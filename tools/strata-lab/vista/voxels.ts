// Voxel trees for the scale lab: the same layouts as the sprites (sprites.ts), built in 3D.
//
// A tree is built once at 128 voxels tall: its trunk and limbs as cylinders, each leaf mass a
// heap of leaf clumps (spheres, ragged), every voxel coloured from the species' six-shade ramp by
// the sun (fixed in the world, so it stays right as the camera turns), its own clump's roundness,
// and whether the crown shades it from the sun. Coarser levels halve it four times (64, 32, 16,
// 8 voxels tall). Drawn, the coarsest level whose voxels are still at least a pixel is used, and
// each voxel covers the pixels its projected square covers.
import { M } from "../../../engine/strata/world";
import { TREES } from "../../../engine/strata/art";
import { type Img, TREE_NAMES, broadleafPlan, coniferPlan, pinePlan, rampsFor } from "./sprites";
import { mulberry } from "./valley";

const N0 = 128;
const SUN = (() => {
  const v = [-0.45, 0.72, -0.53],
    l = Math.hypot(...v);
  return v.map((c) => c / l);
})();
const hash3 = (x: number, y: number, z: number, s: number) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/** A grid of voxels: material (0 empty, 1 leaf, 2 wood) and tone (1-6). Origin at the foot, centred in x and z. */
class Grid {
  m: Uint8Array;
  t: Uint8Array;
  constructor(public nx: number, public ny: number, public nz: number) {
    this.m = new Uint8Array(nx * ny * nz);
    this.t = new Uint8Array(nx * ny * nz);
  }
  idx(x: number, y: number, z: number) {
    return (y * this.nz + z) * this.nx + x;
  }
  in(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }
}

export interface VLevel {
  /** Voxel size in level-0 voxels (1, 2, 4, 8, 16). */
  v: number;
  /** Surface voxels: x, y, z (level-0 voxels from the foot, voxel centres; y up), r, g, b. */
  list: Float32Array;
}
export interface VModel {
  levels: VLevel[];
}

