// Dependency-free Chromium/CDP smoke test. CHROME_BIN can select another binary.
import {spawn} from 'node:child_process';import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const profile=await mkdtemp(path.join(os.tmpdir(),'babel-browser-'));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4174'],{env:{...process.env,PORT:'4174'},stdio:'ignore'});
const browser=spawn(process.env.CHROME_BIN||'chromium',['--remote-debugging-address=127.0.0.1','--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9223',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let browserLog='';browser.stderr?.on('data',chunk=>{browserLog=(browserLog+chunk.toString()).slice(-4000);});
let socket;
try{
 let tabs;for(let i=0;i<300;i++){try{tabs=await(await fetch('http://127.0.0.1:9223/json')).json();if(tabs.length)break;}catch{}await sleep(100);}if(!tabs?.length)throw new Error('Chromium CDP unavailable (exit '+browser.exitCode+'): '+browserLog);
 socket=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),errors=[];
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:'http://127.0.0.1:4174'});await sleep(1500);
 assert.equal(await evaluate(`document.querySelectorAll('#compositor').length`),1);
 await evaluate(`document.getElementById('play').click()`);await sleep(100);
 await mkdir('artifacts',{recursive:true});
 for(const scene of ['ribbons','julia','fireflies','interference','contours','slime','rivers','tapestry','chemical','murmuration','platformer','test']){if(!await evaluate(`!!document.querySelector('[data-scene="${scene}"]')`))continue;await evaluate(`document.querySelector('[data-scene="${scene}"]').click()`);await sleep(150);assert.equal(await evaluate(`document.querySelector('.scene.active').dataset.scene`),scene);if(['tapestry','chemical','murmuration','platformer','rivers','slime'].includes(scene)){await evaluate(`document.getElementById('time').value='1';document.getElementById('time').dispatchEvent(new Event('change'))`);await sleep(1000);assert.equal(await evaluate(`window.babelDebug.runtime.sim.tick`),60,scene+': '+JSON.stringify(errors));assert.equal(await evaluate(`window.babelDebug.runtime.gl.getError()`),0,scene+' must render without GL errors');const shot=await call('Page.captureScreenshot');await writeFile('artifacts/'+scene+'.png',Buffer.from(shot.data,'base64'));const same=await evaluate(`(()=>{const r=window.babelDebug.runtime,s=r.sim.snapshot();r.sim.step();const a=r.sim.snapshot();r.sim.restore(s);r.sim.step();return JSON.stringify(a)===JSON.stringify(r.sim.snapshot());})()`);assert.ok(same,scene+' checkpoint must replay');if(process.env.ENDURANCE==='1'){console.log('Endurance starting: '+scene);await evaluate(`window.babelDebug.project().time=1800;window.babelDebug.runtime.seek(1800)`);assert.equal(await evaluate(`window.babelDebug.runtime.sim.tick`),108000);assert.ok(await evaluate(`window.babelDebug.runtime.history.size<=192&&window.babelDebug.runtime.states.size<=192&&window.babelDebug.runtime.checkpoints.size<=8`));console.log('30 simulated minutes complete: '+scene);}}}
 await evaluate(`document.getElementById('time').value='12';document.getElementById('time').dispatchEvent(new Event('change'))`);await sleep(100);
 if(await evaluate(`!!document.querySelector('[data-scene="platformer"]')`)){await evaluate(`document.querySelector('[data-scene="platformer"]').click();document.getElementById('time').value='1';document.getElementById('time').dispatchEvent(new Event('change'))`);await sleep(500);const state=await evaluate(`JSON.stringify(window.babelDebug.runtime.sim.snapshot())`);await evaluate(`document.getElementById('command').value='geometric';document.getElementById('command-form').requestSubmit()`);await sleep(100);assert.equal(await evaluate(`JSON.stringify(window.babelDebug.runtime.sim.snapshot())`),state,'Style changes must preserve autonomous gameplay');assert.equal(await evaluate(`window.babelDebug.project().scene.style`),'geometric');await evaluate(`document.querySelector('[data-scene="test"]').click();document.getElementById('time').value='12';document.getElementById('time').dispatchEvent(new Event('change'))`);await sleep(100);}
 const image=()=>evaluate(`document.getElementById('compositor').toDataURL()`);
 const a=await image();await evaluate(`document.getElementById('compare').click()`);await sleep(100);assert.equal(await image(),a,'Aligned timing profile must match reference');
 await evaluate(`document.getElementById('timing-preset').value='exaggerated';document.getElementById('apply-timing').click()`);await sleep(150);
 assert.equal(await evaluate(`document.getElementById('compare').getAttribute('aria-pressed')`),'true');
 const delayed=await evaluate(`document.getElementById('compositor').toDataURL()`);
 const playhead=await evaluate(`document.getElementById('time').value`);
 await evaluate(`document.getElementById('compare').click()`);await sleep(100);
 assert.notEqual(await evaluate(`document.getElementById('compositor').toDataURL()`),delayed,'Delay must visibly change the sync pattern');
 assert.equal(await evaluate(`document.getElementById('time').value`),playhead,'A/B must preserve paused playhead');
 await evaluate(`document.getElementById('compare').click()`);await sleep(100);
 assert.equal(await evaluate(`document.getElementById('compositor').toDataURL()`),delayed,'A/B must reproduce identical delayed output');
 await evaluate(`document.getElementById('save-name').value='Browser test';document.getElementById('save').click();document.getElementById('gallery-open').click()`);
 assert.equal(await evaluate(`document.querySelectorAll('.saved').length`),1);await evaluate(`document.getElementById('gallery-close').click()`);
 await evaluate(`document.getElementById('command').value='make it calmer';document.getElementById('command-form').requestSubmit()`);assert.ok(Math.abs(Number(await evaluate(`document.getElementById('speed').value`))-.455)<.01);
 // Range controls round values in their DOM representation.
 await evaluate(`document.querySelector('[data-scene="ribbons"]').click();document.getElementById('compare').click()`);await sleep(200);
 await evaluate(`document.querySelector('[data-tab="layout"]').click();document.getElementById('geo-rotation').value='15';document.getElementById('geo-rotation').dispatchEvent(new Event('change'))`);
 assert.ok(await evaluate(`document.querySelector('.panel').style.transform.includes('15deg')`));
 await evaluate(`document.getElementById('geo-rotation').value='0';document.getElementById('geo-rotation').dispatchEvent(new Event('change'));document.querySelector('[data-tab="artwork"]').click()`);
 assert.equal(await evaluate(`getComputedStyle(document.getElementById('import')).display`),'none');
 await mkdir('artifacts',{recursive:true});const shot=await call('Page.captureScreenshot');await writeFile('artifacts/desktop.png',Buffer.from(shot.data,'base64'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(250);
 assert.ok(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),'Mobile layout should not overflow horizontally');
 const mobile=await call('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile('artifacts/mobile.png',Buffer.from(mobile.data,'base64'));
 assert.deepEqual(errors,[]);console.log('Browser checks passed: 4 WebGL panels, all scenes, A/B, gallery, commands, responsive layout, no JS exceptions. Screenshots: artifacts/.');
}finally{socket?.close();browser.kill();server.kill();await sleep(300);await rm(profile,{recursive:true,force:true});}
