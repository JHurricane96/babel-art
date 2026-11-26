// Strata Vista: the page. Makes today's world and its land in workers, packs the sprites,
// walks the party along the route at a place, directs the camera, and draws.
import { ART_H, ART_W, F, FOV, HORIZON, Renderer, type Camera, type PartsFrame, type Sprites, type SpriteData } from "./render";
import { BIOMES as BIOME_DEFS, ZONE } from "../../../engine/strata/biomes";
import { BIOMES as BIOME_MAP, ROCKS } from "../../../engine/strata/world2d";
import { G, type LandData, biomeAt, ground, groundKind, land, rockAt, setLand, worldSize } from "./land";
import { type Journey, append, planJourney, refine } from "./journey";
import { FINE, type GridSpec, GRIDS, KIND, ROUTE, along, cumulative, mulberry } from "./common";
import { M } from "../../../engine/strata/world";
import { hex, rampOf, shiftColor } from "./color";
import { HMAX, type Plan, type SlotPack } from "./pack";
import { LEAF_HEX, TREE_NAMES, familyOf, slotDefs, slotIndex } from "./sprites";
import { ROCK_KINDS } from "./rocks";

declare const WORKER_SOURCE: string;
const $ = (id: string) => document.getElementById(id)!;

// ---- State ------------------------------------------------------------------------------------
const opt = { snap: true, bands: true, marker: true, ghost: true, wall: true, path: false };
let stepOnce = false;
type Shot = "follow" | "turn" | "trail";
let mode: "auto" | Shot = "auto",
  speed = 6,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  simTime = 0,
  s = 0,
  walked = 0;
const cam: Camera = { x: 0, y: 0, z: 0, yaw: 0 };
let snap = true,
  autoPick: Shot = "follow",
  lastEval = -1e9,
  hiddenRun = 0,
  clearRun = 0,
  trailFrom = 0,
  followYaw = 0,
  followFx = 0.27,
  current: Shot = "follow";
const LEAD_FX = 0.27,
  WALK = 1.35,
  /** The Trail shot: this far behind the party along the route, this far above it. */
  TRAIL_BACK = 34,
  TRAIL_UP = 6,
  TRAIL_SIDE = 4;

// CPU copies of the grids (heights for all three; kinds for the fine one), swapped with the grids.
const HGT: Float32Array[] = GRIDS.map((g) => new Float32Array(g.n * g.n));
let FINE_K: Uint8Array = new Uint8Array(FINE.n * FINE.n),
  FINE_B: Uint8Array = new Uint8Array(FINE.n * FINE.n),
  FINE_R: Uint8Array = new Uint8Array(FINE.n * FINE.n);
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

// ---- The journey -------------------------------------------------------------------------------
// One walk through today's places (journey.ts): the coarse route planned at the start, the walk
// itself refined a few km ahead of the party as it goes (ROUTE grows; what is behind never moves).
let RC = [0, 1],
  TOTAL = 1,
  journey: Journey | null = null,
  /** How far along the coarse route the walk has been refined, and the coarse route's length. */
  cursor = 0,
  coarseTotal = 1;
const routeAt = (v: number) => along(ROUTE, RC, v);
const partyY = (v: number) => {
  const p = routeAt(v);
  return surfaceAt(p.x, p.z);
};
const journeyDone = () => cursor >= coarseTotal;
/** The whole journey's length: what is walked out so far, and the rest in proportion. */
const journeyLength = () => (journeyDone() ? TOTAL : TOTAL + (coarseTotal - cursor) * (TOTAL / Math.max(1, cursor)));
/** Refine the walk until it reaches `until` metres (and the coarse route at least `coarse` metres),
 * or the journey's end. */
function ensureRoute(until: number, coarse = 0) {
  if (!journey) return;
  let grew = false;
  while ((ROUTE.length < 2 || RC[RC.length - 1] < until || cursor < coarse) && !journeyDone()) {
    const end = ROUTE.length ? ROUTE[ROUTE.length - 1] : journey.coarse[0],
      to = Math.min(coarseTotal, cursor + 2500),
      more = refine(journey, end[0], end[1], to);
    cursor = to;
    if (!more) continue;
    append(ROUTE, more);
    RC = cumulative(ROUTE);
    grew = true;
  }
  if (grew) {
    TOTAL = RC[RC.length - 1];
    routeEl.max = String(Math.floor(journeyLength()));
  }
}
/** Where along the walk the journey passes nearest each stop (once the walk reaches past it). */
const stopCache = new Map<number, number>();
function stopS(i: number) {
  const st = journey!.stops[i];
  let v = stopCache.get(i);
  if (v !== undefined) return v;
  ensureRoute(0, st.at + 2600);
  let best = 0,
    bd = Infinity;
  ROUTE.forEach(([x, z], k) => {
    const d = Math.hypot(x - st.x, z - st.z);
    if (d < bd) (bd = d), (best = k);
  });
  v = RC[best];
  stopCache.set(i, v);
  return v;
}
/** The stop the party comes to next (the last once it is past them all), and how far it is. */
function nextStop() {
  const stops = journey?.stops ?? [];
  for (let i = 0; i < stops.length; i++) {
    const known = stopCache.get(i),
      ahead = known !== undefined ? known - s : (stops[i].at - cursor) * (TOTAL / Math.max(1, cursor)) + (TOTAL - s);
    if (ahead > 30) return { i, name: stops[i].name, ahead };
  }
  return { i: stops.length - 1, name: stops[stops.length - 1]?.name ?? "", ahead: 0 };
}

// ---- Streaming the land ----------------------------------------------------------------------------
// The fine (2 m) and mid (16 m) grids follow the party: when it is well past the middle of one, its
// next placement, centred on the way ahead, is built by the workers into the renderer's back set
// and swapped in whole when done. The far grid covers the world and is built once.
interface Build {
  spec: GridSpec;
  left: number;
  total: number;
  h: Float32Array;
  k?: Uint8Array;
  b?: Uint8Array;
  r?: Uint8Array;
  trees: Float32Array[];
  blocking: boolean;
}
const building: (Build | null)[] = [null, null, null],
  built = [false, false, false],
  spareH: (Float32Array | null)[] = [null, null, null];
let spareFine: Uint8Array[] | null = null,
  landReady = false;
