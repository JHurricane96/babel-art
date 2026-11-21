// Strata region generator: six biomes and the transitions between them.
//
// A region is REGION_W x WORLD_H cells generated from (seed, region index)
// alone, so any region can be rebuilt on demand and saves only need what the
// simulation later changes. Everything is decided in world coordinates: a
// region is cut from a wider window (MARGIN cells either side) so tunnels,
// pools, trees and mushrooms that straddle a region edge come out the same
// from both sides.
//
// The land is built in passes:
//   1. ground height, blending the two biomes' shapes across a band at the edge,
//      with each biome's own features: ridged peaks, dunes, ledges, and a basin
//      (a lake, a river, a canyon, a frozen lake or a lava caldera);
//   2. rock in horizontal strata of uneven thickness, with each stratum changing
//      biome at its own place inside the band, so layers interfinger;
//   3. caves from noise: wide caverns, sparse meandering tunnels, and a few
//      sinkhole shafts that open to the sky;
//   4. the basin's water or lava, then pools and deep lava that fill only true
//      hollows, a row at a time from the bottom up; in frozen biomes, ice;
//   5. plants on the surface (pines, broad and giant trees, giant mushrooms,
//      cacti, dead trees, shrubs); in the caves moss, fungi, glowing vines,
//      roots, stalactites or icicles, crystals and fossils.
import {
  GLOW,
  M,
  REGION_W,
  WORLD_H,
  fbm1,
  fbm2,
  hash3,
  lerp,
  noise1,
  noise2,
  smoothstep,
  stateOf,
  walkRandom,
} from "./world";

export interface Biome {
  id: string;
  name: string;
  /** Typical ground height: cells from the top of the world. */
  base: number;
  /** Large-scale relief, cells. */
  amp: number;
  /** Small-scale roughness, as a share of amp. */
  detail: number;
  /** 0-1: sharp ridges and peaks (ridged noise) instead of rounded hills. */
  ridge: number;
  /** 0-1: how strongly the ground breaks into ledges and cliffs. */
  terrace: number;
  /** Typical cliff height, cells. */
  terraceStep: number;
  /** 0-1: sand dunes heaped on the ground. */
  dunes: number;
  /** One basin per region (0 or 1): a lake, a river, a canyon or a caldera. */
  basin: number;
  /** Basin half-width as a share of the region, and its depth in cells. */
  basinW: number;
  basinDepth: number;
  /** 0 = gently shelving sides, 1 = sheer stepped walls. */
  basinSteep: number;
  /** How full the basin is: 1 to just below its rim, 0.15 a stream at the bottom. */
  basinFill: number;
  /** What fills it: water or lava. */
  basinLiquid: number;
  /** 0-1: how much of the deep rock opens into caverns. */
  cavern: number;
  /** Cavern noise wavelength, x then y, cells: wide and low or small and round. */
  cavernX: number;
  cavernY: number;
  /** 0-1: how many passages join the caverns. */
  tunnels: number;
  /** Expected sinkhole shafts per region. */
  sinkholes: number;
  /** 0-1: share of cave hollows that hold pools. */
  wet: number;
  /** Hollows lower than this many cells above the world's floor fill with lava. */
  lavaDepth: number;
  /** Surface cover and the layer under it, and that layer's thickness. */
  top: number;
  sub: number;
  soil: number;
  /** Surface plants per column. */
  pines: number;
  broad: number;
  giants: number;
  shrooms: number;
  cacti: number;
  dead: number;
  shrubs: number;
  /** 0-1 cave life and features. */
  fungus: number;
  vines: number;
  spikes: number;
  crystals: number;
  roots: number;
  fossils: number;
  /** 0-1: freezing; above 0.5 pools are ice and stone spikes are icicles. */
  ice: number;
  /** Ground higher than this (smaller y) carries snow; 0 = never. */
  snowline: number;
}

const COMMON = {
  ridge: 0,
  dunes: 0,
  basin: 0,
  basinW: 0.15,
  basinDepth: 100,
  basinSteep: 0,
  basinFill: 1,
  basinLiquid: M.WATER as number,
  lavaDepth: 240,
  top: M.GRASS as number,
  sub: M.SOIL as number,
  pines: 0,
  broad: 0,
  giants: 0,
  shrooms: 0,
  cacti: 0,
  dead: 0,
  shrubs: 0,
  fungus: 0.05,
  vines: 0,
  spikes: 0.2,
  crystals: 0.1,
  roots: 0,
  fossils: 0,
  ice: 0,
  snowline: 0,
};

export const BIOMES: Biome[] = [
  {
    ...COMMON,
    id: "highlands",
    name: "Cliffs over a lake",
    base: 540,
    amp: 170,
    detail: 0.3,
    terrace: 0.9,
    terraceStep: 54,
    basin: 1,
    basinW: 0.15,
    basinDepth: 105,
    cavern: 0.15,
    cavernX: 190,
    cavernY: 80,
    tunnels: 0.8,
    sinkholes: 0.8,
    wet: 0.35,
    soil: 8,
    pines: 0.06,
    broad: 0.004,
    shrubs: 0.02,
    fungus: 0.08,
    spikes: 0.8,
    crystals: 0.7,
    snowline: 430,
  },
  {
    ...COMMON,
    id: "fungal",
    name: "Fungal caverns",
    base: 600,
    amp: 60,
    detail: 0.35,
    terrace: 0.05,
    terraceStep: 40,
    cavern: 0.9,
    cavernX: 270,
    cavernY: 110,
    tunnels: 0.35,
    sinkholes: 2,
    wet: 0.6,
    soil: 6,
    broad: 0.014,
    shrooms: 0.012,
    shrubs: 0.02,
    fungus: 1,
    vines: 1,
    spikes: 0.1,
  },
  {
    ...COMMON,
    id: "canyon",
    name: "Red canyon",
    base: 560,
    amp: 120,
    detail: 0.2,
    terrace: 1,
    terraceStep: 34,
    dunes: 1,
    basin: 1,
    basinW: 0.1,
    basinDepth: 280,
    basinSteep: 0.55,
    basinFill: 0.12,
    cavern: 0.2,
    cavernX: 230,
    cavernY: 55,
    tunnels: 0.5,
    sinkholes: 0.4,
    wet: 0.05,
    top: M.SAND,
    sub: M.SAND,
    soil: 4,
    cacti: 0.012,
    dead: 0.003,
    spikes: 0.5,
    crystals: 0.15,
    fossils: 1,
  },
  {
    ...COMMON,
    id: "forest",
    name: "River forest",
    base: 610,
    amp: 75,
    detail: 0.3,
    terrace: 0.15,
    terraceStep: 30,
    basin: 1,
    basinW: 0.08,
    basinDepth: 55,
    cavern: 0.35,
    cavernX: 200,
    cavernY: 85,
    tunnels: 0.6,
    sinkholes: 0.6,
    wet: 0.75,
    soil: 12,
    broad: 0.03,
    giants: 0.012,
    shrubs: 0.08,
    fungus: 0.35,
    spikes: 0.25,
    roots: 1,
  },
  {
    ...COMMON,
    id: "peaks",
    name: "Frozen peaks",
    base: 470,
    amp: 210,
    detail: 0.25,
    ridge: 0.75,
    terrace: 0.25,
    terraceStep: 40,
    basin: 1,
    basinW: 0.09,
    basinDepth: 70,
    cavern: 0.35,
    cavernX: 150,
    cavernY: 95,
    tunnels: 0.5,
    sinkholes: 0.3,
    wet: 0.55,
    top: M.SNOW,
    sub: M.SNOW,
    soil: 8,
    pines: 0.03,
    spikes: 0.9,
    crystals: 0.4,
    ice: 1,
    snowline: 2000,
  },
  {
    ...COMMON,
    id: "basalt",
    name: "Basalt fields",
    base: 600,
    amp: 90,
    detail: 0.2,
    terrace: 0.7,
    terraceStep: 26,
    basin: 1,
    basinW: 0.06,
    basinDepth: 60,
    basinFill: 0.6,
    basinLiquid: M.LAVA,
    cavern: 0.55,
    cavernX: 520,
    cavernY: 36,
    tunnels: 0.4,
    sinkholes: 0.5,
    wet: 0.1,
    lavaDepth: 800,
    top: M.ASH,
    sub: M.ASH,
    soil: 3,
    dead: 0.008,
    shrubs: 0.006,
    spikes: 0.3,
    crystals: 0.3,
  },
];

