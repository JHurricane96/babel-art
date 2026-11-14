// PROTOTYPE (review mock-up only): same c-path as the shipped scene, with
// continuous escape coloring, a distance-estimated luminous rim, a textured
// interior, and dithering. Not intended to be merged as-is.
export const fragment = `precision highp float;
varying vec2 uv;
uniform vec4 rect;
uniform vec2 times;
uniform float rotation, seed, speed, age, period;
uniform int scene, scan;
uniform vec3 c0,c1,c2;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
 vec2 local=vec2(uv.x,1.-uv.y);
 float row=scan==2?1.-local.y:local.y;
 float t=(scan>0&&age<row*period?times.y:times.x)*speed;
 vec2 a=(local-.5)*rect.zw;
 vec2 world=rect.xy+rect.zw*.5+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*a;
 vec2 z=(world-vec2(550.,370.))/360.;
 float q=t*.045+seed*.0001; vec2 c=vec2(-.745+.07*cos(q),.185+.07*sin(q*.7));
 vec2 dz=vec2(1.,0.);
 float iter=0.,trap=1e9; bool escaped=false;
 for(int i=0;i<160;i++){
  dz=2.*vec2(z.x*dz.x-z.y*dz.y,z.x*dz.y+z.y*dz.x);
  z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+c;
  trap=min(trap,abs(length(z-vec2(.0,.0))-.35));
  if(dot(z,z)>1024.){escaped=true;break;}
  iter+=1.;
 }
 vec3 deep=c0*.16, mid=mix(c0,c1,.55);
 vec3 col;
 if(escaped){
  float r=length(z);
  float s=iter+1.-log2(log2(r));                 // continuous escape time
  float d=.5*r*log(r)/max(length(dz),1e-9)*360.;  // boundary distance in mm
  float near=exp(-d/9.);
  float far=clamp(s/40.,0.,1.);
  float wave=.5+.5*cos(6.2831*(s*.045+seed*.0001)); // cyclic, no hard seams
  col=mix(deep,mid*.55,pow(far,.7));
  col=mix(col,mix(c1,c2,wave),near*.75);
  col+=c2*exp(-d/1.2)*.55;                        // fine luminous rim
 }else{
  float m=exp(-trap*9.);
  col=mix(c0*.07,mix(c0,c1,.35)*.35,m);           // quiet, textured interior
 }
 col=pow(max(col,vec3(0.)),vec3(.85));
 col+=(hash(gl_FragCoord.xy)-.5)/255.;            // break 8-bit banding
 gl_FragColor=vec4(col,1.);
}`;
