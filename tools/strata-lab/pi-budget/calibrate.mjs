// CPU calibration: runs benchmarks that have published Raspberry Pi 5 results on this machine and
// derives "Pi 5 time / this machine's time" factors from them.
//   node tools/strata-lab/pi-budget/calibrate.mjs --tools DIR --out DIR [--only a,b] [--port 4621]
// DIR for --tools is where setup.sh put p7zip 16.02, CoreMark, Speedometer 2.1, JetStream 2.1 and
// Octane 2.0. Each benchmark is skipped if its tool is missing. --only runs a subset (sevenZip,
// coremark, sysbench, js, speedometer21, jetstream21, octane2) and keeps earlier results from
// OUT/calibration.json for the others; each browser suite takes 2-6 minutes. Writes OUT/calibration.json.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./lib/server.mjs";
import { launch } from "./lib/browser.mjs";
import { CPU_REFS, CPU_CONTEXT, MEMORY } from "./lib/pi5.mjs";

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
const suites = { speedometer21: "speedometer21", jetstream21: "jetstream21", octane2: "octane" };
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
  if (mounts["/jetstream21/"]) await suite("jetstream21", async (p) => {
    await p.goto(`http://127.0.0.1:${port}/jetstream21/index.html`);
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

// Factors: Pi 5 time / time here = (score here) / (score on Pi 5), for higher-is-better scores.
const factors = {};
for (const [k, ref] of Object.entries(CPU_REFS)) {
  if (!results[k]) continue;
  const pis = ref.pi5.map((p) => p.value);
  const f = pis.map((v) => results[k].here / v);
  factors[k] = { what: ref.what, here: results[k].here, pi5: ref.pi5, factor: median(f), factorRange: [Math.min(...f), Math.max(...f)] };
}
const inRange = Object.entries(factors).filter(([k]) => !CPU_REFS[k].outlier).map(([, f]) => f);
const fv = inRange.map((f) => f.factor);
// JS-engine suites (JetStream, Octane) are the closest published browser figures to typed-array kernels.
const jsKernel = ["jetstream21", "octane2"].filter((k) => factors[k]).map((k) => factors[k].factor);
const summary = {
  // Central: median over all benchmarks run (outliers included). Range: lowest and highest factor of
  // the benchmarks not marked as outliers; `highAll` includes them.
  central: median(Object.values(factors).map((f) => f.factor)),
  low: Math.min(...inRange.map((f) => f.factorRange[0])), high: Math.max(...inRange.map((f) => f.factorRange[1])),
  highAll: Math.max(...Object.values(factors).map((f) => f.factorRange[1])),
  native: median(["sevenZip", "coremark", "sysbench"].filter((k) => factors[k]).map((k) => factors[k].factor)),
  jsKernel: jsKernel.length ? median(jsKernel) : null,
  speedometer: factors.speedometer21 ? factors.speedometer21.factor : null,
  memory: results.js ? {
    jsReadGBs: results.js.mem.readGBs, jsMemcpyGBs: results.js.mem.setCopyTinymembenchGBs,
    pi5MemcpyGBs: MEMORY.memcpy.map((m) => m.gbs), pi5ReadGBs: MEMORY.read.map((m) => m.gbs),
    memcpyFactor: median(MEMORY.memcpy.map((m) => m.gbs)) ? results.js.mem.setCopyTinymembenchGBs / median(MEMORY.memcpy.map((m) => m.gbs)) : null,
  } : null,
};
machine.loadavgAfter = fs.readFileSync("/proc/loadavg", "utf8").trim();
const doc = { machine, results, factors, summary, context: CPU_CONTEXT };
fs.writeFileSync(path.join(out, "calibration.json"), JSON.stringify(doc, null, 2));
console.log(JSON.stringify({ factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, { here: v.here, factor: +v.factor.toFixed(3), range: v.factorRange.map((x) => +x.toFixed(3)) }])), summary }, null, 2));
log("wrote", path.join(out, "calibration.json"));
