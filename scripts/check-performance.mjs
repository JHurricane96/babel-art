import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openBrowser, sleep } from "./browser-session.mjs";
const seconds = Math.max(1, Number(process.env.BABEL_PROFILE_SECONDS ?? 3));
const b = await openBrowser({ port: 4186, debugPort: 9236 });
const rows = [];
try {
  const renderer = await b.evaluate(
    `(()=>{const g=babelDebug.runtime.gl,e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)})()`,
  );
  await b.evaluate(
    `document.getElementById('play').click();document.getElementById('quality').value='1';`,
  );
  for (const [id, max] of [
    ["rivers", 1800],
    ["slime", 4000],
    ["murmuration", 4000],
    ["terrarium-worlds", 128],
  ])
    for (const mode of ["default", "maximum/mixed timing"]) {
      await b.evaluate(
        `(async()=>{document.querySelector('[data-scene="${id}"]').click();const r=babelDebug.runtime,p=babelDebug.project();p.scene.speed=1;if(${JSON.stringify(mode)}!=='default'){p.scene.params.population=${max};const {TIMING_PRESETS}=await import('/shared/timing.js');p.layout.forEach((panel,i)=>panel.timing=TIMING_PRESETS.exaggerated(i));p.timingEnabled=true;}else p.timingEnabled=false;r.key='';r.setup(p.scene,p.world);p.time=0;document.getElementById('play').click();})()`,
      );
      await sleep(1800);
      await b.evaluate(`(()=>{const r=babelDebug.runtime;window.perfProbe={start:performance.now(),tick:r.sim.tick,frames:[],last:0,methods:{},undo:[],metrics:{...r.metrics}};const q=perfProbe;
   const observe=(t)=>{if(window.perfProbe!==q)return;if(q.last)q.frames.push(t-q.last);q.last=t;requestAnimationFrame(observe)};requestAnimationFrame(observe);
   const wrap=(object,key)=>{const orig=object[key];if(typeof orig!=='function')return;const row=q.methods[key]={calls:0,totalMs:0,durations:[]};object[key]=function(...a){const t=performance.now();try{return orig.apply(this,a)}finally{const d=performance.now()-t;row.calls++;row.totalMs+=d;row.durations.push(d)}};q.undo.push(()=>object[key]=orig)};
   for(const name of ['step','snapshot','captureFrame'])wrap(r.sim,name);wrap(r,'entityTexture');
  })()`);
      await sleep(seconds * 1000);
      const result =
        await b.evaluate(`(()=>{const r=babelDebug.runtime,q=perfProbe;document.getElementById('play').click();q.undo.forEach(f=>f());const elapsedMs=performance.now()-q.start;
   const percentile=(v,p)=>{const a=v.slice().sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor(a.length*p))]??0};
   const result={elapsedMs,frames:q.frames.length,averageFps:q.frames.length/(q.frames.reduce((a,b)=>a+b,0)/1000),p95Ms:percentile(q.frames,.95),p99Ms:percentile(q.frames,.99),tickProgress:r.sim.tick-q.tick,scale:r.entityScale,states:r.states.size,historyBytes:[...r.states.values()].reduce((n,s)=>n+(s.data.byteLength??s.data.length*8),0),textureBytes:r.entityTextures.size*r.entityCanvas.width*r.entityCanvas.height*4,metrics:Object.fromEntries(Object.keys(r.metrics).map(k=>[k,r.metrics[k]-q.metrics[k]])),methods:Object.fromEntries(Object.entries(q.methods).map(([k,v])=>[k,{calls:v.calls,totalMs:v.totalMs,p95Ms:percentile(v.durations,.95)}])),gl:r.gl.getError()};window.perfProbe=undefined;return result;})()`);
      assert.equal(result.gl, 0, id + " GL");
      assert.equal(
        result.metrics.canvasUploads,
        0,
        id + " must use native GPU rendering",
      );
      assert.ok(
        result.methods.snapshot.calls <=
          Math.ceil(result.tickProgress / 300) + 2,
        id + " must only serialize checkpoints",
      );
      assert.ok(
        result.states <= 192 &&
          result.historyBytes <= 32 * 1024 * 1024 &&
          result.textureBytes <= 64 * 1024 * 1024,
        id + " resource budgets",
      );
      assert.ok(
        result.tickProgress >
          (/swiftshader|llvmpipe|software/i.test(renderer) ? 0 : seconds * 20),
        id + " live simulation progress",
      );
      const before = await b.evaluate(
        "JSON.stringify(babelDebug.runtime.metrics)",
      );
      await b.evaluate(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      assert.equal(
        await b.evaluate("JSON.stringify(babelDebug.runtime.metrics)"),
        before,
        "Paused frames must reuse textures",
      );
      rows.push({ scene: id, mode, ...result });
      console.log(
        id,
        mode,
        Math.round(result.averageFps) + " FPS",
        result.p95Ms.toFixed(1) + " ms p95",
        result.metrics,
      );
    }
  assert.deepEqual(b.errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/performance.json",
    JSON.stringify({ renderer, seconds, rows }, null, 2),
  );
  console.log("Performance invariants passed. Renderer:", renderer);
} finally {
  await b.close();
}
