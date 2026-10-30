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
            ${renderCard("Registry", boolStatus(registryOk), boolLabel(registryOk))}
            ${renderCard("Repository", boolStatus(repositoryOk), boolLabel(repositoryOk))}
            ${renderCard("AtnaLog", boolStatus(atnaLogOk), boolLabel(atnaLogOk))}
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



export const DATACENTERS = ["bg", "osl", "trd"];

export function datacenterSource(source, dc) {
    const url = new URL(source);
    const existing = DATACENTERS.find((name) => url.hostname.startsWith(`static-${name}-`));
    const hostname = existing ? url.hostname.slice(`static-${existing}-`.length) : url.hostname;
    url.hostname = `static-${dc}-${hostname}`;
    return url.href.replace(/\/+$/, "");
}

export async function fetchDatacenterCounts(source, root) {
    const container = root.querySelector('[data-role="dc-summary"]');
    const token = String(Number(container.dataset.token ?? 0) + 1);
    container.dataset.token = token;
    container.dataset.state = "loading";

    const results = await Promise.all(DATACENTERS.map(async (dc) => {
        const item = container.querySelector(`[data-dc="${dc}"]`);
        item.textContent = `${dc.toUpperCase()}: …`;
        item.dataset.state = "loading";
        item.title = "";
        try {
            const res = await proxyFetch(`${datacenterSource(source, dc)}/api/about/registryobjects`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.documentEntries == null) throw new Error("Missing documentEntries");
            return { dc, item, data };
        } catch (err) {
            return { dc, item, error: err.message };
        }
    }));

    if (container.dataset.token !== token) return;
    for (const { dc, item, data, error } of results) {
        const label = dc.toUpperCase();
        if (error) {
            item.textContent = `${label}: —`;
            item.dataset.state = "error";
            item.title = `${label} unavailable: ${error}`;
        } else {
            item.textContent = `${label}: ${data.documentEntries}`;
            item.dataset.state = "ok";
            item.title = `${label} — Document entries: ${data.documentEntries}, Submission sets: ${data.submissionSets ?? "—"}, Associations: ${data.associations ?? "—"}`;
        }
    }
    const counts = results.filter((r) => !r.error).map((r) => r.data.documentEntries);
    container.dataset.state = getState(counts, results);
}

function getState(counts, results) {
    if (counts.length === 0) return "error";

    const uniqueCounts = new Set(counts);
    const diff = Math.max(...uniqueCounts) - Math.min(...uniqueCounts);
    
    // A difference of 1 is acceptable due to the constant writes and deletes by the healthcheck.
    // A difference of more than 1 indicates an error state
    if (diff > 1) return "error"; 
    if (diff === 1) return "warning"; 
    return "ok";
}

export function resetDatacenterCounts(root) {
    const container = root.querySelector('[data-role="dc-summary"]');
    container.dataset.token = String(Number(container.dataset.token ?? 0) + 1);
    container.dataset.state = "loading";
    for (const item of container.querySelectorAll("[data-dc]")) {
        item.textContent = `${item.dataset.dc.toUpperCase()}: —`;
        item.dataset.state = "loading";
        item.title = "";
    }
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
            ${renderCard("Home Community ID", "neutral", data.homeCommunityId ?? "—")}
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
            ${renderCard("Submission Sets", "neutral", data.submissionSets ?? "—")}
            ${renderCard("Associations", "neutral", data.associations ?? "—")}
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
        const data = [... await res.json()];

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
