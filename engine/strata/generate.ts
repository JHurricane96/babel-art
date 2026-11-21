// Strata region generator, loop 1: two biomes and the transition between them.
//
// A region is REGION_W x WORLD_H cells generated from (seed, region index)
// alone, so any region can be rebuilt on demand and saves only need what the
// simulation later changes. Neighbouring regions blend their parameters over
// a band either side of their shared edge, and cells are assigned to one
// biome or the other along a wobbly line inside that band, so transitions
// read as land changing rather than as a seam. Features that cross a region
// edge (tunnels, caverns) are spawned per region index and carved by every
// region they touch, so both sides agree.
import {
  GLOW,
  M,
  REGION_W,
  WORLD_H,
  fbm1,
  fbm2,
  hash3,
  lerp,
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
  /** 0-1: whether the region holds a lake basin. */
  basin: number;
  worms: number;
  wormRadius: [number, number];
  chambers: number;
  /** Chamber half-sizes: rx min, rx max, ry min, ry max. */
  chamberSize: [number, number, number, number];
  /** Chance a chamber holds a pool. */
  pools: number;
  soil: number;
  /** 0 none, 1 pines, 2 broad trees. */
  trees: number;
  treeDensity: number;
  /** Giant mushrooms per 1,000 cells of cavern floor. */
  fungus: number;
  /** Ground higher than this (smaller y) carries snow; 0 = never. */
  snowline: number;
  geodes: number;
  lava: number;
}

export const BIOMES: Biome[] = [
  {
    id: "highlands",
    name: "Cliffs over a lake",
    base: 560,
    amp: 150,
    detail: 0.3,
    terrace: 0.85,
    basin: 1,
    worms: 6,
    wormRadius: [3, 8],
    chambers: 1,
    chamberSize: [80, 150, 35, 65],
    pools: 0.5,
    soil: 9,
    trees: 1,
    treeDensity: 0.06,
    fungus: 2,
    snowline: 440,
    geodes: 3,
    lava: 2,
  },
  {
    id: "fungal",
    name: "Fungal caverns",
    base: 620,
    amp: 70,
    detail: 0.25,
    terrace: 0.1,
    basin: 0,
    worms: 9,
    wormRadius: [5, 13],
    chambers: 4,
    chamberSize: [130, 240, 55, 115],
    pools: 0.7,
    soil: 6,
    trees: 2,
    treeDensity: 0.035,
    fungus: 9,
    snowline: 0,
    geodes: 1,
    lava: 3,
  },
];

/** Half-width of the band over which neighbouring regions blend, in cells. */
export const BLEND = 400;
const NUMERIC: (keyof Biome)[] = ["base", "amp", "detail", "terrace", "soil", "snowline"];

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
  const p: Record<string, number> = {};
  for (const k of NUMERIC) p[k] = lerp(a[k] as number, b[k] as number, t);
  // Snow only blends where both sides have a snowline; otherwise the nearer side decides.
  if (!a.snowline || !b.snowline) p.snowline = (t < 0.5 ? a : b).snowline;
  return { p, t, left: e.left, right: e.right, past: e.past };
}

function basinOf(seed: number, r: number) {
  if (!BIOMES[regionBiome(seed, r)].basin) return null;
  const c = r * REGION_W + REGION_W * (0.32 + 0.36 * hash3(r, 11, seed)),
    w = REGION_W * (0.13 + 0.06 * hash3(r, 12, seed)),
    depth = 150 + 70 * hash3(r, 13, seed);
  return { c, w, depth };
}

