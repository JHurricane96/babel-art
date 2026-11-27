// Vista's trees: every species the biomes name, drawn at any height in pixels: a layout made
// once per drawing (in fractions of the height, from its own random numbers), drawn the same at
// every size; big sizes heap shaded leaf clumps into each mass, small ones shade each mass whole.
import { M } from "../../../engine/strata/world";
import { TREES, type CrownStyle, branch, trunk } from "../../../engine/strata/art";
import { hex, rampOf } from "./color";
import { TREE_KINDS, mulberry } from "./common";
import { type Img, type Mass, type MatCanvas, blade, bay, canvasFor, crownV, hashCell, massSmall, newPart, stemSmall } from "./draw";
export type { Mass } from "./draw";

// ---- Trees ---------------------------------------------------------------------------------
const LEAF: Record<string, string> = Object.fromEntries(TREE_KINDS.map((k) => [k.name, k.leaf])),
  BARK: Record<string, string> = Object.fromEntries(TREE_KINDS.map((k) => [k.name, k.bark]));
export const LEAF_HEX = LEAF;
export const TREE_NAMES = TREE_KINDS.map((k) => k.name);
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
    st: CrownStyle = { r0: 2.4 * cs, r1: 3.8 * cs, density: name === "larch" ? 1.8 : 2.4, speckle: name === "larch" ? 0.5 : 0.3, holes: name === "larch" ? 0.3 : 0.06, needles: true, rag: 1.5 };
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

// ---- Shared pieces ------------------------------------------------------------------------------
type Bark = { cracks: number; marks?: boolean };
/** Leaf masses (in fractions of H): heaped shaded clumps when big, each shaded whole when small. */
function leafMasses(c: MatCanvas, list: Mass[], H: number, st: CrownStyle, seed: number, needles: boolean) {
  list.forEach((m, i) => {
    const mm = { x: m.x * H, y: m.y * H, rx: Math.max(1.2, m.rx * H), ry: Math.max(1, m.ry * H) };
    if (H >= 26) crownV(c, mm.x, mm.y, mm.rx, mm.ry, st, seed * 7 + i * 131);
    else massSmall(c, mm, H, seed + i * 17, needles);
  });
}
/** A bough from (x0, y0) to (x1, y1), w0 to w1 px thick across its own direction (so a steep one
 * is as thick as a level one), lit on the side toward the sun. */
function bough(c: MatCanvas, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number) {
  const L = Math.hypot(x1 - x0, y1 - y0) || 1,
    n = Math.max(1, Math.ceil(L * 2)),
    ux = (x1 - x0) / L,
    uy = (y1 - y0) / L;
  let nx = -uy,
    ny = ux;
  if (nx * -0.55 + ny * -0.7 < 0) (nx = -nx), (ny = -ny);
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      x = x0 + (x1 - x0) * t,
      y = y0 + (y1 - y0) * t,
      w = Math.max(1, w0 + (w1 - w0) * t);
    if (w <= 1.2) {
      c.set(Math.round(x), Math.round(y), M.WOOD, 3);
      continue;
    }
    for (let d = -w / 2; d <= w / 2; d += 0.5) {
      const u = (d + w / 2) / w;
      c.set(Math.round(x + nx * d), Math.round(y + ny * d), M.WOOD, u > 0.7 ? 4 : u > 0.4 ? 3 : u > 0.15 ? 2 : 1);
    }
  }
}
/** Limbs (fractions of H), each its own part: thick at the root, thinner toward the end. */
function limbs(c: MatCanvas, list: Limb[], H: number) {
  if (H < 12) return;
  for (const l of list) {
    newPart();
    const w = H >= 26 ? Math.max(1, l.w * H) : 1;
    bough(c, l.x0 * H, l.y0 * H, l.x1 * H, l.y1 * H, w, w * 0.8);
    bough(c, l.x1 * H, l.y1 * H, l.x2 * H, l.y2 * H, w * 0.8, w * 0.5);
  }
}
/** A stem (its own part) from (x, foot) up h px, w0 to w1 px wide, its top leant by `lean` px. */
function stem(c: MatCanvas, x: number, h: number, w0: number, w1: number, lean: number, H: number, bark: Bark) {
  newPart();
  if (H >= 26) trunk(c, x, -1, h, Math.max(1, w0), Math.max(1, w1), lean, bark);
  else stemSmall(c, x, h, lean, H >= 16 ? 2 : 1);
}
/** Crown style scaled to the drawing's height. */
const styleAt = (H: number, k: number, more: Partial<CrownStyle> = {}): CrownStyle => {
  const cs = Math.sqrt(H / 60);
  return { r0: 2.4 * cs * k, r1: 3.8 * cs * k, density: 2.2, speckle: 0.35, holes: 0.1, rag: 1.5, ...more };
};
/** Walk a curve from (x, y) that starts at `ang` from upright and bends toward hanging straight
 * down by `droop` (more toward its end), `len` px; f(x, y, t, ang) at each pixel. */
