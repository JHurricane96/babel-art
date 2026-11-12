import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openBrowser, sleep } from "./browser-session.mjs";
const browser = await openBrowser();
const { evaluate, call } = browser;
try {
  await evaluate(
    `document.getElementById('play').click();document.querySelector('[data-scene="chemical"]').click()`,
  );
  const recovered = await evaluate(
    `(async()=>{const r=window.babelDebug.runtime,p=window.babelDebug.project();p.time=2;await r.seek(2);const blank=r.sim.snapshot();for(let i=0;i<blank.data.length;i+=4){blank.data[i]=1;blank.data[i+1]=0;}r.sim.restore(blank);r.baseCheckpoint=r.snapshotWithParams();r.replayFloor=blank.tick;r.checkpoints.clear();r.checkpoints.set(blank.tick,r.baseCheckpoint);r.health.reset();for(let t=0;t<8;t++){r.observeHealth(t);r.sim.step();r.capture();p.time=r.sim.tick/60;}return {recoveries:r.health.state.interventions,active:r.sim.snapshot().data.some((v,i)=>i%4===1&&v>.1),event:r.events.some(e=>e.intervention),gl:r.gl.getError()};})()`,
  );
  assert.ok(
    recovered.recoveries > 0 && recovered.active && recovered.event,
    "Extinct chemistry must be revived and logged",
  );
  assert.equal(recovered.gl, 0);
  const replay = await evaluate(
    `(async()=>{const r=window.babelDebug.runtime,p=window.babelDebug.project();const wanted=r.sim.tick+60;p.time=wanted/60;await r.seek(p.time);const expected=r.sim.snapshot();p.time=0;await r.seek(0);p.time=wanted/60;await r.seek(p.time);return JSON.stringify(expected)===JSON.stringify(r.sim.snapshot());})()`,
  );
  assert.ok(replay, "Recovery events must replay deterministically");
  const compacted = await evaluate(
    `(async()=>{const r=window.babelDebug.runtime,p=window.babelDebug.project();for(let i=0;i<2055;i++)r.recordEvent({tick:r.sim.tick,params:{...p.scene.params}});const {validateProject}=await import('/shared/model.js');const saved=validateProject({...p,events:r.events,replayFloor:r.replayFloor,baseCheckpoint:r.baseCheckpoint,checkpoint:r.checkpoint(),initialParams:r.initialParams});const before=r.sim.snapshot().data;r.key='';r.setup(saved.scene,saved.world,saved.events,saved.initialParams,saved.replayFloor,saved.baseCheckpoint);await r.seek(saved.time,saved.checkpoint);return {count:r.events.length,floor:r.replayFloor,same:JSON.stringify(before)===JSON.stringify(r.sim.snapshot().data)};})()`,
  );
  assert.ok(
    compacted.count <= 2048 && compacted.floor > 0 && compacted.same,
    "Compacted replay must restore an exact bounded state",
  );
  for (const id of ["interference", "contours"]) {
    await evaluate(
      `document.querySelector('[data-scene="${id}"]').click();document.getElementById('time').value='5';document.getElementById('time').dispatchEvent(new Event('change'))`,
    );
    await evaluate(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    const before = await evaluate(
      `document.getElementById('compositor').toDataURL()`,
    );
    await evaluate(
      `document.getElementById('time').value='15';document.getElementById('time').dispatchEvent(new Event('change'))`,
    );
    await evaluate(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    assert.ok(
      (await evaluate(`document.getElementById('compositor').toDataURL()`)) !==
        before,
      id +
        " must evolve visibly: " +
        (await evaluate(`document.getElementById('toast').textContent`)),
    );
    await mkdir("artifacts", { recursive: true });
    const shot = await call("Page.captureScreenshot");
    await writeFile(
      "artifacts/" + id + ".png",
      Buffer.from(shot.data, "base64"),
    );
  }
  assert.deepEqual(browser.errors, []);
  console.log(
    "Evolution regressions passed: extinction recovery, replay, event compaction, and both analytic artworks.",
  );
} finally {
  await browser.close();
}
