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

  vec2 z=(world-vec2(550.,370.))/360.;
  float q=t*.045+seed*.0001; vec2 c=vec2(-.745+.07*cos(q),.185+.07*sin(q*.7));
  float iter=0.;
  for(int i=0;i<90;i++){z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+c;if(dot(z,z)>100.)break;iter+=1.;}
  float v=iter/90.; col=iter>89.?c0*.06:palette(fract(v*3.+.13))*pow(v+.1,.45);

 gl_FragColor=vec4(pow(max(col,vec3(0.)),vec3(.85)),1.);
}`;
