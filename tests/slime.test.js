import test from "node:test";
import assert from "node:assert/strict";
import {
  SlimeNetworks,
  SLIME_PRESETS,
  SLIME_CELLS,
  slimeResources,
} from "../engine/slime.ts";
import { defaults } from "../scenes/registry.ts";
import { makeProject, validateProject } from "../shared/model.js";
import { AdaptiveQuality } from "../engine/quality.ts";

test("agents keep following a stronger forward trail instead of turning toward a weaker side", () => {
  const s = new SlimeNetworks(42, { ...defaults("slime"), population: 600 });
  s.trail.fill(0); s.nutrients.fill(0);
  s.nutrientTick = 0; s.nutrientVariation = 0.65;
  for (let i = 0; i < s.agents.length; i += 3) {
    s.agents[i] = 0.5; s.agents[i + 1] = 0.5; s.agents[i + 2] = 0;
  }
  s.trail[60 * 192 + 102] = 1;
  s.trail[55 * 192 + 99] = 0.7;
  s.trail[64 * 192 + 99] = 0.2;
  s.step();
  const heading = s.agents[2];
  assert.ok(Math.min(heading, Math.PI * 2 - heading) < 0.06);
});

test("network checkpoint includes trails and agents and replays odd/even diffusion ticks", () => {
  for (const tick of [121, 150]) {
    const a = new SlimeNetworks(42, { ...defaults("slime"), population: 600 });
    for (let i = 0; i < tick; i++) a.step();
    const p = makeProject();
    p.scene = { ...p.scene, id: "slime", style: "luminous", params: a.params };
    p.time = tick / 60;
    p.checkpoint = a.snapshot();
    const imported = validateProject(JSON.parse(JSON.stringify(p)));
    const b = new SlimeNetworks(42, imported.scene.params);
    b.restore(imported.checkpoint);
    for (let i = 0; i < 80; i++) {
      a.step();
      b.step();
    }
    assert.deepEqual(a.snapshot(), b.snapshot());
    const invalid = structuredClone(p);
    invalid.checkpoint.data[SLIME_CELLS + 2] = 7;
    assert.throws(() => validateProject(invalid));
    invalid.checkpoint.data[SLIME_CELLS + 2] = 1;
    invalid.checkpoint.data[3] = -1;
    assert.throws(() => validateProject(invalid));
  }
});

test("actual network presets keep moving with finite contrast across a seed batch", () => {
  for (const seed of [7, 1337])
    for (const preset of Object.values(SLIME_PRESETS)) {
      const s = new SlimeNetworks(seed, {
        ...defaults("slime"),
        ...preset.params,
        population: 600,
      });
      for (let i = 0; i < 1200; i++) s.step();
      const before = new Float32Array(s.trail);
      for (let i = 0; i < 1500; i++) s.step();
      const state = s.snapshot().data;
      assert.equal(state.length, SLIME_CELLS + 1800);
      assert.ok(state.every(Number.isFinite));
      assert.ok(s.trail.every((v) => v >= 0 && v <= 1));
      const mean = s.trail.reduce((a, b) => a + b, 0) / SLIME_CELLS;
      const contrast = Math.sqrt(
        s.trail.reduce((a, b) => a + (b - mean) ** 2, 0) / SLIME_CELLS,
      );
      const change =
        s.trail.reduce((a, b, i) => a + Math.abs(b - before[i]), 0) /
        SLIME_CELLS;
      assert.ok(
        mean > 0.005 && mean < 0.95 && contrast > 0.01 && change > 0.005,
        `${preset.name}/${seed}: ${JSON.stringify({ mean, contrast, change })}`,
      );
    }
});

test("network invalid state is detected and strong recovery repairs field and all agents", () => {
  const s = new SlimeNetworks(42, defaults("slime"));
  s.trail[17] = NaN;
  s.agents.fill(NaN);
  assert.ok(Number.isNaN(s.activitySample()[0]));
  const event = { kind: 3, x: 0.4, y: 0.6, serial: 1000001 };
  s.intervene(event);
  for (let i = 0; i < 120; i++) s.step();
  assert.ok(s.snapshot().data.every(Number.isFinite));
  assert.ok(s.trail.some((v) => v > 0.1));
});

test("nutrient pools renew and move deterministically, and freeze at zero variation", () => {
  const a = slimeResources(0, 42, 0.65),
    b = slimeResources(3600, 42, 0.65);
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, slimeResources(0, 42, 0.65));
  assert.deepEqual(slimeResources(0, 42, 0), slimeResources(3600, 42, 0));
  assert.ok(
    b.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1 && s.power > 0),
  );
});

test("adaptive quality drops promptly, recovers slowly, and stays bounded", () => {
  const q = new AdaptiveQuality();
  for (let i = 0; i < 15 * 12; i++) q.observe(1 / 15, true);
  assert.equal(q.scale, 0.5);
  for (let i = 0; i < 60 * 8; i++) q.observe(1 / 60, true);
  assert.equal(q.scale, 0.5, "short fast bursts must not increase resolution");
  for (let i = 0; i < 60 * 130; i++) q.observe(1 / 60, true);
  assert.equal(q.scale, 1.5);
  q.reset();
  for (let i = 0; i < 20; i++) q.observe(0.8, true);
  assert.ok(
    q.scale < 1,
    "sustained very slow rendering must still lower quality",
  );
});

test("pauses, hidden tabs, and replay gaps do not drive adaptive quality", () => {
  const q = new AdaptiveQuality();
  for (let i = 0; i < 100; i++) q.observe(0.2, false);
  assert.equal(q.scale, 1);
  q.observe(10, true);
  assert.equal(q.scale, 1);
  q.observe(0.016, true);
  assert.equal(q.scale, 1);
});
