// Particles and creatures for the viewer: things that move over the land.
//
// Spores drift up from glowing fungi, embers rise off lava, spray bursts where
// waterfalls land, snow falls over snowfields and leaves from trees; birds
// cross the sky, fish swim (and now and then jump) in lakes, bats leave cave
// mouths, fireflies blink over meadows. All of it is drawn as points, some at
// half an art pixel (finer than the land, like the vision's screen-resolution
// sparks and spray).
//
// This is the lab's look-and-feel test, so it uses Math.random; the engine's
// own creatures will be deterministic.
import { noise1 } from "../../../engine/strata/world.ts";
import type { Emitters } from "./tile.ts";

export const wind = (x: number, t: number) =>
  0.55 * Math.sin(t * 1.1 + x * 0.013) + 0.45 * (noise1(x / 160 - t * 0.4, 3) * 2 - 1);

const enum K {
  Spore,
  Ember,
  Spray,
  Snow,
  Leaf,
  /** A water drop: hangs from a cave ceiling, swells, then falls. */
  Drip,
}
interface Particle {
  k: K;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  floor: number;
}
interface Firefly {
  x: number;
  y: number;
  hx: number;
  hy: number;
  phase: number;
  vx: number;
  vy: number;
}
interface Bird {
  x: number;
  y: number;
  vx: number;
  phase: number;
}
interface Fish {
  x: number;
  y: number;
  vx: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  jump: number;
  vy: number;
}
interface Bat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  phase: number;
}

export interface View {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MAX_POINTS = 24000;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Life {
  buf = new Float32Array(MAX_POINTS * 7);
  count = 0;
  private parts: Particle[] = [];
  private fireflies: Firefly[] = [];
  private birds: Bird[] = [];
  private nextFlock = 3;
  private fish: Fish[] = [];
  private bats: Bat[] = [];

  /** Forget everything (a new world, or a jump far away). */
  reset() {
    this.parts = [];
    this.fireflies = [];
    this.birds = [];
    this.fish = [];
    this.bats = [];
  }

