// Voxel models for the scale lab: trees (from the same layouts as the sprites), bushes, ferns,
// grass, flowers, rocks and the walking party, built in 3D and drawn from any camera.
//
// Each model is built once at its finest level (a tree 192 voxels tall, a rock 48), then halved
// down to a few voxels. Its visible voxels are shaded from the finished shape: which way each
// faces (the gradient of the filled space round it, blurred), lit by the sun (fixed in the
// world), darker in crevices and where the model shades itself, with leaf texture and a few
// sunlit speckles. Drawn, the coarsest level whose voxels are still a pixel or more is used;
// voxels facing away are skipped, those turning away at the edge are a shade darker (an outline,
// as the drawn sprites have), and each covers its projected square with a hair of overlap so no
// gaps open between neighbours.
import { TREES } from "../../../engine/strata/art";
import { rampOf } from "./color";
import {
  BLOOM, DRY_R, FERN_R, GRASS_R, type Img, type Look, MOSS_R, PARTY, ROCK_R, SHRUB_R, TREE_NAMES, broadleafPlan,
  coniferPlan, pinePlan, rampsFor,
} from "./sprites";
import { M } from "../../../engine/strata/world";
import { mulberry } from "./valley";

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

// Materials: each model has its own ramp for each.
const LEAF = 1,
  WOOD = 2,
  ROCK = 3,
  GRASS = 4,
  BLOOMM = 5,
  MOSS = 6,
  SKIN = 7,
  CLOTH = 8,
  HAIR = 9,
  LEGS = 10,
  PACK = 11;
/** Thin materials survive halving even where few of the eight are filled. */
const THIN = new Set([WOOD, GRASS, BLOOMM, LEGS, HAIR]);

class Grid {
  m: Uint8Array;
  t: Int8Array;
  constructor(public nx: number, public ny: number, public nz: number) {
    this.m = new Uint8Array(nx * ny * nz);
    this.t = new Int8Array(nx * ny * nz);
  }
  idx(x: number, y: number, z: number) {
    return (y * this.nz + z) * this.nx + x;
  }
  in(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }
}

/** Drawing in a grid: the foot at the bottom centre; y up. t: a texture offset in shades (-2..2). */
function painter(g: Grid) {
  const cx = g.nx / 2,
    cz = g.nz / 2;
  const put = (x: number, y: number, z: number, m: number, t = 0) => {
    const xi = Math.floor(x + cx),
      yi = Math.floor(y),
      zi = Math.floor(z + cz);
    if (!g.in(xi, yi, zi)) return;
    const i = g.idx(xi, yi, zi);
    g.m[i] = m;
    g.t[i] = Math.max(-2, Math.min(2, Math.round(t)));
  };
  const cylinder = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r0: number, r1: number, m = WOOD) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0),
      n = Math.ceil(len * 2);
    for (let k = 0; k <= n; k++) {
      const u = k / Math.max(1, n),
        px = x0 + (x1 - x0) * u,
        py = y0 + (y1 - y0) * u,
        pz = z0 + (z1 - z0) * u,
        r = Math.max(0.5, r0 + (r1 - r0) * u),
        c = Math.ceil(r);
      for (let dy = -c; dy <= c; dy++)
        for (let dz = -c; dz <= c; dz++)
          for (let dx = -c; dx <= c; dx++)
            if (Math.hypot(dx, dy, dz) <= r) put(px + dx, py + dy, pz + dz, m, hash3(px + dx, py + dy, pz + dz, 3) < 0.12 ? -1 : 0);
    }
  };
  /** A ragged ball (a leaf clump, a lump of rock). */
  const ball = (x: number, y: number, z: number, r: number, m: number, salt: number, tex: (x: number, y: number, z: number) => number) => {
    const c = Math.ceil(r + 1);
    for (let dy = -c; dy <= c; dy++)
      for (let dz = -c; dz <= c; dz++)
        for (let dx = -c; dx <= c; dx++) {
          const d = Math.hypot(dx, dy, dz),
            rag = 1 + 0.18 * (hash3(dx, dy, dz, salt) - 0.5);
          if (d <= r * rag) put(x + dx, y + dy, z + dz, m, tex(x + dx, y + dy, z + dz));
        }
  };
  /** A leaf mass: many small clumps heaped in an ellipsoid. */
  const mass = (mx: number, my: number, mz: number, rx: number, ry: number, rz: number, needles: boolean, seed: number, m = LEAF) => {
    const r0 = Math.max(1.2, rx * 0.17),
      r1 = Math.max(1.6, rx * 0.28),
      n = Math.max(5, Math.round(((rx * ry * rz) / (((r0 + r1) / 2) ** 3)) * 0.9)),
      tex = needles
        ? (x: number, y: number, z: number) => (hash3(x, Math.floor(y / 2), z, 5) - 0.5) * 2.6
        : (x: number, y: number, z: number) => (hash3(x, y, z, 5) - 0.5) * 2.4;
    for (let k = 0; k < n; k++) {
      const R = mulberry(seed * 1009 + k * 7919),
        a = R() * Math.PI * 2,
        b = Math.acos(2 * R() - 1),
        d = Math.cbrt(R()),
        x = mx + Math.sin(b) * Math.cos(a) * d * Math.max(0, rx - r0 * 0.6),
        y = my + Math.cos(b) * d * Math.max(0, ry - r0 * 0.6),
        z = mz + Math.sin(b) * Math.sin(a) * d * Math.max(0, rz - r0 * 0.6);
      ball(x, y, z, r0 + (r1 - r0) * R(), m, Math.floor(R() * 1e6), tex);
    }
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number, t = 0) => {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
      for (let z = Math.floor(z0); z < Math.ceil(z1); z++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) put(x, y, z, m, t);
  };
  return { put, cylinder, ball, mass, box };
}

