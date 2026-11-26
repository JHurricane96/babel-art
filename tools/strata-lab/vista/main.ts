// Strata Vista: the page. Builds the valley in workers, packs the sprites,
// walks the party along the route, directs the camera, and draws.
import { ART_H, ART_W, F, FOV, Renderer, type Camera, type PartsFrame, type Sprites, type SpriteData } from "./render";
import { BIOMES as BIOME_DEFS, ZONE } from "../../../engine/strata/biomes";
import { BIOMES as BIOME_MAP, type World2D } from "../../../engine/strata/world2d";
import { G, type LandData, type Place, ground, land, landFromWorld, setLand, worldSize } from "./land";
import { FAR, FINE, GRIDS, KIND, MID, ROUTE, along, cumulative, hash2, mulberry, placeGrids } from "./valley";
import { M } from "../../../engine/strata/world";
import { hex, rampOf, shiftColor } from "./color";
import { HMAX, type Plan, type SlotPack } from "./pack";
import { COVER, LEAF_HEX, TREE_NAMES, slotDefs, slotIndex } from "./sprites";

declare const WORKER_SOURCE: string;
const $ = (id: string) => document.getElementById(id)!;

// ---- State ------------------------------------------------------------------------------------
const opt = { snap: true, bands: true, marker: true, ghost: true, wall: true };
let stepOnce = false;
let mode: "auto" | "follow" | "turn" = "auto",
  speed = 6,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  simTime = 0,
  s = 0,
  walked = 0;
const cam: Camera = { x: 0, y: 0, z: 0, yaw: 0 };
let snap = true,
  autoPick: "follow" | "turn" = "turn",
  pending: string | null = null,
  lastEval = -1e9,
  followYaw = 0,
  followFx = 0.27,
  current: "follow" | "turn" = "turn";
const LEAD_FX = 0.27,
  WALK = 1.35;

// CPU copies of the grids (heights for all three; kinds for the fine one).
const HGT = GRIDS.map((g) => new Float32Array(g.n * g.n));
const FINE_K = new Uint8Array(FINE.n * FINE.n),
  FINE_B = new Uint8Array(FINE.n * FINE.n),
  FINE_R = new Uint8Array(FINE.n * FINE.n);
function heightIn(gi: number, x: number, z: number) {
  const g = GRIDS[gi],
    n = g.n,
    fx = Math.min(n - 1.001, Math.max(0, (x - g.x0) / g.cell)),
    fz = Math.min(n - 1.001, Math.max(0, (z - g.z0) / g.cell)),
    ix = fx | 0,
    iz = fz | 0,
    tx = fx - ix,
    tz = fz - iz,
    i = iz * n + ix,
    a = HGT[gi];
  return a[i] + (a[i + 1] - a[i]) * tx + (a[i + n] - a[i]) * tz + (a[i] - a[i + 1] - a[i + n] + a[i + n + 1]) * tx * tz;
}
const inside = (gi: number, x: number, z: number) => {
  const g = GRIDS[gi];
  return x >= g.x0 + g.cell && z >= g.z0 + g.cell && x < g.x0 + g.cell * (g.n - 2) && z < g.z0 + g.cell * (g.n - 2);
};
const surfaceAt = (x: number, z: number) => (inside(0, x, z) ? heightIn(0, x, z) : inside(1, x, z) ? heightIn(1, x, z) : heightIn(2, x, z));
const kindAt = (x: number, z: number) =>
  FINE_K[Math.min(FINE.n - 1, Math.max(0, Math.round((z - FINE.z0) / FINE.cell))) * FINE.n + Math.min(FINE.n - 1, Math.max(0, Math.round((x - FINE.x0) / FINE.cell)))];
function surfaceMax(x: number, z: number, r: number) {
  let m = -1e9;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]])
    m = Math.max(m, surfaceAt(x + dx, z + dz));
  return m;
}

// ---- The route ---------------------------------------------------------------------------------
// Each place has its own walk: across the fine grid, through the place, by the easiest way.
let RC = [0, 1],
  TOTAL = 1,
  place: Place = { name: "", x: 0, z: 0 },
  placeIndex = 0;
const routeAt = (v: number) => along(ROUTE, RC, v);
const partyY = (v: number) => {
  const p = routeAt(v);
  return surfaceAt(p.x, p.z);
};
/** The walk at a place: A* over a 32 m lattice on the fine grid (steep ground costs, rivers can be forded,
 * lakes and the sea cannot), from one side of the grid to the other, then smoothed. */
function planRoute(p: Place): [number, number][] {
  const g = FINE,
    size = g.cell * g.n,
    margin = 220,
    step = 32,
    m = Math.floor((size - 2 * margin) / step),
    x0 = g.x0 + margin,
    z0 = g.z0 + margin,
    H = new Float32Array(m * m),
    W = new Uint8Array(m * m);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const h = ground(x0 + i * step, z0 + j * step);
      H[j * m + i] = h;
      W[j * m + i] = G.level > h ? (G.lake || G.sea ? 2 : 1) : 0;
    }
  const node = (x: number, z: number) => {
    const i = Math.min(m - 1, Math.max(0, Math.round((x - x0) / step))),
      j = Math.min(m - 1, Math.max(0, Math.round((z - z0) / step)));
    // The nearest dry node.
    for (let r = 0; r < m; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const ii = i + di,
            jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= m || jj >= m) continue;
          if (!W[jj * m + ii]) return jj * m + ii;
        }
    return j * m + i;
  };
  const cx = Math.min(g.x0 + size - 600, Math.max(g.x0 + 600, p.x)),
    cz = Math.min(g.z0 + size - 600, Math.max(g.z0 + 600, p.z)),
    R0 = size / 2 - margin - 80,
    a0 = hash2(land().seed & 0xffff, placeIndex, 5) * Math.PI * 2;
  let best: number[] | null = null;
  for (let tries = 0; tries < 6 && !best; tries++) {
    const a = a0 + tries * (Math.PI / 6),
      s0 = node(cx - Math.cos(a) * R0, cz - Math.sin(a) * R0),
      s1 = node(cx + Math.cos(a) * R0, cz + Math.sin(a) * R0);
    // A*.
    const cost = new Float32Array(m * m).fill(Infinity),
      from = new Int32Array(m * m).fill(-1),
      open: number[] = [s0],
      est = (k: number) => Math.hypot((k % m) - (s1 % m), Math.floor(k / m) - Math.floor(s1 / m)) * step;
    cost[s0] = 0;
    const done = new Uint8Array(m * m);
    while (open.length) {
      let bi = 0;
      for (let q = 1; q < open.length; q++) if (cost[open[q]] + est(open[q]) < cost[open[bi]] + est(open[bi])) bi = q;
      const k = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === s1) break;
      const ki = k % m,
        kj = Math.floor(k / m);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ii = ki + di,
          jj = kj + dj;
        if (ii < 0 || jj < 0 || ii >= m || jj >= m) continue;
        const q = jj * m + ii;
        if (done[q] || W[q] === 2) continue;
        const len = Math.hypot(di, dj) * step,
          sl = Math.abs(H[q] - H[k]) / len,
          c = cost[k] + len * (1 + 60 * sl * sl + (sl > 0.45 ? 40 : 0)) + (W[q] === 1 ? 500 : 0);
        if (c < cost[q]) {
          cost[q] = c;
          from[q] = k;
          open.push(q);
        }
      }
    }
    if (from[s1] < 0) continue;
    const path: number[] = [];
    for (let k = s1; k >= 0; k = from[k]) path.push(k);
    best = path.reverse();
  }
  let pts: [number, number][] = (best ?? [node(cx - R0, cz), node(cx + R0, cz)]).map((k) => [x0 + (k % m) * step, z0 + Math.floor(k / m) * step]);
  for (let it = 0; it < 3; it++) {
    const q: [number, number][] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k],
        [bx, bz] = pts[k + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
    }
    q.push(pts[pts.length - 1]);
    pts = q;
  }
  // Every 16 m or so is plenty.
  const out: [number, number][] = [pts[0]];
  for (const pt of pts) if (Math.hypot(pt[0] - out[out.length - 1][0], pt[1] - out[out.length - 1][1]) > 16) out.push(pt);
  out.push(pts[pts.length - 1]);
  return out;
}
const chapterAt = (_v: number) => 0;

