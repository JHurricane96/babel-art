// World history for Strata: a finite world, stepped through its eras.
//
// The world is a side-on strip, so its history runs along one line plus
// height. It is cut into coarse columns (CELL art pixels wide); each column
// holds a basement top and a stack of rock layers above it. Each era:
//
//   1. Tectonics: ranges rise (folding as they go), rifts sink between faults,
//      volcanic arcs swell and erupt, molten rock pushes up as plutons, and
//      the world's two ends sag into ocean.
//   2. Climate: warmth along the world (its own curve, a global swing over
//      time, colder with height) and rain carried on the wind, wrung out over
//      mountains so their lee sides are dry.
//   3. Water: rain runs downhill; hollows fill as lakes, or as salt flats
//      where the climate dries them faster than rivers fill them.
//   4. Erosion and deposition: rain and slope wear rock away, soft rock much
//      faster than hard; the sediment is carried downstream and laid down
//      where the land flattens, in lakes and in the sea, as a layer that
//      records where and when it formed (sand on beaches, shale offshore,
//      red mud in dry plains, till under ice). Warm shallow seas grow
//      limestone and warm swamps grow coal where they are.
//
// Everything is decided from the seed. Elevations are art pixels above the
// final era's sea level; on screen, row = SEA_ROW - elevation.
import { REGION_W, fbm1, hash3, smoothstep } from "./world";

export const CELL = 64;
export const ERAS = 48;
const SUBSTEPS = 3;
/** The screen row of sea level at the end of history. */
export const SEA_ROW = 720;

// ---- Rock ------------------------------------------------------------------

export const ROCK = {
  BASEMENT: 0,
  GRANITE: 1,
  BASALT: 2,
  ASH: 3,
  LIMESTONE: 4,
  SHALE: 5,
  SANDSTONE: 6,
  MUDSTONE: 7,
  REDBED: 8,
  DUNE: 9,
  COAL: 10,
  CONGLOMERATE: 11,
  TILL: 12,
  SALT: 13,
} as const;

/** Name, how easily it erodes (1 = ordinary), and a colour for maps. */
export const ROCKS: { name: string; k: number; color: string }[] = [
  { name: "Basement gneiss", k: 0.12, color: "#3d3a4a" },
  { name: "Granite", k: 0.1, color: "#b48c8c" },
  { name: "Basalt", k: 0.22, color: "#2e2b33" },
  { name: "Volcanic ash", k: 1.3, color: "#c9c1b0" },
  { name: "Limestone", k: 0.32, color: "#cfc8a8" },
  { name: "Shale", k: 1.4, color: "#5e6270" },
  { name: "Sandstone", k: 0.55, color: "#d8a868" },
  { name: "Mudstone", k: 1.5, color: "#8a7a6a" },
  { name: "Red beds", k: 1.2, color: "#b55a3a" },
  { name: "Dune sandstone", k: 0.75, color: "#e8c088" },
  { name: "Coal", k: 1.8, color: "#1e1c1c" },
  { name: "Conglomerate", k: 0.45, color: "#9a8a78" },
  { name: "Glacial till", k: 1.6, color: "#a0a4a8" },
  { name: "Salt", k: 2.2, color: "#f0ece8" },
];

// ---- Biomes ----------------------------------------------------------------

export const BIOME = {
  OCEAN: 0,
  LAKE: 1,
  SALT_FLAT: 2,
  ICE: 3,
  TUNDRA: 4,
  PINE: 5,
  WOODS: 6,
  GRASSLAND: 7,
  DESERT: 8,
  SAVANNA: 9,
  JUNGLE: 10,
  SWAMP: 11,
  ALPINE: 12,
} as const;

export const BIOMES: { name: string; color: string }[] = [
  { name: "Ocean", color: "#2a4f7a" },
  { name: "Lake", color: "#3f7fa8" },
  { name: "Salt flat", color: "#ece6dc" },
  { name: "Ice", color: "#dcecf6" },
  { name: "Tundra", color: "#8fa49a" },
  { name: "Snowy pine forest", color: "#3f6a5a" },
  { name: "Temperate woods", color: "#4f8a3a" },
  { name: "Grassland", color: "#a8b85a" },
  { name: "Desert", color: "#e0b870" },
  { name: "Savanna", color: "#c8a448" },
  { name: "Jungle", color: "#1f7a3a" },
  { name: "Swamp", color: "#4a6a3a" },
  { name: "Alpine rock", color: "#8a8490" },
];

// ---- The plan: what this world's history will hold --------------------------

export type EventKind =
  "range" | "rift" | "arc" | "pluton" | "basin" | "plateau";
export interface WorldEvent {
  kind: EventKind;
  /** Centre and width, in cells. */
  c: number;
  w: number;
  /** First era and the era after the last. */
  e0: number;
  e1: number;
  /** Total uplift (range, arc, plateau), subsidence (rift, basin) or thickness (pluton), in art pixels. */
  amp: number;
  /** Folds in a range: wavelength in cells, and strength as a fraction of amp. */
  fold?: number;
  foldAmp?: number;
  phase?: number;
}

const WARMTH_SHAPES = [
  {
    name: "cold at the left end, warm at the right",
    f: (u: number) => 2 * u - 1,
  },
  {
    name: "warm at the left end, cold at the right",
    f: (u: number) => 1 - 2 * u,
  },
  {
    name: "warm in the middle, cold at both ends",
    f: (u: number) => 1 - 2 * Math.abs(2 * u - 1),
  },
  {
    name: "cold in the middle, warm at both ends",
    f: (u: number) => 2 * Math.abs(2 * u - 1) - 1,
  },
  {
    name: "mild throughout, in long swells",
    f: (u: number) => 0.5 * Math.sin(u * 9.4 + 1),
  },
];

