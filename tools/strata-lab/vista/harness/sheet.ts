// Contact sheet of sprites as drawn, in Node (no browser, seconds): each named sprite drawn at each
// height, and with `parts` also as the GPU puts it together from its parts (pack.ts's assemble,
// coloured from its ramps), for looking at new or changed drawings.
//
//   npx tsx tools/strata-lab/vista/harness/sheet.ts NAMES [HEIGHTS] [OUT.png] [--parts] [--scale=3]
//   NAMES: slot names or name prefixes, comma-separated ("pine 0,sage" = pine 0 and every sage);
//   HEIGHTS: px, comma-separated (default 8,16,32,64,128). One row per height.
import { packSlot, assemble } from "../pack";
import { slotDefs, indexMode } from "../sprites";
import { out, png } from "./lib.mjs";

const flags = process.argv.filter((a) => a.startsWith("--")),
  [namesArg, heightsArg, file] = process.argv.slice(2).filter((a) => !a.startsWith("--")),
  scale = Number(flags.find((f) => f.startsWith("--scale="))?.slice(8) ?? 3),
  parts = flags.includes("--parts"),
  names = (namesArg ?? "").split(",").filter(Boolean),
  heights = (heightsArg ?? "8,16,32,64,128").split(",").map(Number),
  defs = slotDefs(),
  pick = defs.map((d, i) => ({ d, i })).filter(({ d }) => names.some((n) => d.name === n || d.name.startsWith(`${n} `)));
if (!pick.length) {
  console.log(`say which sprites; there are: ${defs.map((d) => d.name).join(", ")}`);
  process.exit(1);
}
type Img = { w: number; h: number; data: Uint8ClampedArray | Uint8Array };
const rows: Img[][] = heights.map((H) =>
  pick.flatMap(({ d, i }) => {
    indexMode(false);
    const drawn: Img = d.draw(H, 1000 + i * 131),
      both = [drawn];
    if (parts) {
      const pk = packSlot(i, d);
      if (pk.parts.length && H >= pk.plan.T) {
        const a = assemble(pk.parts, H, pk.plan.K),
          ramps = new Map(pk.ramps),
          first = [...ramps.values()][0],
          data = new Uint8ClampedArray(a.w * a.h * 4);
        for (let k = 0; k < a.w * a.h; k++) {
          const v = a.data[k * 4];
          if (!a.data[k * 4 + 3] || !v) continue;
          const c = (ramps.get(v >> 3) ?? first)[Math.max(0, (v & 7) - 1)];
          data.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], k * 4);
        }
        both.push({ w: a.w, h: a.h, data });
      }
    }
    return both;
  }),
);
const pad = 6,
  W = Math.max(...rows.map((r) => r.reduce((t, im) => t + im.w + pad, pad))),
  rowH = rows.map((r) => Math.max(...r.map((im) => im.h))),
  H = rowH.reduce((t, h) => t + h + pad, pad),
  img = new Uint8Array(W * H * 4);
for (let k = 0; k < W * H; k++) img.set([150, 180, 210, 255], k * 4);
let y0 = pad;
rows.forEach((r, j) => {
  let x0 = pad;
  for (const im of r) {
    for (let y = 0; y < im.h; y++)
      for (let x = 0; x < im.w; x++) {
        const s = (y * im.w + x) * 4;
        if (im.data[s + 3]) img.set([im.data[s], im.data[s + 1], im.data[s + 2], 255], ((y0 + rowH[j] - im.h + y) * W + x0 + x) * 4);
      }
    x0 += im.w + pad;
  }
  y0 += rowH[j] + pad;
});
console.log(png(file ?? out("drawn.png"), W, H, img, scale), pick.map(({ d }) => d.name).join(", "));