// ---- The camera director ----------------------------------------------------------------------
const angleTo = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
};
const ease = (dt: number, tau: number) => (snap ? 1 : 1 - Math.exp(-dt / tau));
/** The way the route goes over the next stretch: its direction and how straight it is. */
function stretch(v: number, len: number) {
  const a = routeAt(v),
    b = routeAt(Math.min(TOTAL, v + len)),
    dx = b.x - a.x,
    dz = b.z - a.z,
    chord = Math.hypot(dx, dz),
    arc = Math.min(TOTAL, v + len) - v;
  return { yaw: Math.atan2(dx, dz), across: Math.atan2(-dz, dx), straight: arc > 0 ? chord / arc : 1 };
}
function updateCamera(dt: number) {
  const L = routeAt(s),
    Ly = partyY(s);
  // Auto: across the screen where the way runs straight; following into the scene where it winds.
  if (mode === "auto") {
    if (snap || s - lastEval > 50) {
      lastEval = s;
      const st = stretch(s, 350),
        pick = st.straight > 0.82 ? "turn" : "follow";
      if (pick !== autoPick && (pending === pick || snap)) {
        autoPick = pick;
        pending = null;
      } else pending = pick !== autoPick ? pick : null;
    }
  }
  const m = mode === "auto" ? autoPick : mode;
  if (m !== current || snap) {
    if (m === "follow") followYaw = stretch(s, 600).yaw;
    current = m;
  }
  let tYaw: number;
  if (m === "turn") {
    const back = routeAt(s - 60),
      fwd = routeAt(s + 260);
    tYaw = Math.atan2(-(fwd.z - back.z), fwd.x - back.x);
  } else tYaw = followYaw;
  cam.yaw = snap ? tYaw : angleTo(cam.yaw, tYaw, ease(dt, m === "turn" ? 20 : 10));
  const fx = Math.sin(cam.yaw),
    fz = Math.cos(cam.yaw),
    rx = Math.cos(cam.yaw),
    rz = -Math.sin(cam.yaw);
  // The party in the camera's frame: how far ahead, how far across.
  const Lf = L.x * fx + L.z * fz,
    Lr = L.x * rx + L.z * rz;
  let cf = cam.x * fx + cam.z * fz,
    cr = cam.x * rx + cam.z * rz;
  if (snap) {
    cf = Lf - 120;
    cr = Lr;
  }
  let depth = Lf - cf;
  if (m === "follow") {
    // Let the party walk away into the scene (or towards us) before following.
    if (depth > 260) cf = Lf - 260;
    else if (depth < 55) cf = Lf - 55;
    else cf += (Lf - 120 - cf) * ease(dt, 90);
    const ahead = routeAt(s + 120),
      across = (ahead.x - L.x) * rx + (ahead.z - L.z) * rz;
    if (Math.abs(across) > 25) followFx += ((across > 0 ? LEAD_FX : 1 - LEAD_FX) - followFx) * ease(dt, 10);
  } else {
    cf += (Lf - 115 - cf) * ease(dt, 4);
    followFx += (LEAD_FX - followFx) * ease(dt, 6);
  }
  depth = Lf - cf;
  const tr = Lr - ((followFx - 0.5) * ART_W * depth) / F;
  cr += (tr - cr) * ease(dt, m === "turn" ? 4 : 6);
  const half = depth * Math.tan(FOV / 2) * 0.85;
  cr = Math.min(Lr + half, Math.max(Lr - half, cr));
  cam.x = fx * cf + rx * cr;
  cam.z = fz * cf + rz * cr;
  const floor = surfaceMax(cam.x, cam.z, 22) + 6,
    ty = Math.max(floor, Ly + 14 + depth * 0.13);
  cam.y = snap ? ty : cam.y + (ty - cam.y) * ease(dt, 3);
  if (cam.y < floor) cam.y = floor;
  snap = false;
}
/** The camera drawn with: turned and moved in whole-pixel steps (at the party's usual distance). */
function renderCamera(): Camera {
  if (!opt.snap) return { ...cam };
  const yaw = Math.round(cam.yaw * F) / F,
    fx = Math.sin(yaw),
    fz = Math.cos(yaw),
    rx = Math.cos(yaw),
    rz = -Math.sin(yaw),
    step = 120 / F,
    cf = cam.x * fx + cam.z * fz,
    cr = Math.round((cam.x * rx + cam.z * rz) / step) * step;
  return { x: fx * cf + rx * cr, z: fz * cf + rz * cr, y: Math.round(cam.y / step) * step, yaw };
}

// ---- Sprites ----------------------------------------------------------------------------------
const SLOTS = slotIndex(),
  DEFS = slotDefs();
// Plans by slot (filled from the packs): how each is drawn, and from what height in parts.
let PLANS: Plan[] = [],
  PART_BASE: number[] = [],
  PART_N: number[] = [];
