// Loop 1 lab: render generated Strata regions to images, fast, without the app.
//
//   node --import tsx tools/strata-lab/regions.ts OUT_DIR [seed] [--quick]
//
// Writes, for the seed (default 7):
//   panorama.png       four neighbouring regions at 1 cell per pixel (8192 x 1600)
//   panorama-half.png  the same at half size
//   transition-N.png   a wall-sized window (991 x 648 cells) on each region edge, at 2x
// and for seeds 1 to 12, contact.png: two regions per seed, at quarter size, 3 across.
// Prints generation time per region (measured here, and scaled to the mini PC
// with the budget tool's central factor).
//
// The look follows the chosen mock-up (A, stepped): dusk sky, dark cut-away rock,
// caves dark except for light falling in from the sky and from glowing things.
// It is an approximation for judging the land; the real renderer comes later.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  BIOMES,
  generateRegion,
  regionBiome,
} from "../../engine/strata/generate.ts";
import {
  GLOW,
  M,
  REGION_W,
  WORLD_H,
  bandOf,
  biomeOf,
  hash3,
  noise2,
} from "../../engine/strata/world.ts";

const MINI_PC_FACTOR = 0.77; // tools/strata-lab/pi-budget, target 780m, central
const hex = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const ROCK = [
  ["#b98a5e", "#a8784f", "#c29a6a", "#9c6c4a", "#b08560", "#8f6448"].map(hex),
  ["#6f5f86", "#5f5578", "#7a6a90", "#574d6e", "#6a5c80", "#4f4766"].map(hex),
];
const SOLID_COLOUR: Record<number, number[]> = {
  [M.SOIL]: hex("#6b4a34"),
  [M.GRASS]: hex("#6f8f3e"),
  [M.SAND]: hex("#d8c08a"),
  [M.GRAVEL]: hex("#8a8378"),
  [M.SNOW]: hex("#e8eef6"),
  [M.ICE]: hex("#bfe4f0"),
  [M.WOOD]: hex("#5b4330"),
  [M.STALK]: hex("#b7a9c9"),
  [M.CRYSTAL]: hex("#b48cff"),
  [M.BEDROCK]: hex("#1c1a24"),
  [M.MOSS]: hex("#3f6a52"),
  [M.VINE]: hex("#2f6f66"),
};
const LEAF = [hex("#2f4a35"), hex("#4f6b3a")];
const CAP = [hex("#5a4a8a"), hex("#3d6f7a")];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16,
);
const SKY = [hex("#191c3c"), hex("#5a3f78"), hex("#f0a060")];

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
  return { W, H: WORLD_H, cells, state, surface, ms };
}

const open = (m: number) => m === M.AIR || m === M.WATER;

/**
 * Light spreading through open cells: intensity 1 at sources, falling linearly
 * to 0 at radius. Distances use 8 neighbours (costs 5 straight, 7 diagonal), so
 * pools of light come out near-round instead of diamond-shaped.
 */
function flood(
  W: number,
  H: number,
  cells: Uint8Array,
  sources: Int32Array,
  radius: number,
  waterCost = 2,
) {
  const R5 = radius * 5,
    dist = new Int32Array(W * H).fill(R5),
    buckets: number[][] = Array.from({ length: R5 + 8 }, () => []);
  for (const i of sources) {
    dist[i] = 0;
    buckets[0].push(i);
  }
  const steps = [
    [-1, 0, 5],
    [1, 0, 5],
    [0, -1, 5],
    [0, 1, 5],
    [-1, -1, 7],
    [1, -1, 7],
    [-1, 1, 7],
    [1, 1, 7],
  ];
  for (let d = 0; d < R5; d++) {
    const q = buckets[d];
    for (let n = 0; n < q.length; n++) {
      const i = q[n];
      if (dist[i] !== d) continue;
      const x = i % W,
        y = (i - x) / W;
      for (const [dx, dy, c] of steps) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const j = ny * W + nx;
        if (!open(cells[j])) continue;
        // No squeezing diagonally between two solid cells.
        if (dx && dy && !open(cells[y * W + nx]) && !open(cells[ny * W + x]))
          continue;
        const nd = d + c * (cells[j] === M.WATER ? waterCost : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          if (nd < R5) buckets[nd].push(j);
        }
      }
    }
    buckets[d] = [];
  }
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) if (dist[i] < R5) L[i] = 1 - dist[i] / R5;
  return L;
}

