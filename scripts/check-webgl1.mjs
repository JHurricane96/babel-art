import assert from "node:assert/strict";
import { openBrowser } from "./browser-session.mjs";
const b = await openBrowser({ port: 4188, debugPort: 9238, webgl1: true });
try {
  assert.equal(
    await b.evaluate("babelDebug.runtime.gl instanceof WebGL2RenderingContext"),
    false,
  );
  await b.evaluate(`document.getElementById('play').click()`);
  for (const id of [
    "rivers",
    "slime",
    "murmuration",
    "tapestry",
    "terrarium-worlds",
  ]) {
    await b.evaluate(`document.querySelector('[data-scene="${id}"]').click()`);
    await b.evaluate(
      `(async()=>{const r=babelDebug.runtime;babelDebug.project().time=5;await r.seek(5);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
    );
    const state = await b.evaluate(
      `(()=>{const r=babelDebug.runtime,pixels=new Uint8Array(4);r.gl.readPixels(r.canvas.width>>1,r.canvas.height>>1,1,1,r.gl.RGBA,r.gl.UNSIGNED_BYTE,pixels);return {gl:r.gl.getError(),tick:r.sim.tick,lost:r.gl.isContextLost()};})()`,
    );
    assert.equal(state.gl, 0, id);
    assert.equal(state.tick, 300, id);
    assert.equal(state.lost, false, id);
    console.log(id, "WebGL1 passed");
  }
  const instancing = await b.evaluate(
    `(async()=>{const r=babelDebug.runtime,g=r.gl,info=g.getExtension('WEBGL_debug_renderer_info'),original=g.getParameter;g.getParameter=function(k){return info&&k===info.UNMASKED_RENDERER_WEBGL?'Accelerated validation':original.call(this,k);};try{document.querySelector('[data-scene="rivers"]').click();babelDebug.project().time=1;await r.seek(1);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {enabled:!!r.renderer.ribbons,gl:g.getError()};}finally{g.getParameter=original;}})()`,
  );
  assert.ok(instancing.enabled);
  assert.equal(instancing.gl, 0, "ANGLE instanced ribbons");
  assert.deepEqual(b.errors, []);
} finally {
  await b.close();
}
