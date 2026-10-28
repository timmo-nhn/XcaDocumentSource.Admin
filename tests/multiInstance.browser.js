import { sourceOptions } from "../js/sources.js";

const originalFetch = globalThis.fetch;
const originalAlert = globalThis.alert;
const originalConfirm = globalThis.confirm;
const passed = [];
const requests = [];
const alerts = [];
const failedSources = new Set([sourceOptions[1], sourceOptions[2]]);
const healthResponses = new Map();
let activeConnections = 0;
let maxConnections = 0;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for the UI.");
}

function role(root, name) {
    return root.querySelector(`[data-role="${name}"]`);
}

function assertOnlySource(start, source) {
    const recent = requests.slice(start);
    assert(recent.length > 0 && recent.every((request) => request.source === source), "Requests escaped their instance.");
}

async function mockFetch(url, options = {}) {
    if (!String(url).startsWith("/proxy?")) return originalFetch(url, options);
    const target = new URL(new URL(url, location.origin).searchParams.get("url"));
    const source = target.origin;
    requests.push({ source, path: target.pathname, params: target.searchParams, ...options });

    switch (target.pathname) {
        case "/secure":
            activeConnections += 1;
            maxConnections = Math.max(maxConnections, activeConnections);
            await new Promise((resolve) => setTimeout(resolve, 20));
            activeConnections -= 1;
            return failedSources.has(source)
                ? new Response("Denied", { status: source === sourceOptions[1] ? 401 : 503 })
                : new Response("OK");
        case "/api/health-check":
            if (healthResponses.has(source)) {
                const { body, status } = healthResponses.get(source);
                return Response.json(body, { status });
            }
            return Response.json({
                uptimeInSeconds: 3661,
                healthReport: {
                    status: "healthy",
                    entries: {
                        registry: { status: "healthy" },
                        repository: { status: "healthy" },
                        atnalogexport: { status: "healthy" }
                    }
                }
            });
        case "/api/about/config":
            return Response.json({ friendlyName: source, homeCommunityId: source, repositoryUniqueId: source });
        case "/api/implementations":
            return Response.json([{ serviceType: "IRegistry", implementationType: source }]);
        case "/api/about/registryobjects":
            return Response.json({ documentEntries: 53 });
        case "/api/debug-patient-identifiers":
            return Response.json([0, 1].map((index) => ({
                patientId: { id: `patient-${index}`, system: "test-system" },
                firstName: `Patient ${index}`,
                lastName: new URL(source).hostname,
                gender: "M",
                birthTime: "2000-01-01"
            })));
        case "/api/rest/document-list": {
            const page = Number(target.searchParams.get("pageNumber"));
            return Response.json({
                documentListEntries: Array.from({ length: page === 1 ? 50 : 3 }, (_, index) => ({
                    documentReference: { id: `entry-${page}-${index}`, uniqueId: `unique-${page}-${index}`, title: `Doc ${page}-${index}` }
                }))
            });
        }
        case "/api/rest/document-entry":
            return options.method === "POST" || options.method === "PATCH"
                ? Response.json({ ok: true })
                : Response.json({
                    documentEntry: { title: source, sourcePatientInfo: { patientId: {} } },
                    document: { data: "dGVzdA==" },
                    submissionSet: {},
                    association: {}
                });
        case "/api/rest/document-entry-document":
        case "/api/rest/all-data-for-patient":
            return new Response(null, { status: 204 });
        case "/api/generate-test-data":
            return Response.json({ ok: true });
        default:
            throw new Error(`Unexpected test request: ${target}`);
    }
}

