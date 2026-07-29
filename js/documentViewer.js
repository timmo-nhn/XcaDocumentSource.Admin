import { getApiKey } from "./api.js";

export function openDocumentViewer({ source, link, title = "Document", mimeType = "application/pdf" }) {
    const params = new URLSearchParams({
        source,
        link,
        title,
        mimeType,
    });

    const apiKey = getApiKey();
    if (apiKey) params.set("apiKey", apiKey);

    const viewerUrl = `/document-viewer.html?${params.toString()}`;
    const tab = window.open(viewerUrl, "_blank");
    if (!tab) {
        console.error("Document viewer: popup blocked");
        return null;
    }
    try { tab.opener = null; } catch { }
    return tab;
}