import { setUploadDocumentField } from "./actions.js";
import * as viewer from "./documentViewer.js";
import { escapeHtml, formatSize } from "./utils.js";
import {
    deleteAllDataForPatient,
    deleteDocumentById,
    getDocumentEntryById,
    listDocumentEntries,
    listPatients,
    patchDocumentEntryById
} from "./documentsApi.js";
import { openDocumentJsonEditor } from "./documentJsonEditor.js";


const LOADING_ICON_HTML = `<img src="/loading.gif" alt="Loading" width="16" height="16">`;

export async function fetchPatientIdentifiers(source, containerInput) {
    const container = containerInput || document.getElementById("patient-identifiers");
    const patientHeader = container.parentElement.querySelector("h2");
    patientHeader.textContent = "Patients";
    container.innerHTML = `<p class="loading-text">Loading…</p>`;

    try {
        const entries = await listPatients(source);

        if (entries.length === 0) {
            container.innerHTML = `<p class="empty-text">No patients found.</p>`;
            return;
        }

        renderPatientsTable(container, entries);

        const dataRows = [...container.querySelectorAll("tbody tr[data-patient-id]")];
        dataRows.forEach((row) => bindPatientRow(row, source));
    } catch (err) {
        container.innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
}

export async function setupFetchDocumentEntryById(source) {
    const button = document.getElementById("fetchDocumentEntryButton");
    const input = document.getElementById("documentEntryIdInput");

    button.addEventListener("click", async () => {
        const documentEntryId = input.value.trim();
        if (!documentEntryId) {
            alert("Please enter a DocumentEntry ID.");
            return;
        }

        await handleEditDocumentReference(button, source, documentEntryId);
    });

    input.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            button.click();
        }
    });
}

function renderPatientsTable(patientTableContainer, entries) {
    const sortedEntries = [...entries];
    const renderedPatientRows = sortedEntries.map((entry, index) => renderPatientRow(entry, index)).join("");

    setPatientHeaderCount(patientTableContainer, entries.length);
    const tableHtml = `
            <table class="pid-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Patient ID</th>
                        <th>System</th>
                        <th>Date of Birth</th>
                        <th>Gender</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${renderedPatientRows}
                </tbody>
            </table>`;
    patientTableContainer.innerHTML = tableHtml;
}

function setPatientHeaderCount(patientTableContainer, count) {
    const patientHeader = patientTableContainer.parentElement?.querySelector("h2");
    if (!patientHeader) return;

    patientHeader.textContent = `Patients (${count})`;
}

function renderPatientRow(entry, index) {
    const patientId = escapeHtml(entry?.patientId?.id ?? "—");
    const patientSystem = escapeHtml(entry?.patientId?.system ?? "—");
    const patientName = escapeHtml([entry?.firstName, entry?.lastName].filter(Boolean).join(" ") || "—");
    const dateOfBirth = escapeHtml(entry?.birthTime ? new Date(entry.birthTime).toLocaleDateString("no-NO", { year: "numeric", month: "short", day: "numeric" }) : "—");
    const gender = escapeHtml(entry?.gender === "M" ? "♂ Male" : entry?.gender === "F" ? "♀ Female" : entry?.gender ?? "—");
    const expandId = `expand-${index}`;

    return `
        <tr data-patient-id="${patientId}" data-patient-id-system="${patientSystem}" data-patient-name="${patientName}">
            <td class="pid-name">${patientName}</td>
            <td class="pid-id"><code>${patientId}</code></td>
            <td class="pid-system"><code>${patientSystem}</code></td>
            <td>${dateOfBirth}</td>
            <td>${gender}</td>
            <td class="pid-actions"></td>
        </tr>
        <tr id="${expandId}" class="doc-expand-row">
            <td colspan="6">
                <div class="doc-list-content"></div>
            </td>
        </tr>`;
}

function bindPatientRow(row, source) {
    addUploadDocumentButton(row);
    addDeleteAllDataButton(row, source);
    // addFindPatientInSyntpopButton(row);
    addDocumentListToggle(row, source);
}


function addUploadDocumentButton(row) {
    if (row.dataset.uploadAttached === "true") return;
    row.dataset.uploadAttached = "true";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-action-doc";
    button.textContent = "⏫";
    button.title = "Upload document for this patient (Shift+Click to open the upload form)";
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        setUploadDocumentField(event, row.dataset.patientId, row.dataset.patientIdSystem);
    });

    row.querySelector("td.pid-actions").append(button);
}

