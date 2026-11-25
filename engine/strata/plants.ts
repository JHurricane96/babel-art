// Strata plants: tree, shrub and cactus species, drawn into the cell grid as
// leaves and wood standing on the ground. Each biome (biomes.ts) names the
// species that grow in it and how often; each species has its own shape and
// may have its own colours (birch bark, larch gold, olive silver).
import { M } from "./world";

/** What a species draws with: a cell setter (only into open air) and a random stream. */
export interface Grow {
  put: (x: number, y: number, m: number) => boolean;
  R: () => number;
}

/** Draws one plant whose base is column x, standing on the ground cell at row s. */
type Shape = (g: Grow, x: number, s: number, snowy: boolean) => void;

export interface Species {
  name: string;
  shape: Shape;
  /** Its own leaf and bark colours, where its biome's would be wrong. */
  leaf?: string;
  bark?: string;
  bloom?: string;
  /** The steepest ground it grows on (rise over five columns). */
  slope: number;
}

// ---- Drawing helpers ---------------------------------------------------------

function line(g: Grow, x0: number, y0: number, x1: number, y1: number, m: number) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0),
    sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (let n = 0; n < 400; n++) {
    g.put(x0, y0, m);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) {
      e += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      e += dx;
      y0 += sy;
    }
  }
}

/** A leafy ellipse with a ragged edge; fill < 1 leaves gaps inside too. */
function ellipse(
  g: Grow,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  m: number = M.LEAF,
  fill = 1,
  flatBelow = Infinity,
) {
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    if (dy > flatBelow) continue;
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if ((d < 0.72 && g.R() < fill) || (d < 1.05 && g.R() < 0.5 * fill))
        g.put(Math.round(cx + dx), Math.round(cy + dy), m);
    }
  }
}

/** A trunk w cells wide from the ground up h cells, bending by lean at the top. */
function trunk(g: Grow, x: number, s: number, h: number, w = 1, lean = 0) {
  for (let k = 1; k <= h; k++) {
    const off = Math.round(lean * (k / h) * (k / h));
    for (let t = 0; t < w; t++) g.put(x + off + t, s - k, M.WOOD);
  }
  return x + Math.round(lean);
}

const between = (g: Grow, a: number, b: number) => a + (b - a) * g.R();
const int = (g: Grow, a: number, b: number) => Math.floor(between(g, a, b + 1));

// ---- Shapes ------------------------------------------------------------------

/** A conifer cone in tiers; sparse ones (larch) show gaps; snow lies on the tiers. */
const cone =
  (lo: number, hi: number, width: number, sparse = 0, droop = 0): Shape =>
  (g, x, s, snowy) => {
    const H = int(g, lo, hi),
      foot = int(g, 2, 4),
      crown = H - foot,
      maxHalf = Math.max(2, crown * width);
    trunk(g, x, s, H - 1);
    for (let k = 0; k < crown; k++) {
      const y = s - H + k,
        tier = k % 4,
        half = Math.round((k / crown) * maxHalf) - (tier === 0 ? 1 : 0);
      for (let d = -half; d <= half; d++) {
        if (d !== 0 && g.R() < sparse) continue;
        const edge = Math.abs(d) === half;
        g.put(
          x + d,
          y + (edge && droop && tier === 3 && g.R() < droop ? 1 : 0),
          snowy && (tier === 0 || edge) && g.R() < 0.6 ? M.SNOW : M.LEAF,
        );
      }
    }
  };

/** A narrow column (cypress, poplar): a flame of leaves on a short trunk. */
const column =
  (lo: number, hi: number, rx: number): Shape =>
  (g, x, s) => {
    const H = int(g, lo, hi),
      foot = int(g, 1, 3),
      r = between(g, rx * 0.8, rx * 1.2);
    trunk(g, x, s, foot + 2);
    for (let k = 0; k < H - foot; k++) {
      const t = k / (H - foot),
        half = r * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.8) * (1 - 0.6 * t);
      for (let d = -Math.ceil(half); d <= Math.ceil(half); d++)
        if (Math.abs(d) <= half || g.R() < 0.4) g.put(x + d, s - foot - k, M.LEAF);
    }
  };

