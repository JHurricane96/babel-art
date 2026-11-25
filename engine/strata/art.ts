// Strata art: crafted sprites for the land, drawn in shades.
//
// Every cell a sprite draws carries a tone, 1 (darkest) to 6 (brightest), on
// its material's colour ramp (the renderer builds ramps from each biome's or
// species' colours, shadows cooler and highlights warmer), so sprites carry
// their own light: lit from the upper left, shaded beneath, with highlight
// speckles and dark rims where forms turn away.
//
// Small things are drawn by hand (the stamps below: leaf and needle texture,
// grass tufts, flowers); bigger things (crowns, trunks, ferns, boulders,
// logs) are built from hand-made rules: a crown is a heap of leaf clumps, each shaded as a little
// sphere, textured with the leaf stamp, lit more toward the crown's top left.
import { M } from "./world";

/** Draws into a sprite: x, y in sprite or world cells, a material, a tone 1..6. */
export interface Canvas {
  set(x: number, y: number, m: number, tone: number): void;
  R: () => number;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bay = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const clampT = (t: number) => (t < 1 ? 1 : t > 6 ? 6 : t);

// ---- Hand-drawn stamps ---------------------------------------------------------
// Characters: '.' empty; '1'-'6' the stamp's main material at that tone;
// 'a'-'f' leaf tones 1-6; 'A'-'E' wood tones 1-5; 'p'-'u' bloom tones 1-6;
// 'g'-'l' grass tones 1-6.

/** Leaf texture: offsets laid over a clump's shading so it reads as leaves, not a ball. */
const LEAF_TEX = [
  "0+0-00+0+00-",
  "++0--0++00--",
  "+0-00+0+-0+0",
  "0-00++0-0+++",
  "-0+0+--00+0-",
  "0++0-00+0-00",
  "+00--0+++0-0",
  "0-0+0++0-00+",
].map((r) => [...r].map((c) => (c === "+" ? 1 : c === "-" ? -1 : 0)));

/** Needle texture for conifers: short dark strokes hanging down. */
const NEEDLE_TEX = [
  "0+00-0+00-",
  "0+0--0+0-0",
  "+0-00+00-0",
  "0-00+0-0+0",
  "-00+0-0+00",
].map((r) => [...r].map((c) => (c === "+" ? 1 : c === "-" ? -1 : 0)));

export const TUFTS = [
  ["...l...", "..k.l..", ".k..k.l", "k..jk.k", ".j.jk.j", "j.ijki.", ".iijji.", "hiijjih"],
  ["..l..l.", ".k.lk..", "k.k.k.k", ".jk.jk.", "j.jjk.j", ".ijjji.", "hhiiihh"],
  ["l...", ".k.l", "k.k.", ".jk.", "jjk.", "iij.", "hii."],
  ["....l", "...k.", ".lk..", "k.jk.", ".jjk.", "ijj..", "hii.."],
];

/** Flowers: a stem (grass tones) under a head (bloom tones). */
export const BLOOMS = [
  // A bell hanging from an arched stem (bluebell).
  [".jk..", "j..k.", "j..q.", "i.rsr", "i.qrq", "h...."],
  // A daisy head on a straight stem.
  [".rsr.", "rtutr", ".rsr.", "..j..", "..j..", "..i..", "..h.."],
  // A spike of small flowers (foxglove).
  ["..t..", ".s.s.", "..r..", ".r.s.", "..q..", ".q.r.", "..j..", "..i..", "..h.."],
];

/** Stamp a hand-drawn sprite with its bottom-left at (x, y) (y the row just above the ground). */
export function stamp(c: Canvas, rows: string[], x: number, y: number, flip = false) {
  const h = rows.length,
    w = rows[0].length;
  for (let r = 0; r < h; r++)
    for (let k = 0; k < w; k++) {
      const ch = rows[r][flip ? w - 1 - k : k];
      if (ch === ".") continue;
      const code = ch.charCodeAt(0);
      let m: number = M.LEAF,
        t = 0;
      if (ch >= "a" && ch <= "f") t = code - 96;
      else if (ch >= "A" && ch <= "E") {
        m = M.WOOD;
        t = code - 64;
      } else if (ch >= "p" && ch <= "u") {
        m = M.FLOWER;
        t = code - 111;
      } else if (ch >= "g" && ch <= "l") {
        m = M.GRASS;
        t = code - 102;
      } else if (ch >= "1" && ch <= "6") t = code - 48;
      c.set(x + k, y - (h - 1 - r), m, t);
    }
}

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

/**
 * A crown: leaf clumps heaped inside an ellipse centred at (cx, cy), each a
 * shaded little sphere, nearer ones (drawn later) over farther. Lit from the
 * upper left; the crown's own underside and right side in shadow.
 */
export function crown(c: Canvas, cx: number, cy: number, rx: number, ry: number, st: CrownStyle) {
  const R = c.R,
    n = Math.max(3, Math.round((Math.PI * rx * ry * st.density) / (st.r0 * st.r1))),
    clumps: { x: number; y: number; r: number; z: number }[] = [];
  for (let k = 0; k < n; k++) {
    // Uniform in the ellipse, the outer ones a little smaller.
    const a = R() * Math.PI * 2,
      d = Math.sqrt(R()),
      x = cx + Math.cos(a) * d * (rx - st.r0 * 0.6),
      y = cy + Math.sin(a) * d * (ry - st.r0 * 0.6),
      r = st.r0 + (st.r1 - st.r0) * R() * (1 - 0.4 * d);
    // Nearer to the viewer toward the crown's front-bottom-left (a guess at depth).
    clumps.push({ x, y, r, z: R() + 0.3 * (y - cy) / ry });
  }
  clumps.sort((p, q) => p.z - q.z);
  for (const q of clumps) {
    // The crown's own light: brighter toward its top left.
    const pos = 0.5 - 0.5 * ((q.x - cx) / rx) * 0.45 - 0.5 * ((q.y - cy) / ry) * 0.9;
    clump(c, q.x, q.y, q.r, pos, st);
  }
}

/** Light direction (toward the light): from the upper left, toward the viewer. */
const LX = -0.55,
  LY = -0.7,
  LZ = 0.45;

/** A cheap hash of a cell and a salt, 0..1. */
const hashCell = (x: number, y: number, s: number) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};
const EDGE = new Float32Array(32);