function arc(x: number, y: number, ang: number, len: number, droop: number, f: (x: number, y: number, t: number, a: number) => void) {
  const n = Math.max(1, Math.ceil(len)),
    side = Math.sin(ang) >= 0 ? 1 : -1;
  for (let s = 0; s <= n; s++) {
    const t = s / n,
      a = Math.min(Math.PI * 0.97, Math.abs(ang) + droop * t * t) * side;
    x += Math.sin(a) * (len / n);
    y -= Math.cos(a) * (len / n);
    f(x, y, t, a);
  }
}
/** A straight stroke of `len` px along (dx, dy) (normalised here), each pixel's tone from tone(t). */
function ray(c: MatCanvas, x: number, y: number, dx: number, dy: number, len: number, m: number, tone: (t: number) => number) {
  const l = Math.hypot(dx, dy) || 1,
    n = Math.max(1, Math.round(len));
  for (let s = 1; s <= n; s++) c.set(Math.round(x + (dx / l) * s), Math.round(y + (dy / l) * s), m, tone(s / n));
}

// ---- Pines -------------------------------------------------------------------------------------
/** A Scots pine's layout: a tall trunk running up into the crown; above a bare stretch, limbs on
 * alternate sides out to flat, layered masses, shorter toward the top, and a mass at the top. */
export function pinePlan(seed: number) {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.1,
    th = 0.94,
    crown0 = 0.46 + 0.12 * S(),
    at = (f: number) => lean * (f / th) ** 2,
    limbList: Limb[] = [],
    pads: Mass[] = [],
    n = 6 + Math.floor(S() * 3);
  let side = S() < 0.5 ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? k / (n - 1) : 0,
      f = crown0 + (0.88 - crown0) * t + (S() - 0.5) * 0.03,
      reach = (0.12 + 0.18 * S()) * (1 - 0.45 * t),
      rise = 0.02 + 0.07 * S(),
      x0 = at(f),
      ex = x0 + side * reach,
      ey = -f - rise;
    limbList.push({ x0, y0: -f, x1: x0 + side * reach * 0.55, y1: -f - rise * 0.3, x2: ex, y2: ey, w: 0.02 * (1 - 0.5 * t) });
    pads.push({ x: ex - side * Math.min(0.04, reach * 0.2), y: ey - 0.018, rx: 0.045 + reach * 0.38 + 0.02 * S(), ry: 0.032 + 0.02 * S() });
    side = S() < 0.8 ? -side : side;
  }
  pads.push({ x: at(th) + (S() - 0.5) * 0.03, y: -0.955, rx: 0.07 + 0.03 * S(), ry: 0.045 });
  pads.sort((a, b) => a.y - b.y);
  return { lean, th, limbs: limbList, pads };
}
function pine(H: number, seed: number): Img {
  const p = pinePlan(seed),
    { c } = canvasFor(H, 1.1, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(p.th * H), H * 0.05, H * 0.014, p.lean * H, H, { cracks: 0.6 });
  limbs(c, p.limbs, H);
  leafMasses(c, p.pads, H, styleAt(H, 0.95, { density: 1.9, holes: 0.18, needles: true, rag: 1.7 }), seed, true);
  return c.toImg(rampsFor("pine"), 0, 0);
}
/** A stone pine: a trunk forking into a few limbs that hold up one broad, flat-topped umbrella
 * of overlapping pads. */
