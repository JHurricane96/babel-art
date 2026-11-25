// Loop 1 lab: render generated Strata regions to images, fast, without the app.
//
//   node --import tsx tools/strata-lab/regions.ts OUT_DIR [seed] [first region] [--quick]
//
// Writes, for the seed (default 7):
//   panorama.png       four neighbouring regions at 1 cell per pixel (8192 x 1600)
//   panorama-half.png  the same at half size
//   transition-N.png   a wall-sized window (991 x 648 cells) on each region edge, at 2x
// and for seeds 1 to 12, contact.png: two regions per seed, at quarter size, 3 across.
// Prints generation time per region (measured here, and scaled to the mini PC
// with the budget tool's central factor).
//
// The look (land-render.ts) follows the chosen mock-up (A, stepped). It is an
// approximation for judging the land; the real renderer comes later.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateRegion } from "../../engine/strata/generate.ts";
import { biomeNameAt } from "../../engine/strata/worldmap.ts";
import { REGION_W, WORLD_H } from "../../engine/strata/world.ts";
import { renderLand } from "./land-render.ts";

const MINI_PC_FACTOR = 0.77; // tools/strata-lab/pi-budget, target 780m, central
function stitch(seed: number, r0: number, n: number) {
  const W = REGION_W * n,
    cells = new Uint8Array(W * WORLD_H),
    state = new Uint8Array(W * WORLD_H),
    surface = new Int16Array(W),
    ms: number[] = [];
  for (let k = 0; k < n; k++) {
    const g = generateRegion(seed, r0 + k);
    ms.push(g.ms);
    for (let y = 0; y < WORLD_H; y++) {
      cells.set(
        g.cells.subarray(y * REGION_W, (y + 1) * REGION_W),
        y * W + k * REGION_W,
      );
      state.set(
        g.state.subarray(y * REGION_W, (y + 1) * REGION_W),
        y * W + k * REGION_W,
      );
    }
    surface.set(g.surface, k * REGION_W);
  }
  return { W, H: WORLD_H, cells, state, surface, ms, x0: r0 * REGION_W, seed };
}

function render(world: ReturnType<typeof stitch>) {
  const { W, H } = world,
    rgba = renderLand({ ...world, seed: world.seed }),
    rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return { W, H, rgb };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(path: string, W: number, H: number, rgb: Uint8Array) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * W * 3, W * 3).copy(
      raw,
      y * (W * 3 + 1) + 1,
    );
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 6 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
function shrink(img: { W: number; H: number; rgb: Uint8Array }, f: number) {
  const W = Math.floor(img.W / f),
    H = Math.floor(img.H / f),
    out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++)
          for (let dx = 0; dx < f; dx++)
            s += img.rgb[((y * f + dy) * img.W + x * f + dx) * 3 + k];
        out[(y * W + x) * 3 + k] = Math.round(s / (f * f));
      }
  return { W, H, rgb: out };
}
function crop(
  img: { W: number; H: number; rgb: Uint8Array },
  x0: number,
  y0: number,
  w: number,
  h: number,
  scale: number,
) {
  const out = new Uint8Array(w * scale * h * scale * 3);
  for (let y = 0; y < h * scale; y++)
    for (let x = 0; x < w * scale; x++) {
      const sx = Math.min(img.W - 1, Math.max(0, x0 + Math.floor(x / scale))),
        sy = Math.min(img.H - 1, Math.max(0, y0 + Math.floor(y / scale)));
      for (let k = 0; k < 3; k++)
        out[(y * w * scale + x) * 3 + k] = img.rgb[(sy * img.W + sx) * 3 + k];
    }
  return { W: w * scale, H: h * scale, rgb: out };
}

const out = process.argv[2];
const seed = Number(process.argv[3] ?? 7);
mkdirSync(out, { recursive: true });
// Regions from the world's interior (its ends are ocean); a fifth argument picks the first.
const first = Number(
  process.argv.slice(4).find((a) => !a.startsWith("--")) ?? 40,
);
const pano = stitch(seed, first, 4);
const img = render(pano);
png(`${out}/panorama.png`, img.W, img.H, img.rgb);
const half = shrink(img, 2);
png(`${out}/panorama-half.png`, half.W, half.H, half.rgb);
const names = [0, 1, 2, 3].map((k) =>
  biomeNameAt(seed, (first + k) * REGION_W + REGION_W / 2),
);
console.log(
  `seed ${seed}: regions ${first}..${first + 3} = ${names.join(" | ")}`,
);
for (const [k, edge] of [REGION_W, 2 * REGION_W, 3 * REGION_W].entries()) {
  const s = pano.surface[edge],
    c = crop(img, edge - 495, Math.max(0, s - 260), 991, 648, 2);
  png(`${out}/transition-${k + 1}.png`, c.W, c.H, c.rgb);
}
const ms = [...pano.ms];
// Contact sheet: two regions for each of 12 seeds.
const tiles: { W: number; H: number; rgb: Uint8Array }[] = [];
const quick = process.argv.includes("--quick");
for (let sd = 1; sd <= (quick ? 0 : 12); sd++) {
  const w = stitch(sd, 60, 2);
  ms.push(...w.ms);
  tiles.push(shrink(render(w), 4));
}
const tw = tiles[0]?.W ?? 0,
  th = tiles[0]?.H ?? 0,
  gap = 8,
  CW = tw * 3 + gap * 2,
  CH = th * 4 + gap * 3,
  sheet = new Uint8Array(CW * CH * 3).fill(255);
tiles.forEach((t, n) => {
  const ox = (n % 3) * (tw + gap),
    oy = Math.floor(n / 3) * (th + gap);
  for (let y = 0; y < th; y++)
    sheet.set(
      t.rgb.subarray(y * tw * 3, (y + 1) * tw * 3),
      ((oy + y) * CW + ox) * 3,
    );
});
if (!quick) png(`${out}/contact.png`, CW, CH, sheet);
ms.sort((a, b) => a - b);
const med = ms[Math.floor(ms.length / 2)];
console.log(
  `region generation: median ${med.toFixed(0)} ms here, max ${ms[ms.length - 1].toFixed(0)} ms; ` +
    `about ${(med * MINI_PC_FACTOR).toFixed(0)} ms on the mini PC (factor ${MINI_PC_FACTOR}, central)`,
);
