// GPU cost model for a target machine (lib/pi5.mjs, lib/ryzen780m.mjs). There is no GPU in the
// benchmark container, so GPU time is estimated from what each draw asks for (counted by
// web/gl-count.js, with static shader op counts from lib/shader-cost.mjs), against the target's limits
// (`SCENARIOS`: peak lane-ops/s, texels/s, pixels/s, memory bandwidth, efficiencies, per-pass and
// per-draw costs, each with an optimistic and a pessimistic value). Each draw costs the slowest of ALU,
// texture, memory and fill (optimistic) or the sum of the two slowest (pessimistic), plus a fixed cost
// per render pass. None of this uses SwiftShader timings, which say nothing about a real GPU.

// One draw: F fragments of a program with static costs `prog` ({full, trivial}); `active` is the
// fraction of fragment groups (the target's GROUP_LANES) that take the full path, the rest the early-out.
export function drawTime(draw, prog, active, sc, pessimistic = false) {
  const F = draw.frags, tag = draw.tag, full = prog.full, triv = prog.trivial || prog.full;
  const a = active ?? 1;
  const ops = a * full.ops * sc.pathFrac + (1 - a) * triv.ops;
  const fetches = a * full.fetches + (1 - a) * triv.fetches;
  const tAlu = (F * ops) / (sc.aluPeak * sc.aluEff * sc.dualIssue);
  const tTmu = (F * fetches * (tag.fetchBytes > 4 ? sc.wideTexelCost : 1)) / (sc.texPeak * sc.tmuEff);
  const readB = F * tag.uniqueReadBytes * (sc.readReuse + sc.farTapPenalty * (tag.farTaps || 0));
  const writeB = F * tag.writeBytes;
  const tBw = (readB + writeB) / (sc.bwGBs * 1e9);
  const tFill = (F * (tag.writeBytes > 4 ? 2 : 1)) / sc.fillPeak;
  const parts = { alu: tAlu, tex: tTmu, mem: tBw, fill: tFill };
  const sorted = Object.values(parts).sort((x, y) => y - x);
  const t = pessimistic ? sorted[0] + sorted[1] : sorted[0];
  const limit = Object.entries(parts).sort((x, y) => y[1] - x[1])[0][0];
  return { ms: t * 1e3, limit, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v * 1e3])), bytes: readB + writeB };
}

// A whole workload (one step or update): draws, passes, uploads. `costs` maps a program key to its
// static cost; `key(draw)` gives that key; `active(draw)` the full-path fraction.
export function estimate({ draws, passes, uploadBytes = 0 }, costs, key, active, target) {
  const out = {};
  for (const [name, sc] of Object.entries(target.SCENARIOS)) {
    let gpu = passes * sc.passMs, bytes = 0;
    const byProg = {};
    for (const d of draws) {
      const c = costs[key(d)];
      if (!c) throw new Error("no shader cost for " + key(d));
      const r = drawTime(d, c, active(d), sc, name === "high");
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
const ctxDraw = ({ frags, ops, fetches, uniqueReadBytes, writeBytes = 4 }) => ({
  draw: { frags, tag: { prog: "context", fetchBytes: 4, uniqueReadBytes, writeBytes, farTaps: 0 } },
  prog: { full: { ops, fetches }, trivial: null },
});
const timeOf = (draws, sc, pessimistic) => draws.reduce((a, d) => { const c = ctxDraw(d); return a + drawTime(c.draw, c.prog, 1, sc, pessimistic).ms + sc.passMs; }, 0);

// Context: what presenting the wall costs on its own (four 1080p screens), independent of the spikes.
// Hypothetical shaders with assumed op counts, so treat these as orders of magnitude.
export const PRESENT_CONTEXT = [
  { name: "lit composite shaded per screen pixel, 4 x 1920x1080 (40 ops, 2 fetches)", draws: [{ frags: SCREEN, ops: 40, fetches: 2, uniqueReadBytes: 8 / 16 }] },
  { name: "lit composite at art resolution (40 ops) + nearest upscale to 4 x 1920x1080 (12 ops)", draws: [{ frags: ART, ops: 40, fetches: 2, uniqueReadBytes: 8 }, { frags: SCREEN, ops: 12, fetches: 1, uniqueReadBytes: 4 / 16 }] },
  { name: "browser compositor drawing a full-resolution canvas to the screens (15 ops)", draws: [{ frags: SCREEN, ops: 15, fetches: 1, uniqueReadBytes: 4 }] },
];

export function presentContext(target) {
  const S = target.SCENARIOS;
  return PRESENT_CONTEXT.map((c) => ({ name: c.name, low: timeOf(c.draws, S.low, false), high: timeOf(c.draws, S.high, true) }));
}

// The model against the target's published GPU results (`SANITY`): each is a set of draws plus an
// optional fixed per-frame cost (baselineMs), compared with a measured frame time.
export function sanityChecks(target) {
  const S = target.SCENARIOS;
  return (target.SANITY || []).map((c) => ({
    name: c.name, url: c.url, seen: c.seen, measuredMs: c.measuredMs,
    modelLow: (c.baselineMs || 0) + timeOf(c.draws, S.low, false), modelHigh: (c.baselineMs || 0) + timeOf(c.draws, S.high, true),
  }));
}
