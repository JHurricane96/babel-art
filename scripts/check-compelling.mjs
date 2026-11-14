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
  // A discovery must visibly change a repaired landmark, independently of motion.
  await evaluate(
    `(()=>{const r=babelDebug.runtime;window.landmarkCheckpoint=r.sim.snapshot();for(const s of r.sim.chunkStates.values())for(let i=0;i<3;i++){s.structures[i*3]=1;s.structures[i*3+2]=0;}r.renderStates.clear();r.capture();r.clearImages();})()`,
  );
  await frame();
  const unlit = await evaluate(
    "document.getElementById('compositor').toDataURL()",
  );
  await evaluate(
    `(()=>{const r=babelDebug.runtime;for(const s of r.sim.chunkStates.values())for(let i=0;i<3;i++)s.structures[i*3+2]=1;r.renderStates.clear();r.capture();r.clearImages();})()`,
  );
  await frame();
  assert.ok(
    (await evaluate("document.getElementById('compositor').toDataURL()")) !==
      unlit,
    "Discoveries must illuminate repaired landmarks",
  );
  await evaluate(
    `(()=>{const r=babelDebug.runtime;r.sim.restore(window.landmarkCheckpoint);r.renderStates.clear();r.capture();r.clearImages();delete window.landmarkCheckpoint;})()`,
  );
  assert.equal(identities.size, 4);
  // Camera travel must reach the compositor as a sub-pixel offset, and that
  // offset must move the image: slow pans glide instead of stepping.
  const glide = await evaluate(
    `(async()=>{const r=babelDebug.runtime,wait=()=>new Promise(res=>setTimeout(res,10));let fraction=null;for(let t=20;t<70&&fraction===null;t+=0.5){while(r.pending)await wait();babelDebug.project().time=t;await r.seek(t);const x=r.sim.camera.x;if(Math.abs(x-Math.round(x))>0.05)fraction={x,offset:r.renderer.sourceOffset(r.renderStates.get(r.sim.tick)??r.sim.captureFrame())[0]};}const original=r.renderer.sourceOffset,image=async shift=>{r.renderer.sourceOffset=()=>[shift,0];r.clearImages();await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res)));return document.getElementById('compositor').toDataURL();};const a=await image(0),b=await image(0.5);r.renderer.sourceOffset=original;r.clearImages();return {fraction,shifted:a!==b,gl:r.gl.getError()};})()`,
  );
  assert.ok(glide.fraction, "Camera travel must produce fractional positions");
  assert.ok(
    Math.abs(
      glide.fraction.offset - (glide.fraction.x - Math.floor(glide.fraction.x)),
    ) < 1e-6,
    "Renderer must report the camera's sub-pixel offset: " +
      JSON.stringify(glide),
  );
  assert.ok(glide.shifted, "Sub-pixel offsets must move the composited image");
  assert.equal(glide.gl, 0);
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
