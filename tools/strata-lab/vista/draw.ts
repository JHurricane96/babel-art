// Vista's drawing kit: a canvas drawn in materials and shades, leaf clumps that keep their
// detail as a tree grows, small-size stand-ins for masses and stems, strokes, and the recorder
// that takes a drawing apart into parts (pack.ts puts them back together at any size).
import { M } from "../../../engine/strata/world";
import type { Canvas, CrownStyle } from "../../../engine/strata/art";
import { mulberry } from "./common";

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
/** A piece of a drawing (sprites.ts drawParts), with each pixel's material and shade kept
 * (material * 8 + shade, 0 where empty), so it can be coloured again, differently, later. */
export interface Part extends Img {
  mt: Uint8Array;
  /** Mostly leaves (a clump, a strand), not wood. */
  leaf: boolean;
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
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bay = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
export const hashCell = (x: number, y: number, s: number) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

// ---- Parts ------------------------------------------------------------------------------------
// While recording, every pixel drawn is also kept under the part being drawn (a leaf clump, the
// trunk, a branch, a hanging strand), so a big drawing can be taken apart and put back together at
// another size, each part at its own place.
let REC: number[] | null = null,
  REC_CANVAS: MatCanvas | null = null,
  REC_RAMPS: Record<number, number[][]> | null = null,
  PART = 0,
  /** A crown's leaf clumps are parts in groups: by the cell of a grid (CLUSTER_PX, fixed to the foot)
   * their centres fall in, each group drawn together, the groups in order of their depth. */
  CLUSTER_PX = 32,
  /** Images made in materials and shades (red: material * 8 + shade; alpha 255), not colours. */
  INDEX = false,
  LAST_RAMPS: Record<number, number[][]> | null = null;
export const newPart = () => void PART++;
/** Draw in materials and shades instead of colours (for a renderer that colours them itself). */
export function indexMode(on: boolean) {
  INDEX = on;
}
/** The material ramps the last drawing was coloured (or would have been coloured) with. */
export const lastRamps = () => LAST_RAMPS;
/** Is it drawing in materials and shades (for drawings made without a MatCanvas)? */
export const isIndexMode = () => INDEX;
/** Say which ramps a drawing made without a MatCanvas (rocks.ts) would be coloured with. */
export function useRamps(r: Record<number, number[][]>) {
  LAST_RAMPS = r;
}

export class MatCanvas implements Canvas {
  m: Uint8Array;
  t: Uint8Array;
  R: () => number;
  constructor(public w: number, public h: number, public ox: number, public oy: number, seed: number) {
    this.m = new Uint8Array(w * h);
    this.t = new Uint8Array(w * h);
    this.R = mulberry(seed);
    if (REC) REC_CANVAS = this;
  }
  set(x: number, y: number, m: number, tone: number) {
    const px = Math.round(x) + this.ox,
      py = Math.round(y) + this.oy;
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    if (REC) REC.push(PART, px, py, m, Math.max(1, Math.min(6, Math.round(tone))));
    const i = py * this.w + px;
    this.m[i] = m;
    this.t[i] = Math.max(1, Math.min(6, Math.round(tone)));
  }
  /** Crop to what was drawn and colour it, each material by its ramp. The foot at (fx, fy) in drawing coordinates. */
  toImg(ramps: Record<number, number[][]>, fx: number, fy: number): Img {
    if (REC && REC_CANVAS === this) REC_RAMPS = ramps;
    LAST_RAMPS = ramps;
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
        const o = (y * w + x) * 4;
        if (INDEX) {
          data[o] = m * 8 + this.t[i];
          data[o + 3] = 255;
          continue;
        }
        const ramp = ramps[m] ?? ramps[M.LEAF],
          c = ramp[this.t[i] - 1];
        data[o] = c[0] * 255;
        data[o + 1] = c[1] * 255;
        data[o + 2] = c[2] * 255;
        data[o + 3] = 255;
      }
    return { w, h, ax: fx + this.ox - x0, ay: fy + this.oy - y0, data };
  }
}
export const canvasFor = (H: number, wide: number, seed: number) => {
  const w = Math.ceil(H * wide) + 16,
    h = H + 16;
  return { c: new MatCanvas(w, h, Math.floor(w / 2), h - 4, seed), foot: [0, 0] as [number, number] };
};

// ---- Crowns that keep their detail as they grow ----------------------------------------------
// The forest slice's crown (art.ts) heaps leaf clumps; here each clump has its own fixed random
// values (adding a clump at a bigger size leaves the others alone) and its texture, holes,
// speckles and dither are fixed to the clump's own centre, so one pixel more of tree moves each
// clump a little instead of reshuffling what is inside it.
export const LEAF_TEX = [
  "0+0-00+0+00-",
  "++0--0++00--",
  "+0-00+0+-0+0",
  "0-00++0-0+++",
  "-0+0+--00+0-",
  "0++0-00+0-00",
  "+00--0+++0-0",
  "0-0+0++0-00+",
].map((r) => [...r].map((ch) => (ch === "+" ? 1 : ch === "-" ? -1 : 0)));
export const NEEDLE_TEX = [
  "0+00-0+00-",
  "0+0--0+0-0",
  "+0-00+00-0",
  "0-00+0-0+0",
  "-00+0-0+00",
].map((r) => [...r].map((ch) => (ch === "+" ? 1 : ch === "-" ? -1 : 0)));
export const LX = -0.55,
  LY = -0.7,
  LZ = 0.45;
