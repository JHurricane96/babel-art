// Strata art: crafted shapes for sprites, drawn in shades.
//
// Every cell a sprite draws carries a tone, 1 (darkest) to 6 (brightest), on
// its material's colour ramp (the renderer builds ramps from each biome's or
// species' colours, shadows cooler and highlights warmer), so sprites carry
// their own light: lit from the upper left, shaded beneath.
//
// Vista's sprites (tools/strata-lab/vista/sprites.ts) draw their trees, shrubs and
// ground cover with these: trunks and branches, the kinds of broadleaf tree, a
// fern. (Rocks are drawn by tools/strata-lab/vista/rocks.ts.)
import { M } from "./world";

/** Draws into a sprite: x, y in sprite or world cells, a material, a tone 1..6. */
export interface Canvas {
  set(x: number, y: number, m: number, tone: number): void;
  R: () => number;
}

const clampT = (t: number) => (t < 1 ? 1 : t > 6 ? 6 : t);
/** The light, from the upper left and a little toward the viewer. */
const LX = -0.55,
  LY = -0.7,
  LZ = 0.45;

// ---- Crowns ----------------------------------------------------------------------

export interface CrownStyle {
  /** Clump radius range, and how many clumps per area. */
  r0: number;
  r1: number;
  density: number;
  /** Highlight speckles (0..1), holes showing sky (0..1), needle texture. */
  speckle: number;
  holes: number;
  needles?: boolean;
  /** How ragged each clump's outline is (1 = usual; beech smoother, maple rougher). */
  rag?: number;
}

// ---- Trunks and branches -----------------------------------------------------------

export interface BarkStyle {
  /** Birch: pale bark with dark marks. */
  marks?: boolean;
  /** Dark vertical cracks (0..1). */
  cracks: number;
}

/**
 * A trunk from (x, base) up h cells, w0 wide at the foot and w1 at the top,
 * bending by lean, with a flare of roots; shaded across its width (lit on
 * the left), barked. Returns the top's centre.
 */
export function trunk(
  c: Canvas,
  x: number,
  base: number,
  h: number,
  w0: number,
  w1: number,
  lean: number,
  bark: BarkStyle,
) {
  const R = c.R;
  let top = { x, y: base - h };
  for (let k = 0; k <= h; k++) {
    const t = k / h,
      flare = k < 4 ? (4 - k) * 0.6 : 0,
      w = w0 + (w1 - w0) * t + flare,
      cx = x + lean * t * t,
      l = Math.round(cx - w / 2),
      r = Math.round(cx + w / 2);
    for (let px = l; px <= Math.max(l, r - 1); px++) {
      const u = (px + 0.5 - (cx - w / 2)) / Math.max(1, w),
        // Lit on the left, shadowed on the right, darkest at the right edge.
        shade = u < 0.3 ? 4 : u < 0.55 ? 3 : u < 0.85 ? 2 : 1;
      let tone = shade;
      if (bark.marks && R() < 0.07) tone = 1;
      else if (!bark.marks && (px * 7 + Math.floor(k / 3) * 3) % 11 === 0 && R() < bark.cracks) tone = Math.max(1, tone - 1);
      if (k < 2) tone = Math.max(1, tone - 1);
      c.set(px, base - k, M.WOOD, tone);
    }
    if (k === h) top = { x: cx, y: base - h };
  }
  return top;
}

/** A branch from (x0, y0) to (x1, y1), thick at its root, lit on top. */
export function branch(c: Canvas, x0: number, y0: number, x1: number, y1: number, w: number) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let k = 0; k <= n; k++) {
    const t = k / Math.max(1, n),
      x = x0 + (x1 - x0) * t,
      y = y0 + (y1 - y0) * t,
      ww = Math.max(1, Math.round(w * (1 - 0.6 * t)));
    for (let d = 0; d < ww; d++) c.set(Math.round(x), Math.round(y) + d, M.WOOD, d === 0 ? 3 : d === ww - 1 ? 1 : 2);
  }
}

// ---- Trees ------------------------------------------------------------------------

export interface TreeKind {
  name: string;
  /** How it grows: its silhouette. */
  form: "oak" | "beech" | "maple" | "birch" | "hazel";
  /** Height range; trunk width at foot and top. */
  h0: number;
  h1: number;
  w0: number;
  w1: number;
  style: CrownStyle;
  bark: BarkStyle;
}

export const TREES: Record<string, TreeKind> = {
  oak: {
    name: "oak", form: "oak", h0: 50, h1: 76, w0: 7, w1: 4,
    style: { r0: 5, r1: 9, density: 1.6, speckle: 0.5, holes: 0.3, rag: 1.2 },
    bark: { cracks: 0.8 },
  },
  beech: {
    name: "beech", form: "beech", h0: 66, h1: 96, w0: 5, w1: 3,
    style: { r0: 6, r1: 10, density: 1.7, speckle: 0.35, holes: 0.15, rag: 0.6 },
    bark: { cracks: 0.05 },
  },
  maple: {
    name: "maple", form: "maple", h0: 48, h1: 70, w0: 4, w1: 3,
    style: { r0: 5, r1: 8, density: 1.8, speckle: 0.45, holes: 0.2, rag: 1.5 },
    bark: { cracks: 0.5 },
  },
  birch: {
    name: "birch", form: "birch", h0: 52, h1: 78, w0: 3, w1: 2,
    style: { r0: 3, r1: 5, density: 1.2, speckle: 0.7, holes: 1.2, rag: 1.1 },
    bark: { marks: true, cracks: 0 },
  },
  hazel: {
    name: "hazel", form: "hazel", h0: 14, h1: 22, w0: 1, w1: 1,
    style: { r0: 3, r1: 5, density: 1.7, speckle: 0.4, holes: 0.1 },
    bark: { cracks: 0 },
  },
};

/**
 * A fern: fronds arching out from one crown, each a stem lined with
 * leaflets, lit on their upper side, bending down toward their tips.
 */
export function fern(c: Canvas, x: number, ground: number, size: number) {
  const R = c.R,
    n = 5 + Math.floor(R() * 3);
  for (let k = 0; k < n; k++) {
    const a = (k / (n - 1) - 0.5) * 1.8 + (R() - 0.5) * 0.25,
      L = size * (0.8 + 0.3 * R()) * (1 - 0.2 * Math.abs(a) / 0.9),
      droop = 0.25 + 0.35 * Math.abs(a);
    let last = -1;
    for (let s = 1; s <= L; s++) {
      const t = s / L,
        px = Math.round(x + Math.sin(a) * L * t),
        py = Math.round(ground - 1 - Math.cos(a) * L * t * 0.9 + droop * L * t * t);
      c.set(px, py, M.LEAF, t > 0.85 ? 5 : 3);
      // Leaflets in pairs, shorter toward the tip.
      if (s % 2 === 0 && s !== last) {
        last = s;
        const len = Math.max(1, Math.round((1 - t) * 2.2));
        for (let d = 1; d <= len; d++) {
          c.set(px - Math.sign(Math.sin(a) || 1) * 0 , py - d, M.LEAF, 4 + (d === len ? 1 : 0));
          c.set(px + (Math.sin(a) >= 0 ? d : -d), py + 1, M.LEAF, 2);
        }
      }
    }
  }
  c.set(x, ground - 1, M.LEAF, 1);
}
