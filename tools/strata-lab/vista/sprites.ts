// Vista sprites: every sprite drawn natively at every size it is shown at,
// so a tree 6 px tall far off is a crafted 6 px tree, not a 200 px tree
// shrunk to mush. Sizes come in classes a quarter-octave apart, 3 px to
// about 230 px tall; the renderer picks the class nearest the size the
// thing would be on screen and draws it pixel for pixel.
//
// Big broadleaf trees come from the forest slice's drawing code (art.ts:
// crowns heaped from shaded leaf clumps); small ones, conifers, people,
// ground cover, the ox and the cart are drawn here.
import { M } from "../../../engine/strata/world";
import { TREES, type Canvas, type CrownStyle, type TreeKind, boulder, branch, crown, fern, shrub, tree, trunk } from "../../../engine/strata/art";
import { hex, rampOf } from "./color";
import { mulberry } from "./valley";

/** Pixel heights of the size classes. */
export const NC = 26;
export const CLASS_H = Array.from({ length: NC }, (_, k) => Math.round(3 * 2 ** (k / 4)));

export interface Img {
  w: number;
  h: number;
  /** Where the thing stands (its foot), in the image's pixels: x, and the row just below its lowest. */
  ax: number;
  ay: number;
  data: Uint8ClampedArray;
}
export interface SlotDef {
  name: string;
  /** Its height in the world, metres (what the size class is chosen by). */
  worldH: number;
  /** The largest class drawn; bigger on screen uses this one. */
  maxClass: number;
  /** Flip with the sun (things lit from the upper left). */
  sunFlip: boolean;
  draw: (H: number, seed: number) => Img;
}

// ---- Drawing in materials and tones, then colouring ---------------------------------------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const hashCell = (x: number, y: number, s: number) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

class MatCanvas implements Canvas {
  m: Uint8Array;
  t: Uint8Array;
  R: () => number;
  constructor(public w: number, public h: number, public ox: number, public oy: number, seed: number) {
    this.m = new Uint8Array(w * h);
    this.t = new Uint8Array(w * h);
    this.R = mulberry(seed);
  }
  set(x: number, y: number, m: number, tone: number) {
    const px = Math.round(x) + this.ox,
      py = Math.round(y) + this.oy;
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    const i = py * this.w + px;
    this.m[i] = m;
    this.t[i] = Math.max(1, Math.min(6, Math.round(tone)));
  }
  /** Crop to what was drawn and colour it, each material by its ramp. The foot at (fx, fy) in drawing coordinates. */
  toImg(ramps: Record<number, number[][]>, fx: number, fy: number): Img {
    let x0 = this.w,
      y0 = this.h,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.m[y * this.w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return { w: 1, h: 1, ax: 0, ay: 1, data: new Uint8ClampedArray(4) };
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1,
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y + y0) * this.w + x + x0,
          m = this.m[i];
        if (!m) continue;
        const ramp = ramps[m] ?? ramps[M.LEAF],
          c = ramp[this.t[i] - 1],
          o = (y * w + x) * 4;
        data[o] = c[0] * 255;
        data[o + 1] = c[1] * 255;
        data[o + 2] = c[2] * 255;
        data[o + 3] = 255;
      }
    return { w, h, ax: fx + this.ox - x0, ay: fy + this.oy - y0, data };
  }
}
const canvasFor = (H: number, wide: number, seed: number) => {
  const w = Math.ceil(H * wide) + 16,
    h = H + 16;
  return { c: new MatCanvas(w, h, Math.floor(w / 2), h - 4, seed), foot: [0, 0] as [number, number] };
};

// ---- Trees ---------------------------------------------------------------------------------
const LEAF: Record<string, string> = {
  oak: "#4a7428", beech: "#5d8a2e", maple: "#527c2a", birch: "#86a23e",
  spruce: "#24402f", fir: "#2a4a3a", pine: "#2f4a2c",
};
const BARK: Record<string, string> = {
  oak: "#5a4636", beech: "#8a8478", maple: "#5e4c3e", birch: "#e4e0d4",
  spruce: "#4a3a2e", fir: "#4a3a30", pine: "#9a6040",
};
const rampsFor = (name: string) => ({
  [M.LEAF]: rampOf(hex(LEAF[name])),
  [M.WOOD]: rampOf(hex(BARK[name])),
  [M.ROCK]: rampOf(hex("#8a8478")),
});

