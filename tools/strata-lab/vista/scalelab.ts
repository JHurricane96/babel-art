// Vista scale lab: how sprites should change size as the camera moves, tested in isolation.
//
// A small scene (rows of trees, ground cover, the party walking) seen by a camera that moves
// in the ways that trouble pixel art in perspective: towards the scene, sideways, turning,
// and back. Each method draws the same frame its own way, on the CPU, so the lab renders to
// video here and runs as an interactive page anywhere.
import { CLASS_H, NC, type Img, slotDefs, slotIndex } from "./sprites";
import { TREE_KINDS, mulberry } from "./valley";
import { drawVoxel, setView, voxelModel } from "./voxels";

export const PW = 320,
  PH = 180,
  HZ = 40,
  F = 980 / 2 / Math.tan(Math.PI / 6),
  LOOP = 16;
setView(PW / 2, HZ);

export const METHODS = [
  { id: "jumps", name: "Size classes, switched", note: "26 sizes a quarter-octave apart; each thing jumps to the nearest." },
  { id: "dither", name: "Size classes, dithered (Vista now)", note: "As Vista now: the two nearest sizes mixed pixel by pixel." },
  { id: "pixel", name: "Redrawn at every pixel size", note: "Drawn at its exact height in whole pixels; one layout, so it grows a pixel at a time." },
  { id: "nearest", name: "Scaled, nearest neighbour", note: "The next bigger size shrunk to fit by dropping rows and columns." },
  { id: "seams", name: "Rows and columns, octave drawings", note: "Drawn afresh every octave (6, 12, 24 … 384 px); between, it grows or shrinks one row and column at a time, spread evenly. Switching to the next drawing pops a little." },
  { id: "voxel", name: "All voxels", note: "Everything as voxel models in 3D: trees from the same layouts as the sprites, bushes, ferns, grass, flowers, rocks and the walkers; lit by the sun, shaded in crevices and under their own crowns, outlined where they turn away, each level half the last." },
  { id: "seams2", name: "Rows and columns, drawings every 2 octaves", note: "As rows and columns, drawn afresh only at 6, 24, 96 and 384 px: fewer switches between drawings, more taken out between them." },
  { id: "seamsH", name: "Rows and columns, drawings every half octave", note: "As rows and columns, drawn afresh every half octave: less taken out, more switches." },
  { id: "seamsB", name: "Rows and columns, big ones from one drawing", note: "Everything 48 px and over grows from one big drawing, so big things never switch drawings; small ones switch at 48, 24 and 12 px." },
  { id: "seamsB24", name: "Rows and columns, one drawing from 24 px", note: "One big drawing (384 px) for every size from 24 px up, so trees in view never switch drawings; under 24 px, drawings made for 12 and 24 px. The only switches are at 12 and 24 px, and each changes about as much as a one-row step. Smooth, and right at every size." },
  { id: "seams1", name: "Rows and columns, one drawing at every size", note: "One big drawing (384 px) for every size from 6 px up: it never switches drawings, so it is the smoothest, but under about 20 px it keeps only one row in 20 and trees come out wrong (thick trunks, lopsided crowns)." },
] as const;
export type Method = (typeof METHODS)[number]["id"];

const DEFS = slotDefs(),
  SLOT = slotIndex(),
  cache = new Map<number, Img>();
/** A sprite drawn at height H (cached). */
export function imgAt(slot: number, H: number): Img {
  const key = slot * 4096 + H;
  let im = cache.get(key);
  if (!im) cache.set(key, (im = DEFS[slot].draw(H, 1000 + slot * 131)));
  return im;
}
export const cached = () => cache.size;

// ---- Growing by rows and columns --------------------------------------------------------------
// From a drawing, an order in which to take rows (and columns) out to make it smaller: each time
// the one most like its neighbour, so lines and edges stay longest. A size h keeps the drawing's
// rows that are not among the first (rows - h) taken out, so one pixel of growth puts back exactly
// one row: what is above it moves up a pixel, whole; nothing is redrawn.
interface Order {
  rows: number[];
  cols: number[];
}
const orders = new Map<Img, Order>();
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
/** How far from where the next line is due the removal may look for a less visible one (-1: 2.5% of the drawing).
 * Kept to one line either side: given more freedom, it keeps avoiding distinct lines (a trunk's
 * edges) and the proportions drift as the drawing shrinks a long way. */
export let WINDOW = 1;
export function setWindow(w: number) {
  WINDOW = w;
}
/** Van der Corput: 1/2, 1/4, 3/4, 1/8 ... any prefix spread evenly over [0, 1). */
function vdc(k: number) {
  let v = 0,
    b = 0.5;
  while (k) {
    if (k & 1) v += b;
    k >>= 1;
    b *= 0.5;
  }
  return v;
}
/**
 * The order to take lines out in: spread evenly over the drawing (so it keeps its proportions at
 * every size), each time the least visible line near where the next one is due.
 */