export const EDGE_V = new Float32Array(32);
export function crownV(c: MatCanvas, cx: number, cy: number, rx: number, ry: number, st: CrownStyle, seed: number) {
  const n = Math.max(3, Math.round((Math.PI * rx * ry * st.density) / (st.r0 * st.r1))),
    clumps: { x: number; y: number; r: number; z: number; s: number }[] = [];
  for (let k = 0; k < n; k++) {
    const R = mulberry(seed * 1009 + k * 7919),
      a = R() * Math.PI * 2,
      d = Math.sqrt(R()),
      x = cx + Math.cos(a) * d * Math.max(0, rx - st.r0 * 0.6),
      y = cy + Math.sin(a) * d * Math.max(0, ry - st.r0 * 0.6),
      r = st.r0 + (st.r1 - st.r0) * R() * (1 - 0.4 * d);
    clumps.push({ x, y, r, z: R() + (0.3 * (y - cy)) / ry, s: Math.floor(R() * 1e9) });
  }
  clumps.sort((p, q) => p.z - q.z);
  const draw = (q: (typeof clumps)[0]) => clumpV(c, q.x, q.y, q.r, 0.5 - 0.5 * ((q.x - cx) / rx) * 0.45 - 0.5 * ((q.y - cy) / ry) * 0.9, st, q.s);
  if (REC) {
    const groups = new Map<number, typeof clumps>();
    for (const q of clumps) {
      const k = Math.floor(q.x / CLUSTER_PX) * 4096 + Math.floor(q.y / CLUSTER_PX);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(q);
    }
    const mean = (g: typeof clumps) => g.reduce((a, q) => a + q.z, 0) / g.length;
    for (const g of [...groups.values()].sort((a, b) => mean(a) - mean(b))) {
      newPart();
      for (const q of g) draw(q);
    }
  } else for (const q of clumps) draw(q);
}
export function clumpV(c: MatCanvas, cx: number, cy: number, r: number, pos: number, st: CrownStyle, seed: number) {
  const R = mulberry(seed),
    ox = Math.floor(R() * 12),
    oy = Math.floor(R() * 8),
    salt = Math.floor(R() * 1e9),
    tex = st.needles ? NEEDLE_TEX : LEAF_TEX,
    lobes = 5 + Math.floor(R() * 4),
    phase = R() * 6.28,
    rag = (0.12 + 0.08 * R()) * (st.rag ?? 1),
    ix = Math.round(cx),
    iy = Math.round(cy);
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2 - Math.PI;
    EDGE_V[k] = r * (1 + rag * Math.sin(lobes * a + phase) + rag * 0.5 * Math.sin(2.3 * lobes * a));
  }
  const holes = st.holes * 0.02,
    speck = st.speckle * 0.25,
    tw = tex[0].length,
    th = tex.length;
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy,
        rr = dx * dx + dy * dy;
      if (rr > r * r * 1.45) continue;
      const bin = ((Math.atan2(dy, dx) + Math.PI) * (32 / (Math.PI * 2))) | 0,
        d = Math.sqrt(rr) / EDGE_V[bin > 31 ? 31 : bin];
      if (d > 1) continue;
      // Everything below is fixed to the clump's own centre.
      const lx = x - ix,
        ly = y - iy,
        hc = hashCell(lx, ly, salt);
      if (holes && d < 0.8 && hc < holes) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d * d)),
        nx = dx / EDGE_V[bin > 31 ? 31 : bin],
        ny = dy / EDGE_V[bin > 31 ? 31 : bin],
        lam = Math.max(0, nx * LX + ny * LY + nz * LZ),
        v = 0.55 * lam + 0.45 * pos,
        tx = tex[(((ly + oy) % th) + th) % th][(((lx + ox) % tw) + tw) % tw];
      let t = 1 + Math.floor(v * 5 + bay(lx & 3, ly & 3) - 0.25) + tx;
      if (d > 0.82 && nx * LX + ny * LY < 0) t -= 1 + (d > 0.93 ? 1 : 0);
      if (t >= 4 && hc > 1 - speck) t = 6;
      c.set(x, y, M.LEAF, Math.max(1, Math.min(6, t)));
    }
}


