const frame = document.getElementById("app");
const results = document.getElementById("results");
const passed = [];
const requests = [];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function waitFor(predicate) {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for UI.");
}

try {
    await waitFor(() => frame.contentDocument?.readyState === "complete"
        && frame.contentDocument.getElementById("atnaApiKey"));
    const app = frame.contentWindow;
    const get = id => frame.contentDocument.getElementById(id);
    let unhealthy = false;
    let failed = false;
    let empty = false;
    let accept = false;
    let resolved = false;
    let searchFailure = false;
    let multipleEvents = false;
    const payload = "<img src=x onerror=alert('unsafe')>";
    app.confirm = () => accept;
    app.fetch = async (url, options) => {
        const proxy = new URL(url, location.origin);
        const target = new URL(proxy.searchParams.get("url"));
        requests.push({ target, options });
        assert([...proxy.searchParams.keys()].join(",") === "url", "ATNA must use the existing proxy.");
        if (failed) return new Response(JSON.stringify({ error: "Connection refused" }), { status: 502 });
        if (target.pathname === "/healthz") {
            return new Response(JSON.stringify({
                status: unhealthy ? "Unhealthy" : "Healthy",
                entries: { kafka: { status: unhealthy ? "Unhealthy" : "Healthy", description: payload } }
            }), { status: unhealthy ? 503 : 200 });
        }
        if (target.pathname.startsWith("/R4/fhir/AuditEvent")) {
            if (searchFailure) return new Response(JSON.stringify({ issue: [{ diagnostics: "Invalid search" }] }), { status: 400 });
            return new Response(JSON.stringify({
                resourceType: "Bundle", total: empty ? 0 : multipleEvents ? 4 : 1,
                entry: empty ? [] : [
                    ...(multipleEvents ? [
                        { resource: { resourceType: "AuditEvent", id: "missing" } },
                        { resource: { resourceType: "AuditEvent", id: "older", recorded: "2026-10-22T09:00:00Z" } },
                        { resource: { resourceType: "AuditEvent", id: "invalid", recorded: "not-a-date" } }
                    ] : []),
                    { resource: {
                    resourceType: "AuditEvent", id: "audit-1", recorded: "2026-10-22T10:00:00.456789Z",
                    type: { display: payload }, action: "R", outcome: "0"
                } }]
            }));
        }
        if (options.method === "POST") {
            resolved = true;
            return target.pathname.endsWith("/resolve")
                ? new Response(null, { status: 204 })
                : new Response(JSON.stringify({ resolved: true }));
        }
        if (target.pathname === "/admin/dead-letter") {
            return new Response(JSON.stringify(resolved ? [] : [
                { id: 40, auditEventId: "missing-date", observerName: "Postgres" },
                { id: 41, auditEventId: "older", failedAt: "2026-10-22T09:00:00Z", observerName: "Kafka" },
                { id: 42, auditEventId: "audit-1", failedAt: "2026-10-22T10:00:00.456789Z", observerName: "Kafka", retryCount: 2, errorMessage: payload }
            ]));
        }
        throw new Error(`Unexpected request: ${target}`);
    };

    get("atnaApiKey").value = "test-key";
    get("connectionForm").requestSubmit();
    await waitFor(() => !get("atnaContent").hidden);
    assert(requests.length === 1, "Connect should only read health.");
    assert(requests[0].options.headers["X-Api-Key"] === "test-key", "Key not forwarded.");
    assert(!frame.contentDocument.querySelector("img"), "Health data executed HTML.");
    assert(get("healthChecks").querySelectorAll(".card--ok").length === 2, "Healthy overall and component must use shared success cards.");
    assert(get("healthChecks").querySelector(".card__label").textContent === "Overall Status", "Overall status card missing.");
    passed.push("Connect, optional key, explicit data loading and safe health rendering");

    get("dateFrom").value = "2026-10-22T10:00";
    get("dateTo").value = "2026-10-22T11:00";
    get("patientIdentifier").value = "system|patient";
    get("sourceIdentifier").value = "system|source";
    get("searchForm").requestSubmit();
    await waitFor(() => get("auditRows").querySelectorAll(".atna-event-row").length === 1);
    assert(get("auditHeading").tagName === "H2" && get("auditHeading").textContent === "Events (1)", "Event heading must be H2 with count.");
    assert(get("auditRows").closest("table").classList.contains("pid-table"), "Events must use the shared table layout.");
    assert(get("auditRows").closest("table").querySelector("th").textContent === "Recorded", "Recorded must be the first column.");
    assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.45$/.test(get("auditRows").rows[0].cells[0].textContent), "Recorded must show local date/time with exactly two fractional-second digits.");
    assert(get("auditRows").rows[0].cells[0].title === "2026-10-22T10:00:00.456789Z", "Full recorded timestamp must remain available.");
    const search = requests.at(-1).target;
    assert(search.searchParams.getAll("date").length === 2, "Date bounds missing.");
    assert(search.searchParams.get("patient.identifier") === "system|patient", "Patient filter missing.");
    assert(search.searchParams.get("source:identifier") === "system|source", "Source filter missing.");
    assert(!frame.contentDocument.querySelector("img"), "Audit data executed HTML.");
    const eventRow = get("auditRows").querySelector(".atna-event-row");
    eventRow.click();
    const detailsRow = eventRow.nextElementSibling;
    assert(detailsRow.classList.contains("doc-expand-row--open"), "JSON action must expand the row immediately below its event.");
    assert(detailsRow.querySelector("pre").textContent.includes("audit-1"), "Inline event JSON missing.");
    assert(eventRow.getAttribute("aria-expanded") === "true", "Expanded state missing.");
    eventRow.click();
    assert(!detailsRow.classList.contains("doc-expand-row--open") && eventRow.getAttribute("aria-expanded") === "false", "Clicking the event must collapse its details.");
    eventRow.click();
    assert(detailsRow.classList.contains("doc-expand-row--open"), "Clicking the event must expand its details.");
    passed.push("Filtered search and safe event JSON details");

    multipleEvents = true;
    get("searchForm").requestSubmit();
    await waitFor(() => get("auditHeading").textContent === "Events (4)");
    const sortedEvents = [...get("auditRows").querySelectorAll(".atna-event-row")];
    assert(sortedEvents.map(row => row.cells[1].textContent).join(",") === "audit-1,older,missing,invalid", "Events must sort newest first with missing/invalid timestamps last.");
    assert(sortedEvents.every(row => row.nextElementSibling.querySelector("pre").textContent.includes(row.cells[1].textContent)), "Sorted event details must stay with their parent.");
    multipleEvents = false;
    passed.push("Newest-first event ordering with missing/invalid dates and paired detail rows");

    get("eventId").value = "audit-1";
    get("readForm").requestSubmit();
    await waitFor(() => !get("readForm").querySelector("button").disabled);
    assert(requests.at(-1).target.pathname === "/R4/fhir/AuditEvent/audit-1", "Read route is incorrect.");
    empty = true;
    get("searchForm").requestSubmit();
    await waitFor(() => get("auditHeading").textContent === "Events (0)");
    assert(get("auditRows").rows.length === 0, "Stale event results retained.");
    searchFailure = true;
    get("searchForm").requestSubmit();
    await waitFor(() => !get("searchError").hidden);
    assert(get("searchError").textContent.includes("Invalid search"), "Search error missing.");
    assert(get("auditHeading").textContent === "Events", "Failed searches must clear the stale heading count.");
    passed.push("Read by ID, empty results, stale-result clearing and search failures");

    get("deadLetterForm").requestSubmit();
    await waitFor(() => get("deadLetterHeading").textContent === "Dead letters (3)");
    const dlqRows = [...get("deadLetterRows").querySelectorAll(".atna-dead-letter-row")];
    assert(dlqRows.map(row => row.cells[1].textContent).join(",") === "42,41,40", "DLQ must sort by failure time, newest first.");
    assert(get("deadLetterHeading").tagName === "H2", "DLQ heading must be H2.");
    assert(get("deadLetterRows").closest("table").classList.contains("pid-table"), "DLQ must use shared table styles.");
    assert(get("deadLetterRows").closest("table").querySelector("th").textContent === "Failed at", "Failure timestamp must be first.");
    assert(/\.45$/.test(dlqRows[0].cells[0].textContent), "DLQ dates must use two fractional digits.");
    const action = label => get("deadLetterRows").querySelector(`button[aria-label="${label}"]`);
    assert(!frame.contentDocument.querySelector("img"), "Dead-letter data executed HTML.");
    action("View dead-letter JSON").click();
    const dlqDetails = dlqRows[0].nextElementSibling;
    assert(dlqDetails.classList.contains("doc-expand-row--open") && dlqDetails.querySelector("pre").textContent.includes("Kafka"), "Inline dead-letter details missing.");
    assert(dlqDetails.cells[0].colSpan === 7, "DLQ details must span the full table.");
    dlqRows[0].click();
    assert(!dlqDetails.classList.contains("doc-expand-row--open"), "DLQ row click must collapse details.");
    dlqRows[0].dispatchEvent(new app.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert(dlqDetails.classList.contains("doc-expand-row--open"), "DLQ rows must support keyboard expansion.");
    assert([...dlqRows[0].querySelectorAll("button")].every(button => button.classList.contains("btn-action-doc")), "DLQ actions must use shared compact styling.");
    const before = requests.length;
    action("Retry dead letter").click();
    assert(requests.length === before, "Cancelled retry sent a request.");
    assert(dlqDetails.classList.contains("doc-expand-row--open"), "Retry action must not toggle details.");
    accept = true;
    action("Retry dead letter").click();
    await waitFor(() => get("deadLetterStatus").textContent.includes("Retry succeeded"));
    assert(requests.some(request => request.options.method === "POST" && request.target.pathname === "/admin/dead-letter/42/retry"), "Retry POST missing.");
    resolved = false;
    get("deadLetterForm").requestSubmit();
    await waitFor(() => get("deadLetterHeading").textContent === "Dead letters (3)");
    action("Resolve dead letter").click();
    await waitFor(() => get("deadLetterStatus").textContent.includes("Resolve succeeded"));
    assert(get("deadLetterRows").rows.length === 0, "Resolved entry still shown.");
    assert(get("deadLetterHeading").textContent === "Dead letters (0)", "Empty DLQ count must be zero.");
    passed.push("Dead-letter inspection, confirmation, retry and resolve with refreshed list");

    unhealthy = true;
    get("refreshHealth").click();
    assert(get("healthChecks").querySelector(".card--loading"), "Refresh must show the shared loading card.");
    await waitFor(() => get("healthStatus").textContent.includes("Overall: Unhealthy"));
    assert(get("healthChecks").querySelectorAll(".card--error").length === 2, "Unhealthy results must use shared error cards.");
    failed = true;
    get("refreshHealth").click();
    await waitFor(() => get("healthStatus").textContent === "Health unavailable.");
    assert(get("healthChecks").querySelector(".card--error .card__value").textContent.includes("Connection refused"), "Refresh errors must use shared error cards.");
    failed = false;
    get("instanceUrl").value = "https://other.example";
    get("connectionForm").requestSubmit();
    await waitFor(() => get("connectionStatus").textContent.includes("other.example"));
    assert(get("auditRows").rows.length === 0 && get("deadLetterRows").rows.length === 0, "Old instance data retained.");
    failed = true;
    get("connectionForm").requestSubmit();
    await waitFor(() => !get("connectionError").hidden);
    assert(get("atnaContent").hidden && get("connectionError").textContent.includes("Connection refused"), "Failed connection retained data or hid connection error.");
    passed.push("Shared health cards, loading/error states, unhealthy reports, instance switching and explicit connection errors");

    results.textContent = `PASS (${passed.length})\n${passed.join("\n")}`;
    results.dataset.state = "passed";
} catch (error) {
    results.textContent = `FAIL\n${error.stack}\nPassed:\n${passed.join("\n")}`;
    results.dataset.state = "failed";
}
