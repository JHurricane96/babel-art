// Vista: the test valley, as data. A hand-shaped place (no world simulation
// yet) for proving the renderer and the art: a river running south out of
// mountains, a hill town on its east bank, a road climbing by switchbacks to
// a pass, a lake basin beyond, and a high range on the horizon.
//
// Metres throughout: x east, z north, y up. The land is sampled into three
// grids: fine (2 m) over the valley, mid (16 m) over 33 km around it, far
// (96 m) out to the horizon ranges.

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
export function ridged(x: number, z: number, s: number, oct: number) {
  let t = 0,
    a = 0.5,
    f = 1,
    n = 0;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(2 * vnoise(x * f, z * f, s + i * 31) - 1);
    v *= v;
    t += a * v;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return t / n;
}
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss2 = (dx: number, dz: number, rx: number, rz: number) =>
  Math.exp(-(dx * dx) / (2 * rx * rx) - (dz * dz) / (2 * rz * rz));
export function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- The valley's features ---------------------------------------------------------------
/** The river: points (x, z) and its water level there. */
export const RIVER: [number, number, number][] = [
  [1500, -6000, 40], [1500, -200, 95], [1450, 300, 100], [1500, 700, 108], [1420, 1100, 118], [1460, 1500, 128],
  [1380, 1900, 146], [1300, 2400, 182], [1200, 2900, 262], [1080, 3400, 420], [950, 3900, 610], [780, 4700, 820],
  [600, 6000, 1100],
];
export const LAKE = { x: 2450, z: 4420, level: 380 };
/** The party's route for the day. */
export const ROUTE: [number, number][] = [
  [430, 330], [700, 310], [1000, 300], [1300, 300], // riverside meadows, walking east
  [1330, 700], [1280, 1100], [1360, 1480], // up the valley, north
  [1405, 1488], [1515, 1495], // the bridge
  [1600, 1520], [1720, 1560], [1660, 1630], [1800, 1680], [1740, 1750], [1900, 1790], // the town's streets
  [2050, 1850], [2250, 2150], [2380, 2550], // the ridge road
  [2700, 2720], [2420, 2880], [2760, 3030], [2480, 3160], [2650, 3300], // switchbacks to the pass
  [2700, 3500], [2620, 3800], [2520, 4000], // down to the lake
];
/** The route's segment that is the bridge (ROUTE[BRIDGE] to ROUTE[BRIDGE + 1]). */
export const BRIDGE = 7;
/** The valley road the carts use. */
export const ROAD2: [number, number][] = [[1600, -250], [1640, 300], [1600, 800], [1620, 1200], [1560, 1460]];
export const TOWN = ROUTE.slice(9, 16);
export const TOWER = { x: 1885, z: 1832 };

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

/** What the last terrain() call learnt besides the height: river distance and level, lake distance, mountain-ness. */
export const T = { dr: 0, lv: 0, dl: 0, mz: 0 };

/** The ground's height at (x, z). */
export function terrain(x: number, z: number) {
  let h = 118 + 80 * (fbm(x / 650, z / 650, 1, 5) - 0.5);
  // Small relief: hummocks and swales a few metres across.
  h += 3.2 * (fbm(x / 55, z / 55, 31, 3) - 0.5);
  h += 60 * gauss2(x - 420, z - 360, 260, 200); // the low hill where the day starts
  h += 95 * gauss2(x - 1930, z - 1790, 250, 210); // the town's knoll
  const mz = smooth(2000, 3300, z);
  if (mz > 0) {
    let mt = mz * (380 + 720 * ridged(x / 900, z / 900, 7, 5));
    mt += mz * 34 * (ridged(x / 170, z / 170, 41, 3) - 0.5); // crags
    mt *= 1 - 0.5 * gauss2(x - 2650, z - 3300, 340, 260); // the pass
    mt *= 1 - 0.82 * gauss2(x - LAKE.x, z - LAKE.z, 850, 650); // the lake's basin
    h += mt;
  }
  const fz = smooth(5200, 9500, z);
  if (fz > 0) h += fz * (900 + 1600 * ridged(x / 2300, z / 2300, 9, 5));
  // Terraces in the mountains: flat benches and steep risers, where the rock's beds show.
  // (Only in some massifs; the steps vary in height and wander, so benches don't follow contours.)
  const terr = smooth(0.6, 0.76, vnoise(x / 900, z / 900, 51)) * Math.max(mz, fz) * 0.75;
  if (terr > 0) {
    const S = 34 + 40 * vnoise(x / 1500, z / 1500, 53),
      q = (h + 26 * (vnoise(x / 210, z / 210, 52) - 0.5)) / S,
      f = q - Math.floor(q),
      stepped = (Math.floor(q) + f ** 3) * S - 26 * (vnoise(x / 210, z / 210, 52) - 0.5);
    h += (stepped - h) * terr * 0.65;
  }
  // The river's valley: a channel, a flat floodplain, then the valley sides.
  nearest(RIVER, x, z);
  const lv = RIVER[near.i][2] + (RIVER[near.i + 1][2] - RIVER[near.i][2]) * near.t,
    dr = near.d,
    hv = dr < 18 ? lv - 4 + 2 * smooth(10, 18, dr) : dr < 165 ? lv + 2 + (dr - 18) * 0.028 : lv + 6.1 + (dr - 165) * 0.42;
  if (hv < h) h = hv;
  const dl = Math.hypot(x - LAKE.x, (z - LAKE.z) * 1.25),
    hl = LAKE.level - 14 + Math.max(0, dl - 420) * 0.55;
  if (hl < h) h = hl;
  T.dr = dr;
  T.lv = lv;
  T.dl = dl;
  T.mz = Math.max(mz, fz);
  return h;
}
/** The water surface at the last terrain() call's point, or -1e9 where there is none. */
export const waterLevel = () => Math.max(T.dr < 26 ? T.lv : -1e9, T.dl < 900 ? LAKE.level : -1e9);

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
  WHEAT: 10,
  GREEN: 11,
  FALLOW: 12,
  HEDGE: 13,
  YARD: 14,
  SHORE: 15,
} as const;
export const KIND_COUNT = 16;

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