/** One leaf clump: a ragged disc shaded as a sphere, textured, speckled, rimmed. */
function clump(c: Canvas, cx: number, cy: number, r: number, pos: number, st: CrownStyle) {
  const R = c.R,
    ox = Math.floor(R() * 12),
    oy = Math.floor(R() * 8),
    salt = Math.floor(R() * 1e9),
    tex = st.needles ? NEEDLE_TEX : LEAF_TEX,
    // A ragged outline: the radius wobbles around the clump (a table by angle).
    lobes = 5 + Math.floor(R() * 4),
    phase = R() * 6.28,
    rag = (0.12 + 0.08 * R()) * (st.rag ?? 1);
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2 - Math.PI;
    EDGE[k] = r * (1 + rag * Math.sin(lobes * a + phase) + rag * 0.5 * Math.sin(2.3 * lobes * a));
  }
  const x0 = Math.floor(cx - r - 1),
    x1 = Math.ceil(cx + r + 1),
    y0 = Math.floor(cy - r - 1),
    y1 = Math.ceil(cy + r + 1),
    holes = st.holes * 0.02,
    speck = st.speckle * 0.25,
    tw = tex[0].length,
    th = tex.length;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy,
        rr = dx * dx + dy * dy;
      if (rr > r * r * 1.45) continue;
      const bin = ((Math.atan2(dy, dx) + Math.PI) * (32 / (Math.PI * 2))) | 0,
        edge = EDGE[bin > 31 ? 31 : bin],
        d = Math.sqrt(rr) / edge;
      if (d > 1) continue;
      const hc = hashCell(x, y, salt);
      if (holes && d < 0.8 && hc < holes) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d * d)),
        nx = dx / edge,
        ny = dy / edge,
        lam = Math.max(0, nx * LX + ny * LY + nz * LZ),
        // Shade: the clump's sphere and the crown's position, in five steps.
        v = 0.55 * lam + 0.45 * pos,
        tx = tex[(((y + oy) % th) + th) % th][(((x + ox) % tw) + tw) % tw];
      let t = 1 + Math.floor(v * 5 + bay(x, y) - 0.25) + tx;
      // A dark rim where the clump turns away, under and to the right.
      if (d > 0.82 && nx * LX + ny * LY < 0) t -= 1 + (d > 0.93 ? 1 : 0);
      // Highlight speckles where it is lit.
      if (t >= 4 && hc > 1 - speck) t = 6;
      c.set(x, y, M.LEAF, clampT(Math.min(t, 6)));
    }
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

/** A limb: a crooked bough in two segments, thick at its root, lit on top. Returns its end. */
function limb(c: Canvas, x0: number, y0: number, ang: number, len: number, w: number) {
  const R = c.R,
    kink = (R() - 0.5) * 0.7,
    mx = x0 + Math.sin(ang) * len * 0.5,
    my = y0 - Math.cos(ang) * len * 0.5,
    ex = mx + Math.sin(ang + kink) * len * 0.5,
    ey = my - Math.cos(ang + kink) * len * 0.5;
  branch(c, x0, y0, mx, my, w);
  branch(c, mx, my, ex, ey, Math.max(1, w - 1));
  return { x: ex, y: ey };
}

