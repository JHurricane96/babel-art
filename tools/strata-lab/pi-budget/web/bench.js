// In-page benchmark API, driven by ../run.mjs through Playwright (window.bench).
import { makeWorld, ART_W, ART_H } from "./world.js";
import { SandSim } from "./sand-cpu.js";
import { SandGPU, sandActivity } from "./sand-gpu.js";
import { LightCPU, collectSources } from "./light-cpu.js";
import { LightGPU, VARIANTS } from "./light-gpu.js";
import { instrument, intTexture } from "./gl-count.js";
import { memoryBandwidth, driftProbe } from "./calib.js";

export function summary(a) {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  return { n, mean: s.reduce((x, y) => x + y, 0) / n, median: q(0.5), p95: q(0.95), min: s[0], max: s[n - 1] };
}
const hashArr = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return (h >>> 0).toString(16); };
const histogram = (mat) => { const h = new Array(11).fill(0); for (const m of mat) h[m]++; return h; };

let gl = null, glStats = null;
function getGL() {
  if (gl) return gl;
  const c = document.createElement("canvas"); c.width = 64; c.height = 64;
  gl = c.getContext("webgl2", { antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error("WebGL2 unavailable");
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  glStats = instrument(gl);
  return gl;
}
// gl.finish() does not wait for the GPU process in Chromium; reading one pixel back does.
function sync(g) {
  const fb = g.getParameter(g.FRAMEBUFFER_BINDING);
  if (!fb) { g.finish(); return; }
  const fmt = g.getParameter(g.IMPLEMENTATION_COLOR_READ_FORMAT), type = g.getParameter(g.IMPLEMENTATION_COLOR_READ_TYPE);
  const buf = type === g.UNSIGNED_INT ? new Uint32Array(4) : type === g.INT ? new Int32Array(4) : type === g.UNSIGNED_SHORT ? new Uint16Array(4) : type === g.FLOAT ? new Float32Array(4) : new Uint8Array(4);
  try { g.readPixels(0, 0, 1, 1, fmt, type, buf); } catch { g.finish(); }
}
function glInfo() {
  const g = getGL(), ext = g.getExtension("WEBGL_debug_renderer_info");
  return { renderer: ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER), version: g.getParameter(g.VERSION) };
}

function runWorker(q) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./sand-worker.js", import.meta.url), { type: "module" });
    w.onerror = (e) => reject(new Error(e.message));
    let inited = false;
    w.onmessage = (e) => {
      if (!inited) { inited = true; w.postMessage({ cmd: "run", warmup: q.warmup, steps: q.steps }); return; }
      w.terminate(); resolve(e.data);
    };
    w.postMessage({ cmd: "init", kind: q.kind, w: q.w, h: q.h, seed: q.seed, chunking: q.chunking });
  });
}

const lightStates = new Map();
function lightState(kind, simSteps) {
  const key = kind + ":" + simSteps;
  if (!lightStates.has(key)) {
    const world = makeWorld(kind);
    const sim = new SandSim(world);
    for (let i = 0; i < simSteps; i++) sim.step();
    lightStates.set(key, { world, mat: sim.mat.slice() });
  }
  return lightStates.get(key);
}

