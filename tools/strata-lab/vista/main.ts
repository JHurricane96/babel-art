// Strata Vista: the page. Builds the valley in workers, packs the sprites,
// walks the party along the route, directs the camera, and draws.
import { ART_H, ART_W, F, FOV, Renderer, type Camera, type Sprites, type SpriteAtlas } from "./render";
import {
  BRIDGE, FAR, FINE, GRIDS, KIND, MID, ROAD2, ROUTE, along, bridgeOf, cumulative, hash2, layoutBuildings, mulberry,
} from "./valley";
import { COVER, NC, type Img, slotDefs, slotIndex } from "./sprites";

declare const WORKER_SOURCE: string;
const $ = (id: string) => document.getElementById(id)!;

// ---- State ------------------------------------------------------------------------------------
const opt = { snap: true, bands: true, marker: true, wall: true };
let mode: "auto" | "follow" | "turn" = "auto",
  speed = 6,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  simTime = 0,
  s = 0,
  caravan = 300,
  caravanDir = 1,
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
const RC = cumulative(ROUTE),
  TOTAL = RC[RC.length - 1],
  R2C = cumulative(ROAD2);
const routeAt = (v: number) => along(ROUTE, RC, v);
let bridge = { ax: 0, az: 0, bx: 0, bz: 0, deck: 0 };
function partyY(v: number) {
  const p = routeAt(v),
    g = surfaceAt(p.x, p.z),
    s0 = RC[BRIDGE],
    s1 = RC[BRIDGE + 1];
  if (v >= s0 && v <= s1) return bridge.deck;
  const dd = v < s0 ? s0 - v : v - s1;
  return Math.max(g, bridge.deck - dd * 0.35);
}
const CHAPTERS = [
  { name: "Riverside", long: "Riverside meadows", s: 0 },
  { name: "Up the valley", long: "Up the valley", s: RC[3] },
  { name: "Bridge", long: "The bridge", s: RC[BRIDGE] - 60 },
  { name: "Town", long: "The hill town", s: RC[9] },
  { name: "Ridge road", long: "The ridge road", s: RC[15] },
  { name: "Switchbacks", long: "Switchbacks", s: RC[17] },
  { name: "Pass", long: "The pass", s: RC[22] - 160 },
  { name: "Lake", long: "Down to the lake", s: RC[22] + 40 },
];
const chapterAt = (v: number) => {
  let c = 0;
  for (let k = 0; k < CHAPTERS.length; k++) if (v >= CHAPTERS[k].s) c = k;
  return c;
};

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
function packAtlas(all: { slot: number; imgs: Img[] }[]): SpriteAtlas {
  const nS = DEFS.length,
    W = 2048,
    items: { slot: number; k: number; im: Img; x: number; y: number }[] = [];
  for (const s of all) s.imgs.forEach((im, k) => items.push({ slot: s.slot, k, im, x: 0, y: 0 }));
  items.sort((a, b) => b.im.h - a.im.h);
  let x = 0,
    y = 0,
    rowH = 0;
  for (const it of items) {
    if (x + it.im.w > W) {
      x = 0;
      y += rowH + 1;
      rowH = 0;
    }
    it.x = x;
    it.y = y;
    x += it.im.w + 1;
    rowH = Math.max(rowH, it.im.h);
  }
  const H = y + rowH + 1,
    data = new Uint8Array(W * H * 4),
    rects = new Uint16Array(NC * nS * 4),
    anchors = new Uint16Array(NC * nS * 4);
  const byKey = new Map<number, (typeof items)[0]>();
  for (const it of items) {
    for (let r = 0; r < it.im.h; r++) data.set(it.im.data.subarray(r * it.im.w * 4, (r + 1) * it.im.w * 4), ((it.y + r) * W + it.x) * 4);
    byKey.set(it.slot * 64 + it.k, it);
  }
  for (let sl = 0; sl < nS; sl++)
    for (let k = 0; k < NC; k++) {
      const it = byKey.get(sl * 64 + Math.min(k, DEFS[sl].maxClass));
      if (!it) continue;
      rects.set([it.x, it.y, it.im.w, it.im.h], (sl * NC + k) * 4);
      anchors.set([it.im.ax, it.im.ay, 0, 0], (sl * NC + k) * 4);
    }
  return { w: W, h: H, data, rects, anchors, slots: nS, classes: NC };
}

