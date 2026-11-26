// Vista's land: a generated world (engine/strata/world2d.ts) as heights, water, ground and trees at
// any point, in metres.
//
// The world is a map of 512 cells of 200 m; Vista draws down to 2 m. In between:
// - heights: the world's, interpolated smoothly, with relief added in proportion to how rugged the
//   world is there (crags in the mountains, swells on the plains), quieted near water so rivers and
//   shores stay level;
// - rivers: the world's drainage, traced where enough water gathers, smoothed into curves and cut
//   as channels with a flat floodplain, wider downstream;
// - lakes and the sea at the world's levels;
// - ground: the world's biome at each point (its borders wander), and from the biome's look, the
//   slope and the height, what kind of ground it is and how wooded; which trees grow there.
//
// Vista's axes: x east, z north (the world map's rows run south, so they are turned over).
import { BIOMES as BIOME_DEFS, ZONE } from "../../../engine/strata/biomes";
import { WATER, type World2D } from "../../../engine/strata/world2d";
import { KIND, TREE_KINDS, fbm, hash2, smooth, vnoise } from "./valley";

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
  /** River segments, 7 floats each: ax, az, bx, bz, level at a, level at b, half-width. */
  rivers: Float32Array;
  places: Place[];
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
  // Places to visit: the middle of each climate region, named for what grows there, on land.
  const places: Place[] = [];
  for (const r of w.plan.climate.regions) {
    let best = -1,
      bd = 1e18;
    for (let dy = -20; dy <= 20; dy += 2)
      for (let dx = -20; dx <= 20; dx += 2) {
        const x = Math.round(r.x + dx),
          y = Math.round(r.y + dy);
        if (x < 12 || y < 12 || x >= n - 12 || y >= n - 12) continue;
        const c = y * n + x;
        if (w.sea[c] || w.lake[c] > 0 || w.biome[c] === WATER) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) (bd = d), (best = c);
      }
    if (best < 0) continue;
    const name = BIOME_DEFS[w.biome[best]].name;
    if (places.some((p) => p.name === name)) continue;
    places.push({ name, x: X(best), z: Z(best) });
  }
  return { seed: w.seed, n, cell, h: w.h, wet, sea: w.sea, biome: w.biome, zone: w.zone, rough, rivers: Float32Array.from(segs), places };
}

// ---- Asking about a point -----------------------------------------------------------------------
let L: LandData | null = null;
const BUCKET = 400;
let bucketN = 0,
  bucketStart = new Int32Array(0),
  bucketList = new Int32Array(0);
/** Use this land (in each thread that asks). */
export function setLand(d: LandData) {
  L = d;
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
}
export const land = () => L!;
export const worldSize = () => (L ? L.n * L.cell : 0);

/** What the last ground() call learnt besides the height. */
export const G = { level: -1e9, river: 1e9, rw: 0, lake: false, sea: false, rough: 0 };

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
function cubic(A: Float32Array, n: number, u: number, v: number) {
  const iu = Math.floor(u),
    iv = Math.floor(v),
    fu = u - iu,
    fv = v - iv,
    at = (x: number, y: number) => A[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))],
    row = (y: number) => cr(at(iu - 1, y), at(iu, y), at(iu + 1, y), at(iu + 2, y), fu);
  return cr(row(iv - 1), row(iv), row(iv + 1), row(iv + 2), fv);
}
function lin(A: Float32Array, n: number, u: number, v: number) {
  const iu = Math.floor(u),
    iv = Math.floor(v),
    fu = u - iu,
    fv = v - iv,
    at = (x: number, y: number) => A[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
  return (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
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
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const c = Math.min(n - 1, Math.max(0, iv + b)) * n + Math.min(n - 1, Math.max(0, iu + a)),
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
    wx = x + 180 * (vnoise(x / 260, z / 260, 71) - 0.5),
    wz = z + 180 * (vnoise(x / 260, z / 260, 73) - 0.5),
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
export const zoneOfBiome = (b: number) => BIOME_DEFS[b].zone;

/** How wooded a biome is (trees per 2 m cell in its woods), and the woods' kind. */
export function woodsOf(b: number) {
  const L0 = BIOME_DEFS[b],
    dense = L0.pines + L0.broad + L0.giants;
  return { dense, conifer: L0.pines > L0.broad + L0.giants };
}
/** What kind of ground a point is, and how dense its woods (0..1). */
export function groundKind(x: number, z: number, h: number, slope: number, b: number): [number, number] {
  const look = BIOME_DEFS[b],
    zone = look.zone,
    nz5 = vnoise(x / 180, z / 180, 5);
  if (look.ground === "snow") return [slope > 1.0 ? KIND.ROCK : KIND.SNOW, 0];
  if (slope > 0.95) return [KIND.ROCK, 0];
  if (look.ground === "rock") return [slope > 0.5 ? KIND.ROCK : KIND.SCREE, 0];
  if (look.ground === "gravel" || look.ground === "ash") return [KIND.SCREE, 0];
  if (slope > 0.7) return [KIND.SCREE, 0];
  const { dense, conifer } = woodsOf(b);
  if (dense > 0.004) {
    const fm = fbm(x / 380, z / 380, 21, 4),
      thr = Math.min(0.7, 0.66 - 3.2 * dense);
    if (fm > thr) return [conifer ? KIND.CONIFER : KIND.FOREST, smooth(thr, thr + 0.1, fm)];
  }
  if (look.ground === "sand") return [KIND.SAND, 0];
  return [zone === ZONE.ALPINE || zone === ZONE.TUNDRA || (zone === ZONE.ICE && nz5 > 0.3) ? KIND.ALPINE : KIND.GRASS, 0];
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
