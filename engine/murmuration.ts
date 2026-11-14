import { frameBuffer } from "./render-frame";
import type { RenderFrame } from "./render-frame";
import { EvolutionSchedule, variationOf } from "./evolution";
import type { EvolutionAction } from "./evolution";
import type { Params, Simulation, Snapshot } from "./types";
import { rng } from "./types";

/**
 * Murmuration, revision 2: a starling flock after StarDisplay
 * (Hildenbrandt, Carere & Hemelrijk 2010) with the escape manoeuvre that
 * produces agitation waves (Hemelrijk, van Zuidam & Hildenbrandt 2015) and
 * falcon attacks patterned on Storms et al. (2019).
 *
 * Units are SI: metres, seconds, newtons. x runs to the right of the viewer,
 * y is altitude, z is depth away from the camera. Each bird reacts to its
 * seven nearest neighbours. It turns by banking: steering rolls the bird and
 * the tilted lift turns it, which gives the flock the turning inertia that
 * carries turns and dark bands across it. Everything is deterministic from
 * the seed, the tick, the parameters and the checkpointed state.
 */
export const BIRD_STRIDE = 8; // x y z vx vy vz bank escape
const MASS = 0.08,
  GRAVITY = 9.81,
  CRUISE = 10, // m/s at the default flight-speed parameter
  LIFT_DRAG = 3.3,
  SPEED_RELAX = 1, // s
  NEIGHBOURS = 7,
  HARD = 0.2, // m, hard-sphere radius
  SEP_SIGMA2 = 1.37 * 1.37, // m², StarDisplay: separation radius 4 m
  W_SEP = 1, // N
  W_ALIGN = 0.5, // N
  W_COHESION = 1, // N (scaled by the cohesion parameter)
  W_NOISE = 0.01, // N
  BLIND = -0.7071, // cos 135°: neighbours behind are ignored for cohesion and alignment
  BANK_IN = 10,
  BANK_OUT = 1,
  BANK_ALIGN = 2, // 1/s, roll toward neighbours' mean bank
  BANK_MAX = 1.4, // rad
  ROOST_RADIUS = 55, // m
  ROOST_HEIGHT = 55, // m
  W_ROOST_H = 0.01, // N per metre outside the roost
  W_ROOST_V = 0.05, // N per metre from the preferred height (capped)
  ZIG_FORCE = 1, // N
  ZIG_OUT = 0.25, // s
  ZIG_BACK = 0.3, // s
  REFRACTORY = 1, // s
  CUE = 0.05, // s to recognise a neighbour's escape
  REACTION = 0.076, // s, mean reaction time
  SUBSTEPS = 2,
  PERCEIVE = 3, // steps between a bird's neighbour updates (50 ms)
  CELL = 3.5, // m, neighbour-grid cell
  TABLE = 1 << 14;
const ZIG = ZIG_OUT + ZIG_BACK;
/** Weights that shape the flock's spacing and thickness (exposed for tuning). */
export const TUNING = {
  separation: 5 * W_SEP,
  separationSigma2: SEP_SIGMA2,
  cohesion: W_COHESION,
  alignment: 2 * W_ALIGN,
  height: W_ROOST_V,
  heightCap: 0.6,
};

