import { frameBuffer } from "./render-frame";
import type { RenderFrame } from "./render-frame";
import { EvolutionSchedule, variationOf } from "./evolution";
import type { EvolutionAction } from "./evolution";
import type { Params, Simulation, Snapshot } from "./types";
import { PackedData, rng, unpackData } from "./types";

/**
 * Murmuration, revision 2: tens of thousands of starlings, each one drawn.
 *
 * The approach follows Frank Force's LittleJS murmuration demo (MIT licence,
 * https://killedbyapixel.github.io/LittleJS-Demos/murmuration/): birds steer
 * from averages kept on a coarse 3D grid instead of searching for neighbours,
 * so the cost grows only linearly with the number of birds.
 *
 * - Alignment and cohesion come from the averages of a bird's grid cell and
 *   the six cells it touches; separation from how the bird count changes
 *   across them. A finer density grid, read with smooth interpolation, keeps
 *   the spacing even inside the cells.
 * - Shimmer: three slow plane waves, each drifting and turning on its own,
 *   push birds toward their moving crests, so bands of tighter-packed (and so
 *   darker) birds roll through the flock. The spacing force keeps the bands
 *   travelling instead of setting into clumps.
 * - Agitation: panic spreads as in an excitable medium. A bird catches it
 *   from panicking neighbours, flares, calms, and cannot catch it again for a
 *   while, so each startle sweeps across the flock once as a band.
 * - Folding: a slowly drifting divergence-free (ABC) flow stretches and folds
 *   the flock into sheets and ribbons without bunching it.
 * - Splitting: two slowly drifting attractors each pull half the birds, so
 *   the flock divides and merges again.
 *
 * Simulation units are those of the demo (metres at a smaller scale); the
 * frame given to the renderer is scaled to world metres by WORLD_SCALE.
 * Everything is deterministic from the seed, the tick, the parameters and
 * the checkpoint.
 */
export const BIRD_STRIDE = 8; // x y z vx vy vz panic cool (simulation units)
/** World metres per simulation unit. */
export const WORLD_SCALE = 2.6;
/** Kept for the renderer: visible birds are the simulated birds themselves. */
export const SPACING = 1;
const WORLD_Y = 18, // world altitude of simulation height 0
  WORLD_Z = 40; // world depth of simulation depth 0

/** Fixed camera, shared by the simulation (activity) and the renderer. */
export const CAMERA = {
  x: 0,
  y: 2,
  z: -440,
  /** Focal length in 640-wide image units: a long lens, so the flock fills the sky. */
  focal: 1100,
  /** Image row of the horizon in the 640×400 image. */
  horizon: 364,
};
export function project(x: number, y: number, z: number) {
  const depth = Math.max(1, z - CAMERA.z),
    s = CAMERA.focal / depth;
  return [320 + (x - CAMERA.x) * s, CAMERA.horizon - (y - CAMERA.y) * s, s];
}

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Coarse grid: 4-unit cells over x -80..80, y -8..72, z -60..60.
const CELL = 4,
  GX = 40,
  GY = 20,
  GZ = 30,
  GXY = GX * GY,
  GN = GX * GY * GZ,
  GOX = (-GX * CELL) / 2,
  GOY = -8,
  GOZ = (-GZ * CELL) / 2;
// Fine density grid for even spacing.
const FCELL = 1.5,
  FGX = Math.ceil(((GX + 1) * CELL) / FCELL) + 3,
  FGY = Math.ceil(((GY + 1) * CELL) / FCELL) + 3,
  FGZ = Math.ceil(((GZ + 1) * CELL) / FCELL) + 3,
  FGXY = FGX * FGY;

