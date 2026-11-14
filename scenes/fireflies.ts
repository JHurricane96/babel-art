import { FINISH_GLSL } from "../engine/finish";
export const fragment = `precision highp float;
varying vec2 uv;
uniform vec4 rect;
uniform vec2 times;
uniform float rotation, seed, speed, age, period;
uniform int scene, scan;
uniform vec3 c0,c1,c2;
float hash(float n){return fract(sin(n*127.1+seed*.001)*43758.5453);}
${FINISH_GLSL}
vec3 palette(float f){return mix(mix(c0,c1,smoothstep(0.,.65,f)),c2,smoothstep(.6,1.,f));}
void main(){
 vec2 local=vec2(uv.x,1.-uv.y);
 float row=scan==2?1.-local.y:local.y;
 float t=(scan>0&&age<row*period?times.y:times.x)*speed;
 vec2 a=(local-.5)*rect.zw;
 vec2 world=rect.xy+rect.zw*.5+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*a;
 vec2 p=world/650.;
 vec3 col=vec3(.012,.022,.035);

  col=c0*.065;
  for(int i=0;i<38;i++){
   float k=float(i);float h=hash(k+1.);vec2 pos=vec2(mod(h*2200.+t*(28.+h*48.),2200.)-400.,hash(k+90.)*1100.-150.);
   pos.y+=45.*sin(t*.4+k);
   vec2 d=world-pos;float r=length(d);float glow=exp(-r*r/520.)*.5+exp(-r*r/17.)*1.8;
   col+=mix(c1,c2,h)*glow*(.55+.45*sin(t*1.5+k));
  }

 gl_FragColor=vec4(finishColor(pow(max(col,vec3(0.)),vec3(.85))),1.);
}`;
