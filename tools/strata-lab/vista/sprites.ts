// Vista sprites: the drawings, and the list of slots. Every kind of thing Vista shows: trees (every
// species the biomes name, trees.ts); shrubs, heather, sage and rosettes; grasses (tufts, tall
// grass, sedge, reeds, moss); flowers (daisies, spikes, umbels, cups, cushions); ferns; rocks in six
// families (rocks.ts); the party; the party's marker; each as a drawing at any height in pixels
// (drawn with draw.ts). pack.ts turns these into what the GPU draws at each size.
import { M } from "../../../engine/strata/world";
import { fern } from "../../../engine/strata/art";
import { hex, rampOf } from "./color";
import { mulberry } from "./common";
import { ROCK_KINDS, rockImg } from "./rocks";
import { type Img, type MatCanvas, type SlotDef, CLASS_H, NC, blade, canvasFor, crownV, hashCell, isIndexMode, useRamps } from "./draw";
import { branch } from "../../../engine/strata/art";
import { treeDraw } from "./trees";
import { TREE_KINDS } from "./common";
export { type Img, type Part, type SlotDef, CLASS_H, NC, drawParts, indexMode, lastRamps } from "./draw";
export { LEAF_HEX, TREE_NAMES } from "./trees";

// ---- Ground cover --------------------------------------------------------------------------
export const GRASS_R = rampOf(hex("#6f9a3c")),
  DRY_R = rampOf(hex("#a6a05a")),
  ROCK_R = rampOf(hex("#8c867c")),
  FERN_R = rampOf(hex("#4f8a34")),
  SHRUB_R = rampOf(hex("#4d7a30")),
  HEATHER_R = rampOf(hex("#7a4a6a")),
  SAGE_R = rampOf(hex("#8a9a7a")),
  ROSETTE_R = rampOf(hex("#5a7a5a")),
  TWIG_R = rampOf(hex("#5e4c3c")),
  SPIKE_R = rampOf(hex("#e8e0c0")),
  // Flowers are coloured by where they grow (main.ts); these are for drawings on their own.
  BLOOM_R = rampOf(hex("#c86a9a")),
  UMBEL_R = rampOf(hex("#ece6d4")),
  EYE_R = rampOf(hex("#e0b030")),
  STRAW_R = rampOf(hex("#c8b47a")),
  CATKIN_R = rampOf(hex("#5a4632")),
  CATTAIL_R = rampOf(hex("#6a4a30")),
  PLUME_R = rampOf(hex("#b8a488")),
  MOSS_R = rampOf(hex("#5e7a32")),
  CACTUS_R = rampOf(hex("#5a7a48")),
  SPINE_R = rampOf(hex("#d8cc98")),
  CACTUS_BLOOM_R = rampOf(hex("#e0a040")),
  PEAR_R = rampOf(hex("#a83a5a"));

/** A grass clump: blades fanning from one root, dark at the base, lit at the tips. */
function grass(H: number, seed: number, dry: boolean): Img {
  // The same blades at every size (fewer drawn when small).
  const { c } = canvasFor(H, 1.2, seed),
    R = mulberry(seed),
    n = Math.max(2, Math.min(28, Math.round(H * 0.9)));
  if (H <= 3) {
    c.set(0, -1, M.GRASS, 3);
    if (H >= 3) { c.set(-1, -1, M.GRASS, 2); c.set(0, -2, M.GRASS, 4); c.set(1, -2, M.GRASS, 5); }
  } else
    for (let k = 0; k < 28; k++) {
      const lean = (((k * 0.618) % 1) * 2 - 1) * (0.5 + 0.3 * R()),
        len = H * (0.55 + 0.45 * R()),
        bend = (R() - 0.3) * 0.5;
      if (k >= n) continue;
      for (let s = 0; s < len; s++) {
        const t = s / len,
          x = Math.round(lean * s * 0.55 + bend * t * t * len * 0.5),
          y = -1 - s;
        c.set(x, y, M.GRASS, t < 0.25 ? 2 : t < 0.6 ? 3 : t < 0.85 ? 4 : 5);
      }
    }
  return c.toImg({ [M.GRASS]: dry ? DRY_R : GRASS_R }, 0, 0);
}

// ---- Grasses and flowers, stroke by stroke ----------------------------------------------------
// Each is a few strokes with fixed values (the same random numbers drawn whatever the size), laid
// out in fractions of the height, so a drawing a pixel bigger moves each stroke's end a little and
// changes nothing else.

