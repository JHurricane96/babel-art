// A contact sheet of sprites as the GPU draws them (the sprite lab): each named sprite at each size,
// on the sky, side by side, to look at.
//
//   run.mjs sheet names="sage 0,shrub" [sizes=8,16,32,64,128] [scale=3] [file=sheet.png]
//   (or match=REGEX)
import { png } from "../lib.mjs";

export const page = "lab";

export default async ({ page, args, out }) => {
  const names = await page.evaluate(() => window.vista.slotNames()),
    pick = args.names ? String(args.names).split(",").map((s) => s.trim()) : names.filter((n) => new RegExp(args.match ?? "^$").test(n)),
    sizes = String(args.sizes ?? "8,16,32,64,128").split(",").map(Number),
    pad = 6,
    cells = [];
  if (!pick.length) throw new Error("say which: names=a,b or match=REGEX");
  for (const name of pick) {
    const r = await page.evaluate(([n, s]) => window.vista.spriteGrowth(n, s, true), [name, sizes]);
    if (!r) throw new Error(`no sprite ${name}`);
    cells.push(r.map(([, h, w, ...px]) => ({ w, h: h, px })));
  }
  // Rows: one per sprite; columns: sizes.
  const colW = sizes.map((_, j) => Math.max(1, ...cells.map((row) => row[j].w || 0))),
    rowH = cells.map((row) => Math.max(1, ...row.map((c) => c.h || 0))),
    W = colW.reduce((t, w) => t + w + pad, pad),
    H = rowH.reduce((t, h) => t + h + pad, pad),
    img = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) img.set([150, 180, 210, 255], i * 4);
  let y0 = pad;
  cells.forEach((row, i) => {
    let x0 = pad;
    row.forEach((c, j) => {
      // Bottom-aligned, as they stand.
      for (let y = 0; y < c.h; y++)
        for (let x = 0; x < c.w; x++) {
          const s = (y * c.w + x) * 4;
          if (!c.px[s + 3]) continue;
          img.set([c.px[s], c.px[s + 1], c.px[s + 2], 255], ((y0 + rowH[i] - c.h + y) * W + x0 + x) * 4);
        }
      x0 += colW[j] + pad;
    });
    y0 += rowH[i] + pad;
  });
  return { file: png(out(String(args.file ?? "sheet.png")), W, H, img, Number(args.scale ?? 3)), sprites: pick, sizes };
};
