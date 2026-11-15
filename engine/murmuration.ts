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
/** Spacing relative to StarDisplay: each simulated bird stands for a few birds. */
export const SPACING = 1.8;
const MASS = 0.08,
  GRAVITY = 9.81,
  CRUISE = 10, // m/s at the default flight-speed parameter
  LIFT_DRAG = 3.3,
  SPEED_RELAX = 1, // s
  NEIGHBOURS = 7,
  HARD = 0.2 * SPACING, // m, hard-sphere radius
  SEP_SIGMA2 = (1.37 * SPACING) ** 2, // m²
  W_SEP = 1, // N
  W_ALIGN = 0.5, // N
  W_COHESION = 1, // N (scaled by the cohesion parameter)
  W_NOISE = 0.01, // N
  BLIND = -0.7071, // cos 135°: neighbours behind are ignored for cohesion and alignment
  BANK_MAX = 1.3, // rad
  // Turning has inertia, as in the inertial spin model (Cavagna et al.): the
  // sideways pull of a bird's neighbours (mostly their differing heading)
  // changes its bank, the bank turns it, and the bank decays slowly. A
  // heading change therefore runs through the flock as a wave, and a flock
  // flying straight settles level.
  TORQUE_HEADING = 30, // 1/s: bank change per radian of sideways difference from the neighbours' heading
  TORQUE = 1, // 1/s: bank change per unit of other sideways pull (in g)
  BANK_DECAY = 3, // 1/s
  DRIVE = 12, // 1/s: how fast a bird starting a turn or escaping reaches its bank
  SIDE_DIRECT = 0.6, // share of the sideways social force that acts directly
  LEVEL = 0.03, // N per m/s of climb or sink, levelling out
  FLOOR = 14, // m, below this birds climb away from the ground
  OUTER = 1.6, // backstop pull beyond this multiple of the home area
  WARM_UP = 6, // s of settling before time zero
  TURN_GAP = 8, // s between turns started by small groups
  STRAY = 0.08, // pieces smaller than this share of the flock are strays
  W_STRAY = 0.45, // N drawing strays back toward the main body
  W_PIECE = 0.45, // N drawing larger pieces back (less for larger pieces)
  PITCH_GAP = 13, // s between climbs or dives
  SPLIT_GAP = 70, // s between splits
  STARTLE_GAP = 5, // s between startles
  REJOIN_RATE = 0.25, // chance per second that a separated piece heads back
  REJOIN_FORCE = 0.5, // N
  ZIG_FORCE = 0.6, // N
  ZIG_BANK = 0.9, // rad
  ZIG_OUT = 0.25, // s
  ZIG_BACK = 0.3, // s
  REFRACTORY = 1, // s
  CUE = 0.02, // s to recognise a neighbour's escape (each bird stands for several)
  REACTION = 0.03, // s
  SUBSTEPS = 2,
  PERCEIVE = 3, // steps between a bird's neighbour updates (50 ms)
  CELL = 3.5 * SPACING, // m, neighbour-grid cell
  TABLE = 1 << 14;
const ZIG = ZIG_OUT + ZIG_BACK;
/** The middle of the sky the flock keeps to (m): centre, half-sizes, altitude band. */
const HOME = { x: 0, y: 100, z: 40, rx: 60, rz: 70, yLow: 65, yHigh: 135 };
/** Weights that shape the flock's spacing and thickness (exposed for tuning). */
export const TUNING = {
  separation: 5 * W_SEP,
  separationSigma2: SEP_SIGMA2,
  cohesion: W_COHESION,
  alignment: 2 * W_ALIGN,
  torqueHeading: TORQUE_HEADING,
  torque: TORQUE,
  bankDecay: BANK_DECAY,
  sideDirect: SIDE_DIRECT,
  flatten: 0.6, // vertical separation scale (vertical cohesion is scaled by its inverse)
};

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