/** The packs, as textures: atlases (material-and-shade, and colour), the table of what each slot shows at each height, the rows and columns tables, the parts, the palette. */
function buildSprites(packs: SlotPack[]): SpriteData {
  const nS = DEFS.length;
  packs.sort((a, b) => a.slot - b.slot);
  PLANS = [];
  for (const pk of packs) PLANS[pk.slot] = pk.plan;
  // Palette: every ramp once; each kind of tree's leaves in 16 colours, one ramp after another.
  const rampRows: number[][][] = [],
    rampIds = new Map<string, number>(),
    addRamp = (r: number[][]) => {
      const key = r.map((c) => c.map((v) => Math.round(v * 255)).join(",")).join(";");
      let id = rampIds.get(key);
      if (id === undefined) {
        id = rampRows.length;
        rampRows.push(r);
        rampIds.set(key, id);
      }
      return id;
    },
    family = new Map<string, number>();
  const leafFamily = (name: string) => {
    let base = family.get(name);
    if (base !== undefined) return base;
    base = rampRows.length;
    const R = mulberry(TREE_NAMES.indexOf(name) * 7919 + 3);
    for (let v = 0; v < 16; v++) {
      const dL = (R() - 0.5) * 0.09,
        dH = (R() - 0.5) * 0.4,
        ch = 0.8 + 0.35 * R();
      rampRows.push(rampOf(v === 0 ? hex(LEAF_HEX[name]) : shiftColor(hex(LEAF_HEX[name]), dL, dH, ch)));
    }
    family.set(name, base);
    return base;
  };
  const autumn0 = rampRows.length;
  for (const c of ["#c89a32", "#b8582c", "#a8b040"]) rampRows.push(rampOf(hex(c)));
  const mat = new Uint16Array(32 * nS);
  for (const pk of packs) {
    const kind = DEFS[pk.slot].name.split(" ")[0],
      tree = TREE_NAMES.includes(kind);
    let first = -1;
    for (const [m, r] of pk.ramps) {
      // Leaves: the tree's own colour (0x8000), and broadleaves may turn for autumn (0x4000).
      const turns = ["oak", "beech", "maple", "birch"].includes(kind),
        id = tree && m === M.LEAF ? leafFamily(kind) | 0x8000 | (turns ? 0x4000 : 0) : addRamp(r);
      if (first < 0) first = id & 0x3fff;
      mat[pk.slot * 32 + m] = id;
    }
    for (let m = 0; m < 32; m++) if (!pk.ramps.some(([q]) => q === m)) mat[pk.slot * 32 + m] = Math.max(0, first);
  }
  const pal = new Uint8Array(rampRows.length * 6 * 4);
  rampRows.forEach((r, i) => r.forEach((c, t) => pal.set([...c.map((v) => Math.round(v * 255)), 255], (i * 6 + t) * 4)));
  // Atlases: shelves 4096 wide, tallest first.
  type Item = { pic: { w: number; h: number; data: Uint8Array }; rgb: boolean; x: number; y: number };
  const items: Item[] = [],
    item = (pic: Item["pic"], rgb: boolean) => {
      const it = { pic, rgb, x: 0, y: 0 };
      items.push(it);
      return it;
    };
  const slotItems = packs.map((pk) => ({
    exact: pk.exact.map((q) => item(q, pk.plan.direct)),
    span: pk.span ? item(pk.span.pic, pk.plan.direct) : null,
    parts: pk.parts.map((q) => item(q.pic, false)),
  }));
  const shelve = (list: Item[]) => {
    list.sort((a, b) => b.pic.h - a.pic.h);
    let x = 0,
      y = 0,
      rowH = 0;
    for (const it of list) {
      if (x + it.pic.w > 4096) {
        x = 0;
        y += rowH + 1;
        rowH = 0;
      }
      it.x = x;
      it.y = y;
      x += it.pic.w + 1;
      rowH = Math.max(rowH, it.pic.h);
    }
    return y + rowH + 1;
  };
  const idxItems = items.filter((i) => !i.rgb),
    rgbItems = items.filter((i) => i.rgb),
    idxH = shelve(idxItems),
    rgbH = shelve(rgbItems),
    idx = new Uint8Array(4096 * idxH * 2),
    rgb = new Uint8Array(4096 * rgbH * 4);
  for (const it of idxItems)
    for (let y = 0; y < it.pic.h; y++)
      for (let x = 0; x < it.pic.w; x++) {
        const s4 = (y * it.pic.w + x) * 4,
          d = ((it.y + y) * 4096 + it.x + x) * 2;
        if (!it.pic.data[s4 + 3]) continue;
        idx[d] = it.pic.data[s4];
        idx[d + 1] = it.pic.data[s4 + 1];
      }
  for (const it of rgbItems)
    for (let y = 0; y < it.pic.h; y++) rgb.set(it.pic.data.subarray(y * it.pic.w * 4, (y + 1) * it.pic.w * 4), ((it.y + y) * 4096 + it.x) * 4);
  // What each slot shows at each height; the rows and columns tables; the parts.
  const EW = (HMAX + 1) * 2,
    entry = new Uint32Array(EW * nS * 4),
    tab: number[] = [],
    ptab: number[] = [],
    meta: number[] = [],
    per: number[] = [],
    xy = (it: Item) => it.x | (it.y << 16),
    wh = (w: number, h: number) => w | (h << 16),
    anc = (ax: number, ay: number) => (ax + 32768) | ((ay + 32768) << 16);
  PART_BASE = [];
  PART_N = [];
  let nParts = 0;
  packs.forEach((pk, k) => {
    const si = slotItems[k],
      pl = pk.plan,
      e = (H: number, t: number) => (pk.slot * EW + H * 2 + t) * 4;
    entry[e(0, 0)] = pl.K;
    for (let H = 1; H <= pl.E && H <= pl.K; H++) {
      const q = pk.exact[H - 1],
        it = si.exact[H - 1];
      entry.set([xy(it), wh(q.w, q.h), wh(q.w, q.h), anc(q.ax, q.ay)], e(H, 0));
      entry.set([1 | ((pl.direct ? 1 : 0) << 4), 0, 0, 0], e(H, 1));
    }
    if (pk.span && si.span) {
      const sp = pk.span,
        rb = tab.length;
      for (const v of sp.rows) tab.push(v);
      const cb = tab.length;
      for (const v of sp.cols) tab.push(v);
      for (let H = sp.h0; H <= sp.h1; H++) {
        const o = (H - sp.h0) * 6;
        entry.set([xy(si.span), wh(sp.pic.w, sp.pic.h), wh(sp.per[o + 3], sp.per[o + 2]), anc(sp.per[o + 4], sp.per[o + 5])], e(H, 0));
        entry.set([2 | ((pl.direct ? 1 : 0) << 4), rb + sp.per[o], cb + sp.per[o + 1], 0], e(H, 1));
      }
    }
    PART_BASE[pk.slot] = nParts;
    PART_N[pk.slot] = pk.parts.length;
    if (pl.T > 0) for (let H = pl.T; H <= pl.K; H++) entry.set([3, 0, 0, 0], e(H, 1));
    pk.parts.forEach((q, i) => {
      const it = si.parts[i],
        rb = ptab.length;
      for (const v of q.rows) ptab.push(v);
      const cb = ptab.length;
      for (const v of q.cols) ptab.push(v);
      meta.push(xy(it), wh(q.pic.w, q.pic.h), anc(q.cx, q.cy), q.hMin, per.length / 4, q.cell, 0, 0);
      for (let h = q.hMin; h <= q.pic.h; h++) {
        const o = (h - q.hMin) * 5;
        per.push(rb + q.per[o], cb + q.per[o + 1], q.per[o + 2] | (q.per[o + 3] << 16), q.per[o + 4]);
      }
      nParts++;
    });
  });
  const wrap4096 = <T extends Uint8Array | Uint16Array | Uint32Array>(src: number[], ctor: new (n: number) => T, comps: number) => {
    const texels = src.length / comps,
      h = Math.max(1, Math.ceil(texels / 4096)),
      data = new ctor(4096 * h * comps);
    data.set(src as unknown as ArrayLike<number>);
    return { w: 4096, h, data };
  };
  return {
    idx: { w: 4096, h: idxH, data: idx },
    rgb: { w: 4096, h: rgbH, data: rgb },
    entry: { w: EW, h: nS, data: entry },
    tab: wrap4096(tab, Uint16Array, 1),
    ptab: wrap4096(ptab, Uint8Array, 1),
    mat: { w: 32, h: nS, data: mat },
    pal: { h: rampRows.length, data: pal },
    meta: wrap4096(meta, Uint32Array, 4),
    per: wrap4096(per, Uint32Array, 4),
    autumn0,
  };
}

/**
 * The trees (or shrubs) in a list that could come near enough to be drawn in parts before the list is
 * next rebuilt: those within reach of the camera where it was then, with a margin for how far it
 * may move meanwhile. So a frame looks at a few hundred, not every sprite.
 */
function nearSubset(d: Float32Array, cx: number, cz: number, margin: number) {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 6) {
    const pl = PLANS[d[i + 4]];
    if (!pl || !pl.T) continue;
    const reach = (d[i + 3] * F) / (pl.T - 2) + margin,
      dx = d[i] - cx,
      dz = d[i + 2] - cz;
    if (dx * dx + dz * dz > reach * reach) continue;
    for (let k = 0; k < 6; k++) out.push(d[i + k]);
  }
  return Float32Array.from(out);
}
/** Trees and shrubs near enough this frame to be drawn in parts: grouped by slot, for one draw each. */
let partTrees = new Float32Array(4096 * 8);
function partsFrame(c: Camera, lists: { data: Float32Array; near: number; far: number }[]): PartsFrame {
  const fx = Math.sin(c.yaw),
    fz = Math.cos(c.yaw),
    rx = Math.cos(c.yaw),
    rz = -Math.sin(c.yaw),
    tan = Math.tan(FOV / 2),
    bySlot = new Map<number, { l: number; i: number }[]>();
  lists.forEach((l, li) => {
    const d = l.data;
    for (let i = 0; i < d.length; i += 6) {
      const slot = d[i + 4],
        pl = PLANS[slot];
      if (!pl || !pl.T) continue;
      const ex = d[i] - c.x,
        ez = d[i + 2] - c.z,
        vz = ex * fx + ez * fz;
      if (vz < 1.5 || vz < l.near * 0.9 || vz > l.far) continue;
      const want = (d[i + 3] * F) / vz;
      if (want < pl.T - 2 || Math.abs(ex * rx + ez * rz) > vz * tan + d[i + 3]) continue;
      let b = bySlot.get(slot);
      if (!b) bySlot.set(slot, (b = []));
      b.push({ l: li, i });
    }
  });
  let n = 0;
  for (const b of bySlot.values()) n += b.length;
  if (partTrees.length < n * 8) partTrees = new Float32Array(Math.ceil((n * 8) / 32768) * 32768);
  const draws: PartsFrame["draws"] = [];
  let k = 0;
  for (const [slot, b] of bySlot) {
    const pl = PLANS[slot],
      l0 = lists[b[0].l];
    draws.push({ slot, partBase: PART_BASE[slot], nc: PART_N[slot], treeBase: k, count: b.length, K: pl.K, T: pl.T, near: l0.near, far: l0.far });
    for (const { l, i } of b) {
      const d = lists[l].data;
      partTrees.set([d[i], d[i + 1], d[i + 2], d[i + 3], slot, d[i + 5], 0, 0], k * 8);
      k++;
    }
  }
  return { trees: partTrees.subarray(0, n * 8), draws };
}

/** Ground cover for one 32 m tile: what grows depends on the biome (its look: grass, flowers,
 * shrubs, boulders, scree) and on the ground (woods, rock, scree, shore, the road). */
