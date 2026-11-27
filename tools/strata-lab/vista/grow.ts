// Growing and shrinking a drawing by whole rows and columns (the scale lab's method, for Vista).
//
// From a drawing, an order in which to take its rows (and columns) out: spread evenly over the
// drawing (a van der Corput sequence, so any number taken out leaves it in proportion), each time
// the line least unlike its neighbour within one line of where the next is due. A height h keeps
// the rows not among the first (rows - h) taken out, so one pixel of growth puts back exactly one
// row and nothing is redrawn.
import type { Img } from "./sprites";

export interface Order {
  rows: number[];
  cols: number[];
}

function lineDiff(im: Img, a: number, b: number, rows: boolean) {
  let d = 0;
  const n = rows ? im.w : im.h;
  for (let k = 0; k < n; k++) {
    const i = rows ? (a * im.w + k) * 4 : (k * im.w + a) * 4,
      j = rows ? (b * im.w + k) * 4 : (k * im.w + b) * 4;
    const ai = im.data[i + 3] > 127,
      bj = im.data[j + 3] > 127;
    if (ai !== bj) d += 3;
    else if (ai) d += (Math.abs(im.data[i] - im.data[j]) + Math.abs(im.data[i + 1] - im.data[j + 1]) + Math.abs(im.data[i + 2] - im.data[j + 2])) / 255;
  }
  return d;
}
/** Van der Corput: 1/2, 1/4, 3/4, 1/8 ... any prefix spread evenly over [0, 1). */
export function vdc(k: number) {
  let v = 0,
    b = 0.5;
  while (k) {
    if (k & 1) v += b;
    k >>= 1;
    b *= 0.5;
  }
  return v;
}
function removal(im: Img, rows: boolean, keep: number) {
  const n = rows ? im.h : im.w,
    alive = Array.from({ length: n }, (_, i) => i),
    out: number[] = [];
  for (let k = 1; alive.length > 1; k++) {
    const target = vdc(k) * n;
    let jt = 0;
    while (jt < alive.length - 1 && alive[jt + 1] <= target) jt++;
    let best = -1,
      bc = 1e18;
    for (let j = Math.max(0, jt - 1); j <= Math.min(alive.length - 1, jt + 1); j++) {
      if (alive[j] === keep) continue;
      const up = j > 0 ? lineDiff(im, alive[j], alive[j - 1], rows) : 1e9,
        dn = j < alive.length - 1 ? lineDiff(im, alive[j], alive[j + 1], rows) : 1e9,
        c = Math.min(up, dn) + Math.abs(alive[j] - target) * 0.01;
      if (c < bc) {
        bc = c;
        best = j;
      }
    }
    if (best < 0) break;
    out.push(alive[best]);
    alive.splice(best, 1);
  }
  return out;
}
/** The order to take an image's lines out in, never taking out row keepRow or column keepCol. */
export function orderOf(im: Img, keepRow = im.h - 1, keepCol = Math.min(im.w - 1, Math.max(0, im.ax))): Order {
  return { rows: removal(im, true, keepRow), cols: removal(im, false, keepCol) };
}
/** The rows and columns kept when rowsKept rows (and colsKept columns) are left. */
export function kept(im: Img, o: Order, rowsKept: number, colsKept: number) {
  const goneR = new Set(o.rows.slice(0, Math.max(0, im.h - rowsKept))),
    goneC = new Set(o.cols.slice(0, Math.max(0, im.w - colsKept))),
    rows: number[] = [],
    cols: number[] = [];
  for (let y = 0; y < im.h; y++) if (!goneR.has(y)) rows.push(y);
  for (let x = 0; x < im.w; x++) if (!goneC.has(x)) cols.push(x);
  return { rows, cols };
}
/** Columns to keep for a number of rows: the drawing's proportions. */
export const colsFor = (im: Img, rowsKept: number) => Math.max(1, Math.round((im.w * rowsKept) / im.h));
/** The image made of the given rows and columns, its foot moved with them (where as many kept
 * lines lie before it as before the old: not all those below the foot need be kept). */
export function cut(im: Img, rows: number[], cols: number[]): Img {
  const data = new Uint8ClampedArray(rows.length * cols.length * 4);
  rows.forEach((sy, y) => cols.forEach((sx, x) => data.set(im.data.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (y * cols.length + x) * 4)));
  return { w: cols.length, h: rows.length, ax: before(cols, im.ax), ay: before(rows, im.ay), data };
}
/** How many of the kept lines come before line `at`. */
export const before = (kept: ArrayLike<number>, at: number) => {
  let n = 0;
  for (let i = 0; i < kept.length; i++) if (kept[i] < at) n++;
  return n;
};