const SMALL_TUFT = (c: MatCanvas, H: number, m = M.GRASS) => {
  c.set(0, -1, m, 3);
  if (H >= 2) c.set(0, -2, m, 4);
  if (H >= 3) (c.set(-1, -1, m, 2), c.set(1, -2, m, 5));
};
/** Tall grass: a bunch of long blades arching out and over, seed heads on stalks above them. */
function tallgrassDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.5, seed),
    R = mulberry(seed),
    blades = Array.from({ length: 24 }, (_, k) => {
      const side = ((k * 0.618) % 1) * 2 - 1;
      return { side, ang: side * (0.25 + 0.4 * R()), len: 0.5 + 0.3 * R(), curl: side * (0.3 + 0.5 * R()) };
    }),
    stalks = Array.from({ length: 5 }, () => ({ ang: (R() - 0.5) * 0.5, len: 0.82 + 0.18 * R(), curl: (R() - 0.5) * 0.5 }));
  if (H <= 3) SMALL_TUFT(c, H);
  else {
    const n = Math.max(3, Math.min(24, Math.round(H * 0.8)));
    blades.slice(0, n).forEach(({ side, ang, len, curl }) => blade(c, Math.round(side * H * 0.05), -1, ang, len * H, curl, M.GRASS, (t) => (t < 0.3 ? 2 : t < 0.65 ? 3 : t < 0.9 ? 4 : 5)));
    stalks.slice(0, H < 8 ? 1 : H < 16 ? 3 : 5).forEach(({ ang, len, curl }) => {
      const [x, y] = blade(c, 0, -1, ang, len * H, curl, M.STALK, (t) => (t < 0.5 ? 3 : 4));
      // The seed head: the stalk's top arching over and nodding, florets along it.
      const h = Math.max(1, Math.round(H * 0.2)),
        dir = curl + ang >= 0 ? 1 : -1;
      let hx = x,
        hy = y;
      for (let k = 1; k <= h; k++) {
        const a = ang + dir * (k / h) * 1.7;
        hx += Math.sin(a);
        hy -= Math.cos(a);
        const px = Math.round(hx),
          py = Math.round(hy);
        c.set(px, py, M.STALK, 5);
        if (H >= 16 && k % 2 === 0) {
          c.set(px - Math.round(Math.cos(a)), py - Math.round(Math.sin(a)), M.STALK, 6);
          c.set(px + Math.round(Math.cos(a)), py + Math.round(Math.sin(a)), M.STALK, 4);
        }
      }
    });
  }
  return c.toImg({ [M.GRASS]: GRASS_R, [M.STALK]: STRAW_R }, 0, 0);
}
/** Sedge: a stiff clump of narrow, nearly upright leaves, dark, with a few brown spikes. */
function sedgeDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1, seed),
    R = mulberry(seed),
    leaves = Array.from({ length: 18 }, (_, k) => {
      const side = ((k * 0.618) % 1) * 2 - 1;
      return { side, ang: side * (0.08 + 0.4 * R()), len: 0.55 + 0.45 * R(), curl: side * 0.12 * R() };
    }),
    spikes = Array.from({ length: 3 }, () => ({ ang: (R() - 0.5) * 0.3, len: 0.85 + 0.2 * R() }));
  if (H <= 3) SMALL_TUFT(c, H);
  else {
    const n = Math.max(3, Math.min(18, Math.round(H * 0.7)));
    leaves.slice(0, n).forEach(({ side, ang, len, curl }) => blade(c, Math.round(side * H * 0.04), -1, ang, len * H, curl, M.GRASS, (t) => (t < 0.4 ? 1 : t < 0.8 ? 2 : 3) + (side < 0 ? 1 : 0)));
    spikes.slice(0, H < 10 ? 1 : 3).forEach(({ ang, len }) => {
      const [x, y] = blade(c, 0, -1, ang, len * H, 0, M.GRASS, () => 2),
        h = Math.max(1, Math.round(H * 0.1));
      for (let k = 0; k < h; k++) {
        c.set(x, y + k, M.STALK, k === 0 ? 4 : 2);
        if (H >= 20) c.set(x - 1, y + k, M.STALK, 3);
      }
    });
  }
  return c.toImg({ [M.GRASS]: GRASS_R, [M.STALK]: CATKIN_R }, 0, 0);
}
/** Reeds: tall stems with long leaves angled out, some topped with a brown cattail, some with a plume. */
function reedDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 0.9, seed),
    R = mulberry(seed),
    stems = Array.from({ length: 7 }, (_, k) => ({
      x: ((k * 0.618) % 1) - 0.5,
      ang: (R() - 0.5) * 0.18,
      len: 0.7 + 0.3 * R(),
      cattail: R() < 0.55,
      leaves: [0, 1, 2].map(() => ({ at: 0.1 + 0.45 * R(), ang: (R() < 0.5 ? -1 : 1) * (0.35 + 0.4 * R()), len: 0.25 + 0.2 * R() })),
    }));
  if (H <= 3) SMALL_TUFT(c, H);
  else
    stems.slice(0, H < 8 ? 2 : H < 20 ? 4 : 7).forEach((st) => {
      const x0 = Math.round(st.x * H * 0.28),
        [x, y] = blade(c, x0, -1, st.ang, st.len * H, 0, M.GRASS, (t) => (t < 0.5 ? 2 : 3));
      if (H >= 12)
        for (const lf of st.leaves) {
          const ax = x0 + Math.sin(st.ang) * lf.at * st.len * H,
            ay = -1 - Math.cos(st.ang) * lf.at * st.len * H;
          blade(c, ax, ay, lf.ang, lf.len * H, lf.ang * 0.8, M.GRASS, (t) => (t < 0.5 ? 3 : 4));
        }
      if (st.cattail) {
        // A brown cylinder below the stem's tip.
        const h = Math.max(1, Math.round(H * 0.12)),
          w = H >= 30 ? 1 : 0;
        for (let k = 0; k < h; k++) for (let dx = -w; dx <= w; dx++) c.set(x + dx, y + Math.round(H * 0.05) + k, M.REED, dx < 0 ? 4 : dx > 0 ? 2 : 3);
      } else {
        // A plume: a loose, nodding fan of tufts.
        const h = Math.max(1, Math.round(H * 0.14));
        for (let k = 0; k < h; k++) {
          const w = H >= 16 ? Math.round(Math.sin((Math.PI * (k + 1)) / (h + 1)) * H * 0.035) : 0;
          for (let dx = -w; dx <= w; dx++) if (hashCell(dx, k, seed) < 0.75) c.set(x + dx + Math.round(k * 0.3), y + k, M.STALK, dx < 0 ? 6 : 5);
        }
      }
    });
  return c.toImg({ [M.GRASS]: GRASS_R, [M.REED]: CATTAIL_R, [M.STALK]: PLUME_R }, 0, 0);
}
/** Moss: a low, soft hummock of tiny tufts. */
function mossDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 3.4, seed);
  if (H < 4) for (let x = -1; x <= 1; x++) c.set(x, -1, M.LEAF, x < 0 ? 4 : 3);
  else {
    const R = mulberry(seed + 9),
      k = Math.max(0.45, H / 14);
    for (let i = 0; i < 2; i++) {
      const x = (i - 0.5) * H * 1.3 + (R() - 0.5) * H * 0.4,
        h = H * (i ? 0.75 + 0.25 * R() : 1);
      crownV(c, x, -h / 2, H * (1 + 0.3 * R()), h / 2, { r0: 0.9 * k, r1: 1.5 * k, density: 3, speckle: 0.8, holes: 0, rag: 1.7 }, seed + i * 13);
    }
  }
  return c.toImg({ [M.LEAF]: MOSS_R }, 0, 0);
}
/** A few leaves at a plant's foot. */
function basal(c: MatCanvas, H: number, R: () => number, n: number, len: number) {
  for (let k = 0; k < n; k++) {
    const side = ((k * 0.618) % 1) * 2 - 1;
    blade(c, 0, -1, side * (0.7 + 0.5 * R()), len * H * (0.7 + 0.3 * R()), side * 0.4, M.GRASS, (t) => (t < 0.5 ? 2 : 3), H >= 24 ? 2 : 1);
  }
}
/** Daisies: thin stems, each with a flat head, a ring of petals round a yellow eye. */
function daisyDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.1, seed),
    R = mulberry(seed),
    stems = Array.from({ length: 6 }, (_, k) => ({ x: ((k * 0.618) % 1) - 0.5, ang: (R() - 0.5) * 0.7, len: 0.7 + 0.3 * R(), curl: (R() - 0.5) * 0.3 }));
  if (H <= 3) {
    c.set(0, -1, M.GRASS, 3);
    c.set(0, -2, M.FLOWER, 5);
  } else {
    basal(c, H, R, 5, 0.25);
    stems.slice(0, H < 8 ? 2 : H < 16 ? 4 : 6).forEach((st) => {
      const [x, y] = blade(c, Math.round(st.x * H * 0.3), -1, st.ang, st.len * H, st.curl, M.GRASS, (t) => (t < 0.5 ? 2 : 3)),
        r = H >= 28 ? 2 : H >= 10 ? 1 : 0;
      // Seen from a little above: an ellipse, lit on its far (upper) side.
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r - 1; dx <= r + 1; dx++) if (dx * dx + dy * dy * 2.5 <= (r + 0.6) ** 2 + 0.3) c.set(x + dx, y + Math.round(dy * 0.6), M.FLOWER, dy < 0 ? 6 : dx > 0 ? 4 : 5);
      if (r) c.set(x, y, M.CAP, 4);
      else c.set(x, y, M.FLOWER, 5);
    });
  }
  return c.toImg({ [M.GRASS]: GRASS_R, [M.FLOWER]: BLOOM_R, [M.CAP]: EYE_R }, 0, 0);
}
/** Spikes (lupin, foxglove): leaves at the foot and one to three tall stems crowded with flowers
 * along their top half, smaller toward the tip. */
function spikeDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 0.9, seed),
    R = mulberry(seed),
    stems = Array.from({ length: 3 }, (_, k) => ({ x: ((k * 0.618) % 1) - 0.5, ang: (R() - 0.5) * 0.35, len: k ? 0.65 + 0.25 * R() : 0.9 + 0.1 * R() }));
  if (H <= 3) {
    c.set(0, -1, M.GRASS, 3);
    c.set(0, -2, M.FLOWER, 4);
    if (H >= 3) c.set(0, -3, M.FLOWER, 5);
  } else {
    basal(c, H, R, 6, 0.28);
    stems.slice(0, H < 10 ? 1 : 3).forEach((st) => {
      const x0 = Math.round(st.x * H * 0.25),
        len = st.len * H;
      blade(c, x0, -1, st.ang, len * 0.5, 0, M.GRASS, () => 2);
      for (let s = len * 0.45; s <= len; s += 1) {
        const t = (s - len * 0.45) / (len * 0.55),
          x = Math.round(x0 + Math.sin(st.ang) * s),
          y = Math.round(-1 - Math.cos(st.ang) * s),
          w = Math.round(Math.max(0, H * 0.05 * (1 - 0.75 * t)));
        for (let dx = -w; dx <= w; dx++) c.set(x + dx, y, M.FLOWER, (t > 0.9 ? 6 : 4) + (dx < 0 ? 1 : dx > 0 ? -1 : 0) - (Math.round(s) % 3 === 0 && w ? 1 : 0));
      }
    });
  }
  return c.toImg({ [M.GRASS]: GRASS_R, [M.FLOWER]: BLOOM_R }, 0, 0);
}
/** Umbels (cow parsley, yarrow): stems branching at the top into rays, each ending in a little
 * cluster of tiny white flowers, together a flat-topped head. */
function umbelDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.2, seed),
    R = mulberry(seed),
    stems = Array.from({ length: 3 }, (_, k) => ({ x: ((k * 0.618) % 1) - 0.5, ang: (R() - 0.5) * 0.5, len: k ? 0.7 + 0.2 * R() : 0.95, rays: 5 + Math.floor(R() * 4), wide: 0.22 + 0.1 * R() }));
  if (H <= 3) {
    c.set(0, -1, M.GRASS, 3);
    c.set(0, -2, M.FLOWER, 5);
    if (H >= 3) c.set(1, -2, M.FLOWER, 4);
  } else {
    basal(c, H, R, 4, 0.22);
    stems.slice(0, H < 10 ? 1 : 3).forEach((st) => {
      const x0 = Math.round(st.x * H * 0.3),
        [x, y] = blade(c, x0, -1, st.ang, st.len * H * 0.85, 0, M.GRASS, () => 2),
        span = st.wide * H * (st.len > 0.9 ? 1 : 0.7);
      for (let r = 0; r < st.rays; r++) {
        const u = st.rays > 1 ? r / (st.rays - 1) - 0.5 : 0,
          ex = Math.round(x + u * span * 2),
          ey = Math.round(y - st.len * H * 0.15 * (1 - u * u * 1.2));
        if (H >= 16) blade(c, x, y, Math.atan2(ex - x, -(ey - y)), Math.hypot(ex - x, ey - y), 0, M.GRASS, () => 3);
        const w = H >= 30 ? 1 : 0;
        for (let dx = -w - (H >= 20 ? 1 : 0); dx <= w; dx++) c.set(ex + dx, ey - (H >= 24 ? 1 : 0), M.FLOWER, 6 - (dx > 0 ? 1 : 0));
        c.set(ex, ey, M.FLOWER, 5);
      }
    });
  }
  return c.toImg({ [M.GRASS]: GRASS_R, [M.FLOWER]: UMBEL_R }, 0, 0);
}
/** Cups (poppies, tulips): a few stems, some nodding, each holding up a cup-shaped flower. */
function cupDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.1, seed),
    R = mulberry(seed),
    stems = Array.from({ length: 4 }, (_, k) => ({ x: ((k * 0.618) % 1) - 0.5, ang: (R() - 0.5) * 0.4, len: 0.6 + 0.4 * R(), curl: (R() - 0.5) * 0.25 }));
  if (H <= 3) {
    c.set(0, -1, M.GRASS, 3);
    c.set(0, -2, M.FLOWER, 4);
  } else {
    basal(c, H, R, 4, 0.22);
    stems.slice(0, H < 8 ? 1 : H < 16 ? 3 : 4).forEach((st) => {
      const [x, y] = blade(c, Math.round(st.x * H * 0.35), -1, st.ang, st.len * H, st.curl, M.GRASS, (t) => (t < 0.5 ? 2 : 3)),
        r = H >= 30 ? 2 : H >= 11 ? 1 : 0;
      if (!r) {
        c.set(x, y, M.FLOWER, 4);
        return;
      }
      // A bowl: round below, its open top shadowed inside, lit on the left.
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          if (dx * dx + (dy > 0 ? dy * dy * 1.6 : 0) > (r + 0.7) ** 2) continue;
          c.set(x + dx, y - r + dy, M.FLOWER, dy === -r && Math.abs(dx) <= r - 1 ? 2 : dx < 0 ? 5 : dx > 0 ? 3 : 4);
        }
    });
  }
  return c.toImg({ [M.GRASS]: GRASS_R, [M.FLOWER]: BLOOM_R }, 0, 0);
}
/** Cushion flowers (moss campion, saxifrage): a low, tight cushion of leaves, starred with flowers. */
function cushionDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 3, seed),
    R = mulberry(seed + 21),
    flowers = Array.from({ length: 24 }, () => ({ u: R() * 2 - 1, v: R() }));
  if (H < 4) {
    for (let x = -1; x <= 1; x++) c.set(x, -1, M.LEAF, 3);
    c.set(0, -2, M.FLOWER, 5);
  } else {
    const k = Math.max(0.45, H / 14),
      rx = H * 1.2;
    crownV(c, 0, -H / 2, rx, H / 2, { r0: 0.8 * k, r1: 1.3 * k, density: 3, speckle: 0.5, holes: 0, rag: 1.5 }, seed);
    // Flowers on its upper surface, at fixed places on the dome (so they hold still as it grows).
    for (const { u, v } of flowers.slice(0, Math.min(24, Math.round(H * 1.5)))) {
      const x = Math.round(u * rx * 0.85),
        top = -H * Math.sqrt(Math.max(0, 1 - u * u * 0.85)),
        y = Math.round(top + v * H * 0.45);
      c.set(x, y, M.FLOWER, 5 + (v < 0.3 ? 1 : 0));
      if (H >= 14) c.set(x + 1, y, M.FLOWER, 4);
      if (H >= 24) (c.set(x, y - 1, M.FLOWER, 6), c.set(x + 1, y - 1, M.FLOWER, 5));
    }
  }
  return c.toImg({ [M.LEAF]: MOSS_R, [M.FLOWER]: BLOOM_R }, 0, 0);
}
function fernDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 2, seed);
  if (H < 5) {
    for (let x = -1; x <= 1; x++) c.set(x, -1, M.LEAF, x < 0 ? 4 : 2);
    c.set(0, -2, M.LEAF, 5);
  } else {
    c.R = mulberry(seed);
    fern(c, 0, 0, H);
  }
  return c.toImg({ [M.LEAF]: FERN_R }, 0, 0);
}
function shrubDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.7, seed);
  if (H < 5) {
    for (let x = -1; x <= 1; x++) for (let y = -H; y < 0; y++) c.set(x, y, M.LEAF, 4 - (x > 0 ? 2 : 0) - (y === -1 ? 1 : 0));
  } else {
    const k = Math.max(0.6, H / 14);
    crownV(c, 0, -H / 2, H * 0.7, H / 2, { r0: 2.2 * k, r1: 3.6 * k, density: 1.8, speckle: 0.35, holes: 0 }, seed);
  }
  return c.toImg({ [M.LEAF]: SHRUB_R }, 0, 0);
}
/** Heather: a low, wide cushion of fine leaves in two or three humps. */
function heatherDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 2.8, seed);
  if (H < 4) {
    for (let x = -2; x <= 2; x++) c.set(x, -1, M.LEAF, x < 0 ? 4 : 2);
    if (H >= 3) for (let x = -1; x <= 1; x++) c.set(x, -2, M.LEAF, x < 0 ? 5 : 3);
  } else {
    const R = mulberry(seed + 3),
      k = Math.max(0.5, H / 18),
      n = 2 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * H * 0.75 + (R() - 0.5) * H * 0.3,
        h = H * (i === Math.floor(n / 2) ? 1 : 0.6 + 0.3 * R());
      crownV(c, x, -h / 2, H * (0.6 + 0.2 * R()), h / 2, { r0: 1.2 * k, r1: 2 * k, density: 2.6, speckle: 0.6, holes: 0, rag: 1.4 }, seed + i * 31);
    }
  }
  return c.toImg({ [M.LEAF]: HEATHER_R }, 0, 0);
}
/** Sage: an open bush of small grey leaf clusters on crooked woody stems that show between them. */
function sageDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.8, seed);
  if (H < 5) {
    for (let x = -1; x <= 1; x++) for (let y = -H + 1; y < 0; y++) c.set(x, y, M.LEAF, 4 - (x > 0 ? 2 : 0) - (y === -1 ? 1 : 0));
    c.set(0, -1, M.WOOD, 2);
  } else {
    const R = mulberry(seed + 7),
      k = Math.max(0.5, H / 16),
      n = 3 + Math.floor(R() * 3),
      tips: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (n > 1 ? i / (n - 1) - 0.5 : 0) * 1.7 + (R() - 0.5) * 0.35,
        len = H * (0.6 + 0.3 * R()),
        x1 = Math.sin(a) * len * 0.95,
        y1 = -Math.cos(a) * len;
      branch(c, 0, -1, x1, y1, Math.max(1, Math.round(H / 18)));
      tips.push([x1, y1, R()]);
    }
    tips.forEach(([x, y, r], i) =>
      crownV(c, x, y + H * 0.08, H * (0.2 + 0.1 * r), H * (0.15 + 0.06 * r), { r0: 1.3 * k, r1: 2.2 * k, density: 1.6, speckle: 0.5, holes: 0, rag: 1.5 }, seed + i * 17),
    );
  }
  return c.toImg({ [M.LEAF]: SAGE_R, [M.WOOD]: TWIG_R }, 0, 0);
}
/** A rosette (agave, yucca): stiff sword leaves fanning out from the ground, each lit along its
 * upper edge. With a spike, H is the flower spike's height and the leaves SPIKE_K of it. */
