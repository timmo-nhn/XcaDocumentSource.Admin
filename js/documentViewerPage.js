import { detectFileType, decodeUtf8 } from "./utils.js";

const titleEl = document.getElementById("viewerTitle");
const frameEl = document.getElementById("viewerFrame");
const messageEl = document.getElementById("viewerMessage");
const xmlPanelEl = document.getElementById("xmlPanel");
const xmlRawEl = document.getElementById("xmlRaw");

const params = new URLSearchParams(window.location.search);
const source = params.get("source") ?? "";
const link = params.get("link") ?? "";
const title = params.get("title") ?? "Document Viewer";
const mimeTypeHint = params.get("mimeType") ?? "application/pdf";
const apiKey = params.get("apiKey") ?? "";
const xsltCache = new Map();

document.title = title;
titleEl.textContent = title;
frameEl.title = title;

if (!source || !link) {
    showError("Missing source/link query parameters.");
}
else {
    const query = new URLSearchParams({
        source,
        link,
        mimeType: mimeTypeHint,
    });

    if (apiKey) {
        query.set("apiKey", apiKey);
    }

    const documentUrl = `/api/get-document?${query.toString()}`;

    try {
        const response = await fetch(documentUrl, { method: "GET" });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text}`);
        }

        const responseContentType = response.headers.get("content-type") ?? mimeTypeHint;
        const lowerType = responseContentType.toLowerCase();

        // Fast path: let browser stream/render directly without buffering in JS.
        if (lowerType.includes("application/pdf") || lowerType.startsWith("image/")) {
            frameEl.src = documentUrl;
        }
        else {
            const content = await response.arrayBuffer();
            const payload = new Uint8Array(content);

            const jsonWrapped = extractDocumentBytesFromJson(payload, responseContentType);
            if (jsonWrapped) {
                const xmlTextFromJson = extractClinicalDocumentXml(jsonWrapped.bytes);
                if (xmlTextFromJson !== null) {
                    showRawXml(xmlTextFromJson);
                    const embedded = extractNonXmlBodyData(xmlTextFromJson);
                    if (!embedded) {
                        showError("ClinicalDocument found in JSON payload, but no NonXMLBody payload was found.");
                    }
                    else {
                        const detected = detectFileType(embedded.bytes, embedded.mediaType ?? jsonWrapped.mimeType ?? "application/octet-stream");
                        renderByType(detected, embedded.bytes);
                    }
                }
                else {
                    const detected = detectFileType(jsonWrapped.bytes, jsonWrapped.mimeType ?? responseContentType);
                    renderByType(detected, jsonWrapped.bytes);
                }
            }
            else {
                const xmlText = extractClinicalDocumentXml(payload);
                if (xmlText !== null) {
                    showRawXml(xmlText);
                    const embedded = extractNonXmlBodyData(xmlText);
                    if (!embedded) {
                        showError("ClinicalDocument found, but no NonXMLBody payload was found.");
                    }
                    else {
                        const detected = detectFileType(embedded.bytes, embedded.mediaType ?? "application/octet-stream");
                        renderByType(detected, embedded.bytes);
                    }
                }
                else {
                    const maybeDecoded = maybeDecodeBase64Text(payload);
                    const bytesToInspect = maybeDecoded ?? payload;
                    const detected = detectFileType(bytesToInspect, responseContentType);
                    if (detected.kind === "pdf" || detected.kind === "image") {
                        renderByType(detected, bytesToInspect);
                    } else {
                        // Last-resort: raw iframe stream attempt
                        frameEl.src = documentUrl;
                    }
                }
            }
        }
    } catch (err) {
        showError(`Failed to load document: ${err.message}`);
    }

    frameEl.addEventListener("error", () => {
        showError("Failed to render document.");
    });
}

function renderByType(detected, bytes) {
    switch (detected.kind) {
        case "pdf":
            renderPdf(bytes);
            break;
        case "image":
            renderImage(bytes, detected.mimeType);
            break;
        case "xml":
            renderXml(bytes, detected.mimeType);
            break;
        default:
            renderRaw(bytes, `Unsupported file type. Detected: ${detected.mimeType || detected.kind}. Showing raw data.`);
            // showError(`Unsupported file type. Detected: ${detected.mimeType || detected.kind}`);
            break;
    }
}

function renderPdf(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    frameEl.src = url;
}

function renderImage(bytes, mimeType) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const html = `<img src="${url}" title="${escapeHtml(title)}">`;
    frameEl.srcdoc = html;
}

async function renderXml(bytes, mimeType) {
    const xmlText = decodeUtf8(bytes);
    if (!xmlText.trim()) {
        renderRaw(bytes, "XML detected, but payload was empty.");
        return;
    }

    showRawXml(xmlText);
    let message;

    try {
        const transformed = await transformXmlToHtml(xmlText);
        if (transformed) {
            frameEl.srcdoc = transformed;
            return;
        }
        message = `Could not match XSLT for XML type (${mimeType || "application/xml"}). Showing raw XML.`;

    } catch (err) {
        console.warn("XSLT transform failed, trying native stylesheet fallback:", err);
        if (renderXmlWithNativeStylesheet(xmlText)) {
            messageEl.hidden = false;
            messageEl.textContent = `Using browser native XML stylesheet fallback (${err.message}).`;
            return;
        }
        message = `XSLT transform failed: ${err.message}. Showing raw XML.`;
    }

    renderRaw(bytes, message);
}

function renderRaw(bytes, message) {
    frameEl.hidden = false;
    messageEl.hidden = false;

    messageEl.textContent = message;

    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const text = decodeUtf8(bytes);
    frameEl.srcdoc = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body {
      margin: 0;
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
      background: #111;
      color: #ddd;
      font-family: ui-monospace, monospace;
    }
    pre {
      margin: 0;
      padding: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      max-width: 100%;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <pre>${escapeHtml(text || hex || "[no content]")}</pre>
</body>
</html>`;
}

