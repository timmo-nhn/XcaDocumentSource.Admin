import { getDocumentEntryById, uploadDocumentEntry } from "./documentsApi.js";
import { fetchPatientIdentifiers } from "./documents.js";
import { setNewIdentifiersForDocumentEntry } from "./utils.js";

export async function onDocumentEntryDuplicatePatientClicked(event, source, documentId, backdrop) {
    if (document.body.contains(backdrop)) {
        document.body.removeChild(backdrop);
    }

    const selectedRow = event.target.closest("#patient-duplication-table tbody tr[data-patient-id]");
    if (!selectedRow) {
        cleanupHandleDuplicateDocumentReference(backdrop);
    }
    else {
        const documentEntryToDuplicate = await getDocumentEntryById(source, documentId, true);

        setNewIdentifiersForDocumentEntry(documentEntryToDuplicate);

        const targetPatientId = selectedRow.dataset.patientId;
        const targetPatientSystem = selectedRow.dataset.patientIdSystem;
        const targetPatientName = selectedRow.dataset.patientFirstName;
        const targetPatientLastName = selectedRow.dataset.patientLastName;
        const targetPatientBirthTime = selectedRow.dataset.patientBirthtime;
        const targetPatientGender = selectedRow.dataset.patientGender;

        documentEntryToDuplicate.documentEntry.sourcePatientInfo.birthTime = targetPatientBirthTime;
        documentEntryToDuplicate.documentEntry.sourcePatientInfo.firstName = targetPatientName;
        documentEntryToDuplicate.documentEntry.sourcePatientInfo.lastName = targetPatientLastName;
        documentEntryToDuplicate.documentEntry.sourcePatientInfo.gender = targetPatientGender;
        documentEntryToDuplicate.documentEntry.sourcePatientInfo.patientId.id = targetPatientId;
        documentEntryToDuplicate.documentEntry.sourcePatientInfo.patientId.system = targetPatientSystem;

        const response = await uploadDocumentEntry(source, documentEntryToDuplicate);

        cleanupHandleDuplicateDocumentReference(backdrop);
        await fetchPatientIdentifiers(source);
    }
}

function cleanupHandleDuplicateDocumentReference(backdrop) {
    if (backdrop._duplicateClickHandler) {
        backdrop.removeEventListener("click", backdrop._duplicateClickHandler);
    }
    if (document.body.contains(backdrop)) {
        document.body.removeChild(backdrop);
    }
    document.body.style.overflow = "";
}

export function clonePatientTableFromDOMAsPatientDuplicationForm() {
    const existingTable = document.querySelector("#patient-identifiers table");
    if (!existingTable) return null;

    const newTable = existingTable.cloneNode(true);
    newTable.id = "patient-duplication-table";
    newTable.style.background = "var(--color-bg-surface)";

    // Remove the last header row and any existing expand rows or action columns or styling
    newTable.querySelectorAll("tbody tr").forEach(row => row.classList.remove("btn-docs--active"));
    newTable.querySelectorAll(".doc-expand-row").forEach(node => node.remove());
    newTable.querySelectorAll("td.pid-actions").forEach(node => node.remove());

    return newTable;
}
