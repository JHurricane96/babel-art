import test from "node:test";
import assert from "node:assert/strict";
import { ParticleRivers, PARTICLE_STRIDE } from "../engine/particles.ts";
import { choreography } from "../engine/choreography.ts";
import { defaults } from "../scenes/registry.ts";
import { makeProject, validateProject, PALETTES } from "../shared/model.js";
import { applyCommand } from "../engine/commands.ts";

test("particle trails survive checkpoint, project import, and exact replay", () => {
  const a = new ParticleRivers(42, defaults("rivers"));
  for (let i = 0; i < 730; i++) a.step();
  const p = makeProject();
  p.scene = {
    ...p.scene,
    id: "rivers",
    style: "silk",
    params: defaults("rivers"),
  };
  p.checkpoint = a.snapshot();
  p.time = a.tick / 60;
  const imported = validateProject(JSON.parse(JSON.stringify(p)));
  const b = new ParticleRivers(42, imported.scene.params);
  b.restore(imported.checkpoint);
  for (let i = 0; i < 120; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const bad = structuredClone(p);
  bad.checkpoint.data[0] = 2;
  assert.throws(() => validateProject(bad));
  bad.checkpoint = { tick: 1, data: [0, 0] };
  assert.throws(() => validateProject(bad));
});

test("actual particle simulation stays bounded and moving across seeds and flow extremes", () => {
  for (const [seed, turbulence, velocity] of [
    [0, 0.5, 0.04],
    [42, 2, 0.3],
    [1337, 1.1, 0.14],
  ]) {
    const river = new ParticleRivers(seed, {
      ...defaults("rivers"),
      population: 240,
      turbulence,
      velocity,
    });
    const start = river.snapshot().data;
    for (let i = 0; i < 18000; i++) river.step();
    const end = river.snapshot().data;
    assert.equal(end.length, 240 * PARTICLE_STRIDE);
    // Edge revision 2 lets trails flow up to 0.35 off the wall before wrapping.
    assert.ok(end.every((v) => Number.isFinite(v) && v >= -0.35 && v <= 1.35));
    assert.ok(end.some((v, i) => Math.abs(v - start[i]) > 0.1));
    const before = [...river.points];
    for (let i = 0; i < 60; i++) river.step();
    assert.ok(river.points.some((v, i) => Math.abs(v - before[i]) > 0.01));
  }
});

test("strong particle recovery replaces every invalid point even at population divisible by 17", () => {
  const river = new ParticleRivers(7, {
    ...defaults("rivers"),
    population: 1020,
  });
  river.points.fill(NaN);
  assert.ok(Number.isNaN(river.activitySample()[0]));
  river.intervene({ kind: 3, x: 0.5, y: 0.5, serial: 1000001 });
  assert.ok(river.points.every((v) => Number.isFinite(v) && v >= 0 && v < 1));
});

test("chapter transitions are continuous, normalized, and repeatable", () => {
  for (const seed of [0, 42, 4294967295])
    for (let t = 0; t < 600; t += 0.7) {
      const a = choreography(t, seed),
        b = choreography(t + 0.01, seed);
      assert.ok(Math.abs(Object.values(a).reduce((x, y) => x + y) - 1) < 1e-12);
      assert.ok(
        Object.keys(a).every((key) => Math.abs(a[key] - b[key]) < 0.001),
      );
      assert.deepEqual(a, choreography(t, seed));
    }
});

test("all palettes work through both commands and saved projects", () => {
  for (const palette of Object.keys(PALETTES)) {
    const p = makeProject();
    applyCommand(p, { type: "palette", value: palette });
    assert.equal(validateProject(p).scene.palette, palette);
  }
  assert.throws(() =>
    applyCommand(makeProject(), { type: "palette", value: "__proto__" }),
  );
});

test("gliding silk river tails slide smoothly instead of stepping every sixth tick", async () => {
  const { riverTailExtent } = await import("../engine/gpu-art.ts");
  const sim = new ParticleRivers(42, defaults("rivers"));
  for (let i = 0; i < 600; i++) sim.step();
  const n = sim.points.length / PARTICLE_STRIDE,
    T = PARTICLE_STRIDE - 2;
  const tails = (extent) => {
    const out = new Float64Array(n * 2);
    for (let i = 0, k = 0; i < sim.points.length; i += PARTICLE_STRIDE, k++) {
      const x5 = sim.points[i + T - 2], y5 = sim.points[i + T - 1];
      out[k * 2] = x5 + (sim.points[i + T] - x5) * extent;
      out[k * 2 + 1] = y5 + (sim.points[i + T + 1] - y5) * extent;
    }
    return out;
  };
  const ratio = (useExtent) => {
    const worst = [];
    let prev = tails(useExtent ? riverTailExtent(sim.tick) : 1);
    const moves = Array.from({ length: n }, () => []);
    const saved = sim.snapshot();
    for (let t = 0; t < 36; t++) {
      sim.step();
      const now = tails(useExtent ? riverTailExtent(sim.tick) : 1);
      for (let k = 0; k < n; k++) moves[k].push(Math.hypot(now[k * 2] - prev[k * 2], now[k * 2 + 1] - prev[k * 2 + 1]));
      prev = now;
    }
    sim.restore(saved);
    for (const m of moves) {
      // Skip trails that were re-emitted elsewhere during the window.
      if (Math.max(...m) > 0.05) continue;
      const mean = m.reduce((a, b) => a + b, 0) / m.length;
      if (mean > 1e-4) worst.push(Math.max(...m) / mean);
    }
    worst.sort((a, b) => a - b);
    return worst[Math.floor(worst.length / 2)];
  };
  const jumping = ratio(false),
    sliding = ratio(true);
  // A tail that only moves every sixth tick has its largest step about six
  // times its average step; a sliding tail stays close to its average.
  assert.ok(jumping > 4, `stored tails should jump (ratio ${jumping})`);
  assert.ok(sliding < 2, `drawn tails should slide (ratio ${sliding})`);
});

test("river particles leave the wall fully before wrapping (edge revision 2)", async () => {
  const { RIVER_EDGE_MARGIN } = await import("../engine/particles.ts");
  const { riverTailExtent } = await import("../engine/gpu-art.ts");
  // A drawn point lights pixels up to its glow's half-width beyond it: about
  // 0.005 of the wall's width and 0.007 of its height. The simulation waits
  // for a wider margin before wrapping.
  const reach = 0.009;
  assert.ok(RIVER_EDGE_MARGIN > reach);
  const visible = (x, y) => x >= -reach && x <= 1 + reach && y >= -reach && y <= 1 + reach;
  const run = (edgeVersion) => {
    const sim = new ParticleRivers(42, { ...defaults("rivers"), edgeVersion });
    const count = sim.points.length / PARTICLE_STRIDE,
      emission = Math.ceil(count / 720);
    let cutVisible = 0, exits = 0;
    for (let t = 0; t < 1800; t++) {
      const before = sim.points.slice();
      sim.step();
      const emitted = new Set();
      for (let i = 0; i < emission; i++) emitted.add((sim.tick * emission + i) % count);
      for (let k = 0; k < count; k++) {
        const at = k * PARTICLE_STRIDE;
        // A relocation collapses the whole trail onto one point.
        const collapsed = sim.points[at + PARTICLE_STRIDE - 2] === sim.points[at] && sim.points[at + PARTICLE_STRIDE - 1] === sim.points[at + 1];
        const moved = Math.hypot(sim.points[at] - before[at], sim.points[at + 1] - before[at + 1]) > 0.05;
        if (!collapsed || !moved || emitted.has(k)) continue;
        exits++;
        // The trail as gliding silk drew it on the previous tick.
        let shown = false;
        for (let j = 0; j < PARTICLE_STRIDE - 2; j += 2) shown ||= visible(before[at + j], before[at + j + 1]);
        const e = riverTailExtent(sim.tick - 1), T = at + PARTICLE_STRIDE - 4;
        shown ||= visible(before[T] + (before[T + 2] - before[T]) * e, before[T + 1] + (before[T + 3] - before[T + 1]) * e);
        if (shown) cutVisible++;
      }
    }
    return { exits, cutVisible, sim };
  };
  const old = run(1), now = run(2);
  assert.ok(old.exits > 50 && old.cutVisible > old.exits * 0.9, "revision 1 cuts trails off at the edge");
  assert.ok(now.exits > 50, `particles still recirculate through the edges (${now.exits})`);
  assert.equal(now.cutVisible, 0, "revision 2 never removes a trail that is still on the wall");
  assert.ok(now.sim.points.every((v) => v > -0.35 && v < 1.35));
});

test("saved rivers projects without an edge revision keep the original edges", () => {
  const p = makeProject();
  p.scene.id = "rivers";
  p.scene.style = "silk";
  p.scene.params = { population: 960, velocity: 0.14, turbulence: 1.1 };
  assert.equal(validateProject(p).scene.params.edgeVersion, 1);
  assert.equal(defaults("rivers").edgeVersion, 2);
});