const SPIKE_K = 0.45;
function rosetteDraw(HH: number, seed: number, spike: boolean): Img {
  const H = spike ? Math.max(2, Math.round(HH * SPIKE_K)) : HH,
    { c } = canvasFor(HH, spike ? 0.95 : 2, seed);
  if (H < 4) {
    c.set(-1, -1, M.LEAF, 4);
    c.set(1, -1, M.LEAF, 2);
    c.set(0, -2, M.LEAF, 4);
    if (H >= 3) c.set(0, -3, M.LEAF, 5);
  } else {
    const R = mulberry(seed + 11),
      n = 8 + Math.floor(R() * 5),
      leaves: { a: number; len: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5 + (R() - 0.5) * 0.7) / n - 0.5) * 2.9;
      leaves.push({ a, len: H * (0.65 + 0.35 * R()) * (1 - (0.3 * Math.abs(a)) / 1.45) });
    }
    // The upright ones behind, the spreading ones in front.
    leaves.sort((p, q) => Math.abs(p.a) - Math.abs(q.a));
    const w0 = Math.max(1.2, H * 0.17);
    for (const { a, len } of leaves) {
      const lit = 0.5 - 0.45 * Math.sin(a);
      for (let st = 0; st <= len; st += 0.4) {
        const t = st / len,
          ang = a * (1 + 0.2 * t * t),
          x = Math.sin(ang) * st,
          y = -1 - Math.cos(ang) * st * 0.95,
          half = w0 * (1 - t) * 0.5 + 0.25;
        for (let d = -half; d <= half; d += 0.4) {
          const edge = d < -half + 0.6 ? 1 : d > half - 0.6 ? -1 : 0,
            tone = 1 + Math.round(lit * 3 + t * 1.2) + edge;
          c.set(Math.round(x - Math.cos(ang) * d), Math.round(y - Math.sin(ang) * d), M.LEAF, Math.max(1, Math.min(6, tone)));
        }
      }
    }
    if (spike) {
      const top = -HH,
        x0 = Math.round((R() - 0.5) * H * 0.1);
      branch(c, x0, -Math.round(H * 0.4), x0, top, Math.max(1, Math.round(H / 20)));
      for (let y = top; y < top + H * 0.7; y++) {
        const r = Math.max(1, Math.round(H * 0.14 * Math.sin((Math.PI * (y - top)) / (H * 0.7))));
        for (let x = -r; x <= r; x++) if (hashCell(x, y, seed) < 0.75) c.set(x0 + x, y, M.FLOWER, x < 0 ? 5 : x > 0 ? 3 : 4);
      }
    }
  }
  return c.toImg({ [M.LEAF]: ROSETTE_R, [M.WOOD]: TWIG_R, [M.FLOWER]: SPIKE_R }, 0, 0);
}

// ---- Cacti ---------------------------------------------------------------------------------
/** A ribbed upright stem, cx..: lit on the left, a rib line every other column, round at the top. */
function ribbed(c: MatCanvas, cx: number, y0: number, y1: number, w: number, m: number) {
  const half = Math.max(0.5, w / 2);
  for (let y = Math.round(y1); y <= Math.round(y0); y++) {
    // Rounded top: narrower over its last half-width.
    const fromTop = y - y1,
      hw = fromTop < half ? Math.sqrt(Math.max(0, half * half - (half - fromTop) ** 2)) : half;
    for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) {
      const u = (x - (cx - half)) / (2 * half),
        rib = w >= 5 && Math.round(x - cx) % 2 === 0 ? -1 : 0;
      c.set(x, y, m, Math.max(1, (u < 0.3 ? 5 : u < 0.6 ? 4 : u < 0.85 ? 3 : 2) + rib));
    }
  }
}
/** A saguaro: a tall ribbed column, and up to three arms turning upward. */
function saguaroDraw(H: number, seed: number): Img {
  const R = mulberry(seed),
    { c } = canvasFor(H, 0.8, seed),
    w = Math.max(1, H * 0.13),
    arms = Array.from({ length: R() < 0.2 ? 0 : 1 + Math.floor(R() * 3) }, (_, k) => {
      const at = 0.3 + 0.25 * R();
      return { side: k % 2 ? 1 : -1, at, out: 0.17 + 0.07 * R(), top: Math.min(0.9, at + 0.2 + 0.2 * R()) };
    }),
    bloom = R() < 0.4;
  for (const a of H >= 8 ? arms : []) {
    const aw = Math.max(1, w * 0.7),
      x = a.side * a.out * H,
      y0 = -a.at * H;
    // Out from the trunk (an elbow as thick as the arm), then up.
    for (let k = 0; k <= Math.abs(x); k++) for (let d = -aw / 2; d <= aw / 2; d += 0.5) c.set(a.side * k, Math.round(y0 + d), M.LEAF, d < -aw / 6 ? 5 : d < aw / 4 ? 4 : 3);
    ribbed(c, x, y0 + aw / 2, -a.top * H, aw, M.LEAF);
  }
  ribbed(c, 0, -1, -H, w, M.LEAF);
  if (bloom && H >= 12) for (let k = -1; k <= 1; k++) c.set(k, -H - 1, M.FLOWER, 6 - Math.abs(k));
  return c.toImg({ [M.LEAF]: CACTUS_R, [M.FLOWER]: UMBEL_R }, 0, 0);
}
/** A barrel cactus: a squat ribbed globe, spines along its ribs, a crown of flowers. */
function barrelDraw(H: number, seed: number): Img {
  const R = mulberry(seed),
    { c } = canvasFor(H, 1.2, seed),
    rx = H * 0.42,
    ry = H * 0.5,
    ribs = 7 + Math.floor(R() * 4);
  for (let y = -Math.round(2 * ry); y <= -1; y++)
    for (let x = -Math.round(rx); x <= Math.round(rx); x++) {
      const dx = x / rx,
        dy = (y + ry) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)),
        lam = Math.max(0, -0.55 * dx - 0.7 * dy + 0.45 * nz),
        // Ribs: bands across the globe, by the angle round it.
        rib = H >= 10 && Math.round(((Math.asin(Math.max(-1, Math.min(1, dx))) / Math.PI + 0.5) * ribs * 2)) % 2 === 0;
      c.set(x, y, rib && H >= 16 && hashCell(x, y, seed) < 0.25 ? M.CAP : M.LEAF, 1 + Math.round(lam * 4) - (rib ? 1 : 0));
    }
  if (H >= 8) for (let k = -2; k <= 2; k++) c.set(k, -Math.round(2 * ry) - (Math.abs(k) < 2 ? 1 : 0), M.FLOWER, 5 - Math.abs(k));
  return c.toImg({ [M.LEAF]: CACTUS_R, [M.CAP]: SPINE_R, [M.FLOWER]: CACTUS_BLOOM_R }, 0, 0);
}
/** A prickly pear: flat oval pads growing from the rims of others, dotted with spines, a few fruits. */
function pricklyDraw(H: number, seed: number): Img {
  const R = mulberry(seed),
    { c } = canvasFor(H, 1.4, seed),
    pads: { x: number; y: number; a: number; s: number }[] = [{ x: 0, y: -0.25, a: 0, s: 1 }];
  for (let k = 1; k < 8; k++) {
    const p = pads[Math.floor(R() * pads.length)],
      a = p.a + (R() - 0.5) * 1.4,
      s = p.s * (0.75 + 0.2 * R());
    pads.push({ x: p.x + Math.sin(a) * 0.32 * p.s, y: p.y - Math.cos(a) * 0.32 * p.s, a, s });
  }
  const kept = pads.filter((p) => p.y - 0.25 * p.s > -1);
  for (const p of kept.slice(0, H < 8 ? 2 : kept.length)) {
    const rx = 0.17 * p.s * H,
      ry = 0.25 * p.s * H,
      ca = Math.cos(p.a),
      sa = Math.sin(p.a);
    for (let y = Math.floor(p.y * H - ry - 1); y <= Math.ceil(p.y * H + ry + 1); y++)
      for (let x = Math.floor(p.x * H - ry - 1); x <= Math.ceil(p.x * H + ry + 1); x++) {
        const lx = x - p.x * H,
          ly = y - p.y * H,
          u = (lx * ca + ly * sa) / Math.max(0.6, rx),
          v = (-lx * sa + ly * ca) / Math.max(0.6, ry);
        if (u * u + v * v > 1) continue;
        const tone = 1 + Math.round(Math.max(0, 0.6 - 0.45 * u - 0.35 * v) * 5);
        c.set(x, y, H >= 16 && hashCell(Math.round(u * 6), Math.round(v * 6), seed) < 0.12 && (Math.round(u * 6) + Math.round(v * 6)) % 2 === 0 ? M.CAP : M.LEAF, tone);
      }
    // A fruit or two on the rim.
    if (H >= 12 && R() < 0.4) c.set(Math.round(p.x * H - sa * ry), Math.round(p.y * H - ca * ry) - 1, M.FLOWER, 4);
  }
  return c.toImg({ [M.LEAF]: CACTUS_R, [M.CAP]: SPINE_R, [M.FLOWER]: PEAR_R }, 0, 0);
}

