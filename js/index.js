import { setApiKey, proxyFetch } from "./api.js";
import { DATACENTERS, datacenterSource, fetchHealthCheck, fetchAboutConfig, fetchRegistryObjectsCount, fetchBackendImplementations, updateHealthSummary, fetchDatacenterCounts, resetDatacenterCounts } from "./status.js";
import { fetchPatientIdentifiers, setupFetchDocumentEntryById } from "./documents.js";
import { setupActionSection } from "./actions.js";
import { sourceOptions } from "./sources.js";

const apiKeyInput = document.getElementById("apiKeyInput");
const apiKeyStatus = document.getElementById("apiKeyStatus");
const connectionStatus = document.getElementById("connectionStatus");
const submitButton = document.getElementById("submitButton");
const sourcesList = document.getElementById("sourceslist");
const instanceTemplate = document.getElementById("instanceTemplate");
const customSourceInput = document.getElementById("customSourceInput");
const customConnectButton = document.getElementById("customConnectButton");
const customConnectionError = document.getElementById("customConnectionError");

apiKeyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        submitButton.click();
    }
});

apiKeyInput.addEventListener("input", () => {
    apiKeyStatus.textContent = "Click Connect to apply the updated key.";
});

submitButton.addEventListener("click", async () => {
    setApiKey(apiKeyInput.value.trim());
    setConnecting(true);
    sourcesList.replaceChildren();
    apiKeyStatus.textContent = "";
    customConnectionError.textContent = "";

    const instances = sourceOptions.map((source) => createInstance(source));
    sourcesList.append(...instances);

    updateConnectionStatus();

    try {
        await Promise.all(instances.map((root) => connectInstance(root)));
    } finally {
        setConnecting(false);
    }
});

customSourceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        customConnectButton.click();
    }
});

customConnectButton.addEventListener("click", async () => {
    customConnectionError.textContent = "";
    let url;
    try {
        url = new URL(customSourceInput.value.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error("Enter an HTTP or HTTPS base URL without credentials, query parameters or a fragment.");
        }
    } catch (err) {
        customConnectionError.textContent = `Invalid instance URL. ${err.message}`;
        return;
    }
    const source = url.href.replace(/\/+$/, "");
    setApiKey(apiKeyInput.value.trim());
    apiKeyStatus.textContent = "";
    await connectSource(source);
});

async function connectSource(source) {
    const existing = [...sourcesList.children].find((root) => root.dataset.source === source || root.dataset.baseSource === source);
    if (existing) {
        existing.open = true;
        existing.querySelector('[data-role="refresh"]').click();
        return;
    }

    const root = createInstance(source);
    root.open = true;
    sourcesList.append(root);
    setConnecting(true);
    try {
        await connectInstance(root);
    } finally {
        setConnecting(false);
    }
}

function setConnecting(connecting) {
    submitButton.disabled = connecting;
    customConnectButton.disabled = connecting;
    apiKeyInput.disabled = connecting;
}

function updateConnectionStatus() {
    const instances = [...sourcesList.children];
    const connected = instances.filter((root) => root.dataset.state === "connected").length;
    const failed = instances.filter((root) => root.dataset.state === "error").length;
    const pending = instances.length - connected - failed;
    connectionStatus.textContent = `${connected}/${instances.length} connected, ${failed} failed${pending ? `, ${pending} connecting` : ""}`;
}

