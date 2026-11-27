// Run a check in the warm browser (warm.mjs), building the page first if its code changed and
// starting the browser if it is not running.
//
//   node tools/strata-lab/vista/harness/run.mjs CHECK [key=value ...]
//   node tools/strata-lab/vista/harness/run.mjs --status | --stop
//
// CHECK: a check's name in checks/ (walk, sheet, pops, ...) or a path to one. A check is a module:
//   export const page = "lab" | "world";            // the sprites alone, or the world (default)
//   export default async ({ page, args, log, out }) => result;
// `page` is Playwright's (page.evaluate(() => window.vista...)), `args` the key=value pairs (numbers
// as numbers), `log` prints, `out(name)` a path in the output folder. A result with `ok: false`, or
// an error, makes the exit code 1. Timings are printed last.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import { isAbsolute, join, resolve } from "node:path";
import { CONTROL_PORT, DIR, HERE, HTML, REPO, VISTA } from "./lib.mjs";

const argv = process.argv.slice(2);
const call = (path, body) =>
  new Promise((ok, fail) => {
    const rq = http.request({ host: "127.0.0.1", port: CONTROL_PORT, path, method: body ? "POST" : "GET", timeout: 0 }, (res) => {
      let s = "";
      res.on("data", (d) => (s += d));
      res.on("end", () => ok(JSON.parse(s || "{}")));
    });
    rq.on("error", fail);
    rq.end(body ? JSON.stringify(body) : undefined);
  });
const up = () => call("/status").then(() => true, () => false);

if (argv[0] === "--status") {
  console.log((await up()) ? JSON.stringify(await call("/status"), null, 1) : "not running");
  process.exit(0);
}
if (argv[0] === "--stop") {
  console.log((await up()) ? (await call("/stop"), "stopped") : "not running");
  process.exit(0);
}
if (!argv[0]) {
  console.log(`checks: ${readdirSync(join(HERE, "checks")).map((f) => f.replace(/\.mjs$/, "")).join(", ")}`);
  process.exit(0);
}

const t0 = Date.now();
// The build: made again if anything it is made from is newer.
mkdirSync(DIR, { recursive: true });
function newest(dir, skip) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.includes(e.name)) t = Math.max(t, newest(p, skip));
    } else if (/\.(ts|mjs|html)$/.test(e.name)) t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
}
const sources = Math.max(newest(VISTA, ["harness"]), newest(join(REPO, "engine", "strata"), []));
let buildMs = 0;
if (!existsSync(HTML) || statSync(HTML).mtimeMs < sources) {
  const b0 = Date.now();
  execFileSync(process.execPath, [join(VISTA, "build.mjs"), HTML, "--standalone"], { stdio: ["ignore", "inherit", "inherit"] });
  buildMs = Date.now() - b0;
}
// The browser.
let startMs = 0;
if (!(await up())) {
  const s0 = Date.now(),
    logFile = openSync(join(DIR, "warm.log"), "a");
  spawn(process.execPath, [join(HERE, "warm.mjs")], { detached: true, stdio: ["ignore", logFile, logFile] }).unref();
  while (!(await up())) {
    if (Date.now() - s0 > 60000) throw new Error(`the warm browser did not start: see ${join(DIR, "warm.log")}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  startMs = Date.now() - s0;
}
// The check.
const name = argv[0],
  check = existsSync(join(HERE, "checks", `${name}.mjs`)) ? join(HERE, "checks", `${name}.mjs`) : isAbsolute(name) ? name : resolve(name);
const args = {};
for (const a of argv.slice(1)) {
  const i = a.indexOf("=");
  const k = i < 0 ? a : a.slice(0, i),
    v = i < 0 ? "1" : a.slice(i + 1);
  args[k] = v !== "" && !isNaN(Number(v)) ? Number(v) : v;
}
const r = await call("/run", { check, args });
for (const l of r.logs ?? []) console.log(l);
if (r.error) console.error(r.error);
else if (r.result !== undefined) console.log(typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 1));
const s = (ms) => `${(ms / 1000).toFixed(1)} s`,
  pg = r.page;
console.log(
  `[harness] ${[
    buildMs && `build ${s(buildMs)}`,
    startMs && `browser started ${s(startMs)}`,
    pg && (pg.fresh ? `page loaded ${s(pg.loadMs)} (land ${pg.land || "none"}, sprites ${pg.sprites})` : "page warm"),
    r.checkMs !== undefined && `check ${s(r.checkMs)}`,
    `total ${s(Date.now() - t0)}`,
  ]
    .filter(Boolean)
    .join(", ")}`,
);
process.exit(r.error || r.result?.ok === false ? 1 : 0);
