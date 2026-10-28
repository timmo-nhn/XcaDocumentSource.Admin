import assert from "node:assert/strict";
import { test } from "node:test";
import { createAtnaClient, normalizeExporterUrl } from "../js/atnaApi.js";

function mockResponse(t, data, status = 200) {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
        requests.push({
            proxy: new URL(url, "http://localhost"),
            target: new URL(new URL(url, "http://localhost").searchParams.get("url")),
            options
        });
        return new Response(status === 204 ? null : JSON.stringify(data), { status });
    });
    return requests;
}

test("base URLs preserve path prefixes and reject unsafe URL components", () => {
    assert.equal(normalizeExporterUrl(" https://example.test/exporter/ "), "https://example.test/exporter");
    for (const value of ["ftp://example.test", "https://user:pass@example.test", "https://example.test?x=1", "https://example.test#x"]) {
        assert.throws(() => normalizeExporterUrl(value), /HTTP\(S\)/);
    }
});

test("health uses existing proxy, optional key header and no-store without leaking key in URL", async t => {
    const health = { status: "Healthy", entries: {} };
    const requests = mockResponse(t, health);
    assert.deepEqual(await createAtnaClient("https://example.test/base/", "secret").health(), health);
    assert.equal(requests[0].target.href, "https://example.test/base/healthz");
    assert.deepEqual([...requests[0].proxy.searchParams.keys()], ["url"]);
    assert.equal(requests[0].options.headers["X-Api-Key"], "secret");
    assert.equal(requests[0].proxy.href.includes("secret"), false);
    assert.equal(requests[0].options.cache, "no-store");
});

test("unhealthy 503 reports remain visible", async t => {
    mockResponse(t, { status: "Unhealthy", entries: { kafka: { status: "Unhealthy" } } }, 503);
    assert.equal((await createAtnaClient("https://example.test").health()).status, "Unhealthy");
});

test("health rejects invalid response shapes", async t => {
    mockResponse(t, { message: "not health" });
    await assert.rejects(createAtnaClient("https://example.test").health(), /expected health report/);
});

test("search uses actual controller route, repeated UTC dates and encoded identifier tokens", async t => {
    const requests = mockResponse(t, { resourceType: "Bundle", entry: [], total: 0 });
    await createAtnaClient("https://example.test").search({
        from: "2026-10-22T10:00:00Z", to: "2026-10-22T11:00:00Z",
        patient: "urn:oid:1|a+b", source: "system|source"
    });
    const target = requests[0].target;
    assert.equal(target.pathname, "/R4/fhir/AuditEvent");
    assert.deepEqual(target.searchParams.getAll("date"), ["ge2026-10-22T10:00:00.000Z", "le2026-10-22T11:00:00.000Z"]);
    assert.equal(target.searchParams.get("patient.identifier"), "urn:oid:1|a+b");
    assert.equal(target.searchParams.get("source:identifier"), "system|source");
});

test("empty searches omit query parameters and empty Bundles are valid", async t => {
    const requests = mockResponse(t, { resourceType: "Bundle" });
    await createAtnaClient("http://localhost:8080").search();
    assert.equal(requests[0].target.search, "");
    assert.deepEqual(requests[0].options.headers, {});
});

test("invalid and inverted dates fail before making requests", async t => {
    const requests = mockResponse(t, {});
    const client = createAtnaClient("https://example.test");
    await assert.rejects(client.search({ from: "bad date" }), /valid recorded dates/);
    await assert.rejects(client.search({ from: "2026-10-23", to: "2026-10-22" }), /must not be after/);
    assert.equal(requests.length, 0);
});

test("read encodes IDs and rejects non-Bundle responses", async t => {
    const requests = mockResponse(t, { resourceType: "OperationOutcome" });
    const client = createAtnaClient("https://example.test");
    await assert.rejects(client.read("a/b"), /FHIR Bundle/);
    assert.equal(requests[0].target.pathname, "/R4/fhir/AuditEvent/a%2Fb");
    await assert.rejects(client.read(" "), /event ID/);
});

test("FHIR error diagnostics are surfaced", async t => {
    mockResponse(t, { resourceType: "OperationOutcome", issue: [{ diagnostics: "Invalid date filter" }] }, 400);
    await assert.rejects(createAtnaClient("https://example.test").search(), /HTTP 400: Invalid date filter/);
});

test("proxy failures are not converted to successful empty data", async t => {
    mockResponse(t, { error: "Connection refused" }, 502);
    await assert.rejects(createAtnaClient("https://example.test").health(), /HTTP 502: Connection refused/);
});

test("503 FHIR errors are not accepted as unhealthy health reports", async t => {
    mockResponse(t, { resourceType: "OperationOutcome", issue: [{ diagnostics: "Service unavailable" }] }, 503);
    await assert.rejects(createAtnaClient("https://example.test").health(), /HTTP 503: Service unavailable/);
});

test("non-JSON errors are explicit", async t => {
    t.mock.method(globalThis, "fetch", async () => new Response("Bad Gateway", { status: 502 }));
    await assert.rejects(createAtnaClient("https://example.test").health(), /HTTP 502.*Bad Gateway/);
});

test("dead-letter list has bounded integer limit and validates response shape", async t => {
    const requests = mockResponse(t, []);
    const client = createAtnaClient("https://example.test");
    assert.deepEqual(await client.deadLetters(50), []);
    assert.equal(requests[0].target.pathname, "/admin/dead-letter");
    assert.equal(requests[0].target.searchParams.get("limit"), "50");
    for (const limit of [0, -1, 1.5, 1001, NaN]) await assert.rejects(client.deadLetters(limit), /integer/);
    assert.equal(requests.length, 1);
});

test("dead-letter lists reject unexpected response shapes", async t => {
    mockResponse(t, { error: "not a list" });
    await assert.rejects(createAtnaClient("https://example.test").deadLetters(), /dead-letter list/);
});

test("retry requires confirmation in the response and POSTs only the requested entry", async t => {
    const requests = mockResponse(t, { resolved: true });
    await createAtnaClient("https://example.test").deadLetterAction(42, "retry");
    assert.equal(requests[0].target.pathname, "/admin/dead-letter/42/retry");
    assert.equal(requests[0].options.method, "POST");
});

test("resolve accepts 204 and invalid actions never send requests", async t => {
    const requests = mockResponse(t, null, 204);
    const client = createAtnaClient("https://example.test");
    assert.equal(await client.deadLetterAction(42, "resolve"), null);
    assert.equal(requests[0].target.pathname, "/admin/dead-letter/42/resolve");
    await assert.rejects(client.deadLetterAction("../1", "retry"), /Invalid/);
    await assert.rejects(client.deadLetterAction(1, "delete"), /Invalid/);
    assert.equal(requests.length, 1);
});

test("retry without resolved=true fails explicitly", async t => {
    mockResponse(t, { resolved: false });
    await assert.rejects(createAtnaClient("https://example.test").deadLetterAction(1, "retry"), /did not confirm/);
});
