// CPU falling-sand simulation with Noita-style chunking: the grid is split into 64x64 chunks and
// each chunk keeps a dirty rectangle; a step only visits cells inside the rectangles marked by the
// previous step's changes. Integer-only and seeded, so a replay is bit-exact on any machine.
import { M } from "./world.js";

const CS = 64, SHIFT = 6, DISP = 4; // chunk size, log2, water lateral dispersion per step
const { EMPTY, ROCK, SAND, WATER, FIRE, SMOKE, WOOD, WATER_SRC, SAND_SRC, FIRE_SRC, SINK } = M;
const NONE = 1 << 30;

export class SandSim {
  constructor(world, { chunking = true, seed = 12345 } = {}) {
    const { w, h } = world;
    this.w = w; this.h = h;
    this.mat = world.mat.slice(); this.aux = world.aux.slice();
    this.stamp = new Uint8Array(w * h);
    this.cw = Math.ceil(w / CS); this.ch = Math.ceil(h / CS);
    this.cur = new Int32Array(this.cw * this.ch * 4);
    this.next = new Int32Array(this.cw * this.ch * 4);
    this.chunking = chunking;
    this.rs = seed >>> 0 || 1;
    this.stepNo = 0;
    this.stats = { activeChunks: 0, visited: 0, moves: 0 };
    this.wakeAll(this.next);
  }

