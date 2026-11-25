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
/** Scratch colours (no allocation per pixel). */
const WR = [0, 0, 0],
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
  DAY = hex("#fff8ee");
const STREAM = ["#4f9ab4", "#cfe9f2", "#e0f4fa"].map(hex),
  FALLS = ["#bfe3f0", "#7fb8d0", "#f4fbfd"].map(hex),
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
    if (rope || held === 0 || held > 0.3 * comp.length) continue; // stays still: all 1s
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
  { W, H, cells, state, surface, x0, seed = 0, flora, rows }: Land,
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
        below = y - reach[x];
      // In daylight the cut face is lit near the ground, dimming with depth
      // to a low glow, never quite black.
      // Above the valley floors the land dims only slowly with depth.
      // (Continuous: 0.3 per row down to the floor, 1 per row below it.)
      const top = reach[x],
        fl = Math.max(floor[x], top),
        dim = 0.3 * Math.max(0, Math.min(y, fl) - top) + Math.max(0, y - fl);
      cut = dim <= 4 ? 0.95 : 0.95 * (0.3 + 0.7 * Math.exp(-(dim - 4) / 85));
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
        const into = d < near[x] ? near[x] - d : d < far[x] ? far[x] - d : -1;
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
          const landing = y + 3 < H && cells[i + 3 * W] !== M.FALLS;
          c = landing ? FALLS[2] : fall.at(wx) < 0.42 ? FALLS[1] : FALLS[0];
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
        const
          seam =
            y > 0 &&
            cells[i - W] === M.ROCK &&
            bandOf(state[i - W]) !== bandOf(st),
          // Basalt cools into columns: dark joints every few cells.
          joint = bandOf(st) === 2 && wx % 5 === 0,
          tex =
            (1 + (0.05 * ((h & 3) - 1.5)) / 1.5 + 0.12 * (mottle - 0.5)) *
            ((h >>> 8) % 97 === 0 ? 1.25 : 1) *
            (seam ? 0.8 : 1) *
            (joint ? 0.78 : 1);
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
                  ? pal.grass
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
          }
          const c =
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
            if (skyCell && SILHOUETTE[m]) {
              // A plant in the open: daylight from above, its own shade under
              // its leaves, in two steps.
              const k = y > 0 && isOpen(cells[i - W]) ? 1.04 : 0.84;
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
            const amb = cut * (1 + 0.7 * edge);
            lr += amb * AMB[0];
            lg += amb * AMB[1];
            lb += amb * AMB[2];
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
        } else if (m === M.AIR && skyCell) c = MOTION.SKY;
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
  lap("shade");
  return rgba;
}
