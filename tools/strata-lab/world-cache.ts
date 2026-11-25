// A disk cache of world histories for the lab's Node tools (lookbook, probe).
// A world is a pure function of its seed and the engine's code, so it is
// kept under a key made from both: any change to any file in engine/strata
// makes a new key. Saves the 1.5-2 s a world takes to build, per process.
//
//   const w = await cachedWorld(root, seed);   // builds and stores on a miss
//
// The world is also handed to the engine's own cache (worldmap.ts
// adoptWorld), so everything in that process uses it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TYPED: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Float32Array,
  Float64Array,
  Int32Array,
  Uint8Array,
  Int16Array,
  Uint16Array,
};

/** A key for the engine's code: the hash of every engine/strata source file. */
function codeKey(root: string) {
  const dir = resolve(root, "engine/strata"),
    h = createHash("sha1");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort())
    h.update(f).update(readFileSync(resolve(dir, f)));
  return h.digest("hex").slice(0, 16);
}

function pack(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) {
    const b = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    return { __typed: v.constructor.name, data: b.toString("base64") };
  }
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  return v;
}

function unpack(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.__typed === "string") {
      const b = Buffer.from(o.data as string, "base64"),
        ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      return new TYPED[o.__typed](ab);
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, unpack(x)]));
  }
  return v;
}

const keys = new Map<string, string>();

interface History {
  simulateWorld(seed: number): unknown;
}
interface WorldMap {
  adoptWorld?(seed: number, w: unknown): void;
  setWorldSource?(fn: (seed: number) => unknown): void;
}

/** A world from the cache, or built (and stored) on a miss. */
function loadOrBuild(root: string, history: History, seed: number) {
  if (!keys.has(root)) keys.set(root, codeKey(root));
  const dir = resolve(root, "node_modules/.cache/strata-worlds"),
    file = resolve(dir, `${keys.get(root)}-${seed}.json`);
  if (existsSync(file)) {
    try {
      return unpack(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      // A damaged entry is rebuilt below.
    }
  }
  const w = history.simulateWorld(seed);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(pack(w)));
  } catch {
    // A cache that can't be written is only slower.
  }
  return w;
}

/** Have the engine (worldmap.ts worldOf) take its worlds from the cache. */
export function installWorldCache(root: string, history: History, map: WorldMap) {
  map.setWorldSource?.((seed) => loadOrBuild(root, history, seed));
}

/** The world for a seed in the checkout at root, from the cache or built, and adopted by its engine. */
export async function cachedWorld(root: string, seed: number) {
  const history = await import(resolve(root, "engine/strata/history.ts")),
    map: WorldMap = await import(resolve(root, "engine/strata/worldmap.ts")),
    w = loadOrBuild(root, history, seed);
  // Older checkouts may not have adoptWorld; they simply build their own.
  map.adoptWorld?.(seed, w);
  installWorldCache(root, history, map);
  return w;
}
