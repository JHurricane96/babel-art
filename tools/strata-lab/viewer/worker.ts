// Viewer worker: builds tiles on request and hands back their layers.
import { buildTile } from "./tile.ts";

self.onmessage = (e: MessageEvent<{ id: number; seed: number; r: number }>) => {
  const { id, seed, r } = e.data,
    t = buildTile(seed, r);
  (self as unknown as Worker).postMessage({ id, ...t }, [
    t.rgba.buffer,
    t.plants.buffer,
    t.motion.buffer,
    t.surface.buffer,
    t.horizon.buffer,
    ...Object.values(t.emit).map((a) => a.buffer),
  ]);
};
