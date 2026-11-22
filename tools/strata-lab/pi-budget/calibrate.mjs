// CPU calibration: runs benchmarks that have published results for the target machines (lib/targets.mjs)
// on this machine and derives "target time / this machine's time" factors from them.
//   node tools/strata-lab/pi-budget/calibrate.mjs --tools DIR --out DIR [--only a,b] [--port 4621]
// DIR for --tools is where setup.sh put p7zip 16.02, CoreMark, Speedometer 2.1 and 3.0, JetStream 2.0
// and 2.1, and Octane 2.0; 7-Zip 23.01 is the system `7z` (apt package 7zip). Each benchmark is skipped
// if its tool is missing. --only runs a subset (sevenZip, sevenZip23, coremark, sysbench, js,
// speedometer21, speedometer30, jetstream20, jetstream21, octane2) and adds to the earlier results in
// OUT/calibration.json; each browser suite takes 2-6 minutes. Writes OUT/calibration.json with the
// scores measured here and the factors for every target.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./lib/server.mjs";
import { launch } from "./lib/browser.mjs";
import { TARGETS, cpuFactors } from "./lib/targets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const tools = path.resolve(arg("tools", "./pi-budget-tools"));
const out = path.resolve(arg("out", path.join(process.env.TMPDIR || "/tmp", "strata-pi-budget")));
const port = +arg("port", 4621);
const only = arg("only", null)?.split(",");
const want = (k) => !only || only.includes(k);
fs.mkdirSync(out, { recursive: true });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const log = (...a) => console.error("[calibrate]", ...a);

const machine = {
  cpu: (() => { try { return execSync("grep -m1 'model name' /proc/cpuinfo").toString().split(":")[1].trim(); } catch { return "?"; } })(),
  loadavgBefore: fs.readFileSync("/proc/loadavg", "utf8").trim(),
  date: new Date().toISOString(),
};
const prev = path.join(out, "calibration.json");
const earlier = only && fs.existsSync(prev) ? JSON.parse(fs.readFileSync(prev, "utf8")).results : {};
const results = { ...earlier };

// Native benchmarks.
const z = path.join(tools, "p7zip/usr/lib/p7zip/7zr");
if (want("sevenZip") && fs.existsSync(z)) {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    log("7-Zip 16.02 single-thread run", i + 1);
    const txt = execFileSync(z, ["b", "-mmt1"], { encoding: "utf8", maxBuffer: 1 << 24 });
    const tot = txt.split("\n").find((l) => l.startsWith("Tot:"));
    runs.push(+tot.trim().split(/\s+/).pop());
  }
  results.sevenZip = { here: Math.max(...runs), runs, note: "best of runs (noise from the shared machine only slows it down)" };
}
// 7-Zip 23.01 (Ubuntu/Debian package 7zip), to bracket published results from other 7-Zip versions.
if (want("sevenZip23")) try {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    log("7-Zip (system 7z) single-thread run", i + 1);
    const txt = execFileSync("7z", ["b", "-mmt1"], { encoding: "utf8", maxBuffer: 1 << 24 });
    const ver = /7-Zip (\d+\.\d+)/.exec(txt)?.[1];
    if (!ver || parseFloat(ver) < 21) { log("system 7z is", ver, "- skipped (want 7-Zip 21 or later)"); break; }
    runs.push(+txt.split("\n").find((l) => l.startsWith("Tot:")).trim().split(/\s+/).pop());
    results.sevenZip23 = { here: Math.max(...runs), runs, note: "7-Zip " + ver };
  }
} catch { log("system 7z not available, skipped"); }
const cm = path.join(tools, "coremark/coremark.exe");
if (want("coremark") && fs.existsSync(cm)) {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    log("CoreMark single-thread run", i + 1);
    const txt = execFileSync(cm, ["0x0", "0x0", "0x66", "0", "7", "1", "2000"], { encoding: "utf8" });
    runs.push(+/Iterations\/Sec\s*:\s*([\d.]+)/.exec(txt)[1]);
  }
  results.coremark = { here: Math.max(...runs), runs, note: "gcc -O2, one thread" };
}
if (want("sysbench")) try {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    log("sysbench cpu single-thread run", i + 1);
    const txt = execFileSync("sysbench", ["cpu", "--threads=1", "--time=10", "run"], { encoding: "utf8" });
    runs.push(+/events per second:\s*([\d.]+)/.exec(txt)[1]);
  }
  results.sysbench = { here: Math.max(...runs), runs };
} catch { log("sysbench not available, skipped"); }

