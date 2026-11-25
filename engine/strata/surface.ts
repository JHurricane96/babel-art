// Strata's surface: what stands on the land and what the land does that a
// height per column can't — rock shapes (cave mouths, overhangs, arches,
// hoodoos, boulders, scree), greenery that gathers (ivy on cliffs, reeds in
// shallows), and the first built things (ruins, rope bridges).
//
// Everything is decided from world functions and world positions, never from
// the order a window is filled in, so every window that covers a feature
// builds it the same way. Features reach at most ~120 cells from where they
// are decided, well inside a window's margin.
import { BIOMES, type Params, groundAt, regionBiome } from "./generate";
import { riversIn, waterAt } from "./worldmap";
import {
  M,
  REGION_W,
  WORLD_H,
  hash3,
  noise1,
  stateOf,
  walkRandom,
} from "./world";

export interface Win {
  seed: number;
  cells: Uint8Array;
  state: Uint8Array;
  WW: number;
  X0: number;
  /** Ground line per window column; lowered under arches so their openings show sky. */
  surface: Int16Array;
  /** groundAt for window columns -2 .. WW+1, at index x + 2. */
  ground: Float64Array;
  params: Params[];
  colBiome: Uint8Array;
  /** Each column's biome (biomes.ts), or -1 under water. */
  bio: Int16Array;
  /** Per cell: 1 + the biome of the plant or ground cover there, or 0. */
  flora: Uint8Array;
}

const H = WORLD_H;
const rng = (a: number, b: number, c: number) =>
  walkRandom(Math.floor(hash3(a, b, c) * 4294967296));

/** Near water (the sea, a lake, a river's channel): keep clear. */
export function reserved(seed: number, wx: number, pad = 20) {
  return (
    waterAt(seed, wx) !== null ||
    waterAt(seed, wx - pad) !== null ||
    waterAt(seed, wx + pad) !== null
  );
}

function set(w: Win, x: number, y: number, m: number, onlyAir = true) {
  if (x < 0 || x >= w.WW || y < 0 || y >= H) return false;
  const i = y * w.WW + x;
  if (onlyAir ? w.cells[i] !== M.AIR : w.cells[i] === M.BEDROCK) return false;
  w.cells[i] = m;
  return true;
}

/** Set a cell and mark it with a biome (plants and built things carry one). */
function setB(w: Win, x: number, y: number, m: number, biome: number) {
  if (set(w, x, y, m)) {
    w.state[y * w.WW + x] = stateOf(0, biome);
    w.flora[y * w.WW + x] = w.bio[x] + 1;
  }
}

const g = (w: Win, x: number) =>
  w.ground[Math.max(0, Math.min(w.WW + 3, x + 2))];

/**
 * Steep faces in the ground: runs of columns where the land drops at least 3
 * cells per column, 12 or more in all. hx is the column at the top of the
 * face, lx at its foot, dir the way from top to foot.
 */
export function facesIn(w: Win) {
  const out: {
    hx: number;
    lx: number;
    dir: number;
    top: number;
    foot: number;
  }[] = [];
  let x = 0;
  while (x < w.WW - 1) {
    const d = g(w, x + 1) - g(w, x);
    if (Math.abs(d) < 3) {
      x++;
      continue;
    }
    const dir = d > 0 ? 1 : -1;
    let e = x + 1;
    while (e < w.WW - 1 && (g(w, e + 1) - g(w, e)) * dir >= 3) e++;
    const hx = dir > 0 ? x : e,
      lx = dir > 0 ? e : x,
      top = g(w, hx),
      foot = g(w, lx);
    if (foot - top >= 12) out.push({ hx, lx, dir, top, foot });
    x = e;
  }
  return out;
}

/**
 * Carve into the land: cave mouths and overhangs in steep faces, and arches
 * through narrow hills. Runs before water is placed.
 */