/** A broadleaf tree at its full drawing (art.ts), exactly H px tall, its leaf masses sized to it. */
function bigBroadleaf(name: string, H: number, seed: number): Img {
  const k = TREES[name],
    base = (k.h0 + k.h1) / 2,
    s = H / base,
    cs = Math.max(0.55, Math.sqrt(s)),
    kind: TreeKind = {
      ...k,
      h0: H,
      h1: H,
      w0: Math.max(1, k.w0 * s),
      w1: Math.max(1, k.w1 * s),
      style: { ...k.style, r0: Math.max(1.6, k.style.r0 * cs), r1: Math.max(2.2, k.style.r1 * cs) },
    };
  const { c } = canvasFor(H, 1.3, seed);
  tree(c, kind, 0, 0, 1);
  return c.toImg(rampsFor(name), 0, 0);
}

/** A small broadleaf tree: its crown's shape lit as a whole, a few speckles, its trunk. */
function smallBroadleaf(name: string, H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.1, seed),
    R = c.R,
    shape: Record<string, number[]> = { oak: [0.44, 0.3, 0.6], beech: [0.3, 0.4, 0.58], maple: [0.34, 0.32, 0.62], birch: [0.17, 0.34, 0.62] },
    [fx, fy, fc] = shape[name],
    rx = Math.max(1, fx * H),
    ry = Math.max(1, fy * H),
    cy = -fc * H,
    lobes = [{ x: 0, y: cy, rx, ry }];
  if (name === "oak" && H >= 10) for (const sd of [-1, 1]) lobes.push({ x: sd * rx * 0.55, y: cy + ry * 0.35, rx: rx * 0.55, ry: ry * 0.6 });
  // The trunk, seen below the crown.
  const tw = H >= 16 ? 2 : 1;
  for (let y = -1; y > cy; y--) for (let d = 0; d < tw; d++) c.set(d - (tw > 1 ? 1 : 0), y, M.WOOD, d === 0 ? 3 : 1);
  const salt = Math.floor(R() * 1e6);
  for (const l of lobes)
    for (let y = Math.floor(l.y - l.ry - 1); y <= Math.ceil(l.y + l.ry + 1); y++)
      for (let x = Math.floor(l.x - l.rx - 1); x <= Math.ceil(l.x + l.rx + 1); x++) {
        const dx = (x + 0.5 - l.x) / l.rx,
          dy = (y + 0.5 - l.y) / l.ry,
          ang = Math.atan2(dy, dx),
          rag = H >= 8 ? 1 + 0.12 * Math.sin(ang * 6 + salt) : 1,
          d = Math.hypot(dx, dy) / rag;
        if (d > 1) continue;
        const nz = Math.sqrt(Math.max(0, 1 - d * d)),
          lam = Math.max(0, -0.55 * dx - 0.7 * dy + 0.45 * nz);
        let t = 1 + Math.floor(lam * 4.2 + 1 + bay(x, y) - 0.4);
        if (d > 0.78 && dx * -0.55 + dy * -0.7 < 0) t -= 1;
        if (H >= 10 && t >= 4 && hashCell(x, y, salt) > 0.86) t = 6;
        if (H >= 12 && d < 0.85 && hashCell(x, y, salt + 1) < 0.05) t = Math.max(1, t - 2);
        c.set(x, y, M.LEAF, t);
      }
  return c.toImg(rampsFor(name), 0, 0);
}

