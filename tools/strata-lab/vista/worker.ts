// Vista worker: builds bands of the grids, and draws sprites.
import { buildBand } from "./grids";
import { drawSlots } from "./sprites";

self.onmessage = (e: MessageEvent) => {
  const job = e.data;
  if (job.type === "band") {
    const b = buildBand(job.gi, job.r0, job.r1),
      transfer: Transferable[] = [b.h.buffer, b.nrm.buffer, b.kind.buffer, b.road.buffer];
    if (b.trees) transfer.push(b.trees.buffer);
    (self as any).postMessage({ type: "band", id: job.id, band: b }, transfer);
  } else if (job.type === "sprites") {
    const out = drawSlots(job.from, job.to),
      transfer: Transferable[] = [];
    for (const s of out) for (const im of s.imgs) transfer.push(im.data.buffer);
    (self as any).postMessage({ type: "sprites", id: job.id, slots: out }, transfer);
  }
};