/** One flock event: a group of birds that starts a turn, a climb or dive, or a return to the flock. */
interface FlockEvent {
  kind: number; // EVENT_TURN, EVENT_PITCH or EVENT_REJOIN
  centre: number; // bird index the group forms around (the group moves with it)
  radius: number; // m
  end: number; // tick
  amount: number; // bank (rad) for a turn, vertical force (N) for a pitch
  target: number[]; // where a rejoining group heads
}
const EVENT_TURN = 0,
  EVENT_PITCH = 1,
  EVENT_REJOIN = 2;

export class Murmuration implements Simulation {
  tick = 0;
  historyBudgetBytes = 32 * 1024 * 1024;
  birds: Float64Array;
  schedule: EvolutionSchedule;
  /** Where the current attack aims: a bird's predicted position. */
  target: number[] = [0, HOME.y, HOME.z];
  targetIndex = -1;
  /** Whether neighbour lists exist (they are part of the saved state). */
  perceived = false;
  /** Groups currently turning, climbing or rejoining (saved state). */
  events: FlockEvent[] = [];
  // Scratch (derived every tick, never causal state across ticks).
  neighbours: Int32Array;
  counts: Int32Array;
  force: Float64Array;
  /** The bank a bird is commanded to hold (NaN: none), and how far its
   * neighbours' heading lies to its side (radians); both scratch. */
  command: Float64Array;
  misalign: Float64Array;
  /** Which piece of the flock each bird belongs to (scratch, refreshed every second). */
  piece: Int32Array;
  /** Size of each bird's piece, and the main piece's centre (scratch, refreshed every second). */
  pieceSize: Int32Array;
  mainCentre = [0, 0, 0];
  mainSize = 0;
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
    this.command = new Float64Array(count);
    this.misalign = new Float64Array(count);
    this.piece = new Int32Array(count);
    this.pieceSize = new Int32Array(count).fill(count);
    this.order = new Int32Array(count);
    this.bucketOf = new Int32Array(count);
    this.schedule = new EvolutionSchedule(seed);
    // Start as a loose sheet crossing the view, then settle before time zero.
    const random = rng(seed),
      heading = (random() < 0.5 ? 0 : Math.PI) + (random() - 0.5) * 0.6,
      speed = this.cruise(),
      radius = Math.sqrt(count) * 0.55 * SPACING;
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        r = radius * Math.sqrt(random()),
        a = random() * Math.PI * 2,
        h = heading + (random() - 0.5) * 0.2;
      this.birds[at] = HOME.x + r * Math.cos(a);
      this.birds[at + 1] = HOME.y + (random() - 0.5) * 6 * SPACING;
      this.birds[at + 2] = HOME.z + r * Math.sin(a) * 0.5;
      this.birds[at + 3] = Math.cos(h) * speed;
      this.birds[at + 4] = 0;
      this.birds[at + 5] = Math.sin(h) * speed;
    }
    for (let i = 0; i < WARM_UP * 60; i++) this.step();
    this.tick = 0;
    this.targetIndex = -1;
    this.events = [];
  }
  private cruise() {
    return CRUISE * (Number(this.params.velocity ?? 0.12) / 0.12);
  }
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
  /**
   * Pieces of the flock: connected parts of the nearest-neighbour graph.
   * Returns the pieces' sizes and centroids, largest first.
   */
  private findPieces() {
    const count = this.birds.length / BIRD_STRIDE,
      parent = this.piece,
      b = this.birds;
    for (let i = 0; i < count; i++) parent[i] = i;
    const find = (x: number) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    for (let i = 0; i < count; i++)
      for (let k = 0; k < this.counts[i]; k++) {
        const j = this.neighbours[i * NEIGHBOURS + k],
          dx = b[i * BIRD_STRIDE] - b[j * BIRD_STRIDE],
          dy = b[i * BIRD_STRIDE + 1] - b[j * BIRD_STRIDE + 1],
          dz = b[i * BIRD_STRIDE + 2] - b[j * BIRD_STRIDE + 2];
        // Only near neighbours hold a piece together.
        if (dx * dx + dy * dy + dz * dz < (4 * SPACING) ** 2)
          parent[find(i)] = find(j);
      }
    const stats = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const r = find(i);
      parent[i] = r;
      let s = stats.get(r);
      if (!s) stats.set(r, (s = [0, 0, 0, 0, r]));
      s[0]++;
      s[1] += b[i * BIRD_STRIDE];
      s[2] += b[i * BIRD_STRIDE + 1];
      s[3] += b[i * BIRD_STRIDE + 2];
    }
    return [...stats.values()]
      .map((s) => ({
        size: s[0],
        root: s[4],
        c: [s[1] / s[0], s[2] / s[0], s[3] / s[0]],
      }))
      .sort((p, q) => q.size - p.size || p.root - q.root);
  }
  /** New groups that start turns, climbs, splits and returns. */
  private startEvents(t: number, variation: number) {
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      seed = this.seed,
      lively = 0.5 + variation,
      tick = this.tick;
    const fires = (k: number, gap: number, salt: number) => {
      const index = Math.floor(t / gap);
      if (index < 1) return -1;
      const at = Math.round(
        (index * gap + gap * hash(seed * salt + index)) * 60,
      );
      return at === tick ? index : -1;
    };
    // A turn: a few birds bank and hold it; the roll spreads to the rest as
    // a wave. Birds far out or heading away from the middle of the sky turn
    // back toward it; otherwise the turn is a wander, left or right.
    const turn = fires(0, TURN_GAP / lively, 61);
    if (turn >= 0) {
      let best = -1,
        bestScore = -Infinity;
      for (let k = 0; k < 24; k++) {
        const i = Math.floor(hash(seed * 67 + turn * 31 + k) * count),
          at = i * BIRD_STRIDE,
          ox = (b[at] - HOME.x) / HOME.rx,
          oz = (b[at + 2] - HOME.z) / HOME.rz,
          out = Math.hypot(ox, oz),
          v = Math.hypot(b[at + 3], b[at + 5]) || 1,
          away =
            ((ox * b[at + 3]) / HOME.rx + (oz * b[at + 5]) / HOME.rz) /
            v /
            (out || 1),
          score =
            out * (0.5 + Math.max(0, away)) +
            0.3 * hash(seed * 71 + turn * 7 + k);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      const at = best * BIRD_STRIDE,
        vx = b[at + 3],
        vz = b[at + 5],
        hx = HOME.x - b[at],
        hz = HOME.z - b[at + 2],
        homeSide = vx * hz - vz * hx >= 0 ? 1 : -1, // +1: home is to the left
        homing = bestScore > 0.9,
        sign = homing ? homeSide : hash(seed * 73 + turn) < 0.5 ? -1 : 1,
        strength = homing
          ? 0.55 + 0.25 * hash(seed * 79 + turn)
          : 0.25 + 0.35 * hash(seed * 79 + turn);
      this.events.push({
        kind: EVENT_TURN,
        centre: best,
        radius: (10 + 10 * hash(seed * 83 + turn)) * SPACING,
        end:
          tick + Math.round((homing ? 3 : 2 + 2 * hash(seed * 89 + turn)) * 60),
        amount: -sign * strength * BANK_MAX * 0.75,
        target: [0, 0, 0],
      });
    }
    // A climb or a dive: the sheet folds where part of it rises or sinks.
    const pitch = fires(1, PITCH_GAP / lively, 97);
    if (pitch >= 0) {
      const i = Math.floor(hash(seed * 101 + pitch) * count),
        y = b[i * BIRD_STRIDE + 1],
        up =
          y < HOME.yLow + 10
            ? 1
            : y > HOME.yHigh - 10
              ? -1
              : hash(seed * 103 + pitch) < 0.5
                ? -1
                : 1;
      this.events.push({
        kind: EVENT_PITCH,
        centre: i,
        radius: (12 + 10 * hash(seed * 107 + pitch)) * SPACING,
        end: tick + Math.round((1.5 + 2 * hash(seed * 109 + pitch)) * 60),
        amount: up * (0.35 + 0.35 * hash(seed * 113 + pitch)),
        target: [0, 0, 0],
      });
    }
    // A split: groups at the two ends of the flock commit to opposite turns
    // and tear it apart. The pieces find each other again later.
    const split = variation > 0 ? fires(2, SPLIT_GAP / lively, 127) : -1;
    if (split >= 0) {
      const c = this.centre(),
        hv = Math.hypot(c[3], c[5]) || 1,
        ax = -c[5] / hv,
        az = c[3] / hv; // across the flock's travel
      let lo = 0,
        hi = 0,
        loV = Infinity,
        hiV = -Infinity;
      for (let i = 0; i < count; i++) {
        const at = i * BIRD_STRIDE,
          v =
            (b[at] - c[0]) * ax +
            (b[at + 2] - c[2]) * az +
            0.4 * (b[at + 1] - c[1]);
        if (v < loV) ((loV = v), (lo = i));
        if (v > hiV) ((hiV = v), (hi = i));
      }
      const span = Math.max(10, hiV - loV),
        long = Math.round((3 + 3 * hash(seed * 131 + split)) * 60);
      for (const [i, sign] of [
        [lo, 1],
        [hi, -1],
      ])
        this.events.push({
          kind: EVENT_TURN,
          centre: i,
          radius: Math.min(22 * SPACING, span * 0.35),
          end: tick + long,
          amount: sign * 0.65 * BANK_MAX,
          target: [0, 0, 0],
        });
    }
    // Every second, each piece of the flock looks where it is going. A piece
    // that is out toward the edge of the sky and heading further out turns
    // home: the birds at its leading edge start the turn, the rest follow.
    // Pieces that have drifted apart turn back toward the main body.
    if (tick % 60 === 0) {
      const pieces = this.findPieces(),
        sizes = new Map(pieces.map((p) => [p.root, p.size]));
      for (let i = 0; i < count; i++)
        this.pieceSize[i] = sizes.get(this.piece[i]) ?? count;
      this.mainCentre = pieces[0].c;
      this.mainSize = pieces[0].size;
      for (const p of pieces) {
        if (p.size < Math.max(3, count * 0.03)) continue;
        let vx = 0,
          vz = 0,
          lead = -1,
          leadV = -Infinity;
        for (let i = 0; i < count; i++)
          if (this.piece[i] === p.root) {
            vx += b[i * BIRD_STRIDE + 3];
            vz += b[i * BIRD_STRIDE + 5];
          }
        const vl = Math.hypot(vx, vz) || 1;
        vx /= vl;
        vz /= vl;
        const ox = (p.c[0] - HOME.x) / HOME.rx,
          oz = (p.c[2] - HOME.z) / HOME.rz,
          out = Math.hypot(ox, oz),
          away = (ox * vx + oz * vz) / (out || 1);
        if (out < 0.55 || away < -0.2) continue;
        if (
          this.events.some(
            (e) =>
              e.kind === EVENT_TURN &&
              e.radius > 0 &&
              this.piece[e.centre] === p.root &&
              e.amount !== 0 &&
              e.target[0] === 1,
          )
        )
          continue;
        for (let i = 0; i < count; i++)
          if (this.piece[i] === p.root) {
            const v = b[i * BIRD_STRIDE] * vx + b[i * BIRD_STRIDE + 2] * vz;
            if (v > leadV) ((leadV = v), (lead = i));
          }
        const hx = HOME.x - p.c[0],
          hz = HOME.z - p.c[2],
          left = vx * hz - vz * hx >= 0 ? 1 : -1,
          urgency = Math.min(1, out - 0.4);
        this.events.push({
          kind: EVENT_TURN,
          centre: lead,
          radius: Math.sqrt(p.size) * (0.8 + 0.8 * urgency) * SPACING + 8,
          end: tick + Math.round((2 + 2 * urgency) * 60),
          amount: -left * (0.45 + 0.4 * urgency) * BANK_MAX,
          target: [1, 0, 0], // marks a homing turn
        });
      }
      if (pieces.length > 1) {
        const main = pieces[0];
        for (const p of pieces.slice(1)) {
          if (p.size < Math.max(3, count * 0.01)) continue;
          const d = Math.hypot(
            p.c[0] - main.c[0],
            p.c[1] - main.c[1],
            p.c[2] - main.c[2],
          );
          if (d < 12 * SPACING) continue;
          // Wait a while after splitting so pieces travel apart first.
          if (hash(seed * 137 + tick + p.root) > REJOIN_RATE) continue;
          let centre = -1;
          for (let i = 0; i < count && centre < 0; i++)
            if (this.piece[i] === p.root) centre = i;
          if (
            centre < 0 ||
            this.events.some(
              (e) => e.kind === EVENT_REJOIN && this.piece[e.centre] === p.root,
            )
          )
            continue;
          this.events.push({
            kind: EVENT_REJOIN,
            centre,
            radius: Math.sqrt(p.size) * 1.6 * SPACING + 10,
            end: tick + Math.round(4 * 60),
            amount: 0,
            target: main.c,
          });
        }
      }
    }
    if (this.events.length > 24) this.events.splice(0, this.events.length - 24);
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
    this.events = this.events.filter((e) => e.end > this.tick);
    this.startEvents(t, variation);

    // Falcon: fix the aim when an attack window opens.
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

    // Startles: a single bird zigs, and the zig is copied outward.
    const startleEvent = Math.floor(t / STARTLE_GAP),
      startleTick = Math.round(
        (startleEvent * STARTLE_GAP +
          STARTLE_GAP * hash(this.seed * 9 + startleEvent)) *
          60,
      );
    if (variation > 0 && this.tick === startleTick)
      this.startEscape(
        Math.floor(hash(this.seed * 23 + startleEvent) * count),
        hash(this.seed * 29 + startleEvent) - 0.5,
      );

    // Event groups: who is in each, from the group centre's current position.
    const command = this.command;
    command.fill(NaN);
    const events = this.events.map((e) => {
      const at = e.centre * BIRD_STRIDE;
      return {
        e,
        x: b[at],
        y: b[at + 1],
        z: b[at + 2],
        r2: e.radius * e.radius,
      };
    });

    // Social, area, event, escape and noise forces: once per reaction step.
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
        uz = 0;
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
        const g =
          d <= HARD
            ? 1
            : Math.exp(-((d - HARD) ** 2) / TUNING.separationSigma2);
        // Weaker apart vertically, so the flock spreads into a sheet (real
        // flocks are much thinner than they are wide).
        fx -= (TUNING.separation / n) * g * hx;
        fy -= (TUNING.separation / n) * g * hy * TUNING.flatten;
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
      this.misalign[i] = 0;
      if (seen) {
        const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        this.misalign[i] = (ax / al - ex) * sx + (az / al - ez) * sz;
        fx += TUNING.alignment * (ax / al - ex);
        fy += TUNING.alignment * (ay / al - ey);
        fz += TUNING.alignment * (az / al - ez);
        const centrality = n ? Math.sqrt(ux * ux + uy * uy + uz * uz) / n : 1;
        fx += (centrality * cohesion * cx) / seen;
        fy += (centrality * cohesion * cy) / seen / TUNING.flatten;
        fz += (centrality * cohesion * cz) / seen;
      }
      // Birds in a small stray cluster keep looking for the main body and
      // head back to it; larger pieces wander on their own for a while.
      if (this.pieceSize[i] < this.mainSize) {
        const share = this.pieceSize[i] / count,
          w =
            share < STRAY
              ? W_STRAY
              : W_PIECE * (1 - Math.min(0.8, share / 0.5)),
          tx = this.mainCentre[0] - x,
          ty = this.mainCentre[1] - y,
          tz = this.mainCentre[2] - z,
          tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        fx += w * (tx / tl - ex);
        fy += w * 0.5 * (ty / tl - ey);
        fz += w * (tz / tl - ez);
      }

      // The sky's limits act on single birds only far out, as a backstop;
      // the flock is kept in view by the turns its members start.
      const ox = Math.abs(x - HOME.x) - HOME.rx * OUTER,
        oz = Math.abs(z - HOME.z) - HOME.rz * OUTER;
      if (ox > 0) fx -= Math.sign(x - HOME.x) * Math.min(1, 0.02 * ox);
      if (oz > 0) fz -= Math.sign(z - HOME.z) * Math.min(1, 0.02 * oz);
      if (y < HOME.yLow) fy += Math.min(0.8, 0.03 * (HOME.yLow - y));
      if (y > HOME.yHigh) fy -= Math.min(0.8, 0.03 * (y - HOME.yHigh));
      if (y < FLOOR) fy += Math.min(1.5, 0.15 * (FLOOR - y));
      fy -= LEVEL * vy; // level out after a climb or a dive
      // Groups: hold a bank (turn), climb or dive, or head back to the flock.
      for (const g of events) {
        const gx = x - g.x,
          gy = y - g.y,
          gz = z - g.z,
          d2 = gx * gx + gy * gy + gz * gz;
        if (d2 > g.r2) continue;
        const fade = 1 - d2 / g.r2;
        if (g.e.kind === EVENT_TURN) {
          if (
            Number.isNaN(command[i]) ||
            Math.abs(g.e.amount) > Math.abs(command[i])
          )
            command[i] = g.e.amount * Math.min(1, 1.6 * fade);
        } else if (g.e.kind === EVENT_PITCH) fy += g.e.amount * fade;
        else {
          const tx = g.e.target[0] - x,
            ty = g.e.target[1] - y,
            tz = g.e.target[2] - z,
            tl = Math.hypot(tx, ty, tz) || 1;
          fx += REJOIN_FORCE * (tx / tl - ex);
          fy += REJOIN_FORCE * 0.5 * (ty / tl - ey);
          fz += REJOIN_FORCE * (tz / tl - ez);
        }
      }
      const escape = b[at + 7],
        age = Math.abs(escape),
        side = escape < 0 ? -1 : 1;
      if (escape !== 0 && age < ZIG) {
        const push = (age < ZIG_OUT ? 1 : -1) * ZIG_FORCE * side;
        fx += push * sx;
        fz += push * sz;
        command[i] = (age < ZIG_OUT ? -1 : 1) * side * ZIG_BANK;
      }
      if (hawk) {
        const px = x - hawk[0],
          py = y - hawk[1],
          pz = z - hawk[2],
          pd = Math.sqrt(px * px + py * py + pz * pz) || 1,
          reach = 6.4 * SPACING;
        if (pd < reach && escape === 0) this.startEscape(i, px * sx + pz * sz);
        if (pd < reach) {
          const away = (attack!.fast ? 1.4 : 0.8) * (1 - pd / reach);
          fx += (px / pd) * away;
          fy += (py / pd) * away;
          fz += (pz / pd) * away;
        }
        if (attack!.fast && pd < 1.7 * reach) {
          const burst = 0.8 * (1 - pd / (1.7 * reach));
          fx += (px / pd) * burst;
          fy += (py / pd) * burst;
          fz += (pz / pd) * burst;
        }
      }
      fx += (random() - 0.5) * 2 * W_NOISE;
      fy += (random() - 0.5) * 2 * W_NOISE;
      fz += (random() - 0.5) * 2 * W_NOISE;
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
      this.force[i * 3] = fx;
      this.force[i * 3 + 1] = fy;
      this.force[i * 3 + 2] = fz;
    }

    // Flight, in substeps. Social forces turn a bird mostly by banking it
    // (see TORQUE above), so turns carry momentum and travel as waves.
    const h = dt / SUBSTEPS;
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        Fx = this.force[i * 3],
        Fy = this.force[i * 3 + 1],
        Fz = this.force[i * 3 + 2],
        cmd = command[i],
        mis = this.misalign[i];
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
        let upx = -ey * ex,
          upy = 1 - ey * ey,
          upz = -ey * ez;
        const ul = Math.sqrt(upx * upx + upy * upy + upz * upz) || 1;
        upx /= ul;
        upy /= ul;
        upz /= ul;
        // Positive bank turns toward the side axis (forward × up).
        const side = Fx * sx + Fz * sz,
          lateral = side / MASS;
        if (Number.isNaN(cmd))
          bank +=
            (TUNING.torqueHeading * mis +
              TUNING.torque * Math.atan(lateral / GRAVITY) -
              TUNING.bankDecay * bank) *
            h;
        else bank += DRIVE * (cmd - bank) * h;
        bank = Math.max(-BANK_MAX, Math.min(BANK_MAX, bank));
        const cb = Math.cos(bank),
          sb = Math.sin(bank),
          lx = cb * upx + sb * sx,
          ly = cb * upy,
          lz = cb * upz + sb * sz,
          ratio = (v * v) / (cruise * cruise),
          // More lift in a banked turn, so turning birds hold altitude.
          lift = (ratio * MASS * GRAVITY) / Math.max(0.35, cb),
          drag = (ratio * MASS * GRAVITY) / LIFT_DRAG,
          thrust = (MASS * GRAVITY) / LIFT_DRAG,
          speedControl = (MASS / SPEED_RELAX) * (cruise - v);
        const keep = (1 - TUNING.sideDirect) * side,
          dFx = Fx - keep * sx,
          dFz = Fz - keep * sz;
        const ax =
            (dFx + lift * lx + (thrust - drag + speedControl) * ex) / MASS,
          ay =
            (Fy +
              lift * ly +
              (thrust - drag + speedControl) * ey -
              MASS * GRAVITY) /
            MASS,
          az = (dFz + lift * lz + (thrust - drag + speedControl) * ez) / MASS;
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
      const escape = b[at + 7];
      if (escape !== 0) {
        const age = Math.abs(escape) + dt;
        b[at + 7] = age > ZIG + REFRACTORY ? 0 : escape < 0 ? -age : age;
      }
    }
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
        events: this.events.map((e) => [
          e.kind,
          e.centre,
          e.radius,
          e.end,
          e.amount,
          ...e.target,
        ]),
        // Piece sizes and the main body's centre are refreshed once a second
        // and act on the birds in between, so they are part of the state.
        pieceSize: Array.from(this.pieceSize),
        main: [...this.mainCentre, this.mainSize],
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
        : [0, HOME.y, HOME.z];
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
    const pieceSize = s.extra?.pieceSize as number[] | undefined,
      main = s.extra?.main as number[] | undefined;
    if (
      Array.isArray(pieceSize) &&
      pieceSize.length === count &&
      pieceSize.every((v) => Number.isInteger(v) && v >= 0 && v <= count) &&
      Array.isArray(main) &&
      main.length === 4 &&
      main.every(Number.isFinite)
    ) {
      this.pieceSize.set(pieceSize);
      this.mainCentre = main.slice(0, 3);
      this.mainSize = main[3];
    } else {
      this.pieceSize.fill(count);
      this.mainCentre = [HOME.x, HOME.y, HOME.z];
      this.mainSize = count;
    }
    const events = s.extra?.events as number[][] | undefined;
    this.events = Array.isArray(events)
      ? events
          .filter(
            (e) =>
              Array.isArray(e) &&
              e.length === 8 &&
              e.every(Number.isFinite) &&
              Number.isInteger(e[1]) &&
              e[1] >= 0 &&
              e[1] < count,
          )
          .map((e) => ({
            kind: e[0],
            centre: e[1],
            radius: e[2],
            end: e[3],
            amount: e[4],
            target: [e[5], e[6], e[7]],
          }))
      : [];
  }
  intervene(action: EvolutionAction) {
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      random = rng(this.seed + action.serial * 997),
      share = [0, 0.08, 0.25, 1][action.kind],
      total = Math.max(1, Math.round(count * share)),
      speed = this.cruise();
    for (let k = 0; k < total; k++) {
      const at = ((k + action.serial * 131) % count) * BIRD_STRIDE;
      if (action.kind === 1) {
        // A startle: a group escapes, and the wave spreads from it.
        b[at + 7] = b[at + 7] || (random() < 0.5 ? -1e-6 : 1e-6);
        continue;
      }
      // Rejoin the flock beside a bird in it, flying with it.
      const host = Math.floor(random() * count) * BIRD_STRIDE,
        v = Math.hypot(b[host + 3], b[host + 5]) || 1;
      b[at] = b[host] + (random() - 0.5) * 8 * SPACING;
      b[at + 1] = b[host + 1] + (random() - 0.5) * 2 * SPACING;
      b[at + 2] = b[host + 2] + (random() - 0.5) * 8 * SPACING;
      b[at + 3] = (b[host + 3] / v) * speed;
      b[at + 4] = 0;
      b[at + 5] = (b[host + 5] / v) * speed;
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
