// The lab's land renderer, shared by regions.ts (stills) and the viewer.
//
// It approximates the chosen look (A, stepped) on the CPU: a dusk sky; dark
// cut-away rock in strata with grain and seams; caves shown as their back
// wall, lit by sky light falling in through openings and by glowing things;
// light stepped into five levels with an ordered dither. It judges the land;
// the real renderer (light on the GPU) comes later.
//
// Everything position-dependent uses world coordinates (x0 + local x), so
// tiles rendered separately line up exactly.
import {
  GLOW,
  M,
  bandOf,
  biomeOf,
  fbm1,
  hash3,
} from "../../engine/strata/world.ts";
import { groundAt } from "../../engine/strata/generate.ts";
import { BIOMES as LAND, GROUND } from "../../engine/strata/biomes.ts";
import { SPECIES } from "../../engine/strata/plants.ts";

const hex = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// Rock by kind (the band bits of a cell's state hold it; history.ts ROCK
// order): basement gneiss, granite, basalt, volcanic ash, limestone, shale,
// sandstone, mudstone, red beds, dune sandstone, coal, conglomerate, glacial
// till, salt.
const KIND = [
  "#5a5468",
  "#a88480",
  "#4a4450",
  "#c4b8a2",
  "#c2bb98",
  "#6e6c80",
  "#c4925c",
  "#8e7a66",
  "#b0583c",
  "#d8b07a",
  "#2c2830",
  "#9a8a76",
  "#9a9ea8",
  "#e2dcd2",
]
  .map(hex)
  // Muted: each rock keeps a hint of its own hue and lightness, so beds read
  // without striping the screen.
  .map((c) => {
    const g = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2],
      v = 0.42 + 0.38 * g;
    return c.map((ch) => (v + 0.32 * (ch - g)) * 0.86);
  });
const rockOf = (st: number) => KIND[bandOf(st) % KIND.length];
/** All rock averaged: a cave's back wall leans to it. */
const KIND_AVG = [0, 1, 2].map(
  (k) => KIND.reduce((s, c) => s + c[k], 0) / KIND.length,
);
/** Each biome's colours for leaves, grass, moss, bark, flowers and bare earth. */
const PAL = LAND.map((b) => {
  const grass = hex(b.grass);
  return {
    leaf: hex(b.leaf),
    grass,
    moss: grass.map((v) => v * 0.8),
    bark: hex(b.bark),
    bloom: hex(b.bloom),
    earth: hex(b.earth),
    salt: b.earth.toLowerCase() === "#e8e2d8",
  };
});
// Then each species with colours of its own (plants.ts): flora value
// LAND.length + 1 + species id.
for (const sp of SPECIES) {
  const base = PAL[0];
  PAL.push({
    ...base,
    leaf: sp.leaf ? hex(sp.leaf) : base.leaf,
    bark: sp.bark ? hex(sp.bark) : base.bark,
    bloom: sp.bloom ? hex(sp.bloom) : base.bloom,
  });
}
/** How each biome's ground weathers its rock (biomes.ts GROUND, by zone). */
const GB = LAND.map((b) => {
  const g = GROUND[b.zone];
  return {
    earth: hex(b.earth),
    weather: g ? g.weather : 12,
    tint: hex(g ? g.tint : "#808080"),
    tintK: g ? g.tintK : 0,
  };
});
/** Ramps (rampOf) for each palette's leaf, grass, bark and bloom, and each rock kind, built on first use. */
const RAMP_CACHE = new Map<number, number[][]>();
function rampFor(pal: number, m: number): number[][] {
  const key = pal * 64 + m;
  let r = RAMP_CACHE.get(key);
  if (r) return r;
  const p = PAL[pal - 1],
    base =
      m === M.WOOD ? p.bark : m === M.GRASS ? p.grass : m === M.FLOWER ? p.bloom : p.leaf;
  r = rampOf(base);
  RAMP_CACHE.set(key, r);
  return r;
}
const ROCK_RAMPS: number[][][] = [];
const rockRamp = (kind: number) => (ROCK_RAMPS[kind] ??= rampOf(KIND[kind % KIND.length].map((v) => Math.min(1, v * 1.25))));
const BACK_HAZE = [hex("#7d98ab"), hex("#a9c0d2")],
  BACKC = [0, 0, 0];
/** The colour of the forest behind the land at a cell (value from Land.back). */
function backColor(v: number, pal: number) {
  const layer = (v >> 3) & 3,
    t = v & 7,
    c = rampFor(pal, v & 32 ? M.WOOD : M.LEAF)[t - 1],
    hz = BACK_HAZE[layer - 1] ?? BACK_HAZE[1],
    k = layer === 1 ? 0.3 : 0.48;
  BACKC[0] = c[0] + (hz[0] - c[0]) * k;
  BACKC[1] = c[1] + (hz[1] - c[1]) * k;
  BACKC[2] = c[2] + (hz[2] - c[2]) * k;
  return BACKC;
}

/** Scratch colour for grass blades. */
const BLADE = [0, 0, 0],
  SEED = hex("#e6d58e");
/**
 * A grass blade's colour: darker at its base, lighter toward its tip, and
 * in tall grass (steppe, prairie, savanna) the tip turns to a pale seed
 * head; each tuft a little different in hue.
 */
function blade(
  pal: { grass: number[] },
  cells: Uint8Array,
  i: number,
  W: number,
  y: number,
  ground: number,
  wx: number,
) {
  const h = ground - y,
    tip = cells[i - W] !== M.GRASS,
    jit = 0.94 + 0.12 * ((grain(wx >> 2, 4242) & 255) / 255),
    k = (h <= 1 ? 0.72 : tip ? 1.14 : 0.92) * jit;
  BLADE[0] = pal.grass[0] * k;
  BLADE[1] = pal.grass[1] * k;
  BLADE[2] = pal.grass[2] * k;
  if (tip && h >= 4)
    for (let c = 0; c < 3; c++) BLADE[c] += (SEED[c] - BLADE[c]) * 0.55;
  return BLADE;
}

/** Scratch colours (no allocation per pixel). */
const WR = [0, 0, 0],
  WR2 = [0, 0, 0],
  LOOSE = [0, 0, 0];

/** Looks (generate.ts BIOMES) that leaves and caps take their colours from. */
const LOOKS = 6;
const SOLID: number[][] = [];
for (const [m, c] of [
  [M.SOIL, "#6b4a34"],
  [M.GRASS, "#6f8f3e"],
  [M.SAND, "#d9a86e"],
  [M.GRAVEL, "#8a8378"],
  [M.SNOW, "#e8eef6"],
  [M.ICE, "#bfe4f0"],
  [M.WOOD, "#5b4330"],
  [M.STALK, "#b7a9c9"],
  [M.CRYSTAL, "#b48cff"],
  [M.BEDROCK, "#1c1a24"],
  [M.MOSS, "#3f6a52"],
  [M.VINE, "#2f6f66"],
  [M.FOSSIL, "#cdbb94"],
  [M.ASH, "#55505a"],
  [M.SHROOM, "#9a7656"],
  [M.CORAL, "#c8583a"],
  [M.SHELF, "#a86ab8"],
  [M.TOADSTOOL, "#a8382e"],
  [M.SPOT, "#e8dccb"],
  [M.ROPE, "#a08458"],
] as [number, string][])
  SOLID[m] = hex(c);
