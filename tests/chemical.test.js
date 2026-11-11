import test from "node:test";
import assert from "node:assert/strict";
import {
  initialChemicalState,
  CHEMICAL_PRESETS,
  selectedChemicalPreset,
  DEFAULT_CHEMICAL_PRESET,
} from "../engine/chemical.ts";
import { defaults } from "../scenes/registry.ts";

test("chemical seeds are reproducible viable nuclei, not isolated reagent pixels", () => {
  for (const width of [128, 256])
    for (const seed of [42, 1337]) {
      const height = Math.round(width * 0.625),
        data = initialChemicalState(width, height, seed);
      assert.deepEqual(data, initialChemicalState(width, height, seed));
      const active = new Set();
      for (let i = 0; i < data.length; i += 4) {
        assert.ok(data[i] >= 0 && data[i] <= 1);
        assert.equal(data[i + 3], 1);
        if (data[i + 1] > 0.1) active.add(i / 4);
      }
      assert.ok(
        active.size > width * height * 0.02 &&
          active.size < width * height * 0.2,
      );
      let largest = 0;
      while (active.size) {
        const start = active.values().next().value,
          queue = [start];
        active.delete(start);
        let count = 0;
        while (queue.length) {
          const cell = queue.pop();
          count++;
          const x = cell % width,
            y = Math.floor(cell / width);
          for (const n of [
            x > 0 ? cell - 1 : -1,
            x < width - 1 ? cell + 1 : -1,
            y > 0 ? cell - width : -1,
            y < height - 1 ? cell + width : -1,
          ])
            if (active.delete(n)) queue.push(n);
        }
        largest = Math.max(largest, count);
      }
      assert.ok(largest >= 80, "Clusters need a viable interior");
    }
  assert.notDeepEqual(
    initialChemicalState(128, 80, 42),
    initialChemicalState(128, 80, 1337),
  );
});
test("preset identity follows saved numeric values and manual tuning", () => {
  assert.equal(
    selectedChemicalPreset(defaults("chemical")),
    DEFAULT_CHEMICAL_PRESET,
  );
  for (const [name, recipe] of Object.entries(CHEMICAL_PRESETS)) {
    assert.equal(selectedChemicalPreset({ ...recipe, resolution: 256 }), name);
    assert.equal(
      selectedChemicalPreset({ ...recipe, feed: recipe.feed + 0.001 }),
      "",
    );
  }
});
