import { rng } from "./types";
import type { Params, Simulation, Snapshot, ScenePreset } from "./types";
import { frameBuffer } from "./render-frame";
import type { RenderFrame } from "./render-frame";
import { generateChunk, navigation, route, validChunk } from "./terrarium-gen";
import type { WorldChunk, Travel } from "./terrarium-gen";
export const WORLD_PRESETS: Record<string, ScenePreset> = {
  canopy: {
    name: "Canopy settlements",
    description:
      "Pollination, gathering, and bridge building among tree villages.",
    params: { biome: 0, population: 72 },
    palette: "moss",
    style: "pixel",
  },
  caverns: {
    name: "Fungal caverns",
    description:
      "Spore gardens, miners, and luminous shelters under an ancient canopy.",
    params: { biome: 1, population: 72 },
    palette: "orchid",
    style: "pixel",
  },
  aqueduct: {
    name: "Rusted aqueducts",
    description:
      "Cargo lifts and waterwheels link a busy community of salvagers.",
    params: { biome: 2, population: 72 },
    palette: "cobalt",
    style: "pixel",
  },
  tidal: {
    name: "Tidal ruins",
    description:
      "Ferries, tidal gardens, and discoveries in a changing wetland.",
    params: { biome: 3, population: 72 },
    palette: "lagoon",
    style: "pixel",
  },
};
export const ACTOR_STRIDE = 12,
  RESOURCE_STRIDE = 4;