const LEAF = [
  "#2f4a35",
  "#4f6b3a",
  "#5f7d3a",
  "#2f5a2c",
  "#2a4638",
  "#4a4a32",
].map(hex);
const CAP = [
  "#5a4a8a",
  "#3d6f7a",
  "#7a4a5a",
  "#6a5a3a",
  "#4a6a8a",
  "#7a3a2a",
].map(hex);
const VINE_GLOW = hex("#7ff5e6");
const LAVA = [hex("#ff8a3a"), hex("#ffb04a"), hex("#c23e1c"), hex("#8a2416")];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16,
);
/** The day sky, rows above the horizon: pale at the horizon, blue overhead. */
const SKY = [hex("#dce8ef"), hex("#8cbbe3"), hex("#4a7fc2")];
const CYAN = hex("#5ff0e0"),
  VIOLET = hex("#c08cff"),
  WARM = hex("#ffae5a"),
  EMBER = hex("#ff9a6a"),
  SKYL = hex("#fff4e4"),
  AMB = hex("#d0d3dc"),
  WATER = hex("#3f86a8"),
  DEEP = hex("#1d4a6e"),
  BACK_TINT = [0.11, 0.1, 0.18];

const isOpen = (m: number) =>
  m === M.AIR ||
  m === M.WATER ||
  m === M.STREAM ||
  m === M.FALLS ||
  m === M.BACKWALL;
/** Plants and rope: in the open air they take daylight from above and shade under their own leaves. */
const SILHOUETTE = new Uint8Array(64);
for (const m of [
  M.LEAF,
  M.WOOD,
  M.CAP,
  M.STALK,
  M.TOADSTOOL,
  M.SPOT,
  M.VINE,
  M.REED,
  M.ROPE,
  M.SHROOM,
])
  SILHOUETTE[m] = 1;
const BRICK = hex("#8a7f6c"),
  FLOWERS = ["#f2d35a", "#f0ece0", "#e889b0", "#8fb0f0", "#e06a4a"].map(hex),
  REED = [hex("#6f7a3a"), hex("#5a3a22")],
  // Distant hills in the day's blue haze: the farther, the paler.
  HAZE_NEAR = hex("#7d98ab"),
  HAZE_FAR = hex("#a9c0d2"),
  CLOUD_SHADE = hex("#b6c6d6"),
  CLOUD_LIT = hex("#fbfcfd"),
  // Daylight on plants in the open.
  DAY = hex("#fff8ee"),
  // The study look's hill planes, far to near, and the mist they fade into.
  PLANES = ["#c6d6e0", "#a6bccb", "#86a2b3", "#6a8899"].map(hex),
  MIST = hex("#e2ecf1");
const STREAM = ["#4f9ab4", "#cfe9f2", "#e0f4fa"].map(hex),
  FALLS = ["#a8d6ee", "#5f9fca", "#f4fbfd"].map(hex),
  ICE = ["#e8f6fb", "#a6d4e6", "#7fb3cc", "#f2fbff"].map(hex);

const DX = [-1, 1, 0, 0, -1, 1, -1, 1],
  DY = [0, 0, -1, 1, -1, -1, 1, 1],
  COST = [5, 5, 5, 5, 7, 7, 7, 7];

/**
 * Light spreading through open cells from the sources: 1 at a source, falling
 * linearly to 0 at radius. 8 neighbours (costs 5 straight, 7 diagonal) so pools
 * of light come out near-round; water slows light by waterCost.
 */
function flood(
  W: number,
  H: number,
  cells: Uint8Array,
  sources: Int32Array,
  radius: number,
  waterCost: number,
  dist: Int32Array,
  out: Float32Array,
) {
  const R5 = radius * 5,
    buckets: number[][] = [];
  for (let d = 0; d < R5; d++) buckets.push([]);
  dist.fill(R5);
  out.fill(0);
  for (let k = 0; k < sources.length; k++) {
    dist[sources[k]] = 0;
    buckets[0].push(sources[k]);
  }
  for (let d = 0; d < R5; d++) {
    const q = buckets[d];
    for (let n = 0; n < q.length; n++) {
      const i = q[n];
      if (dist[i] !== d) continue;
      out[i] = 1 - d / R5;
      const x = i % W,
        y = (i - x) / W;
      for (let s = 0; s < 8; s++) {
        const nx = x + DX[s],
          ny = y + DY[s];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const j = ny * W + nx,
          m = cells[j];
        if (!isOpen(m)) continue;
        // No squeezing diagonally between two solid cells.
        if (s >= 4 && !isOpen(cells[y * W + nx]) && !isOpen(cells[ny * W + x]))
          continue;
        const nd = d + COST[s] * (m === M.WATER ? waterCost : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          if (nd < R5) buckets[nd].push(j);
        }
      }
    }
    buckets[d] = [];
  }
}

// Light at the current pixel, written by lightAt to avoid allocating per pixel.
let lr = 0,
  lg = 0,
  lb = 0;
const stepped = (L: number, bay: number) =>
  Math.floor((L < 1.6 ? L : 1.6) * 5 + bay) / 5;
function lightAt(
  Lsky: number,
  c: number,
  v: number,
  w: number,
  e: number,
  bay: number,
) {
  const a = stepped(Lsky, bay),
    sc = stepped(c, bay) * 0.9,
    sv = stepped(v, bay) * 0.9,
    sw = stepped(w, bay) * 1.1,
    se = stepped(e, bay) * 0.9;
  lr =
    a * SKYL[0] + sc * CYAN[0] + sv * VIOLET[0] + sw * WARM[0] + se * EMBER[0];
  lg =
    a * SKYL[1] + sc * CYAN[1] + sv * VIOLET[1] + sw * WARM[1] + se * EMBER[1];
  lb =
    a * SKYL[2] + sc * CYAN[2] + sv * VIOLET[2] + sw * WARM[2] + se * EMBER[2];
}

