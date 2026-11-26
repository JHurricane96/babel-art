// A world as a map: Strata's history (history.ts) redone in two dimensions, for Vista.
//
// A square of land (512 cells of 200 m: about 100 km a side) is stepped through its eras:
//
//   1. Tectonics: ranges rise along curving belts, the land swells and sags in broad plateaus and
//      basins, now and then a rift sinks or a volcano grows, and a coast may lie along one side.
//      Rock rises with the land, layers and all.
//   2. Water: rain runs downhill. Every cell drains to a neighbour, hollows fill as lakes that spill
//      over their lowest rim (Priority-Flood), and the water gathered from upstream is counted.
//   3. Erosion: rivers cut down in proportion to the water they carry and their slope (the
//      stream-power law, solved implicitly so long eras stay stable), soft rock faster than hard,
//      so river networks branch out by themselves and benches form where hard beds meet soft;
//      slopes steeper than rock can stand shed scree; lakes slowly fill with sediment.
//   4. Climate: warmth falls with height; rain comes in on one wind, rises over the mountains and
//      falls there, leaving their lee sides dry.
//
// At the end every cell has a height, whether it is sea or lake, the water passing through it, rain
// and warmth, the rock at its surface, and a biome. The rock layers are kept as the land lifted
// them, so a section through the world shows its strata as they lie: bent over the ranges, cut
// through by the valleys.
//
// Everything follows from the seed.
import { ROCK, ROCKS as HISTORY_ROCKS } from "./history";

export { ROCK };
/** Loose sediment on top (river gravel, lake silt, scree): not a rock of the layers. */
export const SEDIMENT = HISTORY_ROCKS.length;
/** The rocks: the strip history's, and loose sediment. */
export const ROCKS = [...HISTORY_ROCKS, { name: "Gravel and silt", k: 1.6, color: "#b9a77f" }];

// ---- Random and noise ------------------------------------------------------------------------
export function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(ix: number, iy: number, s: number) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number, s: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy),
    a = hash(ix, iy, s),
    b = hash(ix + 1, iy, s),
    c = hash(ix, iy + 1, s),
    d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, s: number, oct: number) {
  let t = 0,
    amp = 0.5,
    f = 1;
  for (let o = 0; o < oct; o++) {
    t += amp * vnoise(x * f, y * f, s + o * 131);
    f *= 2.03;
    amp *= 0.5;
  }
  return t / (1 - 0.5 ** oct);
}

// ---- The world ------------------------------------------------------------------------------
export const BIOME = {
  SEA: 0,
  LAKE: 1,
  SHORE: 2,
  MARSH: 3,
  MEADOW: 4,
  STEPPE: 5,
  BROADLEAF: 6,
  CONIFER: 7,
  ALPINE: 8,
  SCREE: 9,
  CLIFF: 10,
  SNOW: 11,
} as const;
export const BIOMES: { name: string; color: string }[] = [
  { name: "Sea", color: "#3e6f96" },
  { name: "Lake", color: "#4f87ad" },
  { name: "Shore", color: "#d8c896" },
  { name: "Marsh", color: "#6f8a5a" },
  { name: "Meadow", color: "#8fb055" },
  { name: "Dry grass", color: "#c2b46a" },
  { name: "Broadleaf wood", color: "#4c7a34" },
  { name: "Conifer wood", color: "#2f5440" },
  { name: "Alpine meadow", color: "#a4ac74" },
  { name: "Scree", color: "#a59c8c" },
  { name: "Cliff", color: "#7e786e" },
  { name: "Snow and ice", color: "#eef2f6" },
];

