import test from "node:test";
import assert from "node:assert/strict";
import { CLASS_H, NC, drawSlots, slotDefs } from "../tools/strata-lab/vista/sprites.ts";
import { buildBand } from "../tools/strata-lab/vista/grids.ts";
import { FAR, FINE, KIND_COUNT, placeGrids } from "../tools/strata-lab/vista/common.ts";
import { G, ground, landFromWorld, setLand } from "../tools/strata-lab/vista/land.ts";
import { BIOMES, generateWorld } from "../engine/strata/world2d.ts";

test("vista sprites draw at every size class, growing with the class", () => {
  const defs = slotDefs();
  assert.equal(CLASS_H.length, NC);
  for (const { slot, imgs } of drawSlots(0, defs.length)) {
    const d = defs[slot];
    assert.equal(imgs.length, d.maxClass + 1, d.name);
    for (const im of imgs) {
      assert.ok(im.w > 0 && im.h > 0 && im.data.length === im.w * im.h * 4, `${d.name}: an image`);
      assert.ok(im.ax >= 0 && im.ax <= im.w && im.ay >= 0 && im.ay <= im.h + 1, `${d.name}: its foot inside it`);
    }
    if (d.name === "marker") continue;
    const big = imgs[imgs.length - 1].h,
      small = imgs[Math.min(2, imgs.length - 1)].h;
    assert.ok(big >= small, `${d.name}: bigger classes are bigger (${small} -> ${big})`);
    // A sprite fills roughly its class's height (people, trees and plants alike).
    const k = imgs.length - 1;
    assert.ok(imgs[k].h >= CLASS_H[k] * 0.5 && imgs[k].h <= CLASS_H[k] * 1.6, `${d.name}: ${imgs[k].h} px at class ${CLASS_H[k]}`);
  }
});

test("vista land from a generated world: heights, water, kinds and biomes, no trees on the road", () => {
  const w = generateWorld(20261126, { n: 128 }),
    L = landFromWorld(w);
  setLand(L);
  assert.ok(L.places.length >= 4, `${L.places.length} places to go`);
  assert.ok(L.rivers.length / 7 > 20, "rivers traced");
  const p = L.places[0];
  placeGrids(p.x, p.z, L.n * L.cell);
  // A straight walk across the middle of the fine grid.
  const mid = FINE.z0 + FINE.cell * FINE.n * 0.5,
    route = [[FINE.x0 + 300, mid], [FINE.x0 + FINE.cell * FINE.n - 300, mid]],
    r0 = Math.floor((mid - FINE.z0) / FINE.cell) - 8,
    band = buildBand(0, r0, r0 + 16, FINE, route);
  for (let i = 0; i < band.h.length; i++) {
    assert.ok(Number.isFinite(band.h[i]) && band.h[i] > -3000 && band.h[i] < 8000, `height ${band.h[i]}`);
    assert.ok(band.kind[i * 2] < KIND_COUNT, "a kind of ground");
    assert.ok(band.kind[i * 2 + 1] < BIOMES.length || band.kind[i * 2 + 1] === 255, "a biome");
  }
  const t = band.trees;
  for (let i = 0; i < t.length; i += 6)
    if (t[i] > route[0][0] && t[i] < route[1][0]) assert.ok(Math.abs(t[i + 2] - mid) > 4, `a tree stands on the road at ${t[i].toFixed(0)}, ${t[i + 2].toFixed(0)}`);
  // The far grid covers the whole world.
  assert.equal(FAR.x0, 0);
  assert.ok(Math.abs(FAR.cell * FAR.n - L.n * L.cell) < 1);
});

import { append, cumulativeOf, planJourney, refine } from "../tools/strata-lab/vista/journey.ts";