/** Steering weights (exposed for tuning). */
export const TUNING = {
  align: 1.4,
  cohesion: 0.7,
  separate: 0.18,
  wander: 1,
  pressure: 0.002, // push down the gradient of count squared, against clumping
  denseCount: 150, // past this many birds a cell, cohesion turns outward
  spread: 15, // even spacing from the fine density gradient
  spreadMax: 8,
  wave: 8, // push toward the density waves' crests (units/s²)
  waveSwell: 0.6,
  waveDepth: 0.8,
  attract: 26,
  attractRadius: 8,
  flow: 1.2,
  flowSpeed: 11,
  flowScale: 0.07,
  flowDrift: 0.15,
  speedMin: 8,
  speedMax: 13,
  speedPanic: 8,
  panicDecay: 0.94,
  panicThreshold: 0.12,
  panicCatch: 0.1,
  panicRefractory: 2,
  jink: 6,
  startleGap: 9, // seconds between spontaneous startles, on average
  floor: 20,
  ceiling: 42,
};
/** The density waves: wavelength, speed, turning rate, start angle, tilt, swell rate. */
const WAVES = [
  { length: 38, speed: 5, turn: 0.021, angle: 0, tilt: 0.25, swell: 0.23 },
  { length: 52, speed: 6.5, turn: -0.016, angle: 2.2, tilt: -0.2, swell: 0.17 },
  { length: 30, speed: 4, turn: 0.027, angle: 4.1, tilt: 0.35, swell: 0.29 },
];
const WARM_UP = 8; // s of settling before time zero
const DT = 1 / 60;

export class Murmuration implements Simulation {
  tick = 0;
  historyBudgetBytes = 32 * 1024 * 1024;
  birds: Float64Array;
  schedule: EvolutionSchedule;
  /** Which attractor pulls each bird (fixed per bird). */
  group: Uint8Array;
  // Scratch (rebuilt every step).
  cell: Int32Array;
  gridCount = new Float32Array(GN);
  gridPanic = new Float32Array(GN);
  gridV = new Float32Array(GN * 3);
  gridP = new Float32Array(GN * 3);
  cellA = new Float32Array(GN * 3);
  cellPanic = new Float32Array(GN);
  cellCohesion = new Float32Array(GN);
  cellSpread = new Float32Array(GN);
  cellStep = new Int32Array(GN).fill(-1e9);
  fine = new Uint16Array(FGXY * FGZ);
  waveData = new Float64Array(WAVES.length * 8);
  centre = [0, 29, 0];
  constructor(
    public seed: number,
    public params: Params,
  ) {
    const count = Math.max(1, Math.round(Number(params.population)));
    this.birds = new Float64Array(count * BIRD_STRIDE);
    this.group = new Uint8Array(count);
    this.cell = new Int32Array(count);
    this.schedule = new EvolutionSchedule(seed);
    const random = rng(seed);
    for (let i = 0; i < count; i++) {
      const g = (this.group[i] = i & 1),
        a = this.attractor(g, -WARM_UP),
        u = random() * 2 - 1,
        theta = random() * Math.PI * 2,
        rad = Math.cbrt(random()),
        ring = Math.sqrt(1 - u * u) * rad,
        at = i * BIRD_STRIDE;
      this.birds[at] = a[0] + Math.cos(theta) * ring * 16;
      this.birds[at + 1] = a[1] + u * rad * 6;
      this.birds[at + 2] = a[2] + Math.sin(theta) * ring * 12;
      this.birds[at + 3] = 10 + (random() - 0.5) * 3;
      this.birds[at + 4] = (random() - 0.5) * 2;
      this.birds[at + 5] = 3 + (random() - 0.5) * 3;
    }
    this.tick = -Math.round(WARM_UP * 60);
    while (this.tick < 0) this.step();
  }
  /** Speed multiplier from the flight-speed parameter. */
  private pace() {
    return Number(this.params.velocity ?? 0.12) / 0.12;
  }
  /** Two slowly drifting points, each pulling half the flock. */
  attractor(g: number, t: number) {
    const s = (this.seed % 9973) * 0.37 + g * 2.1;
    return [
      20 * Math.sin(t * 0.05 + s) + 7 * Math.sin(t * 0.13 + g + s * 0.3),
      27 + 4 * Math.sin(t * 0.09 + g * 1.3 + s),
      14 * Math.sin(t * 0.07 + g * 3.7 + s * 0.7),
    ];
  }
  /** Panic every bird within `radius` of bird i that is not refractory. */
  private scare(i: number, radius: number) {
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      at0 = i * BIRD_STRIDE;
    for (let j = 0; j < count; j++) {
      const at = j * BIRD_STRIDE,
        dx = b[at] - b[at0],
        dy = b[at + 1] - b[at0 + 1],
        dz = b[at + 2] - b[at0 + 2];
      if (dx * dx + dy * dy + dz * dz < radius * radius && b[at + 7] <= 0) {
        b[at + 6] = 1;
        b[at + 7] = TUNING.panicRefractory;
      }
    }
  }
  step() {
    this.tick++;
    const variation = variationOf(this.params);
    if (this.tick > 0) {
      const action = this.schedule.advance(this.tick, variation);
      if (action) this.intervene(action);
    }
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      T = TUNING,
      pace = this.pace(),
      t = this.tick / 60,
      dt = DT * pace,
      random = rng(this.seed ^ Math.imul(this.tick, 0x9e3779b1));

    // Count birds into the grids. Both grids shift by a random part of a
    // cell every step: fixed cell walls are where forces jump, and level
    // flying birds would line up along them.
    const gc = this.gridCount,
      gv = this.gridV,
      gp = this.gridP,
      gpn = this.gridPanic,
      F = this.fine;
    gc.fill(0);
    gpn.fill(0);
    gv.fill(0);
    gp.fill(0);
    F.fill(0);
    const cox = GOX - random() * CELL,
      coy = GOY - random() * CELL,
      coz = GOZ - random() * CELL,
      fox = GOX - CELL - random() * FCELL,
      foy = GOY - CELL - random() * FCELL,
      foz = GOZ - CELL - random() * FCELL;
    let mx = 0,
      my = 0,
      mz = 0;
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        px = b[at],
        py = b[at + 1],
        pz = b[at + 2];
      mx += px;
      my += py;
      mz += pz;
      let ix = Math.floor((px - cox) / CELL),
        iy = Math.floor((py - coy) / CELL),
        iz = Math.floor((pz - coz) / CELL);
      if (ix < 0 || ix >= GX || iy < 0 || iy >= GY || iz < 0 || iz >= GZ) {
        this.cell[i] = -1;
        continue;
      }
      ix = ix < 1 ? 1 : ix > GX - 2 ? GX - 2 : ix;
      iy = iy < 1 ? 1 : iy > GY - 2 ? GY - 2 : iy;
      iz = iz < 1 ? 1 : iz > GZ - 2 ? GZ - 2 : iz;
      const c = (this.cell[i] = ix + iy * GX + iz * GXY);
      gc[c]++;
      gv[c * 3] += b[at + 3];
      gv[c * 3 + 1] += b[at + 4];
      gv[c * 3 + 2] += b[at + 5];
      gp[c * 3] += px;
      gp[c * 3 + 1] += py;
      gp[c * 3 + 2] += pz;
      gpn[c] += b[at + 6];
      const jx = Math.max(0, Math.min(((px - fox) / FCELL + 0.5) | 0, FGX - 1)),
        jy = Math.max(0, Math.min(((py - foy) / FCELL + 0.5) | 0, FGY - 1)),
        jz = Math.max(0, Math.min(((pz - foz) / FCELL + 0.5) | 0, FGZ - 1));
      F[jx + jy * FGX + jz * FGXY]++;
    }
    this.centre = [mx / count, my / count, mz / count];