/** Round broadleaf (oak, maple, teak): a forked trunk under a heaped crown of lobes. */
const round =
  (lo: number, hi: number, r0: number, r1: number, wide = 1.3, tall = 1): Shape =>
  (g, x, s) => {
    const h = int(g, lo, hi),
      w = h > 10 ? 2 : 1,
      top = trunk(g, x, s, h, w, between(g, -1.5, 1.5)),
      r = between(g, r0, r1),
      cy = s - h - r * 0.55 * tall;
    // Two boughs forking into the crown.
    line(g, top, s - h + 1, top - r * 0.5, cy + 1, M.WOOD);
    line(g, top + w - 1, s - h + 1, top + w - 1 + r * 0.5, cy + 1, M.WOOD);
    ellipse(g, top + w / 2, cy, r * wide, r * 0.75 * tall);
    const lobes = 3 + int(g, 0, 2);
    for (let i = 0; i < lobes; i++) {
      const a = Math.PI * (0.1 + 0.8 * (i / (lobes - 1 || 1))) + between(g, -0.2, 0.2);
      ellipse(
        g,
        top + w / 2 - Math.cos(a) * r * wide * 0.75,
        cy - Math.sin(a) * r * 0.55 * tall,
        r * between(g, 0.45, 0.65) * wide,
        r * between(g, 0.4, 0.55) * tall,
      );
    }
  };

/** Slender broadleaf (birch, aspen, alder): thin stems, a narrow airy crown. */
const oval =
  (lo: number, hi: number, stems = 1): Shape =>
  (g, x, s) => {
    const n = stems > 1 && g.R() < 0.5 ? stems : 1;
    for (let i = 0; i < n; i++) {
      const h = int(g, lo, hi) - i * 3,
        dx = i === 0 ? 0 : i % 2 ? -2 : 2,
        top = trunk(g, x + dx, s, h, 1, dx * 0.6),
        rx = between(g, 2.5, 4),
        ry = between(g, 5, 8);
      ellipse(g, top, s - h - ry * 0.6, rx, ry, M.LEAF, 0.8);
    }
  };

/** Scots pine: a tall bare trunk, crowned with flat clumps on short branches. */
const pine: Shape = (g, x, s) => {
  const h = int(g, 16, 28),
    top = trunk(g, x, s, h, 1, between(g, -2, 2)),
    clumps = 2 + int(g, 0, 2);
  for (let i = 0; i < clumps; i++) {
    const y = s - h + i * 3 + int(g, 0, 2),
      dir = i % 2 ? 1 : -1,
      len = int(g, 2, 5);
    line(g, top, y, top + dir * len, y - 1, M.WOOD);
    ellipse(g, top + dir * len, y - 2, between(g, 3, 5), between(g, 1.4, 2.2));
  }
  ellipse(g, top, s - h - 2, between(g, 3, 4.5), 2);
};

/** Umbrella crown (acacia, stone pine): a trunk forking under one flat, wide crown. */
const umbrella =
  (lo: number, hi: number, r0: number, r1: number, thick: number): Shape =>
  (g, x, s) => {
    const h = int(g, lo, hi),
      fork = Math.round(h * between(g, 0.45, 0.6)),
      top = trunk(g, x, s, fork, 1, between(g, -1, 1)),
      rx = between(g, r0, r1),
      cy = s - h;
    line(g, top, s - fork, top - rx * 0.45, cy + 1, M.WOOD);
    line(g, top, s - fork, top + rx * 0.4, cy + 1, M.WOOD);
    if (g.R() < 0.5) line(g, top, s - fork, top + between(g, -2, 2), cy, M.WOOD);
    ellipse(g, top, cy - thick * 0.4, rx, thick, M.LEAF, 1, thick * 0.25);
    if (g.R() < 0.5)
      ellipse(g, top + between(g, -rx, rx) * 0.4, cy - thick, rx * 0.55, thick * 0.6, M.LEAF, 1, 0);
  };

