import test from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_PATTERNS,
  LifeDirector,
  initialLifeState,
  lifeGeneration,
  validateLifeDirector,
} from "../engine/life.ts";
import { defaults } from "../scenes/registry.ts";
import { makeProject, validateProject } from "../shared/model.js";
const bits = (rgba) =>
  Uint8Array.from({ length: rgba.length / 4 }, (_, i) =>
    rgba[i * 4] > 127 ? 1 : 0,
  );
const rgba = (cells) => {
  const a = new Uint8Array(cells.length * 4);
  for (let i = 0; i < cells.length; i++) {
    a[i * 4] = cells[i] * 255;
    a[i * 4 + 1] = cells[i] * 255;
    a[i * 4 + 3] = 255;
  }
  return a;
};
test("verified Life patterns include correct spaceships and periodic oscillators", () => {
  assert.equal(LIFE_PATTERNS.length, 12);
  assert.deepEqual(
    LIFE_PATTERNS.slice(0, 4).map((p) => p.cells.length),
    [5, 9, 11, 13],
  );
  for (const [id, period] of [
    [10, 3],
    [11, 15],
  ]) {
    const p = LIFE_PATTERNS[id],
      cells = new Uint8Array(64 * 64);
    for (const [x, y] of p.cells) cells[(y + 20) * 64 + x + 20] = 1;
    let c = cells;
    for (let i = 0; i < period; i++) c = lifeGeneration(c, 64, 64);
    assert.deepEqual(c, cells, p.name + " must have its known period");
  }
  const c = new Uint8Array(32 * 32);
  for (const [x, y] of LIFE_PATTERNS[0].cells) c[(y + 8) * 32 + x + 8] = 1;
  let moved = c;
  for (let i = 0; i < 4; i++) moved = lifeGeneration(moved, 32, 32);
  for (const [x, y] of LIFE_PATTERNS[0].cells)
    assert.equal(moved[(y + 9) * 32 + x + 9], 1);
});
test("Life renewal is bounded, varied, deterministic, and leaves established areas intact", () => {
  const p = defaults("tapestry"),
    a = new LifeDirector(42),
    b = new LifeDirector(42),
    data = initialLifeState(128, 80, 42, p),
    copy = data.slice();
  const actions = a.renew(data, 128, 80, 120, p),
    same = b.renew(copy, 128, 80, 120, p);
  assert.deepEqual(actions, same);
  assert.deepEqual(data, copy);
  assert.ok(actions.length >= 2);
  assert.ok(
    actions.reduce((n, p) => n + p.width * p.height, 0) <= 128 * 80 * 0.1,
  );
  assert.ok(new Set(actions.map((p) => p.x + "," + p.y)).size > 1);
  const save = a.snapshot();
  b.restore(save);
  assert.deepEqual(
    a.renew(data, 128, 80, 240, p),
    b.renew(copy, 128, 80, 240, p),
  );
  assert.ok(validateLifeDirector(save, 128, 80));
  assert.throws(() =>
    validateLifeDirector({ ...save, hashes: Array(40).fill([]) }, 128, 80),
  );
});
test("empty, static, and oscillator fields receive distributed renewal; unassisted mode is untouched", () => {
  for (const pattern of [
    null,
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  ]) {
    const director = new LifeDirector(42),
      cells = new Uint8Array(128 * 80);
    if (pattern)
      for (const [x, y] of pattern) cells[(y + 30) * 128 + x + 30] = 1;
    const data = rgba(cells);
    let interventions = 0;
    for (let tick = 30; tick <= 600; tick += 30)
      interventions += director.observe(
        data,
        128,
        80,
        tick,
        defaults("tapestry"),
      ).length;
    assert.ok(interventions >= 4);
    assert.ok(director.state.seeded.filter((t) => t >= 0).length >= 8);
  }
  const d = new LifeDirector(1),
    blank = new Uint8Array(128 * 80 * 4);
  for (let t = 30; t < 3600; t += 30)
    assert.deepEqual(
      d.observe(blank, 128, 80, t, {
        ...defaults("tapestry"),
        ecology: "unassisted",
      }),
      [],
    );
});
test("Life director checkpoint includes all decision memory and legacy projects retain their recipe", () => {
  const p = makeProject();
  p.scene = {
    ...p.scene,
    id: "tapestry",
    style: "luminous",
    params: { rule: "life", resolution: 128 },
  };
  assert.equal(validateProject(p).scene.params.ecologyVersion, 1);
  p.scene.params = defaults("tapestry");
  assert.equal(validateProject(p).scene.params.ecologyVersion, 2);
  const d = new LifeDirector(8),
    data = initialLifeState(128, 80, 8, p.scene.params);
  for (let tick = 30; tick <= 240; tick += 30)
    d.observe(data, 128, 80, tick, p.scene.params);
  const e = new LifeDirector(8);
  e.restore(
    validateLifeDirector(JSON.parse(JSON.stringify(d.snapshot())), 128, 80),
  );
  for (let tick = 270; tick <= 1200; tick += 30) {
    const copy = data.slice();
    assert.deepEqual(
      d.observe(data, 128, 80, tick, p.scene.params),
      e.observe(copy, 128, 80, tick, p.scene.params),
    );
  }
});