window.bench = {
  info: () => ({ ua: navigator.userAgent, cores: navigator.hardwareConcurrency, isolated: self.crossOriginIsolated, gl: glInfo() }),

  async sandCPU({ kind = "realistic", chunking = true, warmup = 300, steps = 600, seed = 7, w = 1200, h = 800 } = {}) {
    const r = await runWorker({ kind, chunking, warmup, steps, seed, w, h });
    // Main-thread cost of handing a step to WebGL: one R8UI upload of the whole grid (renderer side only).
    const g = getGL();
    const t = intTexture(g, g.R8UI, g.RED_INTEGER, g.UNSIGNED_BYTE, w, h);
    const mat = r.mat;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, w, h, g.RED_INTEGER, g.UNSIGNED_BYTE, mat);
    const uploadCallMs = (performance.now() - t0) / 20;
    g.finish(); g.deleteTexture(t);
    return {
      kind, chunking, w, h, warmup, steps, step: summary(r.stepMs), activeChunks: summary(r.activeChunks).mean,
      totalChunks: Math.ceil(w / 64) * Math.ceil(h / 64), visitedCells: summary(r.visited).mean, moves: summary(r.moves).mean,
      copyMs: r.copyMs, uploadCallMs, uploadBytes: w * h, checksum: r.checksum, histogram: histogram(new Uint8Array(mat)),
      // Bytes the step streams through memory: 3 bytes of state per visited cell, read and written.
      bytesPerStep: summary(r.visited).mean * 3 * 2, workingSetBytes: w * h * 3,
    };
  },

  async sandDeterminism({ kind = "realistic", warmup = 200, steps = 100 } = {}) {
    const [a, b] = await Promise.all([1, 2].map(() => runWorker({ kind, chunking: true, warmup, steps, seed: 7, w: 1200, h: 800 })));
    const c = await runWorker({ kind, chunking: false, warmup, steps, seed: 7, w: 1200, h: 800 });
    return { run1: a.checksum, run2: b.checksum, identical: a.checksum === b.checksum, unchunked: c.checksum, chunkingChangesResult: c.checksum !== a.checksum };
  },

  // Same simulation on the page's main thread, for CPU-throttling checks.
  sandMain({ kind = "realistic", chunking = true, warmup = 150, steps = 150 } = {}) {
    const sim = new SandSim(makeWorld(kind), { chunking });
    for (let i = 0; i < warmup; i++) sim.step();
    const ms = [];
    for (let i = 0; i < steps; i++) { const t0 = performance.now(); sim.step(); ms.push(performance.now() - t0); }
    return { kind, step: summary(ms) };
  },

  sandGPU({ kind = "realistic", passesPerStep = 4, warmup = 300, steps = 8 } = {}) {
    const g = getGL(), world = makeWorld(kind);
    const sim = new SandGPU(g, world, { passesPerStep });
    for (let i = 0; i < warmup; i++) { sim.step(); if (i % 20 === 19) sync(g); }
    sync(g);
    glStats.reset();
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) sim.step();
    sync(g);
    const swiftshaderMsPerStep = (performance.now() - t0) / steps;
    const perStep = { draws: glStats.draws.length / steps, passes: glStats.passes / steps, frags: glStats.draws.reduce((a, d) => a + d.frags, 0) / steps };
    const draws = glStats.draws.slice(0, passesPerStep);
    const cells = sim.readCells();
    const activity = sandActivity(cells.mat, world.w, world.h);
    // Determinism: a second, independent instance must reach the identical state.
    const sim2 = new SandGPU(g, world, { passesPerStep });
    for (let i = 0; i < warmup + steps; i++) { sim2.step(); if (i % 20 === 19) sync(g); }
    const cells2 = sim2.readCells();
    return {
      kind, passesPerStep, warmup, steps, perStep, draws, activity, swiftshaderMsPerStep,
      checksum: hashArr(cells.mat) + hashArr(cells.aux), replayIdentical: hashArr(cells.mat) === hashArr(cells2.mat) && hashArr(cells.aux) === hashArr(cells2.aux),
      histogram: histogram(cells.mat), initialHistogram: histogram(world.mat), blocks: (world.w >> 1) * (world.h >> 1),
    };
  },

  lightCPU({ kind = "realistic", simSteps = 300, reps = 5 } = {}) {
    const { world, mat } = lightState(kind, simSteps);
    const L = new LightCPU(ART_W, ART_H);
    let t0 = performance.now();
    L.setMedium(world, mat);
    const mediumMs = performance.now() - t0;
    t0 = performance.now();
    const sources = collectSources(world, mat);
    const sourcesMs = performance.now() - t0;
    // "full": what the artwork would do to recompute everything: sky flooded over the whole view,
    // each point light in its own box, then the whole view stepped.
    const full = [], skyMs = [], lightsMs = [], qMs = [], img4 = [];
    for (let r = 0; r < reps + 2; r++) {
      const a = performance.now();
      L.flood(0, sources, 2);
      const b = performance.now();
      for (let c = 1; c < 4; c++) L.L[c].fill(0);
      for (const s of sources) if (s.ch > 0) L.updateLight(s, L.L[s.ch], 2);
      const c2 = performance.now();
      L.quantize();
      const d = performance.now();
      if (r >= 2) { full.push(d - a); skyMs.push(b - a); lightsMs.push(c2 - b); qMs.push(d - c2); }
    }
    const out2 = L.out.slice();
    // Alternative: every channel flooded over the whole view (no boxes).
    for (let r = 0; r < 3; r++) { const a = performance.now(); for (let c = 0; c < 4; c++) L.flood(c, sources, 2); L.quantize(); if (r) img4.push(performance.now() - a); }
    // Reference: every channel flooded over the whole view until nothing changes.
    const iters = [];
    for (let c = 0; c < 4; c++) { L.flood(c, sources, 0); iters.push(L.lastIters); }
    L.quantize();
    const ref = L.out.slice();
    let diff = 0;
    for (let i = 0; i < ref.length; i++) if (ref[i] !== out2[i]) diff++;
    // Moving point lights: each recomputed in its own box and max-combined, then the box re-stepped.
    const placed = sources.filter((s) => s.ch > 0).slice(0, 64);
    const per = [], areas = [];
    for (let r = 0; r < 3; r++) for (const s of placed) {
      const a = performance.now();
      const box = L.updateLight(s, L.L[s.ch], 2);
      L.quantize(box.x0, box.y0, box.x1, box.y1);
      if (r > 0) { per.push(performance.now() - a); areas.push(box.area); }
    }
    const lightsByCh = [0, 0, 0, 0]; for (const s of sources) lightsByCh[s.ch]++;
    const cells = (ART_W + 2) * (ART_H + 2);
    return {
      kind, w: ART_W, h: ART_H, sources: sources.length, lightsByCh, mediumMs, sourcesMs,
      full: summary(full), sky: summary(skyMs), lights: summary(lightsMs), quantize: summary(qMs), fullImage4ch: summary(img4),
      convergedIters: iters, twoIterDiffFrac: diff / ref.length, faceCells: L.faceList.length,
      movingLight: summary(per), movingLightBoxArea: summary(areas).mean, movingLightsTested: placed.length,
      // 4 channels x 16-bit light + medium + output. The sky flood streams its channel and the medium
      // 4 times (2 sweep pairs); stepping reads 4 channels and writes the output once.
      workingSetBytes: cells * (4 * 2 + 1) + ART_W * ART_H * 4,
      bytesSky: 4 * cells * (2 + 1 + 2),
      bytesQuantize: cells * 8 + ART_W * ART_H * 4,
      refHash: hashArr(ref),
    };
  },

  lightGPU({ variant = "jfa-half", kind = "realistic", simSteps = 300, reps = 2 } = {}) {
    const g = getGL();
    const { world, mat } = lightState(kind, simSteps);
    const sources = collectSources(world, mat);
    const lg = new LightGPU(g, variant);
    lg.upload(world, mat, sources); lg.run(); sync(g);
    const t0 = performance.now();
    for (let r = 0; r < reps; r++) { lg.upload(world, mat, sources); lg.run(); }
    sync(g);
    const swiftshaderMs = (performance.now() - t0) / reps;
    glStats.reset();
    lg.upload(world, mat, sources); lg.run();
    const counts = { draws: glStats.draws.length, passes: glStats.passes, uploadBytes: glStats.uploadBytes, bufferBytes: glStats.bufferBytes, frags: glStats.draws.reduce((a, d) => a + d.frags, 0) };
    const draws = glStats.draws.slice();
    // Fraction of 4x4 and 8x8 fragment groups (16 and 64 lanes) at the working resolution that hold
    // any open cell, i.e. that run the propagation shader's full path rather than its rock early-out.
    const S = lg.S, { view, w } = world;
    const isOpaque = (x, y) => { const m = mat[(Math.min(y, ART_H - 1) + view.y0) * w + Math.min(x, ART_W - 1) + view.x0]; return !(m === 0 || m === 3 || m === 4 || m === 5); };
    const openCell = new Uint8Array(lg.lw * lg.lh);
    for (let j = 0; j < lg.lh; j++) for (let i = 0; i < lg.lw; i++) {
      let op = 0;
      for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) op += isOpaque(i * S + a, j * S + b) ? 1 : 0;
      openCell[j * lg.lw + i] = op * 2 < S * S ? 1 : 0;
    }
    const openGroupFracByLanes = {};
    for (const gsz of [4, 8]) {
      let groups = 0, open = 0;
      for (let gy = 0; gy < lg.lh; gy += gsz) for (let gx = 0; gx < lg.lw; gx += gsz) {
        groups++;
        let any = 0;
        for (let j = gy; j < Math.min(lg.lh, gy + gsz); j++) for (let i = gx; i < Math.min(lg.lw, gx + gsz); i++) any |= openCell[j * lg.lw + i];
        open += any;
      }
      openGroupFracByLanes[gsz * gsz] = open / groups;
    }
    const openGroupFrac = openGroupFracByLanes[16];
    const out = lg.readOut();
    // Reference: the CPU flood run to convergence on the same input.
    const L = new LightCPU(ART_W, ART_H);
    L.setMedium(world, mat);
    for (let c = 0; c < 4; c++) L.flood(c, sources, 0);
    L.quantize();
    const ref = L.out;
    let differ = 0, absSum = 0, leak = 0, dark = 0, lit = 0;
    for (let i = 0; i < ref.length; i++) {
      const d = out[i] - ref[i];
      if (d !== 0) differ++;
      absSum += Math.abs(d);
      if (ref[i] > 0) lit++;
      if (ref[i] === 0 && out[i] > 0) leak++;
      if (ref[i] > 0 && out[i] === 0) dark++;
    }
    return {
      variant, ...VARIANTS[variant], workRes: [lg.lw, lg.lh], counts, draws, swiftshaderMs, openGroupFrac, openGroupFracByLanes,
      vsCPU: { differFrac: differ / ref.length, meanAbsLevels: absSum / ref.length, leakFrac: leak / ref.length, darkFracOfLit: dark / Math.max(1, lit) },
      outHash: hashArr(out),
    };
  },

  calib: ({ mb = 64 } = {}) => ({ mem: memoryBandwidth(mb), memSmall: memoryBandwidth(1, 20), drift: driftProbe() }),
  drift: () => driftProbe(),

  programs() {
    const out = [...SandGPU.programs()];
    for (const v of Object.keys(VARIANTS)) for (const p of LightGPU.programs(v)) out.push({ ...p, name: `${p.name}@${VARIANTS[v].scale}` });
    return out;
  },
};
window.benchReady = true;
