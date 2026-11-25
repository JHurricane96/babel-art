// Strata landforms: the land's shape at the scale of a screen or a few, laid
// on the world's coarse elevation (history.ts), whose columns are too coarse
// to hold hills, mesas or peaks.
//
// The land comes in units a little over a region wide. Each takes a landform
// from what made it and what it is made of: a mountain range's units are
// jagged peaks (or glacial horns and troughs where it is cold), a volcanic
// arc's are cones, granite weathers into domes, limestone in the wet tropics
// into towers, flat-lying hard beds in dry country into mesas, tilted ones
// into cuestas, soft rock in dry country into badlands; basins stay plains.
// Rivers sit in valleys cut through it all, coasts and lake shores come down
// to the water, and the beds are raised with the land so cuts show them.
import { CELL, ROCK, type World } from "./history";
import { fbm1, hash3, noise1, smoothstep } from "./world";

export const LANDFORM = {
  PLAIN: 0,
  ROLLING: 1,
  HILLS: 2,
  MESAS: 3,
  CUESTAS: 4,
  BADLANDS: 5,
  DOMES: 6,
  KARST: 7,
  MOUNTAINS: 8,
  GLACIAL: 9,
  VOLCANO: 10,
  SCARPS: 11,
} as const;

export const LANDFORMS = [
  "Plain",
  "Rolling country",
  "Hills",
  "Mesas and buttes",
  "Cuestas",
  "Badlands",
  "Granite domes",
  "Limestone towers",
  "Mountains",
  "Glacial peaks and troughs",
  "Volcanoes",
  "Fault scarps",
];

/** Mean width of a unit, how far its edges wander, and how far neighbours blend. */
const UNIT = 2600,
  WANDER = 0.2,
  BLEND = 700;

