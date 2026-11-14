import { frameBuffer } from "./render-frame";
import type { RenderFrame } from "./render-frame";
import { EvolutionSchedule, variationOf } from "./evolution";
import type { EvolutionAction } from "./evolution";
import { choreography } from "./choreography";
import type { Params, Simulation, Snapshot } from "./types";
import { rng } from "./types";

/**
 * Murmuration, revision 2: a three-dimensional flock.
 *
 * x spans the wall's width and y its height (0 at the top), both in [0, 1];
 * z is depth in [-0.5, 0.5], positive away from the viewer. Each bird reacts
 * to a capped number of nearby neighbors (as starlings track roughly seven),
 * so interaction cost and local behavior do not depend on flock density.
 * A slowly wandering attractor, blended chapters, soft sky containment and a
 * diving falcon shape the flock. Everything is deterministic from the seed,
 * tick, parameters and the checkpointed positions and velocities.
 */
export const BIRD_STRIDE = 6;
const NEIGHBORS = 8,
  RADIUS = 0.08,
  SEPARATION = 0.045,
  CELL = RADIUS,
  MIN = [-0.25, -0.25, -0.75],
  DIMS = [Math.ceil(1.5 / CELL), Math.ceil(1.5 / CELL), Math.ceil(1.5 / CELL)],
  CELLS = DIMS[0] * DIMS[1] * DIMS[2];
/** Sky region the flock is gently kept inside (above the hills). */
export const SKY = {
  x0: 0.05,
  x1: 0.95,
  y0: 0.06,
  y1: 0.66,
  z0: -0.26,
  z1: 0.26,
};

/** The wandering point the flock is drawn toward, per cohort. */
export function attractor(
  t: number,
  seed: number,
  cohort: number,
  split: number,
) {
  const phase = (seed % 997) * 0.0063,
    spread = split * (cohort - 1);
  return [
    0.5 +
      0.19 * Math.sin(t * 0.047 + phase) +
      0.16 * spread * Math.cos(t * 0.031),
    0.34 + 0.1 * Math.sin(t * 0.061 + phase * 1.3) + 0.06 * spread,
    0.16 * Math.sin(t * 0.039 + phase * 0.7) +
      0.12 * spread * Math.sin(t * 0.05),
  ];
}
/** The falcon's position: it circles wide and periodically dives through. */
export function falcon(t: number, seed: number) {
  const phase = (seed % 991) * 0.0071,
    cycle = (t / 26 + phase) % 1,
    dive = cycle > 0.62 ? Math.sin(((cycle - 0.62) / 0.38) * Math.PI) : 0,
    target = attractor(t, seed, 1, 0);
  const orbit = [
    0.5 + 0.42 * Math.sin(t * 0.21 + phase),
    0.12 + 0.05 * Math.cos(t * 0.17),
    0.3 * Math.cos(t * 0.21 + phase),
  ];
  return orbit.map((v, i) => v + (target[i] - v) * dive);
}
/** How strongly the falcon is present (fades in and out over minutes). */
export const falconPresence = (t: number, seed: number, variation: number) =>
  variation > 0
    ? Math.pow(0.5 + 0.5 * Math.sin(t * 0.083 + seed * 0.001), 2)
    : 1;

