// Vista worker: makes today's world, builds bands of the grids from its land, and makes sprites for
// the GPU (pack.ts).
import { generateWorld } from "../../../engine/strata/world2d";
import { buildBand } from "./grids";
import { setLand } from "./land";
import { packSlot } from "./pack";
import { slotDefs } from "./sprites";

const defs = slotDefs();
self.onmessage = (e: MessageEvent) => {
  const job = e.data;
  if (job.type === "land") setLand(job.data);
  else if (job.type === "world") {
    const w = generateWorld(job.seed, { n: job.n, progress: (f) => (self as any).postMessage({ progress: f }) });
    (self as any).postMessage({ world: w });
  } else if (job.type === "band") {
    const b = buildBand(job.gi, job.r0, job.r1, job.spec, job.route),
      transfer: Transferable[] = [b.h.buffer, b.nrm.buffer, b.kind.buffer, b.road.buffer];
    if (b.trees) transfer.push(b.trees.buffer);
    (self as any).postMessage({ band: b }, transfer);
  } else if (job.type === "sprites") {
    const out = [],
      transfer: Transferable[] = [];
    for (let s = job.from; s < job.to; s++) {
      const p = packSlot(s, defs[s]);
      out.push(p);
      for (const q of p.exact) transfer.push(q.data.buffer);
      if (p.span) transfer.push(p.span.pic.data.buffer, p.span.rows.buffer, p.span.cols.buffer, p.span.per.buffer);
      for (const q of p.parts) transfer.push(q.pic.data.buffer, q.rows.buffer, q.cols.buffer, q.per.buffer);
    }
    (self as any).postMessage({ slots: out }, transfer);
  }
};
