// Build the Sprite Growth Lab into one self-contained HTML file.
//
//   node tools/strata-lab/vista/scalelab-build.mjs OUT.html [--standalone]
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)),
  out = resolve(process.argv[2] ?? "scalelab.html"),
  standalone = process.argv.includes("--standalone");
const js = await build({ entryPoints: [resolve(here, "scalelab-page.ts")], bundle: true, format: "iife", target: "es2022", minify: true, write: false, legalComments: "none" });
const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
let html = readFileSync(resolve(here, "scalelab.html"), "utf8").replace("<!-- SCRIPT -->", () => `<script>${script}</script>`);
if (standalone)
  html = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n' + html + "\n</body>\n</html>\n";
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
