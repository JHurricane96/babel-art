// Headless Chromium with SwiftShader WebGL, as tools/murmuration-lab/cost.mjs launches it.
import { createRequire } from "node:module";

export async function launch() {
  let chromium;
  try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
  return chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}
