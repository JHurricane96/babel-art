import type { EntitySimulation, Params, Snapshot } from "./types";
import type { EvolutionAction } from "./evolution";
import { rng } from "./types";
import { variationOf } from "./evolution";
import { choreography } from "./choreography";
import { ground, ink } from "./art";

// Six stored trail points per particle. No accumulating canvas history: any
// frame can be reconstructed exactly from its checkpoint, including scanout.
export const PARTICLE_STRIDE = 14;
export class ParticleRivers implements EntitySimulation {
  tick = 0;
  points: Float64Array;
  constructor(
    public seed: number,
    public params: Params,
  ) {
    this.points = new Float64Array(Number(params.population) * PARTICLE_STRIDE);
    const random = rng(seed);
    for (let i = 0; i < this.points.length; i += PARTICLE_STRIDE)
      this.place(i, random(), random());
  }
  private place(at: number, x: number, y: number) {
    for (let j = 0; j < PARTICLE_STRIDE; j += 2) {
      this.points[at + j] = x;
      this.points[at + j + 1] = y;
    }
  }
  step() {
    this.tick++;
    const t = this.tick / 60,
      phase = (this.seed % 997) * 0.0063,
      variation = variationOf(this.params),
      chapter = choreography(t, this.seed),
      speed = Number(this.params.velocity),
      scale = Number(this.params.turbulence),
      cx = 0.5 + 0.2 * Math.sin(t * 0.037 + phase),
      cy = 0.5 + 0.16 * Math.cos(t * 0.029 + phase);
    for (let i = 0; i < this.points.length; i += PARTICLE_STRIDE) {
      const x = this.points[i],
        y = this.points[i + 1];
      if (this.tick % 6 === 0)
        for (let j = PARTICLE_STRIDE - 1; j >= 2; j--)
          this.points[i + j] = this.points[i + j - 2];
      // A smooth flow field plus a through-current avoids an absorbing rest state.
      const qx = x * scale * 5 + phase,
        qy = y * scale * 5 - phase,
        drift = t * 0.045 * variation;
      let vx =
          0.6 +
          Math.cos(qy + Math.sin(qx * 0.7 + drift)) +
          0.45 * Math.cos(qx * 1.7 - qy * 1.3 + drift * 1.7),
        vy =
          0.7 * Math.sin(qx - Math.cos(qy * 0.8 - drift)) +
          0.35 * Math.sin(qx * 1.3 + qy * 1.7 - drift);
      const dx = x - cx,
        dy = y - cy,
        spin =
          (variation * (0.25 + chapter.vortex)) / (0.06 + dx * dx + dy * dy);
      vx -= dy * spin;
      vy += dx * spin;
      vy += variation * chapter.split * 1.1 * Math.sin(x * 9 + drift);
      const length = Math.hypot(vx, vy) || 1;
      const breathing = 0.8 + 0.2 * Math.sin(i * 0.07 + t * 0.13);
      const nx = x + ((vx / length) * speed * breathing) / 60,
        ny = y + ((vy / length) * speed * breathing) / 60;
      if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1)
        this.place(i, (nx + 1) % 1, (ny + 1) % 1);
      else {
        this.points[i] = nx;
        this.points[i + 1] = ny;
      }
    }
    // A steady source recirculates particles throughout the field instead of
    // allowing all the ink to collect on the same few attracting orbits.
    const count = this.points.length / PARTICLE_STRIDE;
    const emission = Math.ceil(count / 720);
    const random = rng(this.seed ^ Math.imul(this.tick, 997));
    for (let i = 0; i < emission; i++)
      this.place(
        ((this.tick * emission + i) % count) * PARTICLE_STRIDE,
        random(),
        random(),
      );
  }
  snapshot(): Snapshot {
    return { tick: this.tick, data: Array.from(this.points) };
  }
  restore(snapshot: Snapshot) {
    if (snapshot.data.length !== this.points.length)
      throw new Error("Invalid particle checkpoint");
    this.tick = snapshot.tick;
    this.points.set(snapshot.data);
  }
  activitySample() {
    const sample = new Float32Array(640);
    for (let i = 0; i < this.points.length; i += PARTICLE_STRIDE) {
      const x = this.points[i],
        y = this.points[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        sample[0] = NaN;
        break;
      }
      const at =
        Math.min(19, Math.floor(y * 20)) * 32 +
        Math.min(31, Math.floor(x * 32));
      sample[at] = Math.min(1, sample[at] + 0.12);
    }
    return sample;
  }
  intervene(action: EvolutionAction) {
    const random = rng(this.seed ^ action.serial);
    const count = Math.round(
      (this.points.length / PARTICLE_STRIDE) * [0, 0.08, 0.3, 1][action.kind],
    );
    for (let i = 0; i < count; i++) {
      const at =
        ((i + action.serial) % (this.points.length / PARTICLE_STRIDE)) *
        PARTICLE_STRIDE;
      this.place(at, random(), random());
    }
  }
  paint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: string,
    colors = [
      [0.025, 0.12, 0.22],
      [0.06, 0.8, 0.7],
      [1, 0.87, 0.65],
    ],
  ) {
    ground(ctx, w, h, colors);
    const detail = Number(this.params.richness ?? 0.8);
    ctx.lineCap = "round";
    // Colored underpainting, fine filaments, and small bright heads use
    // different widths and values so the composition reads at three scales.
    for (let group = 0; group < 6; group++) {
      const warm = group / 5;
      ctx.beginPath();
      for (
        let i = group * PARTICLE_STRIDE;
        i < this.points.length;
        i += 6 * PARTICLE_STRIDE
      ) {
        ctx.moveTo(this.points[i] * w, this.points[i + 1] * h);
        for (let j = 2; j < PARTICLE_STRIDE; j += 2)
          ctx.lineTo(this.points[i + j] * w, this.points[i + j + 1] * h);
      }
      ctx.strokeStyle = ink(colors[1], colors[2], warm, 0.08 + detail * 0.08);
      ctx.lineWidth = 3.5 + detail * 3;
      ctx.stroke();
      ctx.strokeStyle = ink(colors[1], colors[2], warm, 0.36 + detail * 0.36);
      ctx.lineWidth = 0.55 + warm * 0.7;
      ctx.stroke();
    }
    ctx.fillStyle = ink(colors[2], [1, 1, 1], 0.25, 0.8);
    for (let i = 0; i < this.points.length; i += PARTICLE_STRIDE * 7) {
      ctx.beginPath();
      ctx.arc(
        this.points[i] * w,
        this.points[i + 1] * h,
        0.65 + detail * 0.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  dispose() {}
}
