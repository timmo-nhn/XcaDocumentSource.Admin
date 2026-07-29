import { proxyFetch } from "./api.js";
import { getResponseAsJson } from "./utils.js";

export async function listPatients(source) {
    const response = await proxyFetch(`${source}/api/debug-patient-identifiers`);
    await ensureOk(response, "Failed to load patients.");

    const data = await response.json();
    return Array.isArray(data) ? data : Object.values(data ?? {});
}

export async function listDocumentEntries(source, patientId) {
    const params = new URLSearchParams({ id: patientId, pageNumber: 1, pageSize: 50 });
    const response = await proxyFetch(`${source}/api/rest/document-list?${params}`);
    await ensureOk(response, "Failed to load document list.");

    const data = await response.json();
    return data?.documentListEntries ?? [];
}

export async function deleteAllDataForPatient(source, patientIdentifier, patientSystem) {
    const params = new URLSearchParams({ patientIdentifier, patientSystem });
    const response = await proxyFetch(`${source}/api/rest/all-data-for-patient?${params}`, { method: "DELETE" });
    await ensureOk(response, "Failed to delete all data for patient.");
}

export async function deleteDocumentById(source, documentId) {
    const params = new URLSearchParams({ id: documentId });
    const response = await proxyFetch(`${source}/api/rest/document-entry-document?${params}`, { method: "DELETE" });
    await ensureOk(response, "Failed to delete document.");
}

export async function getDocumentEntryById(source, documentEntryId) {
    const params = new URLSearchParams({ id: documentEntryId });
    const response = await proxyFetch(`${source}/api/rest/document-entry?${params}`);
    await ensureOk(response, "Failed to load document entry.");
    return getResponseAsJson(response);
}

export async function patchDocumentEntryById(source, documentEntryId, payload) {
    const params = new URLSearchParams({ id: documentEntryId });
    const response = await proxyFetch(`${source}/api/rest/document-entry?${params}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        contentType: "application/json"
    });
    await ensureOk(response, "Failed to update document reference.");
}

async function ensureOk(response, contextMessage) {
    if (response.ok) return;
    const responseText = await response.text();
    throw new Error(`${contextMessage}\n\nHTTP ${response.status}${responseText ? `\n\n${responseText}` : ""}`);
}
