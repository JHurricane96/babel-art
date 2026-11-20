// Strata Pi 5 budget: runs the two spikes (material simulation, light flood) on the CPU in headless
// Chromium and on the GPU (WebGL2 under SwiftShader, for counting only), then estimates Raspberry Pi 5
// cost: CPU times scaled by the factors from calibrate.mjs, GPU times from lib/gpu-model.mjs.
//   node tools/strata-lab/pi-budget/run.mjs --out DIR [--calibration FILE] [--throttle] [--quick] [--port 4611]
// Writes DIR/results.json (everything measured and estimated) and DIR/report.md (the summary table).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./lib/server.mjs";
import { launch } from "./lib/browser.mjs";
import { haveTools, shaderCost, roughCost } from "./lib/shader-cost.mjs";
import { estimate, presentContext, glmarkCheck, SCENARIOS } from "./lib/gpu-model.mjs";
import { cpuEstimate, share, fmtRange, median, FRAME_MS } from "./lib/estimate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes("--" + k);
const out = path.resolve(arg("out", path.join(process.env.TMPDIR || "/tmp", "strata-pi-budget")));
const calPath = path.resolve(arg("calibration", path.join(out, "calibration.json")));
const port = +arg("port", 4611);
const quick = flag("quick");
fs.mkdirSync(out, { recursive: true });
const log = (...a) => console.error("[run]", ...a);
if (!fs.existsSync(calPath)) { console.error(`No calibration at ${calPath}. Run calibrate.mjs first (see README.md).`); process.exit(1); }
const cal = JSON.parse(fs.readFileSync(calPath, "utf8"));

const server = await serve(port, { "/": path.join(here, "web") });
const browser = await launch();
const R = { date: new Date().toISOString(), loadavg: [fs.readFileSync("/proc/loadavg", "utf8").trim()], calibration: calPath };
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => log("page error:", e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.benchReady);
  const ev = (fn, a) => page.evaluate(fn, a);
  R.info = await ev(() => bench.info());
  const drift = async () => { const v = []; for (let i = 0; i < 3; i++) v.push((await ev(() => bench.drift())).ms); return median(v); };
  R.driftStart = await drift();

  log("material simulation, CPU worker");
  const reps = quick ? 1 : 2;
  R.sandCPU = { realistic: [], busy: [], worst: [] };
  for (let i = 0; i < reps; i++) {
    R.sandCPU.realistic.push(await ev((o) => bench.sandCPU(o), { kind: "realistic", warmup: 300, steps: quick ? 300 : 600 }));
    R.sandCPU.busy.push(await ev((o) => bench.sandCPU(o), { kind: "busy", warmup: 100, steps: quick ? 150 : 300 }));
    R.sandCPU.worst.push(await ev((o) => bench.sandCPU(o), { kind: "worst", warmup: 30, steps: quick ? 60 : 150 }));
  }
  R.sandCPU.unchunked = await ev((o) => bench.sandCPU(o), { kind: "realistic", chunking: false, warmup: 300, steps: 60 });
  R.sandDeterminism = await ev(() => bench.sandDeterminism());

  log("light flood, CPU");
  R.lightCPU = [];
  for (let i = 0; i < reps; i++) R.lightCPU.push(await ev((o) => bench.lightCPU(o), { reps: quick ? 3 : 6 }));

  log("material simulation, GPU (SwiftShader: counts only)");
  R.sandGPU = {
    realistic: await ev((o) => bench.sandGPU(o), { kind: "realistic", warmup: quick ? 100 : 300, steps: 4 }),
    busy: await ev((o) => bench.sandGPU(o), { kind: "busy", warmup: 100, steps: 4 }),
    worst: await ev((o) => bench.sandGPU(o), { kind: "worst", warmup: 30, steps: 4 }),
  };
  log("light flood, GPU (SwiftShader: counts only)");
  R.lightGPU = {};
  for (const v of ["jfa-full", "jfa-half", "jfa-quarter", "iter-quarter"]) R.lightGPU[v] = await ev((o) => bench.lightGPU(o), { variant: v, reps: 1 });

  R.programs = await ev(() => bench.programs());
  R.driftEnd = await drift();

  if (flag("throttle")) {
    // CPU throttling sanity check (Chrome DevTools Protocol), at the central calibration factor.
    // It slows the page's main thread only; the worker variant shows whether workers are throttled.
    const rate = Math.max(1, cal.summary.central);
    log("CPU throttling check at rate", rate.toFixed(2));
    const cdp = await page.context().newCDPSession(page);
    const runSet = () => Promise.all([]).then(async () => ({
      sandRealistic: (await ev((o) => bench.sandMain(o), { kind: "realistic", warmup: 150, steps: 150 })).step.median,
      sandWorst: (await ev((o) => bench.sandMain(o), { kind: "worst", warmup: 10, steps: 30 })).step.median,
      lightFull: (await ev((o) => bench.lightCPU(o), { reps: 3 })).full.median,
      sandWorker: (await ev((o) => bench.sandCPU(o), { kind: "worst", warmup: 10, steps: 30 })).step.median,
    }));
    const base = await runSet();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const thr = await runSet();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    R.throttle = { rate, base, throttled: thr, ratio: Object.fromEntries(Object.keys(base).map((k) => [k, thr[k] / base[k]])) };
  }
} finally {
  await browser.close(); server.close();
}
R.loadavg.push(fs.readFileSync("/proc/loadavg", "utf8").trim());

