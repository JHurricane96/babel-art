import test from "node:test";
import assert from "node:assert/strict";
import { Flock, Platformer, level } from "../engine/entities.ts";
import { defaults } from "../scenes/registry.ts";
import { makeProject, validateProject } from "../shared/model.js";
test("a dispersed flock organizes into coherent groups", () => {
  const s = new Flock(42, {
    ...defaults("murmuration"),
    population: 120,
    predator: false,
  });
  const distance = () =>
    s.agents.reduce(
      (sum, a, i) =>
        sum +
        Math.min(
          ...s.agents
            .filter((_, j) => j !== i)
            .map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])),
        ),
      0,
    ) / s.agents.length;
  const start = distance();
  for (let i = 0; i < 1200; i++) s.step();
  assert.ok(distance() < start * 0.7);
});
test("landmark surveys happen once, survive saves and replay exactly", () => {
  const a = new Platformer(42, defaults("platformer"));
  for (let i = 0; i < 6000 && !a.visited; i++) a.step();
  assert.ok(a.visited);
  assert.ok(a.cooldown > 0);
  const p = makeProject();
  p.scene = { ...p.scene, id: "platformer", params: a.params, style: "pixel" };
  p.checkpoint = a.snapshot();
  p.time = a.tick / 60;
  const saved = validateProject(JSON.parse(JSON.stringify(p)));
  const b = new Platformer(42, a.params);
  b.restore(saved.checkpoint);
  for (let i = 0; i < 900; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test("old platform checkpoints retain their original terrain until the next expedition", () => {
  const s = new Platformer(42, {}),
    cp = s.snapshot();
  cp.data = cp.data.slice(0, 9);
  s.restore(cp);
  assert.deepEqual(s.platforms, level(42, true));
  assert.equal(s.snapshot().data[10], 0);
  for (let i = 0; i < 18000 && s.stage === 0; i++) s.step();
  assert.ok(s.stage > 0);
  assert.equal(s.terrainVersion, 1);
});
test("flock steering has inertia and remains finite across wrapped boundaries", () => {
  const s = new Flock(42, {
    ...defaults("murmuration"),
    variation: 0,
    predator: false,
    population: 20,
  });
  s.agents[0] = [0.999, 0.5, 0.12, 0];
  s.agents[1] = [0.001, 0.5, -0.12, 0];
  const before = s.agents.map((a) => Math.atan2(a[3], a[2]));
  s.step();
  s.agents.forEach((a, i) => {
    const d = Math.atan2(
      Math.sin(Math.atan2(a[3], a[2]) - before[i]),
      Math.cos(Math.atan2(a[3], a[2]) - before[i]),
    );
    assert.ok(Math.abs(d) <= 0.0750001);
    assert.ok(a.every(Number.isFinite));
  });
});
test("strong flock recovery renews every agent at populations divisible by thirteen", () => {
  const s = new Flock(42, { ...defaults("murmuration"), population: 260 });
  s.agents.forEach((a) => a.fill(NaN));
  assert.ok(Number.isNaN(s.activitySample()[0]));
  s.intervene({ kind: 3, x: 0.5, y: 0.5, serial: 1000001 });
  assert.ok(s.snapshot().data.every(Number.isFinite));
});
