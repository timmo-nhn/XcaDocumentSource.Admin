import { proxyFetch } from "./api.js";
import { renderCard, capitalize, formatUptime, boolStatus, boolLabel } from "./utils.js";

export async function fetchHealthCheck(source, root) {
    const container = root.querySelector('[data-role="health-check"]');
    container.innerHTML = renderCard("Health Check", "loading", null);
    updateHealthSummary(root, "loading");

    try {
        const res = await proxyFetch(`${source}/api/health-check`);
        const data = await res.json();
        if (!res.ok && !data.healthReport?.status) throw new Error(`HTTP ${res.status}`);

        const status = data.healthReport?.status ?? "unknown";
        const isHealthy = status.toLowerCase() === "healthy";
        const registryOk = data.healthReport?.entries?.registry?.status === "healthy";
        const repositoryOk = data.healthReport?.entries?.repository?.status === "healthy";
        const atnaLogOk = data.healthReport?.entries?.atnalogexport?.status === "healthy";
        const uptime = data.uptimeInSeconds != null ? formatUptime(data.uptimeInSeconds) : null;
        updateHealthSummary(root, status, uptime);

        container.innerHTML = `
            ${renderCard("Overall Status", isHealthy ? "ok" : "error", capitalize(status))}
            ${renderCard("Registry",       boolStatus(registryOk),   boolLabel(registryOk))}
            ${renderCard("Repository",     boolStatus(repositoryOk), boolLabel(repositoryOk))}
            ${renderCard("AtnaLog",     boolStatus(atnaLogOk), boolLabel(atnaLogOk))}
            ${uptime ? renderCard("Uptime", "neutral", uptime) : ""}
        `;
    } catch (err) {
        updateHealthSummary(root, "unavailable");
        container.innerHTML = renderCard("Health Check", "error", err.message);
    }
}

export function updateHealthSummary(root, status, uptime = null) {
    const health = root.querySelector('[data-role="health-summary"]');
    const normalized = status.toLowerCase();
    health.dataset.state = normalized === "healthy" ? "ok"
        : normalized === "degraded" ? "warning"
        : normalized === "loading" || normalized === "unknown" ? "loading"
        : "error";
    health.textContent = `Health: ${capitalize(status)}`;
    root.querySelector('[data-role="uptime-summary"]').textContent = `Uptime: ${uptime ?? "unavailable"}`;
}



export async function fetchAboutConfig(source, root) {
    const container = root.querySelector('[data-role="about-config"]');
    container.innerHTML = renderCard("Config", "loading", null);

    try {
        const res = await proxyFetch(`${source}/api/about/config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const friendlyName = data.friendlyName || data.hostName || null;

        container.innerHTML = `
            ${friendlyName ? renderCard("Hostname", "neutral", friendlyName) : ""}
            ${renderCard("Home Community ID",    "neutral", data.homeCommunityId   ?? "—")}
            ${renderCard("Repository Unique ID", "neutral", data.repositoryUniqueId ?? "—")}
        `;
    } catch (err) {
        container.innerHTML = renderCard("Config", "error", err.message);
    }
}

export async function fetchRegistryObjectsCount(source, root) {
    const container = root.querySelector('[data-role="registry-objects"]');
    container.innerHTML = renderCard("Registry Objects", "loading", null);

    try {
        const res = await proxyFetch(`${source}/api/about/registryobjects`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        container.innerHTML = `
            ${renderCard("Document Entries", "neutral", data.documentEntries ?? "—")}
            ${renderCard("Submission Sets",  "neutral", data.submissionSets  ?? "—")}
            ${renderCard("Associations",     "neutral", data.associations    ?? "—")}
        `;
    } catch (err) {
        container.innerHTML = renderCard("Registry Objects", "error", err.message);
    }
}

export async function fetchBackendImplementations(source, root) {
    const container = root.querySelector('[data-role="backend-implementations"]');
    container.innerHTML = renderCard("Backend Implementations", "loading", null);

    try {
        const res = await proxyFetch(`${source}/api/implementations`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data =  [... await res.json()];

        container.innerHTML = `
            ${renderCard("Registry", "neutral", data.filter(itm => itm.serviceType === "IRegistry")[0]?.implementationType ?? "—")}
            ${renderCard("Repository", "neutral", data.filter(itm => itm.serviceType === "IRepository")[0]?.implementationType ?? "—")}
            ${renderCard("PolicyRepository", "neutral", data.filter(itm => itm.serviceType === "IPolicyRepository")[0]?.implementationType ?? "—")}
            ${renderCard("AtnaLog DLQ", "neutral", data.filter(itm => itm.serviceType === "IAtnaLogDLQStore")[0]?.implementationType ?? "—")}
        `;
    } catch (err) {
        container.innerHTML = renderCard("Backend Implementations", "error", err.message);
    }
}