const BLOOMS: [string, number[]][] = [["white", [232, 228, 216]], ["yellow", [226, 192, 64]], ["purple", [138, 100, 176]], ["red", [196, 80, 60]]];
const coverLists = new Map<number, [string, number][]>();
function coverFor(b: number, kind: number): [string, number][] {
  if (kind === KIND.ROCK) return [["stone", 0.04], ["boulder2", 0.006]];
  if (kind === KIND.SCREE) return [["stone", 0.18], ["stone2", 0.1], ["boulder", 0.02], ["boulder2", 0.02]];
  if (kind === KIND.SHORE) return [["stone", 0.25], ["stone2", 0.15], ["boulder2", 0.01]];
  if (kind === KIND.SNOW) return [["stone", 0.01]];
  const key = b * 32 + kind;
  let list = coverLists.get(key);
  if (list) return list;
  const look = BIOME_DEFS[b],
    dry = look.zone === ZONE.STEPPE || look.zone === ZONE.DESERT || look.zone === ZONE.SAVANNA || look.zone === ZONE.MEDITERRANEAN,
    woods = kind === KIND.FOREST || kind === KIND.CONIFER,
    moist = look.ground === "moss" || look.zone === ZONE.OCEANIC || look.zone === ZONE.RAINFOREST || look.zone === ZONE.MONSOON,
    bc = [1, 3, 5].map((k) => parseInt(look.bloom.slice(k, k + 2), 16)),
    bloom = BLOOMS.reduce((a, c) => (Math.hypot(...c[1].map((v, k) => v - bc[k])) < Math.hypot(...a[1].map((v, k) => v - bc[k])) ? c : a))[0];
  const tufts = Math.min(0.5, look.tufts * (woods ? 0.25 : 0.55));
  list = [];
  if (tufts > 0) list.push(dry ? ["dry grass", tufts] : ["grass", tufts * 0.6], dry ? ["grass2", tufts * 0.15] : ["grass2", tufts * 0.4]);
  if (look.flowers > 0) list.push([`flowers ${bloom}`, Math.min(0.08, look.flowers * 0.5)]);
  if (woods && moist) list.push(["fern", 0.1], ["fern2", 0.06]);
  if (look.reeds > 0) list.push(["grass2", look.reeds * 0.2]);
  if (look.shrubs > 0) list.push(["shrub", Math.min(0.12, look.shrubs * 0.35)], ["shrub2", Math.min(0.06, look.shrubs * 0.15)]);
  if (look.boulders > 0) list.push(["boulder", Math.min(0.03, look.boulders * 3)]);
  if (look.scree > 0.5 || kind === KIND.SAND) list.push(["stone", 0.015 * look.scree + (kind === KIND.SAND ? 0.01 : 0)]);
  coverLists.set(key, list);
  return list;
}
const COVER_PATH: [string, number][] = [["stone2", 0.01]];
const TILE = 32;
function coverTile(tx: number, tz: number): Float32Array {
  const out: number[] = [],
    R = mulberry(tx * 92821 + tz * 68917 + 7),
    n = Math.round(TILE * TILE * 0.65);
  for (let k = 0; k < n; k++) {
    const x = tx * TILE + R() * TILE,
      z = tz * TILE + R() * TILE;
    if (!inside(0, x, z)) continue;
    const ri = Math.round((z - FINE.z0) / FINE.cell) * FINE.n + Math.round((x - FINE.x0) / FINE.cell),
      rd = FINE_R[ri] / 20;
    if (FINE_B[ri] === 255) continue;
    const list = rd < 2.1 ? COVER_PATH : coverFor(FINE_B[ri], FINE_K[ri]);
    let r = R() * 0.65;
    for (const [name, d] of list) {
      if ((r -= d) < 0) {
        const slot = SLOTS.get(name)!;
        out.push(x, heightIn(0, x, z) - 0.05, z, DEFS[slot].worldH * (0.75 + 0.5 * R()), slot, 2);
        break;
      }
    }
  }
  return Float32Array.from(out);
}
const coverCache = new Map<number, Float32Array>();
let coverKey = "";
/** Is a disc (centre x, z, radius r) at all in view of a camera at (cx, cz) facing yaw, within far? */
function inView(x: number, z: number, r: number, cx: number, cz: number, yaw: number, far: number) {
  const ex = x - cx,
    ez = z - cz,
    d = ex * Math.sin(yaw) + ez * Math.cos(yaw),
    l = ex * Math.cos(yaw) - ez * Math.sin(yaw);
  return d > -r && d < far + r && Math.abs(l) < Math.max(0, d) * Math.tan(FOV / 2 + 0.15) + r * 1.5;
}

// Trees, kept by 128 m buckets so a frame hands the GPU only those in view.
const TBK = 128,
  TNB = Math.ceil((FINE.n * FINE.cell) / TBK);
let treeAll = new Float32Array(0),
  treeStart = new Int32Array(TNB * TNB + 1),
  treeOut = new Float32Array(0),
  lastCull = { x: 1e9, z: 0, yaw: 0 };
function bucketTrees(t: Float32Array) {
  const n = t.length / 6,
    count = new Int32Array(TNB * TNB + 1),
    bk = (i: number) =>
      Math.min(TNB - 1, Math.max(0, Math.floor((t[i * 6 + 2] - FINE.z0) / TBK))) * TNB + Math.min(TNB - 1, Math.max(0, Math.floor((t[i * 6] - FINE.x0) / TBK)));
  for (let i = 0; i < n; i++) count[bk(i) + 1]++;
  for (let b = 0; b < TNB * TNB; b++) count[b + 1] += count[b];
  treeStart = count.slice();
  treeAll = new Float32Array(t.length);
  treeOut = new Float32Array(t.length);
  const fill = count.slice();
  for (let i = 0; i < n; i++) treeAll.set(t.subarray(i * 6, i * 6 + 6), fill[bk(i)]++ * 6);
}
function cullTrees(c: Camera) {
  let dy = c.yaw - lastCull.yaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  if (Math.hypot(c.x - lastCull.x, c.z - lastCull.z) < 15 && Math.abs(dy) < 0.05) return null;
  if (!treeAll.length) return new Float32Array(0);
  lastCull = { x: c.x, z: c.z, yaw: c.yaw };
  let n = 0;
  for (let bz = 0; bz < TNB; bz++)
    for (let bx = 0; bx < TNB; bx++) {
      const b = bz * TNB + bx,
        a0 = treeStart[b],
        a1 = treeStart[b + 1];
      if (a0 === a1 || !inView(FINE.x0 + bx * TBK + TBK / 2, FINE.z0 + bz * TBK + TBK / 2, TBK * 0.75, c.x, c.z, c.yaw, 6000)) continue;
      treeOut.set(treeAll.subarray(a0 * 6, a1 * 6), n);
      n += (a1 - a0) * 6;
    }
  return treeOut.subarray(0, n);
}
function coverAround(x: number, z: number, yaw: number) {
  const RAD = 210,
    fx = Math.sin(yaw),
    fz = Math.cos(yaw),
    cx = x + fx * RAD * 0.6,
    cz = z + fz * RAD * 0.6,
    t0x = Math.floor((cx - RAD) / TILE),
    t1x = Math.floor((cx + RAD) / TILE),
    t0z = Math.floor((cz - RAD) / TILE),
    t1z = Math.floor((cz + RAD) / TILE),
    key = `${t0x},${t0z},${Math.round(yaw * 8)}`;
  if (key === coverKey) return null;
  coverKey = key;
  const parts: Float32Array[] = [],
    keep = new Set<number>();
  for (let tz = t0z; tz <= t1z; tz++)
    for (let tx = t0x; tx <= t1x; tx++) {
      const k = tz * 100000 + tx;
      if (!inView(tx * TILE + TILE / 2, tz * TILE + TILE / 2, TILE, x, z, yaw, RAD * 1.6)) continue;
      keep.add(k);
      let t = coverCache.get(k);
      if (!t) coverCache.set(k, (t = coverTile(tx, tz)));
      parts.push(t);
    }
  for (const k of coverCache.keys()) if (!keep.has(k)) coverCache.delete(k);
  let n = 0;
  for (const p of parts) n += p.length;
  const all = new Float32Array(n);
  n = 0;
  for (const p of parts) {
    all.set(p, n);
    n += p.length;
  }
  return all;
}

