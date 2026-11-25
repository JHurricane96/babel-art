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
