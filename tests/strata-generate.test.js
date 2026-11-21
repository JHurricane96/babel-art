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

test("each biome shows its character, and the edge band holds both", () => {
  const seed = 5;
  for (const r of [0, 1]) {
    const g = generateRegion(seed, r),
      b = BIOMES[regionBiome(seed, r)];
    let caves = 0,
      water = 0,
      glow = 0,
      plants = 0;
    for (let x = 0; x < REGION_W; x++)
      for (let y = g.surface[x] + 20; y < WORLD_H; y++)
        if (g.cells[y * REGION_W + x] === M.AIR) caves++;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] === M.WATER) water++;
      if (g.state[i] & GLOW) glow++;
      if (g.cells[i] === M.LEAF || g.cells[i] === M.CAP) plants++;
    }
    assert.ok(caves > 20000, `${b.id}: caves ${caves}`);
    assert.ok(plants > 500, `${b.id}: plants ${plants}`);
    if (b.basin)
      assert.ok(
        g.lake > 0 && water > 5000,
        `${b.id}: lake ${g.lake}, water ${water}`,
      );
    if (b.id === "fungal") assert.ok(glow > 1000, `fungal glow ${glow}`);
  }
  // Rock on both sides of the shared edge mixes the two biomes' strata.
  const right = generateRegion(seed, 1),
    seen = new Set();
  for (let y = 700; y < 1400; y++)
    for (let x = 0; x < 200; x++)
      seen.add(biomeOf(right.state[y * REGION_W + x]));
  assert.equal(seen.size, 2);
});

test("a region generates well inside the mini PC budget", () => {
  generateRegion(9, 0);
  const t0 = performance.now();
  generateRegion(9, 1);
  const ms = performance.now() - t0;
  // Target: 2 s on the mini PC (factor about 0.77 of this machine); allow a slow CI box.
  assert.ok(ms < 4000, `${ms.toFixed(0)} ms`);
});
