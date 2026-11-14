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

  float f=0.;
  for(int i=0;i<7;i++){
   float k=float(i);float y=p.y+.22*sin(p.x*2.4-t*.18+k*.23+seed*.0001)+.08*sin(p.x*6.+t*.12+k);
   float wave=.5+.5*sin(y*17.+k*.65-t*.24);
   f+=pow(wave,18.)*.14;
  }
  col=palette(clamp(f,0.,1.))* (.35+f*1.35);
  col+=c1*.07/(.05+abs(sin(p.y*5.+p.x*1.8-t*.15)));

 gl_FragColor=vec4(finishColor(pow(max(col,vec3(0.)),vec3(.85))),1.);
}`;