function stonePine(H: number, seed: number): Img {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.12,
    th = 0.5 + 0.1 * S(),
    W = 0.36 + 0.1 * S(),
    pads: Mass[] = [],
    limbList: Limb[] = [],
    n = 7 + Math.floor(S() * 3),
    m = 3 + Math.floor(S() * 2);
  for (let k = 0; k < n; k++) {
    const u = (k / (n - 1)) * 2 - 1;
    pads.push({ x: lean * 0.6 + u * W + (S() - 0.5) * 0.04, y: -(0.86 + 0.06 * (1 - u * u)) + (S() - 0.5) * 0.02, rx: 0.1 + 0.04 * S(), ry: 0.06 + 0.02 * S() });
  }
  for (let j = 0; j < m; j++) {
    const u = (j / (m - 1)) * 2 - 1,
      ex = lean * 0.6 + u * W * 0.72,
      ey = -(0.8 + 0.03 * (1 - u * u));
    limbList.push({ x0: lean, y0: -th, x1: (lean + ex) / 2 + (S() - 0.5) * 0.05, y1: (-th + ey) / 2, x2: ex, y2: ey, w: 0.022 });
  }
  const { c } = canvasFor(H, 1.25, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * 0.05, H * 0.03, lean * H, H, { cracks: 0.7 });
  limbs(c, limbList, H);
  pads.sort((a, b) => a.y - b.y);
  leafMasses(c, pads, H, styleAt(H, 1, { density: 2.3, holes: 0.08, needles: true, rag: 1.6 }), seed, true);
  return c.toImg(rampsFor("stone-pine"), 0, 0);
}

// ---- Palms and ferns ------------------------------------------------------------------------------
/** A palm's or tree fern's crown: fronds arching out of the top, each a rib lined with leaflets
 * (drawn when big), each its own part. */
