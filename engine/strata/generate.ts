// Strata region generator: a region of the world, built from its history.
//
// A region is REGION_W x WORLD_H cells generated from (seed, region index)
// alone, so any region can be rebuilt on demand and saves only need what the
// simulation later changes. Everything is decided in world coordinates: a
// region is cut from a wider window (MARGIN cells either side) so tunnels,
// pools, trees and mushrooms that straddle a region edge come out the same
// from both sides.
//
// The world's history (history.ts, read through worldmap.ts) decides the
// ground, the rock, the water and the climate; six looks (the BIOMES below)
// are blended by the world's biomes for what grows and lives. The land is
// built in passes:
//   1. the ground from the world: its land roughened, cut by river channels,
//      and stepped into benches and cliffs where hard beds cap soft ones;
//   2. rock in the world's own beds (sandstone, shale, limestone, granite...),
//      each running smoothly between the world's columns;
//   3. caves from noise, opening most readily in limestone and least in
//      granite: wide caverns, meandering tunnels, sinkhole shafts;
//   4. the sea, lakes and rivers where the world has them, then pools and
//      deep lava in hollows; in cold places, ice;
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
import {
  type Win,
  carveSurface,
  grove,
  raiseSurface,
  surfaceLandmarks,
} from "./surface";
import { ROCK as KIND, SEA_ROW } from "./history";
import { BIOMES as LAND, ZONE, coverOf } from "./biomes";
import { type Grow, SPECIES, mixOf, pick } from "./plants";
import { LANDFORM, landformAt, volcanoAt } from "./landforms";
import { isForest, plantForests } from "./forest";
import {
  type RockColumn,
  placeAt,
  groundRow,
  hard,
  kindAt,
  looksAt,
  rainAt,
  rockAt,
  warmthAt,
  waterAt,
  worldOf,
} from "./worldmap";

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
  /** 0-1 glow-worm threads hanging in shallow and middle caves. */
  glowworms: number;
  /** A river (0 or 1): from a spring on high ground, down to the basin. */
  river: number;
  /** An escarpment: a plateau this many cells high ending in a cliff over the basin; 0 = none. */
  scarp: number;
  /** The land rises this many cells away from the basin, so it sits in a valley. */
  valley: number;
  /** Surface rock: 0-1 cave mouths and overhangs in faces, arches, hoodoos (capped or flat pillars), boulders per column, scree. */
  mouths: number;
  arches: number;
  hoodoos: number;
  hoodooCap: number;
  boulders: number;
  scree: number;
  /** Surface greenery: ivy on faces, reeds in shallows, flowers and fallen logs per column. */
  ivy: number;
  reeds: number;
  flowers: number;
  logs: number;
  /** Built things: chance of a ruin per region, and of a rope bridge over a canyon. */
  ruins: number;
  bridge: number;
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
  lavaDepth: 150,
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
  glowworms: 0,
  river: 0,
  scarp: 0,
  valley: 0,
  mouths: 0.4,
  arches: 0.2,
  hoodoos: 0,
  hoodooCap: 1,
  boulders: 0.002,
  scree: 0.6,
  ivy: 0,
  reeds: 0,
  flowers: 0,
  logs: 0,
  ruins: 0.5,
  bridge: 0,
  snowline: 0,
};

