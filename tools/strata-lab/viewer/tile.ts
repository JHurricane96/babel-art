// One region of land, generated and lit, ready to draw and animate. Used by
// the viewer's workers (and on the main thread if workers are unavailable).
import { generateWindow, regionFeatures } from "../../../engine/strata/generate.ts";
import { GLOW, M, REGION_W, WORLD_H } from "../../../engine/strata/world.ts";
import { MOTION, horizonRow, renderLand } from "../land-render.ts";

/** Extra columns lit either side, so light crosses region edges seamlessly. */
const PAD = 128;
/** Extra columns kept either side in the tile, so swaying plants never clip at a region edge. */
export const APRON = 4;

/** Where particles and creatures come from, in world cells. */
export interface Emitters {
  /** Glowing fungi and vines: spores drift up. */
  spores: Float32Array;
  /** Lava meeting air: embers. */
  embers: Float32Array;
  /** Lava open to the sky (a crater's lake): a plume of smoke and steam. */
  vents: Float32Array;
  /** Where waterfalls land: spray. */
  spray: Float32Array;
  /** Leaves on trees: some fall. */
  leaves: Float32Array;
  /** Grass along the ground: fireflies. */
  meadows: Float32Array;
  /** Cave mouths: bats. */
  mouths: Float32Array;
  /** Columns under snow: snowfall (x, ground y). */
  snow: Float32Array;
  /** Open water: x0, x1, surface y, and where its column depths start in waterDepth, per lake or pool. */
  waters: Float32Array;
  /** Per column of each body in waters: how many cells of water lie under its surface. */
  waterDepth: Float32Array;
  /** Cave ceilings where water drips: x, y, and the row the drop lands on. */
  drips: Float32Array;
}

export interface Tile {
  seed: number;
  r: number;
  /** Width of every layer: the region plus an apron either side. */
  width: number;
  rgba: Uint8ClampedArray;
  plants: Uint8ClampedArray;
  motion: Uint8Array;
  surface: Int16Array;
  /** The row the sky's horizon sits on, per column. */
  horizon: Float32Array;
  emit: Emitters;
  genMs: number;
  lightMs: number;
}

export function buildTile(seed: number, r: number): Tile {
  const x0 = r * REGION_W - PAD,
    W = REGION_W + 2 * PAD,
    H = WORLD_H,
    t0 = performance.now(),
    g = generateWindow(seed, x0, W),
    t1 = performance.now(),
    full = { motion: new Uint8Array(W * H), plants: new Uint8ClampedArray(W * H * 4) },
    lit = renderLand(
      { W, H, cells: g.cells, state: g.state, flora: g.flora, surface: g.surface, x0, seed },
      full,
    ),
    t2 = performance.now(),
    TW = REGION_W + 2 * APRON,
    from = PAD - APRON,
    rgba = new Uint8ClampedArray(TW * H * 4),
    plants = new Uint8ClampedArray(TW * H * 4),
    motion = new Uint8Array(TW * H);
  for (let y = 0; y < H; y++) {
    rgba.set(lit.subarray((y * W + from) * 4, (y * W + from + TW) * 4), y * TW * 4);
    plants.set(full.plants.subarray((y * W + from) * 4, (y * W + from + TW) * 4), y * TW * 4);
    motion.set(full.motion.subarray(y * W + from, y * W + from + TW), y * TW);
  }
  // Streams flow the way their river runs.
  const river = regionFeatures(seed, r).river;
  if (river && river.outlet < river.spring)
    for (let i = 0; i < motion.length; i++) if (motion[i] === MOTION.STREAM) motion[i] = MOTION.STREAM_BACK;
  return {
    seed,
    r,
    width: TW,
    rgba,
    plants,
    motion,
    surface: g.surface.slice(from, from + TW),
    horizon: horizonRow(seed, r * REGION_W - APRON, TW),
    emit: emitters(g.cells, g.state, g.surface, W, H, x0, seed, r),
    genMs: t1 - t0,
    lightMs: t2 - t1,
  };
}