export function carveSurface(w: Win) {
  const { seed, X0 } = w;
  for (const f of facesIn(w)) {
    const wx = X0 + f.hx,
      p = w.params[f.hx],
      drop = f.foot - f.top;
    if (reserved(seed, wx, 40)) continue;
    const R = rng(wx, 701, seed);
    if (drop >= 18 && hash3(wx, 702, seed) < 0.3 * p.mouths) caveMouth(w, f, R);
    else if (hash3(wx, 703, seed) < 0.45 * p.mouths) overhang(w, f, R);
  }
  // Arches: decided per region from world positions.
  for (
    let q = Math.floor(X0 / REGION_W) - 1;
    q <= Math.floor((X0 + w.WW) / REGION_W) + 1;
    q++
  ) {
    const b = BIOMES[regionBiome(seed, q)];
    if (hash3(seed, q, 710) > b.arches) continue;
    const a = archOf(seed, q);
    if (a) carveArch(w, a);
  }
}

/** A cave mouth: a tunnel from the face into the high ground, gently descending. */
function caveMouth(
  w: Win,
  f: { hx: number; lx: number; dir: number; top: number; foot: number },
  R: () => number,
) {
  const into = -f.dir,
    len = 25 + R() * 70,
    r0 = 5 + R() * 4;
  let x = f.lx,
    y = f.foot - r0 - 2 - R() * Math.min(20, (f.foot - f.top) * 0.35);
  for (let s = 0; s < len; s += 1) {
    const t = s / len,
      r = r0 * (1 - 0.45 * t);
    // Once past the top of the face, keep a roof of rock overhead.
    if ((x - f.hx) * into > 0) y = Math.max(y, g(w, x) + 6 + r);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++)
        if (dx * dx + dy * dy <= r * r) {
          const cy = Math.round(y + dy);
          // A flat floor: nothing below the tunnel's lowest line is carved.
          if (cy > y + r * 0.6) continue;
          set(w, x + dx, cy, M.AIR, false);
        }
    x += into;
    y += 0.12 + (R() - 0.5) * 0.3;
  }
}

/** An overhang: a shallow hollow under the lip of a face. */
function overhang(
  w: Win,
  f: { hx: number; lx: number; dir: number; top: number; foot: number },
  R: () => number,
) {
  const into = -f.dir,
    rx = 6 + R() * 9,
    ry = Math.min(4 + R() * 6, (f.foot - f.top - 5) / 2),
    cy = f.foot - ry,
    u0 = rx * 0.5;
  if (ry < 3) return;
  for (let u = -Math.ceil(rx); u <= Math.ceil(rx * 1.6); u++)
    for (let y = Math.floor(cy - ry); y < f.foot; y++) {
      const a = (u - u0) / rx,
        b = (y - cy) / ry;
      if (a * a + b * b < 1) set(w, f.hx + into * u, y, M.AIR, false);
    }
}

interface Arch {
  xm: number;
  rx: number;
  /** Underside of the arch's crown, and the floor of its opening. */
  crown: number;
  floor: number;
  thick: number;
}

function archOf(seed: number, q: number): Arch | null {
  const R = rng(seed, q, 711);
  for (let tries = 0; tries < 14; tries++) {
    let xm = q * REGION_W + REGION_W * (0.1 + 0.8 * R()),
      top = groundAt(seed, xm);
    // Climb to the top of the nearest hill.
    for (let k = 0; k < 120; k++) {
      const l = groundAt(seed, xm - 2),
        r = groundAt(seed, xm + 2);
      if (l < top && l <= r) [xm, top] = [xm - 2, l];
      else if (r < top) [xm, top] = [xm + 2, r];
      else break;
    }
    const span = 35 + R() * 35,
      gl = groundAt(seed, xm - span),
      gr = groundAt(seed, xm + span),
      floor = Math.max(gl, gr);
    if (Math.min(gl, gr) - top < 20) continue; // not a narrow enough hill
    if (
      reserved(seed, xm - span) ||
      reserved(seed, xm + span) ||
      reserved(seed, xm)
    )
      continue;
    const thick = 6 + R() * 5;
    return {
      xm: Math.round(xm),
      rx: span * 0.4,
      crown: top + thick,
      floor: Math.round(floor),
      thick,
    };
  }
  return null;
}