// ---- Models ------------------------------------------------------------------------------------
interface Built {
  g: Grid;
  ramps: Record<number, number[][]>;
}
function tree(name: string, seed: number, H: number): Built {
  const W = Math.round(H * 0.82),
    g = new Grid(W, H + 4, W),
    P = painter(g),
    S = mulberry(seed * 3 + 17);
  if (name === "spruce" || name === "fir") {
    const p = coniferPlan(name, seed),
      span = H * (1 - p.base);
    P.cylinder(0, 0, 0, 0, H - 2, 0, Math.max(1, H * 0.03), 0.6);
    for (let k = p.tiers.length - 1; k >= 0; k--) {
      const tier = p.tiers[k],
        y = H - tier.t * span,
        w = tier.w * (0.1 + 0.9 * tier.t) * H,
        th = (span / p.tiers.length) * 1.05,
        ring = Math.max(3, Math.round(w / 5));
      for (let j = 0; j < ring; j++) {
        const a = (j / ring) * Math.PI * 2 + tier.j[0] * 6,
          u = 0.55 + 0.3 * tier.j[1];
        P.mass(Math.cos(a) * w * u, y - th * 0.35 * u * u, Math.sin(a) * w * u, Math.max(1.5, w * 0.42), Math.max(1.2, th * 0.45), Math.max(1.5, w * 0.42), true, seed * 13 + k * 31 + j);
      }
      P.mass(0, y + th * 0.15, 0, Math.max(1.2, w * 0.32), Math.max(1.2, th * 0.5), Math.max(1.2, w * 0.32), true, seed * 17 + k);
    }
    P.mass(0, H - H * 0.05, 0, Math.max(1, p.W * H * 0.05), Math.max(1.5, H * 0.06), Math.max(1, p.W * H * 0.05), true, seed + 5);
    return { g, ramps: { [LEAF]: rampsFor(name)[M.LEAF], [WOOD]: rampsFor(name)[M.WOOD] } };
  }
  if (name === "pine") {
    const p = pinePlan(seed),
      zl = (S() - 0.5) * 0.1;
    P.cylinder(0, 0, 0, p.lean * H, H * 0.7, zl * H, Math.max(1, H * 0.032), Math.max(0.8, H * 0.016));
    p.limbs.forEach((l) => P.cylinder(l.x0 * H, -l.y0 * H, zl * H, l.x2 * H, -l.y2 * H, (S() - 0.5) * H * 0.25, Math.max(0.6, l.w * H * 0.5), 0.6));
    p.pads.forEach((m, i) => P.mass(m.x * H, -m.y * H, (S() - 0.5) * H * 0.25, m.rx * H, m.ry * H, m.rx * H * 0.9, true, seed * 7 + i * 131));
    return { g, ramps: { [LEAF]: rampsFor("pine")[M.LEAF], [WOOD]: rampsFor("pine")[M.WOOD] } };
  }
  const plan = broadleafPlan(name, seed);
  for (const st of plan.stems) {
    const zl = (S() - 0.5) * 0.04;
    P.cylinder(st.x * H, 0, 0, (st.x + st.lean) * H, st.h * H, zl * H, Math.max(1, (st.w0 * H) / 2), Math.max(0.7, (st.w1 * H) / 2));
  }
  const depth = plan.masses.map((m) => (S() - 0.5) * m.rx * H * 1.3);
  for (const l of plan.limbs) {
    const z = (S() - 0.5) * H * 0.2;
    P.cylinder(l.x0 * H, -l.y0 * H, 0, l.x1 * H, -l.y1 * H, z * 0.5, Math.max(0.6, (l.w * H) / 2), Math.max(0.6, (l.w * H) / 3));
    P.cylinder(l.x1 * H, -l.y1 * H, z * 0.5, l.x2 * H, -l.y2 * H, z, Math.max(0.6, (l.w * H) / 3), 0.6);
  }
  plan.masses.forEach((m, i) => P.mass(m.x * H, -m.y * H, depth[i], m.rx * H, m.ry * H, m.rx * H * 0.95, false, seed * 7 + i * 131));
  void TREES;
  return { g, ramps: { [LEAF]: rampsFor(name)[M.LEAF], [WOOD]: rampsFor(name)[M.WOOD] } };
}