function addDeleteAllDataButton(row, source) {
    if (row.dataset.deleteAttached === "true") return;
    row.dataset.deleteAttached = "true";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-action-doc";
    button.textContent = "🛑";
    button.title = "Delete all documents for this patient";
    button.addEventListener("click", async (event) => {
        event.stopPropagation();

        const patientIdentifier = row.dataset.patientId;
        const patientSystem = row.dataset.patientIdSystem;
        if (!patientIdentifier || !patientSystem) {
            throw new Error("Missing patient identifier or patient system.");
        }

        const confirmed = confirm(`Delete all data for patient ${patientIdentifier} (${patientSystem})?`);
        if (!confirmed) return;

        setButtonLoading(button);
        try {
            await deleteAllDataForPatient(source, patientIdentifier, patientSystem);
            document.getElementById("submitButton").click();
        } catch (err) {
            alert(`Failed to delete all data for patient.\n\n${err.message}`);
        } finally {
            restoreButton(button, "🛑");
        }
    });

    row.querySelector("td.pid-actions").append(button);
}

function addFindPatientInSyntpopButton(row) {
    if (row.dataset.syntpopAttached === "true") return;
    row.dataset.syntpopAttached = "true";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-action-doc";
    button.textContent = "🤖";
    button.title = "Find patient in SyntPop";

    button.addEventListener("click", async (event) => {
        event.stopPropagation();

        const name = row.dataset.patientName;
        if (!name) {
            throw new Error("Missing patient name.");
        }

        setButtonLoading(button);
        let response = await synpopClient.getByName(name);

        restoreButton(button, "🤖");
    });

    row.querySelector("td.pid-actions").append(button);
}

function addDocumentListToggle(row, source) {
    if (row.dataset.attached === "true") return;
    row.dataset.attached = "true";

    row.addEventListener("click", () => {
        const expandRow = row.nextElementSibling;
        if (!expandRow || !expandRow.classList.contains("doc-expand-row")) return;

        const isOpen = expandRow.classList.toggle("doc-expand-row--open");
        row.classList.toggle("btn-docs--active", isOpen);
        if (isOpen && expandRow.dataset.loaded !== "true") {
            expandRow.dataset.loaded = "true";
            loadDocumentList(source, getPatientLookupId(row), expandRow);
        }
    });
}

function getPatientLookupId(row) {
    return `${row.dataset.patientId}^^^&${row.dataset.patientIdSystem}&ISO`;
}

async function loadDocumentList(source, patientId, expandRow) {
    const content = expandRow.querySelector(".doc-list-content");
    content.innerHTML = `<p class="loading-text">Loading documents…</p>`;

    try {
        const documents = await listDocumentEntries(source, patientId);
        if (documents.length === 0) {
            content.innerHTML = `<p class="empty-text">No documents found.</p>`;
            return;
        }

        content.innerHTML = renderDocumentTable(documents);
        wireDocumentTableInteractions(content, source, patientId, expandRow);
    } catch (err) {
        content.innerHTML = `<p class="error-text">${escapeHtml(err.message)}</p>`;
    }
}