/** A well-mixed integer hash of a cell, for speckle and pebbles. */
function grain(x: number, y: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Value noise sampled along one row at a time: lattice corners hashed once per row. */
class RowNoise {
  private a: Float64Array;
  private b: Float64Array;
  private lx0: number;
  private v = 0;
  constructor(
    x0: number,
    W: number,
    private sx: number,
    private sy: number,
    private seed: number,
  ) {
    this.lx0 = Math.floor(x0 / sx);
    const n = Math.floor((x0 + W - 1) / sx) - this.lx0 + 2;
    this.a = new Float64Array(n);
    this.b = new Float64Array(n);
  }
  row(y: number) {
    const iy = Math.floor(y / this.sy),
      fy = y / this.sy - iy;
    this.v = fy * fy * (3 - 2 * fy);
    for (let k = 0; k < this.a.length; k++) {
      this.a[k] = hash3(this.lx0 + k, iy, this.seed);
      this.b[k] = hash3(this.lx0 + k, iy + 1, this.seed);
    }
  }
  at(wx: number) {
    const ix = Math.floor(wx / this.sx),
      fx = wx / this.sx - ix,
      u = fx * fx * (3 - 2 * fx),
      k = ix - this.lx0,
      a = this.a[k],
      b = this.a[k + 1],
      c = this.b[k],
      d = this.b[k + 1],
      v = this.v;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
}

export interface Land {
  W: number;
  H: number;
  cells: Uint8Array;
  state: Uint8Array;
  /** Ground height per column, before caves: open cells above it are sky. */
  surface: Int16Array;
  /** World x of column 0. */
  x0: number;
  /** The world's seed: shapes the distant ridges and the clouds. */
  seed?: number;
  /** Per cell: 1 + the biome (biomes.ts) of the plant or ground cover there, or 0: sets its colours. */
  flora?: Uint8Array;
  /** Only shade rows [from, to) (the rest stay black): for stills that show part of the window. */
  rows?: [number, number];
  /** Per cell: a crafted sprite's shade 1-6 (engine/strata/art.ts), or 0. */
  tone?: Uint8Array;
  /** Per cell: the forest behind the land, (wood ? 32 : 0) | (layer << 3) | shade; and its palette. */
  back?: Uint8Array;
  backPal?: Uint8Array;
  /** An alternative look to compare ("study": fewer details, layered misty depth, a strong land shape, a small unified palette). */
  style?: string;
}

/**
 * A gently smoothed ground line, per column, for the sky to sit on: the dusk
 * glow, the clouds and the distant hills are placed relative to it, so every
 * view has its horizon just behind the land, whether the ground there is high
 * or low. Built from world-aligned samples, so tiles line up exactly.
 */
export function horizonRow(seed: number, x0: number, W: number) {
  const STEP = 128,
    k0 = Math.floor(x0 / STEP),
    k1 = Math.floor((x0 + W - 1) / STEP) + 1,
    pts = new Float32Array(k1 - k0 + 1),
    out = new Float32Array(W);
  for (let k = k0; k <= k1; k++) {
    let sum = 0;
    for (let j = -12; j <= 12; j++) sum += groundAt(seed, k * STEP + j * 64);
    pts[k - k0] = sum / 25;
  }
  for (let x = 0; x < W; x++) {
    const wx = x0 + x,
      k = Math.floor(wx / STEP),
      f = (wx - k * STEP) / STEP,
      u = f * f * (3 - 2 * f);
    out[x] = pts[k - k0] + (pts[k - k0 + 1] - pts[k - k0]) * u;
  }
  return out;
}

/**
 * The valley floors around each column: the lowest ground within about 2000
 * columns, smoothed, on the same world grid as the horizon (so it is
 * seamless). Land standing above it (hills, mesas, mountains) is lit like
 * the surface; only below it does the underground darken quickly.
 */
export function floorRow(seed: number, x0: number, W: number) {
  const STEP = 128,
    k0 = Math.floor(x0 / STEP) - 1,
    k1 = Math.floor((x0 + W - 1) / STEP) + 2,
    pts = new Float32Array(k1 - k0 + 1),
    out = new Float32Array(W);
  for (let k = k0; k <= k1; k++) {
    let low = 0;
    for (let j = -16; j <= 16; j++) low = Math.max(low, groundAt(seed, k * STEP + j * 128));
    pts[k - k0] = low;
  }
  for (let x = 0; x < W; x++) {
    const wx = x0 + x,
      k = Math.floor(wx / STEP),
      f = (wx - k * STEP) / STEP,
      u = f * f * (3 - 2 * f),
      a = pts[k - k0],
      b = pts[k - k0 + 1];
    out[x] = a + (b - a) * u;
  }
  return out;
}

/** What moves, per cell, for a renderer that animates (the viewer). */
export const MOTION = {
  STILL: 0,
  SKY: 1,
  WATER: 2,
  STREAM: 3,
  /** A stream flowing toward smaller x (set by whoever knows the river's direction). */
  STREAM_BACK: 4,
  FALLS: 5,
  LAVA: 6,
  WATER_TOP: 7,
  /** Baked (the forest behind the land), with plants swaying over it as over the sky. */
  BACKDROP: 8,
} as const;

/**
 * Optional outputs for an animating renderer: a motion class per cell, and
 * the plants standing in the open air drawn on their own, so they can sway
 * over a sky drawn live (those cells are classed as sky). A plant cell's
 * alpha is 1 + its height above its plant's base (0 where there is no
 * plant), and the colour output's alpha there is 128 + the base's x minus
 * the cell's: see swayField.
 */
export interface MotionLayers {
  motion: Uint8Array;
  plants: Uint8ClampedArray;
}

/**
 * How each plant cell standing in the open air sways. A plant is a joined
 * group of plant cells (with any snow lying on them); it sways about its
 * base, the lowest place it rests on something solid or on water. Per cell:
 * h = 1 + its height above that base (0 for cells that are no plant), and
 * ax = 128 + the base's x minus its own, so the renderer can bend the whole
 * plant together, row by row, in the wind at its base. Plants held along
 * much of their length (ivy on a cliff) or by rope (a bridge) stay still.
 */
function swayField(
  W: number,
  H: number,
  cells: Uint8Array,
  surface: Int16Array,
) {
  const h = new Uint8Array(W * H),
    ax = new Uint8Array(W * H).fill(128),
    mark = new Uint8Array(W * H);
  // Plant cells in the open air, and snow lying on them (bottom up, so snow
  // on snow on a branch counts too).
  for (let x = 0; x < W; x++)
    for (let y = Math.min(H - 2, surface[x] - 1); y >= 0; y--) {
      const i = y * W + x,
        m = cells[i];
      if (SILHOUETTE[m] || (m === M.SNOW && mark[i + W])) mark[i] = 1;
    }
  const comp: number[] = [],
    support = (j: number) =>
      j >= 0 && j < W * H && !mark[j] && cells[j] !== M.AIR;
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!mark[i0] || h[i0]) continue;
    // Gather the plant: every marked cell joined to this one.
    comp.length = 0;
    comp.push(i0);
    h[i0] = 1;
    let rope = false;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k],
        x = i % W;
      if (cells[i] === M.ROPE) rope = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            j = i + dy * W + dx;
          if (
            (dx || dy) &&
            nx >= 0 &&
            nx < W &&
            j >= 0 &&
            j < W * H &&
            mark[j] &&
            !h[j]
          ) {
            h[j] = 1;
            comp.push(j);
          }
        }
    }
    // Where it rests, and its lowest resting place: the base.
    let held = 0,
      baseY = -1,
      sumX = 0,
      nX = 0;
    for (const i of comp) {
      const x = i % W,
        y = (i - x) / W;
      if (!(
        support(i + W) ||
        (x > 0 && support(i - 1)) ||
        (x < W - 1 && support(i + 1))
      ))
        continue;
      held++;
      if (y > baseY) {
        baseY = y;
        sumX = nX = 0;
      }
      if (y === baseY) {
        sumX += x;
        nX++;
      }
    }
    // Trees and anything big stand still; grass, flowers and ferns sway.
    if (rope || held === 0 || held > 0.3 * comp.length || comp.length > 260) continue; // stays still: all 1s
    const baseX = Math.round(sumX / nX);
    for (const i of comp) {
      const x = i % W,
        y = (i - x) / W;
      h[i] = 1 + Math.max(0, Math.min(253, baseY - y));
      ax[i] = 128 + Math.max(-127, Math.min(127, baseX - x));
    }
  }
  return { h, ax };
}

