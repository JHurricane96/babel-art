import { rng } from "./types";
import type { EntitySimulation, Params, Snapshot, ScenePreset } from "./types";
import type { EvolutionAction } from "./evolution";
import { variationOf } from "./evolution";
import { ink } from "./art";

export const SLIME_WIDTH = 192,
  SLIME_HEIGHT = 120;
export const SLIME_CELLS = SLIME_WIDTH * SLIME_HEIGHT;
const TAU = Math.PI * 2;
export const SLIME_PRESETS: Record<string, ScenePreset> = {
  mycelium: {
    name: "Mycelium",
    description: "Fine green threads weave between drifting nutrient pools.",
    params: {
      recipe: "mycelium",
      population: 2400,
      branching: 0.65,
      persistence: 0.968,
    },
    palette: "lagoon",
    style: "luminous",
  },
  copper: {
    name: "Copper delta",
    description:
      "Warm braided channels and engraved junctions over deep indigo.",
    params: {
      recipe: "copper",
      population: 3000,
      branching: 0.3,
      persistence: 0.978,
    },
    palette: "cobalt",
    style: "etched",
  },
  bloom: {
    name: "Night bloom",
    description:
      "Dense violet filaments gather and bloom around changing resources.",
    params: {
      recipe: "bloom",
      population: 3600,
      branching: 0.9,
      persistence: 0.958,
    },
    palette: "orchid",
    style: "luminous",
  },
};

export function slimeResources(tick: number, seed: number, variation: number) {
  const t = (tick / 60) * variation,
    phase = ((seed % 997) / 997) * TAU;
  return Array.from({ length: 5 }, (_, i) => ({
    x: 0.5 + 0.36 * Math.sin(t * (0.021 + i * 0.003) + phase + i * 2.4),
    y: 0.5 + 0.34 * Math.cos(t * (0.027 + i * 0.002) - phase + i * 1.8),
    power: 0.55 + 0.45 * Math.sin(t * 0.043 + i * 1.7) ** 2,
  }));
}