/** Half-width of the band over which neighbouring regions blend, in cells. */
export const BLEND = 400;
/** Cells generated either side of a region so features crossing its edges agree. */
export const MARGIN = 256;
/** Widest air gap a pool may span; must stay well under MARGIN. */
const MAX_POOL = 150;
type Params = Record<Exclude<keyof Biome, "id" | "name">, number>;
/** Parameters that blend across an edge; the rest (materials, basins) belong to one side. */
const NUMERIC = (Object.keys(BIOMES[0]) as (keyof Biome)[]).filter(
  (k) => !["id", "name", "top", "sub", "basinLiquid"].includes(k),
) as (keyof Params)[];

/**
 * The biome of each region. Even regions draw freely from the list; odd ones
 * draw from the biomes their two neighbours are not, so neighbours always
 * differ. Each region depends only on its own index and its neighbours'.
 */
export function regionBiome(seed: number, r: number): number {
  const n = BIOMES.length,
    pick = (q: number) => Math.floor(hash3(q, 7, seed + 1) * n);
  if ((r & 1) === 0) return pick(r);
  const a = pick(r - 1),
    b = pick(r + 1),
    choices: number[] = [];
  for (let k = 0; k < n; k++) if (k !== a && k !== b) choices.push(k);
  return choices[Math.floor(hash3(r, 8, seed + 1) * choices.length)];
}

/** The two regions whose shared edge is nearest x, and how far x is past it. */
function nearestEdge(x: number) {
  const r = Math.floor(x / REGION_W),
    local = x - r * REGION_W;
  return local < REGION_W / 2
    ? { left: r - 1, right: r, past: local }
    : { left: r, right: r + 1, past: local - REGION_W };
}

/** Biome parameters blended across region edges. */
export function paramsAt(seed: number, x: number) {
  const e = nearestEdge(x),
    a = BIOMES[regionBiome(seed, e.left)],
    b = BIOMES[regionBiome(seed, e.right)],
    t = smoothstep(-BLEND, BLEND, e.past);
  const p = {} as Params;
  for (const k of NUMERIC) p[k] = lerp(a[k] as number, b[k] as number, t);
  // Snow only blends where both sides have a snowline; otherwise the nearer side decides.
  if (!a.snowline || !b.snowline) p.snowline = (t < 0.5 ? a : b).snowline;
  return { p, t, left: e.left, right: e.right, past: e.past };
}

/** Which side's biome a surface column belongs to: patches that mix across the band. */
function columnBiome(seed: number, x: number) {
  const { t, left, right } = paramsAt(seed, x);
  return regionBiome(seed, noise1(x / 35, seed + 42) < t ? right : left);
}

interface Basin {
  c: number;
  w: number;
  depth: number;
  steep: number;
  fill: number;
  liquid: number;
}

function basinOf(seed: number, r: number): Basin | null {
  const b = BIOMES[regionBiome(seed, r)];
  if (!b.basin) return null;
  return {
    c: r * REGION_W + REGION_W * (0.3 + 0.4 * hash3(r, 11, seed)),
    w: REGION_W * b.basinW * (0.8 + 0.4 * hash3(r, 12, seed)),
    depth: b.basinDepth * (0.75 + 0.5 * hash3(r, 13, seed)),
    steep: b.basinSteep,
    fill: b.basinFill,
    liquid: b.basinLiquid,
  };
}

/** Dunes: long windward slopes and short steep lee faces, heaped in sand. */
function duneAt(seed: number, x: number, dunes: number) {
  if (dunes <= 0.01) return 0;
  const u = x / 80 + 0.7 * fbm1(x / 420, seed + 10),
    f = u - Math.floor(u),
    shape = f < 0.75 ? smoothstep(0, 0.75, f) : smoothstep(1, 0.75, f);
  return dunes * (6 + 16 * fbm1(x / 300, seed + 11)) * shape;
}