/** The party (and its marker), and the others on the road (the carter, the ox and the cart), this frame. */
function actors(c: Camera) {
  const out: number[] = [],
    others: number[] = [],
    fx = Math.sin(c.yaw),
    fz = Math.cos(c.yaw),
    rx = Math.cos(c.yaw),
    rz = -Math.sin(c.yaw);
  const facing = (hx: number, hz: number) => {
    const lat = hx * rx + hz * rz,
      dep = hx * fx + hz * fz;
    if (Math.abs(dep) > 1.3 * Math.abs(lat)) return { f: dep > 0 ? 2 : 1, mirror: 0 };
    return { f: 0, mirror: lat < 0 ? 1 : 0 };
  };
  for (let m = 3; m >= 0; m--) {
    const sm = Math.max(0, s - m * 2.8),
      p = routeAt(sm),
      fc = facing(p.hx, p.hz),
      frame = Math.floor((walked - m * 2.8) / 0.6) & 3;
    out.push(p.x, partyY(sm), p.z, 1.75, SLOTS.get(`person ${m} ${fc.f} ${frame}`)!, fc.mirror);
  }
  if (opt.marker) {
    const p = routeAt(s);
    out.push(p.x, partyY(s) + 2.4, p.z, 1, SLOTS.get("marker")!, 4);
  }
  return { party: Float32Array.from(out), others: Float32Array.from(others) };
}

// ---- Clouds: a band of pixel-art cumulus all round the sky --------------------------------------
function buildClouds() {
  const W = Math.round(2 * Math.PI * F),
    H = Math.round(0.36 * F),
    data = new Uint8Array(W * H * 4),
    R = mulberry(99);
  const put = (x: number, y: number, c: number[]) => {
    const xx = ((x % W) + W) % W;
    if (y < 0 || y >= H) return;
    const o = (y * W + xx) * 4;
    data.set([c[0], c[1], c[2], 255], o);
  };
  for (let k = 0; k < 70; k++) {
    const e = 0.015 + 0.25 * R() ** 1.6,
      size = (0.35 + 0.7 * R()) * (10 + e * 170),
      cx = R() * W,
      base = Math.round(e * F),
      puffs = 3 + Math.floor(R() * 5),
      list: { x: number; y: number; r: number }[] = [];
    for (let p = 0; p < puffs; p++) {
      const u = puffs === 1 ? 0 : p / (puffs - 1) - 0.5,
        r = size * (0.22 + 0.2 * (1 - Math.abs(u) * 1.6) + 0.08 * R());
      list.push({ x: cx + u * size * 1.4, y: base + r * (0.55 + 0.3 * R()), r });
    }
    const x0 = Math.floor(cx - size * 1.2),
      x1 = Math.ceil(cx + size * 1.2),
      y1 = Math.ceil(base + size * 1.2);
    for (let y = base; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        let best = 1e9,
          bp = list[0];
        for (const p of list) {
          const d = Math.hypot(x - p.x, y - p.y) / p.r;
          if (d < best) {
            best = d;
            bp = p;
          }
        }
        if (best > 1) continue;
        // Lit from above left; flat, shadowed bases (rows count up from the horizon).
        const nx = (x - bp.x) / bp.r,
          ny = (y - bp.y) / bp.r,
          lit = -0.5 * nx + 0.8 * ny,
          low = y - base < Math.max(1, size * 0.08);
        const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
          v = lit + (BAY[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.25,
          c = low ? [198, 208, 224] : v > 0.45 ? [250, 250, 246] : v > 0.05 ? [236, 239, 244] : v > -0.35 ? [220, 227, 238] : [204, 213, 229];
        put(x, y, c);
      }
  }
  return { W, H, data };
}

// ---- The page ------------------------------------------------------------------------------------
const view = $("view") as HTMLCanvasElement,
  area = $("viewarea");
let renderer: Renderer;
try {
  renderer = new Renderer(view);
} catch (err) {
  $("loading").textContent = `This needs WebGL2, which isn't available here (${(err as Error).message.split("\n")[0]}).`;
  throw err;
}
function layout() {
  const r = area.getBoundingClientRect(),
    aspect = ART_W / ART_H;
  let w = r.width,
    h = w / aspect;
  if (h > r.height) {
    h = r.height;
    w = h * aspect;
  }
  w = Math.max(100, Math.floor(w));
  h = Math.max(65, Math.floor(h));
  view.style.width = `${w}px`;
  view.style.height = `${h}px`;
  const dpr = window.devicePixelRatio || 1;
  view.width = Math.round(w * dpr);
  view.height = Math.round(h * dpr);
  const m = $("map") as HTMLCanvasElement,
    mr = m.getBoundingClientRect();
  m.width = Math.round(mr.width * dpr);
  m.height = Math.round(mr.height * dpr);
}
addEventListener("resize", layout);

// The map: the whole world from above, north up: its biomes, shaded; the fine grid's square.
const MAPN = 256,
  mapBase = document.createElement("canvas");
mapBase.width = MAPN;
mapBase.height = MAPN;
const MAP_RGB = BIOME_MAP.map((b) => [1, 3, 5].map((k) => parseInt(b.color.slice(k, k + 2), 16)));
function buildMap() {
  const c = mapBase.getContext("2d")!,
    im = c.createImageData(MAPN, MAPN),
    L = land(),
    size = worldSize();
  for (let py = 0; py < MAPN; py++)
    for (let px = 0; px < MAPN; px++) {
      const u = Math.floor(((px + 0.5) / MAPN) * L.n),
        v = Math.floor(((py + 0.5) / MAPN) * L.n),
        i = v * L.n + u,
        hx = L.h[v * L.n + Math.min(L.n - 1, u + 1)] - L.h[i],
        sh = 0.85 + Math.max(-0.3, Math.min(0.3, -hx * 0.004)),
        b = L.biome[i],
        rgb = L.wet[i] > -1e8 ? [79, 126, 158] : (MAP_RGB[b] ?? [100, 100, 100]);
      im.data.set([rgb[0] * sh, rgb[1] * sh, rgb[2] * sh, 255], (py * MAPN + px) * 4);
    }
  c.putImageData(im, 0, 0);
  void size;
}
function drawMap(c2: Camera) {
  const m = $("map") as HTMLCanvasElement,
    c = m.getContext("2d")!,
    n = m.width,
    size = worldSize(),
    k = n / size,
    mx = (x: number) => x * k,
    my = (z: number) => (size - z) * k,
    u = n / 236;
  c.imageSmoothingEnabled = false;
  c.drawImage(mapBase, 0, 0, n, n);
  c.lineCap = "round";
  c.lineJoin = "round";
  // Places to go, and the fine grid's square (where the walk is).
  c.fillStyle = "rgba(244,239,226,0.9)";
  for (const pl of land().places) {
    c.beginPath();
    c.arc(mx(pl.x), my(pl.z), 2 * u, 0, 7);
    c.fill();
  }
  c.strokeStyle = "rgba(244,239,226,0.8)";
  c.lineWidth = u;
  c.strokeRect(mx(FINE.x0), my(FINE.z0 + FINE.cell * FINE.n), FINE.cell * FINE.n * k, FINE.cell * FINE.n * k);
  c.strokeStyle = "rgba(244,239,226,0.95)";
  c.lineWidth = 1.6 * u;
  c.beginPath();
  ROUTE.forEach(([x, z], i) => (i ? c.lineTo(mx(x), my(z)) : c.moveTo(mx(x), my(z))));
  c.stroke();
  const L = 12000,
    a0 = c2.yaw - FOV / 2,
    a1 = c2.yaw + FOV / 2;
  c.fillStyle = "rgba(127,196,255,0.22)";
  c.strokeStyle = "rgba(127,196,255,0.9)";
  c.lineWidth = u;
  c.beginPath();
  c.moveTo(mx(c2.x), my(c2.z));
  c.lineTo(mx(c2.x + Math.sin(a0) * L), my(c2.z + Math.cos(a0) * L));
  c.lineTo(mx(c2.x + Math.sin(a1) * L), my(c2.z + Math.cos(a1) * L));
  c.closePath();
  c.fill();
  c.stroke();
  const p = routeAt(s);
  c.fillStyle = "#e9a95a";
  c.strokeStyle = "#121419";
  c.lineWidth = 1.5 * u;
  c.beginPath();
  c.arc(mx(p.x), my(p.z), 4 * u, 0, 7);
  c.fill();
  c.stroke();
}

const NOTES: Record<string, string> = {
  auto: "Picks for each stretch: Turn where the way runs straight, Follow where it winds.",
  follow: "Faces the way the route is heading and lets the party walk away into the scene before moving after them.",
  turn: "Swings round as the route turns, so the party walks across the screen while the land turns behind them.",
};
let hudAt = 0,
  fps = 60,
  cpuMs = 0;
function hud(now: number, c2: Camera) {
  if (now - hudAt < 300) return;
  hudAt = now;
  const p = routeAt(s),
    ex = p.x - c2.x,
    ez = p.z - c2.z,
    d = ex * Math.sin(c2.yaw) + ez * Math.cos(c2.yaw),
    px = (1.75 * F) / Math.max(1, d),
    st = renderer.stats;
  $("r-stretch").textContent = place.name;
  $("r-camera").textContent = mode === "auto" ? `auto: ${current}` : current;
  $("r-dist").textContent = `${Math.round(Math.hypot(ex, ez))} m from the camera`;
  $("r-size").textContent = `${px.toFixed(1)} px tall, ${Math.round(px * (1084 / ART_W))} mm on the wall`;
  $("r-fps").textContent = `${fps.toFixed(0)} fps · ${cpuMs.toFixed(1)} ms on the CPU`;
  $("r-gpu").textContent = renderer.timer.ext ? `${renderer.timer.ms.toFixed(1)} ms` : "no timer here";
  $("r-drawn").textContent = `${(st.tris / 1e6).toFixed(2)} M triangles · ${(st.sprites / 1000).toFixed(0)} k sprites · ${st.partTrees} trees in ${(st.parts / 1000).toFixed(1)} k parts`;
}

function setPressed(sel: string, el: Element) {
  document.querySelectorAll(sel).forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
}
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      mode = b.dataset.mode as typeof mode;
      snap = true;
      setPressed("[data-mode]", b);
      $("mode-note").textContent = NOTES[mode];
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(
  (b) =>
    (b.onclick = () => {
      speed = Number(b.dataset.speed);
      paused = false;
      $("play").textContent = "Pause";
      setPressed("[data-speed]", b);
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach(
  (b) =>
    (b.onclick = () => {
      const k = b.dataset.toggle as keyof typeof opt;
      opt[k] = !opt[k];
      b.setAttribute("aria-pressed", String(opt[k]));
    }),
);
$("play").onclick = () => {
  paused = !paused;
  $("play").textContent = paused ? "Play" : "Pause";
};
/** Buttons for the places to go (once the world is made). */
function placeButtons() {
  const el = $("chapters");
  el.querySelectorAll("button").forEach((b) => b.remove());
  land().places.forEach((pl, i) => {
    const b = document.createElement("button");
    b.textContent = pl.name;
    b.id = `c-${i}`;
    b.setAttribute("aria-pressed", String(i === placeIndex));
    b.onclick = () => goPlace(i);
    el.appendChild(b);
  });
}
// Seeking: a slider along the whole route, steps of 10 and 100 m, a single frame on.
const routeEl = $("route") as HTMLInputElement;
let dragging = false;
const seekTo = (v: number) => {
  s = Math.min(TOTAL - 1, Math.max(0, v));
  snap = true;
  showRoute();
};
function showRoute() {
  if (!dragging) routeEl.value = String(Math.round(s));
  $("route-at").textContent = `${(s / 1000).toFixed(2)} of ${(TOTAL / 1000).toFixed(1)} km · ${place.name}`;
}
routeEl.oninput = () => {
  dragging = true;
  seekTo(Number(routeEl.value));
};
routeEl.onchange = () => (dragging = false);
document.querySelectorAll<HTMLButtonElement>("[data-seek]").forEach((b) => (b.onclick = () => seekTo(s + Number(b.dataset.seek))));
$("frame-step").onclick = () => {
  if (!paused) $("play").click();
  stepOnce = true;
};
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
  if (e.key === " ") {
    $("play").click();
    e.preventDefault();
  }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    seekTo(s + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 100 : 10));
    e.preventDefault();
  }
  if (e.key === ".") $("frame-step").click();
});
$("mode-note").textContent = NOTES[mode];
if (paused) $("play").textContent = "Play";

// ---- Making the world, and the land at a place --------------------------------------------------------
// Workers make the sprites and today's world; the world's land goes to every worker; then they build
// the grids' bands for the place being visited (the far grid once: it covers the whole world).
const nW = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)),
  workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })),
  workers: Worker[] = [],
  idle: Worker[] = [],
  queue: { msg: any; done: (d: any) => void }[] = [],
  running = new Map<Worker, { msg: any; done: (d: any) => void }>();
