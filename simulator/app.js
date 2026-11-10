import { SCENES, PALETTES, makeProject, makeLayout, layoutBounds, dailySeed, validateProject } from '../shared/model.js';
import { frameAt, TIMING_PRESETS } from '../shared/timing.js';
import { PanelRenderer } from '../renderer/panel.js';
const $=id=>document.getElementById(id), clone=v=>structuredClone(v);
let project=makeProject(), selected=0, playing=true, last=performance.now(), fit={scale:1,x:0,y:0}, gallery=[], undo=[], saveTimer, toastTimer;
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',4000);}
try { const saved=localStorage.getItem('babel.project.v1');if(saved)project=validateProject(JSON.parse(saved));const g=JSON.parse(localStorage.getItem('babel.gallery.v1')||'[]');if(Array.isArray(g))gallery=g.filter(x=>{try{validateProject(x.project);return typeof x.name==='string';}catch{return false;}}); }catch{toast('Stored data could not be restored. A fresh project is open.');}
function persist(){try{localStorage.setItem('babel.project.v1',JSON.stringify(project));localStorage.setItem('babel.gallery.v1',JSON.stringify(gallery));}catch{toast('Browser storage is unavailable or full. Export JSON to preserve your work.');}}
function changed(){clearTimeout(saveTimer);saveTimer=setTimeout(persist,300);}
function remember(){undo.push(clone(project));if(undo.length>30)undo.shift();}
function update(fn){remember();fn(project);sync();changed();}
const panels=project.layout.map((p,i)=>{
 const node=document.createElement('div');node.className='panel';node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label',`Select and drag panel ${i+1}`);
 const canvas=document.createElement('canvas');const tag=document.createElement('span');tag.className='panel-tag';tag.textContent=String(i+1).padStart(2,'0');node.append(canvas,tag);$('wall').append(node);
 let renderer;try{renderer=new PanelRenderer(canvas);}catch(e){toast(e.message);node.textContent=e.message;}
 node.addEventListener('focus',()=>{selected=i;syncInspectors();});
 node.addEventListener('pointerdown',e=>{if(e.button!==0)return;selected=i;syncInspectors();remember();const start={x:e.clientX,y:e.clientY,px:project.layout[i].x,py:project.layout[i].y,scale:fit.scale};node.setPointerCapture(e.pointerId);
 const move=ev=>{project.layout[i].x=Math.max(-5000,Math.min(5000,start.px+(ev.clientX-start.x)/start.scale));project.layout[i].y=Math.max(-5000,Math.min(5000,start.py+(ev.clientY-start.y)/start.scale));position(false);syncFields();};
 const stop=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',stop);node.removeEventListener('pointercancel',stop);position();changed();};node.addEventListener('pointermove',move);node.addEventListener('pointerup',stop);node.addEventListener('pointercancel',stop);
 });return{node,canvas,renderer};
});
function position(refit=true){
 const bounds=layoutBounds(project.layout),wall=$('wall');
 if(refit){const scale=Math.min(wall.clientWidth/bounds.width,wall.clientHeight/bounds.height)*.91;fit={scale,x:(wall.clientWidth-bounds.width*scale)/2-bounds.x*scale,y:(wall.clientHeight-bounds.height*scale)/2-bounds.y*scale};}
 project.layout.forEach((p,i)=>{const s=fit.scale,b=p.bezel*s;Object.assign(panels[i].node.style,{left:`${fit.x+(p.x-p.bezel)*s}px`,top:`${fit.y+(p.y-p.bezel)*s}px`,width:`${(p.width+2*p.bezel)*s}px`,height:`${(p.height+2*p.bezel)*s}px`,borderWidth:`${b}px`,transform:`rotate(${p.rotation}deg)`});});
 $('wall-size').textContent=`${Math.round(bounds.width)} × ${Math.round(bounds.height)} mm · 4 PANELS`;
}
new ResizeObserver(()=>position()).observe($('wall'));
for(const [id,s] of Object.entries(SCENES)){const b=document.createElement('button');b.className='scene';b.dataset.scene=id;b.innerHTML=`<span class="number">${String(Object.keys(SCENES).indexOf(id)+1).padStart(2,'0')}</span><strong>${s.name}</strong><small>${s.subtitle}</small>`;b.onclick=()=>update(p=>p.scene.id=id);$('scenes').append(b);}
for(const [id,p]of Object.entries(PALETTES))$('palette').add(new Option(p.name,id));
for(const picker of document.querySelectorAll('.panel-picker'))for(let i=0;i<4;i++){const b=document.createElement('button');b.textContent=`0${i+1}`;b.onclick=()=>{selected=i;syncInspectors();};picker.append(b);}
const geometry={x:['X · mm',-5000,5000,1],y:['Y · mm',-5000,5000,1],width:['Width · mm',100,2000,1],height:['Height · mm',100,2000,1],bezel:['Bezel · mm',0,50,.5],rotation:['Rotation · °',-180,180,1]};
const timing={delay:['Delay · ms',0,500,.1],hz:['Refresh · Hz',24,144,.01],phase:['Phase · ms',0,50,.1],jitter:['Delivery jitter · ms',0,30,.1],drift:['Clock drift · ppm',-200,200,1]};
function fields(def,target,prefix,isTiming){for(const [key,[name,min,max,step]]of Object.entries(def)){const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');Object.assign(input,{id:prefix+key,type:'number',min,max,step});input.onchange=()=>{if(!input.checkValidity()||input.value===''){syncFields();return;}update(p=>{(isTiming?p.layout[selected].timing:p.layout[selected])[key]=Number(input.value);});};label.append(input);$(target).append(label);}}
fields(geometry,'geometry-fields','geo-',false);fields(timing,'timing-fields','tim-',true);
function syncFields(){const p=project.layout[selected];for(const k in geometry)$('geo-'+k).value=p[k];for(const k in timing)$('tim-'+k).value=p.timing[k];$('scanout').value=p.timing.scanout;}
function syncInspectors(){panels.forEach((p,i)=>p.node.classList.toggle('selected',i===selected));document.querySelectorAll('.panel-picker').forEach(p=>[...p.children].forEach((b,i)=>b.classList.toggle('active',i===selected)));syncFields();}
function sync(){document.querySelectorAll('.scene').forEach(b=>b.classList.toggle('active',b.dataset.scene===project.scene.id));$('description').textContent=SCENES[project.scene.id].description;$('palette').value=project.scene.palette;$('speed').value=project.scene.speed;$('speed-label').value=project.scene.speed.toFixed(2)+'×';$('seed').value=project.scene.seed;$('swatches').replaceChildren(...PALETTES[project.scene.palette].colors.map(c=>{const i=document.createElement('i');i.style.background=c;return i;}));$('compare').setAttribute('aria-pressed',String(project.timingEnabled));$('compare').textContent=project.timingEnabled?'B · Simulated timing':'A / B · Enable timing';$('mode-label').textContent=project.timingEnabled?'B · SIMULATED TIMING':'A · ALIGNED REFERENCE';syncInspectors();position();}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));document.querySelectorAll('.tab-content').forEach(t=>t.hidden=t.id!==b.dataset.tab);});
$('palette').onchange=e=>update(p=>p.scene.palette=e.target.value);
$('speed').onchange=e=>update(p=>p.scene.speed=Number(e.target.value));
$('seed').onchange=e=>{if(e.target.checkValidity()&&e.target.value!=='')update(p=>p.scene.seed=Number(e.target.value));else sync();};
$('random').onclick=()=>update(p=>p.scene.seed=crypto.getRandomValues(new Uint32Array(1))[0]);
$('date').value=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('daily').onclick=()=>{if($('date').value)update(p=>p.scene.seed=dailySeed(new Date($('date').value+'T12:00:00Z')));};
$('apply-layout').onclick=()=>{const gap=Number($('gap').value);if(!$('gap').checkValidity())return;update(p=>{const old=p.layout;p.layout=makeLayout($('layout-preset').value,gap);p.layout.forEach((v,i)=>v.timing=old[i].timing);});};
$('apply-timing').onclick=()=>update(p=>{p.layout.forEach((v,i)=>v.timing=TIMING_PRESETS[$('timing-preset').value](i));p.timingEnabled=true;});
$('scanout').onchange=e=>update(p=>p.layout[selected].timing.scanout=e.target.value);
$('test-scene').onclick=()=>update(p=>p.scene.id='test');
$('compare').onclick=()=>update(p=>p.timingEnabled=!p.timingEnabled);
function setPlaying(value){playing=value;last=performance.now();$('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',playing?'Pause playback':'Play');changed();}
$('play').onclick=()=>setPlaying(!playing);
$('step').onclick=()=>{setPlaying(false);project.time=Math.min(86400,project.time+1/60);changed();};
$('scrub').oninput=e=>{setPlaying(false);project.time=Number(e.target.value);changed();};
$('time').onchange=e=>{if(e.target.checkValidity()&&e.target.value!==''){setPlaying(false);project.time=Number(e.target.value);changed();}};
$('undo').onclick=()=>{if(!undo.length)return toast('Nothing to undo yet.');project=undo.pop();sync();changed();};
$('command-form').onsubmit=e=>{e.preventDefault();const text=$('command').value.toLowerCase().trim();let action;
 if(/calmer|slower/.test(text))action=p=>p.scene.speed=Math.max(.05,p.scene.speed*.65);
 else if(/faster|energetic/.test(text))action=p=>p.scene.speed=Math.min(3,p.scene.speed*1.5);
 else if(/firefl|particle/.test(text))action=p=>p.scene.id='fireflies';
 else if(/ribbon|wave/.test(text))action=p=>p.scene.id='ribbons';
 else if(/julia|fractal/.test(text))action=p=>p.scene.id='julia';
 else if(/warm|ember/.test(text))action=p=>p.scene.palette='ember';
 else if(/cool|aurora/.test(text))action=p=>p.scene.palette='aurora';
 else return toast('Try calmer, faster, fireflies, ribbons, fractal, warmer, or cooler.');
 update(action);toast('Art direction applied. Undo is available.');$('command').value='';};
