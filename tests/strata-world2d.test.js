import test from "node:test";
import assert from "node:assert/strict";
import { BIOMES, ROCKS, generateWorld, rockAt } from "../engine/strata/world2d.ts";

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
      assert.ok(w.biome[i] < BIOMES.length && w.rock[i] < ROCKS.length);
      assert.ok(w.rain[i] > 0 && w.rain[i] < 6000, `rain ${w.rain[i]}`);
    }
    // Following the drainage from any cell reaches an outlet (an edge or the sea) without looping.
    for (let i = 0; i < n * n; i += 37) {
      let c = i,
        steps = 0;
      while (w.rec[c] >= 0 && steps < n * n) (c = w.rec[c]), steps++;
      const x = c % n,
        y = Math.floor(c / n);
      assert.ok(w.sea[c] || x === 0 || y === 0 || x === n - 1 || y === n - 1, `cell ${i} drains to ${x},${y}, not an outlet`);
    }
    // Rivers gather water: a cell carries at least what drains into it.
    for (let i = 0; i < n * n; i++) if (w.rec[i] >= 0) assert.ok(w.flow[w.rec[i]] >= w.flow[i] * 0.999);
    // A lake's surface is level across its cells' neighbours that are lake too.
    for (let i = 0; i < n * n; i++)
      if (w.lake[i] > 0 && w.lake[i + 1] > 0 && (i + 1) % n) assert.ok(Math.abs(w.h[i] + w.lake[i] - (w.h[i + 1] + w.lake[i + 1])) < 1, "lake surfaces are level");
    // The rock at the surface is the rock a section finds just under it.
    for (let i = 0; i < n * n; i += 53) if (!w.sea[i]) assert.equal(rockAt(w, i, w.h[i] - 0.01), w.rock[i]);
  }
});
