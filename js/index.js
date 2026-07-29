import { setApiKey, proxyFetch } from "./api.js";
import { fetchHealthCheck, fetchAboutConfig, fetchRegistryObjects } from "./status.js";
import { fetchPatientIdentifiers } from "./documents.js";
import { setupActionSection } from "./actions.js";
import { escapeHtml } from "./utils.js";

const sourceInput  = document.getElementById("sourceInput");
const apiKeyInput  = document.getElementById("apiKeyInput");
const apiKeyStatus = document.getElementById("apiKeyStatus");
const connectionStatus = document.getElementById("connectionStatus");
const submitButton = document.getElementById("submitButton");

// Submit on Enter from either input field
[sourceInput, apiKeyInput].forEach(el => {
    el.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); submitButton.click(); }
    });
});

setupInputDropdown();

// Clear validation badge whenever the key is edited
apiKeyInput.addEventListener("input", () => setApiKeyStatus(null));
connectionStatus.textContent = "";

submitButton.addEventListener("click", function () {
    const source = sourceInput.value.trim().replace(/\/$/, "");
    setApiKey(apiKeyInput.value.trim());
    if (source) runStatusChecks(source);
});

async function runStatusChecks(source) {
    const statusesEl = document.getElementById("statuses");

    const keyValid = await validateApiKey(source);
    if (!keyValid) {
        statusesEl.hidden = true;
        return;
    }
    connectionStatus.textContent = `Connected (${new Date().toLocaleString()})`;

    statusesEl.hidden = false;

    await Promise.all([
        fetchHealthCheck(source),
        fetchAboutConfig(source),
        fetchRegistryObjects(source),
        fetchPatientIdentifiers(source),
    ]);

    setupActionSection(source);
}

async function validateApiKey(source) {
    setApiKeyStatus("loading");
    try {
        const res = await proxyFetch(`${source}/secure`);
        if (res.ok) { setApiKeyStatus("ok"); return true; }
        if (res.status === 401 || res.status === 403) { setApiKeyStatus("invalid"); return false; }
        setApiKeyStatus("ok");
        return true;
    } catch {
        setApiKeyStatus("error");
        return false;
    }
}

function setApiKeyStatus(state) {
    const labels = {
        loading: { text: "Validating…", cls: "api-key-status--loading" },
        ok:      { text: "✓ Valid",     cls: "api-key-status--ok" },
        invalid: { text: "✗ Invalid",   cls: "api-key-status--invalid" },
        error:   { text: "✗ Error",     cls: "api-key-status--error" },
    };
    apiKeyStatus.className = "api-key-status";
    apiKeyStatus.textContent = "";
    if (!state) return;
    const { text, cls } = labels[state];
    apiKeyStatus.classList.add(cls);
    apiKeyStatus.textContent = text;
}

function setupInputDropdown() {
    const sourceInputComponent = document.getElementById("sourceInputComponent");
    const sourceInputMenu = document.getElementById("sourceInputMenu");
    const sourceInputToggle = document.getElementById("sourceInputToggle");

    const sourceOptions = [
        "https://localhost:7176",
        "https://viti-aktivt-sykehus.d-xcads.pjd.nhn.no",
        "https://bjarne-sykehus.t-xcads.pjd.nhn.no",
        "https://kurt-sykehus.t-xcads.pjd.nhn.no",
        "https://rex-sykehus.t-xcads.pjd.nhn.no",
        "https://tim-sykehus.t-xcads.pjd.nhn.no",
        "https://origo-sykehus.t-xcads.pjd.nhn.no",
    ];

    sourceInputMenu.innerHTML = sourceOptions
        .map(source => `<li class="source-selector__item" data-source="${escapeHtml(source)}"><span class="env-badge" data-environment="${getEnvironment(source)}"></span> ${escapeHtml(source)}</li>`)
        .join("");

    sourceInputToggle.addEventListener("click", () => {
        const shouldOpen = sourceInputMenu.hidden;
        setSourceMenuOpen(shouldOpen);
        if (shouldOpen) {
            sourceInput.focus();
        }
    });

    sourceInput.addEventListener("focus", () => {
        if (sourceInput.value.trim() === "") {
            setSourceMenuOpen(true);
        }
    });

    sourceInput.addEventListener("input", () => {
        const search = sourceInput.value.trim().toLowerCase();
        const items = [...sourceInputMenu.querySelectorAll(".source-selector__item")];
        let visibleCount = 0;
        items.forEach(item => {
            const value = item.dataset.source.toLowerCase();
            const visible = value.includes(search);
            item.hidden = !visible;
            if (visible) visibleCount += 1;
        });
        setSourceMenuOpen(visibleCount > 0);
    });

    sourceInputMenu.addEventListener("click", (event) => {
        const selected = event.target.closest(".source-selector__item");
        if (!selected) return;
        sourceInput.value = selected.dataset.source;
        setSourceMenuOpen(false);
        sourceInput.focus();
    });

    document.addEventListener("click", (event) => {
        if (!sourceInputComponent.contains(event.target)) {
            setSourceMenuOpen(false);
        }
    });

    sourceInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setSourceMenuOpen(false);
        }
    });

    function setSourceMenuOpen(isOpen) {
        sourceInputMenu.hidden = !isOpen;
        sourceInputToggle.setAttribute("aria-expanded", String(isOpen));
    }
}

function getEnvironment(source) {
    
    const labels = {
        dev: { id:"d", cls: "env-dev" },
        test: { id:"t", cls: "env-test" },
        qa: { id:"q", cls: "env-qa" },
        prod: { id:"", cls: "env-prod" },
    };

    let sourceSources = source.match(/(\w)-xcads/)?.at(1);

    return Object.values(labels).find(label => label.id === sourceSources)?.cls ?? "env-prod";
}