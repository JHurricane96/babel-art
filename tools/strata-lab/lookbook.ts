// Strata lookbook: a fixed set of places, rendered as stills in Node on the
// CPU renderer (no browser), several at a time, into contact sheets. With
// --before it renders the same places from another checkout too, and puts
// each pair side by side, so a change shows as what it did.
//
//   node --import tsx tools/strata-lab/lookbook.ts OUT_DIR                 # this tree
//   node --import tsx tools/strata-lab/lookbook.ts OUT_DIR --before DIR    # DIR (a checkout) | this tree
//   node --import tsx tools/strata-lab/lookbook.ts OUT_DIR --only 1,5,9    # some places
//   node --import tsx tools/strata-lab/lookbook.ts OUT_DIR --spots FILE    # places from a JSON file: [[seed, x, "name"], ...]
//
// Each still is a 640 x 360 art-pixel screen (zoom 3 on a 1920-wide screen),
// framed the way the viewer frames the land. Sheets hold four places each:
// one still per place, or before | after. A tiny digit stamped in each
// still's corner gives its place number; the list prints at the end.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url)),
  ROOT = resolve(HERE, "../..");

/** Places worth keeping an eye on: one per landform, and the biomes that matter. */
const SPOTS: [number, number, string][] = [
  [11, 191283, "Slickrock canyons, an arch"],
  [11, 182067, "Gravel plain under mesas"],
  [11, 53888, "Badlands"],
  [11, 72088, "Mountains, alpine meadow"],
  [11, 308688, "Glacial peaks, treeline"],
  [11, 313888, "A volcano"],
  [7, 64288, "Limestone towers, dry forest"],
  [7, 16384, "Rainforest"],
  [7, 5300, "A coast"],
  [7, 82330, "Birch, aspen and maple"],
  [7, 147865, "River meadow under a ridge"],
  [7, 321740, "Sagebrush tablelands"],
  [2, 154829, "Spruce forest hills"],
  [2, 165472, "Burnt forest"],
  [2, 199968, "Tundra"],
  [2, 98088, "Fault scarps, oak and beech"],
  [5, 23757, "Tree savanna"],
  [3, 373146, "Karst towers, bamboo"],
];

const SW = 640,
  SH = 360,
  PAD = 128;

// ---- PNG -------------------------------------------------------------------

function png(w: number, h: number, rgba: Uint8Array | Uint8ClampedArray) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4),
      td = Buffer.concat([Buffer.from(t), d]),
      c = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    c.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ih),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Digits 0-9 as 3x5 bitmaps, rows top to bottom. */
const DIGITS = [
  "111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111",
];
function stamp(img: Uint8Array, w: number, n: number) {
  const s = String(n),
    k = 3; // each bitmap cell drawn 3 x 3
  for (let y = 0; y < 5 * k + 8; y++)
    for (let x = 0; x < s.length * 4 * k + 8; x++) {
      const o = (y * w + x) * 4;
      img[o] = img[o + 1] = img[o + 2] = 0;
      img[o + 3] = 255;
    }
  [...s].forEach((ch, i) => {
    const bits = DIGITS[Number(ch)];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++)
        if (bits[r * 3 + c] === "1")
          for (let dy = 0; dy < k; dy++)
            for (let dx = 0; dx < k; dx++) {
              const o = ((4 + r * k + dy) * w + 4 + i * 4 * k + c * k + dx) * 4;
              img[o] = img[o + 1] = img[o + 2] = 255;
            }
  });
}

// ---- One still ---------------------------------------------------------------