/** Where a grid lies centred on (x, z), kept inside the world (the far grid: over all of it). */
function placement(gi: number, x: number, z: number): GridSpec {
  const g = GRIDS[gi],
    size = worldSize();
  if (gi === 2) return { x0: 0, z0: 0, cell: size / g.n, n: g.n };
  // (On whole cells of the world, so every placement samples the same points.)
  const span = g.cell * g.n,
    at = (v: number) => Math.floor(Math.min(size - span, Math.max(0, v - span / 2)) / g.cell) * g.cell;
  return { x0: at(x), z0: at(z), cell: g.cell, n: g.n };
}
function buildGrid(gi: number, spec: GridSpec, blocking: boolean) {
  const n = spec.n,
    N = n * n,
    h = spareH[gi]?.length === N ? spareH[gi]! : new Float32Array(N),
    b: Build = { spec, left: 0, total: 0, h, trees: [], blocking };
  spareH[gi] = null;
  if (gi === 0) {
    const [k, bb, r] = spareFine ?? [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)];
    Object.assign(b, { k, b: bb, r });
    spareFine = null;
  }
  building[gi] = b;
  // The walk through this placement: for the line through the woods (and the path, when shown).
  let route: number[][] = [];
  if (gi === 0) {
    const M = 20,
      span = spec.cell * n;
    let i0 = -1,
      i1 = -1;
    ROUTE.forEach(([x, z], i) => {
      if (x > spec.x0 - M && z > spec.z0 - M && x < spec.x0 + span + M && z < spec.z0 + span + M) {
        if (i0 < 0) i0 = i;
        i1 = i;
      }
    });
    if (i0 >= 0) route = ROUTE.slice(Math.max(0, i0 - 1), Math.min(ROUTE.length, i1 + 2)).map((p) => [p[0], p[1]]);
  }
  for (let r = 0; r < n; r += 128) {
    const r0 = r,
      r1 = Math.min(n, r + 128);
    b.left++;
    b.total++;
    run({ type: "band", gi, r0, r1, spec, route }, (d) => {
      // (A build overtaken by another of the same grid is dropped.)
      if (building[gi] !== b) return;
      const band = d.band;
      renderer.uploadBand(gi, r0, r1, band.h, band.nrm, band.kind, band.road);
      b.h.set(band.h, r0 * n);
      if (gi === 0) {
        for (let q = 0; q < band.kind.length / 2; q++) {
          b.k![r0 * n + q] = band.kind[q * 2];
          b.b![r0 * n + q] = band.kind[q * 2 + 1];
        }
        b.r!.set(band.road, r0 * n);
        b.trees.push(band.trees);
      }
      if (--b.left === 0) swapIn(gi, b);
      else if (b.blocking) {
        const all = building.filter((x) => x?.blocking) as Build[],
          done = all.reduce((t, x) => t + x.total - x.left, 0),
          total = all.reduce((t, x) => t + x.total, 0);
        $("loading").textContent = `Building the land… ${Math.round((done / total) * 100)}%`;
      }
    });
  }
}
function swapIn(gi: number, b: Build) {
  renderer.swapGrid(gi);
  Object.assign(GRIDS[gi], b.spec);
  spareH[gi] = HGT[gi];
  HGT[gi] = b.h;
  if (gi === 0) {
    spareFine = [FINE_K, FINE_B, FINE_R];
    FINE_K = b.k!;
    FINE_B = b.b!;
    FINE_R = b.r!;
    // Trees: x, y, z, height, slot (kind * 3 + variant), flipped with the sun.
    let n = 0;
    for (const t of b.trees) n += t.length / 6;
    const trees = new Float32Array(n * 6);
    let o = 0;
    for (const t of b.trees)
      for (let i = 0; i < t.length; i += 6) {
        trees.set([t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 4] * 3 + t[i + 5], 2], o);
        o += 6;
      }
    bucketTrees(trees);
    lastCull = { x: 1e9, z: 0, yaw: 0 };
    // Cover tiles that now lie in the fine grid but were made without it (from the land's coarse
    // kinds, not knowing the walked line) are made again, a few a frame; the rest stand.
    for (const k of [...coverCache.keys()]) {
      if (coverFine.has(k)) continue;
      const base = Math.floor(k / 2),
        tz = Math.floor(base / 100000),
        tx = base - tz * 100000;
      if (inside(0, tx * TILE + TILE / 2, tz * TILE + TILE / 2)) coverCache.delete(k);
    }
    coverKey = "";
  }
  building[gi] = null;
  built[gi] = true;
  if (!landReady && built.every(Boolean)) {
    landReady = true;
    maybeStart();
  }
  if (b.blocking && !building.some((x) => x?.blocking)) {
    if (started) $("loading").hidden = true;
    snap = true;
  }
}
/** Each frame: walk out the route ahead, and move a grid on once the party is `reach` metres from
 * its middle, to a new middle `ahead` metres on. The fine grid so always reaches at least 1.5 km
 * ahead (2048 - 500), past where trees have faded out (TREE_FAR), so moving it never adds a tree
 * that can be seen; the mid grid at least 12 km, so what changes as it moves on (heights from 16 m
 * cells instead of 100 m) lies deep in the haze. */
function stream() {
  if (!landReady || !journey) return;
  ensureRoute(s + 6000);
  const p = routeAt(s);
  for (const [gi, reach, ahead] of [
    [0, 500, 400],
    [1, 4000, 3000],
  ] as const) {
    if (building[gi]) continue;
    const g = GRIDS[gi],
      half = (g.cell * g.n) / 2;
    if (Math.hypot(p.x - (g.x0 + half), p.z - (g.z0 + half)) < reach) continue;
    const a = routeAt(s + ahead),
      spec = placement(gi, a.x, a.z);
    // (At the world's edge a grid can move no further.)
    if (Math.abs(spec.x0 - g.x0) + Math.abs(spec.z0 - g.z0) < reach * 0.25) continue;
    buildGrid(gi, spec, false);
  }
}
/** Is the walk at v well inside the fine grid (so the party can go on while the next one builds)? */
function roomAt(v: number, margin: number) {
  const p = routeAt(v),
    g = GRIDS[0],
    span = g.cell * g.n;
  return p.x > g.x0 + margin && p.z > g.z0 + margin && p.x < g.x0 + span - margin && p.z < g.z0 + span - margin;
}
/** Go somewhere along the journey at once: the land there is built before the walk goes on. */
function travel(v: number) {
  ensureRoute(v + 6000);
  s = Math.max(0, Math.min(TOTAL - 1, v));
  snap = true;
  const a = routeAt(s + 300);
  $("loading").hidden = false;
  $("loading").textContent = "Building the land…";
  buildGrid(1, placement(1, a.x, a.z), true);
  buildGrid(0, placement(0, a.x, a.z), true);
}

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
/** How much of the party a camera at c cannot see (0..1): points on each figure, tested against the
 * trees between (their crowns as upright boards facing the camera) and the land. */
