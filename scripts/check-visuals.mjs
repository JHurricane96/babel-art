import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openBrowser, sleep } from "./browser-session.mjs";
const browser = await openBrowser({ port: 4178, debugPort: 9227 });
const { evaluate, call } = browser;
const frame = () =>
  evaluate(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
const seek = async (seconds) => {
  await evaluate(
    `(async()=>{const r=window.babelDebug.runtime;while(r.pending)await new Promise(resolve=>setTimeout(resolve,20));window.babelDebug.project().time=${seconds};await r.seek(${seconds});document.getElementById('time').value=${seconds};})()`,
  );
  await frame();
};
try {
  await evaluate("document.getElementById('play').click()");
  await mkdir("artifacts", { recursive: true });
  const rows = [];
  for (const [scene, palette] of [
    ["rivers", "lagoon"],
    ["chemical", "mineral"],
    ["tapestry", "cobalt"],
    ["murmuration", "orchid"],
    ["contours", "cobalt"],
    ["interference", "orchid"],
  ]) {
    await evaluate(
      `document.querySelector('[data-scene="${scene}"]').click();document.getElementById('palette').value='${palette}';document.getElementById('palette').dispatchEvent(new Event('change'));`,
    );
    await seek(scene === "chemical" ? 30 : 12);
    const stats = await evaluate(
      `(()=>{const c=document.getElementById('compositor'),s=document.createElement('canvas');s.width=160;s.height=100;const x=s.getContext('2d');x.drawImage(c,0,0,160,100);const p=x.getImageData(0,0,160,100).data,colors=new Set();let sum=0,sq=0,n=0;for(let i=0;i<p.length;i+=4){if(p[i+3]<240)continue;const y=(p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722)/255;sum+=y;sq+=y*y;n++;colors.add([p[i]>>4,p[i+1]>>4,p[i+2]>>4].join(','));}return {colors:colors.size,contrast:Math.sqrt(sq/n-(sum/n)**2),gl:window.babelDebug.runtime.gl.getError()};})()`,
    );
    assert.equal(stats.gl, 0, scene + " must render without graphics errors");
    assert.ok(
      stats.colors > 20 && stats.contrast > 0.035,
      scene +
        " must retain color range and spatial contrast: " +
        JSON.stringify(stats),
    );
    const before = await evaluate(
      "document.getElementById('compositor').toDataURL()",
    );
    const data = await evaluate(
      "JSON.stringify(window.babelDebug.runtime.sim?.snapshot().data)",
    );
    await evaluate(
      `(()=>{const label=[...document.querySelectorAll('#scene-parameters label')].find(l=>l.firstChild.textContent==='Surface detail');const field=label.querySelector('input');field.value='0';field.dispatchEvent(new Event('change'));})()`,
    );
    await frame();
    assert.notEqual(
      await evaluate("document.getElementById('compositor').toDataURL()"),
      before,
      scene + " detail control must affect the image",
    );
    assert.equal(
      await evaluate(
        "JSON.stringify(window.babelDebug.runtime.sim?.snapshot().data)",
      ),
      data,
      "Surface controls must preserve simulation state",
    );
    await evaluate(
      `(()=>{const label=[...document.querySelectorAll('#scene-parameters label')].find(l=>l.firstChild.textContent==='Surface detail');const field=label.querySelector('input');field.value='.8';field.dispatchEvent(new Event('change'));})()`,
    );
    await frame();
    const shot = await call("Page.captureScreenshot");
    await writeFile(
      `artifacts/rich-${scene}.png`,
      Buffer.from(shot.data, "base64"),
    );
    rows.push({ scene, ...stats });
  }
  await evaluate("document.querySelector('[data-scene=\"rivers\"]').click()");
  await seek(8);
  const expected = await evaluate(
    "JSON.stringify(window.babelDebug.runtime.sim.snapshot())",
  );
  await seek(3);
  await seek(8);
  assert.equal(
    await evaluate("JSON.stringify(window.babelDebug.runtime.sim.snapshot())"),
    expected,
    "Particle trails must replay exactly in browser",
  );
  const valid = await evaluate(
    `(async()=>{const r=window.babelDebug.runtime,p=window.babelDebug.project(),{validateProject}=await import('/shared/model.js');const saved=validateProject({...p,checkpoint:r.checkpoint(),events:r.events,initialParams:r.initialParams});return saved.checkpoint.data.length===Number(p.scene.params.population)*14;})()`,
  );
  assert.ok(valid, "Particle project must validate and preserve trails");
  const startTick = await evaluate("window.babelDebug.runtime.sim.tick");
  await evaluate("document.getElementById('play').click()");
  await sleep(5000);
  const playback = await evaluate(
    `(()=>{document.getElementById('play').click();const r=window.babelDebug.runtime;return {tick:r.sim.tick,fps:document.getElementById('fps').textContent,states:r.states.size,images:r.entityTextures.size,gl:r.gl.getError()};})()`,
  );
  assert.ok(
    playback.tick - startTick >= 60 &&
      playback.states <= 192 &&
      playback.images <= 64,
    "Live particle playback must make meaningful progress within resource limits: " +
      JSON.stringify(playback),
  );
  assert.equal(playback.gl, 0);
  assert.deepEqual(browser.errors, []);
  console.table(rows);
  console.log("Particle playback:", playback);
  console.log(
    "Visual checks passed: color/contrast, non-destructive surface controls, GPU rendering, particle replay and project validation.",
  );
} finally {
  await browser.close();
}
