import type { Params } from "./types";
/** Display history is separate from portable, authoritative checkpoints. */
export interface RenderFrame {
  tick: number;
  data: Float32Array;
  params: Params;
  extra?: Record<string, any>;
}
export interface Appearance {
  style: string;
  colors: number[][];
  seed: number;
  params: Params;
}
export interface SceneRenderer {
  width: number;
  height: number;
  pixelated?: boolean;
  /** Sub-pixel offset (source pixels) to apply when sampling a pixelated image. */
  sourceOffset?(frame: RenderFrame): number[];
  render(
    frame: RenderFrame,
    appearance: Appearance,
    width: number,
    height: number,
  ): void;
  dispose(): void;
}
export function frameBuffer(
  previous: RenderFrame | undefined,
  length: number,
  tick: number,
  params: Params,
): RenderFrame {
  const frame =
    previous?.data.length === length
      ? previous
      : { tick, params, data: new Float32Array(length) };
  frame.tick = tick;
  frame.params = params;
  frame.extra = undefined;
  return frame;
}