/** A river crossing the strip: its column and the water it brings (rain over its unseen catchment). */
export interface River {
  c: number;
  q: number;
}

export interface WorldOptions {
  /** Length in regions (default 200). */
  regions?: number;
  /** Keep a snapshot of every era (for the overview's history slider). */
  record?: boolean;
}

/** One era's state, as the overview draws it. */
export interface Snapshot {
  era: number;
  sea: number;
  b: Float32Array;
  offsets: Int32Array;
  kinds: Uint8Array;
  tops: Float32Array;
  water: Float32Array;
}

export interface World {
  seed: number;
  regions: number;
  /** Number of columns. */
  n: number;
  events: WorldEvent[];
  warmth: string;
  windFromLeft: number;
  /** Sea level over the eras (the last is 0). */
  sea: Float32Array;
  /** Basement top per column. */
  b: Float32Array;
  /** Final layers, bottom up: column c's layers are offsets[c] .. offsets[c+1]. */
  offsets: Int32Array;
  kinds: Uint8Array;
  ages: Uint8Array;
  /** Elevation of each layer's top. */
  tops: Float32Array;
  surface: Float32Array;
  /** Water surface: sea level over the sea, lake level over lakes, else the ground. */
  water: Float32Array;
  /** 0 land, 1 lake, 2 salt flat, 3 sea. */
  wet: Uint8Array;
  /** Final climate: warmth (°C) and rain (mm a year). */
  T: Float32Array;
  P: Float32Array;
  /** Main biome, second biome, and the second's share (0 to 0.5) for blending. */
  biome: Uint8Array;
  biome2: Uint8Array;
  blend: Float32Array;
  faults: { c: number; throw: number; era: number }[];
  rivers: River[];
  history?: Snapshot[];
  ms: number;
}

function planWorld(seed: number, regions: number) {
  const r = (k: number) => hash3(seed, k, 9001),
    n = (regions * REGION_W) / CELL,
    events: WorldEvent[] = [],
    taken: [number, number][] = [],
    // Keep features off the coasts and, mostly, off each other.
    place = (w: number, k: number) => {
      for (let t = 0; t < 12; t++) {
        const c = n * (0.1 + 0.8 * r(k + t * 7));
        if (
          !taken.some(([a, b]) => c + w / 2 > a && c - w / 2 < b) ||
          t === 11
        ) {
          taken.push([c - w / 2, c + w / 2]);
          return c;
        }
      }
      return n / 2;
    };
  const perRegion = REGION_W / CELL;
  const ranges = 1 + Math.floor(r(10) * 3);
  for (let i = 0; i < ranges; i++) {
    const w = perRegion * (6 + 20 * r(11 + i)),
      e0 = Math.floor(6 + 26 * r(12 + i)),
      d = Math.floor(6 + 10 * r(13 + i));
    events.push({
      kind: "range",
      c: place(w, 100 + i * 13),
      w,
      e0,
      e1: Math.min(ERAS, e0 + d),
      amp: 350 + 400 * r(14 + i),
      fold: perRegion * (2 + 5 * r(15 + i)),
      foldAmp: 0.15 + 0.25 * r(16 + i),
      phase: 6.283 * r(17 + i),
    });
  }
  const rifts = Math.floor(r(20) * 2.6);
  for (let i = 0; i < rifts; i++) {
    const w = perRegion * (2 + 6 * r(21 + i)),
      e0 = Math.floor(10 + 30 * r(22 + i));
    events.push({
      kind: "rift",
      c: place(w, 300 + i * 13),
      w,
      e0,
      e1: Math.min(ERAS, e0 + 4 + Math.floor(8 * r(23 + i))),
      amp: 120 + 160 * r(24 + i),
    });
  }
  if (r(30) < 0.6) {
    const w = perRegion * (6 + 8 * r(31)),
      e0 = Math.floor(14 + 24 * r(32));
    events.push({
      kind: "arc",
      c: place(w, 500),
      w,
      e0,
      e1: Math.min(ERAS, e0 + 6 + Math.floor(8 * r(33))),
      amp: 300 + 300 * r(34),
    });
  }
  // Broad, slow movements: basins that sink for ages and fill with rock, and
  // late plateaus that lift flat-lying layers for rivers to cut into.
  const basins = 1 + Math.floor(r(50) * 2);
  for (let i = 0; i < basins; i++) {
    const e0 = Math.floor(2 + 18 * r(51 + i));
    events.push({
      kind: "basin",
      c: n * (0.15 + 0.7 * r(52 + i)),
      w: perRegion * (20 + 40 * r(53 + i)),
      e0,
      e1: Math.min(ERAS, e0 + 15 + Math.floor(15 * r(54 + i))),
      amp: 120 + 140 * r(55 + i),
    });
  }
  if (r(60) < 0.75) {
    const e0 = Math.floor(26 + 14 * r(61));
    events.push({
      kind: "plateau",
      c: n * (0.2 + 0.6 * r(62)),
      w: perRegion * (20 + 30 * r(63)),
      e0,
      e1: Math.min(ERAS, e0 + 6 + Math.floor(6 * r(64))),
      amp: 250 + 200 * r(65),
    });
  }
  const plutons = 1 + Math.floor(r(40) * 3);
  for (let i = 0; i < plutons; i++) {
    const w = perRegion * (1 + 3 * r(41 + i)),
      e = Math.floor(8 + 36 * r(42 + i));
    events.push({
      kind: "pluton",
      c: n * (0.12 + 0.76 * r(43 + i)),
      w,
      e0: e,
      e1: e + 1,
      amp: 120 + 200 * r(44 + i),
    });
  }
  // Rivers that cross the strip, every few regions, carrying water from
  // land we don't see: where the land is high they cut valleys and canyons.
  const rivers: River[] = [];
  for (let k = 0, c = n * 0.04; ; k++) {
    c += perRegion * (1.5 + 3.5 * r(200 + k));
    if (c > n * 0.96) break;
    rivers.push({ c: Math.round(c), q: 3000 + 30000 * r(400 + k) ** 2 });
  }
  const shape = WARMTH_SHAPES[Math.floor(r(2) * WARMTH_SHAPES.length)];
  return {
    n,
    events,
    rivers,
    shape,
    tMean: 8 + 10 * r(3),
    tAmp: 6 + 7 * r(4),
    windFromLeft: 0.15 + 0.7 * r(5),
    iceAge: r(6) < 0.55 ? Math.floor(8 + 36 * r(7)) : -1,
    wetness: 0.65 + 0.6 * r(8),
    /** How marine the old rock is (0 mostly land-laid, 1 mostly sea-laid). */
    marine: r(9),
  };
}