function build(name: string, seed: number): Grid {
  const W = 104,
    g = new Grid(W, N0 + 4, W),
    cx = W / 2,
    cz = W / 2,
    H = N0,
    S = mulberry(seed * 3 + 17);
  const put = (x: number, y: number, z: number, m: number, t: number) => {
    const xi = Math.floor(x + cx),
      yi = Math.floor(y),
      zi = Math.floor(z + cz);
    if (!g.in(xi, yi, zi)) return;
    const i = g.idx(xi, yi, zi);
    g.m[i] = m;
    g.t[i] = Math.max(1, Math.min(6, Math.round(t)));
  };
  const cylinder = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r0: number, r1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0),
      n = Math.ceil(len * 2);
    for (let k = 0; k <= n; k++) {
      const u = k / Math.max(1, n),
        px = x0 + (x1 - x0) * u,
        py = y0 + (y1 - y0) * u,
        pz = z0 + (z1 - z0) * u,
        r = Math.max(0.6, r0 + (r1 - r0) * u);
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++)
          for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
            const d = Math.hypot(dx, dz);
            if (d > r || Math.abs(dy) > 1) continue;
            put(px + dx, py + dy, pz + dz, 2, 3 + (hash3(px + dx, py + dy, pz + dz, 3) < 0.12 ? -1 : 0));
          }
    }
  };
  /** A leaf mass: clumps heaped in an ellipsoid, each a ragged ball lit by the sun, lighter toward the mass's sunny side. */
  const mass = (mx: number, my: number, mz: number, rx: number, ry: number, rz: number, needles: boolean, ms: number) => {
    const r0 = Math.max(1.5, rx * 0.28),
      r1 = Math.max(2, rx * 0.42),
      n = Math.max(4, Math.round(((rx * ry * rz) / (r0 * r1 * (r0 + r1) * 0.5)) * 1.6));
    for (let k = 0; k < n; k++) {
      const R = mulberry(ms * 1009 + k * 7919),
        a = R() * Math.PI * 2,
        b = Math.acos(2 * R() - 1),
        d = Math.cbrt(R()),
        x = mx + Math.sin(b) * Math.cos(a) * d * Math.max(0, rx - r0 * 0.6),
        y = my + Math.cos(b) * d * Math.max(0, ry - r0 * 0.6),
        z = mz + Math.sin(b) * Math.sin(a) * d * Math.max(0, rz - r0 * 0.6),
        r = r0 + (r1 - r0) * R(),
        salt = Math.floor(R() * 1e6);
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++)
          for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
            const dd = Math.hypot(dx, dy, dz),
              rag = 1 + 0.15 * (hash3(dx, dy, dz, salt) - 0.5);
            if (dd > r * rag) continue;
            if (dd < r * 0.75 && hash3(dx + 7, dy, dz, salt) < 0.03) continue; // gaps
            const tex = needles ? (hash3(x + dx, Math.floor((y + dy) / 2), z + dz, 5) - 0.5) * 2.2 : (hash3(x + dx, y + dy, z + dz, 5) - 0.5) * 2;
            put(x + dx, y + dy, z + dz, 1, 3 + Math.round(tex));
          }
    }
  };
  if (name === "spruce" || name === "fir") {
    const p = coniferPlan(name, seed),
      span = H * (1 - p.base);
    cylinder(0, 0, 0, 0, H - 2, 0, Math.max(1, H * 0.03), 0.6);
    for (let k = p.tiers.length - 1; k >= 0; k--) {
      const tier = p.tiers[k],
        y = H - tier.t * span,
        w = tier.w * (0.1 + 0.9 * tier.t) * H,
        th = (span / p.tiers.length) * 1.05;
      // A tier: a ring of drooping branch masses round the trunk, and one over it.
      const ring = Math.max(3, Math.round(w / 6));
      for (let j = 0; j < ring; j++) {
        const a = (j / ring) * Math.PI * 2 + tier.j[0] * 6,
          u = 0.55 + 0.3 * tier.j[1];
        mass(Math.cos(a) * w * u, y - th * 0.35 * u * u, Math.sin(a) * w * u, Math.max(1.5, w * 0.45), Math.max(1.2, th * 0.5), Math.max(1.5, w * 0.45), true, seed * 13 + k * 31 + j);
      }
      mass(0, y + th * 0.15, 0, Math.max(1.2, w * 0.35), Math.max(1.2, th * 0.55), Math.max(1.2, w * 0.35), true, seed * 17 + k);
    }
    mass(0, H - H * 0.05, 0, Math.max(1, p.W * H * 0.05), Math.max(1.5, H * 0.06), Math.max(1, p.W * H * 0.05), true, seed + 5);
  } else if (name === "pine") {
    const p = pinePlan(seed),
      zl = (S() - 0.5) * 0.1;
    cylinder(0, 0, 0, p.lean * H, H * 0.7, zl * H, Math.max(1, H * 0.035), Math.max(0.8, H * 0.018));
    p.limbs.forEach((l) => {
      const z = (S() - 0.5) * H * 0.25;
      cylinder(l.x0 * H, -l.y0 * H, zl * H, l.x2 * H, -l.y2 * H, z, Math.max(0.6, l.w * H * 0.5), 0.6);
    });
    p.pads.forEach((m, i) => mass(m.x * H, -m.y * H, (S() - 0.5) * H * 0.25, m.rx * H, m.ry * H, m.rx * H * 0.9, true, seed * 7 + i * 131));
  } else {
    const plan = broadleafPlan(name, seed),
      depth = new Map<number, number>();
    for (const st of plan.stems) {
      const zl = (S() - 0.5) * 0.04;
      cylinder(st.x * H, 0, 0, (st.x + st.lean) * H, st.h * H, zl * H, Math.max(1, (st.w0 * H) / 2), Math.max(0.7, (st.w1 * H) / 2));
    }
    plan.masses.forEach((m, i) => depth.set(i, (S() - 0.5) * m.rx * H * 1.3));
    for (const l of plan.limbs) {
      const z = (S() - 0.5) * H * 0.2;
      cylinder(l.x0 * H, -l.y0 * H, 0, l.x1 * H, -l.y1 * H, z * 0.5, Math.max(0.6, (l.w * H) / 2), Math.max(0.6, (l.w * H) / 3));
      cylinder(l.x1 * H, -l.y1 * H, z * 0.5, l.x2 * H, -l.y2 * H, z, Math.max(0.6, (l.w * H) / 3), 0.6);
    }
    plan.masses.forEach((m, i) => mass(m.x * H, -m.y * H, depth.get(i)!, m.rx * H, m.ry * H, m.rx * H * 0.95, false, seed * 7 + i * 131));
  }
  void TREES;
  return g;
}

