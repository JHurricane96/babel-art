// The warm browser: one Chromium kept open with Vista loaded, in a profile of its own so the land and
// sprites the page saves (cache.ts) are found again, even after a restart. A check then costs
// seconds, not a cold start (minutes under software GL). Two pages, each opened when a check first
// needs it and reloaded when the build changes:
//   world  the page as visitors see it (held: it moves only when a check steps it)
//   lab    the sprites alone (?lab=sprites): no land, ready in seconds
// run.mjs starts this when needed (logging to DIR/warm.log) and sends it checks; `run.mjs --stop`
// stops it. Checks run one at a time.
import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONTROL_PORT, DIR, GL_ARGS, HTML, PAGE_PORT, out } from "./lib.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("The harness needs Playwright (with its Chromium): npm install --no-save playwright && npx playwright install chromium");
  process.exit(1);
}

http
  .createServer((req, res) => {
    if (new URL(req.url, "http://x").pathname !== "/vista.html") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(HTML));
  })
  .listen(PAGE_PORT, "127.0.0.1");

const ctx = await chromium.launchPersistentContext(join(DIR, "profile"), {
  headless: !process.env.VISTA_HEADED,
  args: GL_ARGS,
  viewport: { width: 1400, height: 900 },
});
/** The open pages: their page, the build they loaded, how long that took, where their land and
 * sprites came from. */
const open = {};
/** Messages from the page during the check now running. */
let said = null;
async function pageFor(kind) {
  const built = statSync(HTML).mtimeMs;
  let o = open[kind];
  if (o && o.built === built && !o.page.isClosed()) return { ...o, fresh: false };
  const t0 = Date.now(),
    page = o && !o.page.isClosed() ? o.page : kind === "world" && ctx.pages()[0]?.url() === "about:blank" ? ctx.pages()[0] : await ctx.newPage();
  if (!o || o.page !== page) {
    page.on("pageerror", (e) => said?.push(`[page error] ${e.message.split("\n").slice(0, 6).join("\n")}`));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") said?.push(`[page ${m.type()}] ${m.text()}`);
    });
  }
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/vista.html${kind === "lab" ? "?lab=sprites" : ""}`);
  await page.waitForFunction(() => window.vista?.ready, null, { timeout: 0, polling: 250 });
  await page.evaluate(() => window.vista.hold());
  const saved = await page.evaluate(() => window.vista.saved());
  o = open[kind] = { page, built, loadMs: Date.now() - t0, land: saved.landFrom, sprites: saved.spritesFrom };
  return { ...o, fresh: true };
}

let queue = Promise.resolve();
const control = http.createServer((req, res) => {
  const reply = (code, v) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(v));
  };
  if (req.url === "/status") return reply(200, { pid: process.pid, dir: DIR, gl: GL_ARGS, pages: Object.fromEntries(Object.entries(open).map(([k, o]) => [k, { loadMs: o.loadMs, land: o.land, sprites: o.sprites }])) });
  if (req.url === "/stop") {
    reply(200, { stopping: true });
    setTimeout(async () => {
      await ctx.close().catch(() => {});
      process.exit(0);
    }, 50);
    return;
  }
  if (req.url !== "/run" || req.method !== "POST") return reply(404, {});
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    queue = queue.then(async () => {
      const { check, args } = JSON.parse(body),
        logs = [],
        log = (...a) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
      said = logs;
      let result, error, info;
      const t0 = Date.now();
      try {
        const mod = await import(`${pathToFileURL(check).href}?t=${statSync(check).mtimeMs}`);
        info = await pageFor(mod.page ?? "world");
        const t1 = Date.now();
        result = await mod.default({ page: info.page, args: args ?? {}, log, out });
        info.checkMs = Date.now() - t1;
      } catch (e) {
        error = e.stack ?? String(e);
      }
      said = null;
      reply(200, { result, error, logs, page: info && { fresh: info.fresh, loadMs: info.loadMs, land: info.land, sprites: info.sprites }, checkMs: info?.checkMs, totalMs: Date.now() - t0 });
    });
  });
});
control.requestTimeout = 0;
control.headersTimeout = 0;
control.listen(CONTROL_PORT, "127.0.0.1", () => console.log(`warm browser on ${CONTROL_PORT} (page on ${PAGE_PORT}), ${DIR}`));
