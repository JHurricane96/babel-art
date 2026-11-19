export type Params = Record<string, number | string | boolean>;
export interface Parameter {
  label: string;
  value: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  restart?: boolean;
  hidden?: boolean;
}
export interface ScenePreset {
  name: string;
  description: string;
  params: Params;
  palette?: string;
  style?: string;
}
export interface Scene {
  name: string;
  subtitle: string;
  description: string;
  version: number;
  kind: "procedural" | "grid" | "entities";
  fragment?: string;
  createRenderer?: (
    gl: WebGLRenderingContext,
  ) => import("./render-frame").SceneRenderer;
  parameters: Record<string, Parameter>;
  styles: string[];
  presets?: Record<string, ScenePreset>;
  create?: (
    gl: WebGLRenderingContext,
    seed: number,
    params: Params,
  ) => Simulation;
}
export interface Snapshot {
  tick: number;
  data: number[];
  /**
   * Large states (Murmuration) keep their numbers here instead, as a packed
   * binary block, and leave `data` empty.
   */
  packed?: PackedData;
  extra?: Record<string, unknown>;
}

/**
 * A large snapshot's numbers, kept as a binary copy. Taking one is a single
 * memory copy, and it is stored as is in IndexedDB. Written to JSON (saves in
 * localStorage, exports) it becomes "f32:" or "f64:" followed by base64 of
 * the little-endian bytes, which restores the exact same values.
 */
export class PackedData {
  constructor(public values: Float32Array | Float64Array) {}
  get length() {
    return this.values.length;
  }
  toJSON() {
    const v = this.values,
      bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      text += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + 0x8000) as unknown as number[],
      );
    return (v instanceof Float32Array ? "f32:" : "f64:") + btoa(text);
  }
}
/**
 * The numbers of a snapshot's data in any stored form: a plain array, a
 * PackedData, its JSON text, or the plain object IndexedDB returns for it.
 * Returns undefined for anything else.
 */
export function unpackData(data: unknown): ArrayLike<number> | undefined {
  if (Array.isArray(data)) return data;
  if (data instanceof PackedData) return data.values;
  const values = (data as { values?: unknown } | null)?.values;
  if (values instanceof Float32Array || values instanceof Float64Array)
    return values;
  if (typeof data === "string" && /^f(32|64):/.test(data)) {
    let text: string;
    try {
      text = atob(data.slice(4));
    } catch {
      return undefined;
    }
    const size = data.startsWith("f32") ? 4 : 8;
    if (text.length % size) return undefined;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return size === 4
      ? new Float32Array(bytes.buffer)
      : new Float64Array(bytes.buffer);
  }
  return undefined;
}
/** Normalises a stored packed block (any of its forms) to a PackedData. */
export function storedPacked(data: unknown): PackedData | undefined {
  if (data == null || Array.isArray(data)) return undefined;
  const v = unpackData(data);
  return v ? new PackedData(v as Float32Array | Float64Array) : undefined;
}
export interface World {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Simulation {
  seed: number;
  params: Params;
  tick: number;
  historyBudgetBytes?: number;
  captureFrame?(
    previous?: import("./render-frame").RenderFrame,
  ): import("./render-frame").RenderFrame;
  step(): void;
  snapshot(): Snapshot;
  restore(s: Snapshot): void;
  activitySample?(): Float32Array;
  intervene?(action: import("./evolution").EvolutionAction): void;
  dispose(): void;
}
export function rng(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EntitySimulation extends Simulation {
  paint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: string,
    colors?: number[][],
  ): void;
}
