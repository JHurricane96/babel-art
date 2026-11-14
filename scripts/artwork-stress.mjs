import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { ParticleRivers } from "../engine/particles.ts";
import { SlimeNetworks } from "../engine/slime.ts";
import { Flock } from "../engine/entities.ts";
import { Murmuration } from "../engine/murmuration.ts";
import { TerrariumWorld, validateWorldSave } from "../engine/terrarium.ts";
import { defaults } from "../scenes/registry.ts";
const minutes = Math.max(1, Number(process.env.BABEL_STRESS_MINUTES ?? 30)),
  ticks = Math.round(minutes * 3600),
  rows = [];
const cases = [
  ["rivers", ParticleRivers, {}],
  ["slime", SlimeNetworks, {}],
  ["murmuration", Murmuration, {}],
  ["murmuration-v1", Flock, { flockVersion: 1, population: 480 }],
  ...[0, 1, 2, 3].map((biome) => [
    "terrarium-worlds",
    TerrariumWorld,
    { biome },
  ]),
];
await mkdir("artifacts", { recursive: true });
for (const [id, Type, extra] of cases.filter(
  ([id]) =>
    !process.env.BABEL_STRESS_SCENE || process.env.BABEL_STRESS_SCENE === id,
)) {
  const started = performance.now(),
    s = new Type(42, { ...defaults(id.replace("-v1", "")), ...extra });
  let frame;
  for (let t = 0; t < ticks; t++) {
    s.step();
    if (t % 3600 === 3599) {
      const snap = s.snapshot();
      assert.ok(snap.data.every(Number.isFinite), id + " finite state");
      frame = s.captureFrame?.(frame);
      if (frame) assert.ok(frame.data.every(Number.isFinite));
      if (id === "terrarium-worlds") {
        assert.ok(validateWorldSave(snap.extra.world, s.tick, s.actors.length));
        assert.equal(s.chunks.length, 9);
        assert.equal(s.chunkStates.size, 9);
      }
      console.log(
        id,
        JSON.stringify(extra),
        s.tick / 3600 + " simulated minutes",
      );
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const cp = s.snapshot(),
    replay = new Type(42, { ...defaults(id.replace("-v1", "")), ...extra });
  replay.restore(cp);
  for (let i = 0; i < 120; i++) {
    s.step();
    replay.step();
  }
  assert.deepEqual(s.snapshot(), replay.snapshot());
  rows.push({
    scene: id,
    params: extra,
    simulatedMinutes: minutes,
    wallSeconds: (performance.now() - started) / 1000,
    stats: s.stats ?? null,
  });
  s.dispose();
  replay.dispose();
  await writeFile(
    `artifacts/artwork-stress${process.env.BABEL_STRESS_SCENE ? "-" + process.env.BABEL_STRESS_SCENE : ""}.json`,
    JSON.stringify({ status: "running", rows }, null, 2),
  );
}
await writeFile(
  `artifacts/artwork-stress${process.env.BABEL_STRESS_SCENE ? "-" + process.env.BABEL_STRESS_SCENE : ""}.json`,
  JSON.stringify({ status: "passed", rows }, null, 2),
);
console.table(
  rows.map(({ scene, params, simulatedMinutes, wallSeconds }) => ({
    scene,
    ...params,
    simulatedMinutes,
    wallSeconds,
  })),
);
