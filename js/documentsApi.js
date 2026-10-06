import { proxyFetch } from "./api.js";
import { getResponseAsJson } from "./utils.js";

export async function listPatients(source) {
    const response = await proxyFetch(`${source}/api/debug-patient-identifiers`);
    await ensureOk(response, "Failed to load patients.");

    const data = await response.json();
    return Array.isArray(data) ? data : Object.values(data ?? {});
}

export async function listDocumentEntries(source, patientId) {
    const pageSize = 50;
    const entries = [];

    for (let pageNumber = 1; ; pageNumber += 1) {
        const params = new URLSearchParams({ id: patientId, pageNumber, pageSize });
        const response = await proxyFetch(`${source}/api/rest/document-list?${params}`);
        await ensureOk(response, "Failed to load document list.");

        const data = await response.json();
        const pageEntries = data?.documentListEntries ?? [];
        entries.push(...pageEntries);

        if (pageEntries.length < pageSize) {
            return entries;
        }
    }
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

export async function getDocumentEntryById(source, documentEntryId, includeDocument = false) {
    const params = new URLSearchParams({ id: documentEntryId, includeDocument: includeDocument ? "true" : "false" });
    const response = await proxyFetch(`${source}/api/rest/document-entry?${params}`);
    await ensureOk(response, "Failed to load document entry.");
    return getResponseAsJson(response);
}

export async function getDocumentEntryAndDocumentById(source, documentEntryId) {
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

export async function uploadDocumentEntry(source, documentEntry) {
    const response = await proxyFetch(`${source}/api/rest/document-entry`, {
        method: "POST",
        body: JSON.stringify(documentEntry),
        contentType: "application/json"
    });
    await ensureOk(response, "Failed to upload document entry.");

    return getResponseAsJson(response);
}

async function ensureOk(response, contextMessage) {
    if (response.ok) return;
    const responseText = await response.text();
    const error = new Error(`${contextMessage}\n\nHTTP ${response.status}${responseText ? `\n\n${responseText}` : ""}`);
    error.status = response.status;
    throw error;
}