/** Hanging fringes under a birch's crown: thin strands of leaves. */
function fringe(c: Canvas, cx: number, cy: number, rx: number, ry: number) {
  const R = c.R,
    n = Math.round(rx * 1.4);
  for (let k = 0; k < n; k++) {
    const u = (k / Math.max(1, n - 1)) * 2 - 1,
      x = Math.round(cx + u * rx * 0.95),
      y0 = Math.round(cy + ry * Math.sqrt(Math.max(0, 1 - u * u)) * 0.8),
      len = 3 + Math.floor(R() * (5 + 5 * (1 - Math.abs(u))));
    for (let d = 0; d < len; d++) if (R() < 0.85) c.set(x + (d > len * 0.6 ? Math.sign(u) : 0), y0 + d, M.LEAF, d === len - 1 ? 2 : 3 + (d % 2));
  }
}

/** A tree standing on the ground at (x, ground) (the ground row), grown in its kind's form. */
export function tree(c: Canvas, kind: TreeKind, x: number, ground: number, scale = 1) {
  const R = c.R,
    h = Math.round((kind.h0 + (kind.h1 - kind.h0) * R()) * scale),
    w0 = kind.w0 * scale,
    w1 = kind.w1 * scale,
    st = kind.style;
  switch (kind.form) {
    case "oak": {
      // A short, stout, crooked trunk splitting into gnarled limbs, each
      // carrying its own mass of leaves: a wide, broken crown.
      const th = Math.round(h * (0.3 + 0.1 * R())),
        top = trunk(c, x, ground - 1, th, w0, w1 + 1, (R() - 0.5) * 4, kind.bark),
        n = 4 + Math.floor(R() * 2),
        lobes: { x: number; y: number; r: number }[] = [];
      for (let k = 0; k < n; k++) {
        const side = n === 1 ? 0 : (k / (n - 1)) * 2 - 1,
          ang = side * (0.95 + 0.3 * R()) + (R() - 0.5) * 0.2,
          end = limb(c, top.x, top.y, ang, h * (0.4 + 0.16 * R()) * (1 - 0.2 * Math.abs(side)), Math.max(2, Math.round(w1))),
          r = h * (0.15 + 0.05 * R());
        lobes.push({ x: end.x, y: end.y - r * 0.2, r });
      }
      lobes.push({ x: top.x + (R() - 0.5) * 6, y: top.y - h * 0.5, r: h * 0.16 });
      // Higher lobes are farther back: draw them first.
      lobes.sort((a, b) => a.y - b.y);
      for (const l of lobes) crown(c, l.x, l.y, l.r * 1.15, l.r * 0.72, st);
      break;
    }
    case "beech": {
      // A tall smooth grey column into a tall, smooth dome.
      const th = Math.round(h * 0.62),
        top = trunk(c, x, ground - 1, th, w0, w1, (R() - 0.5) * 2, kind.bark),
        rx = h * (0.24 + 0.04 * R()),
        ry = h * (0.33 + 0.04 * R()),
        cy = ground - h + ry;
      for (const s of [-1, 1]) limb(c, top.x, top.y + 6, s * 0.5, h * 0.25, Math.max(1, Math.round(w1 - 1)));
      crown(c, top.x, cy, rx, ry, st);
      crown(c, top.x + (R() - 0.5) * rx * 0.6, cy - ry * 0.55, rx * 0.55, ry * 0.4, st);
      break;
    }
    case "maple": {
      // A round, ragged crown, with lower lobes either side.
      const th = Math.round(h * 0.42),
        top = trunk(c, x, ground - 1, th, w0, w1, (R() - 0.5) * 3, kind.bark),
        r = h * (0.27 + 0.04 * R()),
        cy = ground - h + r;
      for (const s of [-1, 1]) {
        const e = limb(c, top.x, top.y, s * (0.7 + 0.2 * R()), h * 0.28, Math.max(1, Math.round(w1)));
        crown(c, e.x, e.y + r * 0.1, r * 0.62, r * 0.5, st);
      }
      crown(c, top.x, cy, r * 1.05, r * 0.92, st);
      break;
    }
    case "birch": {
      // One to three slender stems, a narrow airy crown with hanging fringes.
      const stems = R() < 0.45 ? 1 + Math.floor(R() * 3) : 1;
      for (let k = 0; k < stems; k++) {
        const hh = Math.round(h * (1 - 0.13 * k)),
          dx = k === 0 ? 0 : (k % 2 ? -1 : 1) * (2 + Math.floor(R() * 2)),
          lean = dx * 2.2 + (R() - 0.5) * 3,
          top = trunk(c, x + dx, ground - 1, Math.round(hh * 0.8), w0, w1, lean, kind.bark),
          rx = hh * (0.11 + 0.03 * R()),
          ry = hh * (0.3 + 0.04 * R()),
          cy = ground - hh + ry;
        crown(c, top.x, cy, rx, ry, st);
        fringe(c, top.x, cy, rx, ry);
      }
      break;
    }
    case "hazel": {
      // A vase of thin stems from one stool, leafy toward their tips.
      const n = 4 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) {
        const ang = ((k / (n - 1)) * 2 - 1) * 0.55,
          e = limb(c, x, ground - 1, ang, h * (0.75 + 0.3 * R()), 1);
        crown(c, e.x, e.y + 2, 4 + R() * 2, 3 + R() * 1.5, st);
      }
      break;
    }
  }
  return h;
}

