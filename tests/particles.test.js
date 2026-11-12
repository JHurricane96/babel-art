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
    assert.ok(end.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
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