/** Render land to RGBA, one pixel per cell. */
export const renderTimes: Record<string, number> = {};
export function renderLand(
  { W, H, cells, state, surface, x0, seed = 0, flora, rows, style, tone, back, backPal }: Land,
  layers?: MotionLayers,
) {
  let tt = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    renderTimes[k] = n - tt;
    tt = n;
  };
  const N = W * H,
    sway = layers ? swayField(W, H, cells, surface) : null,
    dist = new Int32Array(N),
    Ls = new Float32Array(N),
    Lc = new Float32Array(N),
    Lv = new Float32Array(N),
    Lw = new Float32Array(N),
    Le = new Float32Array(N);

  // Sky light enters the ground through its openings: seed the flood from sky
  // cells that touch open space below the ground line.
  // How deep each cell lies under open ground: under the ground straight
  // above, or the hillside beside it (light comes in from the side too, half
  // as far), so the dark below a steep slope follows the slope.
  const reach = Float32Array.from(surface);
  for (let x = 1; x < W; x++) reach[x] = Math.min(reach[x], reach[x - 1] + 2);
  for (let x = W - 2; x >= 0; x--) reach[x] = Math.min(reach[x], reach[x + 1] + 2);
  const below = (x: number, y: number) => y >= surface[x];
  const sky: number[] = [];
  for (let x = 0; x < W; x++) {
    const lo = Math.min(
      surface[x],
      x > 0 ? surface[x - 1] : surface[x],
      x < W - 1 ? surface[x + 1] : surface[x],
    );
    for (let y = Math.max(0, lo - 2); y < surface[x]; y++) {
      const i = y * W + x;
      if (!isOpen(cells[i])) continue;
      let touches = false;
      for (let s = 0; s < 8 && !touches; s++) {
        const nx = x + DX[s],
          ny = y + DY[s];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (below(nx, ny) && isOpen(cells[ny * W + nx])) touches = true;
      }
      if (touches) sky.push(i);
    }
  }
  flood(W, H, cells, Int32Array.from(sky), 120, 3, dist, Ls);
  // The sky itself is fully lit.
  for (let x = 0; x < W; x++)
    for (let y = 0; y < surface[x]; y++)
      if (isOpen(cells[y * W + x])) Ls[y * W + x] = 1;

  lap("sky");
  // Glowing cells are solid; seed each colour's flood from the open cells beside them.
  const mark = new Uint8Array(N),
    lists: number[][] = [[], [], [], []];
  for (let i = 0; i < N; i++) {
    const m = cells[i];
    if (!(state[i] & GLOW) && m !== M.LAVA) continue;
    const kind =
        m === M.LAVA
          ? 2
          : m === M.CORAL
            ? 3
            : m === M.CRYSTAL || m === M.SHELF
              ? 1
              : 0,
      bit = 1 << kind,
      x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W])
      if (j >= 0 && j < N && isOpen(cells[j]) && !(mark[j] & bit)) {
        mark[j] |= bit;
        lists[kind].push(j);
      }
  }
  flood(W, H, cells, Int32Array.from(lists[0]), 34, 2, dist, Lc);
  flood(W, H, cells, Int32Array.from(lists[1]), 26, 2, dist, Lv);
  // Lava lights a pool around it; ember coral only a small glow of its own.
  flood(W, H, cells, Int32Array.from(lists[2]), 50, 2, dist, Lw);
  flood(W, H, cells, Int32Array.from(lists[3]), 18, 2, dist, Le);

  lap("glow");
  const rgba = new Uint8ClampedArray(N * 4),
    waterAbove = new Int16Array(W);
  // Mottling in the rock: two value noises on lattices that never line up
  // (6 x 4 and 13 x 7 cells), so no grid shows through.
  const fine = new RowNoise(x0, W, 6, 4, 991),
    coarse = new RowNoise(x0, W, 13, 7, 992),
    // Streaks in moving water: long sideways in streams, long downward in falls.
    flow = new RowNoise(x0, W, 11, 2, 993),
    fall = new RowNoise(x0, W, 2, 13, 994),
    iceAbove = new Int16Array(W),
    // Whether the water in this column lies under ice.
    frozen = new Uint8Array(W),
    // Clouds: two value noises, broad and fine; distant ridges: a far range
    // of peaks and nearer rolling hills, both behind the land.
    cloudA = new RowNoise(x0, W, 150, 46, seed + 711),
    cloudB = new RowNoise(x0, W, 42, 18, seed + 712),
    // The same clouds a few rows up: where there is less cloud above, a
    // cloud is lit; where there is more, it is in its own shade.
    upA = new RowNoise(x0, W, 150, 46, seed + 711),
    upB = new RowNoise(x0, W, 42, 18, seed + 712),
    far = new Float32Array(W),
    near = new Float32Array(W),
    hz = horizonRow(seed, x0, W),
    floor = floorRow(seed, x0, W);
  for (let x = 0; x < W; x++) {
    const wx = x0 + x,
      // Ridged noise at two scales: ranges of sharp peaks, not domes.
      r1 = 1 - Math.abs(2 * fbm1(wx / 1100, seed + 701, 3) - 1),
      r2 = 1 - Math.abs(2 * fbm1(wx / 300, seed + 705, 3) - 1);
    // Heights above the horizon: a low line of near hills, far peaks behind.
    far[x] =
      50 + 70 * r1 * r1 + 40 * r2 * r2 * r1 + 10 * fbm1(wx / 60, seed + 702, 2);
    near[x] =
      22 +
      28 * fbm1(wx / 520, seed + 703, 3) +
      12 * fbm1(wx / 90, seed + 704, 2);
  }
  // The study look's depth is measured from the ground smoothed over the
  // screen, so peaks don't cast shafts of light into the rock below them.
  const smoothTop = new Float32Array(W);
  if (style === "study")
    for (let x = 0; x < W; x++) {
      let sum = 0,
        n = 0;
      for (let k = Math.max(0, x - 32); k <= Math.min(W - 1, x + 32); k++) {
        sum += reach[k];
        n++;
      }
      smoothTop[x] = sum / n;
    }
  // The study look: four planes of hills behind the land, farther ones
  // higher and paler, each fading into mist toward its foot.
  const study = style === "study",
    planes = study ? [0, 1, 2, 3].map(() => new Float32Array(W)) : [];
  if (study)
    for (let x = 0; x < W; x++) {
      const wx = x0 + x,
        r = (sx: number, o: number) => 1 - Math.abs(2 * fbm1(wx / sx, seed + o, 3) - 1);
      planes[0][x] = 70 + 95 * r(1800, 721) ** 2.5 + 30 * r(500, 722) * r(1800, 721) ** 2;
      planes[1][x] = 45 + 55 * r(1100, 723) ** 2 + 15 * r(300, 724) * r(1100, 723);
      planes[2][x] = 26 + 30 * fbm1(wx / 700, seed + 725, 3) + 9 * fbm1(wx / 150, seed + 726, 2);
      planes[3][x] = 8 + 18 * fbm1(wx / 450, seed + 727, 3) + 6 * fbm1(wx / 90, seed + 728, 2);
    }
  // Each column's ground: its biome, from the cover and plants the generator
  // stamped there (gaps such as water or bare rock take their neighbours').
  const colB = new Int16Array(W).fill(-1);
  if (flora) {
    for (let x = 0; x < W; x++)
      for (let y = Math.max(0, surface[x] - 2); y < Math.min(H, surface[x] + 16); y++) {
        const f = flora[y * W + x];
        if (f > 0 && f <= LAND.length) {
          colB[x] = f - 1;
          break;
        }
      }
    let last = -1;
    for (let x = 0; x < W; x++) if (colB[x] >= 0) last = colB[x];
      else colB[x] = last;
    last = -1;
    for (let x = W - 1; x >= 0; x--) if (colB[x] >= 0 && colB[x] !== -1) last = colB[x];
      else if (colB[x] < 0) colB[x] = last;
  }
  // The ground's colours, smoothed over about 50 columns, so biome edges
  // (which dither column by column) blend instead of striping the rock.
  const G = Array.from({ length: W }, () => ({
    earth: [0, 0, 0],
    tint: [0, 0, 0],
    tintK: 0,
    weather: 0,
  }));
  {
    const R = 24;
    for (let x = 0; x < W; x++) {
      const g = G[x];
      let n = 0;
      for (let k = Math.max(0, x - R); k <= Math.min(W - 1, x + R); k++) {
        if (colB[k] < 0) continue;
        const b = GB[colB[k]];
        for (let c = 0; c < 3; c++) {
          g.earth[c] += b.earth[c];
          g.tint[c] += b.tint[c];
        }
        g.tintK += b.tintK;
        g.weather += b.weather;
        n++;
      }
      if (!n) continue;
      for (let c = 0; c < 3; c++) {
        g.earth[c] /= n;
        g.tint[c] /= n;
      }
      g.tintK /= n;
      g.weather /= n;
    }
  }
  const yFrom = rows ? Math.max(0, rows[0]) : 0,
    yTo = rows ? Math.min(H, rows[1]) : H;
  // Rows skipped above still count toward water and ice depth.
  for (let y = 0; y < yFrom; y++)
    for (let x = 0; x < W; x++) {
      const m = cells[y * W + x];
      waterAbove[x] = m === M.WATER ? waterAbove[x] + 1 : 0;
      iceAbove[x] = m === M.ICE ? iceAbove[x] + 1 : 0;
      frozen[x] = m === M.ICE ? 1 : m === M.WATER ? frozen[x] : 0;
    }
  for (let y = yFrom; y < yTo; y++) {
    // Cut-away light: full at the ground, fading with depth below it (set per column below).
    let cut = 0.6;
    fine.row(y);
    coarse.row(y);
    flow.row(y);
    fall.row(y);
    cloudA.row(y);
    cloudB.row(y);
    upA.row(y - 4);
    upB.row(y - 4);
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        wx = x0 + x,
        m = cells[i],
        st = state[i],
        biome = biomeOf(st) % LOOKS,
        bay = BAYER[(y & 3) * 4 + (wx & 3)];
      const skyCell = y < surface[x],
        below = y - reach[x],
        belowSm = study ? Math.max(0, y - smoothTop[x]) : below;
      // In daylight the cut face is lit near the ground, dimming with depth
      // to a low glow, never quite black.
      // Above the valley floors the land dims only slowly with depth.
      // (Continuous: 0.3 per row down to the floor, 1 per row below it.)
      const top = reach[x],
        fl = Math.max(floor[x], top),
        dim = 0.3 * Math.max(0, Math.min(y, fl) - top) + Math.max(0, y - fl);
      cut = study
        ? // The land as one strong shape: lit just under the ground, then a
          // quiet deep tone.
          belowSm <= 3
          ? 0.9
          : 0.9 * (0.5 + 0.5 * Math.exp(-(belowSm - 3) / 40))
        : dim <= 4
          ? 0.95
          : 0.95 * (0.3 + 0.7 * Math.exp(-(dim - 4) / 85));
      let cr: number, cg: number, cb: number;
      const wd = m === M.WATER ? waterAbove[x] : 0;
      waterAbove[x] = m === M.WATER ? wd + 1 : 0;
      const id = m === M.ICE ? iceAbove[x] : 0;
      iceAbove[x] = m === M.ICE ? id + 1 : 0;
      frozen[x] = m === M.ICE ? 1 : m === M.WATER ? frozen[x] : 0;
      if (m === M.AIR && skyCell) {
        // Open sky: a day gradient, dithered into bands, measured in rows
        // above the horizon (d): pale and hazy at it, bluer upward.
        const d = hz[x] - y,
          g = Math.min(1, Math.max(0, d / 700)),
          a = g < 0.35 ? SKY[0] : SKY[1],
          b = g < 0.35 ? SKY[1] : SKY[2],
          u = g < 0.35 ? g / 0.35 : (g - 0.35) / 0.65;
        cr = Math.floor((a[0] + (b[0] - a[0]) * u) * 24 + bay) / 24;
        cg = Math.floor((a[1] + (b[1] - a[1]) * u) * 24 + bay) / 24;
        cb = Math.floor((a[2] + (b[2] - a[2]) * u) * 24 + bay) / 24;
        // Clouds: heaped, lit on top and shaded underneath, in a few steps.
        const env =
            Math.min(1, Math.max(0, (d - 90) / 50)) *
            Math.min(1, Math.max(0, (560 - d) / 90)),
          cl = 0.65 * cloudA.at(wx) + 0.35 * cloudB.at(wx),
          amt =
            Math.floor(
              Math.min(1, Math.max(0, (cl - 0.6) / 0.06)) * env * 3 + bay,
            ) / 3;
        if (amt > 0) {
          const up = 0.65 * upA.at(wx) + 0.35 * upB.at(wx),
            lit =
              Math.floor(Math.min(1, Math.max(0, 0.55 + (cl - up) * 9)) * 3 + bay) / 3,
            k = 0.35 + 0.6 * amt;
          cr += (CLOUD_SHADE[0] + (CLOUD_LIT[0] - CLOUD_SHADE[0]) * lit - cr) * k;
          cg += (CLOUD_SHADE[1] + (CLOUD_LIT[1] - CLOUD_SHADE[1]) * lit - cg) * k;
          cb += (CLOUD_SHADE[2] + (CLOUD_LIT[2] - CLOUD_SHADE[2]) * lit - cb) * k;
        }
        // Distant hills behind the land, in haze: flat silhouettes with
        // crisp tops, the nearer the deeper in colour, a little darker
        // lower down in a few dithered steps.
        if (study) {
          // The nearest plane this point lies in.
          for (let k = 3; k >= 0; k--) {
            if (d >= planes[k][x]) continue;
            const into = planes[k][x] - d,
              col = PLANES[k],
              mist = 0.85 * Math.floor(Math.min(1, Math.max(0, (into - 4) / 26)) * 4 + bay) / 4;
            cr = col[0] + (MIST[0] - col[0]) * mist;
            cg = col[1] + (MIST[1] - col[1]) * mist;
            cb = col[2] + (MIST[2] - col[2]) * mist;
            break;
          }
        }
        const into = study ? -1 : d < near[x] ? near[x] - d : d < far[x] ? far[x] - d : -1;
        if (into >= 0) {
          const nearer = d < near[x],
            hz2 = nearer ? HAZE_NEAR : HAZE_FAR,
            k =
              (nearer ? 0.85 : 0.6) +
              (0.08 * Math.floor(Math.min(1, into / 120) * 3 + bay)) / 3;
          cr += (hz2[0] - cr) * k;
          cg += (hz2[1] - cg) * k;
          cb += (hz2[2] - cb) * k;
        }
        // The forest standing behind the land.
        if (back && back[i]) {
          const bc = backColor(back[i], backPal![i]);
          cr = bc[0];
          cg = bc[1];
          cb = bc[2];
        }
        lr = lg = lb = 1;
      } else if (m === M.WATER) {
        // Water: tinted, darker with depth, a bright line where it meets the air.
        const top = wd === 0 && y > 0 && cells[i - W] === M.AIR,
          f = Math.min(1, wd / 160),
          rock = rockOf(st);
        if (top) {
          cr = 0.75 * WATER[0] + 0.35;
          cg = 0.75 * WATER[1] + 0.35;
          cb = 0.75 * WATER[2] + 0.35;
        } else {
          cr =
            (rock[0] * 0.42 + 0.03) * 0.35 * (1 - f) +
            (WATER[0] * (1 - f) + DEEP[0] * f) * 0.75;
          cg =
            (rock[1] * 0.42 + 0.03) * 0.35 * (1 - f) +
            (WATER[1] * (1 - f) + DEEP[1] * f) * 0.75;
          cb =
            (rock[2] * 0.42 + 0.03) * 0.35 * (1 - f) +
            (WATER[2] * (1 - f) + DEEP[2] * f) * 0.75;
        }
        lightAt(
          skyCell ? 1 : Math.max(Ls[i], y < surface[x] + 260 ? 0.5 : 0),
          Lc[i],
          Lv[i],
          Lw[i],
          Le[i],
          bay,
        );
        lr = 0.25 + 0.75 * Math.min(1.2, lr + 0.3 * AMB[0]);
        lg = 0.25 + 0.75 * Math.min(1.2, lg + 0.3 * AMB[1]);
        lb = 0.25 + 0.75 * Math.min(1.2, lb + 0.3 * AMB[2]);
      } else if (m === M.STREAM || m === M.FALLS) {
        // Moving water: a stream streaked along its flow with a bright skin;
        // a waterfall streaked downward, foaming where it lands.
        let c: number[];
        if (m === M.STREAM)
          c =
            y > 0 && cells[i - W] === M.AIR
              ? STREAM[2]
              : flow.at(wx) > 0.66
                ? STREAM[1]
                : STREAM[0];
        else {
          // Thin streaks of light down the fall, a bright splash where it lands.
          const landing = y + 3 < H && cells[i + 3 * W] !== M.FALLS,
            streak = grain(wx, 3131) % 5;
          c = landing
            ? FALLS[2]
            : streak === 0
              ? FALLS[2]
              : streak === 3
                ? FALLS[1]
                : fall.at(wx) < 0.42
                  ? FALLS[1]
                  : FALLS[0];
        }
        cr = c[0];
        cg = c[1];
        cb = c[2];
        if (skyCell) {
          lr = 0.5 + 0.5 * SKYL[0];
          lg = 0.5 + 0.5 * SKYL[1];
          lb = 0.5 + 0.5 * SKYL[2];
        } else {
          lightAt(Ls[i], Lc[i], Lv[i], Lw[i], Le[i], bay);
          lr += 0.4 * AMB[0];
          lg += 0.4 * AMB[1];
          lb += 0.4 * AMB[2];
        }
      } else if (m === M.LAVA) {
        // Lava: dark red with an orange crust where it meets the air, and a few hot specks.
        // Dark red melt with brighter veins (smooth noise, not per-cell
        // speckle) and an orange skin where it meets the air.
        const n = 0.6 * fine.at(wx) + 0.4 * coarse.at(wx),
          c =
            y > 0 && cells[i - W] === M.AIR
              ? LAVA[0]
              : n > 0.68
                ? LAVA[1]
                : n > 0.52
                  ? LAVA[2]
                  : LAVA[3];
        cr = c[0];
        cg = c[1];
        cb = c[2];
        lr = lg = lb = 1;
      } else {
        // Rock and everything solid, or the back wall of a cave behind open space.
        const mottle = 0.6 * fine.at(wx) + 0.4 * coarse.at(wx),
          h = grain(wx, y);
        let rock = rockOf(st);
        if (study) {
          // Fewer distinct rocks: each leans halfway to the average.
          WR2[0] = rock[0] * 0.55 + KIND_AVG[0] * 0.45;
          WR2[1] = rock[1] * 0.55 + KIND_AVG[1] * 0.45;
          WR2[2] = rock[2] * 0.55 + KIND_AVG[2] * 0.45;
          rock = WR2;
        }
        // Near the surface, rock takes its climate's tint, and just under the
        // soil it is weathered: grading, in dithered steps, into the earth.
        const gb = colB[x] >= 0 ? G[x] : null;
        if (gb && below < 170 && (m === M.ROCK || m === M.AIR || m === M.BACKWALL || m === M.GRAVEL || m === M.SAND)) {
          const kT = gb.tintK * (1 - Math.min(1, Math.max(0, below) / 170));
          let r0 = rock[0] + (gb.tint[0] - rock[0]) * kT,
            g0 = rock[1] + (gb.tint[1] - rock[1]) * kT,
            b0 = rock[2] + (gb.tint[2] - rock[2]) * kT;
          const depth = gb.weather * 1.8;
          if (m === M.ROCK && y >= surface[x] && below < depth) {
            const f = Math.pow(1 - Math.max(0, below) / depth, 1.3) * 0.85,
              k = Math.floor(f * 4 + bay) / 4;
            r0 += (gb.earth[0] - r0) * k;
            g0 += (gb.earth[1] - g0) * k;
            b0 += (gb.earth[2] - b0) * k;
          }
          WR[0] = r0;
          WR[1] = g0;
          WR[2] = b0;
          rock = WR;
        }
        if (study && gb) {
          // The land in its biome's own hue: every rock leans to the earth.
          WR[0] = rock[0] + (gb.earth[0] * 1.15 - rock[0]) * 0.4;
          WR[1] = rock[1] + (gb.earth[1] * 1.15 - rock[1]) * 0.4;
          WR[2] = rock[2] + (gb.earth[2] * 1.15 - rock[2]) * 0.4;
          rock = WR;
        }
        const
          seam =
            y > 0 &&
            cells[i - W] === M.ROCK &&
            bandOf(state[i - W]) !== bandOf(st),
          joint = false,
          tex = study
            ? seam
              ? 0.93
              : 1
            : (1 + (0.05 * ((h & 3) - 1.5)) / 1.5 + 0.12 * (mottle - 0.5)) *
              ((h >>> 8) % 97 === 0 ? 1.25 : 1) *
              (seam ? 0.8 : 1) *
              (joint ? 0.9 : 1);
        // Brick courses: rows three cells high, joints offset row by row.
        const mortar =
          y % 3 === 0 || (wx + (Math.floor(y / 3) % 2) * 3) % 6 === 0
            ? 0.72
            : 1;
        if (m === M.AIR || m === M.BACKWALL) {
          // A back wall, set back and in shadow: the cave's rock, or a
          // building's masonry. The cave's strata show only faintly on it,
          // and its ambient light dims with depth as the rock's does, so open
          // space always reads as a hole in the rock, however deep.
          const avg = KIND_AVG,
            back =
              m === M.BACKWALL
                ? BRICK.map((v) => v * mortar * 1.1)
                : [
                    rock[0] * 0.35 + avg[0] * 0.65,
                    rock[1] * 0.35 + avg[1] * 0.65,
                    rock[2] * 0.35 + avg[2] * 0.65,
                  ],
            amb = (0.55 * cut) / 0.6;
          cr = back[0] * 0.42 * tex + BACK_TINT[0] * 0.25;
          cg = back[1] * 0.42 * tex + BACK_TINT[1] * 0.25;
          cb = back[2] * 0.42 * tex + BACK_TINT[2] * 0.25;
          lightAt(Ls[i], Lc[i], Lv[i], Lw[i], Le[i], bay);
          lr += amb * AMB[0];
          lg += amb * AMB[1];
          lb += amb * AMB[2];
        } else {
          // A plant or ground cover in a biome takes the biome's colours.
          const fl = flora ? flora[i] : 0,
            pal = fl ? PAL[fl - 1] : null,
            tinted = !pal
              ? null
              : m === M.LEAF
                ? pal.leaf
                : m === M.GRASS
                  ? y < surface[x]
                    ? blade(pal, cells, i, W, y, surface[x], wx)
                    : pal.grass
                  : m === M.MOSS
                    ? pal.moss
                    : m === M.WOOD
                      ? pal.bark
                      : m === M.FLOWER
                        ? h % 3 === 0
                          ? FLOWERS[h % FLOWERS.length]
                          : pal.bloom
                        : m === M.SOIL || (m === M.SAND && pal.salt)
                          ? pal.earth
                          : null;
          // A crafted sprite's cell: its shade on its colour's ramp.
          const toned = tone ? tone[i] : 0,
            tonedC = !toned
              ? null
              : m === M.ROCK
                ? rockRamp(bandOf(st))[toned - 1]
                : fl
                  ? rampFor(fl, m)[toned - 1]
                  : null;
          // Scree and sand are broken rock: they take the rock's colour.
          let loose: number[] | null = null;
          if (m === M.GRAVEL || (m === M.SAND && !(pal && pal.salt))) {
            const base = SOLID[m],
              k = m === M.GRAVEL ? 0.8 : 0.3,
              lift = m === M.GRAVEL ? 1.05 : 1.15;
            LOOSE[0] = base[0] + (rock[0] * lift - base[0]) * k;
            LOOSE[1] = base[1] + (rock[1] * lift - base[1]) * k;
            LOOSE[2] = base[2] + (rock[2] * lift - base[2]) * k;
            loose = LOOSE;
            if (m === M.GRAVEL) {
              // Stones, three or four cells wide and three tall, in courses
              // offset row by row, each lit on top and shaded underneath, in
              // a few tones (some dark with desert varnish), bedded in a
              // paler matrix of grit that shows between them.
              const band = Math.floor(y / 3),
                ox = wx + (grain(band, 9191) % 5),
                cell = Math.floor(ox / 5),
                id = grain(cell, band + 5151),
                lx = ox - cell * 5,
                ly = y - band * 3,
                wide = 3 + ((id >>> 3) & 1),
                // (Rounded: the top corners of each stone are grit.)
                gap =
                  lx >= wide ||
                  (ly === 2 && ((id >>> 4) & 3) === 0) ||
                  (ly === 0 && (lx === 0 || lx === wide - 1) && ((id >>> 9) & 1) === 0);
              let k: number;
              if (gap) k = 1.28;
              else {
                const tone = [0.62, 0.82, 0.95, 1.08][(id >>> 6) & 3];
                k = tone * (ly === 0 ? 1.14 : ly === 2 ? 0.8 : 1) * (lx === 0 ? 0.94 : 1);
              }
              LOOSE[0] *= k;
              LOOSE[1] *= k;
              LOOSE[2] *= k;
            }
          }
          const c =
            tonedC ??
            tinted ??
            loose ??
            (m === M.ROCK
              ? null
              : m === M.LEAF
                ? LEAF[biome]
                : m === M.CAP
                  ? CAP[biome]
                  : m === M.VINE && st & GLOW
                    ? VINE_GLOW
                    : m === M.BRICK
                      ? BRICK.map((v) => v * mortar * tex)
                      : m === M.FLOWER
                        ? FLOWERS[h % FLOWERS.length]
                        : m === M.REED
                          ? REED[y > 0 && cells[i - W] !== M.REED ? 1 : 0]
                          : (SOLID[m] ?? rock));
          cr = c ? c[0] : rock[0] * tex;
          cg = c ? c[1] : rock[1] * tex;
          cb = c ? c[2] : rock[2] * tex;
          if (m === M.ICE) {
            // Ice: pale at its top, bluer deeper in, with white cracks and bubbles.
            const c2 =
              id === 0 && y > 0 && isOpen(cells[i - W])
                ? ICE[0]
                : (id < 10 && Math.abs(coarse.at(wx) - 0.5) < 0.008) ||
                    (h & 127) === 0
                  ? ICE[3]
                  : id < 5
                    ? ICE[1]
                    : ICE[2];
            cr = c2[0];
            cg = c2[1];
            cb = c2[2];
          }
          if (st & GLOW) lr = lg = lb = 1.25;
          else if (m === M.ICE && skyCell) {
            // A frozen lake catches the sky.
            lr = 0.45 + 0.55 * SKYL[0];
            lg = 0.45 + 0.55 * SKYL[1];
            lb = 0.45 + 0.55 * SKYL[2];
          } else {
            // Cut-away light on the body, fading with depth, plus light from
            // open space beside it; faces that meet open space catch more,
            // floors (open above) most.
            // The light falling on this face from the open space beside it,
            // channel by channel, so a wall by glowing fungi takes their colour.
            let nS = 0,
              nC = 0,
              nV = 0,
              nW = 0,
              nE = 0,
              edge = 0;
            if (skyCell && (SILHOUETTE[m] || m === M.GRASS || m === M.FLOWER || tonedC)) {
              // A plant in the open: daylight from above, its own shade under
              // its leaves, in two steps (a crafted sprite carries its own).
              const k = tonedC
                ? 1
                : y > 0 && isOpen(cells[i - W])
                  ? study
                    ? 1
                    : 1.04
                  : study
                    ? 0.7
                    : 0.84;
              lr = k * DAY[0];
              lg = k * DAY[1];
              lb = k * DAY[2];
            } else {
            if (!skyCell || !SILHOUETTE[m]) {
              const up = y > 0 ? i - W : -1,
                down = y < H - 1 ? i + W : -1,
                left = x > 0 ? i - 1 : -1,
                right = x < W - 1 ? i + 1 : -1;
              for (let s = 0; s < 4; s++) {
                const j =
                  s === 0 ? up : s === 1 ? left : s === 2 ? right : down;
                if (j < 0 || !isOpen(cells[j])) continue;
                if (Ls[j] > nS) nS = Ls[j];
                if (Lc[j] > nC) nC = Lc[j];
                if (Lv[j] > nV) nV = Lv[j];
                if (Lw[j] > nW) nW = Lw[j];
                if (Le[j] > nE) nE = Le[j];
                const e = s === 0 ? 1 : 0.6;
                if (e > edge) edge = e;
              }
            }
            // Deep inside solid rock nothing reaches but the cut-away light.
            // Sky on an edge is a gentle rim, not a full sunlit face; glows
            // light the faces they touch more strongly.
            if (nS + nC + nV + nW + nE > 0)
              lightAt(
                nS * (skyCell || y <= surface[x] + 2 ? 0.7 : 0.35),
                nC * 0.85,
                nV * 0.85,
                nW * 0.85,
                nE * 0.85,
                bay,
              );
            else lr = lg = lb = 0;
            // Faces on open space keep a brighter rim even in the dark, so a
            // cave's outline reads at any depth.
            // (Softer on the ground's own top, so its edge doesn't glow.)
            const amb = cut * (1 + (y <= surface[x] + 2 ? 0.25 : 0.7) * edge);
            lr += amb * AMB[0];
            lg += amb * AMB[1];
            lb += amb * AMB[2];
            // Turf in the sun reads as a band of green, not a glowing line.
            if ((m === M.GRASS || m === M.MOSS) && y <= surface[x] + 3) {
              lr *= 0.8;
              lg *= 0.8;
              lb *= 0.8;
            }
            }
          }
        }
      }
      const o = i * 4;
      rgba[o] = cr * lr * 255;
      rgba[o + 1] = cg * lg * 255;
      rgba[o + 2] = cb * lb * 255;
      rgba[o + 3] = 255;
      if (layers) {
        let c: number = MOTION.STILL;
        if (sway!.h[i]) {
          // A plant (or snow on one) standing in the open air: it sways
          // about its own base. Where its base is rides in the colour
          // layer's alpha, which an animating renderer doesn't show.
          layers.plants[o] = rgba[o];
          layers.plants[o + 1] = rgba[o + 1];
          layers.plants[o + 2] = rgba[o + 2];
          layers.plants[o + 3] = sway!.h[i];
          rgba[o + 3] = sway!.ax[i];
          c = MOTION.SKY;
          // Over the forest behind: that shows where the plant sways away.
          if (back && back[i]) {
            const bc = backColor(back[i], backPal![i]);
            rgba[o] = bc[0] * 255;
            rgba[o + 1] = bc[1] * 255;
            rgba[o + 2] = bc[2] * 255;
            c = MOTION.BACKDROP;
          }
        } else if (m === M.AIR && skyCell) c = back && back[i] ? MOTION.BACKDROP : MOTION.SKY;
        // Water under the open sky glints and shimmers; in a cave no sunlight
        // reaches it, and under ice it is held, so there it lies still.
        else if (m === M.WATER && skyCell && !frozen[x])
          c = y > 0 && cells[i - W] === M.AIR ? MOTION.WATER_TOP : MOTION.WATER;
        else if (m === M.STREAM) c = MOTION.STREAM;
        else if (m === M.FALLS) c = MOTION.FALLS;
        else if (m === M.LAVA) c = MOTION.LAVA;
        layers.motion[i] = c;
      }
    }
  }
  if (study) unify(rgba, W, yFrom, yTo, x0);
  lap("shade");
  return rgba;
}