// Browser: JS probes, Speedometer 2.1, JetStream 2.1, Octane 2.0 (each from its own checkout).
const suites = { speedometer21: "speedometer21", speedometer30: "speedometer30", jetstream20: "jetstream20", jetstream21: "jetstream21", octane2: "octane" };
const mounts = { "/": path.join(here, "web") };
for (const [k, dir] of Object.entries(suites)) if (want(k) && fs.existsSync(path.join(tools, dir))) mounts[`/${k}/`] = path.join(tools, dir);
const server = await serve(port, mounts);
const browser = await launch();
const suite = async (k, fn) => {
  log(k, "(a few minutes)");
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => log(k, "page error:", e.message));
  try { const v = await fn(p); results[k] = { here: v, runs: [v], note: "headless Chromium " + R_VERSION() }; } finally { await p.close(); }
};
let version = "";
const R_VERSION = () => version;
try {
  version = browser.version();
  if (want("js")) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.benchReady);
    log("JS memory bandwidth and drift probe");
    results.js = await page.evaluate(() => bench.calib());
    const drift = [];
    for (let i = 0; i < 3; i++) drift.push((await page.evaluate(() => bench.drift())).ms);
    results.js.driftMs = median(drift);
    await page.close();
  }
  const T = { timeout: 9 * 60 * 1000, polling: 2000 };
  if (mounts["/speedometer21/"]) await suite("speedometer21", async (p) => {
    await p.goto(`http://127.0.0.1:${port}/speedometer21/index.html`);
    await p.evaluate(() => startTest());
    await p.waitForFunction(() => document.getElementById("result-number").textContent.length > 0, null, T);
    return +(await p.evaluate(() => document.getElementById("result-number").textContent));
  });
  if (mounts["/speedometer30/"]) await suite("speedometer30", async (p) => {
    await p.goto(`http://127.0.0.1:${port}/speedometer30/index.html?startAutomatically=true`);
    await p.waitForFunction(() => document.getElementById("result-number").textContent.length > 0, null, T);
    return +(await p.evaluate(() => document.getElementById("result-number").textContent));
  });
  for (const js of ["jetstream20", "jetstream21"]) if (mounts[`/${js}/`]) await suite(js, async (p) => {
    await p.goto(`http://127.0.0.1:${port}/${js}/index.html`);
    await p.waitForFunction(() => !document.getElementById("status").classList.contains("loading"), null, T);
    await p.evaluate(() => JetStream.start());
    await p.waitForFunction(() => document.querySelector("#result-summary .score"), null, T);
    return +(await p.evaluate(() => document.querySelector("#result-summary .score").textContent));
  });
  if (mounts["/octane2/"]) await suite("octane2", async (p) => {
    await p.goto(`http://127.0.0.1:${port}/octane2/index.html`);
    await p.evaluate(() => Run());
    await p.waitForFunction(() => /Octane Score: \d+/.test(document.getElementById("main-banner").textContent), null, T);
    return +/(\d+)/.exec(await p.evaluate(() => document.getElementById("main-banner").textContent))[1];
  });
} finally {
  await browser.close(); server.close();
}

// A rerun of a benchmark adds to its earlier runs; the best run counts (noise from a shared machine
// only ever slows a run down).
for (const [k, r] of Object.entries(results)) {
  const e = earlier[k];
  if (!e || e === r || k === "js" || typeof r.here !== "number") continue;
  const runs = [...(e.runs || [e.here]), ...(r.runs || [r.here])];
  results[k] = { ...r, runs, here: Math.max(...runs) };
}

// Factors for every target; the top-level `factors`/`summary` are the Raspberry Pi 5's (default target).
const targets = Object.fromEntries(Object.entries(TARGETS).map(([id, t]) => [id, cpuFactors(results, t)]));
const { factors, summary } = targets.pi5;
const jsMemory = results.js ? { jsReadGBs: results.js.mem.readGBs, jsMemcpyGBs: results.js.mem.setCopyTinymembenchGBs } : null;
machine.loadavgAfter = fs.readFileSync("/proc/loadavg", "utf8").trim();
const doc = { machine, results, factors, summary, targets, jsMemory };
fs.writeFileSync(path.join(out, "calibration.json"), JSON.stringify(doc, null, 2));
for (const [id, t] of Object.entries(targets)) console.log(id, JSON.stringify({ factors: Object.fromEntries(Object.entries(t.factors).map(([k, v]) => [k, { here: v.here, factor: +v.factor.toFixed(3), range: v.factorRange.map((x) => +x.toFixed(3)) }])), summary: t.summary }, null, 1));
log("wrote", path.join(out, "calibration.json"));