function hiddenFrom(c: { x: number; y: number; z: number; yaw: number }) {
  const fx = Math.sin(c.yaw),
    fz = Math.cos(c.yaw),
    rx = Math.cos(c.yaw),
    rz = -Math.sin(c.yaw),
    pts: number[][] = [];
  for (let m = 0; m < 4; m++) {
    const v = Math.max(0, s - m * 2.8),
      p = routeAt(v),
      y = partyY(v);
    pts.push([p.x, y + 0.5, p.z], [p.x, y + 1.4, p.z]);
  }
  // Trees near the line of sight, from their 128 m buckets.
  const L = routeAt(s),
    near: number[] = [],
    bx0 = Math.max(0, Math.floor((Math.min(c.x, L.x) - 30 - FINE.x0) / TBK)),
    bx1 = Math.min(TNB - 1, Math.floor((Math.max(c.x, L.x) + 30 - FINE.x0) / TBK)),
    bz0 = Math.max(0, Math.floor((Math.min(c.z, L.z) - 30 - FINE.z0) / TBK)),
    bz1 = Math.min(TNB - 1, Math.floor((Math.max(c.z, L.z) + 30 - FINE.z0) / TBK));
  for (let bz = bz0; bz <= bz1; bz++)
    for (let bx = bx0; bx <= bx1; bx++) {
      const b = bz * TNB + bx;
      for (let i = treeStart[b]; i < treeStart[b + 1]; i++) near.push(i);
    }
  let hid = 0;
  for (const [px, py, pz] of pts) {
    const ex = px - c.x,
      ez = pz - c.z,
      dP = ex * fx + ez * fz,
      lP = ex * rx + ez * rz;
    if (dP < 2) continue;
    let blocked = false;
    for (const i of near) {
      const o = i * 6,
        tx = treeAll[o] - c.x,
        tz = treeAll[o + 2] - c.z,
        dT = tx * fx + tz * fz;
      if (dT < 6 || dT > dP - 1.5) continue;
      const t = dT / dP,
        th = treeAll[o + 3],
        conifer = Math.floor(treeAll[o + 4] / 3) >= 4,
        half = th * (conifer ? 0.17 : 0.3),
        lo = th * (conifer ? 0.12 : 0.3),
        ry = c.y + t * (py - c.y) - treeAll[o + 1];
      if (ry > lo && ry < th && Math.abs(t * lP - (tx * rx + tz * rz)) < half) {
        blocked = true;
        break;
      }
    }
    // The land in between.
    for (let k = 1; k < 12 && !blocked; k++) {
      const t = k / 12;
      if (surfaceAt(c.x + ex * t, c.z + ez * t) > c.y + t * (py - c.y)) blocked = true;
    }
    if (blocked) hid++;
  }
  return hid / pts.length;
}
/** Where Follow would put the camera now (for Auto to ask whether it would see the party). */
function followSpot() {
  const L = routeAt(s),
    yaw = stretch(s, 600).yaw,
    x = L.x - Math.sin(yaw) * 120,
    z = L.z - Math.cos(yaw) * 120;
  return { x, z, yaw, y: Math.max(surfaceMax(x, z, 22) + 6, partyY(s) + 14 + 120 * 0.13) };
}
function updateCamera(dt: number) {
  const L = routeAt(s),
    Ly = partyY(s);
  // Auto: Follow, looking ahead into the land; Trail, close behind the party, while Follow would
  // lose them behind trees or a hill.
  if (mode === "auto") {
    if (snap) {
      autoPick = hiddenFrom(followSpot()) > 0.6 ? "trail" : "follow";
      hiddenRun = clearRun = 0;
      trailFrom = s;
      lastEval = s;
    } else if (s - lastEval > 6) {
      lastEval = s;
      if (autoPick === "follow") {
        hiddenRun = hiddenFrom(cam) > 0.6 ? hiddenRun + 1 : 0;
        if (hiddenRun >= 2) {
          autoPick = "trail";
          trailFrom = s;
          hiddenRun = 0;
        }
      } else {
        clearRun = hiddenFrom(followSpot()) < 0.25 ? clearRun + 1 : 0;
        if (clearRun >= 4 && s - trailFrom > 60) {
          autoPick = "follow";
          clearRun = 0;
        }
      }
    }
  }
  const m: Shot = mode === "auto" ? autoPick : mode;
  if (m !== current || snap) {
    if (m === "follow") followYaw = stretch(s, 600).yaw;
    current = m;
  }
  // Follow looks again where the way ahead has turned well away from where it looks.
  if (m === "follow") {
    const ahead = stretch(s, 600).yaw;
    let d = ahead - followYaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 0.6) followYaw = ahead;
  }
  if (m === "trail") {
    // Behind the party on the way they came, a little to one side (so they read as a file, not one
    // figure), looking the way they are going.
    // (Near the journey's start, back along its first heading.)
    const back = s - TRAIL_BACK,
      B0 = routeAt(Math.max(0, back)),
      B = back < 0 ? { x: B0.x + B0.hx * back, z: B0.z + B0.hz * back } : B0,
      A = routeAt(s + 30),
      hy = Math.atan2(A.x - B.x, A.z - B.z),
      bx = B.x + Math.cos(hy) * TRAIL_SIDE,
      bz = B.z - Math.sin(hy) * TRAIL_SIDE,
      tYaw = Math.atan2(A.x - bx, A.z - bz),
      ty = Math.max(surfaceMax(bx, bz, 4) + 2, Ly + TRAIL_UP);
    cam.yaw = snap ? tYaw : angleTo(cam.yaw, tYaw, ease(dt, 3));
    cam.x = snap ? bx : cam.x + (bx - cam.x) * ease(dt, 2.5);
    cam.z = snap ? bz : cam.z + (bz - cam.z) * ease(dt, 2.5);
    cam.y = snap ? ty : cam.y + (ty - cam.y) * ease(dt, 2);
    frameParty(dt);
    snap = false;
    return;
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
    // (Eased when closer, so coming out of Trail the camera draws back rather than jumps.)
    if (depth > 260) cf = Lf - 260;
    else if (depth < 55) cf += (Lf - 55 - cf) * ease(dt, 2);
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
  frameParty(dt);
  snap = false;
}
/** Keep the party in frame: where the camera must stand well above them (or below), shift the
 * horizon (a lens shift, so verticals stay vertical) until they sit inside the middle of the frame. */
function frameParty(dt: number) {
  const L = routeAt(s),
    depth = Math.max(5, (L.x - cam.x) * Math.sin(cam.yaw) + (L.z - cam.z) * Math.cos(cam.yaw)),
    row = HORIZON + (F * (cam.y - partyY(s) - 0.9)) / depth,
    lo = ART_H * 0.3,
    hi = ART_H * 0.72,
    want = row > hi ? HORIZON - (row - hi) : row < lo ? HORIZON + (lo - row) : HORIZON,
    target = Math.max(-ART_H * 0.8, Math.min(ART_H * 0.75, want));
  cam.hz = snap || cam.hz === undefined ? target : cam.hz + (target - cam.hz) * ease(dt, 1.5);
}
/** The camera drawn with: turned and moved in whole-pixel steps (at the party's usual distance). */
function renderCamera(): Camera {
  if (!opt.snap) return { ...cam };
  const yaw = Math.round(cam.yaw * F) / F,
    fx = Math.sin(yaw),
    fz = Math.cos(yaw),
    rx = Math.cos(yaw),
    rz = -Math.sin(yaw),
    step = (current === "trail" ? TRAIL_BACK : 120) / F,
    cf = cam.x * fx + cam.z * fz,
    cr = Math.round((cam.x * rx + cam.z * rz) / step) * step;
  return { x: fx * cf + rx * cr, z: fz * cf + rz * cr, y: Math.round(cam.y / step) * step, yaw, hz: Math.round(cam.hz ?? HORIZON) };
}

