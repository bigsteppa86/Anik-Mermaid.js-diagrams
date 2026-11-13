/*
 * Static server for the browser tests.
 *
 * It mimics the parts of Anki's media server the add-on relies on:
 *   /_addons/anki_mermaid/web/...  the add-on's web exports
 *   /_anki/...                     Anki's own scripts (here: the page mocks)
 *   /editor.html                   served with the editor's content security policy
 */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT, "anki_mermaid", "web");
const PAGES_DIR = path.join(__dirname, "pages");

const MIME = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
};

/** Mirrors _untrusted_sveltekit_content_security_policy in qt/aqt/mediasrv.py. */
function editorCsp(port) {
    const origin = `http://127.0.0.1:${port}`;
    return [
        `script-src ${origin}/_anki/ ${origin}/_app/ ${origin}/_addons/`,
        "form-action 'none'",
        "frame-ancestors 'none'",
    ].join("; ");
}

function resolveFile(urlPath) {
    const routes = [
        ["/_addons/anki_mermaid/web/", WEB_DIR],
        ["/_anki/", PAGES_DIR],
        ["/", PAGES_DIR],
    ];
    for (const [prefix, dir] of routes) {
        if (urlPath.startsWith(prefix)) {
            const file = path.normalize(path.join(dir, urlPath.slice(prefix.length)));
            return file.startsWith(dir + path.sep) ? file : null;
        }
    }
    return null;
}

function start() {
    const server = http.createServer((request, response) => {
        const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        const file = resolveFile(urlPath);
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end("not found");
            return;
        }
        const headers = {
            "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
            "Cache-Control": "max-age=0",
        };
        if (urlPath === "/editor.html") {
            headers["Content-Security-Policy"] = editorCsp(server.address().port);
        }
        response.writeHead(200, headers);
        fs.createReadStream(file).pipe(response);
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

module.exports = { start };

if (require.main === module) {
    start().then(({ origin }) => console.log(`Serving on ${origin}`));
}