/** Ground height (cells from the top) at world column x, before caves. */
export function groundAt(seed: number, x: number) {
  const { p } = paramsAt(seed, x);
  let n =
    (fbm1(x / 600, seed + 1) - 0.5) * 2 * p.amp +
    (fbm1(x / 110, seed + 2) - 0.5) * 2 * p.amp * p.detail;
  if (p.ridge > 0) {
    // Ridged noise: crests and peaks rather than rounded hills.
    const r = 1 - Math.abs(2 * fbm1(x / 380, seed + 8, 4) - 1);
    n -= p.ridge * p.amp * 1.5 * (r * Math.sqrt(r) - 0.4);
  }
  const basin = basinOf(seed, Math.floor(x / REGION_W));
  let bowl = 0;
  if (basin)
    bowl = smoothstep(
      1,
      0.35 + 0.4 * basin.steep,
      Math.abs(x - basin.c) / basin.w,
    );
  // A basin: flat-bottomed, with shelving sides (a lake) or sheer ones (a canyon).
  const hs =
    p.base +
    n +
    (bowl > 0
      ? basin!.depth * bowl * (1 + 0.25 * (fbm1(x / 50, seed + 4) - 0.5))
      : 0);
  // Ledges: the height is snapped toward steps whose size drifts along the land,
  // so cliffs come in different heights rather than one repeated stair.
  const step = p.terraceStep * (0.7 + 0.6 * fbm1(x / 900, seed + 3)),
    k = hs / step,
    fi = Math.floor(k),
    terr = (fi + smoothstep(0.8, 1, k - fi)) * step,
    h = lerp(hs, terr, p.terrace * (1 - bowl * (1 - (basin?.steep ?? 0))));
  return Math.max(150, Math.min(WORLD_H - 420, h - duneAt(seed, x, p.dunes)));
}

/**
 * The liquid in a basin: its surface sits below the lower of the two highest
 * points either side, so it is held in on both sides wherever the land around
 * the bowl rises and falls; a part-filled basin sits lower, toward its bed.
 * Returns the level (cells from the top) and the stretch of columns between
 * those two high points.
 */
function lakeOf(seed: number, basin: Basin) {
  let left = Infinity,
    xl = 0,
    right = Infinity,
    xr = 0,
    bed = 0;
  for (let x = Math.round(basin.c); x >= basin.c - 1.4 * basin.w; x--) {
    const g = groundAt(seed, x);
    if (g < left) [left, xl] = [g, x];
    bed = Math.max(bed, g);
  }
  for (let x = Math.round(basin.c); x <= basin.c + 1.4 * basin.w; x++) {
    const g = groundAt(seed, x);
    if (g < right) [right, xr] = [g, x];
    bed = Math.max(bed, g);
  }
  const rim = Math.max(left, right) + 3;
  return {
    level: Math.round(Math.min(bed - 3, rim + (1 - basin.fill) * (bed - rim))),
    x0: xl,
    x1: xr,
  };
}

export interface Region {
  index: number;
  biome: number;
  cells: Uint8Array;
  state: Uint8Array;
  /** Ground height per local column, before caves. */
  surface: Int16Array;
  /** Lake surface (cells from the top) or -1. */
  lake: number;
  /** Milliseconds to generate, measured. */
  ms: number;
}

/** Strata: thickness varies from thin seams to thick beds, the same everywhere for a seed. */
function strataTable(seed: number) {
  const band = new Int32Array(2400),
    /** How far through its stratum each depth is, 0 at the top to 1 at the bottom. */
    within = new Float32Array(2400),
    R = walkRandom(Math.floor(hash3(seed, 5, 5) * 4294967296));
  let k = 0,
    u = 0;
  while (u < band.length) {
    k++;
    const r = R(),
      thick =
        r < 0.25 ? 4 + Math.floor(R() * 6) : 12 + Math.floor(R() * R() * 46);
    for (let j = 0; j < thick && u < band.length; j++, u++) {
      band[u] = k;
      within[u] = (j + 0.5) / thick;
    }
  }
  return { band, within };
}

/** Cavern openness at a world point: positive inside a cavern. */
function cavernAt(seed: number, wx: number, y: number, p: Params, g: number) {
  const depth = y - g,
    thr = 0.74 - 0.2 * p.cavern,
    // Wide, low pockets; a few more of them deeper down.
    deepen = 0.05 * smoothstep(150, 700, depth),
    o =
      (fbm2(wx / p.cavernX, y / p.cavernY, seed + 100, 3) - thr + deepen) * 14,
    // Keep a skin of rock under the ground and above the bedrock.
    env =
      smoothstep(16, 70, depth) *
      (1 - smoothstep(WORLD_H - 150, WORLD_H - 60, y));
  return Math.min(o, env * 3 - 1);
}

/** Caverns are found and joined on a fixed world grid of blocks, the same from any window. */
const BX = 256,
  BY = 200;

/** The most open point of a cavern in a block, if the block holds one. */
function anchorOf(
  seed: number,
  bx: number,
  by: number,
  cache: Map<number, { x: number; y: number } | null>,
) {
  const key = bx * 64 + by;
  if (cache.has(key)) return cache.get(key)!;
  let best = 0.5,
    found: { x: number; y: number } | null = null;
  for (let i = 0; i < 8; i++) {
    const wx = bx * BX + ((i + 0.5) * BX) / 8,
      p = paramsAt(seed, wx).p,
      g = groundAt(seed, wx);
    for (let j = 0; j < 8; j++) {
      const y = by * BY + ((j + 0.5) * BY) / 8,
        o = cavernAt(seed, wx, y, p, g);
      if (o > best) {
        best = o;
        found = { x: wx, y };
      }
    }
  }
  cache.set(key, found);
  return found;
}

/**
 * Passages between caverns in neighbouring blocks: gentle curves that wander
 * a little and change width, as points (x, y, radius) to carve.
 */
function passagesNear(seed: number, X0: number, WW: number) {
  const cache = new Map<number, { x: number; y: number } | null>(),
    out: number[][] = [],
    rows = Math.ceil(WORLD_H / BY);
  for (
    let bx = Math.floor(X0 / BX) - 2;
    bx <= Math.floor((X0 + WW) / BX) + 1;
    bx++
  )
    for (let by = 0; by < rows; by++) {
      const a = anchorOf(seed, bx, by, cache);
      if (!a) continue;
      // At most two passages leave each cavern: one sideways (level, rising or
      // falling, chosen by hash) and sometimes one down.
      const side = Math.floor(hash3(bx, by, seed + 504) * 3) - 1;
      for (const [dx, dy] of [
        [1, side],
        [0, 1],
      ]) {
        if (by + dy < 0 || by + dy >= rows) continue;
        const b = anchorOf(seed, bx + dx, by + dy, cache);
        if (!b) continue;
        const mx = (a.x + b.x) / 2,
          p = paramsAt(seed, mx).p;
        if (
          hash3(bx * 4 + dx, by * 4 + dy + 2, seed + 500) >
          p.tunnels * (dx ? 0.75 : 0.35)
        )
          continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y),
          nx = -(b.y - a.y) / len,
          ny = (b.x - a.x) / len,
          bow = (hash3(bx, by * 4 + dx + dy, seed + 501) - 0.5) * 0.8 * len,
          cx = mx + nx * bow,
          cy = (a.y + b.y) / 2 + ny * bow,
          n = Math.ceil(len / 2),
          pts: number[] = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n,
            u = 1 - t,
            wig =
              16 *
              (fbm1((t * len) / 50, seed + 502 + bx * 13 + by, 3) - 0.5) *
              2 *
              Math.min(1, 4 * t * (1 - t));
          let x = u * u * a.x + 2 * u * t * cx + t * t * b.x + nx * wig,
            y = u * u * a.y + 2 * u * t * cy + t * t * b.y + ny * wig;
          y = Math.max(y, groundAt(seed, x) + 30);
          pts.push(
            x,
            y,
            2.5 + 3.5 * fbm1((t * len) / 60, seed + 503 + by * 7 + bx),
          );
        }
        out.push(pts);
      }
    }
  return out;
}