// ---- Sprites ----------------------------------------------------------------------------------
const SLOTS = slotIndex(),
  DEFS = slotDefs();
/** Families of drawings placed as one (a rock family's drawings: "boulder 0" ..), by name; anything
 * else a family of one. Their height in the world, for what is low enough to walk through. */
const FAMILY = new Map<string, number[]>(),
  FAMILY_H = new Map<string, number>();
DEFS.forEach((d, i) => {
  const name = familyOf(d.name);
  if (!FAMILY.has(name)) FAMILY.set(name, []);
  FAMILY.get(name)!.push(i);
  FAMILY_H.set(name, d.worldH);
});
/** Each slot's kind (its name's first word), and which are rocks. */
const SLOT_KIND = DEFS.map((d) => d.name.split(" ")[0]),
  SLOT_ROCK = SLOT_KIND.map((k) => ROCK_KINDS.some((r) => r.kind === k));
const isRock = (slot: number) => SLOT_ROCK[slot];
/** What takes its colour from the place: grass from the biome's grass; bushes, sage, rosettes and
 * ferns from its leaves. */
const GRASSY = ["grass", "grass2", "dry", "flowers"],
  LEAFY = ["fern", "fern2", "shrub", "shrub2", "sage", "rosette"];
/** Heather's own colours (whatever the biome), one per plant: in bloom, rusty, dark. */
const HEATHER_HEX = ["#7a4a6a", "#8a5a78", "#6e4a3a", "#4f5236"];
/** Rocks as they look in the sun at sprite size, by world2d ROCKS (the map colours are too dark or
 * too bright for that: coal, basalt, salt): each in two colours, a little darker and warmer the second. */
