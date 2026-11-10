import { PALETTES } from '../shared/model.js';
const vertex = `attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 uv;
uniform vec4 rect;
uniform vec2 times;
uniform float rotation, seed, speed, age, period;
uniform int scene, scan;
uniform vec3 c0,c1,c2;
float hash(float n){return fract(sin(n*127.1+seed*.001)*43758.5453);}
vec3 palette(float f){return mix(mix(c0,c1,smoothstep(0.,.65,f)),c2,smoothstep(.6,1.,f));}
void main(){
 vec2 local=vec2(uv.x,1.-uv.y);
 float row=scan==2?1.-local.y:local.y;
 float t=(scan>0&&age<row*period?times.y:times.x)*speed;
 vec2 a=(local-.5)*rect.zw;
 vec2 world=rect.xy+rect.zw*.5+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*a;
 vec2 p=world/650.;
 vec3 col=vec3(.012,.022,.035);
 if(scene==0){
  float f=0.;
  for(int i=0;i<7;i++){
   float k=float(i);float y=p.y+.22*sin(p.x*2.4-t*.18+k*.23+seed*.0001)+.08*sin(p.x*6.+t*.12+k);
   float wave=.5+.5*sin(y*17.+k*.65-t*.24);
   f+=pow(wave,18.)*.14;
  }
  col=palette(clamp(f,0.,1.))* (.35+f*1.35);
  col+=c1*.07/(.05+abs(sin(p.y*5.+p.x*1.8-t*.15)));
 }else if(scene==1){
  vec2 z=(world-vec2(550.,370.))/360.;
  float q=t*.045+seed*.0001; vec2 c=vec2(-.745+.07*cos(q),.185+.07*sin(q*.7));
  float iter=0.;
  for(int i=0;i<90;i++){z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+c;if(dot(z,z)>100.)break;iter+=1.;}
  float v=iter/90.; col=iter>89.?c0*.06:palette(fract(v*3.+.13))*pow(v+.1,.45);
 }else if(scene==2){
  col=c0*.065;
  for(int i=0;i<38;i++){
   float k=float(i);float h=hash(k+1.);vec2 pos=vec2(mod(h*2200.+t*(28.+h*48.),2200.)-400.,hash(k+90.)*1100.-150.);
   pos.y+=45.*sin(t*.4+k);
   vec2 d=world-pos;float r=length(d);float glow=exp(-r*r/520.)*.5+exp(-r*r/17.)*1.8;
   col+=mix(c1,c2,h)*glow*(.55+.45*sin(t*1.5+k));
  }
 }else{
  float x=mod(world.x-t*850.,450.);
  float bar=1.-step(35.,x);float line=1.-step(3.,mod(world.x+world.y-t*330.,95.));
  float pulse=exp(-pow((world.y-350.-sin(t*2.)*240.)/7.,2.));
  col=vec3(.025)+bar*c1+line*c2*.6+pulse*vec3(1.);
 }
 gl_FragColor=vec4(pow(max(col,vec3(0.)),vec3(.85)),1.);
}`;
export class PanelRenderer {
  constructor(canvas) {
    const gl=this.gl=canvas.getContext('webgl',{antialias:false,preserveDrawingBuffer:true});
    if(!gl) throw new Error('WebGL is required. Enable hardware acceleration or try another browser.');
    const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const program=this.program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const at=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
    this.u=Object.fromEntries(['rect','times','rotation','seed','speed','age','period','scene','scan','c0','c1','c2'].map(n=>[n,gl.getUniformLocation(program,n)]));
    canvas.dataset.renderer='webgl';
  }
  draw(panel,scene,frame,width,height) {
    const gl=this.gl,u=this.u,c=gl.canvas;
    if(c.width!==width||c.height!==height){c.width=width;c.height=height;}
    gl.viewport(0,0,c.width,c.height);gl.useProgram(this.program);
    gl.uniform4f(u.rect,panel.x,panel.y,panel.width,panel.height);gl.uniform2f(u.times,frame.current/1000,frame.previous/1000);
    gl.uniform1f(u.rotation,panel.rotation*Math.PI/180);gl.uniform1f(u.seed,scene.seed%100000);gl.uniform1f(u.speed,scene.speed);
    gl.uniform1f(u.age,frame.age);gl.uniform1f(u.period,frame.period);gl.uniform1i(u.scan,['none','top-down','bottom-up'].indexOf(frame.scan));
    gl.uniform1i(u.scene,['ribbons','julia','fireflies','test'].indexOf(scene.id));
    PALETTES[scene.palette].colors.forEach((hex,i)=>gl.uniform3fv(u['c'+i],[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)/255)));
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
}