function shrub(seed: number, H: number, ramp: number[][]): Built {
  const g = new Grid(Math.round(H * 1.8), H + 2, Math.round(H * 1.8)),
    P = painter(g);
  P.mass(0, H * 0.48, 0, H * 0.72, H * 0.48, H * 0.62, false, seed);
  return { g, ramps: { [LEAF]: ramp } };
}

/** A rock: a few overlapping lumps, flattened, faceted by its rough surface; moss on top if wanted. */
function rock(seed: number, H: number, wide: number, moss: number): Built {
  const W = Math.round(H * wide * 1.3),
    g = new Grid(W, H + 2, W),
    P = painter(g),
    R = mulberry(seed),
    lumps = 3 + Math.floor(R() * 3);
  for (let k = 0; k < lumps; k++) {
    const r = H * (0.34 + 0.18 * R()),
      x = (R() - 0.5) * H * wide * 0.5,
      z = (R() - 0.5) * H * wide * 0.4,
      salt = Math.floor(R() * 1e6),
      sq = 0.7 + 0.25 * R();
    const c = Math.ceil(r * 1.3);
    for (let dy = 0; dy <= c; dy++)
      for (let dz = -c; dz <= c; dz++)
        for (let dx = -c; dx <= c; dx++) {
          // A faceted lump: distance measured against a few planes (flat faces), roughened.
          const fx = dx / (r * 1.15),
            fy = dy / (r * sq * 1.25),
            fz = dz / r,
            f = Math.max(Math.abs(fx * 0.8 + fy * 0.6), Math.abs(-fx * 0.7 + fy * 0.7), Math.abs(fz * 0.9 + fy * 0.4), Math.abs(-fz * 0.8 + fy * 0.6), Math.hypot(fx, fy, fz) * 0.95) + 0.08 * (hash3(dx, dy, dz, salt) - 0.5);
          if (f > 1) continue;
          const crack = hash3(Math.floor((dx + x) / 3), dy, Math.floor((dz + z) / 3), salt + 1) < 0.04 ? -2 : 0;
          P.put(x + dx, dy, z + dz, ROCK, (hash3(dx, dy, dz, salt + 2) - 0.5) * 1.8 + crack);
        }
  }
  if (moss > 0)
    for (let y = g.ny - 1; y > 0; y--)
      for (let z = 0; z < g.nz; z++)
        for (let x = 0; x < g.nx; x++) {
          const i = g.idx(x, y, z);
          if (g.m[i] !== ROCK || (y + 1 < g.ny && g.m[g.idx(x, y + 1, z)])) continue;
          if (hash3(x, y, z, seed) < moss * 3) g.m[i] = MOSS;
        }
  return { g, ramps: { [ROCK]: ROCK_R, [MOSS]: MOSS_R } };
}