const ROCK_HEX = ["#6f6c76", "#a6918c", "#57545c", "#b2aa98", "#b6b09a", "#6c707c", "#b8956a", "#8c7e70", "#a4644a", "#c8a474", "#4c4846", "#968a7c", "#93979b", "#c8c4be", "#9a9182"];
if (ROCK_HEX.length !== ROCKS.length) throw new Error("a sprite colour for every rock");
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
  // Colours each thing takes from where it is (spriteColour: a row added to its material's first):
  // rocks by the rock under them, two colours each; grass, shrubs and ferns by their biome.
  const rockBase = rampRows.length;
  for (const c of ROCK_HEX) rampRows.push(rampOf(hex(c)), rampOf(shiftColor(hex(c), -0.04, 0.12, 1.15)));
  const grassBase = rampRows.length;
  for (const b of BIOME_DEFS) rampRows.push(rampOf(hex(b.grass)));
  const leafBase = rampRows.length;
  for (const b of BIOME_DEFS) rampRows.push(rampOf(hex(b.leaf)));
  const heatherBase = rampRows.length;
  for (const c of HEATHER_HEX) rampRows.push(rampOf(hex(c)));
  // Weathering on rocks: moss, lichen, snow.
  const weather0 = rampRows.length;
  for (const c of ["#5f7f38", "#b4ae7a", "#e8eef4"]) rampRows.push(rampOf(hex(c)));
  const mat = new Uint16Array(32 * nS);
  for (const pk of packs) {
    const kind = DEFS[pk.slot].name.split(" ")[0],
      tree = TREE_NAMES.includes(kind);
    let first = -1;
    for (const [m, r] of pk.ramps) {
      // Leaves: the tree's own colour (0x8000), and broadleaves may turn for autumn (0x4000).
      // Rocks, grass, shrubs and ferns: the colour of their place (0x2000, see above).
      const turns = ["oak", "beech", "maple", "birch"].includes(kind),
        id =
          tree && m === M.LEAF ? leafFamily(kind) | 0x8000 | (turns ? 0x4000 : 0)
          : isRock(pk.slot) && m === M.ROCK ? rockBase | 0x2000
          : GRASSY.includes(kind) && m === M.GRASS ? grassBase | 0x2000
          : LEAFY.includes(kind) && m === M.LEAF ? leafBase | 0x2000
          : kind === "heather" && m === M.LEAF ? heatherBase | 0x2000
          : addRamp(r);
      if (first < 0) first = id & 0x1fff;
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
    weather0,
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
let growthList: Sprites | null = null;
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
// (Rocks by family: each placed rock one of the family's drawings, as they come.)
const ON_ROCK: [string, number][] = [["stone", 0.03], ["rubble", 0.01], ["slab", 0.006], ["boulder", 0.006], ["outcrop", 0.002]],
  ON_SCREE: [string, number][] = [["stone", 0.16], ["rubble", 0.06], ["slab", 0.03], ["boulder", 0.025], ["erratic", 0.002]],
  ON_SHORE: [string, number][] = [["stone", 0.22], ["rubble", 0.06], ["slab", 0.025], ["boulder", 0.01]],
  ON_SNOW: [string, number][] = [["stone", 0.01], ["boulder", 0.003]];
function coverFor(b: number, kind: number): [string, number][] {
  if (kind === KIND.ROCK) return ON_ROCK;
  if (kind === KIND.SCREE) return ON_SCREE;
  if (kind === KIND.SHORE) return ON_SHORE;
  if (kind === KIND.SNOW) return ON_SNOW;
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
  // Bushes of the kinds the biome names, in its proportions (bush, fern, heather, sage, rosette).
  if (look.shrubs > 0) {
    const all = Math.min(0.12, look.shrubs * 0.35) + Math.min(0.06, look.shrubs * 0.15),
      kinds = look.bushes.split(",").map((e) => e.trim().split(" ")).filter((e) => e[0]),
      sum = kinds.reduce((a, e) => a + Number(e[1] ?? 1), 0) || 1;
    for (const [name, w] of kinds) {
      const d = (all * Number(w ?? 1)) / sum;
      if (name === "bush") list.push(["shrub", d * 0.67], ["shrub2", d * 0.33]);
      else if (name === "fern") list.push(["fern", d * 0.6], ["fern2", d * 0.4]);
      else if (FAMILY.has(name)) list.push([name, d]);
    }
  }
  // Boulders, with now and then a slab, a lone big erratic, or a crag (fewer in woods).
  if (look.boulders > 0)
    list.push(
      ["boulder", Math.min(0.025, look.boulders * 2.5)],
      ["slab", Math.min(0.008, look.boulders * 0.8)],
      ["erratic", Math.min(0.0025, look.boulders * 0.25)],
      ["outcrop", woods ? 0 : Math.min(0.0015, look.boulders * 0.15)],
    );
  if (look.scree > 0.5 || kind === KIND.SAND) list.push(["stone", 0.015 * look.scree + (kind === KIND.SAND ? 0.01 : 0)], ["rubble", 0.004 * look.scree]);
  coverLists.set(key, list);
  return list;
}
const COVER_PATH: [string, number][] = [["stone", 0.01]];
/** Weathering on rocks (render.ts spriteColour: 1 moss, 2 lichen, 3 snow, and how much, 0..3, in
 * the bits above) by the climate and the ground: moss in wet woods, lichen where it is cold or by
 * the sea, snow on snow; bare in dry lands. */
function weatherFor(b: number, kind: number) {
  const look = BIOME_DEFS[b],
    z = look.zone,
    woods = kind === KIND.FOREST || kind === KIND.CONIFER;
  if (kind === KIND.SNOW || look.ground === "snow" || z === ZONE.ICE) return 3 | (3 << 2);
  if (z === ZONE.RAINFOREST || z === ZONE.MONSOON || z === ZONE.OCEANIC) return 1 | ((woods ? 3 : 2) << 2);
  if (z === ZONE.BOREAL || z === ZONE.CONTINENTAL) return woods || look.ground === "moss" ? 1 | (2 << 2) : 2 | (1 << 2);
  if (z === ZONE.TUNDRA || z === ZONE.ALPINE) return 2 | (2 << 2);
  if (kind === KIND.SHORE) return 2 | (1 << 2);
  return 0;
}
const COVER_FAR = 1400;
/** Where the party walks with no path drawn: what grows there, but nothing that would hide them. */
const lowLists = new Map<[string, number][], [string, number][]>();
const lowCover = (list: [string, number][]) => {
  let low = lowLists.get(list);
  if (!low) lowLists.set(list, (low = list.filter(([name]) => FAMILY_H.get(name)! < 0.6)));
  return low;
};
const TILE = 32;
/** Beyond this, a tile holds only what stands at least FAR_COVER_H tall: anything smaller is under
 * a pixel there anyway. */
const NEAR_COVER = 560,
  FAR_COVER_H = 0.6;
/** What the ground is on an 8 m lattice over a tile outside the fine grid (from the land itself):
 * kind and biome (255 for water) per lattice point. */
function latticeKinds(tx: number, tz: number) {
  const out = new Uint8Array(32);
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const x = tx * TILE + (i + 0.5) * 8,
        z = tz * TILE + (j + 0.5) * 8,
        h = ground(x, z),
        o = (j * 4 + i) * 2;
      if (G.level > h) {
        out[o + 1] = 255;
        continue;
      }
      const g = inside(1, x, z) ? 1 : 2,
        slope = Math.hypot(heightIn(g, x + 8, z) - heightIn(g, x - 8, z), heightIn(g, x, z + 8) - heightIn(g, x, z - 8)) / 16,
        b = biomeAt(x, z);
      out[o] = groundKind(x, z, h, slope, b)[0];
      out[o + 1] = b;
    }
  return out;
}
/** Ground cover for one 32 m tile: what grows depends on the biome (its look: grass, flowers,
 * shrubs, boulders, scree) and on the ground (woods, rock, scree, shore, the walked line). A far
 * tile is the same tile with only its taller things, so a tile coming nearer only adds what was too
 * small to see. */
function coverTile(tx: number, tz: number, far: boolean): Float32Array {
  const out: number[] = [],
    R = mulberry(tx * 92821 + tz * 68917 + 7),
    n = Math.round(TILE * TILE * 0.65);
  let lat: Uint8Array | null = null;
  for (let k = 0; k < n; k++) {
    const x = tx * TILE + R() * TILE,
      z = tz * TILE + R() * TILE;
    let b: number,
      kd: number,
      rd = 99,
      y: number;
    if (inside(0, x, z)) {
      const ri = Math.round((z - FINE.z0) / FINE.cell) * FINE.n + Math.round((x - FINE.x0) / FINE.cell);
      rd = FINE_R[ri] / 20;
      b = FINE_B[ri];
      kd = FINE_K[ri];
      y = heightIn(0, x, z);
    } else {
      lat ??= latticeKinds(tx, tz);
      const li = Math.min(3, Math.floor((z - tz * TILE) / 8)) * 4 + Math.min(3, Math.floor((x - tx * TILE) / 8));
      kd = lat[li * 2];
      b = lat[li * 2 + 1];
      y = surfaceAt(x, z);
    }
    if (b === 255) continue;
    const here = coverFor(b, kd),
      list = rd < 2.1 ? (opt.path ? COVER_PATH : lowCover(here)) : here;
    let r = R() * 0.65;
    for (const [name, d] of list) {
      if ((r -= d) < 0) {
        // Which drawing, how big, and its colour and weathering: a rock the colour of the rock
        // under it (one of two), moss or lichen on some; a plant its biome's colour. (As many
        // numbers drawn whatever it is, near or far, so a far tile is the near one thinned.)
        const fam = FAMILY.get(name)!,
          slot = fam[Math.min(fam.length - 1, Math.floor(R() * fam.length))],
          rock = isRock(slot),
          kind = SLOT_KIND[slot],
          hgt = DEFS[slot].worldH * (rock ? 0.6 + 0.8 * R() : 0.75 + 0.5 * R()),
          jit = R(),
          shade = R() < 0.5 ? 1 : 0,
          bare = R(),
          less = R() < 0.5 ? 1 : 0;
        let info = b;
        if (kind === "heather") info = Math.floor(jit * HEATHER_HEX.length);
        else if (rock) {
          // (Snow on every rock where there is snow; moss or lichen on three in four.)
          const w = weatherFor(b, kd),
            weather = w && ((w & 3) === 3 || bare > 0.25) ? (w & 3) | (Math.max(0, (w >> 2) - less) << 2) : 0;
          info = rockAt(x, z, jit) * 2 + shade + (weather << 7);
        }
        if (!far || DEFS[slot].worldH >= FAR_COVER_H) out.push(x, y - 0.05, z, hgt, slot, 2 | (info << 3));
        break;
      }
    }
  }
  return Float32Array.from(out);
}
/** Tiles made, near and far kinds (kept a while after they leave the view, so turning back is free),
 * and which were made from the fine grid. */
const coverCache = new Map<number, Float32Array>(),
  coverFine = new Set<number>();
let coverKey = "";
/** Is a disc (centre x, z, radius r) at all in view of a camera at (cx, cz) facing yaw, within far? */
function inView(x: number, z: number, r: number, cx: number, cz: number, yaw: number, far: number) {
  const ex = x - cx,
    ez = z - cz,
    d = ex * Math.sin(yaw) + ez * Math.cos(yaw),
    l = ex * Math.cos(yaw) - ez * Math.sin(yaw);
  return d > -r && d < far + r && Math.abs(l) < Math.max(0, d) * Math.tan(FOV / 2 + 0.15) + r * 1.5;
}

// Trees, kept by 128 m buckets so a frame hands the GPU only those in view. Beyond about 1.2 km
// they fade out (into the canopy the ground draws for woods), so they are only ever needed inside
// the fine grid, which reaches further than that wherever the party is.
const TREE_FAR = 1450;
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
      if (a0 === a1 || !inView(FINE.x0 + bx * TBK + TBK / 2, FINE.z0 + bz * TBK + TBK / 2, TBK * 0.75, c.x, c.z, c.yaw, TREE_FAR)) continue;
      treeOut.set(treeAll.subarray(a0 * 6, a1 * 6), n);
      n += (a1 - a0) * 6;
    }
  return treeOut.subarray(0, n);
}
/** The tiles the view needs (once the camera crosses into another tile, or turns), made a few at a
 * time (3 ms a frame): until they are all made the cover drawn stays as it was, which differs only
 * at its far edge, where everything is a pixel or so. The first time at a place, all at once. */
