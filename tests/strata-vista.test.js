import test from "node:test";
import assert from "node:assert/strict";
import { CLASS_H, NC, drawSlots, slotDefs } from "../tools/strata-lab/vista/sprites.ts";
import { buildBand } from "../tools/strata-lab/vista/grids.ts";
import { FINE, ROUTE } from "../tools/strata-lab/vista/valley.ts";

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

test("vista valley: the route runs over dry ground, with no trees on the road", () => {
  // The band of the fine grid where the day starts.
  const r0 = Math.floor((ROUTE[0][1] - FINE.z0) / FINE.cell) - 8,
    band = buildBand(0, r0, r0 + 16);
  for (let i = 0; i < band.h.length; i++) assert.ok(Number.isFinite(band.h[i]), "heights are numbers");
  const t = band.trees;
  for (let i = 0; i < t.length; i += 6) {
    const dz = Math.abs(t[i + 2] - ROUTE[0][1]),
      onRoad = t[i] > ROUTE[0][0] && t[i] < ROUTE[1][0] && dz < 2;
    assert.ok(!onRoad, `a tree stands on the road at ${t[i].toFixed(0)}, ${t[i + 2].toFixed(0)}`);
  }
});

import { assemble, packSlot, partAt, partH } from "../tools/strata-lab/vista/pack.ts";

test("vista packs: every height has an image, spans grow by whole rows, parts step a pixel at a time", () => {
  const defs = slotDefs();
  for (const name of ["oak 0", "spruce 1", "pine 2", "shrub", "grass", "boulder", "person 0 0 0"]) {
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
    // A span: each height keeps one row more than the one below, and every row it kept before.
    if (p.span) {
      const sp = p.span,
        rowsAt = (H) => {
          const o = (H - sp.h0) * 6;
          return new Set(sp.rows.subarray(sp.per[o], sp.per[o] + sp.per[o + 2]));
        };
      for (let H = sp.h0; H < sp.h1; H++) {
        const a = rowsAt(H),
          b = rowsAt(H + 1);
        assert.equal(b.size, a.size + 1, `${name}: one row more at ${H + 1} px`);
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