export interface Range {
  /** A curving belt: control points of a quadratic curve, in cells. */
  p: [number, number][];
  /** Half-width in cells, uplift rate at its crest (m/yr), and the share of history it is rising. */
  w: number;
  rate: number;
  from: number;
}
export interface WorldPlan {
  ranges: Range[];
  /** A sinking basin (a rift) and a volcano, if this world has them: centre and radius in cells. */
  rift: { x: number; y: number; r: number; rate: number } | null;
  volcano: { x: number; y: number; r: number; rate: number; from: number } | null;
  /** Which sides face the sea (0 none; bit 1 west, 2 east, 4 north, 8 south). */
  coast: number;
  /** Where the rain comes from (radians: 0 from the west), how warm the lowlands are (degrees C). */
  wind: number;
  warmth: number;
  /** The rock layers laid down before the ranges, oldest first: rock, and mean thickness (m). */
  layers: { rock: number; t: number }[];
  /** Plain words for what this world holds. */
  story: string[];
}
export interface World2D {
  seed: number;
  n: number;
  cell: number;
  plan: WorldPlan;
  /** Height above sea level (m). */
  h: Float32Array;
  /** Lake depth (m) where a lake stands, else 0; sea where sea[i] = 1. */
  lake: Float32Array;
  sea: Uint8Array;
  /** Where each cell drains (-1 off the map or into the sea), and the water that passes (m3/yr, rain-weighted area). */
  rec: Int32Array;
  flow: Float32Array;
  /** Rain (mm/yr) and mean warmth (degrees C). */
  rain: Float32Array;
  temp: Float32Array;
  /** Total uplift (m), loose sediment on top (m), the rock at the surface, the biome. */
  uplift: Float32Array;
  sed: Float32Array;
  rock: Uint8Array;
  biome: Uint8Array;
  /** Tops of the original layers before any uplift, layer by layer (m); layer k lies between tops k-1 and k. */
  tops: Float32Array[];
  /** How far the beds were folded up (or down) beyond the land's own uplift (m). */
  fold: Float32Array;
}

/** The rock layers' original top (m) at a cell, for every layer, from their mean thicknesses and the seed. */
function layerTops(plan: WorldPlan, seed: number, n: number) {
  const tops: Float32Array[] = [],
    total = plan.layers.reduce((a, l) => a + l.t, 0);
  let base: Float32Array | null = null;
  plan.layers.forEach((l, k) => {
    const t = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x,
          th = l.t * (0.45 + 1.1 * fbm(x / 90, y / 90, seed * 7 + k * 31, 3));
        t[i] = (base ? base[i] : -total) + th;
      }
    tops.push(t);
    base = t;
  });
  return tops;
}

export function planWorld(seed: number, n: number): WorldPlan {
  const R = mulberry(seed * 2654435761),
    story: string[] = [];
  // Ranges: one to three belts across the map.
  const nr = R() < 0.25 ? 1 : R() < 0.7 ? 2 : 3,
    ranges: Range[] = [];
  const edgePoint = (side: number): [number, number] => {
    const t = (0.15 + 0.7 * R()) * n;
    return side === 0 ? [-n * 0.1, t] : side === 1 ? [n * 1.1, t] : side === 2 ? [t, -n * 0.1] : [t, n * 1.1];
  };
  for (let k = 0; k < nr; k++) {
    const s0 = Math.floor(R() * 4);
    let s1 = Math.floor(R() * 4);
    if (s1 === s0) s1 = (s0 + 1 + Math.floor(R() * 3)) % 4;
    const a = edgePoint(s0),
      b = edgePoint(s1),
      mid: [number, number] = [(a[0] + b[0]) / 2 + (R() - 0.5) * n * 0.5, (a[1] + b[1]) / 2 + (R() - 0.5) * n * 0.5];
    const main = k === 0;
    ranges.push({ p: [a, mid, b], w: n * (main ? 0.11 + 0.06 * R() : 0.06 + 0.05 * R()), rate: main ? 0.45e-3 + 0.3e-3 * R() : 0.22e-3 + 0.25e-3 * R(), from: main ? 0 : 0.2 + 0.4 * R() });
  }
  story.push(nr === 1 ? "one mountain range" : `${nr} mountain ranges, the first the highest`);
  const rift = R() < 0.35 ? { x: n * (0.25 + 0.5 * R()), y: n * (0.25 + 0.5 * R()), r: n * (0.06 + 0.06 * R()), rate: -(0.25e-3 + 0.3e-3 * R()) } : null;
  if (rift) story.push("a sinking basin");
  const volcano = R() < 0.3 ? { x: n * (0.2 + 0.6 * R()), y: n * (0.2 + 0.6 * R()), r: n * (0.02 + 0.015 * R()), rate: 1.2e-3 + 0.8e-3 * R(), from: 0.6 + 0.2 * R() } : null;
  if (volcano) story.push("a young volcano");
  const c = R();
  const coast = c < 0.4 ? 0 : 1 << Math.floor(R() * 4);
  story.push(coast ? `the sea to the ${["west", "east", "north", "south"][Math.log2(coast)]}` : "no sea, only lakes");
  const wind = R() * Math.PI * 2,
    warmth = 7 + 8 * R();
  story.push(`rain on the wind from the ${["west", "south-west", "south", "south-east", "east", "north-east", "north", "north-west"][Math.round((((wind / (Math.PI * 2)) * 8) % 8 + 8) % 8) % 8]}`);
  // Rock laid down before the ranges: a basement, then beds of sediment.
  const beds = [ROCK.SANDSTONE, ROCK.SHALE, ROCK.LIMESTONE, ROCK.REDBED, ROCK.MUDSTONE, ROCK.CONGLOMERATE, ROCK.LIMESTONE, ROCK.SHALE, ROCK.SANDSTONE],
    layers: { rock: number; t: number }[] = [{ rock: ROCK.BASEMENT, t: 6000 }];
  const nb = 7 + Math.floor(R() * 3);
  for (let k = 0; k < nb; k++) {
    const rock = beds[Math.floor(R() * beds.length)];
    layers.push({ rock, t: rock === ROCK.LIMESTONE ? 250 + 450 * R() : rock === ROCK.SHALE || rock === ROCK.MUDSTONE ? 150 + 350 * R() : 150 + 400 * R() });
    if (R() < 0.12) layers.push({ rock: ROCK.COAL, t: 20 + 30 * R() });
  }
  return { ranges, rift, volcano, coast, wind, warmth, layers, story };
}

