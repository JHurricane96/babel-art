import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  generateRegion,
  generateWindow,
  regionFeatures,
} from "../engine/strata/generate.ts";
import { ROCK } from "../engine/strata/history.ts";
import { BIOMES } from "../engine/strata/biomes.ts";
import * as history from "../engine/strata/history.ts";
import * as worldmap from "../engine/strata/worldmap.ts";
import { installWorldCache } from "../tools/strata-lab/world-cache.ts";

const { placeAt, worldOf } = worldmap;
// Worlds come from a disk cache keyed to the engine's code (history tests
// build theirs directly, so the simulation itself stays tested).
installWorldCache(new URL("..", import.meta.url).pathname, history, worldmap);
import { M, REGION_W, WORLD_H, bandOf } from "../engine/strata/world.ts";

const digest = (a) => createHash("sha256").update(a).digest("hex");

test("a region generates identically every time", () => {
  const a = generateRegion(3, 1),
    b = generateRegion(3, 1);
  assert.equal(digest(a.cells), digest(b.cells));
  assert.equal(digest(a.state), digest(b.state));
  assert.deepEqual([...a.surface], [...b.surface]);
});

test("region edges are seamless: a window across an edge matches both regions", () => {
  for (const [seed, r] of [
    [1, 60],
    [2, 0],
  ]) {
    const left = generateRegion(seed, r),
      right = generateRegion(seed, r + 1),
      half = 400,
      w = generateWindow(seed, (r + 1) * REGION_W - half, 2 * half);
    let mismatched = 0;
    for (let y = 0; y < WORLD_H; y++)
      for (let x = 0; x < 2 * half; x++) {
        const fromRegion =
          x < half
            ? left.cells[y * REGION_W + REGION_W - half + x]
            : right.cells[y * REGION_W + x - half];
        const stateFromRegion =
          x < half
            ? left.state[y * REGION_W + REGION_W - half + x]
            : right.state[y * REGION_W + x - half];
        if (
          w.cells[y * 2 * half + x] !== fromRegion ||
          w.state[y * 2 * half + x] !== stateFromRegion
        )
          mismatched++;
      }
    assert.equal(
      mismatched,
      0,
      `seed ${seed}: ${mismatched} cells differ across the edge`,
    );
  }
});