// ---- Colour ramps for crafted sprites ------------------------------------------

/**
 * Six shades of a colour for sprites, darkest first: lightness steps around
 * the colour (which sits at tone 3-4), shadows shifted cooler and toward
 * blue-violet, highlights warmer and toward yellow, chroma highest in the
 * middle of the ramp. The way pixel artists build ramps.
 */
export function rampOf(base: number[]): number[][] {
  const [L, a, b] = oklab(toLin(base[0]), toLin(base[1]), toLin(base[2])),
    steps = [-0.2, -0.12, -0.05, 0.02, 0.09, 0.17],
    out: number[][] = [];
  for (let k = 0; k < 6; k++) {
    const s = steps[k],
      warm = s * 0.35,
      chroma = k === 0 ? 0.8 : k === 5 ? 0.75 : 1.05,
      [r, g, bb] = fromOklab(
        Math.min(0.97, Math.max(0.08, L + s)),
        a * chroma + warm * 0.15,
        b * chroma + warm * 0.55,
      );
    out.push([r, g, bb].map((v) => toSrgb(Math.min(1, Math.max(0, v)))));
  }
  return out;
}

// ---- The study look's palette: graded toward the sky, then snapped ------------

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklab(r: number, g: number, b: number) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
/** The sky's own hue, which every colour leans toward (shadows most). */
const TONE = oklab(toLin(0.55), toLin(0.71), toLin(0.84));