/** A conifer: tiers of drooping branches up to a spire, lit on the left, each tier's underside in shadow. */
function conifer(name: string, H: number, seed: number): Img {
  const { c } = canvasFor(H, 0.8, seed),
    R = c.R,
    wide = name === "fir" ? 0.5 : 0.42,
    W = Math.max(2, H * wide),
    trunkH = Math.max(1, Math.round(H * (H < 8 ? 0.14 : 0.1))),
    crownH = H - trunkH,
    tiers = Math.max(2, Math.round(H / (H < 20 ? 4 : 6.5))),
    salt = Math.floor(R() * 1e6);
  for (let y = -1; y >= -trunkH - 1; y--) c.set(0, y, M.WOOD, 2);
  if (H >= 30) for (let y = -1; y >= -trunkH; y--) c.set(-1, y, M.WOOD, 3);
  for (let r = 0; r < crownH; r++) {
    const y = -H + r,
      t = (r + 0.5) / crownH,
      tp = t * tiers,
      tf = tp - Math.floor(tp),
      tier = Math.floor(tp),
      // Each tier flares toward its lower edge, its tips drooping.
      half = (W / 2) * (0.12 + 0.88 * t) * (0.72 + 0.36 * tf) + (H >= 14 ? (hashCell(tier, r, salt) - 0.5) * 1.2 : 0),
      xa = Math.round(-half),
      xb = Math.round(half);
    for (let x = xa; x <= xb; x++) {
      const u = x / Math.max(1, half),
        v = 0.62 - 0.42 * u - 0.3 * tf + 0.12 * (1 - t);
      let tone = 1 + Math.floor(v * 5 + bay(x, y) - 0.2);
      if (tf > 0.86 && H >= 10) tone -= 1; // the shadow under each tier
      if (Math.abs(u) > 0.85 && H >= 12) tone -= u > 0 ? 1 : 0;
      if (H >= 16 && tone >= 4 && hashCell(x, y, salt) > 0.9) tone = 6;
      if (H >= 24 && hashCell(x, y, salt + 3) < 0.06) tone -= 1;
      c.set(x, y, M.LEAF, tone);
    }
  }
  return c.toImg(rampsFor(name), 0, 0);
}

/** A pine: a tall warm trunk and a few flat clouds of needles at the top. */
function pine(H: number, seed: number): Img {
  const { c } = canvasFor(H, 0.9, seed),
    R = c.R,
    trunkTop = -Math.round(H * 0.62),
    tw = Math.max(1, Math.round(H / 22)),
    lean = (R() - 0.5) * H * 0.08;
  for (let y = -1; y >= trunkTop; y--) {
    const t = y / trunkTop,
      x = Math.round(lean * t * t);
    for (let d = 0; d < tw; d++) c.set(x + d, y, M.WOOD, d === 0 && tw > 1 ? 4 : 2);
  }
  const n = H < 10 ? 1 : 2 + Math.floor(R() * 3),
    salt = Math.floor(R() * 1e6);
  for (let k = 0; k < n; k++) {
    const cx = lean + (k === 0 ? 0 : (R() - 0.5) * H * 0.42),
      cy = trunkTop - H * (0.06 + 0.25 * (k === 0 ? 1 : R())),
      rx = Math.max(1.2, H * (k === 0 ? 0.2 : 0.13 + 0.05 * R())),
      ry = Math.max(1, rx * 0.42);
    if (k > 0 && H >= 16) for (let s = 0; s <= 1; s += 0.05) c.set(Math.round(lean + (cx - lean) * s), Math.round(trunkTop - (trunkTop - cy) * s * 0.7), M.WOOD, 2);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx,
          dy = (y + 0.5 - cy) / ry,
          d = Math.hypot(dx, dy * (dy < 0 ? 1.25 : 1));
        if (d > 1 || (H >= 12 && d > 0.75 && hashCell(x, y, salt) < 0.3)) continue;
        let tone = 1 + Math.floor((0.62 - 0.3 * dx - 0.5 * dy) * 4.6 + bay(x, y) - 0.3);
        if (H >= 16 && tone >= 4 && hashCell(x, y, salt + 1) > 0.88) tone = 6;
        c.set(x, y, M.LEAF, tone);
      }
  }
  return c.toImg(rampsFor("pine"), 0, 0);
}