function fronds(c: MatCanvas, tx: number, ty: number, H: number, list: { a: number; len: number; droop: number }[], leaflet: number, fine: boolean, m: number = M.LEAF) {
  for (const f of list) {
    newPart();
    const L = f.len * H;
    arc(tx, ty, f.a, L, f.droop, (x, y, t, a) => {
      c.set(Math.round(x), Math.round(y), m, 3);
      if (H < 26 || t < 0.06) return;
      const step = fine ? 1 : 2;
      if (Math.round(t * L) % step) return;
      // Leaflets both sides, angled toward the tip and hanging a little; lit on the upper side.
      const dx = Math.sin(a),
        dy = -Math.cos(a);
      for (const side of [-1, 1]) {
        const px = Math.cos(a) * side,
          py = Math.sin(a) * side,
          vx = dx * 0.55 + px * 0.85,
          vy = dy * 0.55 + py * 0.85 + 0.45,
          up = vy < 0;
        ray(c, x, y, vx, vy, leaflet * H * (1 - 0.65 * t), m, (u) => (up ? 5 : 3) - (u > 0.8 ? 1 : 0));
      }
    });
  }
}
/** A palm's ringed trunk: slim, curving. */
function palmTrunk(c: MatCanvas, H: number, h: number, w0: number, w1: number, lean: number, rings: number) {
  newPart();
  if (H < 26) return stemSmall(c, 0, h, lean, H >= 16 ? 2 : 1);
  trunk(c, 0, -1, h, w0, w1, lean, { cracks: 0 });
  for (let k = 4; k < h; k += Math.max(2, Math.round(rings))) {
    const t = k / h,
      cx = lean * t * t,
      w = w0 + (w1 - w0) * t;
    for (let x = Math.round(cx - w / 2); x < Math.round(cx + w / 2); x++) c.set(x, -1 - k, M.WOOD, 1);
  }
}
function palm(H: number, seed: number): Img {
  const S = mulberry(seed),
    lean = (S() < 0.5 ? -1 : 1) * (0.06 + 0.14 * S()),
    th = 0.76 + 0.06 * S(),
    n = 11 + Math.floor(S() * 4),
    list = Array.from({ length: n }, (_, k) => {
      const a = -2.6 + (5.2 * (k + 0.5)) / n + (S() - 0.5) * 0.3;
      return { a, len: (0.22 + 0.12 * S()) * (0.5 + 0.5 * Math.abs(Math.sin(a))), droop: 0.8 + 0.6 * S() };
    }),
    dead = Array.from({ length: 2 + Math.floor(S() * 2) }, () => ({ a: (S() < 0.5 ? -1 : 1) * (2.6 + 0.35 * S()), len: 0.12 + 0.05 * S(), droop: 0.2 }));
  const { c } = canvasFor(H, 1.3, seed);
  c.R = mulberry(seed + 99);
  palmTrunk(c, H, Math.round(th * H), H * 0.04, H * 0.027, lean * H, H * 0.016);
  const tx = lean * H,
    ty = -1 - th * H;
  fronds(c, tx, ty, H, dead, 0.04, false, M.WOOD);
  // Up-turned fronds first (behind), the drooping ones last (in front).
  fronds(c, tx, ty, H, [...list].sort((p, q) => Math.abs(p.a) - Math.abs(q.a)), 0.075, false);
  return c.toImg(rampsFor("palm"), 0, 0);
}
function fanPalm(H: number, seed: number): Img {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.06,
    th = 0.78 + 0.04 * S(),
    nl = 17 + Math.floor(S() * 6),
    leaves = Array.from({ length: nl }, (_, k) => ({ a: -2 + (4 * (k + 0.5)) / nl + (S() - 0.5) * 0.25, len: 0.1 + 0.06 * S(), fan: 0.09 + 0.04 * S() })),
    { c } = canvasFor(H, 1, seed);
  c.R = mulberry(seed + 99);
  palmTrunk(c, H, Math.round(th * H), H * 0.06, H * 0.045, lean * H, H * 0.03);
  const tx = lean * H,
    ty = -1 - th * H;
  // The skirt of old leaves hanging down the trunk.
  if (H >= 12) {
    newPart();
    const n = Math.max(3, Math.round(H * 0.08));
    for (let k = 0; k < n; k++) {
      const u = (k / (n - 1)) * 2 - 1,
        len = H * (0.1 + 0.05 * S()) * (1 - 0.3 * Math.abs(u));
      ray(c, tx + u * H * 0.05, ty + 1, u * 0.15, 1, len, M.WOOD, (t) => (u < 0 ? 3 : 2) - (t > 0.85 ? 1 : 0));
    }
  }
  for (const lf of [...leaves].sort((p, q) => Math.abs(p.a) - Math.abs(q.a))) {
    newPart();
    const ex = tx + Math.sin(lf.a) * lf.len * H,
      ey = ty - Math.cos(lf.a) * lf.len * H;
    ray(c, tx, ty, ex - tx, ey - ty, lf.len * H, M.LEAF, () => 3);
    // The fan: leaflets radiating from the stalk's end.
    const rays = H >= 26 ? 13 : 3;
    for (let r = 0; r < rays; r++) {
      const a = lf.a + (r / (rays - 1) - 0.5) * 1.3,
        lit = Math.sin(a) < 0 ? 1 : 0;
      ray(c, ex, ey, Math.sin(a), -Math.cos(a) + 0.25, lf.fan * H, M.LEAF, (t) => 3 + lit + (t < 0.3 ? 1 : 0));
    }
  }
  return c.toImg(rampsFor("fan-palm"), 0, 0);
}
function treeFern(H: number, seed: number): Img {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.14,
    th = 0.6 + 0.06 * S(),
    n = 9 + Math.floor(S() * 4),
    list = Array.from({ length: n }, (_, k) => {
      const a = -2.2 + (4.4 * (k + 0.5)) / n + (S() - 0.5) * 0.3;
      return { a, len: (0.3 + 0.1 * S()) * (0.6 + 0.4 * Math.abs(Math.sin(a))), droop: 1.1 + 0.5 * S() };
    }),
    { c } = canvasFor(H, 1.3, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * 0.045, H * 0.035, lean * H, H, { cracks: 0.95 });
  const tx = lean * H,
    ty = -1 - th * H;
  fronds(c, tx, ty, H, [...list].sort((p, q) => Math.abs(p.a) - Math.abs(q.a)), 0.045, true);
  // A young frond or two, still curled, at the crown.
  if (H >= 26)
    for (const side of [-1, 1]) {
      newPart();
      arc(tx, ty, side * 0.2, H * 0.06, 2.6, (x, y) => c.set(Math.round(x), Math.round(y), M.LEAF, 5));
    }
  return c.toImg(rampsFor("tree-fern"), 0, 0);
}
function banana(H: number, seed: number): Img {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.06,
    th = 0.42 + 0.06 * S(),
    nl = 6 + Math.floor(S() * 3),
    leaves = Array.from({ length: nl }, (_, k) => {
      const a = -1.7 + (3.4 * (k + 0.5)) / nl + (S() - 0.5) * 0.4;
      return { a, len: 0.4 + 0.18 * S(), droop: 0.5 + 0.6 * S(), w: 0.075 + 0.02 * S() };
    }),
    { c } = canvasFor(H, 1.4, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * 0.08, H * 0.055, lean * H, H, { cracks: 0.2 });
  const tx = lean * H,
    ty = -1 - th * H;
  for (const lf of [...leaves].sort((p, q) => Math.abs(p.a) - Math.abs(q.a))) {
    newPart();
    const L = lf.len * H;
    arc(tx, ty, lf.a, L, lf.droop, (x, y, t, a) => {
      // The blade either side of the midrib, widest in its middle; torn here and there.
      const hw = H >= 12 ? lf.w * H * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.6 : 0,
        px = Math.cos(a),
        py = Math.sin(a);
      for (let d = -hw; d <= hw; d += 0.6) {
        if (H >= 26 && hashCell(Math.round(t * L), d < 0 ? 1 : 2, seed) < 0.12 && Math.abs(d) > hw * 0.3) continue;
        c.set(Math.round(x + px * d), Math.round(y + py * d), M.LEAF, d * py < 0 || (py === 0 && d < 0) ? 5 : 3);
      }
      c.set(Math.round(x), Math.round(y), M.LEAF, 4);
    });
  }
  return c.toImg(rampsFor("banana"), 0, 0);
}

