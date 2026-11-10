// Dependency-free Chromium/CDP smoke test. CHROME_BIN can select another binary.
import {spawn} from 'node:child_process';import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const profile=await mkdtemp(path.join(os.tmpdir(),'babel-browser-'));
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'4174'},stdio:'ignore'});
const browser=spawn(process.env.CHROME_BIN||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9223',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let socket;
try{
 let tabs;for(let i=0;i<100;i++){try{tabs=await(await fetch('http://localhost:9223/json')).json();if(tabs.length)break;}catch{}await sleep(100);}if(!tabs?.length)throw new Error('Chromium CDP unavailable');
 socket=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),errors=[];
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:'http://localhost:4174'});await sleep(1500);
 assert.equal(await evaluate(`document.querySelectorAll('canvas[data-renderer="webgl"]').length`),4);
 await evaluate(`document.getElementById('play').click()`);await sleep(100);
 for(const scene of ['ribbons','julia','fireflies','test']){await evaluate(`document.querySelector('[data-scene="${scene}"]').click()`);await sleep(150);assert.equal(await evaluate(`document.querySelector('.scene.active').dataset.scene`),scene);}
 const image=()=>evaluate(`document.querySelector('canvas').toDataURL()`);
 const a=await image();await evaluate(`document.getElementById('compare').click()`);await sleep(100);assert.equal(await image(),a,'Aligned timing profile must match reference');
 await evaluate(`document.getElementById('timing-preset').value='exaggerated';document.getElementById('apply-timing').click()`);await sleep(150);
 assert.equal(await evaluate(`document.getElementById('compare').getAttribute('aria-pressed')`),'true');
 const delayed=await evaluate(`document.querySelectorAll('canvas')[1].toDataURL()`);
 const playhead=await evaluate(`document.getElementById('time').value`);
 await evaluate(`document.getElementById('compare').click()`);await sleep(100);
 assert.notEqual(await evaluate(`document.querySelectorAll('canvas')[1].toDataURL()`),delayed,'Delay must visibly change the sync pattern');
 assert.equal(await evaluate(`document.getElementById('time').value`),playhead,'A/B must preserve paused playhead');
 await evaluate(`document.getElementById('compare').click()`);await sleep(100);
 assert.equal(await evaluate(`document.querySelectorAll('canvas')[1].toDataURL()`),delayed,'A/B must reproduce identical delayed output');
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