/** A big conifer: drooping tiers of needle masses down a straight trunk, a narrow spire at the top. */
function bigConifer(name: string, H: number, seed: number): Img {
  const { c } = canvasFor(H, 0.9, seed),
    R = c.R,
    s = H / 60,
    cs = Math.sqrt(s),
    st: CrownStyle = { r0: 2.4 * cs, r1: 3.8 * cs, density: 2.4, speckle: 0.3, holes: 0.06, needles: true, rag: 1.5 },
    W = H * (name === "fir" ? 0.48 : 0.4),
    base = Math.round(H * 0.08);
  trunk(c, 0, -1, H - 2, Math.max(1, H * 0.035), 1, 0, { cracks: 0.3 });
  // Tiers from the bottom up, so the upper ones sit over the lower.
  const tiers = Math.max(5, Math.round(H / 11));
  for (let k = tiers - 1; k >= 0; k--) {
    const t = (k + 0.6) / tiers, // 0 at the top, 1 at the bottom
      y = -H + t * (H - base),
      w = (W / 2) * (0.1 + 0.9 * t) * (0.85 + 0.3 * R()),
      th = ((H - base) / tiers) * 1.05;
    // Branch masses either side, drooping toward their tips; a smaller one over the trunk.
    for (const side of [-1, 1]) {
      const n = w > 10 * cs ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const u = n === 1 ? 0.55 : 0.35 + 0.45 * j,
          x = side * w * u,
          droop = th * 0.35 * u * u;
        crown(c, x, y + droop, Math.max(1.5, w * (n === 1 ? 0.5 : 0.36)), Math.max(1.2, th * 0.5), st);
      }
    }
    crown(c, 0, y - th * 0.15, Math.max(1.2, w * 0.35), Math.max(1.2, th * 0.55), st);
  }
  // The spire.
  crown(c, 0, -H + H * 0.05, Math.max(1, W * 0.05), Math.max(1.5, H * 0.06), st);
  return c.toImg(rampsFor(name), 0, 0);
}

/** A big pine: a leaning trunk, warm above, limbs out to flat, ragged pads of needles. */
function bigPine(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.1, seed),
    R = c.R,
    s = H / 60,
    cs = Math.sqrt(s),
    st: CrownStyle = { r0: 2.6 * cs, r1: 4.2 * cs, density: 2.0, speckle: 0.35, holes: 0.12, needles: true, rag: 1.6 },
    top = trunk(c, 0, -1, Math.round(H * 0.7), Math.max(1, H * 0.045), Math.max(1, H * 0.02), (R() - 0.5) * H * 0.12, { cracks: 0.6 }),
    pads = 3 + Math.floor(R() * 3);
  const list: { x: number; y: number; rx: number; ry: number }[] = [{ x: top.x, y: -H + H * 0.08, rx: H * 0.17, ry: H * 0.07 }];
  for (let k = 1; k < pads; k++) {
    const side = k % 2 ? -1 : 1,
      y0 = top.y + H * (0.05 + 0.18 * R()),
      ex = top.x + side * H * (0.14 + 0.16 * R()),
      ey = y0 - H * (0.06 + 0.1 * R());
    branch(c, top.x, y0, ex, ey, Math.max(1, Math.round(H * 0.02)));
    list.push({ x: ex, y: ey - H * 0.02, rx: H * (0.1 + 0.06 * R()), ry: H * (0.045 + 0.02 * R()) });
  }
  list.sort((a, b) => a.y - b.y);
  for (const p of list) crown(c, p.x, p.y, Math.max(2, p.rx), Math.max(1.5, p.ry), st);
  return c.toImg(rampsFor("pine"), 0, 0);
}

function treeDraw(name: string) {
  return (H: number, seed: number) => {
    if (name === "spruce" || name === "fir") return H >= 26 ? bigConifer(name, H, seed) : conifer(name, H, seed);
    if (name === "pine") return H >= 26 ? bigPine(H, seed) : pine(H, seed);
    return H >= 24 ? bigBroadleaf(name, H, seed) : smallBroadleaf(name, H, seed);
  };
}

// ---- Ground cover --------------------------------------------------------------------------
const GRASS_R = rampOf(hex("#6f9a3c")),
  DRY_R = rampOf(hex("#a6a05a")),
  ROCK_R = rampOf(hex("#8c867c")),
  MOSS_R = rampOf(hex("#5a7a34")),
  FERN_R = rampOf(hex("#4f8a34")),
  SHRUB_R = rampOf(hex("#4d7a30")),
  BLOOM: Record<string, number[][]> = {
    white: rampOf(hex("#e8e4d8")),
    yellow: rampOf(hex("#e2c040")),
    purple: rampOf(hex("#8a64b0")),
    red: rampOf(hex("#c4503c")),
  };