// ---- The simulation ---------------------------------------------------------

interface Column {
  b: number;
  kinds: number[];
  th: number[];
  ages: number[];
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export function simulateWorld(seed: number, opts: WorldOptions = {}): World {
  const t0 = performance.now(),
    regions = opts.regions ?? 200,
    plan = planWorld(seed, regions),
    n = plan.n,
    cols: Column[] = [];

  // The young world: a deep basement under a thick sequence of older rock
  // (formations that thicken, thin and pinch out along the world), its top
  // near sea level, both ends sloping down into ocean.
  const edge = (i: number) => {
    const d = Math.min(i, n - 1 - i) / ((5 * REGION_W) / CELL);
    return 1 - smoothstep(0, 1, d);
  };
  const r = (k: number) => hash3(seed, k, 9101),
    formations: number[] = [],
    count = 7 + Math.floor(r(1) * 6);
  const MARINE = [
      ROCK.SHALE,
      ROCK.LIMESTONE,
      ROCK.SHALE,
      ROCK.SANDSTONE,
      ROCK.LIMESTONE,
    ],
    LAND = [
      ROCK.SANDSTONE,
      ROCK.REDBED,
      ROCK.MUDSTONE,
      ROCK.CONGLOMERATE,
      ROCK.DUNE,
      ROCK.REDBED,
    ];
  for (let f = 0; f < count; f++) {
    const list = r(10 + f) < 0.25 + 0.6 * plan.marine ? MARINE : LAND;
    formations.push(list[Math.floor(r(30 + f) * list.length)]);
  }
  for (let i = 0; i < n; i++) {
    const b = -640 + 160 * (fbm1(i / 260, seed + 50, 4) - 0.5) - 320 * edge(i),
      c: Column = { b, kinds: [ROCK.CONGLOMERATE], th: [6], ages: [0] },
      top = 30 + 120 * (fbm1(i / 140, seed + 51, 3) - 0.5) - 360 * edge(i),
      weights = formations.map((_, f) =>
        Math.max(
          0,
          0.15 +
            1.3 * fbm1(i / (90 + 60 * r(50 + f)), seed + 200 + f, 3) -
            0.25,
        ),
      );
    const sum = weights.reduce((a, x) => a + x, 0) || 1,
      total = Math.max(60, top - b - 6);
    for (let f = 0; f < count; f++) {
      const th = (total * weights[f]) / sum;
      if (th < 2) continue;
      c.kinds.push(formations[f]);
      c.th.push(th);
      c.ages.push(0);
      // Now and then a thin coal seam or ash bed between formations.
      if (r(70 + f) < 0.2) {
        c.kinds.push(r(90 + f) < 0.5 ? ROCK.COAL : ROCK.ASH);
        c.th.push(3);
        c.ages.push(0);
      }
    }
    cols.push(c);
  }

  // Sea level and warmth over the eras: high seas early, falling to today's
  // level, wandering as it goes; warmth swinging, with an ice age in some.
  const sea = new Float32Array(ERAS),
    tg = new Float32Array(ERAS);
  for (let e = 0; e < ERAS; e++) {
    sea[e] =
      60 * (1 - e / (ERAS - 1)) + 120 * (fbm1(e / 5, seed + 60, 3) - 0.5);
    tg[e] = 6 * (fbm1(e / 7, seed + 61, 3) - 0.5);
    if (plan.iceAge >= 0)
      tg[e] -= 9 * Math.exp(-(((e - plan.iceAge) / 3) ** 2));
  }
  // History ends on a falling sea: today's level is the lowest of the last
  // few eras, so flats that filled to the recent seas stand as land.
  sea[ERAS - 1] = Math.min(...sea.slice(ERAS - 6));
  const lastSea = sea[ERAS - 1];
  for (let e = 0; e < ERAS; e++) sea[e] -= lastSea;
  tg[ERAS - 1] = 0;

  const T0 = new Float32Array(n),
    Mb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    T0[i] =
      plan.tMean +
      plan.tAmp *
        (plan.shape.f(u) + 0.25 * (2 * fbm1(u * 6, seed + 70, 3) - 1));
    // How much moisture reaches each stretch from seas beside the strip.
    Mb[i] = clamp(
      plan.wetness * (1.7 * fbm1(i / 420, seed + 71, 3) - 0.2) + 0.5 * edge(i),
      0.04,
      1.2,
    );
  }