// ---- People: drawn in colours directly -------------------------------------------------------
type RGB = [number, number, number];
class Px {
  data: Uint8ClampedArray;
  constructor(public w: number, public h: number, public ox: number, public oy: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB) {
    const px = Math.round(x) + this.ox,
      py = Math.round(y) + this.oy;
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    const o = (py * this.w + px) * 4;
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = 255;
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.set(x0 + x, y0 + y, c);
  }
  /** A dark outline around everything drawn, so a figure reads against busy ground. */
  outline(c: RGB) {
    const a = new Uint8Array(this.w * this.h);
    for (let i = 0; i < a.length; i++) a[i] = this.data[i * 4 + 3] ? 1 : 0;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (a[y * this.w + x]) continue;
        const n = (x > 0 && a[y * this.w + x - 1]) || (x < this.w - 1 && a[y * this.w + x + 1]) || (y > 0 && a[(y - 1) * this.w + x]) || (y < this.h - 1 && a[(y + 1) * this.w + x]);
        if (n) {
          const o = (y * this.w + x) * 4;
          this.data[o] = c[0]; this.data[o + 1] = c[1]; this.data[o + 2] = c[2]; this.data[o + 3] = 255;
        }
      }
  }
  toImg(fx: number, fy: number): Img {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.data[(y * this.w + x) * 4 + 3]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    if (x1 < 0) return { w: 1, h: 1, ax: 0, ay: 1, data: new Uint8ClampedArray(4) };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) data.set(this.data.subarray(((y + y0) * this.w + x0) * 4, ((y + y0) * this.w + x0 + w) * 4), y * w * 4);
    return { w, h, ax: fx + this.ox - x0, ay: fy + this.oy - y0, data };
  }
}
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k].map((v) => Math.max(0, Math.min(255, v))) as RGB;

export interface Look {
  tunic: RGB;
  hair: RGB;
  legs: RGB;
  hat?: RGB;
  staff?: boolean;
  pack?: boolean;
}
export const PARTY: Look[] = [
  { tunic: [181, 69, 46], hair: [60, 42, 30], legs: [70, 58, 48], pack: true, staff: true },
  { tunic: [61, 111, 160], hair: [30, 26, 24], legs: [64, 56, 52], pack: true, hat: [120, 92, 60] },
  { tunic: [200, 160, 64], hair: [140, 70, 40], legs: [84, 66, 50], pack: true },
  { tunic: [90, 122, 58], hair: [170, 168, 160], legs: [66, 60, 50], pack: true, hat: [74, 90, 60] },
];
const SKIN: RGB = [226, 178, 136],
  INK: RGB = [36, 30, 28],
  PACK: RGB = [138, 104, 66],
  ROLL: RGB = [196, 184, 150],
  WOOD: RGB = [120, 86, 54];

