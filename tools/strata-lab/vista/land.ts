// Vista's land: a generated world (engine/strata/world2d.ts) as heights, water, ground and trees at
// any point, in metres.
//
// The world is a map of 512 cells of 200 m; Vista draws down to 2 m. In between:
// - heights: the world's, interpolated smoothly, with relief added in proportion to how rugged the
//   world is there (crags in the mountains, swells on the plains), quieted near water so rivers and
//   shores stay level; and rock standing out, as a game world has it: mesas and buttes in the dry
//   lands, crags and tors elsewhere, and in patches the land stepped into benches and cliffs where
//   its beds show;
// - rivers: the world's drainage, traced where enough water gathers, smoothed into curves and cut
//   as channels with a flat floodplain, wider downstream;
// - lakes and the sea at the world's levels;
// - ground: the world's biome at each point (its borders wander), and from the biome's look, the
//   slope and the height, what kind of ground it is and how wooded; which trees grow there.
//
// Vista's axes: x east, z north (the world map's rows run south, so they are turned over).
import { BIOMES as BIOME_DEFS, ZONE } from "../../../engine/strata/biomes";
import { WATER, type World2D } from "../../../engine/strata/world2d";
import { KIND, TREE_KINDS, fbm, hash2, smooth, vnoise } from "./common";

export interface Place {
  name: string;
  x: number;
  z: number;
}
export interface LandData {
  seed: number;
  n: number;
  cell: number;
  h: Float32Array;
  /** Water surface per world cell (lake or sea level), or -1e9. */
  wet: Float32Array;
  sea: Uint8Array;
  biome: Uint8Array;
  zone: Uint8Array;
  /** How rugged (0 plains .. 1 crags). */
  rough: Float32Array;
  /** The rock at the surface per world cell (world2d ROCKS: a bedrock, or SEDIMENT). */
  rock: Uint8Array;
  /** River segments, 7 floats each: ax, az, bx, bz, level at a, level at b, half-width. */
  rivers: Float32Array;
  places: Place[];
  /** What setLand works out from the rest (kept with the land once worked out, so the threads it
   * is sent to need not work it out again). */
  derived?: { terr: Float32Array; mesa: Float32Array; bucketN: number; bucketStart: Int32Array; bucketList: Int32Array };
}