function showError(message) {
    frameEl.hidden = true;
    messageEl.hidden = false;
    messageEl.textContent = message;
}

function showRawXml(xmlText) {
    frameEl.hidden = false;
    xmlPanelEl.hidden = false;
    const scrubbed = stripClinicalDocumentBase64(xmlText);
    xmlRawEl.value = prettyPrintXml(scrubbed);
}

function extractClinicalDocumentXml(bytes) {
    const text = decodeUtf8(bytes);
    if (!text) return null;
    const trimmed = text.replace(/^\uFEFF?[\s\r\n\t]*/u, "");
    if (trimmed.startsWith("<ClinicalDocument")) return text;
    return null;
}

function extractNonXmlBodyData(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");

    const parseError = xml.querySelector("parsererror");
    if (parseError) return null;

    const nonXmlBody = findElementByLocalName(xml.documentElement, "NonXMLBody");
    if (!nonXmlBody) return null;

    const textElement = findElementByLocalName(nonXmlBody, "text");
    if (!textElement) return null;

    const mediaType = textElement.getAttribute("mediaType") || textElement.getAttribute("media-type");
    const base64Data = (textElement.textContent || "").trim();
    if (!base64Data) return null;

    try {
        return {
            bytes: decodeBase64(base64Data),
            mediaType,
        };
    } catch {
        return null;
    }
}

function findElementByLocalName(root, name) {
    if (!root) return null;
    const target = name.toLowerCase();
    const all = [root, ...root.getElementsByTagName("*")];
    for (const el of all) {
        const local = (el.localName || el.nodeName || "").toLowerCase();
        if (local === target) return el;
    }
    return null;
}

function extractDocumentBytesFromJson(bytes, mimeHint) {
    const hint = String(mimeHint || "").toLowerCase();
    const text = decodeUtf8(bytes).trim();
    if (!text) return null;
    if (!hint.includes("json") && !text.startsWith("{")) return null;

    try {
        const payload = JSON.parse(text);
        const base64 = payload?.document?.data ?? payload?.data;
        if (!base64) return null;
        const mimeType = payload?.document?.mimeType ?? payload?.document?.contentType ?? null;
        return {
            bytes: decodeBase64(base64),
            mimeType,
        };
    } catch {
        return null;
    }
}

function maybeDecodeBase64Text(bytes) {
    const text = decodeUtf8(bytes).trim();
    if (!text) return null;

    // Only attempt when the payload looks like base64 and not like XML/JSON.
    if (text.startsWith("<") || text.startsWith("{") || text.startsWith("[")) return null;
    if (!/^[A-Za-z0-9+/_=\r\n-]+$/.test(text)) return null;
    if (text.length < 24) return null;

    try {
        return decodeBase64(text);
    } catch {
        return null;
    }

}

async function transformXmlToHtml(xmlText) {
    const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (xmlDoc.querySelector("parsererror")) return null;

    const xsltPath = pickXsltPath(xmlDoc);
    if (!xsltPath) return null;

    const xsltDoc = await loadXslt(xsltPath);
    const processor = new XSLTProcessor();
    processor.importStylesheet(xsltDoc);
    let transformed = null;
    try {
        transformed = processor.transformToDocument(xmlDoc);
    } catch {
        // Some engines fail transformToDocument for HTML-output stylesheets.
    }

    if (!transformed || typeof transformed.nodeType !== "number") {
        transformed = processor.transformToFragment(xmlDoc, document);
    }

    if (!transformed || typeof transformed.nodeType !== "number") return null;

    const html = new XMLSerializer().serializeToString(transformed);
    return html.includes("<html") ? html : `<!DOCTYPE html><html><body>${html}</body></html>`;
}