/** A shrub: a low heap of clumps from the ground. */
export function shrub(c: Canvas, x: number, ground: number, w: number, h: number) {
  crown(c, x, ground - h / 2, w / 2, h / 2, { r0: 3, r1: 5, density: 1.8, speckle: 0.35, holes: 0 });
}

// ---- Boulders ---------------------------------------------------------------------

/**
 * A boulder: a faceted stone, each facet lit by its own slope (light from the
 * upper left), a dark underside where it sits, moss on its top in wet woods.
 */
export function boulder(c: Canvas, x: number, ground: number, w: number, h: number, moss: number) {
  const R = c.R,
    // A ring of points around an ellipse, jittered: the stone's outline.
    n = 7 + Math.floor(R() * 3),
    pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.PI + (k / (n - 1)) * Math.PI,
      rr = 0.8 + 0.25 * R();
    pts.push([x + Math.cos(a) * (w / 2) * rr, ground - Math.max(0, -Math.sin(a)) * h * rr]);
  }
  // The facets: triangles from a raised centre toward each edge of the outline.
  const apx = x - w * 0.1,
    apy = ground - h * 0.55;
  for (let k = 0; k < n - 1; k++) {
    const [ax, ay] = pts[k],
      [bx, by] = pts[k + 1],
      // The facet's slope: its outward direction, tilted up.
      mx = (ax + bx) / 2 - apx,
      my = (ay + by) / 2 - apy,
      len = Math.hypot(mx, my) || 1,
      nx = (mx / len) * 0.7,
      ny = (my / len) * 0.7,
      nz = 0.71,
      lam = Math.max(0, nx * LX + ny * LY + nz * LZ),
      tone = clampT(1 + Math.round(lam * 4.4));
    tri(c, apx, apy, ax, ay, bx, by, tone);
  }
  // Close the base: the facet facing down to the ground, in shadow.
  const [lx, ly] = pts[0],
    [rx, ry] = pts[n - 1];
  tri(c, apx, apy, rx, ry, lx, ly, 2);
  // The underside, where it meets the ground, in shadow.
  for (let px = Math.floor(x - w / 2); px <= Math.ceil(x + w / 2); px++) c.set(px, ground, M.ROCK, 1);
  // Moss on its top.
  if (moss > 0)
    for (let px = Math.floor(x - w / 2); px <= Math.ceil(x + w / 2); px++)
      if (R() < moss) {
        const top = topOf(pts, px);
        if (top !== null) c.set(px, Math.round(top), M.LEAF, R() < 0.5 ? 4 : 3);
      }
}

function topOf(pts: [number, number][], x: number) {
  let best: number | null = null;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k],
      [bx, by] = pts[k + 1];
    if ((x - ax) * (x - bx) > 0 || ax === bx) continue;
    const y = ay + ((by - ay) * (x - ax)) / (bx - ax);
    if (best === null || y < best) best = y;
  }
  return best;
}

function tri(c: Canvas, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, tone: number) {
  const x0 = Math.floor(Math.min(ax, bx, cx)),
    x1 = Math.ceil(Math.max(ax, bx, cx)),
    y0 = Math.floor(Math.min(ay, by, cy)),
    y1 = Math.ceil(Math.max(ay, by, cy)),
    area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-6) return;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5,
        py = y + 0.5,
        w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area,
        w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area,
        w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      c.set(x, y, M.ROCK, tone);
    }
}

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

/** A fallen log lying along the ground, lit on top, its cut end showing rings. */
export function log(c: Canvas, x: number, ground: number, len: number, thick: number, dir: number) {
  for (let k = 0; k < len; k++)
    for (let d = 0; d < thick; d++) {
      const tone = d === 0 ? 4 : d === thick - 1 ? 1 : d === 1 ? 3 : 2;
      c.set(x + k * dir, ground - 1 - (thick - 1 - d), M.WOOD, tone);
    }
  // The cut end: pale wood in rings.
  for (let d = 0; d < thick; d++) c.set(x + (len - 1) * dir, ground - 1 - (thick - 1 - d), M.WOOD, d % 2 ? 5 : 4);
}
