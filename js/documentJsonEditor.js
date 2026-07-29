export function openDocumentJsonEditor({ title, initialPayload, onSave }) {
    const elements = getEditorElements();
    elements.title.textContent = title;
    elements.textarea.value = JSON.stringify(initialPayload, null, 2);

    showElement(elements.overlay, "flex");
    showElement(elements.quickOverlay, "none");
    document.body.classList.add("no-scroll");
    elements.textarea.focus();

    let isSaving = false;

    const cleanup = () => {
        document.removeEventListener("keydown", onKeyDown);
        elements.overlay.removeEventListener("click", onOverlayClick);
        elements.cancelButton.removeEventListener("click", onCancelClick);
        elements.saveButton.removeEventListener("click", onSaveClick);
        elements.quickButton.removeEventListener("click", onQuickClick);
        elements.quickCancelButton.removeEventListener("click", onQuickCancelClick);
        elements.quickApplyButton.removeEventListener("click", onQuickApplyClick);
        elements.quickOverlay.removeEventListener("click", onQuickOverlayClick);

        elements.saveButton.disabled = false;
        elements.cancelButton.disabled = false;
        elements.quickButton.disabled = false;

        showElement(elements.quickOverlay, "none");
        showElement(elements.overlay, "none");
        document.body.classList.remove("no-scroll");
    };

    const closeEditor = () => {
        if (!isSaving) cleanup();
    };

    const onKeyDown = (event) => {
        if (event.key !== "Escape" || isSaving) return;
        event.preventDefault();
        if (isVisible(elements.quickOverlay)) {
            showElement(elements.quickOverlay, "none");
            return;
        }
        closeEditor();
    };

    const onOverlayClick = (event) => {
        if (event.target !== elements.overlay || isSaving) return;
        closeEditor();
    };

    const onCancelClick = () => closeEditor();

    const onSaveClick = async () => {
        if (isSaving) return;

        let parsedPayload;
        try {
            parsedPayload = JSON.parse(elements.textarea.value);
        } catch (err) {
            alert(`Invalid JSON.\n\n${err.message}`);
            return;
        }

        isSaving = true;
        elements.saveButton.disabled = true;
        elements.cancelButton.disabled = true;
        elements.quickButton.disabled = true;

        try {
            await onSave(parsedPayload);
            cleanup();
        } catch (err) {
            alert(err instanceof Error ? err.message : String(err));
            isSaving = false;
            elements.saveButton.disabled = false;
            elements.cancelButton.disabled = false;
            elements.quickButton.disabled = false;
        }
    };

    const onQuickClick = () => {
        const payload = parseEditorPayload(elements.textarea.value);
        if (!payload) return;

        const reference = ensureObject(payload.documentEntry);
        const typeCode = ensureObject(reference.typeCode);

        elements.quickTitleInput.value = reference.title ?? payload.title ?? "";
        elements.quickMimeTypeInput.value = reference.mimeType ?? "";
        elements.quickTypeCodeInput.value = typeCode.code ?? "";
        elements.quickTypeSystemInput.value = typeCode.codeSystem ?? "";

        showElement(elements.quickOverlay, "flex");
        elements.quickTitleInput.focus();
    };

    const onQuickCancelClick = () => {
        showElement(elements.quickOverlay, "none");
    };

    const onQuickApplyClick = () => {
        const payload = parseEditorPayload(elements.textarea.value);
        if (!payload) return;

        payload.documentEntry = ensureObject(payload.documentEntry);
        payload.documentEntry.typeCode = ensureObject(payload.documentEntry.typeCode);

        const titleValue = elements.quickTitleInput.value.trim();
        const mimeTypeValue = elements.quickMimeTypeInput.value.trim();
        const typeCodeValue = elements.quickTypeCodeInput.value.trim();
        const typeSystemValue = elements.quickTypeSystemInput.value.trim();

        payload.documentEntry.title = titleValue;

        if (mimeTypeValue) {
            payload.documentEntry.mimeType = mimeTypeValue;
        } else {
            delete payload.documentEntry.mimeType;
        }

        if (typeCodeValue) {
            payload.documentEntry.typeCode.code = typeCodeValue;
        } else {
            delete payload.documentEntry.typeCode.code;
        }

        if (typeSystemValue) {
            payload.documentEntry.typeCode.codeSystem = typeSystemValue;
        } else {
            delete payload.documentEntry.typeCode.codeSystem;
        }

        elements.textarea.value = JSON.stringify(payload, null, 2);
        showElement(elements.quickOverlay, "none");
    };

    const onQuickOverlayClick = (event) => {
        if (event.target === elements.quickOverlay) {
            showElement(elements.quickOverlay, "none");
        }
    };

    document.addEventListener("keydown", onKeyDown);
    elements.overlay.addEventListener("click", onOverlayClick);
    elements.cancelButton.addEventListener("click", onCancelClick);
    elements.saveButton.addEventListener("click", onSaveClick);
    elements.quickButton.addEventListener("click", onQuickClick);
    elements.quickCancelButton.addEventListener("click", onQuickCancelClick);
    elements.quickApplyButton.addEventListener("click", onQuickApplyClick);
    elements.quickOverlay.addEventListener("click", onQuickOverlayClick);
}

function parseEditorPayload(rawText) {
    try {
        return JSON.parse(rawText);
    } catch (err) {
        alert(`Current JSON is invalid.\n\n${err.message}`);
        return null;
    }
}

function ensureObject(value) {
    return value && typeof value === "object" ? value : {};
}

function showElement(element, displayValue) {
    element.style.display = displayValue;
}

function isVisible(element) {
    return element.style.display !== "none";
}

function getEditorElements() {
    const elements = {
        overlay: document.getElementById("jsonEditorOverlay"),
        title: document.getElementById("jsonEditorTitle"),
        textarea: document.getElementById("jsonEditorTextarea"),
        cancelButton: document.getElementById("jsonEditorCancelButton"),
        saveButton: document.getElementById("jsonEditorSaveButton"),
        quickButton: document.getElementById("jsonEditorQuickEditsButton"),
        quickOverlay: document.getElementById("jsonQuickEditOverlay"),
        quickTitleInput: document.getElementById("jsonQuickEditDocumentTitle"),
        quickMimeTypeInput: document.getElementById("jsonQuickEditMimeType"),
        quickTypeCodeInput: document.getElementById("jsonQuickEditTypeCode"),
        quickTypeSystemInput: document.getElementById("jsonQuickEditTypeSystem"),
        quickCancelButton: document.getElementById("jsonQuickEditCancelButton"),
        quickApplyButton: document.getElementById("jsonQuickEditApplyButton")
    };

    const missing = Object.entries(elements).filter(([, el]) => !el).map(([key]) => key);
    if (missing.length > 0) {
        throw new Error(`JSON editor elements are missing in HTML: ${missing.join(", ")}`);
    }

    return elements;
}
