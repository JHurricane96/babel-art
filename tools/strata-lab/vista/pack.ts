// Vista sprites made for the GPU (runs in the workers). Each slot is drawn at every whole-pixel
// height it can be shown at, in one of three ways:
//
// - exact: small sizes drawn (or, for trees, shrunk from small drawings) one image per height;
// - span: one drawing grown and shrunk by whole rows and columns (grow.ts), as tables of the
//   rows and columns each height keeps, so the GPU draws any height from the one image;
// - parts: trees and shrubs near the camera taken apart into groups of leaf clumps (and their
//   trunk and branches), each group put back at its own exact place and shrunk by its own rows
//   and columns, so a tree grows evenly instead of jerking in blocks.
//
// For trees the span's drawing is the parts put together at the height where the parts take
// over, so the hand-over from one to the other changes nothing.
//
// Trees, shrubs and ground cover are drawn in materials and shades (red: material * 8 + shade;
// green: which cell of the tree the pixel belongs to, for autumn colour), so the renderer can
// colour every tree its own way. People, the ox and the cart are drawn in colour.
import { colsFor, cut, kept, orderOf } from "./grow";
import { type Img, type Part, type SlotDef, TREE_NAMES, drawParts, indexMode, lastRamps } from "./sprites";

export const HMAX = 384;
/** Pixels of an image: RGBA bytes (in index form: red the material and shade, green the cell). */
export interface Pic {
  w: number;
  h: number;
  ax: number;
  ay: number;
  data: Uint8Array;
}
/**
 * How a slot is drawn: exact images up to E px; a span (rows and columns of one drawing, which
 * stands for N px) from E + 1 up to T - 1 (or K when it has no parts); parts from T up to K px.
 * Above K it stays K px.
 */
export interface Plan {
  E: number;
  T: number;
  K: number;
  N: number;
  direct: boolean;
}
export function planOf(def: SlotDef): Plan {
  const kind = def.name.split(" ")[0];
  // Trees, shrubs and rocks grow from one drawing by whole rows and columns from 6 px up (each
  // height the one below and a row or column more), so they never change their look as they grow;
  // only the tiniest are drawn at their own size. Grass, flowers and ferns are strokes, redrawn at
  // every size (a stroke drawn a pixel bigger just moves its ends; shrunk by rows and columns, thin
  // fronds break into dots).
  if (TREE_NAMES.includes(kind)) return { E: 5, T: 128, K: 384, N: 128, direct: false };
  if (kind.startsWith("shrub")) return { E: 5, T: 64, K: 256, N: 64, direct: false };
  if (kind.startsWith("boulder") || kind.startsWith("stone")) return { E: 5, T: 0, K: 192, N: 192, direct: false };
  if (kind === "marker") return { E: 1, T: 0, K: 1, N: 1, direct: true };
  if (kind === "person" || kind === "ox" || kind === "cart") return { E: 48, T: 0, K: 96, N: 96, direct: true };
  return { E: 64, T: 0, K: 192, N: 192, direct: false };
}
/** Rows and columns kept at each height of a span, and where the foot is. */
export interface Span {
  pic: Pic;
  h0: number;
  h1: number;
  rows: Uint16Array;
  cols: Uint16Array;
  /** Per height from h0: rows offset, columns offset, rows, columns, foot x, foot y. */
  per: Int32Array;
}
/** One part of a tree: its pixels at full size, and its rows and columns at each height it is shown at. */
export interface PartPack {
  pic: Pic;
  /** Its centre column and row, measured from the tree's foot (at full size, K px). */
  cx: number;
  cy: number;
  cell: number;
  hMin: number;
  rows: Uint16Array;
  cols: Uint16Array;
  /** Per height from hMin to pic.h: rows offset, columns offset, columns, index of the centre column, index of the centre row. */
  per: Int32Array;
}
export interface SlotPack {
  slot: number;
  plan: Plan;
  exact: Pic[];
  span: Span | null;
  parts: PartPack[];
  ramps: [number, number[][]][];
}

