export const fragment = `precision highp float;
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

  float x=mod(world.x-t*850.,450.);
  float bar=1.-step(35.,x);float line=1.-step(3.,mod(world.x+world.y-t*330.,95.));
  float pulse=exp(-pow((world.y-350.-sin(t*2.)*240.)/7.,2.));
  col=vec3(.025)+bar*c1+line*c2*.6+pulse*vec3(1.);

 gl_FragColor=vec4(pow(max(col,vec3(0.)),vec3(.85)),1.);
}`;