function run(msg: any, done: (d: any) => void) {
  queue.push({ msg, done });
  pump();
}
function pump() {
  while (idle.length && queue.length) {
    const w = idle.pop()!,
      j = queue.shift()!;
    running.set(w, j);
    w.postMessage(j.msg);
  }
}
const today = new Date(),
  SEED = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
let worldProgress = 0;
for (let k = 0; k < nW; k++) {
  const w = new Worker(workerUrl);
  w.onmessage = (e) => {
    if (e.data.progress !== undefined) {
      worldProgress = e.data.progress;
      $("loading").textContent = `Making today's world… ${Math.round(worldProgress * 100)}%`;
      return;
    }
    const j = running.get(w)!;
    running.delete(w);
    idle.push(w);
    j.done(e.data);
    pump();
  };
  workers.push(w);
  idle.push(w);
}
const spritePacks: SlotPack[] = [];
let treeParts: Float32Array[] = [],
  spritesLeft = 0,
  ready = false,
  treesList: Sprites | null = null,
  coverList: Sprites | null = null,
  partyList: Sprites | null = null,
  actorList: Sprites | null = null;
const t0 = performance.now();
let buildMs = 0,
  started = false;

// Sprites: trees and shrubs one slot a job (the heavy ones), the rest a dozen at a time.
const nSlots = DEFS.length;
for (let a = 0; a < nSlots; ) {
  const heavy = DEFS[a].maxClass >= 25 || DEFS[a].name.startsWith("shrub");
  let to = a + 1;
  if (!heavy) while (to < Math.min(nSlots, a + 12) && !(DEFS[to].maxClass >= 25 || DEFS[to].name.startsWith("shrub"))) to++;
  spritesLeft++;
  run({ type: "sprites", from: a, to }, (d) => {
    spritePacks.push(...d.slots);
    spritesLeft--;
    maybeStart();
  });
  a = to;
}
// Today's world, first in the queue.
queue.unshift({
  msg: { type: "world", seed: SEED, n: 512 },
  done: (d) => onWorld(d.world),
});
pump();

