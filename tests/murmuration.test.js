import test from "node:test";
import assert from "node:assert/strict";
import { Murmuration, BIRD_STRIDE, SKY } from "../engine/murmuration.ts";
import { Flock } from "../engine/entities.ts";
import { registry, defaults } from "../scenes/registry.ts";
import { makeProject, validateProject } from "../shared/model.js";

const params = (extra = {}) => ({ ...defaults("murmuration"), ...extra });

test("new murmuration recipes use the 3D flock; revision 1 keeps the 2D flock", () => {
  assert.equal(defaults("murmuration").flockVersion, 2);
  const create = registry.murmuration.create;
  assert.ok(create(null, 3, params({ population: 60 })) instanceof Murmuration);
  assert.ok(
    create(null, 3, params({ population: 60, flockVersion: 1 })) instanceof
      Flock,
  );
});

test("3D flock replays exactly through checkpoints and interventions", () => {
  const a = new Murmuration(42, params({ population: 400 })),
    b = new Murmuration(42, params({ population: 400 }));
  for (let i = 0; i < 900; i++) a.step();
  b.restore(JSON.parse(JSON.stringify(a.snapshot())));
  a.intervene({ kind: 2, serial: 5, x: 0.3, y: 0.3 });
  b.intervene({ kind: 2, serial: 5, x: 0.3, y: 0.3 });
  for (let i = 0; i < 600; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test("3D flock stays finite, in the sky, and spread out over ten minutes", () => {
  const sim = new Murmuration(9, params({ population: 900 }));
  let inSky = 0,
    samples = 0,
    minWidth = Infinity;
  for (let i = 1; i <= 36000; i++) {
    sim.step();
    if (i % 600) continue;
    const b = sim.birds;
    const xs = [];
    for (let at = 0; at < b.length; at += BIRD_STRIDE) {
      assert.ok(b.subarray(at, at + BIRD_STRIDE).every(Number.isFinite));
      const inside =
        b[at] > SKY.x0 - 0.08 &&
        b[at] < SKY.x1 + 0.08 &&
        b[at + 1] > SKY.y0 - 0.08 &&
        b[at + 1] < SKY.y1 + 0.08;
      inSky += inside ? 1 : 0;
      samples++;
      xs.push(b[at]);
    }
    xs.sort((p, q) => p - q);
    // Width spanned by the central 80% of birds.
    minWidth = Math.min(
      minWidth,
      xs[Math.floor(xs.length * 0.9)] - xs[Math.floor(xs.length * 0.1)],
    );
  }
  assert.ok(
    inSky / samples > 0.97,
    "birds stay in the sky: " + inSky / samples,
  );
  assert.ok(minWidth > 0.06, "flock keeps a visible spread: " + minWidth);
});

test("projects migrate and validate flock revisions", () => {
  const legacy = makeProject();
  legacy.scene = {
    ...legacy.scene,
    id: "murmuration",
    style: "luminous",
    params: { population: 120, cohesion: 0.4, velocity: 0.12, predator: true },
  };
  const old = new Flock(1, { ...params(), flockVersion: 1, population: 120 });
  for (let i = 0; i < 30; i++) old.step();
  legacy.checkpoint = old.snapshot();
  legacy.time = old.tick / 60;
  const migrated = validateProject(legacy);
  assert.equal(migrated.scene.params.flockVersion, 1);
  assert.equal(migrated.checkpoint.data.length, 120 * 4);

  const current = makeProject();
  current.scene = {
    ...current.scene,
    id: "murmuration",
    style: "silhouette",
    params: params({ population: 120 }),
  };
  const sim = new Murmuration(1, current.scene.params);
  for (let i = 0; i < 30; i++) sim.step();
  current.checkpoint = sim.snapshot();
  current.time = sim.tick / 60;
  assert.equal(
    validateProject(current).checkpoint.data.length,
    120 * BIRD_STRIDE,
  );
  current.checkpoint = {
    ...current.checkpoint,
    data: current.checkpoint.data.slice(6),
  };
  assert.throws(() => validateProject(current));
});