/** A walking figure H px tall: facing 0 side (to the right), 1 toward the viewer, 2 away; frame 0-3 of the stride. */
export function person(H: number, facing: number, frame: number, look: Look): Img {
  const p = new Px(H + 12, H + 8, Math.floor((H + 12) / 2), H + 4),
    stride = frame === 0 ? 1 : frame === 2 ? -1 : 0,
    bob = frame === 1 || frame === 3 ? 1 : 0;
  if (H < 5) {
    // A stroke: head, body, legs.
    p.set(0, -H, facing === 2 ? look.hair : SKIN);
    for (let y = -H + 1; y < -1; y++) p.set(0, y, look.tunic);
    p.set(stride !== 0 ? stride * (facing === 0 ? 1 : 0) : 0, -1, look.legs);
    if (H >= 4 && look.pack && facing !== 1) p.set(facing === 0 ? -1 : 0, -H + 2, PACK);
    return p.toImg(0, 0);
  }
  if (H < 9) {
    const top = -H + bob,
      head = H >= 7 ? 2 : 1,
      body = Math.round(H * 0.45);
    for (let y = 0; y < head; y++) for (let x = 0; x < 2; x++) p.set(x - 1, top + y, y === 0 ? (look.hat ?? look.hair) : facing === 2 ? look.hair : SKIN);
    for (let y = top + head; y < top + head + body; y++) for (let x = -1; x <= (facing === 0 ? 0 : 1) - 1 + (facing === 0 ? 0 : 1); x++) p.set(x, y, x < 0 ? look.tunic : shade(look.tunic, 0.8));
    if (look.pack && facing !== 1) for (let y = top + head; y < top + head + body - 1; y++) p.set(facing === 0 ? -2 : 0, y, facing === 0 ? PACK : PACK);
    for (let y = top + head + body; y < 0; y++) {
      if (facing === 0) {
        p.set(-1 + (y > -3 ? stride : 0), y, look.legs);
        p.set(0 - (y > -3 ? stride : 0), y, shade(look.legs, 0.75));
      } else {
        p.set(-1, y - (frame === 1 && y === -1 ? 1 : 0), look.legs);
        p.set(0, y - (frame === 3 && y === -1 ? 1 : 0), look.legs);
      }
    }
    if (look.staff && facing === 0) for (let y = top - 1; y < 0; y++) p.set(1, y, WOOD);
    return p.toImg(0, 0);
  }
  // Proportions.
  const headH = Math.max(2, Math.round(H * 0.16)),
    headW = Math.max(2, Math.round(H * 0.14)),
    torsoH = Math.round(H * 0.38),
    torsoW = Math.max(3, Math.round(H * 0.24)),
    legH = H - headH - torsoH,
    legW = Math.max(1, Math.round(H * 0.075)),
    top = -H + bob,
    neck = top + headH,
    hip = neck + torsoH,
    tl = -Math.floor(torsoW / 2);
  // Legs: a step forward and back, boots darker.
  const stepX = Math.round(H * 0.1) * stride,
    boot = shade(look.legs, 0.6);
  const leg = (x0: number, dx: number, lift: number, c: RGB) => {
    for (let y = hip; y < -lift; y++) {
      const t = (y - hip) / Math.max(1, legH),
        x = Math.round(x0 + dx * t);
      for (let d = 0; d < legW; d++) p.set(x + d, y, y >= -Math.max(1, Math.round(H * 0.06)) - lift ? boot : c);
    }
  };
  if (facing === 0) {
    leg(-Math.floor(legW / 2) - 0, -stepX, frame === 3 ? 1 : 0, shade(look.legs, 0.75));
    leg(-Math.floor(legW / 2), stepX, frame === 1 ? 1 : 0, look.legs);
  } else {
    leg(-legW - (H >= 14 ? 0 : 0), 0, frame === 1 ? 1 : 0, look.legs);
    leg(Math.max(1, Math.round(legW * 0.3)), 0, frame === 3 ? 1 : 0, shade(look.legs, 0.85));
  }
  // The torso: lit on the left, a belt.
  for (let y = neck; y < hip; y++)
    for (let x = tl; x < tl + torsoW; x++) {
      const u = (x - tl) / torsoW;
      p.set(x, y, y === hip - Math.max(1, Math.round(H * 0.06)) ? shade(look.tunic, 0.55) : u < 0.35 ? shade(look.tunic, 1.12) : u > 0.8 ? shade(look.tunic, 0.78) : look.tunic);
    }
  // The pack, with a bedroll on top.
  if (look.pack && facing !== 1) {
    const pw = facing === 0 ? Math.max(2, Math.round(H * 0.14)) : torsoW,
      px0 = facing === 0 ? tl - pw + 1 : tl,
      py0 = neck + (facing === 0 ? 0 : 0),
      ph = Math.round(torsoH * 0.8);
    for (let y = py0; y < py0 + ph; y++) for (let x = px0; x < px0 + pw; x++) p.set(x, y, x === px0 ? shade(PACK, 1.15) : PACK);
    const rh = Math.max(1, Math.round(H * 0.06));
    for (let y = py0 - rh; y < py0; y++) for (let x = px0 - (facing === 0 ? 1 : 0); x < px0 + pw + (facing === 0 ? 1 : 0); x++) p.set(x, y, y === py0 - rh ? shade(ROLL, 1.08) : ROLL);
  }
  if (look.pack && facing === 1) for (let y = neck; y < neck + Math.round(torsoH * 0.6); y++) { p.set(tl, y, shade(PACK, 0.9)); p.set(tl + torsoW - 1, y, shade(PACK, 0.9)); }
  // Arms: swinging against the stride (side), at the sides (front, back).
  const armC = shade(look.tunic, 0.82),
    armLen = Math.round(torsoH * 0.95);
  if (facing === 0) {
    for (let k = 0; k < armLen; k++) p.set(Math.round(-stride * (k / armLen) * H * 0.08) + 0, neck + 1 + k, k > armLen - 2 ? SKIN : armC);
  } else
    for (let k = 0; k < armLen; k++) {
      p.set(tl - 1, neck + 1 + k + (frame === 1 ? 1 : 0), k > armLen - 2 ? SKIN : armC);
      p.set(tl + torsoW, neck + 1 + k + (frame === 3 ? 1 : 0), k > armLen - 2 ? SKIN : armC);
    }
  // The head: hair, face, a hat.
  const hl = -Math.floor(headW / 2) + (facing === 0 ? 1 : 0);
  for (let y = top; y < neck; y++)
    for (let x = hl; x < hl + headW; x++) {
      const back = facing === 2 || y === top || (facing === 0 && x === hl);
      p.set(x, y, back ? look.hair : SKIN);
    }
  if (facing === 1 && H >= 14) { p.set(hl + Math.floor(headW / 2) - 1, top + Math.round(headH * 0.5), INK); p.set(hl + Math.floor(headW / 2) + (headW > 3 ? 1 : 0), top + Math.round(headH * 0.5), INK); }
  if (facing === 0 && H >= 12) p.set(hl + headW - 1, top + Math.round(headH * 0.5), INK);
  if (look.hat) {
    const brim = H >= 12 ? 1 : 0;
    for (let x = hl - brim; x < hl + headW + brim; x++) p.set(x, top, look.hat);
    for (let x = hl; x < hl + headW; x++) p.set(x, top - 1, shade(look.hat, 1.1));
  }
  if (look.staff) {
    const sx = facing === 0 ? tl + torsoW + 1 : tl + torsoW + 1;
    for (let y = top - Math.round(H * 0.1); y < 0; y++) p.set(sx, y, y < top + 1 ? shade(WOOD, 1.2) : WOOD);
  }
  if (H >= 10) p.outline(INK);
  return p.toImg(0, 0);
}


// ---- The slots ----------------------------------------------------------------------------
export const COVER = ["grass", "grass2", "dry grass", "fern", "fern2", "shrub", "shrub2"];
const COVER_H = [0.35, 0.3, 0.4, 0.8, 0.7, 1.5, 1.2];
/** Grasses and flowers beyond the plain tuft, a few drawings each; `blob`: a mound (grown from one
 * drawing like a shrub) rather than strokes (drawn at each size). */