const smoothChain = (pts: number[][]) => {
  let p = pts;
  for (let it = 0; it < 2; it++) {
    const q: number[][] = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const [ax, az, al, aw] = p[k],
        [bx, bz, bl, bw] = p[k + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz, 0.75 * al + 0.25 * bl, 0.75 * aw + 0.25 * bw]);
      q.push([0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz, 0.25 * al + 0.75 * bl, 0.25 * aw + 0.75 * bw]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
};

/** What Vista needs from a world (made once, in the main thread, then sent to the workers). */
export function landFromWorld(w: World2D): LandData {
  const n = w.n,
    cell = w.cell,
    N = n * n,
    wet = new Float32Array(N).fill(-1e9),
    rough = new Float32Array(N),
    X = (c: number) => ((c % n) + 0.5) * cell,
    Z = (c: number) => (n - Math.floor(c / n) - 0.5) * cell;
  for (let i = 0; i < N; i++) {
    if (w.sea[i]) wet[i] = 0;
    else if (w.lake[i] > 0) wet[i] = w.h[i] + w.lake[i];
    const x = i % n,
      y = (i / n) | 0;
    let lo = 1e9,
      hi = -1e9;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const v = w.h[Math.min(n - 1, Math.max(0, y + dy)) * n + Math.min(n - 1, Math.max(0, x + dx))];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    rough[i] = Math.min(1, Math.max(0, (hi - lo - 40) / 900));
  }
  // Rivers: chains down the drainage from where enough water gathers; smoothed; level a little
  // under the world's valley floor; wider as they grow.
  const F = 2.5e7,
    on = (c: number) => c >= 0 && w.flow[c] > F && !w.sea[c] && !(w.lake[c] > 0),
    seen = new Uint8Array(N),
    order = Array.from({ length: N }, (_, i) => i).filter(on).sort((a, b) => w.flow[a] - w.flow[b]),
    segs: number[] = [];
  for (const c0 of order) {
    if (seen[c0]) continue;
    const pts: number[][] = [];
    let c = c0;
    for (;;) {
      seen[c] = 1;
      pts.push([X(c), Z(c), w.h[c] - 1, Math.min(28, 2 + 2.2 * Math.sqrt(w.flow[c] / F))]);
      const r = w.rec[c];
      if (r < 0) break;
      if (!on(r) || seen[r]) {
        // Into a lake, the sea, or a river already traced: end there.
        pts.push([X(r), Z(r), Math.min(w.h[r] - 1, pts[pts.length - 1][2]), pts[pts.length - 1][3]]);
        break;
      }
      c = r;
    }
    if (pts.length < 2) continue;
    // Downhill all the way (a level never rises downstream).
    for (let k = 1; k < pts.length; k++) pts[k][2] = Math.min(pts[k][2], pts[k - 1][2]);
    const sm = smoothChain(pts);
    for (let k = 0; k < sm.length - 1; k++) segs.push(sm[k][0], sm[k][1], sm[k + 1][0], sm[k + 1][1], sm[k][2], sm[k + 1][2], (sm[k][3] + sm[k + 1][3]) / 2);
  }
  // Places to visit: where the most lies within a walk: several biomes, a rise and fall of the land,
  // some water, rock. Spots a km or so apart are scored; the best are taken, well apart, those of a
  // climate not yet visited first; each named for what grows most there.
  // (Distances in cells of a 512 map, ~200 m, scaled to this one's.)
  const sc = n / 512,
    cands: { c: number; score: number; zone: number; names: number[] }[] = [],
    RAD = Math.max(3, Math.round(10 * sc)),
    ds = RAD >= 6 ? 2 : 1,
    edge = Math.max(RAD + 1, Math.round(14 * sc)),
    stepC = Math.max(1, Math.round(6 * sc));
  for (let y = edge; y < n - edge; y += stepC)
    for (let x = edge; x < n - edge; x += stepC) {
      const c0 = y * n + x;
      if (w.sea[c0] || w.lake[c0] > 0 || w.biome[c0] === WATER) continue;
      const count = new Map<number, number>();
      let dry = 0,
        wetN = 0,
        lo = 1e9,
        hi = -1e9,
        rg = 0;
      for (let dy = -RAD; dy <= RAD; dy += ds)
        for (let dx = -RAD; dx <= RAD; dx += ds) {
          if (dx * dx + dy * dy > RAD * RAD) continue;
          const c = (y + dy) * n + x + dx;
          if (w.sea[c] || w.lake[c] > 0 || w.biome[c] === WATER) {
            wetN++;
            continue;
          }
          dry++;
          count.set(w.biome[c], (count.get(w.biome[c]) ?? 0) + 1);
          lo = Math.min(lo, w.h[c]);
          hi = Math.max(hi, w.h[c]);
          rg += rough[c];
        }
      if (dry < (dry + wetN) * 0.65) continue;
      const ranked = [...count].sort((p, q) => q[1] - p[1]),
        many = ranked.filter(([, k]) => k >= dry * 0.06).length,
        wf = wetN / (dry + wetN),
        score = many + Math.min(3, (hi - lo) / 300) + (wf > 0.02 ? 1.2 : 0) + (2 * rg) / dry;
      cands.push({ c: c0, score, zone: BIOME_DEFS[ranked[0][0]].zone, names: ranked.slice(0, 2).map(([b]) => b) });
    }
  cands.sort((p, q) => q.score - p.score);
  const places: Place[] = [],
    zones = new Set<number>(),
    groups = new Set<number>(),
    // Cold, temperate, dry, hot and wet: one of each first if there is one.
    groupOf = (z: number) =>
      z === ZONE.ICE || z === ZONE.TUNDRA || z === ZONE.ALPINE || z === ZONE.BOREAL ? 0
      : z === ZONE.STEPPE || z === ZONE.DESERT || z === ZONE.SALT_FLAT || z === ZONE.SAVANNA ? 2
      : z === ZONE.MONSOON || z === ZONE.RAINFOREST ? 3 : 1,
    taken: number[] = [];
  for (let k = 0; k < 8; k++) {
    let best: (typeof cands)[number] | null = null,
      bs = -1e9;
    for (const cd of cands) {
      const cx = cd.c % n,
        cy = Math.floor(cd.c / n);
      if (taken.some((t) => Math.hypot((t % n) - cx, Math.floor(t / n) - cy) < 60 * sc)) continue;
      const v = cd.score + (zones.has(cd.zone) ? 0 : 1.5) + (groups.has(groupOf(cd.zone)) ? 0 : 4);
      if (v > bs) (bs = v), (best = cd);
    }
    if (!best) break;
    taken.push(best.c);
    zones.add(best.zone);
    groups.add(groupOf(best.zone));
    const [b0, b1] = best.names;
    let name = BIOME_DEFS[b0].name;
    if (places.some((p) => p.name === name) && b1 !== undefined) name = `${name} and ${BIOME_DEFS[b1].name.toLowerCase()}`;
    if (places.some((p) => p.name === name)) name = `${name} (${k + 1})`;
    places.push({ name, x: X(best.c), z: Z(best.c) });
  }
  return { seed: w.seed, n, cell, h: w.h, wet, sea: w.sea, biome: w.biome, zone: w.zone, rough, rock: w.rock, rivers: Float32Array.from(segs), places };
}

// ---- Asking about a point -----------------------------------------------------------------------
let L: LandData | null = null;
/** Per world cell, smoothed: how much the land breaks into benches and cliffs, and into mesas. */
let TERR: Float32Array = new Float32Array(0),
  MESA: Float32Array = new Float32Array(0);
const BUCKET = 400;
let bucketN = 0,
  bucketStart: Int32Array = new Int32Array(0),
  bucketList: Int32Array = new Int32Array(0);
/** Use this land (in each thread that asks). */
export function setLand(d: LandData) {
  L = d;
  if (d.derived) {
    ({ terr: TERR, mesa: MESA, bucketN, bucketStart, bucketList } = d.derived);
    return;
  }
  const n = d.n,
    blur = (A: Float32Array) => {
      for (let pass = 0; pass < 2; pass++)
        for (const [sx, sy] of [[1, 0], [0, 1]]) {
          const B = A.slice();
          for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++) {
              let t = 0;
              for (let k = -2; k <= 2; k++) t += B[Math.min(n - 1, Math.max(0, y + k * sy)) * n + Math.min(n - 1, Math.max(0, x + k * sx))];
              A[y * n + x] = t / 5;
            }
        }
      return A;
    };
  TERR = new Float32Array(n * n);
  MESA = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const z = d.zone[i],
      dry = z === ZONE.DESERT || z === ZONE.STEPPE || z === ZONE.SAVANNA || z === ZONE.MEDITERRANEAN || z === ZONE.SALT_FLAT,
      cold = z === ZONE.ALPINE || z === ZONE.ICE || z === ZONE.TUNDRA;
    TERR[i] = dry ? 1 : cold ? 0.75 : Math.min(1, 0.2 + 0.8 * d.rough[i]);
    MESA[i] = dry ? 1 : cold ? 0.5 : 0.3;
  }
  blur(TERR);
  blur(MESA);
  const size = d.n * d.cell;
  bucketN = Math.ceil(size / BUCKET) + 1;
  const lists: number[][] = Array.from({ length: bucketN * bucketN }, () => []),
    S = d.rivers;
  for (let k = 0; k < S.length / 7; k++) {
    const m = S[k * 7 + 6] * 4 + 60,
      x0 = Math.max(0, Math.floor((Math.min(S[k * 7], S[k * 7 + 2]) - m) / BUCKET)),
      x1 = Math.min(bucketN - 1, Math.floor((Math.max(S[k * 7], S[k * 7 + 2]) + m) / BUCKET)),
      z0 = Math.max(0, Math.floor((Math.min(S[k * 7 + 1], S[k * 7 + 3]) - m) / BUCKET)),
      z1 = Math.min(bucketN - 1, Math.floor((Math.max(S[k * 7 + 1], S[k * 7 + 3]) + m) / BUCKET));
    for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) lists[bz * bucketN + bx].push(k);
  }
  bucketStart = new Int32Array(lists.length + 1);
  for (let b = 0; b < lists.length; b++) bucketStart[b + 1] = bucketStart[b] + lists[b].length;
  bucketList = Int32Array.from(lists.flat());
  d.derived = { terr: TERR, mesa: MESA, bucketN, bucketStart, bucketList };
}
export const land = () => L!;
export const worldSize = () => (L ? L.n * L.cell : 0);

