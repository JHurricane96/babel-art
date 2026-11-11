import type { Simulation, Snapshot, Params } from "./types";
import { rng } from "./types";
export class Flock implements Simulation {
  tick = 0;
  agents: number[][] = [];
  constructor(
    public seed: number,
    public params: Params,
  ) {
    const r = rng(seed);
    this.agents = Array.from({ length: Number(params.population) }, () => [
      r(),
      r(),
      (r() - 0.5) * 0.2,
      (r() - 0.5) * 0.2,
    ]);
  }
  step() {
    this.tick++;
    const grid = new Map<string, number[]>();
    this.agents.forEach((a, i) => {
      const k = `${Math.floor(a[0] * 10)},${Math.floor(a[1] * 10)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(i);
    });
    const next = this.agents.map((a, i) => {
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
          for (const j of grid.get(`${gx + x},${gy + y}`) || []) {
            if (i === j) continue;
            const b = this.agents[j],
              dx = a[0] - b[0],
              dy = a[1] - b[1],
              d = dx * dx + dy * dy;
            if (d > 0.012 || d < 1e-9) continue;
            sx += dx / (d + 0.0001);
            sy += dy / (d + 0.0001);
            ax += b[2];
            ay += b[3];
            cx += b[0];
            cy += b[1];
            count++;
          }
      let vx = a[2],
        vy = a[3];
      if (count) {
        vx +=
          (sx * 0.001 +
            (ax / count) * 0.05 +
            (cx / count - a[0]) * Number(this.params.cohesion)) *
          0.04;
        vy +=
          (sy * 0.001 +
            (ay / count) * 0.05 +
            (cy / count - a[1]) * Number(this.params.cohesion)) *
          0.04;
      }
      const t = this.tick / 60;
      const tx = 0.5 + 0.3 * Math.sin(t * 0.08),
        ty = 0.5 + 0.3 * Math.cos(t * 0.09);
      vx += (tx - a[0]) * 0.001;
      vy += (ty - a[1]) * 0.001;
      if (this.params.predator) {
        const dx = a[0] - (0.5 + 0.3 * Math.sin(t * 0.3)),
          dy = a[1] - (0.5 + 0.3 * Math.cos(t * 0.23)),
          d = dx * dx + dy * dy;
        if (d < 0.04) {
          vx += (dx * 0.01) / (d + 0.005);
          vy += (dy * 0.01) / (d + 0.005);
        }
      }
      const ox = a[0] - 0.5,
        oy = a[1] - 0.5,
        od = ox * ox + oy * oy;
      if (od < 0.02) {
        vx += (ox * 0.005) / (od + 0.001);
        vy += (oy * 0.005) / (od + 0.001);
      }
      const norm = Math.hypot(vx, vy) || 1,
        speed = Number(this.params.velocity);
      vx = (vx / norm) * speed;
      vy = (vy / norm) * speed;
      return [(a[0] + vx / 60 + 1) % 1, (a[1] + vy / 60 + 1) % 1, vx, vy];
    });
    this.agents = next;
  }
  snapshot(): Snapshot {
    return { tick: this.tick, data: this.agents.flat() };
  }
  restore(s: Snapshot) {
    if (s.data.length % 4) throw new Error("Invalid flock checkpoint");
    this.tick = s.tick;
    this.agents = Array.from({ length: s.data.length / 4 }, (_, i) =>
      s.data.slice(i * 4, i * 4 + 4),
    );
  }
  paint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: string,
    colors?: number[][],
  ) {
    ctx.fillStyle = "#06121c";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = colors
      ? `rgb(${colors[1].map((n) => Math.round(n * 255)).join(",")})`
      : "#9de9ce";
    this.agents.forEach((a) => {
      ctx.save();
      ctx.translate(a[0] * w, a[1] * h);
      ctx.rotate(Math.atan2(a[3] * h, a[2] * w));
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -2.5);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    if (this.params.predator) {
      ctx.fillStyle = "#ef8e68";
      ctx.beginPath();
      ctx.arc(
        (0.5 + 0.3 * Math.sin((this.tick / 60) * 0.3)) * w,
        (0.5 + 0.3 * Math.cos((this.tick / 60) * 0.23)) * h,
        8,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  dispose() {}
}
export interface Platform {
  x: number;
  y: number;
  width: number;
}
export function level(seed: number): Platform[] {
  const r = rng(seed);
  let x = 0,
    y = 310;
  const result: Platform[] = [];
  for (let i = 0; i < 22; i++) {
    const width = 110 + Math.floor(r() * 60);
    result.push({ x, y, width });
    x += width + 25 + Math.floor(r() * 30);
    y = Math.max(220, Math.min(330, y + Math.floor(r() * 41) - 20));
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
    if (this.vy === 0 && next && this.x > on.x + on.width - 22) this.vy = -410;
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
        if (i > this.ground) this.coins++;
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
      ],
    };
  }
  restore(s: Snapshot) {
    if (s.data.length !== 9) throw new Error("Invalid platform checkpoint");
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
    this.platforms = level(this.seed + this.stage);
  }
  paint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: string,
    colors?: number[][],
  ) {
    const scale = h / 400,
      cam = Math.max(0, this.x - 180);
    ctx.save();
    ctx.scale(scale, scale);
    const width = w / scale;
    const pixel = style === "pixel";
    ctx.fillStyle = pixel ? "#10263c" : "#171b29";
    ctx.fillRect(0, 0, width, 400);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? "#203d54" : "#1b334b";
      const px =
        ((((i * 170 - cam * 0.2) % (width + 170)) + width + 170) %
          (width + 170)) -
        100;
      ctx.fillRect(px, 110 + (i % 3) * 25, 95, 250);
    }
    ctx.translate(-cam, 0);
    this.platforms.forEach((p, i) => {
      ctx.fillStyle = colors
        ? `rgb(${colors[1].map((n) => Math.round(n * 255)).join(",")})`
        : pixel
          ? "#729e70"
          : "#b0b3ef";
      ctx.fillRect(p.x, p.y, p.width, 10);
      ctx.fillStyle = pixel ? "#34483f" : "#3b3a56";
      ctx.fillRect(p.x, p.y + 10, p.width, 400 - p.y);
      if (i > this.ground) {
        ctx.fillStyle = colors
          ? `rgb(${colors[2].map((n) => Math.round(n * 255)).join(",")})`
          : "#e9ca79";
        ctx.beginPath();
        ctx.arc(p.x + 30, p.y - 30, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.fillStyle = this.cooldown ? "#e59887" : "#f1d09a";
    if (pixel) {
      ctx.fillRect(this.x - 7, this.y - 24, 14, 24);
      ctx.fillStyle = "#152c3e";
      ctx.fillRect(this.x + 2, this.y - 20, 3, 3);
      ctx.fillStyle = "#8dc9bb";
      ctx.fillRect(this.x - 8, this.y - 11, 16, 8);
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y - 12, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#c1dfac";
    ctx.font = "12px monospace";
    ctx.fillText(
      `WORLD ${this.stage + 1}  ◇ ${this.coins}  ↻ ${this.deaths}`,
      16,
      24,
    );
  }
  dispose() {}
}