/** Ground cover for one 32 m tile: what grows depends on the ground. */
const COVER_BY_KIND: Record<number, [string, number][]> = {
  [KIND.GRASS]: [["grass", 0.32], ["grass2", 0.24], ["flowers white", 0.02], ["flowers yellow", 0.025], ["flowers purple", 0.012], ["stone", 0.01], ["shrub", 0.004]],
  [KIND.ALPINE]: [["dry grass", 0.32], ["grass2", 0.1], ["flowers purple", 0.02], ["flowers white", 0.015], ["stone", 0.05], ["stone2", 0.03], ["boulder", 0.005]],
  [KIND.FOREST]: [["fern", 0.12], ["fern2", 0.07], ["shrub", 0.03], ["grass2", 0.07], ["boulder2", 0.005], ["stone", 0.02]],
  [KIND.CONIFER]: [["fern2", 0.05], ["shrub2", 0.02], ["stone", 0.05], ["boulder", 0.008], ["dry grass", 0.05]],
  [KIND.ROCK]: [["stone", 0.04], ["boulder2", 0.006]],
  [KIND.SCREE]: [["stone", 0.18], ["stone2", 0.1], ["boulder", 0.02], ["boulder2", 0.02]],
  [KIND.PATH]: [["stone2", 0.01]],
  [KIND.WHEAT]: [["dry grass", 0.6], ["flowers red", 0.012]],
  [KIND.GREEN]: [["grass", 0.45]],
  [KIND.FALLOW]: [["grass2", 0.06], ["stone", 0.02]],
  [KIND.HEDGE]: [["shrub", 0.15], ["shrub2", 0.1]],
  [KIND.YARD]: [["grass2", 0.05], ["stone", 0.01]],
  [KIND.SHORE]: [["stone", 0.25], ["stone2", 0.15], ["boulder2", 0.01]],
};
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
    const list = rd < 2.1 ? COVER_BY_KIND[KIND.PATH] : COVER_BY_KIND[kindAt(x, z)];
    if (!list) continue;
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
    key = `${t0x},${t0z}`;
  if (key === coverKey) return null;
  coverKey = key;
  const parts: Float32Array[] = [],
    keep = new Set<number>();
  for (let tz = t0z; tz <= t1z; tz++)
    for (let tx = t0x; tx <= t1x; tx++) {
      const k = tz * 100000 + tx;
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

/** The people, the ox and the cart, this frame. */
function actors(c: Camera) {
  const out: number[] = [],
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
  const r2 = (v: number) => along(ROAD2, R2C, v);
  const o = r2(caravan),
    back = r2(caravan - 3.4 * caravanDir),
    lead = r2(caravan + 2.2 * caravanDir),
    fc = facing(o.hx * caravanDir, o.hz * caravanDir),
    fr = Math.floor(caravan / 0.5) & 3;
  if (inside(0, o.x, o.z)) {
    out.push(o.x, surfaceAt(o.x, o.z), o.z, 1.6, SLOTS.get(`ox ${fr}`)!, fc.f === 0 ? fc.mirror : 0);
    out.push(back.x, surfaceAt(back.x, back.z), back.z, 2.6, SLOTS.get("cart")!, fc.f === 0 ? fc.mirror : 0);
    out.push(lead.x, surfaceAt(lead.x, lead.z), lead.z, 1.75, SLOTS.get(`person 4 ${fc.f} ${fr}`)!, fc.mirror);
  }
  return Float32Array.from(out);
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

// The map: the valley from above, north up.
const MX0 = -300,
  MZ0 = -400,
  MSPAN = 4900,
  MAPN = 256,
  mapBase = document.createElement("canvas");
mapBase.width = MAPN;
mapBase.height = MAPN;
const KIND_RGB = [
  [110, 154, 62], [151, 153, 78], [70, 110, 48], [44, 74, 52], [150, 144, 132], [138, 132, 122], [230, 236, 244], [90, 138, 164],
  [79, 126, 158], [180, 154, 112], [205, 176, 90], [122, 160, 64], [142, 118, 86], [62, 96, 48], [156, 142, 108], [164, 154, 136],
];
function buildMap() {
  const c = mapBase.getContext("2d")!,
    im = c.createImageData(MAPN, MAPN);
  for (let py = 0; py < MAPN; py++)
    for (let px = 0; px < MAPN; px++) {
      const x = MX0 + ((px + 0.5) / MAPN) * MSPAN,
        z = MZ0 + MSPAN - ((py + 0.5) / MAPN) * MSPAN,
        h = surfaceAt(x, z),
        hx = surfaceAt(x + 10, z) - h,
        sh = 0.85 + Math.max(-0.3, Math.min(0.3, -hx * 0.04));
      const k = inside(0, x, z) ? kindAt(x, z) : h > 1400 ? 6 : h > 1100 ? 4 : h > 600 ? 3 : 0,
        rgb = KIND_RGB[k] ?? [100, 100, 100];
      im.data.set([rgb[0] * sh, rgb[1] * sh, rgb[2] * sh, 255], (py * MAPN + px) * 4);
    }
  c.putImageData(im, 0, 0);
}
function drawMap(c2: Camera) {
  const m = $("map") as HTMLCanvasElement,
    c = m.getContext("2d")!,
    n = m.width,
    k = n / MSPAN,
    mx = (x: number) => (x - MX0) * k,
    my = (z: number) => (MZ0 + MSPAN - z) * k,
    u = n / 236;
  c.drawImage(mapBase, 0, 0, n, n);
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = "rgba(244,239,226,0.5)";
  c.lineWidth = u;
  c.beginPath();
  ROAD2.forEach(([x, z], i) => (i ? c.lineTo(mx(x), my(z)) : c.moveTo(mx(x), my(z))));
  c.stroke();
  c.strokeStyle = "rgba(244,239,226,0.95)";
  c.lineWidth = 1.6 * u;
  c.beginPath();
  ROUTE.forEach(([x, z], i) => (i ? c.lineTo(mx(x), my(z)) : c.moveTo(mx(x), my(z))));
  c.stroke();
  const L = 1500,
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
  auto: "Picks for each stretch: Turn where the way runs straight, Follow where it winds (the town, the switchbacks).",
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
  $("r-stretch").textContent = CHAPTERS[chapterAt(s)].long;
  $("r-camera").textContent = mode === "auto" ? `auto: ${current}` : current;
  $("r-dist").textContent = `${Math.round(Math.hypot(ex, ez))} m from the camera`;
  $("r-size").textContent = `${px.toFixed(1)} px tall, ${Math.round(px * (1084 / ART_W))} mm on the wall`;
  $("r-fps").textContent = `${fps.toFixed(0)} fps · ${cpuMs.toFixed(1)} ms on the CPU`;
  $("r-gpu").textContent = renderer.timer.ext ? `${renderer.timer.ms.toFixed(1)} ms` : "no timer here";
  $("r-drawn").textContent = `${(st.tris / 1e6).toFixed(2)} M triangles · ${(st.sprites / 1000).toFixed(0)} k sprites`;
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
for (const ch of CHAPTERS) {
  const b = document.createElement("button");
  b.textContent = ch.name;
  b.id = `c-${ch.name.toLowerCase().replace(/\s+/g, "-")}`;
  b.onclick = () => {
    s = ch.s;
    snap = true;
  };
  $("chapters").appendChild(b);
}
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;
  if (e.key === " ") {
    $("play").click();
    e.preventDefault();
  }
});
$("mode-note").textContent = NOTES[mode];
if (paused) $("play").textContent = "Play";

// ---- Building the valley -------------------------------------------------------------------------
const nW = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)),
  workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })),
  jobs: any[] = [];
