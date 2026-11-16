// Run the flock headless and write what a renderer needs, for fast offline review.
//   node --import tsx tools/murmuration-lab/export.mjs <seed> <seconds> <fps> <out.bin> [startSeconds] [population]
// Per frame and bird, six float32: screen x, y (640×400 image units), scale (units per metre),
// shade (0..1, how dark the bird is drawn), and the flight direction on screen (units per metre).
// A JSON file beside it holds the counts and the horizon row.
import { Murmuration, BIRD_STRIDE, CAMERA } from "../../engine/murmuration.ts";
import { birdShade } from "../../engine/murmuration-look.ts";
import { defaults } from "../../scenes/registry.ts";
import { writeFileSync } from "node:fs";
const [seed, secs, fps, out, start = "0", pop] = process.argv.slice(2);
if (!out)
  throw new Error(
    "usage: export.mjs <seed> <seconds> <fps> <out.bin> [startSeconds] [population]",
  );
const params = {
  ...defaults("murmuration"),
  ...(pop ? { population: Number(pop) } : {}),
};
const sim = new Murmuration(Number(seed), params);
for (let i = 0; i < Number(start) * 60; i++) sim.step();
const n = sim.birds.length / BIRD_STRIDE,
  frames = Math.round(Number(secs) * Number(fps)),
  per = 60 / Number(fps);
const data = new Float32Array(frames * n * 6);
let acc = 0,
  stepMs = 0,
  steps = 0;
for (let f = 0; f < frames; f++) {
  acc += per;
  while (acc >= 1) {
    const t = performance.now();
    sim.step();
    stepMs += performance.now() - t;
    steps++;
    acc -= 1;
  }
  const b = sim.captureFrame().data;
  for (let i = 0; i < n; i++) {
    const at = i * BIRD_STRIDE,
      x = b[at],
      y = b[at + 1],
      z = b[at + 2],
      vx = b[at + 3],
      vy = b[at + 4],
      vz = b[at + 5];
    const v = Math.hypot(vx, vy, vz) || 1,
      s = CAMERA.focal / Math.max(1, z - CAMERA.z),
      o = (f * n + i) * 6;
    data[o] = 320 + (x - CAMERA.x) * s;
    data[o + 1] = CAMERA.horizon - (y - CAMERA.y) * s;
    data[o + 2] = s;
    data[o + 3] = birdShade(b, at);
    data[o + 4] = (vx / v) * s;
    data[o + 5] = (-vy / v) * s;
  }
}
writeFileSync(out, Buffer.from(data.buffer));
writeFileSync(
  out + ".json",
  JSON.stringify({ n, frames, fps: Number(fps), horizon: CAMERA.horizon }),
);
console.log(
  `exported ${frames} frames of ${n} birds; simulation ${(stepMs / steps).toFixed(2)} ms per step`,
);
