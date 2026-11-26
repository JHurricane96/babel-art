// Vista sprites: the drawings. Every kind of thing Vista shows (seven kinds of tree, each in a few
// variants; shrubs, heather, sage and rosettes, grass, flowers, ferns; rocks in six families, from
// rocks.ts; the party; the party's marker) as a drawing at any height in pixels. pack.ts turns
// these into what the GPU draws at each size.
//
// Trees are heaps of leaf clumps, each clump with its own fixed values, so a tree drawn a pixel
// bigger moves its clumps a little instead of reshuffling them; trunks, branches and ferns come
// from engine/strata/art.ts.
import { M } from "../../../engine/strata/world";
import { TREES, type Canvas, type CrownStyle, branch, fern, trunk } from "../../../engine/strata/art";
import { hex, rampOf } from "./color";
import { mulberry } from "./common";
import { ROCK_KINDS, rockImg } from "./rocks";

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
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const hashCell = (x: number, y: number, s: number) => {
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
const newPart = () => void PART++;
/** Draw in materials and shades instead of colours (for a renderer that colours them itself). */
export function indexMode(on: boolean) {
  INDEX = on;
}
/** The material ramps the last drawing was coloured (or would have been coloured) with. */
export const lastRamps = () => LAST_RAMPS;

class MatCanvas implements Canvas {
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
const canvasFor = (H: number, wide: number, seed: number) => {
  const w = Math.ceil(H * wide) + 16,
    h = H + 16;
  return { c: new MatCanvas(w, h, Math.floor(w / 2), h - 4, seed), foot: [0, 0] as [number, number] };
};

// ---- Crowns that keep their detail as they grow ----------------------------------------------
// The forest slice's crown (art.ts) heaps leaf clumps; here each clump has its own fixed random
// values (adding a clump at a bigger size leaves the others alone) and its texture, holes,
// speckles and dither are fixed to the clump's own centre, so one pixel more of tree moves each
// clump a little instead of reshuffling what is inside it.
const LEAF_TEX = [
  "0+0-00+0+00-",
  "++0--0++00--",
  "+0-00+0+-0+0",
  "0-00++0-0+++",
  "-0+0+--00+0-",
  "0++0-00+0-00",
  "+00--0+++0-0",
  "0-0+0++0-00+",
].map((r) => [...r].map((ch) => (ch === "+" ? 1 : ch === "-" ? -1 : 0)));
const NEEDLE_TEX = [
  "0+00-0+00-",
  "0+0--0+0-0",
  "+0-00+00-0",
  "0-00+0-0+0",
  "-00+0-0+00",
].map((r) => [...r].map((ch) => (ch === "+" ? 1 : ch === "-" ? -1 : 0)));
const LX = -0.55,
  LY = -0.7,
  LZ = 0.45;
const EDGE_V = new Float32Array(32);
function crownV(c: MatCanvas, cx: number, cy: number, rx: number, ry: number, st: CrownStyle, seed: number) {
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
function clumpV(c: MatCanvas, cx: number, cy: number, r: number, pos: number, st: CrownStyle, seed: number) {
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

// ---- Trees ---------------------------------------------------------------------------------
const LEAF: Record<string, string> = {
  oak: "#4a7428", beech: "#5d8a2e", maple: "#527c2a", birch: "#86a23e",
  spruce: "#24402f", fir: "#2a4a3a", pine: "#2f4a2c",
};
const BARK: Record<string, string> = {
  oak: "#5a4636", beech: "#8a8478", maple: "#5e4c3e", birch: "#e4e0d4",
  spruce: "#4a3a2e", fir: "#4a3a30", pine: "#9a6040",
};
export const LEAF_HEX = LEAF;
export const rampsFor = (name: string) => ({
  [M.LEAF]: rampOf(hex(LEAF[name])),
  [M.WOOD]: rampOf(hex(BARK[name])),
  [M.ROCK]: rampOf(hex("#8a8478")),
});

// One structure at every size: a tree's trunk, limbs and leaf masses are laid out once per
// variant (in fractions of its height, from its own random sequence), and every size class draws
// that same layout. Big sizes heap shaded leaf clumps into each mass (the forest slice's crowns);
// small sizes shade each mass as a whole. So a tree changing size class grows a little: it never
// turns into another tree.
export interface Mass {
  x: number;
  y: number;
  rx: number;
  ry: number;
}
export interface Limb {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
}
export interface Plan {
  /** Stems: foot x, height, lean (all fractions of H), widths at foot and top (fractions of H). */
  stems: { x: number; h: number; lean: number; w0: number; w1: number }[];
  limbs: Limb[];
  masses: Mass[];
  fringe: boolean;
}

/** A broadleaf tree's layout, in fractions of its height (y up is negative). */
export function broadleafPlan(name: string, seed: number): Plan {
  const S = mulberry(seed),
    k = TREES[name],
    base = (k.h0 + k.h1) / 2,
    w0 = k.w0 / base,
    w1 = k.w1 / base,
    plan: Plan = { stems: [], limbs: [], masses: [], fringe: false };
  const limb = (x0: number, y0: number, ang: number, len: number, w: number) => {
    const kink = (S() - 0.5) * 0.7,
      x1 = x0 + Math.sin(ang) * len * 0.5,
      y1 = y0 - Math.cos(ang) * len * 0.5,
      x2 = x1 + Math.sin(ang + kink) * len * 0.5,
      y2 = y1 - Math.cos(ang + kink) * len * 0.5;
    plan.limbs.push({ x0, y0, x1, y1, x2, y2, w });
    return { x: x2, y: y2 };
  };
  if (k.form === "oak") {
    const th = 0.3 + 0.1 * S(),
      lean = (S() - 0.5) * 0.06;
    plan.stems.push({ x: 0, h: th, lean, w0, w1: w1 + 1 / base });
    const top = { x: lean, y: -th },
      n = 4 + Math.floor(S() * 2);
    for (let j = 0; j < n; j++) {
      const side = (j / (n - 1)) * 2 - 1,
        ang = side * (0.95 + 0.3 * S()) + (S() - 0.5) * 0.2,
        end = limb(top.x, top.y, ang, (0.4 + 0.16 * S()) * (1 - 0.2 * Math.abs(side)), w1),
        r = 0.15 + 0.05 * S();
      plan.masses.push({ x: end.x, y: end.y - r * 0.2, rx: r * 1.15, ry: r * 0.72 });
    }
    plan.masses.push({ x: top.x + (S() - 0.5) * 0.1, y: top.y - 0.5, rx: 0.16 * 1.15, ry: 0.16 * 0.72 });
  } else if (k.form === "beech") {
    const th = 0.62,
      lean = (S() - 0.5) * 0.03;
    plan.stems.push({ x: 0, h: th, lean, w0, w1 });
    for (const s of [-1, 1]) limb(lean, -th + 0.08, s * 0.5, 0.25, Math.max(0.5 / base, w1 - 1 / base));
    const rx = 0.24 + 0.04 * S(),
      ry = 0.33 + 0.04 * S(),
      cy = -1 + ry;
    plan.masses.push({ x: lean, y: cy, rx, ry });
    plan.masses.push({ x: lean + (S() - 0.5) * rx * 0.6, y: cy - ry * 0.55, rx: rx * 0.55, ry: ry * 0.4 });
  } else if (k.form === "maple") {
    const th = 0.42,
      lean = (S() - 0.5) * 0.04,
      r = 0.27 + 0.04 * S(),
      cy = -1 + r;
    plan.stems.push({ x: 0, h: th, lean, w0, w1 });
    for (const s of [-1, 1]) {
      const e = limb(lean, -th, s * (0.7 + 0.2 * S()), 0.28, w1);
      plan.masses.push({ x: e.x, y: e.y + r * 0.1, rx: r * 0.62, ry: r * 0.5 });
    }
    plan.masses.push({ x: lean, y: cy, rx: r * 1.05, ry: r * 0.92 });
  } else {
    // Birch: one to three slender stems, narrow airy crowns with hanging fringes.
    const stems = S() < 0.45 ? 1 + Math.floor(S() * 3) : 1;
    plan.fringe = true;
    for (let j = 0; j < stems; j++) {
      const hh = 1 - 0.13 * j,
        dx = j === 0 ? 0 : (j % 2 ? -1 : 1) * (0.03 + 0.02 * S()),
        lean = dx * 2.2 + (S() - 0.5) * 0.05,
        rx = hh * (0.11 + 0.03 * S()),
        ry = hh * (0.3 + 0.04 * S());
      plan.stems.push({ x: dx, h: hh * 0.8, lean, w0, w1 });
      plan.masses.push({ x: dx + lean, y: -hh + ry, rx, ry });
    }
  }
  plan.masses.sort((a, b) => a.y - b.y);
  return plan;
}

/** A leaf mass shaded as a whole: lit at the upper left, a ragged rim, a few speckles and gaps. */
function massSmall(c: MatCanvas, m: Mass, H: number, salt: number, needles: boolean) {
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
function stemSmall(c: MatCanvas, x: number, h: number, lean: number, w: number) {
  for (let k = 0; k <= h; k++) {
    const t = k / Math.max(1, h),
      cx = x + lean * t * t;
    for (let d = 0; d < w; d++) c.set(Math.round(cx) + d - (w > 1 ? 1 : 0), -1 - k, M.WOOD, d === 0 ? 3 : 1);
  }
}

function broadleaf(name: string, H: number, seed: number): Img {
  const plan = broadleafPlan(name, seed),
    k = TREES[name],
    big = H >= 24,
    s = H / ((k.h0 + k.h1) / 2),
    cs = Math.max(0.55, Math.sqrt(s)),
    st: CrownStyle = { ...k.style, r0: Math.max(1.6, k.style.r0 * cs), r1: Math.max(2.2, k.style.r1 * cs) },
    { c } = canvasFor(H, 1.3, seed);
  c.R = mulberry(seed + 99);
  for (const st0 of plan.stems) {
    const h = Math.round(st0.h * H);
    newPart();
    if (big) trunk(c, st0.x * H, -1, h, Math.max(1, st0.w0 * H), Math.max(1, st0.w1 * H), st0.lean * H, k.bark);
    else stemSmall(c, st0.x * H, h, st0.lean * H, H >= 16 ? 2 : 1);
  }
  for (const l of plan.limbs)
    if (big || H >= 12) {
      const w = big ? Math.max(1, Math.round(l.w * H)) : 1;
      newPart();
      branch(c, l.x0 * H, l.y0 * H, l.x1 * H, l.y1 * H, w);
      branch(c, l.x1 * H, l.y1 * H, l.x2 * H, l.y2 * H, Math.max(1, w - 1));
    }
  plan.masses.forEach((m, i) => {
    const mm = { x: m.x * H, y: m.y * H, rx: m.rx * H, ry: m.ry * H };
    if (big) crownV(c, mm.x, mm.y, mm.rx, mm.ry, st, seed * 7 + i * 131);
    else massSmall(c, mm, H, seed + i * 17, false);
  });
  if (plan.fringe && H >= 20) {
    c.R = mulberry(seed + 7);
    for (const m of plan.masses) {
      const n = Math.round(m.rx * H * 1.4);
      for (let j = 0; j < n; j++) {
        const u = (j / Math.max(1, n - 1)) * 2 - 1,
          x = Math.round(m.x * H + u * m.rx * H * 0.95),
          y0 = Math.round(m.y * H + m.ry * H * Math.sqrt(Math.max(0, 1 - u * u)) * 0.8),
          len = Math.round((0.05 + 0.08 * c.R() * (1 - Math.abs(u))) * H);
        newPart();
        for (let d = 0; d < len; d++) if (c.R() < 0.85) c.set(x + (d > len * 0.6 ? Math.sign(u) : 0), y0 + d, M.LEAF, d === len - 1 ? 2 : 3 + (d % 2));
      }
    }
  }
  return c.toImg(rampsFor(name), 0, 0);
}

/** A conifer's tiers (fractions of H): the same for every size. */
export function coniferPlan(name: string, seed: number) {
  const S = mulberry(seed),
    n = 7 + Math.floor(S() * 3),
    W = name === "fir" ? 0.5 : 0.42,
    tiers: { t: number; w: number; j: number[] }[] = [];
  for (let k = 0; k < n; k++) tiers.push({ t: (k + 0.6) / n, w: (W / 2) * (0.85 + 0.3 * S()), j: [S(), S(), S()] });
  return { tiers, W, base: 0.08 };
}
/** A conifer: drooping tiers of needle masses down a straight trunk, the same layout at every size. */
function conifer(name: string, H: number, seed: number): Img {
  const p = coniferPlan(name, seed),
    { c } = canvasFor(H, 0.9, seed),
    big = H >= 26,
    cs = Math.sqrt(H / 60),
    st: CrownStyle = { r0: 2.4 * cs, r1: 3.8 * cs, density: 2.4, speckle: 0.3, holes: 0.06, needles: true, rag: 1.5 };
  c.R = mulberry(seed + 99);
  newPart();
  if (big) trunk(c, 0, -1, H - 2, Math.max(1, H * 0.035), 1, 0, { cracks: 0.3 });
  else stemSmall(c, 0, Math.max(1, Math.round(H * 0.14)), 0, 1);
  const span = H * (1 - p.base);
  for (let k = p.tiers.length - 1; k >= 0; k--) {
    const tier = p.tiers[k],
      y = -H + tier.t * span,
      w = tier.w * (0.1 + 0.9 * tier.t) * H,
      th = (span / p.tiers.length) * 1.05;
    if (big) {
      for (const side of [-1, 1]) {
        const n = w > 10 * cs ? 2 : 1;
        for (let j = 0; j < n; j++) {
          const u = n === 1 ? 0.55 : 0.35 + 0.45 * j,
            droop = th * 0.35 * u * u;
          crownV(c, side * w * u, y + droop, Math.max(1.5, w * (n === 1 ? 0.5 : 0.36)), Math.max(1.2, th * 0.5), st, seed * 13 + k * 7 + j * 3 + (side + 1));
        }
      }
      crownV(c, 0, y - th * 0.15, Math.max(1.2, w * 0.35), Math.max(1.2, th * 0.55), st, seed * 17 + k);
    } else {
      // The tier as one drooping shape: wide at its foot, lit on the left, shadowed beneath.
      const rows = Math.max(1, Math.round(th));
      for (let r = 0; r < rows; r++) {
        const f = (r + 0.5) / rows,
          yy = Math.round(y - th * 0.6 + r),
          half = w * (0.35 + 0.65 * f);
        for (let x = Math.round(-half); x <= Math.round(half); x++) {
          const u = x / Math.max(1, half);
          let tone = 1 + Math.floor((0.62 - 0.42 * u - 0.3 * f) * 5 + bay(x, yy) - 0.2);
          if (f > 0.8 && H >= 10) tone -= 1;
          c.set(x, yy, M.LEAF, tone);
        }
      }
    }
  }
  if (big) {
    crownV(c, 0, -H + H * 0.05, Math.max(1, p.W * H * 0.05), Math.max(1.5, H * 0.06), st, seed + 5);
  } else c.set(0, -H, M.LEAF, 4);
  return c.toImg(rampsFor(name), 0, 0);
}

/** A pine's layout: a leaning trunk, limbs out to flat pads (fractions of H). */
export function pinePlan(seed: number) {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.12,
    top = { x: lean, y: -0.7 },
    pads: Mass[] = [{ x: lean, y: -1 + 0.08, rx: 0.17, ry: 0.07 }],
    limbs: Limb[] = [],
    n = 3 + Math.floor(S() * 3);
  for (let k = 1; k < n; k++) {
    const side = k % 2 ? -1 : 1,
      y0 = top.y + 0.05 + 0.18 * S(),
      ex = top.x + side * (0.14 + 0.16 * S()),
      ey = y0 - (0.06 + 0.1 * S());
    limbs.push({ x0: top.x, y0, x1: (top.x + ex) / 2, y1: (y0 + ey) / 2, x2: ex, y2: ey, w: 0.02 });
    pads.push({ x: ex, y: ey - 0.02, rx: 0.1 + 0.06 * S(), ry: 0.045 + 0.02 * S() });
  }
  pads.sort((a, b) => a.y - b.y);
  return { lean, top, pads, limbs };
}
function pine(H: number, seed: number): Img {
  const p = pinePlan(seed),
    { c } = canvasFor(H, 1.1, seed),
    big = H >= 26,
    cs = Math.sqrt(H / 60),
    st: CrownStyle = { r0: 2.6 * cs, r1: 4.2 * cs, density: 2.0, speckle: 0.35, holes: 0.12, needles: true, rag: 1.6 };
  c.R = mulberry(seed + 99);
  newPart();
  if (big) trunk(c, 0, -1, Math.round(H * 0.7), Math.max(1, H * 0.045), Math.max(1, H * 0.02), p.lean * H, { cracks: 0.6 });
  else stemSmall(c, 0, Math.round(H * 0.7), p.lean * H, H >= 16 ? 2 : 1);
  if (big || H >= 12)
    for (const l of p.limbs) {
      newPart();
      branch(c, l.x0 * H, l.y0 * H, l.x2 * H, l.y2 * H, big ? Math.max(1, Math.round(l.w * H)) : 1);
    }
  p.pads.forEach((m, i) => {
    const mm = { x: m.x * H, y: m.y * H, rx: Math.max(1.2, m.rx * H), ry: Math.max(1, m.ry * H) };
    if (big) crownV(c, mm.x, mm.y, mm.rx, mm.ry, st, seed * 7 + i * 131);
    else massSmall(c, mm, H, seed + i * 17, true);
  });
  return c.toImg(rampsFor("pine"), 0, 0);
}

function treeDraw(name: string) {
  return (H: number, seed: number) => {
    if (name === "spruce" || name === "fir") return conifer(name, H, seed);
    if (name === "pine") return pine(H, seed);
    return broadleaf(name, H, seed);
  };
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
  BLOOM: Record<string, number[][]> = {
    white: rampOf(hex("#e8e4d8")),
    yellow: rampOf(hex("#e2c040")),
    purple: rampOf(hex("#8a64b0")),
    red: rampOf(hex("#c4503c")),
  };

/** A grass clump: blades fanning from one root, dark at the base, lit at the tips; blooms if given. */
function grass(H: number, seed: number, dry: boolean, bloom?: string): Img {
  // The same blades at every size (fewer drawn when small), the same flower heads.
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
  if (bloom) {
    const B = mulberry(seed + 5),
      all = 1 + Math.floor(B() * 3),
      heads = H < 6 ? 1 : all;
    for (let k = 0; k < heads; k++) {
      const x = Math.round((B() - 0.5) * H * 0.6),
        y = -Math.round(H * (0.75 + 0.3 * B())),
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
export const TREE_VARIANTS = 3;
export const TREE_NAMES = ["oak", "beech", "maple", "birch", "spruce", "fir", "pine"];
export const COVER = ["grass", "grass2", "dry grass", "flowers white", "flowers yellow", "flowers purple", "flowers red", "fern", "fern2", "shrub", "shrub2"];
const COVER_H = [0.35, 0.3, 0.4, 0.45, 0.45, 0.45, 0.45, 0.8, 0.7, 1.5, 1.2];

/** Bushes beyond the plain shrub, by the names the biomes give them (biomes.ts `bushes`). */
export const PLANT_KINDS = [
  { kind: "heather", n: 3, worldH: 0.45 },
  { kind: "sage", n: 3, worldH: 0.9 },
  { kind: "rosette", n: 3, worldH: 0.7 },
];
/** Families placed as one (any of their drawings, as they come): rocks and bushes, by kind. */
export function familyOf(name: string) {
  const kind = name.split(" ")[0];
  return ROCK_KINDS.some((r) => r.kind === kind) || PLANT_KINDS.some((p) => p.kind === kind) ? kind : name;
}

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
  // Rocks: each family a few drawings, each its own shape (rocks.ts); its seed fixed by family and
  // number, so adding slots elsewhere never changes a rock.
  ROCK_KINDS.forEach(({ kind, n, worldH }, f) => {
    for (let v = 0; v < n; v++)
      out.push({
        name: `${kind} ${v}`, worldH, maxClass: 18, sunFlip: true,
        draw: (H) => {
          LAST_RAMPS = { [M.ROCK]: ROCK_R };
          return rockImg(kind, 101 + f * 1009 + v * 37, H, M.ROCK, INDEX, ROCK_R);
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
