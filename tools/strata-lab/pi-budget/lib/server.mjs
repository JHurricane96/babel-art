// Minimal static server. The benchmark pages are served cross-origin isolated (COOP/COEP), which
// gives the page and its worker 5 microsecond timers instead of 100 microsecond ones.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

// mounts: { "/": dir, "/speedometer/": dir2 }; isolated: prefixes that get COOP/COEP headers.
export function serve(port, mounts, isolated = ["/"]) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const prefix = Object.keys(mounts).sort((a, b) => b.length - a.length).find((p) => url.startsWith(p));
    if (!prefix) { res.writeHead(404); res.end(); return; }
    const root = path.resolve(mounts[prefix]);
    let file = path.resolve(root, "." + url.slice(prefix.length - 1));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const headers = { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (prefix === "/" && isolated.includes("/")) { headers["Cross-Origin-Opener-Policy"] = "same-origin"; headers["Cross-Origin-Embedder-Policy"] = "require-corp"; }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