/** A grass clump: blades fanning out from one root and arching over; flower heads if given. */
function grass(seed: number, H: number, ramp: number[][], bloom?: number[][]): Built {
  const g = new Grid(Math.round(H * 1.5), H + 2, Math.round(H * 1.5)),
    P = painter(g),
    R = mulberry(seed),
    n = Math.max(6, Math.round(H * 1.2));
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2,
      lean = 0.15 + 0.45 * R(),
      len = H * (0.55 + 0.45 * R());
    for (let s = 0; s < len; s++) {
      const u = s / len,
        out = lean * s + lean * 0.6 * u * u * len * 0.4;
      P.put(Math.cos(a) * out * 0.6, s * (1 - 0.25 * u * u), Math.sin(a) * out * 0.6, GRASS, u < 0.3 ? -1 : u > 0.8 ? 1 : 0);
    }
  }
  if (bloom)
    for (let k = 0; k < 3; k++) {
      const a = R() * 6.28,
        r = R() * H * 0.25;
      P.ball(Math.cos(a) * r, H * (0.8 + 0.2 * R()), Math.sin(a) * r, Math.max(0.8, H * 0.08), BLOOMM, k, () => 0);
    }
  return { g, ramps: { [GRASS]: ramp, [BLOOMM]: bloom ?? ramp } };
}

/** A fern: fronds arching out from a crown, each lined with leaflets. */
function fern(seed: number, H: number): Built {
  const g = new Grid(Math.round(H * 2.4), H + 2, Math.round(H * 2.4)),
    P = painter(g),
    R = mulberry(seed),
    n = 6 + Math.floor(R() * 4);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + R() * 0.6,
      L = H * (0.9 + 0.4 * R()),
      rise = 0.7 + 0.3 * R();
    for (let s = 0; s < L; s++) {
      const u = s / L,
        r = u * L * 0.9,
        y = H * rise * Math.sin(u * Math.PI * 0.75) * (1 - u * 0.4),
        x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      P.put(x, y, z, LEAF, u > 0.85 ? 1 : 0);
      if (s % 2 === 0) {
        const len = Math.max(1, Math.round((1 - u) * H * 0.18));
        for (let d = 1; d <= len; d++)
          for (const side of [-1, 1]) P.put(x - Math.sin(a) * d * side, y - d * 0.25, z + Math.cos(a) * d * side, LEAF, d === len ? 1 : 0);
      }
    }
  }
  return { g, ramps: { [LEAF]: FERN_R } };
}

/** A walker facing +x: legs and arms swinging by the frame, a pack on the back, a hat if they wear one. */
function person(look: Look, frame: number, H: number): Built {
  const g = new Grid(Math.round(H * 0.7), H + 2, Math.round(H * 0.5)),
    P = painter(g),
    swing = [0.35, 0, -0.35, 0][frame],
    lift = [0, 1, 0, 1][frame],
    hip = H * 0.47,
    legW = Math.max(1, H * 0.07);
  for (const [side, sw] of [[-1, swing], [1, -swing]] as [number, number][]) {
    const z = side * H * 0.06,
      fx = Math.sin(sw) * hip,
      fy = (side < 0 && lift) || (side > 0 && !lift && frame % 2) ? H * 0.03 : 0;
    P.cylinder(0, hip, z, fx, fy + 1, z, legW, legW, LEGS);
  }
  P.box(-H * 0.09, hip - 1, -H * 0.12, H * 0.09, H * 0.8, H * 0.12, CLOTH);
  for (const [side, sw] of [[-1, -swing], [1, swing]] as [number, number][]) {
    const z = side * H * 0.15;
    P.cylinder(0, H * 0.78, z, Math.sin(sw) * H * 0.3, H * 0.5, z, Math.max(0.8, H * 0.045), Math.max(0.8, H * 0.04), CLOTH);
  }
  P.ball(H * 0.02, H * 0.89, 0, H * 0.085, SKIN, 3, () => 0);
  P.box(-H * 0.09, H * 0.92, -H * 0.08, H * 0.06, H * 0.99, H * 0.08, HAIR);
  if (look.pack) P.box(-H * 0.24, H * 0.5, -H * 0.11, -H * 0.09, H * 0.82, H * 0.11, PACK);
  if (look.hat) P.box(-H * 0.12, H * 0.97, -H * 0.12, H * 0.12, H * 1.0, H * 0.12, HAIR);
  if (look.staff) P.cylinder(H * 0.18, 0, H * 0.18, H * 0.2, H * 1.05, H * 0.18, Math.max(0.6, H * 0.02), Math.max(0.6, H * 0.02), WOOD);
  const r = (c: number[]) => rampOf(c.map((v) => v / 255));
  return {
    g,
    ramps: {
      [LEGS]: r(look.legs), [CLOTH]: r(look.tunic), [SKIN]: r([226, 178, 136]), [HAIR]: r(look.hat ?? look.hair),
      [PACK]: r([138, 104, 66]), [WOOD]: r([120, 86, 54]),
    },
  };
}