function carveArch(w: Win, a: Arch) {
  const rise = a.floor - a.crown;
  if (rise < 10) return;
  for (let wx = Math.floor(a.xm - a.rx); wx <= Math.ceil(a.xm + a.rx); wx++) {
    const x = wx - w.X0;
    if (x < 0 || x >= w.WW) continue;
    const u = (wx - a.xm) / a.rx;
    if (Math.abs(u) >= 1) continue;
    // A rounded opening: highest in the middle, meeting the floor at its ends,
    // always leaving the crown's thickness of rock under the ground above.
    const top = Math.max(
      a.crown + rise * (1 - Math.sqrt(1 - u * u)),
      g(w, x) + a.thick,
    );
    if (top >= a.floor) continue;
    for (let y = Math.ceil(top); y < a.floor; y++) set(w, x, y, M.AIR, false);
    // The opening is open sky: the ground line drops to the opening's floor.
    w.surface[x] = Math.max(w.surface[x], a.floor);
  }
}

/**
 * Raise things on the land: hoodoos and pillars, boulders, scree under
 * cliffs, ivy down cliff faces, reeds in shallows, ruins and rope bridges.
 * Runs after water is placed, before trees.
 */
export function raiseSurface(w: Win) {
  const { seed, X0, WW, cells } = w;
  for (let x = 4; x < WW - 4; x++) {
    const wx = X0 + x,
      p = w.params[x],
      s = w.surface[x],
      si = s * WW + x;
    if (
      cells[si - WW] !== M.AIR ||
      cells[si] === M.WATER ||
      cells[si] === M.ICE
    )
      continue;
    const slope = Math.abs(g(w, x + 3) - g(w, x - 3));
    if (slope > 4 || reserved(seed, wx)) continue;
    if (hash3(wx, 720, seed) < 0.01 * p.hoodoos)
      hoodoo(w, x, rng(wx, 721, seed), p.hoodooCap > 0.5);
    else if (hash3(wx, 722, seed) < p.boulders)
      boulder(w, x, rng(wx, 723, seed));
  }
  for (const f of facesIn(w)) {
    const wx = X0 + f.hx,
      p = w.params[f.hx],
      drop = f.foot - f.top;
    if (reserved(seed, wx, 30)) continue;
    if (drop >= 20 && hash3(wx, 724, seed) < 0.8 * p.scree)
      scree(w, f, rng(wx, 725, seed));
    if (drop >= 14 && p.ivy > 0) ivy(w, f, p.ivy, w.colBiome[f.hx]);
  }
  reeds(w);
  for (
    let q = Math.floor(X0 / REGION_W) - 1;
    q <= Math.floor((X0 + WW) / REGION_W) + 1;
    q++
  ) {
    ruin(w, q);
    bridge(w, q);
  }
}

/**
 * A hoodoo: a stout, lumpy spire under a wider cap rock. Or, where the rock
 * is basalt, a cluster of flat-topped columns of different heights.
 */
function hoodoo(w: Win, x: number, R: () => number, capped: boolean) {
  const column = (cx: number, tall: number, half: number, lumpy: boolean) => {
    const base = Math.round(g(w, cx));
    for (let k = 0; k < tall; k++) {
      const t = k / tall,
        // Weathered in bands: a narrower neck below the cap, bulges along the body.
        waist = lumpy
          ? 1 -
            0.35 * Math.max(0, 1 - Math.abs(t - 0.78) * 6) +
            0.15 * (noise1(k / 5, cx + w.X0) - 0.5)
          : 1,
        cap = lumpy && k > tall - 4 ? 2 : 0,
        hw = Math.max(1, Math.round(half * waist + cap));
      for (let dx = -hw; dx <= hw; dx++) {
        const y = base - 1 - k;
        set(w, cx + dx, y, M.ROCK);
        // Fill down to the ground where it dips under the spire.
        if (k === 0)
          for (let yy = y + 1; yy < Math.round(g(w, cx + dx)); yy++)
            set(w, cx + dx, yy, M.ROCK);
      }
    }
  };
  if (capped) column(x, Math.round(12 + R() * 30), 3 + R() * 4, true);
  else {
    // Basalt: three to seven columns side by side, stepped like a causeway.
    const n = 3 + Math.floor(R() * 5),
      base = 10 + R() * 25;
    for (let c = 0; c < n; c++)
      column(x + c * 4, Math.round(base * (0.6 + 0.6 * R())), 1.5, false);
  }
}

