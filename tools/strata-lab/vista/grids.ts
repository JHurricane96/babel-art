// Vista grids: the valley sampled for the renderer, a band of rows at a time
// (workers build bands in parallel). Per cell: the surface height (ground, or
// water where there is water), its normal and hollowness (for shading), the
// forest's density, and what the ground is (KIND). The fine grid also says
// where its trees stand.
import {
  GRIDS, KIND, ROAD2, ROUTE, TOWN, T, TREE_KINDS, fbm, hash2, nearest, smooth, terrain, vnoise, waterLevel,
} from "./valley";

export interface Band {
  gi: number;
  r0: number;
  r1: number;
  /** Surface height: ground, or the water's surface. */
  h: Float32Array;
  /** RGBA8: normal x and z (0..255 for -1..1), hollowness, forest density. */
  nrm: Uint8Array;
  /** Fine grid: distance to the nearest road, 0.05 m a step (so roads have smooth edges). */
  road: Uint8Array;
  kind: Uint8Array;
  /** Fine grid only: trees, 6 floats each (x, y, z, height in metres, kind, variant). */
  trees?: Float32Array;
}

export function buildBand(gi: number, r0: number, r1: number): Band {
  const g = GRIDS[gi],
    n = g.n,
    M = 4,
    ra = Math.max(0, r0 - M),
    rb = Math.min(n, r1 + M),
    rows = rb - ra,
    ground = new Float32Array(rows * n),
    surf = new Float32Array(rows * n),
    DR = new Float32Array(rows * n),
    DL = new Float32Array(rows * n);
  for (let r = ra; r < rb; r++) {
    const z = g.z0 + r * g.cell;
    for (let c = 0; c < n; c++) {
      const x = g.x0 + c * g.cell,
        i = (r - ra) * n + c,
        h = terrain(x, z);
      ground[i] = h;
      surf[i] = Math.max(h, waterLevel());
      DR[i] = T.dr;
      DL[i] = T.dl;
    }
  }
  // Paths and the town, marked on the fine grid (and the town on the mid).
  const out = r1 - r0,
    mask = new Uint8Array(out * n);
  const mark = (pts: number[][], half: number, bit: number) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k],
        [bx, bz] = pts[k + 1],
        c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - g.x0) / g.cell)),
        c1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + half - g.x0) / g.cell)),
        q0 = Math.max(r0, Math.floor((Math.min(az, bz) - half - g.z0) / g.cell)),
        q1 = Math.min(r1 - 1, Math.ceil((Math.max(az, bz) + half - g.z0) / g.cell));
      for (let r = q0; r <= q1; r++)
        for (let c = c0; c <= c1; c++)
          if (nearest([pts[k], pts[k + 1]], g.x0 + c * g.cell, g.z0 + r * g.cell) <= half) mask[(r - r0) * n + c] |= bit;
    }
  };
  const road = new Uint8Array(out * n).fill(255);
  if (gi === 0) {
    mark(ROUTE, 5, 2); // no trees on the road's verges
    mark(ROAD2, 5, 2);
    for (const pts of [ROUTE, ROAD2])
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k],
          [bx, bz] = pts[k + 1],
          c0 = Math.max(0, Math.floor((Math.min(ax, bx) - 13 - g.x0) / g.cell)),
          c1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + 13 - g.x0) / g.cell)),
          q0 = Math.max(r0, Math.floor((Math.min(az, bz) - 13 - g.z0) / g.cell)),
          q1 = Math.min(r1 - 1, Math.ceil((Math.max(az, bz) + 13 - g.z0) / g.cell));
        for (let r = q0; r <= q1; r++)
          for (let c = c0; c <= c1; c++) {
            const d = nearest([pts[k], pts[k + 1]], g.x0 + c * g.cell, g.z0 + r * g.cell),
              o = (r - r0) * n + c;
            road[o] = Math.min(road[o], Math.round(Math.min(12.7, d) * 20));
          }
      }
  }
  if (gi <= 1) {
    mark(TOWN, 30, 4);
    mark([[1300, 1440], [1380, 1490]], 40, 4);
  }
  const h = new Float32Array(out * n),
    nrm = new Uint8Array(out * n * 4),
    kind = new Uint8Array(out * n),
    trees: number[] = [],
    cell = g.cell,
    R = Math.max(1, Math.round(6 / cell));
  for (let r = r0; r < r1; r++) {
    const z = g.z0 + r * cell,
      li = r - ra;
    for (let c = 0; c < n; c++) {
      const x = g.x0 + c * cell,
        i = li * n + c,
        o = (r - r0) * n + c,
        gh = ground[i],
        xl = c > 0 ? i - 1 : i,
        xr = c < n - 1 ? i + 1 : i,
        zd = li > 0 ? i - n : i,
        zu = li < rows - 1 ? i + n : i,
        hx = (ground[xr] - ground[xl]) / ((xr - xl) * cell || 1),
        hz = (ground[zu] - ground[zd]) / (((zu - zd) / n) * cell || 1),
        slope = Math.hypot(hx, hz),
        water = surf[i] > gh + 0.01,
        m = mask[o];
      // Hollowness: how far the ground lies below its neighbours a few metres off.
      let avg = 0,
        cnt = 0;
      for (const [dc, dr] of [[R, 0], [-R, 0], [0, R], [0, -R]]) {
        const cc = c + dc,
          rr = li + dr;
        if (cc < 0 || cc >= n || rr < 0 || rr >= rows) continue;
        avg += ground[rr * n + cc];
        cnt++;
      }
      const hollow = cnt ? Math.max(0, Math.min(1, 0.5 + (avg / cnt - gh) / (cell * R * 0.6))) : 0.5;
      const nl = Math.hypot(hx, 1, hz),
        nx = water ? 0 : -hx / nl,
        nz = water ? 0 : -hz / nl;
      // What the ground is.
      const nz5 = vnoise(x / 180, z / 180, 5),
        dr = DR[i],
        dl = DL[i];
      let k: number = KIND.GRASS,
        forest = 0;
      if (water) k = dl < 900 && dr > 26 ? KIND.LAKE : KIND.RIVER;
      else if (m & 1) k = KIND.PATH;
      else if ((dr > 17 && dr < 23) || (dl > 440 && dl < 468 && gh < 392)) k = KIND.SHORE;
      else if (m & 4) k = KIND.YARD;
      else if (gh > 1480 + 170 * (nz5 - 0.5) && slope < 1.15) k = KIND.SNOW;
      else if (slope > 0.95) k = KIND.ROCK;
      else if (gh > 1260 + 140 * (nz5 - 0.5)) k = slope > 0.4 ? KIND.SCREE : KIND.ALPINE;
      else if (slope > 0.66 && gh > 450) k = KIND.SCREE;
      else if (gi <= 1 && dr > 30 && dr < 170 && z > -1500 && z < 1440 && slope < 0.12) {
        const u = x * 0.83 + z * 0.56,
          v = -x * 0.56 + z * 0.83,
          um = ((u % 46) + 46) % 46;
        if (um < 3.5) k = KIND.HEDGE;
        else {
          const f = hash2(Math.floor(u / 46), Math.floor(v / 120), 9);
          k = f < 0.4 ? KIND.WHEAT : f < 0.75 ? KIND.GREEN : KIND.FALLOW;
        }
      } else {
        const fm = fbm(x / 380, z / 380, 21, 4),
          thr = 0.555 - 0.05 * smooth(300, 700, gh);
        const clearing = Math.hypot(x - 520, z - 330) < 260;
        if (fm > thr && gh < 1180 + 100 * (nz5 - 0.5) && dr > 45 && !clearing) {
          k = gh > 540 + 90 * (nz5 - 0.5) ? KIND.CONIFER : KIND.FOREST;
          forest = smooth(thr, thr + 0.09, fm);
        } else k = gh > 760 + 80 * (nz5 - 0.5) ? KIND.ALPINE : KIND.GRASS;
      }
      h[o] = surf[i];
      nrm[o * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      nrm[o * 4 + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      nrm[o * 4 + 2] = Math.round(hollow * 255);
      nrm[o * 4 + 3] = Math.round(forest * 255);
      kind[o] = k;
      // Trees (fine grid): thick in the woods, scattered in the open, along hedges and the river.
      if (gi !== 0 || water || m & 3) continue;
      const p = hash2(c, r, 11);
      let want = false,
        tk = 0;
      const sp = fbm(x / 260, z / 260, 61, 2);
      if (k === KIND.FOREST) {
        want = p < 0.06 + 0.16 * forest;
        tk = sp < 0.42 ? 0 : sp < 0.55 ? 1 : sp < 0.68 ? 2 : 3;
      } else if (k === KIND.CONIFER) {
        want = p < 0.05 + 0.15 * forest;
        tk = slope > 0.5 || gh > 980 ? 6 : sp > 0.6 ? 5 : 4;
        if (gh < 640 && hash2(c, r, 19) < 0.25) tk = 3;
      } else if (k === KIND.HEDGE) {
        want = p < 0.05;
        tk = sp < 0.5 ? 0 : 2;
      } else if (k === KIND.GRASS) {
        want = p < 0.0012 || (dr > 23 && dr < 42 && p < 0.035);
        tk = dr < 42 ? (sp < 0.5 ? 3 : 2) : sp < 0.5 ? 0 : 2;
      } else if (k === KIND.ALPINE || k === KIND.SCREE) {
        want = gh < 1250 && p < 0.004;
        tk = 6;
      } else if (k === KIND.YARD) {
        want = p < 0.002;
        tk = 2;
      }
      if (!want) continue;
      const jx = x + (hash2(c, r, 12) - 0.5) * cell * 0.9,
        jz = z + (hash2(c, r, 13) - 0.5) * cell * 0.9,
        [h0, h1] = TREE_KINDS[tk].h;
      trees.push(jx, gh - 0.3, jz, h0 + (h1 - h0) * hash2(c, r, 15), tk, Math.floor(hash2(c, r, 16) * 3));
    }
  }
  return { gi, r0, r1, h, nrm, road, kind, trees: gi === 0 ? Float32Array.from(trees) : undefined };
}