// ---- Levels and their visible voxels -------------------------------------------------------------
function halve(g: Grid): Grid {
  const h = new Grid(Math.ceil(g.nx / 2), Math.ceil(g.ny / 2), Math.ceil(g.nz / 2)),
    count = new Uint8Array(16);
  for (let y = 0; y < h.ny; y++)
    for (let z = 0; z < h.nz; z++)
      for (let x = 0; x < h.nx; x++) {
        count.fill(0);
        let n = 0,
          ts = 0;
        for (let k = 0; k < 8; k++) {
          const xx = x * 2 + (k & 1),
            yy = y * 2 + ((k >> 1) & 1),
            zz = z * 2 + ((k >> 2) & 1);
          if (!g.in(xx, yy, zz)) continue;
          const i = g.idx(xx, yy, zz);
          if (!g.m[i]) continue;
          count[g.m[i]]++;
          n++;
          ts += g.t[i];
        }
        if (!n) continue;
        let best = 0;
        for (let m = 1; m < 16; m++) if (count[m] > count[best]) best = m;
        if (n >= 3 || THIN.has(best)) {
          const i = h.idx(x, y, z);
          h.m[i] = best;
          h.t[i] = Math.round(ts / n);
        }
      }
  return h;
}
/** Box-blur the filled space: the fraction filled in a cube of side 2r + 1 round each voxel. */
function blur(g: Grid, r: number) {
  const { nx, ny, nz } = g,
    a = new Float32Array(nx * ny * nz),
    b = new Float32Array(nx * ny * nz);
  for (let i = 0; i < a.length; i++) a[i] = g.m[i] ? 1 : 0;
  const pass = (src: Float32Array, dst: Float32Array, n: number, stride: number, count: number, at: (k: number) => number) => {
    for (let k = 0; k < count; k++) {
      const base = at(k);
      let s = 0;
      for (let j = -r; j <= r; j++) if (j >= 0 && j < n) s += src[base + j * stride];
      for (let j = 0; j < n; j++) {
        dst[base + j * stride] = s;
        const add = j + r + 1,
          sub = j - r;
        if (add < n) s += src[base + add * stride];
        if (sub >= 0) s -= src[base + sub * stride];
      }
    }
  };
  pass(a, b, nx, 1, ny * nz, (k) => k * nx);
  pass(b, a, nz, nx, ny * nx, (k) => Math.floor(k / nx) * nz * nx + (k % nx));
  pass(a, b, ny, nx * nz, nz * nx, (k) => k);
  const vol = (2 * r + 1) ** 3;
  for (let i = 0; i < b.length; i++) b[i] /= vol;
  return b;
}