function renderXmlWithNativeStylesheet(xmlText) {
    const xmlDoc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (xmlDoc.querySelector("parsererror")) return false;

    const xsltPath = pickXsltPath(xmlDoc);
    if (!xsltPath) return false;

    const cleanXml = String(xmlText).replace(/^\uFEFF/, "").replace(/^<\?xml[^>]*\?>\s*/i, "");
    const absoluteXsltPath = `${window.location.origin}${xsltPath}`;
    const xmlWithPi =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<?xml-stylesheet type="text/xsl" href="${absoluteXsltPath}"?>\n` +
        cleanXml;

    const url = URL.createObjectURL(new Blob([xmlWithPi], { type: "application/xml" }));
    frameEl.src = url;
    return true;
}

function pickXsltPath(xmlDoc) {
    const root = xmlDoc.documentElement;
    if (!root) return null;

    const ns = (root.namespaceURI || "").toLowerCase();
    const typeV = (xmlDoc.querySelector("Type")?.getAttribute("V") || "").toUpperCase();

    if (ns.includes("/epikrise/") || typeV === "EPIKRISE") {
        return "/visningsfil/epikrise/Epikrise2html.xsl";
    }

    if (ns.includes("/labsvar/") || ns.includes("/svarrapport/")) {
        return "/visningsfil/svarrapport/svarrapport2html.xsl";
    }

    return null;
}

async function loadXslt(path) {
    if (!xsltCache.has(path)) {
        const p = fetch(path).then(async (r) => {
            if (!r.ok) throw new Error(`Failed to fetch ${path}: HTTP ${r.status}`);
            const original = await r.text();
            const withAbsoluteImports = absolutizeXsltHrefs(original, path);
            const text = rewriteCssDocumentCalls(withAbsoluteImports, path);
            const doc = new DOMParser().parseFromString(text, "application/xml");
            if (doc.querySelector("parsererror")) {
                throw new Error(`Invalid XSLT in ${path}`);
            }
            return doc;
        });
        xsltCache.set(path, p);
    }
    return xsltCache.get(path);
}

function absolutizeXsltHrefs(xsltText, stylesheetPath) {
    return xsltText.replace(
        /(<xsl:(?:import|include)\b[^>]*\bhref\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
        (_, prefix, href, suffix) => {
            try {
                const absolute = new URL(href, window.location.origin + stylesheetPath).toString();
                return `${prefix}${absolute}${suffix}`;
            } catch {
                return `${prefix}${href}${suffix}`;
            }
        }
    );
}

function rewriteCssDocumentCalls(xsltText, stylesheetPath) {
    return xsltText.replace(
        /<style\b[^>]*>\s*<xsl:value-of\b[^>]*select\s*=\s*["']document\(['"]([^'"]+\.css)['"]\)["'][^>]*\/>\s*<\/style>/gi,
        (_, href) => {
            try {
                const absolute = new URL(href, window.location.origin + stylesheetPath).pathname;
                return `<link rel="stylesheet" type="text/css" href="${absolute}"/>`;
            } catch {
                return `<link rel="stylesheet" type="text/css" href="${href}"/>`;
            }
        }
    );
}

function decodeBase64(input) {
    let normalized = String(input).trim();
    const marker = "base64,";
    const markerIndex = normalized.indexOf(marker);

    if (markerIndex >= 0) 
        normalized = normalized.slice(markerIndex + marker.length);

    normalized = normalized.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");

    const mod = normalized.length % 4;

    if (mod > 0) 
        normalized += "=".repeat(4 - mod);

    const raw = atob(normalized);
    const out = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) 
        out[i] = raw.charCodeAt(i);

    return out;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function prettyPrintXml(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");

    if (xml.querySelector("parsererror")) {
        return xmlText;
    }

    const serializer = new XMLSerializer();
    const raw = serializer.serializeToString(xml);

    return formatXmlIndentation(raw);
}

function stripClinicalDocumentBase64(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");

    if (xml.querySelector("parsererror")) {
        return xmlText;
    }

    const nonXmlBody = findElementByLocalName(xml.documentElement, "NonXMLBody");

    if (!nonXmlBody) {
        return xmlText;
    }

    const textElement = findElementByLocalName(nonXmlBody, "text");

    if (!textElement) {
        return xmlText;
    }

    const original = (textElement.textContent || "").trim();

    if (!original) {
        return xmlText;
    }

    textElement.textContent = `[base64 removed, length=${original.length} chars]`;

    return new XMLSerializer().serializeToString(xml);
}

function formatXmlIndentation(xml) {
    const tokens = xml.replace(/>\s*</g, "><").replace(/(>)(<)(\/*)/g, "$1\n$2$3").split("\n");
    let pad = 0;
    const lines = [];
    
    for (const token of tokens) {
        if (!token) continue;

        const trimmed = token.trim();

        if (trimmed.startsWith("</")) {
            pad = Math.max(0, pad - 1);
        }

        lines.push(`${"  ".repeat(pad)}${trimmed}`);
        const opens = /^<[^!?/][^>]*[^/]>$/.test(trimmed);
        
        if (opens) {
            pad += 1;
        }
    }
    
    return lines.join("\n");
}
