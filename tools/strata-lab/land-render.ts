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
import { GLOW, M, bandOf, biomeOf, hash3 } from "../../engine/strata/world.ts";

const hex = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// Rock strata per biome, in BIOMES order: highlands sandstone, fungal violet
// shale, canyon red beds, forest limestone, peaks granite, basalt.
const ROCK = [
  ["#b98a5e", "#a8784f", "#c29a6a", "#9c6c4a", "#b08560", "#8f6448"],
  ["#6f5f86", "#5f5578", "#7a6a90", "#574d6e", "#6a5c80", "#4f4766"],
  ["#c8643c", "#d98a4e", "#b5523a", "#e0a066", "#a84a32", "#cf7a48"],
  ["#b4ad90", "#a29c80", "#c2bb9e", "#958f76", "#aca68a", "#8a846c"],
  ["#9aa3b2", "#8a93a3", "#a9b1bf", "#7c8596", "#949db0", "#6f7889"],
  ["#6e6670", "#7d7280", "#625b68", "#8a7068", "#5a5462", "#94746a"],
].map((p) => p.map(hex));
const SOLID: number[][] = [];
for (const [m, c] of [
  [M.SOIL, "#6b4a34"],
  [M.GRASS, "#6f8f3e"],
  [M.SAND, "#d8c08a"],
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
const SKY = [hex("#191c3c"), hex("#5a3f78"), hex("#f0a060")];
const CYAN = hex("#5ff0e0"),
  VIOLET = hex("#c08cff"),
  WARM = hex("#ffae5a"),
  SKYL = hex("#ffd2b0"),
  AMB = hex("#9aa0d0"),
  WATER = hex("#2f6f86"),
  DEEP = hex("#123049"),
  BACK_TINT = [0.11, 0.1, 0.18];

const isOpen = (m: number) =>
  m === M.AIR || m === M.WATER || m === M.STREAM || m === M.FALLS;
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
function lightAt(Lsky: number, c: number, v: number, w: number, bay: number) {
  const a = stepped(Lsky, bay),
    sc = stepped(c, bay) * 0.9,
    sv = stepped(v, bay) * 0.9,
    sw = stepped(w, bay) * 1.1;
  lr = a * SKYL[0] + sc * CYAN[0] + sv * VIOLET[0] + sw * WARM[0];
  lg = a * SKYL[1] + sc * CYAN[1] + sv * VIOLET[1] + sw * WARM[1];
  lb = a * SKYL[2] + sc * CYAN[2] + sv * VIOLET[2] + sw * WARM[2];
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
}

/** Render land to RGBA, one pixel per cell. */
export const renderTimes: Record<string, number> = {};
export function renderLand({ W, H, cells, state, surface, x0 }: Land) {
  let tt = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    renderTimes[k] = n - tt;
    tt = n;
  };
  const N = W * H,
    dist = new Int32Array(N),
    Ls = new Float32Array(N),
    Lc = new Float32Array(N),
    Lv = new Float32Array(N),
    Lw = new Float32Array(N);

  // Sky light enters the ground through its openings: seed the flood from sky
  // cells that touch open space below the ground line.
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
    lists: number[][] = [[], [], []];
  for (let i = 0; i < N; i++) {
    const m = cells[i];
    if (!(state[i] & GLOW) && m !== M.LAVA) continue;
    const kind =
        m === M.LAVA || m === M.CORAL
          ? 2
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
  flood(W, H, cells, Int32Array.from(lists[2]), 70, 2, dist, Lw);

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
    iceAbove = new Int16Array(W);
  for (let y = 0; y < H; y++) {
    const cut = 0.6 - 0.24 * Math.min(1, Math.max(0, (y - 400) / 900));
    fine.row(y);
    coarse.row(y);
    flow.row(y);
    fall.row(y);
    for (let x = 0; x < W; x++) {
      const i = y * W + x,
        wx = x0 + x,
        m = cells[i],
        st = state[i],
        biome = biomeOf(st) % ROCK.length,
        bay = BAYER[(y & 3) * 4 + (wx & 3)];
      const skyCell = y < surface[x];
      let cr: number, cg: number, cb: number;
      const wd = m === M.WATER ? waterAbove[x] : 0;
      waterAbove[x] = m === M.WATER ? wd + 1 : 0;
      const id = m === M.ICE ? iceAbove[x] : 0;
      iceAbove[x] = m === M.ICE ? id + 1 : 0;
      if (m === M.AIR && skyCell) {
        // Open sky: a dusk gradient, dithered into bands.
        const t = Math.min(1, y / 600),
          a = t < 0.55 ? SKY[0] : SKY[1],
          b = t < 0.55 ? SKY[1] : SKY[2],
          u = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
        cr = Math.floor((a[0] + (b[0] - a[0]) * u) * 18 + bay) / 18;
        cg = Math.floor((a[1] + (b[1] - a[1]) * u) * 18 + bay) / 18;
        cb = Math.floor((a[2] + (b[2] - a[2]) * u) * 18 + bay) / 18;
        lr = lg = lb = 1;
      } else if (m === M.WATER) {
        // Water: tinted, darker with depth, a bright line where it meets the air.
        const top = wd === 0 && y > 0 && cells[i - W] === M.AIR,
          f = Math.min(1, wd / 36),
          rock = ROCK[biome][bandOf(st) % 6];
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
          lightAt(Ls[i], Lc[i], Lv[i], Lw[i], bay);
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
          rock = ROCK[biome][bandOf(st) % 6],
          h = grain(wx, y),
          seam =
            y > 0 &&
            cells[i - W] === M.ROCK &&
            bandOf(state[i - W]) !== bandOf(st),
          // Basalt cools into columns: in some flows (strata), dark joints every
          // 4 to 8 cells, spaced and offset by the flow.
          bnd = bandOf(st),
          joint =
            biome === 5 &&
            (bnd * 7) % 5 < 3 &&
            (wx + bnd * 13) % (4 + ((bnd * 5) % 5)) === 0,
          tex =
            (1 + (0.05 * ((h & 3) - 1.5)) / 1.5 + 0.12 * (mottle - 0.5)) *
            ((h >>> 8) % 97 === 0 ? 1.25 : 1) *
            (seam ? 0.8 : 1) *
            (joint ? 0.78 : 1);
        if (m === M.AIR) {
          // The cave's back wall: the same rock, set back and in shadow.
          cr = rock[0] * 0.42 * tex + BACK_TINT[0] * 0.25;
          cg = rock[1] * 0.42 * tex + BACK_TINT[1] * 0.25;
          cb = rock[2] * 0.42 * tex + BACK_TINT[2] * 0.25;
          lightAt(Ls[i], Lc[i], Lv[i], Lw[i], bay);
          lr += 0.55 * AMB[0];
          lg += 0.55 * AMB[1];
          lb += 0.55 * AMB[2];
        } else {
          const c =
            m === M.ROCK
              ? null
              : m === M.LEAF
                ? LEAF[biome]
                : m === M.CAP
                  ? CAP[biome]
                  : m === M.VINE && st & GLOW
                    ? VINE_GLOW
                    : (SOLID[m] ?? rock);
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
            let near = 0,
              edge = 0;
            if (!skyCell) {
              const up = y > 0 ? i - W : -1,
                down = y < H - 1 ? i + W : -1,
                left = x > 0 ? i - 1 : -1,
                right = x < W - 1 ? i + 1 : -1;
              for (let s = 0; s < 4; s++) {
                const j =
                  s === 0 ? up : s === 1 ? left : s === 2 ? right : down;
                if (j < 0 || !isOpen(cells[j])) continue;
                const l = Math.max(Ls[j], Lc[j], Lv[j], Lw[j]);
                if (l > near) near = l;
                const e = s === 0 ? 1 : 0.6;
                if (e > edge) edge = e;
              }
            }
            // Deep inside solid rock nothing reaches but the cut-away light.
            if (near > 0) lightAt(near * 0.85, Lc[i], Lv[i], Lw[i], bay);
            else lr = lg = lb = 0;
            const amb = cut * (1 + 0.35 * edge);
            lr += amb * AMB[0];
            lg += amb * AMB[1];
            lb += amb * AMB[2];
          }
        }
      }
      const o = i * 4;
      rgba[o] = cr * lr * 255;
      rgba[o + 1] = cg * lg * 255;
      rgba[o + 2] = cb * lb * 255;
      rgba[o + 3] = 255;
    }
  }
  lap("shade");
  return rgba;
}