/** Visible voxels: x, y, z (finest-level voxels from the foot), material, shade (1-6), normal x, y, z. */
function surface(g: Grid, v: number, leafy: boolean): Float32Array {
  const near = blur(g, 1),
    wide = blur(g, 3),
    out: number[] = [];
  const at = (f: Float32Array, x: number, y: number, z: number) =>
    f[g.idx(Math.max(0, Math.min(g.nx - 1, x)), Math.max(0, Math.min(g.ny - 1, y)), Math.max(0, Math.min(g.nz - 1, z)))];
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
        // Which way it faces: down the slope of the blurred filled space.
        let nx = -(at(wide, x + 1, y, z) - at(wide, x - 1, y, z)),
          ny = -(at(wide, x, y + 1, z) - at(wide, x, y - 1, z)),
          nz = -(at(wide, x, y, z + 1) - at(wide, x, y, z - 1));
        const sx = -(at(near, x + 1, y, z) - at(near, x - 1, y, z)),
          sy = -(at(near, x, y + 1, z) - at(near, x, y - 1, z)),
          sz = -(at(near, x, y, z + 1) - at(near, x, y, z - 1)),
          ln = Math.hypot(nx, ny, nz) || 1,
          ls = Math.hypot(sx, sy, sz) || 1;
        nx /= ln;
        ny /= ln;
        nz /= ln;
        const lamW = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]),
          lamN = Math.max(0, (sx * SUN[0] + sy * SUN[1] + sz * SUN[2]) / ls),
          lam = leafy ? 0.5 * lamW + 0.5 * lamN : 0.35 * lamW + 0.65 * lamN,
          crevice = near[i] > 0.62 ? -1 : near[i] < 0.34 ? 0.5 : 0;
        // In shadow: something solid a little way toward the sun.
        let shade = 0;
        for (let s = 2; s <= 6; s++) {
          const xx = Math.round(x + SUN[0] * s),
            yy = Math.round(y + SUN[1] * s),
            zz = Math.round(z + SUN[2] * s);
          if (g.in(xx, yy, zz) && g.m[g.idx(xx, yy, zz)]) {
            shade = 1;
            break;
          }
        }
        let tone = Math.round(1.6 + lam * 4.1 + g.t[i] * 0.55 + crevice - shade);
        if (leafy && lam > 0.55 && hash3(x, y, z, 11) < 0.1) tone = 6;
        tone = Math.max(m === LEAF || m === GRASS ? (shade && crevice < 0 ? 1 : 2) : 1, Math.min(6, tone));
        out.push((x + 0.5) * v - (g.nx * v) / 2, y * v + v / 2, (z + 0.5) * v - (g.nz * v) / 2, m, tone, nx, ny, nz);
      }
  return Float32Array.from(out);
}

export interface VModel {
  /** Its finest level's height in voxels. */
  n0: number;
  levels: { v: number; list: Float32Array }[];
  ramps: Record<number, number[][]>;
}
function finish(b: Built, n0: number, leafy: boolean): VModel {
  let g = b.g;
  const levels: VModel["levels"] = [];
  for (let v = 1; ; v *= 2) {
    levels.push({ v, list: surface(g, v, leafy) });
    if (g.ny <= 6) break;
    g = halve(g);
  }
  return { n0, levels, ramps: b.ramps };
}

const models = new Map<string, VModel>();
/** The voxel model for a sprite slot's name (trees "oak 0", cover "boulder", people "person 2 0 1"), or null. */
export function voxelModel(name: string, slot: number): VModel | null {
  let mdl = models.get(name);
  if (mdl) return mdl;
  const seed = 1000 + slot * 131,
    [base, a, , c] = name.split(" ");
  let b: Built | null = null,
    n0 = 0,
    leafy = true;
  if (TREE_NAMES.includes(base)) {
    n0 = 192;
    b = tree(base, seed + Number(a) * 7919, n0);
  } else if (base === "shrub" || base === "shrub2") {
    n0 = 40;
    b = shrub(seed, n0, SHRUB_R);
  } else if (base === "boulder" || base === "boulder2") {
    n0 = 48;
    leafy = false;
    b = rock(seed, n0, 1.5, base === "boulder" ? 0.15 : 0);
  } else if (base === "stone" || base === "stone2") {
    n0 = 24;
    leafy = false;
    b = rock(seed, n0, 1.3, 0);
  } else if (base === "fern" || base === "fern2") {
    n0 = 32;
    b = fern(seed, n0);
  } else if (base === "grass" || base === "grass2" || base === "dry") {
    n0 = 24;
    b = grass(seed, n0, base === "dry" ? DRY_R : GRASS_R);
  } else if (base === "flowers") {
    n0 = 24;
    b = grass(seed, n0, GRASS_R, BLOOM[a]);
  } else if (base === "person" && Number(a) < PARTY.length) {
    n0 = 40;
    leafy = false;
    b = person(PARTY[Number(a)], Number(c), n0);
  }
  if (!b) return null;
  models.set(name, (mdl = finish(b, n0, leafy)));
  return mdl;
}

/**
 * A voxel model drawn for this camera into a picture of its own, aligned at its foot, to stand
 * in the scene like a sprite. h: its height in metres; flip: mirrored in x (a walker going left).
 */
