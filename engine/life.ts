import { rng } from "./types";
import type { Params, ScenePreset } from "./types";
export interface LifePattern {
  name: string;
  cells: [number, number][];
  width: number;
  height: number;
}
export function rle(name: string, text: string): LifePattern {
  let x = 0,
    y = 0,
    run = "";
  const cells: [number, number][] = [];
  for (const ch of text) {
    if (/\d/.test(ch)) {
      run += ch;
      continue;
    }
    const n = Number(run) || 1;
    run = "";
    if (ch === "o") {
      for (let i = 0; i < n; i++) cells.push([x + i, y]);
      x += n;
    } else if (ch === "b") x += n;
    else if (ch === "$") {
      y += n;
      x = 0;
    } else if (ch === "!") break;
  }
  return {
    name,
    cells,
    width: Math.max(...cells.map((c) => c[0])) + 1,
    height: Math.max(...cells.map((c) => c[1])) + 1,
  };
}
export const LIFE_PATTERNS = [
  rle("Glider", "bo$2bo$3o!"),
  rle("Lightweight spaceship", "bo2bo$o4b$o3bo$4o!"),
  rle("Middleweight spaceship", "3bo$bo3bo$o6b$o4bo$5o!"),
  rle("Heavyweight spaceship", "3b2o$bo4bo$o7b$o5bo$6o!"),
  rle("R-pentomino", "b2o$2ob$bo!"),
  rle("Acorn", "bo$3bo$2o2b3o!"),
  rle("Diehard", "6bo$2o$bo3b3o!"),
  rle("Pi-heptomino", "3o$obo$obo!"),
  rle("B-heptomino", "o$3o$obo!"),
  rle(
    "Gosper glider gun",
    "24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!",
  ),
  rle(
    "Pulsar",
    "2b3o3b3o2b2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b2$2b3o3b3o$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!",
  ),
  rle("Pentadecathlon", "2bo4bo$2ob4ob2o$2bo4bo!"),
];
export const LIFE_PRESETS: Record<string, ScenePreset> = {
  crosscurrents: {
    name: "Crosscurrents",
    description:
      "Traveling colonies cross, collide, and leave constellations of survivors.",
    params: {
      recipe: "crosscurrents",
      ecologyVersion: 2,
      ecology: "directed",
      rule: "life",
      autonomous: true,
      variation: 0.65,
      autoRecovery: true,
      rate: 12,
      trails: 0.92,
    },
    palette: "cobalt",
    style: "luminous",
  },
  blooms: {
    name: "Bloom fields",
    description: "Long-lived seeds unfold into overlapping cellular blooms.",
    params: {
      recipe: "blooms",
      ecologyVersion: 2,
      ecology: "directed",
      rule: "life",
      autonomous: true,
      variation: 0.8,
      autoRecovery: true,
      rate: 15,
      trails: 0.95,
    },
    palette: "orchid",
    style: "luminous",
  },
  constellations: {
    name: "Constellations",
    description:
      "Persistent cellular architecture is surrounded by migrating growth.",
    params: {
      recipe: "constellations",
      ecologyVersion: 2,
      ecology: "directed",
      rule: "life",
      autonomous: true,
      variation: 0.6,
      autoRecovery: true,
      rate: 12,
      trails: 0.94,
    },
    palette: "lagoon",
    style: "luminous",
  },
};
export const directedLife = (p: Params) =>
  Number(p.ecologyVersion) >= 2 && p.rule === "life";
