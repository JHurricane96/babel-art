// CPU light flood at art resolution. Four light channels (sky, warm, cyan, violet) spread through
// open space with a per-pixel linear falloff (8-neighbour chamfer distance, as in the mock-up's flood),
// are blocked by opaque cells, reach a few pixels into rock faces, and are then stepped into 5 levels
// with a 4x4 Bayer dither. Integer-only (light 1.0 = UNIT), so results replay exactly.
import { M, CH } from "./world.js";

export const UNIT_SHIFT = 14, UNIT = 1 << UNIT_SHIFT, LMAX = Math.round(1.6 * UNIT), LEVELS = 5; // light 1.0 = UNIT
export const AIR = 0, WATER = 1, OPAQUE = 2;
const K = 480 / 531; // art pixels per millimetre on the default wall (mock-up scale)
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const BAYER_U = Int32Array.from(BAYER4, (b) => Math.round(((b + 0.5) / 16) * UNIT));

// Falloff distances from the mock-up (millimetres on the wall): sky 120 (420 in water), warm 60,
// fungus 42, crystal 30. Light reaches ~4 px into rock faces.
export function lightParams() {
  const mm = [[120, 420], [60, 60], [42, 42], [30, 30]];
  const d1 = new Int32Array(8), d2 = new Int32Array(8); // index medium*4 + channel
  for (let c = 0; c < 4; c++) for (let m = 0; m < 2; m++) {
    const d = UNIT / (mm[c][m] * K);
    d1[m * 4 + c] = Math.round(d); d2[m * 4 + c] = Math.round(d * Math.SQRT2);
  }
  return { d1, d2, rock1: Math.round(0.25 * UNIT), rock2: Math.round(0.25 * UNIT * Math.SQRT2), skyPeak: Math.round(1.15 * UNIT) };
}

export function mediumOf(m) {
  if (m === M.EMPTY || m === M.SMOKE || m === M.FIRE) return AIR;
  if (m === M.WATER) return WATER;
  return OPAQUE;
}

// Light sources inside the view: placed lights, plus burning cells (warm), one source per 16x16 tile
// that holds fire (at its first burning cell), so a blaze is a handful of lights, not hundreds.
export function collectSources(world, mat) {
  const { view, w } = world, out = [];
  for (const l of world.lights) {
    const x = l.x - view.x0, y = l.y - view.y0;
    if (x >= 0 && y >= 0 && x < view.w && y < view.h) out.push({ x, y, ch: l.ch, a: l.a });
  }
  const tiles = new Set();
  for (let y = 0; y < view.h; y++) for (let x = 0; x < view.w; x++) {
    const m = mat[(y + view.y0) * w + x + view.x0];
    if (m !== M.FIRE && m !== M.FIRE_SRC) continue;
    const t = (y >> 4) * 1024 + (x >> 4);
    if (!tiles.has(t)) { tiles.add(t); out.push({ x, y, ch: CH.WARM, a: 0.7 }); }
  }
  return out;
}

export class LightCPU {
  constructor(W, H) {
    this.W = W; this.H = H; this.W2 = W + 2; this.H2 = H + 2;
    const n = this.W2 * this.H2;
    this.med = new Uint8Array(n).fill(OPAQUE);
    this.L = [0, 1, 2, 3].map(() => new Uint16Array(n));      // static field (sky + placed lights)
    this.scratch = new Uint16Array(n);
    this.out = new Uint8Array(W * H * 4);                      // stepped levels 0..8 per channel
    this.p = lightParams();
    this.lastIters = 0;
  }

