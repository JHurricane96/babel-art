// Vista's rocks: small 3D shapes drawn as pixel art.
//
// Each stone is an ellipsoid cut by a handful of planes (a block with flat faces), seen from a little
// above. Every face is lit by the sun from the upper left and given one of six tones, so the faces
// read as crisp planes of light and shadow. Grain and cracks are fixed to the stone itself (found in
// its own space), so they neither swim nor shuffle as the rock grows. Every rock sits partly in the
// ground: cut flat at the ground, with a dark seam where it meets the soil.
//
// Families (the kinds of rock a place is strewn with): stones, boulders (round to angular), slabs,
// rubble (a heap of stones), erratics (a lone big boulder) and outcrops (a crag of blocks). Each
// drawing's seed makes its own shape.
//
// Drawn in material and shade (the renderer colours rocks by the bedrock under them). The green
// channel of every pixel says how open to the sky that bit of stone is (its face turned up, and
// high on the rock): the renderer lays moss, lichen or snow there.
export type RockKind = "stone" | "boulder" | "slab" | "rubble" | "erratic" | "outcrop";
export const ROCK_KINDS: { kind: RockKind; n: number; worldH: number }[] = [
  { kind: "stone", n: 6, worldH: 0.4 },
  { kind: "boulder", n: 8, worldH: 1.3 },
  { kind: "slab", n: 4, worldH: 0.55 },
  { kind: "rubble", n: 4, worldH: 0.65 },
  { kind: "erratic", n: 3, worldH: 2.4 },
  { kind: "outcrop", n: 3, worldH: 3.6 },
];

interface Stone {
  /** Centre, and the turn about the vertical (its local axes). */
  c: [number, number, number];
  yaw: number;
  /** Semi-axes of the ellipsoid, and the cutting planes (local: n . p <= d). */
  ax: [number, number, number];
  planes: [number, number, number, number][];
  /** Cracks: planes through the stone (local), and how far along them they run. */
  cracks: [number, number, number, number, number][];
}

function mulberry(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash3 = (x: number, y: number, z: number, s: number) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1442695041) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth 3D value noise, 0..1. */
function noise3(x: number, y: number, z: number, s: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z),
    fx = x - ix,
    fy = y - iy,
    fz = z - iz,
    u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy),
    w = fz * fz * (3 - 2 * fz),
    c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, s),
    l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function unit(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** One stone: an ellipsoid of semi-axes (a, b, c) centred at (x, cy, z), cut by `cuts` planes, each
 * as deep as `depth` (a fraction of the ellipsoid's reach that way: smaller is more angular). */
function stone(R: () => number, x: number, cy: number, z: number, a: number, b: number, c: number, cuts: number, depth: [number, number], flatTop = false): Stone {
  const planes: Stone["planes"] = [];
  for (let k = 0; k < cuts; k++) {
    // Normals spread round the stone, more of them sideways and up than down (it rests on its base).
    const th = (k / cuts) * Math.PI * 2 + (R() - 0.5) * 1.2,
      el = (R() - 0.3) * 1.6,
      n = unit(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el)),
      reach = Math.hypot(a * n[0], b * n[1], c * n[2]);
    planes.push([n[0], n[1], n[2], reach * (depth[0] + (depth[1] - depth[0]) * R())]);
  }
  if (flatTop) {
    const n = unit((R() - 0.5) * 0.3, 1, (R() - 0.5) * 0.3);
    planes.push([n[0], n[1], n[2], b * (0.55 + 0.25 * R())]);
  }
  const cracks: Stone["cracks"] = [];
  for (let k = R() < 0.6 ? 1 : 2; k > 0; k--) {
    const n = unit(R() - 0.5, (R() - 0.5) * 0.6, R() - 0.5);
    cracks.push([n[0], n[1], n[2], (R() - 0.5) * 0.5 * Math.min(a, c), 0.3 + 0.5 * R()]);
  }
  return { c: [x, cy, z], yaw: R() * Math.PI * 2, ax: [a, b, c], planes, cracks };
}

/** The stones of one drawing (in units where the rock stands about 1 tall). */
function stonesOf(kind: RockKind, seed: number): Stone[] {
  const R = mulberry(seed * 9781 + 17);
  const one = (a: number, b: number, c: number, cuts: number, depth: [number, number], bury: number, flatTop = false) => [stone(R, 0, b * (1 - 2 * bury), 0, a, b, c, cuts, depth, flatTop)];
  switch (kind) {
    case "stone":
      return one(0.5 + 0.35 * R(), 0.5, 0.45 + 0.3 * R(), 5 + Math.floor(R() * 4), [0.55, 0.8], 0.25 + 0.15 * R());
    case "boulder": {
      // From round and worn (few, shallow cuts) to blocky (many, deep).
      const angular = R();
      return one(0.55 + 0.35 * R(), 0.55, 0.5 + 0.3 * R(), 3 + Math.floor(angular * 7), angular < 0.4 ? [0.8, 0.95] : [0.55, 0.78], 0.15 + 0.2 * R());
    }
    case "slab":
      return one(1.2 + 0.6 * R(), 0.5, 0.7 + 0.4 * R(), 4 + Math.floor(R() * 3), [0.6, 0.85], 0.35 + 0.1 * R(), true);
    case "erratic":
      return one(0.5 + 0.3 * R(), 0.55, 0.45 + 0.25 * R(), 6 + Math.floor(R() * 4), [0.6, 0.85], 0.1 + 0.1 * R());
    case "rubble": {
      // A heap: a few stones on the ground and one or two on top of them.
      const out: Stone[] = [],
        n = 4 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) {
        const top = k >= n - 1 - Math.floor(R() * 2),
          r = 0.18 + 0.14 * R(),
          ang = R() * Math.PI * 2,
          d = top ? 0.1 * R() : 0.25 + 0.3 * R();
        out.push(stone(R, Math.cos(ang) * d, top ? r + 0.28 : r * 0.7, Math.sin(ang) * d * 0.6, r * (1 + 0.4 * R()), r, r * (0.8 + 0.4 * R()), 5 + Math.floor(R() * 3), [0.55, 0.8]));
      }
      return out;
    }
    case "outcrop": {
      // A crag: two or three tall blocks leaning together, steep-faced.
      const out: Stone[] = [],
        n = 2 + Math.floor(R() * 2);
      for (let k = 0; k < n; k++) {
        const h = 0.35 + 0.2 * R() - k * 0.06,
          x = (k - (n - 1) / 2) * (0.38 + 0.15 * R());
        out.push(stone(R, x, h * 0.85, (R() - 0.5) * 0.3, 0.25 + 0.12 * R(), h, 0.25 + 0.1 * R(), 6 + Math.floor(R() * 3), [0.5, 0.72], true));
      }
      return out;
    }
  }
}