let coverNeed: { tx: number; tz: number; far: boolean; k: number; d: number }[] | null = null,
  coverHave = false,
  coverBuf = new Float32Array(0);
/** The cover near enough (150 m) to hold anything drawn in parts, from the last list made. */
let coverNear = new Float32Array(0);
function coverAround(x: number, z: number, yaw: number) {
  // Out to where even a shrub is down to a pixel or so and has faded by its size, so nothing pops in.
  const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)},${Math.round(yaw * 8)}`;
  if (key !== coverKey) {
    coverKey = key;
    const RAD = (COVER_FAR + 2 * TILE) / 1.6,
      cx = x + Math.sin(yaw) * RAD * 0.6,
      cz = z + Math.cos(yaw) * RAD * 0.6,
      t0x = Math.floor((cx - RAD) / TILE),
      t1x = Math.floor((cx + RAD) / TILE),
      t0z = Math.floor((cz - RAD) / TILE),
      t1z = Math.floor((cz + RAD) / TILE);
    coverNeed = [];
    for (let tz = t0z; tz <= t1z; tz++)
      for (let tx = t0x; tx <= t1x; tx++) {
        const mx = tx * TILE + TILE / 2,
          mz = tz * TILE + TILE / 2;
        if (!inView(mx, mz, TILE, x, z, yaw, COVER_FAR + TILE)) continue;
        // Near or far by the tile's nearest point (and a tile's width to spare as the camera moves on).
        const far = Math.hypot(mx - x, mz - z) - TILE > NEAR_COVER;
        coverNeed.push({ tx, tz, far, k: (tz * 100000 + tx) * 2 + (far ? 1 : 0), d: Math.hypot(mx - x, mz - z) });
      }
  }
  if (!coverNeed) return null;
  const t0 = performance.now();
  for (const t of coverNeed)
    if (!coverCache.has(t.k)) {
      if (coverHave && performance.now() - t0 > 2) return null;
      coverCache.set(t.k, coverTile(t.tx, t.tz, t.far));
      if (inside(0, t.tx * TILE + TILE / 2, t.tz * TILE + TILE / 2)) coverFine.add(t.k);
      else coverFine.delete(t.k);
    }
  let n = 0,
    nn = 0;
  for (const t of coverNeed) {
    const p = coverCache.get(t.k)!;
    // (Kept as the most recently used.)
    coverCache.delete(t.k);
    coverCache.set(t.k, p);
    n += p.length;
    if (t.d < 150) nn += p.length;
  }
  // One buffer, reused (grown when it must be): the list is a view of its start.
  if (coverBuf.length < n) coverBuf = new Float32Array(Math.ceil((n * 1.25) / 6) * 6);
  const near = new Float32Array(nn);
  n = 0;
  nn = 0;
  for (const t of coverNeed) {
    const p = coverCache.get(t.k)!;
    coverBuf.set(p, n);
    n += p.length;
    if (t.d < 150) {
      near.set(p, nn);
      nn += p.length;
    }
  }
  coverNeed = null;
  coverHave = true;
  coverNear = near;
  // Forget the longest unused beyond a few thousand tiles.
  if (coverCache.size > 6000) for (const k of coverCache.keys()) if (coverCache.size > 4500) coverCache.delete(k); else break;
  return coverBuf.subarray(0, n);
}

/** The party (and its marker), this frame. */
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
  // The map: as big as the side panel has room for beside everything else in it (at most its width).
  const m = $("map") as HTMLCanvasElement,
    side = m.parentElement!;
  if (getComputedStyle(side).flexDirection === "column") {
    m.style.width = m.style.height = "236px";
    const others = side.scrollHeight - m.offsetHeight,
      size = Math.max(110, Math.min(side.clientWidth, side.clientHeight - others));
    m.style.width = m.style.height = `${size}px`;
  } else m.style.width = m.style.height = "";
  const mr = m.getBoundingClientRect();
  m.width = Math.round(mr.width * dpr);
  m.height = Math.round(mr.height * dpr);
}
// The panel's numbers opening or closing changes the room left for the map.
document.querySelector("details.more")?.addEventListener("toggle", layout);
addEventListener("resize", layout);
// The view's area changes size without the window doing so: when the fonts arrive, when the Go to
// menu fills with places, when the panel's numbers fold open. Fit the view (and the map) again then.
{
  let queued = false;
  const ro = new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      layout();
    });
  });
  ro.observe(area);
  ro.observe(document.querySelector(".readout")!);
}

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
  // The day's journey (its coarse route), its stops, and the fine grid's square (where the party is).
  if (journey) {
    c.strokeStyle = "rgba(244,239,226,0.95)";
    c.lineWidth = 1.2 * u;
    c.beginPath();
    journey.coarse.forEach(([x, z], i) => (i ? c.lineTo(mx(x), my(z)) : c.moveTo(mx(x), my(z))));
    c.stroke();
    c.fillStyle = "rgba(244,239,226,0.95)";
    for (const st of journey.stops) {
      c.beginPath();
      c.arc(mx(st.x), my(st.z), 2.2 * u, 0, 7);
      c.fill();
    }
  }
  c.strokeStyle = "rgba(244,239,226,0.8)";
  c.lineWidth = u;
  c.strokeRect(mx(FINE.x0), my(FINE.z0 + FINE.cell * FINE.n), FINE.cell * FINE.n * k, FINE.cell * FINE.n * k);
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
  auto: "Follows the party, looking ahead into the land; drops in close behind them (Trail) while trees or a hill would hide them.",
  follow: "Faces the way the route is heading and lets the party walk away into the scene before moving after them.",
  turn: "Swings round as the route turns, so the party walks across the screen while the land turns behind them.",
  trail: "Close behind the party, looking the way they are going: for woods and hollows where they would be hidden.",
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
  const ns = nextStop();
  $("r-stretch").textContent = `${BIOME_DEFS[biomeAt(p.x, p.z)].name}; next ${ns.name}${ns.ahead > 0 ? `, ${(ns.ahead / 1000).toFixed(1)} km` : ""}`;
  placesEl.value = String(ns.i);
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
      // The path changes what grows on it.
      if (k === "path") {
        coverCache.clear();
        coverFine.clear();
        coverKey = "";
        coverHave = false;
      }
    }),
);
$("play").onclick = () => {
  paused = !paused;
  $("play").textContent = paused ? "Play" : "Pause";
};
/** The places to go, in the Go to menu (once the world is made). */
const placesEl = $("places") as HTMLSelectElement;
function placeButtons() {
  placesEl.replaceChildren(
    ...journey!.stops.map((st, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${i + 1}. ${st.name}`;
      return o;
    }),
  );
}
/** River crossings: where the walk fords a river (in its channel; never a lake or the sea). */
const inRiver = (v: number) => {
  const p = routeAt(v),
    h = ground(p.x, p.z);
  return G.level > h && !G.lake && !G.sea;
};
/** Where the walk next (dir 1) or last (dir -1) enters a river, seen from `from`: looking 4 m at a
 * time, on to the journey's end (walking the route out 40 km at a time as it goes) or back to the
 * start. Null if there is none. */