  const z = new Float32Array(n),
    W = new Float32Array(n),
    T = new Float32Array(n),
    Tsea = new Float32Array(n),
    P = new Float32Array(n),
    Q = new Float32Array(n),
    sed = new Float32Array(n),
    dir = new Int8Array(n),
    river = new Uint8Array(n),
    wet = new Uint8Array(n),
    order = new Uint32Array(n),
    faults: World["faults"] = [],
    history: Snapshot[] = [];

  const surfaceOf = (c: Column) => {
    let s = c.b;
    for (const t of c.th) s += t;
    return s;
  };
  const addLayer = (c: Column, kind: number, th: number, age: number) => {
    if (th <= 0) return;
    const k = c.kinds.length - 1;
    if (k >= 0 && c.kinds[k] === kind && age - c.ages[k] <= 1) c.th[k] += th;
    else {
      c.kinds.push(kind);
      c.th.push(th);
      c.ages.push(age);
    }
  };
  /** Wear the column down with this much erosive power; returns the thickness removed. */
  const erode = (c: Column, power: number) => {
    let removed = 0;
    while (power > 1e-6) {
      const top = c.kinds.length - 1;
      if (top < 0) {
        const d = power * ROCKS[ROCK.BASEMENT].k;
        c.b -= d;
        removed += d;
        break;
      }
      const k = ROCKS[c.kinds[top]].k,
        cap = power * k,
        t = c.th[top];
      if (cap < t) {
        c.th[top] = t - cap;
        removed += cap;
        break;
      }
      removed += t;
      power -= t / k;
      c.kinds.pop();
      c.th.pop();
      c.ages.pop();
    }
    return removed;
  };

  /** Take this thickness off the top regardless of hardness (a landslide); returns it. */
  const strip = (c: Column, amount: number) => {
    let left = amount;
    while (left > 1e-6) {
      const top = c.kinds.length - 1;
      if (top < 0) {
        c.b -= left;
        break;
      }
      if (c.th[top] > left) {
        c.th[top] -= left;
        break;
      }
      left -= c.th[top];
      c.kinds.pop();
      c.th.pop();
      c.ages.pop();
    }
    return amount;
  };