/** Weeping willow: a leaning trunk, a dome of leaves and long hanging strands. */
const willow: Shape = (g, x, s) => {
  const h = int(g, 6, 10),
    top = trunk(g, x, s, h, 2, between(g, -2, 2)),
    rx = between(g, 7, 10),
    ry = between(g, 3.5, 5),
    cy = s - h - ry * 0.4;
  ellipse(g, top + 1, cy, rx, ry);
  for (let d = -Math.floor(rx); d <= Math.floor(rx); d++) {
    if (g.R() < 0.35) continue;
    const from = Math.round(cy + ry * Math.sqrt(Math.max(0, 1 - (d * d) / (rx * rx))) * 0.7),
      len = int(g, 3, Math.max(4, s - from - 2));
    for (let k = 0; k < len; k++) if (g.R() < 0.9) g.put(top + 1 + d, from + k, M.LEAF);
  }
};

/** Olive: a short twisted trunk, a low irregular crown full of holes. */
const olive: Shape = (g, x, s) => {
  const h = int(g, 6, 9);
  let cx = x;
  for (let k = 1; k <= h; k++) {
    if (k > 1 && g.R() < 0.4) cx += g.R() < 0.5 ? -1 : 1;
    g.put(cx, s - k, M.WOOD);
    g.put(cx + 1, s - k, M.WOOD);
  }
  const blobs = 3 + int(g, 0, 2);
  for (let i = 0; i < blobs; i++)
    ellipse(g, cx + between(g, -6, 7), s - h - between(g, 1, 5), between(g, 4, 6), between(g, 2.5, 3.5), M.LEAF, 0.8);
};

/** Baobab: a fat bottle trunk with stubby branches and small tufts. */
const baobab: Shape = (g, x, s) => {
  const h = int(g, 12, 18),
    base = int(g, 6, 8);
  for (let k = 1; k <= h; k++) {
    const t = k / h,
      w = Math.round(base * (1 - 0.45 * t) + (t > 0.85 ? -1 : 0));
    for (let d = 0; d < w; d++) g.put(x - (w >> 1) + d, s - k, M.WOOD);
  }
  const arms = 4 + int(g, 0, 2);
  for (let i = 0; i < arms; i++) {
    const dir = (i / (arms - 1)) * 2 - 1,
      ex = x + dir * between(g, 4, 8),
      ey = s - h - between(g, 2, 6);
    line(g, x + dir * 2, s - h + 1, ex, ey, M.WOOD);
    ellipse(g, ex, ey - 1, between(g, 1.5, 3), 1.5, M.LEAF, 0.8);
  }
};

/** Palm: a curving ringed trunk under a rosette of drooping fronds. */
const palm =
  (lo: number, hi: number, frond: number): Shape =>
  (g, x, s) => {
    const h = int(g, lo, hi),
      lean = between(g, 2, 7) * (g.R() < 0.5 ? -1 : 1);
    for (let k = 1; k <= h; k++) g.put(x + Math.round(lean * (k / h) * (k / h)), s - k, M.WOOD);
    const tx = x + Math.round(lean),
      ty = s - h,
      n = 6 + int(g, 0, 2);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (i / (n - 1)) + between(g, -0.15, 0.15),
        L = between(g, frond * 0.75, frond * 1.2),
        droop = between(g, 0.6, 1.1);
      for (let t = 0; t <= 1; t += 0.5 / L) {
        const fx = tx + Math.cos(a) * L * t,
          fy = ty - Math.sin(a) * L * t * 0.8 + droop * L * t * t;
        g.put(Math.round(fx), Math.round(fy), M.LEAF);
        if (t > 0.3 && g.R() < 0.6) g.put(Math.round(fx), Math.round(fy) + 1, M.LEAF);
      }
    }
  };

