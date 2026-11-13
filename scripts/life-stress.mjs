import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openBrowser } from "./browser-session.mjs";
const minutes = Math.max(1, Number(process.env.BABEL_STRESS_MINUTES ?? 30));
const b = await openBrowser({ port: 4187, debugPort: 9237 }),
  rows = [];
try {
  await b.evaluate(
    `document.getElementById('play').click();document.querySelector('[data-scene="tapestry"]').click()`,
  );
  for (const id of ["crosscurrents", "blooms", "constellations"]) {
    await b.evaluate(
      `(()=>{const s=document.getElementById('scene-preset');s.value='${id}';s.dispatchEvent(new Event('change'));})()`,
    );
    await b.evaluate(
      `window.lifeProbe={started:performance.now(),maxQuiet:0,minCoverage:12,samples:0}`,
    );
    for (let minute = 1; minute <= minutes; minute++) {
      await b.evaluate(
        `(()=>{const r=babelDebug.runtime,p=babelDebug.project(),s=r.sim,q=lifeProbe,until=${minute}*3600;while(s.tick<until){s.step();if(s.tick%30===0){q.samples++;q.maxQuiet=Math.max(q.maxQuiet,s.life.state.quiet/60);if(s.tick>1800)q.minCoverage=Math.min(q.minCoverage,s.life.coverage);}}p.time=s.tick/60;r.capture();})()`,
      );
      console.log(id, minute + " simulated minutes");
    }
    const result = await b.evaluate(
      `(()=>{const s=babelDebug.runtime.sim,q=lifeProbe;return {simulatedMinutes:${minutes},wallSeconds:(performance.now()-q.started)/1000,maxQuiet:q.maxQuiet,minCoverage:q.minCoverage,samples:q.samples,events:s.life.state.serial,gl:babelDebug.runtime.gl.getError(),history:s.life.state.hashes.length};})()`,
    );
    assert.equal(result.gl, 0);
    assert.ok(result.maxQuiet <= 8, JSON.stringify(result));
    assert.ok(result.minCoverage >= 4, JSON.stringify(result));
    assert.ok(result.history <= 32);
    rows.push({ preset: id, ...result });
    console.log(id, result);
  }
  assert.deepEqual(b.errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/life-stress.json",
    JSON.stringify({ status: "passed", rows }, null, 2),
  );
} finally {
  await b.close();
}