function crossing(from: number, dir: 1 | -1) {
  const step = 4;
  let v = from,
    inside = true;
  for (;;) {
    if (dir > 0) ensureRoute(v + 40000);
    const stop = dir > 0 ? Math.min(TOTAL - 1, v + 40000) : 0,
      more = (x: number) => (dir > 0 ? x < stop : x > stop);
    // First off the crossing the search starts on, then on to the next one.
    if (inside) while (more(v) && inRiver(v)) v += dir * step;
    if (more(v)) inside = false;
    while (more(v) && !inRiver(v)) v += dir * step;
    if (more(v)) break;
    if (dir < 0 || (journeyDone() && v >= TOTAL - 2)) return null;
  }
  // (Going back, on to where that crossing begins.)
  if (dir < 0) while (v > 0 && inRiver(v - step)) v -= step;
  return v;
}
function goCrossing(dir: 1 | -1) {
  if (!journey) return;
  const v = crossing(dir > 0 ? s + 100 : s + 40, dir);
  if (v === null) {
    routeNote = dir > 0 ? "No river crossing ahead" : "No river crossing behind";
    routeNoteUntil = performance.now() + 4000;
    showRoute();
    return;
  }
  // A little before it, so the party walks into it.
  seekTo(Math.max(0, v - 60));
}
$("cross-prev").onclick = () => goCrossing(-1);
$("cross-next").onclick = () => goCrossing(1);
/** Go to where the journey passes a stop. */
function goStop(i: number) {
  if (!journey) return;
  travel(stopS(Math.max(0, Math.min(journey.stops.length - 1, i))));
}
placesEl.onchange = () => goStop(Number(placesEl.value));
// Seeking: a slider along the whole route, steps of 10 and 100 m, a single frame on.
const routeEl = $("route") as HTMLInputElement;
let dragging = false;
/** Seek along the journey: within the land already built, at once; further, by travelling there. */
const seekTo = (v: number) => {
  if (!journey) return;
  v = Math.max(0, Math.min(journeyLength() - 1, v));
  ensureRoute(v + 6000);
  v = Math.min(TOTAL - 1, v);
  if (roomAt(v, 500)) {
    s = v;
    snap = true;
  } else travel(v);
  showRoute();
};
/** A note shown in place of the route readout for a few seconds. */
let routeNote = "",
  routeNoteUntil = 0;