/** Wild banana: a short pale stem with a few huge drooping leaves. */
const banana: Shape = (g, x, s) => {
  const h = int(g, 4, 8);
  trunk(g, x, s, h, 2);
  const n = 4 + int(g, 0, 2);
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1,
      L = between(g, 6, 10),
      rise = between(g, 0.3, 1.1);
    for (let t = 0; t <= 1; t += 0.6 / L) {
      const fx = x + 0.5 + dir * L * t,
        fy = s - h - i - rise * L * t + 1.4 * L * t * t;
      g.put(Math.round(fx), Math.round(fy), M.LEAF);
      g.put(Math.round(fx), Math.round(fy) - 1, M.LEAF);
      if (t > 0.2 && t < 0.8) g.put(Math.round(fx), Math.round(fy) + 1, M.LEAF);
    }
  }
};

/** Tree fern: a slender dark trunk with a dense crown of arching fronds. */
const treefern: Shape = (g, x, s) => {
  const h = int(g, 10, 18);
  trunk(g, x, s, h);
  const n = 8 + int(g, 0, 3);
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i / (n - 1)) + between(g, -0.1, 0.1),
      L = between(g, 6, 10);
    for (let t = 0; t <= 1; t += 0.6 / L) {
      const fx = x + Math.cos(a) * L * t,
        fy = s - h - Math.sin(a) * L * t * 0.7 + 0.9 * L * t * t;
      g.put(Math.round(fx), Math.round(fy), M.LEAF);
      if (g.R() < 0.7) g.put(Math.round(fx), Math.round(fy) + 1, M.LEAF);
    }
  }
};

/** Bamboo: a clump of tall jointed culms with sprays of leaves. */
const bamboo: Shape = (g, x, s) => {
  const n = 3 + int(g, 0, 4);
  for (let i = 0; i < n; i++) {
    const cx = x + int(g, -3, 3),
      h = int(g, 16, 32),
      lean = between(g, -4, 4);
    for (let k = 1; k <= h; k++) {
      const px = cx + Math.round(lean * (k / h) * (k / h));
      g.put(px, s - k, k % 6 === 0 ? M.LEAF : M.WOOD);
      if (k > h * 0.35 && k % 5 === 0) {
        const dir = g.R() < 0.5 ? -1 : 1,
          len = int(g, 2, 4);
        line(g, px + dir, s - k, px + dir * len, s - k + 1, M.LEAF);
      }
    }
  }
};

/** Mangrove: a round crown on a short trunk raised over arching stilt roots. */
const mangrove: Shape = (g, x, s) => {
  const lift = int(g, 3, 5),
    h = int(g, 6, 10),
    rx = between(g, 5, 8);
  for (let k = lift; k <= h; k++) g.put(x, s - k, M.WOOD);
  const roots = 4 + int(g, 0, 2);
  for (let i = 0; i < roots; i++) {
    const dir = i % 2 ? 1 : -1,
      out = int(g, 2, 6);
    line(g, x, s - lift, x + dir * Math.ceil(out / 2), s - lift - 1, M.WOOD);
    line(g, x + dir * Math.ceil(out / 2), s - lift - 1, x + dir * out, s, M.WOOD);
  }
  ellipse(g, x, s - h - between(g, 2, 4), rx, between(g, 3, 4.5));
};

/** Emergent giant (kapok): far above the canopy, buttressed, with a flat layered crown. */
const emergent: Shape = (g, x, s) => {
  const h = int(g, 40, 66),
    w = 3;
  trunk(g, x, s, h, w);
  for (let i = 1; i <= 4; i++) {
    g.put(x - Math.ceil(i / 2), s - 5 + i, M.WOOD);
    g.put(x + w - 1 + Math.ceil(i / 2), s - 5 + i, M.WOOD);
  }
  const layers = 2 + int(g, 0, 1);
  for (let i = 0; i < layers; i++) {
    const y = s - h + i * 5,
      rx = between(g, 10, 15) * (1 - 0.2 * i),
      dir = i % 2 ? 1 : -1;
    if (i) line(g, x + 1, y + 3, x + 1 + dir * rx * 0.6, y, M.WOOD);
    ellipse(g, x + 1 + (i ? dir * rx * 0.4 : 0), y - 2, rx, between(g, 2.5, 3.5), M.LEAF, 1, 1);
  }
};