    // This step's density waves, measured from the flock's middle so the
    // bands drift through the flock at their own pace.
    const wd = this.waveData;
    for (let k = 0; k < WAVES.length; k++) {
      const w = WAVES[k],
        a = w.angle + t * w.turn + (this.seed % 997) * 0.01,
        l = Math.hypot(1, w.tilt),
        n = (2 * Math.PI) / w.length,
        dx = Math.cos(a) / l,
        dy = w.tilt / l,
        dz = Math.sin(a) / l;
      wd[k * 8] = dx;
      wd[k * 8 + 1] = dy;
      wd[k * 8 + 2] = dz;
      wd[k * 8 + 3] = dx * n;
      wd[k * 8 + 4] = dy * n;
      wd[k * 8 + 5] = dz * n;
      wd[k * 8 + 6] =
        n * w.speed * t +
        dx * n * this.centre[0] +
        dy * n * this.centre[1] +
        dz * n * this.centre[2];
      wd[k * 8 + 7] = 1 + T.waveSwell * Math.sin(t * w.swell + k * 2.4);
    }
    const fpx = t * T.flowDrift,
      fpy = t * T.flowDrift * 0.7 + 1,
      fpz = t * T.flowDrift * 1.3 + 2,
      a0 = this.attractor(0, t),
      a1 = this.attractor(1, t);