interface Unit {
  form: number;
  /** Height of the landform above the valley floors, in art pixels. */
  amp: number;
  /** Seed for its shapes, and its span. */
  s: number;
  x0: number;
  x1: number;
  /** Cuestas: which way the steep faces look. */
  dir: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ridge = (x: number, s: number) => 1 - Math.abs(2 * noise1(x, s) - 1);

const edge = (seed: number, k: number) =>
  k * UNIT + WANDER * UNIT * (2 * hash3(k, 11, seed + 560) - 1);

function unitIndex(seed: number, x: number) {
  let k = Math.floor(x / UNIT);
  while (x < edge(seed, k)) k--;
  while (x >= edge(seed, k + 1)) k++;
  return k;
}

/** The kind of rock a little under the coarse ground at column c (what the land is carved from). */
function kindBelow(w: World, c: number, depth: number) {
  const o0 = w.offsets[c],
    o1 = w.offsets[c + 1],
    z = w.surface[c] - depth;
  for (let k = o1 - 1; k >= o0; k--) {
    const bottom = k > o0 ? w.tops[k - 1] : w.b[c];
    if (z > bottom) return w.kinds[k];
  }
  return ROCK.BASEMENT;
}

const SOFT = new Set<number>([
  ROCK.SHALE,
  ROCK.MUDSTONE,
  ROCK.REDBED,
  ROCK.COAL,
  ROCK.TILL,
  ROCK.ASH,
]);
const CAPROCK = new Set<number>([
  ROCK.SANDSTONE,
  ROCK.LIMESTONE,
  ROCK.BASALT,
  ROCK.CONGLOMERATE,
  ROCK.DUNE,
]);

/** Landforms whose rivers cut gorges, and those whose rivers cut deep V valleys. */
const CANYON = new Set<number>([
  LANDFORM.MESAS,
  LANDFORM.CUESTAS,
  LANDFORM.SCARPS,
  LANDFORM.BADLANDS,
]);
const STEEP = new Set<number>([
  LANDFORM.MOUNTAINS,
  LANDFORM.GLACIAL,
  LANDFORM.VOLCANO,
  LANDFORM.HILLS,
  LANDFORM.KARST,
]);

const units = new WeakMap<World, Map<number, Unit>>();

function unitOf(w: World, seed: number, k: number): Unit {
  let m = units.get(w);
  if (!m) units.set(w, (m = new Map()));
  let u = m.get(k);
  if (u) return u;
  const x0 = edge(seed, k),
    x1 = edge(seed, k + 1),
    xm = (x0 + x1) / 2,
    c = Math.max(0, Math.min(w.n - 1, Math.floor(xm / CELL))),
    z = Math.max(0, w.surface[c]),
    P = w.P[c],
    T = w.T[c],
    rock = kindBelow(w, c, 30),
    span = 80;
  let mean = 0,
    cnt = 0;
  for (let i = Math.max(0, c - span); i < Math.min(w.n, c + span); i++) {
    mean += Math.max(0, w.surface[i]);
    cnt++;
  }
  const tpi = z - mean / cnt,
    inside = (kind: string) =>
      w.events.some(
        (e) => e.kind === kind && Math.abs(c - e.c) < e.w / 2 + 8,
      ),
    range = inside("range"),
    arc = inside("arc"),
    hills = inside("hills"),
    rift = inside("rift"),
    basin = inside("basin"),
    plateau = inside("plateau"),
    pluton = inside("pluton"),
    dry = P < 450,
    soft = SOFT.has(rock),
    cap = CAPROCK.has(rock);
  // How strongly each landform suits this unit.
  const L = LANDFORM,
    score = new Float32Array(LANDFORMS.length);
  score[L.PLAIN] = 0.35 + (z < 35 ? 1 : 0) + (basin ? 1.6 : 0);
  score[L.ROLLING] = 0.6 + (P > 700 ? 0.4 : 0) + (soft ? 0.3 : 0);
  score[L.HILLS] = 0.9 + Math.min(1.5, z / 180) + (hills ? 2.2 : 0) + (tpi > 40 ? 0.8 : 0);
  score[L.MESAS] =
    (cap ? (dry ? 2.6 : P < 800 ? 0.9 : 0.25) : dry ? 0.4 : 0) +
    (plateau ? (P < 900 ? 2.2 : 0.6) : 0);
  score[L.CUESTAS] = (cap ? 0.7 : 0.15) + (plateau ? 0.6 : 0);
  score[L.BADLANDS] = soft ? (dry ? 2.4 : P < 800 ? 0.6 : 0) : 0;
  score[L.DOMES] =
    (rock === ROCK.GRANITE || rock === ROCK.BASEMENT ? 2.2 : 0) +
    (pluton ? 2 : 0);
  score[L.KARST] =
    rock === ROCK.LIMESTONE
      ? P > 1000 && T > 10
        ? 3.2
        : P > 700
          ? 1
          : 0.3
      : 0;
  score[L.MOUNTAINS] = (range ? 3 + z / 150 : 0) + (z > 260 ? 1 + (z - 260) / 80 : 0);
  score[L.GLACIAL] = T < 3 && z > 160 ? score[L.MOUNTAINS] * 1.3 + 1.5 : 0;
  score[L.VOLCANO] =
    (arc ? 3.5 : 0) + (rock === ROCK.BASALT || rock === ROCK.ASH ? 0.7 : 0);
  score[L.SCARPS] = rift ? 2.6 : 0.1;
  // Pick one, the stronger suits likelier (squared, so causes win most of the time).
  let total = 0;
  for (let i = 0; i < score.length; i++) total += score[i] * score[i];
  let r = hash3(k, 12, seed + 561) * total,
    form = 0;
  for (let i = 0; i < score.length; i++) {
    r -= score[i] * score[i];
    if (r <= 0) {
      form = i;
      break;
    }
  }
  const h = hash3(k, 13, seed + 562),
    AMP: Record<number, [number, number]> = {
      [L.PLAIN]: [6, 12],
      [L.ROLLING]: [30, 45],
      [L.HILLS]: [80, 100],
      [L.MESAS]: [80, 130],
      [L.CUESTAS]: [55, 90],
      [L.BADLANDS]: [35, 45],
      [L.DOMES]: [60, 110],
      [L.KARST]: [100, 150],
      [L.MOUNTAINS]: [220, 300],
      [L.GLACIAL]: [240, 300],
      [L.VOLCANO]: [220, 320],
      [L.SCARPS]: [60, 110],
    },
    [a, b] = AMP[form];
  let amp = a + b * h;
  if (form === L.HILLS) amp *= 0.85 + Math.min(0.45, z / 400);
  // Keep inside the world's sky.
  // Keep inside the world's sky, with room above the peaks to frame them.
  amp = Math.min(amp, Math.max(form === L.MOUNTAINS || form === L.GLACIAL || form === L.VOLCANO ? 120 : 15, 860 - z));
  u = {
    form,
    amp,
    s: seed * 31 + k * 977,
    x0,
    x1,
    dir: hash3(k, 14, seed + 563) < 0.5 ? -1 : 1,
  };
  m.set(k, u);
  return u;
}

/** A unit's landform at x, from 0 (its valley floors) to 1 (its tops). */
function shape(u: Unit, x: number) {
  const s = u.s,
    L = LANDFORM;
  switch (u.form) {
    case L.PLAIN:
      return fbm1(x / 600, s, 3);
    case L.ROLLING:
      return smoothstep(0.25, 0.75, fbm1(x / 900, s, 3));
    case L.HILLS: {
      const r = 0.65 * ridge(x / 520, s) + 0.35 * ridge(x / 170, s + 1);
      return Math.pow(clamp01((r - 0.2) / 0.75), 1.4);
    }
    case L.MESAS: {
      // Flat caps on steep scarps over talus, at one or two levels.
      const t = fbm1(x / 1500, s, 3),
        u2 = fbm1(x / 520, s + 3, 2);
      return (
        0.25 * smoothstep(0.4, 0.497, t) +
        0.55 * smoothstep(0.497, 0.501, t) +
        0.2 * smoothstep(0.5, 0.52, t) * smoothstep(0.558, 0.562, u2)
      );
    }
    case L.CUESTAS: {
      // Long gentle back slopes ending in steep faces.
      const lam = 1100 + 700 * hash3(s, 1, 9),
        v = (u.dir * x) / lam + hash3(s, 2, 9),
        i = Math.floor(v),
        f = v - i,
        hgt = 0.55 + 0.45 * hash3(i, s, 7);
      return (
        hgt * smoothstep(0, 0.84, f) * (1 - smoothstep(0.85, 0.875, f)) +
        0.08 * fbm1(x / 300, s + 4, 2)
      );
    }
    case L.BADLANDS: {
      const r = 0.55 * ridge(x / 150, s) + 0.45 * ridge(x / 55, s + 1);
      return clamp01((r - 0.2) / 0.8) * (0.45 + 0.55 * fbm1(x / 900, s + 2, 2));
    }
    case L.DOMES:
      return bumps(x, s, 760, 0.75, 220, 300, (d) => Math.pow(1 - Math.pow(d, 2.2), 0.6)) +
        0.08 * fbm1(x / 300, s + 5, 2);
    case L.KARST:
      return Math.max(
        bumps(x, s, 230, 0.6, 30, 60, (d) => Math.pow(1 - Math.pow(d, 2.5), 0.4)) *
          (0.82 + 0.18 * fbm1(x / 18, s + 8, 2)),
        0.18 * fbm1(x / 400, s + 6, 2),
      );
    case L.MOUNTAINS: {
      const r =
        0.55 * ridge(x / 1000, s) +
        0.3 * ridge(x / 330, s + 1) +
        0.15 * ridge(x / 110, s + 2);
      return Math.pow(smoothstep(0.3, 1, r), 1.2);
    }
    case L.GLACIAL: {
      // Broad flat-floored troughs between steep walls and sharp horns.
      // Sharp ridges (aretes) and horns between broad, flat-floored troughs.
      const m = ridge(x / 1300, s),
        horn = ridge(x / 170, s + 1);
      return (
        0.85 * Math.pow(smoothstep(0.3, 1, m), 1.6) +
        0.15 * horn * smoothstep(0.5, 0.9, m)
      );
    }
    case L.VOLCANO: {
      // One or two cones with craters, concave flanks.
      const w = u.x1 - u.x0,
        c1 = u.x0 + w * (0.35 + 0.3 * hash3(s, 3, 9)),
        r1 = w * (0.28 + 0.07 * hash3(s, 4, 9)),
        two = hash3(s, 5, 9) < 0.4,
        c2 = c1 + (hash3(s, 6, 9) < 0.5 ? -1 : 1) * r1 * 0.9,
        cone = (c: number, r: number, h: number) => {
          const d = Math.abs(x - c) / r;
          if (d >= 1) return 0;
          const crater = d < 0.06 ? 0.12 * Math.sqrt(1 - d / 0.06) : 0;
          return h * (Math.pow(1 - d, 1.7) - crater);
        };
      return Math.max(
        cone(c1, r1, 1),
        two ? cone(c2, r1 * 0.45, 0.45) : 0,
        0.06 * fbm1(x / 200, s + 7, 2),
      );
    }
    case L.SCARPS: {
      // Steps down from a fault block: flat benches between steep scarps.
      const t = fbm1(x / 1800, s, 2),
        q = clamp01((t - 0.3) / 0.4) * 3,
        i = Math.floor(q),
        f = q - i;
      return (i + smoothstep(0.42, 0.58, f)) / 3;
    }
  }
  return 0;
}

/**
 * Scattered bumps: per cell of the given size, a bump with the given chance,
 * width between w0 and w0+w1, and a profile p(d) over 0..1 of its half-width.
 */
function bumps(
  x: number,
  s: number,
  cell: number,
  chance: number,
  w0: number,
  w1: number,
  p: (d: number) => number,
) {
  const i0 = Math.floor(x / cell);
  let best = 0;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    if (hash3(i, s, 21) > chance) continue;
    const c = (i + 0.2 + 0.6 * hash3(i, s, 22)) * cell,
      w = w0 + w1 * hash3(i, s, 23),
      h = 0.55 + 0.45 * hash3(i, s, 24),
      d = Math.abs(x - c) / w;
    if (d < 1) best = Math.max(best, h * p(d));
  }
  return best;
}