  wakeAll(r) {
    const { cw, ch, w, h } = this;
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      const k = (cy * cw + cx) * 4;
      r[k] = cx * CS; r[k + 1] = cy * CS; r[k + 2] = Math.min(w - 1, cx * CS + CS - 1); r[k + 3] = Math.min(h - 1, cy * CS + CS - 1);
    }
  }

  checksum() {
    let hsh = 2166136261 >>> 0;
    const { mat, aux } = this;
    for (let i = 0; i < mat.length; i++) { hsh = Math.imul(hsh ^ mat[i], 16777619); hsh = Math.imul(hsh ^ aux[i], 16777619); }
    return (hsh >>> 0).toString(16);
  }

  step() {
    const t = this.cur; this.cur = this.next; this.next = t;
    const next = this.next, cur = this.cur;
    for (let k = 0; k < next.length; k += 4) { next[k] = NONE; next[k + 1] = NONE; next[k + 2] = -1; next[k + 3] = -1; }
    if (!this.chunking) this.wakeAll(cur);
    const { w, h, mat, aux, stamp, cw, ch } = this;
    const st = (this.stepNo % 255) + 1;
    this.stepNo++;
    const ltr = (this.stepNo & 1) === 0;
    let s = this.rs, visited = 0, activeChunks = 0, moves = 0;

    const wake = (x, y) => {
      const xa = x > 0 ? x - 1 : 0, xb = x < w - 1 ? x + 1 : w - 1;
      const ya = y > 0 ? y - 1 : 0, yb = y < h - 1 ? y + 1 : h - 1;
      const c0 = xa >> SHIFT, c1 = xb >> SHIFT, r0 = ya >> SHIFT, r1 = yb >> SHIFT;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = (r * cw + c) * 4;
        const bx0 = c << SHIFT, by0 = r << SHIFT;
        const ax = xa > bx0 ? xa : bx0, ay = ya > by0 ? ya : by0;
        const bx1 = bx0 + CS - 1, by1 = by0 + CS - 1;
        const bx = xb < bx1 ? xb : bx1, by = yb < by1 ? yb : by1;
        if (ax < next[k]) next[k] = ax;
        if (ay < next[k + 1]) next[k + 1] = ay;
        if (bx > next[k + 2]) next[k + 2] = bx;
        if (by > next[k + 3]) next[k + 3] = by;
      }
    };
    const swap = (i, j) => {
      const m = mat[i]; mat[i] = mat[j]; mat[j] = m;
      const a = aux[i]; aux[i] = aux[j]; aux[j] = a;
      stamp[i] = st; stamp[j] = st; moves++;
    };

    for (let cy = ch - 1; cy >= 0; cy--) {
      let ymin = NONE, ymax = -1;
      for (let cx = 0; cx < cw; cx++) {
        const k = (cy * cw + cx) * 4;
        if (cur[k] > cur[k + 2]) continue;
        activeChunks++;
        if (cur[k + 1] < ymin) ymin = cur[k + 1];
        if (cur[k + 3] > ymax) ymax = cur[k + 3];
      }
      for (let y = ymax; y >= ymin; y--) {
        const row = y * w;
        for (let c = 0; c < cw; c++) {
          const k = (cy * cw + (ltr ? c : cw - 1 - c)) * 4;
          const x0 = cur[k], x1 = cur[k + 2];
          if (x0 > x1 || y < cur[k + 1] || y > cur[k + 3]) continue;
          const n = x1 - x0;
          visited += n + 1;
          for (let xi = 0; xi <= n; xi++) {
            const x = ltr ? x0 + xi : x1 - xi;
            const i = row + x;
            const m = mat[i];
            if (m <= ROCK || m === WOOD || stamp[i] === st) continue;
            switch (m) {
              case SAND: {
                if (y >= h - 1) break;
                const b = i + w, mb = mat[b];
                if (mb === EMPTY || mb === WATER || mb === SMOKE || mb === FIRE) { swap(i, b); wake(x, y); wake(x, y + 1); break; }
                s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                const d = s & 1 ? 1 : -1;
                if (x + d >= 0 && x + d < w) { const mj = mat[b + d]; if (mj === EMPTY || mj === WATER || mj === SMOKE) { swap(i, b + d); wake(x, y); wake(x + d, y + 1); break; } }
                if (x - d >= 0 && x - d < w) { const mj = mat[b - d]; if (mj === EMPTY || mj === WATER || mj === SMOKE) { swap(i, b - d); wake(x, y); wake(x - d, y + 1); break; } }
                break;
              }
              case WATER: {
                if (y < h - 1) {
                  const b = i + w, mb = mat[b];
                  if (mb === EMPTY || mb === SMOKE) { swap(i, b); wake(x, y); wake(x, y + 1); break; }
                  s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                  const d = s & 1 ? 1 : -1;
                  if (x + d >= 0 && x + d < w) { const mj = mat[b + d]; if (mj === EMPTY || mj === SMOKE) { swap(i, b + d); wake(x, y); wake(x + d, y + 1); break; } }
                  if (x - d >= 0 && x - d < w) { const mj = mat[b - d]; if (mj === EMPTY || mj === SMOKE) { swap(i, b - d); wake(x, y); wake(x - d, y + 1); break; } }
                }
                s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                let d = s & 1 ? 1 : -1, moved = false;
                for (let tryDir = 0; tryDir < 2 && !moved; tryDir++, d = -d) {
                  let k2 = 0;
                  while (k2 < DISP) { const xx = x + d * (k2 + 1); if (xx < 0 || xx >= w || mat[i + d * (k2 + 1)] !== EMPTY) break; k2++; }
                  if (k2 > 0) { swap(i, i + d * k2); wake(x, y); wake(x + d * k2, y); moved = true; }
                }
                break;
              }
              case SMOKE: {
                const a = aux[i] - 1;
                if (a <= 0) { mat[i] = EMPTY; aux[i] = 0; wake(x, y); break; }
                aux[i] = a;
                wake(x, y);
                s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                if ((s & 3) === 0 || y === 0) break;
                const u = i - w;
                if (mat[u] === EMPTY) { swap(i, u); wake(x, y - 1); break; }
                const d = s & 4 ? 1 : -1;
                if (x + d >= 0 && x + d < w && mat[u + d] === EMPTY) { swap(i, u + d); wake(x + d, y - 1); break; }
                if (x - d >= 0 && x - d < w && mat[i - d] === EMPTY) { swap(i, i - d); wake(x - d, y); break; }
                break;
              }
              case FIRE: {
                const up = y > 0 ? mat[i - w] : ROCK, dn = y < h - 1 ? mat[i + w] : ROCK;
                const lf = x > 0 ? mat[i - 1] : ROCK, rt = x < w - 1 ? mat[i + 1] : ROCK;
                if (up === WATER || dn === WATER || lf === WATER || rt === WATER) { mat[i] = SMOKE; aux[i] = 30; wake(x, y); break; }
                s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                const a = aux[i] - 1;
                if (a <= 0) { mat[i] = SMOKE; aux[i] = 40 + (s % 40); stamp[i] = st; wake(x, y); break; }
                aux[i] = a;
                wake(x, y);
                if (up === WOOD && (s & 7) === 0) { mat[i - w] = FIRE; aux[i - w] = 40 + ((s >>> 3) % 40); stamp[i - w] = st; wake(x, y - 1); }
                if (dn === WOOD && (s & 56) === 0) { mat[i + w] = FIRE; aux[i + w] = 40 + ((s >>> 6) % 40); stamp[i + w] = st; wake(x, y + 1); }
                if (lf === WOOD && (s & 448) === 0) { mat[i - 1] = FIRE; aux[i - 1] = 40 + ((s >>> 9) % 40); stamp[i - 1] = st; wake(x - 1, y); }
                if (rt === WOOD && (s & 3584) === 0) { mat[i + 1] = FIRE; aux[i + 1] = 40 + ((s >>> 12) % 40); stamp[i + 1] = st; wake(x + 1, y); }
                if (up === EMPTY && (s & 4096)) { swap(i, i - w); wake(x, y - 1); }
                break;
              }
              case WATER_SRC: {
                wake(x, y);
                if (y < h - 1 && mat[i + w] === EMPTY) { mat[i + w] = WATER; stamp[i + w] = st; wake(x, y + 1); }
                break;
              }
              case SAND_SRC: {
                wake(x, y);
                s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                if ((s & 1) && y < h - 1 && mat[i + w] === EMPTY) { mat[i + w] = SAND; stamp[i + w] = st; wake(x, y + 1); }
                break;
              }
              case FIRE_SRC: {
                wake(x, y);
                s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
                if ((s & 3) !== 0 && y > 0 && mat[i - w] === EMPTY) { mat[i - w] = FIRE; aux[i - w] = 8 + ((s >>> 2) & 15); stamp[i - w] = st; wake(x, y - 1); }
                if (x < w - 1 && mat[i + 1] === WOOD && (s & 0xf0) === 0) { mat[i + 1] = FIRE; aux[i + 1] = 60; stamp[i + 1] = st; wake(x + 1, y); }
                break;
              }
              case SINK: {
                const cand = y > 0 ? i - w : -1;
                let j = -1;
                if (cand >= 0) { const mc = mat[cand]; if (mc === SAND || mc === WATER || mc === SMOKE) j = cand; }
                if (j < 0 && x > 0) { const mc = mat[i - 1]; if (mc === SAND || mc === WATER) j = i - 1; }
                if (j < 0 && x < w - 1) { const mc = mat[i + 1]; if (mc === SAND || mc === WATER) j = i + 1; }
                if (j >= 0) { mat[j] = EMPTY; aux[j] = 0; stamp[j] = st; wake(j % w, (j / w) | 0); }
                break;
              }
            }
          }
        }
      }
    }
    this.rs = s;
    this.stats.activeChunks = activeChunks; this.stats.visited = visited; this.stats.moves = moves;
  }
}
