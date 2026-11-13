import { frameBuffer } from "./render-frame";
import type { RenderFrame } from "./render-frame";
import { paintTerrarium, paintMurmuration } from "./world-art";
import { EvolutionSchedule, variationOf } from "./evolution";
import { choreography } from "./choreography";
import type { EvolutionAction } from "./evolution";
import type { Simulation, Snapshot, Params } from "./types";
import { rng } from "./types";
export class Flock implements Simulation {
  tick = 0;
  agents: number[][] = [];
  schedule: EvolutionSchedule;
  binCounts = new Int32Array(100);
  binOffsets = new Int32Array(101);
  binCursor = new Int32Array(100);
  binAgents: Int32Array;
  nextAgents: number[][];
  constructor(
    public seed: number,
    public params: Params,
  ) {
    this.schedule = new EvolutionSchedule(seed);
    const r = rng(seed);
    this.binAgents = new Int32Array(Number(params.population));
    this.nextAgents = Array.from({ length: Number(params.population) }, () => [
      0, 0, 0, 0,
    ]);
    this.agents = Array.from({ length: Number(params.population) }, () => [
      r(),
      r(),
      (r() - 0.5) * 0.2,
      (r() - 0.5) * 0.2,
    ]);
  }
  step() {
    this.tick++;
    const action = this.schedule.advance(this.tick, variationOf(this.params));
    if (action) this.intervene(action);
    this.binCounts.fill(0);
    for (const a of this.agents)
      this.binCounts[Math.floor(a[1] * 10) * 10 + Math.floor(a[0] * 10)]++;
    this.binOffsets[0] = 0;
    for (let i = 0; i < 100; i++)
      this.binOffsets[i + 1] = this.binOffsets[i] + this.binCounts[i];
    this.binCursor.set(this.binOffsets.subarray(0, 100));
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i],
        cell = Math.floor(a[1] * 10) * 10 + Math.floor(a[0] * 10);
      this.binAgents[this.binCursor[cell]++] = i;
    }
    const t = this.tick / 60,
      variation = variationOf(this.params),
      chapter = choreography(t, this.seed);
    const next = this.nextAgents;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      let sx = 0,
        sy = 0,
        ax = 0,
        ay = 0,
        cx = 0,
        cy = 0,
        count = 0;
      const gx = Math.floor(a[0] * 10),
        gy = Math.floor(a[1] * 10);
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++)
          for (
            let k = 0,
              cell = ((gy + y + 10) % 10) * 10 + ((gx + x + 10) % 10),
              length = this.binCounts[cell],
              limit = Math.min(12, length);
            k < limit;
            k++
          ) {
            const j =
              this.binAgents[
                this.binOffsets[cell] +
                  ((k + i * 7 + Math.floor(this.tick / 12)) % length)
              ];
            if (i === j) continue;
            const b = this.agents[j],
              dx = ((a[0] - b[0] + 1.5) % 1) - 0.5,
              dy = ((a[1] - b[1] + 1.5) % 1) - 0.5,
              d = dx * dx + dy * dy;
            if (d > 0.012 || d < 1e-9) continue;
            if (d < 0.0008) {
              sx += dx / (d + 0.0001);
              sy += dy / (d + 0.0001);
            }
            ax += b[2];
            ay += b[3];
            cx += a[0] - dx;
            cy += a[1] - dy;
            count++;
          }
      let vx = a[2],
        vy = a[3];
      if (count) {
        vx +=
          sx * 0.00001 +
          (ax / count - a[2]) * 0.07 +
          (cx / count - a[0]) * Number(this.params.cohesion) * 0.12;
        vy +=
          sy * 0.00001 +
          (ay / count - a[3]) * 0.07 +
          (cy / count - a[1]) * Number(this.params.cohesion) * 0.12;
      }

      // Slowly exchange gathering, split-stream and vortex influences.

      const split = variation * chapter.split;
      const vortex = variation * chapter.vortex;
      const phase = t * 0.057 + this.seed * 0.001;
      const cohort = i % 3;
      const centerX = 0.5 + 0.18 * Math.sin(phase + cohort * split * 2.1);
      const centerY =
        0.43 + 0.17 * Math.cos(phase * 0.79 + cohort * split * 2.1);
      const dx = a[0] - centerX,
        dy = (a[1] - centerY) * 1.3;
      const radius = Math.hypot(dx, dy) || 0.01;
      const desiredRadius =
        0.12 + 0.09 * (0.5 + 0.5 * Math.sin(t * 0.031 + cohort));
      const radial = (radius - desiredRadius) * vortex;
      vx +=
        ((centerX - a[0]) * chapter.gather -
          dy * vortex -
          (dx / radius) * radial +
          Math.cos(phase + cohort) * split * 0.16) *
        0.035 *
        variation;
      vy +=
        ((centerY - a[1]) * chapter.gather +
          dx * vortex -
          (dy / radius) * radial +
          Math.sin(phase * 0.8 + cohort) * split * 0.12) *
        0.035 *
        variation;
      // A small circulating wind varies locally without overwhelming neighbors.
      vx += Math.sin(a[1] * 9 + t * 0.17) * variation * 0.0005;
      vy += Math.cos(a[0] * 8 - t * 0.13) * variation * 0.0005;
      const presence =
        variation > 0
          ? Math.pow(0.5 + 0.5 * Math.sin(t * 0.083 + this.seed * 0.001), 2)
          : 1;
      if (this.params.predator) {
        const dx = a[0] - (0.5 + 0.3 * Math.sin(t * 0.3)),
          dy = a[1] - (0.5 + 0.3 * Math.cos(t * 0.23)),
          d = dx * dx + dy * dy;
        if (d < 0.04) {
          vx += (dx * 0.01 * presence) / (d + 0.005);
          vy += (dy * 0.01 * presence) / (d + 0.005);
        }
      }
      const desired = Math.atan2(vy, vx),
        previous = Math.atan2(a[3], a[2]);
      const turn = Math.atan2(
        Math.sin(desired - previous),
        Math.cos(desired - previous),
      );
      const heading = previous + Math.max(-0.075, Math.min(0.075, turn));
      const speed =
        Number(this.params.velocity) *
        (1 + variation * 0.16 * Math.sin(t * 0.23 + i * 0.07)) *
        (1 - Math.min(0.18, count * 0.003));
      vx = Math.cos(heading) * speed;
      vy = Math.sin(heading) * speed;
      const n = next[i];
      n[0] = (a[0] + vx / 60 + 1) % 1;
      n[1] = (a[1] + vy / 60 + 1) % 1;
      n[2] = vx;
      n[3] = vy;
    }
    this.nextAgents = this.agents;
    this.agents = next;
  }
  captureFrame(previous?: RenderFrame) {
    const frame = frameBuffer(
      previous,
      this.agents.length * 4,
      this.tick,
      this.params,
    );
    for (let i = 0; i < this.agents.length; i++)
      frame.data.set(this.agents[i], i * 4);
    return frame;
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      data: this.agents.flat(),
      extra: { schedule: this.schedule.snapshot() },
    };
  }
  restore(s: Snapshot) {
    if (s.data.length % 4) throw new Error("Invalid flock checkpoint");
    this.tick = s.tick;
    this.schedule.restore(s.extra?.schedule as any, this.tick);
    if (this.nextAgents.length !== s.data.length / 4) {
      this.nextAgents = Array.from({ length: s.data.length / 4 }, () => [
        0, 0, 0, 0,
      ]);
      this.binAgents = new Int32Array(s.data.length / 4);
    }
    this.agents = Array.from({ length: s.data.length / 4 }, (_, i) =>
      s.data.slice(i * 4, i * 4 + 4),
    );
  }
  intervene(action: EvolutionAction) {
    const random = rng(this.seed + action.serial * 997),
      count = Math.max(
        1,
        Math.round(this.agents.length * [0, 0.08, 0.25, 1][action.kind]),
      );
    for (let i = 0; i < count; i++) {
      const at = (i + action.serial) % this.agents.length,
        angle = random() * Math.PI * 2;
      if (action.kind === 1) {
        const a = this.agents[at],
          dx = action.x - a[0],
          dy = action.y - a[1],
          length = Math.hypot(dx, dy) || 1;
        a[2] = (dx / length) * Number(this.params.velocity);
        a[3] = (dy / length) * Number(this.params.velocity);
        continue;
      }
      this.agents[at] = [
        (action.x + 0.15 * Math.cos(angle) + 1) % 1,
        (action.y + 0.15 * Math.sin(angle) + 1) % 1,
        Math.cos(angle) * Number(this.params.velocity),
        Math.sin(angle) * Number(this.params.velocity),
      ];
    }
  }
  activitySample() {
    const sample = new Float32Array(640);
    for (const a of this.agents) {
      if (!a.every(Number.isFinite)) {
        sample[0] = NaN;
        return sample;
      }
      const i =
        Math.min(19, Math.floor(a[1] * 20)) * 32 +
        Math.min(31, Math.floor(a[0] * 32));
      sample[i] = Math.min(1, sample[i] + 0.25);
    }
    return sample;
  }
  paint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: string,
    colors?: number[][],
  ) {
    paintMurmuration(this, ctx, w, h, style, colors);
  }
  dispose() {}
}
export interface Platform {
  x: number;
  y: number;
  width: number;
}
export function level(seed: number, legacy = false): Platform[] {
  const r = rng(seed);
  let x = 0,
    y = 310;
  const result: Platform[] = [];
  for (let i = 0; i < 22; i++) {
    const width = legacy
      ? 110 + Math.floor(r() * 60)
      : 95 + Math.floor(r() * 90);
    result.push({ x, y, width });
    x += width + 25 + Math.floor(r() * (legacy ? 30 : 50));
    y = legacy
      ? Math.max(220, Math.min(330, y + Math.floor(r() * 41) - 20))
      : Math.max(180, Math.min(330, y + Math.floor(r() * 111) - 55));
  }
  return result;
}
export class Platformer implements Simulation {
  tick = 0;
  stage = 0;
  platforms: Platform[];
  x = 35;
  y = 310;
  vx = 105;
  vy = 0;
  ground = 0;
  deaths = 0;
  coins = 0;
  cooldown = 0;
  visited = 0;
  terrainVersion = 1;
  constructor(
    public seed: number,
    public params: Params,
  ) {
    this.platforms = level(seed);
    this.y = this.platforms[0].y;
  }
  step() {
    this.tick++;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    const oldY = this.y,
      oldX = this.x;
    const on = this.platforms[this.ground],
      next = this.platforms[this.ground + 1];
    if (
      this.vy === 0 &&
      this.ground % 4 === 2 &&
      !(this.visited & (1 << this.ground)) &&
      this.x >= on.x + on.width * 0.65 - 6
    ) {
      this.visited |= 1 << this.ground;
      this.cooldown = 24;
      return;
    }
    if (this.vy === 0 && next && this.x > on.x + on.width - 30) {
      const rise = Math.max(0, on.y - next.y);
      this.vy = -Math.sqrt(2 * 1000 * (70 + rise));
      const flight =
        (-this.vy + Math.sqrt(this.vy * this.vy + 2000 * (next.y - on.y))) /
        1000;
      this.vx = Math.max(60, Math.min(190, (next.x + 32 - this.x) / flight));
    }
    this.x += this.vx / 60;
    this.vy += 1000 / 60;
    this.y += this.vy / 60;
    for (let i = Math.max(0, this.ground - 1); i < this.platforms.length; i++) {
      const p = this.platforms[i];
      if (
        this.x + 8 > p.x &&
        this.x - 8 < p.x + p.width &&
        oldY <= p.y &&
        this.y >= p.y &&
        this.vy > 0
      ) {
        this.y = p.y;
        this.vy = 0;
        if (i > this.ground) {
          this.coins++;
        }
        this.vx = 105;
        this.ground = i;
        break;
      }
    }
    if (this.y > 470) {
      this.deaths++;
      this.cooldown = 45;
      this.x = this.platforms[this.ground].x + 25;
      this.y = this.platforms[this.ground].y;
      this.vy = 0;
    }
    const last = this.platforms.at(-1)!;
    if (this.x > last.x + last.width - 25) {
      this.stage++;
      this.terrainVersion = 1;
      this.visited = 0;
      this.platforms = level(this.seed + this.stage);
      this.x = 25;
      this.ground = 0;
      this.y = this.platforms[0].y;
      this.vy = 0;
      this.cooldown = 60;
    }
    if (this.x === oldX && this.cooldown === 0) this.x += 1;
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      data: [
        this.x,
        this.y,
        this.vx,
        this.vy,
        this.ground,
        this.stage,
        this.deaths,
        this.coins,
        this.cooldown,
        this.visited,
        this.terrainVersion,
      ],
    };
  }
  restore(s: Snapshot) {
    if (![9, 10, 11].includes(s.data.length))
      throw new Error("Invalid platform checkpoint");
    this.tick = s.tick;
    [
      this.x,
      this.y,
      this.vx,
      this.vy,
      this.ground,
      this.stage,
      this.deaths,
      this.coins,
      this.cooldown,
    ] = s.data;
    this.visited = s.data[9] ?? (1 << (this.ground + 1)) - 1;
    this.terrainVersion = s.data[10] ?? (s.data.length === 9 ? 0 : 1);
    this.platforms = level(this.seed + this.stage, this.terrainVersion === 0);
  }
  paint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: string,
    colors?: number[][],
  ) {
    paintTerrarium(this, ctx, w, h, style, colors);
  }
  dispose() {}
}
