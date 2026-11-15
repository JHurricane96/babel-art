// Run the flock headless and write what a renderer needs, for fast offline review.
//   node --import tsx tools/murmuration-lab/export.mjs <seed> <seconds> <fps> <out.bin> [startSeconds] [population]
// Per frame and bird, six float32: screen x, y (640×400 image units), scale (units per metre),
// wing area facing the camera (0..1), and the wing-span direction on screen (units per metre).
// A JSON file beside it holds the counts, the horizon row and the falcon's position per frame.
import { Murmuration, BIRD_STRIDE, CAMERA } from "../../engine/murmuration.ts";
import { defaults } from "../../scenes/registry.ts";
import { writeFileSync } from "node:fs";
const [seed, secs, fps, out, start = "0", pop] = process.argv.slice(2);
if (!out) throw new Error("usage: export.mjs <seed> <seconds> <fps> <out.bin> [startSeconds] [population]");
const params = { ...defaults("murmuration"), ...(pop ? { population: Number(pop) } : {}) };
const sim = new Murmuration(Number(seed), params);
for (let i = 0; i < Number(start) * 60; i++) sim.step();
const n = sim.birds.length / BIRD_STRIDE, frames = Math.round(Number(secs) * Number(fps)), per = 60 / Number(fps);
const data = new Float32Array(frames * n * 6), falcon = [];
let acc = 0, stepMs = 0, steps = 0;
for (let f = 0; f < frames; f++) {
  acc += per;
  while (acc >= 1) { const t = performance.now(); sim.step(); stepMs += performance.now() - t; steps++; acc -= 1; }
  const b = sim.birds;
  for (let i = 0; i < n; i++) {
    const at = i * BIRD_STRIDE, x = b[at], y = b[at + 1], z = b[at + 2], vx = b[at + 3], vy = b[at + 4], vz = b[at + 5], bank = b[at + 6];
    const v = Math.hypot(vx, vy, vz) || 1, ex = vx / v, ey = vy / v, ez = vz / v;
    let sx = -ez, sz = ex; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    let ux = -ey * ex, uy = 1 - ey * ey, uz = -ey * ez; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const cb = Math.cos(bank), sb = Math.sin(bank), nx = cb * ux + sb * sx, ny = cb * uy, nz = cb * uz + sb * sz, wx = cb * sx - sb * ux, wy = -sb * uy;
    const lx = x - CAMERA.x, ly = y - CAMERA.y, lz = z - CAMERA.z, ll = Math.hypot(lx, ly, lz) || 1;
    const s = CAMERA.focal / Math.max(1, z - CAMERA.z), o = (f * n + i) * 6;
    data[o] = 320 + (x - CAMERA.x) * s; data[o + 1] = CAMERA.horizon - (y - CAMERA.y) * s; data[o + 2] = s;
    data[o + 3] = Math.abs((nx * lx + ny * ly + nz * lz) / ll); data[o + 4] = wx * s; data[o + 5] = -wy * s;
  }
  const fr = sim.captureFrame().extra?.falcon; falcon.push(fr ? Array.from(fr) : null);
}
writeFileSync(out, Buffer.from(data.buffer));
writeFileSync(out + ".json", JSON.stringify({ n, frames, fps: Number(fps), horizon: CAMERA.horizon, falcon }));
console.log(`exported ${frames} frames of ${n} birds; simulation ${(stepMs / steps).toFixed(2)} ms per step`);