/** A shaft from the surface down into the rock: a sinkhole. */
interface Shaft {
  cx: number;
  top: number;
  bottom: number;
  hw: number;
}

function shaftsOf(seed: number, q: number): Shaft[] {
  const R = walkRandom(Math.floor(hash3(seed, q, 77) * 4294967296)),
    b = BIOMES[regionBiome(seed, q)],
    out: Shaft[] = [];
  let n = Math.floor(b.sinkholes);
  if (R() < b.sinkholes - n) n++;
  const basin = basinOf(seed, q);
  for (let i = 0; i < n; i++) {
    const cx = q * REGION_W + REGION_W * (0.12 + 0.76 * R()),
      g = groundAt(seed, cx),
      bottom = g + 120 + R() * 240,
      hw = 4 + R() * 6;
    // Not under a lake: the water would pour down the shaft.
    if (basin && Math.abs(cx - basin.c) < 1.4 * basin.w + 30) continue;
    out.push({ cx, top: g - 6, bottom, hw });
  }
  return out;
}

/** Generate one region. */
export function generateRegion(seed: number, r: number): Region {
  const t0 = performance.now();
  const w = generateWindow(seed, r * REGION_W, REGION_W);
  let lake = -1;
  const basin = basinOf(seed, r);
  if (basin) lake = lakeOf(seed, basin).level;
  return {
    index: r,
    biome: regionBiome(seed, r),
    ...w,
    lake,
    ms: performance.now() - t0,
  };
}

/**
 * Generate the world columns [x0, x0 + width). Any window gives the same cells
 * as the regions it overlaps, which is what makes region edges seamless.
 */