test("vista journey: a tour through the places round the water, walked out in stretches", () => {
  const w = generateWorld(20261126, { n: 128 }),
    L = landFromWorld(w);
  setLand(L);
  const j = planJourney(L);
  assert.ok(j.stops.length >= 4, `${j.stops.length} stops`);
  for (let i = 1; i < j.stops.length; i++) assert.ok(j.stops[i].at > j.stops[i - 1].at, "stops in order along the route");
  const total = j.coarseAt[j.coarseAt.length - 1];
  assert.ok(total > 20000, `${(total / 1000).toFixed(1)} km`);
  // The first 10 km walked out: round lakes and the sea, continuous.
  const walk = [];
  let cursor = 0;
  while (cursor < Math.min(total, 10000)) {
    const end = walk.length ? walk[walk.length - 1] : j.coarse[0],
      to = Math.min(total, cursor + 2500),
      more = refine(j, end[0], end[1], to);
    cursor = to;
    if (more) append(walk, more);
  }
  const cum = cumulativeOf(walk);
  assert.ok(cum[cum.length - 1] > 8000, `${cum[cum.length - 1]} m walked out`);
  let wet = 0;
  for (let i = 1; i < walk.length; i++) {
    assert.ok(cum[i] - cum[i - 1] < 40, `a gap of ${(cum[i] - cum[i - 1]).toFixed(0)} m in the walk`);
    const h = ground(walk[i][0], walk[i][1]);
    if (G.level > h && (G.lake || G.sea)) wet++;
  }
  assert.ok(wet === 0, `${wet} points of the walk in a lake or the sea`);
});

test("vista grids: trees hang on the world's cells, so a grid laid elsewhere grows the same ones", () => {
  const w = generateWorld(20261126, { n: 128 }),
    L = landFromWorld(w);
  setLand(L);
  const p = L.places[1],
    a = { x0: Math.round(p.x - 2000), z0: Math.round(p.z - 200), cell: 2, n: 2048 },
    b = { ...a, x0: a.x0 + 2 * 37 },
    key = (t, i) => `${t[i].toFixed(2)},${t[i + 2].toFixed(2)},${t[i + 3].toFixed(2)}`,
    ta = buildBand(0, 40, 80, a, []).trees,
    tb = buildBand(0, 40, 80, b, []).trees,
    inB = new Set();
  for (let i = 0; i < tb.length; i += 6) inB.add(key(tb, i));
  let shared = 0;
  for (let i = 0; i < ta.length; i += 6)
    if (ta[i] > b.x0 + 4 && ta[i] < a.x0 + a.cell * a.n - 4) {
      assert.ok(inB.has(key(ta, i)), `the tree at ${ta[i].toFixed(0)}, ${ta[i + 2].toFixed(0)} is not in the other placement`);
      shared++;
    }
  assert.ok(shared > 0 || ta.length === 0, "trees to compare");
});

import { assemble, packSlot, partAt, partH } from "../tools/strata-lab/vista/pack.ts";