/** A grass clump: blades fanning from one root, dark at the base, lit at the tips; blooms if given. */
function grass(H: number, seed: number, dry: boolean, bloom?: string): Img {
  const { c } = canvasFor(H, 1.2, seed),
    R = c.R,
    n = Math.max(2, Math.min(42, Math.round(H * 0.9)));
  if (H <= 3) {
    c.set(0, -1, M.GRASS, 3);
    if (H >= 3) { c.set(-1, -1, M.GRASS, 2); c.set(0, -2, M.GRASS, 4); c.set(1, -2, M.GRASS, 5); }
  } else
    for (let k = 0; k < n; k++) {
      const lean = ((k / (n - 1)) * 2 - 1) * (0.5 + 0.3 * R()),
        len = H * (0.55 + 0.45 * R()),
        bend = (R() - 0.3) * 0.5;
      for (let s = 0; s < len; s++) {
        const t = s / len,
          x = Math.round(lean * s * 0.55 + bend * t * t * len * 0.5),
          y = -1 - s;
        c.set(x, y, M.GRASS, t < 0.25 ? 2 : t < 0.6 ? 3 : t < 0.85 ? 4 : 5);
      }
    }
  if (bloom) {
    const heads = H < 6 ? 1 : 1 + Math.floor(R() * 3);
    for (let k = 0; k < heads; k++) {
      const x = Math.round((R() - 0.5) * H * 0.6),
        y = -Math.round(H * (0.75 + 0.3 * R())),
        r = H >= 12 ? 1 : 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) c.set(x + dx, y + dy, M.FLOWER, dx < 0 || dy < 0 ? 5 : 3);
      if (r) c.set(x, y, M.FLOWER, 6);
    }
  }
  return c.toImg({ [M.GRASS]: dry ? DRY_R : GRASS_R, [M.FLOWER]: BLOOM[bloom ?? "white"] }, 0, 0);
}
function fernDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 2, seed);
  if (H < 5) {
    for (let x = -1; x <= 1; x++) c.set(x, -1, M.LEAF, x < 0 ? 4 : 2);
    c.set(0, -2, M.LEAF, 5);
  } else fern(c, 0, 0, H);
  return c.toImg({ [M.LEAF]: FERN_R }, 0, 0);
}
function shrubDraw(H: number, seed: number): Img {
  const { c } = canvasFor(H, 1.7, seed);
  if (H < 5) {
    for (let x = -1; x <= 1; x++) for (let y = -H; y < 0; y++) c.set(x, y, M.LEAF, 4 - (x > 0 ? 2 : 0) - (y === -1 ? 1 : 0));
  } else shrub(c, 0, 0, H * 1.4, H);
  return c.toImg({ [M.LEAF]: SHRUB_R }, 0, 0);
}
function rockDraw(H: number, seed: number, wide: number, moss: number): Img {
  const { c } = canvasFor(H, wide + 0.4, seed);
  if (H < 4) {
    for (let x = -1; x <= 1; x++) c.set(x, -1, M.ROCK, x < 0 ? 4 : 2);
    if (H >= 3) c.set(0, -2, M.ROCK, 4);
  } else {
    boulder(c, 0, 0, H * wide, H, moss);
    if (H >= 7) {
      // Grain in the facets, a crack or two, lichen where it is lit.
      const R = c.R,
        salt = Math.floor(R() * 1e6);
      for (let i = 0; i < c.m.length; i++) {
        if (c.m[i] !== M.ROCK) continue;
        const x = i % c.w,
          y = (i / c.w) | 0,
          hsh = hashCell(x, y, salt);
        if (hsh < 0.14) c.t[i] = Math.max(1, c.t[i] - 1);
        else if (hsh > 0.9 && c.t[i] >= 3) c.t[i] = Math.min(6, c.t[i] + 1);
        else if (hsh > 0.985 && c.t[i] >= 4) c.m[i] = M.MOSS;
      }
      const cracks = H >= 24 ? 2 : 1;
      for (let k = 0; k < cracks; k++) {
        let x = (R() - 0.5) * H * wide * 0.6,
          y = -H * (0.3 + 0.5 * R());
        const dx = (R() - 0.5) * 1.2,
          n = Math.round(H * (0.3 + 0.3 * R()));
        for (let s = 0; s < n; s++) {
          const px = Math.round(x) + c.ox,
            py = Math.round(y) + c.oy,
            j = py * c.w + px;
          if (px > 0 && py > 0 && px < c.w && py < c.h && c.m[j] === M.ROCK) c.t[j] = 1;
          x += dx + (R() - 0.5) * 0.8;
          y += 0.7 + R() * 0.4;
        }
      }
    }
  }
  return c.toImg({ [M.ROCK]: ROCK_R, [M.LEAF]: MOSS_R, [M.MOSS]: rampOf(hex("#b8b070")) }, 0, 0);
}