export interface LifeDirectorState {
  version: number;
  next: number;
  serial: number;
  quiet: number;
  previous: number[];
  hashes: number[][];
  seeded: number[];
  changed: number[];
}
export interface LifePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}
/** CPU reference also supplies rule-agreement and accelerated ecology tests. */
export function lifeGeneration(
  cells: Uint8Array,
  w: number,
  h: number,
  out = new Uint8Array(cells.length),
) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy)
            neighbors +=
              cells[((y + dy + h) % h) * w + ((x + dx + w) % w)] > 0 ? 1 : 0;
      out[y * w + x] =
        neighbors === 3 || (cells[y * w + x] > 0 && neighbors === 2) ? 1 : 0;
    }
  return out;
}
export class LifeDirector {
  state: LifeDirectorState = {
    version: 2,
    next: 120,
    serial: 0,
    quiet: 0,
    previous: [],
    hashes: [],
    seeded: Array(12).fill(-1200),
    changed: Array(12).fill(-1800),
  };
  coverage = 0;
  constructor(public seed: number) {}
  snapshot(): LifeDirectorState {
    return structuredClone(this.state);
  }
  restore(s: LifeDirectorState | undefined) {
    this.state = s ? structuredClone(s) : new LifeDirector(this.seed).state;
  }
  renew(
    data: Uint8Array,
    w: number,
    h: number,
    tick: number,
    p: Params,
    initial = false,
  ): LifePatch[] {
    const s = this.state,
      random = rng(this.seed ^ Math.imul(s.serial + 1, 0x45d9f3b));
    const order = Array.from({ length: 12 }, (_, i) => i),
      density = Array(12).fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        density[
          Math.min(2, Math.floor((y * 3) / h)) * 4 +
            Math.min(3, Math.floor((x * 4) / w))
        ] += data[(y * w + x) * 4] > 127 ? 1 : 0;
    order.sort(
      (a, b) => s.seeded[a] + density[a] * 4 - (s.seeded[b] + density[b] * 4),
    );
    const result: LifePatch[] = [];
    let area = 0;
    for (let n = 0; n < (initial ? 12 : 4); n++) {
      const region = initial ? n : order[n],
        col = region % 4,
        row = Math.floor(region / 4);
      const pool =
        p.recipe === "blooms"
          ? [4, 5, 6, 7, 8, 5, 4, 1]
          : p.recipe === "constellations"
            ? [4, 5, 0, 1, 9, 10, 11, 7]
            : [0, 1, 2, 3, 4, 5, 7, 8];
      const id =
          pool[
            (s.serial * 3 + n + Math.floor(random() * pool.length)) %
              pool.length
          ],
        pattern = LIFE_PATTERNS[id];
      const rotate = Math.floor(random() * 4),
        mirror = random() < 0.5 ? -1 : 1;
      const points = pattern.cells.map(([x, y]) => {
        x *= mirror;
        for (let k = 0; k < rotate; k++) [x, y] = [-y, x];
        return [x, y];
      });
      const minX = Math.min(...points.map((c) => c[0])),
        minY = Math.min(...points.map((c) => c[1]));
      const width = Math.max(...points.map((c) => c[0])) - minX + 5,
        height = Math.max(...points.map((c) => c[1])) - minY + 5;
      if (!initial && area + width * height > w * h * 0.1) continue;
      const x = Math.max(
          0,
          Math.min(
            w - width,
            Math.round(((col + 0.25 + random() * 0.5) * w) / 4 - width / 2),
          ),
        ),
        y = Math.max(
          0,
          Math.min(
            h - height,
            Math.round(((row + 0.25 + random() * 0.5) * h) / 3 - height / 2),
          ),
        );
      const bytes = new Uint8Array(width * height * 4);
      for (let i = 0; i < bytes.length; i += 4) bytes[i + 3] = 255;
      for (const [px, py] of points) {
        const at = ((py - minY + 2) * width + px - minX + 2) * 4;
        bytes[at] = 255;
        bytes[at + 1] = 255;
      }
      for (let yy = 0; yy < height; yy++)
        data.set(
          bytes.subarray(yy * width * 4, (yy + 1) * width * 4),
          ((y + yy) * w + x) * 4,
        );
      result.push({ x, y, width, height, data: bytes });
      s.seeded[region] = tick;
      area += width * height;
    }
    s.serial++;
    s.quiet = 0;
    s.next =
      tick +
      Math.round(
        ((4 + random() * 4) * 60) /
          (0.5 + Math.max(0, Number(p.variation ?? 0.65))),
      );
    return result;
  }
  observe(
    data: Uint8Array,
    w: number,
    h: number,
    tick: number,
    p: Params,
  ): LifePatch[] {
    const s = this.state,
      hash = Array(12).fill(2166136261),
      diff = Array(12).fill(0),
      count = Array(12).fill(0);
    const previous =
        s.previous.length === w * h ? s.previous : Array(w * h).fill(0),
      next = new Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const at = y * w + x,
          region =
            Math.min(2, Math.floor((y * 3) / h)) * 4 +
            Math.min(3, Math.floor((x * 4) / w)),
          alive = data[at * 4] > 127 ? 1 : 0;
        hash[region] = Math.imul(hash[region] ^ alive, 16777619) >>> 0;
        diff[region] += Math.abs(alive - previous[at]);
        count[region]++;
        next[at] = alive;
      }
    for (let i = 0; i < 12; i++)
      if (diff[i] / count[i] > 0.002 && !s.hashes.some((h) => h[i] === hash[i]))
        s.changed[i] = tick;
    s.hashes.push(hash);
    if (s.hashes.length > 32) s.hashes.shift();
    s.previous = next;
    this.coverage = s.changed.filter((t) => tick - t < 1800).length;
    const nowActive = s.changed.filter((t) => tick - t < 180).length;
    s.quiet = nowActive < 4 ? s.quiet + 30 : 0;
    const enabled =
      p.ecology !== "unassisted" &&
      p.autonomous !== false &&
      Number(p.variation ?? 0.65) > 0;
    if (
      enabled &&
      (tick >= s.next || (s.quiet >= 60 && tick - Math.max(...s.seeded) >= 120))
    )
      return this.renew(data, w, h, tick, p);
    return [];
  }
}
export function initialLifeState(
  w: number,
  h: number,
  seed: number,
  p: Params,
) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  new LifeDirector(seed).renew(data, w, h, 0, p, true);
  return data;
}
export function validateLifeDirector(
  value: unknown,
  w: number,
  h: number,
): LifeDirectorState | undefined {
  if (value === undefined) return;
  const s = value as LifeDirectorState;
  const ints = (v: unknown, n: number, max: number) =>
    Array.isArray(v) &&
    v.length === n &&
    v.every((x) => Number.isInteger(x) && x >= -1800 && x <= max);
  if (
    !s ||
    s.version !== 2 ||
    ![s.next, s.serial, s.quiet].every(
      (x) => Number.isInteger(x) && x >= 0 && x < 2e10,
    ) ||
    !ints(s.seeded, 12, 2e10) ||
    !ints(s.changed, 12, 2e10) ||
    !Array.isArray(s.previous) ||
    !(
      s.previous.length === 0 ||
      (s.previous.length === w * h &&
        s.previous.every((v) => v === 0 || v === 1))
    ) ||
    !Array.isArray(s.hashes) ||
    s.hashes.length > 32 ||
    !s.hashes.every((x) => ints(x, 12, 4294967295) && x.every((v) => v >= 0))
  )
    throw new Error("Invalid Life director checkpoint");
  return structuredClone(s);
}
