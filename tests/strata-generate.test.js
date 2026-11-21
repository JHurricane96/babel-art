import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BIOMES,
  generateRegion,
  generateWindow,
  regionBiome,
} from "../engine/strata/generate.ts";
import { GLOW, M, REGION_W, WORLD_H, biomeOf } from "../engine/strata/world.ts";

const digest = (a) => createHash("sha256").update(a).digest("hex");

test("a region generates identically every time", () => {
  const a = generateRegion(3, 1),
    b = generateRegion(3, 1);
  assert.equal(digest(a.cells), digest(b.cells));
  assert.equal(digest(a.state), digest(b.state));
  assert.deepEqual([...a.surface], [...b.surface]);
});

test("region edges are seamless: a window across an edge matches both regions", () => {
  for (const seed of [1, 2]) {
    const left = generateRegion(seed, 0),
      right = generateRegion(seed, 1),
      half = 400,
      w = generateWindow(seed, REGION_W - half, 2 * half);
    let mismatched = 0;
    for (let y = 0; y < WORLD_H; y++)
      for (let x = 0; x < 2 * half; x++) {
        const fromRegion =
          x < half
            ? left.cells[y * REGION_W + REGION_W - half + x]
            : right.cells[y * REGION_W + x - half];
        if (w.cells[y * 2 * half + x] !== fromRegion) mismatched++;
      }
    assert.equal(
      mismatched,
      0,
      `seed ${seed}: ${mismatched} cells differ across the edge`,
    );
  }
});

test("water never stands as a wall: no water cell has open air beside it", () => {
  for (const [seed, r] of [
    [1, 0],
    [1, 1],
    [7, 0],
  ]) {
    const g = generateRegion(seed, r);
    let walls = 0;
    for (let y = 0; y < WORLD_H; y++)
      for (let x = 1; x < REGION_W - 1; x++) {
        const i = y * REGION_W + x;
        if (
          g.cells[i] === M.WATER &&
          (g.cells[i - 1] === M.AIR || g.cells[i + 1] === M.AIR)
        )
          walls++;
      }
    assert.equal(
      walls,
      0,
      `seed ${seed} region ${r}: ${walls} water cells beside air`,
    );
  }
});

test("neighbouring regions always have different biomes", () => {
  for (let seed = 1; seed <= 6; seed++)
    for (let r = -30; r < 30; r++)
      assert.notEqual(
        regionBiome(seed, r),
        regionBiome(seed, r + 1),
        `seed ${seed}, regions ${r} and ${r + 1}`,
      );
});

test("each biome shows its character, and an edge band holds both biomes", () => {
  const count = (g, pred) => {
    let n = 0;
    for (let i = 0; i < g.cells.length; i++)
      if (pred(g.cells[i], g.state[i])) n++;
    return n;
  };
  const checks = {
    highlands: (g) =>
      count(g, (m) => m === M.WATER) > 5000 &&
      count(g, (m) => m === M.LEAF) > 300,
    fungal: (g) =>
      count(g, (m, s) => s & GLOW) > 1000 && count(g, (m) => m === M.CAP) > 200,
    canyon: (g) =>
      count(g, (m) => m === M.SAND) > 5000 &&
      count(g, (m) => m === M.FOSSIL) > 20,
    forest: (g) =>
      count(g, (m) => m === M.LEAF) > 3000 &&
      count(g, (m) => m === M.WATER) > 1000,
    peaks: (g) =>
      count(g, (m) => m === M.SNOW) > 3000 &&
      count(g, (m) => m === M.ICE) > 100,
    basalt: (g) =>
      count(g, (m) => m === M.LAVA) > 500 &&
      count(g, (m) => m === M.ASH) > 1000,
  };
  const seen = new Set();
  for (let seed = 1; seed <= 4 && seen.size < BIOMES.length; seed++)
    for (let r = 0; r < 6 && seen.size < BIOMES.length; r++) {
      const b = BIOMES[regionBiome(seed, r)];
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      assert.ok(
        checks[b.id](generateRegion(seed, r)),
        `${b.id} (seed ${seed}, region ${r})`,
      );
    }
  assert.equal(seen.size, BIOMES.length);
  // Rock just past an edge mixes the two biomes' strata.
  const right = generateRegion(5, 1),
    mixed = new Set();
  for (let y = 700; y < 1400; y++)
    for (let x = 0; x < 200; x++)
      mixed.add(biomeOf(right.state[y * REGION_W + x]));
  assert.equal(mixed.size, 2);
});

test("a region generates well inside the mini PC budget", () => {
  generateRegion(9, 0);
  const t0 = performance.now();
  generateRegion(9, 1);
  const ms = performance.now() - t0;
  // Target: 2 s on the mini PC (factor about 0.77 of this machine); allow a slow CI box.
  assert.ok(ms < 4000, `${ms.toFixed(0)} ms`);
});