/** Ground height (cells from the top) at world column x, before caves. */
export function groundAt(seed: number, x: number) {
  const { p } = paramsAt(seed, x);
  const n =
    (fbm1(x / 560, seed + 1) - 0.5) * 2 * p.amp +
    (fbm1(x / 120, seed + 2) - 0.5) * 2 * p.amp * p.detail;
  const hs = p.base + n,
    step = 44,
    k = hs / step,
    fi = Math.floor(k),
    terr = (fi + smoothstep(0.78, 1, k - fi)) * step;
  let h = lerp(hs, terr, p.terrace);
  const basin = basinOf(seed, Math.floor(x / REGION_W));
  if (basin) {
    const d = (x - basin.c) / basin.w;
    if (d > -1 && d < 1) {
      const q = 1 - d * d;
      h += basin.depth * q * Math.sqrt(q);
    }
  }
  return Math.max(240, Math.min(WORLD_H - 420, h));
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

/** A tunnel or cavern spawned by one region; every region it reaches carves it. */
interface Feature {
  kind: "worm" | "chamber" | "lava" | "geode";
  pts?: number[];
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  pool?: number;
}

function featuresOf(seed: number, q: number): Feature[] {
  const b = BIOMES[regionBiome(seed, q)],
    R = walkRandom(Math.floor(hash3(seed, q, 99) * 4294967296)),
    out: Feature[] = [],
    x0 = q * REGION_W;
  const chambers: Feature[] = [];
  for (let i = 0; i < b.chambers; i++) {
    const cx = x0 + REGION_W * (0.1 + 0.8 * R()),
      g = groundAt(seed, cx),
      rx = lerp(b.chamberSize[0], b.chamberSize[1], R()),
      ry = lerp(b.chamberSize[2], b.chamberSize[3], R()),
      cy = g + ry + 90 + R() * Math.max(0, WORLD_H - 380 - (g + ry + 90) - ry);
    const f: Feature = { kind: "chamber", cx, cy, rx, ry };
    if (R() < b.pools) f.pool = cy + ry * (0.15 + 0.25 * R());
    chambers.push(f);
    out.push(f);
  }
  for (let i = 0; i < b.worms + Math.max(0, chambers.length - 1); i++) {
    // Tunnels: the first ones join chambers; a few open to the sky as sinkholes.
    const linking = i >= b.worms;
    let x: number, y: number, tx = 0, ty = 0;
    if (linking) {
      const a = chambers[i - b.worms],
        c = chambers[i - b.worms + 1];
      x = a.cx;
      y = a.cy;
      tx = c.cx;
      ty = c.cy;
    } else {
      x = x0 + REGION_W * R();
      const g = groundAt(seed, x);
      y = i % 3 === 0 ? g - 4 : g + 50 + R() * (WORLD_H - g - 320);
    }
    let dx = linking ? tx - x : R() - 0.5,
      dy = linking ? ty - y : i % 3 === 0 ? 1 : (R() - 0.5) * 0.4;
    let len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len;
    dy /= len;
    const steps = linking ? Math.ceil(Math.hypot(tx - x, ty - y) / 2.5) : 160 + Math.floor(R() * 260),
      pts: number[] = [];
    for (let s = 0; s < steps; s++) {
      const r = lerp(b.wormRadius[0], b.wormRadius[1], fbm1(s / 30, Math.floor(R() * 1000) + i));
      pts.push(x, y, r);
      // Turn a little each step: rotate the heading by a small angle, then renormalise.
      let a = (R() - 0.5) * 0.3;
      if (linking) {
        const wx = tx - x,
          wy = ty - y,
          wl = Math.sqrt(wx * wx + wy * wy) || 1;
        dx = dx * 0.85 + (wx / wl) * 0.15;
        dy = dy * 0.85 + (wy / wl) * 0.15;
        a *= 0.3;
      } else if (dy < -0.5) a += 0.1 * (dx > 0 ? 1 : -1);
      const ndx = dx - a * dy,
        ndy = dy + a * dx;
      len = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
      dx = ndx / len;
      dy = ndy / len;
      x += dx * 2.5;
      y += dy * 2.5;
      if (y > WORLD_H - 140) dy = -Math.abs(dy);
    }
    out.push({ kind: "worm", pts, cx: 0, cy: 0, rx: 0, ry: 0 });
  }
  for (let i = 0; i < b.lava; i++)
    out.push({
      kind: "lava",
      cx: x0 + REGION_W * R(),
      cy: WORLD_H - 110 - R() * 150,
      rx: 30 + R() * 60,
      ry: 10 + R() * 16,
    });
  for (let i = 0; i < b.geodes; i++) {
    const cx = x0 + REGION_W * (0.05 + 0.9 * R()),
      g = groundAt(seed, cx);
    out.push({ kind: "geode", cx, cy: g + 60 + R() * 300, rx: 7 + R() * 7, ry: 0 });
  }
  return out;
}

export function generateRegion(seed: number, r: number): Region {
  const t0 = performance.now(),
    W = REGION_W,
    H = WORLD_H,
    x0 = r * W,
    cells = new Uint8Array(W * H),
    state = new Uint8Array(W * H),
    surface = new Int16Array(W);
  const margin = 48,
    ground = new Float64Array(W + 2 * margin);
  for (let i = 0; i < ground.length; i++) ground[i] = groundAt(seed, x0 + i - margin);
  for (let x = 0; x < W; x++) surface[x] = Math.round(ground[x + margin]);

  // Rock, soil, grass and snow, banded into strata; each cell belongs to one biome.
  for (let x = 0; x < W; x++) {
    const wx = x0 + x,
      { p, left, right, past } = paramsAt(seed, wx),
      s = surface[x],
      slope = Math.abs(ground[x + margin + 2] - ground[x + margin - 2]),
      soil = Math.round(p.soil * Math.max(0, 1 - slope / 9)),
      snowy = p.snowline > 0 && s < p.snowline,
      bl = regionBiome(seed, left),
      br = regionBiome(seed, right),
      bedrock = H - 22 - Math.floor(10 * fbm1(wx / 40, seed + 9));
    for (let y = s; y < H; y++) {
      const i = y * W + x,
        depth = y - s;
      let biome = past > 0 ? br : bl;
      if (bl !== br && Math.abs(past) < 180) {
        const wob = past + 170 * (fbm2(wx / 90, y / 90, seed + 21) - 0.5) * 2;
        biome = wob > 0 ? br : bl;
      }
      const band = Math.floor(
        (y - 0.6 * s + 80 * (fbm2(wx / 260, y / 170, seed + 5) - 0.5) + 0.02 * wx) / 22,
      );
      state[i] = stateOf(((band % 16) + 16) % 16, biome);
      if (y >= bedrock) cells[i] = M.BEDROCK;
      else if (depth === 0) cells[i] = snowy ? M.SNOW : soil > 0 ? M.GRASS : M.ROCK;
      else if (snowy && depth < 3) cells[i] = M.SNOW;
      else if (depth < soil) cells[i] = M.SOIL;
      else cells[i] = M.ROCK;
    }
  }

  // Caves: every feature spawned by this region or a neighbour that reaches it.
  const carve = (cx: number, cy: number, rad: number, to: number) => {
    const lx = Math.round(cx - x0);
    if (lx + rad < 0 || lx - rad >= W) return;
    const r2 = rad * rad;
    for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(H - 1, Math.ceil(cy + rad)); y++)
      for (let x = Math.max(0, Math.floor(lx - rad)); x <= Math.min(W - 1, Math.ceil(lx + rad)); x++) {
        const ddx = x - (cx - x0),
          ddy = y - cy;
        if (ddx * ddx + ddy * ddy > r2) continue;
        const i = y * W + x;
        if (cells[i] !== M.BEDROCK) cells[i] = to;
      }
  };
  const pools: Feature[] = [];
  for (const q of [r - 1, r, r + 1])
    for (const f of featuresOf(seed, q)) {
      if (f.kind === "worm") {
        const pts = f.pts!;
        for (let k = 0; k < pts.length; k += 3) carve(pts[k], pts[k + 1], pts[k + 2], M.AIR);
      } else if (f.kind === "chamber") {
        const lx0 = Math.floor(f.cx - f.rx - 20 - x0),
          lx1 = Math.ceil(f.cx + f.rx + 20 - x0);
        if (lx1 < 0 || lx0 >= W) continue;
        for (let y = Math.max(0, Math.floor(f.cy - f.ry * 1.3)); y < Math.min(H, f.cy + f.ry * 1.3); y++)
          for (let x = Math.max(0, lx0); x < Math.min(W, lx1); x++) {
            const wx = x + x0,
              ddx = (wx - f.cx) / f.rx,
              ddy = (y - f.cy) / f.ry,
              edge = 1 + 0.35 * (fbm2(wx / 40, y / 40, seed + 31) - 0.5),
              floor = f.cy + f.ry * (0.55 + 0.25 * (fbm1(wx / 70, seed + 33) - 0.5));
            if (ddx * ddx + ddy * ddy < edge && y < floor) {
              const i = y * W + x;
              if (cells[i] !== M.BEDROCK) cells[i] = M.AIR;
            }
          }
        if (f.pool !== undefined) pools.push(f);
      } else if (f.kind === "lava") {
        const lx0 = Math.floor(f.cx - f.rx - x0),
          lx1 = Math.ceil(f.cx + f.rx - x0);
        if (lx1 < 0 || lx0 >= W) continue;
        for (let y = Math.floor(f.cy - f.ry); y <= f.cy + f.ry; y++)
          for (let x = Math.max(0, lx0); x < Math.min(W, lx1); x++) {
            const ddx = (x + x0 - f.cx) / f.rx,
              ddy = (y - f.cy) / f.ry;
            if (ddx * ddx + ddy * ddy < 1 + 0.3 * (fbm2((x + x0) / 14, y / 14, seed + 41) - 0.5)) {
              const i = y * W + x;
              cells[i] = M.LAVA;
              state[i] |= GLOW;
            }
          }
      } else {
        // Geode: a hollow lined with crystals.
        const lx = Math.round(f.cx - x0);
        if (lx + f.rx + 3 < 0 || lx - f.rx - 3 >= W) continue;
        for (let y = Math.floor(f.cy - f.rx - 3); y <= f.cy + f.rx + 3; y++)
          for (let x = Math.max(0, lx - Math.ceil(f.rx) - 3); x <= Math.min(W - 1, lx + Math.ceil(f.rx) + 3); x++) {
            const d = Math.hypot(x + x0 - f.cx, y - f.cy),
              i = y * W + x;
            if (y < 0 || y >= H || cells[i] === M.BEDROCK) continue;
            if (d < f.rx) cells[i] = M.AIR;
            else if (d < f.rx + 2.2 && cells[i] !== M.AIR) {
              cells[i] = M.CRYSTAL;
              if (hash3(x + x0, y, seed + 51) < 0.35) state[i] |= GLOW;
            }
          }
      }
    }

  // The lake, filled to the lower of its two rims; sand at the shore, gravel below.
  let lake = -1;
  const basin = basinOf(seed, r);
  if (basin) {
    const rim = Math.min(groundAt(seed, basin.c - basin.w), groundAt(seed, basin.c + basin.w));
    lake = Math.round(rim) + 3;
    for (let x = Math.max(0, Math.floor(basin.c - basin.w - x0)); x < Math.min(W, basin.c + basin.w - x0); x++) {
      for (let y = lake; y < H; y++) {
        const i = y * W + x;
        if (cells[i] === M.AIR) cells[i] = M.WATER;
        else {
          const shore = y - lake < 10;
          for (let k = 0; k < 4 && y + k < H; k++) {
            const j = (y + k) * W + x;
            if (cells[j] !== M.AIR && cells[j] !== M.WATER) cells[j] = shore ? M.SAND : M.GRAVEL;
          }
          break;
        }
      }
    }
  }
  // Pools in caverns: water fills the hollow below the pool line.
  for (const f of pools) {
    const lx0 = Math.max(0, Math.floor(f.cx - f.rx - x0)),
      lx1 = Math.min(W, Math.ceil(f.cx + f.rx - x0));
    for (let y = Math.ceil(f.pool!); y < Math.min(H, f.cy + f.ry * 1.3); y++)
      for (let x = lx0; x < lx1; x++) {
        const i = y * W + x;
        if (cells[i] === M.AIR && y > surface[x] + 20) cells[i] = M.WATER;
      }
  }

  // Trees on open ground, decided per world column so both sides of an edge agree.
  for (let wx = x0 - margin; wx < x0 + W + margin; wx++) {
    const b = BIOMES[regionBiome(seed, Math.floor(wx / REGION_W))];
    if (!b.trees || hash3(wx, 31, seed) > b.treeDensity) continue;
    const gi = wx - x0 + margin,
      s = Math.round(ground[gi]),
      slope = Math.abs(ground[Math.min(ground.length - 1, gi + 3)] - ground[Math.max(0, gi - 3)]);
    if (slope > 5 || (lake >= 0 && s >= lake - 1)) continue;
    const { p } = paramsAt(seed, wx);
    if (p.snowline > 0 && s < p.snowline) continue;
    const put = (x: number, y: number, m: number) => {
      const lx = x - x0;
      if (lx < 0 || lx >= W || y < 0 || y >= H) return;
      const i = y * W + lx;
      if (cells[i] === M.AIR) cells[i] = m;
    };
    const R = walkRandom(Math.floor(hash3(wx, 32, seed) * 4294967296));
    if (b.trees === 1) {
      const trunk = 3 + Math.floor(R() * 4),
        crown = 14 + Math.floor(R() * 16);
      for (let k = 1; k <= trunk + crown; k++) put(wx, s - k, M.WOOD);
      for (let k = 0; k < crown; k++) {
        const half = Math.floor((k / crown) * crown * 0.3) + 1 - (k % 4 === 0 ? 1 : 0);
        for (let d = -half; d <= half; d++) put(wx + d, s - trunk - crown + k, M.LEAF);
      }
    } else {
      const trunk = 6 + Math.floor(R() * 6),
        rad = 5 + R() * 6;
      for (let k = 1; k <= trunk; k++) put(wx, s - k, M.WOOD);
      const cy = s - trunk - rad * 0.6;
      for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++)
        for (let dx = -Math.ceil(rad * 1.3); dx <= Math.ceil(rad * 1.3); dx++)
          if ((dx / 1.3) * (dx / 1.3) + dy * dy < rad * rad * (0.75 + 0.5 * hash3(wx + dx, Math.round(cy) + dy, seed + 33)))
            put(wx + dx, Math.round(cy + dy), M.LEAF);
    }
  }

  // Cavern floors: moss, small glowing fungi, and giant mushrooms where there is headroom.
  for (let x = 2; x < W - 2; x++) {
    const wx = x0 + x,
      b = BIOMES[biomeAtColumn(seed, wx)];
    for (let y = surface[x] + 24; y < H - 30; y++) {
      const i = y * W + x;
      if (cells[i] !== M.AIR || cells[i + W] === M.AIR || cells[i + W] === M.WATER) continue;
      // i is open space resting on solid ground: a cavern floor.
      const floor = i + W;
      if (cells[floor] === M.ROCK || cells[floor] === M.SOIL) {
        if (hash3(wx, y, seed + 61) < 0.25 * b.fungus / 9 + 0.05) cells[floor] = M.MOSS;
        const h = hash3(wx, y, seed + 62);
        if (h < 0.025 * (b.fungus / 9) + 0.004) {
          cells[i] = M.CAP;
          state[i] |= GLOW;
        } else if (h > 1 - b.fungus / 1000) mushroom(cells, state, x, y, seed, wx);
      }
    }
  }
  return { index: r, biome: regionBiome(seed, r), cells, state, surface, lake, ms: performance.now() - t0 };
}