export const HERB_KINDS = [
  { kind: "tallgrass", n: 3, worldH: 0.9, blob: false, draw: tallgrassDraw },
  { kind: "sedge", n: 2, worldH: 0.5, blob: false, draw: sedgeDraw },
  { kind: "reed", n: 2, worldH: 1.8, blob: false, draw: reedDraw },
  { kind: "moss", n: 2, worldH: 0.15, blob: true, draw: mossDraw },
  { kind: "daisy", n: 2, worldH: 0.35, blob: false, draw: daisyDraw },
  { kind: "spike", n: 2, worldH: 0.75, blob: false, draw: spikeDraw },
  { kind: "umbel", n: 2, worldH: 0.8, blob: false, draw: umbelDraw },
  { kind: "cup", n: 2, worldH: 0.45, blob: false, draw: cupDraw },
  { kind: "cushion", n: 2, worldH: 0.12, blob: true, draw: cushionDraw },
  // Cacti, as the biomes name them (cactusKinds).
  { kind: "saguaro", n: 3, worldH: 6, blob: true, draw: saguaroDraw },
  { kind: "barrel", n: 2, worldH: 0.7, blob: true, draw: barrelDraw },
  { kind: "pricklypear", n: 2, worldH: 1.2, blob: true, draw: pricklyDraw },
];

/** Bushes beyond the plain shrub, by the names the biomes give them (biomes.ts `bushes`). */
export const PLANT_KINDS = [
  { kind: "heather", n: 3, worldH: 0.45 },
  { kind: "sage", n: 3, worldH: 0.9 },
  { kind: "rosette", n: 3, worldH: 0.7 },
];
/** Families placed as one (any of their drawings, as they come): rocks and bushes, by kind. */
export function familyOf(name: string) {
  const kind = name.split(" ")[0];
  return ROCK_KINDS.some((r) => r.kind === kind) || PLANT_KINDS.some((p) => p.kind === kind) || HERB_KINDS.some((p) => p.kind === kind) ? kind : name;
}

export function slotDefs(): SlotDef[] {
  const out: SlotDef[] = [];
  for (const { name, n } of TREE_KINDS)
    for (let v = 0; v < n; v++) out.push({ name: `${name} ${v}`, worldH: 20, maxClass: NC - 1, sunFlip: true, draw: (H, s) => treeDraw(name)(H, s + v * 7919) });
  COVER.forEach((name, k) => {
    const draw = (H: number, s: number): Img => {
      if (name === "dry grass") return grass(H, s, true);
      if (name.startsWith("grass")) return grass(H, s + (name === "grass2" ? 31 : 0), false);
      if (name.startsWith("fern")) return fernDraw(H, s + (name === "fern2" ? 17 : 0));
      return shrubDraw(H, s + (name === "shrub2" ? 23 : 0));
    };
    out.push({ name, worldH: COVER_H[k], maxClass: 18, sunFlip: true, draw });
  });
  // Bushes of their own kinds (as the biomes name them), a few drawings each.
  PLANT_KINDS.forEach(({ kind, n, worldH }, f) => {
    for (let v = 0; v < n; v++)
      out.push({
        // (A yucca in flower is as tall as its spike.)
        name: `${kind} ${v}`, worldH: kind === "rosette" && v === n - 1 ? worldH / SPIKE_K : worldH, maxClass: 18, sunFlip: true,
        draw: (H) => {
          const sd = 503 + f * 1013 + v * 41;
          return kind === "heather" ? heatherDraw(H, sd) : kind === "sage" ? sageDraw(H, sd) : rosetteDraw(H, sd, v === n - 1);
        },
      });
  });
  HERB_KINDS.forEach(({ kind, n, worldH, draw }, f) => {
    for (let v = 0; v < n; v++) out.push({ name: `${kind} ${v}`, worldH, maxClass: 18, sunFlip: true, draw: (H) => draw(H, 907 + f * 1031 + v * 53) });
  });
  // Rocks: each family a few drawings, each its own shape (rocks.ts); its seed fixed by family and
  // number, so adding slots elsewhere never changes a rock.
  ROCK_KINDS.forEach(({ kind, n, worldH }, f) => {
    for (let v = 0; v < n; v++)
      out.push({
        name: `${kind} ${v}`, worldH, maxClass: 18, sunFlip: true,
        draw: (H) => {
          useRamps({ [M.ROCK]: ROCK_R });
          return rockImg(kind, 101 + f * 1009 + v * 37, H, M.ROCK, isIndexMode(), ROCK_R);
        },
      });
  });
  PARTY.forEach((look, m) => {
    for (let f = 0; f < 3; f++) for (let fr = 0; fr < 4; fr++) out.push({ name: `person ${m} ${f} ${fr}`, worldH: 1.75, maxClass: 15, sunFlip: false, draw: (H) => person(H, f, fr, look) });
  });
  // The party marker: a small caret, the same at every size.
  out.push({
    name: "marker", worldH: 1, maxClass: 0, sunFlip: false,
    draw: () => {
      // A yellow arrow pointing down at the leader, outlined so it reads on sky and land alike.
      const p = new Px(13, 9, 6, 7);
      for (let k = 0; k < 4; k++) for (let x = -3 + k; x <= 3 - k; x++) p.set(x, -5 + k, k === 0 && x < 0 ? [255, 232, 120] : [244, 200, 64]);
      for (let y = -7; y < -5; y++) for (let x = -1; x <= 1; x++) p.set(x, y, [244, 200, 64]);
      p.outline([40, 30, 20]);
      return p.toImg(0, 0);
    },
  });
  return out;
}
/** Slot numbers by name, for placing things. */
export function slotIndex() {
  const m = new Map<string, number>();
  slotDefs().forEach((s, i) => m.set(s.name, i));
  return m;
}

/** Draw some slots at all their classes (in a worker). */
export function drawSlots(from: number, to: number) {
  const defs = slotDefs(),
    out: { slot: number; imgs: Img[] }[] = [];
  for (let s = from; s < Math.min(to, defs.length); s++) {
    const d = defs[s],
      imgs: Img[] = [];
    for (let k = 0; k <= d.maxClass; k++) imgs.push(d.draw(CLASS_H[k], 1000 + s * 131));
    out.push({ slot: s, imgs });
  }
  return out;
}
