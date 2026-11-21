// Strata's world grid: shared constants, materials, and deterministic noise.
//
// One cell is one art pixel (480 per panel width). The world is endless
// sideways and WORLD_H cells tall, built in regions REGION_W cells wide that
// are generated from (seed, region index) alone. Everything here uses only
// integer hashing and +, -, *, / on doubles, never Math.sin or Math.random, so
// a region generates identically on every machine and browser.

export const CHUNK = 64;
export const REGION_W = 2048;
export const WORLD_H = 1600;

/** Materials: the first byte of a cell. */
export const M = {
  AIR: 0,
  ROCK: 1,
  SOIL: 2,
  GRASS: 3,
  SAND: 4,
  GRAVEL: 5,
  WATER: 6,
  LAVA: 7,
  ICE: 8,
  SNOW: 9,
  WOOD: 10,
  LEAF: 11,
  STALK: 12,
  CAP: 13,
  CRYSTAL: 14,
  BEDROCK: 15,
  MOSS: 16,
} as const;
export type Material = (typeof M)[keyof typeof M];

/**
 * The second byte of a cell: the band of strata (low 4 bits), the biome the
 * cell belongs to (next 3 bits), and whether it glows (top bit).
 */
export const GLOW = 0x80;
export const stateOf = (band: number, biome: number, glow = false) =>
  (band & 15) | ((biome & 7) << 4) | (glow ? GLOW : 0);
export const bandOf = (state: number) => state & 15;
export const biomeOf = (state: number) => (state >> 4) & 7;

/** A hash of three integers to [0, 1). */
export function hash3(x: number, y: number, s: number) {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(s | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

export function noise1(x: number, s: number) {
  const i = Math.floor(x),
    u = fade(x - i),
    a = hash3(i, 0, s);
  return a + (hash3(i + 1, 0, s) - a) * u;
}

export function noise2(x: number, y: number, s: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    u = fade(x - ix),
    v = fade(y - iy);
  const a = hash3(ix, iy, s),
    b = hash3(ix + 1, iy, s),
    c = hash3(ix, iy + 1, s),
    d = hash3(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise in [0, 1). */
export function fbm1(x: number, s: number, octaves = 4) {
  let v = 0,
    amp = 0.5,
    f = 1,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * noise1(x * f, s + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

export function fbm2(x: number, y: number, s: number, octaves = 3) {
  let v = 0,
    amp = 0.5,
    f = 1,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * noise2(x * f, y * f, s + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

export const smoothstep = (e0: number, e1: number, x: number) =>
  fade(Math.max(0, Math.min(1, (x - e0) / (e1 - e0))));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A small seeded generator for sequences (walks, placements). */
export function walkRandom(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
