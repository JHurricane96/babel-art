// World history (engine/strata/history.ts): determinism, sanity of the rock
// record and the climate, and the time budget.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BIOME,
  CELL,
  ERAS,
  ROCKS,
  SEA_ROW,
  rainfall,
  simulateWorld,
} from "../engine/strata/history.ts";
import { REGION_W, WORLD_H } from "../engine/strata/world.ts";

const worlds = new Map();
const world = (seed) => {
  if (!worlds.has(seed)) worlds.set(seed, simulateWorld(seed));
  return worlds.get(seed);
};

test("the same seed gives the same world", () => {
  const a = world(3),
    b = simulateWorld(3);
  assert.deepEqual(a.surface, b.surface);
  assert.deepEqual(a.kinds, b.kinds);
  assert.deepEqual(a.tops, b.tops);
  assert.deepEqual(a.biome, b.biome);
  assert.notDeepEqual(world(4).surface, a.surface);
});

test("a world is finite, with ocean at both ends", () => {
  for (const seed of [1, 2, 3]) {
    const w = world(seed);
    assert.equal(w.n, (200 * REGION_W) / CELL);
    assert.equal(w.biome[0], BIOME.OCEAN, `seed ${seed}: left end`);
    assert.equal(w.biome[w.n - 1], BIOME.OCEAN, `seed ${seed}: right end`);
    assert.equal(w.sea[ERAS - 1], 0);
  }
});

test("rock stacks are ordered and the land stays inside the world", () => {
  for (const seed of [1, 2, 3]) {
    const w = world(seed);
    for (let c = 0; c < w.n; c++) {
      let h = w.b[c];
      for (let k = w.offsets[c]; k < w.offsets[c + 1]; k++) {
        assert.ok(
          w.tops[k] >= h - 1e-3,
          `seed ${seed} column ${c}: layer ${k} below the one under it`,
        );
        assert.ok(w.kinds[k] < ROCKS.length);
        h = w.tops[k];
      }
      assert.ok(Math.abs(h - w.surface[c]) < 1e-3);
      const row = SEA_ROW - w.surface[c];
      assert.ok(
        row > 0 && row < WORLD_H,
        `seed ${seed} column ${c}: ground at row ${row.toFixed(0)}`,
      );
    }
  }
});

test("climate makes a varied world, not one biome", () => {
  for (const seed of [1, 2, 3, 4]) {
    const w = world(seed),
      count = new Map();
    let land = 0;
    for (let c = 0; c < w.n; c++)
      if (w.biome[c] !== BIOME.OCEAN) {
        land++;
        count.set(w.biome[c], (count.get(w.biome[c]) ?? 0) + 1);
      }
    const top = Math.max(...count.values());
    assert.ok(
      top / land < 0.6,
      `seed ${seed}: one biome covers ${((100 * top) / land).toFixed(0)}% of the land`,
    );
    assert.ok(count.size >= 4, `seed ${seed}: only ${count.size} biomes`);
  }
});

test("mountains are colder than the plains either side", () => {
  let ranges = 0,
    colder = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const w = world(seed);
    for (const ev of w.events) {
      if (ev.kind !== "range") continue;
      const c = Math.round(ev.c),
        half = Math.round(ev.w / 2),
        a = Math.max(0, c - half - 20),
        b = Math.min(w.n - 1, c + half + 20);
      if (w.wet[a] || w.wet[b]) continue;
      ranges++;
      const peak = Math.max(...w.surface.slice(c - half, c + half)),
        at = w.surface.indexOf(peak);
      if (w.T[at] < Math.min(w.T[a], w.T[b])) colder++;
    }
  }
  assert.ok(ranges >= 3, `only ${ranges} ranges to check`);
  assert.equal(colder, ranges);
});

test("a mountain catches rain on its windward side and casts a rain shadow", () => {
  // Flat land with one mountain in the middle, at the same warmth and
  // background moisture everywhere, the wind always from the left.
  const n = 600,
    W = new Float32Array(n),
    wet = new Uint8Array(n),
    Tsea = new Float32Array(n).fill(15),
    Mb = new Float32Array(n).fill(0.8),
    P = new Float32Array(n);
  for (let i = 0; i < n; i++)
    W[i] = 50 + 450 * Math.exp(-(((i - 300) / 40) ** 2));
  rainfall(P, W, wet, Tsea, Mb, 1);
  const mean = (a, b) => P.slice(a, b).reduce((s, v) => s + v, 0) / (b - a);
  const plain = mean(100, 180),
    windward = mean(240, 290),
    lee = mean(340, 420);
  assert.ok(
    windward > 1.12 * plain,
    `windward slope ${windward.toFixed(0)} vs plain ${plain.toFixed(0)}`,
  );
  assert.ok(
    lee < 0.6 * plain,
    `lee ${lee.toFixed(0)} vs plain ${plain.toFixed(0)}`,
  );
  // The other way round when the wind blows from the right.
  rainfall(P, W, wet, Tsea, Mb, 0);
  assert.ok(
    mean(310, 360) > 1.12 * mean(420, 500) &&
      mean(180, 260) < 0.6 * mean(420, 500),
  );
});

test("history keeps a record and the layers remember the eras", () => {
  const w = world(2);
  let young = 0;
  for (let k = 0; k < w.ages.length; k++) if (w.ages[k] > ERAS / 2) young++;
  assert.ok(
    young > 0,
    "some layers were laid down in the second half of history",
  );
  const h = simulateWorld(2, { record: true }).history;
  assert.equal(h.length, ERAS);
});

test("a world's history takes under three seconds", () => {
  const t0 = performance.now();
  simulateWorld(9);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
});
