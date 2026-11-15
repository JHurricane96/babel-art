// Stills from the real renderer, through headless Chromium (software GL here: about 10 s per still).
//   node tools/murmuration-lab/capture.mjs <outDir> '<jobs json>' [port]
//   jobs: [{"scene":"murmuration","palette":"aurora","style":"luminous","params":{"Label":value},"times":[20,55],"name":"a"}]
// Set DPR=2 for full-resolution stills. Never record video this way in a container without a GPU:
// it takes about two seconds per frame. Use export.mjs + render.py for motion.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
const [outDir, jobsJson, port = "4190"] = process.argv.slice(2);
if (!jobsJson) throw new Error("usage: capture.mjs <outDir> '<jobs json>' [port]");
const jobs = JSON.parse(jobsJson);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", port, "--strictPort"], { cwd: root, stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}`); break; } catch { await sleep(200); } }
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const page = await browser.newPage({ viewport: { width: 2000, height: 1500 }, deviceScaleFactor: Number(process.env.DPR || 1) });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}`);
await page.waitForFunction(() => !!window.babelDebug, null, { timeout: 30000 });
await page.addStyleTag({ content: ".stage{height:1050px!important}" });
await page.evaluate(() => window.dispatchEvent(new Event("resize")));
const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const seek = async (s) => {
  await page.evaluate(async (s) => { const r = window.babelDebug.runtime; while (r.pending) await new Promise((res) => setTimeout(res, 20)); window.babelDebug.project().time = s; await r.seek(s); document.getElementById("time").value = s; }, s);
  await frame(); await frame();
};
await page.evaluate(() => document.getElementById("play").click()); // pause
await page.selectOption("#quality", "2");
try {
  for (const job of jobs) {
    await page.evaluate((id) => document.querySelector(`[data-scene="${id}"]`).click(), job.scene);
    await frame();
    if (job.palette) { await page.selectOption("#palette", job.palette); await frame(); }
    if (job.style) {
      await page.evaluate((st) => { const l = [...document.querySelectorAll("label")].find((l) => l.textContent.startsWith("Visual style")); const s = l.querySelector("select"); s.value = st; s.dispatchEvent(new Event("change")); }, job.style);
      await frame();
    }
    for (const [label, value] of Object.entries(job.params ?? {})) {
      await page.evaluate(([label, value]) => { const l = [...document.querySelectorAll("#scene-parameters label")].find((l) => l.firstChild.textContent.startsWith(label)); const f = l.querySelector("input,select"); if (f.type === "checkbox") f.checked = value; else f.value = value; f.dispatchEvent(new Event("change")); }, [label, value]);
      await frame();
    }
    for (const t of job.times) {
      const t0 = Date.now();
      await seek(t); await sleep(150); await frame();
      await (await page.$("#wall")).screenshot({ path: `${outDir}/${job.name}-t${String(t).padStart(4, "0")}.png` });
      console.log(job.name, t, `${Date.now() - t0}ms`);
    }
  }
} finally {
  console.log("errors:", errors);
  await browser.close(); server.kill();
}