  update(dt: number, t: number, v: View, sources: Emitters[], ground: (x: number) => number) {
    dt = Math.min(dt, 0.1);
    const pad = 40,
      inView = (x: number, y: number) => x > v.left - pad && x < v.right + pad && y > v.top - pad && y < v.bottom + pad;
    // Spawn particles from emitters near the view.
    const spawn = (list: Float32Array, rate: number, make: (x: number, y: number) => void) => {
      for (let i = 0; i < list.length; i += 2) {
        const x = list[i],
          y = list[i + 1];
        if (inView(x, y) && Math.random() < rate * dt) make(x, y);
      }
    };
    let meadow = 0;
    const waters: number[][] = [];
    for (const e of sources) {
      if (this.parts.length > 6000) break;
      spawn(e.spores, 0.2, (x, y) =>
        this.parts.push({ k: K.Spore, x: x + rnd(-1, 1), y, vx: 0, vy: rnd(-2.5, -1), age: 0, life: rnd(8, 14), floor: 1e9 }),
      );
      for (let i = 0; i < e.drips.length; i += 3) {
        const x = e.drips[i],
          y = e.drips[i + 1];
        // vx holds how long the drop hangs before it falls.
        if (inView(x, y) && Math.random() < 0.06 * dt)
          this.parts.push({ k: K.Drip, x, y, vx: rnd(1, 2.5), vy: 0, age: 0, life: 20, floor: e.drips[i + 2] });
      }
      spawn(e.embers, 0.25, (x, y) =>
        this.parts.push({ k: K.Ember, x: x + rnd(-1, 1), y, vx: rnd(-1, 1), vy: rnd(-9, -4), age: 0, life: rnd(1, 2.5), floor: 1e9 }),
      );
      spawn(e.spray, 4, (x, y) =>
        this.parts.push({ k: K.Spray, x: x + rnd(-2, 2), y, vx: rnd(-8, 8), vy: rnd(-10, -3), age: 0, life: rnd(0.5, 1), floor: 1e9 }),
      );
      for (let i = 0; i < e.snow.length; i += 2) {
        const x = e.snow[i],
          gy = e.snow[i + 1];
        if (x < v.left - pad || x > v.right + pad || gy < v.top) continue;
        if (Math.random() < 0.15 * dt) {
          const y = Math.max(v.top - 2, gy - 260);
          this.parts.push({ k: K.Snow, x: x + rnd(-1.5, 1.5), y, vx: 0, vy: rnd(4, 8), age: 0, life: 60, floor: gy });
        }
      }
      spawn(e.leaves, 0.01, (x, y) =>
        this.parts.push({ k: K.Leaf, x, y, vx: 0, vy: rnd(3, 6), age: 0, life: 8, floor: ground(x) }),
      );
      for (let i = 0; i < e.meadows.length; i += 2) if (inView(e.meadows[i], e.meadows[i + 1])) meadow++;
      for (let i = 0; i < e.waters.length; i += 4) {
        const w = [e.waters[i], e.waters[i + 1], e.waters[i + 2], e.waters[i + 3]];
        if (w[1] > v.left - pad && w[0] < v.right + pad && w[2] > v.top - pad && w[2] < v.bottom + pad) waters.push(w);
      }
      // Bats leave cave mouths now and then.
      spawn(e.mouths, 0.015, (x, y) => {
        if (this.bats.length < 30)
          for (let n = 0; n < 1 + Math.floor(Math.random() * 3); n++)
            this.bats.push({ x, y, vx: rnd(-6, 6), vy: rnd(-8, -2), age: 0, phase: rnd(0, 6) });
      });
    }
    // Fireflies over meadows: keep a few near the view.
    const wantFlies = Math.min(40, Math.floor(meadow / 8));
    this.fireflies = this.fireflies.filter((f) => inView(f.x, f.y));
    for (const e of sources)
      for (let i = 0; i < e.meadows.length && this.fireflies.length < wantFlies; i += 2) {
        const x = e.meadows[i],
          y = e.meadows[i + 1];
        if (inView(x, y) && Math.random() < 0.02)
          this.fireflies.push({ x, y: y - rnd(3, 20), hx: x, hy: y, phase: rnd(0, 6.3), vx: 0, vy: 0 });
      }
    // Fish in the open water near the view.
    this.fish = this.fish.filter((f) => inView(f.x, f.y));
    for (const w of waters) {
      const have = this.fish.filter((f) => f.x0 === w[0]).length,
        want = Math.max(1, Math.min(6, Math.floor((w[1] - w[0]) / 40)));
      if (have < want && w[3] > 6)
        this.fish.push({
          x: rnd(w[0] + 3, w[1] - 3),
          y: rnd(w[2] + 3, w[2] + w[3] - 3),
          vx: rnd(3, 8) * (Math.random() < 0.5 ? -1 : 1),
          x0: w[0],
          x1: w[1],
          top: w[2],
          bottom: w[2] + w[3],
          jump: 0,
          vy: 0,
        });
    }
    // Birds: a flock crosses the sky every so often.
    this.nextFlock -= dt;
    if (this.nextFlock <= 0 && this.birds.length === 0) {
      this.nextFlock = rnd(8, 20);
      const dir = Math.random() < 0.5 ? 1 : -1,
        n = 3 + Math.floor(Math.random() * 6),
        cx = dir > 0 ? v.left - 20 : v.right + 20,
        lowest = Math.min(ground(v.left), ground((v.left + v.right) / 2), ground(v.right)),
        cy = Math.max(v.top + 15, Math.min(lowest - 60, v.top + (v.bottom - v.top) * rnd(0.1, 0.35))),
        speed = rnd(18, 30) * dir;
      for (let k = 0; k < n; k++)
        this.birds.push({ x: cx - dir * k * 5, y: cy + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3, vx: speed, phase: rnd(0, 6) });
    }

    // Move everything.
    this.parts = this.parts.filter((p) => {
      p.age += dt;
      const w = wind(p.x, t);
      if (p.k === K.Spore) {
        p.x += (Math.sin(t * 1.3 + p.y * 0.2) * 0.8 + w * 0.6) * dt;
        p.y += p.vy * dt;
      } else if (p.k === K.Ember) {
        p.x += (p.vx + w * 1.5) * dt;
        p.y += p.vy * dt;
      } else if (p.k === K.Spray) {
        p.vy += 30 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.k === K.Drip) {
        if (p.age > p.vx) {
          p.vy += 70 * dt;
          p.y += p.vy * dt;
          if (p.y >= p.floor - 0.5) {
            // A tiny splash where it lands.
            for (let k = 0; k < 3; k++)
              this.parts.push({ k: K.Spray, x: p.x, y: p.floor - 1, vx: rnd(-5, 5), vy: rnd(-9, -4), age: 0, life: rnd(0.25, 0.45), floor: 1e9 });
            return false;
          }
        }
      } else if (p.k === K.Snow) {
        p.x += (w * 3 + Math.sin(t * 2 + p.y * 0.1) * 0.6) * dt;
        p.y += p.vy * dt;
        if (p.y >= p.floor) return false;
      } else {
        p.x += (w * 4 + Math.sin(t * 3 + p.age * 2) * 3) * dt;
        p.y += p.vy * dt;
        if (p.y >= p.floor) return false;
      }
      return p.age < p.life && inView(p.x, p.y);
    });
    for (const f of this.fireflies) {
      f.vx += rnd(-12, 12) * dt;
      f.vy += rnd(-12, 12) * dt;
      f.vx += (f.hx - f.x) * 0.2 * dt;
      f.vy += (f.hy - 10 - f.y) * 0.3 * dt;
      f.vx *= 0.96;
      f.vy *= 0.96;
      f.x += f.vx * dt;
      f.y = Math.min(f.hy - 2, f.y + f.vy * dt);
    }
    this.birds = this.birds.filter((b) => {
      b.x += b.vx * dt;
      b.y += Math.sin(t * 0.7 + b.phase) * 2 * dt;
      return b.x > v.left - 60 && b.x < v.right + 60;
    });
    for (const f of this.fish) {
      if (f.jump > 0) {
        // A leap out of the water and back.
        f.vy += 40 * dt;
        f.y += f.vy * dt;
        f.x += f.vx * dt;
        if (f.y >= f.top + 1 && f.vy > 0) {
          f.jump = 0;
          f.y = f.top + 3;
          for (let k = 0; k < 8; k++)
            this.parts.push({ k: K.Spray, x: f.x, y: f.top, vx: rnd(-6, 6), vy: rnd(-8, -2), age: 0, life: rnd(0.4, 0.8), floor: 1e9 });
        }
        continue;
      }
      f.x += f.vx * dt;
      f.y += Math.sin(t + f.x * 0.1) * 0.5 * dt;
      f.y = Math.max(f.top + 2, Math.min(f.bottom - 2, f.y));
      if (f.x < f.x0 + 2 || f.x > f.x1 - 2 || Math.random() < 0.05 * dt) f.vx = -f.vx;
      if (Math.random() < 0.015 * dt) {
        f.jump = 1;
        f.vy = -rnd(14, 22);
        f.y = f.top;
      }
    }
    this.bats = this.bats.filter((b) => {
      b.age += dt;
      b.vx += rnd(-40, 40) * dt;
      b.vy += rnd(-40, 30) * dt - (b.age < 3 ? 6 * dt : 0);
      b.vx = Math.max(-14, Math.min(14, b.vx));
      b.vy = Math.max(-12, Math.min(10, b.vy));
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      return b.age < 14 && inView(b.x, b.y);
    });

    // Write points: x, y, size, r, g, b, a.
    let n = 0;
    const put = (x: number, y: number, size: number, r: number, g: number, b: number, a: number) => {
      if (n >= MAX_POINTS) return;
      const o = n * 7;
      this.buf[o] = x;
      this.buf[o + 1] = y;
      this.buf[o + 2] = size;
      this.buf[o + 3] = r;
      this.buf[o + 4] = g;
      this.buf[o + 5] = b;
      this.buf[o + 6] = a;
      n++;
    };
    for (const p of this.parts) {
      const fade = Math.min(1, p.age * 2, (p.life - p.age) * 2);
      if (p.k === K.Spore) put(p.x, p.y, 0.5, 0.55, 1, 0.92, 0.95 * fade);
      else if (p.k === K.Drip) {
        // Swelling on the ceiling, then a drop with a short streak as it falls.
        const hang = p.age < p.vx;
        put(p.x, p.y, 0.5, 0.75, 0.9, 1, hang ? 0.35 + 0.5 * (p.age / p.vx) : 0.9);
        if (!hang && p.vy > 25) put(p.x, p.y - 0.5, 0.5, 0.75, 0.9, 1, 0.4);
      }
      else if (p.k === K.Ember) put(p.x, p.y, 0.5, 1, 0.55 + 0.3 * fade, 0.25, fade);
      else if (p.k === K.Spray) put(p.x, p.y, 0.5, 0.9, 0.96, 1, 0.75 * fade);
      else if (p.k === K.Snow) put(p.x, p.y, 0.5, 0.96, 0.97, 1, 0.9);
      else put(p.x, p.y, 1, 0.3, 0.38, 0.2, fade);
    }
    for (const f of this.fireflies) {
      const glow = Math.max(0, Math.sin(t * 1.7 + f.phase)) ** 3;
      if (glow > 0.05) put(f.x, f.y, 0.5, 0.85, 1, 0.45, glow);
    }
    for (const b of this.birds) {
      // Five pixels wide, wings through three frames: up (v), level, down (^).
      const f = Math.floor(((t * 7 + b.phase) % 3 + 3) % 3),
        tip = f === 0 ? -1 : f === 1 ? 0 : 1,
        mid = f === 0 ? -0.5 : f === 1 ? 0 : 0.5;
      put(b.x, b.y, 1, 0.1, 0.08, 0.13, 1);
      put(b.x - 1, b.y + Math.round(mid), 1, 0.1, 0.08, 0.13, 1);
      put(b.x + 1, b.y + Math.round(mid), 1, 0.1, 0.08, 0.13, 1);
      put(b.x - 2, b.y + tip, 1, 0.1, 0.08, 0.13, 1);
      put(b.x + 2, b.y + tip, 1, 0.1, 0.08, 0.13, 1);
    }
    for (const f of this.fish) {
      const out = f.jump > 0,
        a = out ? 1 : 0.55,
        dir = f.vx > 0 ? 1 : -1;
      put(f.x, f.y, 1, 0.78, 0.82, 0.84, a);
      put(f.x - dir, f.y, 1, 0.62, 0.68, 0.72, a);
    }
    for (const b of this.bats) {
      const up = Math.sin(t * 14 + b.phase) > 0;
      put(b.x, b.y, 1, 0.07, 0.05, 0.09, 1);
      put(b.x - 1, b.y - (up ? 1 : 0), 0.5, 0.07, 0.05, 0.09, 1);
      put(b.x + 1, b.y - (up ? 1 : 0), 0.5, 0.07, 0.05, 0.09, 1);
    }
    this.count = n;
  }
}