/** Pick up to n entries from a list of (x, y) pairs, evenly spread. */
function thin(list: number[], n: number, per = 2) {
  const count = list.length / per;
  if (count <= n) return Float32Array.from(list);
  const out = new Float32Array(n * per),
    step = count / n;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < per; j++) out[k * per + j] = list[Math.floor(k * step) * per + j];
  return out;
}

function emitters(
  cells: Uint8Array,
  state: Uint8Array,
  surface: Int16Array,
  W: number,
  H: number,
  x0: number,
  seed: number,
  r: number,
): Emitters {
  void seed;
  void r;
  const spores: number[] = [],
    embers: number[] = [],
    vents: number[] = [],
    spray: number[] = [],
    leaves: number[] = [],
    meadows: number[] = [],
    mouths: number[] = [],
    snow: number[] = [],
    waters: number[] = [],
    waterDepth: number[] = [],
    tips: number[] = [],
    ceilings: number[] = [];
  for (let x = PAD; x < PAD + REGION_W; x++) {
    const wx = x0 + x,
      s = surface[x],
      top = cells[s * W + x];
    if (top === M.SNOW && x % 3 === 0) snow.push(wx, s);
    if (top === M.GRASS && cells[(s - 1) * W + x] !== M.WATER) meadows.push(wx, s - 1);
    for (let y = 1; y < H - 1; y++) {
      const i = y * W + x,
        m = cells[i];
      if (m === M.AIR) {
        // A cave mouth: open space under the ground line beside the open sky.
        if (y >= surface[x] && ((cells[i - 1] === M.AIR && y < surface[x - 1]) || (cells[i + 1] === M.AIR && y < surface[x + 1])))
          mouths.push(wx, y);
        continue;
      }
      if ((m === M.CAP || m === M.SHROOM || m === M.VINE) && state[i] & GLOW && y > s && cells[i - W] === M.AIR)
        spores.push(wx, y - 1);
      else if (y > s + 6 && cells[i + W] === M.AIR && m !== M.WATER && m !== M.LAVA && m !== M.FALLS && m !== M.STREAM) {
        // A cave ceiling: water gathers and drips, most of all from the tips
        // of hanging rock. Find where a drop would land.
        let f = y + 1;
        while (f < H - 1 && f - y < 320 && cells[f * W + x] === M.AIR) f++;
        if (f - y >= 6) {
          const tip = cells[i - 1] === M.AIR && cells[i + 1] === M.AIR;
          (tip ? tips : ceilings).push(wx, y + 1, f);
        }
      }
      else if (m === M.LAVA && cells[i - W] === M.AIR) {
        embers.push(wx, y - 1);
        if (y <= s) vents.push(wx, y - 1);
      }
      else if (m === M.FALLS && cells[i + W] !== M.FALLS) spray.push(wx, y);
      else if (m === M.LEAF && y < s) leaves.push(wx, y);
      else if (m === M.WATER && cells[i - W] === M.AIR && cells[i - 1] !== M.WATER) {
        // The left end of a water surface: measure the run, and how deep the
        // water is under each column of it, so swimmers keep to the water.
        let e = x;
        while (e < W - 1 && cells[y * W + e + 1] === M.WATER) e++;
        const depths: number[] = [];
        for (let c = x; c <= e; c++) {
          let d = 0;
          while (y + d < H && cells[(y + d) * W + c] === M.WATER) d++;
          depths.push(d);
        }
        if (e - x >= 16 && Math.max(...depths) >= 7) {
          waters.push(wx, x0 + e, y, waterDepth.length);
          waterDepth.push(...depths);
        }
      }
    }
  }
  return {
    spores: thin(spores, 600),
    embers: thin(embers, 300),
    vents: thin(vents, 40),
    spray: thin(spray, 200),
    leaves: thin(leaves, 500),
    meadows: thin(meadows, 400),
    mouths: thin(mouths, 60),
    snow: thin(snow, 400),
    waters: Float32Array.from(waters),
    waterDepth: Float32Array.from(waterDepth),
    // Tips first: they drip most; a few plain ceilings as well.
    drips: Float32Array.from([...thin(tips, 160, 3), ...thin(ceilings, 60, 3)]),
  };
}
