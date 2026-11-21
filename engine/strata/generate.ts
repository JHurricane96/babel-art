// Strata region generator, loop 1: two biomes and the transition between them.
//
// A region is REGION_W x WORLD_H cells generated from (seed, region index)
// alone, so any region can be rebuilt on demand and saves only need what the
// simulation later changes. Everything is decided in world coordinates: a
// region is cut from a wider window (MARGIN cells either side) so tunnels,
// pools, trees and mushrooms that straddle a region edge come out the same
// from both sides.
//
// The land is built in passes:
//   1. ground height, blending the two biomes' shapes across a band at the edge;
//   2. rock in horizontal strata of uneven thickness, with each stratum changing
//      biome at its own place inside the band, so layers interfinger;
//   3. caves from noise: wide caverns, sparse meandering tunnels, and a few
//      sinkhole shafts that open to the sky;
//   4. a lake in the highlands' basin, then pools and deep lava that fill only
//      true hollows, a row at a time from the bottom up;
//   5. trees and giant mushrooms on the surface; moss, fungi, glowing vines,
//      stalactites and crystals in the caves.
import {
  GLOW,
  M,
  REGION_W,
  WORLD_H,
  fbm1,
  fbm2,
  hash3,
  lerp,
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
  /** 0-1: how strongly the ground breaks into ledges and cliffs. */
  terrace: number;
  /** Typical cliff height, cells. */
  terraceStep: number;
  /** 0-1: whether the region holds a lake basin. */
  basin: number;
  /** 0-1: how much of the deep rock opens into caverns. */
  cavern: number;
  /** Cavern noise wavelength, x then y, cells: wide and low or small and round. */
  cavernX: number;
  cavernY: number;
  /** 0-1: how many meandering tunnels. */
  tunnels: number;
  /** Expected sinkhole shafts per region. */
  sinkholes: number;
  /** 0-1: share of cave hollows that hold pools. */
  wet: number;
  soil: number;
  /** Surface plants per column: pines, broad trees, giant mushrooms. */
  pines: number;
  broad: number;
  shrooms: number;
  /** 0-1 cave life: moss and fungi, glowing vines, stone spikes, crystals. */
  fungus: number;
  vines: number;
  spikes: number;
  crystals: number;
  /** Ground higher than this (smaller y) carries snow; 0 = never. */
  snowline: number;
}

export const BIOMES: Biome[] = [
  {
    id: "highlands",
    name: "Cliffs over a lake",
    base: 540,
    amp: 170,
    detail: 0.3,
    terrace: 0.9,
    terraceStep: 54,
    basin: 1,
    cavern: 0.15,
    cavernX: 190,
    cavernY: 80,
    tunnels: 0.8,
    sinkholes: 0.8,
    wet: 0.35,
    soil: 8,
    pines: 0.06,
    broad: 0.004,
    shrooms: 0,
    fungus: 0.08,
    vines: 0,
    spikes: 0.8,
    crystals: 0.7,
    snowline: 430,
  },
  {
    id: "fungal",
    name: "Fungal caverns",
    base: 600,
    amp: 60,
    detail: 0.35,
    terrace: 0.05,
    terraceStep: 40,
    basin: 0,
    cavern: 0.9,
    cavernX: 270,
    cavernY: 110,
    tunnels: 0.35,
    sinkholes: 2,
    wet: 0.6,
    soil: 6,
    pines: 0,
    broad: 0.014,
    shrooms: 0.012,
    fungus: 1,
    vines: 1,
    spikes: 0.1,
    crystals: 0.1,
    snowline: 0,
  },
];

/** Half-width of the band over which neighbouring regions blend, in cells. */
export const BLEND = 400;
/** Cells generated either side of a region so features crossing its edges agree. */
export const MARGIN = 256;
/** Widest air gap a pool may span; must stay well under MARGIN. */
const MAX_POOL = 150;
/** Below this, hollows fill with lava rather than water. */
const LAVA_LINE = WORLD_H - 240;
type Params = Record<Exclude<keyof Biome, "id" | "name">, number>;
const NUMERIC = Object.keys(BIOMES[0]).filter(
  (k) => k !== "id" && k !== "name",
) as (keyof Params)[];