export function generateWindow(seed: number, x0: number, width: number) {
  const H = WORLD_H,
    WW = width + 2 * MARGIN,
    X0 = x0 - MARGIN,
    cells = new Uint8Array(WW * H),
    state = new Uint8Array(WW * H);

  // 1. Ground, and the blended parameters for every column.
  const ground = new Float64Array(WW + 4),
    params: Params[] = [],
    edges: { left: number; right: number; past: number }[] = [];
  for (let i = 0; i < WW + 4; i++) ground[i] = groundAt(seed, X0 + i - 2);
  for (let x = 0; x < WW; x++) {
    const e = paramsAt(seed, X0 + x);
    params.push(e.p);
    edges.push(e);
  }
  const surface = new Int16Array(WW);
  for (let x = 0; x < WW; x++) surface[x] = Math.round(ground[x + 2]);

  // 2. Rock in strata. Layers stay roughly level (cliffs cut through them) with
  // slow folds; across a biome edge each layer changes over at its own place.
  const table = strataTable(seed),
    colBiome = new Uint8Array(WW);
  for (let x = 0; x < WW; x++) {
    const wx = X0 + x,
      p = params[x],
      { left, right, past } = edges[x],
      s = surface[x],
      slope = Math.abs(ground[x + 4] - ground[x]),
      cb = (colBiome[x] = columnBiome(seed, wx)),
      cover = BIOMES[cb],
      // Dunes are heaps of sand on the ground, so they are sand all through.
      soil = Math.round(
        p.soil * Math.max(0, 1 - slope / 10) + duneAt(seed, wx, p.dunes),
      ),
      snowy = p.snowline > 0 && s < p.snowline,
      bl = regionBiome(seed, left),
      br = regionBiome(seed, right),
      fold = 80 * (fbm1(wx / 1500, seed + 5) - 0.5) * 2,
      bedrock = H - 22 - Math.floor(10 * fbm1(wx / 40, seed + 9));
    for (let y = s; y < H; y++) {
      const i = y * WW + x,
        depth = y - s,
        u = Math.max(
          0,
          Math.min(
            table.band.length - 1,
            Math.round(
              y +
                300 +
                fold +
                30 * (fbm2(wx / 260, y / 160, seed + 6, 2) - 0.5) * 2,
            ),
          ),
        ),
        k = table.band[u];
      let biome = past > 0 ? br : bl;
      if (bl !== br && Math.abs(past) < BLEND) {
        // Each layer's end is lens-shaped: it reaches furthest at mid-layer and
        // pinches out toward its top and bottom, like a bed thinning away.
        const shift = (hash3(k, left, seed + 23) - 0.5) * 1.2 * BLEND,
          f = table.within[u] - 0.5,
          tongue = hash3(k, left, seed + 24) < 0.5 ? 1 : -1,
          wob =
            past +
            shift -
            tongue * (140 * (1 - 4 * f * f) - 70) +
            50 * (fbm2(wx / 70, y / 50, seed + 21, 2) - 0.5) * 2;
        biome = wob > 0 ? br : bl;
      }
      state[i] = stateOf(k & 15, biome);
      if (y >= bedrock) cells[i] = M.BEDROCK;
      else if (depth === 0)
        cells[i] = snowy ? M.SNOW : soil > 0 ? cover.top : M.ROCK;
      else if (snowy && depth < 3) cells[i] = M.SNOW;
      else if (depth < soil) cells[i] = cover.sub;
      else cells[i] = M.ROCK;
    }
  }

  // 3. Caves. Openness is worked out on a coarse grid (every 4 cells), blended
  // between grid points, and roughened near the walls.
  const G = 4,
    GW = Math.ceil(WW / G) + 1,
    GH = Math.ceil(H / G) + 1,
    open = new Float32Array(GW * GH);
  const shafts: Shaft[] = [];
  for (
    let q = Math.floor(X0 / REGION_W) - 1;
    q <= Math.floor((X0 + WW) / REGION_W) + 1;
    q++
  )
    shafts.push(...shaftsOf(seed, q));
  for (let gx = 0; gx < GW; gx++) {
    const wx = X0 + gx * G,
      lx = Math.min(WW - 1, gx * G),
      p = params[lx],
      g = ground[lx + 2];
    const near = shafts.filter((s) => Math.abs(s.cx - wx) < s.hw * 2.2 + 40);
    for (let gy = 0; gy < GH; gy++) {
      const y = gy * G;
      let o = cavernAt(seed, wx, y, p, g);
      for (const s of near) {
        if (y < s.top || y > s.bottom) continue;
        const cx =
            s.cx + 24 * (fbm1(y / 90, seed + Math.round(s.cx)) - 0.5) * 2,
          taper = smoothstep(s.bottom, s.bottom - 60, y),
          flare = 1 + 1.2 * smoothstep(s.top + 20, s.top, y);
        o = Math.max(o, (s.hw * taper * flare - Math.abs(wx - cx)) * 0.3);
      }
      open[gy * GW + gx] = o;
    }
  }
  const before = cells.slice();
  for (let y = 1; y < H - 1; y++) {
    const gy = Math.floor(y / G),
      fy = y / G - gy;
    for (let x = 0; x < WW; x++) {
      const i = y * WW + x;
      if (cells[i] === M.BEDROCK || y < surface[x] - 8) continue;
      const gx = Math.floor(x / G),
        fx = x / G - gx,
        a = open[gy * GW + gx],
        b = open[gy * GW + gx + 1],
        c = open[(gy + 1) * GW + gx],
        d = open[(gy + 1) * GW + gx + 1];
      let o = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      if (o > -0.35 && o < 0.35)
        o += (noise2((X0 + x) / 7, y / 7, seed + 300) - 0.5) * 0.6;
      if (o > 0) cells[i] = M.AIR;
    }
  }
  // Passages joining neighbouring caverns.
  for (const pts of passagesNear(seed, X0, WW))
    for (let k = 0; k < pts.length; k += 3) {
      const cx = pts[k] - X0,
        cy = pts[k + 1],
        r = pts[k + 2];
      for (
        let y = Math.max(1, Math.floor(cy - r));
        y <= Math.min(H - 2, Math.ceil(cy + r));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(cx - r));
          x <= Math.min(WW - 1, Math.ceil(cx + r));
          x++
        ) {
          const i = y * WW + x;
          if (
            (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r &&
            cells[i] !== M.BEDROCK &&
            y > surface[x] + 12
          )
            cells[i] = M.AIR;
        }
    }
  let top = H;
  for (let x = 0; x < WW; x++) top = Math.min(top, surface[x] - 10);
  tidy(cells, before, WW, H, Math.max(0, top), 160, 90);

  // 4. The lake, then pools and lava in hollows.
  for (
    let q = Math.floor(X0 / REGION_W);
    q <= Math.floor((X0 + WW - 1) / REGION_W);
    q++
  ) {
    const basin = basinOf(seed, q);
    if (!basin) continue;
    const { level, x0: lx0, x1: lx1 } = lakeOf(seed, basin),
      lava = basin.liquid === M.LAVA;
    for (let wx = lx0 + 1; wx < lx1; wx++) {
      const x = wx - X0;
      if (x < 0 || x >= WW || surface[x] <= level) continue; // dry land above the waterline
      for (let y = level; y < surface[x]; y++)
        if (cells[y * WW + x] === M.AIR) cells[y * WW + x] = basin.liquid;
      // A sealed bed: sand at the shore, gravel deeper (or bare rock under
      // lava); no cave breaks through it.
      const shore = surface[x] - level < 8;
      for (let y = surface[x]; y < Math.min(H, surface[x] + 12); y++) {
        const i = y * WW + x;
        if (cells[i] === M.BEDROCK) break;
        if (y < surface[x] + 5 || cells[i] === M.AIR)
          cells[i] = lava ? M.ROCK : shore ? M.SAND : M.GRAVEL;
      }
    }
  }
  fillHollows(cells, WW, H, X0, seed, params, surface);
  // In frozen biomes pools are ice, and lakes carry a crust of it.
  for (let x = 0; x < WW; x++) {
    if (params[x].ice < 0.5) continue;
    let run = 0;
    for (let y = 0; y < H; y++) {
      const i = y * WW + x;
      if (cells[i] !== M.WATER) {
        run = 0;
        continue;
      }
      run++;
      if (y >= surface[x] || run <= 4) cells[i] = M.ICE;
    }
  }
  // Fossils in the rock, on a fixed world grid.
  for (
    let gx = Math.floor(X0 / 48) - 1;
    gx <= Math.floor((X0 + WW) / 48) + 1;
    gx++
  )
    for (let gy = 0; gy < H / 40; gy++) {
      const fx = gx * 48 + Math.floor(hash3(gx, gy, seed + 90) * 40),
        fy = gy * 40 + Math.floor(hash3(gx, gy, seed + 91) * 32),
        lx = fx - X0;
      if (lx < 0 || lx >= WW) continue;
      if (hash3(gx, gy, seed + 92) > 0.06 * params[lx].fossils) continue;
      if (fy < surface[lx] + 12) continue;
      ammonite(cells, WW, lx, fy, 2 + Math.floor(hash3(gx, gy, seed + 93) * 3));
    }

  // 5. Life on the surface: decided per world column, mixed by the blended
  // densities. Plants carry their column's biome, which sets their colours.
  stamp = state;
  for (let x = 0; x < WW; x++) {
    const wx = X0 + x,
      p = params[x],
      s = surface[x],
      si = s * WW + x,
      top = cells[si];
    if (top === M.AIR || top === M.WATER || top === M.LAVA || top === M.ICE)
      continue;
    if (cells[si - WW] !== M.AIR) continue;
    stampBiome = colBiome[x];
    const slope = Math.abs(
        ground[Math.min(WW + 3, x + 5)] - ground[Math.max(0, x - 1)],
      ),
      R = walkRandom(Math.floor(hash3(wx, 32, seed) * 4294967296));
    let h = hash3(wx, 31, seed);
    if (slope < 6 && (h -= p.pines) < 0)
      pine(cells, WW, x, s, R, top === M.SNOW);
    else if (slope < 4 && (h -= p.giants) < 0)
      giantTree(cells, WW, x, s, R, wx, seed);
    else if (slope < 5 && (h -= p.broad) < 0)
      broadTree(cells, WW, x, s, R, wx, seed);
    else if (slope < 4 && (h -= p.shrooms) < 0)
      mushroom(cells, state, WW, x, s - 1, wx, seed, R, 1.5);
    else if (slope < 6 && (h -= p.cacti) < 0) cactus(cells, WW, x, s, R);
    else if (slope < 8 && (h -= p.dead) < 0) deadTree(cells, WW, x, s, R);
    else if ((h -= p.shrubs) < 0) shrub(cells, WW, x, s, R);
    else if (top === M.GRASS && hash3(wx, 33, seed) < 0.3) {
      // Tufts of grass along the skyline.
      const tall = 1 + Math.floor(hash3(wx, 34, seed) * 3);
      for (let k = 1; k <= tall; k++) put(cells, WW, x, s - k, M.GRASS);
    }
  }
  stamp = null;

  // Life in the caves: floors and ceilings, decided per world cell.
  for (let y = 4; y < H - 30; y++)
    for (let x = 2; x < WW - 2; x++) {
      const i = y * WW + x;
      if (cells[i] !== M.AIR || y <= surface[x] + 6) continue;
      const below = cells[i + WW],
        above = cells[i - WW],
        wx = X0 + x,
        p = params[x];
      if (
        below === M.ROCK ||
        below === M.SOIL ||
        below === M.GRAVEL ||
        below === M.SAND
      ) {
        const zone = noise2(wx / 40, y / 40, seed + 60);
        if (zone < 0.25 + 0.5 * p.fungus && below !== M.SAND)
          cells[i + WW] = M.MOSS;
        const h = hash3(wx, y, seed + 62);
        if (h < 0.03 * p.fungus) {
          cells[i] = M.CAP;
          state[i] |= GLOW;
          if (hash3(wx, y, seed + 66) < 0.5 && cells[i - WW] === M.AIR) {
            cells[i - WW] = M.CAP;
            state[i - WW] |= GLOW;
          }
        } else if (h > 1 - 0.012 * p.fungus) {
          mushroom(
            cells,
            state,
            WW,
            x,
            y,
            wx,
            seed,
            walkRandom(Math.floor(hash3(wx, y, seed + 63) * 4294967296)),
            1,
          );
        } else if (h > 0.5 && h < 0.5 + 0.012 * p.spikes) {
          spike(
            cells,
            state,
            WW,
            x,
            y,
            -1,
            3 + Math.floor(hash3(wx, y, seed + 64) * 12),
            p.ice > 0.5 ? M.ICE : M.ROCK,
          );
        } else if (h > 0.6 && h < 0.6 + 0.004 * p.crystals)
          crystals(cells, state, WW, x, y, -1, wx, seed);
      } else if (above === M.ROCK || above === M.SOIL || above === M.SAND) {
        const h = hash3(wx, y, seed + 65);
        if (y < surface[x] + 110 && h > 0.8 && h < 0.8 + 0.2 * p.roots)
          root(cells, WW, x, y, wx, seed);
        else if (
          h <
          0.12 *
            p.vines *
            smoothstep(0.42, 0.72, noise2(wx / 45, y / 45, seed + 69))
        )
          vine(cells, state, WW, x, y, wx, seed);
        else if (h > 0.5 && h < 0.5 + 0.03 * p.spikes)
          spike(
            cells,
            state,
            WW,
            x,
            y,
            1,
            3 +
              Math.floor(
                hash3(wx, y, seed + 67) * hash3(wx, y, seed + 68) * 26,
              ),
            p.ice > 0.5 ? M.ICE : M.ROCK,
          );
        else if (h > 0.6 && h < 0.6 + 0.004 * p.crystals)
          crystals(cells, state, WW, x, y, 1, wx, seed);
      }
    }

  // Cut the region out of the window.
  const outCells = new Uint8Array(width * H),
    outState = new Uint8Array(width * H);
  for (let y = 0; y < H; y++) {
    outCells.set(
      cells.subarray(y * WW + MARGIN, y * WW + MARGIN + width),
      y * width,
    );
    outState.set(
      state.subarray(y * WW + MARGIN, y * WW + MARGIN + width),
      y * width,
    );
  }
  return {
    cells: outCells,
    state: outState,
    surface: surface.slice(MARGIN, MARGIN + width),
  };
}