/** The cell of a tree (16 x 16 over its height) a point belongs to, measured from the foot. */
export function cellOf(dx: number, dy: number, H: number) {
  const cx = Math.min(15, Math.max(0, Math.floor((dx * 12) / H) + 8)),
    cy = Math.min(15, Math.max(0, Math.floor((dy * 12) / H) + 14));
  return cx | (cy << 4);
}
/** A part's height when its tree is H px tall (of K): rounded, at least 1. Integer arithmetic, as on the GPU. */
export const partH = (ph: number, H: number, K: number) => Math.max(1, Math.floor((2 * ph * H + K) / (2 * K)));
/** Where a part's centre goes (from the foot) when its tree is H px tall: c * H / K, rounded. */
export const partAt = (c: number, H: number, K: number) => Math.floor(((2 * c + 1) * H) / (2 * K));

function toPic(im: Img, cells?: number): Pic {
  const data = new Uint8Array(im.data.buffer.slice(im.data.byteOffset, im.data.byteOffset + im.data.byteLength));
  if (cells)
    for (let y = 0; y < im.h; y++)
      for (let x = 0; x < im.w; x++) {
        const o = (y * im.w + x) * 4;
        if (data[o + 3]) data[o + 1] = cellOf(x - im.ax, y - im.ay, cells);
      }
  return { w: im.w, h: im.h, ax: im.ax, ay: im.ay, data };
}
/** A drawing shrunk to stand for H px when it was drawn standing for N px (its own rows may differ a little). */
function shrink(src: Img, order: ReturnType<typeof orderOf>, H: number, N: number) {
  // Rows in proportion: the drawing stands for N px, whatever its own height (a boulder drawn for
  // 192 px is 162 rows; taking away N - H rows would leave it far too small).
  const r = Math.min(src.h, Math.max(1, Math.round((src.h * H) / N))),
    { rows, cols } = kept(src, order, r, colsFor(src, r));
  return { rows, cols };
}
function makeSpan(src: Img, h0: number, h1: number, N: number): Span {
  const order = orderOf(src),
    rows: number[] = [],
    cols: number[] = [],
    per = new Int32Array((h1 - h0 + 1) * 6);
  for (let H = h0; H <= h1; H++) {
    const k = shrink(src, order, H, N);
    let ax = 0;
    for (const c of k.cols) if (c < src.ax) ax++;
    per.set([rows.length, cols.length, k.rows.length, k.cols.length, ax, k.rows.length - (src.h - src.ay)], (H - h0) * 6);
    rows.push(...k.rows);
    cols.push(...k.cols);
  }
  return { pic: toPic(src), h0, h1, rows: Uint16Array.from(rows), cols: Uint16Array.from(cols), per };
}
/** Parts no taller or wider than 64 px: longer ones (a trunk, a long branch) cut in pieces overlapping by a line, so no gap opens between them. */
function slices(p: Part): Part[] {
  const cutRows = (q: Part): Part[] => {
    if (q.h <= 64) return [q];
    const out: Part[] = [];
    for (let r0 = 0; r0 < q.h - 1; r0 += 47) {
      const h = Math.min(48, q.h - r0);
      out.push(sub(q, 0, r0, q.w, h));
      if (r0 + h >= q.h) break;
    }
    return out;
  };
  const cutCols = (q: Part): Part[] => {
    if (q.w <= 64) return [q];
    const out: Part[] = [];
    for (let c0 = 0; c0 < q.w - 1; c0 += 47) {
      const w = Math.min(48, q.w - c0);
      out.push(sub(q, c0, 0, w, q.h));
      if (c0 + w >= q.w) break;
    }
    return out;
  };
  return cutRows(p).flatMap(cutCols);
}
function sub(p: Part, x0: number, y0: number, w: number, h: number): Part {
  const data = new Uint8ClampedArray(w * h * 4),
    mt = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    data.set(p.data.subarray(((y0 + y) * p.w + x0) * 4, ((y0 + y) * p.w + x0 + w) * 4), y * w * 4);
    mt.set(p.mt.subarray((y0 + y) * p.w + x0, (y0 + y) * p.w + x0 + w), y * w);
  }
  return { w, h, ax: p.ax - x0, ay: p.ay - y0, data, mt, leaf: p.leaf };
}

