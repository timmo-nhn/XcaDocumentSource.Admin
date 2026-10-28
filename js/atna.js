import { createAtnaClient } from "./atnaApi.js";
import { renderCard, capitalize, boolStatus } from "./utils.js";

const element = id => document.getElementById(id);
let client;
let busy = false;

function clearError(id) {
    element(id).textContent = "";
    element(id).hidden = true;
}

function newestFirst(entries, timestamp) {
    const time = value => {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : -Infinity;
    };
    return [...entries].sort((a, b) => {
        const first = time(timestamp(a));
        const second = time(timestamp(b));
        return first === second ? 0 : first > second ? -1 : 1;
    });
}

function addTimestampCell(row, value) {
    const date = value ? new Date(value) : null;
    let text = value ?? "";
    if (date && Number.isFinite(date.getTime())) {
        const pad = (value, length = 2) => String(value).padStart(length, "0");
        text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
            + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.`
            + pad(date.getMilliseconds(), 3).slice(0, 2);
    }
    const cell = addCell(row, text);
    cell.title = value ?? "";
}

function addJsonExpansion(row, value, id, actions = null) {
    const expandedRow = row.parentElement.insertRow();
    expandedRow.className = "doc-expand-row";
    expandedRow.id = id;
    const cell = expandedRow.insertCell();
    cell.colSpan = row.cells.length;
    const content = document.createElement("div");
    content.className = "doc-list-content";
    const json = document.createElement("pre");
    json.textContent = JSON.stringify(value, null, 2);
    content.append(json);
    cell.append(content);
    let button;
    const toggle = () => {
        const open = expandedRow.classList.toggle("doc-expand-row--open");
        row.setAttribute("aria-expanded", String(open));
        button?.setAttribute("aria-expanded", String(open));
    };
    row.setAttribute("aria-controls", id);
    row.setAttribute("aria-expanded", "false");
    row.tabIndex = 0;
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", event => {
        if (event.target === row && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            toggle();
        }
    });
    if (actions) {
        button = addButton(actions, "\u{1F9D1}\u200D\u{1F4BB}", event => {
            event.stopPropagation();
            toggle();
        });
        button.className = "btn-action-doc";
        button.title = "View dead-letter JSON";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-controls", id);
        button.setAttribute("aria-expanded", "false");
    }
}

async function run(errorId, action) {
    if (busy) return;
    busy = true;
    clearError(errorId);
    const controls = [...document.querySelectorAll("button, input, select")];
    controls.forEach(control => control.disabled = true);
    try {
        await action();
    } catch (error) {
        element(errorId).textContent = error.message;
        element(errorId).hidden = false;
    } finally {
        busy = false;
        controls.forEach(control => control.disabled = false);
    }
}

function addCell(row, value) {
    const cell = row.insertCell();
    cell.textContent = value ?? "";
    return cell;
}

function addButton(cell, label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    cell.append(button);
    return button;
}

function renderHealth(health) {
    element("healthStatus").textContent = `Overall: ${health.status} | Checked ${new Date().toLocaleString()}`;
    const status = health.status.toLowerCase();
    element("healthChecks").innerHTML = [
        renderCard("Overall Status", status === "healthy" ? "ok" : "error", capitalize(status)),
        ...Object.entries(health.entries).map(([name, check]) => {
            const status = typeof check?.status === "string" ? check.status.toLowerCase() : "unknown";
            const state = boolStatus(status === "unknown" ? undefined : status === "healthy");
            const value = `${capitalize(status)}${check?.description ? ` - ${check.description}` : ""}`;
            return renderCard(capitalize(name), state, value);
        })
    ].join("");
}

function resetResults() {
    element("auditHeading").textContent = "Events";
    element("deadLetterHeading").textContent = "Dead letters";
    for (const id of ["auditRows", "deadLetterRows", "healthChecks"]) element(id).replaceChildren();
    for (const id of ["searchStatus", "deadLetterStatus", "healthStatus"]) element(id).textContent = "";
    for (const id of ["searchError", "deadLetterError"]) clearError(id);
}

element("instancePreset").addEventListener("change", event => {
    element("instanceUrl").value = event.target.value;
});
element("instanceUrl").addEventListener("input", () => {
    element("instancePreset").value = [...element("instancePreset").options]
        .some(option => option.value === element("instanceUrl").value) ? element("instanceUrl").value : "";
});

element("connectionForm").addEventListener("submit", event => {
    event.preventDefault();
    run("connectionError", async () => {
        client = undefined;
        element("atnaContent").hidden = true;
        resetResults();
        element("connectionStatus").textContent = "Connecting...";
        try {
            const next = createAtnaClient(element("instanceUrl").value, element("atnaApiKey").value);
            const health = await next.health();
            client = next;
            renderHealth(health);
            element("connectionStatus").textContent = `Connected to ${client.baseUrl}`;
            element("atnaContent").hidden = false;
        } catch (error) {
            element("connectionStatus").textContent = "Connection failed.";
            throw error;
        }
    });
});

element("refreshHealth").addEventListener("click", () => run("connectionError", async () => {
    element("healthChecks").innerHTML = renderCard("Health Check", "loading", null);
    element("healthStatus").textContent = "Loading health...";
    try {
        renderHealth(await client.health());
    } catch (error) {
        element("healthStatus").textContent = "Health unavailable.";
        element("healthChecks").innerHTML = renderCard("Health Check", "error", error.message);
        throw error;
    }
}));

function renderEvents(bundle) {
    const rows = element("auditRows");
    let count = 0;
    for (const entry of newestFirst(bundle.entry || [], entry => entry.resource?.recorded)) {
        const audit = entry.resource;
        if (!audit) continue;
        const row = rows.insertRow();
        row.className = "atna-event-row";
        count += 1;
        addTimestampCell(row, audit.recorded);
        const idCell = addCell(row, "");
        idCell.className = "pid-id";
        const code = document.createElement("code");
        code.textContent = audit.id ?? "";
        idCell.append(code);
        addCell(row, audit.type?.display || audit.type?.code);
        addCell(row, audit.action);
        addCell(row, audit.outcome);
        addCell(row, audit.source?.observer?.identifier?.value || audit.source?.observer?.reference);
        addJsonExpansion(row, audit, `audit-details-${count}`);
    }
    element("auditHeading").textContent = `Events (${count})`;
    element("searchStatus").textContent = `Reported total: ${bundle.total ?? count}.`;
}

function search(action) {
    return run("searchError", async () => {
        element("auditRows").replaceChildren();
        element("auditHeading").textContent = "Events";
        element("searchStatus").textContent = "Loading audit events...";
        try {
            renderEvents(await action());
        } catch (error) {
            element("searchStatus").textContent = "Audit events unavailable.";
            throw error;
        }
    });
}

element("searchForm").addEventListener("submit", event => {
    event.preventDefault();
    search(() => client.search({
        from: element("dateFrom").value, to: element("dateTo").value,
        patient: element("patientIdentifier").value, source: element("sourceIdentifier").value
    }));
});
element("readForm").addEventListener("submit", event => {
    event.preventDefault();
    search(() => client.read(element("eventId").value));
});

async function loadDeadLetters() {
    element("deadLetterRows").replaceChildren();
    element("deadLetterHeading").textContent = "Dead letters";
    element("deadLetterStatus").textContent = "Loading dead letters...";
    try {
        const entries = await client.deadLetters(Number(element("deadLetterLimit").value));
        for (const entry of newestFirst(entries, entry => entry.failedAt)) {
            const row = element("deadLetterRows").insertRow();
            row.className = "atna-dead-letter-row";
            addTimestampCell(row, entry.failedAt);
            for (const value of [entry.id, entry.auditEventId, entry.observerName, entry.retryCount, entry.errorMessage]) {
                addCell(row, value);
            }
            const actions = row.insertCell();
            actions.className = "pid-actions";
            for (const action of ["retry", "resolve"]) {
                const button = addButton(actions, action === "retry" ? "\u{1F504}" : "\u2705", event => {
                    event.stopPropagation();
                    const explanation = action === "retry" ? "Re-run the failed observer?" : "Mark handled WITHOUT reprocessing?";
                    if (!confirm(`${client.baseUrl}\nDead letter ${entry.id}: ${explanation}`)) return;
                    run("deadLetterError", async () => {
                        await client.deadLetterAction(entry.id, action);
                        element("deadLetterRows").replaceChildren();
                        try {
                            await loadDeadLetters();
                        } catch (error) {
                            throw new Error(`Action succeeded, but refreshing the list failed: ${error.message}`);
                        }
                        element("deadLetterStatus").textContent += ` ${action === "retry" ? "Retry" : "Resolve"} succeeded for ${entry.id}.`;
                    });
                });
                button.className = "btn-action-doc";
                button.title = action === "retry" ? "Retry dead letter" : "Resolve dead letter";
                button.setAttribute("aria-label", button.title);
            }
            addJsonExpansion(row, entry, `dead-letter-details-${entry.id}`, actions);
        }
        element("deadLetterHeading").textContent = `Dead letters (${entries.length})`;
        element("deadLetterStatus").textContent = `${entries.length} unresolved failure(s) loaded (limit ${element("deadLetterLimit").value}).`;
    } catch (error) {
        element("deadLetterStatus").textContent = "Dead letters unavailable.";
        throw error;
    }
}

element("deadLetterForm").addEventListener("submit", event => {
    event.preventDefault();
    run("deadLetterError", loadDeadLetters);
});
