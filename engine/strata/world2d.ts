// A world as a map: Strata's world history in two dimensions, for Vista and the Atlas.
//
// A square of land (512 cells of 200 m: about 100 km a side) is stepped through sixty eras:
//
//   1. Tectonics. The map lies across a handful of plates, each drifting its own way. Where two
//      press together a range rises along the join: old ranges stopped long ago and are worn down
//      to hills, young ones are still rising and sharp. Where they pull apart a rift sinks, and
//      lakes string along it. Where they slide past, little happens. Some plates are ocean floor,
//      so seas come in with bays, headlands and islands. Here and there a volcanic field grows
//      its cones, and granite pushed up into the beds long ago is laid bare as domes. Rock rises
//      with the land; under the ranges its beds buckle into folds.
//   2. Water. Every cell drains to a neighbour; hollows fill as lakes that spill over their lowest
//      rim (Priority-Flood), except where the climate is too dry for them to fill: there the
//      water goes no further, and what is left is a salt flat or a salt lake.
//   3. Erosion. Rivers cut down in proportion to the water they carry and their slope (the
//      stream-power law, solved implicitly), soft rock faster than hard, so networks branch out by
//      themselves and benches form where hard beds meet soft; slopes steeper than rock stands
//      shed scree; lakes slowly silt up.
//   4. Ice ages. Two or three times the world grows cold, and glaciers creep down from the high
//      ground, gouging their valleys deeper than the rivers ever could and piling moraine where
//      they end, so when the ice goes, long lakes lie in the valleys and tarns under the peaks.
//   5. Climate, made for a world to walk through in a day rather than copied from Earth: every
//      world has the whole range, laid out in regions over the map, a frozen one, a cold wet one,
//      a mild one, a hot dry one and a hot wet one (and a random one or two), blended smoothly
//      into each other through wandering borders. On top, the rain comes on one wind and is wrung
//      out over the mountains, and warmth falls with height. So ice, pine forest, temperate woods,
//      steppe, desert and jungle all lie within a day's walk; what differs from day to day is
//      where they lie, and the rarer things: volcanoes, salt basins, granite domes.
//
// Then every place gets its climate zone, its habitat (ridge, slope, cliff, flat, valley floor,
// riverside, wetland, shore) and its soil (from the rock under it), and from those one of the 65
// biomes of biomes.ts.
//
// Everything follows from the seed.
import { BIOMES as BIOME_DEFS, HABITAT, SOIL, ZONE, ZONES, classify, swatchOf, zoneOf } from "./biomes";

export { HABITAT, SOIL, ZONE, ZONES };
/** The kinds of rock (beds laid down, and what lies under them or comes up through them). */
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
const ROCK_KINDS: { name: string; k: number; color: string }[] = [
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
/** Loose sediment on top (river gravel, lake silt, scree, moraine): not a rock of the layers. */
export const SEDIMENT = ROCK_KINDS.length;
/** The rocks, and loose sediment. */
export const ROCKS = [...ROCK_KINDS, { name: "Gravel and silt", k: 1.6, color: "#b9a77f" }];
/** The land biomes (biomes.ts), with a colour for maps (woods in autumn colours shown green, so a
 * map does not read them as desert). Water cells have biome WATER. */
export const BIOMES = BIOME_DEFS.map((b) => {
  let color = swatchOf(b);
  const c = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
  if (b.pines + b.broad + b.giants > 0.025 && c[0] > c[1] + 20)
    color = `#${c.map((v, k) => Math.round(v * 0.4 + [0x5a, 0x7a, 0x34][k] * 0.6).toString(16).padStart(2, "0")).join("")}`;
  return { name: b.name, zone: b.zone, color };
});
export const WATER = 255;

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
  return t / (oct < FBM_NORM.length ? FBM_NORM[oct] : 1 - 0.5 ** oct);
}
const FBM_NORM = Array.from({ length: 9 }, (_, oct) => 1 - 0.5 ** oct);
/**
 * Math.hypot(a, b) as V8 computes it (each scaled by the larger, squared and summed, the root taken
 * and scaled back), so the same bits, but a few times faster: V8 does not inline Math.hypot.
 */
export function hypot2(a: number, b: number) {
  a = Math.abs(a);
  b = Math.abs(b);
  const m = a > b ? a : b;
  if (!(m > 0 && m < Infinity) || b !== b) return Math.hypot(a, b);
  const x = a / m,
    y = b / m;
  return Math.sqrt(x * x + y * y) * m;
}

// ---- The plan -------------------------------------------------------------------------------
export interface Plate {
  /** Its heart (cells; may lie off the map), its drift, whether it is ocean floor, how it swells (m/yr). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  ocean: boolean;
  swell: number;
}
export interface Join {
  /** Two plates and how fast they close (+) or open (-) across their join. */
  a: number;
  b: number;
  conv: number;
  kind: "range" | "rift" | "shear";
  /** Half-width (cells), rate at its heart (m/yr), and the share of history it is active. */
  w: number;
  rate: number;
  from: number;
  to: number;
}
export interface WorldPlan {
  plates: Plate[];
  joins: Join[];
  /** Volcanic fields: a centre and radius, cones, and from when they grow. */
  fields: { x: number; y: number; r: number; from: number; cones: { x: number; y: number; r: number; rate: number }[] }[];
  /** Granite pushed into the beds: centre, radius (cells), how high its top reaches (m below the old surface). */
  plutons: { x: number; y: number; r: number; top: number }[];
  /** Cold spells: share of history, and how much colder (degrees C). */
  glacials: { from: number; to: number; cool: number }[];
  /** Climate: warmth at sea level in the middle of the map, how much it changes across the map and which way it rises;
   * where the rain comes from, how fast the air dries over land, the seasons. */
  climate: { wind: number; dry: number; regions: { x: number; y: number; t: number; wet: number; season: number; kind: string }[] };
  layers: { rock: number; t: number }[];
  story: string[];
  /** A section worth seeing: across the youngest, highest range. */
  cross: [[number, number], [number, number]] | null;
}
export interface World2D {
  seed: number;
  n: number;
  cell: number;
  plan: WorldPlan;
  /** Height above sea level (m). */
  h: Float32Array;
  /** Lake depth (m) where a lake stands, else 0; salt marks a salt lake; sea where sea[i] = 1. */
  lake: Float32Array;
  salt: Uint8Array;
  sea: Uint8Array;
  /** Where each cell drains (-1: off the map, into the sea or into a dry basin), and the water passing (rain-weighted area, m2). */
  rec: Int32Array;
  flow: Float32Array;
  /** Rain (mm/yr), mean warmth (degrees C), seasons (-1 dry winters .. +1 dry summers), nearness to the sea (0..1). */
  rain: Float32Array;
  temp: Float32Array;
  season: Float32Array;
  ocean: Float32Array;
  /** Total uplift (m), loose sediment on top (m), the rock at the surface. */
  uplift: Float32Array;
  sed: Float32Array;
  rock: Uint8Array;
  /** Climate zone, habitat, soil, and biome (an index into BIOMES, or WATER). */
  zone: Uint8Array;
  habitat: Uint8Array;
  soil: Uint8Array;
  biome: Uint8Array;
  /** Which plate each cell lies on. */
  plate: Uint8Array;
  /** Tops of the original layers before any uplift (m); layer k lies between tops k-1 and k. */
  tops: Float32Array[];
  /** How far the beds were folded beyond the land's own uplift (m), and how high granite reaches (m, original depth; -1e9 none). */
  fold: Float32Array;
  granite: Float32Array;
}