/** Distance (art pixels) to the nearest sea, lake or salt-flat column, per coarse column. */
const wetDist = new WeakMap<World, Float32Array>();
function wetDistance(w: World) {
  let d = wetDist.get(w);
  if (d) return d;
  d = new Float32Array(w.n).fill(1e9);
  let last = -1e9;
  for (let c = 0; c < w.n; c++) {
    if (w.wet[c]) last = c;
    d[c] = (c - last) * CELL;
  }
  last = 1e9;
  for (let c = w.n - 1; c >= 0; c--) {
    if (w.wet[c]) last = c;
    d[c] = Math.min(d[c], (last - c) * CELL);
  }
  wetDist.set(w, d);
  return d;
}

/**
 * The landform at art column x: L, the height it adds to the world's coarse
 * ground (0 on valley floors and at the water), and U, how far the beds are
 * raised there (the landform's full height), so valleys cut down into them.
 */
export function landformAt(w: World, seed: number, x: number) {
  const k = unitIndex(seed, x),
    u = unitOf(w, seed, k),
    dl = x - u.x0,
    dr = u.x1 - x;
  // Blend with the neighbour across the nearer edge.
  let wSelf = 1,
    other: Unit | null = null;
  if (dl < BLEND / 2) {
    wSelf = smoothstep(-BLEND / 2, BLEND / 2, dl);
    other = unitOf(w, seed, k - 1);
  } else if (dr < BLEND / 2) {
    wSelf = smoothstep(-BLEND / 2, BLEND / 2, dr);
    other = unitOf(w, seed, k + 1);
  }
  let L = wSelf * u.amp * shape(u, x),
    U = wSelf * u.amp;
  if (other) {
    L += (1 - wSelf) * other.amp * shape(other, x);
    U += (1 - wSelf) * other.amp;
  }
  // Coasts and lake shores come down to the water: gently, or as cliffs.
  const dist = wetDistance(w),
    t = Math.max(0, Math.min(w.n - 1.001, x / CELL - 0.5)),
    c = Math.floor(t),
    dw = dist[c] + (dist[Math.min(w.n - 1, c + 1)] - dist[c]) * (t - c),
    cliffy = hash3(Math.floor(c / 40), 15, seed + 564) < 0.45,
    coast = smoothstep(110, cliffy ? 320 : 1200, dw);
  // Rivers run in valleys as wide as the land is high; where the land is
  // high and its rock flat-lying and hard (mesas, cuestas, scarps,
  // badlands), they cut narrow gorges down through it, stepped where the
  // beds alternate; in mountains and hills, deep V-shaped valleys.
  let valley = 1,
    cut = 0;
  for (const r of w.rivers) {
    if (w.wet[r.c]) continue;
    const xc = (r.c + 0.5) * CELL,
      d = Math.abs(x - xc);
    if (d > 1400) continue;
    const hw = 8 + 16 * Math.sqrt(r.q / 33000),
      at = unitOf(w, seed, unitIndex(seed, xc)),
      canyon = CANYON.has(at.form),
      steep = STEEP.has(at.form),
      reach = canyon ? 50 + 0.35 * U : 220 + 2.4 * U;
    if (d < hw + 12 + reach)
      valley = Math.min(valley, smoothstep(hw + 12, hw + 12 + reach, d));
    // The gorge, below the valley floor: deepest where the land stands high.
    const zc = Math.max(0, w.surface[r.c]),
      D = canyon
        ? Math.min(360, 0.55 * Math.max(0, zc - 30) + 0.5 * at.amp)
        : steep
          ? Math.min(240, 0.35 * Math.max(0, zc - 60))
          : Math.min(50, 0.15 * Math.max(0, zc - 80)),
      wall = canyon ? 25 + 0.25 * D : steep ? 60 + D : 80 + D;
    if (D < 4 || d > hw + 6 + wall) continue;
    const t = Math.max(0, d - hw - 6) / wall;
    let g: number;
    if (canyon) {
      // Steps: a cliff, a ledge, a cliff, about every 45 rows of depth.
      const n = Math.max(1, Math.round(D / 45)),
        q = t * n,
        k = Math.floor(q);
      g = 1 - (k + smoothstep(0.7, 1, q - k)) / n;
    } else g = Math.pow(1 - t, 1.3);
    cut = Math.max(cut, D * g);
  }
  return { L: L * coast * valley, U: U * coast, cut: cut * coast, form: u.form };
}

/** The landform name of the unit at x (for labels). */
export function landformNameAt(w: World, seed: number, x: number) {
  return LANDFORMS[unitOf(w, seed, unitIndex(seed, x)).form];
}
