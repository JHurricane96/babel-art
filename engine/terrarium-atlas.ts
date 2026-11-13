import { rng } from "./types";
export const TILE_W = 32,
  TILE_H = 48,
  ATLAS_COLS = 32;
export const PLANT_BASE = 480,
  STRUCTURE_BASE = 800,
  TERRAIN_BASE = 836,
  DECOR_BASE = 932,
  TILE_COUNT = 980;
export const WORLD_PALETTES = [
  [
    "#102c32",
    "#224943",
    "#386052",
    "#59845d",
    "#9aab64",
    "#d9cf8a",
    "#f4dfac",
    "#222a36",
    "#67594a",
    "#9d7852",
    "#ce9961",
    "#97d5c3",
  ],
  [
    "#201d35",
    "#373253",
    "#51446a",
    "#786180",
    "#9b7892",
    "#dfb29e",
    "#f3dfc0",
    "#232b3f",
    "#465570",
    "#7595a1",
    "#95ced0",
    "#d5f4c6",
  ],
  [
    "#192c3b",
    "#304552",
    "#4c6670",
    "#759196",
    "#aab39a",
    "#ead1a0",
    "#ffdf9a",
    "#302d39",
    "#704e49",
    "#a9684e",
    "#d89763",
    "#8fc9bc",
  ],
  [
    "#122e42",
    "#244c60",
    "#3a7181",
    "#69a19e",
    "#a1c5a7",
    "#e2dab2",
    "#fff0ba",
    "#262e48",
    "#435570",
    "#779299",
    "#a6c4b5",
    "#a5e6dc",
  ],
];
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
export function makeWorldAtlas(seed: number, accents: number[][]) {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * TILE_W;
  canvas.height = Math.ceil(TILE_COUNT / ATLAS_COLS) * TILE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  let ox = 0,
    oy = 0;
  const tile = (id: number) => {
    ox = (id % ATLAS_COLS) * 32;
    oy = Math.floor(id / ATLAS_COLS) * 48;
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(
      ox + Math.round(x),
      oy + Math.round(y),
      Math.round(w),
      Math.round(h),
    );
  };
  const line = (x: number, y: number, x1: number, y1: number, c: string) => {
    x = Math.round(x);
    y = Math.round(y);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x),
      sx = x < x1 ? 1 : -1,
      dy = -Math.abs(y1 - y),
      sy = y < y1 ? 1 : -1;
    let e = dx + dy;
    for (let k = 0; k < 120; k++) {
      rect(x, y, 1, 1, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) {
        e += dy;
        x += sx;
      }
      if (e2 <= dx) {
        e += dx;
        y += sy;
      }
    }
  };
  const oval = (x: number, y: number, rx: number, ry: number, c: string) => {
    for (let yy = -ry; yy <= ry; yy++) {
      const width = Math.floor(
        rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))),
      );
      rect(x - width, y + yy, width * 2 + 1, 1, c);
    }
  };
  const palettes = WORLD_PALETTES.map((p, biome) =>
    p.map((hex, i) => {
      const c = rgb(hex),
        a = accents[i === 6 ? 2 : 1];
      if (i < 4 || i === 7) return hex;
      return (
        "#" +
        c
          .map((v, j) =>
            Math.round(v * 0.84 + a[j] * 255 * 0.16)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
      );
    }),
  );
  for (let archetype = 0; archetype < 12; archetype++)
    for (let state = 0; state < 10; state++)
      for (let frame = 0; frame < 4; frame++) {
        tile(archetype * 40 + state * 4 + frame);
        const role = Math.floor(archetype / 2),
          variant = archetype % 2,
          p = palettes[(archetype + seed) % 4],
          out = p[0],
          light = p[6],
          cloth = p[3],
          metal = p[10];
        const walk = [0, 2, 0, -2][frame],
          working = state === 4,
          rest = state === 9;
        oval(16, 45, 10, 2, "#0c1b2844");
        if (role <= 2) {
          const bob = state === 1 || state === 7 ? frame % 2 : 0,
            y = rest ? 4 : 0;
          rect(11 - walk / 2, 37 + y, 4, 7, out);
          rect(19 + walk / 2, 37 + y, 4, 7, out);
          rect(10 - walk / 2, 43, 6, 2, p[8]);
          rect(18 + walk / 2, 43, 6, 2, p[8]);
          rect(10, 23 + bob + y, 14, 16, out);
          rect(12, 24 + bob + y, 10, 13, cloth);
          rect(12, 26 + bob + y, 3, 11, p[4]);
          rect(16, 34 + bob + y, 7, 2, p[8]);
          rect(17, 34 + bob + y, 2, 2, light);
          rect(8, 25 + bob + y, 5, 12, out);
          rect(8, 26 + bob + y, 3, 9, p[9]);
          rect(7, 26 + bob + y, 1, 6, metal);
          rect(12, 13 + bob + y, 11, 12, out);
          rect(14, 15 + bob + y, 8, 8, p[5]);
          rect(20, 18 + bob + y, 4, 3, p[5]);
          rect(20, 17 + bob + y, 1, 2, out);
          rect(
            12,
            13 + bob + y,
            11,
            3,
            role === 0 ? p[8] : role === 1 ? p[4] : metal,
          );
          rect(
            10,
            15 + bob + y,
            15,
            2,
            role === 0 ? p[9] : role === 1 ? p[3] : p[11],
          );
          if (variant) {
            rect(15, 10 + bob + y, 6, 4, p[9]);
            rect(14, 10 + bob + y, 8, 1, metal);
          } else rect(13, 11 + bob + y, 8, 3, p[8]);
          if (role === 2) {
            rect(18, 17 + bob + y, 7, 3, p[7]);
            rect(19, 17 + bob + y, 3, 1, p[11]);
          }
          const handY = working ? 25 + walk * 2 : 33 + bob + y;
          line(23, 26 + bob + y, 26, handY, out);
          rect(24, handY, 3, 3, p[5]);
          if (role === 0) {
            rect(25, handY - 4, 4, 5, out);
            rect(26, handY - 3, 2, 3, p[6]);
          }
          if (role === 1) {
            rect(22, handY - 5, 8, 8, p[8]);
            rect(23, handY - 4, 6, 6, p[10]);
            line(23, handY - 4, 28, handY + 1, p[5]);
          }
          if (role === 2) {
            line(25, handY + 2, 28, handY - 7, p[9]);
            rect(24, handY - 9, 7, 4, p[2]);
            rect(24, handY - 9, 7, 1, p[11]);
          }
          rect(13, 26 + bob + y, 2, 2, light);
        } else if (role === 3) {
          const limb = state === 1 || state === 7 ? walk : 0;
          for (const x of [8, 20]) {
            rect(x - limb, 36, 3, 8, out);
            rect(x + limb + 3, 36, 3, 8, p[8]);
          }
          oval(15, 31, 11, 8, out);
          oval(15, 30, 9, 6, p[3]);
          rect(8, 26, 9, 2, p[4]);
          oval(23, 25, 5, 6, out);
          oval(24, 25, 4, 4, p[5]);
          rect(27, 25, 3, 3, p[8]);
          rect(25, 22, 1, 2, out);
          rect(20, 16, 3, 7, p[8]);
          rect(20, 16, 1, 5, light);
          if (variant) {
            line(24, 20, 26, 11, p[10]);
            line(26, 13, 29, 11, p[10]);
            line(25, 16, 22, 12, p[10]);
          } else {
            rect(22, 16, 2, 5, p[4]);
            rect(24, 17, 3, 3, p[4]);
          }
          line(5, 31, 2, 24, p[5]);
          rect(2, 22, 3, 4, p[4]);
          for (let i = 0; i < 4; i++)
            rect(8 + i * 4, 30 + (i % 2) * 3, 2, 2, p[8]);
        } else if (role === 4) {
          const wing = frame % 2 ? 5 : 8;
          oval(13, 27, 6, wing, p[11] + "aa");
          oval(21, 27, 6, wing, light + "aa");
          oval(17, 31, 6, 4, out);
          oval(17, 30, 4, 3, p[10]);
          rect(16, 27, 2, 7, light);
          rect(22, 29, 2, 2, out);
          line(22, 27, 25, 24, out);
          line(14, 33, 12, 36, p[9]);
        } else {
          const limb = state === 1 ? walk : 0;
          rect(8 - limb, 35, 3, 8, out);
          rect(22 + limb, 35, 3, 8, out);
          oval(15, 31, 12, 6, out);
          oval(15, 29, 10, 5, p[8]);
          oval(25, 26, 5, 6, out);
          oval(26, 25, 4, 4, p[9]);
          rect(27, 23, 2, 1, p[6]);
          rect(28, 28, 3, 2, out);
          line(5, 31, 1, 25, p[8]);
          for (let i = 0; i < 5; i++)
            rect(8 + i * 3, 23 - (i % 2) * 2, 2, 4, p[10]);
          if (variant) {
            rect(25, 17, 2, 5, p[3]);
            rect(28, 18, 2, 4, p[3]);
          }
        }
      }
  for (let biome = 0; biome < 4; biome++)
    for (let kind = 0; kind < 20; kind++)
      for (let stage = 0; stage < 4; stage++) {
        tile(PLANT_BASE + biome * 80 + kind * 4 + stage);
        const p = palettes[biome],
          random = rng(seed ^ Math.imul(kind + biome * 20, 997));
        if (kind < 5) {
          const height = 13 + kind * 3;
          line(16, 45, 15, 45 - height, p[3]);
          line(17, 45, 16, 45 - height, p[2]);
          for (let j = 0; j < 3; j++) {
            const y = 43 - j * 5;
            line(16, y, 8 + (j % 2) * 15, y - 4, p[3]);
            oval(9 + (j % 2) * 14, y - 4, 4, 2, p[4]);
          }
          if (stage > 0) {
            const y = 43 - height,
              petal = biome === 1 ? p[11] : kind % 2 ? p[5] : p[10];
            for (const [dx, dy] of [
              [-3, 0],
              [3, 0],
              [0, -3],
              [0, 3],
            ])
              oval(16 + dx, y + dy, 2 + Math.floor(stage / 2), 2, petal);
            rect(15, y - 1, 3, 3, p[6]);
          }
        } else if (kind < 10) {
          if (biome === 1 || kind === 8) {
            const size = 4 + stage * 2;
            rect(14, 31, 5, 15, p[5]);
            oval(16, 29, size + 3, 5, p[0]);
            oval(16, 27, size + 2, 4, p[3]);
            for (let j = 0; j < 5; j++)
              rect(
                10 + Math.floor(random() * 12),
                25 + Math.floor(random() * 4),
                2,
                1,
                p[11],
              );
            rect(16, 32, 1, 10, p[6]);
          } else {
            rect(14, 24, 4, 22, p[8]);
            rect(15, 27, 1, 17, p[10]);
            for (let j = 0; j < 3; j++) {
              const x = 8 + j * 7,
                y = 25 - (j % 2) * 7;
              oval(x, y, 7 + stage, 6 + stage, p[2]);
              oval(x - 1, y - 2, 6 + stage, 4 + stage, p[3]);
              for (let k = 0; k < 4; k++)
                rect(
                  x - 4 + Math.floor(random() * 9),
                  y - 3 + Math.floor(random() * 6),
                  2,
                  1,
                  p[4],
                );
              if (stage > 1) oval(x + 2, y + 4, 2, 2, p[10]);
            }
          }
        } else if (kind < 15) {
          const high = 4 + stage * 3;
          rect(8, 42, 20, 4, p[0]);
          for (let j = 0; j < 3; j++) {
            const x = 8 + j * 6,
              y = 40 - Math.floor(random() * high);
            rect(x, y, 7, 43 - y, p[8]);
            rect(x, y, 7, 2, p[10]);
            rect(x + 1, y + 2, 2, 3, p[9]);
          }
          if (kind % 2) line(9, 40, 24, 31, p[11]);
        } else {
          for (let j = 0; j < 3; j++) {
            const x = 8 + j * 7,
              y = 42 - (5 + stage * 3) - (j % 2) * 4;
            for (let k = 0; k < 8 + stage * 3; k++)
              rect(
                x - Math.floor(k * 0.25),
                y + k,
                1 + Math.floor(k * 0.5),
                1,
                p[j % 2 ? 11 : 3],
              );
            line(x, y, x, 42, p[6]);
          }
          rect(7, 44, 22, 3, p[2]);
        }
      }
  for (let kind = 0; kind < 12; kind++)
    for (let state = 0; state < 3; state++) {
      tile(STRUCTURE_BASE + kind * 3 + state);
      const biome = Math.floor(kind / 3),
        type = kind % 3,
        p = palettes[biome],
        on = state === 2;
      if (type === 0) {
        rect(4, 22, 25, 23, p[0]);
        rect(6, 24, 21, 20, p[8]);
        rect(5, 19, 24, 4, p[10]);
        for (let y = 26; y < 44; y += 5) {
          line(7, y, 26, y, p[9]);
          rect(10, y, 2, 2, p[2]);
        }
        rect(13, 31, 9, 14, p[0]);
        rect(15, 33, 5, 11, p[7]);
        rect(17, 35, 2, 5, on ? p[6] : p[3]);
        for (let x = 4; x < 29; x += 4) line(x, 18, 16, 8, p[3]);
        rect(15, 8, 3, 12, p[3]);
      } else if (type === 1) {
        rect(5, 12, 4, 34, p[8]);
        rect(24, 12, 4, 34, p[8]);
        rect(6, 12, 21, 3, p[10]);
        for (let y = 17; y < 42; y += 6) line(8, y, 25, y + 4, p[9]);
        rect(9, 39, 16, 5, p[3]);
        rect(11, 27, 12, 9, p[0]);
        rect(12, 28, 10, 7, on ? p[11] : p[2]);
        rect(16, 28, 2, 7, p[6]);
        for (let j = 0; j < 4; j++) rect(13 + j * 2, 9, 1, 3, p[6]);
      } else {
        rect(5, 42, 23, 4, p[2]);
        rect(9, 33, 15, 10, p[8]);
        rect(11, 15, 11, 20, p[0]);
        rect(13, 17, 7, 16, p[3]);
        rect(15, 19, 3, 12, on ? p[6] : p[10]);
        rect(9, 12, 15, 4, p[10]);
        rect(13, 7, 7, 5, p[9]);
        rect(16, 4, 1, 4, p[11]);
        for (let y = 19; y < 32; y += 4) rect(14, y, 5, 1, p[11]);
      }
      if (biome === 1) {
        ctx.clearRect(ox, oy, 32, 48);
        if (type === 0) {
          rect(6, 25, 22, 20, p[0]);
          rect(8, 26, 18, 18, p[8]);
          oval(16, 21, 15, 7, p[0]);
          oval(16, 19, 14, 6, p[3]);
          for (let j = 0; j < 7; j++)
            rect(5 + j * 3, 18 + (j % 3), 2, 1, p[11]);
          rect(14, 33, 6, 12, p[0]);
          rect(15, 34, 4, 10, on ? p[11] : p[2]);
          rect(9, 29, 4, 4, p[5]);
          rect(22, 29, 3, 4, p[5]);
        } else if (type === 1) {
          rect(4, 38, 25, 7, p[2]);
          rect(7, 24, 5, 16, p[8]);
          rect(23, 20, 5, 20, p[8]);
          for (let j = 0; j < 8; j++)
            rect(10 + j * 2, 35 - j * 3, 3, j * 3 + 5, p[j % 2 ? 3 : 11]);
          line(11, 35, 24, 17, p[6]);
          rect(4, 43, 25, 2, p[11]);
        } else {
          for (let j = 0; j < 5; j++) {
            const x = 4 + j * 5,
              h = 17 + (j % 3) * 7;
            rect(x, 43 - h, 4, h, p[j % 2 ? 2 : 3]);
            line(x, 43 - h, x + 2, 39, p[11]);
          }
          rect(2, 43, 29, 3, p[8]);
          rect(14, 23, 7, 15, on ? p[6] : p[4]);
        }
      } else if (biome === 2 && type === 0) {
        ctx.clearRect(ox, oy, 32, 48);
        rect(2, 23, 19, 23, p[0]);
        rect(4, 25, 15, 18, p[8]);
        rect(2, 20, 20, 4, p[9]);
        rect(5, 28, 4, 7, on ? p[6] : p[3]);
        rect(12, 28, 4, 7, on ? p[11] : p[3]);
        oval(23, 35, 8, 8, p[0]);
        oval(23, 35, 6, 6, p[10]);
        oval(23, 35, 4, 4, p[1]);
        for (let j = 0; j < 8; j++) {
          const angle = (j * Math.PI) / 4;
          line(
            23,
            35,
            23 + Math.cos(angle) * 7,
            35 + Math.sin(angle) * 7,
            p[9],
          );
        }
        rect(8, 12, 4, 10, p[2]);
        rect(8, 11, 4, 2, p[10]);
      } else if (biome === 3) {
        ctx.clearRect(ox, oy, 32, 48);
        if (type === 0) {
          rect(5, 27, 23, 15, p[0]);
          rect(7, 29, 19, 11, p[3]);
          for (let j = 0; j < 3; j++) rect(8 + j * 7, 38, 2, 9, p[8]);
          for (let y = 0; y < 9; y++)
            rect(3 + y, 18 + y, 28 - y * 2, 1, p[y % 2 ? 9 : 10]);
          rect(15, 29, 5, 12, on ? p[6] : p[2]);
          rect(13, 16, 7, 4, p[8]);
        } else if (type === 1) {
          rect(3, 40, 27, 4, p[8]);
          rect(6, 22, 4, 19, p[10]);
          rect(24, 22, 4, 19, p[10]);
          oval(17, 22, 13, 7, p[3]);
          rect(7, 21, 20, 3, p[4]);
          rect(11, 32, 13, 4, p[9]);
          rect(16, 26, 2, 8, p[6]);
        } else {
          rect(4, 43, 25, 3, p[2]);
          for (let j = 0; j < 3; j++) {
            rect(7 + j * 8, 18, 3, 26, p[9]);
            rect(6 + j * 8, 18, 5, 2, p[6]);
          }
          rect(4, 14, 25, 4, p[10]);
          rect(13, 25, 7, 10, on ? p[11] : p[3]);
          line(16, 22, 16, 40, p[5]);
        }
      }
      if (state === 0) {
        line(9, 24, 17, 29, p[0]);
        line(17, 29, 13, 36, p[0]);
        rect(20, 38, 4, 4, p[0]);
      }
    }
  for (let biome = 0; biome < 4; biome++)
    for (let variant = 0; variant < 24; variant++) {
      tile(TERRAIN_BASE + biome * 24 + variant);
      const p = palettes[biome],
        random = rng(seed ^ Math.imul(variant + biome * 24 + 1, 7717));
      rect(0, 0, 32, 48, p[variant < 6 ? 8 : 1]);
      for (let j = 0; j < 40; j++) {
        const x = Math.floor(random() * 32),
          y = Math.floor(random() * 48);
        rect(
          x,
          y,
          2 + Math.floor(random() * 5),
          1,
          p[variant < 6 ? (j % 3 === 0 ? 10 : 9) : j % 3 === 0 ? 3 : 2],
        );
      }
      for (let j = 0; j < 4; j++) {
        const x = Math.floor(random() * 32),
          y = Math.floor(random() * 40);
        line(x, y, x - 4, y + 7, p[0]);
        line(x - 4, y + 7, x + 1, y + 9, p[0]);
      }
      if (variant < 6) {
        rect(0, 0, 32, 3, p[3]);
        rect(0, 0, 32, 1, p[5]);
        for (let j = 0; j < 10; j++) {
          const x = Math.floor(random() * 32);
          rect(x, 2, 2, 3 + Math.floor(random() * 6), p[4]);
        }
      }
      if (biome === 2 && variant >= 12) {
        for (let y = 0; y < 48; y += 12) {
          line(0, y, 31, y, p[8]);
          for (let x = y % 24 ? 0 : 8; x < 32; x += 16)
            line(x, y, x, y + 11, p[8]);
        }
      }
    }
  for (let i = 0; i < 48; i++) {
    tile(DECOR_BASE + i);
    const p = palettes[Math.floor(i / 12)],
      type = i % 12;
    const random = rng(seed + i * 997);
    if (type < 4) {
      for (let j = 0; j < 5; j++) {
        const x = 7 + j * 4;
        line(16, 47, x, 27 + Math.floor(random() * 12), p[3]);
        oval(x, 29 + Math.floor(random() * 10), 3, 2, p[4]);
      }
    } else if (type < 8) {
      rect(9, 28, 15, 18, p[8]);
      rect(10, 29, 13, 15, p[10]);
      line(10, 29, 22, 42, p[5]);
      line(22, 29, 10, 42, p[9]);
      rect(14, 27, 5, 3, p[2]);
    } else {
      rect(14, 18, 3, 28, p[8]);
      rect(10, 15, 11, 3, p[10]);
      rect(9, 18, 13, 13, p[0]);
      rect(11, 20, 9, 9, p[6]);
      rect(15, 20, 1, 10, p[9]);
      rect(8, 31, 15, 2, p[10]);
    }
  }
  return canvas;
}
export function tileUV(id: number) {
  return [
    (id % ATLAS_COLS) / ATLAS_COLS,
    (Math.floor(id / ATLAS_COLS) * TILE_H) /
      (Math.ceil(TILE_COUNT / ATLAS_COLS) * TILE_H),
    TILE_W / (ATLAS_COLS * TILE_W),
    TILE_H / (Math.ceil(TILE_COUNT / ATLAS_COLS) * TILE_H),
  ];
}