const nSlots = DEFS.length,
  SP = 6;
for (let k = 0; k < SP; k++) jobs.push({ type: "sprites", from: Math.floor((k * nSlots) / SP), to: Math.floor(((k + 1) * nSlots) / SP) });
for (const [gi, step] of [[2, 128], [1, 128], [0, 128]]) for (let r = 0; r < GRIDS[gi].n; r += step) jobs.push({ type: "band", gi, r0: r, r1: Math.min(GRIDS[gi].n, r + step) });
jobs.forEach((j, i) => (j.id = i));
let done = 0,
  next = 0;
const spriteParts: { slot: number; imgs: Img[] }[] = [],
  treeParts: Float32Array[] = [];
let ready = false,
  treesList: Sprites | null = null,
  coverList: Sprites | null = null,
  actorList: Sprites | null = null;

function onDone() {
  bridge = bridgeOf((x, z) => heightIn(0, x, z));
  const isWater = (x: number, z: number) => {
    const k = kindAt(x, z);
    return k === KIND.RIVER || k === KIND.LAKE;
  };
  const buildings = layoutBuildings((x, z) => heightIn(0, x, z), isWater);
  renderer.setBuildings(buildings, { ...bridge, bed: (x, z) => heightIn(0, x, z) - (isWater(x, z) ? 3 : 0) });
  renderer.setAtlas(packAtlas(spriteParts));
  const cl = buildClouds();
  renderer.setClouds(cl.W, cl.H, cl.data);
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
  treesList = renderer.sprites(trees);
  coverList = renderer.sprites(new Float32Array(0));
  actorList = renderer.sprites(new Float32Array(0));
  buildMap();
  $("loading").hidden = true;
  layout();
  ready = true;
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
  void 0;
}
const t0 = performance.now();
let buildMs = 0;
function feed(w: Worker) {
  if (next >= jobs.length) return;
  w.postMessage(jobs[next++]);
}
for (let k = 0; k < nW; k++) {
  const w = new Worker(workerUrl);
  w.onmessage = (e) => {
    const d = e.data;
    if (d.type === "band") {
      const b = d.band,
        g = GRIDS[b.gi];
      renderer.uploadBand(b.gi, b.r0, b.r1, b.h, b.nrm, b.kind, b.road);
      HGT[b.gi].set(b.h, b.r0 * g.n);
      if (b.gi === 0) {
        FINE_K.set(b.kind, b.r0 * g.n);
        FINE_R.set(b.road, b.r0 * g.n);
        treeParts.push(b.trees);
      }
    } else spriteParts.push(...d.slots);
    done++;
    $("loading").textContent = `Building the valley… ${Math.round((done / jobs.length) * 100)}%`;
    if (done === jobs.length) {
      buildMs = performance.now() - t0;
      onDone();
    } else feed(w);
  };
  feed(w);
}
void MID;
void FAR;
void hash2;

