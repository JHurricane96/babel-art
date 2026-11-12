import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(os.tmpdir(), "babel-chemical-"));
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "4175",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
const browser = spawn(
  process.env.CHROME_BIN || "chromium",
  [
    "--remote-debugging-address=127.0.0.1",
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--remote-debugging-port=9224",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browserLog = "";
browser.stderr?.on("data", (chunk) => {
  browserLog = (browserLog + chunk.toString()).slice(-4000);
});
let socket;
try {
  let tab;
  for (let i = 0; i < 300; i++) {
    try {
      tab = (await (await fetch("http://127.0.0.1:9224/json")).json()).find(
        (t) => t.type === "page",
      );
      if (tab) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(tab, "Chromium CDP should start: " + browserLog);
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  let next = 0;
  const pending = new Map(),
    errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) p.reject(new Error(JSON.stringify(message.error)));
      else p.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await mkdir("artifacts", { recursive: true });
  await call("Page.navigate", { url: "http://127.0.0.1:4175" });
  for (let i = 0; i < 100 && !(await evaluate("!!window.babelDebug")); i++)
    await sleep(100);
  await evaluate(
    `document.getElementById('play').click();document.querySelector('[data-scene="chemical"]').click()`,
  );
  if (process.argv.includes("--diagnose")) {
    console.log(
      "Before selection:",
      await evaluate(
        `document.querySelector('#scene-parameters select').value`,
      ),
    );
    await evaluate(
      `const s=document.querySelector('#scene-parameters select');s.value='Coral';s.dispatchEvent(new Event('change'))`,
    );
    console.log(
      "After choosing Coral:",
      await evaluate(
        `({label:document.querySelector('#scene-parameters select').value,params:window.babelDebug.project().scene.params})`,
      ),
    );
  }
  const metrics = await evaluate(`(async()=>{
    const {Grid}=await import('/engine/grid.ts');
    const {defaults}=await import('/scenes/registry.ts');
    const {CHEMICAL_PRESETS}=await import('/engine/chemical.ts');
    const gl=window.babelDebug.runtime.gl,results=[];
    const cases=Object.entries(CHEMICAL_PRESETS).flatMap(([name,recipe])=>[42,1337].map(seed=>({name,recipe,seed,resolution:128})));
    cases.push({name:'Dividing cells',recipe:CHEMICAL_PRESETS['Dividing cells'],seed:42,resolution:256});
    for(const {name,recipe,seed,resolution}of cases){
      const sim=new Grid(gl,seed,{...defaults('chemical'),...recipe,resolution,autonomous:false},true);
      try{
        const at=[];let prior;
        for(let tick=1;tick<=1800;tick++){
          sim.step();
          if([60,600,1800].includes(tick)){
            const data=sim.snapshot().data;let active=0,max=0,min=1,sum=0,squares=0,change=0;
            for(let i=1;i<data.length;i+=4){const b=data[i];active+=b>.1?1:0;max=Math.max(max,b);min=Math.min(min,b);sum+=b;squares+=b*b;if(prior)change+=Math.abs(b-prior[i]);}
            const n=data.length/4;
            at.push({tick,active:active/n,max,min,std:Math.sqrt(Math.max(0,squares/n-(sum/n)**2)),finite:data.every(Number.isFinite),change:change/n});prior=data;
          }
        }
        results.push({name,seed,resolution,at,error:gl.getError()});
      }finally{sim.dispose();}
    }
    return results;
  })()`);
  console.table(
    metrics.map((p) => ({
      preset: p.name,
      seed: p.seed,
      resolution: p.resolution,
      activeAt10s: p.at[1].active,
      activeAt30s: p.at[2].active,
      contrastAt30s: p.at[2].std,
      change: p.at[2].change,
    })),
  );
  if (process.argv.includes("--diagnose")) process.exitCode = 0;
  else {
    for (const preset of metrics) {
      assert.equal(preset.error, 0, preset.name + " GPU errors");
      assert.ok(
        preset.at.at(-1).change > 1e-4,
        preset.name + " must keep evolving",
      );
      for (const m of preset.at) {
        assert.ok(m.finite, preset.name + " must remain finite");
        assert.ok(
          m.active > 0.005 && m.active < 0.95,
          preset.name + " must retain a nonuniform active pattern",
        );
        assert.ok(m.std > 0.02, preset.name + " must retain spatial contrast");
      }
    }
    for (const name of ["Coral", "Dividing cells", "Labyrinth"]) {
      // Recover an actually extinct world, including one restored from a save.
      await evaluate(
        `(async()=>{const r=window.babelDebug.runtime,p=window.babelDebug.project();p.time=2;await r.seek(2);const s=r.sim.snapshot();for(let i=0;i<s.data.length;i+=4){s.data[i]=1;s.data[i+1]=0;}r.sim.restore(s);p.checkpoint=r.checkpoint();})()`,
      );

      await evaluate(
        `(()=>{const s=document.getElementById('chemical-preset');s.value=${JSON.stringify(name)};s.dispatchEvent(new Event('change'));})()`,
      );
      await sleep(100);
      assert.equal(
        await evaluate(`document.getElementById('chemical-preset').value`),
        name,
        "Selected preset must remain visible",
      );
      assert.equal(
        await evaluate("window.babelDebug.runtime.sim.tick"),
        0,
        "Preset starts a fresh garden",
      );
      assert.equal(await evaluate("window.babelDebug.project().time"), 0);
      assert.ok(
        await evaluate(
          `window.babelDebug.runtime.sim.snapshot().data.some((v,i)=>i%4===1&&v>.1)`,
        ),
        "Preset restores viable reagent clusters",
      );
      assert.equal(
        await evaluate(`'checkpoint' in window.babelDebug.project()`),
        false,
        "Preset must discard the extinct saved checkpoint",
      );
      await evaluate(
        `document.getElementById('time').value='30';document.getElementById('time').dispatchEvent(new Event('change'))`,
      );
      for (
        let i = 0;
        i < 150 &&
        (await evaluate(
          "window.babelDebug.runtime.sim.tick!==1800||window.babelDebug.runtime.pending",
        ));
        i++
      )
        await sleep(100);
      assert.equal(await evaluate("window.babelDebug.runtime.sim.tick"), 1800);
      const capture = await call("Page.captureScreenshot");
      await writeFile(
        "artifacts/chemical-" +
          name.toLowerCase().replace(/ /g, "-") +
          "-fixed.png",
        Buffer.from(capture.data, "base64"),
      );
    }
    await evaluate(
      `document.getElementById('time').value='10';document.getElementById('time').dispatchEvent(new Event('change'))`,
    );
    await sleep(1000);
    await evaluate(`document.getElementById('chemical-restart').click()`);
    await sleep(100);
    assert.equal(
      await evaluate("window.babelDebug.runtime.sim.tick"),
      0,
      "Restart resets simulation",
    );
    assert.equal(
      await evaluate(`document.getElementById('chemical-preset').value`),
      "Labyrinth",
    );
    await evaluate(
      `document.getElementById('palette').value='ember';document.getElementById('palette').dispatchEvent(new Event('change'))`,
    );
    assert.equal(
      await evaluate(`document.getElementById('chemical-preset').value`),
      "Labyrinth",
      "Other controls preserve the preset label",
    );
    await evaluate(
      `const feed=[...document.querySelectorAll('#scene-parameters label')].find(l=>l.textContent.includes('Feed rate')).querySelector('input');feed.value='.04';feed.dispatchEvent(new Event('change'))`,
    );
    assert.equal(
      await evaluate(`document.getElementById('chemical-preset').value`),
      "",
      "Manual tuning is marked as custom",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Chemical Garden regressions passed: all presets stay alive, retain their selection, and restart cleanly.",
    );
  }
} finally {
  socket?.close();
  browser.kill();
  server.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}