function boulder(w: Win, x: number, R: () => number) {
  const r = 1.5 + R() * 3.5,
    rx = r * (1 + R() * 0.5),
    cy = Math.round(g(w, x)) - r * 0.55;
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++)
      if ((dx * dx) / (rx * rx) + (dy * dy) / (r * r) < 1)
        set(w, x + dx, Math.round(cy + dy), M.ROCK);
}

/** Scree: a wedge of gravel fallen against the foot of a face. */
function scree(
  w: Win,
  f: { hx: number; lx: number; dir: number; top: number; foot: number },
  R: () => number,
) {
  const drop = f.foot - f.top,
    len = drop * (0.5 + 0.3 * R());
  for (let k = 0; k < len; k++) {
    const x = f.lx + f.dir * k,
      base = Math.round(g(w, x)),
      tall = Math.round(drop * 0.4 * Math.pow(1 - k / len, 1.3));
    if (
      w.cells[base * w.WW + x] === M.WATER ||
      w.cells[(base - 1) * w.WW + x] !== M.AIR
    )
      continue;
    for (let y = base - tall; y < base; y++) set(w, x, y, M.GRAVEL);
  }
}

/** Ivy: strands hanging from the lip of a face, hugging it. */
function ivy(
  w: Win,
  f: { hx: number; lx: number; dir: number; top: number; foot: number },
  amount: number,
  biome: number,
) {
  const wx0 = w.X0 + f.hx;
  for (let k = 0; k <= Math.abs(f.lx - f.hx); k++) {
    const col = f.hx + f.dir * k,
      x = col + f.dir,
      wx = wx0 + f.dir * k;
    if (hash3(wx, 730, w.seed) > 0.35 * amount) continue;
    const start = Math.round(g(w, col)),
      len = 4 + Math.floor(hash3(wx, 731, w.seed) * 20);
    for (let y = start; y < start + len; y++) {
      if (y >= Math.round(g(w, x))) break;
      setB(w, x, y, M.LEAF, biome);
      if (hash3(wx, y, w.seed + 732) < 0.25)
        setB(w, x + f.dir, y, M.LEAF, biome);
    }
  }
}

/** Reeds: stalks standing in shallow water at lake edges, fewer in streams. */
function reeds(w: Win) {
  const { WW, cells, seed, X0 } = w;
  for (let x = 1; x < WW - 1; x++) {
    const p = w.params[x];
    if (p.reeds <= 0) continue;
    const s = w.surface[x],
      wx = X0 + x;
    // Find the water standing on this column, if any.
    let topW = s;
    while (
      topW > 0 &&
      (cells[(topW - 1) * WW + x] === M.WATER ||
        cells[(topW - 1) * WW + x] === M.STREAM)
    )
      topW--;
    const depth = s - topW;
    if (depth === 0 || depth > 5) continue;
    const stream = cells[topW * WW + x] === M.STREAM;
    if (hash3(wx, 740, seed) > (stream ? 0.06 : 0.45) * p.reeds) continue;
    const tall = 3 + Math.floor(hash3(wx, 741, seed) * 7);
    for (let y = s - 1; y >= topW - tall && y >= 0; y--) {
      const i = y * WW + x;
      if (cells[i] === M.WATER || cells[i] === M.STREAM || cells[i] === M.AIR) {
        cells[i] = M.REED;
        w.state[i] = stateOf(0, w.colBiome[x]);
        w.flora[i] = w.bio[x] + 1;
      } else break;
    }
  }
}