// ---- The loop ---------------------------------------------------------------------------------------
let last = 0,
  hold = false;
function frame(now: number, forced = -1) {
  if (hold && forced < 0) return;
  const dtReal = forced >= 0 ? forced : Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  const t1 = performance.now(),
    dt = paused ? 0 : dtReal * speed;
  simTime += dt;
  const grade = (partyY(s + 2) - partyY(s - 2)) / 4,
    step = (WALK / (1 + 5 * Math.max(0, grade) + 1.5 * Math.max(0, -grade))) * dt;
  s += step;
  walked += step;
  if (s >= TOTAL) {
    s = 0;
    snap = true;
  }
  caravan += 1.1 * dt * caravanDir;
  const c2end = R2C[R2C.length - 1];
  if (caravan > c2end - 5) {
    caravan = c2end - 5;
    caravanDir = -1;
  }
  if (caravan < 10) {
    caravan = 10;
    caravanDir = 1;
  }
  updateCamera(dt);
  const rc = renderCamera();
  const cover = coverAround(rc.x, rc.z, rc.yaw);
  if (cover && coverList) renderer.sprites(cover, coverList);
  if (actorList) renderer.sprites(actors(rc), actorList);
  renderer.draw(
    rc,
    [
      { sprites: treesList!, near: 14, far: 6000 },
      { sprites: coverList!, near: 3, far: 230 },
      { sprites: actorList!, near: 3, far: 20000 },
    ],
    { bands: opt.bands, wall: opt.wall, time: simTime, party: (() => { const p = routeAt(s); return [p.x, partyY(s), p.z]; })() },
  );
  drawMap(rc);
  cpuMs = cpuMs * 0.9 + (performance.now() - t1) * 0.1;
  fps = fps * 0.93 + (dtReal > 0 ? 1 / dtReal : 60) * 0.07;
  hud(now, rc);
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
    jump(name: string) {
      const ch = CHAPTERS.find((c) => c.name === name)!;
      s = ch.s;
      snap = true;
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
    /** Stop the loop (for slow software GL in checks); step() then advances by dt seconds of real time and draws once. */
    hold() {
      hold = true;
    },
    step(dt: number) {
      frame(performance.now(), dt);
    },
  },
});