// ---- People, the ox and the cart: drawn in colours directly ---------------------------------
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
export const CARTER: Look = { tunic: [128, 116, 98], hair: [80, 60, 44], legs: [70, 60, 50], hat: [150, 130, 90] };
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

/** An ox in profile, facing right: a deep barrel body, a hump over the shoulders, the head carried low, legs in step. */
function ox(H: number, frame: number): Img {
  const L = Math.round(H * 1.6),
    p = new Px(L + 14, H + 8, Math.floor((L + 14) / 2), H + 4),
    C: RGB = [150, 104, 66],
    hide = (u: number, v: number): RGB => shade(C, 1.18 - 0.42 * v + (u < -0.1 ? -0.04 : 0.02));
  if (H < 6) {
    p.rect(-2, -H + 1, 4, H - 2, C);
    p.set(2, -H + 2, shade(C, 0.8));
    p.set(-2, -1, shade(C, 0.6)); p.set(1, -1, shade(C, 0.6));
    return p.toImg(0, 0);
  }
  const legH = Math.round(H * 0.36),
    top = -H,
    belly = -legH,
    x0 = -Math.round(L * 0.42),
    x1 = Math.round(L * 0.24);
  // The barrel: rounder at the rump, a hump at the withers.
  for (let x = x0; x <= x1; x++) {
    const u = (x - x0) / (x1 - x0),
      hump = Math.exp(-((u - 0.78) ** 2) / 0.02) * H * 0.08,
      rump = Math.sin(Math.min(1, u * 3.2) * Math.PI * 0.5),
      yt = Math.round(top + H * 0.12 - hump + (1 - rump) * H * 0.12),
      yb = Math.round(belly - (1 - rump) * H * 0.06 + Math.sin(u * Math.PI) * H * 0.05);
    for (let y = yt; y <= yb; y++) p.set(x, y, hide(u - 0.5, (y - yt) / Math.max(1, yb - yt)));
  }
  // Neck and head, carried low and forward; horns; a dark muzzle.
  const hx = x1 + 1,
    hy = top + Math.round(H * 0.3),
    hw = Math.max(2, Math.round(H * 0.26)),
    hh = Math.max(2, Math.round(H * 0.24));
  for (let k = 0; k < hw; k++) for (let y = 0; y < hh - (k > hw * 0.6 ? 1 : 0); y++) p.set(hx + k, hy + y + Math.round(k * 0.35), shade(C, 1.05 - y * 0.06));
  p.set(hx + hw - 1, hy + hh - 1 + Math.round(hw * 0.35), [70, 52, 40]);
  const horn: RGB = [226, 214, 186];
  p.set(hx, hy - 1, horn);
  if (H >= 12) { p.set(hx - 1, hy - 2, horn); p.set(hx + 1, hy - 1, horn); }
  if (H >= 10) p.set(hx + Math.round(hw * 0.4), hy + 1, [40, 32, 28]);
  // Legs: hocks behind, knees in front, hooves dark.
  const lw = H >= 14 ? 2 : 1,
    legs = [x0 + 1, x0 + Math.round(L * 0.1), x1 - Math.round(L * 0.12), x1 - 1];
  legs.forEach((x, k) => {
    const sw = ((frame + (k % 2 ? 2 : 0) + (k > 1 ? 1 : 0)) % 4) - 1.5;
    for (let y = belly - 1; y < 0; y++) {
      const t = (y - belly) / legH,
        dx = Math.round(sw * 0.5 * t * (H / 12));
      for (let d = 0; d < lw; d++) p.set(x + dx + d, y, y >= -1 ? [56, 42, 34] : k === 1 || k === 2 ? shade(C, 0.62) : shade(C, 0.82));
    }
  });
  // The tail.
  for (let y = top + Math.round(H * 0.25); y < belly; y++) p.set(x0 - 1, y, shade(C, 0.7));
  p.set(x0 - 1, belly, [60, 44, 34]);
  if (H >= 10) p.outline(INK);
  return p.toImg(0, 0);
}
/** A covered cart in profile: a box on two wheels under a canvas hood. */
function cart(H: number): Img {
  const L = Math.round(H * 1.15),
    p = new Px(L + 12, H + 8, Math.floor((L + 12) / 2), H + 4),
    hood: RGB = [222, 212, 186],
    box: RGB = [132, 98, 62],
    wheelR = Math.max(1, Math.round(H * 0.18));
  const boxTop = -Math.round(H * 0.52),
    boxBot = -wheelR;
  for (let y = boxTop; y < boxBot; y++) for (let x = -Math.round(L / 2); x < Math.round(L / 2); x++) p.set(x, y, y === boxTop ? shade(box, 1.2) : box);
  const hr = Math.round(L / 2);
  for (let y = -H; y < boxTop; y++)
    for (let x = -hr; x < hr; x++) {
      const u = x / hr,
        v = (boxTop - y) / (boxTop + H);
      if (u * u * 0.6 + v * v > 1) continue;
      p.set(x, y, u < -0.2 ? shade(hood, 1.04) : u > 0.5 ? shade(hood, 0.82) : hood);
    }
  for (const cx of [-Math.round(L * 0.2)])
    for (let y = -2 * wheelR; y <= 0; y++)
      for (let x = -wheelR; x <= wheelR; x++) {
        const d = Math.hypot(x, y + wheelR);
        if (d <= wheelR + 0.3) p.set(cx + x, y - 0, d > wheelR - 1 ? [52, 40, 32] : [96, 72, 50]);
      }
  if (H >= 10) p.outline(INK);
  return p.toImg(0, 0);
}

