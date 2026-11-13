import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openBrowser, sleep } from "./browser-session.mjs";
const b = await openBrowser({ port: 4185, debugPort: 9235 });
const { evaluate, call } = b;
const frame = () =>
  evaluate(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
const seek = (t) =>
  evaluate(
    `(async()=>{const r=babelDebug.runtime;while(r.pending)await new Promise(r=>setTimeout(r,10));babelDebug.project().time=${t};await r.seek(${t});})()`,
  );
try {
  await mkdir("artifacts", { recursive: true });
  await evaluate(
    `document.getElementById('play').click();document.getElementById('quality').value='1';document.querySelector('[data-scene="tapestry"]').click()`,
  );
  const instancing = await evaluate(
    `(async()=>{const r=babelDebug.runtime,g=r.gl,info=g.getExtension('WEBGL_debug_renderer_info'),original=g.getParameter;g.getParameter=function(k){return info&&k===info.UNMASKED_RENDERER_WEBGL?'Accelerated validation':original.call(this,k);};try{document.querySelector('[data-scene="rivers"]').click();babelDebug.project().time=1;await r.seek(1);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {enabled:!!r.renderer.ribbons,gl:g.getError()};}finally{g.getParameter=original;document.querySelector('[data-scene="tapestry"]').click();}})()`,
  );
  assert.ok(instancing.enabled);
  assert.equal(instancing.gl, 0, "Instanced WebGL2 ribbons");
  const agreement = await evaluate(
    `(async()=>{const {lifeGeneration}=await import('/engine/life.ts'),r=babelDebug.runtime,s=r.sim;s.params={...s.params,ecology:'unassisted',autonomous:false};const snap=s.snapshot(),cells=Uint8Array.from({length:snap.data.length/4},(_,i)=>snap.data[i*4]>127?1:0),expected=lifeGeneration(cells,s.width,s.height);for(let i=0;i<5;i++)s.step();const actual=s.snapshot();s.restore(snap);babelDebug.project().time=s.tick/60;return expected.every((v,i)=>v===(actual.data[i*4]>127?1:0));})()`,
  );
  assert.ok(agreement, "GPU must agree with reference Conway rules");
  for (const id of ["crosscurrents", "blooms", "constellations"]) {
    await evaluate(
      `(()=>{const s=document.getElementById('scene-preset');s.value='${id}';s.dispatchEvent(new Event('change'));})()`,
    );
    await seek(17);
    const expected = await evaluate(
      "JSON.stringify(babelDebug.runtime.sim.snapshot())",
    );
    await seek(2);
    await seek(17);
    assert.equal(
      await evaluate("JSON.stringify(babelDebug.runtime.sim.snapshot())"),
      expected,
      "Life director replay " + id,
    );
    await frame();
    const shot = await call("Page.captureScreenshot");
    await writeFile(
      "artifacts/life-" + id + ".png",
      Buffer.from(shot.data, "base64"),
    );
  }
  await evaluate(
    `document.querySelector('[data-scene="terrarium-worlds"]').click()`,
  );
  const identities = new Set();
  for (const id of ["canopy", "caverns", "aqueduct", "tidal"]) {
    await evaluate(
      `(()=>{const s=document.getElementById('scene-preset');s.value='${id}';s.dispatchEvent(new Event('change'));})()`,
    );
    await seek(24);
    await frame();
    const result = await evaluate(
      `(async()=>{const r=babelDebug.runtime,p=babelDebug.project(),{validateProject}=await import('/shared/model.js');validateProject({...p,checkpoint:r.checkpoint()});return {stats:r.sim.stats,gl:r.gl.getError(),frame:document.getElementById('compositor').toDataURL(),snapshot:JSON.stringify(r.sim.snapshot())};})()`,
    );
    assert.equal(result.gl, 0);
    assert.ok(
      result.stats.pollinations > 0 &&
        result.stats.meals > 0 &&
        result.stats.repairs > 0,
    );
    identities.add(result.frame);
    const shot = await call("Page.captureScreenshot");
    await writeFile(
      "artifacts/terrarium-worlds-" + id + ".png",
      Buffer.from(shot.data, "base64"),
    );
    await seek(4);
    await seek(24);
    assert.equal(
      await evaluate("JSON.stringify(babelDebug.runtime.sim.snapshot())"),
      result.snapshot,
      "World replay " + id,
    );
    const snap = await evaluate(
      "JSON.stringify(babelDebug.runtime.sim.snapshot())",
    );
    await evaluate(`document.getElementById('quality').value='0.75'`);
    await frame();
    assert.equal(
      await evaluate("JSON.stringify(babelDebug.runtime.sim.snapshot())"),
      snap,
      "Quality must preserve world",
    );
    console.log(id, result.stats);
  }
  assert.equal(identities.size, 4);
  await evaluate(
    `document.getElementById('quality').value='auto';document.getElementById('play').click()`,
  );
  const start = await evaluate("babelDebug.runtime.sim.tick");
  await sleep(4000);
  const live = await evaluate(
    `(()=>{document.getElementById('play').click();const r=babelDebug.runtime;return {tick:r.sim.tick,states:r.states.size,textures:r.entityTextures.size,metrics:r.metrics,gl:r.gl.getError(),fps:document.getElementById('fps').textContent};})()`,
  );
  assert.ok(
    live.tick - start > 100 && live.states <= 192 && live.textures <= 64,
    JSON.stringify(live),
  );
  assert.equal(live.gl, 0);
  assert.equal(live.metrics.canvasUploads, 0);
  assert.deepEqual(b.errors, []);
  console.log("Compelling art checks passed", live);
} finally {
  await b.close();
}
