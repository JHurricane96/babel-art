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
  extra?: Record<string, unknown>;
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