try {
    const html = new DOMParser().parseFromString(await (await originalFetch("/")).text(), "text/html");
    document.body.replaceChildren(...html.body.childNodes);
    globalThis.fetch = mockFetch;
    globalThis.alert = (message) => alerts.push(message);
    globalThis.confirm = () => true;
    await import("../js/index.js");

    document.getElementById("apiKeyInput").value = "fixture-key";
    document.getElementById("submitButton").click();
    await waitFor(() => !document.getElementById("submitButton").disabled);
    let roots = [...document.querySelectorAll("#sourceslist > .source")];
    assert(roots.length === sourceOptions.length && maxConnections === sourceOptions.length, "Connections were not concurrent.");
    assert(roots.filter((root) => root.dataset.state === "connected").length === roots.length - 2, "Failures affected healthy instances.");
    assert(role(roots[1], "connection-error").textContent.includes("Invalid API key"), "Missing key validation error.");
    assert(role(roots[2], "connection-error").textContent.includes("503"), "Missing connection error.");
    for (const root of roots.filter((item) => item.dataset.state === "connected")) {
        assert(role(root, "about-config").textContent.includes(root.dataset.source), "Configuration rendered in the wrong panel.");
        assert(role(root, "swagger").href === `${root.dataset.source}/swagger`, "Wrong Swagger target.");
        assert(role(root, "health-summary").dataset.state === "ok", "Missing healthy header indicator.");
        assert(role(root, "uptime-summary").textContent === "Uptime: 1h 1m 1s", "Missing formatted header uptime.");
    }
    assert(role(roots[1], "health-summary").dataset.state === "error", "Failed connection retained healthy state.");
    assert(role(roots[1], "uptime-summary").textContent.includes("unavailable"), "Failed connection retained uptime.");
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    assert(new Set(ids).size === ids.length, "Duplicate DOM IDs.");
    passed.push("All configured instances connect concurrently; status, authentication failures and Swagger links are isolated.");

    const a = roots[0];
    const b = roots[3];
    a.open = true;
    b.open = true;
    a.querySelector("tr[data-patient-id] .btn-action-doc").click();
    assert(role(a, "uploadDocumentPatientIdentifier").value === "patient-0^^^&test-system&ISO", "Wrong patient prefill.");
    assert(role(b, "uploadDocumentPatientIdentifier").value === "", "Patient prefill leaked.");
    a.querySelector("tr[data-patient-id]").click();
    b.querySelector("tr[data-patient-id]").click();
    await waitFor(() => a.querySelector(".doc-load-more") && b.querySelector(".doc-load-more"));
    a.querySelector(".doc-load-more").click();
    await waitFor(() => !a.querySelector(".doc-load-more"));
    const rowCount = (root) => root.querySelectorAll(".doc-list-content > .doc-table > tbody > tr").length;
    assert(rowCount(a) === 53 && rowCount(b) === 50, "Pagination mixed panels.");
    passed.push("Patient prefill and paginated document lists stay within their own accordion.");

    let start = requests.length;
    role(b, "documentEntryIdInput").value = "fetch-b";
    role(b, "fetchDocumentEntryButton").click();
    await waitFor(() => document.getElementById("jsonEditorOverlay").style.display === "flex");
    assert(document.getElementById("jsonEditorTextarea").value.includes(b.dataset.source), "Editor loaded the wrong source.");
    document.getElementById("jsonEditorSaveButton").click();
    await waitFor(() => document.getElementById("jsonEditorOverlay").style.display === "none");
    assertOnlySource(start, b.dataset.source);
    assert(requests.slice(start).some((request) => request.method === "PATCH"), "Editor did not save.");
    passed.push("Fetching and saving JSON refreshes only the originating instance.");

    start = requests.length;
    a.querySelector(".btn-duplicate-document-reference").click();
    assert(document.querySelectorAll("#patient-duplication-table tbody tr[data-patient-id]").length === 2, "Duplication cloned the wrong table.");
    document.querySelector("#patient-duplication-table tbody tr[data-patient-id]").click();
    await waitFor(() => !document.getElementById("patient-duplication-backdrop"));
    assertOnlySource(start, a.dataset.source);
    assert(requests.slice(start).some((request) => request.method === "POST"), "Duplication did not upload.");
    assert(!document.body.style.overflow, "Duplication left scrolling disabled.");
    passed.push("Duplication uses only that instance's patients and restores scrolling.");

    start = requests.length;
    role(a, "refresh").click();
    await waitFor(() => a.dataset.state === "connected");
    assertOnlySource(start, a.dataset.source);
    assert(a.open && b.open, "Refresh changed accordion expansion.");
    const failed = roots[1];
    failedSources.delete(failed.dataset.source);
    start = requests.length;
    role(failed, "refresh").click();
    await waitFor(() => failed.dataset.state === "connected");
    assertOnlySource(start, failed.dataset.source);
    assert(role(failed, "connection-error").hidden, "Retry did not clear the error.");
    passed.push("Refresh and failed-connection retries affect one instance and preserve open accordions.");

    start = requests.length;
    a.querySelector('tr[data-patient-id] button[title="Delete all documents for this patient"]').click();
    await waitFor(() => a.dataset.state === "connecting");
    await waitFor(() => a.dataset.state === "connected");
    assertOnlySource(start, a.dataset.source);
    assert(requests.slice(start).some((request) => request.method === "DELETE"), "Delete did not run.");
    passed.push("Patient deletion refreshes only the instance where it was requested.");

    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify({ template: true })], "template.json", { type: "application/json" }));
    role(b, "testDataFile").files = data.files;
    role(b, "testDataFile").dispatchEvent(new Event("change"));
    role(b, "entriesToGenerate").value = "7";
    role(b, "patientIdentifier").value = "generated-b";
    start = requests.length;
    role(b, "uploadButton").click();
    await waitFor(() => b.dataset.state === "connecting");
    await waitFor(() => b.dataset.state === "connected");
    assertOnlySource(start, b.dataset.source);
    const generation = requests.slice(start).find((request) => request.path === "/api/generate-test-data");
    assert(generation?.params.get("entriesToGenerate") === "7" && generation.params.get("patientIdentifier") === "generated-b", "Generation read another form.");
    passed.push("Test-data generation reads and refreshes only its own form.");

    const uploadData = new DataTransfer();
    uploadData.items.add(new File([JSON.stringify({
        documentEntry: { title: "Upload B" }, document: {}, submissionSet: {}, association: {}
    })], "document.json", { type: "application/json" }));
    role(b, "uploadDocumentFile").files = uploadData.files;
    role(b, "uploadDocumentFile").dispatchEvent(new Event("change"));
    start = requests.length;
    role(b, "uploadDocumentButton").click();
    await waitFor(() => b.dataset.state === "connecting");
    await waitFor(() => b.dataset.state === "connected");
    assertOnlySource(start, b.dataset.source);
    assert(requests.slice(start).some((request) => request.method === "POST"), "Document upload did not run.");
    assert(role(b, "uploadDocumentResponse").textContent.includes("Uploaded 1 document"), "Missing upload response.");
    assert(role(a, "uploadDocumentResponse").hidden, "Upload response leaked to another panel.");
    passed.push("Document uploads and responses stay in the originating instance.");

    for (const [status, health, uptime, expectedState] of [
        [503, "unhealthy", 0, "error"],
        [200, "degraded", 120, "warning"],
        [200, "healthy", null, "ok"]
    ]) {
        healthResponses.set(a.dataset.source, {
            status,
            body: { healthReport: { status: health }, uptimeInSeconds: uptime }
        });
        role(a, "refresh").click();
        await waitFor(() => a.dataset.state === "connected");
        assert(role(a, "health-summary").dataset.state === expectedState, `Wrong header for ${health}.`);
        assert(role(a, "health-summary").textContent.toLowerCase().includes(health), "Missing header health text.");
        assert(role(a, "uptime-summary").textContent === (uptime === null ? "Uptime: unavailable" : uptime === 0 ? "Uptime: 0s" : "Uptime: 2m 0s"), "Wrong refreshed uptime.");
        assert(role(b, "health-summary").dataset.state === "ok", "Health refresh affected another instance.");
    }
    healthResponses.set(a.dataset.source, { status: 503, body: { error: "Health unavailable" } });
    role(a, "refresh").click();
    await waitFor(() => a.dataset.state === "connected");
    assert(role(a, "health-summary").textContent === "Health: Unavailable", "Failed health check retained stale state.");
    assert(role(a, "uptime-summary").textContent === "Uptime: unavailable", "Failed health check retained stale uptime.");
    healthResponses.delete(a.dataset.source);
    passed.push("Header health and uptime update for healthy, degraded, unhealthy, zero uptime and unavailable responses.");

    const customInput = document.getElementById("customSourceInput");
    const customButton = document.getElementById("customConnectButton");
    customInput.value = "not-a-url";
    start = requests.length;
    customButton.click();
    assert(document.getElementById("customConnectionError").textContent && requests.length === start, "Invalid override was not rejected.");
    customInput.value = "https://custom-instance.example/";
    customButton.click();
    await waitFor(() => !customButton.disabled);
    let customRoots = [...document.querySelectorAll("#sourceslist > .source")];
    const custom = customRoots.at(-1);
    assert(customRoots.length === sourceOptions.length + 1 && custom.dataset.source === "https://custom-instance.example", "Custom instance not appended.");
    assert(custom.open && a.isConnected && b.isConnected, "Override replaced existing connections.");
    assert(custom.dataset.state === "connected" && role(custom, "health-summary").dataset.state === "ok", "Custom instance did not connect.");
    assert(document.getElementById("connectionStatus").textContent.includes(`/${sourceOptions.length + 1}`), "Connection counts omit custom instances.");
    customButton.click();
    await waitFor(() => custom.dataset.state === "connected");
    customRoots = [...document.querySelectorAll("#sourceslist > .source")];
    assert(customRoots.length === sourceOptions.length + 1, "Duplicate URL created another accordion.");
    passed.push("Custom URLs append an expanded instance, invalid URLs show errors, and duplicate URLs refresh instead.");

    document.getElementById("submitButton").click();
    await waitFor(() => !document.getElementById("submitButton").disabled);
    roots = [...document.querySelectorAll("#sourceslist > .source")];
    assert(roots.length === sourceOptions.length && !roots.includes(a), "Reconnect duplicated old panels.");
    start = requests.length;
    role(roots[0], "documentEntryIdInput").value = "after-reconnect";
    role(roots[0], "fetchDocumentEntryButton").click();
    await waitFor(() => document.getElementById("jsonEditorOverlay").style.display === "flex");
    assert(requests.slice(start).length === 1, "Reconnect stacked event listeners.");
    document.getElementById("jsonEditorCancelButton").click();
    assert(alerts.length === 0, alerts.join("\n"));
    assert(requests.every((request) => request.headers["X-Api-Key"] === "fixture-key"), "Shared API key not sent consistently.");
    passed.push("Reconnect replaces panels without duplicate listeners.");

    document.body.dataset.result = "passed";
    document.body.textContent = `PASS: ${passed.length} multi-instance browser checks\n\n${passed.join("\n")}`;
} catch (error) {
    document.body.dataset.result = "failed";
    document.body.textContent = `FAIL: ${error.stack}\n\nCompleted:\n${passed.join("\n")}`;
} finally {
    globalThis.fetch = originalFetch;
    globalThis.alert = originalAlert;
    globalThis.confirm = originalConfirm;
}
