import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8000;

// Equivalent to curl -k — skips TLS certificate validation for the proxy target
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

const MIME = {
    ".html": "text/html",
    ".js":   "application/javascript",
    ".css":  "text/css",
    ".json": "application/json",
    ".ico":  "image/x-icon",
};

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === "/api/get-document") {
        if (req.method !== "GET") {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }

        const source = url.searchParams.get("source");
        const link = url.searchParams.get("link");
        const mimeTypeHint = url.searchParams.get("mimeType") ?? "application/pdf";
        const apiKey = url.searchParams.get("apiKey") ?? req.headers["x-api-key"];

        if (!source || !link) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing source/link query parameters" }));
            return;
        }

        let targetUrl;
        try {
            targetUrl = new URL(link, source);
        } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Invalid target URL: ${err.message}` }));
            return;
        }

        const lib = targetUrl.protocol === "https:" ? https : http;
        const requestHeaders = {};
        if (apiKey) {
            requestHeaders["X-Api-Key"] = apiKey;
        }

        const upstreamReq = lib.request(
            targetUrl,
            { method: "GET", headers: requestHeaders, agent: insecureAgent },
            (upstreamRes) => {
                const status = upstreamRes.statusCode ?? 500;
                const upstreamContentType = String(upstreamRes.headers["content-type"] ?? "").toLowerCase();

                if (status >= 400) {
                    res.writeHead(status, {
                        "Content-Type": upstreamContentType || "application/json",
                        "Cache-Control": "no-store",
                    });
                    upstreamRes.pipe(res);
                    return;
                }

                // Stream through directly; do not materialize large payloads in Node.
                res.writeHead(status, {
                    "Content-Type": upstreamContentType || mimeTypeHint,
                    "Content-Disposition": "inline",
                    "Cache-Control": "no-store",
                });

                upstreamRes.pipe(res);
            }
        );

        upstreamReq.on("error", (err) => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        });
        upstreamReq.end();
        return;
    }

    // Proxy endpoint: GET/POST /proxy?url=<encoded-target-url>
    if (url.pathname === "/proxy") {
        // Handle CORS preflight — respond immediately, never forward to target
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin":  "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "X-Api-Key, Authorization, Content-Type",
                "Access-Control-Max-Age":       "86400",
            });
            res.end();
            return;
        }

        const target = url.searchParams.get("url");
        if (!target) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing ?url= parameter" }));
            return;
        }

        try {
            const targetUrl = new URL(target);
            const lib = targetUrl.protocol === "https:" ? https : http;

            // Forward safe headers from the browser request to the target.
            // Node.js lowercases all incoming header names, so compare in lowercase.
            const forwardHeaders = {};
            const allowList = ["x-api-key", "authorization", "content-type", "content-length"];
            for (const [key, value] of Object.entries(req.headers)) {
                if (allowList.includes(key.toLowerCase())) {
                    forwardHeaders[key] = value;
                }
            }

            const proxyReq = lib.request(targetUrl, { method: req.method, headers: forwardHeaders, agent: insecureAgent }, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, {
                    "Content-Type": proxyRes.headers["content-type"] ?? "application/json",
                    "Access-Control-Allow-Origin": "*",
                });
                proxyRes.pipe(res);
            });
            
            proxyReq.on("error", (err) => {
                console.log(err);
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            });
            // Pipe request body (for POST/PUT)
            req.pipe(proxyReq);
        } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Invalid URL: ${err.message}` }));
        }
        return;
    }

    // Static file serving
    let filePath = path.join(__dirname, url.pathname === "/" ? "/index.html" : url.pathname);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
            return;
        }
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Admin server running at http://localhost:${PORT}`);
});

function extractEmbeddedDocument(rawBytes, upstreamContentType) {
    const text = rawBytes.toString("utf8");

    if (upstreamContentType.includes("json")) {
        const payload = JSON.parse(text);
        const base64 = payload?.document?.data ?? payload?.data;
        if (!base64) return null;
        return {
            bytes: Buffer.from(normalizeBase64(base64), "base64"),
            mediaType: payload?.document?.mimeType ?? payload?.document?.contentType ?? null,
        };
    }

    if (upstreamContentType.includes("xml")) {
        const trimmed = text.replace(/^\uFEFF?[\s\r\n\t]*/u, "");
        if (!trimmed.startsWith("<ClinicalDocument")) return null;

        const nonXmlBodyMatch = text.match(/<[^>]*NonXMLBody[^>]*>[\s\S]*?<[^>]*text\b([^>]*)>([\s\S]*?)<\/[^>]*text>[\s\S]*?<\/[^>]*NonXMLBody>/i);
        if (!nonXmlBodyMatch) return null;

        const textAttrs = nonXmlBodyMatch[1] ?? "";
        const base64Data = (nonXmlBodyMatch[2] ?? "").trim();
        if (!base64Data) return null;

        const mediaTypeMatch = textAttrs.match(/\bmediaType\s*=\s*["']([^"']+)["']/i);
        return {
            bytes: Buffer.from(normalizeBase64(base64Data), "base64"),
            mediaType: mediaTypeMatch ? mediaTypeMatch[1] : null,
        };
    }

    return null;
}

function detectContentType(bytes, hint) {
    if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
    if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
    if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
    if (hasPrefix(bytes, [0x42, 0x4d])) return "image/bmp";
    if (hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "image/tiff";
    if (hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasAsciiAt(bytes, "WEBP", 8)) return "image/webp";
    return hint || "application/octet-stream";
}

function hasPrefix(bytes, prefix) {
    if (bytes.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (bytes[i] !== prefix[i]) return false;
    }
    return true;
}

function hasAsciiAt(bytes, text, offset) {
    if (bytes.length < offset + text.length) return false;
    for (let i = 0; i < text.length; i++) {
        if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
}

function normalizeBase64(value) {
    let normalized = String(value).trim();
    const marker = "base64,";
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) {
        normalized = normalized.slice(markerIndex + marker.length);
    }
    normalized = normalized
        .replace(/\s/g, "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const mod = normalized.length % 4;
    if (mod > 0) {
        normalized += "=".repeat(4 - mod);
    }
    return normalized;
}