// CPU sensor/deposit feedback, with a bounded scalar trail and fixed agents.
// Every state that affects future physics is represented in the checkpoint.
export class SlimeNetworks implements EntitySimulation {
  tick = 0;
  historyBudgetBytes = 32 * 1024 * 1024;
  trail = new Float32Array(SLIME_CELLS);
  scratch = new Float32Array(SLIME_CELLS);
  nutrients = new Float32Array(SLIME_CELLS);
  agents: Float64Array;
  nutrientTick = -1;
  nutrientVariation = -1;
  surface?: HTMLCanvasElement;
  pixels?: ImageData;
  constructor(
    public seed: number,
    public params: Params,
  ) {
    this.agents = new Float64Array(Number(params.population) * 3);
    this.seedAgents(rng(seed), 1);
    // Start with an established weave instead of waiting through a blank intro.
    for (let i = 0; i < 120; i++) this.step();
    this.tick = 0;
    this.nutrientTick = -1;
  }
  private seedAgents(random: () => number, fraction: number, offset = 0) {
    const count = this.agents.length / 3;
    for (let n = 0; n < Math.ceil(count * fraction); n++) {
      const at = ((n + offset) % count) * 3;
      this.agents[at] = random();
      this.agents[at + 1] = random();
      this.agents[at + 2] = random() * TAU;
    }
  }
  private updateNutrients() {
    const tick = Math.floor(this.tick / 30) * 30,
      variation = variationOf(this.params);
    if (tick === this.nutrientTick && variation === this.nutrientVariation)
      return;
    this.nutrientTick = tick;
    this.nutrientVariation = variation;
    const sources = slimeResources(tick, this.seed, variation);
    for (let y = 0; y < SLIME_HEIGHT; y++)
      for (let x = 0; x < SLIME_WIDTH; x++) {
        let value = 0;
        for (const s of sources) {
          const dx = x / SLIME_WIDTH - s.x,
            dy = y / SLIME_HEIGHT - s.y;
          value += Math.exp(-(dx * dx + dy * dy) * 75) * s.power;
        }
        this.nutrients[y * SLIME_WIDTH + x] = value * 0.34;
      }
  }
  private sense(x: number, y: number, angle: number, distance: number) {
    const sx =
      ((Math.floor(x * SLIME_WIDTH + Math.cos(angle) * distance) %
        SLIME_WIDTH) +
        SLIME_WIDTH) %
      SLIME_WIDTH;
    const sy =
      ((Math.floor(y * SLIME_HEIGHT + Math.sin(angle) * distance) %
        SLIME_HEIGHT) +
        SLIME_HEIGHT) %
      SLIME_HEIGHT;
    const at = sy * SLIME_WIDTH + sx;
    return this.trail[at] + this.nutrients[at];
  }
  step() {
    this.tick++;
    this.updateNutrients();
    const random = rng(this.seed ^ Math.imul(this.tick, 997));
    const branch = Number(this.params.branching),
      recipe = this.params.recipe;
    const distance = recipe === "copper" ? 8 : recipe === "bloom" ? 4 : 6;
    const sensor = 0.38 + branch * 0.85,
      turn = 0.16 + branch * 0.48;
    const speed = recipe === "copper" ? 1.15 : recipe === "bloom" ? 0.8 : 1;
    for (let i = 0; i < this.agents.length; i += 3) {
      const x = this.agents[i],
        y = this.agents[i + 1];
      let angle = this.agents[i + 2];
      const front = this.sense(x, y, angle, distance),
        left = this.sense(x, y, angle - sensor, distance),
        right = this.sense(x, y, angle + sensor, distance),
        noise = random() - 0.5;
      if (front < Math.max(left, right)) {
        if (front < left && front < right) angle += noise * turn * 2;
        else if (left > right) angle -= turn;
        else if (right > left) angle += turn;
      }
      angle = (angle + noise * 0.1 + TAU) % TAU;
      const nx = (x + (Math.cos(angle) * speed) / SLIME_WIDTH + 1) % 1;
      const ny = (y + (Math.sin(angle) * speed) / SLIME_HEIGHT + 1) % 1;
      this.agents[i] = nx;
      this.agents[i + 1] = ny;
      this.agents[i + 2] = angle;
      const at =
        Math.floor(ny * SLIME_HEIGHT) * SLIME_WIDTH +
        Math.floor(nx * SLIME_WIDTH);
      this.trail[at] = Math.min(1, this.trail[at] + 0.13);
    }
    if (this.tick % 2 === 0) {
      const decay = Number(this.params.persistence);
      for (let y = 0; y < SLIME_HEIGHT; y++) {
        const up = ((y + SLIME_HEIGHT - 1) % SLIME_HEIGHT) * SLIME_WIDTH;
        const down = ((y + 1) % SLIME_HEIGHT) * SLIME_WIDTH;
        for (let x = 0; x < SLIME_WIDTH; x++) {
          const at = y * SLIME_WIDTH + x;
          const mean =
            (this.trail[up + x] +
              this.trail[down + x] +
              this.trail[
                y * SLIME_WIDTH + ((x + SLIME_WIDTH - 1) % SLIME_WIDTH)
              ] +
              this.trail[y * SLIME_WIDTH + ((x + 1) % SLIME_WIDTH)]) *
            0.25;
          this.scratch[at] = (this.trail[at] * 0.78 + mean * 0.22) * decay;
        }
      }
      [this.trail, this.scratch] = [this.scratch, this.trail];
    }
    const emission = Math.ceil(this.agents.length / 3 / 1200);
    this.seedAgents(
      random,
      emission / (this.agents.length / 3),
      this.tick * emission,
    );
  }
  snapshot(): Snapshot {
    return { tick: this.tick, data: [...this.trail, ...this.agents] };
  }
  restore(snapshot: Snapshot) {
    if (snapshot.data.length !== SLIME_CELLS + this.agents.length)
      throw new Error("Invalid network checkpoint");
    this.tick = snapshot.tick;
    this.trail.set(snapshot.data.slice(0, SLIME_CELLS));
    this.agents.set(snapshot.data.slice(SLIME_CELLS));
  }
  activitySample() {
    const sample = new Float32Array(640);
    if (
      !this.agents.every(Number.isFinite) ||
      !this.trail.every(Number.isFinite)
    ) {
      sample[0] = NaN;
      return sample;
    }
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 32; x++)
        sample[y * 32 + x] =
          this.trail[
            Math.floor(((y + 0.5) / 20) * SLIME_HEIGHT) * SLIME_WIDTH +
              Math.floor(((x + 0.5) / 32) * SLIME_WIDTH)
          ];
    return sample;
  }
  intervene(action: EvolutionAction) {
    const random = rng(this.seed ^ action.serial);
    this.seedAgents(random, [0, 0.12, 0.35, 1][action.kind], action.serial);
    if (action.kind === 3) this.trail.fill(0);
    else {
      const radius = action.kind === 1 ? 0.12 : 0.26;
      for (let y = 0; y < SLIME_HEIGHT; y++)
        for (let x = 0; x < SLIME_WIDTH; x++)
          if (
            Math.hypot(
              x / SLIME_WIDTH - action.x,
              y / SLIME_HEIGHT - action.y,
            ) < radius
          )
            this.trail[y * SLIME_WIDTH + x] *= 0.5;
    }
  }
  paint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: string,
    colors = [
      [0.02, 0.1, 0.2],
      [0.08, 0.8, 0.7],
      [1, 0.87, 0.65],
    ],
  ) {
    if (!this.surface) {
      this.surface = document.createElement("canvas");
      this.surface.width = SLIME_WIDTH;
      this.surface.height = SLIME_HEIGHT;
      this.pixels = this.surface
        .getContext("2d", { willReadFrequently: true })!
        .createImageData(SLIME_WIDTH, SLIME_HEIGHT);
    }
    const data = this.pixels!.data,
      detail = Number(this.params.richness ?? 0.8);
    for (let y = 0; y < SLIME_HEIGHT; y++)
      for (let x = 0; x < SLIME_WIDTH; x++) {
        const at = y * SLIME_WIDTH + x,
          v = this.trail[at];
        const body = 1 - Math.exp(-v * 2.1);
        const junction = Math.max(0, Math.min(1, (v - 0.48) * 1.7));
        const grain =
          ((Math.imul(x + 1, 374761393) ^
            Math.imul(y + this.seed, 668265263)) >>>
            0) /
            4294967295 -
          0.5;
        const fine =
          1 + detail * (0.09 * grain + 0.08 * Math.sin(v * 65 + y * 0.13));
        const mineral = 0.5 + 0.5 * Math.sin(x * 0.033 + Math.sin(y * 0.047));
        const warm =
          style === "etched"
            ? 0.4 + junction * 0.25 + mineral * 0.2
            : 0.08 + junction * 0.45 + mineral * 0.15;
        for (let c = 0; c < 3; c++) {
          const pigment = colors[1][c] + (colors[2][c] - colors[1][c]) * warm;
          data[at * 4 + c] = Math.min(
            255,
            (colors[0][c] * (0.12 + detail * 0.05 * grain) +
              pigment * body * fine +
              junction ** 6 * 0.045) *
              255,
          );
        }
        data[at * 4 + 3] = 255;
      }
    this.surface.getContext("2d")!.putImageData(this.pixels!, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.surface, 0, 0, w, h);
    // Directional marks follow the actual agents, supplying fine filaments
    // inside the broader concentration field rather than flickering noise.
    ctx.lineCap = "round";
    if (detail > 0)
      for (let group = 0; group < 4; group++) {
        ctx.beginPath();
        for (let i = group * 3; i < this.agents.length; i += 12) {
          const x = this.agents[i] * w,
            y = this.agents[i + 1] * h;
          const dx = Math.cos(this.agents[i + 2]) * 2.5,
            dy = Math.sin(this.agents[i + 2]) * 2.5;
          ctx.moveTo(x - dx, y - dy);
          ctx.lineTo(x + dx, y + dy);
        }
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = ink(colors[0], colors[1], 0.25, detail * 0.5);
        ctx.stroke();
        ctx.lineWidth = 0.4;
        ctx.strokeStyle = ink(colors[1], colors[2], group / 4, detail * 0.7);
        ctx.stroke();
      }
    ctx.fillStyle = ink(colors[2], [1, 1, 1], 0.2, 0.3 + detail * 0.35);
    for (let i = 0; i < this.agents.length; i += 45) {
      ctx.beginPath();
      ctx.arc(
        this.agents[i] * w,
        this.agents[i + 1] * h,
        0.45 + detail * 0.35,
        0,
        TAU,
      );
      ctx.fill();
    }
  }
  dispose() {
    this.surface = undefined;
    this.pixels = undefined;
  }
}
