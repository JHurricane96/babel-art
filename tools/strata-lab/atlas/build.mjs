// Build Strata Atlas (worlds as maps) into one self-contained HTML file.
//
//   node tools/strata-lab/atlas/build.mjs OUT.html               # page content (for an artifact)
//   node tools/strata-lab/atlas/build.mjs OUT.html --standalone  # a full document to open locally
//
// The worker is bundled first and embedded in the page as a string, so the page
// needs no other files.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)),
  out = resolve(process.argv[2] ?? "atlas.html"),
  standalone = process.argv.includes("--standalone"),
  common = {
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
  };

const worker = await build({
    ...common,
    entryPoints: [resolve(here, "worker.ts")],
  }),
  main = await build({
    ...common,
    entryPoints: [resolve(here, "main.ts")],
    define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) },
  });
const script = main.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
let html = readFileSync(resolve(here, "page.html"), "utf8").replace(
  "<!-- SCRIPT -->",
  () => `<script>${script}</script>`,
);
if (standalone)
  html =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    "<style>body{margin:0}</style>\n</head>\n<body>\n" +
    html +
    "\n</body>\n</html>\n";
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