// ---- Dry country -------------------------------------------------------------------------------
/** An acacia: a short trunk forking into a few limbs reaching out and up to a wide, flat crown. */
function acacia(H: number, seed: number): Img {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.12,
    th = 0.26 + 0.1 * S(),
    W = 0.48 + 0.14 * S(),
    pads: Mass[] = [],
    limbList: Limb[] = [],
    n = 6 + Math.floor(S() * 3),
    m = 3 + Math.floor(S() * 2);
  for (let k = 0; k < n; k++) {
    const u = (k / (n - 1)) * 2 - 1;
    pads.push({ x: lean + u * W + (S() - 0.5) * 0.04, y: -(0.82 + 0.035 * (1 - u * u)) + (S() - 0.5) * 0.02, rx: 0.15 + 0.06 * S(), ry: 0.042 + 0.014 * S() });
    // A second, smaller layer over the joins, so the top reads as one canopy.
    if (k < n - 1) pads.push({ x: lean + (u + 1 / (n - 1)) * W, y: -(0.855 + 0.035 * (1 - u * u)), rx: 0.1 + 0.03 * S(), ry: 0.03 });
  }
  for (let j = 0; j < m; j++) {
    const u = (j / (m - 1)) * 2 - 1,
      ex = lean + u * W * 0.7,
      ey = -(0.78 + 0.02 * S());
    limbList.push({ x0: lean, y0: -th, x1: lean + u * W * 0.45 + (S() - 0.5) * 0.06, y1: -th - (0.78 - th) * 0.5, x2: ex, y2: ey, w: 0.024 });
  }
  const { c } = canvasFor(H, 1.7, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * 0.05, H * 0.035, lean * H, H, { cracks: 0.8 });
  limbs(c, limbList, H);
  pads.sort((a, b) => a.y - b.y);
  leafMasses(c, pads, H, styleAt(H, 0.8, { density: 2, holes: 0.25, speckle: 0.4, rag: 1.7 }), seed, false);
  return c.toImg(rampsFor("acacia"), 0, 0);
}
/** A baobab: a vast bottle of a trunk, stubby crooked limbs at its top, a few small tufts of leaves. */
function baobab(H: number, seed: number): Img {
  const S = mulberry(seed),
    th = 0.58 + 0.08 * S(),
    w0 = 0.26 + 0.06 * S(),
    w1 = 0.14 + 0.04 * S(),
    limbList: Limb[] = [],
    tufts: Mass[] = [],
    n = 6 + Math.floor(S() * 4);
  for (let k = 0; k < n; k++) {
    const u = (k / (n - 1)) * 2 - 1,
      x0 = u * w1 * 0.4,
      ang = u * (0.9 + 0.3 * S()) + (S() - 0.5) * 0.3,
      len = 0.12 + 0.1 * S(),
      x1 = x0 + Math.sin(ang) * len * 0.5,
      y1 = -th - Math.cos(ang) * len * 0.5,
      x2 = x1 + Math.sin(ang * 0.6) * len * 0.5,
      y2 = y1 - Math.cos(ang * 0.6) * len * 0.5;
    limbList.push({ x0, y0: -th + 0.01, x1, y1, x2, y2, w: 0.04 });
    if (S() < 0.8) tufts.push({ x: x2, y: y2 - 0.02, rx: 0.05 + 0.03 * S(), ry: 0.035 + 0.015 * S() });
  }
  const { c } = canvasFor(H, 1.1, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * w0, H * w1, 0, H, { cracks: 0.5 });
  limbs(c, limbList, H);
  leafMasses(c, tufts, H, styleAt(H, 0.7, { density: 1.6, holes: 0.35, speckle: 0.5 }), seed, false);
  return c.toImg(rampsFor("baobab"), 0, 0);
}
/** A Joshua tree: a shaggy trunk branching into arms that bend upward, each ending in a spiky tuft. */
function joshua(H: number, seed: number): Img {
  const S = mulberry(seed),
    th = 0.36 + 0.1 * S(),
    arms: { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number }[] = [],
    grow = (x: number, y: number, ang: number, len: number, depth: number) => {
      const x1 = x + Math.sin(ang) * len * 0.6,
        y1 = y - Math.cos(ang) * len * 0.6,
        x2 = x1 + Math.sin(ang * 0.35) * len * 0.4,
        y2 = y1 - Math.cos(ang * 0.35) * len * 0.4;
      arms.push({ x0: x, y0: y, x1, y1, x2, y2 });
      if (depth > 0 && S() < 0.6) for (const s of [-1, 1]) grow(x2, y2, s * (0.4 + 0.4 * S()), len * 0.6, depth - 1);
    };
  const n = 2 + Math.floor(S() * 2);
  for (let k = 0; k < n; k++) grow(0, -th, ((k / (n - 1)) * 2 - 1) * (0.5 + 0.35 * S()), 0.22 + 0.08 * S(), 1);
  const ends = arms.filter((a) => !arms.some((b) => b.x0 === a.x2 && b.y0 === a.y2)),
    { c } = canvasFor(H, 1.2, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * 0.075, H * 0.055, 0, H, { cracks: 1 });
  // The arms as one part (joined pieces drawn as parts of their own could part at the joints).
  if (H >= 12) newPart();
  if (H >= 12)
    for (const a of arms) {
      const w = H >= 26 ? 0.045 * H : 1;
      bough(c, a.x0 * H, a.y0 * H, a.x1 * H, a.y1 * H, w, w * 0.85);
      bough(c, a.x1 * H, a.y1 * H, a.x2 * H, a.y2 * H, w * 0.85, w * 0.7);
    }
  for (const e of H >= 12 ? ends : []) {
    newPart();
    const x = e.x2 * H,
      y = e.y2 * H,
      r = 0.07 * H,
      k = H >= 26 ? 18 : 6;
    // Dead leaves hanging below, then the living ones radiating out.
    for (let j = 0; j < (H >= 26 ? 6 : 2); j++) ray(c, x, y, (j / 5 - 0.5) * 0.8, 1, r * 0.7, M.WOOD, () => 2);
    for (let j = 0; j < k; j++) {
      const a = -2 + (4 * (j + 0.5)) / k,
        lit = Math.sin(a) < 0 ? 1 : 0;
      ray(c, x, y, Math.sin(a), -Math.cos(a), r * (0.75 + 0.25 * Math.cos(a * 3)), M.LEAF, (t) => 3 + lit + (t > 0.7 ? 1 : 0));
    }
  }
  if (H < 12) leafMasses(c, [{ x: 0, y: -th - 0.2, rx: 0.2, ry: 0.15 }], H, styleAt(H, 1), seed, false);
  return c.toImg(rampsFor("joshua-tree"), 0, 0);
}
/** An olive: a short, twisted, gnarled trunk of two stems, a broad and airy grey-green crown. */
function olive(H: number, seed: number): Img {
  const S = mulberry(seed),
    stems = [-1, 1].map((s) => ({ x: s * 0.04, h: 0.3 + 0.08 * S(), lean: -s * (0.06 + 0.08 * S()) })),
    limbList: Limb[] = [],
    masses: Mass[] = [];
  for (const st of stems)
    for (const side of [-1, 1]) {
      const x0 = st.x + st.lean,
        y0 = -st.h,
        ex = x0 + side * (0.12 + 0.1 * S()),
        ey = y0 - (0.18 + 0.12 * S());
      limbList.push({ x0, y0, x1: (x0 + ex) / 2 + (S() - 0.5) * 0.06, y1: (y0 + ey) / 2, x2: ex, y2: ey, w: 0.03 });
      masses.push({ x: ex, y: ey - 0.04, rx: 0.13 + 0.06 * S(), ry: 0.1 + 0.04 * S() });
    }
  masses.push({ x: (S() - 0.5) * 0.1, y: -0.82, rx: 0.16, ry: 0.11 });
  masses.sort((a, b) => a.y - b.y);
  const { c } = canvasFor(H, 1.3, seed);
  c.R = mulberry(seed + 99);
  for (const st of stems) stem(c, st.x * H, Math.round(st.h * H), H * 0.07, H * 0.045, st.lean * H, H, { cracks: 0.95 });
  limbs(c, limbList, H);
  leafMasses(c, masses, H, styleAt(H, 0.75, { density: 1.7, holes: 0.35, speckle: 0.8, rag: 1.6 }), seed, false);
  return c.toImg(rampsFor("olive"), 0, 0);
}

