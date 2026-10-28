export function normalizeExporterUrl(value) {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("Use an HTTP(S) base URL without credentials, query parameters or a fragment.");
    }
    return url.href.replace(/\/+$/, "");
}

export function createAtnaClient(baseUrl, apiKey = "") {
    const base = normalizeExporterUrl(baseUrl);

    async function request(path, { method = "GET", allowUnhealthy = false } = {}) {
        const headers = {};
        if (apiKey) headers["X-Api-Key"] = apiKey;
        const response = await fetch(`/proxy?url=${encodeURIComponent(base + path)}`, {
            method, headers, cache: "no-store"
        });
        const text = await response.text();
        let data;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            throw new Error(`HTTP ${response.status}: expected JSON from the exporter. ${text.slice(0, 500)}`);
        }
        if (!response.ok && !(allowUnhealthy && response.status === 503 && typeof data?.status === "string")) {
            const message = data?.error || data?.reason || data?.issue?.map(issue => issue.diagnostics).filter(Boolean).join("; ") || text;
            throw new Error(`HTTP ${response.status}: ${message || response.statusText}`);
        }
        return data;
    }

    function bundle(data) {
        if (data?.resourceType !== "Bundle" || (data.entry !== undefined && !Array.isArray(data.entry))) {
            throw new Error("The exporter did not return a FHIR Bundle.");
        }
        return data;
    }

    return {
        baseUrl: base,
        async health() {
            const data = await request("/healthz", { allowUnhealthy: true });
            if (typeof data?.status !== "string" || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) {
                throw new Error("The exporter did not return the expected health report.");
            }
            return data;
        },
        async search({ from = "", to = "", patient = "", source = "" } = {}) {
            const params = new URLSearchParams();
            if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))) {
                throw new Error("Enter valid recorded dates.");
            }
            if (from && to && new Date(from) > new Date(to)) {
                throw new Error("Recorded from must not be after recorded to.");
            }
            if (from) params.append("date", `ge${new Date(from).toISOString()}`);
            if (to) params.append("date", `le${new Date(to).toISOString()}`);
            if (patient.trim()) params.set("patient.identifier", patient.trim());
            if (source.trim()) params.set("source:identifier", source.trim());
            return bundle(await request(`/R4/fhir/AuditEvent${params.size ? `?${params}` : ""}`));
        },
        async read(id) {
            if (!id.trim()) throw new Error("Enter an audit event ID.");
            return bundle(await request(`/R4/fhir/AuditEvent/${encodeURIComponent(id.trim())}`));
        },
        async deadLetters(limit = 100) {
            if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
                throw new Error("Dead-letter limit must be an integer between 1 and 1000.");
            }
            const data = await request(`/admin/dead-letter?limit=${limit}`);
            if (!Array.isArray(data)) throw new Error("The exporter did not return a dead-letter list.");
            return data;
        },
        async deadLetterAction(id, action) {
            if (!/^\d+$/.test(String(id)) || !["retry", "resolve"].includes(action)) {
                throw new Error("Invalid dead-letter action or ID.");
            }
            const data = await request(`/admin/dead-letter/${id}/${action}`, { method: "POST" });
            if (action === "retry" && data?.resolved !== true) {
                throw new Error("The exporter did not confirm that the retry resolved the failure.");
            }
            return data;
        }
    };
}