export const BIOMES: Biome[] = [
  {
    ...COMMON,
    id: "highlands",
    name: "Cliffs over a lake",
    mouths: 0.5,
    arches: 0.3,
    boulders: 0.004,
    scree: 1,
    ivy: 0.5,
    reeds: 0.6,
    flowers: 0.03,
    ruins: 0.9,
    scarp: 170,
    river: 1,
    glowworms: 0.5,
    base: 540,
    amp: 170,
    detail: 0.3,
    terrace: 0.7,
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
    mouths: 0.7,
    ivy: 0.3,
    reeds: 0.3,
    flowers: 0.015,
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
    arches: 1,
    hoodoos: 1,
    boulders: 0.003,
    scree: 1,
    reeds: 0.3,
    ruins: 0.7,
    bridge: 1,
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
    glowworms: 0.2,
    spikes: 0.5,
    crystals: 0.15,
    fossils: 1,
  },
  {
    ...COMMON,
    id: "forest",
    name: "River forest",
    arches: 0.1,
    scree: 0.4,
    ivy: 0.8,
    reeds: 1,
    flowers: 0.05,
    logs: 0.004,
    ruins: 0.6,
    base: 610,
    amp: 75,
    detail: 0.3,
    terrace: 0.15,
    terraceStep: 30,
    basin: 1,
    basinW: 0.06,
    basinDepth: 50,
    river: 1,
    valley: 80,
    glowworms: 1,
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
    boulders: 0.005,
    scree: 1,
    ruins: 0.4,
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
    glowworms: 0.2,
    spikes: 0.9,
    crystals: 0.4,
    ice: 1,
    snowline: 2000,
  },
  {
    ...COMMON,
    id: "basalt",
    name: "Basalt fields",
    arches: 0.3,
    hoodoos: 0.6,
    hoodooCap: 0,
    boulders: 0.003,
    scree: 0.8,
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
export type Params = Record<Exclude<keyof Biome, "id" | "name">, number>;
/** Parameters that blend across an edge; the rest (materials, basins) belong to one side. */
const NUMERIC = (Object.keys(BIOMES[0]) as (keyof Biome)[]).filter(
  (k) =>
    ![
      "id",
      "name",
      "top",
      "sub",
      "basinLiquid",
      "river",
      "scarp",
      "valley",
    ].includes(k),
) as (keyof Params)[];

/** Parameters a column's biome decides (the rest come from its climate zone's look). */
/** Each land biome's species, parsed once. */
const MIXES = LAND.map((b) => ({
  trees: mixOf(b.trees),
  bushes: mixOf(b.bushes),
  cacti: mixOf(b.cactusKinds),
}));

/** Grass where no land biome is (under water, at the shore). */
const DEFAULT_GRASS = { tufts: 0.3, tall: 3 };

const SURFACE_KEYS = [
  "pines",
  "broad",
  "giants",
  "shrubs",
  "cacti",
  "dead",
  "logs",
  "shrooms",
  "flowers",
  "reeds",
  "ivy",
  "boulders",
  "scree",
  "hoodoos",
  "hoodooCap",
  "mouths",
  "dunes",
  "soil",
] as const;

/** Scratch for look weights. */
const LW = new Float32Array(6);

/** The look (an index into BIOMES) that carries most weight across region r. */
export function regionBiome(seed: number, r: number): number {
  const sum = new Float32Array(6);
  for (let x = r * REGION_W + 32; x < (r + 1) * REGION_W; x += 64) {
    looksAt(seed, x, LW);
    for (let k = 0; k < 6; k++) sum[k] += LW[k];
  }
  let best = 0;
  for (let k = 1; k < 6; k++) if (sum[k] > sum[best]) best = k;
  return best;
}

/** Look parameters at world column x, blended by the world's biomes there. */
export function paramsAt(seed: number, x: number) {
  const w = looksAt(seed, x, LW),
    p = {} as Params;
  for (const k of NUMERIC) {
    let v = 0;
    for (let b = 0; b < 6; b++) v += w[b] * (BIOMES[b][k] as number);
    p[k] = v;
  }
  const r = Math.floor(x / REGION_W);
  return { p, t: 0, left: r, right: r, past: 0 };
}

/** Only the named parameters, blended: cheaper than paramsAt when called often. */
const CAVERN_KEYS = ["cavern", "cavernX", "cavernY"] as const;
function blendOf<K extends keyof Params>(
  seed: number,
  x: number,
  keys: readonly K[],
) {
  const w = looksAt(seed, x, LW),
    p = {} as Pick<Params, K>;
  for (const k of keys) {
    let v = 0;
    for (let b = 0; b < 6; b++) v += w[b] * (BIOMES[b][k] as number);
    p[k] = v as Params[K];
  }
  return p;
}

/** Which look a surface column takes: the strongest, or in mixed country patches of the two strongest. */
function columnBiome(seed: number, x: number) {
  const w = looksAt(seed, x, LW);
  let a = 0,
    b = -1;
  for (let k = 1; k < 6; k++)
    if (w[k] > w[a]) [a, b] = [k, a];
    else if (b < 0 || w[k] > w[b]) b = k;
  if (b < 0 || w[b] < 0.05) return a;
  return noise1(x / 35, seed + 42) < w[b] / (w[a] + w[b]) ? b : a;
}

export interface Basin {
  c: number;
  w: number;
  depth: number;
  steep: number;
  fill: number;
  liquid: number;
}

/** The old per-region basins are gone: the world's own water stands where it lies. */
export function basinOf(seed: number, r: number): Basin | null {
  void seed;
  void r;
  return null;
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
  return Math.max(40, Math.min(WORLD_H - 60, groundRow(seed, x)));
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

/** How readily each rock kind (history.ts ROCK) opens into caves: water dissolves limestone and salt, lava leaves tubes in basalt, granite stays shut. */
const SOLUBLE = [
  -1.6, -1.6, 0.3, -0.3, 1.6, -0.8, -0.2, -0.8, -0.5, 0, -0.6, -0.3, -0.8, 1.0,
];

/** Cavern openness at a world point: positive inside a cavern. */
function cavernAt(
  seed: number,
  wx: number,
  y: number,
  p: Pick<Params, "cavern" | "cavernX" | "cavernY">,
  g: number,
  bias = 0,
) {
  const depth = y - g,
    thr = 0.77 - 0.2 * p.cavern,
    // Wide, low pockets; a few more of them deeper down.
    deepen = 0.05 * smoothstep(150, 700, depth),
    o =
      (fbm2(wx / p.cavernX, y / p.cavernY, seed + 100, 3) - thr + deepen) * 14 +
      bias,
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
      p = blendOf(seed, wx, CAVERN_KEYS),
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
  for (let i = 0; i < n; i++) {
    const cx = q * REGION_W + REGION_W * (0.12 + 0.76 * R()),
      g = groundAt(seed, cx),
      bottom = g + 120 + R() * 240,
      hw = 4 + R() * 6;
    // Not under the sea, a lake or a river: the water would pour down the shaft.
    if (waterAt(seed, cx - 40) || waterAt(seed, cx) || waterAt(seed, cx + 40))
      continue;
    out.push({ cx, top: g - 6, bottom, hw });
  }
  return out;
}

/** Generate one region. */
export function generateRegion(seed: number, r: number): Region {
  const t0 = performance.now();
  const w = generateWindow(seed, r * REGION_W, REGION_W);
  const water = waterAt(seed, r * REGION_W + REGION_W / 2),
    lake =
      water && water.kind === "lake" ? Math.round(SEA_ROW - water.level) : -1;
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

  // 1. The ground and the look parameters for every column, and the world's
  // rock under it.
  // Each column's biome (biomes.ts; -1 under water) sets what grows and
  // stands on the land; the climate zone's look still sets the caves.
  const ground = new Float64Array(WW + 4),
    params: Params[] = [],
    rock: RockColumn[] = [],
    bio = new Int16Array(WW),
    cone = new Int16Array(WW),
    flora = new Uint8Array(WW * H),
    // Crafted sprites' shades (art.ts), and the forest standing behind the
    // land (forest.ts): (layer << 3) | tone, and its palette.
    tone = new Uint8Array(WW * H),
    back = new Uint8Array(WW * H),
    backPal = new Uint8Array(WW * H);
  for (let i = 0; i < WW + 4; i++) ground[i] = groundAt(seed, X0 + i - 2);
  for (let x = 0; x < WW; x++) {
    const p = paramsAt(seed, X0 + x).p,
      b = (bio[x] = placeAt(seed, X0 + x).biome);
    if (b >= 0) for (const k of SURFACE_KEYS) p[k] = LAND[b][k];
    params.push(p);
    rock.push(rockAt(seed, X0 + x));
    // A volcano's cone is its own: built of lava and ash, not the beds below.
    const lf = landformAt(worldOf(seed), seed, X0 + x);
    cone[x] = lf.form === LANDFORM.VOLCANO ? Math.max(0, Math.round(lf.L)) : 0;
  }
  const surface = new Int16Array(WW);
  for (let x = 0; x < WW; x++) surface[x] = Math.round(ground[x + 2]);

  // 2. Rock in the world's beds. A cell's state holds the rock's kind in its
  // band bits (the renderer colours rock by it) and the column's look in its
  // biome bits (cave life takes its colours from that).
  const colBiome = new Uint8Array(WW),
    coneRef = new Float32Array(WW);
  for (let x = 0; x < WW; x++) {
    let sum = 0,
      n = 0;
    for (let k = Math.max(0, x - 12); k <= Math.min(WW - 1, x + 12); k++) {
      sum += surface[k];
      n++;
    }
    coneRef[x] = sum / n;
  }
  for (let x = 0; x < WW; x++) {
    const wx = X0 + x,
      p = params[x],
      s = surface[x],
      slope = Math.abs(ground[x + 4] - ground[x]),
      cb = (colBiome[x] = columnBiome(seed, wx)),
      // The upper cone of a volcano is bare cinder and ash.
      cover =
        cone[x] > 60
          ? { top: M.ASH, sub: M.ASH }
          : bio[x] >= 0
            ? coverOf(LAND[bio[x]])
            : BIOMES[cb],
      tint = bio[x] + 1,
      col = rock[x],
      water = waterAt(seed, wx),
      // Under water the bed is gravel and sand, not grass.
      bed = water !== null && Math.round(SEA_ROW - water.level) < s,
      // Dunes are heaps of sand on the ground, so they are sand all through.
      // Soil thins on steep ground and high up, where peaks stand bare.
      soil = Math.round(
        p.soil *
          Math.max(0, 1 - slope / 10) *
          (1 - 0.85 * smoothstep(420, 720, SEA_ROW - s)) +
          duneAt(seed, wx, p.dunes),
      ),
      // Snow lies all over in the hard cold and in drifts and patches where
      // it is only just freezing.
      cold = warmthAt(seed, wx, s),
      // How much snow lies here, 0..1: all of it in the hard cold; in
      // patches where it is only just freezing, thinning out at their edges.
      snowAmt = bed || cold >= -1
        ? 0
        : cold < -10
          ? 1
          : Math.min(1, Math.max(0, (0.3 + (-1 - cold) / 30 - fbm1(wx / 140, seed + 545, 3)) / 0.2)),
      snowy = snowAmt > 0,
      bedrock = H - 22 - Math.floor(10 * fbm1(wx / 40, seed + 9)),
      // Snow lies thick enough to read from across a room, deeper in the
      // hard cold; turf is a few cells deep where grass or moss grows.
      snowDepth = Math.max(
        1,
        Math.round(snowAmt * (4 + 4 * fbm1(wx / 40, seed + 546, 2) + (cold < -10 ? 2 : 0))),
      ),
      turf =
        cover.top === M.GRASS || cover.top === M.MOSS
          ? 2 + Math.round(fbm1(wx / 30, seed + 547, 2))
          : 1,
      // Glaciers: ice caps lie thick on all but the steepest ground, and in
      // the hard cold elsewhere ice fills the flatter ground; a skin of snow
      // on top, crevasses cut down into it.
      zoneHere = bio[x] >= 0 ? LAND[bio[x]].zone : -1,
      iceT = bed
        ? 0
        : zoneHere === ZONE.ICE && slope < 8
          ? Math.round(16 + 26 * fbm1(wx / 260, seed + 548, 2))
          : cold < -6 && slope < 4
            ? Math.round(Math.min(22, (-6 - cold) * 3) * (0.5 + fbm1(wx / 200, seed + 549, 2)))
            : 0,
      crevasse =
        iceT > 10 && hash3(Math.floor(wx / 2), 44, seed) < 0.05
          ? 6 + Math.floor(hash3(Math.floor(wx / 2), 45, seed) * Math.min(14, iceT - 4))
          : 0;
    // Rock is worked out a little above the ground too, so rock raised on the
    // land (spires, boulders, arches) shows the same beds.
    let k = col.kinds.length - 1;
    for (let y = Math.max(0, s - 110); y < H; y++) {
      const i = y * WW + x,
        z = SEA_ROW - y;
      while (k > 0 && z <= col.tops[k - 1]) k--;
      state[i] = stateOf(
        k >= 0 && z > col.b ? col.kinds[k] : KIND.BASEMENT,
        cb,
      );
      const depth = y - s;
      if (depth < 0) continue;
      // Inside a volcano's cone: layers of lava and ash lying parallel to
      // its slopes (the cone's smoothed surface, not every bump on it).
      if (depth < cone[x] && depth >= 3)
        state[i] = stateOf(
          Math.floor((y - coneRef[x] + 5 * fbm1(wx / 50, seed + 551, 2)) / 9) % 3 === 0
            ? KIND.ASH
            : KIND.BASALT,
          cb,
        );
      if (y >= bedrock) cells[i] = M.BEDROCK;
      else if (iceT > 0 && depth < iceT) {
        cells[i] =
          depth < 2 ? M.SNOW : crevasse && depth >= 2 && depth < 2 + crevasse ? M.AIR : M.ICE;
      } else if (depth === 0) {
        cells[i] = bed
          ? M.GRAVEL
          : snowy
            ? M.SNOW
            : soil > 0
              ? cover.top
              : M.ROCK;
        if (!bed) flora[i] = tint;
      } else if (snowy && depth < snowDepth) cells[i] = M.SNOW;
      else if (depth < soil && !bed) {
        cells[i] = depth < turf ? cover.top : cover.sub;
        flora[i] = tint;
      } else cells[i] = M.ROCK;
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
      // Caves open most readily in limestone, least in granite.
      let o = cavernAt(
        seed,
        wx,
        y,
        p,
        g,
        SOLUBLE[kindAt(rock[lx], SEA_ROW - y)],
      );
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
  // Small pockets and stubs are filled back in: caves come as caverns, not crumbs.
  tidy(cells, before, WW, H, Math.max(0, top), 1400, 90);
  const win: Win = {
    seed,
    cells,
    state,
    WW,
    X0,
    surface,
    ground,
    params,
    colBiome,
    bio,
    flora,
  };
  carveSurface(win);

  // 4. The sea, lakes and rivers where the world has them: water stands from
  // its level down to the ground, on a sealed bed of sand and gravel; then
  // pools and lava in hollows.
  for (let x = 0; x < WW; x++) {
    const wx = X0 + x,
      water = waterAt(seed, wx);
    if (!water) continue;
    const level = Math.round(SEA_ROW - water.level);
    if (surface[x] <= level) continue; // dry land above the waterline
    for (let y = Math.max(0, level); y < surface[x]; y++)
      if (cells[y * WW + x] === M.AIR) cells[y * WW + x] = M.WATER;
    const shore = surface[x] - level < 8;
    for (let y = surface[x]; y < Math.min(H, surface[x] + 12); y++) {
      const i = y * WW + x;
      if (cells[i] === M.BEDROCK) break;
      if (y < surface[x] + 4 || cells[i] === M.AIR)
        cells[i] = shore ? M.SAND : M.GRAVEL;
    }
  }
  sealWater(cells, WW, H);
  fillHollows(cells, WW, H, X0, seed, params, surface);
  springs(cells, WW, H, X0, seed, surface);
  volcanoes(cells, state, WW, H, X0, seed, surface, colBiome);
  // Where it is cold, lakes and seas carry a thick sheet of ice under drifts
  // of snow, and cave pools freeze, until the rock grows warm with depth.
  for (let x = 0; x < WW; x++) {
    if (warmthAt(seed, X0 + x, surface[x]) > -3) continue;
    const wx = X0 + x,
      sheet = 8 + Math.floor(8 * noise1(wx / 60, seed + 95));
    let run = 0;
    for (let y = 0; y < H; y++) {
      const i = y * WW + x;
      if (cells[i] !== M.WATER) {
        run = 0;
        continue;
      }
      run++;
      const lake = y < surface[x];
      if (lake ? run <= sheet : y - surface[x] < 480) cells[i] = M.ICE;
      if (lake && run === 1 && noise1(wx / 25, seed + 96) > 0.45) {
        const drift = 1 + Math.floor(3 * noise1(wx / 11, seed + 97));
        for (let k = 1; k <= drift; k++) put(cells, WW, x, y - k, M.SNOW);
      }
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

  // Rock shapes, ivy, reeds, ruins and bridges on the land.
  raiseSurface(win);

  // 5. Life on the surface: decided per world column, mixed by the blended
  // densities. Plants carry their column's biome, which sets their colours.
  // The crafted forests first (they stand in front of anything planted
  // after), then everything else, column by column.
  plantForests({
    seed,
    X0,
    WW,
    H,
    cells,
    state,
    flora,
    tone,
    back,
    backPal,
    surface,
    bio,
    colBiome,
    mark: (i, cb) => {
      state[i] = stateOf(0, cb);
    },
  });
  stamp = state;
  floraStamp = flora;
  for (let x = 0; x < WW; x++) {
    const wx = X0 + x,
      p = params[x],
      s = surface[x],
      si = s * WW + x,
      top = cells[si];
    if (bio[x] >= 0 && isForest(bio[x])) continue;
    if (top === M.AIR || top === M.WATER || top === M.LAVA || top === M.ICE)
      continue;
    if (cells[si - WW] !== M.AIR) continue;
    // Nothing grows on a volcano's bare upper cone or on a glacier.
    if ((top === M.ASH && cone[x] > 60) || (top === M.SNOW && cells[si + 2 * WW] === M.ICE)) continue;
    stampBiome = colBiome[x];
    stampFlora = bio[x] + 1;
    const grass = bio[x] >= 0 ? LAND[bio[x]] : DEFAULT_GRASS;
    const slope = Math.abs(
        ground[Math.min(WW + 3, x + 5)] - ground[Math.max(0, x - 1)],
      ),
      R = walkRandom(Math.floor(hash3(wx, 32, seed) * 4294967296));
    // Trees gather in groves with clearings between.
    const trees = 0.25 + 1.5 * smoothstep(0.35, 0.65, grove(seed, wx));
    // Stones lie scattered on gravel: a pebble or two, now and then a cobble.
    if (top === M.GRAVEL && hash3(wx, 38, seed) < 0.12) {
      const big = hash3(wx, 39, seed) < 0.25;
      put(cells, WW, x, s - 1, M.ROCK);
      if (big) {
        put(cells, WW, x + 1, s - 1, M.ROCK);
        put(cells, WW, x, s - 2, M.ROCK);
      }
      continue;
    }
    let h = hash3(wx, 31, seed);
    const mix = bio[x] >= 0 ? MIXES[bio[x]] : null,
      // A species from the biome's mix, drawn in its own colours if it has them.
      grow = (list: { id: number; w: number }[], salt: number) => {
        const id = pick(list, hash3(wx, salt, seed)),
          spc = SPECIES[id];
        if (slope >= spc.slope) return;
        // (Only species with leaves of their own; the rest take the biome's.)
        if (spc.leaf) stampFlora = LAND.length + 1 + id;
        spc.shape(grower, x, s, top === M.SNOW);
        stampFlora = bio[x] + 1;
      },
      grower: Grow = { put: (px, py, m) => put(cells, WW, px, py, m), R };
    if (mix && mix.trees.length) {
      if ((h -= (p.pines + p.giants + p.broad) * trees) < 0) {
        grow(mix.trees, 35);
        continue;
      }
    } else if (slope < 6 && (h -= p.pines * trees) < 0) {
      pine(cells, WW, x, s, R, top === M.SNOW);
      continue;
    } else if (slope < 4 && (h -= p.giants * trees) < 0) {
      giantTree(cells, WW, x, s, R, wx, seed);
      continue;
    } else if (slope < 5 && (h -= p.broad * trees) < 0) {
      broadTree(cells, WW, x, s, R, wx, seed);
      continue;
    }
    if (slope < 4 && (h -= p.shrooms) < 0) toadstool(cells, WW, x, s, R);
    else if (slope < 6 && (h -= p.cacti) < 0) {
      if (mix && mix.cacti.length) grow(mix.cacti, 36);
      else cactus(cells, WW, x, s, R);
    } else if (slope < 8 && (h -= p.dead) < 0) deadTree(cells, WW, x, s, R);
    else if ((h -= p.shrubs * (0.5 + 0.5 * trees)) < 0) {
      if (mix && mix.bushes.length) grow(mix.bushes, 37);
      else shrub(cells, WW, x, s, R);
    } else if (slope < 2 && (h -= p.logs * trees) < 0)
      fallenLog(cells, WW, x, s, R, ground);
    else if (top === M.GRASS && (h -= p.flowers * (1.6 - 0.6 * trees)) < 0) {
      // Flowers in the clearings, on stems as tall as the grass, some in pairs.
      const stem = Math.floor(R() * (1 + 0.6 * grass.tall));
      for (let k = 1; k <= stem; k++) put(cells, WW, x, s - k, M.GRASS);
      put(cells, WW, x, s - stem - 1, M.FLOWER);
      if (R() < 0.4) put(cells, WW, x + 1, s - stem - 1, M.FLOWER);
    } else if (top === M.GRASS && hash3(wx, 33, seed) < grass.tufts) {
      // Grass in tussocks: blades rise and fall in clumps along the
      // skyline, the tall ones bending over at the tip, all one way in a
      // stretch (the wind's), as tall as the biome grows them.
      const clump = smoothstep(0.3, 0.7, fbm1(wx / 7, seed + 35, 2)),
        tall = Math.max(1, Math.round(grass.tall * (0.35 + 0.65 * clump) * (0.75 + 0.5 * hash3(wx, 34, seed)))),
        lean = fbm1(wx / 300, seed + 36, 2) < 0.5 ? -1 : 1;
      for (let k = 1; k <= tall; k++)
        put(cells, WW, x + (tall >= 3 && k === tall ? lean : 0), s - k, M.GRASS);
    }
  }
  stamp = null;
  floraStamp = null;

  // Life in the caves, decided per world cell, and changing with depth:
  // roots, moss, small mushrooms and glow-worms near the surface; each biome's
  // own life in the middle depths; ember coral and shelf fungi deep down
  // where the rock is warm. Frozen biomes thaw with depth.
  for (let y = 4; y < H - 30; y++)
    for (let x = 2; x < WW - 2; x++) {
      const i = y * WW + x;
      if (cells[i] !== M.AIR || y <= surface[x] + 6) continue;
      const below = cells[i + WW],
        above = cells[i - WW],
        wx = X0 + x,
        p = params[x],
        d = y - surface[x],
        shallow = 1 - smoothstep(120, 240, d),
        deep = smoothstep(380, 560, d),
        mid = Math.max(0, 1 - shallow - deep),
        cold = p.ice > 0.5 && d < 480,
        stone = cold ? M.ICE : M.ROCK,
        // Crystals grow in veins: a few caves glitter, most have none.
        vein = smoothstep(0.64, 0.8, noise2(wx / 160, y / 160, seed + 71));
      if (
        below === M.ROCK ||
        below === M.SOIL ||
        below === M.GRAVEL ||
        below === M.SAND
      ) {
        const zone = noise2(wx / 40, y / 40, seed + 60);
        if (
          zone < 0.2 + 0.5 * p.fungus * (1 - deep) &&
          below !== M.SAND &&
          !cold
        )
          cells[i + WW] = M.MOSS;
        let t = hash3(wx, y, seed + 62);
        if ((t -= 0.03 * p.fungus * mid) < 0) {
          cells[i] = M.CAP;
          state[i] |= GLOW;
          if (hash3(wx, y, seed + 66) < 0.5 && cells[i - WW] === M.AIR) {
            cells[i - WW] = M.CAP;
            state[i - WW] |= GLOW;
          }
        } else if (!cold && (t -= 0.02 * (0.3 + p.fungus) * shallow) < 0)
          smallShroom(cells, WW, x, y, wx, seed);
        else if ((t -= 0.012 * p.fungus * mid) < 0)
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
        else if ((t -= 0.035 * deep * p.fungus) < 0)
          coral(cells, state, WW, x, y, wx, seed);
        else if ((t -= 0.012 * p.spikes) < 0)
          spike(
            cells,
            state,
            WW,
            x,
            y,
            -1,
            3 + Math.floor(hash3(wx, y, seed + 64) * 12),
            stone,
          );
        else if ((t -= 0.006 * p.crystals * vein * (0.4 + deep)) < 0)
          crystals(cells, state, WW, x, y, -1, wx, seed);
      } else if (above === M.ROCK || above === M.SOIL || above === M.SAND) {
        let t = hash3(wx, y, seed + 65);
        if ((t -= 0.2 * p.roots * shallow) < 0) root(cells, WW, x, y, wx, seed);
        else if (
          (t -=
            0.12 *
            p.vines *
            mid *
            smoothstep(0.42, 0.72, noise2(wx / 45, y / 45, seed + 69))) < 0
        )
          vine(cells, state, WW, x, y, wx, seed);
        else if (
          (t -=
            0.1 *
            p.glowworms *
            (mid + 0.5 * shallow) *
            smoothstep(0.5, 0.75, noise2(wx / 30, y / 30, seed + 70))) < 0
        )
          glowworm(cells, state, WW, x, y, wx, seed);
        else if ((t -= 0.03 * p.spikes) < 0)
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
            stone,
          );
        else if ((t -= 0.006 * p.crystals * vein * (0.4 + deep)) < 0)
          crystals(cells, state, WW, x, y, 1, wx, seed);
      } else if (
        deep > 0 &&
        (cells[i - 1] === M.ROCK || cells[i + 1] === M.ROCK) &&
        // Rare, in clusters, and only on the walls of roomy caves (open space
        // well out from the wall), never lining narrow shafts.
        cells[i + (cells[i - 1] === M.ROCK ? 8 : -8)] === M.AIR &&
        hash3(wx, y, seed + 85) <
          0.008 *
            deep *
            p.fungus *
            smoothstep(0.55, 0.75, noise2(wx / 90, y / 90, seed + 86))
      )
        shelf(
          cells,
          state,
          WW,
          x,
          y,
          cells[i - 1] === M.ROCK ? 1 : -1,
          wx,
          seed,
        );
    }

  // Cut the region out of the window.
  const outCells = new Uint8Array(width * H),
    outState = new Uint8Array(width * H),
    outFlora = new Uint8Array(width * H),
    outTone = new Uint8Array(width * H),
    outBack = new Uint8Array(width * H),
    outBackPal = new Uint8Array(width * H);
  for (let y = 0; y < H; y++) {
    const a = y * WW + MARGIN,
      b = a + width;
    outTone.set(tone.subarray(a, b), y * width);
    outBack.set(back.subarray(a, b), y * width);
    outBackPal.set(backPal.subarray(a, b), y * width);
    outFlora.set(
      flora.subarray(y * WW + MARGIN, y * WW + MARGIN + width),
      y * width,
    );
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
    /** Per cell: 1 + the biome (biomes.ts) of the plant or ground cover there, or 0. */
    flora: outFlora,
    /** Per cell: a crafted sprite's shade (1-6), or 0. */
    tone: outTone,
    /** Per cell: the forest behind the land, (layer << 3) | shade, or 0; and its palette. */
    back: outBack,
    backPal: outBackPal,
    surface: surface.slice(MARGIN, MARGIN + width),
  };
}

/**
 * Pools and lava fill hollows a row at a time from the bottom up: a run of air
 * between two walls becomes liquid when everything under it is solid or the
 * same liquid. Pools start only in wet stretches of rock and stop at a depth
 * that varies along the land, so they never stand as walls of water.
 */
/**
 * Volcanoes: an active one holds a lava lake in its crater and sends a
 * glowing flow down one flank; a dormant one has an old black flow there
 * and, where it rains enough, a crater lake. Worked out from the world
 * (crater rims from the ground itself), so every window agrees.
 */
function volcanoes(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  H: number,
  X0: number,
  seed: number,
  surface: Int16Array,
  colBiome: Uint8Array,
) {
  const w = worldOf(seed),
    seen = new Set<number>();
  for (let x = 0; x < WW; x += 32) {
    const v = volcanoAt(w, seed, X0 + x);
    if (!v || seen.has(Math.round(v.cx))) continue;
    seen.add(Math.round(v.cx));
    // The crater's rims: the highest ground either side of its centre.
    const crest = (d: number) => {
      let at = Math.round(v.cx),
        best = groundRow(seed, at);
      for (let k = 1; k <= v.half * 1.8; k++) {
        const r = groundRow(seed, Math.round(v.cx) + d * k);
        if (r < best) {
          best = r;
          at = Math.round(v.cx) + d * k;
        }
      }
      return { at, row: best };
    };
    const L = crest(-1),
      R = crest(1),
      lo = L.at,
      hi = R.at;
    if (hi < X0 || lo >= X0 + WW) continue;
    // The crater fills to a little under its lower rim, between the rims only.
    const rim = Math.max(L.row, R.row) + 2,
      wet = rainAt(seed, v.cx) > 550,
      fill = v.active ? M.LAVA : wet ? (warmthAt(seed, v.cx, rim) > 0 ? M.WATER : M.ICE) : -1;
    if (fill >= 0)
      for (let wx = lo; wx <= hi; wx++) {
        const lx = wx - X0;
        if (lx < 0 || lx >= WW) continue;
        for (let y = Math.ceil(rim); y < surface[lx] && y < H; y++)
          if (cells[y * WW + lx] === M.AIR) cells[y * WW + lx] = fill;
      }
    // A flow from the rim down one flank, half the way to the foot: glowing
    // lava on an active volcano, black basalt on a dormant one.
    const from = v.cx + v.side * v.half * 1.1,
      len = v.r * 0.5;
    for (let k = 0; k < len; k++) {
      const wx = Math.round(from + v.side * k),
        lx = wx - X0;
      if (lx < 1 || lx >= WW - 1) continue;
      // Thick near the rim, thinning toward its snout, in lobes.
      const thick = Math.max(1, Math.round((1 - k / len) * 4 + 1.5 * fbm1(wx / 25, seed + 552, 2))),
        s0 = surface[lx];
      for (let d = 1; d <= thick; d++) {
        const i = (s0 - d) * WW + lx;
        if (s0 - d < 0 || cells[i] !== M.AIR) continue;
        if (v.active && k < len * 0.75) cells[i] = M.LAVA;
        else {
          cells[i] = M.ROCK;
          state[i] = stateOf(KIND.BASALT, colBiome[lx]);
        }
      }
    }
  }
}

/**
 * Waterfalls: in wet country, rain soaked into a big massif comes out as a
 * spring from a dark mouth in a cliff face, a few rows under its lip, falls
 * down the face into a pool at its foot, and runs on as a stream downhill
 * until it reaches a river, lake or the sea, or ends in a pond. Decided per
 * stretch of 160 world columns from the world's ground (not the window's),
 * so every window agrees.
 */
function springs(
  cells: Uint8Array,
  WW: number,
  H: number,
  X0: number,
  seed: number,
  surface: Int16Array,
) {
  const gr = (wx: number) => Math.round(groundAt(seed, wx)),
    STEP = 240;
  for (let b = Math.floor((X0 - 900) / STEP); b <= Math.floor((X0 + WW + 900) / STEP); b++) {
    const P = rainAt(seed, b * STEP),
      chance = Math.min(0.3, Math.max(0, (P - 700) / 1200));
    if (hash3(b, 41, seed) >= chance) continue;
    // The first tall drop in the stretch, either way.
    let lip = 0,
      dir = 0;
    for (let wx = b * STEP; wx < (b + 1) * STEP && !dir; wx += 2)
      for (const d of [1, -1])
        if (gr(wx + 6 * d) - gr(wx) >= 30) {
          lip = wx;
          dir = d;
          break;
        }
    if (!dir) continue;
    // Back to the real lip of the cliff.
    while (gr(lip - dir) < gr(lip) - 2) lip -= dir;
    const s0 = gr(lip);
    if (warmthAt(seed, lip, s0) < 1) continue;
    // Only out of a massif that can hold water: wide ground behind the lip.
    let wide = 0;
    for (let k = 4; k <= 160; k += 4) if (Math.abs(gr(lip - k * dir) - s0) < 60) wide++;
    if (wide < 20) continue;
    // The spring's mouth: a few rows under the lip, where the face is.
    const my = s0 + 6 + Math.floor(hash3(b, 42, seed) * 6);
    let face = lip;
    while (gr(face + dir) <= my && Math.abs(face - lip) < 30) face += dir;
    const foot = (wx: number) => gr(wx);
    // Tall enough below the mouth (the face may come down in steps).
    let drop = 0;
    for (let k = 1; k <= 14; k++) drop = Math.max(drop, foot(face + k * dir) - my);
    if (drop < 20) continue;
    const put2 = (wx: number, y: number, m: number, onlyAir = true) => {
      const lx = wx - X0;
      if (lx < 0 || lx >= WW || y < 0 || y >= H) return;
      const i = y * WW + lx;
      if (cells[i] === M.BEDROCK) return;
      if (!onlyAir || cells[i] === M.AIR) cells[i] = m;
    };
    // The mouth: a dark oval opening driven into the face, its floor
    // running with water.
    const mx = face - 4 * dir;
    for (let dy = -7; dy <= 0; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const e = (dx * dx) / 36 + ((dy + 3.5) * (dy + 3.5)) / 16;
        if (e > 1 || (dir > 0 ? mx + dx > face : mx + dx < face)) continue;
        put2(mx + dx, my + dy, dy === 0 ? M.STREAM : M.AIR, false);
      }
    for (let k = 0; k <= 9; k++) put2(face - k * dir, my, M.STREAM, false);
    // Down the face, five cells wide, stepping out as the face steps.
    // In tiers: every 22-34 rows a ledge juts out under the water, it
    // splashes there and spills off the ledge's end to fall again.
    let c = face + dir,
      y = my,
      tier = 0,
      next = 22 + Math.floor(hash3(b, 44, seed) * 12);
    for (let step = 0; step < 24; step++) {
      const f = foot(c);
      for (; y < f && y < H - 30; y++) {
        for (let k = 0; k < 5; k++) put2(c + k * dir, y, M.FALLS);
        if (++tier >= next && f - y > 20) {
          for (let k = 0; k < 6; k++) put2(c + k * dir, y + 1, M.ROCK, false);
          c += 5 * dir;
          y += 1;
          tier = 0;
          next = 22 + Math.floor(hash3(b, 45 + step, seed) * 12);
          break;
        }
      }
      if (y >= foot(c) && foot(c + dir) - foot(c) <= 2) break;
      if (y >= foot(c)) c += dir;
    }
    // Where it lands: a plunge pool dug into the ground, a little spray.
    const land = c + 2 * dir,
      base = foot(land);
    for (let k = -1; k <= 5; k++)
      for (let d = 0; d < 3; d++) {
        const pc = land + k * dir;
        if (Math.abs(foot(pc) - base) > 1) continue;
        put2(pc, foot(pc) + d, d === 0 && k <= 1 ? M.FALLS : M.WATER, false);
      }
    // On downhill as a stream, until it meets water or the ground rises.
    let cur = land + 6 * dir;
    for (let n = 0; n < 700; n++, cur += dir) {
      if (waterAt(seed, cur)) break;
      const here = foot(cur),
        next = foot(cur + dir);
      put2(cur, here, M.STREAM, false);
      put2(cur, here + 1, M.GRAVEL, false);
      if (next < here - 1) {
        // The ground rises: it ends in a pond.
        for (let k = -4; k <= 0; k++)
          for (let d = 0; d < 3; d++)
            if (Math.abs(foot(cur + k * dir) - here) <= 1) put2(cur + k * dir, foot(cur + k * dir) + d, M.WATER, false);
        break;
      }
    }
  }
}

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
            noise2(wx / 260, y / 200, seed + 400) < (lava ? 0.35 : p.wet)
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
/** Water may stand only on something: any air beside or under it fills with sand. */
function sealWater(cells: Uint8Array, WW: number, H: number) {
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let y = 1; y < H - 1; y++)
      for (let x = 0; x < WW; x++) {
        const i = y * WW + x;
        if (cells[i] !== M.WATER) continue;
        for (const j of [x > 0 ? i - 1 : -1, x < WW - 1 ? i + 1 : -1, i + WW])
          if (j >= 0 && cells[j] === M.AIR) {
            cells[j] = M.SAND;
            changed = true;
          }
      }
    if (!changed) break;
  }
}

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
      for (let s = 0; s < 4; s++) {
        const k =
          s === 0
            ? x > 0
              ? j - 1
              : -1
            : s === 1
              ? x < WW - 1
                ? j + 1
                : -1
              : s === 2
                ? j - WW >= yTop * WW
                  ? j - WW
                  : -1
                : j + WW < WW * H
                  ? j + WW
                  : -1;
        if (k >= 0 && !seen[k] && (cells[k] === M.AIR) === air) {
          seen[k] = 1;
          stack[sp++] = k;
        }
      }
    }
    if (n < limit && !side)
      for (let k = 0; k < n; k++)
        cells[comp[k]] = air ? before[comp[k]] : M.AIR;
  }
}

/** While surface plants are placed, the arrays to mark them with their look and biome. */
let stamp: Uint8Array | null = null,
  stampBiome = 0,
  floraStamp: Uint8Array | null = null,
  stampFlora = 0;
function mark(i: number) {
  if (stamp) stamp[i] = stateOf(0, stampBiome);
  if (floraStamp) floraStamp[i] = stampFlora;
}

function put(cells: Uint8Array, WW: number, x: number, y: number, m: number) {
  if (x < 0 || x >= WW || y < 0 || y >= WORLD_H) return false;
  const i = y * WW + x;
  if (cells[i] !== M.AIR) return false;
  cells[i] = m;
  mark(i);
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
          mark(i);
        }
      for (let r = 0; r < ch; r++) {
        const f = (ch - r) / ch,
          half = Math.floor(cap * Math.sqrt(1 - f * f * f));
        for (let dx = -half; dx <= half; dx++) {
          const i = (top - ch + r) * WW + x + dx;
          if (cells[i] !== M.AIR) continue;
          cells[i] = M.CAP;
          mark(i);
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
        (k === len - 1 || hash3(xx + wx - x, yy, seed + 83) < 0.3)
      )
        state[yy * WW + xx] |= GLOW;
    }
  }
}

