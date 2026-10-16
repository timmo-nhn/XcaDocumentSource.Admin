import assert from "node:assert/strict";
import { test } from "node:test";
import { listAllDocumentEntries, listDocumentEntries } from "../js/documentsApi.js";

function mockPages(t, pageLengths) {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url) => {
        const target = new URL(new URL(url, "http://localhost").searchParams.get("url"));
        requests.push(target);
        const page = Number(target.searchParams.get("pageNumber"));
        assert.ok(page in pageLengths, `Unexpected page request: ${page}`);
        return new Response(JSON.stringify({
            documentListEntries: Array.from({ length: pageLengths[page] }, (_, index) => ({
                documentReference: { id: `${page}-${index}` }
            }))
        }), { headers: { "Content-Type": "application/json" } });
    });
    return requests;
}

test("document list defaults to one request for page 1 with 50 entries", async (t) => {
    const requests = mockPages(t, { 1: 50 });
    const entries = await listDocumentEntries("https://example.test", "patient^^^&system&ISO");
    assert.equal(entries.length, 50);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("pageNumber"), "1");
    assert.equal(requests[0].searchParams.get("pageSize"), "50");
    assert.equal(requests[0].searchParams.get("id"), "patient^^^&system&ISO");
});

test("document list requests only the specified page", async (t) => {
    const requests = mockPages(t, { 3: 12 });
    const entries = await listDocumentEntries("https://example.test", "patient", 3);
    assert.equal(entries.length, 12);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("pageNumber"), "3");
});

test("full download collects all pages until a partial page", async (t) => {
    const requests = mockPages(t, { 1: 50, 2: 50, 3: 7 });
    const entries = await listAllDocumentEntries("https://example.test", "patient");
    assert.equal(entries.length, 107);
    assert.deepEqual(requests.map((url) => url.searchParams.get("pageNumber")), ["1", "2", "3"]);
    assert.equal(entries[100].documentReference.id, "3-0");
});

test("full download stops on an empty page after an exact page boundary", async (t) => {
    const requests = mockPages(t, { 1: 50, 2: 0 });
    assert.equal((await listAllDocumentEntries("https://example.test", "patient")).length, 50);
    assert.equal(requests.length, 2);
});

test("empty patient list does not request another page", async (t) => {
    const requests = mockPages(t, { 1: 0 });
    assert.deepEqual(await listAllDocumentEntries("https://example.test", "patient"), []);
    assert.equal(requests.length, 1);
});

test("page errors preserve the HTTP status and message", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
    await assert.rejects(listDocumentEntries("https://example.test", "patient", 2), (error) => {
        assert.equal(error.status, 503);
        assert.match(error.message, /Failed to load document list/);
        assert.match(error.message, /Unavailable/);
        return true;
    });
});
