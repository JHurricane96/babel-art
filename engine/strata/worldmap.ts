// Strata's regions read the world's history (history.ts): ground, rock,
// water and climate at any art column, worked out from the world's coarse
// columns (CELL art pixels each). Everything is a function of the seed and
// the world position, so regions built separately line up exactly.
import {
  CELL,
  ROCK,
  ROCKS,
  SEA_ROW,
  simulateWorld,
  type World,
} from "./history";
import {
  BIOMES,
  HABITAT,
  SOIL,
  ZONE,
  ZONES,
  classify,
  zoneOf,
} from "./biomes";
import { fbm1, hash3 } from "./world";
import { landformAt, volcanoAt } from "./landforms";

const worlds = new Map<number, World>();

let source: ((seed: number) => World | undefined) | null = null;

/**
 * Lab tools and tests can hand worlds in (from a disk cache) instead of
 * having each process build them; a world is a pure function of its seed.
 */
export function setWorldSource(fn: ((seed: number) => World | undefined) | null) {
  source = fn;
}

/** Use a world already built for this seed (e.g. one with its history recorded). */
export function adoptWorld(seed: number, w: World) {
  worlds.delete(seed);
  worlds.set(seed, w);
  if (worlds.size > 3) worlds.delete(worlds.keys().next().value!);
}