/** The compass point a direction on the map faces (angle 0 east, a quarter turn south: y runs down). */
const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
const compass = (a: number) => COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];

export function planWorld(seed: number, n: number): WorldPlan {
  const R = mulberry(seed * 2654435761),
    story: string[] = [];
  // Plates: hearts spread over and around the map, each drifting its own way.
  const np = 6 + Math.floor(R() * 6),
    plates: Plate[] = [];
  for (let tries = 0; plates.length < np && tries < 400; tries++) {
    const x = (-0.15 + 1.3 * R()) * n,
      y = (-0.15 + 1.3 * R()) * n;
    if (plates.some((p) => Math.hypot(p.x - x, p.y - y) < n * 0.24)) continue;
    const a = R() * Math.PI * 2,
      sp = 0.3 + 0.7 * R();
    plates.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ocean: false, swell: 0.05e-3 + 0.3e-3 * R() });
  }
  // Some worlds have sea: one or two plates of ocean floor, nearest an edge.
  const seaCount = R() < 0.35 ? 0 : R() < 0.7 ? 1 : 2;
  const byEdge = plates.map((p, i) => ({ i, d: Math.min(p.x, p.y, n - p.x, n - p.y) + R() * n * 0.2 })).sort((a, b) => a.d - b.d);
  for (let k = 0; k < seaCount; k++) {
    const p = plates[byEdge[k].i];
    p.ocean = true;
    p.swell = -0.12e-3;
  }
  const layersOf = () => {
    const beds = [ROCK.SANDSTONE, ROCK.SHALE, ROCK.LIMESTONE, ROCK.REDBED, ROCK.MUDSTONE, ROCK.CONGLOMERATE, ROCK.LIMESTONE, ROCK.SHALE, ROCK.SANDSTONE],
      layers: { rock: number; t: number }[] = [{ rock: ROCK.BASEMENT, t: 6000 }],
      nb = 7 + Math.floor(R() * 3);
    for (let k = 0; k < nb; k++) {
      const rock = beds[Math.floor(R() * beds.length)];
      layers.push({ rock, t: rock === ROCK.LIMESTONE ? 250 + 450 * R() : rock === ROCK.SHALE || rock === ROCK.MUDSTONE ? 150 + 350 * R() : 150 + 400 * R() });
      if (R() < 0.12) layers.push({ rock: ROCK.COAL, t: 20 + 30 * R() });
    }
    return layers;
  };
  const layers = layersOf();
  const fields: WorldPlan["fields"] = [],
    nf = R() < 0.45 ? 0 : R() < 0.75 ? 1 : 2;
  for (let k = 0; k < nf; k++) {
    const x = n * (0.15 + 0.7 * R()),
      y = n * (0.15 + 0.7 * R()),
      r = n * (0.05 + 0.05 * R()),
      cones = Array.from({ length: 2 + Math.floor(R() * 5) }, () => {
        const a = R() * Math.PI * 2,
          d = Math.sqrt(R()) * r;
        return { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: n * (0.008 + 0.012 * R()), rate: 0.8e-3 + 1.4e-3 * R() };
      });
    cones[0].rate *= 1.5;
    cones[0].r *= 1.4;
    fields.push({ x, y, r, from: 0.45 + 0.35 * R(), cones });
  }
  const plutons = Array.from({ length: Math.floor(R() * 3) }, () => ({ x: n * (0.1 + 0.8 * R()), y: n * (0.1 + 0.8 * R()), r: n * (0.04 + 0.06 * R()), top: -2600 + 1600 * R() }));
  const ng = 2 + Math.floor(R() * 2),
    glacials = Array.from({ length: ng }, (_, k) => {
    const c = (k + 0.5 + (R() - 0.5) * 0.5) / ng;
    return { from: Math.max(0.05, c * 0.9 - 0.06), to: Math.min(0.97, c * 0.9 + 0.04 + 0.04 * R()), cool: 6 + 5 * R() };
  });
  // The climate, as a game world has it: every kind of place, in many regions about 10 km across,
  // side by side (snow country a day's walk from desert). Each region has a warmth at sea level, a
  // wetness (a factor on the rain) and seasons; every kind several times, a few odd ones between;
  // spread out so each has room, the frozen and the hot kept a region apart.
  const KINDS: [string, () => { t: number; wet: number; season: number }][] = [
      ["frozen", () => ({ t: -4 + 2.5 * R(), wet: 0.6 + 0.3 * R(), season: 0 })],
      ["cold", () => ({ t: -1 + 4 * R(), wet: 1.1 + 0.4 * R(), season: (R() - 0.5) * 0.6 })],
      ["mild", () => ({ t: 9 + 5 * R(), wet: 0.8 + 0.5 * R(), season: R() < 0.5 ? 0.5 + 0.3 * R() : (R() - 0.5) * 0.5 })],
      ["hot and dry", () => ({ t: 24 + 5 * R(), wet: 0.18 + 0.12 * R(), season: (R() - 0.5) * 0.8 })],
      ["hot and wet", () => ({ t: 24 + 4 * R(), wet: 1.6 + 0.5 * R(), season: R() < 0.4 ? -0.6 : (R() - 0.5) * 0.4 })],
    ],
    kinds: { kind: string; t: number; wet: number; season: number }[] = [],
    share = [0.08, 0.18, 0.26, 0.2, 0.16],
    count = 60 + Math.floor(R() * 20);
  for (let k = 0; k < count; k++) {
    // Each kind at least three times; then by its share, and now and then an odd one.
    let q = k < 15 ? k % 5 : -1;
    if (q < 0 && R() < 0.88) {
      let u = R() * share.reduce((a, b) => a + b, 0);
      q = 0;
      while ((u -= share[q]) > 0) q++;
    }
    kinds.push(q < 0 ? { kind: "", t: 2 + 22 * R(), wet: 0.3 + 1.3 * R(), season: (R() - 0.5) * 1.4 } : { kind: KINDS[q][0], ...KINDS[q][1]() });
  }
  const regions: WorldPlan["climate"]["regions"] = [];
  for (const k of kinds) {
    let best: [number, number] = [n / 2, n / 2],
      bd = -1;
    // The best of a few tries: far from those placed; the frozen kept away from the hot.
    for (let t = 0; t < 24; t++) {
      const x = n * (0.04 + 0.92 * R()),
        y = n * (0.04 + 0.92 * R());
      let d = 1e9;
      for (const r of regions) {
        const far = Math.abs(r.t - k.t) > 20 ? 0.5 : 1;
        d = Math.min(d, Math.hypot(r.x - x, r.y - y) * far);
      }
      if (d > bd) (bd = d), (best = [x, y]);
    }
    regions.push({ x: best[0], y: best[1], ...k });
  }
  const climate = { wind: R() * Math.PI * 2, dry: 0.3 + 1.2 * R(), regions };
  return { plates, joins: [], fields, plutons, glacials, climate, layers, story, cross: null };
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
    s = (v: number) => (v * n) / 512, // a length given for a 512 map, in this map's cells
    P = plan.plates,
    JR = mulberry(seed * 7 + 99);
  // ---- Plates and their joins. ----
  const plate = new Uint8Array(N),
    joinOf = new Int16Array(N).fill(-1),
    bdist = new Float32Array(N),
    swellU = new Float32Array(N),
    hInit = new Float64Array(N),
    joinKey = new Map<number, number>();
  const joinFor = (a: number, b: number) => {
    const lo = Math.min(a, b),
      hi = Math.max(a, b),
      key = lo * 64 + hi;
    let j = joinKey.get(key);
    if (j !== undefined) return j;
    const pa = P[lo],
      pb = P[hi],
      dx = pb.x - pa.x,
      dy = pb.y - pa.y,
      l = Math.hypot(dx, dy),
      conv = ((pa.vx - pb.vx) * dx + (pa.vy - pb.vy) * dy) / l,
      kind: Join["kind"] = conv > 0.42 ? "range" : conv < -0.5 ? "rift" : "shear",
      r = JR(),
      era = JR();
    const join: Join =
      kind === "range"
        ? { a: lo, b: hi, conv, kind, w: n * (0.045 + 0.05 * JR()), rate: (0.3e-3 + 0.5e-3 * Math.min(1.3, conv)) * (0.75 + 0.5 * r), from: era < 0.3 ? 0 : era < 0.7 ? 0 : 0.3 + 0.3 * JR(), to: era < 0.3 ? 0.35 + 0.25 * JR() : 1 }
        : kind === "rift"
          ? { a: lo, b: hi, conv, kind, w: n * (0.018 + 0.016 * JR()), rate: -(0.2e-3 + 0.3e-3 * Math.min(1.3, -conv)), from: 0.2 * JR(), to: 1 }
          : { a: lo, b: hi, conv, kind, w: n * 0.03, rate: 0.05e-3 * conv, from: 0, to: 1 };
    j = plan.joins.length;
    plan.joins.push(join);
    joinKey.set(key, j);
    return j;
  };
  // Uplift along the joins, summed over every join near a cell (two kept: the strongest), so it
  // changes smoothly where the nearest join changes; the beds' folds likewise.
  const range = new Float32Array(N),
    range2 = new Float32Array(N),
    join2 = new Int16Array(N).fill(-1),
    fold = new Float32Array(N);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        // Joins that wander.
        qx = x + s(40) * (fbm(x / s(90), y / s(90), seed + 3, 3) - 0.5) * 2,
        qy = y + s(40) * (fbm(x / s(90), y / s(90), seed + 5, 3) - 0.5) * 2;
      let a = 0,
        b = 0,
        da = 1e18,
        db = 1e18;
      for (let k = 0; k < P.length; k++) {
        const d = (P[k].x - qx) ** 2 + (P[k].y - qy) ** 2;
        if (d < da) (b = a), (db = da), (a = k), (da = d);
        else if (d < db) (b = k), (db = d);
      }
      const sep = Math.hypot(P[b].x - P[a].x, P[b].y - P[a].y),
        bd = (db - da) / (2 * sep);
      plate[i] = a;
      bdist[i] = bd;
      joinOf[i] = joinFor(a, b);
      // Ground level at the start, and the plates' swells, blended across joins.
      const wt = 0.5 + 0.5 * Math.tanh(bd / s(14)),
        base = (p: Plate) => (p.ocean ? -1300 : 250),
        noise = 150 * fbm(x / s(120), y / s(120), seed + 43, 4) + 220 * (fbm(x / s(40), y / s(40), seed + 47, 3) - 0.5);
      hInit[i] = base(P[a]) * wt + base(P[b]) * (1 - wt) + noise;
      swellU[i] = P[a].swell * wt + P[b].swell * (1 - wt) + 0.08e-3 * (fbm(x / s(55), y / s(55), seed + 33, 3) - 0.5);
      let best = 0,
        bestJ = -1,
        sec = 0,
        secJ = -1;
      for (let k = 0; k < P.length; k++) {
        if (k === a) continue;
        const dk = (P[k].x - qx) ** 2 + (P[k].y - qy) ** 2,
          sk = Math.hypot(P[k].x - P[a].x, P[k].y - P[a].y),
          bk = (dk - da) / (2 * sk);
        if (bk > n * 0.25) continue;
        const j = joinFor(a, k),
          J = plan.joins[j],
          along = fbm(qx / s(60), qy / s(60), seed + 17 + j, 3);
        let u = 0;
        if (J.kind === "range") {
          // A crest that wanders, high massifs and saddles along it, spurs off it.
          const wob = J.w * (0.7 + 0.6 * along),
            core = Math.exp(-((bk / wob) ** 2)),
            peaks = 0.55 + 0.8 * fbm(x / s(40), y / s(40), seed + 21 + j, 4) + 0.3 * (fbm(x / s(14), y / s(14), seed + 25 + j, 2) - 0.5);
          u = J.rate * core * peaks * (0.45 + 0.9 * along);
          fold[i] += J.rate * 1.5e6 * core * Math.sin((bk * cell) / (5500 + 3000 * hash(j, 3, seed)) * Math.PI * 2 + j * 2.1 + 3 * along);
        } else if (J.kind === "rift") {
          // A trough with raised shoulders.
          const v = bk / J.w;
          u = J.rate * (Math.exp(-(v * v)) * (0.6 + 0.8 * along) - 0.35 * Math.exp(-(((v - 2.2) / 0.9) ** 2)));
        } else u = J.rate * Math.exp(-((bk / J.w) ** 2)) * (along - 0.3);
        if (Math.abs(u) > Math.abs(best)) (sec = best), (secJ = bestJ), (best = u), (bestJ = j);
        else if (Math.abs(u) > Math.abs(sec)) (sec = u), (secJ = j);
      }
      range[i] = best;
      range2[i] = sec;
      if (bestJ >= 0) joinOf[i] = bestJ;
      join2[i] = secJ;
    }
  // Volcanic cones, and the lava plains round them.
  const volc = plan.fields.map(() => new Float32Array(N)),
    lava = new Uint8Array(N);
  for (const [fi, f] of plan.fields.entries())
    for (let y = Math.max(0, Math.floor(f.y - f.r * 2)); y < Math.min(n, f.y + f.r * 2); y++)
      for (let x = Math.max(0, Math.floor(f.x - f.r * 2)); x < Math.min(n, f.x + f.r * 2); x++) {
        const i = y * n + x;
        for (const c of f.cones) {
          const d = Math.hypot(x - c.x, y - c.y) / c.r;
          volc[fi][i] += c.rate * (Math.exp(-(d * d)) + 0.12 * Math.exp(-((d / 3) ** 2)));
        }
        if (Math.hypot(x - f.x, y - f.y) < f.r * (0.9 + 0.5 * fbm(x / s(10), y / s(10), seed + 61, 2))) lava[i] = 1;
      }
  // Granite: how high it reaches into the beds (original depth), domed.
  const granite = new Float32Array(N).fill(-1e9);
  for (const g of plan.plutons)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - g.x, y - g.y) / (g.r * (0.8 + 0.4 * fbm(x / s(30), y / s(30), seed + 63, 2)));
        if (d < 1) granite[y * n + x] = Math.max(granite[y * n + x], g.top - 1800 * d * d);
      }
  // ---- Rock layers. ----
  const tops: Float32Array[] = [],
    total = plan.layers.reduce((a, l) => a + l.t, 0);
  {
    let base: Float32Array | null = null;
    plan.layers.forEach((l, k) => {
      const t = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = i % n,
          y = (i / n) | 0;
        t[i] = (base ? base[i] : -total) + l.t * (0.45 + 1.1 * fbm(x / s(90), y / s(90), seed * 7 + k * 31, 3));
      }
      tops.push(t);
      base = t;
    });
  }
  const h = Float64Array.from(hInit),
    uplift = new Float32Array(N),
    sed = new Float32Array(N),
    rock = new Uint8Array(N),
    kRock = new Float32Array(N);
  const rockUnder = (i: number, z: number) => {
    const z0 = z - uplift[i] - fold[i];
    if (granite[i] > -1e8 && z0 < granite[i]) return ROCK.GRANITE;
    let k = 0;
    while (k < tops.length - 1 && tops[k][i] < z0) k++;
    return plan.layers[k].rock;
  };
  const surfaceRock = () => {
    for (let i = 0; i < N; i++) {
      rock[i] = sed[i] > 2 ? SEDIMENT : lava[i] && uplift[i] > 120 ? ROCK.BASALT : rockUnder(i, h[i]);
      kRock[i] = ROCKS[rock[i]].k;
    }
  };
  // ---- Climate. ----
  const C = plan.climate,
    T0 = new Float32Array(N),
    rain = new Float32Array(N).fill(900),
    temp = new Float32Array(N),
    season = new Float32Array(N),
    ocean = new Float32Array(N),
    wetness = new Float32Array(N),
    wx = Math.cos(C.wind),
    wy = Math.sin(C.wind);
  // Each place takes its warmth, wetness and seasons from the regions, nearest most, blended
  // smoothly, read through warped coordinates so the borders wander.
  // (The regions as flat arrays, their wetness's log taken once.)
  const nR = C.regions.length,
    RX = C.regions.map((r) => r.x),
    RY = C.regions.map((r) => r.y),
    RT = C.regions.map((r) => r.t),
    RW = C.regions.map((r) => Math.log(r.wet)),
    RS = C.regions.map((r) => r.season),
    RD = n * 0.05,
    FAR2 = (7 * RD) ** 2;
  for (let i = 0; i < N; i++) {
    const x = i % n,
      y = (i / n) | 0,
      qx = x + n * 0.035 * (fbm(x / s(40), y / s(40), seed + 85, 3) - 0.5) * 2,
      qy = y + n * 0.035 * (fbm(x / s(40), y / s(40), seed + 87, 3) - 0.5) * 2;
    let ws = 0,
      t = 0,
      wt = 0,
      se = 0;
    for (let k = 0; k < nR; k++) {
      const dx = qx - RX[k],
        dy = qy - RY[k];
      let w = 1e-12;
      // (A region more than 7 of its radii off weighs exactly 1e-12: what exp adds to it is under
      // half its last bit.)
      if (dx * dx + dy * dy < FAR2) {
        const d = hypot2(dx, dy) / RD;
        w = Math.exp(-d * d * 1.6) + 1e-12;
      }
      ws += w;
      t += w * RT[k];
      wt += w * RW[k];
      se += w * RS[k];
    }
    T0[i] = t / ws + 2.5 * (fbm(x / s(60), y / s(60), seed + 81, 2) - 0.5);
    wetness[i] = Math.exp(wt / ws) * (0.85 + 0.3 * fbm(x / s(45), y / s(45), seed + 82, 2));
    season[i] = Math.max(-1, Math.min(1, se / ws + 0.3 * (fbm(x / s(180), y / s(180), seed + 83, 2) - 0.5)));
  }
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
  const climate = (cool = 0) => {
    const M = new Float32Array(N),
      Pr = new Float32Array(N),
      step = (1.5 * cell) / 1000;
    let seaUpwind = 0;
    for (let i = 0; i < N; i++) {
      const x = i % n,
        y = (i / n) | 0;
      if (sea[i] && (x * wx + y * wy) / n < 0.35 * Math.abs(wx) + 0.35 * Math.abs(wy)) seaUpwind = 1;
    }
    // Moist air comes in on the wind: it rains steadily over the lowlands and much more where the
    // air climbs; what rains out is gone, and the air dries as it crosses land (faster in some
    // worlds), regaining moisture over water. Warm air holds more.
    for (const i of order) {
      const x = i % n,
        y = Math.floor(i / n),
        fx = x - wx * 1.5,
        fy = y - wy * 1.5,
        inside = fx >= 0 && fy >= 0 && fx <= n - 1 && fy <= n - 1,
        here = Math.max(0, h[i]);
      let m: number, up: number;
      if (inside) {
        const x0 = Math.min(n - 2, Math.floor(fx)),
          y0 = Math.min(n - 2, Math.floor(fy)),
          ax = fx - x0,
          ay = fy - y0,
          a = y0 * n + x0;
        m = (M[a] * (1 - ax) + M[a + 1] * ax) * (1 - ay) + (M[a + n] * (1 - ax) + M[a + n + 1] * ax) * ay;
        up = (Math.max(0, h[a]) * (1 - ax) + Math.max(0, h[a + 1]) * ax) * (1 - ay) + (Math.max(0, h[a + n]) * (1 - ax) + Math.max(0, h[a + n + 1]) * ax) * ay;
      } else {
        m = seaUpwind ? 1 : 0.85;
        up = here;
      }
      const oro = Math.min(2.5, (Math.max(0, here - up) / (cell * 1.5)) * 12);
      Pr[i] = m * (1 + oro);
      M[i] = Math.min(1.1, Math.max(0.12, m + step * (-0.0035 * C.dry + (sea[i] || lakeNow[i] ? 0.012 : 0.003) - 0.016 * oro)));
    }
    let A = Pr,
      B = new Float32Array(N);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          if (y >= 2 && y < n - 2 && x >= 2 && x < n - 2) {
            // (Inside, the same sum in the same order, without the checks.)
            let t = 0;
            for (let r = (y - 2) * n + x, e = r + 5 * n; r < e; r += n) {
              t += A[r - 2];
              t += A[r - 1];
              t += A[r];
              t += A[r + 1];
              t += A[r + 2];
            }
            B[y * n + x] = t / 25;
            continue;
          }
          let t = 0,
            c = 0;
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx,
                yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              t += A[yy * n + xx];
              c++;
            }
          B[y * n + x] = t / c;
        }
      [A, B] = [B, A];
    }
    for (let i = 0; i < N; i++) {
      temp[i] = T0[i] - 0.0065 * Math.max(0, h[i]) - cool;
      rain[i] = (60 + 900 * A[i]) * Math.min(1.9, Math.max(0.45, 0.62 + 0.042 * T0[i])) * wetness[i];
    }
  };
  // ---- Water: sea, drainage, lakes, dry basins (Priority-Flood with epsilon; Barnes et al. 2014). ----
  const filled = new Float64Array(N),
    rec = new Int32Array(N),
    stack = new Int32Array(N),
    state = new Uint8Array(N),
    heapK = new Float64Array(N),
    heapI = new Int32Array(N),
    pit = new Int32Array(N),
    flow = new Float32Array(N),
    sink = new Uint8Array(N),
    lakeNow = new Uint8Array(N);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1],
    DY = [0, 0, 1, -1, 1, -1, 1, -1],
    DD = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2],
    /** The neighbours as offsets in the map (for cells not on its edges). */
    OFF = DX.map((dx, d) => DY[d] * n + dx);
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
  const route = (useSinks = true) => {
    // The sea: below sea level and joined to an edge below it.
    sea.fill(0);
    let qn = 0;
    for (let k = 0; k < n; k++)
      for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1])
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
    // Outlets: the sea, the edges, dry basins' floors. Then everything else, lowest first.
    state.fill(0);
    hn = 0;
    for (let i = 0; i < N; i++) {
      const x = i % n,
        y = (i / n) | 0;
      if (sea[i] || x === 0 || y === 0 || x === n - 1 || y === n - 1 || (useSinks && sink[i])) {
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
        y = (c / n) | 0,
        fc = filled[c],
        inner = x > 0 && y > 0 && x < n - 1 && y < n - 1;
      let best = -1,
        bs = 0;
      // (The steepest way down: straight neighbours first, then diagonal ones, as DX, DY order
      // them; a straight step's slope needs no division, its length being 1.)
      if (!sea[c] && !(useSinks && sink[c]) && inner) {
        for (let d = 0; d < 4; d++) {
          const j = c + OFF[d];
          if (state[j] !== 2) continue;
          const sl = fc - filled[j];
          if (best < 0 || sl > bs) {
            best = j;
            bs = sl;
          }
        }
        for (let d = 4; d < 8; d++) {
          const j = c + OFF[d];
          if (state[j] !== 2) continue;
          const sl = (fc - filled[j]) / Math.SQRT2;
          if (best < 0 || sl > bs) {
            best = j;
            bs = sl;
          }
        }
      }
      rec[c] = best;
      const up = fc + 1e-3;
      for (let d = 0; d < 8; d++) {
        let j: number;
        if (inner) j = c + OFF[d];
        else {
          const xx = x + DX[d],
            yy = y + DY[d];
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          j = yy * n + xx;
        }
        if (state[j]) continue;
        state[j] = 1;
        if (h[j] <= up) {
          filled[j] = up;
          pit[pt++] = j;
        } else {
          filled[j] = h[j];
          push(h[j], j);
        }
      }
    }
    for (let i = 0; i < N; i++) {
      flow[i] = cell * cell * Math.min(2.5, Math.max(0.1, (rain[i] - 150) / 800));
      lakeNow[i] = !sea[i] && filled[i] - h[i] > 1 ? 1 : 0;
    }
    for (let k = N - 1; k >= 0; k--) {
      const c = stack[k];
      if (rec[c] >= 0) flow[rec[c]] += flow[c];
    }
  };
  /** Lakes too dry to fill: their lowest cell becomes a sink, so water ends there. */
  const drySinks = () => {
    const seen = new Uint8Array(N),
      q: number[] = [];
    for (let i0 = 0; i0 < N; i0++) {
      if (!lakeNow[i0] || seen[i0]) continue;
      q.length = 0;
      q.push(i0);
      seen[i0] = 1;
      let low = i0,
        rs = 0,
        ts = 0;
      for (let k = 0; k < q.length; k++) {
        const c = q[k],
          x = c % n,
          y = (c / n) | 0;
        if (h[c] < h[low]) low = c;
        rs += rain[c];
        ts += temp[c];
        for (let d = 0; d < 8; d++) {
          const xx = x + DX[d],
            yy = y + DY[d];
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const j = yy * n + xx;
          if (lakeNow[j] && !seen[j]) {
            seen[j] = 1;
            q.push(j);
          }
        }
      }
      // Evaporation outruns rain where it is dry, and faster where it is warm.
      if (rs / q.length < 330 + 16 * Math.max(0, ts / q.length)) sink[low] = 1;
    }
  };
  // ---- Eras. ----
  const K = 6e-6,
    m = 0.45,
    talus = 0.85,
    LIM = DD.map((dd) => talus * cell * dd),
    ice = new Float32Array(N);
  for (let e = 0; e < eras; e++) {
    const f = e / eras,
      glacial = plan.glacials.find((g) => f >= g.from && f < g.to);
    // Uplift. (Which joins and volcanic fields are active this era, worked out once.)
    const active = Uint8Array.from(plan.joins, (J) => (f >= J.from && f < J.to ? 1 : 0)),
      cones = volc.filter((_, fi) => f >= plan.fields[fi].from);
    for (let y = 1; y < n - 1; y++)
      for (let i = y * n + 1, end = i + n - 2; i < end; i++) {
        const j2 = join2[i];
        let u = swellU[i] + (active[joinOf[i]] ? range[i] : 0) + (j2 >= 0 && active[j2] ? range2[i] : 0);
        for (let k = 0; k < cones.length; k++) u += cones[k][i];
        h[i] += u * dt;
        uplift[i] += u * dt;
      }
    if (e % 6 === 0 || glacial) climate(glacial ? glacial.cool : 0);
    surfaceRock();
    route();
    if (e > 6 && e % 3 === 0) drySinks();
    // Rivers cut down (implicit stream power), receivers first; lakes and basins silt up.
    for (let k = 0; k < N; k++) {
      const c = stack[k],
        r = rec[c];
      if (sea[c]) continue;
      if (r < 0) {
        if (sink[c]) {
          h[c] += 2e-5 * dt;
          sed[c] += 2e-5 * dt;
        }
        continue;
      }
      if (filled[c] > h[c] + 0.5) {
        const add = Math.min(filled[c] - h[c], 2e-5 * dt);
        h[c] += add;
        sed[c] += add;
        continue;
      }
      const hr = Math.max(h[r], filled[r] > h[r] + 0.5 ? filled[r] : h[r]);
      // (Where the receiver stands no lower, nothing is cut, whatever the stream's power.)
      if (hr >= h[c]) continue;
      // (A receiver is a neighbour: a step of 1 or √2 cells, as Math.hypot gives them.)
      const d = (c % n !== r % n && ((c / n) | 0) !== ((r / n) | 0) ? Math.SQRT2 : 1) * cell,
        fk = (K * (0.2 + 0.8 * kRock[c]) * dt * flow[c] ** m) / d,
        nh = (h[c] + fk * hr) / (1 + fk);
      if (nh < h[c]) {
        const cut = h[c] - Math.max(nh, hr);
        if (cut > 0) {
          h[c] -= cut;
          sed[c] = Math.max(0, sed[c] - cut);
        }
      }
    }
    // Glaciers: ice gathers where it is cold enough and flows down the valleys until it melts,
    // gouging deeper than any river (below the valley downstream, so lakes are left behind),
    // widening its valley, and dropping moraine where it ends.
    if (glacial) {
      for (let k = N - 1; k >= 0; k--) {
        const c = stack[k];
        ice[c] += temp[c] < -5 ? cell * cell : 0;
        if (temp[c] > -5) ice[c] *= Math.max(0, 1 - (temp[c] + 5) / 9);
        if (rec[c] >= 0) ice[rec[c]] += ice[c];
      }
      const thr = cell * cell * 6;
      for (let c = 0; c < N; c++) {
        if (ice[c] < thr || sea[c]) continue;
        const x = c % n,
          y = (c / n) | 0;
        if (x < 1 || y < 1 || x > n - 2 || y > n - 2) continue;
        const gouge = Math.min(70, 3.2e-4 * Math.sqrt(ice[c]) * (dt / 6e4));
        h[c] -= gouge;
        sed[c] = 0;
        for (let d = 0; d < 4; d++) {
          const j = (y + DY[d]) * n + x + DX[d];
          if (h[j] > h[c] + gouge) h[j] -= gouge * 0.45;
        }
        const r = rec[c];
        if (r >= 0 && ice[r] < thr && !sea[r]) {
          // The snout: moraine.
          const ry = (r / n) | 0,
            rx = r % n;
          for (let d = -1; d < 8; d++) {
            const j = d < 0 ? r : (ry + DY[d]) * n + rx + DX[d];
            if (j < 0 || j >= N || sea[j]) continue;
            const add = Math.min(25, gouge * 0.5);
            h[j] += add;
            sed[j] += add;
          }
        }
      }
      ice.fill(0);
    }
    // Slopes steeper than rock stands shed scree onto the cell below.
    for (let pass = 0; pass < 2; pass++)
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          const i = y * n + x;
          let hi = h[i];
          for (let d = 0; d < 8; d++) {
            const j = i + OFF[d],
              lim = LIM[d],
              dh = hi - h[j];
            if (dh > lim) {
              const mv = (dh - lim) * 0.25;
              hi -= mv;
              h[i] = hi;
              h[j] += mv;
              sed[j] += mv;
              sed[i] = Math.max(0, sed[i] - mv);
            }
          }
        }
    // The edges follow the land inside them, a little lower, so rivers leave the map.
    for (let k = 0; k < n; k++)
      for (const [a, b] of [[k, n + k], [(n - 1) * n + k, (n - 2) * n + k], [k * n, k * n + 1], [k * n + n - 1, k * n + n - 2]]) if (h[b] >= 0) h[a] = Math.min(h[a], h[b] - 2) * 0.5 + (h[b] - 2) * 0.5;
    o.progress?.((e + 1) / (eras + 3));
  }
  climate();
  surfaceRock();
  route();
  drySinks();
  route();
  // ---- Water at the end: lakes, and in dry basins salt flats round a salt lake. ----
  const lake = new Float32Array(N),
    salt = new Uint8Array(N),
    playa = new Uint8Array(N),
    hh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hh[i] = h[i];
    lake[i] = !sea[i] && filled[i] - h[i] > 1 ? filled[i] - h[i] : 0;
  }
  {
    const keepRec = Int32Array.from(rec),
      keepFlow = Float32Array.from(flow),
      keepFilled = Float64Array.from(filled);
    route(false);
    // Hollows that would hold water if it were wetter: their floors.
    const seen = new Uint8Array(N),
      q: number[] = [];
    for (let i0 = 0; i0 < N; i0++) {
      if (seen[i0] || lake[i0] > 0 || sea[i0] || filled[i0] - h[i0] < 0.5) continue;
      q.length = 0;
      q.push(i0);
      seen[i0] = 1;
      let low = 1e9,
        wet = false;
      for (let k = 0; k < q.length; k++) {
        const c = q[k],
          x = c % n,
          y = (c / n) | 0;
        low = Math.min(low, h[c]);
        for (let d = 0; d < 8; d++) {
          const xx = x + DX[d],
            yy = y + DY[d];
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const j = yy * n + xx;
          // A hollow beside a lake or the sea is part of that water's shore, not a dry basin.
          if ((lake[j] > 0 && !salt[j]) || sea[j]) wet = true;
          if (!seen[j] && !(lake[j] > 0) && !sea[j] && filled[j] - h[j] >= 0.5) {
            seen[j] = 1;
            q.push(j);
          }
        }
      }
      if (q.length < 3 || wet) continue;
      for (const c of q) {
        const up = h[c] - low;
        if (up < 6 && rain[c] > 260) {
          lake[c] = 6 - up + 1;
          salt[c] = 1;
        } else if (up < 30) playa[c] = 1;
      }
    }
    rec.set(keepRec);
    flow.set(keepFlow);
    filled.set(keepFilled);
  }
  // ---- Nearness to the sea, habitat, soil, zone, biome. ----
  {
    const dist = new Float32Array(N).fill(1e9),
      q: number[] = [];
    for (let i = 0; i < N; i++) if (sea[i]) (dist[i] = 0), q.push(i);
    for (let k = 0; k < q.length; k++) {
      const c = q[k],
        x = c % n,
        y = (c / n) | 0;
      for (let d = 0; d < 4; d++) {
        const xx = x + DX[d],
          yy = y + DY[d];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx;
        if (dist[j] > dist[c] + 1) {
          dist[j] = dist[c] + 1;
          q.push(j);
        }
      }
    }
    // Nearness to the sea (by a wandering measure, so the coastal climate's edge wanders too).
    for (let i = 0; i < N; i++) {
      const x = i % n,
        y = (i / n) | 0;
      ocean[i] = Math.max(0, Math.min(1, 1 - (dist[i] * cell * 0.8) / (40000 * (0.55 + 0.9 * fbm(x / s(70), y / s(70), seed + 89, 3)))));
    }
  }
  const zone = new Uint8Array(N),
    habitat = new Uint8Array(N),
    soil = new Uint8Array(N),
    biome = new Uint8Array(N);
  const at = (x: number, y: number) => h[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
  for (let i = 0; i < N; i++) {
    const x = i % n,
      y = (i / n) | 0;
    if (sea[i]) {
      zone[i] = ZONE.OCEAN;
      biome[i] = WATER;
      continue;
    }
    if (lake[i] > 0) {
      zone[i] = ZONE.LAKE;
      biome[i] = WATER;
      continue;
    }
    const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * cell),
      gy = (at(x, y + 1) - at(x, y - 1)) / (2 * cell),
      sl = Math.hypot(gx, gy),
      // How much the cell stands above (or sinks below) the ground round it, out to 600 m.
      ring = (at(x - 3, y) + at(x + 3, y) + at(x, y - 3) + at(x, y + 3) + at(x - 2, y - 2) + at(x + 2, y + 2) + at(x - 2, y + 2) + at(x + 2, y - 2)) / 8,
      relief = h[i] - ring;
    let nearWater = false;
    for (let d = 0; d < 8 && !nearWater; d++) {
      const xx = x + DX[d],
        yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (sea[j] || lake[j] > 0) nearWater = true;
    }
    const T = temp[i],
      Pm = rain[i],
      wetFlat = sl < 0.02 && (flow[i] > 4e7 || Pm > 1200) && relief < 2;
    const hab = nearWater
      ? HABITAT.SHORE
      : sl > 0.75
        ? HABITAT.CLIFF
        : flow[i] > 1.2e8
          ? HABITAT.RIVERSIDE
          : wetFlat
            ? HABITAT.WETLAND
            : relief > 18 * (cell / 200)
              ? HABITAT.RIDGE
              : relief < -14 * (cell / 200)
                ? HABITAT.VALLEY
                : sl < 0.05
                  ? HABITAT.FLAT
                  : HABITAT.SLOPE;
    const r = rock[i],
      so =
        T < 6 && Pm > 850 && sl < 0.04
          ? SOIL.PEAT
          : r === ROCK.LIMESTONE
            ? SOIL.ALKALINE
            : r === ROCK.SANDSTONE || r === ROCK.DUNE || r === ROCK.CONGLOMERATE || r === SEDIMENT
              ? SOIL.SANDY
              : r === ROCK.SHALE || r === ROCK.MUDSTONE || r === ROCK.REDBED || r === ROCK.TILL || r === ROCK.COAL
                ? SOIL.CLAY
                : r === ROCK.BASALT || r === ROCK.ASH
                  ? SOIL.RICH
                  : r === ROCK.SALT
                    ? SOIL.SALTY
                    : SOIL.STONY;
    // Above the treeline (a yearly mean near freezing) the mountains are alpine, whatever the
    // climate below; elsewhere the strip worlds' zones.
    const z = playa[i] ? ZONE.SALT_FLAT : T < -9 ? ZONE.ICE : T < 0.5 && h[i] > 700 ? ZONE.ALPINE : zoneOf(T, Pm, season[i], ocean[i], 0),
      open = fbm(x / s(12), y / s(12), seed + 71, 3) > 0.66,
      typical = T > 18 ? 1300 : T > 10 ? 800 : 600;
    habitat[i] = hab;
    soil[i] = playa[i] ? SOIL.SALTY : so;
    zone[i] = z;
    // Snow lies on alpine ridges only where it is cold enough to last the summer.
    const b = classify(z, z === ZONE.ALPINE && hab === HABITAT.RIDGE && T > -5 ? HABITAT.SLOPE : hab, soil[i], { wet: Pm > typical * 1.8, dry: Pm < typical * 0.8, high: h[i] > 1200, open });
    biome[i] = b < 0 ? WATER : b;
  }
  // The section to show at first: across the most active range, through its highest ground.
  {
    let best = -1,
      bh = -1e9;
    for (let i = 0; i < N; i++) {
      const J = plan.joins[joinOf[i]];
      if (J.kind !== "range" || sea[i]) continue;
      const x = i % n,
        y = (i / n) | 0;
      if (x < n * 0.15 || y < n * 0.15 || x > n * 0.85 || y > n * 0.85) continue;
      if (h[i] > bh) (bh = h[i]), (best = i);
    }
    if (best < 0) for (let i = 0; i < N; i++) if (h[i] > bh) (bh = h[i]), (best = i);
    const J = plan.joins[joinOf[best]],
      pa = P[J.a],
      pb = P[J.b],
      l = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1,
      nx = (pb.x - pa.x) / l,
      ny = (pb.y - pa.y) / l,
      cx = best % n,
      cy = (best / n) | 0,
      half = n * 0.34,
      cl = (v: number) => Math.min(n - 2, Math.max(1, v));
    plan.cross = [[cl(cx - nx * half), cl(cy - ny * half)], [cl(cx + nx * half), cl(cy + ny * half)]];
  }
  // ---- What this world holds, in words. ----
  {
    const onMap = new Set<number>();
    for (let i = 0; i < N; i += 7) onMap.add(joinOf[i]);
    const joins = [...onMap].map((j) => plan.joins[j]),
      ranges = joins.filter((J) => J.kind === "range"),
      old = ranges.filter((J) => J.to < 1).length,
      young = ranges.filter((J) => J.from > 0).length,
      rifts = joins.filter((J) => J.kind === "rift").length,
      story = plan.story;
    const count = (k: number, one: string, many: string) => (k === 1 ? `one ${one}` : `${["no", "one", "two", "three", "four", "five", "six", "seven", "eight"][k] ?? k} ${many}`);
    story.push(`${count(ranges.length, "mountain range", "mountain ranges")}${old ? `, ${old === ranges.length && old > 1 ? "all" : old} worn down to hills` : ""}${young ? `, ${young} still young and rising` : ""}`);
    if (rifts) story.push(count(rifts, "rift with lakes along it", "rifts with lakes along them"));
    if (plan.fields.length) story.push(count(plan.fields.length, "volcanic field", "volcanic fields"));
    if (plan.plutons.length) story.push("granite domes");
    let seaN = 0,
      lakes = 0,
      salty = 0;
    for (let i = 0; i < N; i++) {
      if (sea[i]) seaN++;
      if (lake[i] > 0 && !salt[i]) lakes++;
      if (playa[i] || salt[i]) salty++;
    }
    if (seaN > N * 0.02) story.push("a coast");
    if (lakes > N * 0.004) story.push("lakes left by the ice");
    if (salty > N * 0.002) story.push("salt flats in a dry basin");
    story.push(`${plan.glacials.length} ice ages`);
    // The climates: the commonest, and the rest in patches.
    const zc = new Map<number, number>();
    for (let i = 0; i < N; i++) if (zone[i] !== ZONE.OCEAN && zone[i] !== ZONE.LAKE) zc.set(zone[i], (zc.get(zone[i]) ?? 0) + 1);
    const byShare = [...zc].sort((a, b) => b[1] - a[1]).map(([z]) => ZONES[z].name.toLowerCase()),
      list = (a: string[]) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : a[0] ?? "");
    story.push(`${C.regions.length} climate regions: mostly ${list(byShare.slice(0, 2))}, with ${list(byShare.slice(2, 6))} in patches`);
    story.push(`rain on the wind from the ${compass(C.wind + Math.PI)}`);
  }
  o.progress?.(1);
  return { seed, n, cell, plan, h: hh, lake, salt, sea, rec, flow, rain, temp, season, ocean, uplift, sed, rock, zone, habitat, soil, biome, plate, tops, fold, granite };
}

/** The rock at a point of a section: at elevation z (m) under cell i (-1 above ground). */
export function rockAt(w: World2D, i: number, z: number) {
  const top = w.h[i];
  if (z > top) return -1;
  if (z > top - w.sed[i] && w.sed[i] > 2) return SEDIMENT;
  if (w.rock[i] === ROCK.BASALT && z > top - 150) return ROCK.BASALT;
  const z0 = z - w.uplift[i] - w.fold[i];
  if (w.granite[i] > -1e8 && z0 < w.granite[i]) return ROCK.GRANITE;
  let k = 0;
  while (k < w.tops.length - 1 && w.tops[k][i] < z0) k++;
  return w.plan.layers[k].rock;
}