/** Loop 1: the two biomes alternate, so every panorama shows transitions. */
export function regionBiome(seed: number, r: number) {
  return (((r + (hash3(seed, 7, 0) < 0.5 ? 0 : 1)) % 2) + 2) % 2;
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

function basinOf(seed: number, r: number) {
  if (!BIOMES[regionBiome(seed, r)].basin) return null;
  const c = r * REGION_W + REGION_W * (0.3 + 0.4 * hash3(r, 11, seed)),
    w = REGION_W * (0.12 + 0.07 * hash3(r, 12, seed)),
    depth = 70 + 70 * hash3(r, 13, seed);
  return { c, w, depth };
}

/** Ground height (cells from the top) at world column x, before caves. */
export function groundAt(seed: number, x: number) {
  const { p } = paramsAt(seed, x);
  const n =
    (fbm1(x / 600, seed + 1) - 0.5) * 2 * p.amp +
    (fbm1(x / 110, seed + 2) - 0.5) * 2 * p.amp * p.detail;
  // Ledges: the height is snapped toward steps whose size drifts along the land,
  // so cliffs come in different heights rather than one repeated stair.
  const hs = p.base + n,
    step = p.terraceStep * (0.7 + 0.6 * fbm1(x / 900, seed + 3)),
    k = hs / step,
    fi = Math.floor(k),
    terr = (fi + smoothstep(0.8, 1, k - fi)) * step;
  const basin = basinOf(seed, Math.floor(x / REGION_W));
  let bowl = 0;
  if (basin) bowl = smoothstep(1, 0.35, Math.abs(x - basin.c) / basin.w);
  let h = lerp(hs, terr, p.terrace * (1 - bowl));
  // A flat-bottomed basin with gently shelving sides and an uneven bed.
  if (bowl > 0)
    h += basin!.depth * bowl * (1 + 0.25 * (fbm1(x / 50, seed + 4) - 0.5));
  return Math.max(200, Math.min(WORLD_H - 420, h));
}

/**
 * The lake in a basin: its surface sits just below the lower of the two highest
 * points either side of the basin, so it is held in on both sides wherever the
 * land around the bowl rises and falls. Returns the level (cells from the top)
 * and the stretch of columns between those two high points.
 */
function lakeOf(seed: number, basin: { c: number; w: number }) {
  let left = Infinity,
    xl = 0,
    right = Infinity,
    xr = 0;
  for (let x = Math.round(basin.c); x >= basin.c - 1.4 * basin.w; x--) {
    const g = groundAt(seed, x);
    if (g < left) [left, xl] = [g, x];
  }
  for (let x = Math.round(basin.c); x <= basin.c + 1.4 * basin.w; x++) {
    const g = groundAt(seed, x);
    if (g < right) [right, xr] = [g, x];
  }
  return { level: Math.round(Math.max(left, right)) + 3, x0: xl, x1: xr };
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
  const top = new Int32Array(2400),
    R = walkRandom(Math.floor(hash3(seed, 5, 5) * 4294967296));
  let k = 0,
    left = 0;
  for (let u = 0; u < top.length; u++) {
    if (left <= 0) {
      k++;
      const r = R();
      left =
        r < 0.25 ? 4 + Math.floor(R() * 6) : 12 + Math.floor(R() * R() * 46);
    }
    top[u] = k;
    left--;
  }
  return top;
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
  const table = strataTable(seed);
  for (let x = 0; x < WW; x++) {
    const wx = X0 + x,
      p = params[x],
      { left, right, past } = edges[x],
      s = surface[x],
      slope = Math.abs(ground[x + 4] - ground[x]),
      soil = Math.round(p.soil * Math.max(0, 1 - slope / 10)),
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
            table.length - 1,
            Math.round(
              y +
                300 +
                fold +
                30 * (fbm2(wx / 260, y / 160, seed + 6, 2) - 0.5) * 2,
            ),
          ),
        ),
        k = table[u];
      let biome = past > 0 ? br : bl;
      if (bl !== br && Math.abs(past) < BLEND) {
        const shift = (hash3(k, left, seed + 23) - 0.5) * 1.5 * BLEND,
          wob =
            past + shift + 50 * (fbm2(wx / 70, y / 50, seed + 21, 2) - 0.5) * 2;
        biome = wob > 0 ? br : bl;
      }
      state[i] = stateOf(k & 15, biome);
      if (y >= bedrock) cells[i] = M.BEDROCK;
      else if (depth === 0)
        cells[i] = snowy ? M.SNOW : soil > 0 ? M.GRASS : M.ROCK;
      else if (snowy && depth < 3) cells[i] = M.SNOW;
      else if (depth < soil) cells[i] = M.SOIL;
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
    const { level, x0: lx0, x1: lx1 } = lakeOf(seed, basin);
    for (let wx = lx0 + 1; wx < lx1; wx++) {
      const x = wx - X0;
      if (x < 0 || x >= WW || surface[x] <= level) continue; // dry land above the waterline
      for (let y = level; y < surface[x]; y++)
        if (cells[y * WW + x] === M.AIR) cells[y * WW + x] = M.WATER;
      // A sealed bed: sand at the shore, gravel deeper; no cave breaks through it.
      const shore = surface[x] - level < 8;
      for (let y = surface[x]; y < Math.min(H, surface[x] + 12); y++) {
        const i = y * WW + x;
        if (cells[i] === M.BEDROCK) break;
        if (y < surface[x] + 5 || cells[i] === M.AIR)
          cells[i] = shore ? M.SAND : M.GRAVEL;
      }
    }
  }
  fillHollows(cells, WW, H, X0, seed, params, surface);

  // 5. Life on the surface: decided per world column, mixed by the blended densities.
  for (let x = 0; x < WW; x++) {
    const wx = X0 + x,
      p = params[x],
      s = surface[x],
      si = s * WW + x;
    if (cells[si] !== M.GRASS && cells[si] !== M.SNOW && cells[si] !== M.SOIL)
      continue;
    if (cells[si - WW] !== M.AIR) continue;
    const slope = Math.abs(
      ground[Math.min(WW + 3, x + 5)] - ground[Math.max(0, x - 1)],
    );
    const h = hash3(wx, 31, seed);
    const R = walkRandom(Math.floor(hash3(wx, 32, seed) * 4294967296));
    if (slope < 6 && h < p.pines)
      pine(cells, WW, x, s, R, cells[si] === M.SNOW);
    else if (slope < 5 && h < p.pines + p.broad)
      broadTree(cells, WW, x, s, R, wx, seed);
    else if (slope < 4 && h < p.pines + p.broad + p.shrooms)
      mushroom(cells, state, WW, x, s - 1, wx, seed, R, 1.5);
    else if (cells[si] === M.GRASS && hash3(wx, 33, seed) < 0.3) {
      // Tufts of grass along the skyline.
      const tall = 1 + Math.floor(hash3(wx, 34, seed) * 3);
      for (let k = 1; k <= tall; k++)
        if (cells[si - k * WW] === M.AIR) cells[si - k * WW] = M.GRASS;
    }
  }

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
          );
        } else if (h > 0.6 && h < 0.6 + 0.004 * p.crystals)
          crystals(cells, state, WW, x, y, -1, wx, seed);
      } else if (above === M.ROCK || above === M.SOIL) {
        const h = hash3(wx, y, seed + 65);
        if (
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
            lava = y > LAVA_LINE;
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

function put(cells: Uint8Array, WW: number, x: number, y: number, m: number) {
  if (x < 0 || x >= WW || y < 0 || y >= WORLD_H) return false;
  const i = y * WW + x;
  if (cells[i] !== M.AIR) return false;
  cells[i] = m;
  return true;
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
      const thick = stalk > 26 ? 2 : 1;
      for (let k = 0; k < stalk; k++)
        for (let t = 0; t < thick; t++) cells[(y - k) * WW + x + t] = M.STALK;
      for (let r = 0; r < ch; r++) {
        const f = (ch - r) / ch,
          half = Math.floor(cap * Math.sqrt(1 - f * f * f));
        for (let dx = -half; dx <= half; dx++) {
          const i = (top - ch + r) * WW + x + dx;
          if (cells[i] !== M.AIR) continue;
          cells[i] = M.CAP;
          // A glowing rim under the cap and a few glowing spots on top.
          if (r === ch - 1 || hash3(wx + dx, top - ch + r, seed + 64) < 0.04)
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
) {
  const st = state[y * WW + x - dir * WW] & 0x7f,
    width = len > 10 ? 2 : len > 5 ? 1 : 0;
  for (let k = 0; k < len; k++) {
    const half = Math.round(width * (1 - k / len));
    for (let d = -half; d <= half; d++) {
      const yy = y + dir * k;
      if (put(cells, WW, x + d, yy, M.ROCK)) state[yy * WW + x + d] = st;
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
