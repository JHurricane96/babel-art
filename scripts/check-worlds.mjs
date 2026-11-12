import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openBrowser, sleep } from "./browser-session.mjs";
const b = await openBrowser({ port: 4181, debugPort: 9230 });
const { evaluate, call } = b;
const frame = () =>
  evaluate(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
const seek = async (t) => {
  await evaluate(
    `(async()=>{const r=window.babelDebug.runtime;while(r.pending)await new Promise(r=>setTimeout(r,20));window.babelDebug.project().time=${t};await r.seek(${t});})()`,
  );
  await frame();
};
try {
  await evaluate(
    `document.getElementById('play').click();document.getElementById('quality').value='1'`,
  );
  await mkdir("artifacts", { recursive: true });
  const images = new Set();
  for (const seed of [42, 43, 44]) {
    await evaluate(
      `document.querySelector('[data-scene="platformer"]').click();document.getElementById('seed').value=${seed};document.getElementById('seed').dispatchEvent(new Event('change'))`,
    );
    await seek(8);
    images.add(
      await evaluate(`document.getElementById('compositor').toDataURL()`),
    );
    const shot = await call("Page.captureScreenshot");
    await writeFile(
      `artifacts/terrarium-${seed}.png`,
      Buffer.from(shot.data, "base64"),
    );
    assert.equal(await evaluate("window.babelDebug.runtime.gl.getError()"), 0);
  }
  assert.equal(images.size, 3, "Biomes must have distinct compositions");
  for (const id of ["platformer", "murmuration"]) {
    await evaluate(`document.querySelector('[data-scene="${id}"]').click()`);
    await seek(id === "murmuration" ? 25 : 12);
    const expected = await evaluate(
      "JSON.stringify(window.babelDebug.runtime.sim.snapshot())",
    );
    const image = await evaluate(
      'document.getElementById("compositor").toDataURL()',
    );
    await seek(3);
    await seek(id === "murmuration" ? 25 : 12);
    assert.equal(
      await evaluate(
        "JSON.stringify(window.babelDebug.runtime.sim.snapshot())",
      ),
      expected,
      "World replay must remain exact",
    );
    await seek(id === "murmuration" ? 27 : 14);
    assert.notEqual(
      await evaluate('document.getElementById("compositor").toDataURL()'),
      image,
      "World must evolve",
    );
    const shot = await call("Page.captureScreenshot");
    await writeFile(
      `artifacts/world-${id}.png`,
      Buffer.from(shot.data, "base64"),
    );
    const start = await evaluate("window.babelDebug.runtime.sim.tick");
    await evaluate(
      `document.getElementById('quality').value='auto';document.getElementById('quality').dispatchEvent(new Event('change'));document.getElementById('play').click()`,
    );
    await sleep(5000);
    const playback = await evaluate(
      `(()=>{document.getElementById('play').click();const r=window.babelDebug.runtime;return {tick:r.sim.tick,states:r.states.size,images:r.entityTextures.size,gl:r.gl.getError(),fps:document.getElementById('fps').textContent};})()`,
    );
    assert.ok(
      playback.tick - start >= 60 &&
        playback.states <= 192 &&
        playback.images <= 64,
      JSON.stringify(playback),
    );
    assert.equal(playback.gl, 0);
    console.log(id, playback);
  }
  assert.deepEqual(b.errors, []);
  console.log(
    "World checks passed: distinct biomes, evolution, checkpoint replay, bounded live playback and graphics.",
  );
} finally {
  await b.close();
}