/** Redwood: a great red trunk carrying a narrow cone high up. */
const redwood: Shape = (g, x, s, snowy) => {
  const h = int(g, 44, 68),
    w = 3;
  trunk(g, x, s, h - 2, w);
  const crown = Math.round(h * between(g, 0.5, 0.6));
  for (let k = 0; k < crown; k++) {
    const y = s - h + k,
      half = Math.round(1 + (k / crown) * 5) - (k % 4 === 0 ? 1 : 0);
    for (let d = -half; d <= half + w - 1; d++)
      if (g.R() < 0.92)
        g.put(x + d, y, snowy && k % 4 === 0 && g.R() < 0.5 ? M.SNOW : M.LEAF);
  }
};

/** Strangler fig: a wide crown on a thick trunk, with aerial roots hanging to the ground. */
const fig: Shape = (g, x, s) => {
  const h = int(g, 9, 14),
    rx = between(g, 10, 14),
    ry = between(g, 4.5, 6.5),
    cy = s - h - ry * 0.5;
  trunk(g, x, s, h, 3);
  ellipse(g, x + 1, cy, rx, ry);
  ellipse(g, x + 1 + between(g, -5, 5), cy - ry * 0.6, rx * 0.6, ry * 0.6);
  const roots = 3 + int(g, 0, 3);
  for (let i = 0; i < roots; i++) {
    let rx2 = x + 1 + Math.round(between(g, -rx * 0.8, rx * 0.8));
    for (let y = Math.round(cy + ry * 0.6); y < s; y++) {
      if (g.R() < 0.15) rx2 += g.R() < 0.5 ? -1 : 1;
      g.put(rx2, y, M.WOOD);
    }
  }
};

/** Joshua tree / dragon tree: a trunk branching into arms tipped with spiky tufts. */
const spiky: Shape = (g, x, s) => {
  const h = int(g, 4, 8);
  trunk(g, x, s, h, 1);
  const arms = 2 + int(g, 0, 2);
  for (let i = 0; i < arms; i++) {
    const dir = arms === 1 ? 0 : (i / (arms - 1)) * 2 - 1,
      ex = x + Math.round(dir * between(g, 3, 6)),
      ey = s - h - int(g, 3, 7);
    line(g, x, s - h, ex, ey, M.WOOD);
    for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 0], [1, 0], [0, -2], [-2, -2], [2, -2]])
      if (g.R() < 0.85) g.put(ex + dx, ey + dy, M.LEAF);
  }
};

/** Dead snag: a bare trunk with a few crooked branches. */
const snag: Shape = (g, x, s) => {
  const h = int(g, 8, 22);
  let cx = x;
  for (let k = 1; k <= h; k++) {
    if (k > 4 && g.R() < 0.15) cx += g.R() < 0.5 ? -1 : 1;
    g.put(cx, s - k, M.WOOD);
  }
  const n = 2 + int(g, 0, 2);
  for (let b = 0; b < n; b++) {
    const y0 = s - Math.floor(h * between(g, 0.45, 0.95)),
      dir = g.R() < 0.5 ? -1 : 1,
      len = int(g, 3, 8);
    line(g, cx, y0, cx + dir * len, y0 - Math.floor(len * between(g, 0.5, 1.5)), M.WOOD);
  }
};

// Shrubs and cacti.

const bush: Shape = (g, x, s) => ellipse(g, x, s - 1.5, between(g, 2, 4.5), between(g, 1.5, 2.7), M.LEAF, 0.95);

/** Heather: a low wide mound speckled with flowers. */
const heather: Shape = (g, x, s) => {
  const rx = between(g, 3, 6);
  ellipse(g, x, s - 1, rx, between(g, 1.2, 1.8), M.LEAF, 0.95, 0.5);
  for (let d = -Math.floor(rx); d <= rx; d++) if (g.R() < 0.35) g.put(x + d, s - 3, M.FLOWER);
};