  for (const rv of plan.rivers) river[rv.c] = 1;
  const dt = 1 / SUBSTEPS;
  for (let e = 0; e < ERAS; e++) {
    const s = sea[e];
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      // 1. Tectonics.
      for (const ev of plan.events) {
        if (e < ev.e0 || e >= ev.e1) continue;
        const rate = (ev.amp / (ev.e1 - ev.e0)) * dt,
          lo = Math.max(0, Math.floor(ev.c - ev.w)),
          hi = Math.min(n - 1, Math.ceil(ev.c + ev.w));
        if (ev.kind === "pluton") {
          if (sub > 0) continue;
          // Molten rock rises and sets as a lens of granite, doming what lies above.
          for (let i = lo; i <= hi; i++) {
            const d = (i - ev.c) / (ev.w / 2),
              th = ev.amp * Math.max(0, 1 - d * d) ** 0.7;
            if (th < 1) continue;
            const c = cols[i];
            c.kinds.unshift(ROCK.GRANITE);
            c.th.unshift(th);
            c.ages.unshift(e);
          }
          continue;
        }
        for (let i = lo; i <= hi; i++) {
          const d = i - ev.c;
          let u = 0;
          // Land near the world's top stops rising.
          const room = clamp(
            (SEA_ROW - 40 - s - surfaceOf(cols[i])) / 220,
            0,
            1,
          );
          if (ev.kind === "range") {
            const half = ev.w / 2,
              ramp = ev.w * 0.35,
              body =
                smoothstep(-half - ramp, -half + ramp, d) *
                (1 - smoothstep(half - ramp, half + ramp, d));
            u =
              body *
              (1 + ev.foldAmp! * Math.sin((6.283 * d) / ev.fold! + ev.phase!));
          } else if (ev.kind === "rift") {
            // Sharp edges: the floor drops between two faults, tilted a little.
            const half = ev.w / 2;
            u =
              -(
                smoothstep(-half - 0.6, -half + 0.6, d) *
                (1 - smoothstep(half - 0.6, half + 0.6, d))
              ) *
              (0.75 + 0.5 * (d / ev.w + 0.5));
          } else if (ev.kind === "arc") {
            u = Math.exp(-2 * (d / (ev.w / 2)) ** 2);
          } else if (ev.kind === "basin") {
            u = -Math.exp(-2.5 * (d / (ev.w / 2)) ** 2);
          } else if (ev.kind === "plateau") {
            const half = ev.w / 2,
              ramp = ev.w * 0.3;
            u =
              smoothstep(-half - ramp, -half + ramp, d) *
              (1 - smoothstep(half - ramp, half + ramp, d));
          }
          cols[i].b += rate * u * (u > 0 ? room : 1);
        }
        if (ev.kind === "arc" && hash3(seed, e * 7 + sub, 777) < 0.7) {
          // An eruption: a basalt flow round the vent, ash carried downwind.
          const vent = Math.floor(
              ev.c + (hash3(seed, e * 7 + sub, 778) - 0.5) * ev.w * 0.8,
            ),
            reach = 2 + Math.floor(4 * hash3(seed, e * 7 + sub, 779)),
            th = 4 + 10 * hash3(seed, e * 7 + sub, 780),
            downwind =
              hash3(seed, e * 7 + sub, 781) < plan.windFromLeft ? 1 : -1;
          for (let k = -reach; k <= reach; k++) {
            const i = vent + k;
            if (i >= 0 && i < n)
              addLayer(
                cols[i],
                ROCK.BASALT,
                th * (1 - (k / (reach + 1)) ** 2),
                e,
              );
          }
          for (let k = 0; k < 90; k++) {
            const i = vent + downwind * k;
            if (i >= 0 && i < n)
              addLayer(cols[i], ROCK.ASH, 1.6 * Math.exp(-k / 35), e);
          }
        }
      }
      // The world's ends keep sagging into ocean.
      for (let i = 0; i < n; i++) cols[i].b -= 4 * dt * edge(i);
      for (const ev of plan.events)
        if (ev.kind === "rift" && e === ev.e1 - 1 && sub === SUBSTEPS - 1)
          for (const side of [-1, 1])
            faults.push({
              c: ev.c + (side * ev.w) / 2,
              throw: ev.amp,
              era: ev.e0,
            });

      for (let i = 0; i < n; i++) z[i] = surfaceOf(cols[i]);

      // 2. Water surface: hollows fill to their lowest rim; what connects to
      // either end below sea level is sea.
      let m = s;
      for (let i = 0; i < n; i++) {
        m = Math.max(m, z[i]);
        W[i] = m;
      }
      m = s;
      for (let i = n - 1; i >= 0; i--) {
        m = Math.max(m, z[i]);
        const L = W[i];
        W[i] = Math.max(z[i], Math.min(L, m));
        // Lakes spill toward their lower rim; land drains downhill.
        dir[i] = L < m ? -1 : 1;
        wet[i] =
          z[i] < s && Math.min(L, m) <= s ? 3 : W[i] > z[i] + 0.5 ? 1 : 0;
      }
      // Most hollows drain sideways, out of the picture, by rivers we don't
      // see: only rifts, and now and then another basin, are truly closed and
      // hold a lake (or dry to a salt flat).
      for (let i = 0; i < n;) {
        if (wet[i] !== 1) {
          i++;
          continue;
        }
        let j = i,
          low = i;
        while (j < n && wet[j] === 1) {
          if (z[j] < z[low]) low = j;
          j++;
        }
        const closed =
          j - i <= (6 * REGION_W) / CELL &&
          (plan.events.some(
            (ev) =>
              ev.kind === "rift" &&
              e >= ev.e0 &&
              Math.abs(low - ev.c) < ev.w / 2,
          ) ||
            hash3(seed, Math.floor((low * CELL) / REGION_W), 4242) < 0.15);
        if (!closed)
          for (let k = i; k < j; k++) {
            // Drained sideways; and where the floor is below sea level the
            // sea comes in from the side, as an inlet.
            W[k] = Math.max(z[k], s);
            wet[k] = z[k] < s ? 3 : 0;
          }
        i = j;
      }
      for (let i = 0; i < n; i++)
        if (wet[i] === 0) {
          const a = i > 0 ? W[i - 1] : s,
            b = i < n - 1 ? W[i + 1] : s;
          // 0: a low point, where water leaves sideways.
          dir[i] = a < W[i] || b < W[i] ? (a < b ? -1 : 1) : 0;
        }
      // Where a river crosses, the land drains into it and it carries all away.
      for (const rv of plan.rivers) if (wet[rv.c] === 0) dir[rv.c] = 0;

      // 3. Climate. Warmth falls with height; rain rides the wind from each
      // end, heaviest where air climbs, and is wrung out over mountains.
      for (let i = 0; i < n; i++)
        T[i] = T0[i] + tg[e] - 0.025 * Math.max(0, z[i] - s);
      for (let i = 0; i < n; i++) Tsea[i] = T0[i] + tg[e];
      rainfall(P, W, wet, Tsea, Mb, plan.windFromLeft);

      // 4. Drain: water gathers downhill (upstream first), stopping in lakes
      // that dry faster than they fill.
      for (let i = 0; i < n; i++) order[i] = i;
      const ord = Array.from(order).sort(
        (a, b) => W[b] - W[a] || (dir[a] < 0 ? b - a : a - b),
      );
      Q.fill(0);
      for (const rv of plan.rivers)
        Q[rv.c] += rv.q * clamp(P[rv.c] / 800, 0.4, 1.6);
      for (const i of ord) {
        Q[i] += P[i];
        if (wet[i] === 3 || dir[i] === 0) continue;
        const j = i + dir[i];
        if (j >= 0 && j < n) Q[j] += Q[i];
      }
      // Closed basins: a lake whose inflow can't match its evaporation dries to a salt flat.
      for (let i = 0; i < n;) {
        if (wet[i] !== 1) {
          i++;
          continue;
        }
        let j = i;
        while (j < n && wet[j] === 1) j++;
        const out = dir[i] < 0 ? i : j - 1,
          evap = (j - i) * 1300 * clamp((T[out] + 5) / 30, 0.1, 1.4);
        if (Q[out] < evap) for (let k = i; k < j; k++) wet[k] = 2;
        i = j;
      }

      // 5. Erosion and transport, upstream first.
      sed.fill(0);
      for (let i = 0; i < n; i++) {
        if (wet[i] !== 0) continue;
        // Hilltops creep down: convex ground loses most.
        const a = i > 0 ? z[i - 1] : z[i],
          b = i < n - 1 ? z[i + 1] : z[i],
          bulge = Math.max(0, 2 * z[i] - a - b);
        sed[i] += erode(cols[i], 0.07 * bulge * dt);
      }
      for (const i of ord) {
        const c = cols[i],
          w = wet[i];
        if (w === 3) {
          // At sea: lay the load down, most near the shore, the rest further out.
          let load = sed[i],
            k = i;
          const out = dir[i];
          while (load > 0.01 && k >= 0 && k < n && wet[k] === 3) {
            const room = Math.max(0, s - surfaceOf(cols[k]) - 2),
              d = Math.min(room, load * 0.35 + 0.01);
            if (d > 0) {
              addLayer(
                cols[k],
                s - surfaceOf(cols[k]) < 30 ? ROCK.SANDSTONE : ROCK.SHALE,
                d,
                e,
              );
              load -= d;
            }
            k += out;
          }
          continue;
        }
        if (w === 1 || w === 2) {
          // Into a lake or a salt pan: it all settles here.
          const room = Math.max(0, W[i] - surfaceOf(c)),
            d = Math.min(sed[i], room + (w === 2 ? 2 : 0));
          addLayer(
            c,
            w === 2 ? (T[i] > 10 ? ROCK.SALT : ROCK.MUDSTONE) : ROCK.MUDSTONE,
            d,
            e,
          );
          const j = i + dir[i];
          if (w === 1 && j >= 0 && j < n) sed[j] += sed[i] - d;
          continue;
        }
        const out = dir[i] === 0,
          j = i + dir[i],
          down = j >= 0 && j < n ? W[j] : s,
          // A low point's river runs off sideways toward the sea, a long way off.
          S = out
            ? Math.max(0, z[i] - s) / (river[i] ? 35 * CELL : 100 * CELL)
            : Math.max(0, z[i] - down) / CELL,
          glacier = T[i] < -6 ? 2.5 : 1,
          power = 1.8 * glacier * Math.sqrt(Q[i]) * S * dt;
        sed[i] += erode(c, power);
        if (out) {
          // The load leaves with the river; near sea level some settles on its
          // floodplain, but a river still cutting down carries everything off.
          const d = z[i] < s + 60 ? Math.min(sed[i] * 0.15, 3) : 0;
          addLayer(
            c,
            T[i] < -2
              ? ROCK.TILL
              : river[i]
                ? ROCK.SANDSTONE
                : P[i] < 350 && T[i] > 8
                  ? ROCK.REDBED
                  : ROCK.MUDSTONE,
            d,
            e,
          );
          continue;
        }
        const cap = 0.3 * Q[i] * S;
        if (sed[i] > cap) {
          // More than the stream can carry: lay some down here.
          const d = Math.min((sed[i] - cap) * 0.5, 3);
          const kind =
            T[i] < -2
              ? ROCK.TILL
              : S > 0.06
                ? ROCK.CONGLOMERATE
                : P[i] < 350 && T[i] > 8
                  ? ROCK.REDBED
                  : S > 0.015
                    ? ROCK.SANDSTONE
                    : ROCK.MUDSTONE;
          addLayer(c, kind, d, e);
          sed[i] -= d;
        }
        if (j >= 0 && j < n) sed[j] += sed[i];
      }

      // Landslides: no slope steeper than a cliff can stand at this scale.
      for (let i = 0; i < n - 1; i++) {
        const za = surfaceOf(cols[i]),
          zb = surfaceOf(cols[i + 1]),
          excess = (Math.abs(za - zb) - 0.45 * CELL) / 2;
        if (excess <= 0) continue;
        const [hi, lo] = za > zb ? [i, i + 1] : [i + 1, i];
        // Rock that falls into a river is carried off; elsewhere it piles up as scree.
        if (wet[lo] === 0 && dir[lo] !== 0)
          addLayer(cols[lo], ROCK.CONGLOMERATE, strip(cols[hi], excess), e);
        else strip(cols[hi], excess);
      }

      // 6. What grows in place: limestone in warm shallow seas, coal in warm
      // swamps, wind-blown sand in deserts.
      for (let i = 0; i < n; i++) {
        const c = cols[i],
          h = surfaceOf(c);
        if (wet[i] === 3) {
          const depth = s - h;
          if (T[i] > 14 && depth > 4 && depth < 140)
            addLayer(c, ROCK.LIMESTONE, 3.5 * dt * (1 - depth / 140), e);
          // Mud and sand from rivers we don't see settle in shallow seas,
          // until they build up into coastal flats.
          if (depth < 220)
            addLayer(
              c,
              depth < 30 ? ROCK.SANDSTONE : ROCK.SHALE,
              Math.min(depth + 3, 3.6 * dt * (1 - depth / 220)),
              e,
            );
          else if (depth >= 220) addLayer(c, ROCK.SHALE, 0.4 * dt, e);
        } else if (wet[i] === 0) {
          const a = i > 0 ? z[i - 1] : z[i],
            b = i < n - 1 ? z[i + 1] : z[i],
            flat = Math.abs(b - a) / (2 * CELL) < 0.004;
          if (flat && T[i] > 12 && P[i] > 1300 && h < s + 40)
            addLayer(c, ROCK.COAL, 1.2 * dt, e);
          else if (
            P[i] < 160 &&
            T[i] > 4 &&
            Math.abs(b - a) / (2 * CELL) < 0.03
          )
            addLayer(c, ROCK.DUNE, 0.6 * dt, e);
        }
      }
    }
    if (opts.record) history.push(snapshot(cols, e, s, W));
  }

  // ---- Pack the result ------------------------------------------------------
  let total = 0;
  for (const c of cols) total += c.kinds.length;
  const offsets = new Int32Array(n + 1),
    kinds = new Uint8Array(total),
    ages = new Uint8Array(total),
    tops = new Float32Array(total),
    b = new Float32Array(n),
    surface = new Float32Array(n);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const c = cols[i];
    offsets[i] = o;
    b[i] = c.b;
    let h = c.b;
    for (let k = 0; k < c.kinds.length; k++) {
      h += c.th[k];
      kinds[o] = c.kinds[k];
      ages[o] = c.ages[k];
      tops[o] = h;
      o++;
    }
    surface[i] = h;
  }
  offsets[n] = o;

  const { biome, biome2, blend } = biomesOf(n, surface, W, wet, T, P);
  return {
    seed,
    regions,
    n,
    events: plan.events,
    warmth: plan.shape.name,
    windFromLeft: plan.windFromLeft,
    sea,
    b,
    offsets,
    kinds,
    ages,
    tops,
    surface,
    water: Float32Array.from(W),
    wet: Uint8Array.from(wet),
    T: Float32Array.from(T),
    P: Float32Array.from(P),
    biome,
    biome2,
    blend,
    faults,
    rivers: plan.rivers,
    history: opts.record ? history : undefined,
    ms: performance.now() - t0,
  };
}

