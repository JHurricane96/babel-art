// The day's journey: one walk through today's places, in metres (x east, z north).
//
// - The tour: from the westmost place, on to the nearest one not yet visited, and so on.
// - The coarse route: A* over the world map (200 m cells) between each place and the next, round
//   lakes and the sea, preferring gentle ground; smoothed.
// - The walk itself, made a few km at a time as the party goes on (refine): A* over a 32 m
//   lattice of the land at full detail (land.ts), from where the walk so far ends to a point of
//   the coarse route a little further on, so it goes round the cliffs and crags the world map is
//   too coarse to hold, and fords rivers only where it must.
import { G, type LandData, type Place, ground } from "./land";

export interface Journey {
  /** The coarse route, and the distance along it at each point. */
  coarse: [number, number][];
  coarseAt: number[];
  /** The places in the order the journey reaches them, with where along the coarse route. */
  stops: (Place & { at: number })[];
}

/** A binary heap of node indices keyed by a cost array. */
function heap(key: Float64Array | Float32Array) {
  const a: number[] = [];
  return {
    get size() {
      return a.length;
    },
    push(v: number) {
      a.push(v);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (key[a[p]] <= key[a[i]]) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    },
    pop() {
      const top = a[0],
        last = a.pop()!;
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1,
            r = l + 1;
          let m = i;
          if (l < a.length && key[a[l]] < key[a[m]]) m = l;
          if (r < a.length && key[a[r]] < key[a[m]]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    },
  };
}

/** A* over a w x h lattice of step metres: cost of a move from k to q, or Infinity where blocked. */
function astar(w: number, h: number, step: number, s0: number, s1: number, cost: (k: number, q: number, len: number) => number) {
  const N = w * h,
    g = new Float64Array(N).fill(Infinity),
    f = new Float64Array(N).fill(Infinity),
    from = new Int32Array(N).fill(-1),
    done = new Uint8Array(N),
    ex = s1 % w,
    ez = Math.floor(s1 / w),
    est = (k: number) => Math.hypot((k % w) - ex, Math.floor(k / w) - ez) * step,
    open = heap(f);
  g[s0] = 0;
  f[s0] = est(s0);
  open.push(s0);
  while (open.size) {
    const k = open.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === s1) break;
    const ki = k % w,
      kj = Math.floor(k / w);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = ki + di,
          jj = kj + dj;
        if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
        const q = jj * w + ii;
        if (done[q]) continue;
        const c = g[k] + cost(k, q, Math.hypot(di, dj) * step);
        if (c < g[q]) {
          g[q] = c;
          f[q] = c + est(q);
          from[q] = k;
          open.push(q);
        }
      }
  }
  if (s0 !== s1 && from[s1] < 0) return null;
  const path: number[] = [];
  for (let k = s1; k >= 0; k = from[k]) {
    path.push(k);
    if (k === s0) break;
  }
  return path.reverse();
}