/** A small brown mushroom on the floor at (x, y + 1). */
function smallShroom(
  cells: Uint8Array,
  WW: number,
  x: number,
  y: number,
  wx: number,
  seed: number,
) {
  const tall = 1 + Math.floor(hash3(wx, y, seed + 86) * 3);
  for (let k = 0; k < tall; k++)
    if (!put(cells, WW, x, y - k, M.SHROOM)) return;
  put(cells, WW, x - 1, y - tall + 1, M.SHROOM);
  put(cells, WW, x + 1, y - tall + 1, M.SHROOM);
}

/** Ember coral: a branching growth on warm deep floors, its tips glowing. */
function coral(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  x: number,
  y: number,
  wx: number,
  seed: number,
) {
  // Hash world positions, not window ones, so every window grows the same coral.
  const dx0 = wx - x,
    tall = 6 + Math.floor(hash3(wx, y, seed + 87) * 14);
  const grow = (
    cx: number,
    cy: number,
    len: number,
    lean: number,
    depth: number,
  ) => {
    let px = cx,
      py = cy;
    for (let k = 0; k < len; k++) {
      if (k > 0 && hash3(px + dx0, py, seed + 88) < 0.35) px += lean;
      py--;
      if (!put(cells, WW, px, py, M.CORAL)) return;
      if (depth === 0 && k < len * 0.6 && len > 10)
        put(cells, WW, px + 1, py, M.CORAL);
      if (k === len - 1 || hash3(px + dx0, py, seed + 84) < 0.2)
        state[py * WW + px] |= GLOW;
      if (depth < 2 && k > 1 && hash3(px + dx0, py, seed + 89) < 0.35)
        grow(
          px,
          py,
          Math.max(2, (len - k) >> 1),
          hash3(px + dx0, py, seed + 90) < 0.5 ? -1 : 1,
          depth + 1,
        );
    }
  };
  grow(x, y + 1, tall, hash3(wx, y, seed + 91) < 0.5 ? -1 : 1, 0);
}