export function packSlot(slot: number, def: SlotDef): SlotPack {
  const plan = planOf(def),
    seed = 1000 + slot * 131,
    ramps = new Map<number, number[][]>(),
    note = () => {
      const r = lastRamps();
      if (r) for (const [m, v] of Object.entries(r)) ramps.set(Number(m), v);
    },
    draw = (H: number) => {
      const im = def.draw(H, seed);
      if (!plan.direct) note();
      return im;
    };
  indexMode(!plan.direct);
  const exact: Pic[] = [],
    isTree = plan.T > 0;
  let span: Span | null = null;
  const parts: PartPack[] = [];
  if (isTree) {
    // Small: drawn at their own size under 6 px, then shrunk from drawings made for 12 and 24 px.
    const n12 = draw(12),
      n24 = draw(24),
      o12 = orderOf(n12),
      o24 = orderOf(n24);
    for (let H = 1; H <= plan.E; H++) {
      if (H < 6) exact.push(toPic(draw(H), H));
      else {
        const [src, o, N] = H < 12 ? [n12, o12, 12] : [n24, o24, 24],
          k = shrink(src, o, H, N);
        exact.push(toPic(cut(src, k.rows, k.cols), H));
      }
    }
    // Near: the parts of a big drawing, clumps grouped by cell.
    const raw = drawParts(def, plan.K, seed, "cluster").flatMap(slices);
    for (const p of raw) {
      const cr = Math.floor(p.h / 2),
        cc = Math.floor(p.w / 2),
        data = new Uint8Array(p.w * p.h * 4),
        cell = cellOf(cc - p.ax, cr - p.ay, plan.K);
      for (let q = 0; q < p.w * p.h; q++)
        if (p.mt[q]) {
          data[q * 4] = p.mt[q];
          data[q * 4 + 1] = cell;
          data[q * 4 + 3] = 255;
        }
      const pic: Pic = { w: p.w, h: p.h, ax: p.ax, ay: p.ay, data },
        im = { ...pic, data: new Uint8ClampedArray(data.buffer) },
        order = orderOf(im, cr, cc),
        hMin = partH(p.h, plan.T, plan.K),
        rows: number[] = [],
        cols: number[] = [],
        per = new Int32Array((p.h - hMin + 1) * 5);
      for (let h = hMin; h <= p.h; h++) {
        const k = kept(im, order, h, colsFor(im, h));
        per.set([rows.length, cols.length, k.cols.length, k.cols.indexOf(cc), k.rows.indexOf(cr)], (h - hMin) * 5);
        rows.push(...k.rows);
        cols.push(...k.cols);
      }
      parts.push({ pic, cx: cc - p.ax, cy: cr - p.ay, cell, hMin, rows: Uint16Array.from(rows), cols: Uint16Array.from(cols), per });
    }
    // Mid: the parts put together at T px, grown and shrunk by rows and columns from E + 1 to T - 1.
    const whole = assemble(parts, plan.T, plan.K);
    span = makeSpan(whole, plan.E + 1, plan.T - 1, plan.T);
    note();
  } else {
    for (let H = 1; H <= plan.E; H++) exact.push(toPic(draw(H)));
    if (plan.K > plan.E) span = makeSpan(draw(plan.K), plan.E + 1, plan.K, plan.N);
  }
  indexMode(false);
  return { slot, plan, exact, span, parts, ramps: [...ramps] };
}

/** The parts put together as they stand when the tree is H px tall (exactly as the GPU places them). */
export function assemble(parts: PartPack[], H: number, K: number): Img {
  const placed: { p: PartPack; x: number; y: number; r0: number; c0: number; nr: number; nc: number }[] = [];
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  for (const p of parts) {
    const h = partH(p.pic.h, H, K),
      i = (h - p.hMin) * 5;
    if (i < 0) continue;
    const nc = p.per[i + 2],
      x = partAt(p.cx, H, K) - p.per[i + 3],
      y = partAt(p.cy, H, K) - p.per[i + 4];
    placed.push({ p, x, y, r0: p.per[i], c0: p.per[i + 1], nr: h, nc });
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + nc);
    y1 = Math.max(y1, y + h);
  }
  const w = x1 - x0,
    h = y1 - y0,
    data = new Uint8ClampedArray(w * h * 4);
  for (const { p, x, y, r0, c0, nr, nc } of placed)
    for (let j = 0; j < nr; j++)
      for (let i = 0; i < nc; i++) {
        const s = (p.rows[r0 + j] * p.pic.w + p.cols[c0 + i]) * 4;
        if (p.pic.data[s + 3] < 128) continue;
        const o = ((y - y0 + j) * w + x - x0 + i) * 4;
        data[o] = p.pic.data[s];
        data[o + 1] = p.pic.data[s + 1];
        data[o + 2] = 0;
        data[o + 3] = 255;
      }
  return { w, h, ax: -x0, ay: -y0, data };
}
