// PROTOTYPE (review mock-up only): the shipped height field, drawn with
// constant-width isolines (gradient-normalized), index contours every fifth
// line, hillshade relief, and a hypsometric tint. Not intended to be merged as-is.
export const fragment = `precision highp float;
varying vec2 uv;
uniform vec4 rect;uniform vec2 times;uniform float rotation,seed,age,period,richness;uniform int scan;uniform vec3 c0,c1,c2;
float grain(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float field(vec2 p,float t,float phase){
 vec2 q=p;float height=0.;float weight=.55;
 for(int i=0;i<4;i++){float k=float(i);q=mat2(.8,-.6,.6,.8)*q*1.9+vec2(sin(t*.071+k+phase),cos(t*.097-k))*.35;height+=weight*sin(q.x+t*.09)*cos(q.y-t*.12);weight*=.5;}
 return height;
}
float iso(float v,float spacing,float grad,float widthMm){
 float d=abs(fract(v/spacing+.5)-.5)*spacing;      // distance in height units
 float mm=d/max(grad,1e-4);                         // distance in wall millimetres
 return 1.-smoothstep(widthMm*.5,widthMm*.5+.35,mm);
}
void main(){
 vec2 local=vec2(uv.x,1.-uv.y);float row=scan==2?1.-local.y:local.y;
 float t=scan>0&&age<row*period?times.y:times.x;
 vec2 off=(local-.5)*rect.zw;
 vec2 wp=rect.xy+rect.zw*.5+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*off;
 float phase=seed*.001;
 vec2 p=wp/450.;
 float e=1./450.;                                   // one millimetre
 float h=field(p,t,phase);
 float hx=field(p+vec2(e,0.),t,phase), hy=field(p+vec2(0.,e),t,phase);
 vec2 g=vec2(hx-h,hy-h);                            // height change per mm
 float grad=length(g);
 // Relief: light from the upper left, gentle vertical exaggeration.
 vec3 n=normalize(vec3(-g*230.,1.));
 float shade=clamp(dot(n,normalize(vec3(-.6,.55,.6))),0.,1.);
 // Hypsometric tint: deep ground -> saturated middle -> warm high ground.
 float k=clamp(h*.85+.5,0.,1.);
 vec3 low=c0*.38, midc=mix(c0,c1,.6)*.85, high=mix(c1,c2,.85)*.95;
 vec3 tint=mix(low,midc,smoothstep(.0,.55,k));
 tint=mix(tint,high,smoothstep(.55,1.,k)*.75);
 vec3 color=tint*(.35+.9*shade);
 // Thin contours every .06 of height, an index contour every fifth line.
 float minor=iso(h,.05,grad,.5);
 float major=iso(h,.25,grad,1.2);
 vec3 ink=mix(color*.45,c2,.18);
 color=mix(color,ink,minor*.7*richness);
 color=mix(color,mix(c2,vec3(1.),.15),major*.85);
 color*=1.+(grain(floor(wp*3.))-.5)*.06*richness;   // paper tooth, fixed to the wall
 color+=(grain(gl_FragCoord.xy)-.5)/255.;
 gl_FragColor=vec4(clamp(color,0.,1.),1.);
}`;