  // Medium (padded by one opaque border) from the world material grid, for the view window.
  setMedium(world, mat) {
    const { W, H, W2, med } = this, { view, w } = world;
    for (let y = 0; y < H; y++) {
      const src = (y + view.y0) * w + view.x0, dst = (y + 1) * W2 + 1;
      for (let x = 0; x < W; x++) med[dst + x] = mediumOf(mat[src + x]);
    }
    // Opaque cells within 4 cells of open space: the only ones light can reach, in raster order.
    const near = new Uint8Array(med.length);
    for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) {
      if (med[y * W2 + x] === OPAQUE) continue;
      for (let j = Math.max(1, y - 4); j <= Math.min(H, y + 4); j++) near.fill(1, j * W2 + Math.max(1, x - 4), j * W2 + Math.min(W, x + 4) + 1);
    }
    const list = [];
    for (let i = 0; i < med.length; i++) if (near[i] && med[i] === OPAQUE) list.push(i);
    this.faceList = Int32Array.from(list);
  }

  seed(c, sources) {
    const { W, H, W2, med, p } = this, L = this.L[c];
    L.fill(0);
    if (c === 0) {
      for (let x = 1; x <= W; x++) for (let y = 1; y <= H; y++) { const i = y * W2 + x; if (med[i] !== AIR) break; L[i] = p.skyPeak; }
    }
    for (const s of sources) if (s.ch === c) {
      const i = (s.y + 1) * W2 + s.x + 1, v = Math.round((0.6 + 0.8 * s.a) * UNIT);
      if (med[i] !== OPAQUE && v > L[i]) L[i] = v;
    }
  }

  // One forward and one backward chamfer sweep over open cells in the box (padded coords, inclusive).
  // Opaque cells hold 0 during the flood, so no neighbour medium test is needed. Returns cells changed.
  sweep(L, c, x0, y0, x1, y1) {
    const { W2, med, p } = this;
    const a1 = p.d1[c], w1 = p.d1[4 + c], a2 = p.d2[c], w2 = p.d2[4 + c];
    let changed = 0;
    for (let y = y0; y <= y1; y++) {
      let i = y * W2 + x0;
      for (let x = x0; x <= x1; x++, i++) {
        const m = med[i];
        if (m === OPAQUE) continue;
        const d1 = m === AIR ? a1 : w1, d2 = m === AIR ? a2 : w2;
        let v = L[i], t;
        t = L[i - 1] - d1; if (t > v) v = t;
        t = L[i - W2] - d1; if (t > v) v = t;
        t = L[i - W2 - 1] - d2; if (t > v) v = t;
        t = L[i - W2 + 1] - d2; if (t > v) v = t;
        if (v !== L[i]) { L[i] = v; changed++; }
      }
    }
    for (let y = y1; y >= y0; y--) {
      let i = y * W2 + x1;
      for (let x = x1; x >= x0; x--, i--) {
        const m = med[i];
        if (m === OPAQUE) continue;
        const d1 = m === AIR ? a1 : w1, d2 = m === AIR ? a2 : w2;
        let v = L[i], t;
        t = L[i + 1] - d1; if (t > v) v = t;
        t = L[i + W2] - d1; if (t > v) v = t;
        t = L[i + W2 + 1] - d2; if (t > v) v = t;
        t = L[i + W2 - 1] - d2; if (t > v) v = t;
        if (v !== L[i]) { L[i] = v; changed++; }
      }
    }
    return changed;
  }

  // Light entering rock faces over the whole view, using the precomputed list of rock cells near open
  // space: the same chamfer sweep pair as face(), visiting only those cells.
  faceAll(L) {
    const { W2, p } = this, r1 = p.rock1, r2 = p.rock2, list = this.faceList;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      let v = L[i], t;
      t = L[i - 1] - r1; if (t > v) v = t;
      t = L[i - W2] - r1; if (t > v) v = t;
      t = L[i - W2 - 1] - r2; if (t > v) v = t;
      t = L[i - W2 + 1] - r2; if (t > v) v = t;
      L[i] = v;
    }
    for (let k = list.length - 1; k >= 0; k--) {
      const i = list[k];
      let v = L[i], t;
      t = L[i + 1] - r1; if (t > v) v = t;
      t = L[i + W2] - r1; if (t > v) v = t;
      t = L[i + W2 + 1] - r2; if (t > v) v = t;
      t = L[i + W2 - 1] - r2; if (t > v) v = t;
      L[i] = v;
    }
  }

  // Light entering rock faces: one chamfer sweep pair over opaque cells only, with a steep falloff.
  face(L, x0, y0, x1, y1) {
    const { W2, med, p } = this, r1 = p.rock1, r2 = p.rock2;
    for (let y = y0; y <= y1; y++) for (let x = x0, i = y * W2 + x0; x <= x1; x++, i++) {
      if (med[i] !== OPAQUE) continue;
      let v = L[i], t;
      t = L[i - 1] - r1; if (t > v) v = t;
      t = L[i - W2] - r1; if (t > v) v = t;
      t = L[i - W2 - 1] - r2; if (t > v) v = t;
      t = L[i - W2 + 1] - r2; if (t > v) v = t;
      L[i] = v;
    }
    for (let y = y1; y >= y0; y--) for (let x = x1, i = y * W2 + x1; x >= x0; x--, i--) {
      if (med[i] !== OPAQUE) continue;
      let v = L[i], t;
      t = L[i + 1] - r1; if (t > v) v = t;
      t = L[i + W2] - r1; if (t > v) v = t;
      t = L[i + W2 + 1] - r2; if (t > v) v = t;
      t = L[i + W2 - 1] - r2; if (t > v) v = t;
      L[i] = v;
    }
  }

  // Full recompute of one channel: seed, `iters` sweep pairs (0 = until converged), rock faces.
  flood(c, sources, iters = 2) {
    const { W, H } = this, L = this.L[c];
    this.seed(c, sources);
    let n = 0;
    for (;;) {
      n++;
      const changed = this.sweep(L, c, 1, 1, W, H);
      if (iters ? n >= iters : changed === 0 || n >= 64) break;
    }
    this.lastIters = n;
    this.faceAll(L);
  }

  // Everything recomputed the way the artwork would: the sky channel flooded over the whole view,
  // each point light flooded in its own box (light cannot travel further than its box), then stepped.
  fullUpdate(sources, iters = 2) {
    this.flood(0, sources, iters);
    for (let c = 1; c < 4; c++) this.L[c].fill(0);
    for (const s of sources) if (s.ch > 0) this.updateLight(s, this.L[s.ch], iters);
    this.quantize();
  }

  // Step into LEVELS levels with the 4x4 Bayer matrix, in a view-space box (inclusive). Output is
  // RGBA bytes (one level 0..8 per channel), written as packed 32-bit words (little-endian).
  quantize(x0 = 0, y0 = 0, x1 = this.W - 1, y1 = this.H - 1) {
    const { W, W2 } = this, out32 = (this.out32 ||= new Uint32Array(this.out.buffer));
    const L0 = this.L[0], L1 = this.L[1], L2 = this.L[2], L3 = this.L[3];
    const lv = (a, b) => ((a < LMAX ? a : LMAX) * LEVELS + b) >> UNIT_SHIFT;
    for (let y = y0; y <= y1; y++) {
      const r = (y & 3) * 4, b0 = BAYER_U[r], b1 = BAYER_U[r + 1], b2 = BAYER_U[r + 2], b3 = BAYER_U[r + 3];
      let i = (y + 1) * W2 + x0 + 1, o = y * W + x0, x = x0;
      if ((x & 3) === 0) for (; x + 3 <= x1; x += 4, i += 4, o += 4) {
        out32[o] = lv(L0[i], b0) | lv(L1[i], b0) << 8 | lv(L2[i], b0) << 16 | lv(L3[i], b0) << 24;
        out32[o + 1] = lv(L0[i + 1], b1) | lv(L1[i + 1], b1) << 8 | lv(L2[i + 1], b1) << 16 | lv(L3[i + 1], b1) << 24;
        out32[o + 2] = lv(L0[i + 2], b2) | lv(L1[i + 2], b2) << 8 | lv(L2[i + 2], b2) << 16 | lv(L3[i + 2], b2) << 24;
        out32[o + 3] = lv(L0[i + 3], b3) | lv(L1[i + 3], b3) << 8 | lv(L2[i + 3], b3) << 16 | lv(L3[i + 3], b3) << 24;
      }
      for (; x <= x1; x++, i++, o++) {
        const b = BAYER_U[r + (x & 3)];
        out32[o] = lv(L0[i], b) | lv(L1[i], b) << 8 | lv(L2[i], b) << 16 | lv(L3[i], b) << 24;
      }
    }
  }

  // A single moving point light, recomputed in its own box (the region its light can reach),
  // max-combined into channel buffer `dst`, then the box is re-stepped. Returns the box area.
  updateLight(s, dst, iters = 2) {
    const { W, H, W2, med, p, scratch } = this;
    const v0 = Math.round((0.6 + 0.8 * s.a) * UNIT);
    const R = Math.ceil(v0 / Math.min(p.d1[s.ch], p.d1[4 + s.ch])) + 4;
    const x0 = Math.max(1, s.x + 1 - R), x1 = Math.min(W, s.x + 1 + R), y0 = Math.max(1, s.y + 1 - R), y1 = Math.min(H, s.y + 1 + R);
    const i0 = (s.y + 1) * W2 + s.x + 1;
    if (med[i0] !== OPAQUE) scratch[i0] = v0;
    for (let k = 0; k < iters; k++) this.sweep(scratch, s.ch, x0, y0, x1, y1);
    this.face(scratch, x0, y0, x1, y1);
    for (let y = y0; y <= y1; y++) for (let x = x0, i = y * W2 + x0; x <= x1; x++, i++) {
      if (scratch[i] > dst[i]) dst[i] = scratch[i];
      scratch[i] = 0;
    }
    return { x0: x0 - 1, y0: y0 - 1, x1: x1 - 1, y1: y1 - 1, area: (x1 - x0 + 1) * (y1 - y0 + 1) };
  }
}
