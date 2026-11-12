// Reusable wall-space program for analytic artwork with no decaying state.
export const proceduralFragment = (body: string) => `precision highp float;
varying vec2 uv;
uniform vec4 rect;uniform vec2 times;uniform float rotation,seed,age,period,richness;uniform int scan;uniform vec3 c0,c1,c2;
float grain(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
vec2 local=vec2(uv.x,1.-uv.y);float row=scan==2?1.-local.y:local.y;
float t=scan>0&&age<row*period?times.y:times.x;
vec2 wallLocalOffset=(local-.5)*rect.zw;
vec2 p=(rect.xy+rect.zw*.5+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*wallLocalOffset)/450.;
float phase=seed*.001;
vec3 color=vec3(0.);
${body}
gl_FragColor=vec4(clamp(color,0.,1.),1.);
}`;