export interface Actor {
  id: number;
  role: number;
  variant: number;
  x: number;
  y: number;
  node: number;
  path: number[];
  progress: number;
  segmentX: number;
  segmentY: number;
  action: number;
  state: number;
  carry: number;
  targetChunk: number;
  target: number;
  goal: number;
  serial: number;
  age: number;
  hunger: number;
  energy: number;
  direction: number;
  wait: number;
}
export interface ChunkState {
  index: number;
  plants: number[];
  structures: number[];
}
export interface Camera {
  x: number;
  from: number;
  to: number;
  start: number;
  duration: number;
  dwell: number;
  serial: number;
}
export interface WorldStats {
  pollinations: number;
  meals: number;
  seeds: number;
  deliveries: number;
  repairs: number;
  discoveries: number;
  pursuits: number;
  arrivals: number;
  events: number;
}
export interface WorldSave {
  version: 1;
  chunks: ChunkState[];
  actors: Actor[];
  camera: Camera;
  stats: WorldStats;
  weather: number;
  eventTick: number;
}
const emptyStats = (): WorldStats => ({
  pollinations: 0,
  meals: 0,
  seeds: 0,
  deliveries: 0,
  repairs: 0,
  discoveries: 0,
  pursuits: 0,
  arrivals: 0,
  events: 0,
});
export class TerrariumWorld implements Simulation {
  tick = 0;
  historyBudgetBytes = 24 * 1024 * 1024;
  chunks: WorldChunk[] = [];
  chunkStates = new Map<number, ChunkState>();
  graph = navigation([]);
  actors: Actor[] = [];
  camera: Camera = {
    x: 0,
    from: 0,
    to: 0,
    start: 0,
    duration: 0,
    dwell: 1200,
    serial: 0,
  };
  stats = emptyStats();
  weather = 0;
  eventTick = 1200;
  private plansThisTick = 0;
  constructor(
    public seed: number,
    public params: Params,
  ) {
    this.stream();
    for (let i = 0; i < Number(params.population ?? 72); i++)
      this.actors.push(this.spawn(i));
    for (const a of this.actors) this.chooseGoal(a);
  }
  private freshState(c: WorldChunk): ChunkState {
    const random = rng(c.seed);
    return {
      index: c.index,
      plants: c.plants.flatMap(() => [
        0.35 + random() * 0.65,
        0.5 + random() * 0.5,
        0,
        0,
      ]),
      structures: c.structures.flatMap(() => [
        0.25 + random() * 0.65,
        1 + random() * 2,
        0,
      ]),
    };
  }
  private stream() {
    const base = Math.floor(this.camera.x / 320),
      indices = Array.from({ length: 9 }, (_, i) => base - 3 + i);
    if (this.chunks[0]?.index === indices[0]) return;
    const old = new Map(this.chunks.map((c) => [c.index, c]));
    this.chunks = indices.map((index) => {
      let chunk = old.get(index);
      if (!chunk) {
        chunk = generateChunk(
          this.seed,
          index,
          Number(this.params.biome ?? 0) - (this.seed % 4),
        );
        if (!validChunk(chunk)) chunk = generateChunk(0, index, 0);
      }
      if (!this.chunkStates.has(index))
        this.chunkStates.set(index, this.freshState(chunk));
      return chunk;
    });
    for (const i of this.chunkStates.keys())
      if (!indices.includes(i)) this.chunkStates.delete(i);
    this.graph = navigation(this.chunks);
  }
  private spawn(id: number, previous?: Actor): Actor {
    const serial = (previous?.serial ?? 0) + 1,
      random = rng(
        this.seed ^ Math.imul(id + 1, 997) ^ Math.imul(serial, 7919),
      );
    const ratio = id / Number(this.params.population ?? 72),
      role =
        ratio < 6 / 72
          ? 0
          : ratio < 14 / 72
            ? 1
            : ratio < 22 / 72
              ? 2
              : ratio < 44 / 72
                ? 3
                : ratio < 68 / 72
                  ? 4
                  : 5;
    const chunk = Math.floor(this.camera.x / 320) + Math.floor(random() * 4),
      blueprint = this.chunks.find((c) => c.index === chunk) ?? this.chunks[3],
      node = blueprint.nodes[Math.floor(random() * 9)];
    return {
      id,
      role,
      variant: Math.floor(random() * 4),
      x: node.x,
      y: node.y,
      node: node.id,
      path: [],
      progress: 0,
      segmentX: node.x,
      segmentY: node.y,
      action: 0,
      state: 0,
      carry: 0,
      targetChunk: chunk,
      target: 0,
      goal: 0,
      serial,
      age: 0,
      hunger: random(),
      energy: 0.6 + random() * 0.4,
      direction: random() < 0.5 ? -1 : 1,
      wait: 0,
    };
  }
  private open = (gate: number) => {
    const chunk = Math.floor(gate / 3),
      s = this.chunkStates.get(chunk);
    return !s || s.structures[0] > 0.6;
  };
  private chooseGoal(a: Actor) {
    if (this.tick > 0 && this.plansThisTick >= 4) {
      a.path = [];
      a.progress = 0;
      a.goal = 0;
      a.targetChunk = Math.floor(a.node / 9);
      a.target = 0;
      a.state = 0;
      a.wait = 1;
      return;
    }
    this.plansThisTick++;
    const random = rng(
      this.seed ^ Math.imul(a.id + 1, 7919) ^ Math.imul(++a.serial, 997),
    );
    if (a.energy < 0.18) {
      a.state = 9;
      a.wait = 180;
      a.energy = 0.8;
      return;
    }
    const hungry = a.role < 3 && a.hunger > 0.85;
    const candidates: {
      chunk: WorldChunk;
      index: number;
      node: number;
      score: number;
    }[] = [];
    const structure =
      !hungry &&
      (a.role === 0 || a.role === 2 || (a.role === 1 && a.carry > 0));
    for (const c of this.chunks) {
      if (Math.abs(c.index * 320 - a.x) > 1100) continue;
      const s = this.chunkStates.get(c.index)!;
      const items = structure ? c.structures : c.plants;
      for (let i = 0; i < items.length; i++) {
        if (!structure) {
          if (hungry && (i < 5 || i >= 10)) continue;
          if (!hungry && a.role === 1 && i < 10) continue;
          if (a.role === 3 && i >= 10) continue;
          if (a.role === 4 && i >= 5) continue;
        }
        const site = items[i],
          distance = Math.hypot(site.x - a.x, site.y - a.y),
          repeat = c.index === a.targetChunk && i === a.target ? 400 : 0;
        let benefit = 0;
        if (structure)
          benefit =
            a.role === 0
              ? (1 - s.structures[i * 3 + 2]) * 170
              : a.role === 2
                ? (1 - s.structures[i * 3]) * 250 + s.structures[i * 3 + 1] * 35
                : (3 - s.structures[i * 3 + 1]) * 90;
        else
          benefit =
            (a.role === 3 && a.carry ? 1 - s.plants[i * 4] : s.plants[i * 4]) *
            160;
        candidates.push({
          chunk: c,
          index: i,
          node: site.node,
          score: benefit - distance * 0.35 - repeat + random() * 120,
        });
      }
    }
    if (a.role === 5) {
      const prey = this.actors.filter(
        (b) => b.role === 3 && Math.abs(b.x - a.x) < 600,
      );
      if (prey.length) {
        const target = prey[Math.floor(random() * prey.length)];
        a.target = target.id;
        a.goal = 5;
        a.targetChunk = Math.floor(target.x / 320);
        a.path = route(this.graph, a.node, target.node, this.open);
        a.progress = 0;
        a.state = 1;
        a.wait = 0;
        return;
      }
    }
    candidates.sort((x, y) => y.score - x.score);
    let selected = candidates[0];
    for (const c of candidates.slice(0, 8)) {
      const path = route(this.graph, a.node, c.node, this.open);
      if (path.length || c.node === a.node || a.role === 4) {
        selected = c;
        a.path = path;
        break;
      }
    }
    if (!selected) {
      a.wait = 60;
      return;
    }
    a.targetChunk = selected.chunk.index;
    a.target = selected.index;
    a.goal = structure ? 1 : 0;
    a.path = route(this.graph, a.node, selected.node, this.open);
    a.progress = 0;
    a.wait = 0;
    a.state = a.role === 4 ? 6 : 1;
  }
  private targetPosition(a: Actor) {
    if (a.goal === 5) return this.actors.find((b) => b.id === a.target);
    const chunk = this.chunks.find((c) => c.index === a.targetChunk);
    return (a.goal === 1 ? chunk?.structures : chunk?.plants)?.[a.target];
  }
  private complete(a: Actor) {
    const s = this.chunkStates.get(a.targetChunk);
    if (a.goal === 5) {
      this.stats.pursuits++;
      a.energy = 0.2;
      a.state = 9;
      a.wait = 120;
      return;
    }
    if (!s) {
      this.chooseGoal(a);
      return;
    }
    if (a.goal === 1) {
      const at = a.target * 3;
      if (a.role === 0) {
        s.structures[at + 2] = 1;
        this.stats.discoveries++;
        a.state = 4;
        a.wait = 120;
      } else if (a.role === 1) {
        s.structures[at + 1] = Math.min(5, s.structures[at + 1] + 1);
        a.carry = 0;
        this.stats.deliveries++;
        a.state = 4;
        a.wait = 45;
      } else if (a.role === 2) {
        if (s.structures[at + 1] > 0.05) {
          s.structures[at] = Math.min(1, s.structures[at] + 0.28);
          s.structures[at + 1] = Math.max(0, s.structures[at + 1] - 0.25);
          this.stats.repairs++;
        }
        a.state = 4;
        a.wait = 150;
      }
    } else {
      const at = a.target * 4;
      if (a.role < 3 && a.hunger > 0.85) {
        if (s.plants[at] > 0.1) {
          s.plants[at] = Math.max(0, s.plants[at] - 0.2);
          a.hunger = 0;
          this.stats.meals++;
        }
        a.state = 5;
        a.wait = 90;
      } else if (a.role === 4) {
        s.plants[at + 1] = Math.max(0, s.plants[at + 1] - 0.15);
        s.plants[at + 2] = 1;
        s.plants[at + 3] = this.tick;
        const fruit = 5 + (a.target % 5);
        s.plants[fruit * 4] = Math.min(1, s.plants[fruit * 4] + 0.1);
        this.stats.pollinations++;
        a.carry = 1;
        a.state = 5;
        a.wait = 35;
      } else if (a.role === 3) {
        if (a.carry) {
          s.plants[at] = Math.min(1, s.plants[at] + 0.35);
          a.carry = 0;
          this.stats.seeds++;
        } else if (s.plants[at] > 0.2) {
          s.plants[at] = Math.max(0.05, s.plants[at] - 0.4);
          a.carry = 1;
          a.hunger = 0;
          this.stats.meals++;
        }
        a.state = 5;
        a.wait = 100;
      } else {
        if (s.plants[at] > 0.2) {
          s.plants[at] = Math.max(0.05, s.plants[at] - 0.4);
          a.carry = 1;
        }
        a.state = 4;
        a.wait = 60;
      }
    }
    a.action = this.tick;
    a.energy = Math.min(1, a.energy + 0.2);
  }
  private move(a: Actor) {
    const target = this.targetPosition(a);
    if (!target) {
      this.chooseGoal(a);
      return;
    }
    if (a.role === 4) {
      const dx = target.x - a.x,
        dy = target.y - 18 - a.y,
        len = Math.hypot(dx, dy),
        speed = 42 + a.variant * 4;
      a.direction = dx < 0 ? -1 : 1;
      if (len < 3) {
        a.node = (target as any).node ?? a.node;
        this.complete(a);
      } else {
        a.x += ((dx / len) * speed) / 60;
        a.y += ((dy / len) * speed) / 60;
      }
      return;
    }
    if (!a.path.length) {
      const dx = target.x - a.x;
      if (Math.abs(dx) > 3) {
        a.direction = Math.sign(dx);
        a.x += Math.sign(dx) * 0.7;
      } else this.complete(a);
      return;
    }
    const from = this.graph.nodes.get(a.node),
      to = this.graph.nodes.get(a.path[0]);
    if (!from || !to) {
      a.wait = 30;
      a.path = [];
      this.chooseGoal(a);
      return;
    }
    const edge = this.graph.edges.get(from.id)?.find((e) => e.to === to.id),
      kind: Travel = edge?.kind ?? "walk";
    if (edge?.gate !== undefined && !this.open(edge.gate)) {
      a.path = route(this.graph, a.node, to.id, this.open);
      if (!a.path.length) this.chooseGoal(a);
      return;
    }
    if (
      (kind === "lift" || kind === "ferry") &&
      a.progress === 0 &&
      (this.tick + Math.abs(from.id) * 13) % 300 > 85
    ) {
      a.state = 8;
      return;
    }
    const fleeing =
      a.role === 3 &&
      this.actors.some(
        (b) => b.role === 5 && Math.hypot(b.x - a.x, b.y - a.y) < 85,
      );
    a.state = fleeing ? 7 : kind === "jump" ? 2 : kind === "climb" ? 3 : 1;
    if (a.progress === 0) {
      a.segmentX = a.x;
      a.segmentY = a.y;
    }
    const speed =
        (a.role === 5 ? 55 : a.role === 3 ? 35 : 43) *
        (fleeing ? 1.8 : 1) *
        (kind === "climb" ? 0.7 : 1),
      distance = Math.hypot(to.x - a.segmentX, to.y - a.segmentY);
    a.progress = Math.min(1, a.progress + speed / (Math.max(1, distance) * 60));
    a.direction = to.x >= from.x ? 1 : -1;
    a.x = a.segmentX + (to.x - a.segmentX) * a.progress;
    a.y =
      a.segmentY +
      (to.y - a.segmentY) * a.progress -
      (kind === "jump" ? Math.sin(a.progress * Math.PI) * 45 : 0);
    if (a.progress >= 1) {
      a.node = to.id;
      a.path.shift();
      a.progress = 0;
    }
  }
  step() {
    this.plansThisTick = 0;
    this.tick++;
    const c = this.camera;
    if (c.duration > 0) {
      const u = Math.min(1, (this.tick - c.start) / c.duration),
        blend = u * u * (3 - 2 * u);
      c.x = c.from + (c.to - c.from) * blend;
      if (u === 1) {
        c.duration = 0;
        c.dwell =
          this.tick + 900 + Math.floor(rng(this.seed + c.serial)() * 900);
      }
    } else if (this.tick >= c.dwell) {
      const random = rng(this.seed + ++c.serial * 997),
        base = Math.floor(c.x / 320);
      const candidates = this.chunks
        .filter((chunk) => chunk.index >= base + 2 && chunk.index <= base + 4)
        .map((chunk) => {
          const state = this.chunkStates.get(chunk.index)!;
          const activity = this.actors.filter(
            (a) =>
              Math.abs(a.x - (chunk.index * 320 + 160)) < 200 &&
              (a.state === 4 || a.state === 5 || a.role === 0),
          ).length;
          const renewal = state.structures.reduce(
            (n, v, i) => n + (i % 3 === 0 ? 1 - v : 0),
            0,
          );
          return {
            x: chunk.nodes[4].x - 480,
            score:
              activity * 2 +
              renewal * 3 +
              random() * 2 -
              (chunk.index - base - 2) * 1.5,
          };
        })
        .sort((a, b) => b.score - a.score);
      c.from = c.x;
      c.to = Math.max(
        c.x + 220,
        Math.min(
          c.x + 380,
          (candidates[0]?.x ?? c.x + 320) + (random() - 0.5) * 40,
        ),
      );
      c.start = this.tick;
      c.duration = 720 + Math.floor(random() * 480);
    }
    this.stream();
    for (let i = 0; i < this.actors.length; i++) {
      let a = this.actors[i];
      a.age++;
      a.hunger = Math.min(1, a.hunger + 0.00005);
      a.energy = Math.max(0, a.energy - 0.000015);
      if (
        !this.graph.nodes.has(a.node) ||
        (a.age > 12000 + a.variant * 2400 &&
          (a.x < c.x - 40 || a.x > c.x + 1000))
      ) {
        a = this.spawn(a.id, a);
        this.actors[i] = a;
        this.stats.arrivals++;
        this.chooseGoal(a);
      }
      if (
        !this.chunkStates.has(a.targetChunk) ||
        a.path.some((n) => !this.graph.nodes.has(n))
      )
        this.chooseGoal(a);
      if (a.wait > 0) {
        a.wait--;
        if (a.wait === 0) this.chooseGoal(a);
        continue;
      }
      if (
        (this.tick + a.id) % 12 === 0 &&
        (!this.targetPosition(a) ||
          (this.tick - a.action > 1800 && a.path.length === 0))
      )
        this.chooseGoal(a);
      this.move(a);
    }
    if (this.tick % 60 === 0) {
      const rain =
        this.weather === 1
          ? 1
          : 0.2 + 0.2 * Math.sin((this.tick / 60) * 0.027 + this.seed);
      for (const s of this.chunkStates.values()) {
        for (let i = 0; i < 20; i++) {
          const at = i * 4;
          s.plants[at] = Math.min(
            1,
            s.plants[at] + 0.004 + rain * 0.006 + s.plants[at + 2] * 0.01,
          );
          s.plants[at + 1] = Math.min(1, s.plants[at + 1] + 0.025);
          s.plants[at + 2] *= 0.95;
        }
        for (let i = 0; i < 3; i++)
          s.structures[i * 3] = Math.max(0.1, s.structures[i * 3] - 0.0006);
      }
    }
    if (this.tick >= this.eventTick) {
      const random = rng(this.seed ^ Math.imul(this.stats.events + 1, 65537)),
        visible = Math.floor(c.x / 320) + Math.floor(random() * 3),
        s = this.chunkStates.get(visible)!;
      this.stats.events++;
      this.weather = this.stats.events % 4;
      if (this.weather === 0) s.structures[0] = 0.25;
      if (this.weather === 1) for (let i = 0; i < 10; i++) s.plants[i * 4] = 1;
      if (this.weather === 2)
        for (const a of this.actors)
          if (a.role === 4 && Math.abs(a.x - c.x) < 1100) this.chooseGoal(a);
      if (this.weather === 3) s.structures[2] = 0;
      this.eventTick = this.tick + 1080 + Math.floor(random() * 720);
    }
  }
  snapshot(): Snapshot {
    return {
      tick: this.tick,
      data: [this.camera.x],
      extra: {
        world: {
          version: 1,
          chunks: [...this.chunkStates.values()].map((s) => structuredClone(s)),
          actors: structuredClone(this.actors),
          camera: { ...this.camera },
          stats: { ...this.stats },
          weather: this.weather,
          eventTick: this.eventTick,
        } satisfies WorldSave,
      },
    };
  }
  restore(s: Snapshot) {
    const world = s.extra?.world as WorldSave;
    this.tick = s.tick;
    this.camera = { ...world.camera };
    this.stats = { ...world.stats };
    this.weather = world.weather;
    this.eventTick = world.eventTick;
    this.chunkStates = new Map(
      world.chunks.map((c) => [c.index, structuredClone(c)]),
    );
    this.chunks = [];
    this.stream();
    this.actors = structuredClone(world.actors);
  }
  captureFrame(previous?: RenderFrame) {
    const f = frameBuffer(
      previous,
      this.actors.length * ACTOR_STRIDE + 9 * (20 * 4 + 3 * 3),
      this.tick,
      this.params,
    );
    let n = 0;
    for (const a of this.actors) {
      f.data.set(
        [
          a.x,
          a.y,
          a.role,
          a.variant,
          a.state,
          a.carry,
          a.direction,
          a.action,
          a.wait,
          a.id,
          a.hunger,
          a.energy,
        ],
        n,
      );
      n += ACTOR_STRIDE;
    }
    for (const c of this.chunks) {
      const s = this.chunkStates.get(c.index)!;
      f.data.set(s.plants, n);
      n += 80;
      f.data.set(s.structures, n);
      n += 9;
    }
    f.extra = {
      chunks: this.chunks,
      // Full precision: the renderer draws at whole pixels and the compositor
      // applies the fraction, so slow pans glide instead of stepping.
      camera: this.camera.x,
      population: this.actors.length,
      weather: this.weather,
      stats: { ...this.stats },
    };
    return f;
  }
  dispose() {}
}
export function validateWorldSave(
  value: unknown,
  tick: number,
  population: number,
): WorldSave {
  const w = value as WorldSave,
    finite = (x: unknown, min = -1e9, max = 1e9) =>
      typeof x === "number" && Number.isFinite(x) && x >= min && x <= max,
    integer = (x: unknown, min = -1e9, max = 1e9) =>
      finite(x, min, max) && Number.isInteger(x);
  if (
    !w ||
    w.version !== 1 ||
    !Array.isArray(w.chunks) ||
    w.chunks.length !== 9 ||
    !Array.isArray(w.actors) ||
    w.actors.length !== population ||
    !w.camera ||
    !w.stats ||
    !integer(w.eventTick, tick, 2e10) ||
    !integer(w.weather, 0, 3)
  )
    throw new Error("Invalid terrarium world checkpoint");
  if (
    !["x", "from", "to", "start", "duration", "dwell", "serial"].every((k) =>
      finite((w.camera as any)[k], 0, 2e10),
    ) ||
    w.camera.duration > 1200 ||
    w.camera.start > tick ||
    w.camera.dwell > tick + 1800 ||
    w.camera.to - w.camera.from > 400 ||
    w.camera.to < w.camera.from ||
    w.camera.x < w.camera.from ||
    w.camera.x > w.camera.to
  )
    throw new Error("Invalid world camera");
  const base = Math.floor(w.camera.x / 320) - 3;
  for (let i = 0; i < 9; i++) {
    const s = w.chunks[i];
    if (
      s.index !== base + i ||
      !Array.isArray(s.plants) ||
      s.plants.length !== 80 ||
      !s.plants.every((v, j) => finite(v, 0, j % 4 === 3 ? tick : 1)) ||
      !Array.isArray(s.structures) ||
      s.structures.length !== 9 ||
      !s.structures.every((v, j) => finite(v, 0, j % 3 === 1 ? 5 : 1))
    )
      throw new Error("Invalid world chunk state");
  }
  if (
    !Object.keys(emptyStats()).every((k) =>
      integer((w.stats as any)[k], 0, 2e10),
    )
  )
    throw new Error("Invalid world statistics");
  for (let i = 0; i < w.actors.length; i++) {
    const a = w.actors[i];
    if (
      a.id !== i ||
      !integer(a.role, 0, 5) ||
      !integer(a.variant, 0, 3) ||
      !integer(a.state, 0, 9) ||
      !integer(a.carry, 0, 1) ||
      !finite(a.x) ||
      !finite(a.y, -1000, 1200) ||
      !integer(a.node, base * 9, (base + 9) * 9 - 1) ||
      !Array.isArray(a.path) ||
      a.path.length > 32 ||
      !a.path.every((n) => integer(n, base * 9, (base + 9) * 9 - 1)) ||
      !finite(a.progress, 0, 1) ||
      !finite(a.segmentX) ||
      !finite(a.segmentY) ||
      !integer(a.wait, 0, 200) ||
      !integer(a.action, 0, tick) ||
      !integer(a.age, 0, 2e10) ||
      !integer(a.serial, 0, 2e10) ||
      !finite(a.hunger, 0, 1) ||
      !finite(a.energy, 0, 1) ||
      ![-1, 1].includes(a.direction) ||
      ![0, 1, 5].includes(a.goal) ||
      !integer(a.targetChunk, base, base + 8) ||
      !integer(
        a.target,
        0,
        a.goal === 5 ? population - 1 : a.goal === 1 ? 2 : 19,
      )
    )
      throw new Error("Invalid world actor");
  }
  return structuredClone(w);
}
