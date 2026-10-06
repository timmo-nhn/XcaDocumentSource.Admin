import { proxyFetch } from "./api.js";
import { uploadDocumentEntry } from "./documentsApi.js";
import {
    escapeHtml,
    fileToBase64,
    detectFileType,
    isUploadableDocumentEntry,
    setNewIdentifiersForDocumentEntry
} from "./utils.js";

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

    fileInput.onchange = function () {
        const files = [...fileInput.files];
        fileLabelEl.textContent = files.length === 0
            ? "Choose documents"
            : files.length === 1
                ? files[0].name
                : `${files.length} files selected`;
    };

    // Clone to avoid stacking listeners if Connect is clicked multiple times
    const newUploadButton = uploadButton.cloneNode(true);
    uploadButton.replaceWith(newUploadButton);

    newUploadButton.addEventListener("click", () => uploadDocument(source, fileInput, responseEl, newUploadButton));
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

async function uploadDocument(source, fileInput, responseEl, uploadButton) {
    const files = [...fileInput.files];
    if (files.length === 0) { alert("Please select one or more files first."); return; }

    const patient = document.getElementById("uploadDocumentPatientIdentifier").value.trim();

    responseEl.hidden = false;
    responseEl.className = "upload-response upload-response--loading";
    responseEl.textContent = "Preparing documents…";
    uploadButton.disabled = true;

    try {
        const { readyEntries, regularFiles } = await classifyUploadFiles(files);
        if (regularFiles.length > 0 && !patient) {
            throw new Error("Please select a patient before uploading regular document files.");
        }

        if (regularFiles.length > 0) {
            responseEl.textContent = "Generating metadata…";
            const generatedEntries = await generateRandomTestData(source, patient, regularFiles.length);
            if (!Array.isArray(generatedEntries) || generatedEntries.length !== regularFiles.length) {
                throw new Error(`Expected ${regularFiles.length} generated document entries, but received ${generatedEntries?.length ?? 0}.`);
            }

            for (let index = 0; index < regularFiles.length; index += 1) {
                const file = regularFiles[index];
                const payload = generatedEntries[index];
                const bytes = new Uint8Array(await file.arrayBuffer());
                payload.document.data = await fileToBase64(file);
                payload.documentEntry.mimeType = detectFileType(bytes, file.type).mimeType;
                payload.documentEntry.size = `${file.size}`;
                readyEntries.push({ name: file.name, payload });
            }
        }

        const results = [];
        for (let index = 0; index < readyEntries.length; index += 1) {
            const entry = readyEntries[index];
            responseEl.textContent = `Uploading ${index + 1} of ${readyEntries.length}: ${entry.name}`;
            try {
                if (entry.refreshIdentifiers) {
                    setNewIdentifiersForDocumentEntry(entry.payload);
                }
                await uploadDocumentEntry(source, entry.payload);
                results.push(`✓ ${entry.name}`);
            } catch (err) {
                throw new Error(`${entry.name}: ${err.message}`);
            }
        }

        responseEl.className = "upload-response upload-response--ok";
        responseEl.textContent = `Uploaded ${results.length} document${results.length === 1 ? "" : "s"}.\n\n${results.join("\n")}`;
        fileInput.value = "";
        document.getElementById("uploadDocumentLabel").textContent = "Choose documents";
        document.getElementById("submitButton").click();
    } catch (err) {
        responseEl.className = "upload-response upload-response--error";
        responseEl.textContent = err.message;
    } finally {
        uploadButton.disabled = false;
    }
}

async function classifyUploadFiles(files) {
    const readyEntries = [];
    const regularFiles = [];

    for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".json")) {
            regularFiles.push(file);
            continue;
        }

        let parsed;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            regularFiles.push(file);
            continue;
        }

        const entries = Array.isArray(parsed) ? parsed : [parsed];
        if (!entries.every(isUploadableDocumentEntry)) {
            regularFiles.push(file);
            continue;
        }

        entries.forEach((payload, index) => {
            readyEntries.push({
                name: entries.length === 1 ? file.name : `${file.name} [${index + 1}]`,
                payload,
                refreshIdentifiers: true
            });
        });
    }

    return { readyEntries, regularFiles };
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