/** What the last ground() call learnt besides the height. */
export const G = { level: -1e9, river: 1e9, rw: 0, lake: false, sea: false, rough: 0 };

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
/** A cell index clamped into 0..n-1. */
const clampI = (i: number, n: number) => Math.min(n - 1, Math.max(0, i));
function cubic(A: Float32Array, n: number, u: number, v: number) {
  const iu = Math.floor(u),
    iv = Math.floor(v),
    fu = u - iu,
    fv = v - iv,
    x0 = clampI(iu - 1, n),
    x1 = clampI(iu, n),
    x2 = clampI(iu + 1, n),
    x3 = clampI(iu + 2, n),
    y0 = clampI(iv - 1, n) * n,
    y1 = clampI(iv, n) * n,
    y2 = clampI(iv + 1, n) * n,
    y3 = clampI(iv + 2, n) * n;
  return cr(
    cr(A[y0 + x0], A[y0 + x1], A[y0 + x2], A[y0 + x3], fu),
    cr(A[y1 + x0], A[y1 + x1], A[y1 + x2], A[y1 + x3], fu),
    cr(A[y2 + x0], A[y2 + x1], A[y2 + x2], A[y2 + x3], fu),
    cr(A[y3 + x0], A[y3 + x1], A[y3 + x2], A[y3 + x3], fu),
    fv,
  );
}
function lin(A: Float32Array, n: number, u: number, v: number) {
  const iu = Math.floor(u),
    iv = Math.floor(v),
    fu = u - iu,
    fv = v - iv,
    x0 = clampI(iu, n),
    x1 = clampI(iu + 1, n),
    y0 = clampI(iv, n) * n,
    y1 = clampI(iv + 1, n) * n;
  return (A[y0 + x0] * (1 - fu) + A[y0 + x1] * fu) * (1 - fv) + (A[y1 + x0] * (1 - fu) + A[y1 + x1] * fu) * fv;
}