/**
 * Rain along the world, in mm a year, into P. The wind blows from each end
 * (windFromLeft of the time from the left). Air takes up moisture over the
 * sea and drifts toward each stretch's background level (Mb: moisture from
 * seas beside the strip); climbing air loses moisture as rain in proportion
 * to how high it climbs, so windward slopes are wet and lee sides dry. How
 * much the air can carry depends on the sea-level warmth below it (Tsea).
 * W is the water surface (ground, or lake or sea level); wet marks sea (3)
 * and lakes (1).
 */
export function rainfall(
  P: Float32Array,
  W: Float32Array,
  wet: Uint8Array,
  Tsea: Float32Array,
  Mb: Float32Array,
  windFromLeft: number,
) {
  const n = P.length;
  P.fill(0);
  for (const [from, weight] of [
    [1, windFromLeft],
    [-1, 1 - windFromLeft],
  ] as const) {
    let M = Mb[from > 0 ? 0 : n - 1];
    for (let k = 0; k < n; k++) {
      const i = from > 0 ? k : n - 1 - k,
        prev = i - from,
        rise = prev >= 0 && prev < n ? Math.max(0, W[i] - W[prev]) : 0,
        A = 2100 * clamp((Tsea[i] + 8) / 30, 0.12, 1.25);
      if (wet[i] === 3) M += (Math.max(Mb[i], 0.9) - M) * 0.05;
      else M += (Mb[i] - M) * (wet[i] === 1 ? 0.03 : 0.004);
      const lost = M * (1 - Math.exp(-rise / 350));
      P[i] += weight * (A * M * 0.9 + A * lost * 40);
      M -= lost;
    }
  }
  // Rain doesn't jump from one column to the next: smooth it over a few.
  const R = 6,
    tmp = Float32Array.from(P);
  let acc = 0;
  for (let i = 0; i < Math.min(n, R); i++) acc += tmp[i];
  for (let i = 0; i < n; i++) {
    const a = i + R < n ? tmp[i + R] : 0,
      b = i - R - 1 >= 0 ? tmp[i - R - 1] : 0;
    acc += a - b;
    P[i] = acc / (Math.min(n - 1, i + R) - Math.max(0, i - R) + 1);
  }
}

