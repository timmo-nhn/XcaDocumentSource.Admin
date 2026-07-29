let globalApiKey = "";

export function setApiKey(key) {
    globalApiKey = key;
}

export function getApiKey() {
    return globalApiKey;
}

export function proxyFetch(url, { method = "GET", body = null, contentType = null } = {}) {
    const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
    const headers = {};
    if (globalApiKey) headers["X-Api-Key"] = globalApiKey;
    if (contentType)  headers["Content-Type"] = contentType;
    return fetch(proxyUrl, { method, headers, body });
}