test("vista packs: every height has an image, spans grow by whole rows, parts step a pixel at a time", () => {
  const defs = slotDefs();
  for (const name of ["oak 0", "spruce 1", "pine 2", "shrub", "grass", "boulder 0", "outcrop 2", "rubble 1", "heather 0", "sage 1", "rosette 2", "person 0 0 0"]) {
    const slot = defs.findIndex((d) => d.name === name),
      p = packSlot(slot, defs[slot]),
      pl = p.plan;
    // Exact images up to E, the span from E + 1, parts from T, to K.
    assert.equal(p.exact.length, pl.E, `${name}: an image for each small height`);
    if (pl.T) {
      assert.equal(p.span.h0, pl.E + 1);
      assert.equal(p.span.h1, pl.T - 1, `${name}: the span runs up to where parts take over`);
      assert.ok(p.parts.length > 10 && p.parts.length < 400, `${name}: ${p.parts.length} parts`);
    } else if (pl.K > pl.E) assert.deepEqual([p.span.h0, p.span.h1], [pl.E + 1, pl.K], `${name}: the span runs to K`);
    // A span: each height keeps every row it kept below, and rows in proportion to its height (the
    // drawing stands for N px whatever its own height): a pixel more of sprite puts back about as
    // many rows as the drawing has per pixel (one, for a drawing as tall as it stands for).
    if (p.span) {
      const sp = p.span,
        k = sp.pic.h / (pl.T || pl.N),
        rowsAt = (H) => {
          const o = (H - sp.h0) * 6;
          return new Set(sp.rows.subarray(sp.per[o], sp.per[o] + sp.per[o + 2]));
        };
      for (let H = sp.h0; H < sp.h1; H++) {
        const a = rowsAt(H),
          b = rowsAt(H + 1),
          more = b.size - a.size;
        assert.ok(more >= (k >= 1 ? 1 : 0) && more <= Math.ceil(k), `${name}: ${more} rows more at ${H + 1} px (${k.toFixed(2)} a pixel)`);
        assert.ok(Math.abs(b.size - k * (H + 1)) <= 1, `${name}: ${b.size} rows at ${H + 1} px`);
        for (const r of a) assert.ok(b.has(r), `${name}: row ${r} kept from ${H} to ${H + 1} px`);
      }
    }
    // Parts: one pixel more of tree moves each part at most a pixel and adds at most a row to it.
    for (const q of p.parts)
      for (let H = pl.T; H < pl.K; H++) {
        const h0 = partH(q.pic.h, H, pl.K),
          h1 = partH(q.pic.h, H + 1, pl.K);
        assert.ok(h1 - h0 === 0 || h1 - h0 === 1, `${name}: a part grows a row at a time`);
        assert.ok(Math.abs(partAt(q.cx, H + 1, pl.K) - partAt(q.cx, H, pl.K)) <= 1 && Math.abs(partAt(q.cy, H + 1, pl.K) - partAt(q.cy, H, pl.K)) <= 1, `${name}: a part moves a pixel at a time`);
      }
    // Where parts take over, they make the span's own drawing (so the hand-over changes nothing).
    if (pl.T) {
      const at = assemble(p.parts, pl.T, pl.K);
      assert.deepEqual([at.w, at.h], [p.span.pic.w, p.span.pic.h], `${name}: the same size at ${pl.T} px`);
      let diff = 0;
      for (let i = 0; i < at.w * at.h; i++) if (at.data[i * 4] !== p.span.pic.data[i * 4] || (at.data[i * 4 + 3] > 0) !== (p.span.pic.data[i * 4 + 3] > 0)) diff++;
      assert.equal(diff, 0, `${name}: the same pixels at ${pl.T} px`);
    }
  }
});

import { FORMAT, bytesOf, matches } from "../tools/strata-lab/vista/cache.ts";

test("vista saved land: only a record made by the same code, for the same day and size, is used", () => {
  const want = { format: FORMAT, code: "abc", seed: 20261126, n: 512 },
    value = { n: 512, h: new Float32Array(4) },
    rec = { kind: "land", ...want, made: 0, bytes: 16, value },
    valid = (v) => v?.n === 512;
  assert.ok(matches(rec, "land", want, valid));
  for (const [k, v] of [["format", FORMAT + 1], ["code", "abd"], ["seed", 20261127], ["n", 256], ["kind", "sprites"]])
    assert.ok(!matches({ ...rec, [k]: v }, "land", want, valid), `a different ${k} is not used`);
  assert.ok(!matches({ ...rec, value: { n: 256 } }, "land", want, valid), "a value of the wrong shape is not used");
  for (const junk of [null, undefined, 3, "land", {}]) assert.ok(!matches(junk, "land", want, valid));
  // Its size: the bytes in its typed arrays (each counted once).
  const a = new Uint8Array(10);
  assert.equal(bytesOf({ a, b: { c: new Float32Array(5), again: a }, n: 3 }), 30);
});