/** A leaf mass: its centre and radii (in pixels, or fractions of a tree's height in a plan). */
export interface Mass {
  x: number;
  y: number;
  rx: number;
  ry: number;
}
/** A leaf mass shaded as a whole: lit at the upper left, a ragged rim, a few speckles and gaps. */
export function massSmall(c: MatCanvas, m: Mass, H: number, salt: number, needles: boolean) {
  const rx = Math.max(0.8, m.rx),
    ry = Math.max(0.8, m.ry);
  for (let y = Math.floor(m.y - ry - 1); y <= Math.ceil(m.y + ry + 1); y++)
    for (let x = Math.floor(m.x - rx - 1); x <= Math.ceil(m.x + rx + 1); x++) {
      const dx = (x + 0.5 - m.x) / rx,
        dy = (y + 0.5 - m.y) / ry,
        ang = Math.atan2(dy, dx),
        rag = H >= 8 ? 1 + 0.12 * Math.sin(ang * 6 + salt) : 1,
        d = Math.hypot(dx, dy) / rag;
      if (d > 1) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d * d)),
        lam = Math.max(0, -0.55 * dx - 0.7 * dy + 0.45 * nz);
      const lx = x - Math.round(m.x),
        ly = y - Math.round(m.y);
      let t = 1 + Math.floor(lam * 4.2 + 1 + bay(lx & 3, ly & 3) - 0.4);
      if (d > 0.78 && dx * -0.55 + dy * -0.7 < 0) t -= 1;
      if (H >= 10 && t >= 4 && hashCell(lx, ly, salt) > (needles ? 0.92 : 0.86)) t = 6;
      if (H >= 12 && d < 0.85 && hashCell(lx, ly, salt + 1) < 0.05) t = Math.max(1, t - 2);
      c.set(x, y, M.LEAF, t);
    }
}

/** A stem drawn simply (small sizes): a column a pixel or two wide, lit on its left. */
export function stemSmall(c: MatCanvas, x: number, h: number, lean: number, w: number) {
  for (let k = 0; k <= h; k++) {
    const t = k / Math.max(1, h),
      cx = x + lean * t * t;
    for (let d = 0; d < w; d++) c.set(Math.round(cx) + d - (w > 1 ? 1 : 0), -1 - k, M.WOOD, d === 0 ? 3 : 1);
  }
}

/**
 * A tree drawn at height H and taken apart: each part (leaf clump, trunk, branch, strand) as an
 * image anchored at the tree's foot like the whole, in drawing order; painted in order they make
 * the whole drawing again.
 */
export function drawParts(def: SlotDef, H: number, seed: number): Part[] {
  CLUSTER_PX = H / 12;
  REC = [];
  PART = 0;
  REC_CANVAS = null;
  REC_RAMPS = null;
  def.draw(H, seed);
  const rec = REC,
    cv = REC_CANVAS as MatCanvas | null,
    ramps = REC_RAMPS as Record<number, number[][]> | null;
  REC = null;
  REC_CANVAS = null;
  REC_RAMPS = null;
  if (!cv || !ramps) return [];
  // Each part is drawn whole before the next begins, so its pixels are one run of the record;
  // a pixel set twice within a part keeps the later value, as on the canvas.
  const parts: Part[] = [];
  for (let a = 0; a < rec.length; ) {
    let b = a;
    while (b < rec.length && rec[b] === rec[a]) b += 5;
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1e9,
      y1 = -1e9;
    for (let i = a; i < b; i += 5) {
      x0 = Math.min(x0, rec[i + 1]);
      x1 = Math.max(x1, rec[i + 1]);
      y0 = Math.min(y0, rec[i + 2]);
      y1 = Math.max(y1, rec[i + 2]);
    }
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1,
      data = new Uint8ClampedArray(w * h * 4),
      mt = new Uint8Array(w * h);
    let leafPx = 0;
    for (let i = a; i < b; i += 5) {
      const c = (ramps[rec[i + 3]] ?? ramps[M.LEAF])[rec[i + 4] - 1],
        q = (rec[i + 2] - y0) * w + rec[i + 1] - x0,
        o = q * 4;
      data[o] = c[0] * 255;
      data[o + 1] = c[1] * 255;
      data[o + 2] = c[2] * 255;
      data[o + 3] = 255;
      mt[q] = rec[i + 3] * 8 + rec[i + 4];
    }
    for (let q = 0; q < mt.length; q++) if (mt[q] >> 3 === M.LEAF) leafPx++;
    parts.push({ w, h, ax: cv.ox - x0, ay: cv.oy - y0, data, mt, leaf: leafPx * 2 > (b - a) / 5 });
    a = b;
  }
  return parts;
}


/** A stroke from (x0, y0) going `len` px at `ang` from upright (positive leans right), bending by
 * `curl` (positive bends right, more toward its end); its tone along it from tone(t). */
export function blade(c: MatCanvas, x0: number, y0: number, ang: number, len: number, curl: number, m: number, tone: (t: number) => number, width = 1) {
  const n = Math.max(1, Math.ceil(len * 2)),
    sx = Math.sin(ang),
    sy = -Math.cos(ang);
  let px = 1e9,
    py = 1e9;
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      d = t * len,
      bend = curl * t * t * len,
      x = Math.round(x0 + sx * d + bend * Math.cos(ang)),
      y = Math.round(y0 + sy * d + bend * Math.sin(ang));
    if (x === px && y === py) continue;
    px = x;
    py = y;
    const w = Math.max(1, Math.round(width * (1 - 0.6 * t)));
    for (let k = 0; k < w; k++) c.set(x + k, y, m, tone(t) + (k === 0 && w > 1 ? 1 : 0));
  }
  return [px, py];
}