/** Shelf fungi: brackets stacked on a cave wall, with glowing rims. */
function shelf(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  x: number,
  y: number,
  dir: number,
  wx: number,
  seed: number,
) {
  const n = 2 + Math.floor(hash3(wx, y, seed + 92) * 4);
  for (let b = 0; b < n; b++) {
    const by = y + b * 3,
      w = 3 + Math.floor(hash3(wx, by, seed + 93) * 6);
    for (let k = 0; k < w; k++) {
      const cx = x + dir * k;
      // Only the bracket's outer tip glows.
      if (put(cells, WW, cx, by, M.SHELF))
        state[by * WW + cx] |= k === w - 1 ? GLOW : 0;
      if (k < w - 2) put(cells, WW, cx, by + 1, M.SHELF);
    }
  }
}

/** A glow-worm thread: a fine strand hanging from the ceiling, a bead of light at its end. */
function glowworm(
  cells: Uint8Array,
  state: Uint8Array,
  WW: number,
  x: number,
  y: number,
  wx: number,
  seed: number,
) {
  const len = 2 + Math.floor(hash3(wx, y, seed + 94) * 9);
  for (let k = 0; k < len; k++) {
    if (!put(cells, WW, x, y + k, M.VINE)) return;
    if (k === len - 1) state[(y + k) * WW + x] |= GLOW;
  }
}