async function still(root: string, seed: number, x: number) {
  const gen = await import(resolve(root, "engine/strata/generate.ts")),
    map = await import(resolve(root, "engine/strata/worldmap.ts")),
    world = await import(resolve(root, "engine/strata/world.ts")),
    lr = await import(resolve(root, "tools/strata-lab/land-render.ts")),
    H: number = world.WORLD_H,
    W = SW + 2 * PAD,
    x0 = Math.round(x - SW / 2 - PAD),
    g = gen.generateWindow(seed, x0, W),
    rgba: Uint8ClampedArray = lr.renderLand({
      W,
      H,
      cells: g.cells,
      state: g.state,
      flora: g.flora,
      surface: g.surface,
      x0,
      seed,
    });
  // Frame like the viewer: the ground (smoothed over the screen) a little below the middle.
  let sum = 0;
  for (let k = -4; k <= 4; k++) sum += map.groundRow(seed, x + (k * SW) / 8);
  const top = Math.max(0, Math.min(H - SH, Math.round(sum / 9 - 0.64 * SH))),
    out = new Uint8Array(SW * SH * 4);
  for (let y = 0; y < SH; y++)
    out.set(rgba.subarray(((top + y) * W + PAD) * 4, ((top + y) * W + PAD + SW) * 4), y * SW * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

// ---- Worker: render some places from one tree, write raw stills ---------------

async function worker(root: string, list: number[], spots: typeof SPOTS, dir: string, tag: string) {
  for (const i of list) {
    const [seed, x] = spots[i],
      img = await still(root, seed, x);
    stamp(img, SW, i + 1);
    writeFileSync(resolve(dir, `${tag}-${i}.raw`), img);
  }
}

// ---- Main: farm out, then compose sheets ------------------------------------------

function run(args: string[]) {
  return new Promise<void>((done, fail) => {
    const p = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), ...args], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
    p.on("exit", (code) => (code === 0 ? done() : fail(new Error(`worker exited ${code}`))));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--worker") {
    const [, root, listS, spotsFile, dir, tag] = argv;
    const spots = JSON.parse(readFileSync(spotsFile, "utf8"));
    await worker(root, listS.split(",").map(Number), spots, dir, tag);
    return;
  }
  const out = resolve(argv[0] ?? "lookbook"),
    flag = (name: string) => {
      const k = argv.indexOf(name);
      return k >= 0 ? argv[k + 1] : undefined;
    },
    before = flag("--before"),
    spots: typeof SPOTS = flag("--spots") ? JSON.parse(readFileSync(flag("--spots")!, "utf8")) : SPOTS,
    only = flag("--only")?.split(",").map((s) => Number(s) - 1),
    picks = only ?? spots.map((_, i) => i);
  mkdirSync(out, { recursive: true });
  const spotsFile = resolve(out, "spots.json");
  writeFileSync(spotsFile, JSON.stringify(spots));
  const t0 = performance.now(),
    trees: [string, string][] = before ? [[resolve(before), "before"], [ROOT, "after"]] : [[ROOT, "now"]],
    n = Math.max(1, Math.min(cpus().length, 6)),
    jobs: Promise<void>[] = [];
  // Places of one seed go to one worker (the world is built once per process).
  for (const [root, tag] of trees) {
    const bySeed = new Map<number, number[]>();
    for (const i of picks) bySeed.set(spots[i][0], [...(bySeed.get(spots[i][0]) ?? []), i]);
    const groups = [...bySeed.values()].sort((a, b) => b.length - a.length),
      lanes: number[][] = Array.from({ length: Math.ceil(n / trees.length) }, () => []);
    for (const g of groups) lanes.sort((a, b) => a.length - b.length)[0].push(...g);
    for (const lane of lanes)
      if (lane.length) jobs.push(run(["--worker", root, lane.join(","), spotsFile, out, tag]));
  }
  await Promise.all(jobs);
  // Sheets of four places.
  const cols = trees.length === 2 ? 2 : 2,
    per = 4;
  const sheets: string[] = [];
  for (let s = 0; s < picks.length; s += per) {
    const group = picks.slice(s, s + per),
      cells: Uint8Array[] = [];
    for (const i of group)
      for (const [, tag] of trees) cells.push(new Uint8Array(readFileSync(resolve(out, `${tag}-${i}.raw`))));
    const rows = Math.ceil(cells.length / cols),
      W = SW * cols + (cols - 1) * 4,
      H = SH * rows + (rows - 1) * 4,
      sheet = new Uint8Array(W * H * 4);
    for (let k = 0; k < sheet.length; k += 4) sheet[k + 3] = 255;
    cells.forEach((img, c) => {
      const ox = (c % cols) * (SW + 4),
        oy = Math.floor(c / cols) * (SH + 4);
      for (let y = 0; y < SH; y++)
        sheet.set(img.subarray(y * SW * 4, (y + 1) * SW * 4), ((oy + y) * W + ox) * 4);
    });
    const name = resolve(out, `sheet-${s / per + 1}.png`);
    writeFileSync(name, png(W, H, sheet));
    sheets.push(name);
  }
  console.log(`${picks.length} places${before ? " (before | after)" : ""} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  for (const i of picks) console.log(`  ${i + 1}. seed ${spots[i][0]} · region ${(spots[i][1] / 2048).toFixed(1)} · ${spots[i][2]}`);
  for (const s of sheets) console.log(s);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