// ---- Narrow and weeping ------------------------------------------------------------------------
/** A column of foliage: a cypress (narrow, dark, pointed, needled) or a Lombardy poplar (wider,
 * leafy), from a short visible trunk, its outline bumped by a few side masses. */
function column(name: string, H: number, seed: number): Img {
  const S = mulberry(seed),
    cypress = name === "cypress",
    rx = cypress ? 0.075 + 0.02 * S() : 0.11 + 0.03 * S(),
    base = cypress ? 0.06 : 0.14,
    ry = (1 - base) / 2 - 0.01,
    masses: Mass[] = [{ x: 0, y: -base - ry, rx, ry }];
  for (let k = 0; k < 5; k++) masses.push({ x: (S() - 0.5) * rx * 1.2, y: -base - ry * (0.3 + 1.4 * S()), rx: rx * (0.55 + 0.25 * S()), ry: ry * 0.22 });
  masses.push({ x: 0, y: -0.96, rx: rx * 0.35, ry: 0.05 });
  const { c } = canvasFor(H, 0.5, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round((base + 0.1) * H), H * 0.035, H * 0.025, 0, H, { cracks: 0.5 });
  leafMasses(c, masses, H, styleAt(H, cypress ? 0.75 : 0.9, { density: 2.6, holes: cypress ? 0.02 : 0.08, needles: cypress, rag: cypress ? 1.3 : 1.2 }), seed, cypress);
  return c.toImg(rampsFor(name), 0, 0);
}
/** A weeping willow: a short leaning trunk, limbs up to a broad dome, curtains of hanging leaves. */
function willow(H: number, seed: number): Img {
  const S = mulberry(seed),
    lean = (S() - 0.5) * 0.15,
    th = 0.3 + 0.06 * S(),
    masses: Mass[] = [],
    limbList: Limb[] = [];
  for (const u of [-1, -0.35, 0.35, 1]) {
    const ex = lean + u * (0.2 + 0.05 * S()),
      ey = -(0.66 + 0.1 * (1 - u * u));
    limbList.push({ x0: lean, y0: -th, x1: lean + u * 0.08, y1: (-th + ey) / 2, x2: ex, y2: ey, w: 0.03 });
    masses.push({ x: ex, y: ey - 0.02, rx: 0.16 + 0.05 * S(), ry: 0.12 + 0.03 * S() });
  }
  masses.push({ x: lean, y: -0.88, rx: 0.18, ry: 0.1 });
  masses.sort((a, b) => a.y - b.y);
  const { c } = canvasFor(H, 1.4, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * 0.07, H * 0.05, lean * H, H, { cracks: 0.8 });
  limbs(c, limbList, H);
  leafMasses(c, masses, H, styleAt(H, 0.8, { density: 2, holes: 0.15, speckle: 0.5, rag: 1.4 }), seed, false);
  // Curtains: strands hanging from each mass's lower edge almost to the ground.
  if (H >= 12) {
    const R = mulberry(seed + 7);
    for (const m of masses) {
      newPart();
      const n = Math.round(m.rx * H * (H >= 26 ? 0.9 : 0.4));
      for (let j = 0; j < n; j++) {
        const u = n > 1 ? (j / (n - 1)) * 2 - 1 : 0,
          x0 = m.x * H + u * m.rx * H * 0.95,
          y0 = m.y * H + m.ry * H * Math.sqrt(Math.max(0, 1 - u * u)) * 0.7,
          len = H * (0.22 + 0.3 * R()) * (1 - 0.35 * Math.abs(u)),
          sway = (R() - 0.5) * 0.12;
        ray(c, x0, y0, sway + u * 0.08, 1, Math.min(len, -y0 - H * 0.05), M.LEAF, (t) => (t > 0.9 ? 2 : (j + Math.round(t * 9)) % 3 === 0 ? 4 : 3));
      }
    }
  }
  return c.toImg(rampsFor("willow"), 0, 0);
}
/** A juniper: low and irregular, one to three twisted stems, dense dark clumps of needles, now and
 * then a bare dead limb. */
