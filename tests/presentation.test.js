import test from "node:test";
import assert from "node:assert/strict";
import { paletteRoles, okMix, toOklab, ROLE_NAMES } from "../engine/finish.ts";
import { PALETTES } from "../shared/model.js";

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const chroma = (c) => Math.hypot(...toOklab(c).slice(1));

test("palette roles keep saturation where sRGB mixing turns gray", () => {
  for (const [id, palette] of Object.entries(PALETTES)) {
    const colors = palette.colors.map(hex),
      roles = paletteRoles(colors);
    for (const name of ROLE_NAMES) {
      assert.equal(roles[name].length, 3, id + " " + name);
      assert.ok(
        roles[name].every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
        id + " " + name,
      );
    }
    const naive = colors[0].map((v, i) => (v + colors[2][i]) / 2);
    assert.ok(
      chroma(roles.toneDusk) >= chroma(naive) - 1e-6,
      id + " dusk keeps chroma",
    );
    assert.ok(
      toOklab(roles.toneGround)[0] < toOklab(colors[0])[0],
      id + " ground is darker than the deep stop",
    );
    assert.deepEqual(paletteRoles(colors), roles, id + " roles are stable");
  }
  // The endpoints of a hue-arc blend are the original colors.
  const [a, , b] = PALETTES.aurora.colors.map(hex);
  okMix(a, b, 0).forEach((v, i) => assert.ok(Math.abs(v - a[i]) < 1e-3));
  okMix(a, b, 1).forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-3));
});
