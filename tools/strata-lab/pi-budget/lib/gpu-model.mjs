// Raspberry Pi 5 (VideoCore VII) GPU cost model. There is no GPU in the benchmark container, so GPU
// time is estimated from what each draw asks for (counted by web/gl-count.js, with static shader op
// counts from lib/shader-cost.mjs), against limits derived from published VideoCore figures:
//   shader ALU   12 QPUs x 4 lanes x 800 MHz = 38.4 G lane-ops/s peak (76.8 GFLOPS counting add+mul)
//   texture      3-6 texels/clock (assumption: no published VideoCore VII texture rate)
//   fill         2-4 pixels/clock written (assumption: no published VideoCore VII fill rate)
//   memory       4-8 GB/s for the GPU out of LPDDR4X-4267 (17 GB/s theoretical, 14-15 GB/s measured CPU
//                streaming read, 5-6 GB/s memcpy), shared with the CPU, Chromium's compositor and the
//                scanout of four 1080p screens (about 2 GB/s on its own)
// Each draw costs the slowest of these (optimistic) or the sum of the two slowest (pessimistic), plus
// a fixed cost per render pass: on a tile-based GPU every framebuffer change is a full binning and
// tile load/store cycle. None of this uses SwiftShader timings, which say nothing about a real GPU.

export const SCENARIOS = {
  low: {
    label: "optimistic", clock: 800e6, qpus: 12, lanes: 4, aluEff: 0.7, dualIssue: 1.3, pathFrac: 0.75,
    texelsPerClock: 6, tmuEff: 0.8, wideTexelCost: 1, pixelsPerClock: 4, bwGBs: 8, readReuse: 1.0, farTapPenalty: 0,
    passMs: 0.02, drawCpuMs: 0.005, uploadCopies: 2, memcpyGBs: 6.0,
  },
  high: {
    label: "pessimistic", clock: 800e6, qpus: 12, lanes: 4, aluEff: 0.4, dualIssue: 1.0, pathFrac: 1.0,
    texelsPerClock: 3, tmuEff: 0.5, wideTexelCost: 2, pixelsPerClock: 2, bwGBs: 4, readReuse: 1.25, farTapPenalty: 1,
    passMs: 0.1, drawCpuMs: 0.02, uploadCopies: 3, memcpyGBs: 5.2,
  },
};

// One draw: F fragments of a program with static costs `prog` ({full, trivial}); `active` is the
// fraction of 16-fragment groups that take the full path (the rest take the early-out).
export function drawTime(draw, prog, active, sc) {
  const F = draw.frags, tag = draw.tag, full = prog.full, triv = prog.trivial || prog.full;
  const a = active ?? 1;
  const ops = a * full.ops * sc.pathFrac + (1 - a) * triv.ops;
  const fetches = a * full.fetches + (1 - a) * triv.fetches;
  const tAlu = (F * ops) / (sc.qpus * sc.lanes * sc.clock * sc.aluEff * sc.dualIssue);
  const tTmu = (F * fetches * (tag.fetchBytes > 4 ? sc.wideTexelCost : 1)) / (sc.texelsPerClock * sc.clock * sc.tmuEff);
  const readB = F * tag.uniqueReadBytes * (sc.readReuse + sc.farTapPenalty * (tag.farTaps || 0));
  const writeB = F * tag.writeBytes;
  const tBw = (readB + writeB) / (sc.bwGBs * 1e9);
  const tFill = (F * (tag.writeBytes > 4 ? 2 : 1)) / (sc.pixelsPerClock * sc.clock);
  const parts = { alu: tAlu, tex: tTmu, mem: tBw, fill: tFill };
  const sorted = Object.values(parts).sort((x, y) => y - x);
  const t = sc === SCENARIOS.high ? sorted[0] + sorted[1] : sorted[0];
  const limit = Object.entries(parts).sort((x, y) => y[1] - x[1])[0][0];
  return { ms: t * 1e3, limit, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v * 1e3])), bytes: readB + writeB };
}

// A whole workload (one step or update): draws, passes, uploads. `costs` maps a program key to its
// static cost; `key(draw)` gives that key; `active(draw)` the full-path fraction.
export function estimate({ draws, passes, uploadBytes = 0 }, costs, key, active) {
  const out = {};
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    let gpu = passes * sc.passMs, bytes = 0;
    const byProg = {};
    for (const d of draws) {
      const c = costs[key(d)];
      if (!c) throw new Error("no shader cost for " + key(d));
      const r = drawTime(d, c, active(d), sc);
      gpu += r.ms; bytes += r.bytes;
      const b = (byProg[d.tag.prog] ||= { ms: 0, draws: 0, limits: {} });
      b.ms += r.ms; b.draws++; b.limits[r.limit] = (b.limits[r.limit] || 0) + 1;
    }
    out[name] = {
      gpuMs: gpu, gpuBytes: bytes, byProg,
      cpuSubmitMs: draws.length * sc.drawCpuMs,
      uploadCpuMs: (uploadBytes * sc.uploadCopies) / (sc.memcpyGBs * 1e9) * 1e3,
    };
  }
  out.centralGpuMs = Math.sqrt(out.low.gpuMs * out.high.gpuMs); // geometric mean of the bounds
  return out;
}

// Context: what presenting the wall costs on its own, independent of the spikes. Hypothetical shaders
// with assumed op counts, so treat these as orders of magnitude.
const SCREEN = 4 * 1920 * 1080, ART = 991 * 648;
const ctxDraw = (frags, ops, fetches, uniqueReadBytes, writeBytes = 4) => ({
  draw: { frags, tag: { prog: "context", fetchBytes: 4, uniqueReadBytes, writeBytes, farTaps: 0 } },
  prog: { full: { ops, fetches }, trivial: null },
});
export const PRESENT_CONTEXT = [
  { name: "lit composite shaded per screen pixel, 4 x 1920x1080 (40 ops, 2 fetches)", draws: [ctxDraw(SCREEN, 40, 2, 8 / 16)] },
  { name: "lit composite at art resolution (40 ops) + nearest upscale to 4 x 1920x1080 (12 ops)", draws: [ctxDraw(ART, 40, 2, 8), ctxDraw(SCREEN, 12, 1, 4 / 16)] },
  { name: "browser compositor drawing a full-resolution canvas to the screens (15 ops)", draws: [ctxDraw(SCREEN, 15, 1, 4)] },
];

export function presentContext() {
  const t = (c, sc) => c.draws.reduce((a, d) => a + drawTime(d.draw, d.prog, 1, sc).ms + sc.passMs, 0);
  return PRESENT_CONTEXT.map((c) => ({ name: c.name, low: t(c, SCENARIOS.low), high: t(c, SCENARIOS.high) }));
}

// Sanity check against glmark2 (score ~190 at 1920x1080 on a Pi 5, i.e. ~5.3 ms per frame averaged
// over its scenes): one full-screen 1080p draw with a 60-op shader and 2 fetches, plus its pass.
export function glmarkCheck() {
  const c = { draws: [ctxDraw(1920 * 1080, 60, 2, 2)] };
  const t = (sc) => c.draws.reduce((a, d) => a + drawTime(d.draw, d.prog, 1, sc).ms + sc.passMs, 0);
  return { modelLow: t(SCENARIOS.low), modelHigh: t(SCENARIOS.high), glmark2FrameMs: 1000 / 190 };
}