function removal(im: Img, rows: boolean, keepIdx: number) {
  const n = rows ? im.h : im.w,
    alive = Array.from({ length: n }, (_, i) => i),
    out: number[] = [],
    win = WINDOW < 0 ? Math.max(1, Math.round(n * 0.025)) : WINDOW;
  for (let k = 1; alive.length > 1; k++) {
    const target = vdc(k) * n;
    let jt = 0;
    while (jt < alive.length - 1 && alive[jt + 1] <= target) jt++;
    let best = -1,
      bc = 1e18;
    for (let j = Math.max(0, jt - win); j <= Math.min(alive.length - 1, jt + win); j++) {
      if (alive[j] === keepIdx) continue;
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
function orderOf(im: Img): Order {
  let o = orders.get(im);
  if (!o) orders.set(im, (o = { rows: removal(im, true, im.h - 1), cols: removal(im, false, Math.min(im.w - 1, im.ax)) }));
  return o;
}
const shrunk = new Map<string, Img>();
/** A drawing made h rows tall by taking out rows and columns in its order. */
function shrinkTo(src: Img, h: number, key: string): Img {
  const k = `${key}|${h}`;
  let im = shrunk.get(k);
  if (im) return im;
  const o = orderOf(src),
    w = Math.max(1, Math.round((src.w * h) / src.h)),
    goneR = new Set(o.rows.slice(0, Math.max(0, src.h - h))),
    goneC = new Set(o.cols.slice(0, Math.max(0, src.w - w))),
    rows: number[] = [],
    cols: number[] = [];
  for (let y = 0; y < src.h; y++) if (!goneR.has(y)) rows.push(y);
  for (let x = 0; x < src.w; x++) if (!goneC.has(x)) cols.push(x);
  const data = new Uint8ClampedArray(cols.length * rows.length * 4);
  rows.forEach((sy, y) => cols.forEach((sx, x) => data.set(src.data.subarray((sy * src.w + sx) * 4, (sy * src.w + sx) * 4 + 4), (y * cols.length + x) * 4)));
  let ax = 0;
  for (const c of cols) if (c < src.ax) ax++;
  im = { w: cols.length, h: rows.length, ax, ay: rows.length - (src.h - src.ay), data };
  shrunk.set(k, im);
  return im;
}
/** Drawings to grow from: every octave, every two octaves, or every half octave. */
export const KEYFRAMES: Record<string, number[]> = {
  octave: [6, 12, 24, 48, 96, 192, 384],
  two: [6, 24, 96, 384],
  half: [6, 8, 12, 17, 24, 34, 48, 68, 96, 136, 192, 272, 384],
};
/** Or ranges: from a height up, grow from this drawing (big sizes all from the biggest, so they never switch). */
export const RANGES: Record<string, [number, number][]> = {
  big48: [[6, 12], [12, 24], [24, 48], [48, 384]],
  big24: [[6, 12], [12, 24], [24, 384]],
};
/** Which drawing a picture came from (for measuring). */
export const keyframeOf = new WeakMap<Img, number>();
/** A sprite at height H, grown by rows and columns from the nearest drawing at or above it. */
export function seamImg(slot: number, H: number, oneDrawing: boolean, maxH: number, spacing = "octave"): Img {
  if (H < 6 || maxH < 6) return imgAt(slot, Math.min(H, maxH));
  const ks = KEYFRAMES[spacing],
    rg = RANGES[spacing],
    K = oneDrawing
      ? Math.max(48, Math.min(maxH, 384))
      : rg
        ? (() => {
            let src = rg[0][1];
            for (const [from, d] of rg) if (H >= from) src = d;
            return src;
          })()
        : ks.find((k) => k >= H) ?? 384,
    KK = Math.min(K, Math.max(6, maxH)),
    src = imgAt(slot, KK),
    im = H >= src.h ? src : shrinkTo(src, H, `${slot}:${KK}`);
  keyframeOf.set(im, KK);
  return im;
}

// ---- The scene ---------------------------------------------------------------------------------
export interface Obj {
  id: number;
  x: number;
  z: number;
  slot: number;
  h: number;
  walker: number;
  maxClass: number;
}
export function scene(): Obj[] {
  const R = mulberry(11),
    out: Obj[] = [];
  const add = (x: number, z: number, slot: number, h: number, walker = -1) => out.push({ id: out.length, x, z, slot, h, walker, maxClass: DEFS[slot].maxClass });
  // Trees in loose rows, nearer and farther.
  for (const [z0, z1, gap] of [[70, 95, 16], [150, 210, 20], [300, 420, 26], [600, 800, 40]]) {
    for (let x = -260; x < 300; x += gap * (0.7 + 0.6 * R())) {
      const kind = Math.floor(R() * 7),
        v = Math.floor(R() * 3),
        [h0, h1] = TREE_KINDS[kind].h,
        z = z0 + (z1 - z0) * R();
      if (Math.abs(x) > z * 0.75) continue;
      add(x, z, kind * 3 + v, h0 + (h1 - h0) * R());
    }
  }
  // Ground cover between the camera and the near trees.
  const cover = ["grass", "grass2", "flowers yellow", "flowers white", "fern", "shrub", "boulder", "stone", "dry grass"];
  for (let k = 0; k < 420; k++) {
    const z = 48 + R() ** 0.7 * 110,
      x = (R() - 0.5) * z * 1.3,
      name = cover[Math.floor(R() * cover.length)],
      slot = SLOT.get(name)!;
    add(x, z, slot, DEFS[slot].worldH * (0.75 + 0.5 * R()));
  }
  // The party, walking across.
  for (let m = 0; m < 4; m++) add(0, 92, SLOT.get(`person ${m} 0 0`)!, 1.75, m);
  return out;
}

// ---- The camera's loop: in, across, turning, back -----------------------------------------------
const ease = (u: number) => u * u * (3 - 2 * u);
export function camAt(t: number) {
  const u = ((t % LOOP) + LOOP) % LOOP,
    seg = Math.floor(u / 4),
    f = ease((u % 4) / 4);
  let x = 0,
    z = 0,
    yaw = 0;
  if (seg === 0) z = 22 * f;
  else if (seg === 1) (z = 22), (x = 26 * f);
  else if (seg === 2) (z = 22), (x = 26), (yaw = 0.12 * f);
  else (x = 26 * (1 - f)), (z = 22 * (1 - f)), (yaw = 0.12 * (1 - f));
  return { x, y: 8, z, yaw, seg };
}
export const SEGMENTS = ["moving in", "moving across", "turning", "moving back"];

// ---- Drawing a frame -----------------------------------------------------------------------------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)];
const classFor = (H: number) => Math.log2(Math.max(H, 3) / 3) * 4;

/** Draw one frame of the scene by one method into rgba (PW x PH, rows top-down). */
export function frame(objs: Obj[], t: number, method: Method, rgba: Uint8ClampedArray, log?: Map<number, Img>) {
  const cam = camAt(t),
    fx = Math.sin(cam.yaw),
    fz = Math.cos(cam.yaw),
    rx = Math.cos(cam.yaw),
    rz = -Math.sin(cam.yaw);
  // Sky and ground: plain bands, so only the sprites move.
  for (let y = 0; y < PH; y++) {
    const c = y < HZ ? [150 + y, 186 + y * 0.6, 222] : [118 - (y - HZ) * 0.12, 150 - (y - HZ) * 0.15, 76];
    for (let x = 0; x < PW; x++) {
      const o = (y * PW + x) * 4;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = 255;
    }
  }
  const list: { o: Obj; vz: number; sx: number; sy: number; want: number; x: number }[] = [];
  for (const o of objs) {
    let x = o.x;
    if (o.walker >= 0) x = -40 + ((t * 4 - o.walker * 2.8) % 80);
    const ex = x - cam.x,
      ez = o.z - cam.z,
      vz = ex * fx + ez * fz;
    if (vz < 5) continue;
    const sx = PW / 2 + (F * (ex * rx + ez * rz)) / vz,
      sy = HZ + (F * cam.y) / vz,
      want = (o.h * F) / vz;
    if (sx < -200 || sx > PW + 200 || want < 0.6) continue;
    list.push({ o, vz, sx, sy, want, x });
  }
  list.sort((a, b) => b.vz - a.vz);
  for (const it of list) {
    const ax = Math.floor(it.sx + 0.5),
      ay = Math.floor(it.sy + 0.5),
      o = it.o;
    let slot = o.slot;
    if (o.walker >= 0) slot = SLOT.get(`person ${o.walker} 0 ${Math.floor((it.x + 100) / 0.6) & 3}`)!;
    const vm = method === "voxel" ? voxelModel(DEFS[slot].name, slot) : null,
      local = vm ? drawVoxel(vm, o.h, { x: it.x, z: o.z }, cam, F) : spriteImg(method === "voxel" ? "seams" : method, slot, it.want, o.maxClass);
    blit(rgba, local, ax, ay);
    log?.set(o.id, local);
  }
  return cam;
}

/** The image a method shows for a thing wanting to be `want` px tall. */
const made = new Map<string, Img>();
export function spriteImg(method: Method, slot: number, want: number, maxClass: number): Img {
  const maxH = CLASS_H[maxClass];
  if (method === "jumps") return imgAt(slot, CLASS_H[Math.min(maxClass, Math.max(0, Math.round(classFor(want))))]);
  if (method === "pixel") return imgAt(slot, Math.min(Math.max(maxH, 400), Math.max(1, Math.round(want))));
  if (method.startsWith("seams")) {
    const cap = maxClass >= 25 ? 384 : maxH * 2,
      spacing = ({ seams2: "two", seamsH: "half", seamsB: "big48", seamsB24: "big24" } as Record<string, string>)[method] ?? "octave";
    return seamImg(slot, Math.min(Math.max(1, Math.round(want)), cap), method === "seams1", cap, spacing);
  }
  if (method === "dither") {
    const cf = classFor(want),
      lo = Math.min(maxClass, Math.floor(cf)),
      hi = Math.min(maxClass, lo + 1),
      f = lo === hi ? 0 : ease(Math.min(1, Math.max(0, (cf - Math.floor(cf) - 0.3) / 0.4))),
      vis = Math.min(1, Math.max(0, (want - 1) / 2)),
      fq = Math.round(f * 16),
      vq = Math.round(vis * 16),
      key = `d${slot}|${lo}|${hi}|${fq}|${vq}`;
    let im = made.get(key);
    if (!im) made.set(key, (im = dithered(imgAt(slot, CLASS_H[lo]), imgAt(slot, CLASS_H[hi]), fq / 16, vq / 16)));
    return im;
  }
  const k = Math.min(maxClass, Math.max(0, Math.ceil(classFor(want)))),
    src = imgAt(slot, CLASS_H[k]),
    H = Math.max(1, Math.round(want)),
    key = `n${slot}|${k}|${H}`;
  let im = made.get(key);
  if (!im) made.set(key, (im = scaled(src, Math.min(1, H / src.h))));
  return im;
}
function dithered(lo: Img, hi: Img, f: number, vis: number): Img {
  const x0 = Math.min(-lo.ax, -hi.ax),
    x1 = Math.max(lo.w - lo.ax, hi.w - hi.ax),
    y0 = Math.min(-lo.ay, -hi.ay),
    y1 = Math.max(lo.h - lo.ay, hi.h - hi.ay),
    w = x1 - x0,
    h = y1 - y0,
    data = new Uint8ClampedArray(w * h * 4);
  for (let py = y0; py < y1; py++)
    for (let px = x0; px < x1; px++) {
      if (bayer(px, py) >= vis) continue;
      const im = bayer(px + 2, py + 1) < f ? hi : lo,
        ix = px + im.ax,
        iy = py + im.ay;
      if (ix < 0 || iy < 0 || ix >= im.w || iy >= im.h) continue;
      data.set(im.data.subarray((iy * im.w + ix) * 4, (iy * im.w + ix) * 4 + 4), ((py - y0) * w + px - x0) * 4);
    }
  return { w, h, ax: -x0, ay: -y0, data };
}
function scaled(im: Img, k: number): Img {
  const w = Math.max(1, Math.round(im.w * k)),
    h = Math.max(1, Math.round(im.h * k)),
    data = new Uint8ClampedArray(w * h * 4);
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++) {
      const ix = Math.min(im.w - 1, Math.floor(((tx + 0.5) * im.w) / w)),
        iy = Math.min(im.h - 1, Math.floor(((ty + 0.5) * im.h) / h));
      data.set(im.data.subarray((iy * im.w + ix) * 4, (iy * im.w + ix) * 4 + 4), (ty * w + tx) * 4);
    }
  return { w, h, ax: Math.round(im.ax * k), ay: Math.round(im.ay * k), data };
}

function put(rgba: Uint8ClampedArray, x: number, y: number, im: Img, ix: number, iy: number) {
  if (x < 0 || y < 0 || x >= PW || y >= PH) return;
  const s = (iy * im.w + ix) * 4;
  if (im.data[s + 3] < 128) return;
  const d = (y * PW + x) * 4;
  rgba[d] = im.data[s];
  rgba[d + 1] = im.data[s + 1];
  rgba[d + 2] = im.data[s + 2];
}
function blit(rgba: Uint8ClampedArray, im: Img, ax: number, ay: number) {
  for (let iy = 0; iy < im.h; iy++) for (let ix = 0; ix < im.w; ix++) put(rgba, ax - im.ax + ix, ay - im.ay + iy, im, ix, iy);
}
void NC;