/**
 * Pools and lava fill hollows a row at a time from the bottom up: a run of air
 * between two walls becomes liquid when everything under it is solid or the
 * same liquid. Pools start only in wet stretches of rock and stop at a depth
 * that varies along the land, so they never stand as walls of water.
 */
function fillHollows(
  cells: Uint8Array,
  WW: number,
  H: number,
  X0: number,
  seed: number,
  params: Params[],
  surface: Int16Array,
) {
  const depthOf = new Uint8Array(WW * H);
  for (let y = H - 2; y > 0; y--) {
    let x = 0;
    while (x < WW) {
      if (cells[y * WW + x] !== M.AIR) {
        x++;
        continue;
      }
      let e = x;
      while (e < WW && cells[y * WW + e] === M.AIR) e++;
      if (x > 0 && e < WW && e - x <= MAX_POOL) {
        let liquid = -1,
          ok = true,
          deepest = 0,
          sealed = true;
        for (let k = x; k < e && ok; k++) {
          const b = cells[(y + 1) * WW + k];
          if (b === M.AIR) ok = false;
          else if (b === M.WATER || b === M.LAVA) {
            sealed = false;
            if (liquid < 0) liquid = b;
            else if (liquid !== b) ok = false;
            deepest = Math.max(deepest, depthOf[(y + 1) * WW + k]);
          }
        }
        if (ok && sealed) {
          // The bottom of a hollow: does a pool start here?
          const wx = X0 + x,
            p = params[x],
            lava = y > H - p.lavaDepth;
          liquid = -1;
          if (
            y > surface[x] + 30 &&
            noise2(wx / 260, y / 200, seed + 400) < (lava ? 0.45 : p.wet)
          )
            liquid = lava ? M.LAVA : M.WATER;
        }
        const most =
          4 + Math.floor(34 * noise2((X0 + x) / 400, y / 300, seed + 401));
        // Leave air above a pool: stop where the roof comes down close.
        let roof = 0;
        if (ok && liquid >= 0 && y > 10)
          for (let k = x; k < e; k++)
            if (cells[(y - 10) * WW + k] === M.AIR) roof++;
        if (ok && liquid >= 0 && deepest < most && roof >= 0.6 * (e - x))
          for (let k = x; k < e; k++) {
            const i = y * WW + k;
            cells[i] = liquid;
            depthOf[i] = deepest + 1;
          }
      }
      x = e;
    }
  }
}

/**
 * Tidy the caves: fill air pockets smaller than minAir cells and clear rock
 * islands smaller than minRock, so the rock reads as solid and caves as spaces.
 * Anything touching the window's sides is kept: it may continue beyond.
 */