/** Each biome's grass, leaves and sand, for the ground's palette. */
function biomeRamps() {
  const out: number[][][] = [];
  for (const b of BIOME_DEFS) {
    const sand = b.ground === "sand" ? b.earth : b.ground === "snow" ? "#e4ecf4" : b.earth;
    out.push(rampOf(hex(b.grass)), rampOf(hex(b.leaf)), rampOf(hex(sand)));
  }
  return out;
}
function onWorld(w: World2D) {
  const L = landFromWorld(w);
  setLand(L);
  for (const wk of workers) wk.postMessage({ type: "land", data: L });
  renderer.setBiomeRamps(biomeRamps());
  buildMap();
  placeButtons();
  goPlace(0);
}
let bandsLeft = 0;
/** Go to a place: lay the mid and fine grids over it, plan its walk, rebuild their bands. */
function goPlace(i: number) {
  const L: LandData = land();
  placeIndex = Math.min(L.places.length - 1, Math.max(0, i));
  place = L.places[placeIndex];
  placeGrids(place.x, place.z, worldSize());
  ROUTE.splice(0, ROUTE.length, ...planRoute(place));
  RC = cumulative(ROUTE);
  TOTAL = RC[RC.length - 1];
  routeEl.max = String(Math.floor(TOTAL - 1));
  s = 0;
  walked = 0;
  snap = true;
  document.querySelectorAll("#chapters button").forEach((b) => b.setAttribute("aria-pressed", String(b.id === `c-${placeIndex}`)));
  $("loading").hidden = false;
  $("loading").textContent = `Going to ${place.name}…`;
  treeParts = [];
  const grids = started ? [1, 0] : [2, 1, 0],
    route = ROUTE.map((p) => [p[0], p[1]]);
  for (const gi of grids)
    for (let r = 0; r < GRIDS[gi].n; r += 128) {
      bandsLeft++;
      run({ type: "band", gi, r0: r, r1: Math.min(GRIDS[gi].n, r + 128), spec: { ...GRIDS[gi] }, route }, (d) => {
        const b = d.band,
          g = GRIDS[b.gi];
        renderer.uploadBand(b.gi, b.r0, b.r1, b.h, b.nrm, b.kind, b.road);
        HGT[b.gi].set(b.h, b.r0 * g.n);
        if (b.gi === 0) {
          for (let q = 0; q < b.kind.length / 2; q++) {
            FINE_K[b.r0 * g.n + q] = b.kind[q * 2];
            FINE_B[b.r0 * g.n + q] = b.kind[q * 2 + 1];
          }
          FINE_R.set(b.road, b.r0 * g.n);
          treeParts.push(b.trees);
        }
        bandsLeft--;
        if (!bandsLeft) placeReady();
        else $("loading").textContent = `${started ? `Going to ${place.name}` : "Building the land"}… ${Math.round((1 - bandsLeft / 400) * 100)}%`;
      });
    }
}
function placeReady() {
  // Trees: x, y, z, height, slot (kind * 3 + variant), flipped with the sun.
  let n = 0;
  for (const t of treeParts) n += t.length / 6;
  const trees = new Float32Array(n * 6);
  let o = 0;
  for (const t of treeParts)
    for (let i = 0; i < t.length; i += 6) {
      trees.set([t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4] * 3 + t[i + 5], 2], o);
      o += 6;
    }
  bucketTrees(trees);
  lastCull = { x: 1e9, z: 0, yaw: 0 };
  coverCache.clear();
  coverKey = "";
  snap = true;
  maybeStart();
  if (started) $("loading").hidden = true;
}
function maybeStart() {
  if (started || spritesLeft > 0 || bandsLeft > 0 || !treeParts.length) return;
  started = true;
  buildMs = performance.now() - t0;
  renderer.setSprites(buildSprites(spritePacks));
  const cl = buildClouds();
  renderer.setClouds(cl.W, cl.H, cl.data);
  treesList = renderer.sprites(new Float32Array(0));
  coverList = renderer.sprites(new Float32Array(0));
  actorList = renderer.sprites(new Float32Array(0));
  partyList = renderer.sprites(new Float32Array(0));
  $("loading").hidden = true;
  layout();
  ready = true;
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}
void MID;
void FAR;
void hash2;

// ---- Checking motion on this device ----------------------------------------------------------------
/**
 * How much of a frame does not move like pixel art: for each 8 x 8 block, the best whole-pixel shift
 * of the frame before it (up to 4 px across, 2 up or down), and the pixels that shift still leaves
 * wrong. Rigid layers scrolling by whole pixels leave none; shimmer, crawling edges and popping do.
 */
