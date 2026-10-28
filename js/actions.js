import { proxyFetch } from "./api.js";
import { uploadDocumentEntry } from "./documentsApi.js";
import {
    escapeHtml,
    fileToBase64,
    detectFileType,
    isUploadableDocumentEntry,
    setNewIdentifiersForDocumentEntry
} from "./utils.js";

export function setupActionSection(source, root) {
    const actionEl = root.querySelector('[data-role="action"]');
    actionEl.hidden = false;

    setupUploadTestData(source, root);
    setupUploadDocument(source, root);
}

function setupUploadTestData(source, root) {
    const fileInput = root.querySelector('[data-role="testDataFile"]');
    const fileLabelEl = root.querySelector('[data-role="fileLabel"]');
    const uploadButton = root.querySelector('[data-role="uploadButton"]');
    const responseEl = root.querySelector('[data-role="uploadResponse"]');

    fileInput.addEventListener("change", function () {
        fileLabelEl.textContent = fileInput.files[0]?.name ?? "Choose .json file";
    });

    uploadButton.addEventListener("click", () => uploadTestData(source, fileInput, responseEl, root));
}

async function uploadTestData(source, fileInput, responseEl, root) {
    const file = fileInput.files[0];
    if (!file) { alert("Please select a .json file first."); return; }

    const entries = root.querySelector('[data-role="entriesToGenerate"]').value.trim();
    const patient = root.querySelector('[data-role="patientIdentifier"]').value.trim();

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
    root.dispatchEvent(new Event("refresh-instance"));
}

function setupUploadDocument(source, root) {
    const fileInput = root.querySelector('[data-role="uploadDocumentFile"]');
    const fileLabelEl = root.querySelector('[data-role="uploadDocumentLabel"]');
    const uploadButton = root.querySelector('[data-role="uploadDocumentButton"]');
    const responseEl = root.querySelector('[data-role="uploadDocumentResponse"]');

    fileInput.onchange = function () {
        const files = [...fileInput.files];
        fileLabelEl.textContent = files.length === 0
            ? "Choose documents"
            : files.length === 1
                ? files[0].name
                : `${files.length} files selected`;
    };

    uploadButton.addEventListener("click", () => uploadDocument(source, fileInput, responseEl, uploadButton, root));
}

export function setUploadDocumentField(event, patientId, patientIdSystem, root) {
    const documentUpload = root.querySelector('[data-role="uploadDocument"]');
    const patientIdentifierField = root.querySelector('[data-role="uploadDocumentPatientIdentifier"]');

    if (!documentUpload || !patientIdentifierField) {
        throw new Error("Upload document form not found.");
    }

    patientIdentifierField.value = `${patientId}^^^&${patientIdSystem}&ISO`;
    documentUpload.scrollIntoView({ behavior: "smooth", block: "start" });
    patientIdentifierField.focus({ preventScroll: true });
    patientIdentifierField.select();

    if (event.shiftKey) {
        documentUpload.querySelector("label").click();
    }
}

async function uploadDocument(source, fileInput, responseEl, uploadButton, root) {
    const files = [...fileInput.files];
    if (files.length === 0) { alert("Please select one or more files first."); return; }

    const patient = root.querySelector('[data-role="uploadDocumentPatientIdentifier"]').value.trim();

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

                payload.document = { documentId: payload.documentEntry?.uniqueId ?? "", data: await fileToBase64(file) };
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
        root.querySelector('[data-role="uploadDocumentLabel"]').textContent = "Choose documents";
        root.dispatchEvent(new Event("refresh-instance"));
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