export function drawVoxel(
  mdl: VModel,
  h: number,
  at: { x: number; z: number },
  cam: { x: number; y: number; z: number; yaw: number },
  F: number,
  flip = false,
): Img {
  const fx = Math.sin(cam.yaw),
    fz = Math.cos(cam.yaw),
    rx = Math.cos(cam.yaw),
    rz = -Math.sin(cam.yaw),
    scale = h / mdl.n0,
    ex = at.x - cam.x,
    ez = at.z - cam.z,
    vz0 = ex * fx + ez * fz,
    s0 = (scale * F) / vz0;
  // The coarsest level whose voxels are still a pixel or more.
  let k = 0;
  while (k < mdl.levels.length - 1 && s0 * mdl.levels[k + 1].v <= 1.6) k++;
  const lv = mdl.levels[k],
    footX = Math.floor(CENTRE + (F * (ex * rx + ez * rz)) / vz0 + 0.5),
    footY = Math.floor(HORIZON + (F * cam.y) / vz0 + 0.5),
    L = lv.list,
    n = L.length / 8,
    sx = new Float32Array(n),
    sy = new Float32Array(n),
    hs = new Float32Array(n),
    dep = new Float32Array(n),
    col = new Uint32Array(n),
    keep = new Uint8Array(n);
  let x0 = 1e9,
    x1 = -1e9,
    y0 = 1e9,
    y1 = -1e9;
  for (let i = 0; i < n; i++) {
    const o = i * 8,
      mx = L[o] * scale * (flip ? -1 : 1),
      my = L[o + 1] * scale,
      mz = L[o + 2] * scale,
      wx = at.x + mx,
      wz = at.z + mz,
      qx = wx - cam.x,
      qy = my - cam.y,
      qz = wz - cam.z,
      vz = qx * fx + qz * fz;
    if (vz < 1) continue;
    // Facing away from the camera: hidden behind the rest; turning away at the edge: a shade darker.
    const nX = L[o + 5] * (flip ? -1 : 1),
      dl = Math.hypot(qx, qy, qz),
      facing = (nX * qx + L[o + 6] * qy + L[o + 7] * qz) / dl;
    if (facing > 0.2) continue;
    let tone = L[o + 4];
    if (facing > -0.28) tone = Math.max(1, tone - 1);
    const ramp = mdl.ramps[L[o + 3]],
      c = ramp[tone - 1];
    col[i] = (255 << 24) | (Math.round(c[2] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[0] * 255);
    sx[i] = CENTRE + (F * (qx * rx + qz * rz)) / vz - footX;
    sy[i] = HORIZON - (F * qy) / vz - footY;
    hs[i] = (lv.v * scale * F) / vz / 2 + 0.2;
    dep[i] = vz;
    keep[i] = 1;
    x0 = Math.min(x0, sx[i] - hs[i]);
    x1 = Math.max(x1, sx[i] + hs[i]);
    y0 = Math.min(y0, sy[i] - hs[i]);
    y1 = Math.max(y1, sy[i] + hs[i]);
  }
  if (x0 > x1) return { w: 1, h: 1, ax: 0, ay: 0, data: new Uint8ClampedArray(4) };
  const ox = Math.floor(x0) - 1,
    oy = Math.floor(y0) - 1,
    w = Math.ceil(x1) - ox + 2,
    hh = Math.ceil(y1) - oy + 2,
    data = new Uint8ClampedArray(w * hh * 4),
    px = new Uint32Array(data.buffer),
    zb = new Float32Array(w * hh).fill(1e9);
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const a0 = Math.ceil(sx[i] - hs[i] - 0.5) - ox,
      a1 = Math.max(a0 + 1, Math.ceil(sx[i] + hs[i] - 0.5) - ox),
      b0 = Math.ceil(sy[i] - hs[i] - 0.5) - oy,
      b1 = Math.max(b0 + 1, Math.ceil(sy[i] + hs[i] - 0.5) - oy);
    for (let yy = b0; yy < b1; yy++)
      for (let xx = a0; xx < a1; xx++) {
        const j = yy * w + xx;
        if (dep[i] >= zb[j]) continue;
        zb[j] = dep[i];
        px[j] = col[i];
      }
  }
  return { w, h: hh, ax: -ox, ay: -oy, data };
}
let CENTRE = 160,
  HORIZON = 40;
/** Where the picture's centre and horizon are (the lab sets these). */
export function setView(centre: number, horizon: number) {
  CENTRE = centre;
  HORIZON = horizon;
}