/** The ground's height at (x, z); the water there (G.level) and the nearest river (G.river, G.rw). */
export function ground(x: number, z: number) {
  const d = L!,
    n = d.n,
    u = x / d.cell - 0.5,
    v = n - z / d.cell - 0.5;
  const base = cubic(d.h, n, u, v),
    rough = lin(d.rough, n, u, v);
  // Water close by: lakes and the sea, from the four cells round the point.
  const iu = Math.floor(u),
    iv = Math.floor(v);
  let lake = -1e9,
    sea = false,
    near = 0;
  for (let k = 0; k < 4; k++) {
    // (The corners (0, 0), (1, 0), (0, 1), (1, 1).)
    const c = clampI(iv + (k >> 1), n) * n + clampI(iu + (k & 1), n),
      wl = d.wet[c];
    if (wl > -1e8) {
      near++;
      if (d.sea[c]) sea = true;
      else lake = Math.max(lake, wl);
    }
  }
  // The nearest river.
  let dr = 1e9,
    lv = 0,
    rw = 0;
  const bx = Math.min(bucketN - 1, Math.max(0, Math.floor(x / BUCKET))),
    bz = Math.min(bucketN - 1, Math.max(0, Math.floor(z / BUCKET))),
    b = bz * bucketN + bx,
    S = d.rivers;
  for (let q = bucketStart[b]; q < bucketStart[b + 1]; q++) {
    const k = bucketList[q] * 7,
      ax = S[k],
      az = S[k + 1],
      vx = S[k + 2] - ax,
      vz = S[k + 3] - az,
      l2 = vx * vx + vz * vz || 1;
    let t = ((x - ax) * vx + (z - az) * vz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + vx * t - x,
      pz = az + vz * t - z,
      dd = Math.sqrt(px * px + pz * pz) - S[k + 6];
    if (dd < dr - rw) {
      dr = dd + S[k + 6];
      lv = S[k + 4] + (S[k + 5] - S[k + 4]) * t;
      rw = S[k + 6];
    }
  }
  // Relief the world is too coarse to hold: more where it is rugged, quiet by water.
  const fp = rw * 3 + 45,
    quiet = (dr < fp ? smooth(rw, fp, dr) : 1) * (1 - 0.22 * near),
    detail =
      (14 + 150 * rough) * (fbm(x / 1100, z / 1100, 61, 3) - 0.5) +
      (3 + 42 * rough) * (Math.abs(fbm(x / 260, z / 260, 63, 3) - 0.5) * -2 + 0.5) +
      (0.8 + 8 * rough) * (fbm(x / 60, z / 60, 65, 3) - 0.5) +
      0.9 * (fbm(x / 14, z / 14, 67, 2) - 0.5);
  let h = base + detail * quiet;
  // Rock standing out: blocks with steep sides (mesas and buttes, or crags and tors), and in
  // patches the land stepped into benches, with cliffs between where the beds show.
  const mw = lin(MESA, n, u, v) * quiet,
    // Benches only on rugged ground (on gentle slopes they would be long, even stripes).
    tw = lin(TERR, n, u, v) * quiet * smooth(0.1, 0.4, rough);
  if (mw > 0.01) {
    const m = fbm(x / 1300, z / 1300, 91, 3),
      thr = 0.64 - 0.05 * mw;
    if (m > thr) h += mw * smooth(thr, thr + 0.02, m) * (30 + 50 * vnoise(x / 2700, z / 2700, 93));
  }
  if (tw > 0.01) {
    const patch = smooth(0.5, 0.62, fbm(x / 3200, z / 3200, 99, 2));
    if (patch > 0) {
      // Each bench its own: along it the step sharpens into a cliff and eases off into a slope.
      const S = 14 + 24 * vnoise(x / 2300, z / 2300, 95),
        off = 0.5 * vnoise(x / 650, z / 650, 97),
        t = h / S + off,
        i = Math.floor(t),
        f = t - i,
        e = Math.min(0.94, 0.3 + 0.75 * vnoise(x / 380 + i * 3.7, z / 380 - i * 1.3, 101));
      h += (S * (i + smooth(e, 1, f) - off) - h) * tw * patch;
    }
  }
  // The river: a flat floodplain, then the channel.
  if (dr < fp) h = Math.min(h, lv + 1.2 + Math.max(0, dr - rw) * 0.05 + (h - lv) * smooth(rw * 2, fp, dr));
  if (dr < rw) h = Math.min(h, lv - 0.3 - 1.8 * (1 - (dr / rw) ** 2));
  let level = -1e9;
  if (lake > -1e8 && h < lake) level = lake;
  if (sea && h < 0) level = Math.max(level, 0);
  if (dr < rw && h < lv) level = Math.max(level, lv);
  G.level = level;
  G.river = dr;
  G.rw = rw;
  G.lake = level > -1e8 && level === lake;
  G.sea = level === 0 && sea;
  G.rough = rough;
  return h;
}

/** The biome at a point (its borders wander a little), never water. */
export function biomeAt(x: number, z: number) {
  const d = L!,
    n = d.n,
    wx = x + 280 * (vnoise(x / 430, z / 430, 71) - 0.5) + 90 * (vnoise(x / 110, z / 110, 75) - 0.5),
    wz = z + 280 * (vnoise(x / 430, z / 430, 73) - 0.5) + 90 * (vnoise(x / 110, z / 110, 77) - 0.5),
    u = Math.round(wx / d.cell - 0.5),
    v = Math.round(n - wz / d.cell - 0.5);
  for (let r = 0; r < 4; r++)
    for (let dv = -r; dv <= r; dv++)
      for (let du = -r; du <= r; du++) {
        if (Math.max(Math.abs(du), Math.abs(dv)) !== r) continue;
        const c = Math.min(n - 1, Math.max(0, v + dv)) * n + Math.min(n - 1, Math.max(0, u + du));
        if (d.biome[c] !== WATER) return d.biome[c];
      }
  return 0;
}

/** The rock at the surface near a point (world2d ROCKS): its cell's, the boundaries between cells
 * wandering as the biomes' do, and frayed (`jitter`, 0..1, moves the point up to 150 m). */
export function rockAt(x: number, z: number, jitter = 0) {
  const d = L!,
    n = d.n,
    wx = x + 280 * (vnoise(x / 430, z / 430, 81) - 0.5) + 300 * (jitter - 0.5),
    wz = z + 280 * (vnoise(x / 430, z / 430, 83) - 0.5) + 300 * (((jitter * 7.31) % 1) - 0.5),
    u = Math.min(n - 1, Math.max(0, Math.round(wx / d.cell - 0.5))),
    v = Math.min(n - 1, Math.max(0, Math.round(n - wz / d.cell - 0.5)));
  return d.rock[v * n + u];
}

/** How wooded a biome is (trees per 2 m cell in its woods), and the woods' kind. */
export function woodsOf(b: number) {
  return WOODS[b];
}
const WOODS: readonly { readonly dense: number; readonly conifer: boolean }[] = BIOME_DEFS.map((L0) => ({
  dense: L0.pines + L0.broad + L0.giants,
  conifer: L0.pines > L0.broad + L0.giants,
}));
/** What kind of ground a point is, and how dense its woods (0..1). */
export function groundKind(x: number, z: number, h: number, slope: number, b: number): [number, number] {
  const k = kindOf(x, z, h, slope, b);
  return [k, GK.forest];
}
/** What the last kindOf() call learnt besides the kind: how dense the woods are (0..1). */
export const GK = { forest: 0 };
/** What kind of ground a point is (and in GK, how dense its woods): groundKind without the array. */
export function kindOf(x: number, z: number, h: number, slope: number, b: number): number {
  const look = BIOME_DEFS[b],
    zone = look.zone,
    nz5 = vnoise(x / 180, z / 180, 5);
  GK.forest = 0;
  if (look.ground === "snow") return slope > 0.6 ? KIND.ROCK : slope > 0.35 && nz5 > 0.55 ? KIND.SCREE : KIND.SNOW;
  if (slope > 0.95) return KIND.ROCK;
  if (look.ground === "rock") return slope > 0.5 ? KIND.ROCK : KIND.SCREE;
  if (look.ground === "gravel" || look.ground === "ash") return KIND.SCREE;
  if (slope > 0.7) return KIND.SCREE;
  const { dense, conifer } = woodsOf(b);
  if (dense > 0.004) {
    const fm = fbm(x / 380, z / 380, 21, 4),
      thr = Math.min(0.7, 0.66 - 3.2 * dense);
    if (fm > thr) {
      GK.forest = smooth(thr, thr + 0.1, fm);
      return conifer ? KIND.CONIFER : KIND.FOREST;
    }
  }
  if (look.ground === "sand") return KIND.SAND;
  return zone === ZONE.ALPINE || zone === ZONE.TUNDRA || (zone === ZONE.ICE && nz5 > 0.3) ? KIND.ALPINE : KIND.GRASS;
}

// Trees: the strip's species, drawn as Vista's seven kinds.
const SPECIES: Record<string, number> = {
  oak: 0, "cork oak": 0, olive: 0, fig: 0, baobab: 0, beech: 1, kapok: 1, "canopy tree": 1, teak: 1, maple: 2, willow: 2, alder: 2,
  banana: 2, "tree fern": 2, mangrove: 2, birch: 3, aspen: 3, poplar: 3, spruce: 4, snag: 4, fir: 5, juniper: 5, cypress: 5, redwood: 5,
  pine: 6, "stone pine": 6, larch: 6, acacia: 6, "dragon tree": 6, "joshua tree": 6, palm: 6, "fan palm": 6, bamboo: 6,
};
const treeMix = new Map<number, [number, number][]>();
/** The tree kinds a biome grows, with weights. */
export function treesOf(b: number): [number, number][] {
  let m = treeMix.get(b);
  if (m) return m;
  const look = BIOME_DEFS[b],
    w = new Map<number, number>();
  for (const part of look.trees.split(",")) {
    const t = part.trim().match(/^(.*?)\s+([\d.]+)$/);
    if (!t) continue;
    const k = SPECIES[t[1]];
    if (k !== undefined) w.set(k, (w.get(k) ?? 0) + Number(t[2]));
  }
  if (!w.size) w.set(look.pines > look.broad ? 4 : 0, 1);
  m = [...w];
  treeMix.set(b, m);
  return m;
}
export function pickTree(b: number, r: number) {
  const m = treesOf(b),
    total = m.reduce((a, [, v]) => a + v, 0);
  let x = r * total;
  for (const [k, v] of m) if ((x -= v) < 0) return k;
  return m[m.length - 1][0];
}
void TREE_KINDS;
void hash2;