// ---- Shader op counts ----
log("shader op counts");
const tools = haveTools();
R.shaderCosts = {};
for (const p of R.programs) if (!R.shaderCosts[p.name]) R.shaderCosts[p.name] = tools ? shaderCost(p.fs, p.trivialDefine) : roughCost(p.fs);

// ---- Estimates ----
// Drift: if the machine ran slower than during calibration (shared machine), scale times down.
const runDrift = (R.driftStart + R.driftEnd) / 2;
const calDrift = cal.results?.js?.driftMs;
const drift = calDrift ? Math.min(1, calDrift / runDrift) : 1;
R.drift = { calibrationMs: calDrift, runStartMs: R.driftStart, runEndMs: R.driftEnd, correction: drift };

const E = (R.estimates = {});
const best = (arr, f) => arr.map(f).sort((a, b) => a - b)[0]; // fastest repeat: noise only adds time
const sr = R.sandCPU.realistic, sb = R.sandCPU.busy, sw = R.sandCPU.worst;
E.sandCPU = {
  realisticMedian: cpuEstimate(best(sr, (r) => r.step.median), cal, sr[0], drift),
  realisticP95: cpuEstimate(best(sr, (r) => r.step.p95), cal, sr[0], drift),
  busyMedian: cpuEstimate(best(sb, (r) => r.step.median), cal, { workingSetBytes: sb[0].workingSetBytes, dramBytes: sb[0].bytesPerStep }, drift),
  busyP95: cpuEstimate(best(sb, (r) => r.step.p95), cal, { workingSetBytes: sb[0].workingSetBytes, dramBytes: sb[0].bytesPerStep }, drift),
  worstMedian: cpuEstimate(best(sw, (r) => r.step.median), cal, { workingSetBytes: sw[0].workingSetBytes, dramBytes: sw[0].bytesPerStep }, drift),
  unchunkedMedian: cpuEstimate(R.sandCPU.unchunked.step.median, cal, { workingSetBytes: R.sandCPU.unchunked.workingSetBytes, dramBytes: R.sandCPU.unchunked.bytesPerStep }, drift),
  handoffCopy: cpuEstimate(best(sr, (r) => r.copyMs), cal, {}, drift),
  uploadCall: cpuEstimate(best(sr, (r) => r.uploadCallMs), cal, {}, drift),
};
const lc = R.lightCPU;
const ws = lc[0].workingSetBytes;
E.lightCPU = {
  full: cpuEstimate(best(lc, (r) => r.full.median), cal, { workingSetBytes: ws, dramBytes: lc[0].bytesSky + lc[0].bytesQuantize }, drift),
  sky: cpuEstimate(best(lc, (r) => r.sky.median), cal, { workingSetBytes: ws, dramBytes: lc[0].bytesSky }, drift),
  lights: cpuEstimate(best(lc, (r) => r.lights.median), cal, {}, drift),
  quantize: cpuEstimate(best(lc, (r) => r.quantize.median), cal, { workingSetBytes: ws, dramBytes: lc[0].bytesQuantize }, drift),
  fullImage4ch: cpuEstimate(best(lc, (r) => r.fullImage4ch.median), cal, { workingSetBytes: ws, dramBytes: 4 * lc[0].bytesSky + lc[0].bytesQuantize }, drift),
  movingLight: cpuEstimate(best(lc, (r) => r.movingLight.mean), cal, {}, drift),
};
const sandKey = () => "sand-block";
E.sandGPU = {};
for (const k of ["realistic", "busy", "worst"]) {
  const g = R.sandGPU[k];
  E.sandGPU[k] = estimate({ draws: g.draws, passes: g.passesPerStep, uploadBytes: 0 }, R.shaderCosts, sandKey, () => g.activity.groupFrac);
}
E.lightGPU = {};
for (const [v, g] of Object.entries(R.lightGPU)) {
  const key = (d) => `${d.tag.prog}@${g.scale}`;
  const active = (d) => (d.tag.prog.startsWith("light-prop") ? g.openGroupFrac : 1);
  E.lightGPU[v] = estimate({ draws: g.draws, passes: g.counts.passes, uploadBytes: g.counts.uploadBytes + g.counts.bufferBytes }, R.shaderCosts, key, active);
}
E.present = presentContext();
E.glmark = glmarkCheck();
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(R, null, 1));

