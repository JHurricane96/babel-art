// Strata's regions read the world's history (history.ts): ground, rock,
// water and climate at any art column, worked out from the world's coarse
// columns (CELL art pixels each). Everything is a function of the seed and
// the world position, so regions built separately line up exactly.
import {
  BIOME,
  BIOMES as WORLD_BIOMES,
  CELL,
  ROCK,
  ROCKS,
  SEA_ROW,
  simulateWorld,
  type World,
} from "./history";
import { fbm1 } from "./world";

const worlds = new Map<number, World>();

/** The world for a seed, built once and kept (the last few). */
export function worldOf(seed: number): World {
  let w = worlds.get(seed);
  if (!w) {
    w = simulateWorld(seed);
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
function riverNear(w: World, x: number) {
  for (const r of w.rivers) {
    if (w.wet[r.c]) continue;
    const xc = (r.c + 0.5) * CELL,
      size = Math.sqrt(r.q / 33000),
      hw = 8 + 16 * size;
    if (Math.abs(x - xc) < hw + 40) return { xc, hw, depth: 5 + 9 * size };
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
    slope = slopeAt(w, x),
    amp = 3 + 70 * Math.min(0.25, slope);
  // Rolling ground at the scale of a screen or two (the world's columns are
  // too coarse to hold it), and finer roughness, more on slopes.
  let z =
    smoothElevation(w, x) +
    22 * (2 * fbm1(x / 700, seed + 503, 3) - 1) +
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
        const gap = top - z,
          step = 16 + 320 * Math.min(0.25, slope);
        if (gap < step) z = top - gap * 0.12;
      }
      break;
    }
  }
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

// ---- Climate and biome -----------------------------------------------------------

/** Warmth (°C) at x on the ground, from the world's climate, colder with height. */
export function warmthAt(seed: number, x: number, row: number) {
  const w = worldOf(seed),
    { c, t } = pos(w, x),
    T = w.T[c] + (w.T[c + 1] - w.T[c]) * t,
    coarse = w.surface[c] + (w.surface[c + 1] - w.surface[c]) * t;
  return T - 0.025 * (SEA_ROW - row - coarse);
}

/**
 * The region generator's six looks (its BIOMES presets, in order: highlands,
 * fungal, canyon, forest, peaks, basalt), weighted for each world biome.
 * These stand in until each world biome has its own looks.
 */
const LOOKS: number[][] = [];
LOOKS[BIOME.OCEAN] = [1, 0, 0, 0, 0, 0];
LOOKS[BIOME.LAKE] = [1, 0, 0, 0, 0, 0];
LOOKS[BIOME.SALT_FLAT] = [0, 0, 1, 0, 0, 0];
LOOKS[BIOME.ICE] = [0, 0, 0, 0, 1, 0];
LOOKS[BIOME.TUNDRA] = [0.35, 0, 0, 0, 0.65, 0];
LOOKS[BIOME.PINE] = [0, 0, 0, 0.3, 0.7, 0];
LOOKS[BIOME.WOODS] = [0.2, 0, 0, 0.8, 0, 0];
LOOKS[BIOME.GRASSLAND] = [1, 0, 0, 0, 0, 0];
LOOKS[BIOME.DESERT] = [0, 0, 1, 0, 0, 0];
LOOKS[BIOME.SAVANNA] = [0.5, 0, 0.5, 0, 0, 0];
LOOKS[BIOME.JUNGLE] = [0, 0.25, 0, 0.75, 0, 0];
LOOKS[BIOME.SWAMP] = [0, 0.35, 0, 0.65, 0, 0];
LOOKS[BIOME.ALPINE] = [0, 0, 0, 0, 1, 0];

/** The look weights of one coarse column, built once per world. */
const lookCache = new WeakMap<World, Float32Array>();
function looksOf(w: World) {
  let a = lookCache.get(w);
  if (a) return a;
  a = new Float32Array(w.n * 6);
  for (let c = 0; c < w.n; c++) {
    const m1 = LOOKS[w.biome[c]],
      m2 = LOOKS[w.biome2[c]],
      t = w.blend[c];
    let sum = 0;
    for (let k = 0; k < 6; k++) {
      a[c * 6 + k] = m1[k] * (1 - t) + m2[k] * t;
      sum += a[c * 6 + k];
    }
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

/** The world biome's name at x, and the one it is blending into (if any). */
export function biomeNameAt(seed: number, x: number) {
  const w = worldOf(seed),
    c = colAt(w, x),
    a = WORLD_BIOMES[w.biome[c]].name,
    b = WORLD_BIOMES[w.biome2[c]].name;
  return w.blend[c] > 0.2 && a !== b ? `${a} → ${b}` : a;
}