// ---- The slots ----------------------------------------------------------------------------
export const TREE_SLOT0 = 0;
export const TREE_VARIANTS = 3;
const TREE_NAMES = ["oak", "beech", "maple", "birch", "spruce", "fir", "pine"];
export const COVER = ["grass", "grass2", "dry grass", "flowers white", "flowers yellow", "flowers purple", "flowers red", "fern", "fern2", "shrub", "shrub2", "boulder", "boulder2", "stone", "stone2"];
const COVER_H = [0.35, 0.3, 0.4, 0.45, 0.45, 0.45, 0.45, 0.8, 0.7, 1.5, 1.2, 1.4, 1.0, 0.35, 0.3];

export function slotDefs(): SlotDef[] {
  const out: SlotDef[] = [];
  for (const name of TREE_NAMES)
    for (let v = 0; v < TREE_VARIANTS; v++) out.push({ name: `${name} ${v}`, worldH: 20, maxClass: NC - 1, sunFlip: true, draw: (H, s) => treeDraw(name)(H, s + v * 7919) });
  COVER.forEach((name, k) => {
    const draw = (H: number, s: number): Img => {
      if (name.startsWith("flowers")) return grass(H, s, false, name.split(" ")[1]);
      if (name === "dry grass") return grass(H, s, true);
      if (name.startsWith("grass")) return grass(H, s + (name === "grass2" ? 31 : 0), false);
      if (name.startsWith("fern")) return fernDraw(H, s + (name === "fern2" ? 17 : 0));
      if (name.startsWith("shrub")) return shrubDraw(H, s + (name === "shrub2" ? 23 : 0));
      if (name.startsWith("boulder")) return rockDraw(H, s + (name === "boulder2" ? 5 : 0), 1.5, name === "boulder" ? 0.15 : 0);
      return rockDraw(H, s + (name === "stone2" ? 9 : 0), 1.3, 0);
    };
    out.push({ name, worldH: COVER_H[k], maxClass: 18, sunFlip: true, draw });
  });
  const looks = [...PARTY, CARTER];
  looks.forEach((look, m) => {
    for (let f = 0; f < 3; f++) for (let fr = 0; fr < 4; fr++) out.push({ name: `person ${m} ${f} ${fr}`, worldH: 1.75, maxClass: 15, sunFlip: false, draw: (H) => person(H, f, fr, look) });
  });
  for (let fr = 0; fr < 4; fr++) out.push({ name: `ox ${fr}`, worldH: 1.6, maxClass: 15, sunFlip: false, draw: (H) => ox(H, fr) });
  out.push({ name: "cart", worldH: 2.6, maxClass: 16, sunFlip: false, draw: (H) => cart(H) });
  // The party marker: a small caret, the same at every size.
  out.push({
    name: "marker", worldH: 1, maxClass: 0, sunFlip: false,
    draw: () => {
      const p = new Px(9, 6, 4, 4);
      for (let k = 0; k < 3; k++) for (let x = -2 + k; x <= 2 - k; x++) p.set(x, -3 + k, [233, 169, 90]);
      return p.toImg(0, 1);
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
