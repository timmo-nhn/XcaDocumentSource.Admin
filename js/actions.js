import { proxyFetch } from "./api.js";
import { escapeHtml, fileToBase64, detectFileType } from "./utils.js";

export function setupActionSection(source) {
    const actionEl = document.getElementById("action");
    actionEl.hidden = false;

    setupUploadTestData(source);
    setupUploadDocument(source);
}

function setupUploadTestData(source) {
    const fileInput = document.getElementById("testDataFile");
    const fileLabelEl = document.getElementById("fileLabel");
    const uploadButton = document.getElementById("uploadButton");
    const responseEl = document.getElementById("uploadResponse");

    fileInput.addEventListener("change", function () {
        fileLabelEl.textContent = fileInput.files[0]?.name ?? "Choose .json file";
    });

    // Clone to avoid stacking listeners if Connect is clicked multiple times
    const newUploadButton = uploadButton.cloneNode(true);
    uploadButton.replaceWith(newUploadButton);

    newUploadButton.addEventListener("click", () => uploadTestData(source, fileInput, responseEl));
}

async function uploadTestData(source, fileInput, responseEl) {
    const file = fileInput.files[0];
    if (!file) { alert("Please select a .json file first."); return; }

    const entries = document.getElementById("entriesToGenerate").value.trim();
    const patient = document.getElementById("patientIdentifier").value.trim();

    const params = new URLSearchParams();
    if (entries) params.set("entriesToGenerate", entries);
    if (patient) params.set("patientIdentifier", patient);

    const targetUrl = `${source}/api/generate-test-data?${params}`;

    responseEl.hidden = false;
    responseEl.className = "upload-response upload-response--loading";
    responseEl.textContent = "Uploading…";

    try {
        const body = await file.text();
        const res = await proxyFetch(targetUrl, { method: "POST", body, contentType: "application/json" });
        const text = await res.text();

        let pretty = text;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { }

        responseEl.className = res.ok
            ? "upload-response upload-response--ok"
            : "upload-response upload-response--error";
        responseEl.textContent = `HTTP ${res.status}\n\n${pretty}`;
    } catch (err) {
        responseEl.className = "upload-response upload-response--error";
        responseEl.textContent = escapeHtml(err.message);
    }

    // Refresh the status section to show the new data
    document.getElementById("submitButton").click();
}

async function setupUploadDocument(source) {
    const fileInput = document.getElementById("uploadDocumentFile");
    const fileLabelEl = document.getElementById("uploadDocumentLabel");
    const uploadButton = document.getElementById("uploadDocumentButton");
    const responseEl = document.getElementById("uploadDocumentResponse");

    const uploadForm = document.getElementById("uploadDocument");

    fileInput.addEventListener("change", function () {
        fileLabelEl.textContent = fileInput.files[0]?.name ?? "Choose file";
    });

    // Clone to avoid stacking listeners if Connect is clicked multiple times
    const newUploadButton = uploadButton.cloneNode(true);
    uploadButton.replaceWith(newUploadButton);

    newUploadButton.addEventListener("click", () => uploadDocument(source, fileInput, responseEl));
}

export function setUploadDocumentField(event, patientId, patientIdSystem) {
    const documentUpload = document.getElementById("uploadDocument");
    const patientIdentifierField = document.getElementById("uploadDocumentPatientIdentifier");
    const label = documentUpload.querySelector("label");

    if (!documentUpload || !patientIdentifierField) {
        throw new Error("Upload document form not found.");
    }

    patientIdentifierField.value = `${patientId}^^^&${patientIdSystem}&ISO`;
    documentUpload.scrollIntoView({ behavior: "smooth", block: "start" });
    patientIdentifierField.focus({ preventScroll: true });
    patientIdentifierField.select();

    if (event.shiftKey) {
        label.click();
    }
}

async function uploadDocument(source, fileInput, responseEl) {
    const file = fileInput.files[0];
    if (!file) { alert("Please select a file first."); return; }
    
    const patient = document.getElementById("uploadDocumentPatientIdentifier").value.trim();
    
    if (!patient) { alert("Please select a patient first."); return; }

    responseEl.textContent = "Generating random test data…";

    const documentReference = (await generateRandomTestData(source, patient, 1))[0];
    
    const base64File = await fileToBase64(file);
    documentReference.document.data = base64File;
    documentReference.documentEntry.mimeType = detectFileType(base64File).mimeType;
    documentReference.documentEntry.size = `${file.size}`;
    console.log(file.size);
    
    console.log(documentReference);

    responseEl.hidden = false;
    responseEl.className = "upload-response upload-response--loading";
    responseEl.textContent = "Uploading document…";

    try {
        const targetUrl = `${source}/api/rest/document-entry`;
        const body = JSON.stringify(documentReference);
        const res = await proxyFetch(targetUrl, { method: "POST", body, contentType: "application/json" });
        const text = await res.text();

        let pretty = text;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { }

        responseEl.className = res.ok
            ? "upload-response upload-response--ok"
            : "upload-response upload-response--error";
        responseEl.textContent = `HTTP ${res.status}\n\n${pretty}`;
    } catch (err) {
        responseEl.className = "upload-response upload-response--error";
        responseEl.textContent = escapeHtml(err.message);
    }

    // Refresh the status section to show the new data
    document.getElementById("submitButton").click();
}

async function generateRandomTestData(source, patientIdentifier, amount = 1) {
    const params = new URLSearchParams();
    params.set("entriesToGenerate", amount);
    params.set("patientIdentifier", patientIdentifier);

    const targetUrl = `${source}/api/generate-random-test-data?${params}`;

    const res = await proxyFetch(targetUrl);
    const text = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}\n\n${text}`);
    return text;
}