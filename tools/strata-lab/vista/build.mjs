// Build the Vista renderer (the layered valley) into one self-contained HTML file.
//
//   node tools/strata-lab/vista/build.mjs OUT.html               # page content (for an artifact)
//   node tools/strata-lab/vista/build.mjs OUT.html --standalone  # a full document to open locally
//
// The worker is bundled first and embedded in the page as a string, so the page
// needs no other files.
//
// LAND_CODE, the version of the day's land the page saves in the browser (cache.ts): a hash of the
// code that makes it (the world generator, landFromWorld and setLand, bundled and minified with all
// they use), so a change to any of that code, and to nothing else, makes the page make the land
// again instead of using one saved by an older build.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)),
  out = resolve(process.argv[2] ?? "vista.html"),
  standalone = process.argv.includes("--standalone"),
  common = {
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
  };

const landCode = await build({
    ...common,
    // (Names kept: renaming would shift with any code added to these files, used here or not.)
    minify: false,
    minifyWhitespace: true,
    minifySyntax: true,
    stdin: {
      contents: 'export { generateWorld } from "../../../engine/strata/world2d"; export { landFromWorld, setLand } from "./land";',
      resolveDir: here,
      loader: "ts",
    },
    format: "esm",
  }),
  LAND_CODE = createHash("sha256").update(landCode.outputFiles[0].text).digest("hex").slice(0, 16);
const worker = await build({
    ...common,
    entryPoints: [resolve(here, "worker.ts")],
  }),
  main = await build({
    ...common,
    entryPoints: [resolve(here, "main.ts")],
    define: { WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text), LAND_CODE: JSON.stringify(LAND_CODE) },
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
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB (land code ${LAND_CODE})`);