function snapshot(
  cols: Column[],
  era: number,
  sea: number,
  W: Float32Array,
): Snapshot {
  let total = 0;
  for (const c of cols) total += c.kinds.length;
  const n = cols.length,
    offsets = new Int32Array(n + 1),
    kinds = new Uint8Array(total),
    tops = new Float32Array(total),
    b = new Float32Array(n);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const c = cols[i];
    offsets[i] = o;
    b[i] = c.b;
    let h = c.b;
    for (let k = 0; k < c.kinds.length; k++) {
      h += c.th[k];
      kinds[o] = c.kinds[k];
      tops[o] = h;
      o++;
    }
  }
  offsets[n] = o;
  return { era, sea, b, offsets, kinds, tops, water: Float32Array.from(W) };
}

// ---- Biomes from climate ------------------------------------------------------

const ramp = (x: number, a: number, b: number) => smoothstep(a, b, x);
const band = (x: number, a0: number, a1: number, b0: number, b1: number) =>
  ramp(x, a0, a1) * (1 - ramp(x, b0, b1));

/**
 * Each column's biome from its warmth, rain, slope and water, as weights
 * that change smoothly with climate, so neighbouring biomes always blend.
 */
function biomesOf(
  n: number,
  surface: Float32Array,
  W: Float32Array,
  wet: Uint8Array,
  T: Float32Array,
  P: Float32Array,
) {
  const biome = new Uint8Array(n),
    biome2 = new Uint8Array(n),
    blend = new Float32Array(n),
    w = new Float32Array(BIOMES.length);
  for (let i = 0; i < n; i++) {
    if (wet[i] === 3) {
      biome[i] = biome2[i] = BIOME.OCEAN;
      continue;
    }
    if (wet[i] === 1) {
      biome[i] = biome2[i] = BIOME.LAKE;
      continue;
    }
    if (wet[i] === 2) {
      biome[i] = biome2[i] = BIOME.SALT_FLAT;
      continue;
    }
    const t = T[i],
      p = P[i],
      a = i > 0 ? surface[i - 1] : surface[i],
      b = i < n - 1 ? surface[i + 1] : surface[i],
      slope = Math.abs(b - a) / (2 * CELL),
      low = surface[i] < 40,
      flat = 1 - ramp(slope, 0.002, 0.008);
    w.fill(0);
    w[BIOME.ICE] = ramp(-t, 6, 10);
    w[BIOME.TUNDRA] = band(t, -10, -6, 0, 3);
    w[BIOME.PINE] = band(t, -1, 2, 6, 9) * ramp(p, 220, 380);
    w[BIOME.WOODS] = band(t, 7, 10, 15, 19) * ramp(p, 500, 700);
    w[BIOME.GRASSLAND] = band(t, 3, 7, 21, 25) * band(p, 250, 350, 540, 720);
    w[BIOME.DESERT] = (1 - ramp(p, 230, 360)) * ramp(t, 2, 6);
    w[BIOME.SAVANNA] = ramp(t, 15, 19) * band(p, 340, 460, 900, 1200);
    w[BIOME.JUNGLE] = ramp(t, 18, 22) * ramp(p, 1200, 1500);
    w[BIOME.SWAMP] =
      ramp(t, 8, 12) * ramp(p, 900, 1200) * flat * (low ? 1.4 : 0);
    w[BIOME.ALPINE] = ramp(slope, 0.12, 0.25) * (1 - ramp(t, 2, 8));
    let best = BIOME.GRASSLAND,
      second = BIOME.GRASSLAND,
      bw = 0,
      sw = 0;
    for (let k = 3; k < w.length; k++) {
      if (w[k] > bw) {
        second = best;
        sw = bw;
        best = k as typeof best;
        bw = w[k];
      } else if (w[k] > sw) {
        second = k as typeof second;
        sw = w[k];
      }
    }
    if (bw < 0.02) best = second = BIOME.GRASSLAND;
    biome[i] = best;
    biome2[i] = sw > 0.02 ? second : best;
    blend[i] = sw > 0.02 ? (0.5 * sw) / Math.max(1e-6, bw) : 0;
  }
  void W;
  return { biome, biome2, blend };
}