function createInstance(baseSource, datacenter = null) {
    const host = new URL(baseSource).hostname;
    const prefixed = DATACENTERS.find((dc) => host.startsWith(`static-${dc}-`));
    if (prefixed) {
        datacenter ??= prefixed;
        const url = new URL(baseSource);
        url.hostname = host.slice(`static-${prefixed}-`.length);
        baseSource = url.href.replace(/\/+$/, "");
    }
    const source = datacenter ? datacenterSource(baseSource, datacenter) : baseSource;
    const root = instanceTemplate.content.firstElementChild.cloneNode(true);
    root.dataset.source = source;
    root.dataset.baseSource = baseSource;
    if (datacenter) root.dataset.datacenter = datacenter;
    root.querySelector('[data-role="instance-name"]').textContent = new URL(baseSource).host;
    root.querySelector('[data-role="instance-url"]').textContent = source;
    root.querySelector(".env-badge").dataset.environment = getEnvironment(baseSource);
    const swaggerLink = root.querySelector('[data-role="swagger"]');
    swaggerLink.href = `${source}/swagger`;
    const datacenterButtons = root.querySelector('[data-role="datacenter-buttons"]');
    const datacenterCounts = root.querySelector('[data-role="dc-summary"]');
    for (const dc of DATACENTERS) {
        const count = document.createElement("span");
        count.dataset.dc = dc;
        count.textContent = `${dc.toUpperCase()}: —`;
        datacenterCounts.append(count);

        const button = document.createElement("button");
        button.type = "button";
        button.dataset.dc = dc;
        button.textContent = dc.toUpperCase();
        button.setAttribute("aria-pressed", String(dc === datacenter));
        button.title = dc === datacenter
            ? "Switch back to the default endpoint"
            : `Switch to ${datacenterSource(baseSource, dc)}`;
        button.addEventListener("click", () => switchDatacenter(root, dc === datacenter ? null : dc));
        datacenterButtons.append(button);
    }
    root.querySelector('[data-role="datacenter-label"]').textContent =
        `Connected to: ${datacenter ? datacenter.toUpperCase() : "default"}`;
    return root;
}

async function switchDatacenter(root, datacenter) {
    const replacement = createInstance(root.dataset.baseSource, datacenter);
    replacement.open = root.open;
    root.replaceWith(replacement);
    updateConnectionStatus();
    await connectInstance(replacement);
}

async function connectInstance(root) {
    const source = root.dataset.source;
    const status = root.querySelector('[data-role="connection-status"]');
    const error = root.querySelector('[data-role="connection-error"]');
    const refreshButton = root.querySelector('[data-role="refresh"]');
    let initialized = false;
    let refreshing = false;

    const refresh = async () => {
        if (refreshing) return;
        refreshing = true;
        refreshButton.disabled = true;
        root.dataset.state = "connecting";
        status.textContent = "Connecting...";
        updateHealthSummary(root, "loading");
        error.hidden = true;
        updateConnectionStatus();

        try {
            const response = await proxyFetch(`${source}/secure`);
            if (!response.ok) {
                throw new Error(response.status === 401 || response.status === 403
                    ? `Invalid API key (HTTP ${response.status}).`
                    : `Connection failed (HTTP ${response.status}).`);
            }

            if (!initialized) {
                setupFetchDocumentEntryById(source, root);
                setupActionSection(source, root);
                initialized = true;
            }
            root.querySelector('[data-role="statuses"]').hidden = false;
            root.querySelector('[data-role="action"]').hidden = false;
            status.textContent = "Loading...";
            // Not awaited: unreachable datacenters may hang until the proxy timeout.
            fetchDatacenterCounts(root.dataset.baseSource, root);
            await Promise.all([
                fetchHealthCheck(source, root),
                fetchAboutConfig(source, root),
                fetchBackendImplementations(source, root),
                fetchRegistryObjectsCount(source, root),
                fetchPatientIdentifiers(source, root),
            ]);
            root.dataset.state = "connected";
            status.textContent = "Connected";
            status.title = `Last refreshed: ${new Date().toLocaleString()}`;
        } catch (err) {
            root.dataset.state = "error";
            status.textContent = "Connection failed";
            updateHealthSummary(root, "unavailable");
            resetDatacenterCounts(root);
            error.textContent = err.message;
            error.hidden = false;
            root.querySelector('[data-role="statuses"]').hidden = true;
            root.querySelector('[data-role="action"]').hidden = true;
        } finally {
            refreshButton.disabled = false;
            refreshing = false;
            updateConnectionStatus();
        }
    };

    refreshButton.addEventListener("click", refresh);
    root.addEventListener("refresh-instance", refresh);
    await refresh();
}

function getEnvironment(source) {
    const environment = source.match(/(\w)-xcads/)?.[1];
    return { d: "env-dev", t: "env-test", q: "env-qa" }[environment] ?? "env-prod";
}