$('save').onclick=()=>{gallery.unshift({id:crypto.randomUUID(),name:$('save-name').value.trim()||'Untitled current',favorite:false,project:clone(project)});persist();toast('Saved to your collection.');};
function showGallery(){const list=$('gallery-list');list.replaceChildren();if(!gallery.length)list.textContent='Your collection is waiting for its first artwork.';
 gallery.forEach(item=>{const row=document.createElement('div');row.className='saved';const name=document.createElement('strong');name.textContent=item.name;const star=document.createElement('button');star.textContent=item.favorite?'★':'☆';star.setAttribute('aria-label','Toggle favorite');star.onclick=()=>{item.favorite=!item.favorite;persist();showGallery();};const load=document.createElement('button');load.textContent='Open';load.onclick=()=>{remember();project=validateProject(item.project);setPlaying(false);sync();changed();$('gallery').close();};const remove=document.createElement('button');remove.textContent='Delete';remove.onclick=()=>{gallery=gallery.filter(x=>x!==item);persist();showGallery();};row.append(star,name,load,remove);list.append(row);});}
$('gallery-open').onclick=()=>{showGallery();$('gallery').showModal();};$('gallery-close').onclick=()=>$('gallery').close();
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='babel-art.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1000000)throw new Error('Artwork JSON must be smaller than 1 MB.');const imported=validateProject(JSON.parse(await file.text()));remember();project=imported;setPlaying(false);sync();changed();toast('Artwork imported.');}catch(err){toast('Import failed: '+err.message);}e.target.value='';};
window.addEventListener('pagehide',persist);setInterval(persist,10000);
let fpsAt=performance.now(),frames=0,diagnosticAt=0;
function draw(now){const dt=(now-last)/1000;last=now;if(playing){project.time=Math.min(86400,project.time+dt);if(project.time===86400)setPlaying(false);}
 const samples=project.layout.map((p,i)=>frameAt(project.time*1000,p.timing,i,project.timingEnabled));
 panels.forEach((p,i)=>{if(p.renderer){const panel=project.layout[i],quality=Number($('quality').value);p.renderer.draw(panel,project.scene,samples[i],Math.max(16,Math.round(panel.width*fit.scale*quality)),Math.max(16,Math.round(panel.height*fit.scale*quality)));}});
 if(document.activeElement!==$('time'))$('time').value=project.time.toFixed(3);$('scrub').max=Math.max(120,Math.ceil(project.time/60)*60);$('scrub').value=project.time;
 frames++;if(now-fpsAt>750){$('fps').textContent=`${Math.round(frames*1000/(now-fpsAt))} FPS · WEBGL`;fpsAt=now;frames=0;}
 if(now-diagnosticAt>150){const ages=samples.map(f=>project.time*1000-f.current),spread=Math.max(...samples.map(f=>f.current))-Math.min(...samples.map(f=>f.current));$('diagnostics').replaceChildren(...ages.map((v,i)=>{const d=document.createElement('div');const s=document.createElement('strong');s.textContent=`PANEL 0${i+1} · ${v.toFixed(1)} ms`;d.append(s,document.createTextNode(`content age · spread ${spread.toFixed(1)} ms`));return d;}));diagnosticAt=now;}
 requestAnimationFrame(draw);
}
sync();requestAnimationFrame(draw);
