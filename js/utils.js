export function escapeHtml(str) {
    if (typeof str !== "string") return "";
    if (!str) return "";

    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
    );
}

export function setNewIdentifiersForDocumentEntry(documentEntry) {
    const newDocumentEntryId = uuidv4();
    const newDocumentId = uuidv4();
    const newSubmissionSetId = uuidv4();
    const newSubmissionSetUniqueId = uuidv4();
    const newAssociationId = uuidv4();

    documentEntry.documentEntry.id = newDocumentEntryId;

    documentEntry.documentEntry.uniqueId = newDocumentId;
    documentEntry.document.documentId = newDocumentId;

    documentEntry.submissionSet.id = newSubmissionSetId;
    documentEntry.submissionSet.uniqueId = newSubmissionSetUniqueId;
    delete documentEntry.submissionSet.Id;

    documentEntry.association.id = newAssociationId;
    documentEntry.association.sourceObject = newSubmissionSetId;
    documentEntry.association.targetObject = newDocumentEntryId;
}

export function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatSize(size) {
    const sizeInMB = (size / 1_048_576);

    switch (true) {
        case sizeInMB >= 1_024: return `${(sizeInMB / 1_024).toFixed(2)} GB`;
        case sizeInMB >= 1: return `${sizeInMB.toFixed(2)} MB`;
        default: return `${(sizeInMB * 1_024).toFixed(2)} KB`;
    }
}

export function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h > 0 ? `${h}h` : null, m > 0 ? `${m}m` : null, `${s}s`].filter(Boolean).join(" ");
}

export function boolStatus(val) {
    if (val === true) return "ok";
    if (val === false) return "error";
    return "neutral";
}

export function boolLabel(val) {
    if (val === true) return "OK";
    if (val === false) return "Failed";
    return "Unknown";
}

export function renderCard(label, state, value) {
    const stateClass = state === "loading" ? "card--loading" : `card--${state}`;
    const valueHtml = state === "loading"
        ? `<span class="card__value card__value--loading">Loading…</span>`
        : `<span class="card__value">${escapeHtml(String(value))}</span>`;
    return `
        <div class="card ${stateClass}">
            <span class="card__label">${escapeHtml(label)}</span>
            ${valueHtml}
        </div>`;
}

export function decodeUtf8(bytes) {
    try {
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
        return "";
    }
}

export function detectFileType(bytes, mimeHint = "") {
    const hint = String(mimeHint).toLowerCase();
    console.log(hint);
    if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf", mimeType: "application/pdf" };
    if (hasPrefix(bytes, [0x89, 0x50, 0x4E, 0x47])) return { kind: "image", mimeType: "image/png" };
    if (hasPrefix(bytes, [0xFF, 0xD8, 0xFF])) return { kind: "image", mimeType: "image/jpeg" };
    if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mimeType: "image/gif" };
    if (hasPrefix(bytes, [0x42, 0x4D])) return { kind: "image", mimeType: "image/bmp" };
    if (hasPrefix(bytes, [0x49, 0x49, 0x2A, 0x00]) || hasPrefix(bytes, [0x4D, 0x4D, 0x00, 0x2A])) return { kind: "image", mimeType: "image/tiff" };
    if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasAsciiAt(bytes, "WEBP", 8)) return { kind: "image", mimeType: "image/webp" };
    if (hint.includes("pdf")) return { kind: "pdf", mimeType: "application/pdf" };
    if (hint.startsWith("image/")) return { kind: "image", mimeType: hint.split(";")[0].trim() };
    if (hint.includes("xml")) return { kind: "xml", mimeType: "application/xml" };
    if (hint.includes("text/plain")) return { kind: "text", mimeType: "text/plain" };
    if (looksLikeXml(bytes)) return { kind: "xml", mimeType: "application/xml" };
    return { kind: "unknown", mimeType: hint || "application/octet-stream" };
}

export function hasPrefix(bytes, prefix) {
    if (bytes.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (bytes[i] !== prefix[i]) return false;
    }
    return true;
}

export function looksLikeXml(bytes) {
    const sample = decodeUtf8(bytes.slice(0, 512));
    const trimmed = sample.replace(/^\uFEFF?[\s\r\n\t]*/u, "");
    return trimmed.startsWith("<");
}

export function hasAsciiAt(bytes, text, offset) {
    if (bytes.length < offset + text.length) return false;
    for (let i = 0; i < text.length; i++) {
        if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
}

export function tryGetAsJson(str) {
    try {
        return JSON.parse(str);
    } catch {
    }
}

export function isUploadableDocumentEntry(obj){
    if (!obj || typeof obj !== "object") return false;

    const hasDocumentEntry = obj.documentEntry && typeof obj.documentEntry === "object";
    const hasDocument = obj.document && typeof obj.document === "object";
    const hasSubmissionSet = obj.submissionSet && typeof obj.submissionSet === "object";
    const hasAssociation = obj.association && typeof obj.association === "object";

    return hasDocumentEntry && hasDocument && hasSubmissionSet && hasAssociation;
}

export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = (error) => reject(error);
    });
}

export async function getResponseAsJson(res) {
    try {
        return await res.json();
    } catch (err) {
        throw new Error(`Failed to parse document entry response as JSON.\n\n${err.message}`);
    }
}

export function decodeBase64(input) {
    let normalized = String(input).trim();
    const marker = "base64,";
    const markerIndex = normalized.indexOf(marker);

    if (markerIndex >= 0) 
        normalized = normalized.slice(markerIndex + marker.length);

    normalized = normalized.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");

    const mod = normalized.length % 4;

    if (mod > 0) 
        normalized += "=".repeat(4 - mod);

    const raw = atob(normalized);
    const out = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) 
        out[i] = raw.charCodeAt(i);

    return out;
}

export function findElementByLocalName(root, name) {
    if (!root) return null;
    const target = name.toLowerCase();
    const all = [root, ...root.getElementsByTagName("*")];
    for (const el of all) {
        const local = (el.localName || el.nodeName || "").toLowerCase();
        if (local === target) return el;
    }
    return null;
}

export function extractNonXmlBodyData(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");

    const parseError = xml.querySelector("parsererror");
    if (parseError) return null;

    const nonXmlBody = findElementByLocalName(xml.documentElement, "NonXMLBody");
    if (!nonXmlBody) return null;

    const textElement = findElementByLocalName(nonXmlBody, "text");
    if (!textElement) return null;

    const mediaType = textElement.getAttribute("mediaType") || textElement.getAttribute("media-type");
    const base64Data = (textElement.textContent || "").trim();
    if (!base64Data) return null;

    try {
        return {
            bytes: decodeBase64(base64Data),
            mediaType,
        };
    } catch {
        return {
            bytes: base64Data,
            mediaType,
        };
    }
}