export function unexplained(prev: Uint8Array, cur: Uint8Array, W: number, H: number) {
  const a = new Uint32Array(prev.buffer, prev.byteOffset, W * H),
    b = new Uint32Array(cur.buffer, cur.byteOffset, W * H),
    BS = 8,
    quarters = [0, 0, 0, 0],
    totals = [0, 0, 0, 0];
  let bad = 0,
    all = 0,
    changed = 0;
  for (let i = 0; i < W * H; i++) if (a[i] !== b[i]) changed++;
  for (let by = 0; by + BS <= H; by += BS)
    for (let bx = 0; bx + BS <= W; bx += BS) {
      let best = BS * BS;
      for (let dy = 0; dy <= 4 && best > 0; dy++)
        for (let dx = 0; dx <= 8 && best > 0; dx++) {
          const sy = dy & 1 ? -((dy + 1) >> 1) : dy >> 1,
            sx = dx & 1 ? -((dx + 1) >> 1) : dx >> 1;
          if (bx + sx < 0 || by + sy < 0 || bx + sx + BS > W || by + sy + BS > H) continue;
          let m = 0;
          for (let y = 0; y < BS && m < best; y++) {
            let i = (by + y) * W + bx,
              j = (by + y + sy) * W + bx + sx;
            for (let x = 0; x < BS; x++, i++, j++) if (b[i] !== a[j]) m++;
          }
          if (m < best) best = m;
        }
      // readPixels rows run bottom-up: quarter 0 is the top of the picture.
      const q = Math.min(3, Math.floor(((H - 1 - by) / H) * 4));
      quarters[q] += best;
      totals[q] += BS * BS;
      bad += best;
      all += BS * BS;
    }
  return { unexplained: bad / all, changed: changed / (W * H), byQuarter: quarters.map((v, i) => v / Math.max(1, totals[i])) };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function runCheck(o: { quick?: boolean; timing?: boolean; settle?: number; frames?: number } = {}) {
  const quick = !!o.quick;
  const btn = $("check") as HTMLButtonElement,
    outEl = $("check-out"),
    say = (t: string) => (outEl.textContent = t),
    keep = { mode, speed, paused, snap: opt.snap, s };
  btn.disabled = true;
  const gl = renderer.gl,
    dbg = gl.getExtension("WEBGL_debug_renderer_info"),
    result: Record<string, unknown> = {
      at: new Date().toISOString(),
      device: {
        gpu: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
        agent: navigator.userAgent,
        cores: navigator.hardwareConcurrency || 0,
        dpr: window.devicePixelRatio || 1,
        screen: `${screen.width}x${screen.height}`,
        canvas: `${view.width}x${view.height}`,
      },
      buildMs: Math.round(buildMs),
    };
  try {
    // 1. Frame times as it runs, on three stretches (the loop must be running).
    if (hold) {
      hold = false;
      requestAnimationFrame((t) => {
        last = t;
        frame(t);
      });
    }
    const stretches = [];
    // Three stretches of this place's walk: the start, the middle, near the end.
    for (const [name, at] of o.timing === false ? [] : ([["start", 0.08], ["middle", 0.45], ["end", 0.8]] as const)) {
      say(`Timing frames: the ${name} of the walk…`);
      mode = "auto";
      speed = 6;
      paused = false;
      s = TOTAL * at;
      snap = true;
      await pause(quick ? 300 : 1200);
      frameLog = [];
      await pause(quick ? 1500 : 5000);
      const log = frameLog;
      frameLog = null;
      const dts = log.map((l) => l[0]).sort((x, y) => x - y),
        mean = dts.reduce((x, y) => x + y, 0) / Math.max(1, dts.length);
      stretches.push({
        name,
        frames: dts.length,
        meanMs: +mean.toFixed(1),
        p95Ms: +(dts[Math.floor(dts.length * 0.95)] ?? 0).toFixed(1),
        maxMs: +(dts[dts.length - 1] ?? 0).toFixed(1),
        cpuMs: +(log.reduce((x, l) => x + l[1], 0) / Math.max(1, log.length)).toFixed(1),
        gpuMs: renderer.timer.ext ? +renderer.timer.ms.toFixed(1) : null,
        triangles: renderer.stats.tris,
        sprites: renderer.stats.sprites,
      });
    }
    result.stretches = stretches;
    // 2. Stability: step one shot frame by frame, with whole-pixel snapping on and off.
    hold = true;
    const stability = [];
    for (const [shot, m, at] of [["a third of the way", "turn", 0.3], ["two thirds of the way", "follow", 0.62]] as const)
      for (const snapOn of [true, false]) {
        say(`Counting pixels that don't move like pixel art: ${shot}, snapping ${snapOn ? "on" : "off"}…`);
        opt.snap = snapOn;
        mode = m;
        speed = 3;
        paused = false;
        s = TOTAL * at;
        snap = true;
        for (let k = 0; k < (o.settle ?? (quick ? 3 : 30)); k++) frame(performance.now(), 1 / 60);
        let prev = renderer.readArt(),
          sumU = 0,
          sumC = 0;
        const q = [0, 0, 0, 0],
          N = o.frames ?? (quick ? 2 : 20);
        for (let k = 0; k < N; k++) {
          frame(performance.now(), 1 / 60);
          const cur = renderer.readArt(),
            r = unexplained(prev, cur, ART_W, ART_H);
          sumU += r.unexplained;
          sumC += r.changed;
          r.byQuarter.forEach((v, i) => (q[i] += v));
          prev = cur;
          if (k % 4 === 3) await pause(0);
        }
        stability.push({
          shot,
          camera: m,
          snap: snapOn,
          unexplainedPct: +((sumU / N) * 100).toFixed(2),
          changedPct: +((sumC / N) * 100).toFixed(1),
          byQuarterPct: q.map((v) => +((v / N) * 100).toFixed(2)),
        });
      }
    result.stability = stability;
  } finally {
    hold = false;
    mode = keep.mode;
    speed = keep.speed;
    paused = keep.paused;
    opt.snap = keep.snap;
    s = keep.s;
    snap = true;
    frameLog = null;
    requestAnimationFrame((t) => {
      last = t;
      frame(t);
    });
  }
  // Show it, and save it where Claude can read it.
  const st = result.stretches as { meanMs: number; p95Ms: number }[],
    stab = result.stability as { snap: boolean; unexplainedPct: number }[],
    timed = st.filter((x) => x.meanMs > 0),
    fpsMean = timed.length ? 1000 / (timed.reduce((x, y) => x + y.meanMs, 0) / timed.length) : 0,
    p95 = timed.length ? Math.max(...timed.map((x) => x.p95Ms)) : 0,
    on = stab.filter((x) => x.snap).reduce((x, y) => x + y.unexplainedPct, 0) / 2,
    off = stab.filter((x) => !x.snap).reduce((x, y) => x + y.unexplainedPct, 0) / 2;
  outEl.innerHTML = "";
  const line = (label: string, value: string) => {
    const b = document.createElement("b");
    b.textContent = value;
    outEl.append(label, b, document.createElement("br"));
  };
  line("Frames: ", timed.length ? `${fpsMean.toFixed(0)} fps on average, slowest 5% ${p95.toFixed(0)} ms` : "not timed");
  line("Not moving like pixel art: ", `${on.toFixed(1)}% of pixels a frame snapped, ${off.toFixed(1)}% not`);
  const saved = document.createElement("span");
  saved.textContent = "Saving for Claude…";
  outEl.append(saved);
  try {
    const db = await (window as unknown as { claude?: { use: (n: string) => Promise<any> } }).claude?.use("db");
    if (!db) saved.textContent = "Not saved: this page can't store data here (open it on claude.ai, signed in).";
    else {
      await db.collection("checks").add(result);
      saved.textContent = "Saved for Claude.";
    }
  } catch (err) {
    saved.textContent = `Not saved (${(err as { code?: string }).code ?? "error"}).`;
  }
  btn.disabled = false;
  return result;
}
$("check").onclick = () => void runCheck();

// ---- The loop ---------------------------------------------------------------------------------------
let routeAt0 = 0;
let treeVis = new Float32Array(0),
  coverVis = new Float32Array(0);
let last = 0,
  hold = false,
  frameLog: number[][] | null = null;
function frame(now: number, forced = -1) {
  if (hold && forced < 0) return;
  const dtReal = forced >= 0 ? forced : Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  const t1 = performance.now(),
    dt = paused ? (stepOnce ? speed / 60 : 0) : dtReal * speed;
  stepOnce = false;
  simTime += dt;
  const grade = (partyY(s + 2) - partyY(s - 2)) / 4,
    step = (WALK / (1 + 5 * Math.max(0, grade) + 1.5 * Math.max(0, -grade))) * dt;
  s += step;
  walked += step;
  if (s >= TOTAL) {
    s = 0;
    snap = true;
  }
  updateCamera(dt);
  const rc = renderCamera();
  const visTrees = cullTrees(rc);
  if (visTrees && treesList) {
    renderer.sprites(visTrees, treesList);
    treeVis = nearSubset(visTrees, rc.x, rc.z, 40);
  }
  const cover = coverAround(rc.x, rc.z, rc.yaw);
  if (cover && coverList) {
    renderer.sprites(cover, coverList);
    coverVis = nearSubset(cover, rc.x, rc.z, 90);
  }
  if (actorList && partyList) {
    const a = actors(rc);
    renderer.sprites(a.party, partyList);
    renderer.sprites(a.others, actorList);
  }
  renderer.draw(
    rc,
    [
      { sprites: treesList!, near: 10, far: 6000 },
      { sprites: coverList!, near: 3, far: 260 },
      { sprites: actorList!, near: 1.5, far: 20000 },
      { sprites: partyList!, near: 1.5, far: 20000, ghost: opt.ghost },
    ],
    { bands: opt.bands, wall: opt.wall, time: simTime },
    partsFrame(rc, [
      { data: treeVis, near: 10, far: 6000 },
      { data: coverVis, near: 3, far: 260 },
    ]),
  );
  drawMap(rc);
  const cpuNow = performance.now() - t1;
  cpuMs = cpuMs * 0.9 + cpuNow * 0.1;
  if (frameLog && forced < 0) frameLog.push([dtReal * 1000, cpuNow]);
  fps = fps * 0.93 + (dtReal > 0 ? 1 / dtReal : 60) * 0.07;
  hud(now, rc);
  if (now - routeAt0 > 250 || paused) {
    routeAt0 = now;
    showRoute();
  }
  if (forced < 0) requestAnimationFrame((t) => frame(t));
}
layout();

// For scripted checks.
Object.assign(window, {
  vista: {
    get ready() {
      return ready;
    },
    get buildMs() {
      return buildMs;
    },
    /** Go to a place, by its number or name. */
    jump(which: number | string) {
      const i = typeof which === "number" ? which : land().places.findIndex((p) => p.name === which);
      goPlace(Math.max(0, i));
    },
    get places() {
      return land().places.map((p) => p.name);
    },
    get place() {
      return place.name;
    },
    setS(v: number) {
      s = v;
      snap = true;
    },
    setMode(m: typeof mode) {
      mode = m;
      snap = true;
    },
    set speed(v: number) {
      speed = v;
    },
    set paused(v: boolean) {
      paused = v;
    },
    opt,
    state() {
      return { s, mode, current, cam: { ...cam }, stats: { ...renderer.stats }, gpuMs: renderer.timer.ms, cpuMs, fps, total: TOTAL };
    },
    readArt: () => renderer.readArt(),
    /** What the fine grid holds: its place, and how many cells of each kind and biome. */
    probe() {
      const kinds: Record<number, number> = {},
        biomes: Record<number, number> = {};
      for (let i = 0; i < FINE_K.length; i++) {
        kinds[FINE_K[i]] = (kinds[FINE_K[i]] ?? 0) + 1;
        biomes[FINE_B[i]] = (biomes[FINE_B[i]] ?? 0) + 1;
      }
      return { grids: GRIDS.map((g) => ({ ...g })), cam: { ...cam }, ground: surfaceAt(cam.x, cam.z), kinds, biomes };
    },
    /** Stop the loop (for slow software GL in checks); step() then advances by dt seconds of real time and draws once. */
    hold() {
      hold = true;
    },
    step(dt: number) {
      frame(performance.now(), dt);
    },
    crop(r: number[] | null) {
      renderer.crop = r;
    },
    unexplained,
    check: (o = {}) => runCheck(o),
    /** Trees in view this frame by size on screen (px): how many reach each size, by kind. */
    treeSizes(limits = [24, 64, 96, 128, 192, 256]) {
      const c = renderCamera(),
        fx = Math.sin(c.yaw),
        fz = Math.cos(c.yaw),
        rx = Math.cos(c.yaw),
        rz = -Math.sin(c.yaw),
        n = treeAll.length / 6,
        out = limits.map(() => 0),
        byKind = limits.map(() => [0, 0, 0, 0, 0, 0, 0]);
      for (let i = 0; i < n; i++) {
        const ex = treeAll[i * 6] - c.x,
          ez = treeAll[i * 6 + 2] - c.z,
          vz = ex * fx + ez * fz;
        if (vz < 1.5) continue;
        const sx = ART_W / 2 + (F * (ex * rx + ez * rz)) / vz,
          want = (treeAll[i * 6 + 3] * F) / vz;
        if (sx < -want || sx > ART_W + want) continue;
        limits.forEach((L, k) => {
          if (want >= L) {
            out[k]++;
            byKind[k][Math.floor(treeAll[i * 6 + 4] / 3)]++;
          }
        });
      }
      return { limits, out, byKind };
    },
  },
});