/** A ruin: an old house or tower, broken, on the level ground it was built on. */
function ruin(w: Win, q: number) {
  const site = ruinSite(w.seed, q);
  if (site) buildRuin(w, site.x0, site.base, site.fw, site.tower, site.R);
}

function ruinSite(seed: number, q: number) {
  const b = BIOMES[regionBiome(seed, q)];
  // Ruins are rare until the world has people of its own.
  if (hash3(seed, q, 750) > 0.25 * b.ruins) return null;
  const R = rng(seed, q, 751),
    tower = R() < 0.45,
    fw = tower ? 12 + Math.floor(R() * 8) : 26 + Math.floor(R() * 22);
  for (let tries = 0; tries < 10; tries++) {
    const x0 = Math.round(q * REGION_W + REGION_W * (0.08 + 0.84 * R()));
    let hi = Infinity,
      lo = -Infinity,
      ok = true;
    for (let wx = x0 - 3; wx <= x0 + fw + 3 && ok; wx++) {
      const gy = groundAt(seed, wx);
      hi = Math.min(hi, gy);
      lo = Math.max(lo, gy);
      if (reserved(seed, wx, 10)) ok = false;
    }
    if (!ok || lo - hi > 8) continue;
    return { x0, base: Math.round(hi), fw, tower, R };
  }
  return null;
}

function buildRuin(
  w: Win,
  wx0: number,
  base: number,
  fw: number,
  tower: boolean,
  R: () => number,
) {
  const x0 = wx0 - w.X0,
    put = (x: number, y: number, m: number) => set(w, x, y, m),
    tall = tower ? 30 + Math.floor(R() * 32) : 12 + Math.floor(R() * 14),
    thick = tower ? 2 + Math.floor(R() * 2) : 2;
  // A foundation levelling the ground under the whole footprint.
  for (let x = x0; x <= x0 + fw; x++)
    for (let y = base; y < Math.round(g(w, x)); y++)
      set(w, x, y, M.BRICK, false);
  for (let x = x0; x <= x0 + fw; x++) set(w, x, base - 1, M.BRICK, false);
  // Walls, broken to different heights, ragged along their tops.
  const leftTop = tall - Math.floor(R() * (tall * 0.4)),
    rightTop = tall - Math.floor(R() * (tall * 0.6)),
    door = R() < 0.5 ? 0 : 1;
  for (let side = 0; side < 2; side++) {
    const top = side === 0 ? leftTop : rightTop;
    for (let t = 0; t < thick; t++) {
      const x = side === 0 ? x0 + t : x0 + fw - t,
        h = top - Math.floor(R() * 3);
      for (let k = 2; k <= h; k++) {
        // A doorway in one wall (houses), windows in both (towers).
        if (!tower && side === door && k <= 7) continue;
        // Windows: a few, at different heights in each wall.
        if (
          tower &&
          k > 8 &&
          (k + side * 5) % 13 < 3 &&
          hash3(wx0 + side, k, 77) < 0.7
        )
          continue;
        put(x, base - k, M.BRICK);
      }
    }
  }
  // The inner wall: masonry behind, crumbled away toward the top.
  for (let x = x0 + thick; x <= x0 + fw - thick; x++) {
    const u = (x - x0) / fw,
      edge = Math.min(leftTop, rightTop) * (tower ? 0.95 : 0.7),
      h =
        edge * (0.55 + 0.45 * (1 - Math.abs(u - (tower ? 0.5 : 0.3)))) -
        R() * 3;
    for (let k = 2; k <= h; k++) put(x, base - k, M.BACKWALL);
  }
  // Floors in a tower, partly fallen; a fallen beam and rubble in a house.
  if (tower)
    for (let k = 12; k < Math.min(leftTop, rightTop) - 2; k += 12)
      for (let x = x0 + thick; x <= x0 + fw - thick; x++)
        if (R() < 0.75) set(w, x, base - k, M.WOOD, false);
        else {
          const bx = x0 + thick + Math.floor(R() * (fw - 2 * thick - 6));
          for (let k = 0; k < 7; k++)
            set(w, bx + k, base - 2 - Math.floor(k * 0.6), M.WOOD, false);
          for (let n = 0; n < 3; n++) {
            const rx = x0 + thick + Math.floor(R() * (fw - 2 * thick));
            set(w, rx, base - 2, M.BRICK, false);
            if (R() < 0.5) set(w, rx + 1, base - 2, M.BRICK, false);
          }
        }
}