function showRoute() {
  if (!dragging) routeEl.value = String(Math.round(s));
  if (performance.now() < routeNoteUntil) {
    $("route-at").textContent = routeNote;
    return;
  }
  const ns = nextStop();
  $("route-at").textContent = `${(s / 1000).toFixed(2)} of ${(journeyLength() / 1000).toFixed(0)} km · next: ${ns.name}${ns.ahead > 0 ? ` in ${(ns.ahead / 1000).toFixed(1)} km` : ""}`;
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
let spritesLeft = 0,
  spritesSet = false,
  ready = false,
  treesList: Sprites | null = null,
  coverList: Sprites | null = null,
  partyList: Sprites | null = null;
const t0 = performance.now();
let buildMs = 0,
  started = false;

// Today's world first, so a worker starts on it at once (it sends back the world's land: far less
// than the world). The sprites take the other workers: trees and shrubs one slot a job (the heavy
// ones), the rest a dozen at a time.
run({ type: "world", seed: SEED, n: 512 }, (d) => onLand(d.land));
const nSlots = DEFS.length;
for (let a = 0; a < nSlots; ) {
  const heavy = DEFS[a].maxClass >= 25 || DEFS[a].name.startsWith("shrub");
  let to = a + 1;
  if (!heavy) while (to < Math.min(nSlots, a + 12) && !(DEFS[to].maxClass >= 25 || DEFS[to].name.startsWith("shrub"))) to++;
  spritesLeft++;
  run({ type: "sprites", from: a, to }, (d) => {
    spritePacks.push(...d.slots);
    if (--spritesLeft === 0) spritesDone();
  });
  a = to;
}
/** The sprites are all here: on to the GPU now (while the land is still being made), and the clouds. */
function spritesDone() {
  renderer.setSprites(buildSprites(spritePacks));
  const cl = buildClouds();
  renderer.setClouds(cl.W, cl.H, cl.data);
  spritesSet = true;
  maybeStart();
}

/** Each biome's grass, leaves and sand, for the ground's palette. */
function biomeRamps() {
  const out: number[][][] = [];
  for (const b of BIOME_DEFS) {
    const sand = b.ground === "sand" ? b.earth : b.ground === "snow" ? "#e4ecf4" : b.earth;
    out.push(rampOf(hex(b.grass)), rampOf(hex(b.leaf)), rampOf(hex(sand)));
  }
  return out;
}
function onLand(L: LandData) {
  setLand(L);
  for (const wk of workers) wk.postMessage({ type: "land", data: L });
  renderer.setBiomeRamps(biomeRamps());
  $("loading").textContent = "Building the land…";
  // The far grid (the whole world) needs only the land: the workers start on it while the journey
  // is planned here.
  buildGrid(2, placement(2, 0, 0), true);
  journey = planJourney(L);
  coarseTotal = journey.coarseAt[journey.coarseAt.length - 1];
  ensureRoute(6000);
  buildMap();
  placeButtons();
  s = 0;
  snap = true;
  const a = routeAt(300);
  buildGrid(1, placement(1, a.x, a.z), true);
  buildGrid(0, placement(0, a.x, a.z), true);
}
function maybeStart() {
  if (started || !spritesSet || !landReady) return;
  started = true;
  buildMs = performance.now() - t0;
  treesList = renderer.sprites(new Float32Array(0));
  coverList = renderer.sprites(new Float32Array(0));
  partyList = renderer.sprites(new Float32Array(0));
  $("loading").hidden = true;
  layout();
  ready = true;
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

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
    say = (t: string) => {
      outEl.hidden = false;
      outEl.textContent = t;
      layout();
    },
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
    // Three stretches of the walk just ahead (within the land already built).
    for (const [name, at] of o.timing === false ? [] : ([["start", 0.08], ["middle", 0.45], ["end", 0.8]] as const)) {
      say(`Timing frames: the ${name} of the walk…`);
      mode = "auto";
      speed = 6;
      paused = false;
      seekTo(keep.s + 300 * at);
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
        seekTo(keep.s + 300 * at);
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
  outEl.hidden = false;
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
  layout();
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
  // (The party waits at the edge of the land built so far, or while the land is built after a jump.)
  const waiting = !landReady || building.some((b) => b?.blocking) || (building[0] && !roomAt(s + step, 300));
  if (!waiting) {
    s += step;
    walked += step;
  }
  if (s >= TOTAL - 1) {
    if (journeyDone()) travel(0);
    else s = TOTAL - 1;
  }
  stream();
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
    coverVis = nearSubset(coverNear, rc.x, rc.z, 90);
  }
  if (partyList) renderer.sprites(actors(rc), partyList);
  renderer.draw(
    rc,
    [
      { sprites: treesList!, near: 10, far: TREE_FAR },
      { sprites: coverList!, near: 3, far: COVER_FAR },
      { sprites: partyList!, near: 1.5, far: 20000, ghost: opt.ghost },
    ],
    { bands: opt.bands, wall: opt.wall, path: opt.path, time: simTime },
    partsFrame(rc, [
      { data: treeVis, near: 10, far: TREE_FAR },
      { data: coverVis, near: 3, far: COVER_FAR },
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
    /** Go to a stop of the journey, by its number or name. */
    jump(which: number | string) {
      const i = typeof which === "number" ? which : (journey?.stops.findIndex((p) => p.name === which) ?? 0);
      goStop(Math.max(0, i));
    },
    get places() {
      return journey?.stops.map((p) => p.name) ?? [];
    },
    get place() {
      const p = routeAt(s);
      return BIOME_DEFS[biomeAt(p.x, p.z)].name;
    },
    get building() {
      return building.some(Boolean);
    },
    /** Seek to the next (1) or previous (-1) river crossing. */
    crossing: (dir: 1 | -1) => goCrossing(dir),
    crossingAt: (from: number, dir: 1 | -1) => crossing(from, dir),
    inRiver: (v: number) => inRiver(v),
    /** Where the walk is v metres along. */
    routeAt: (v: number) => routeAt(v),
    setS(v: number) {
      seekTo(v);
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
    /** How a sprite grows: drawn alone against the sky at each size it should be (px tall), what it
     * draws: its height (from its base to its topmost pixel) and width on screen. */
    spriteGrowth(name: string, wants: number[], crops = false) {
      const slot = SLOTS.get(name);
      if (slot === undefined) return null;
      const H = DEFS[slot].worldH,
        c: Camera = { x: 0, y: 20000, z: 0, yaw: 0, hz: HORIZON },
        draw = (data: Float32Array) => {
          growthList = renderer.sprites(data, growthList ?? undefined);
          renderer.draw(c, [{ sprites: growthList, near: 0.5, far: 1e7 }], { bands: false, wall: false, time: 0, spritesOnly: true }, partsFrame(c, [{ data, near: 0.5, far: 1e7 }]));
          return renderer.readArt();
        },
        bg = draw(new Float32Array(0)),
        out: number[][] = [];
      for (const want of wants) {
        const d = (H * F) / want,
          base = Math.round(want) + 20,
          img = draw(Float32Array.of(0, c.y - ((base - HORIZON) * d) / F, d, H, slot, 0));
        let top = 1e9,
          x0 = 1e9,
          x1 = -1;
        for (let y = 0; y < ART_H; y++)
          for (let x = 0; x < ART_W; x++) {
            const o = (y * ART_W + x) * 4;
            if (Math.abs(img[o] - bg[o]) + Math.abs(img[o + 1] - bg[o + 1]) + Math.abs(img[o + 2] - bg[o + 2]) < 6) continue;
            const row = ART_H - 1 - y;
            if (row < top) top = row;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          }
        if (crops && x1 >= 0) {
          // The pixels it drew (others clear), from its top to its base.
          const w = x1 - x0 + 1,
            h = base - top + 1,
            px: number[] = [];
          for (let r = top; r <= base; r++)
            for (let x = x0; x <= x1; x++) {
              const o = ((ART_H - 1 - r) * ART_W + x) * 4,
                on = Math.abs(img[o] - bg[o]) + Math.abs(img[o + 1] - bg[o + 1]) + Math.abs(img[o + 2] - bg[o + 2]) >= 6;
              px.push(on ? img[o] : 0, on ? img[o + 1] : 0, on ? img[o + 2] : 0, on ? 255 : 0);
            }
          out.push([want, h, w, ...px]);
          continue;
        }
        out.push(x1 < 0 ? [want, 0, 0] : [want, base - top, x1 - x0 + 1]);
      }
      return out;
    },
    slotNames: () => DEFS.map((d) => d.name),
    /** Tiles of ground cover the view still waits for (made a few a frame after a seek). */
    get coverPending() {
      return coverNeed ? coverNeed.filter((t) => !coverCache.has(t.k)).length : 0;
    },
    /** Make the next frame's ground cover all at once (for checks: no waiting a few tiles a frame). */
    coverNow() {
      coverHave = false;
    },
    /** What the 32 m tile of ground cover at a point holds, by drawing (and its flags, as given). */
    coverAt(x: number, z: number) {
      const t = coverTile(Math.floor(x / TILE), Math.floor(z / TILE), false),
        n: Record<string, number> = {},
        flags: number[] = [];
      for (let i = 0; i < t.length; i += 6) {
        const k = DEFS[t[i + 4]].name;
        n[k] = (n[k] ?? 0) + 1;
        if (isRock(t[i + 4])) flags.push(t[i + 5]);
      }
      return { n, flags: flags.slice(0, 12) };
    },
    /** The cover's cost as the camera moves on a tile at a time: the time each call takes (ms) until
     * the new list is ready, and how many sprites it holds. */
    coverCost(steps = 6) {
      const out: { calls: number[]; n: number }[] = [],
        c = renderCamera();
      for (let k = 1; k <= steps; k++) {
        const x = c.x + Math.sin(c.yaw) * TILE * k,
          z = c.z + Math.cos(c.yaw) * TILE * k,
          calls: number[] = [];
        let r: Float32Array | null = null;
        while (!r && calls.length < 200) {
          const t0 = performance.now();
          r = coverAround(x, z, c.yaw);
          calls.push(Math.round((performance.now() - t0) * 10) / 10);
        }
        out.push({ calls, n: r ? r.length / 6 : -1 });
      }
      return out;
    },
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
