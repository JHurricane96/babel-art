import test from "node:test";
import assert from "node:assert/strict";
import {
  EvolutionSchedule,
  ActivityMonitor,
  actionFor,
} from "../engine/evolution.ts";
import { Flock } from "../engine/entities.ts";
import { defaults } from "../scenes/registry.ts";
test("scheduled events cannot be skipped by a nondividing generation cadence", () => {
  for (const period of [7, 9, 60]) {
    const schedule = new EvolutionSchedule(42);
    let pending,
      lastApplied = 0,
      count = 0;
    for (let tick = 1; tick <= 3600; tick++) {
      pending = schedule.advance(tick, 0.65) || pending;
      if (tick % period === 0 && pending) {
        assert.ok(tick - lastApplied < 1500);
        lastApplied = tick;
        count++;
        pending = undefined;
      }
    }
    assert.ok(count >= 3);
  }
});
test("schedule checkpoints reproduce future events exactly", () => {
  const a = new EvolutionSchedule(42),
    b = new EvolutionSchedule(42);
  for (let t = 1; t <= 700; t++) a.advance(t, 0.65);
  b.restore(a.snapshot(), 700);
  for (let t = 701; t < 10000; t++)
    assert.deepEqual(a.advance(t, 0.65), b.advance(t, 0.65));
  assert.deepEqual(actionFor(9, 10), actionFor(9, 10));
});
test("stagnation escalates to renewal; pause and disabled recovery do not intervene", () => {
  const h = new ActivityMonitor(),
    still = new Float32Array(640),
    actions = [];
  for (let t = 0; t <= 40; t++)
    if (h.observe(t, still, true)) actions.push(h.state.stage);
  assert.deepEqual(actions.slice(0, 3), [1, 2, 3]);
  assert.ok(h.fallback(0.65, true) > 0.5);
  const count = h.state.interventions;
  for (let i = 0; i < 10; i++) h.observe(40, still, true);
  assert.equal(h.state.interventions, count);
  for (let t = 41; t < 80; t++)
    assert.equal(h.observe(t, still, false), undefined);
});
test("healthy changing samples reset the stagnation budget", () => {
  const h = new ActivityMonitor();
  for (let t = 0; t < 60; t++) {
    const moving = Float32Array.from(
      { length: 640 },
      (_, i) => ((i + t) % 7) / 7,
    );
    assert.equal(h.observe(t, moving, true), undefined);
  }
  assert.equal(h.state.quietSeconds, 0);
});
test("nonfinite state immediately requests strong recovery", () => {
  const h = new ActivityMonitor();
  assert.equal(h.observe(0, new Float32Array([NaN, 1]), true), 3);
});
test("murmuration stays reproducible across scheduled interventions", () => {
  const a = new Flock(42, defaults("murmuration")),
    b = new Flock(42, defaults("murmuration"));
  for (let i = 0; i < 1234; i++) a.step();
  b.restore(a.snapshot());
  for (let i = 0; i < 2000; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test("eight-hour controller schedule and metrics retain bounded state", () => {
  const schedule = new EvolutionSchedule(42),
    health = new ActivityMonitor(),
    blank = new Float32Array(640);
  let events = 0;
  for (let seconds = 0; seconds <= 8 * 3600; seconds++) {
    if (schedule.advance(seconds * 60, 0.65)) events++;
    health.observe(seconds, blank, true);
    assert.ok(health.recent.length <= 8);
  }
  assert.ok(events > 1000 && events < 4000);
  assert.ok(
    health.state.interventions > 1000 && health.state.interventions < 4000,
  );
  assert.ok(Number.isFinite(health.state.score));
});
test("presentation time stays real while simulation catch-up is bounded", async () => {
  const { PresentationClock } = await import("../engine/clock.ts");
  const c = new PresentationClock();
  c.align(0, 1);
  c.advance(2, 1, 0.1);
  assert.equal(c.wallMs, 2000);
  assert.equal(c.sceneMs, 100);
  assert.equal(c.sceneAt(1000), 50);
});
test("extinct state receives help within two sampled seconds", () => {
  const m = new ActivityMonitor();
  const blank = new Float32Array(640);
  m.observe(0, blank, true);
  m.observe(1, blank, true);
  assert.equal(m.observe(2, blank, true), 1);
});