/** Halve a grid: a coarse voxel is filled where enough of its eight are (any, for wood), its tone their mean. */
function halve(g: Grid): Grid {
  const h = new Grid(Math.ceil(g.nx / 2), Math.ceil(g.ny / 2), Math.ceil(g.nz / 2));
  for (let y = 0; y < h.ny; y++)
    for (let z = 0; z < h.nz; z++)
      for (let x = 0; x < h.nx; x++) {
        let leaf = 0,
          wood = 0,
          ts = 0;
        for (let k = 0; k < 8; k++) {
          const xx = x * 2 + (k & 1),
            yy = y * 2 + ((k >> 1) & 1),
            zz = z * 2 + ((k >> 2) & 1);
          if (!g.in(xx, yy, zz)) continue;
          const i = g.idx(xx, yy, zz);
          if (g.m[i] === 1) leaf++;
          else if (g.m[i] === 2) wood++;
          if (g.m[i]) ts += g.t[i];
        }
        if (wood > 0 && wood >= leaf) {
          const i = h.idx(x, y, z);
          h.m[i] = 2;
          h.t[i] = Math.round(ts / (leaf + wood));
        } else if (leaf >= 3) {
          const i = h.idx(x, y, z);
          h.m[i] = 1;
          h.t[i] = Math.round(ts / (leaf + wood));
        }
      }
  return h;
}

/** The voxels that show (an empty neighbour), coloured, shaded where the crown hides them from the sun. */
function surface(g: Grid, v: number, ramps: Record<number, number[][]>): Float32Array {
  const out: number[] = [];
  for (let y = 0; y < g.ny; y++)
    for (let z = 0; z < g.nz; z++)
      for (let x = 0; x < g.nx; x++) {
        const i = g.idx(x, y, z),
          m = g.m[i];
        if (!m) continue;
        let open = false;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const xx = x + dx,
            yy = y + dy,
            zz = z + dz;
          if (!g.in(xx, yy, zz) || !g.m[g.idx(xx, yy, zz)]) {
            open = true;
            break;
          }
        }
        if (!open) continue;
        // In the crown's shadow: something solid a few voxels toward the sun.
        let shade = 0;
        for (let s = 2; s <= 7; s++) {
          const xx = Math.round(x + SUN[0] * s),
            yy = Math.round(y + SUN[1] * s),
            zz = Math.round(z + SUN[2] * s);
          if (g.in(xx, yy, zz) && g.m[g.idx(xx, yy, zz)]) {
            shade = s < 4 ? 2 : 1;
            break;
          }
        }
        // Which way the surface faces: away from the filled space round it, near (the clump) and wider (the crown).
        const nrm = (r: number) => {
          let gx = 0,
            gy = 0,
            gz = 0;
          for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++)
              for (let dx = -r; dx <= r; dx++) {
                const xx = x + dx,
                  yy = y + dy,
                  zz = z + dz;
                if (g.in(xx, yy, zz) && g.m[g.idx(xx, yy, zz)]) {
                  gx -= dx;
                  gy -= dy;
                  gz -= dz;
                }
              }
          const l = Math.hypot(gx, gy, gz) || 1;
          return Math.max(0, (gx * SUN[0] + gy * SUN[1] + gz * SUN[2]) / l);
        };
        const lam = m === 2 ? 0.25 + 0.6 * nrm(1) : 0.55 * nrm(2) + 0.45 * nrm(4),
          tone = Math.max(1, Math.min(6, Math.round(1 + lam * 4.6 + (g.t[i] - 3) * 0.6 + 0.2) - shade)),
          c = (ramps[m === 1 ? M.LEAF : M.WOOD] ?? ramps[M.LEAF])[tone - 1];
        out.push((x + 0.5) * v - (g.nx * v) / 2, y * v + v / 2, (z + 0.5) * v - (g.nz * v) / 2, c[0] * 255, c[1] * 255, c[2] * 255);
      }
  return Float32Array.from(out);
}

const models = new Map<string, VModel>();
/** The voxel model of a tree sprite slot (kind * 3 + variant), built on first use. */
export function voxelTree(slot: number): VModel {
  const kind = Math.floor(slot / 3),
    name = TREE_NAMES[kind],
    key = `${slot}`;
  let mdl = models.get(key);
  if (mdl) return mdl;
  const seed = 1000 + slot * 131 + (slot % 3) * 7919,
    ramps = rampsFor(name);
  let g = build(name, seed);
  const levels: VLevel[] = [];
  for (let k = 0, v = 1; k < 5; k++, v *= 2) {
    levels.push({ v, list: surface(g, v, ramps) });
    if (k < 4) g = halve(g);
  }
  models.set(key, (mdl = { levels }));
  return mdl;
}

