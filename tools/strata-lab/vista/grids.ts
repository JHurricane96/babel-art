// Vista grids: the land (land.ts, from a generated world) sampled for the renderer, a band of rows
// at a time (workers build bands in parallel). Per cell: the surface height (ground, or water
// where there is water), its normal and hollowness (for shading), the woods' density, what the
// ground is (KIND) and its biome. The fine grid also says where its trees stand and how far the
// nearest road is.
import { G, biomeAt, ground, groundKind, pickTree, woodsOf } from "./land";
import { type GridSpec, KIND, TREE_KINDS, hash2, nearest } from "./valley";

export interface Band {
  gi: number;
  r0: number;
  r1: number;
  /** Surface height: ground, or the water's surface. */
  h: Float32Array;
  /** RGBA8: normal x and z (0..255 for -1..1), hollowness, woods' density. */
  nrm: Uint8Array;
  /** Fine grid: distance to the nearest road, 0.05 m a step (so roads have smooth edges). */
  road: Uint8Array;
  /** Two bytes a cell: the kind of ground, and the biome (255 for water). */
  kind: Uint8Array;
  /** Fine grid only: trees, 6 floats each (x, y, z, height in metres, kind, variant). */
  trees?: Float32Array;
}

export function buildBand(gi: number, r0: number, r1: number, g: GridSpec, route: number[][]): Band {
  const n = g.n,
    M = 4,
    ra = Math.max(0, r0 - M),
    rb = Math.min(n, r1 + M),
    rows = rb - ra,
    groundH = new Float32Array(rows * n),
    surf = new Float32Array(rows * n),
    wk = new Uint8Array(rows * n),
    DR = new Float32Array(rows * n);
  for (let r = ra; r < rb; r++) {
    const z = g.z0 + r * g.cell;
    for (let c = 0; c < n; c++) {
      const x = g.x0 + c * g.cell,
        i = (r - ra) * n + c,
        h = ground(x, z);
      groundH[i] = h;
      surf[i] = Math.max(h, G.level);
      wk[i] = G.level > h ? (G.lake || G.sea ? 2 : 1) : 0;
      DR[i] = G.river - G.rw;
    }
  }
  // The day's route, on the fine grid: its distance (for the path's edges, drawn when asked) and no
  // trees on it.
  const out = r1 - r0,
    road = new Uint8Array(out * n).fill(255),
    onRoad = new Uint8Array(out * n);
  if (gi === 0)
    for (let k = 0; k < route.length - 1; k++) {
      const [ax, az] = route[k],
        [bx, bz] = route[k + 1],
        c0 = Math.max(0, Math.floor((Math.min(ax, bx) - 13 - g.x0) / g.cell)),
        c1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + 13 - g.x0) / g.cell)),
        q0 = Math.max(r0, Math.floor((Math.min(az, bz) - 13 - g.z0) / g.cell)),
        q1 = Math.min(r1 - 1, Math.ceil((Math.max(az, bz) + 13 - g.z0) / g.cell));
      for (let r = q0; r <= q1; r++)
        for (let c = c0; c <= c1; c++) {
          const d = nearest([route[k], route[k + 1]], g.x0 + c * g.cell, g.z0 + r * g.cell),
            o = (r - r0) * n + c;
          road[o] = Math.min(road[o], Math.round(Math.min(12.7, d) * 20));
          if (d < 5) onRoad[o] = 1;
        }
    }
  const h = new Float32Array(out * n),
    nrm = new Uint8Array(out * n * 4),
    kind = new Uint8Array(out * n * 2),
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
        gh = groundH[i],
        xl = c > 0 ? i - 1 : i,
        xr = c < n - 1 ? i + 1 : i,
        zd = li > 0 ? i - n : i,
        zu = li < rows - 1 ? i + n : i,
        hx = (groundH[xr] - groundH[xl]) / ((xr - xl) * cell || 1),
        hz = (groundH[zu] - groundH[zd]) / (((zu - zd) / n) * cell || 1),
        slope = Math.hypot(hx, hz),
        water = wk[i];
      // Hollowness: how far the ground lies below its neighbours a few metres off.
      let avg = 0,
        cnt = 0;
      for (const [dc, dr] of [[R, 0], [-R, 0], [0, R], [0, -R]]) {
        const cc = c + dc,
          rr = li + dr;
        if (cc < 0 || cc >= n || rr < 0 || rr >= rows) continue;
        avg += groundH[rr * n + cc];
        cnt++;
      }
      const hollow = cnt ? Math.max(0, Math.min(1, 0.5 + (avg / cnt - gh) / (cell * R * 0.6))) : 0.5;
      const nl = Math.hypot(hx, 1, hz),
        nx = water ? 0 : -hx / nl,
        nz = water ? 0 : -hz / nl;
      // What the ground is.
      const b = biomeAt(x, z);
      let k: number = KIND.GRASS,
        forest = 0;
      if (water) k = water === 2 ? KIND.LAKE : KIND.RIVER;
      else if (DR[i] < 4 && cell <= 16) k = KIND.SHORE;
      else [k, forest] = groundKind(x, z, gh, slope, b);
      h[o] = surf[i];
      nrm[o * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      nrm[o * 4 + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      nrm[o * 4 + 2] = Math.round(hollow * 255);
      nrm[o * 4 + 3] = Math.round(forest * 255);
      kind[o * 2] = k;
      kind[o * 2 + 1] = water ? 255 : b;
      // Trees (fine grid): thick in the woods, scattered in the open, by what the biome grows.
      if (gi !== 0 || water || onRoad[o] || slope > 0.9) continue;
      const { dense } = woodsOf(b);
      if (dense <= 0) continue;
      const p = hash2(c, r, 11),
        woods = k === KIND.FOREST || k === KIND.CONIFER,
        want = woods ? p < Math.min(0.24, dense * 2.6) * (0.35 + 0.65 * forest) : p < dense * 0.09;
      if (!want) continue;
      const tk = pickTree(b, hash2(c, r, 17)),
        jx = x + (hash2(c, r, 12) - 0.5) * cell * 0.9,
        jz = z + (hash2(c, r, 13) - 0.5) * cell * 0.9,
        [h0, h1] = TREE_KINDS[tk].h;
      trees.push(jx, gh - 0.3, jz, h0 + (h1 - h0) * hash2(c, r, 15), tk, Math.floor(hash2(c, r, 16) * 3));
    }
  }
  return { gi, r0, r1, h, nrm, road, kind, trees: gi === 0 ? Float32Array.from(trees) : undefined };
}