/** Agave or yucca: a rosette of spikes, sometimes with a tall flower stalk. */
const rosette: Shape = (g, x, s) => {
  const n = 5 + int(g, 0, 2);
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.1 + 0.8 * (i / (n - 1))),
      L = between(g, 2, 5);
    line(g, x, s - 1, x + Math.cos(a) * L, s - 1 - Math.sin(a) * L, M.LEAF);
  }
  if (g.R() < 0.3) {
    const h = int(g, 6, 11);
    line(g, x, s - 2, x, s - h, M.WOOD);
    ellipse(g, x, s - h - 1, 1.5, 1.2, M.FLOWER);
  }
};

/** Ferns on the forest floor: a few low arching fronds. */
const fern: Shape = (g, x, s) => {
  const n = 3 + int(g, 0, 2);
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1,
      L = between(g, 3, 6);
    for (let t = 0; t <= 1; t += 0.3) g.put(Math.round(x + dir * L * t), Math.round(s - 1 - 2.5 * t + 2.2 * t * t), M.LEAF);
  }
};

/** Saguaro: a tall column with arms bending upward. */
const saguaro: Shape = (g, x, s) => {
  const h = int(g, 10, 22),
    w = h > 14 ? 2 : 1;
  for (let k = 1; k <= h; k++) for (let t = 0; t < w; t++) g.put(x + t, s - k, M.LEAF);
  const arms = h > 12 ? 1 + int(g, 0, 1) : 0;
  for (let a = 0; a < arms; a++) {
    const dir = a === 0 ? -1 : 1,
      y = s - 4 - int(g, 0, h - 9),
      out = int(g, 2, 3),
      ax = dir < 0 ? x - out : x + w - 1 + out;
    line(g, dir < 0 ? x - 1 : x + w, y, ax, y, M.LEAF);
    line(g, ax, y - 1, ax, y - int(g, 3, 7), M.LEAF);
  }
};

/** Prickly pear: oval pads stacked at angles. */
const pear: Shape = (g, x, s) => {
  let px = x,
    py = s - 2;
  const n = 3 + int(g, 0, 3);
  for (let i = 0; i < n; i++) {
    ellipse(g, px, py, 1.4, 2.1, M.LEAF);
    if (g.R() < 0.3) g.put(px, py - 3, M.FLOWER);
    px += g.R() < 0.5 ? -2 : 2;
    py -= int(g, 1, 3);
  }
};

/** Barrel cactus: a squat round body with a flower on top. */
const barrel: Shape = (g, x, s) => {
  ellipse(g, x, s - 2, between(g, 1.5, 2.5), between(g, 2, 3), M.LEAF);
  g.put(x, s - 5, M.FLOWER);
};

// ---- Species -------------------------------------------------------------------

const sp = (name: string, shape: Shape, slope: number, colours: Partial<Species> = {}): Species => ({
  name,
  shape,
  slope,
  ...colours,
});

