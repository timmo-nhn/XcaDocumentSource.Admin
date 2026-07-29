import { proxyFetch } from "./api.js";
import { renderCard, capitalize, formatUptime, boolStatus, boolLabel } from "./utils.js";

export async function fetchHealthCheck(source) {
    const container = document.getElementById("health-check");
    container.innerHTML = renderCard("Health Check", "loading", null);

    try {
        const res = await proxyFetch(`${source}/api/health-check`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const status = data.healthReport?.status ?? "unknown";
        const isHealthy = status.toLowerCase() === "healthy";
        const registryOk = data.registryRepository?.registryOk;
        const repositoryOk = data.registryRepository?.repositoryOk;
        const uptime = data.uptimeInSeconds != null ? formatUptime(data.uptimeInSeconds) : null;

        container.innerHTML = `
            ${renderCard("Overall Status", isHealthy ? "ok" : "error", capitalize(status))}
            ${renderCard("Registry",       boolStatus(registryOk),   boolLabel(registryOk))}
            ${renderCard("Repository",     boolStatus(repositoryOk), boolLabel(repositoryOk))}
            ${uptime ? renderCard("Uptime", "neutral", uptime) : ""}
        `;
    } catch (err) {
        container.innerHTML = renderCard("Health Check", "error", err.message);
    }
}

export async function fetchAboutConfig(source) {
    const container = document.getElementById("about-config");
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

export async function fetchRegistryObjects(source) {
    const container = document.getElementById("registry-objects");
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