/** A house, the tower, or a piece of the bridge. Walls and roofs name their materials. */
export interface Building {
  x: number;
  z: number;
  /** Ground under it (its lowest corner), and the wall's top above that. */
  y: number;
  /** Width along its facing, depth, and the angle it faces (radians, about y). */
  w: number;
  d: number;
  angle: number;
  wallH: number;
  roofH: number;
  wall: number;
  roof: number;
  /** 0 a house (gable roof), 1 the tower (pyramid roof). */
  type: number;
}
export const WALLS = ["plaster", "plaster ochre", "stone", "timber"];
export const ROOFS = ["red tile", "brown tile", "slate", "thatch"];

/** Lay out the town, a hamlet by the bridge and a few farms, on the ground given. */
export function layoutBuildings(groundAt: (x: number, z: number) => number, isWater: (x: number, z: number) => boolean) {
  const rnd = mulberry(7),
    out: Building[] = [];
  const ok = (x: number, z: number, gap: number, r = 8) => {
    if (nearest(ROUTE, x, z) < r || nearest(ROAD2, x, z) < r - 1) return false;
    if (isWater(x, z) || nearest(RIVER, x, z) < 30) return false;
    for (const o of out) if (Math.hypot(o.x - x, o.z - z) < gap) return false;
    return true;
  };
  const house = (x: number, z: number, angle: number, big = 1) => {
    const w = (7 + rnd() * 4) * big,
      d = 5.5 + rnd() * 2.5,
      c = Math.cos(angle),
      s = Math.sin(angle);
    let y = 1e9;
    for (const [u, v] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) y = Math.min(y, groundAt(x + u * c - v * s, z + u * s + v * c));
    out.push({
      x, z, y, w, d, angle, wallH: 4 + rnd() * 2.5, roofH: 2.8 + rnd() * 1.8,
      wall: Math.floor(rnd() * WALLS.length), roof: Math.floor(rnd() * ROOFS.length), type: 0,
    });
  };
  out.push({ x: TOWER.x, z: TOWER.z, y: groundAt(TOWER.x, TOWER.z) - 1, w: 6.5, d: 6.5, angle: 0.3, wallH: 22, roofH: 8, wall: 2, roof: 2, type: 1 });
  // Along the town's streets, facing them, in one or two rows.
  for (let i = 0; i < TOWN.length - 1; i++) {
    const [ax, az] = TOWN[i],
      [bx, bz] = TOWN[i + 1],
      L = Math.hypot(bx - ax, bz - az),
      ux = (bx - ax) / L,
      uz = (bz - az) / L,
      angle = Math.atan2(uz, ux);
    for (let s = 6; s < L; s += 13 + rnd() * 5)
      for (const side of [-1, 1])
        for (const row of [11, 23]) {
          if (row > 11 && rnd() < 0.5) continue;
          const off = row + rnd() * 3,
            x = ax + ux * s - uz * off * side,
            z = az + uz * s + ux * off * side;
          if (ok(x, z, 10)) house(x, z, angle);
        }
  }
  for (let k = 0; k < 30; k++) {
    const a = rnd() * 6.283,
      r = 18 + rnd() * 60,
      x = TOWER.x + Math.cos(a) * r,
      z = TOWER.z + Math.sin(a) * r;
    if (ok(x, z, 11)) house(x, z, rnd() * 3.14);
  }
  // A hamlet at the west end of the bridge, and farms out on the floodplain.
  for (let k = 0; k < 16; k++) {
    const x = 1290 + rnd() * 90,
      z = 1410 + rnd() * 100;
    if (ok(x, z, 12)) house(x, z, 0.1 + rnd() * 0.3);
  }
  for (const [x, z, a] of [[1150, 600, 0.2], [1680, 900, 1.4], [1700, 360, 0.1], [1190, 1290, 0.9], [900, 420, 0.05], [1720, 1180, 0.4]])
    if (ok(x, z, 10)) house(x, z, a, 1.3);
  return out;
}

/** The bridge: its deck height and the line it spans. */
export function bridgeOf(groundAt: (x: number, z: number) => number) {
  const [ax, az] = ROUTE[BRIDGE],
    [bx, bz] = ROUTE[BRIDGE + 1];
  return { ax, az, bx, bz, deck: Math.max(groundAt(ax, az), groundAt(bx, bz)) + 2.5 };
}

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
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < s) i++;
  const L = cum[i + 1] - cum[i],
    t = L > 0 ? (s - cum[i]) / L : 0,
    a = pts[i],
    b = pts[i + 1];
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, i, hx: (b[0] - a[0]) / L, hz: (b[1] - a[1]) / L };
}