/** A few sentences on what this world is and what happened in it. */
export function describeWorld(w: World) {
  const lines: string[] = [];
  const hours = (w.regions * 6) / 60;
  lines.push(
    `${w.regions} regions long (about ${Math.round(hours)} hours of drifting), ${w.warmth}.`,
  );
  lines.push(
    w.windFromLeft > 0.6
      ? "Winds mostly from the left."
      : w.windFromLeft < 0.4
        ? "Winds mostly from the right."
        : "Winds from both ends.",
  );
  const where = (c: number) => `region ${Math.floor((c * CELL) / REGION_W)}`;
  for (const ev of w.events) {
    const span = `${Math.round((ev.w * CELL) / REGION_W)} regions wide`;
    if (ev.kind === "range")
      lines.push(
        `A mountain range rose around ${where(ev.c)}, ${span}, in eras ${ev.e0} to ${ev.e1 - 1}.`,
      );
    else if (ev.kind === "rift")
      lines.push(
        `A rift opened around ${where(ev.c)}, ${span}, in eras ${ev.e0} to ${ev.e1 - 1}.`,
      );
    else if (ev.kind === "arc")
      lines.push(
        `A volcanic arc erupted around ${where(ev.c)}, ${span}, in eras ${ev.e0} to ${ev.e1 - 1}.`,
      );
    else if (ev.kind === "basin")
      lines.push(
        `A wide basin sank around ${where(ev.c)}, ${span}, in eras ${ev.e0} to ${ev.e1 - 1}, filling with rock.`,
      );
    else if (ev.kind === "plateau")
      lines.push(
        `A plateau rose around ${where(ev.c)}, ${span}, in eras ${ev.e0} to ${ev.e1 - 1}, lifting its layers for rivers to cut.`,
      );
    else lines.push(`Granite welled up under ${where(ev.c)} in era ${ev.e0}.`);
  }
  return lines;
}

/** Runs of the same main biome along the world, merging runs shorter than `min` columns. */
export function biomeRuns(w: World, min = 48) {
  const runs: { biome: number; from: number; to: number }[] = [];
  for (let i = 0; i < w.n; i++) {
    const b = w.biome[i],
      last = runs[runs.length - 1];
    if (last && last.biome === b) last.to = i + 1;
    else runs.push({ biome: b, from: i, to: i + 1 });
  }
  // Fold short runs into their longer neighbour.
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      if (r.to - r.from >= min || runs.length === 1) continue;
      const a = runs[k - 1],
        b = runs[k + 1],
        into = !a ? b : !b ? a : a.to - a.from >= b.to - b.from ? a : b;
      if (into === a) a.to = r.to;
      else b.from = r.from;
      runs.splice(k, 1);
      changed = true;
      break;
    }
    for (let k = 1; k < runs.length; k++)
      if (runs[k].biome === runs[k - 1].biome) {
        runs[k - 1].to = runs[k].to;
        runs.splice(k, 1);
        changed = true;
        break;
      }
  }
  return runs;
}