/** Corner-cutting smoothing (each pass replaces a corner by two points a quarter of the way in). */
function chaikin(pts: [number, number][], passes: number) {
  let p = pts;
  for (let it = 0; it < passes; it++) {
    const q: [number, number][] = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const [ax, az] = p[k],
        [bx, bz] = p[k + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
/** Points about every `every` metres along a polyline (its ends kept). */
function resample(pts: [number, number][], every: number) {
  const out: [number, number][] = [pts[0]];
  for (const p of pts) if (Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > every) out.push(p);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
export function cumulativeOf(pts: [number, number][]) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}
/** The point at distance v along a polyline. */
export function pointAt(pts: [number, number][], cum: number[], v: number): [number, number] {
  const total = cum[cum.length - 1];
  v = Math.max(0, Math.min(total, v));
  let lo = 0,
    hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= v) lo = m;
    else hi = m;
  }
  const L = cum[hi] - cum[lo] || 1,
    t = (v - cum[lo]) / L;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}

/** The day's tour and its coarse route, over the world map. */
export function planJourney(L: LandData): Journey {
  const n = L.n,
    cell = L.cell,
    // World cells: rows run south, Vista's z north.
    cellOf = (x: number, z: number) => Math.min(n - 1, Math.max(0, Math.floor(n - z / cell))) * n + Math.min(n - 1, Math.max(0, Math.floor(x / cell))),
    X = (c: number) => ((c % n) + 0.5) * cell,
    Z = (c: number) => (n - Math.floor(c / n) - 0.5) * cell,
    EDGE = 4,
    blocked = (c: number) => {
      const x = c % n,
        y = Math.floor(c / n);
      return L.wet[c] > -1e8 || x < EDGE || y < EDGE || x >= n - EDGE || y >= n - EDGE;
    },
    cost = (k: number, q: number, len: number) => {
      if (blocked(q)) return Infinity;
      const sl = Math.abs(L.h[q] - L.h[k]) / len;
      return len * (1 + 30 * sl * sl + (sl > 0.25 ? 4 : 0));
    },
    // The nearest cell that is not water.
    dryNear = (c: number) => {
      const cx = c % n,
        cy = Math.floor(c / n);
      for (let r = 0; r < 40; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx,
              y = cy + dy;
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            if (!blocked(y * n + x)) return y * n + x;
          }
      return c;
    };
  // The tour: westmost first, then the nearest not yet visited.
  const left = [...L.places],
    tour: Place[] = [];
  left.sort((a, b) => a.x - b.x);
  tour.push(left.shift()!);
  while (left.length) {
    const last = tour[tour.length - 1];
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].x - last.x, left[i].z - last.z) < Math.hypot(left[bi].x - last.x, left[bi].z - last.z)) bi = i;
    tour.push(left.splice(bi, 1)[0]);
  }
  // Leg by leg over the world map; a place that cannot be reached (across the sea) is left out.
  const cells: number[] = [],
    stopCells: { place: Place; cell: number }[] = [];
  let at = dryNear(cellOf(tour[0].x, tour[0].z));
  cells.push(at);
  stopCells.push({ place: tour[0], cell: at });
  for (const p of tour.slice(1)) {
    const goal = dryNear(cellOf(p.x, p.z)),
      path = astar(n, n, cell, at, goal, cost);
    if (!path) continue;
    cells.push(...path.slice(1));
    stopCells.push({ place: p, cell: goal });
    at = goal;
  }
  const raw: [number, number][] = cells.map((c) => [X(c), Z(c)]),
    coarse = resample(chaikin(raw, 3), 100),
    coarseAt = cumulativeOf(coarse),
    stops = stopCells.map(({ place, cell: c }) => {
      let best = 0,
        bd = Infinity;
      coarse.forEach(([x, z], i) => {
        const d = Math.hypot(x - X(c), z - Z(c));
        if (d < bd) (bd = d), (best = i);
      });
      return { ...place, at: coarseAt[best] };
    });
  return { coarse, coarseAt, stops };
}

/**
 * The walk from (x0, z0) to the point `to` metres along the coarse route: A* over a 32 m lattice
 * of the land at full detail (steep ground costs, rivers are forded only where they must be, lakes
 * and the sea cannot be crossed), smoothed, a point every 16 m or so. Null if no way is found.
 */
export function refine(j: Journey, x0: number, z0: number, to: number): [number, number][] | null {
  const [x1, z1] = pointAt(j.coarse, j.coarseAt, to),
    step = 32,
    M = 500,
    bx0 = Math.min(x0, x1) - M,
    bz0 = Math.min(z0, z1) - M,
    w = Math.ceil((Math.max(x0, x1) + M - bx0) / step) + 1,
    h = Math.ceil((Math.max(z0, z1) + M - bz0) / step) + 1,
    H = new Float32Array(w * h),
    W = new Uint8Array(w * h);
  for (let jj = 0; jj < h; jj++)
    for (let ii = 0; ii < w; ii++) {
      const k = jj * w + ii,
        hh = ground(bx0 + ii * step, bz0 + jj * step);
      H[k] = hh;
      W[k] = G.level > hh ? (G.lake || G.sea ? 2 : 1) : 0;
    }
  const node = (x: number, z: number) => {
      const i = Math.min(w - 1, Math.max(0, Math.round((x - bx0) / step))),
        jz = Math.min(h - 1, Math.max(0, Math.round((z - bz0) / step)));
      for (let r = 0; r < Math.max(w, h); r++)
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
            const ii = i + di,
              jj = jz + dj;
            if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
            if (!W[jj * w + ii]) return jj * w + ii;
          }
      return jz * w + i;
    },
    s0 = node(x0, z0),
    s1 = node(x1, z1),
    path = astar(w, h, step, s0, s1, (k, q, len) => {
      if (W[q] === 2) return Infinity;
      const sl = Math.abs(H[q] - H[k]) / len;
      return len * (1 + 60 * sl * sl + (sl > 0.45 ? 40 : 0)) + (W[q] === 1 ? 500 : 0);
    });
  if (!path) return null;
  const pts: [number, number][] = [[x0, z0], ...path.map((k): [number, number] => [bx0 + (k % w) * step, bz0 + Math.floor(k / w) * step])];
  return resample(chaikin(pts, 3), 16);
}

/** Join a newly refined stretch onto the walk so far, smoothing across the join (only the last few
 * points of the walk so far move, all well ahead of the party). */
export function append(walk: [number, number][], more: [number, number][]) {
  if (!walk.length) {
    walk.push(...more);
    return;
  }
  const keep = Math.max(1, walk.length - 8),
    joint = chaikin([...walk.slice(keep - 1), ...more.slice(1)], 2);
  walk.splice(keep - 1, walk.length - keep + 1, ...resample(joint, 16));
}
