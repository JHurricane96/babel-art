import type { Params } from "./types";
import { rng } from "./types";

// Keep the inspector, scene defaults, and regression tests on one set of recipes.
export const CHEMICAL_PRESETS = {
  Coral: { feed: 0.0545, kill: 0.062 },
  "Dividing cells": { feed: 0.0367, kill: 0.0649 },
  Labyrinth: { feed: 0.029, kill: 0.057 },
} as const;
export type ChemicalPreset = keyof typeof CHEMICAL_PRESETS;
export const DEFAULT_CHEMICAL_PRESET: ChemicalPreset = "Dividing cells";

export function selectedChemicalPreset(params: Params): ChemicalPreset | "" {
  return (
    (Object.keys(CHEMICAL_PRESETS) as ChemicalPreset[]).find((name) => {
      const recipe = CHEMICAL_PRESETS[name];
      return (
        Math.abs(Number(params.feed) - recipe.feed) < 1e-8 &&
        Math.abs(Number(params.kill) - recipe.kill) < 1e-8
      );
    }) || ""
  );
}

export function initialChemicalState(
  width: number,
  height: number,
  seed: number,
) {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 1;
    data[i + 3] = 1;
  }
  const random = rng(seed);
  // Isolated reagent pixels diffuse below the reaction threshold and die out.
  // Connected nuclei leave a viable interior while their boundaries evolve.
  // Gray–Scott's critical nucleus size is measured in simulation cells.
  // Increase the number of nuclei on a larger grid, not their radius: oversized
  // homogeneous deposits also collapse for the dividing-cell recipe.
  const radius = 6;
  const columns = Math.max(1, Math.round(width / 128) * 3),
    rows = Math.max(1, Math.round(height / 80) * 2);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const cx = Math.round(
        (width * (column + 0.5 + (random() - 0.5) * 0.15)) / columns,
      );
      const cy = Math.round(
        (height * (row + 0.5 + (random() - 0.5) * 0.15)) / rows,
      );
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (
            x < 0 ||
            x >= width ||
            y < 0 ||
            y >= height ||
            (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2
          )
            continue;
          const i = (y * width + x) * 4;
          data[i] = 0.5;
          data[i + 1] = 0.25 + (random() - 0.5) * 0.04;
        }
      }
    }
  }
  return data;
}