/** Fixed camera, shared by the simulation (activity) and the renderer. */
export const CAMERA = {
  x: 0,
  y: 4,
  z: -260,
  /** Focal length in 640-wide image units. */
  focal: 740,
  /** Image row of the horizon in the 640×400 image. */
  horizon: 330,
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

/** Falcon attacks: the pass through the flock is centred on `time`. */
export interface Attack {
  index: number;
  time: number;
  speed: number;
  fast: boolean;
  direction: number[];
}
export function attackAt(t: number, seed: number): Attack | undefined {
  const k = Math.floor((t - 20) / 32);
  for (const index of [k, k + 1]) {
    if (index < 0) continue;
    const time = 20 + 32 * index + 10 * hash(seed * 31 + index),
      roll = hash(seed * 17 + index * 7 + 1);
    if (t < time - 4 || t > time + 3) continue;
    // Mostly from above (about 70%), at medium speed; one in eight is fast.
    const from = hash(seed * 13 + index * 5 + 2),
      side = hash(seed * 11 + index * 3 + 3) < 0.5 ? -1 : 1,
      elevation = from < 0.7 ? 0.6 : from < 0.9 ? 0.05 : -0.35,
      dx = side * Math.cos(elevation),
      dy = -Math.sin(elevation),
      dz = (hash(seed * 7 + index) - 0.5) * 0.6,
      length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fast = roll < 0.125;
    return {
      index,
      time,
      fast,
      speed: fast ? 32 : roll > 0.9 ? 15 : 22,
      direction: [dx / length, dy / length, dz / length],
    };
  }
  return undefined;
}
export function falconAt(t: number, attack: Attack, target: number[]) {
  const s = (t - attack.time) * attack.speed;
  return [0, 1, 2].map((i) => target[i] + attack.direction[i] * s);
}

export class Murmuration implements Simulation {
  tick = 0;
  historyBudgetBytes = 32 * 1024 * 1024;
  birds: Float64Array;
  schedule: EvolutionSchedule;
  /** Where the current attack aims: the flock's predicted centre. */
  target: number[] = [0, ROOST_HEIGHT, 0];
  targetIndex = -1;
  /** Whether neighbour lists exist (they are part of the saved state). */
  perceived = false;
  // Scratch (derived every tick, never causal state across ticks).
  neighbours: Int32Array;
  counts: Int32Array;
  force: Float64Array;
  bucketCount = new Int32Array(TABLE);
  bucketStart = new Int32Array(TABLE + 1);
  bucketCursor = new Int32Array(TABLE);
  order: Int32Array;
  bucketOf: Int32Array;
  constructor(
    public seed: number,
    public params: Params,
  ) {
    const count = Number(params.population);
    this.birds = new Float64Array(count * BIRD_STRIDE);
    this.neighbours = new Int32Array(count * NEIGHBOURS);
    this.counts = new Int32Array(count);
    this.force = new Float64Array(count * 3);
    this.order = new Int32Array(count);
    this.bucketOf = new Int32Array(count);
    this.schedule = new EvolutionSchedule(seed);
    const random = rng(seed),
      heading = random() * Math.PI * 2,
      speed = this.cruise(),
      radius = Math.sqrt(count) * 0.62;
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        r = radius * Math.sqrt(random()),
        a = random() * Math.PI * 2,
        h = heading + (random() - 0.5) * 0.3;
      this.birds[at] = Math.cos(heading) * 40 + r * Math.cos(a);
      this.birds[at + 1] = ROOST_HEIGHT + (random() - 0.5) * 4;
      this.birds[at + 2] = Math.sin(heading) * 40 + r * Math.sin(a) * 0.6;
      this.birds[at + 3] = Math.cos(h) * speed;
      this.birds[at + 4] = 0;
      this.birds[at + 5] = Math.sin(h) * speed;
    }
    // Settle into a flock before the first frame.
    for (let i = 0; i < 360; i++) this.step();
    this.tick = 0;
    this.targetIndex = -1;
  }
  private cruise() {
    return CRUISE * (Number(this.params.velocity ?? 0.12) / 0.12);
  }
  /**
   * Seven nearest neighbours through a hashed grid. Like StarDisplay's 50 ms
   * reaction time, each bird re-perceives every third step (a third of the
   * flock per step); the lists are saved state, so replay stays exact.
   */
  private findNeighbours(all = false) {
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      key = (cx: number, cy: number, cz: number) =>
        (Math.imul(cx, 73856093) ^
          Math.imul(cy, 19349663) ^
          Math.imul(cz, 83492791)) &
        (TABLE - 1);
    this.bucketCount.fill(0);
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        k = key(
          Math.floor(b[at] / CELL),
          Math.floor(b[at + 1] / CELL),
          Math.floor(b[at + 2] / CELL),
        );
      this.bucketOf[i] = k;
      this.bucketCount[k]++;
    }
    this.bucketStart[0] = 0;
    for (let k = 0; k < TABLE; k++)
      this.bucketStart[k + 1] = this.bucketStart[k] + this.bucketCount[k];
    this.bucketCursor.set(this.bucketStart.subarray(0, TABLE));
    for (let i = 0; i < count; i++)
      this.order[this.bucketCursor[this.bucketOf[i]]++] = i;
    const bestD = new Float64Array(NEIGHBOURS),
      bestJ = new Int32Array(NEIGHBOURS);
    for (
      let i = all ? 0 : this.tick % PERCEIVE;
      i < count;
      i += all ? 1 : PERCEIVE
    ) {
      const at = i * BIRD_STRIDE,
        x = b[at],
        y = b[at + 1],
        z = b[at + 2],
        cx = Math.floor(x / CELL),
        cy = Math.floor(y / CELL),
        cz = Math.floor(z / CELL);
      let found = 0;
      for (let reach = 1; reach <= 2 && found < NEIGHBOURS; reach++) {
        found = 0;
        for (let ox = -reach; ox <= reach; ox++)
          for (let oy = -reach; oy <= reach; oy++)
            for (let oz = -reach; oz <= reach; oz++) {
              const k = key(cx + ox, cy + oy, cz + oz),
                end = this.bucketStart[k + 1];
              for (let m = this.bucketStart[k]; m < end; m++) {
                const j = this.order[m];
                if (j === i) continue;
                const bt = j * BIRD_STRIDE,
                  dx = b[bt] - x,
                  dy = b[bt + 1] - y,
                  dz = b[bt + 2] - z,
                  d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > (CELL * (reach + 0.5)) ** 2) continue;
                if (found < NEIGHBOURS) {
                  let p = found++;
                  while (p > 0 && bestD[p - 1] > d2) {
                    bestD[p] = bestD[p - 1];
                    bestJ[p] = bestJ[p - 1];
                    p--;
                  }
                  bestD[p] = d2;
                  bestJ[p] = j;
                } else if (d2 < bestD[NEIGHBOURS - 1]) {
                  let p = NEIGHBOURS - 1;
                  while (p > 0 && bestD[p - 1] > d2) {
                    bestD[p] = bestD[p - 1];
                    bestJ[p] = bestJ[p - 1];
                    p--;
                  }
                  bestD[p] = d2;
                  bestJ[p] = j;
                }
              }
            }
      }
      this.counts[i] = found;
      for (let n = 0; n < found; n++)
        this.neighbours[i * NEIGHBOURS + n] = bestJ[n];
    }
  }
  /** Mean position and velocity of the flock. */
  centre() {
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      c = [0, 0, 0, 0, 0, 0];
    for (let at = 0; at < b.length; at += BIRD_STRIDE)
      for (let k = 0; k < 6; k++) c[k] += b[at + k];
    return c.map((v) => v / count);
  }
  private startEscape(i: number, direction: number) {
    const at = i * BIRD_STRIDE + 7;
    if (this.birds[at] === 0) this.birds[at] = direction < 0 ? -1e-6 : 1e-6;
  }
  step() {
    this.tick++;
    const variation = variationOf(this.params);
    const action = this.schedule.advance(this.tick, variation);
    if (action) this.intervene(action);
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      t = this.tick / 60,
      dt = 1 / 60,
      cruise = this.cruise(),
      cohesion = TUNING.cohesion * (Number(this.params.cohesion ?? 0.4) / 0.4),
      random = rng(this.seed ^ Math.imul(this.tick, 0x9e3779b1));
    this.findNeighbours(!this.perceived);
    this.perceived = true;

    // Falcon: fix the aim when an attack window opens.
    const attack = this.params.predator ? attackAt(t, this.seed) : undefined;
    if (attack && attack.index !== this.targetIndex) {
      const c = this.centre(),
        lead = attack.time - t;
      this.target = [
        c[0] + c[3] * lead,
        c[1] + c[4] * lead,
        c[2] + c[5] * lead,
      ];
      this.targetIndex = attack.index;
    }
    const hawk = attack ? falconAt(t, attack, this.target) : undefined;

    // Initiators: a bird and its neighbours start a turn (every ~10 s), and a
    // single bird startles (every ~7 s), so ripples also run without a falcon.
    const turnEvent = Math.floor(t / 10),
      turnStart = turnEvent * 10 + 4 * hash(this.seed + turnEvent * 101),
      turning = variation > 0 && t >= turnStart && t < turnStart + 1.4,
      turner = Math.floor(hash(this.seed * 3 + turnEvent) * count),
      turnSign = hash(this.seed * 5 + turnEvent) < 0.5 ? -1 : 1;
    const startleEvent = Math.floor(t / 7),
      startleTick = Math.round(
        (startleEvent * 7 + 5 * hash(this.seed * 9 + startleEvent)) * 60,
      );
    if (variation > 0 && this.tick === startleTick)
      this.startEscape(
        Math.floor(hash(this.seed * 23 + startleEvent) * count),
        hash(this.seed * 29 + startleEvent) - 0.5,
      );

    // Social, roost, escape and noise forces: computed once per reaction step.
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        x = b[at],
        y = b[at + 1],
        z = b[at + 2],
        vx = b[at + 3],
        vy = b[at + 4],
        vz = b[at + 5],
        v = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1,
        ex = vx / v,
        ey = vy / v,
        ez = vz / v;
      // Lateral (right-hand) axis: forward × up.
      let sx = -ez,
        sz = ex;
      const sl = Math.sqrt(sx * sx + sz * sz) || 1;
      sx /= sl;
      sz /= sl;
      let fx = 0,
        fy = 0,
        fz = 0;
      const n = this.counts[i];
      let ax = 0,
        ay = 0,
        az = 0,
        cx = 0,
        cy = 0,
        cz = 0,
        seen = 0,
        ux = 0,
        uy = 0,
        uz = 0,
        bankSum = 0;
      for (let k = 0; k < n; k++) {
        const j = this.neighbours[i * NEIGHBOURS + k],
          bt = j * BIRD_STRIDE,
          dx = b[bt] - x,
          dy = b[bt + 1] - y,
          dz = b[bt + 2] - z,
          d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6,
          hx = dx / d,
          hy = dy / d,
          hz = dz / d;
        ux += hx;
        uy += hy;
        uz += hz;
        bankSum += b[bt + 6];
        // Separation: full inside the hard sphere, a half-Gaussian beyond it.
        const g =
          d <= HARD
            ? 1
            : Math.exp(-((d - HARD) ** 2) / TUNING.separationSigma2);
        fx -= (TUNING.separation / n) * g * hx;
        fy -= (TUNING.separation / n) * g * hy;
        fz -= (TUNING.separation / n) * g * hz;
        if (hx * ex + hy * ey + hz * ez < BLIND) continue;
        const bv =
          Math.sqrt(
            b[bt + 3] * b[bt + 3] +
              b[bt + 4] * b[bt + 4] +
              b[bt + 5] * b[bt + 5],
          ) || 1;
        ax += b[bt + 3] / bv;
        ay += b[bt + 4] / bv;
        az += b[bt + 5] / bv;
        if (d > HARD) {
          cx += hx;
          cy += hy;
          cz += hz;
        }
        seen++;
      }
      if (seen) {
        const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        fx += TUNING.alignment * (ax / al - ex);
        fy += TUNING.alignment * (ay / al - ey);
        fz += TUNING.alignment * (az / al - ez);
        // Edge birds (directions to neighbours point one way) cohere harder.
        const centrality = n ? Math.sqrt(ux * ux + uy * uy + uz * uz) / n : 1;
        fx += (centrality * cohesion * cx) / seen;
        fy += (centrality * cohesion * cy) / seen;
        fz += (centrality * cohesion * cz) / seen;
      }
      // Roost: outside its radius, a sideways push turns the bird back home.
      const r = Math.sqrt(x * x + z * z);
      if (r > ROOST_RADIUS) {
        const nx = x / r,
          nz = z / r,
          outward = 0.5 + 0.5 * (ex * nx + ez * nz),
          turnHome = sx * -nx + sz * -nz >= 0 ? 1 : -1,
          push = W_ROOST_H * (r - ROOST_RADIUS) * outward * turnHome;
        fx += push * sx;
        fz += push * sz;
      }
      fy -= Math.max(
        -TUNING.heightCap,
        Math.min(TUNING.heightCap, TUNING.height * (y - ROOST_HEIGHT)),
      );
      // Escape manoeuvre in progress: zig sideways, then back.
      const escape = b[at + 7],
        age = Math.abs(escape),
        side = escape < 0 ? -1 : 1;
      if (escape !== 0 && age < ZIG) {
        const push = (age < ZIG_OUT ? 1 : -1) * ZIG_FORCE * side;
        fx += push * sx;
        fz += push * sz;
      }
      if (turning && (i === turner || this.isNeighbour(turner, i))) {
        fx += 0.6 * turnSign * sx;
        fz += 0.6 * turnSign * sz;
      }
      if (hawk) {
        const px = x - hawk[0],
          py = y - hawk[1],
          pz = z - hawk[2],
          pd = Math.sqrt(px * px + py * py + pz * pz) || 1;
        // Birds close to the falcon escape (a zig away from it), and the
        // flock parts around it, opening a hole where it passes.
        if (pd < 16 && escape === 0) this.startEscape(i, px * sx + pz * sz);
        if (pd < 14) {
          const away = (attack!.fast ? 2.2 : 1.2) * (1 - pd / 14);
          fx += (px / pd) * away;
          fy += (py / pd) * away;
          fz += (pz / pd) * away;
        }
        // A fast pass makes the flock burst outward around the falcon.
        if (attack!.fast && pd < 24) {
          const burst = 1.4 * (1 - pd / 24);
          fx += (px / pd) * burst;
          fy += (py / pd) * burst;
          fz += (pz / pd) * burst;
        }
      }
      fx += (random() - 0.5) * 2 * W_NOISE;
      fy += (random() - 0.5) * 2 * W_NOISE;
      fz += (random() - 0.5) * 2 * W_NOISE;
      // Neighbours copy an escape they see, after recognising it and reacting.
      if (escape === 0) {
        const delay = CUE + REACTION + (hash(this.seed + i * 977) - 0.5) * 0.02;
        for (let k = 0; k < Math.min(6, n); k++) {
          const other =
              b[this.neighbours[i * NEIGHBOURS + k] * BIRD_STRIDE + 7],
            otherAge = Math.abs(other);
          if (other !== 0 && otherAge >= delay && otherAge < delay + 0.1) {
            this.startEscape(i, other);
            break;
          }
        }
      }
      // Bank toward the neighbours' mean bank (birds match each other's roll).
      if (n) b[at + 6] += (bankSum / n - b[at + 6]) * BANK_ALIGN * dt;
      this.force[i * 3] = fx;
      this.force[i * 3 + 1] = fy;
      this.force[i * 3 + 2] = fz;
    }

    // Flight physics, with banked turns, in substeps.
    const h = dt / SUBSTEPS;
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        Fx = this.force[i * 3],
        Fy = this.force[i * 3 + 1],
        Fz = this.force[i * 3 + 2];
      let vx = b[at + 3],
        vy = b[at + 4],
        vz = b[at + 5],
        bank = b[at + 6];
      for (let s = 0; s < SUBSTEPS; s++) {
        const v = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1,
          ex = vx / v,
          ey = vy / v,
          ez = vz / v;
        let sx = -ez,
          sz = ex;
        const sl = Math.sqrt(sx * sx + sz * sz) || 1;
        sx /= sl;
        sz /= sl;
        // Bird's up before rolling: world up made perpendicular to forward.
        let upx = -ey * ex,
          upy = 1 - ey * ey,
          upz = -ey * ez;
        const ul = Math.sqrt(upx * upx + upy * upy + upz * upz) || 1;
        upx /= ul;
        upy /= ul;
        upz /= ul;
        // Roll in toward the steering's sideways pull, roll out gently.
        const lateral = (Fx * sx + Fz * sz) / MASS;
        bank +=
          Math.atan(BANK_IN * Math.abs(lateral) * h) * Math.sign(lateral) -
          Math.atan(BANK_OUT * Math.sin(bank) * h);
        bank = Math.max(-BANK_MAX, Math.min(BANK_MAX, bank));
        const cb = Math.cos(bank),
          sb = Math.sin(bank),
          lx = cb * upx + sb * sx,
          ly = cb * upy,
          lz = cb * upz + sb * sz,
          ratio = (v * v) / (cruise * cruise),
          lift = ratio * MASS * GRAVITY,
          drag = (ratio * MASS * GRAVITY) / LIFT_DRAG,
          thrust = (MASS * GRAVITY) / LIFT_DRAG,
          speedControl = (MASS / SPEED_RELAX) * (cruise - v);
        const ax =
            (Fx + lift * lx + (thrust - drag + speedControl) * ex) / MASS,
          ay =
            (Fy +
              lift * ly +
              (thrust - drag + speedControl) * ey -
              MASS * GRAVITY) /
            MASS,
          az = (Fz + lift * lz + (thrust - drag + speedControl) * ez) / MASS;
        vx += ax * h;
        vy += ay * h;
        vz += az * h;
        b[at] += vx * h;
        b[at + 1] += vy * h;
        b[at + 2] += vz * h;
      }
      b[at + 3] = vx;
      b[at + 4] = vy;
      b[at + 5] = vz;
      b[at + 6] = bank;
      // Escape clock: active zig, then refractory, then idle.
      const escape = b[at + 7];
      if (escape !== 0) {
        const age = Math.abs(escape) + dt;
        b[at + 7] = age > ZIG + REFRACTORY ? 0 : escape < 0 ? -age : age;
      }
    }
  }
  private isNeighbour(i: number, j: number) {
    for (let k = 0; k < this.counts[i]; k++)
      if (this.neighbours[i * NEIGHBOURS + k] === j) return true;
    return false;
  }
  captureFrame(previous?: RenderFrame) {
    const frame = frameBuffer(
      previous,
      this.birds.length,
      this.tick,
      this.params,
    );
    frame.data.set(this.birds);
    const t = this.tick / 60,
      attack = this.params.predator ? attackAt(t, this.seed) : undefined;
    frame.extra = {
      falcon:
        attack && attack.index === this.targetIndex
          ? [...falconAt(t, attack, this.target), ...attack.direction]
          : null,
    };
    return frame;
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      data: Array.from(this.birds),
      extra: {
        schedule: this.schedule.snapshot(),
        target: [...this.target],
        targetIndex: this.targetIndex,
        neighbours: Array.from(this.neighbours),
        counts: Array.from(this.counts),
      },
    };
  }
  restore(s: Snapshot) {
    if (s.data.length !== this.birds.length || !s.data.every(Number.isFinite))
      throw new Error("Invalid murmuration checkpoint");
    this.tick = s.tick;
    this.birds.set(s.data);
    this.schedule.restore(s.extra?.schedule as any, this.tick);
    const target = s.extra?.target as number[] | undefined;
    this.target =
      Array.isArray(target) &&
      target.length === 3 &&
      target.every(Number.isFinite)
        ? [...target]
        : [0, ROOST_HEIGHT, 0];
    this.targetIndex = Number.isInteger(s.extra?.targetIndex)
      ? Number(s.extra!.targetIndex)
      : -1;
    const count = this.birds.length / BIRD_STRIDE,
      neighbours = s.extra?.neighbours as number[] | undefined,
      counts = s.extra?.counts as number[] | undefined;
    if (
      Array.isArray(neighbours) &&
      Array.isArray(counts) &&
      neighbours.length === count * NEIGHBOURS &&
      counts.length === count &&
      neighbours.every((j) => Number.isInteger(j) && j >= 0 && j < count) &&
      counts.every((c) => Number.isInteger(c) && c >= 0 && c <= NEIGHBOURS)
    ) {
      this.neighbours.set(neighbours);
      this.counts.set(counts);
      this.perceived = true;
    } else this.perceived = false;
  }
  intervene(action: EvolutionAction) {
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      random = rng(this.seed + action.serial * 997),
      share = [0, 0.08, 0.25, 1][action.kind],
      total = Math.max(1, Math.round(count * share)),
      c = this.centre(),
      speed = this.cruise();
    for (let k = 0; k < total; k++) {
      const at = ((k + action.serial * 131) % count) * BIRD_STRIDE;
      if (action.kind === 1) {
        // A startle: a group escapes, and the wave spreads from it.
        b[at + 7] = b[at + 7] || (random() < 0.5 ? -1e-6 : 1e-6);
        continue;
      }
      // Rejoin the flock near its centre, flying with it.
      b[at] = c[0] + (random() - 0.5) * 20;
      b[at + 1] = c[1] + (random() - 0.5) * 4;
      b[at + 2] = c[2] + (random() - 0.5) * 20;
      const v = Math.sqrt(c[3] * c[3] + c[4] * c[4] + c[5] * c[5]) || 1;
      b[at + 3] = (c[3] / v) * speed;
      b[at + 4] = 0;
      b[at + 5] = (c[5] / v) * speed;
      b[at + 6] = 0;
      b[at + 7] = 0;
    }
  }
  activitySample() {
    const sample = new Float32Array(640),
      b = this.birds;
    for (let at = 0; at < b.length; at += BIRD_STRIDE) {
      if (!Number.isFinite(b[at]) || !Number.isFinite(b[at + 1])) {
        sample[0] = NaN;
        return sample;
      }
      const [px, py] = project(b[at], b[at + 1], b[at + 2]),
        gx = Math.min(31, Math.max(0, Math.floor((px / 640) * 32))),
        gy = Math.min(19, Math.max(0, Math.floor((py / 400) * 20)));
      sample[gy * 32 + gx] = Math.min(1, sample[gy * 32 + gx] + 0.05);
    }
    return sample;
  }
  /** Canvas fallback for hosts without the native renderer. */
  paint(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#c9b6a8";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10,12,20,.6)";
    const b = this.birds;
    for (let at = 0; at < b.length; at += BIRD_STRIDE) {
      const [px, py] = project(b[at], b[at + 1], b[at + 2]);
      ctx.fillRect((px / 640) * w, (py / 400) * h, 1.2, 1.2);
    }
  }
  dispose() {}
}