function juniper(H: number, seed: number): Img {
  const S = mulberry(seed),
    ns = 1 + Math.floor(S() * 3),
    stems = Array.from({ length: ns }, (_, j) => ({ x: (j - (ns - 1) / 2) * 0.07, h: (j ? 0.5 : 0.72) + 0.12 * S(), lean: (S() - 0.5) * 0.3 })),
    masses: Mass[] = [],
    n = 9 + Math.floor(S() * 5),
    // Where a stem is at height f (fractions of H), as trunk() bends it.
    onStem = (st: (typeof stems)[0], f: number) => st.x + st.lean * Math.min(1, f / st.h) ** 2;
  for (let k = 0; k < n; k++) {
    // Each mass on a stem: around it, from a fifth of the way up to a little above its tip.
    const st = stems[k % ns],
      f = 0.2 + (st.h + 0.1 - 0.2) * S();
    masses.push({ x: onStem(st, f) + (S() - 0.5) * 0.3 * (1 - f * 0.5), y: -f, rx: 0.06 + 0.07 * S(), ry: 0.06 + 0.05 * S() });
  }
  masses.push({ x: onStem(stems[0], stems[0].h), y: -stems[0].h - 0.04, rx: 0.08, ry: 0.08 });
  masses.sort((a, b) => a.y - b.y);
  const dead = S() < 0.45 ? { side: S() < 0.5 ? -1 : 1, f: 0.4 + 0.3 * S() } : null,
    { c } = canvasFor(H, 1, seed);
  c.R = mulberry(seed + 99);
  for (const st of stems) stem(c, st.x * H, Math.round(st.h * H), H * 0.06, H * 0.03, st.lean * H, H, { cracks: 0.9 });
  if (dead && H >= 12) {
    newPart();
    bough(c, 0, -dead.f * H, dead.side * 0.32 * H, -(dead.f + 0.12) * H, H >= 26 ? H * 0.018 : 1, H >= 26 ? H * 0.006 : 1);
  }
  leafMasses(c, masses, H, styleAt(H, 0.8, { density: 2.2, holes: 0.14, needles: true, rag: 1.9 }), seed, true);
  return c.toImg(rampsFor("juniper"), 0, 0);
}
/** A snag: a dead tree, its top broken off, a few bare limbs, some of them broken short. */
function snag(H: number, seed: number): Img {
  const S = mulberry(seed),
    th = 0.8 + 0.12 * S(),
    lean = (S() - 0.5) * 0.08,
    limbList: Limb[] = [],
    n = 5 + Math.floor(S() * 4);
  let side = S() < 0.5 ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const f = 0.3 + 0.58 * S(),
      x0 = lean * (f / th) ** 2,
      len = (S() < 0.3 ? 0.06 : 0.13 + 0.14 * S()) * (1 - f * 0.35),
      ang = side * (0.6 + 0.6 * S());
    limbList.push({ x0, y0: -f, x1: x0 + Math.sin(ang) * len * 0.5, y1: -f - Math.cos(ang) * len * 0.5, x2: x0 + Math.sin(ang * 0.8) * len, y2: -f - Math.cos(ang * 0.8) * len, w: 0.02 });
    side = -side;
  }
  const { c } = canvasFor(H, 0.9, seed);
  c.R = mulberry(seed + 99);
  stem(c, 0, Math.round(th * H), H * 0.05, H * 0.025, lean * H, H, { cracks: 0.9 });
  // The broken top: a few splinters.
  if (H >= 26)
    for (let k = -1; k <= 1; k++) {
      const h = Math.round((0.01 + 0.02 * S()) * H);
      for (let d = 0; d < h; d++) c.set(Math.round(lean * H + k * Math.max(1, H * 0.006)), -1 - Math.round(th * H) - d, M.WOOD, k < 0 ? 3 : 2);
    }
  limbs(c, limbList, H);
  return c.toImg(rampsFor("snag"), 0, 0);
}

/** Each kind's drawing, by name (spruce, fir and larch are conifers; the broadleaves from art.ts). */
const DRAW: Record<string, (H: number, seed: number) => Img> = {
  pine,
  "stone-pine": stonePine,
  palm,
  "fan-palm": fanPalm,
  "tree-fern": treeFern,
  banana,
  acacia,
  baobab,
  "joshua-tree": joshua,
  olive,
  cypress: (H, s) => column("cypress", H, s),
  poplar: (H, s) => column("poplar", H, s),
  willow,
  juniper,
  snag,
};
export function treeDraw(name: string) {
  return (H: number, seed: number) => {
    if (name === "spruce" || name === "fir" || name === "larch") return conifer(name, H, seed);
    const d = DRAW[name];
    return d ? d(H, seed) : broadleaf(name, H, seed);
  };
}

