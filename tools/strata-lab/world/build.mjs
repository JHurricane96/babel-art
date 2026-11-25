// Build the Strata world overview into one self-contained HTML file.
//
//   node tools/strata-lab/world/build.mjs OUT.html                # page content (for an artifact)
//   node tools/strata-lab/world/build.mjs OUT.html  --standalone  # a full document to open locally
//
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)),
  out = resolve(process.argv[2] ?? "strata-world.html"),
  standalone = process.argv.includes("--standalone"),
  common = {
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
  };

const main = await build({
  ...common,
  entryPoints: [resolve(here, "main.ts")],
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
