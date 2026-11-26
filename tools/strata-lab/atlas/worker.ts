// Strata Atlas worker: makes one world (world2d.ts) and sends it back, with progress on the way.
import { generateWorld } from "../../../engine/strata/world2d";

self.onmessage = (e: MessageEvent) => {
  const { id, seed, n } = e.data;
  const w = generateWorld(seed, { n, progress: (f) => (self as any).postMessage({ id, progress: f }) }),
    arrays = [w.h, w.lake, w.salt, w.sea, w.rec, w.flow, w.rain, w.temp, w.season, w.ocean, w.uplift, w.sed, w.rock, w.zone, w.habitat, w.soil, w.biome, w.plate, w.fold, w.granite, ...w.tops];
  (self as any).postMessage({ id, world: w }, arrays.map((a) => a.buffer));
};