/** Every species, by name. */
export const SPECIES: Species[] = [
  sp("spruce", cone(16, 34, 0.27, 0, 0.6), 6, { leaf: "#24402f", bark: "#4a3a2e" }),
  sp("fir", cone(18, 30, 0.3), 6, { leaf: "#2a4a3a", bark: "#4a3a30" }),
  sp("larch", cone(16, 28, 0.26, 0.35), 6, { leaf: "#a89a3a", bark: "#6a4a32" }),
  sp("juniper", cone(9, 15, 0.42, 0.12), 8, { leaf: "#3a5a40", bark: "#6a5040" }),
  sp("pine", pine, 6, { leaf: "#2f4a2c", bark: "#9a6040" }),
  sp("stone pine", umbrella(12, 18, 8, 12, 3.5), 5, { leaf: "#2f4a2a", bark: "#7a5038" }),
  sp("cypress", column(14, 26, 2), 7, { leaf: "#22382a", bark: "#5a4030" }),
  sp("poplar", column(18, 30, 3), 5, { leaf: "#6a8a3a", bark: "#8a8070" }),
  sp("oak", round(7, 11, 6, 9, 1.35, 1.1), 5),
  sp("beech", round(8, 12, 6, 8, 1.1, 1.25), 5, { bark: "#8a8478" }),
  sp("maple", round(6, 9, 5, 7, 1.2, 1), 5),
  sp("teak", round(10, 15, 4, 6, 1.2, 0.9), 5),
  sp("canopy tree", round(14, 22, 6, 9, 1.4, 0.8), 4),
  sp("cork oak", round(6, 9, 5, 7, 1.4, 1), 5, { leaf: "#3a5232", bark: "#8a5a3a" }),
  sp("birch", oval(12, 20, 3), 6, { leaf: "#8aa040", bark: "#e4e0d4" }),
  sp("aspen", oval(12, 22, 2), 6, { leaf: "#b8b048", bark: "#d4d2c4" }),
  sp("alder", oval(9, 16, 1), 6, { leaf: "#3f6a34", bark: "#5a4a40" }),
  sp("willow", willow, 4, { leaf: "#8aa850", bark: "#5a4a38" }),
  sp("olive", olive, 6, { leaf: "#8a9a78", bark: "#6a5a4a" }),
  sp("acacia", umbrella(8, 14, 8, 13, 2), 5, { leaf: "#6a7a3a", bark: "#5a4636" }),
  sp("baobab", baobab, 4, { leaf: "#6a8040", bark: "#9a8a7a" }),
  sp("palm", palm(14, 26, 8), 5, { leaf: "#6a9a3a", bark: "#8a7458" }),
  sp("fan palm", palm(8, 14, 6), 5, { leaf: "#5a8a3a", bark: "#7a6a54" }),
  sp("banana", banana, 5, { leaf: "#6aaa3a", bark: "#8aa058" }),
  sp("tree fern", treefern, 6, { leaf: "#4a8a3a", bark: "#3a2e26" }),
  sp("bamboo", bamboo, 6, { leaf: "#8aa83a", bark: "#a0a848" }),
  sp("mangrove", mangrove, 8, { leaf: "#2f5a2a", bark: "#5a4230" }),
  sp("kapok", emergent, 4, { leaf: "#3f6a2a", bark: "#a09a88" }),
  sp("redwood", redwood, 4, { leaf: "#2a4a30", bark: "#8a3f2a" }),
  sp("fig", fig, 5, { leaf: "#2f5a28", bark: "#7a6a5a" }),
  sp("joshua tree", spiky, 6, { leaf: "#7a8a4a", bark: "#6a5a44" }),
  sp("dragon tree", umbrella(8, 12, 6, 9, 2.5), 6, { leaf: "#4a6a3a", bark: "#a09484" }),
  sp("snag", snag, 8),
  // Shrubs and cacti
  sp("bush", bush, 99),
  sp("heather", heather, 99, { leaf: "#6a4a5a", bloom: "#c87ab0" }),
  sp("sage", bush, 99, { leaf: "#9aa090" }),
  sp("rosette", rosette, 99, { leaf: "#6a8a6a", bloom: "#f0d060" }),
  sp("fern", fern, 99, { leaf: "#4a7a34" }),
  sp("saguaro", saguaro, 8, { leaf: "#4a7a4a" }),
  sp("prickly pear", pear, 8, { leaf: "#5a8a4a", bloom: "#f0c040" }),
  sp("barrel", barrel, 8, { leaf: "#5a7a4a", bloom: "#e8604a" }),
];

const byName = new Map(SPECIES.map((s, i) => [s.name, i]));

/** Parses "spruce 3, birch 1" into species ids and weights. */
export function mixOf(list: string): { id: number; w: number }[] {
  if (!list.trim()) return [];
  return list.split(",").map((part) => {
    const m = part.trim().match(/^(.*?)\s+([\d.]+)$/),
      name = m ? m[1] : part.trim(),
      id = byName.get(name);
    if (id === undefined) throw new Error(`unknown species: ${name}`);
    return { id, w: m ? Number(m[2]) : 1 };
  });
}

/** Picks one species from a mix by r in [0, 1). */
export function pick(mix: { id: number; w: number }[], r: number) {
  let total = 0;
  for (const m of mix) total += m.w;
  r *= total;
  for (const m of mix) if ((r -= m.w) < 0) return m.id;
  return mix[mix.length - 1].id;
}