function tidy(
  cells: Uint8Array,
  before: Uint8Array,
  WW: number,
  H: number,
  yTop: number,
  minAir: number,
  minRock: number,
) {
  const seen = new Uint8Array(WW * H),
    stack = new Int32Array(WW * H),
    comp = new Int32Array(Math.max(minAir, minRock));
  for (let i = yTop * WW; i < WW * H; i++) {
    if (seen[i]) continue;
    const air = cells[i] === M.AIR,
      limit = air ? minAir : minRock;
    let n = 0,
      sp = 0,
      side = false;
    stack[sp++] = i;
    seen[i] = 1;
    while (sp) {
      const j = stack[--sp],
        x = j % WW;
      if (n < limit) comp[n] = j;
      n++;
      if (x === 0 || x === WW - 1) side = true;
      const ns = [
        x > 0 ? j - 1 : -1,
        x < WW - 1 ? j + 1 : -1,
        j - WW >= yTop * WW ? j - WW : -1,
        j + WW < WW * H ? j + WW : -1,
      ];
      for (const k of ns)
        if (k >= 0 && !seen[k] && (cells[k] === M.AIR) === air) {
          seen[k] = 1;
          stack[sp++] = k;
        }
    }
    if (n < limit && !side)
      for (let k = 0; k < n; k++)
        cells[comp[k]] = air ? before[comp[k]] : M.AIR;
  }
}

/** While surface plants are placed, the state array to mark them with their biome. */
let stamp: Uint8Array | null = null,
  stampBiome = 0;

function put(cells: Uint8Array, WW: number, x: number, y: number, m: number) {
  if (x < 0 || x >= WW || y < 0 || y >= WORLD_H) return false;
  const i = y * WW + x;
  if (cells[i] !== M.AIR) return false;
  cells[i] = m;
  if (stamp) stamp[i] = stateOf(0, stampBiome);
  return true;
}

/** A blob of leaves: an ellipse with ragged edges. */
function blob(
  cells: Uint8Array,
  WW: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  R: () => number,
) {
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (d < 0.75 || (d < 1.05 && R() < 0.55))
        put(cells, WW, Math.round(cx + dx), Math.round(cy + dy), M.LEAF);
    }
}

/** A line of cells from (x0, y0) to (x1, y1). */
function line(
  cells: Uint8Array,
  WW: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  m: number,
) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++)
    put(
      cells,
      WW,
      Math.round(x0 + ((x1 - x0) * k) / n),
      Math.round(y0 + ((y1 - y0) * k) / n),
      m,
    );
}

/** A giant forest tree: a thick trunk, a few boughs and a broad layered crown. */
function giantTree(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
  wx: number,
  seed: number,
) {
  const tall = 34 + Math.floor(R() * 34),
    thick = R() < 0.5 ? 2 : 3,
    top = s - tall;
  for (let k = 1; k <= tall; k++)
    for (let t = 0; t < thick; t++) put(cells, WW, x + t, s - k, M.WOOD);
  // Buttress roots flaring at the base.
  put(cells, WW, x - 1, s - 1, M.WOOD);
  put(cells, WW, x + thick, s - 1, M.WOOD);
  const boughs = 2 + Math.floor(R() * 3);
  for (let b = 0; b < boughs; b++) {
    const y0 = top + Math.floor(tall * (0.15 + 0.35 * R())),
      dir = b % 2 ? 1 : -1,
      len = 7 + Math.floor(R() * 9),
      x1 = x + (dir > 0 ? thick : -1) + dir * len,
      y1 = y0 - Math.floor(len * (0.4 + 0.4 * R()));
    line(cells, WW, x + (dir > 0 ? thick - 1 : 0), y0, x1, y1, M.WOOD);
    blob(cells, WW, x1, y1 - 2, 6 + R() * 4, 3.5 + R() * 2, R);
  }
  blob(cells, WW, x + thick / 2, top - 3, 10 + R() * 5, 6 + R() * 3, R);
  blob(
    cells,
    WW,
    x + thick / 2 + (R() - 0.5) * 10,
    top - 9,
    7 + R() * 3,
    4 + R() * 2,
    R,
  );
  void wx;
  void seed;
}

/** A cactus: a column with one or two arms bending upward. */
function cactus(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
) {
  const tall = 6 + Math.floor(R() * 12),
    wide = tall > 11 ? 2 : 1;
  for (let k = 1; k <= tall; k++)
    for (let t = 0; t < wide; t++) put(cells, WW, x + t, s - k, M.LEAF);
  const arms = tall > 8 ? 1 + Math.floor(R() * 2) : 0;
  for (let a = 0; a < arms; a++) {
    const dir = a === 0 ? -1 : 1,
      y = s - 3 - Math.floor(R() * (tall - 6)),
      out = 2 + Math.floor(R() * 2),
      up = 2 + Math.floor(R() * 4),
      ax = dir < 0 ? x - out : x + wide - 1 + out;
    line(cells, WW, dir < 0 ? x - 1 : x + wide, y, ax, y, M.LEAF);
    line(cells, WW, ax, y - 1, ax, y - up, M.LEAF);
  }
}

/** A dead tree: a bare trunk with a few crooked branches. */
function deadTree(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
) {
  const tall = 8 + Math.floor(R() * 14);
  let cx = x;
  for (let k = 1; k <= tall; k++) {
    if (k > 4 && R() < 0.15) cx += R() < 0.5 ? -1 : 1;
    put(cells, WW, cx, s - k, M.WOOD);
  }
  const n = 2 + Math.floor(R() * 3);
  for (let b = 0; b < n; b++) {
    const y0 = s - Math.floor(tall * (0.45 + 0.5 * R())),
      dir = R() < 0.5 ? -1 : 1,
      len = 3 + Math.floor(R() * 6);
    line(
      cells,
      WW,
      cx,
      y0,
      cx + dir * len,
      y0 - Math.floor(len * (0.5 + R())),
      M.WOOD,
    );
  }
}

/** A low shrub. */
function shrub(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
) {
  blob(cells, WW, x, s - 1.5, 2 + R() * 2.5, 1.5 + R() * 1.2, R);
}

/** Roots hanging from a cave ceiling near the surface. */
function root(
  cells: Uint8Array,
  WW: number,
  x: number,
  y: number,
  wx: number,
  seed: number,
) {
  const len = 3 + Math.floor(hash3(wx, y, seed + 75) * 18);
  let cx = x;
  for (let k = 0; k < len; k++) {
    if (k > 1 && hash3(wx, y + k, seed + 76) < 0.2)
      cx += hash3(wx, y + k, seed + 77) < 0.5 ? -1 : 1;
    if (!put(cells, WW, cx, y + k, M.WOOD)) break;
  }
}