/** Distance from (x, y) to a quadratic curve, and where along it (0..1), by sampling. */
function curveDist(p: [number, number][], x: number, y: number) {
  let best = 1e18,
    bt = 0;
  for (let k = 0; k <= 48; k++) {
    const t = k / 48,
      u = 1 - t,
      cx = u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0],
      cy = u * u * p[0][1] + 2 * u * t * p[1][1] + t * t * p[2][1],
      d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < best) {
      best = d;
      bt = t;
    }
  }
  return { d: Math.sqrt(best), t: bt };
}

export interface WorldOptions {
  n?: number;
  cell?: number;
  eras?: number;
  /** Years per era. */
  dt?: number;
  progress?: (f: number) => void;
}

export function generateWorld(seed: number, o: WorldOptions = {}): World2D {
  const n = o.n ?? 512,
    cell = o.cell ?? (512 * 200) / n,
    eras = o.eras ?? 60,
    dt = o.dt ?? 6e4,
    N = n * n,
    plan = planWorld(seed, n),
    s = (v: number) => (v * n) / 512; // a length given for a 512 map, in this map's cells
  // ---- Uplift: the ranges, the broad swells, the rift and the volcano (m/yr; by era fraction). ----
  const fold = new Float32Array(N),
    rangeU = new Float32Array(N * plan.ranges.length),
    swell = new Float32Array(N),
    riftU = new Float32Array(N),
    volU = new Float32Array(N);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      plan.ranges.forEach((r, k) => {
        const { d, t } = curveDist(r.p, x, y),
          // A crest that wanders, peaks along it, and spurs off its flanks.
          wob = r.w * (0.75 + 0.5 * fbm(t * 6, k * 3.7, seed + 11 + k, 3)),
          core = Math.exp(-((d / wob) ** 2)),
          // High massifs and low saddles along the crest; spurs and peaks across it.
          crest = 0.45 + 0.85 * fbm(t * 5, k * 5.3, seed + 15 + k, 2),
          peaks = 0.6 + 0.75 * fbm(x / s(40), y / s(40), seed + 21 + k, 4) + 0.3 * (fbm(x / s(14), y / s(14), seed + 25 + k, 2) - 0.5);
        rangeU[k * N + i] = r.rate * core * peaks * crest;
        // The beds under a range buckle into folds across it, strongest in its core.
        fold[i] += r.rate * 1.6e6 * core * Math.sin((d * cell) / (5500 + 3000 * hash(k, 3, seed)) * Math.PI * 2 + k * 2.1 + 0.6 * Math.sin(t * 9 + k));
      });
      // The whole land rises a little (so rivers cut valleys everywhere), more in broad swells.
      swell[i] = 0.12e-3 + 0.3e-3 * fbm(x / s(200), y / s(200), seed + 31, 3) + 0.1e-3 * (fbm(x / s(55), y / s(55), seed + 33, 3) - 0.5);
      if (plan.rift) {
        const d = Math.hypot(x - plan.rift.x, (y - plan.rift.y) * 1.6) / plan.rift.r;
        riftU[i] = plan.rift.rate * Math.exp(-(d ** 4));
      }
      if (plan.volcano) {
        const d = Math.hypot(x - plan.volcano.x, y - plan.volcano.y) / plan.volcano.r;
        volU[i] = plan.volcano.rate * Math.exp(-(d ** 2)) + plan.volcano.rate * 0.15 * Math.exp(-((d / 3) ** 2));
      }
    }
  // ---- The land at the start: a low plain, sloping under the sea where a coast lies. ----
  const h = new Float64Array(N),
    seaSide = (x: number, y: number) => {
      let c = 0;
      const u = x / n,
        v = y / n;
      if (plan.coast & 1) c = Math.max(c, 1 - u);
      if (plan.coast & 2) c = Math.max(c, u);
      if (plan.coast & 4) c = Math.max(c, 1 - v);
      if (plan.coast & 8) c = Math.max(c, v);
      return c;
    };
  const coastU = new Float32Array(N);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        c = seaSide(x, y),
        // A coastline that wanders: bays, headlands, a peninsula or an island here and there.
        bend = 0.32 * (fbm(x / s(130), y / s(130), seed + 41, 3) - 0.5) + 0.12 * (fbm(x / s(36), y / s(36), seed + 45, 3) - 0.5);
      h[i] = 250 + 150 * fbm(x / s(120), y / s(120), seed + 43, 4) - (c > 0 ? 2400 * Math.max(0, c - 0.62 + bend) : 0);
      // The coast keeps sinking a little, so the ranges do not push the sea off the map.
      coastU[i] = c > 0 ? -1.4e-3 * Math.max(0, c - 0.62 + bend) : 0;
    }
  const tops = layerTops(plan, seed, n),
    uplift = new Float32Array(N),
    sed = new Float32Array(N),
    rock = new Uint8Array(N),
    kRock = new Float32Array(N);
  const surfaceRock = () => {
    for (let i = 0; i < N; i++) {
      if (sed[i] > 2) {
        rock[i] = SEDIMENT;
        kRock[i] = 1.6;
        continue;
      }
      const z = h[i] - uplift[i] - fold[i];
      let k = 0;
      while (k < tops.length - 1 && tops[k][i] < z) k++;
      const r = plan.layers[k].rock;
      rock[i] = plan.volcano && volU[i] > plan.volcano.rate * 0.05 && uplift[i] > 200 ? ROCK.BASALT : r;
      kRock[i] = ROCKS[rock[i]].k;
    }
  };
  // ---- Climate (also steers erosion: wet slopes wear faster). ----
  const rain = new Float32Array(N).fill(900),
    temp = new Float32Array(N),
    wx = Math.cos(plan.wind),
    wy = Math.sin(plan.wind);
  // Cells in the order the wind reaches them.
  const order = new Int32Array(N);
  {
    const key = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      order[i] = i;
      key[i] = (i % n) * wx + Math.floor(i / n) * wy;
    }
    order.sort((a, b) => key[a] - key[b]);
  }
  const sea = new Uint8Array(N);
  const climate = () => {
    const M = new Float32Array(N),
      P = new Float32Array(N),
      upwindSea = (plan.coast & 1 && wx > 0.3) || (plan.coast & 2 && wx < -0.3) || (plan.coast & 4 && wy > 0.3) || (plan.coast & 8 && wy < -0.3);
    // Moist air comes in on the wind; it rains a steady amount over the lowlands, much more where the
    // air is forced up a slope, and what rains out is gone, so the lee of a range is dry. Land gives
    // a little back (plants, lakes), so the air dries only slowly over plains.
    // Per kilometre the air dries a little, regains some over land (plants, lakes) and more over the
    // sea, and loses much more where it climbs.
    const step = (1.5 * cell) / 1000;
    for (const i of order) {
      const x = i % n,
        y = Math.floor(i / n),
        fx = x - wx * 1.5,
        fy = y - wy * 1.5,
        inside = fx >= 0 && fy >= 0 && fx <= n - 1 && fy <= n - 1,
        here = Math.max(0, h[i]);
      let m: number, up: number;
      if (inside) {
        // Bilinear, so the wind carries no stripes.
        const x0 = Math.min(n - 2, Math.floor(fx)),
          y0 = Math.min(n - 2, Math.floor(fy)),
          tx = fx - x0,
          ty = fy - y0,
          a = y0 * n + x0,
          lerp = (A: ArrayLike<number>, f: (v: number) => number) =>
            (f(A[a]) * (1 - tx) + f(A[a + 1]) * tx) * (1 - ty) + (f(A[a + n]) * (1 - tx) + f(A[a + n + 1]) * tx) * ty;
        m = lerp(M, (v) => v);
        up = lerp(h, (v) => Math.max(0, v));
      } else {
        m = upwindSea ? 1 : 0.85;
        up = here;
      }
      const oro = Math.min(2.5, (Math.max(0, here - up) / (cell * 1.5)) * 12);
      P[i] = m * (1 + oro);
      M[i] = Math.min(1.1, Math.max(0.3, m + step * (-0.002 + (sea[i] ? 0.012 : 0.0045) - 0.016 * oro)));
    }
    // Smoothed: rain falls over a stretch, not on one cell.
    let a = P,
      b = new Float32Array(N);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          let t = 0,
            c = 0;
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx,
                yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              t += a[yy * n + xx];
              c++;
            }
          b[y * n + x] = t / c;
        }
      [a, b] = [b, a];
    }
    for (let i = 0; i < N; i++) {
      rain[i] = 100 + 900 * a[i];
      temp[i] = plan.warmth - 0.0065 * Math.max(0, h[i]) - 1.5 * (Math.floor(i / n) / n - 0.5);
    }
  };
  // ---- Water: sea, drainage, lakes (Priority-Flood with epsilon; Barnes et al. 2014). ----
  const filled = new Float64Array(N),
    rec = new Int32Array(N),
    stack = new Int32Array(N),
    state = new Uint8Array(N),
    heapK = new Float64Array(N),
    heapI = new Int32Array(N),
    pit = new Int32Array(N),
    flow = new Float32Array(N);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1],
    DY = [0, 0, 1, -1, 1, -1, 1, -1],
    DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  let hn = 0;
  const push = (k: number, i: number) => {
    let c = hn++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapK[p] <= k) break;
      heapK[c] = heapK[p];
      heapI[c] = heapI[p];
      c = p;
    }
    heapK[c] = k;
    heapI[c] = i;
  };
  const pop = () => {
    const top = heapI[0],
      k = heapK[--hn],
      i = heapI[hn];
    let c = 0;
    for (;;) {
      let m = 2 * c + 1;
      if (m >= hn) break;
      if (m + 1 < hn && heapK[m + 1] < heapK[m]) m++;
      if (heapK[m] >= k) break;
      heapK[c] = heapK[m];
      heapI[c] = heapI[m];
      c = m;
    }
    heapK[c] = k;
    heapI[c] = i;
    return top;
  };
  const route = () => {
    // The sea: below sea level and joined to an edge below it.
    sea.fill(0);
    let qn = 0;
    for (let x = 0; x < n; x++)
      for (const y of [0, n - 1])
        for (const i of [y * n + x, x * n + y])
          if (h[i] < 0 && !sea[i]) {
            sea[i] = 1;
            pit[qn++] = i;
          }
    for (let q = 0; q < qn; q++) {
      const i = pit[q],
        x = i % n,
        y = (i / n) | 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d],
          yy = y + DY[d];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx;
        if (!sea[j] && h[j] < 0) {
          sea[j] = 1;
          pit[qn++] = j;
        }
      }
    }
    // Outlets: the sea and the edges. Then everything else, lowest first.
    state.fill(0);
    hn = 0;
    for (let i = 0; i < N; i++) {
      const x = i % n,
        y = (i / n) | 0;
      if (sea[i] || x === 0 || y === 0 || x === n - 1 || y === n - 1) {
        filled[i] = sea[i] ? Math.min(0, h[i]) : h[i];
        state[i] = 1;
        push(filled[i], i);
      }
    }
    let sn = 0,
      ph = 0,
      pt = 0;
    while (hn > 0 || ph < pt) {
      const c = ph < pt ? pit[ph++] : pop();
      state[c] = 2;
      stack[sn++] = c;
      const x = c % n,
        y = (c / n) | 0;
      // Drains to the steepest neighbour already settled (so always one nearer the outlet).
      let best = -1,
        bs = 0;
      if (!sea[c] && x > 0 && y > 0 && x < n - 1 && y < n - 1)
        for (let d = 0; d < 8; d++) {
          const j = (y + DY[d]) * n + x + DX[d];
          if (state[j] !== 2 || j === c) continue;
          const sl = (filled[c] - filled[j]) / DD[d];
          if (best < 0 || sl > bs) {
            best = j;
            bs = sl;
          }
        }
      rec[c] = best;
      for (let d = 0; d < 8; d++) {
        const xx = x + DX[d],
          yy = y + DY[d];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx;
        if (state[j]) continue;
        state[j] = 1;
        if (h[j] <= filled[c] + 1e-3) {
          filled[j] = filled[c] + 1e-3;
          pit[pt++] = j;
        } else {
          filled[j] = h[j];
          push(h[j], j);
        }
      }
    }
    // Water gathered from upstream, weighted by rain.
    for (let i = 0; i < N; i++) flow[i] = cell * cell * Math.min(2.5, Math.max(0.15, (rain[i] - 150) / 800));
    for (let k = N - 1; k >= 0; k--) {
      const c = stack[k];
      if (rec[c] >= 0) flow[rec[c]] += flow[c];
    }
  };
  // ---- Eras. ----
  const K = 6e-6,
    m = 0.45,
    talus = 0.85;
  for (let e = 0; e < eras; e++) {
    const f = e / eras;
    // Uplift.
    for (let i = 0; i < N; i++) {
      let u = swell[i] + riftU[i] + coastU[i];
      plan.ranges.forEach((r, k) => {
        if (f >= r.from) u += rangeU[k * N + i] * Math.min(1, (f - r.from) * 6 + 0.3);
      });
      if (plan.volcano && f >= plan.volcano.from) u += volU[i];
      const x = i % n,
        y = (i / n) | 0;
      if (x === 0 || y === 0 || x === n - 1 || y === n - 1) u = 0;
      h[i] += u * dt;
      uplift[i] += u * dt;
    }
    if (e % 6 === 0) climate();
    surfaceRock();
    route();
    // Rivers cut down (implicit stream power), receivers first.
    for (let k = 0; k < N; k++) {
      const c = stack[k],
        r = rec[c];
      if (r < 0 || sea[c]) continue;
      if (filled[c] > h[c] + 0.5) {
        // Under a lake: it fills with sediment instead.
        const add = Math.min(filled[c] - h[c], 2e-5 * dt);
        h[c] += add;
        sed[c] += add;
        continue;
      }
      const d = Math.hypot((c % n) - (r % n), ((c / n) | 0) - ((r / n) | 0)) * cell,
        fk = (K * (0.35 + 0.65 * kRock[c]) * dt * flow[c] ** m) / d,
        hr = Math.max(h[r], filled[r] > h[r] + 0.5 ? filled[r] : h[r]),
        nh = (h[c] + fk * hr) / (1 + fk);
      if (nh < h[c]) {
        const cut = h[c] - Math.max(nh, hr);
        if (cut > 0) {
          h[c] -= cut;
          sed[c] = Math.max(0, sed[c] - cut);
        }
      }
    }
    // Slopes steeper than rock stands shed scree onto the cell below.
    for (let pass = 0; pass < 2; pass++)
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          const i = y * n + x;
          for (let d = 0; d < 8; d += 1) {
            const j = (y + DY[d]) * n + x + DX[d],
              lim = talus * cell * DD[d],
              dh = h[i] - h[j];
            if (dh > lim) {
              const mv = (dh - lim) * 0.25;
              h[i] -= mv;
              h[j] += mv;
              sed[j] += mv;
              sed[i] = Math.max(0, sed[i] - mv);
            }
          }
        }
    // The edges follow the land inside them, a little lower, so rivers leave the map.
    for (let k = 0; k < n; k++)
      for (const [a, b] of [[k, n + k], [(n - 1) * n + k, (n - 2) * n + k], [k * n, k * n + 1], [k * n + n - 1, k * n + n - 2]]) if (h[b] >= 0) h[a] = Math.min(h[a], h[b] - 2) * 0.5 + (h[b] - 2) * 0.5;
    o.progress?.((e + 1) / (eras + 2));
  }
  climate();
  surfaceRock();
  route();
  // ---- Lakes, biomes. ----
  const lake = new Float32Array(N),
    biome = new Uint8Array(N),
    hh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hh[i] = h[i];
    lake[i] = !sea[i] && filled[i] - h[i] > 1 ? filled[i] - h[i] : 0;
  }
  const slopeAt = (i: number) => {
    const x = i % n,
      y = (i / n) | 0,
      gx = (h[y * n + Math.min(n - 1, x + 1)] - h[y * n + Math.max(0, x - 1)]) / (2 * cell),
      gy = (h[Math.min(n - 1, y + 1) * n + x] - h[Math.max(0, y - 1) * n + x]) / (2 * cell);
    return Math.hypot(gx, gy);
  };
  // Distance to the sea, in cells (for the shore).
  const toSea = new Float32Array(N).fill(1e9);
  {
    let q: number[] = [];
    for (let i = 0; i < N; i++) if (sea[i]) (toSea[i] = 0), q.push(i);
    for (let r = 1; r <= 3 && q.length; r++) {
      const nq: number[] = [];
      for (const i of q) {
        const x = i % n,
          y = (i / n) | 0;
        for (let d = 0; d < 8; d++) {
          const xx = x + DX[d],
            yy = y + DY[d];
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const j = yy * n + xx;
          if (toSea[j] > r) (toSea[j] = r), nq.push(j);
        }
      }
      q = nq;
    }
  }
  for (let i = 0; i < N; i++) {
    const x = i % n,
      y = (i / n) | 0,
      t = temp[i],
      p = rain[i],
      sl = slopeAt(i),
      patch = fbm(x / s(14), y / s(14), seed + 71, 3);
    let b: number;
    if (sea[i]) b = BIOME.SEA;
    else if (lake[i] > 0) b = BIOME.LAKE;
    else if (t < -9 + 2 * (patch - 0.5) && sl < 0.9) b = BIOME.SNOW;
    else if (sl > 1.0) b = BIOME.CLIFF;
    else if (t < -1.5 + 1.5 * (patch - 0.5)) b = sl > 0.55 ? BIOME.SCREE : BIOME.ALPINE;
    else if (toSea[i] <= 1 && h[i] < 8) b = BIOME.SHORE;
    else if (sl < 0.012 && p > 950 && flow[i] > 2e8 && h[i] < 400) b = BIOME.MARSH;
    else if (p < 420 + 120 * (patch - 0.5)) b = BIOME.STEPPE;
    else if (sl > 0.7) b = BIOME.SCREE;
    else if (p < 640 + 200 * (patch - 0.5) || patch > 0.74) b = BIOME.MEADOW;
    else b = t < 3 + 2 * (patch - 0.5) ? BIOME.CONIFER : BIOME.BROADLEAF;
    biome[i] = b;
  }
  o.progress?.(1);
  return { seed, n, cell, plan, h: hh, lake, sea, rec, flow, rain, temp, uplift, sed, rock, biome, tops, fold };
}

/** The rock at a point of a section: at elevation z (m) under cell i. */
export function rockAt(w: World2D, i: number, z: number) {
  const top = w.h[i];
  if (z > top) return -1;
  if (z > top - w.sed[i] && w.sed[i] > 2) return SEDIMENT;
  const z0 = z - w.uplift[i] - w.fold[i];
  let k = 0;
  while (k < w.tops.length - 1 && w.tops[k][i] < z0) k++;
  return w.plan.layers[k].rock;
}