/** A region's landmarks (for tools and, later, the director): basin, lake, cliff, river. */
export function regionFeatures(seed: number, r: number) {
  return {
    biome: BIOMES[regionBiome(seed, r)].id,
    ...surfaceLandmarks(seed, r),
    /** Rivers no longer run along the ground: they cross it, in the world's channels. */
    river: null as { spring: number; outlet: number; falls: number } | null,
  };
}

/**
 * A giant toadstool for the surface: a white stalk and a red dome with pale
 * spots, unlike the glowing parasols of the caves below.
 */
function toadstool(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
) {
  const tall = 10 + Math.floor(R() * 22),
    rad = 5 + Math.floor(R() * 8),
    dome = Math.max(3, Math.round(rad * 0.7)),
    thick = tall > 20 ? 3 : 2,
    top = s - tall;
  for (let k = 1; k <= tall; k++)
    for (let t = 0; t < thick; t++) put(cells, WW, x + t, s - k, M.STALK);
  const cx = x + (thick - 1) / 2;
  for (let dy = 0; dy < dome; dy++) {
    const f = 1 - dy / dome,
      half = Math.round(rad * Math.sqrt(1 - (1 - f) * (1 - f)));
    for (let dx = -half; dx <= half; dx++) {
      const spot = R() < 0.12 && dy > 0 && Math.abs(dx) < half;
      put(
        cells,
        WW,
        Math.round(cx + dx),
        top - dy,
        spot ? M.SPOT : M.TOADSTOOL,
      );
    }
  }
}

/** A fallen log lying on flat ground. */
function fallenLog(
  cells: Uint8Array,
  WW: number,
  x: number,
  s: number,
  R: () => number,
  ground: Float64Array,
) {
  const len = 6 + Math.floor(R() * 9),
    thick = R() < 0.6 ? 2 : 1;
  for (let k = 0; k < len; k++)
    if (Math.abs(ground[Math.min(ground.length - 1, x + k + 2)] - s) > 1)
      return;
  for (let k = 0; k < len; k++)
    for (let t = 1; t <= thick; t++) put(cells, WW, x + k, s - t, M.WOOD);
}