/** An ammonite: a ring with a dot, set into the rock. */
function ammonite(
  cells: Uint8Array,
  WW: number,
  x: number,
  y: number,
  r: number,
) {
  for (let dy = -r - 1; dy <= r + 1; dy++)
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy),
        i = (y + dy) * WW + x + dx;
      if (
        x + dx < 0 ||
        x + dx >= WW ||
        y + dy < 0 ||
        y + dy >= WORLD_H ||
        cells[i] !== M.ROCK
      )
        continue;
      if (
        (d > r - 0.7 && d < r + 0.4) ||
        d < 0.8 ||
        (d > r * 0.45 && d < r * 0.45 + 0.8 && dx > 0)
      )
        cells[i] = M.FOSSIL;
    }
}

function pine(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
  snowy: boolean,
) {
  const trunk = 2 + Math.floor(R() * 4),
    crown = 12 + Math.floor(R() * 20);
  for (let k = 1; k <= trunk + crown - 2; k++) put(cells, WW, x, s - k, M.WOOD);
  for (let k = 0; k < crown; k++) {
    // Tiers: the crown widens downward in steps, each tier a little wider.
    const tier = k % 5,
      half = Math.floor((k / crown) * crown * 0.28) + 1 - (tier === 0 ? 1 : 0);
    for (let d = -half; d <= half; d++) {
      const y = s - trunk - crown + k;
      put(
        cells,
        WW,
        x + d,
        y,
        snowy && (tier === 0 || Math.abs(d) === half) && R() < 0.6
          ? M.SNOW
          : M.LEAF,
      );
    }
  }
}

function broadTree(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
  wx: number,
  seed: number,
) {
  const trunk = 6 + Math.floor(R() * 7),
    rad = 5 + R() * 6;
  for (let k = 1; k <= trunk; k++) put(cells, WW, x, s - k, M.WOOD);
  const lean = R() < 0.5 ? -1 : 1;
  put(cells, WW, x + lean, s - trunk + 2, M.WOOD);
  const cy = s - trunk - rad * 0.6;
  for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++)
    for (let dx = -Math.ceil(rad * 1.4); dx <= Math.ceil(rad * 1.4); dx++)
      if (
        (dx / 1.4) * (dx / 1.4) + dy * dy <
        rad * rad * (0.7 + 0.5 * hash3(wx + dx, Math.round(cy) + dy, seed + 33))
      )
        put(cells, WW, x + dx, Math.round(cy + dy), M.LEAF);
}

/** A giant mushroom standing on (x, y + 1), sized to the room it has. */
function mushroom(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  x: number,
  y: number,
  wx: number,
  seed: number,
  R: () => number,
  size: number,
) {
  let free = 0;
  while (free < 160 && y - free > 0 && cells[(y - free) * WW + x] === M.AIR)
    free++;
  let cap = Math.round((6 + R() * 12) * size),
    ch = Math.max(3, Math.floor(cap * 0.5));
  const want = Math.round((10 + R() * 34) * size);
  for (let attempt = 0; ; attempt++) {
    const stalk = Math.min(want, free - ch - 3),
      top = y - stalk;
    if (stalk < 6 || x - cap - 1 < 0 || x + cap + 1 >= WW) return;
    let clear = true;
    for (let yy = top - ch - 1; yy <= top + 1 && clear; yy++)
      for (let dx = -cap; dx <= cap; dx += 2)
        if (cells[yy * WW + x + dx] !== M.AIR) clear = false;
    if (clear) {
      const thick = Math.max(1, Math.min(3, Math.round(stalk / 20)));
      for (let k = 0; k < stalk; k++)
        for (let t = 0; t < thick; t++) {
          const i = (y - k) * WW + x + t;
          cells[i] = M.STALK;
          if (stamp) stamp[i] = stateOf(0, stampBiome);
        }
      for (let r = 0; r < ch; r++) {
        const f = (ch - r) / ch,
          half = Math.floor(cap * Math.sqrt(1 - f * f * f));
        for (let dx = -half; dx <= half; dx++) {
          const i = (top - ch + r) * WW + x + dx;
          if (cells[i] !== M.AIR) continue;
          cells[i] = M.CAP;
          if (stamp) stamp[i] = stateOf(0, stampBiome);
          // A glowing rim under the cap and a few glowing spots on top.
          if (r === ch - 1 || hash3(wx + dx, top - ch + r, seed + 64) < 0.015)
            state[i] |= GLOW;
        }
      }
      return;
    }
    if (attempt === 1) return;
    cap = Math.max(4, Math.floor(cap * 0.6));
    ch = Math.max(3, Math.floor(cap * 0.5));
  }
}

/** A glowing vine hanging from the ceiling at (x, y). */
function vine(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  x: number,
  y: number,
  wx: number,
  seed: number,
) {
  const len =
    3 + Math.floor(hash3(wx, y, seed + 70) * hash3(wx, y, seed + 71) * 40);
  for (let k = 0; k < len; k++) {
    const i = (y + k) * WW + x;
    if (y + k >= WORLD_H - 1 || cells[i] !== M.AIR || cells[i + WW] !== M.AIR)
      break;
    cells[i] = M.VINE;
    if (k === len - 1 || hash3(wx, y + k, seed + 72) < 0.12) state[i] |= GLOW;
  }
}

/** A stone spike from the floor (dir -1, growing up) or the ceiling (dir 1, hanging down). */
function spike(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  x: number,
  y: number,
  dir: number,
  len: number,
  material: number,
) {
  const st = state[y * WW + x - dir * WW] & 0x7f,
    width = len > 10 ? 2 : len > 5 ? 1 : 0;
  for (let k = 0; k < len; k++) {
    const half = Math.round(width * (1 - k / len));
    for (let d = -half; d <= half; d++) {
      const yy = y + dir * k;
      if (put(cells, WW, x + d, yy, material)) state[yy * WW + x + d] = st;
    }
  }
}

/** A small cluster of glowing crystal shards. */
function crystals(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  x: number,
  y: number,
  dir: number,
  wx: number,
  seed: number,
) {
  const n = 2 + Math.floor(hash3(wx, y, seed + 80) * 4);
  for (let s = 0; s < n; s++) {
    const len = 2 + Math.floor(hash3(wx + s, y, seed + 81) * 8),
      lean = Math.floor((hash3(wx + s, y, seed + 82) - 0.5) * 3);
    for (let k = 0; k < len; k++) {
      const xx = x + s - (n >> 1) + Math.round((lean * k) / len),
        yy = y + dir * k;
      if (
        put(cells, WW, xx, yy, M.CRYSTAL) &&
        (k === len - 1 || hash3(xx, yy, seed + 83) < 0.3)
      )
        state[yy * WW + xx] |= GLOW;
    }
  }
}
