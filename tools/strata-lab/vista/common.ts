// Vista's common pieces: the three grids the land is sampled into (a 2 m and a 16 m grid laid
// over the place being walked, a 100 m grid over the whole world), noise, the kinds of ground and
// of tree, and walking a route.
//
// Metres throughout: x east, z north, y up.

export interface GridSpec {
  x0: number;
  z0: number;
  cell: number;
  n: number;
}
export const FINE: GridSpec = { x0: 0, z0: 0, cell: 2, n: 2048 };
export const MID: GridSpec = { x0: -14000, z0: -12000, cell: 16, n: 2048 };
export const FAR: GridSpec = { x0: -40000, z0: -30000, cell: 96, n: 1024 };
export const GRIDS = [FINE, MID, FAR];
/** Lay the grids over a world `size` metres a side: the far grid over all of it, the mid and fine
 * grids centred on (x, z), kept inside the world. */
export function placeGrids(x: number, z: number, size: number) {
  FAR.x0 = 0;
  FAR.z0 = 0;
  FAR.cell = size / FAR.n;
  for (const g of [MID, FINE]) {
    const span = g.cell * g.n;
    g.x0 = Math.min(size - span, Math.max(0, x - span / 2));
    g.z0 = Math.min(size - span, Math.max(0, z - span / 2));
  }
}

// ---- Noise -------------------------------------------------------------------------
export function hash2(ix: number, iz: number, s: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x: number, z: number, s: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz,
    u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz),
    a = hash2(ix, iz, s),
    b = hash2(ix + 1, iz, s),
    c = hash2(ix, iz + 1, s),
    d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number, s: number, oct: number) {
  let t = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let i = 0; i < oct; i++) {
    t += a * vnoise(x * f, z * f, s + i * 17);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return t / n;
}
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The route walked at the place being visited (main.ts plans it). */
export const ROUTE: [number, number][] = [];

/** Distance from (x, z) to a polyline, and where along it (segment, fraction). */
export const near = { d: 0, i: 0, t: 0 };
export function nearest(pts: number[][], x: number, z: number) {
  let best = 1e18;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0],
      az = pts[i][1],
      vx = pts[i + 1][0] - ax,
      vz = pts[i + 1][1] - az,
      L2 = vx * vx + vz * vz;
    let t = ((x - ax) * vx + (z - az) * vz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + vx * t - x,
      pz = az + vz * t - z,
      d2 = px * px + pz * pz;
    if (d2 < best) {
      best = d2;
      near.i = i;
      near.t = t;
    }
  }
  near.d = Math.sqrt(best);
  return near.d;
}

// ---- What the ground is -------------------------------------------------------------------
export const KIND = {
  GRASS: 0,
  ALPINE: 1,
  FOREST: 2,
  CONIFER: 3,
  ROCK: 4,
  SCREE: 5,
  SNOW: 6,
  RIVER: 7,
  LAKE: 8,
  PATH: 9,
  SHORE: 10,
  SAND: 11,
} as const;
export const KIND_COUNT = 12;

/** Tree kinds, as sprite families (sprites.ts draws them; heights in metres). */
export const TREE_KINDS = [
  { name: "oak", h: [13, 21] },
  { name: "beech", h: [18, 28] },
  { name: "maple", h: [11, 17] },
  { name: "birch", h: [12, 19] },
  { name: "spruce", h: [17, 30] },
  { name: "fir", h: [15, 26] },
  { name: "pine", h: [13, 22] },
];

// ---- Walking the route ----------------------------------------------------------------------
export function cumulative(pts: [number, number][]) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}
export function along(pts: [number, number][], cum: number[], s: number) {
  const total = cum[cum.length - 1];
  if (s < 0) s = 0;
  if (s > total) s = total;
  // (Binary search: a day's walk has thousands of points.)
  let i = 0,
    hi = cum.length - 1;
  while (hi - i > 1) {
    const m = (i + hi) >> 1;
    if (cum[m] < s) i = m;
    else hi = m;
  }
  i = Math.min(i, Math.max(0, cum.length - 2));
  const L = cum[i + 1] - cum[i],
    t = L > 0 ? (s - cum[i]) / L : 0,
    a = pts[i],
    b = pts[i + 1];
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, i, hx: (b[0] - a[0]) / L, hz: (b[1] - a[1]) / L };
}