/** The view: from a little above (ELEV), sunlight from the upper left and toward the viewer. */
const ELEV = (14 * Math.PI) / 180,
  SE = Math.sin(ELEV),
  CE = Math.cos(ELEV),
  SUN = unit(-0.55, 0.7, 0.45);

export interface RockImg {
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** RGBA: in index form, red the material and shade, green how open to the sky. */
  data: Uint8ClampedArray;
}

/**
 * A rock drawn `H` pixels tall. `index`: in material (ROCK) and shade, the green channel how open to
 * the sky; otherwise coloured with `ramp` (six RGB triples, 0..1).
 */
export function rockImg(kind: RockKind, seed: number, H: number, rockMaterial: number, index: boolean, ramp: number[][]): RockImg {
  const stones = stonesOf(kind, seed);
  // The rock's height above the ground, in its own units (found from the stones' tops).
  let top = 0,
    reach = 0;
  for (const s of stones) {
    top = Math.max(top, s.c[1] + s.ax[1]);
    reach = Math.max(reach, Math.abs(s.c[0]) + Math.max(s.ax[0], s.ax[2]) * 1.2);
  }
  const scale = Math.max(1, H) / top,
    W = Math.ceil(reach * 2 * scale) + 4,
    Hh = Math.ceil(Math.max(1, H) * 1.25) + 4,
    // Screen: x right; v up from the foot. A pixel's centre is (u, v) in rock units.
    cx = W / 2,
    foot = Hh - 3,
    depth = new Float32Array(W * Hh).fill(Infinity),
    tone = new Uint8Array(W * Hh),
    open = new Uint8Array(W * Hh),
    yAt = new Float32Array(W * Hh);
  // Each stone's turn, once.
  const rot = stones.map((s) => [Math.cos(s.yaw), Math.sin(s.yaw)]),
    // Where each stone falls on the screen (its centre, and a circle round it), to skip the rest.
    onScreen = stones.map((s) => [s.c[0], s.c[1] * CE - s.c[2] * SE, Math.max(...s.ax) ** 2 * 1.02]);
  for (let py = 0; py < Hh; py++)
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5 - cx) / scale,
        v = (foot - py - 0.5) / scale,
        // The ray: from far in front, looking forward and a little down.
        B = 10,
        O = [u, v * CE + B * SE, -v * SE + B * CE],
        D = [0, -SE, -CE],
        // The ground (y >= 0) is reached at:
        tG = O[1] / SE;
      let best = Infinity,
        bn: [number, number, number] = [0, 1, 0],
        bp: [number, number, number] = [0, 0, 0],
        bs = 0;
      stones.forEach((s, si) => {
        const [du, dv, r2] = onScreen[si];
        if ((u - du) ** 2 + (v - dv) ** 2 > r2) return;
        const [co, sn] = rot[si],
          // Into the stone's own axes (turned about the vertical).
          rx = O[0] - s.c[0],
          ry = O[1] - s.c[1],
          rz = O[2] - s.c[2],
          o = [co * rx + sn * rz, ry, -sn * rx + co * rz],
          d = [co * D[0] + sn * D[2], D[1], -sn * D[0] + co * D[2]],
          [a, b, c] = s.ax,
          A = (d[0] / a) ** 2 + (d[1] / b) ** 2 + (d[2] / c) ** 2,
          Bq = 2 * ((o[0] * d[0]) / (a * a) + (o[1] * d[1]) / (b * b) + (o[2] * d[2]) / (c * c)),
          C = (o[0] / a) ** 2 + (o[1] / b) ** 2 + (o[2] / c) ** 2 - 1,
          disc = Bq * Bq - 4 * A * C;
        if (disc < 0) return;
        const sq = Math.sqrt(disc);
        let t0 = (-Bq - sq) / (2 * A),
          t1 = (-Bq + sq) / (2 * A),
          n: number[] | null = null;
        for (const [nx, ny, nz, dd] of s.planes) {
          const nd = nx * d[0] + ny * d[1] + nz * d[2],
            no = nx * o[0] + ny * o[1] + nz * o[2];
          if (Math.abs(nd) < 1e-9) {
            if (no > dd) return;
            continue;
          }
          const t = (dd - no) / nd;
          if (nd < 0) {
            if (t > t0) {
              t0 = t;
              n = [nx, ny, nz];
            }
          } else if (t < t1) t1 = t;
        }
        if (t0 >= t1 || t0 >= tG || t0 >= best) return;
        best = t0;
        const p = [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0];
        if (!n) n = [p[0] / (a * a), p[1] / (b * b), p[2] / (c * c)];
        const ln = unit(n[0], n[1], n[2]);
        // Back to the world's axes.
        bn = [co * ln[0] - sn * ln[2], ln[1], sn * ln[0] + co * ln[2]];
        bp = [p[0], p[1], p[2]];
        bs = si;
      });
      if (best === Infinity) continue;
      const i = py * W + px,
        s = stones[bs],
        wy = O[1] + D[1] * best,
        lam = Math.max(0, bn[0] * SUN[0] + bn[1] * SUN[1] + bn[2] * SUN[2]),
        // Grain fixed to the stone: mottling a shade lighter or darker, and fine speckle.
        g = noise3(bp[0] * 16, bp[1] * 16, bp[2] * 16, seed + bs * 13),
        sp = hash3(Math.floor(bp[0] * 60), Math.floor(bp[1] * 60), Math.floor(bp[2] * 60), seed + 5),
        grain = (g > 0.8 ? 0.55 : g < 0.18 ? -0.55 : 0) + (sp > 0.94 ? 0.6 : sp < 0.05 ? -0.6 : 0);
      let t = Math.round(1.3 + lam * 4.3 + grain);
      // Cracks: thin dark lines where a crack's plane meets the surface, over part of the stone.
      for (const [nx, ny, nz, dd, len] of s.cracks) {
        const f = nx * bp[0] + ny * bp[1] + nz * bp[2] - dd,
          along = Math.abs(-nz * bp[0] + nx * bp[2]) / Math.max(s.ax[0], s.ax[2]);
        if (Math.abs(f) < 0.7 / scale + 0.004 && along < len) t -= 2;
      }
      // The seam with the ground.
      if (wy < 1.2 / scale + 0.01) t = 1;
      tone[i] = Math.max(1, Math.min(6, t));
      depth[i] = best;
      yAt[i] = wy;
      // Open to the sky: faces turned up, and high on the rock.
      open[i] = Math.round(255 * Math.max(0, Math.min(1, bn[1] * 0.85 + (wy / top) * 0.35 - 0.1)));
    }
  // Outlines: a stone's edge against the sky (or a nearer stone in front) one tone darker, below and
  // on its shadowed (right) side.
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < Hh && tone[y * W + x] > 0;
  for (let py = 0; py < Hh; py++)
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (!tone[i]) continue;
      const edge = !has(px + 1, py) || !has(px, py + 1) || (has(px + 1, py) && depth[i + 1] < depth[i] - 2 / scale);
      if (edge && yAt[i] > 0.02) tone[i] = Math.max(1, tone[i] - 1);
    }
  // Crop to what was drawn; the foot at the bottom middle.
  let x0 = W,
    y0 = Hh,
    x1 = -1,
    y1 = -1;
  for (let py = 0; py < Hh; py++)
    for (let px = 0; px < W; px++)
      if (tone[py * W + px]) {
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
  if (x1 < 0) return { w: 1, h: 1, ax: 0, ay: 1, data: new Uint8ClampedArray(4) };
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1,
    data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y + y0) * W + x + x0,
        o = (y * w + x) * 4;
      if (!tone[i]) continue;
      if (index) {
        data[o] = rockMaterial * 8 + tone[i];
        data[o + 1] = open[i];
      } else {
        const c = ramp[tone[i] - 1];
        data[o] = c[0] * 255;
        data[o + 1] = c[1] * 255;
        data[o + 2] = c[2] * 255;
      }
      data[o + 3] = 255;
    }
  return { w, h, ax: Math.round(cx) - x0, ay: h, data };
}