// ---- Report ----
const L = [];
const f2 = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const pct = (x) => `${share(x).toFixed(x < 1 ? 1 : 0)}%`;
const cpuRow = (name, e, note = "", perFrame = 1) => L.push(`| ${name} | ${f2(e.hereMs)} | ${fmtRange(e)} | ${pct(e.low * perFrame)}-${pct(e.high * perFrame)} | ${note} |`);
const gpuRow = (name, e, note = "", perFrame = 1) => L.push(`| ${name} | - | ${f2(e.low.gpuMs)}-${f2(e.high.gpuMs)} (central ${f2(e.centralGpuMs)}) | ${pct(e.low.gpuMs * perFrame)}-${pct(e.high.gpuMs * perFrame)} | ${note} |`);
L.push(`# Strata Pi 5 budget report`, "", `Run ${R.date}. ${R.info.gl.renderer}. Calibration: ${calPath}.`, "");
L.push(`CPU factor (Pi 5 time / time here): central ${cal.summary.central.toFixed(2)}, range ${cal.summary.low.toFixed(2)}-${cal.summary.high.toFixed(2)}` +
  ` (native compute ${cal.summary.native?.toFixed(2)}, JS-engine suites ${cal.summary.jsKernel?.toFixed(2)}, Speedometer 2.1 ${cal.summary.speedometer?.toFixed(2)} left out of the range).` +
  ` Drift correction ${drift.toFixed(3)} (load ${R.loadavg.join(" -> ")}).`, "");
