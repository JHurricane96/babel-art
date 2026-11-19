import test from "node:test";
import assert from "node:assert/strict";
import { Murmuration, BIRD_STRIDE } from "../engine/murmuration.ts";
import { Flock } from "../engine/entities.ts";
import { registry, defaults } from "../scenes/registry.ts";
import { makeProject, validateProject } from "../shared/model.js";

const params = (extra = {}) => ({ ...defaults("murmuration"), ...extra });

test("new murmuration recipes use the starling flock; revision 1 keeps the 2D flock", () => {
  assert.equal(defaults("murmuration").flockVersion, 2);
  const create = registry.murmuration.create;
  assert.ok(create(null, 3, params({ population: 60 })) instanceof Murmuration);
  assert.ok(
    create(null, 3, params({ population: 60, flockVersion: 1 })) instanceof
      Flock,
  );
});

/** Shares of the flock in each connected piece (occupied 12 m cells), largest first. */
function pieces(d) {
  const C = 12,
    cells = new Map();
  for (let at = 0; at < d.length; at += BIRD_STRIDE) {
    const k = `${Math.floor(d[at] / C)},${Math.floor(d[at + 1] / C)},${Math.floor(d[at + 2] / C)}`;
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  const seen = new Set(),
    sizes = [];
  for (const [k, c] of cells) {
    if (seen.has(k) || c < 2) continue;
    let total = 0;
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop();
      total += cells.get(cur);
      const [x, y, z] = cur.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const nk = `${x + dx},${y + dy},${z + dz}`;
            if (!seen.has(nk) && (cells.get(nk) ?? 0) >= 2) {
              seen.add(nk);
              stack.push(nk);
            }
          }
    }
    sizes.push(total);
  }
  return sizes.sort((a, b) => b - a).map((v) => (v * BIRD_STRIDE) / d.length);
}

test("starling flock replays exactly through checkpoints and panic waves", () => {
  const a = new Murmuration(42, params({ population: 1000 })),
    b = new Murmuration(42, params({ population: 1000 }));
  // Past the first spontaneous startles, so panic waves are under way.
  for (let i = 0; i < 31 * 60 + 23; i++) a.step();
  b.restore(JSON.parse(JSON.stringify(a.snapshot())));
  a.intervene({ kind: 1, serial: 5, x: 0.3, y: 0.3 });
  b.intervene({ kind: 1, serial: 5, x: 0.3, y: 0.3 });
  for (let i = 0; i < 600; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test("starling flock stays finite, aloft and in view; it splits and rejoins", () => {
  const sim = new Murmuration(9, params({ population: 2000 }));
  let samples = 0,
    aloft = 0,
    near = 0,
    checks = 0,
    whole = 0,
    largestSum = 0,
    worstGroup = 1;
  for (let i = 1; i <= 5 * 60 * 60; i++) {
    sim.step();
    if (i % 1200) continue;
    assert.ok(sim.birds.every(Number.isFinite));
    const d = sim.captureFrame().data;
    for (let at = 0; at < d.length; at += BIRD_STRIDE) {
      samples++;
      if (d[at + 1] > 15 && d[at + 1] < 220) aloft++;
      // Within the sky in front of the camera.
      if (Math.abs(d[at]) < 260 && d[at + 2] > -160 && d[at + 2] < 260) near++;
    }
    const largest = pieces(d)[0];
    checks++;
    largestSum += largest;
    if (largest > 0.9) whole++;
    worstGroup = Math.min(worstGroup, largest);
  }
  assert.ok(aloft / samples > 0.97, "birds stay aloft: " + aloft / samples);
  assert.ok(near / samples > 0.97, "birds stay in view: " + near / samples);
  // Two attractors pull the halves of the flock apart and together again,
  // so it is often in two pieces, but it is often whole and never scatters.
  assert.ok(whole / checks > 0.35, "flock is often whole: " + whole / checks);
  assert.ok(
    largestSum / checks > 0.65,
    "mean largest group: " + largestSum / checks,
  );
  assert.ok(worstGroup > 0.4, "never scatters: " + worstGroup);
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
    params: params({ population: 1000 }),
  };
  const sim = new Murmuration(1, current.scene.params);
  for (let i = 0; i < 30; i++) sim.step();
  current.checkpoint = sim.snapshot();
  current.time = sim.tick / 60;
  // Packed: the flock's numbers travel as a binary block, and as compact
  // text in JSON; every stored form restores the exact same flock.
  const valid = validateProject(current);
  assert.equal(valid.checkpoint.packed.length, 1000 * BIRD_STRIDE);
  const json = JSON.parse(JSON.stringify(current));
  assert.match(json.checkpoint.packed, /^f(32|64):/);
  assert.ok(JSON.stringify(current).length < 1000 * BIRD_STRIDE * 12);
  const fromIndexedDb = structuredClone(current), // the block loses its class
    plain = {
      ...current,
      checkpoint: {
        ...current.checkpoint,
        data: Array.from(current.checkpoint.packed.values),
      },
    };
  delete plain.checkpoint.packed;
  for (const stored of [json, fromIndexedDb, plain]) {
    const restored = new Murmuration(1, current.scene.params);
    restored.restore(validateProject(stored).checkpoint);
    assert.deepEqual(Array.from(restored.birds), Array.from(sim.birds));
  }
  // A truncated or garbled block is refused.
  const broken = JSON.parse(JSON.stringify(current));
  broken.checkpoint.packed = broken.checkpoint.packed.slice(0, -40);
  assert.throws(() => validateProject(broken));
  broken.checkpoint.packed = "f64:not base64!";
  assert.throws(() => validateProject(broken));
});