export class Murmuration implements Simulation {
  tick = 0;
  birds: Float64Array;
  next: Float64Array;
  schedule: EvolutionSchedule;
  cellCount = new Int32Array(CELLS);
  cellStart = new Int32Array(CELLS + 1);
  cellCursor = new Int32Array(CELLS);
  order: Int32Array;
  cellOf: Int32Array;
  constructor(
    public seed: number,
    public params: Params,
  ) {
    const count = Number(params.population);
    this.birds = new Float64Array(count * BIRD_STRIDE);
    this.next = new Float64Array(count * BIRD_STRIDE);
    this.order = new Int32Array(count);
    this.cellOf = new Int32Array(count);
    this.schedule = new EvolutionSchedule(seed);
    const random = rng(seed),
      center = attractor(0, seed, 1, 0),
      speed = Number(params.velocity),
      heading = random() * Math.PI * 2;
    // Start as a loose, already-aligned flock rather than random noise.
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        u = random() * 2 - 1,
        a = random() * Math.PI * 2,
        r = Math.cbrt(random()),
        s = Math.sqrt(1 - u * u);
      this.birds[at] = center[0] + 0.2 * r * s * Math.cos(a);
      this.birds[at + 1] = center[1] + 0.09 * r * s * Math.sin(a);
      this.birds[at + 2] = center[2] + 0.16 * r * u;
      const h = heading + (random() - 0.5) * 0.6;
      this.birds[at + 3] = Math.cos(h) * speed;
      this.birds[at + 4] = (random() - 0.5) * 0.5 * speed;
      this.birds[at + 5] = Math.sin(h) * speed;
    }
  }
  private cellIndex(x: number, y: number, z: number) {
    const cx = Math.min(
        DIMS[0] - 1,
        Math.max(0, Math.floor((x - MIN[0]) / CELL)),
      ),
      cy = Math.min(DIMS[1] - 1, Math.max(0, Math.floor((y - MIN[1]) / CELL))),
      cz = Math.min(DIMS[2] - 1, Math.max(0, Math.floor((z - MIN[2]) / CELL)));
    return (cz * DIMS[1] + cy) * DIMS[0] + cx;
  }
  step() {
    this.tick++;
    const variation = variationOf(this.params);
    const action = this.schedule.advance(this.tick, variation);
    if (action) this.intervene(action);
    const b = this.birds,
      n = this.next,
      count = b.length / BIRD_STRIDE,
      t = this.tick / 60,
      chapter = choreography(t, this.seed),
      speed = Number(this.params.velocity),
      cohesion = Number(this.params.cohesion),
      predator = !!this.params.predator,
      hawk = falcon(t, this.seed),
      presence = falconPresence(t, this.seed, variation),
      centers = [0, 1, 2].map((c) =>
        attractor(t, this.seed, c, chapter.split * variation),
      );
    // Counting sort of birds into grid cells.
    this.cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        cell = this.cellIndex(b[at], b[at + 1], b[at + 2]);
      this.cellOf[i] = cell;
      this.cellCount[cell]++;
    }
    this.cellStart[0] = 0;
    for (let c = 0; c < CELLS; c++)
      this.cellStart[c + 1] = this.cellStart[c] + this.cellCount[c];
    this.cellCursor.set(this.cellStart.subarray(0, CELLS));
    for (let i = 0; i < count; i++)
      this.order[this.cellCursor[this.cellOf[i]]++] = i;
    const random = rng(this.seed ^ Math.imul(this.tick, 0x9e3779b1));
    for (let i = 0; i < count; i++) {
      const at = i * BIRD_STRIDE,
        x = b[at],
        y = b[at + 1],
        z = b[at + 2];
      let vx = b[at + 3],
        vy = b[at + 4],
        vz = b[at + 5];
      // Up to NEIGHBORS birds within RADIUS: own cell first, then the rest.
      let found = 0,
        ax = 0,
        ay = 0,
        az = 0,
        cx = 0,
        cy = 0,
        cz = 0,
        sx = 0,
        sy = 0,
        sz = 0;
      const home = this.cellOf[i],
        hx = home % DIMS[0],
        hy = Math.floor(home / DIMS[0]) % DIMS[1],
        hz = Math.floor(home / (DIMS[0] * DIMS[1]));
      for (let k = 0; k < 27 && found < NEIGHBORS; k++) {
        const ox = ((k + 13) % 3) - 1,
          oy = Math.floor(((k + 13) % 9) / 3) - 1,
          oz = Math.floor(((k + 13) % 27) / 9) - 1,
          gx = hx + ox,
          gy = hy + oy,
          gz = hz + oz;
        if (
          gx < 0 ||
          gy < 0 ||
          gz < 0 ||
          gx >= DIMS[0] ||
          gy >= DIMS[1] ||
          gz >= DIMS[2]
        )
          continue;
        const cell = (gz * DIMS[1] + gy) * DIMS[0] + gx,
          start = this.cellStart[cell],
          length = this.cellStart[cell + 1] - start;
        for (
          let m = 0, scanned = 0;
          m < length && scanned < 16 && found < NEIGHBORS;
          m++
        ) {
          const j =
            this.order[start + ((m + i * 7 + (this.tick >> 4)) % length)];
          if (j === i) continue;
          scanned++;
          const bt = j * BIRD_STRIDE,
            dx = b[bt] - x,
            dy = b[bt + 1] - y,
            dz = b[bt + 2] - z,
            d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > RADIUS * RADIUS || d2 < 1e-12) continue;
          found++;
          ax += b[bt + 3];
          ay += b[bt + 4];
          az += b[bt + 5];
          cx += dx;
          cy += dy;
          cz += dz;
          if (d2 < SEPARATION * SEPARATION) {
            const push =
              ((SEPARATION - Math.sqrt(d2)) / (Math.sqrt(d2) + 1e-6)) * speed;
            sx -= dx * push;
            sy -= dy * push;
            sz -= dz * push;
          }
        }
      }
      let fx = 0,
        fy = 0,
        fz = 0;
      if (found) {
        fx +=
          (ax / found - vx) * 0.14 +
          (cx / found) * cohesion * speed * 0.06 +
          sx * 0.6;
        fy +=
          (ay / found - vy) * 0.14 +
          (cy / found) * cohesion * speed * 0.08 +
          sy * 0.6;
        fz +=
          (az / found - vz) * 0.14 +
          (cz / found) * cohesion * speed * 0.06 +
          sz * 0.6;
      }
      // Global shaping: gather toward the cohort's wandering point, roll
      // around it in vortex chapters.
      // Seek rather than pull: only birds well away from the cohort's point
      // steer toward it, so the flock travels as a whole instead of
      // contracting into a ball.
      const center = centers[i % 3],
        dx = center[0] - x,
        dy = center[1] - y,
        dz = center[2] - z,
        distance = Math.hypot(dx * 0.8, dy * 1.4, dz) || 1,
        reach = Math.min(1, Math.max(0, (distance - 0.2) / 0.25)),
        seek = (0.004 + 0.008 * chapter.gather) * variation * speed * reach;
      fx += (dx / distance) * seek;
      fy += (dy / distance) * seek;
      fz += (dz / distance) * seek;
      // Vortex chapters circle the flock around a vertical axis and roll it
      // about a horizontal one, tilting the sheet between face-on (a wide,
      // light veil) and edge-on (a dark line).
      const spin = chapter.vortex * variation * speed * 0.05,
        roll = Math.sin(t * 0.11 + (this.seed % 89)) * spin;
      fx += -dz * spin * 6;
      fz += dx * spin * 6 - dy * roll * 8;
      fy += dz * roll * 8;
      // Sky containment: never wrap, never sink into the hills. Near the
      // edge of the sky a bird turns back toward its middle, gradually and
      // individually, so the flock curves away instead of flattening
      // against an invisible wall.
      const ex = Math.max(SKY.x0 + 0.12 - x, x - (SKY.x1 - 0.12), 0),
        ey = Math.max(SKY.y0 + 0.08 - y, y - (SKY.y1 - 0.08), 0),
        ez = Math.max(SKY.z0 + 0.08 - z, z - (SKY.z1 - 0.08), 0),
        edge = Math.min(4, (ex + ey * 1.5 + ez) * 8);
      if (edge > 0) {
        const tx = 0.5 - x,
          ty = (SKY.y0 + SKY.y1) / 2 - y,
          tz = -z,
          tl = Math.hypot(tx, ty, tz) || 1;
        fx += (tx / tl) * speed * 0.035 * edge;
        fy += (ty / tl) * speed * 0.035 * edge;
        fz += (tz / tl) * speed * 0.035 * edge;
      }
      if (predator && presence > 0.02) {
        const px = x - hawk[0],
          py = y - hawk[1],
          pz = z - hawk[2],
          p2 = px * px + py * py + pz * pz;
        if (p2 < 0.018) {
          const flee = (presence * speed * 0.004) / (p2 + 0.002);
          fx += px * flee;
          fy += py * flee;
          fz += pz * flee;
        }
      }
      fx += (random() - 0.5) * speed * 0.01;
      fy += (random() - 0.5) * speed * 0.02;
      fz += (random() - 0.5) * speed * 0.01;
      // Bounded turning, speed that relaxes toward cruising speed.
      const f = Math.hypot(fx, fy, fz),
        limit = speed * 0.07;
      if (f > limit) {
        fx *= limit / f;
        fy *= limit / f;
        fz *= limit / f;
      }
      vx += fx;
      vy += fy;
      vz += fz;
      const v = Math.hypot(vx, vy, vz) || 1,
        cruise =
          speed *
          (1 + 0.12 * Math.sin(t * 0.23 + i * 0.07)) *
          (found < 3 ? 1.12 : 1),
        target = v + (cruise - v) * 0.08;
      vx *= target / v;
      vy *= target / v;
      vz *= target / v;
      n[at] = x + vx / 60;
      n[at + 1] = y + vy / 60;
      n[at + 2] = z + vz / 60;
      n[at + 3] = vx;
      n[at + 4] = vy;
      n[at + 5] = vz;
    }
    [this.birds, this.next] = [this.next, this.birds];
  }
  captureFrame(previous?: RenderFrame) {
    const frame = frameBuffer(
      previous,
      this.birds.length,
      this.tick,
      this.params,
    );
    frame.data.set(this.birds);
    return frame;
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      data: Array.from(this.birds),
      extra: { schedule: this.schedule.snapshot() },
    };
  }
  restore(s: Snapshot) {
    if (s.data.length !== this.birds.length || !s.data.every(Number.isFinite))
      throw new Error("Invalid murmuration checkpoint");
    this.tick = s.tick;
    this.birds.set(s.data);
    this.schedule.restore(s.extra?.schedule as any, this.tick);
  }
  intervene(action: EvolutionAction) {
    const b = this.birds,
      count = b.length / BIRD_STRIDE,
      random = rng(this.seed + action.serial * 997),
      speed = Number(this.params.velocity),
      share = [0, 0.08, 0.25, 1][action.kind],
      total = Math.max(1, Math.round(count * share)),
      center = attractor(this.tick / 60, this.seed, 1, 0);
    for (let k = 0; k < total; k++) {
      const at = ((k + action.serial * 131) % count) * BIRD_STRIDE;
      if (action.kind === 1) {
        // Turn a group toward the event location (a startle or a call).
        const dx = action.x - b[at],
          dy = action.y - b[at + 1],
          length = Math.hypot(dx, dy) || 1;
        b[at + 3] = (dx / length) * speed;
        b[at + 4] = (dy / length) * speed;
        b[at + 5] *= 0.5;
        continue;
      }
      // Rejoin near the flock's wandering center.
      const a = random() * Math.PI * 2;
      b[at] = center[0] + 0.15 * (random() - 0.5);
      b[at + 1] = center[1] + 0.08 * (random() - 0.5);
      b[at + 2] = center[2] + 0.15 * (random() - 0.5);
      b[at + 3] = Math.cos(a) * speed;
      b[at + 4] = 0;
      b[at + 5] = Math.sin(a) * speed;
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
      const x = Math.min(31, Math.max(0, Math.floor(b[at] * 32))),
        y = Math.min(19, Math.max(0, Math.floor(b[at + 1] * 20)));
      sample[y * 32 + x] = Math.min(1, sample[y * 32 + x] + 0.05);
    }
    return sample;
  }
  /** Canvas fallback for hosts without the native renderer. */
  paint(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#1b2a3a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10,12,20,.7)";
    const b = this.birds;
    for (let at = 0; at < b.length; at += BIRD_STRIDE)
      ctx.fillRect(b[at] * w, b[at + 1] * h, 1.5, 1.5);
  }
  dispose() {}
}
