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
/** Spacing relative to StarDisplay: each simulated bird is a parcel of birds. */
export const SPACING = 2.5;
const MASS = 0.08,
  GRAVITY = 9.81,
  CRUISE = 10, // m/s at the default flight-speed parameter
  LIFT_DRAG = 3.3,
  SPEED_RELAX = 1, // s
  NEIGHBOURS = 7,
  // Each simulated bird stands for a parcel of real birds, so spacing is
  // SPACING times StarDisplay's: the flock spans hundreds of metres, as
  // real murmurations do, and turns slowly relative to its size.
  HARD = 0.2 * SPACING, // m, hard-sphere radius
  SEP_SIGMA2 = (1.37 * SPACING) ** 2, // m², StarDisplay: separation radius 4 m
  W_SEP = 1, // N
  W_ALIGN = 0.5, // N
  W_COHESION = 1, // N (scaled by the cohesion parameter)
  W_NOISE = 0.01, // N
  BLIND = -0.7071, // cos 135°: neighbours behind are ignored for cohesion and alignment
  BANK_IN = 10,
  BANK_OUT = 1,
  BANK_ALIGN = 2, // 1/s, roll toward neighbours' mean bank
  BANK_MAX = 1.4, // rad
  ROOST_HEIGHT = 60, // m, middle of the route's altitude band
  FLOOR = 14, // m, below this birds climb away from the ground
  CEILING = 170, // m, above this birds descend
  BREAK_EVERY = 40, // s between breakaway groups
  BREAK_TIME = 3.5, // s a breakaway group pulls away
  BREAK_RADIUS = 11 * SPACING, // m around the group's leader
  BREAK_FORCE = 0.55, // N
  // The stream: birds follow the path a guide flew (equal-radius turns).
  W_TRAIL_ALIGN = 0.35, // N toward the trail's direction where the bird is
  W_TRAIL_PULL = 0.6, // N toward the trail's centre line, beyond its width
  TRAIL_WIDTH = 24, // m, typical half-width of the stream
  ROUTE_LEAD = 60, // s the route has flown before the artwork's time zero
  WARM_UP = 6, // s of settling before time zero
  GUIDE_PACE = 0.85, // the guide flies a little slower so the stream keeps up
  STREAM_LENGTH = 45, // s of trail the stream spreads over
  ZIG_FORCE = 1, // N
  ZIG_OUT = 0.25, // s
  ZIG_BACK = 0.3, // s
  REFRACTORY = 1, // s
  CUE = 0.05, // s to recognise a neighbour's escape
  REACTION = 0.076, // s, mean reaction time
  SUBSTEPS = 2,
  PERCEIVE = 3, // steps between a bird's neighbour updates (50 ms)
  CELL = 3.5 * SPACING, // m, neighbour-grid cell
  TABLE = 1 << 14;
const ZIG = ZIG_OUT + ZIG_BACK;
/** Weights that shape the flock's spacing and thickness (exposed for tuning). */
export const TUNING = {
  separation: 5 * W_SEP,
  separationSigma2: SEP_SIGMA2,
  cohesion: W_COHESION,
  alignment: 2 * W_ALIGN,
};

