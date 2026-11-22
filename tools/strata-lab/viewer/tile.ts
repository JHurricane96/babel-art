// One region of land, generated and lit, ready to draw. Used by the viewer's
// workers (and on the main thread if workers are unavailable).
import { generateWindow } from "../../../engine/strata/generate.ts";
import { REGION_W, WORLD_H } from "../../../engine/strata/world.ts";
import { renderLand } from "../land-render.ts";

/** Extra columns lit either side, so light crosses region edges seamlessly. */
const PAD = 128;

export interface Tile {
  seed: number;
  r: number;
  rgba: Uint8ClampedArray;
  surface: Int16Array;
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
    lit = renderLand({
      W,
      H,
      cells: g.cells,
      state: g.state,
      surface: g.surface,
      x0,
      seed,
    }),
    t2 = performance.now(),
    rgba = new Uint8ClampedArray(REGION_W * H * 4);
  for (let y = 0; y < H; y++)
    rgba.set(
      lit.subarray((y * W + PAD) * 4, (y * W + PAD + REGION_W) * 4),
      y * REGION_W * 4,
    );
  return {
    seed,
    r,
    rgba,
    surface: g.surface.slice(PAD, PAD + REGION_W),
    genMs: t1 - t0,
    lightMs: t2 - t1,
  };
}