L.push("Share of frame = share of one 16.7 ms frame at 60 fps, low-high. For 30 steps/s workloads, the per-frame share counts half a step per frame.", "");
L.push("| Workload | ms here | Pi 5 ms (low-high) | share of frame | notes |", "| --- | --- | --- | --- | --- |");
const s0 = sr[0];
cpuRow("Sand CPU worker, realistic, median step", E.sandCPU.realisticMedian, `${s0.activeChunks.toFixed(0)}/${s0.totalChunks} chunks active, ${Math.round(s0.visitedCells)} cells visited; per frame at 30 steps/s`, 0.5);
cpuRow("Sand CPU worker, realistic, p95 step", E.sandCPU.realisticP95, "per frame at 30 steps/s", 0.5);
cpuRow("Sand CPU worker, busy (rain + sand slab), median step", E.sandCPU.busyMedian, `${sb[0].activeChunks.toFixed(0)}/${sb[0].totalChunks} chunks active, ${Math.round(sb[0].visitedCells)} cells visited; per frame at 30 steps/s`, 0.5);
cpuRow("Sand CPU worker, busy, p95 step", E.sandCPU.busyP95, "per frame at 30 steps/s", 0.5);
cpuRow("Sand CPU worker, worst case (all active), median step", E.sandCPU.worstMedian, `all ${sw[0].totalChunks} chunks; ${(sw[0].moves / 1e3).toFixed(0)}k moves/step; per frame at 30 steps/s`, 0.5);
cpuRow("Sand CPU, realistic with chunking off", E.sandCPU.unchunkedMedian, "shows what chunking saves", 0.5);
cpuRow("Sand: copy grid out of worker (960 KB)", E.sandCPU.handoffCopy, "per step", 0.5);
cpuRow("Sand: texSubImage2D call, main thread", E.sandCPU.uploadCall, "renderer side only; GPU process adds copies", 0.5);
for (const k of ["realistic", "busy", "worst"]) {
  const g = R.sandGPU[k], e = E.sandGPU[k];
  gpuRow(`Sand GPU (Margolus, ${g.passesPerStep} passes/step), ${k}`, e, `${(g.activity.groupFrac * 100).toFixed(1)}% of 16-lane groups active; ${g.perStep.passes} passes, ${(g.perStep.frags / 1e3).toFixed(0)}k fragments/step; per frame at 30 steps/s`, 0.5);
}
cpuRow("Light CPU, full recompute (sky + all point lights + stepping)", E.lightCPU.full, `if done every frame; ${lc[0].sources} point sources, each in its own box`);
cpuRow("Light CPU, sky channel (whole view)", E.lightCPU.sky, "2 sweep pairs + rock faces");
cpuRow("Light CPU, all point lights (boxes)", E.lightCPU.lights, `${lc[0].sources} sources`);
cpuRow("Light CPU, 5-level Bayer stepping of whole view", E.lightCPU.quantize, "");
cpuRow("Light CPU, alternative: 4 channels flooded over whole view", E.lightCPU.fullImage4ch, "no boxes");
cpuRow("Light CPU, one moving point light (local box)", E.lightCPU.movingLight, `box ~${Math.round(lc[0].movingLightBoxArea)} px, incl. re-stepping`);
for (const [v, g] of Object.entries(R.lightGPU)) {
  gpuRow(`Light GPU ${v}`, E.lightGPU[v], `${g.counts.passes} passes, ${g.counts.draws} draws, ${(g.counts.frags / 1e6).toFixed(2)}M fragments; differs from CPU in ${(g.vsCPU.differFrac * 100).toFixed(1)}% of pixel-channels, leaks ${(g.vsCPU.leakFrac * 100).toFixed(2)}%`);
}
for (const p of E.present) L.push(`| Context: ${p.name} | - | ${f2(p.low)}-${f2(p.high)} | ${pct(p.low)}-${pct(p.high)} | GPU, assumed shader |`);
L.push("", `GPU rows are model estimates (lib/gpu-model.mjs), not SwiftShader timings; central = geometric mean of the bounds. Model check: a full-screen 1080p draw with a 60-op shader costs ${f2(E.glmark.modelLow)}-${f2(E.glmark.modelHigh)} ms in the model; the published glmark2 score of ~190 at 1080p means ~${f2(E.glmark.glmark2FrameMs)} ms per frame averaged over its scenes.`, "", "CPU-side cost of GPU work:");
for (const [v, e] of Object.entries({ ...Object.fromEntries(Object.entries(E.lightGPU).map(([k, x]) => ["light " + k, x])), "sand realistic": E.sandGPU.realistic })) {
  L.push(`- ${v}: submit ${f2(e.low.cpuSubmitMs)}-${f2(e.high.cpuSubmitMs)} ms, uploads ${f2(e.low.uploadCpuMs)}-${f2(e.high.uploadCpuMs)} ms per update`);
}
L.push("", `Determinism: CPU sand replay identical: ${R.sandDeterminism.identical}; GPU sand replay identical: ${R.sandGPU.realistic.replayIdentical && R.sandGPU.worst.replayIdentical}.`);
L.push(`Light CPU: converges in ${lc[0].convergedIters.join("/")} sweep pairs per channel; 2 pairs differ from converged in ${(lc[0].twoIterDiffFrac * 100).toFixed(4)}% of pixel-channels.`);
if (R.throttle) L.push(`CPU throttling at ${R.throttle.rate.toFixed(2)}x: measured slow-down ${Object.entries(R.throttle.ratio).map(([k, v]) => `${k} ${v.toFixed(2)}x`).join(", ")}.`);
L.push("", "Shader op counts (per fragment, all paths / early-out path):");
for (const [n, c] of Object.entries(R.shaderCosts)) L.push(`- ${n}: ${c.full.ops} ops, ${c.full.fetches} fetches${c.trivial ? ` / ${c.trivial.ops} ops, ${c.trivial.fetches} fetches` : ""}`);
fs.writeFileSync(path.join(out, "report.md"), L.join("\n") + "\n");
console.log(L.join("\n"));
log("wrote", path.join(out, "results.json"), "and report.md");