/** Fixed camera, shared by the simulation (activity) and the renderer. */
export const CAMERA = {
  x: 0,
  y: 2,
  z: -600,
  /** Focal length in 640-wide image units: a long lens, so the flock fills the sky. */
  focal: 1350,
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

/** Smooth value noise in one dimension, in [0, 1]. */
const smooth = (x: number, seed: number) => {
  const i = Math.floor(x),
    f = x - i,
    u = f * f * (3 - 2 * f);
  return hash(seed * 7919 + i) * (1 - u) + hash(seed * 7919 + i + 1) * u;
};
export const ROUTE_STEP = 0.1, // s of route integration
  TRAIL_SAMPLE = 0.5, // s between stored trail points
  TRAIL_SAMPLES = 180; // 90 s of trail
const ROUTE_BOX = { x: 120, zMin: -30, zMax: 80, yMin: 55, yMax: 125 };
/**
 * The stream's guide: a seeded route through the sky in front of the viewer,
 * flown at cruise speed. Long passes across the view, vertical loops that
 * curl up and back, U-turns and S-bends. It is a pure function of the seed
 * and time (integrated from zero), so it needs no saved state. Its recent
 * path, the trail, is what the birds follow.
 */
export class Route {
  time = 0;
  p = [-120, 55, 20];
  d = [1, 0, 0];
  trail = new Float64Array(TRAIL_SAMPLES * 3);
  /** Absolute index of the newest stored trail point. */
  newest = 0;
  loopAxis = [0, 0, 1];
  loopLeft = 0;
  loopRate = 0;
  slot = -1;
  constructor(
    public seed: number,
    public speed: number,
  ) {
    this.store(0);
  }
  private store(k: number) {
    const at = (k % TRAIL_SAMPLES) * 3;
    this.trail[at] = this.p[0];
    this.trail[at + 1] = this.p[1];
    this.trail[at + 2] = this.p[2];
    this.newest = k;
  }
  /** Trail point k (absolute index), which must be among the stored ones. */
  point(k: number, out: number[]) {
    const at = (k % TRAIL_SAMPLES) * 3;
    out[0] = this.trail[at];
    out[1] = this.trail[at + 1];
    out[2] = this.trail[at + 2];
    return out;
  }
  oldest() {
    return Math.max(0, this.newest - TRAIL_SAMPLES + 2);
  }
  advanceTo(t: number) {
    while (this.time + ROUTE_STEP <= t + 1e-9) this.integrate();
  }
  private rotate(axis: number[], angle: number) {
    // Rodrigues' rotation of the direction about a unit axis.
    const [kx, ky, kz] = axis,
      [x, y, z] = this.d,
      c = Math.cos(angle),
      s = Math.sin(angle),
      dot = kx * x + ky * y + kz * z;
    this.d[0] = x * c + (ky * z - kz * y) * s + kx * dot * (1 - c);
    this.d[1] = y * c + (kz * x - kx * z) * s + ky * dot * (1 - c);
    this.d[2] = z * c + (kx * y - ky * x) * s + kz * dot * (1 - c);
    const l = Math.hypot(this.d[0], this.d[1], this.d[2]) || 1;
    this.d[0] /= l;
    this.d[1] /= l;
    this.d[2] /= l;
  }
  private integrate() {
    const h = ROUTE_STEP,
      t = this.time,
      seed = this.seed,
      [x, y, z] = this.p;
    // Manoeuvres in 18 s slots: now and then a vertical loop that curls up
    // and back over the stream, an S-bend, or a climb or dive.
    const slot = Math.floor(t / 18);
    if (slot !== this.slot) {
      this.slot = slot;
      const kind = hash(seed * 13 + slot),
        start = 2 + 6 * hash(seed * 17 + slot);
      this.loopLeft = 0;
      if (kind < 0.28 && y < 100) {
        // Loop radius 18–32 m about the horizontal axis across the flight.
        const radius = 18 + 14 * hash(seed * 19 + slot),
          hl = Math.hypot(this.d[0], this.d[2]) || 1;
        this.loopRate = this.speed / radius;
        // Rotating about (−dz, 0, dx) pitches up: the head curls up and back.
        this.loopAxis = [-this.d[2] / hl, 0, this.d[0] / hl];
        this.loopLeft = -start; // negative: waiting to start
      } else this.loopRate = kind < 0.7 ? 1 : -1; // S-bend sign or climb
    }
    if (this.loopLeft < 0) {
      this.loopLeft += h;
      if (this.loopLeft >= 0) this.loopLeft = (2 * Math.PI) / this.loopRate;
    }
    if (this.loopLeft > 0) {
      this.rotate(this.loopAxis, this.loopRate * h);
      this.loopLeft -= h;
    } else {
      // Yaw: slow wander, S-bends, and turning back inside the box.
      let yaw =
        0.18 * (smooth(t * 0.07, seed) - 0.5) +
        0.22 * (smooth(t * 0.19, seed + 1) - 0.5) * (this.loopRate > 0 ? 2 : 1);
      const hx = this.d[0],
        hz = this.d[2],
        hl = Math.hypot(hx, hz) || 1;
      // Prefer passes across the view, where the stream's shapes show best.
      yaw -= 0.15 * (hz / hl) * (hx >= 0 ? 1 : -1);
      const outX = Math.max(0, Math.abs(x) - ROUTE_BOX.x),
        outZ = Math.max(0, z - ROUTE_BOX.zMax, ROUTE_BOX.zMin - z);
      if (outX > 0 || outZ > 0) {
        const cx = -x,
          cz = 15 - z,
          cross = (hx * cz - hz * cx) / hl,
          toward = (hx * cx + hz * cz) / hl / (Math.hypot(cx, cz) || 1);
        if (toward < 0.95)
          yaw =
            (cross >= 0 ? 1 : -1) * Math.min(0.4, 0.12 + 0.01 * (outX + outZ));
      }
      this.rotate([0, 1, 0], -yaw * h);
      // Pitch: level out, follow a slow climb-and-dive, stay in the band.
      let pitch =
        0.2 * (smooth(t * 0.11, seed + 2) - 0.5) +
        0.1 * (smooth(t * 0.31, seed + 4) - 0.5);
      if (this.loopRate < 0) pitch *= 3;
      if (y < ROUTE_BOX.yMin) pitch = 0.15;
      if (y > ROUTE_BOX.yMax) pitch = -0.15;
      const target = Math.max(-0.3, Math.min(0.3, pitch * 4)),
        current = Math.asin(Math.max(-1, Math.min(1, this.d[1]))),
        hl2 = Math.hypot(this.d[0], this.d[2]) || 1,
        side = [-this.d[2] / hl2, 0, this.d[0] / hl2];
      this.rotate(side, (target - current) * 0.8 * h);
    }
    this.p[0] += this.d[0] * this.speed * h;
    this.p[1] += this.d[1] * this.speed * h;
    this.p[2] += this.d[2] * this.speed * h;
    this.time = Math.round((t + h) * 1e6) / 1e6;
    const k = Math.floor(this.time / TRAIL_SAMPLE + 1e-6);
    if (k > this.newest) this.store(k);
  }
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
  /** The guide's route; recomputed from the seed, never saved. */
  route: Route;
  /** Each bird's place along the trail (absolute trail index; saved). */
  lane: Int32Array;
  /** Seconds of warm-up still to run before the artwork's time zero. */
  warm = 0;
  // Scratch (derived every tick, never causal state across ticks).
  neighbours: Int32Array;
  counts: Int32Array;
  force: Float64Array;
  /** Each bird's target speed this step (scratch). */
  pace: Float64Array;
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
    this.pace = new Float64Array(count);
    this.order = new Int32Array(count);
    this.bucketOf = new Int32Array(count);
    this.schedule = new EvolutionSchedule(seed);
    this.lane = new Int32Array(count);
    const random = rng(seed),
      speed = this.cruise();
    // Lay the birds along the last 30 s of the guide's trail, then let them
    // settle for six seconds before the artwork's time zero.
    this.warm = WARM_UP;
    this.route = new Route(seed, speed * GUIDE_PACE);
    this.route.advanceTo(this.routeTime());
    const a = [0, 0, 0],
      c = [0, 0, 0],
      newest = this.route.newest;
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        k = Math.max(
          1,
          newest -
            1 -
            Math.floor(
              (this.streamLength() * hash(seed * 59 + i * 7)) / TRAIL_SAMPLE,
            ),
        );
      random();
      this.route.point(k, a);
      this.route.point(k + 1, c);
      const tx = c[0] - a[0],
        ty = c[1] - a[1],
        tz = c[2] - a[2],
        tl = Math.hypot(tx, ty, tz) || 1,
        w = this.streamWidth() * 0.7;
      this.birds[at] = a[0] + (random() - 0.5) * 2 * w;
      this.birds[at + 1] = a[1] + (random() - 0.5) * w;
      this.birds[at + 2] = a[2] + (random() - 0.5) * 2 * w;
      this.birds[at + 3] = (tx / tl) * speed;
      this.birds[at + 4] = (ty / tl) * speed;
      this.birds[at + 5] = (tz / tl) * speed;
      this.lane[i] = k;
    }
    for (let i = 0; i < WARM_UP * 60; i++) this.step();
    this.tick = 0;
    this.warm = 0;
    this.targetIndex = -1;
  }
  /**
   * Seconds of trail the stream spreads over, and its typical half-width:
   * smaller flocks make a shorter, narrower stream so it stays as dense.
   */
  private streamLength() {
    return STREAM_LENGTH * Math.sqrt(this.birds.length / BIRD_STRIDE / 3000);
  }
  private streamWidth() {
    return TRAIL_WIDTH * Math.pow(this.birds.length / BIRD_STRIDE / 3000, 0.25);
  }
  /** Route seconds: the route runs a minute ahead so a trail exists at zero. */
  private routeTime() {
    return this.tick / 60 + ROUTE_LEAD - this.warm;
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
    const route = this.route;
    route.advanceTo(this.routeTime());

    // Falcon: fix the aim when an attack window opens, at a bird's predicted
    // position (the stream's centre may be open sky).
    const attack = this.params.predator ? attackAt(t, this.seed) : undefined;
    if (attack && attack.index !== this.targetIndex) {
      const at =
          Math.floor(hash(this.seed * 53 + attack.index) * count) * BIRD_STRIDE,
        lead = attack.time - t;
      this.target = [
        b[at] + b[at + 3] * lead,
        b[at + 1] + b[at + 4] * lead,
        b[at + 2] + b[at + 5] * lead,
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

    // Breakaway: now and then the birds around one leader pull away together
    // (sideways and up or down) for a few seconds. They may split off as a
    // separate cluster before the roost draws them back.
    const breakEvent = Math.floor((t - 8) / BREAK_EVERY),
      breakStart =
        8 + breakEvent * BREAK_EVERY + 15 * hash(this.seed * 37 + breakEvent),
      breaking =
        variation > 0 &&
        breakEvent >= 0 &&
        t >= breakStart &&
        t < breakStart + BREAK_TIME;
    let breakX = 0,
      breakY = 0,
      breakZ = 0,
      breakFx = 0,
      breakFy = 0,
      breakFz = 0;
    const streamLength = this.streamLength(),
      streamWidth = this.streamWidth(),
      breakRadius = BREAK_RADIUS * Math.pow(count / 3000, 0.4),
      oldest = route.oldest(),
      newest = route.newest,
      head = route.p,
      pa = [0, 0, 0],
      pb = [0, 0, 0];
    if (breaking) {
      const leader =
          Math.floor(hash(this.seed * 41 + breakEvent) * count) * BIRD_STRIDE,
        lvx = b[leader + 3],
        lvz = b[leader + 5],
        lv = Math.sqrt(lvx * lvx + lvz * lvz) || 1,
        sign = hash(this.seed * 43 + breakEvent) < 0.5 ? -1 : 1,
        lift = (hash(this.seed * 47 + breakEvent) - 0.5) * 0.9;
      breakX = b[leader];
      breakY = b[leader + 1];
      breakZ = b[leader + 2];
      breakFx = BREAK_FORCE * sign * (-lvz / lv);
      breakFz = BREAK_FORCE * sign * (lvx / lv);
      breakFy = BREAK_FORCE * lift;
    }

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
      // The stream: find the nearest stretch of the guide's trail near this
      // bird's place along it, fly the trail's direction there, and keep
      // within the stream's width (which swells and thins along its length).
      {
        let best = Infinity,
          bestK = this.lane[i],
          qx = 0,
          qy = 0,
          qz = 0,
          tx = 1,
          ty = 0,
          tz = 0;
        const from = Math.max(oldest, this.lane[i] - 2),
          to = Math.min(newest, this.lane[i] + 4);
        for (let k = from; k <= to; k++) {
          route.point(k, pa);
          if (k < newest) route.point(k + 1, pb);
          else {
            pb[0] = head[0];
            pb[1] = head[1];
            pb[2] = head[2];
          }
          const sx2 = pb[0] - pa[0],
            sy2 = pb[1] - pa[1],
            sz2 = pb[2] - pa[2],
            sl2 = sx2 * sx2 + sy2 * sy2 + sz2 * sz2 || 1e-9,
            u = Math.max(
              0,
              Math.min(
                1,
                ((x - pa[0]) * sx2 + (y - pa[1]) * sy2 + (z - pa[2]) * sz2) /
                  sl2,
              ),
            ),
            cx2 = pa[0] + sx2 * u,
            cy2 = pa[1] + sy2 * u,
            cz2 = pa[2] + sz2 * u,
            // Vertical offsets count double: the stream is a flattened band.
            d2 = (x - cx2) ** 2 + 4 * (y - cy2) ** 2 + (z - cz2) ** 2;
          if (d2 < best) {
            best = d2;
            bestK = k;
            qx = cx2;
            qy = cy2;
            qz = cz2;
            const l = Math.sqrt(sl2);
            tx = sx2 / l;
            ty = sy2 / l;
            tz = sz2 / l;
          }
        }
        this.lane[i] = bestK;
        // Spread the stream along the trail: each bird keeps to its own
        // place behind the guide, speeding up when behind it and easing off
        // when ahead, so the stream stays long and its shape persists.
        const lag = (newest - bestK) * TRAIL_SAMPLE,
          place = streamLength * hash(this.seed * 59 + i * 7);
        this.pace[i] =
          cruise *
          GUIDE_PACE *
          (1 + Math.max(-0.25, Math.min(0.35, (lag - place) / 8)));
        fx += W_TRAIL_ALIGN * (tx - ex);
        fy += W_TRAIL_ALIGN * (ty - ey);
        fz += W_TRAIL_ALIGN * (tz - ez);
        const dist = Math.sqrt(best),
          // The band swells and pinches along its length.
          width =
            streamWidth *
            (0.3 +
              0.9 * smooth(bestK * TRAIL_SAMPLE * 0.12, this.seed + 3) +
              0.5 * smooth(bestK * TRAIL_SAMPLE * 0.04, this.seed + 5));
        if (dist > width) {
          const pull = (W_TRAIL_PULL * Math.min(1, (dist - width) / 20)) / dist;
          fx += (qx - x) * pull;
          fy += (qy - y) * pull * 2;
          fz += (qz - z) * pull;
        }
      }
      if (breaking) {
        const bx = x - breakX,
          by = y - breakY,
          bz = z - breakZ;
        if (bx * bx + by * by + bz * bz < breakRadius * breakRadius) {
          fx += breakFx;
          fy += breakFy;
          fz += breakFz;
        }
      }
      // The ground and the ceiling.
      if (y < FLOOR) fy += Math.min(1.5, 0.15 * (FLOOR - y));
      if (y > CEILING) fy -= Math.min(1, 0.05 * (y - CEILING));
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
        if (pd < 6.4 * SPACING && escape === 0)
          this.startEscape(i, px * sx + pz * sz);
        if (pd < 5.6 * SPACING) {
          const away = (attack!.fast ? 2.2 : 1.2) * (1 - pd / (5.6 * SPACING));
          fx += (px / pd) * away;
          fy += (py / pd) * away;
          fz += (pz / pd) * away;
        }
        // A fast pass makes the flock burst outward around the falcon.
        if (attack!.fast && pd < 9.6 * SPACING) {
          const burst = 1.4 * (1 - pd / (9.6 * SPACING));
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
          // Birds pull more lift in a banked turn so they hold altitude.
          lift = (ratio * MASS * GRAVITY) / Math.max(0.5, cb),
          drag = (ratio * MASS * GRAVITY) / LIFT_DRAG,
          thrust = (MASS * GRAVITY) / LIFT_DRAG,
          speedControl = (MASS / SPEED_RELAX) * (this.pace[i] - v);
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
        lane: Array.from(this.lane),
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
    // The route is a function of the seed and time: fly it again.
    this.warm = 0;
    this.route = new Route(this.seed, this.cruise() * GUIDE_PACE);
    this.route.advanceTo(this.routeTime());
    const lane = s.extra?.lane as number[] | undefined,
      oldest = this.route.oldest(),
      newest = this.route.newest;
    if (
      Array.isArray(lane) &&
      lane.length === count &&
      lane.every((k) => Number.isInteger(k) && k >= oldest && k <= newest)
    )
      this.lane.set(lane);
    else {
      // Without saved places, each bird takes the nearest trail point.
      const p = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        let best = Infinity;
        for (let k = oldest; k <= newest; k++) {
          this.route.point(k, p);
          const d =
            (this.birds[i * BIRD_STRIDE] - p[0]) ** 2 +
            (this.birds[i * BIRD_STRIDE + 1] - p[1]) ** 2 +
            (this.birds[i * BIRD_STRIDE + 2] - p[2]) ** 2;
          if (d < best) {
            best = d;
            this.lane[i] = k;
          }
        }
      }
    }
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
      // Rejoin the stream near a bird in it, flying with the flock.
      const host = Math.floor(random() * count) * BIRD_STRIDE;
      b[at] = b[host] + (random() - 0.5) * 20;
      b[at + 1] = b[host + 1] + (random() - 0.5) * 4;
      b[at + 2] = b[host + 2] + (random() - 0.5) * 20;
      this.lane[at / BIRD_STRIDE] = this.lane[host / BIRD_STRIDE];
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
