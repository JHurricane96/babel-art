import { mkdir, writeFile, rename } from "node:fs/promises";
import { openBrowser, sleep } from "./browser-session.mjs";
const argument = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const hours = Number(argument("--hours", "8")),
  scene = argument("--scene", "chemical");
if (
  !Number.isFinite(hours) ||
  hours <= 0 ||
  hours > 12 ||
  ![
    "chemical",
    "tapestry",
    "murmuration",
    "interference",
    "contours",
    "platformer",
  ].includes(scene)
)
  throw new Error("Use --hours (0,12] and a supported --scene.");
const report = {
  status: "running",
  scene,
  hours,
  startedAt: new Date().toISOString(),
  elapsedSeconds: 0,
  samples: [],
  errors: [],
};
await mkdir("artifacts", { recursive: true });
const filename = `artifacts/soak-${scene}.json`;
const save = async () => {
  await writeFile(filename + ".tmp", JSON.stringify(report, null, 2));
  await rename(filename + ".tmp", filename);
};
let browser;
const start = Date.now();
let previous,
  quiet = 0,
  peakHeap = 0;
try {
  browser = await openBrowser({
    port: 4177,
    debugPort: 9226,
    directory: "artifacts/soak-site",
  });
  await browser.evaluate(
    `document.querySelector('[data-scene="${scene}"]').click()`,
  );
  while (Date.now() - start < hours * 3600000) {
    await sleep(5000);
    const sample = await browser.evaluate(
      `(()=>{const r=window.babelDebug.runtime,c=document.getElementById('compositor');const small=document.createElement('canvas');small.width=64;small.height=40;const ctx=small.getContext('2d');ctx.drawImage(c,0,0,64,40);const pixels=Array.from(ctx.getImageData(0,0,64,40).data);return {tick:r.sim?.tick||0,history:r.history.size,states:r.states.size,images:r.entityTextures.size,checkpoints:r.checkpoints.size,events:r.events.length,replayFloor:r.replayFloor,health:r.health.state,activeSeconds:window.babelDebug.clock.wallMs/1000,visible:!document.hidden,fps:document.getElementById('fps').textContent,pixels,gl:r.gl.getError()};})()`,
    );
    const pixels = sample.pixels;
    delete sample.pixels;
    let change = 0;
    if (previous) {
      for (let i = 0; i < pixels.length; i++)
        if (i % 4 !== 3) change += Math.abs(pixels[i] - previous[i]);
      change /= (pixels.length / 4) * 3 * 255;
      quiet = change < 0.001 ? quiet + 5 : 0;
    }
    previous = pixels;
    const heap = await browser.call("Runtime.getHeapUsage");
    peakHeap = Math.max(peakHeap, heap.usedSize);
    sample.heapBytes = heap.usedSize;
    sample.change = change;
    if (
      !sample.visible ||
      sample.gl !== 0 ||
      sample.history > 192 ||
      sample.states > 192 ||
      sample.images > 64 ||
      sample.checkpoints > 8 ||
      sample.events > 2048 ||
      heap.usedSize > 256 * 1024 * 1024 ||
      quiet >= 30 ||
      browser.errors.length
    )
      throw new Error("Soak invariant failed: " + JSON.stringify(sample));
    report.elapsedSeconds = (Date.now() - start) / 1000;
    report.peakHeapBytes = peakHeap;
    if (
      report.samples.length === 0 ||
      report.elapsedSeconds - report.samples.at(-1).seconds >= 30
    )
      report.samples.push({ seconds: report.elapsedSeconds, ...sample });
    if (report.samples.length > 1440) report.samples.shift();
    await save();
    if (Math.floor(report.elapsedSeconds) % 30 < 5)
      console.log(
        JSON.stringify({
          seconds: Math.round(report.elapsedSeconds),
          scene,
          fps: sample.fps,
          heapMB: Math.round(heap.usedSize / 1048576),
          recoveries: sample.health.interventions,
        }),
      );
  }
  report.status = "passed";
  console.log("Wall-clock soak passed: " + filename);
} catch (error) {
  report.status = "failed";
  report.errors.push(String(error.stack || error));
  console.error(error);
  process.exitCode = 1;
} finally {
  report.elapsedSeconds = (Date.now() - start) / 1000;
  report.finishedAt = new Date().toISOString();
  await save();
  await browser?.close();
}