test("water never stands as a wall: no water cell has open air beside it", () => {
  // The ocean at a world's end and its coast, and stretches with lakes and rivers.
  const lake = (seed) => {
    const w = worldOf(seed);
    for (let c = 0; c < w.n; c++)
      if (w.wet[c] === 1) return Math.floor((c * 64) / REGION_W);
    return 50;
  };
  for (const [seed, r] of [
    [1, 0],
    [1, 4],
    [7, 3],
    [2, lake(2)],
    [3, lake(3)],
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

test("the land keeps changing: no biome runs on past seven regions, and a world has many", () => {
  for (const seed of [1, 2, 3, 4]) {
    const w = worldOf(seed),
      per = REGION_W / 64,
      seq = [];
    for (let x = 32; x < w.regions * REGION_W; x += 64) seq.push(placeAt(seed, x).biome);
    const all = new Set(seq.filter((b) => b >= 0));
    assert.ok(all.size >= 15, `seed ${seed}: only ${all.size} biomes`);
    for (let r = 2; r + 8 <= w.regions - 2; r++) {
      const here = new Set(seq.slice(r * per, (r + 8) * per));
      if (here.has(-1)) continue;
      assert.ok(
        here.size >= 2,
        `seed ${seed}: only ${BIOMES[[...here][0]].name} in regions ${r}-${r + 7}`,
      );
    }
  }
});

test("regions show the world: snow where it's cold, sand in deserts, leaves in woods, sea at the ends", () => {
  const count = (g, pred) => {
    let n = 0;
    for (let i = 0; i < g.cells.length; i++) if (pred(g.cells[i])) n++;
    return n;
  };
  /** A region whose middle is mostly biomes that look like this. */
  const find = (seed, looks) => {
    const w = worldOf(seed),
      per = REGION_W / 64;
    for (let r = 10; r < w.regions - 10; r++) {
      let hits = 0;
      for (let c = r * per + 8; c < (r + 1) * per - 8; c++) {
        const b = placeAt(seed, c * 64 + 32).biome;
        if (b >= 0 && looks(BIOMES[b])) hits++;
      }
      if (hits > (per - 16) * 0.7) return r;
    }
    return -1;
  };
  /** A region that is below freezing all through. */
  const cold = (seed) => {
    const w = worldOf(seed),
      per = REGION_W / 64;
    for (let r = 10; r < w.regions - 10; r++) {
      let ok = true;
      for (let c = r * per; c < (r + 1) * per && ok; c++)
        ok = !w.wet[c] && w.T[c] < -2;
      if (ok) return r;
    }
    return -1;
  };
  const checks = [
    ["cold", (g) => count(g, (m) => m === M.SNOW) > 1000, "snow"],
    [(b) => b.ground === "sand", (g) => count(g, (m) => m === M.SAND) > 1500, "sand"],
    [(b) => b.broad + b.pines > 0.05, (g) => count(g, (m) => m === M.LEAF) > 2000, "leaves"],
  ];
  for (const [biome, ok, what] of checks) {
    let tried = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const r = biome === "cold" ? cold(seed) : find(seed, biome);
      if (r < 0) continue;
      tried = true;
      assert.ok(
        ok(generateRegion(seed, r)),
        `${what} (seed ${seed}, region ${r})`,
      );
      break;
    }
    assert.ok(tried, `no region found for ${what}`);
  }
  assert.ok(
    count(generateRegion(1, 0), (m) => m === M.WATER) > 100000,
    "the sea at the world's end",
  );
});

test("rock comes in the world's own beds, and caves open most in limestone", () => {
  const kinds = new Set(),
    air = new Map(),
    all = new Map();
  for (const [seed, r] of [
    [1, 60],
    [3, 75],
    [11, 137],
  ]) {
    const g = generateRegion(seed, r);
    for (let x = 0; x < REGION_W; x += 2)
      for (let y = g.surface[x] + 60; y < WORLD_H - 80; y += 2) {
        const i = y * REGION_W + x,
          k = bandOf(g.state[i]);
        kinds.add(k);
        all.set(k, (all.get(k) ?? 0) + 1);
        if (g.cells[i] === M.AIR) air.set(k, (air.get(k) ?? 0) + 1);
      }
  }
  assert.ok(kinds.size >= 4, `only ${kinds.size} kinds of rock`);
  const share = (k) => (air.get(k) ?? 0) / Math.max(1, all.get(k) ?? 0);
  assert.ok(
    share(ROCK.LIMESTONE) > 2 * share(ROCK.BASEMENT),
    `caves: ${(100 * share(ROCK.LIMESTONE)).toFixed(1)}% of limestone, ${(100 * share(ROCK.BASEMENT)).toFixed(1)}% of basement`,
  );
});

test("a region generates well inside the mini PC budget", () => {
  generateRegion(9, 0);
  const t0 = performance.now();
  generateRegion(9, 1);
  const ms = performance.now() - t0;
  // Target: 2 s on the mini PC (factor about 0.77 of this machine); allow a slow CI box.
  assert.ok(ms < 4000, `${ms.toFixed(0)} ms`);
});

test("the surface carries rock shapes, greenery and built things", () => {
  const seen = { BRICK: 0, ROPE: 0, REED: 0, FLOWER: 0, raisedRock: 0 };
  // A region with a ruin and one with a bridge across a gorge, from the
  // world's landmarks, and two ordinary ones.
  const regions = [
    [1, 60],
    [2, 30],
  ];
  for (const seed of [1, 2, 3]) {
    for (let r = 10; r < 190; r++) {
      const f = regionFeatures(seed, r);
      if (f.bridge && !regions.some(([s2, r2]) => s2 === seed && r2 === r)) {
        regions.push([seed, r]);
        break;
      }
    }
    if (regions.length >= 3) break;
  }
  for (let r = 10; r < 190; r++)
    if (regionFeatures(1, r).ruin) {
      regions.push([1, r]);
      break;
    }
  for (const [seed, r] of regions) {
    const g = generateRegion(seed, r);
    for (let x = 0; x < REGION_W; x++)
      for (let y = 0; y < g.surface[x]; y++) {
        const m = g.cells[y * REGION_W + x];
        if (m === M.BRICK) seen.BRICK++;
        else if (m === M.ROPE) seen.ROPE++;
        else if (m === M.REED) seen.REED++;
        else if (m === M.FLOWER) seen.FLOWER++;
        else if (m === M.ROCK || m === M.GRAVEL) seen.raisedRock++;
      }
  }
  for (const [k, n] of Object.entries(seen))
    assert.ok(n > 0, `${k}: ${n} in ${JSON.stringify(regions)}`);
});

test("journey routes join seamlessly: each region's route ends where the next one's starts", async () => {
  const { planRoute, VERB } = await import("../engine/strata/route.ts");
  const PAD = 128,
    W = REGION_W + 2 * PAD,
    route = (seed, r) => {
      const x0 = r * REGION_W - PAD,
        g = generateWindow(seed, x0, W);
      return planRoute({ cells: g.cells, W, H: WORLD_H, x0, seed, r, left: PAD, right: PAD + REGION_W });
    };
  for (const [seed, r] of [
    [7, 44],
    [11, 52],
  ]) {
    const a = route(seed, r),
      b = route(seed, r + 1),
      n = a.xs.length;
    assert.equal(a.xs[0], r * REGION_W, "starts on the region's left edge");
    assert.equal(a.xs[n - 1], b.xs[0], `seed ${seed}: region ${r} ends where ${r + 1} starts (x)`);
    assert.equal(a.ys[n - 1], b.ys[0], `seed ${seed}: region ${r} ends where ${r + 1} starts (row)`);
    // Every step moves to a neighbouring cell (rests stay put).
    for (let i = 1; i < n; i++) {
      if (a.verbs[i] === VERB.REST || a.verbs[i - 1] === VERB.REST) continue;
      assert.ok(Math.abs(a.xs[i] - a.xs[i - 1]) <= 1, `step ${i} jumps ${a.xs[i] - a.xs[i - 1]} columns`);
    }
  }
});