/**
 * A rope bridge across a river's canyon, rim to rim, sagging, with a few
 * planks gone: wherever a river has cut a gorge deep and narrow enough to
 * be worth bridging, now and then.
 */
function bridgeSite(seed: number, q: number) {
  for (const rv of riversIn(
    seed,
    q * REGION_W + 150,
    (q + 1) * REGION_W - 150,
  )) {
    if (hash3(seed, Math.round(rv.xc), 760) > 0.6) continue;
    // The rims: the highest ground on each side within reach.
    const rim = (dir: number) => {
      let x = 0,
        y = Infinity;
      for (let d = rv.hw + 4; d <= rv.hw + 140; d += 2) {
        const xx = Math.round(rv.xc + dir * d),
          gy = groundAt(seed, xx);
        if (gy < y) [x, y] = [xx, gy];
      }
      return { x, y: Math.round(y) };
    };
    const L = rim(-1),
      Rt = rim(1),
      span = Rt.x - L.x,
      floor = groundAt(seed, rv.xc);
    if (span < 40 || Math.abs(Rt.y - L.y) > span * 0.25) continue;
    if (floor - Math.max(L.y, Rt.y) < 45) continue; // not a gorge
    return { L, Rt, span };
  }
  return null;
}

function bridge(w: Win, q: number) {
  const { seed } = w,
    site = bridgeSite(seed, q);
  if (!site) return;
  const { L, Rt, span } = site,
    sag = span * 0.05;
  const deck = (wx: number) => {
    const t = (wx - L.x) / span;
    return Math.round(L.y + (Rt.y - L.y) * t + sag * 4 * t * (1 - t)) - 1;
  };
  for (let wx = L.x; wx <= Rt.x; wx++) {
    const x = wx - w.X0,
      y = deck(wx),
      rail =
        y -
        4 +
        Math.round(
          sag * 0.15 * 4 * ((wx - L.x) / span) * (1 - (wx - L.x) / span),
        );
    if (hash3(wx, 761, seed) > 0.05) set(w, x, y, M.WOOD);
    set(w, x, rail, M.ROPE);
    if ((wx - L.x) % 6 === 0)
      for (let k = rail + 1; k < y; k++) set(w, x, k, M.ROPE);
  }
  // Posts at each end.
  for (const end of [L, Rt])
    for (let k = 1; k <= 7; k++) {
      set(w, end.x - w.X0, end.y - k, M.WOOD);
      set(w, end.x - w.X0 + (end === L ? -1 : 1), end.y - k, M.WOOD);
    }
}

/** How much a column sits in a grove (dense trees) rather than a clearing. */
export function grove(seed: number, wx: number) {
  return noise1(wx / 350, seed + 120);
}

/** Where a region's arch, ruin and bridge are (for tools and, later, the director). */
export function surfaceLandmarks(seed: number, q: number) {
  const b = BIOMES[regionBiome(seed, q)],
    arch = hash3(seed, q, 710) <= b.arches ? archOf(seed, q) : null,
    ruin = ruinSite(seed, q),
    bridge = bridgeSite(seed, q);
  return {
    arch: arch && { x: arch.xm, y: arch.crown },
    ruin: ruin && {
      x: ruin.x0,
      y: ruin.base,
      kind: ruin.tower ? "tower" : "house",
    },
    bridge: bridge && { x0: bridge.L.x, x1: bridge.Rt.x, y: bridge.L.y },
  };
}