function biomeAtColumn(seed: number, wx: number) {
  const { left, right, t } = paramsAt(seed, wx);
  return regionBiome(seed, t < 0.5 ? left : right);
}

function mushroom(cells: Uint8Array, state: Uint8Array, x: number, y: number, seed: number, wx: number) {
  const W = REGION_W,
    R = walkRandom(Math.floor(hash3(wx, y, seed + 63) * 4294967296)),
    stalk = 12 + Math.floor(R() * 30),
    cap = 6 + Math.floor(R() * 13);
  if (x - cap - 1 < 0 || x + cap + 1 >= W) return;
  // Needs open space for the whole mushroom.
  for (let k = 0; k <= stalk + cap * 0.6 + 1; k++)
    for (const dx of [-cap, 0, cap]) {
      const yy = y - k;
      if (yy < 0 || cells[yy * W + x + (k > stalk ? dx : 0)] !== M.AIR) return;
    }
  for (let k = 0; k < stalk; k++) {
    cells[(y - k) * W + x] = M.STALK;
    if (stalk > 24) cells[(y - k) * W + x + 1] = M.STALK;
  }
  const top = y - stalk,
    ch = Math.max(3, Math.floor(cap * 0.55));
  for (let r = 0; r < ch; r++) {
    const half = Math.floor(cap * Math.sqrt(1 - ((ch - r) / ch) * ((ch - r) / ch)));
    for (let dx = -half; dx <= half; dx++) {
      const i = (top - ch + r) * W + x + dx;
      if (cells[i] !== M.AIR) continue;
      cells[i] = M.CAP;
      if (r === ch - 1 || hash3(wx + dx, top - ch + r, seed + 64) < 0.1) state[i] |= GLOW;
    }
  }
}
