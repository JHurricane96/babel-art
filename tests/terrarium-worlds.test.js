import test from "node:test";
import assert from "node:assert/strict";
import {
  generateChunk,
  navigation,
  route,
  validChunk,
} from "../engine/terrarium-gen.ts";
import { TerrariumWorld, validateWorldSave } from "../engine/terrarium.ts";
import { defaults } from "../scenes/registry.ts";
import { validateProject, makeProject } from "../shared/model.js";

test("procedural terrain is connected across one hundred seeds and every biome", () => {
  const identities = new Set();
  for (let seed = 0; seed < 100; seed++)
    for (let biome = 0; biome < 4; biome++) {
      const chunks = [0, 1, 2].map((i) => generateChunk(seed, i, biome));
      assert.ok(chunks.every(validChunk));
      const g = navigation(chunks);
      assert.ok(
        route(g, chunks[0].nodes[0].id, chunks[2].nodes[8].id).length > 0,
      );
      identities.add(JSON.stringify(chunks[0].platforms));
      assert.deepEqual(chunks[0], generateChunk(seed, 0, biome));
    }
  assert.ok(identities.size >= 100);
});
test("six autonomous roles complete the resource and construction chains", () => {
  const s = new TerrariumWorld(42, defaults("terrarium-worlds"));
  for (let i = 0; i < 10800; i++) s.step();
  assert.equal(new Set(s.actors.map((a) => a.role)).size, 6);
  for (const key of [
    "pollinations",
    "meals",
    "seeds",
    "deliveries",
    "repairs",
    "discoveries",
    "pursuits",
  ])
    assert.ok(s.stats[key] > 0, key + " must progress");
  assert.ok(s.camera.x > 640);
  assert.equal(s.chunks.length, 9);
  assert.equal(s.actors.length, 72);
  assert.ok(
    s.actors.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y)),
  );
  assert.ok(validateWorldSave(s.snapshot().extra.world, s.tick, 72));
});
test("checkpoint round trips preserve world ecology, camera, routes, and future decisions", () => {
  const p = defaults("terrarium-worlds"),
    a = new TerrariumWorld(7, p),
    b = new TerrariumWorld(7, p);
  for (let i = 0; i < 5300; i++) a.step();
  const project = makeProject();
  project.scene = {
    ...project.scene,
    id: "terrarium-worlds",
    style: "pixel",
    seed: 7,
    params: p,
  };
  project.time = a.tick / 60;
  project.checkpoint = a.snapshot();
  const saved = validateProject(JSON.parse(JSON.stringify(project)));
  b.restore(saved.checkpoint);
  for (let i = 0; i < 1500; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const before = a.snapshot();
  a.captureFrame();
  a.captureFrame();
  assert.deepEqual(a.snapshot(), before);
  const invalid = structuredClone(project);
  invalid.checkpoint.extra.world.actors[0].path = Array(50).fill(0);
  assert.throws(() => validateProject(invalid));
});
test("streaming retires distant state and actors recover from obsolete routes", () => {
  const s = new TerrariumWorld(1, {
    ...defaults("terrarium-worlds"),
    population: 48,
  });
  s.camera = {
    x: 32000,
    from: 32000,
    to: 32000,
    start: 0,
    duration: 0,
    dwell: 1200,
    serial: 1,
  };
  s.step();
  assert.equal(s.chunkStates.size, 9);
  assert.ok(s.actors.every((a) => s.graph.nodes.has(a.node)));
  assert.ok(s.stats.arrivals > 0);
  assert.equal(s.captureFrame().data.length, 48 * 12 + 9 * 89);
  assert.ok(validateWorldSave(s.snapshot().extra.world, s.tick, 48));
});