    // A spontaneous startle now and then starts a panic band.
    const startle = Math.floor(t / T.startleGap);
    if (
      variation > 0 &&
      this.tick ===
        Math.round(
          (startle * T.startleGap +
            T.startleGap * hash(this.seed * 9 + startle)) *
            60,
        )
    )
      this.scare(Math.floor(hash(this.seed * 23 + startle) * count), 3);

    const damp = T.align + T.flow;
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        c = this.cell[i],
        px = b[at],
        py = b[at + 1],
        pz = b[at + 2];
      let vx = b[at + 3],
        vy = b[at + 4],
        vz = b[at + 5];
      // Steering shared by every bird in a cell, worked out once per cell.
      if (c >= 0 && this.cellStep[c] !== this.tick) {
        this.cellStep[c] = this.tick;
        const c0 = c - 1,
          c1 = c + 1,
          c2 = c - GX,
          c3 = c + GX,
          c4 = c - GXY,
          c5 = c + GXY,
          inv =
            1 / (gc[c] + gc[c0] + gc[c1] + gc[c2] + gc[c3] + gc[c4] + gc[c5]),
          sum = (g: Float32Array, k: number) =>
            (g[c * 3 + k] +
              g[c0 * 3 + k] +
              g[c1 * 3 + k] +
              g[c2 * 3 + k] +
              g[c3 * 3 + k] +
              g[c4 * 3 + k] +
              g[c5 * 3 + k]) *
            inv,
          avx = sum(gv, 0),
          avy = sum(gv, 1),
          avz = sum(gv, 2),
          apx = sum(gp, 0),
          apy = sum(gp, 1),
          apz = sum(gp, 2);
        this.cellPanic[c] =
          (gpn[c] + gpn[c0] + gpn[c1] + gpn[c2] + gpn[c3] + gpn[c4] + gpn[c5]) *
          inv;
        // The flow at the cell.
        const qx = apx * T.flowScale + fpx,
          qy = apy * T.flowScale * 1.5 + fpy,
          qz = apz * T.flowScale + fpz,
          ux = Math.sin(qz) + 0.7 * Math.cos(qy),
          uy = 0.5 * (Math.sin(qx) + Math.cos(qz)),
          uz = 0.7 * Math.sin(qy) + Math.cos(qx);
        // Cohesion fades as the neighbourhood fills and turns outward past
        // denseCount birds a cell.
        const coh = (this.cellCohesion[c] =
          T.cohesion * Math.max(-1, 1 - 1 / (inv * 7 * T.denseCount)));
        // Up the waves' slope, toward the nearest crest; and how high the
        // waves stand here (crests relax the spacing so birds pack tighter).
        let wx = 0,
          wy = 0,
          wz = 0,
          crest = 0;
        for (let k = 0; k < WAVES.length * 8; k += 8) {
          const ph =
              apx * wd[k + 3] + apy * wd[k + 4] + apz * wd[k + 5] - wd[k + 6],
            g = Math.cos(ph) * wd[k + 7] * T.wave;
          wx += wd[k] * g;
          wy += wd[k + 1] * g;
          wz += wd[k + 2] * g;
          crest += Math.sin(ph) * wd[k + 7];
        }
        this.cellSpread[c] =
          T.spread * Math.max(0.1, 1 - (T.waveDepth * crest) / WAVES.length);
        const p0 = gc[c0] * gc[c0],
          p1 = gc[c1] * gc[c1],
          p2 = gc[c2] * gc[c2],
          p3 = gc[c3] * gc[c3],
          p4 = gc[c4] * gc[c4],
          p5 = gc[c5] * gc[c5];
        this.cellA[c * 3] =
          avx * T.align +
          apx * coh -
          (gc[c1] - gc[c0]) * T.separate -
          (p1 - p0) * T.pressure +
          ux * T.flowSpeed * T.flow +
          wx;
        this.cellA[c * 3 + 1] =
          avy * T.align +
          apy * coh -
          (gc[c3] - gc[c2]) * T.separate -
          (p3 - p2) * T.pressure +
          uy * T.flowSpeed * 0.6 * T.flow +
          wy;
        this.cellA[c * 3 + 2] =
          avz * T.align +
          apz * coh -
          (gc[c5] - gc[c4]) * T.separate -
          (p5 - p4) * T.pressure +
          uz * T.flowSpeed * T.flow +
          wz;
      }
      let ax = 0,
        ay = 0,
        az = 0,
        nearPanic = 0;
      if (c >= 0) {
        const coh = this.cellCohesion[c];
        ax = this.cellA[c * 3] - vx * damp - px * coh;
        ay = this.cellA[c * 3 + 1] - vy * damp - py * coh;
        az = this.cellA[c * 3 + 2] - vz * damp - pz * coh;
        nearPanic = this.cellPanic[c];
        // Even spacing: down the fine density's slope at this bird.
        const fx = (px - fox) / FCELL,
          fy = (py - foy) / FCELL,
          fz = (pz - foz) / FCELL,
          jx = Math.max(0, Math.min(fx | 0, FGX - 2)),
          jy = Math.max(0, Math.min(fy | 0, FGY - 2)),
          jz = Math.max(0, Math.min(fz | 0, FGZ - 2)),
          tx = fx - jx,
          ty = fy - jy,
          tz = fz - jz,
          sx = 1 - tx,
          sy = 1 - ty,
          sz = 1 - tz,
          f = jx + jy * FGX + jz * FGXY,
          d000 = F[f],
          d100 = F[f + 1],
          d010 = F[f + FGX],
          d110 = F[f + FGX + 1],
          d001 = F[f + FGXY],
          d101 = F[f + FGXY + 1],
          d011 = F[f + FGXY + FGX],
          d111 = F[f + FGXY + FGX + 1],
          gx =
            sy * sz * (d100 - d000) +
            ty * sz * (d110 - d010) +
            sy * tz * (d101 - d001) +
            ty * tz * (d111 - d011),
          gy =
            sx * sz * (d010 - d000) +
            tx * sz * (d110 - d100) +
            sx * tz * (d011 - d001) +
            tx * tz * (d111 - d101),
          gz =
            sx * sy * (d001 - d000) +
            tx * sy * (d101 - d100) +
            sx * ty * (d011 - d010) +
            tx * ty * (d111 - d110),
          g2 = gx * gx + gy * gy + gz * gz,
          spread = this.cellSpread[c],
          push =
            g2 * spread * spread > T.spreadMax * T.spreadMax
              ? T.spreadMax / Math.sqrt(g2)
              : spread;
        ax -= gx * push;
        ay -= gy * push;
        az -= gz * push;
      }
      ax += (random() - 0.5) * T.wander;
      ay += (random() - 0.5) * T.wander * 0.5;
      az += (random() - 0.5) * T.wander;
      // Pull toward this bird's attractor once outside its radius.
      const a = this.group[i] ? a1 : a0,
        dx = a[0] - px,
        dy = a[1] - py,
        dz = a[2] - pz,
        d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
      if (d > T.attractRadius) {
        const f = (Math.min((d - T.attractRadius) * 0.3, 1) * T.attract) / d;
        ax += dx * f;
        ay += dy * f * 0.6;
        az += dz * f;
      }
      // Mostly level flight, between floor and ceiling.
      ay -= vy * 0.8;
      if (py < T.floor) ay += (T.floor - py) * 0.8;
      if (py > T.ceiling) ay -= (py - T.ceiling) * 2;
      // Panic: caught from panicking neighbours, then a refractory spell.
      let panic = b[at + 6] * T.panicDecay,
        cool = b[at + 7] - dt;
      if (
        cool <= 0 &&
        nearPanic > T.panicThreshold &&
        random() < T.panicCatch
      ) {
        panic = 1;
        cool = T.panicRefractory;
      }
      b[at + 6] = panic;
      b[at + 7] = cool < 0 ? 0 : cool;
      // A panicking bird jinks upward, so the band ripples the flock's shape.
      ay += panic * T.jink;
      vx += ax * dt;
      vy += ay * dt;
      vz += az * dt;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-3,
        maxSpeed = T.speedMax + panic * T.speedPanic,
        s =
          speed < T.speedMin
            ? T.speedMin / speed
            : speed > maxSpeed
              ? maxSpeed / speed
              : 1;
      vx *= s;
      vy *= s;
      vz *= s;
      b[at + 3] = vx;
      b[at + 4] = vy;
      b[at + 5] = vz;
      b[at] = px + vx * dt;
      b[at + 1] = py + vy * dt;
      b[at + 2] = pz + vz * dt;
    }
  }
  /** World position of bird i (metres). */
  world(i: number) {
    const at = i * BIRD_STRIDE,
      b = this.birds;
    return [
      b[at] * WORLD_SCALE,
      b[at + 1] * WORLD_SCALE + WORLD_Y,
      b[at + 2] * WORLD_SCALE + WORLD_Z,
    ];
  }
  /** The frame the renderer draws, in world metres: x y z vx vy vz panic cool. */
  captureFrame(previous?: RenderFrame) {
    const b = this.birds,
      frame = frameBuffer(previous, b.length, this.tick, this.params),
      d = frame.data;
    for (let at = 0; at < b.length; at += BIRD_STRIDE) {
      d[at] = b[at] * WORLD_SCALE;
      d[at + 1] = b[at + 1] * WORLD_SCALE + WORLD_Y;
      d[at + 2] = b[at + 2] * WORLD_SCALE + WORLD_Z;
      d[at + 3] = b[at + 3] * WORLD_SCALE;
      d[at + 4] = b[at + 4] * WORLD_SCALE;
      d[at + 5] = b[at + 5] * WORLD_SCALE;
      d[at + 6] = b[at + 6];
      d[at + 7] = b[at + 7];
    }
    return frame;
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      // A single memory copy; it becomes compact text only when saved.
      data: [],
      packed: new PackedData(this.birds.slice()),
      extra: { schedule: this.schedule.snapshot() },
    };
  }
  restore(s: Snapshot) {
    // Packed (current) or plain numbers (checkpoints saved before packing).
    const values = s.packed ? unpackData(s.packed) : unpackData(s.data);
    if (!values || values.length !== this.birds.length)
      throw new Error("Invalid murmuration checkpoint");
    for (let i = 0; i < values.length; i++)
      if (!Number.isFinite(values[i]))
        throw new Error("Invalid murmuration checkpoint");
    this.tick = s.tick;
    this.birds.set(values);
    this.schedule.restore(s.extra?.schedule as any, this.tick);
    // The per-cell cache is keyed by tick; clear it so nothing stale is reused.
    this.cellStep.fill(-1e9);
  }
  intervene(action: EvolutionAction) {
    const b = this.birds,
      count = b.length / BIRD_STRIDE;
    if (action.kind === 1) {
      // A startle: a panic band starts at one bird.
      this.scare((action.serial * 7919) % count, 4);
      return;
    }
    // Strays (far from the flock) rejoin it beside a bird in it.
    const random = rng(this.seed + action.serial * 997),
      c = this.centre;
    for (let j = 0; j < count; j++) {
      const at = j * BIRD_STRIDE,
        dx = b[at] - c[0],
        dy = b[at + 1] - c[1],
        dz = b[at + 2] - c[2];
      if (dx * dx + dy * dy + dz * dz < 70 * 70) continue;
      const host = Math.floor(random() * count) * BIRD_STRIDE;
      for (let k = 0; k < BIRD_STRIDE; k++) b[at + k] = b[host + k];
      b[at] += (random() - 0.5) * 2;
      b[at + 1] += (random() - 0.5) * 2;
      b[at + 2] += (random() - 0.5) * 2;
    }
  }
  activitySample() {
    const sample = new Float32Array(640),
      count = this.birds.length / BIRD_STRIDE;
    for (let i = 0; i < count; i += 4) {
      const [x, y, z] = this.world(i);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        sample[0] = NaN;
        return sample;
      }
      const [px, py] = project(x, y, z),
        gx = Math.min(31, Math.max(0, Math.floor((px / 640) * 32))),
        gy = Math.min(19, Math.max(0, Math.floor((py / 400) * 20)));
      sample[gy * 32 + gx] = Math.min(1, sample[gy * 32 + gx] + 0.02);
    }
    return sample;
  }
  /** Canvas fallback for hosts without the native renderer. */
  paint(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#c9b6a8";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10,12,20,.5)";
    const count = this.birds.length / BIRD_STRIDE;
    for (let i = 0; i < count; i++) {
      const [x, y, z] = this.world(i),
        [px, py] = project(x, y, z);
      ctx.fillRect((px / 640) * w, (py / 400) * h, 1, 1);
    }
  }
  dispose() {}
}
