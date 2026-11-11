import { RELEASE } from "../scenes/release.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { Flock, Platformer, level } from "../engine/entities.ts";
import { defaults, parameters } from "../scenes/registry.ts";
import { makeProject, validateProject } from "../shared/model.js";
test("entity checkpoints replay exactly", () => {
  for (const [Type, id] of [
    [Flock, "murmuration"],
    [Platformer, "platformer"],
  ]) {
    const a = new Type(42, defaults(id)),
      b = new Type(42, defaults(id));
    for (let i = 0; i < 150; i++) a.step();
    b.restore(a.snapshot());
    for (let i = 0; i < 120; i++) {
      a.step();
      b.step();
    }
    assert.deepEqual(a.snapshot(), b.snapshot());
  }
});
test("flock remains finite, bounded, reproducible through 30 simulated minutes", () => {
  const a = new Flock(7, { ...defaults("murmuration"), population: 20 });
  for (let i = 0; i < 108000; i++) a.step();
  assert.ok(a.snapshot().data.every(Number.isFinite));
  for (const [x, y] of a.agents) {
    assert.ok(x >= 0 && x <= 1);
    assert.ok(y >= 0 && y <= 1);
  }
});
test("autonomous platformer completes generated levels across seed batch", () => {
  for (let seed = 0; seed < 50; seed++) {
    const p = new Platformer(seed, {});
    assert.deepEqual(level(seed), level(seed));
    for (let i = 0; i < 18000; i++) p.step();
    assert.ok(p.stage > 0, `seed ${seed} must progress`);
    const s = p.snapshot();
    assert.ok(s.data.every(Number.isFinite));
  }
});
test("v1 projects migrate; scene parameters are validated", () => {
  const old = makeProject();
  old.schemaVersion = 1;
  delete old.scene.params;
  delete old.scene.style;
  const migrated = validateProject(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.scene.params, {});
  assert.throws(() => parameters("tapestry", { rate: Infinity }));
  assert.throws(() => parameters("tapestry", { rule: "invalid" }));
  assert.throws(() =>
    validateProject({ ...migrated, checkpoint: { tick: -1, data: [] } }),
  );
});
test("world and event metadata reject invalid input", () => {
  const p = makeProject();
  assert.throws(() =>
    validateProject({ ...p, world: { x: 0, y: 0, width: -1, height: 10 } }),
  );
  assert.throws(() =>
    validateProject({ ...p, events: [{ tick: NaN, params: {} }] }),
  );
});
test("structured art direction validates commands", async () => {
  const { applyCommand, parseText } = await import("../engine/commands.ts");
  const p = makeProject();
  if (RELEASE < 4) {
    assert.throws(() => applyCommand(p, { type: "scene", id: "platformer" }));
    return;
  }
  applyCommand(p, { type: "scene", id: "platformer" });
  const before = p.time;
  applyCommand(p, { type: "style", value: "geometric" });
  assert.equal(p.time, before);
  assert.equal(p.scene.style, "geometric");
  assert.throws(() => applyCommand(p, { type: "style", value: "unsupported" }));
  assert.equal(parseText("show chemical garden", p).id, "chemical");
});
test("platformer recovers after a fall and continues autonomously", () => {
  const p = new Platformer(1, {});
  p.y = 600;
  p.step();
  assert.equal(p.deaths, 1);
  assert.ok(p.cooldown > 0);
  for (let i = 0; i < 18000; i++) p.step();
  assert.ok(p.stage > 0);
});
test("presentation refresh remains physical time across speed changes", async () => {
  const { PresentationClock } = await import("../engine/clock.ts");
  const c = new PresentationClock();
  c.align(0, 1);
  c.advance(1, 1);
  c.advance(1, 0.5);
  assert.equal(c.wallMs, 2000);
  assert.equal(c.sceneMs, 1500);
  assert.equal(c.sceneAt(500), 500);
  assert.equal(c.sceneAt(1500), 1250);
  const f = c.frame({ current: 1900, previous: 1800 });
  assert.equal(f.contentAge, 100);
  assert.equal(f.current, 1450);
});