/**
 * One unified palette: every colour leans toward the sky's hue (shadows
 * most, so the land's dark tones agree with the sky), loses a little
 * chroma, and is snapped to a few steps of lightness (dithered), hue and
 * chroma, so a scene holds a small set of colours that agree.
 */
function unify(rgba: Uint8ClampedArray, W: number, y0: number, y1: number, x0: number) {
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4,
        [L, a0, b0] = oklab(toLin(rgba[o] / 255), toLin(rgba[o + 1] / 255), toLin(rgba[o + 2] / 255)),
        w = 0.05 + 0.12 * (1 - L),
        a = a0 * 0.95 + TONE[1] * w,
        b = b0 * 0.95 + TONE[2] * w,
        bay = BAYER[(y & 3) * 4 + ((x0 + x) & 3)],
        Lq = Math.floor(L * 14 + bay) / 14,
        C = Math.hypot(a, b),
        Cq = Math.round(C / 0.025) * 0.025,
        hq = Math.round(Math.atan2(b, a) / (Math.PI / 12)) * (Math.PI / 12),
        [r, g, bb] = fromOklab(Lq, Cq * Math.cos(hq), Cq * Math.sin(hq));
      rgba[o] = 255 * toSrgb(Math.min(1, Math.max(0, r)));
      rgba[o + 1] = 255 * toSrgb(Math.min(1, Math.max(0, g)));
      rgba[o + 2] = 255 * toSrgb(Math.min(1, Math.max(0, bb)));
    }
}