function render(world: ReturnType<typeof stitch>) {
  const { W, H, cells, state, surface } = world;
  // Sky light: from every open cell above the ground, through the open space it reaches.
  const skySrc: number[] = [];
  for (let x = 0; x < W; x++)
    for (let y = 0; y < surface[x]; y++)
      if (open(cells[y * W + x])) skySrc.push(y * W + x);
  const Ls = flood(W, H, cells, Int32Array.from(skySrc), 120, 3);
  const glow: Record<string, number[]> = { cyan: [], violet: [], warm: [] };
  for (let i = 0; i < W * H; i++)
    if (state[i] & GLOW || cells[i] === M.LAVA)
      (cells[i] === M.LAVA
        ? glow.warm
        : cells[i] === M.CRYSTAL
          ? glow.violet
          : glow.cyan
      ).push(i);
  // Glowing cells are solid; seed the flood from the open cells next to them.
  const seedFrom = (list: number[]) => {
    const s = new Set<number>();
    for (const i of list)
      for (const j of [i - 1, i + 1, i - W, i + W])
        if (j >= 0 && j < W * H && open(cells[j])) s.add(j);
    return Int32Array.from(s);
  };
  const Lc = flood(W, H, cells, seedFrom(glow.cyan), 34),
    Lv = flood(W, H, cells, seedFrom(glow.violet), 26),
    Lw = flood(W, H, cells, seedFrom(glow.warm), 70);
  const rgb = new Uint8Array(W * H * 3),
    step = (L: number, i: number) =>
      Math.floor(
        Math.min(1.6, L) * 5 + BAYER[(Math.floor(i / W) % 4) * 4 + (i % 4)],
      ) / 5;
  const cyan = hex("#5ff0e0"),
    violet = hex("#c08cff"),
    warm = hex("#ffae5a"),
    skyl = hex("#ffd2b0"),
    amb = hex("#9aa0d0"),
    water = hex("#2f6f86"),
    deep = hex("#123049");
  for (let i = 0; i < W * H; i++) {
    const x = i % W,
      y = (i - x) / W,
      m = cells[i],
      st = state[i],
      biome = biomeOf(st);
    let c: number[];
    let light: number[];
    const lights = (Lsky: number) =>
      [0, 1, 2].map(
        (k) =>
          step(Lsky, i) * skyl[k] +
          step(Lc[i], i) * cyan[k] * 0.9 +
          step(Lv[i], i) * violet[k] * 0.9 +
          step(Lw[i], i) * warm[k] * 1.1,
      );
    if (open(m) && y < surface[x] && Ls[i] >= 0.999 && m === M.AIR) {
      // Open sky: a dusk gradient, dithered into bands.
      const t = Math.min(1, y / 600);
      const a = t < 0.55 ? SKY[0] : SKY[1],
        b = t < 0.55 ? SKY[1] : SKY[2],
        u = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
      c = [0, 1, 2].map(
        (k) =>
          Math.floor(
            (a[k] + (b[k] - a[k]) * u) * 18 + BAYER[(y % 4) * 4 + (x % 4)],
          ) / 18,
      );
      light = [1, 1, 1];
    } else if (m === M.WATER) {
      // Water: tinted, darker with depth, a bright line where it meets the air.
      let d = 0;
      while (
        d < 40 &&
        i - (d + 1) * W >= 0 &&
        cells[i - (d + 1) * W] === M.WATER
      )
        d++;
      const top = d === 0 && cells[i - W] === M.AIR,
        f = Math.min(1, d / 36),
        back = ROCK[biome % 2][bandOf(st) % 6].map((v) => v * 0.42 + 0.03);
      c = [0, 1, 2].map((k) =>
        top
          ? 0.75 * water[k] + 0.35
          : back[k] * 0.35 * (1 - f) +
            (water[k] * (1 - f) + deep[k] * f) * 0.75,
      );
      const l = lights(Math.max(Ls[i], y < surface[x] + 260 ? 0.5 : 0));
      light = l.map((v, k) => 0.25 + 0.75 * Math.min(1.2, v + 0.3 * amb[k]));
    } else if (m === M.LAVA) {
      // Lava: dark red with an orange crust where it meets the air, and a few hot specks.
      const top = cells[i - W] === M.AIR,
        h = Math.floor(hash3(x, y, 77) * 64);
      c = hex(
        top
          ? "#ff8a3a"
          : (h & 63) === 0
            ? "#ffb04a"
            : (h & 7) < 3
              ? "#c23e1c"
              : "#8a2416",
      );
      light = [1, 1, 1];
    } else {
      // Rock and everything solid, or the back wall of a cave behind open space.
      const rock = ROCK[biome % 2][bandOf(st) % 6];
      // Grain: fine speckle, coarser mottling, the odd pebble, and a dark seam
      // along the top of each stratum.
      const h = ((x * 374761393 + y * 668265263) ^ ((x * y) >>> 3)) >>> 0,
        mott = noise2(x / 6, y / 4, 991),
        seam =
          y > 0 &&
          cells[i - W] === M.ROCK &&
          bandOf(state[i - W]) !== bandOf(st),
        tex =
          (1 + (0.05 * ((h & 3) - 1.5)) / 1.5 + 0.12 * (mott - 0.5)) *
          ((h >>> 8) % 97 === 0 ? 1.25 : 1) *
          (seam ? 0.8 : 1);
      if (m === M.AIR) {
        // The cave's back wall: the same rock, set back and in shadow.
        c = [0, 1, 2].map(
          (k) => rock[k] * 0.42 * tex + [0.11, 0.1, 0.18][k] * 0.25,
        );
        const l = lights(Ls[i]);
        light = l.map((v, k) => v + 0.55 * amb[k]);
      } else {
        c =
          m === M.ROCK
            ? rock.map((v) => v * tex)
            : m === M.LEAF
              ? LEAF[biome % 2]
              : m === M.CAP
                ? CAP[biome % 2]
                : m === M.VINE && st & GLOW
                  ? hex("#7ff5e6")
                  : (SOLID_COLOUR[m] ?? rock);
        // Cut-away light on the rock body, fading with depth, plus light from open space beside it.
        const cut = 0.6 - 0.24 * Math.min(1, Math.max(0, (y - 400) / 900));
        let near = 0,
          edge = 0;
        for (const j of [i - 1, i + 1, i - W, i + W])
          if (
            j >= 0 &&
            j < W * H &&
            open(cells[j]) &&
            !(j < W * H && y < surface[x])
          ) {
            near = Math.max(near, Ls[j], Lc[j], Lv[j], Lw[j]);
            edge = Math.max(edge, j === i - W ? 1 : 0.6);
          }
        // Faces that meet open space catch more light; floors (open above) most.
        const l = lights(near * 0.85);
        light = l.map((v, k) => v + cut * amb[k] * (1 + 0.35 * edge));
        if (st & GLOW) light = [1.25, 1.25, 1.25];
      }
    }
    for (let k = 0; k < 3; k++)
      rgb[i * 3 + k] = Math.max(
        0,
        Math.min(255, Math.round(c[k] * light[k] * 255)),
      );
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
const pano = stitch(seed, -1, 4);
const img = render(pano);
png(`${out}/panorama.png`, img.W, img.H, img.rgb);
const half = shrink(img, 2);
png(`${out}/panorama-half.png`, half.W, half.H, half.rgb);
const names = [-1, 0, 1, 2].map((r) => BIOMES[regionBiome(seed, r)].name);
console.log(`seed ${seed}: regions -1..2 = ${names.join(" | ")}`);
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
  const w = stitch(sd, 0, 2);
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