/**
 * A voxel tree drawn for this camera into a picture of its own (aligned at its foot), so it can
 * stand in the scene like a sprite. h: its height in metres; yaw: which way it was planted.
 */
export function drawVoxelTree(
  mdl: VModel,
  h: number,
  plantYaw: number,
  tree: { x: number; z: number },
  cam: { x: number; y: number; z: number; yaw: number },
  F: number,
): Img {
  const fx = Math.sin(cam.yaw),
    fz = Math.cos(cam.yaw),
    rx = Math.cos(cam.yaw),
    rz = -Math.sin(cam.yaw),
    scale = h / N0,
    ex = tree.x - cam.x,
    ez = tree.z - cam.z,
    vz0 = ex * fx + ez * fz,
    s0 = (scale * F) / vz0;
  // The coarsest level whose voxels are still at least a pixel.
  let k = 0;
  while (k < mdl.levels.length - 1 && s0 * mdl.levels[k + 1].v <= 1.6) k++;
  const lv = mdl.levels[k],
    footX = Math.floor(ART_CENTER + (F * (ex * rx + ez * rz)) / vz0 + 0.5),
    footY = Math.floor(HZ_LAB + (F * cam.y) / vz0 + 0.5),
    cy = Math.cos(plantYaw),
    sy = Math.sin(plantYaw),
    L = lv.list,
    n = L.length / 6,
    px: number[] = [],
    py: number[] = [],
    half: number[] = [],
    dep: number[] = [];
  let x0 = 1e9,
    x1 = -1e9,
    y0 = 1e9,
    y1 = -1e9;
  for (let i = 0; i < n; i++) {
    const mx = L[i * 6] * scale,
      my = L[i * 6 + 1] * scale,
      mz = L[i * 6 + 2] * scale,
      wx = tree.x + mx * cy - mz * sy,
      wz = tree.z + mx * sy + mz * cy,
      qx = wx - cam.x,
      qz = wz - cam.z,
      vz = qx * fx + qz * fz,
      sx = ART_CENTER + (F * (qx * rx + qz * rz)) / vz - footX,
      syy = HZ_LAB - (F * (my - cam.y)) / vz - footY,
      s = (lv.v * scale * F) / vz;
    px.push(sx);
    py.push(syy);
    half.push(s / 2);
    dep.push(vz);
    x0 = Math.min(x0, sx - s / 2);
    x1 = Math.max(x1, sx + s / 2);
    y0 = Math.min(y0, syy - s / 2);
    y1 = Math.max(y1, syy + s / 2);
  }
  const ox = Math.floor(x0) - 1,
    oy = Math.floor(y0) - 1,
    w = Math.max(1, Math.ceil(x1) - ox + 2),
    hh = Math.max(1, Math.ceil(y1) - oy + 2),
    data = new Uint8ClampedArray(w * hh * 4),
    zb = new Float32Array(w * hh).fill(1e9);
  for (let i = 0; i < n; i++) {
    const a0 = Math.ceil(px[i] - half[i] - 0.5),
      a1 = Math.max(a0 + 1, Math.ceil(px[i] + half[i] - 0.5)),
      b0 = Math.ceil(py[i] - half[i] - 0.5),
      b1 = Math.max(b0 + 1, Math.ceil(py[i] + half[i] - 0.5));
    for (let yy = b0; yy < b1; yy++)
      for (let xx = a0; xx < a1; xx++) {
        const lx = xx - ox,
          ly = yy - oy;
        if (lx < 0 || ly < 0 || lx >= w || ly >= hh) continue;
        const j = ly * w + lx;
        if (dep[i] >= zb[j]) continue;
        zb[j] = dep[i];
        data[j * 4] = L[i * 6 + 3];
        data[j * 4 + 1] = L[i * 6 + 4];
        data[j * 4 + 2] = L[i * 6 + 5];
        data[j * 4 + 3] = 255;
      }
  }
  return { w, h: hh, ax: -ox, ay: -oy, data };
}
// The lab's view: where the picture's centre and horizon are (set by scalelab.ts).
let ART_CENTER = 160,
  HZ_LAB = 40;
export function setView(centre: number, horizon: number) {
  ART_CENTER = centre;
  HZ_LAB = horizon;
}
