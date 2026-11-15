import test from "node:test";
import assert from "node:assert/strict";
import { Murmuration, BIRD_STRIDE, attackAt } from "../engine/murmuration.ts";
import { Flock } from "../engine/entities.ts";
import { registry, defaults } from "../scenes/registry.ts";
import { makeProject, validateProject } from "../shared/model.js";

const params = (extra = {}) => ({ ...defaults("murmuration"), ...extra });

test("new murmuration recipes use the starling flock; revision 1 keeps the 2D flock", () => {
  assert.equal(defaults("murmuration").flockVersion, 2);
  const create = registry.murmuration.create;
  assert.ok(create(null, 3, params({ population: 60 })) instanceof Murmuration);
  assert.ok(
    create(null, 3, params({ population: 60, flockVersion: 1 })) instanceof
      Flock,
  );
});

test("starling flock replays exactly through checkpoints, escapes and attacks", () => {
  const a = new Murmuration(42, params({ population: 400 })),
    b = new Murmuration(42, params({ population: 400 }));
  // Run past the first falcon attack so escapes and the attack aim are live.
  for (let i = 0; i < 31 * 60; i++) a.step();
  b.restore(JSON.parse(JSON.stringify(a.snapshot())));
  a.intervene({ kind: 1, serial: 5, x: 0.3, y: 0.3 });
  b.intervene({ kind: 1, serial: 5, x: 0.3, y: 0.3 });
  for (let i = 0; i < 600; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test("starling flock stays finite, aloft and near the roost; groups break away and rejoin", () => {
  const sim = new Murmuration(9, params({ population: 1500 }));
  let samples = 0,
    aloft = 0,
    near = 0,
    checks = 0,
    whole = 0,
    largestSum = 0,
    worstGroup = 1;
  for (let i = 1; i <= 5 * 60 * 60; i++) {
    sim.step();
    if (i % 1200) continue;
    const b = sim.birds,
      n = b.length / BIRD_STRIDE;
    for (let at = 0; at < b.length; at += BIRD_STRIDE) {
      assert.ok(b.subarray(at, at + BIRD_STRIDE).every(Number.isFinite));
      samples++;
      if (b[at + 1] > 15 && b[at + 1] < 110) aloft++;
      if (Math.hypot(b[at], b[at + 2]) < 140) near++;
    }
    // Largest connected group in the nearest-neighbour graph.
    const parent = Int32Array.from({ length: n }, (_, i) => i),
      find = (x) => {
        while (parent[x] !== x) x = parent[x] = parent[parent[x]];
        return x;
      };
    for (let i = 0; i < n; i++)
      for (let k = 0; k < sim.counts[i]; k++)
        parent[find(i)] = find(sim.neighbours[i * 7 + k]);
    const sizes = new Map();
    for (let i = 0; i < n; i++)
      sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
    const largest = Math.max(...sizes.values()) / n;
    checks++;
    largestSum += largest;
    if (largest > 0.9) whole++;
    worstGroup = Math.min(worstGroup, largest);
  }
  assert.ok(aloft / samples > 0.97, "birds stay aloft: " + aloft / samples);
  assert.ok(
    near / samples > 0.97,
    "birds stay near the roost: " + near / samples,
  );
  // Breakaway groups are intended, but they return: the flock is whole most
  // of the time and never scatters.
  assert.ok(whole / checks > 0.6, "flock is usually whole: " + whole / checks);
  assert.ok(
    largestSum / checks > 0.85,
    "mean largest group: " + largestSum / checks,
  );
  assert.ok(worstGroup > 0.4, "never scatters: " + worstGroup);
});

test("falcon attacks follow the observed pattern: mostly from above", () => {
  let above = 0,
    total = 0;
  for (let seed = 1; seed <= 40; seed++)
    for (let t = 20; t < 400; t += 1) {
      const a = attackAt(t, seed);
      if (!a || Math.abs(t - a.time) > 0.5) continue;
      total++;
      if (a.direction[1] < -0.3) above++;
    }
  assert.ok(total > 100);
  assert.ok(
    above / total > 0.55 && above / total < 0.85,
    "share from above: " + above / total,
  );
});

test("projects migrate and validate flock revisions", () => {
  const legacy = makeProject();
  legacy.scene = {
    ...legacy.scene,
    id: "murmuration",
    style: "luminous",
    params: { population: 120, cohesion: 0.4, velocity: 0.12, predator: true },
  };
  const old = new Flock(1, { ...params(), flockVersion: 1, population: 120 });
  for (let i = 0; i < 30; i++) old.step();
  legacy.checkpoint = old.snapshot();
  legacy.time = old.tick / 60;
  const migrated = validateProject(legacy);
  assert.equal(migrated.scene.params.flockVersion, 1);
  assert.equal(migrated.checkpoint.data.length, 120 * 4);

  const current = makeProject();
  current.scene = {
    ...current.scene,
    id: "murmuration",
    style: "silhouette",
    params: params({ population: 120 }),
  };
  const sim = new Murmuration(1, current.scene.params);
  for (let i = 0; i < 30; i++) sim.step();
  current.checkpoint = sim.snapshot();
  current.time = sim.tick / 60;
  assert.equal(
    validateProject(current).checkpoint.data.length,
    120 * BIRD_STRIDE,
  );
  current.checkpoint = {
    ...current.checkpoint,
    data: current.checkpoint.data.slice(BIRD_STRIDE),
  };
  assert.throws(() => validateProject(current));
});
