// Vista's trees: every species the biomes name, drawn at any height in pixels: a layout made
// once per drawing (in fractions of the height, from its own random numbers), drawn the same at
// every size; big sizes heap shaded leaf clumps into each mass, small ones shade each mass whole.
import { M } from "../../../engine/strata/world";
import { TREES, type CrownStyle, branch, trunk } from "../../../engine/strata/art";
import { hex, rampOf } from "./color";
import { mulberry } from "./common";
import { type Img, type Mass, type MatCanvas, blade, bay, canvasFor, crownV, hashCell, massSmall, newPart, stemSmall } from "./draw";
export type { Mass } from "./draw";

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
export const TREE_NAMES = ["oak", "beech", "maple", "birch", "spruce", "fir", "pine"];
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

export function treeDraw(name: string) {
  return (H: number, seed: number) => {
    if (name === "spruce" || name === "fir") return conifer(name, H, seed);
    if (name === "pine") return pine(H, seed);
    return broadleaf(name, H, seed);
  };
}