function renderDocumentTable(documents) {
    const rows = documents.map((docRef) => {
        const reference = docRef.documentReference ?? {};
        const entryId = reference.id ?? "";
        const documentId = reference.uniqueId;
        const documentReferenceId = reference.id;
        const titleRaw = reference.title ?? reference.name ?? "—";
        const created = reference.creationTime ?? reference.created ?? reference.date;

        const rowClass = docRef?.linkToDocument?.url ? " class=\"doc-row-link\"" : "";
        const rowAttrs = docRef?.linkToDocument?.url
            ? ` data-link="${encodeURIComponent(docRef.linkToDocument.url)}" data-title="${encodeURIComponent(titleRaw)}" data-mime="${encodeURIComponent(reference?.mimeType ?? reference?.contentType ?? "Unknown")}"`
            : "";

        const editButton = entryId
            ? `<button type="button" class="btn-action-doc btn-edit-document-reference" data-entry-id="${encodeURIComponent(entryId)}" title="Edit document reference JSON">✏️</button>`
            : "—";

        const duplicateDocumentReference = entryId
            ? `<button type="button" class="btn-action-doc btn-duplicate-document-reference" data-entry-id="${encodeURIComponent(entryId)}" title="Duplicate document reference to another patient">📋</button>`
            : "—";

        const deleteButton = documentId
            ? `<button type="button" class="btn-action-doc btn-delete-document" data-doc-id="${encodeURIComponent(documentId)}" title="Delete this document">🛑</button>`
            : "—";

        return `
            <tr${rowClass}${rowAttrs}>
                <td>${escapeHtml(titleRaw)}</td>
                <td>${renderConfidentiality(reference?.confidentialityCode ?? [])}</td>
                <td>${renderAuthorInstitution(reference?.author)}</td>
                <td>${reference?.size == null ? "—" : formatSize(Number(reference.size))}</td>
                <td><small><code title="Document Entry Id">${escapeHtml(documentReferenceId || "—")}</code><br><code title="Document UniqueId">${escapeHtml(documentId || "—")}</code></small></td>
                <td>${created ? new Date(created).toLocaleDateString("no-NO", { year: "numeric", month: "short", day: "numeric" }) : "—"}</td>
                <td>${escapeHtml(reference?.mimeType ?? reference?.contentType ?? "Unknown")}</td>
                <td class="action-column">${editButton} ${duplicateDocumentReference} ${deleteButton}</td>
            </tr>`;
    }).join("");

    return `
        <table class="doc-table">
            <thead>
                <tr>
                    <th>Title</th>
                    <th>Confidentiality</th>
                    <th>Institutions</th>
                    <th>Size</th>
                    <th>Document Identifiers</th>
                    <th>Created</th>
                    <th>MIME Type</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderAuthorInstitution(authors) {
    if (!authors) return "—";

    const authorList = [...authors].map(author => {
        const organization = author?.organization;
        const department = author?.department;

        const orgName = organization?.organizationName ?? "";
        const deptName = department?.organizationName ?? "";

        const organizationTitle = organization.id && organization.assigningAuthority ? `Code: ${organization.id}\nSystem: ${organization.assigningAuthority}` : "";
        const departmentTitle = department.id && organization.assigningAuthority ? `Code: ${department.id}\nSystem: ${organization.assigningAuthority}` : "";

        const organizationString = orgName ? `<code title="${organizationTitle}">${escapeHtml(orgName)}</code>` : "";
        const departmentString = deptName ? `<code title="${departmentTitle}">${escapeHtml(deptName)}</code>` : "";

        return `
        <tr>
            <td>${organizationString}</td>
            <td>${departmentString}</td>
        </tr>`;
    }).join("");

    return `
        <table class="doc-table compact-table">
            <tbody>${authorList}</tbody>
        </table>`;
}

function renderConfidentiality(codes) {
    if (!Array.isArray(codes) || codes.length === 0) return "—";
    return codes
        .map((code) => `<code title="${escapeHtml(code?.codeSystem ?? "—")}">${escapeHtml(code?.code ?? "—")}</code>`)
        .join(" ");
}

function wireDocumentTableInteractions(content, source, patientId, expandRow) {
    const tableBody = content.querySelector("tbody");
    if (!tableBody) return;

    tableBody.addEventListener("click", async (event) => {
        const actionButton = event.target.closest("button");
        const anyActionButtonClicked = !!actionButton;

        if (anyActionButtonClicked) {
            event.stopPropagation();

            if (actionButton.classList.contains("btn-delete-document")) {
                await handleDeleteDocument(actionButton, source, patientId, expandRow);
            } else if (actionButton.classList.contains("btn-edit-document-reference")) {
                await handleEditDocumentReference(actionButton, source, patientId, expandRow);
            } else if (actionButton.classList.contains("btn-duplicate-document-reference")) {
                await handleDuplicateDocumentReference(actionButton, source, patientId, expandRow);
            }
        }
        else {
            const row = event.target.closest("tr.doc-row-link");
            if (!row) return;

            const link = row.dataset.link ? decodeURIComponent(row.dataset.link) : "";
            if (!link) return;

            viewer.openDocumentViewer({
                source,
                link,
                title: row.dataset.title ? decodeURIComponent(row.dataset.title) : "Document",
                mimeType: row.dataset.mime ? decodeURIComponent(row.dataset.mime) : "Unknown"
            });
        }
    });
}

async function handleDeleteDocument(button, source, patientId, expandRow) {
    const documentId = button.dataset.docId ? decodeURIComponent(button.dataset.docId) : "";
    if (!documentId) {
        throw new Error("Missing document id.");
    }

    const confirmed = confirm(`Delete document ${documentId}?`);
    if (!confirmed) return;

    setButtonLoading(button);
    try {
        await deleteDocumentById(source, documentId);
        await loadDocumentList(source, patientId, expandRow);
    } catch (err) {
        alert(`Failed to delete document.\n\n${err.message}`);
        restoreButton(button, "🛑");
    }
}

async function handleEditDocumentReference(button, source, patientIdOrUniqueId, expandRow) {
    const documentEntryId = button.dataset.entryId ? decodeURIComponent(button.dataset.entryId) : patientIdOrUniqueId;
    if (!documentEntryId) {
        throw new Error("Missing document entry id.");
    }

    setButtonLoading(button);
    let payload;
    try {
        payload = await getDocumentEntryById(source, documentEntryId);
    } catch (err) {
        alert(`Failed to load document entry.\n\n${err.message}`);
        restoreButton(button, "✏️");
        return;
    }
    restoreButton(button, "✏️");

    removeLargeDocumentContent(payload);

    openDocumentJsonEditor({
        title: `Edit document entry: ${documentEntryId}`,
        initialPayload: payload,
        onSave: async (editedPayload) => {
            await patchDocumentEntryById(source, documentEntryId, editedPayload);
            if (expandRow) {
                await loadDocumentList(source, patientIdOrUniqueId, expandRow);
            }
            else {
                await fetchPatientIdentifiers(source);
            }
        }
    });
}

async function handleDuplicateDocumentReference(button, source, patientId, expandRow) {
    const documentId = button.dataset.entryId ? decodeURIComponent(button.dataset.entryId) : "";

    const recycledTable = clonePatientTableFromDOMAsPatientDuplicationForm();
    document.body.appendChild(recycledTable);

    document.body.addEventListener("click", (event) => onDocumentEntryDuplicatePatientClicked(event, recycledTable));

    const documentEntryToDuplicate = await getDocumentEntryById(source, documentId);
    console.log("Document entry to duplicate:", documentEntryToDuplicate);

}

async function onDocumentEntryDuplicatePatientClicked(event, recycledTable) {
    const selectedRow = event.target.closest("#patient-duplication-table tbody tr[data-patient-id]");
    if (!selectedRow) {
        cleanupHandleDuplicateDocumentReference(recycledTable);
        return;
    }
    console.log("Selected patient row for duplication:", selectedRow);

}

function cleanupHandleDuplicateDocumentReference(recycledTable) {
    console.log("Removing recycled patient duplication table from DOM.");
    document.body.removeEventListener("click", onDocumentEntryDuplicatePatientClicked);
    document.body.removeChild(recycledTable);
}

function clonePatientTableFromDOMAsPatientDuplicationForm() {
    const existingTable = document.querySelector("#patient-identifiers table");
    if (!existingTable) return null;

    const newTable = existingTable.cloneNode(true);
    newTable.id = "patient-duplication-table";

    // Remove the last header row and any existing expand rows or action columns or styling
    newTable.querySelectorAll("tbody tr").forEach(row => row.classList.remove("btn-docs--active"));
    newTable.querySelectorAll(".doc-expand-row").forEach(node => node.remove());
    newTable.querySelectorAll("td.pid-actions").forEach(node => node.remove());

    return newTable;
}

function removeLargeDocumentContent(payload) {
    if (payload?.documentReference && typeof payload.documentReference === "object") {
        delete payload.documentReference.document;
    }
    if (payload?.document && typeof payload.document === "object") {
        delete payload.document;
    }
}

function setButtonLoading(button) {
    if (!button.dataset.originalContent) {
        button.dataset.originalContent = button.innerHTML;
    }
    button.disabled = true;
    button.innerHTML = LOADING_ICON_HTML;
}

function restoreButton(button, fallback) {
    button.disabled = false;
    button.innerHTML = button.dataset.originalContent || fallback;
    delete button.dataset.originalContent;
}
