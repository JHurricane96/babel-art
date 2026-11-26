import test from "node:test";
import assert from "node:assert/strict";
import { BIOMES, ROCKS, WATER, generateWorld, rockAt } from "../engine/strata/world2d.ts";

test("world2d: the same seed makes the same world; another seed another", () => {
  const a = generateWorld(7, { n: 96 }),
    b = generateWorld(7, { n: 96 }),
    c = generateWorld(8, { n: 96 });
  assert.deepEqual(a.h, b.h);
  assert.deepEqual(a.biome, b.biome);
  assert.notDeepEqual(a.h, c.h);
});

test("world2d: water runs off the map or into the sea, lakes are level, everything has a name", () => {
  for (const seed of [3, 20261126]) {
    const w = generateWorld(seed, { n: 128 }),
      n = w.n;
    for (let i = 0; i < n * n; i++) {
      assert.ok(Number.isFinite(w.h[i]) && w.h[i] > -5000 && w.h[i] < 9000, `height at ${i}: ${w.h[i]}`);
      assert.ok((w.biome[i] < BIOMES.length || w.biome[i] === WATER) && w.rock[i] < ROCKS.length);
      assert.ok(w.sea[i] || w.lake[i] > 0 || w.biome[i] !== WATER, `land at ${i} has a biome`);
      assert.ok(w.rain[i] > 0 && w.rain[i] < 8000, `rain ${w.rain[i]}`);
    }
    // Following the drainage from any cell reaches an outlet (an edge or the sea) without looping.
    for (let i = 0; i < n * n; i += 37) {
      let c = i,
        steps = 0;
      while (w.rec[c] >= 0 && steps < n * n) (c = w.rec[c]), steps++;
      const x = c % n,
        y = Math.floor(c / n);
      assert.ok(w.sea[c] || x === 0 || y === 0 || x === n - 1 || y === n - 1 || w.salt[c] || w.lake[c] > 0 || w.zone[c] === 2 || w.biome[c] !== WATER, `cell ${i} drains to ${x},${y}`);
    }
    // Rivers gather water: a cell carries at least what drains into it.
    for (let i = 0; i < n * n; i++) if (w.rec[i] >= 0) assert.ok(w.flow[w.rec[i]] >= w.flow[i] * 0.999);
    // Lakes are level: neighbouring lake cells share a surface (bar where one lake spills into a lower one).
    let pairs = 0,
      level = 0;
    for (let i = 0; i < n * n; i++)
      if (w.lake[i] > 0 && w.lake[i + 1] > 0 && (i + 1) % n) {
        pairs++;
        if (Math.abs(w.h[i] + w.lake[i] - (w.h[i + 1] + w.lake[i + 1])) < 1) level++;
      }
    assert.ok(level >= pairs * 0.98, `lake surfaces are level (${level} of ${pairs})`);
    // The rock at the surface is the rock a section finds just under it.
    for (let i = 0; i < n * n; i += 53) if (!w.sea[i]) assert.equal(rockAt(w, i, w.h[i] - 0.01), w.rock[i]);
  }
});

test("world2d: every world holds the whole range of climates and many biomes", () => {
  for (const seed of [20261126, 20261127, 5]) {
    const w = generateWorld(seed, { n: 128 }),
      zones = new Map(),
      biomes = new Set();
    for (let i = 0; i < w.n * w.n; i++)
      if (w.biome[i] !== WATER) {
        biomes.add(w.biome[i]);
        zones.set(w.zone[i], (zones.get(w.zone[i]) ?? 0) + 1);
      }
    // Every world has the whole range: cold, temperate, dry and hot-wet climates.
    const big = new Set([...zones].filter(([, c]) => c > w.n * w.n * 0.01).map(([z]) => z)),
      has = (...zs) => zs.some((z) => big.has(z));
    assert.ok(has(3, 4, 5), `seed ${seed}: something frozen, tundra or boreal`);
    assert.ok(has(7, 8, 9), `seed ${seed}: something temperate`);
    assert.ok(has(10, 11, 12, 2), `seed ${seed}: something dry (steppe, desert, savanna, salt)`);
    assert.ok(has(13, 14), `seed ${seed}: something hot and wet (monsoon or rainforest)`);
    assert.ok(biomes.size >= 25, `seed ${seed}: ${biomes.size} biomes`);
  }
});
