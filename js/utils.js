export function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    
    console.log(mimeHint);
    console.log(bytes.slice(0, 16));

    if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: "pdf", mimeType: "application/pdf" }; // %PDF
    if (hasPrefix(bytes, [0x89, 0x50, 0x4E, 0x47])) return { kind: "image", mimeType: "image/png" };
    if (hasPrefix(bytes, [0xFF, 0xD8, 0xFF])) return { kind: "image", mimeType: "image/jpeg" };
    if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mimeType: "image/gif" };
    if (hasPrefix(bytes, [0x42, 0x4D])) return { kind: "image", mimeType: "image/bmp" };
    if (hasPrefix(bytes, [0x49, 0x49, 0x2A, 0x00]) || hasPrefix(bytes, [0x4D, 0x4D, 0x00, 0x2A])) {
        return { kind: "image", mimeType: "image/tiff" };
    }
    if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasAsciiAt(bytes, "WEBP", 8)) {
        return { kind: "image", mimeType: "image/webp" };
    }
    if (hint.includes("pdf")) return { kind: "pdf", mimeType: "application/pdf" };
    if (hint.startsWith("image/")) return { kind: "image", mimeType: hint.split(";")[0].trim() };
    if (hint.includes("xml")) return { kind: "xml", mimeType: "application/xml" };
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
        return JSON.parse(JSON.stringify(await res.json()));
    } catch (err) {
        throw new Error(`Failed to parse document entry response as JSON.\n\n${err.message}`);
    }
}