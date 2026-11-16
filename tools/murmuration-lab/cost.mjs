// Processor cost of the murmuration in the browser: simulation step, frame capture, checkpoint,
// and building the draw data in JavaScript. GPU time is not measured (and cannot be without a GPU).
//   node tools/murmuration-lab/cost.mjs
// It reaches into renderer internals (marks, drawFlock3D): update it when those change.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
const port = 4246, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}`); break; } catch { await sleep(200); } }
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto(`http://127.0.0.1:${port}`);
await page.waitForFunction(() => !!window.babelDebug); await sleep(1000);
await page.evaluate(() => document.querySelector('[data-scene="murmuration"]').click()); await sleep(6000);
const r = await page.evaluate(() => {
  const rt = window.babelDebug.runtime, sim = rt.sim, re = rt.renderer;
  let t = performance.now(); for (let i = 0; i < 120; i++) sim.step(); const stepMs = (performance.now() - t) / 120;
  t = performance.now(); let fr; for (let i = 0; i < 50; i++) fr = sim.captureFrame(fr); const captureMs = (performance.now() - t) / 50;
  t = performance.now(); let snap; for (let i = 0; i < 10; i++) snap = sim.snapshot(); const snapshotMs = (performance.now() - t) / 10;
  const out = { birds: sim.birds.length / 8, stepMs, captureMs, snapshotMs, checkpointBytes: JSON.stringify(snap).length };
  if (re?.marks && re.drawFlock3D) {
    const marks = re.marks, draw = marks.draw; marks.draw = function () { out.marks = this.count; this.count = 0; };
    const a = { style: "silhouette", colors: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.8, 0.7, 0.6]], seed: 5, params: { richness: 0.8 } };
    t = performance.now(); for (let i = 0; i < 50; i++) re.drawFlock3D(fr, a, 1, 0.8, 1440); out.buildMarksMs = (performance.now() - t) / 50;
    marks.draw = draw;
  }
  return out;
});
console.log(JSON.stringify(r, (k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
await browser.close(); server.kill();
