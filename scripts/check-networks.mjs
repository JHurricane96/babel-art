import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openBrowser, sleep } from "./browser-session.mjs";
const browser = await openBrowser({ port: 4179, debugPort: 9229 });
const { evaluate, call } = browser;
const frame = () =>
  evaluate(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
const seek = async (seconds) => {
  await evaluate(
    `(async()=>{const r=window.babelDebug.runtime;while(r.pending)await new Promise(r=>setTimeout(r,20));window.babelDebug.project().time=${seconds};await r.seek(${seconds});})()`,
  );
  await frame();
};
try {
  await evaluate(
    "document.getElementById('play').click();document.querySelector('[data-scene=\"slime\"]').click()",
  );
  await mkdir("artifacts", { recursive: true });
  const rows = [],
    images = new Set();
  for (const id of ["mycelium", "copper", "bloom"]) {
    await evaluate(
      `(()=>{const s=document.getElementById('scene-preset');s.value='${id}';s.dispatchEvent(new Event('change'));})()`,
    );
    assert.equal(await evaluate("window.babelDebug.runtime.sim.tick"), 0);
    assert.equal(
      await evaluate("document.getElementById('scene-preset').value"),
      id,
    );
    await seek(12);
    const stats = await evaluate(
      `(()=>{const c=document.getElementById('compositor'),small=document.createElement('canvas');small.width=160;small.height=100;const x=small.getContext('2d');x.drawImage(c,0,0,160,100);const a=x.getImageData(0,0,160,100).data,colors=new Set();let n=0,sum=0,sq=0;for(let i=0;i<a.length;i+=4){if(a[i+3]<240)continue;const y=(a[i]*.2126+a[i+1]*.7152+a[i+2]*.0722)/255;n++;sum+=y;sq+=y*y;colors.add([a[i]>>4,a[i+1]>>4,a[i+2]>>4].join(','));}return {contrast:Math.sqrt(sq/n-(sum/n)**2),colors:colors.size,gl:window.babelDebug.runtime.gl.getError()};})()`,
    );
    assert.ok(
      stats.contrast > 0.04 && stats.colors > 25,
      id + ": " + JSON.stringify(stats),
    );
    assert.equal(stats.gl, 0);
    const image = await evaluate(
      "document.getElementById('compositor').toDataURL()",
    );
    images.add(image);
    const shot = await call("Page.captureScreenshot");
    await writeFile(
      `artifacts/slime-${id}.png`,
      Buffer.from(shot.data, "base64"),
    );
    await seek(20);
    assert.notEqual(
      await evaluate("document.getElementById('compositor').toDataURL()"),
      image,
      "Network must evolve visibly",
    );
    rows.push({ preset: id, ...stats });
  }
  assert.equal(images.size, 3);
  const recovery = await evaluate(
    `(()=>{const r=window.babelDebug.runtime;r.sim.agents.fill(NaN);r.health.reset();r.observeHealth(1);return {finite:r.sim.snapshot().data.every(Number.isFinite),events:r.events.filter(e=>e.intervention?.kind===3).length};})()`,
  );
  assert.ok(
    recovery.finite && recovery.events > 0,
    "Invalid agents must trigger a logged complete recovery",
  );
  await seek(21);
  const expected = await evaluate(
    "JSON.stringify(window.babelDebug.runtime.sim.snapshot())",
  );
  await seek(0);
  await seek(21);
  assert.equal(
    await evaluate("JSON.stringify(window.babelDebug.runtime.sim.snapshot())"),
    expected,
    "Network interventions must replay exactly",
  );
  assert.ok(
    await evaluate(
      `(async()=>{const {validateProject}=await import('/shared/model.js'),r=window.babelDebug.runtime,p=window.babelDebug.project();return !!validateProject({...p,checkpoint:r.checkpoint(),events:r.events,initialParams:r.initialParams}).checkpoint;})()`,
    ),
  );
  const physics = await evaluate(
    "JSON.stringify(window.babelDebug.runtime.sim.snapshot())",
  );
  // High is the default; adaptive behavior is exercised under Auto.
  await evaluate(
    "document.getElementById('quality').value='auto';document.getElementById('quality').dispatchEvent(new Event('change'));for(let i=0;i<200;i++)window.babelDebug.quality.observe(1/15,true)",
  );
  await frame();
  assert.equal(await evaluate("window.babelDebug.runtime.entityScale"), 0.5);
  assert.equal(
    await evaluate("JSON.stringify(window.babelDebug.runtime.sim.snapshot())"),
    physics,
    "Adaptive resolution must preserve all physics",
  );
  await evaluate(
    "document.getElementById('quality').value='1';document.getElementById('quality').dispatchEvent(new Event('change'))",
  );
  await frame();
  assert.equal(await evaluate("window.babelDebug.runtime.entityScale"), 1);
  await evaluate(
    "document.getElementById('quality').value='auto';document.getElementById('quality').dispatchEvent(new Event('change'));document.getElementById('play').click()",
  );
  await sleep(6000);
  const playback = await evaluate(
    `(()=>{document.getElementById('play').click();const r=window.babelDebug.runtime;return {tick:r.sim.tick,fps:document.getElementById('fps').textContent,scale:r.entityScale,states:r.states.size,bytes:[...r.states.values()].reduce((a,s)=>a+(s.data.byteLength??s.data.length*8),0),textureBytes:r.entityTextures.size*r.entityCanvas.width*r.entityCanvas.height*4,checkpoints:r.checkpoints.size,gl:r.gl.getError()};})()`,
  );
  assert.ok(
    playback.tick >= 1320,
    "Live simulation must make progress: " + JSON.stringify(playback),
  );
  assert.ok(
    playback.bytes <= 32 * 1024 * 1024 &&
      playback.textureBytes <= 64 * 1024 * 1024 &&
      playback.checkpoints <= 8,
  );
  assert.equal(playback.gl, 0);
  assert.deepEqual(browser.errors, []);
  console.table(rows);
  console.log("Network playback:", playback);
  console.log(
    "Network checks passed: curated presets, visual range, evolving feedback, recovery replay, saves, adaptive/manual resolution and bounded playback.",
  );
} finally {
  await browser.close();
}