/** The world for a seed, built once and kept (the last few). */
export function worldOf(seed: number): World {
  let w = worlds.get(seed);
  if (!w) {
    w = source?.(seed) ?? simulateWorld(seed);
    worlds.set(seed, w);
    if (worlds.size > 3) worlds.delete(worlds.keys().next().value!);
  }
  return w;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Left coarse column and the fraction past its centre, for art column x. */
function pos(w: World, x: number) {
  const u = x / CELL - 0.5,
    c = Math.floor(u);
  if (c < 0) return { c: 0, t: 0 };
  if (c >= w.n - 1) return { c: w.n - 2, t: 1 };
  return { c, t: u - c };
}
const colAt = (w: World, x: number) => clamp(Math.floor(x / CELL), 0, w.n - 1);

/** The land's elevation at x, smoothly through the coarse columns (no detail). */
function smoothElevation(w: World, x: number) {
  const u = x / CELL - 0.5,
    c = Math.floor(u),
    t = clamp(u - c, 0, 1),
    s = (k: number) => w.surface[clamp(k, 0, w.n - 1)],
    p0 = s(c - 1),
    p1 = s(c),
    p2 = s(c + 1),
    p3 = s(c + 2),
    v =
      p1 +
      0.5 *
        t *
        (p2 -
          p0 +
          t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  // No overshoot past the neighbours (a rift's wall stays a wall).
  return clamp(v, Math.min(p1, p2), Math.max(p1, p2));
}

/** The coarse slope at x (elevation per art pixel). */
function slopeAt(w: World, x: number) {
  const c = colAt(w, x),
    a = w.surface[clamp(c - 1, 0, w.n - 1)],
    b = w.surface[clamp(c + 1, 0, w.n - 1)];
  return Math.abs(b - a) / (2 * CELL);
}

// ---- Rock --------------------------------------------------------------------

/** The rock at one art column: basement top, then each layer's kind and top (elevations, bottom up). */
export interface RockColumn {
  b: number;
  kinds: number[];
  tops: number[];
}

/**
 * The layers at art column x: the two nearest coarse columns' stacks, each
 * layer matched to its counterpart by when it formed, so a bed's top runs
 * smoothly from one column to the next; where the two laid down different
 * rock in that age (sand inshore, mud offshore), the rock changes over part
 * way across, at a ragged line. A bed only one side has thins away toward
 * the other. Bed tops wander a little.
 */
export function rockAt(seed: number, x: number): RockColumn {
  const w = worldOf(seed),
    { c, t } = pos(w, x),
    a0 = w.offsets[c],
    a1 = w.offsets[c + 1],
    b0 = w.offsets[c + 1],
    b1 = w.offsets[c + 2],
    keyOf = (o0: number, o1: number) => {
      const keys: number[] = [],
        seen = new Map<number, number>();
      for (let k = o0; k < o1; k++) {
        const base = w.ages[k],
          n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        keys.push(base * 64 + n);
      }
      return keys;
    },
    ka = keyOf(a0, a1),
    kb = keyOf(b0, b1),
    inA = new Set(ka),
    inB = new Set(kb),
    th = (o0: number, k: number, base: number) =>
      w.tops[o0 + k] - (k > 0 ? w.tops[o0 + k - 1] : base),
    out: RockColumn = {
      b: w.b[c] + (w.b[c + 1] - w.b[c]) * t,
      kinds: [],
      tops: [],
    };
  let i = 0,
    j = 0,
    h = out.b;
  // Beds keep their own thickness, however thin (everything here varies
  // smoothly along the world, so nothing jumps from one column to the next);
  // their tops wander a little, thin beds least, so they never cross.
  const push = (kind: number, thick: number, key: number) => {
    if (thick <= 0.05) return;
    h += thick;
    const last = out.kinds.length - 1,
      wob =
        Math.min(2.5, 0.2 * thick) *
        (2 * fbm1(x / 70 + (key % 997) * 0.37, seed + 600, 2) - 1);
    if (last >= 0 && out.kinds[last] === kind)
      out.tops[last] = Math.max(out.tops[last], h + wob);
    else {
      out.kinds.push(kind);
      out.tops.push(Math.max(last >= 0 ? out.tops[last] : out.b, h + wob));
    }
  };
  while (i < ka.length || j < kb.length) {
    if (i < ka.length && j < kb.length && ka[i] === kb[j]) {
      const kA = w.kinds[a0 + i],
        kB = w.kinds[b0 + j],
        thick =
          th(a0, i, w.b[c]) + (th(b0, j, w.b[c + 1]) - th(a0, i, w.b[c])) * t;
      if (kA === kB) push(kA, thick, ka[i]);
      else {
        // Where the rock changes, the new kind comes in as a wedge, thickening
        // across the bed (above or below the old), so the two interfinger.
        const cut =
            0.5 +
            0.3 * (2 * fbm1(x / 90 + (ka[i] % 997) * 0.53, seed + 610, 2) - 1),
          f = Math.min(1, Math.max(0, (t - cut + 0.3) / 0.6)),
          over = ka[i] & 1;
        if (over) {
          push(kA, thick * (1 - f), ka[i]);
          push(kB, thick * f, ka[i] + 1);
        } else {
          push(kB, thick * f, ka[i] + 1);
          push(kA, thick * (1 - f), ka[i]);
        }
      }
      i++;
      j++;
    } else if (j < kb.length && (i >= ka.length || !inA.has(kb[j]))) {
      push(w.kinds[b0 + j], th(b0, j, w.b[c + 1]) * t, kb[j]);
      j++;
    } else if (i < ka.length && (j >= kb.length || !inB.has(ka[i]))) {
      push(w.kinds[a0 + i], th(a0, i, w.b[c]) * (1 - t), ka[i]);
      i++;
    } else {
      // Both present but out of order: take this side's and move on.
      push(w.kinds[a0 + i], th(a0, i, w.b[c]) * (1 - t), ka[i]);
      i++;
    }
  }
  // The beds rise with the landform, so its valleys cut down through them.
  const lift = landformAt(w, seed, x).U;
  out.b += lift;
  for (let k = 0; k < out.tops.length; k++) out.tops[k] += lift;
  return out;
}

/** The rock kind at elevation z in a column (the top layer reaches up to the ground). */
export function kindAt(col: RockColumn, z: number) {
  if (z <= col.b || col.kinds.length === 0) return ROCK.BASEMENT;
  for (let k = 0; k < col.kinds.length; k++)
    if (z <= col.tops[k]) return col.kinds[k];
  return col.kinds[col.kinds.length - 1];
}

/** Hard rock holds up cliffs and benches; soft rock wears into slopes. */
export const hard = (kind: number) => ROCKS[kind].k < 0.6;

// ---- Water -------------------------------------------------------------------

/** A river crossing near x: its centre, half-width and depth in art pixels. */
function riverNear(w: World, x: number, reach = 40) {
  for (const r of w.rivers) {
    if (w.wet[r.c]) continue;
    const xc = (r.c + 0.5) * CELL,
      size = Math.sqrt(r.q / 33000),
      hw = 8 + 16 * size;
    if (Math.abs(x - xc) < hw + reach) return { xc, hw, size, depth: 5 + 9 * size };
  }
  return null;
}

/** The rivers crossing art columns [x0, x1): centre, half-width and depth of each channel. */
export function riversIn(seed: number, x0: number, x1: number) {
  const w = worldOf(seed),
    out: { xc: number; hw: number; depth: number }[] = [];
  for (const r of w.rivers) {
    const xc = (r.c + 0.5) * CELL;
    if (xc < x0 || xc >= x1 || w.wet[r.c]) continue;
    const size = Math.sqrt(r.q / 33000);
    out.push({ xc, hw: 8 + 16 * size, depth: 5 + 9 * size });
  }
  return out;
}

/**
 * The water standing at art column x, as an elevation, or null: the sea
 * (where the world has sea here or beside), a lake at its level, or a river
 * in its channel.
 */
export function waterAt(
  seed: number,
  x: number,
): { level: number; kind: "sea" | "lake" | "river" } | null {
  const w = worldOf(seed),
    c = Math.floor(x / CELL);
  if (c < 0 || c >= w.n) return { level: 0, kind: "sea" };
  for (const k of [c, c - 1, c + 1]) {
    const q = clamp(k, 0, w.n - 1);
    if (w.wet[q] === 3) return { level: 0, kind: "sea" };
  }
  for (const k of [c, c - 1, c + 1]) {
    const q = clamp(k, 0, w.n - 1);
    if (w.wet[q] === 1) return { level: w.water[q], kind: "lake" };
  }
  const rv = riverNear(w, x);
  if (rv && Math.abs(x - rv.xc) < rv.hw) {
    const rim = Math.min(
      groundElevation(seed, rv.xc - rv.hw, false),
      groundElevation(seed, rv.xc + rv.hw, false),
    );
    return { level: rim - 1, kind: "river" };
  }
  return null;
}

// ---- Ground ------------------------------------------------------------------

/**
 * The ground's elevation at art column x: the world's land, smoothly
 * through its columns, roughened (more on slopes), cut by river channels,
 * and stepped where a hard bed caps softer rock: the ground rests on the
 * hard bed's top as a bench, and drops as a cliff where the slope below has
 * worn past it.
 */
export function groundElevation(seed: number, x: number, channels = true) {
  const w = worldOf(seed),
    form = landformAt(w, seed, x),
    right = landformAt(w, seed, x + 8),
    left = landformAt(w, seed, x - 8),
    // Where the world's land already stands high, the landform is scaled
    // down (shape kept) so its tops stay under the sky's ceiling.
    base = smoothElevation(w, x),
    room = Math.max(60, 880 - base) / Math.max(1, form.U),
    lf = form.L * Math.min(1, room) - form.cut,
    lfSlope = (Math.abs(right.L - left.L) * Math.min(1, room) + Math.abs(right.cut - left.cut)) / 16,
    slope = slopeAt(w, x) + lfSlope,
    amp = 2 + 26 * Math.min(0.5, slope);
  // The world's land, its landform (hills, mesas, peaks: landforms.ts), and
  // finer roughness, more on slopes.
  let z =
    base +
    lf +
    6 * (2 * fbm1(x / 300, seed + 503, 2) - 1) +
    amp * (2 * fbm1(x / 45, seed + 501, 3) - 1) +
    0.4 * amp * (2 * fbm1(x / 13, seed + 502, 2) - 1);
  const c = colAt(w, x),
    rv = riverNear(w, x),
    wet =
      w.wet[c] !== 0 ||
      w.wet[clamp(c - 1, 0, w.n - 1)] === 3 ||
      w.wet[clamp(c + 1, 0, w.n - 1)] === 3;
  if (!wet && !(rv && Math.abs(x - rv.xc) < rv.hw + 30)) {
    const col = rockAt(seed, x);
    for (let k = col.kinds.length - 1; k >= 0; k--) {
      const top = col.tops[k],
        bottom = k > 0 ? col.tops[k - 1] : col.b;
      if (z > top) break;
      if (z <= bottom) continue;
      if (hard(col.kinds[k]) && top - bottom > 4) {
        // Small ledges only: the landforms make the big cliffs.
        const gap = top - z,
          step = 4 + 24 * Math.min(0.4, slope);
        if (gap < step) z = top - gap * 0.3;
      }
      break;
    }
  }
  // Peaks bend under a soft ceiling, so there is sky above even the highest.
  if (z > 860) z = 860 + 40 * Math.tanh((z - 860) / 40);
  if (channels && rv && Math.abs(x - rv.xc) < rv.hw) {
    const d = (x - rv.xc) / rv.hw;
    z -= rv.depth * (1 - d * d);
  }
  return z;
}

/** The ground at x as a screen row (cells from the top of the world). */
export function groundRow(seed: number, x: number) {
  return SEA_ROW - groundElevation(seed, x);
}

// ---- Climate, habitat, soil and biome ----------------------------------------------

/** Rain (mm a year) at x, from the world's climate. */
export function rainAt(seed: number, x: number) {
  const w = worldOf(seed),
    { c, t } = pos(w, x);
  return w.P[c] + (w.P[c + 1] - w.P[c]) * t;
}

/** Warmth (°C) at x on the ground at the given row, from the world's climate, colder with height. */
export function warmthAt(seed: number, x: number, row: number) {
  const w = worldOf(seed),
    { c, t } = pos(w, x),
    T = w.T[c] + (w.T[c + 1] - w.T[c]) * t,
    coarse = w.surface[c] + (w.surface[c + 1] - w.surface[c]) * t;
  return T - 0.025 * (SEA_ROW - row - coarse);
}

/** The land's shape at the scale of habitats: the world's land and its landform, without the fine detail. */
function relief(w: World, seed: number, x: number) {
  const f = landformAt(w, seed, x),
    base = smoothElevation(w, x);
  return base + f.L * Math.min(1, Math.max(60, 880 - base) / Math.max(1, f.U)) - f.cut;
}

/** Is the place by the sea or a lake, or by a river? (Local: these keep their own edges.) */
function shoreAt(w: World, seed: number, x: number) {
  for (const d of [-140, 0, 140]) {
    const wa = waterAt(seed, x + d);
    if (wa && wa.kind !== "river" && relief(w, seed, x + d) < wa.level + 6)
      return HABITAT.SHORE;
  }
  // Bigger rivers keep wider banks.
  const rv = riverNear(w, x, 260);
  if (rv && Math.abs(x - rv.xc) < rv.hw + 90 + 120 * Math.min(1.4, rv.size))
    return HABITAT.RIVERSIDE;
  return -1;
}

/** Where a place sits in the land (HABITAT), at one column. */
export function habitatAt(seed: number, x: number) {
  const w = worldOf(seed),
    by = shoreAt(w, seed, x);
  return by >= 0 ? by : habitatFormAt(w, seed, x);
}

/** The land's form at x, away from water: ridge, valley, cliff, slope, flat or wetland. */
function habitatFormAt(w: World, seed: number, x: number) {
  const z = relief(w, seed, x);
  // Cliffs from the ground itself (benches and drops included).
  if (Math.abs(groundElevation(seed, x + 24) - groundElevation(seed, x - 24)) > 30)
    return HABITAT.CLIFF;
  const tpi =
      z -
      (relief(w, seed, x - 250) +
        relief(w, seed, x + 250) +
        relief(w, seed, x - 600) +
        relief(w, seed, x + 600)) /
        4,
    slope = Math.abs(relief(w, seed, x + 60) - relief(w, seed, x - 60)) / 120;
  if (tpi > 28) return HABITAT.RIDGE;
  if (tpi < -28) return HABITAT.VALLEY;
  if (slope < 0.05) {
    const { c, t } = pos(w, x),
      P = w.P[c] + (w.P[c + 1] - w.P[c]) * t;
    // Hollows and low plains near sea level hold water where it rains enough.
    return P > 1000 && (tpi < -6 || z < 24) ? HABITAT.WETLAND : HABITAT.FLAT;
  }
  return HABITAT.SLOPE;
}

/** What each rock kind (history.ts ROCK order) weathers into. */
const SOIL_OF = [
  SOIL.STONY,
  SOIL.STONY,
  SOIL.RICH,
  SOIL.RICH,
  SOIL.ALKALINE,
  SOIL.CLAY,
  SOIL.SANDY,
  SOIL.CLAY,
  SOIL.CLAY,
  SOIL.SANDY,
  SOIL.CLAY,
  SOIL.SANDY,
  SOIL.CLAY,
  SOIL.SALTY,
];

// Biomes come in patches about PATCH columns wide, each the majority of
// what its land, climate and rock say along it, so they last a screen or more
// instead of flickering with every bench and bed. Shores and riversides keep
// their own edges; patch edges dither over FRINGE columns.
const PATCH = 900,
  FRINGE = 56,
  SAMPLES = 9;

const edge = (seed: number, k: number) =>
  k * PATCH + 0.35 * PATCH * (2 * hash3(k, 7, seed + 530) - 1);

function patchIndex(seed: number, x: number) {
  let k = Math.floor(x / PATCH);
  while (x < edge(seed, k)) k--;
  while (x >= edge(seed, k + 1)) k++;
  return k;
}

interface Patch {
  zone: number;
  habitat: number;
  soil: number;
  T: number;
  P: number;
  z: number;
  /** Opened up lately by fire, storm or grazing, and growing back. */
  open: boolean;
}

const patchCache = new WeakMap<World, Map<number, Patch>>();

const mode = (counts: Map<number, number>) => {
  let best = -1,
    n = -1;
  for (const [k, c] of counts)
    if (c > n) {
      best = k;
      n = c;
    }
  return best;
};

function patchOf(w: World, seed: number, k: number): Patch {
  let cache = patchCache.get(w);
  if (!cache) patchCache.set(w, (cache = new Map()));
  let p = cache.get(k);
  if (p) return p;
  const x0 = edge(seed, k),
    x1 = edge(seed, k + 1),
    zones = new Map<number, number>(),
    habs = new Map<number, number>(),
    soils = new Map<number, number>(),
    add = (m: Map<number, number>, v: number, by = 1) => m.set(v, (m.get(v) ?? 0) + by);
  let T = 0,
    P = 0,
    z = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const x = x0 + ((s + 0.5) / SAMPLES) * (x1 - x0),
      { c, t } = pos(w, x),
      lerp = (a: Float32Array) => a[c] + (a[c + 1] - a[c]) * t,
      zs = relief(w, seed, x),
      Ts = lerp(w.T) - 0.025 * (zs - Math.max(0, lerp(w.surface))),
      Ps = lerp(w.P),
      near = w.zone[colAt(w, x)];
    T += Ts / SAMPLES;
    P += Ps / SAMPLES;
    z += zs / SAMPLES;
    if (near === ZONE.OCEAN || near === ZONE.LAKE) continue;
    add(
      zones,
      near === ZONE.SALT_FLAT ? ZONE.SALT_FLAT : zoneOf(Ts, Ps, lerp(w.S), lerp(w.O), zs),
    );
    add(habs, habitatFormAt(w, seed, x));
    add(soils, SOIL_OF[kindAt(rockAt(seed, x), groundElevation(seed, x) - 3)]);
  }
  const habitat = habs.size ? mode(habs) : HABITAT.FLAT;
  let soil = soils.size ? mode(soils) : SOIL.SANDY;
  if (T < 6 && P > 900 && (habitat === HABITAT.WETLAND || habitat === HABITAT.FLAT))
    soil = SOIL.PEAT;
  // Disturbance: fire, storms and grazing open the land in stretches a patch
  // or three long, more often where summers are dry; woods grow back after.
  const S = w.S[colAt(w, (x0 + x1) / 2)],
    prone = 0.1 * Math.max(0, Math.min(1, (1100 - P) / 700)) + 0.08 * Math.max(0, S),
    open = fbm1((x0 + x1) / 2 / 2600, seed + 540, 3) > 0.62 - prone;
  p = {
    zone: zones.size ? mode(zones) : ZONE.OCEAN,
    habitat,
    soil,
    T,
    P,
    z,
    open,
  };
  cache.set(k, p);
  return p;
}

/**
 * The place at art column x: its climate zone, habitat, soil, and biome
 * (an index into biomes.ts BIOMES, or -1 under water).
 */
export function placeAt(seed: number, x: number) {
  const w = worldOf(seed),
    z = groundElevation(seed, x),
    water = waterAt(seed, x),
    near = w.zone[colAt(w, x)];
  if (
    (water !== null && z < water.level) ||
    (water && (near === ZONE.OCEAN || near === ZONE.LAKE))
  )
    return {
      zone: near === ZONE.LAKE ? ZONE.LAKE : ZONE.OCEAN,
      habitat: HABITAT.SHORE,
      soil: SOIL.SANDY,
      biome: -1,
    };
  let k = patchIndex(seed, x);
  // Dither across the patch edges, so neighbours mix over a few plants.
  const dl = x - edge(seed, k),
    dr = edge(seed, k + 1) - x,
    r = hash3(Math.floor(x), 3, seed + 531);
  if (dl < FRINGE && r < 0.5 * (1 - dl / FRINGE)) k--;
  else if (dr < FRINGE && r < 0.5 * (1 - dr / FRINGE)) k++;
  const p = patchOf(w, seed, k),
    by = shoreAt(w, seed, x),
    habitat = by >= 0 ? by : p.habitat,
    zone = p.zone === ZONE.OCEAN || p.zone === ZONE.LAKE ? ZONE.CONTINENTAL : p.zone,
    flags = { wet: p.P > 1500, dry: p.P < 650, high: p.z > 260, open: p.open };
  return { zone, habitat, soil: p.soil, biome: classify(zone, habitat, p.soil, flags) };
}

/** The biome at x, or -1 under water. */
export const biomeAt = (seed: number, x: number) => placeAt(seed, x).biome;

/**
 * The region generator's six looks (its BIOMES presets, in order: highlands,
 * fungal, canyon, forest, peaks, basalt) by climate zone: they still decide
 * the caves and what lives in them, until each zone has its own.
 */
const LOOKS: number[][] = [];
LOOKS[ZONE.OCEAN] = [1, 0, 0, 0, 0, 0];
LOOKS[ZONE.LAKE] = [1, 0, 0, 0, 0, 0];
LOOKS[ZONE.SALT_FLAT] = [0, 0, 1, 0, 0, 0];
LOOKS[ZONE.ICE] = [0, 0, 0, 0, 1, 0];
LOOKS[ZONE.TUNDRA] = [0.35, 0, 0, 0, 0.65, 0];
LOOKS[ZONE.BOREAL] = [0, 0, 0, 0.3, 0.7, 0];
LOOKS[ZONE.ALPINE] = [0, 0, 0, 0, 1, 0];
LOOKS[ZONE.OCEANIC] = [0.2, 0, 0, 0.8, 0, 0];
LOOKS[ZONE.CONTINENTAL] = [0.4, 0, 0, 0.6, 0, 0];
LOOKS[ZONE.MEDITERRANEAN] = [0.5, 0, 0.5, 0, 0, 0];
LOOKS[ZONE.STEPPE] = [0.8, 0, 0.2, 0, 0, 0];
LOOKS[ZONE.DESERT] = [0, 0, 1, 0, 0, 0];
LOOKS[ZONE.SAVANNA] = [0.5, 0, 0.5, 0, 0, 0];
LOOKS[ZONE.MONSOON] = [0, 0.2, 0, 0.8, 0, 0];
LOOKS[ZONE.RAINFOREST] = [0, 0.3, 0, 0.7, 0, 0];

/** The look weights of one coarse column, built once per world. */
const lookCache = new WeakMap<World, Float32Array>();
function looksOf(w: World) {
  let a = lookCache.get(w);
  if (a) return a;
  a = new Float32Array(w.n * 6);
  for (let c = 0; c < w.n; c++) {
    const m = LOOKS[w.zone[c]];
    let sum = 0;
    for (let k = 0; k < 6; k++) sum += a[c * 6 + k] = m[k];
    // Volcanic ground takes the basalt look.
    const top =
      w.offsets[c + 1] > w.offsets[c]
        ? w.kinds[w.offsets[c + 1] - 1]
        : ROCK.BASEMENT;
    if (top === ROCK.BASALT || top === ROCK.ASH) {
      a[c * 6 + 5] += 0.8;
      sum += 0.8;
    }
    for (let k = 0; k < 6; k++) a[c * 6 + k] /= sum || 1;
  }
  lookCache.set(w, a);
  return a;
}

/** Weights of the six looks at art column x. */
export function looksAt(seed: number, x: number, out = new Float32Array(6)) {
  const w = worldOf(seed),
    a = looksOf(w),
    { c, t } = pos(w, x);
  for (let k = 0; k < 6; k++)
    out[k] = a[c * 6 + k] + (a[(c + 1) * 6 + k] - a[c * 6 + k]) * t;
  return out;
}

/** What to call the place at x: a volcano if it is on one, its biome and its climate zone. */
export function biomeNameAt(seed: number, x: number) {
  const p = placeAt(seed, x),
    v = volcanoAt(worldOf(seed), seed, x),
    on = v && Math.abs(x - v.cx) < v.r ? `${v.active ? "Active" : "Dormant"} volcano · ` : "";
  return p.biome < 0
    ? on + ZONES[p.zone].name
    : `${on}${BIOMES[p.biome].name} · ${ZONES[p.zone].name}`;
}
