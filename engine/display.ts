// Presentation only: pigment, lighting, and grain never feed back into the
// simulation. Surface detail can change without disturbing the artwork.
export const entityDisplay = `precision highp float;
varying vec2 uv;
uniform vec4 rect,world;
uniform float rotation,age,period,evolutionTime,variation,recoveryMix;
uniform int scan;
uniform sampler2D state,previous;
uniform vec3 c0,c1,c2;
void main(){
  vec2 offset=(vec2(uv.x,1.-uv.y)-.5)*rect.zw;
  vec2 p=rect.xy+rect.zw*.5+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*offset;
  vec2 st=(p-world.xy)/world.zw;
  float row=scan==2?uv.y:1.-uv.y;
  vec3 color=scan>0&&age<row*period?texture2D(previous,st).rgb:texture2D(state,st).rgb;
  vec2 warp=st*6.+variation*.7*vec2(sin(st.y*5.+evolutionTime*.17),cos(st.x*4.-evolutionTime*.11));
  float field=.5+.5*sin(warp.x+sin(warp.y+evolutionTime*.23)-evolutionTime*.19);
  vec3 living=mix(c0*.3,c1*.8,field)*(.6+.4*sin(warp.y*2.-evolutionTime*.21));
  gl_FragColor=vec4(mix(color,living,max(variation*.055,recoveryMix)),1.);
}`;

export const display = `precision highp float;
varying vec2 uv;
uniform vec4 rect,world;
uniform float rotation;
uniform sampler2D state,previous;
uniform vec3 c0,c1,c2;
uniform int style,scan;
uniform float age,period,evolutionTime,variation,recoveryMix,richness;
uniform vec2 texel;
float grain(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec4 rawState(vec2 p,bool old){return old?texture2D(previous,p):texture2D(state,p);}
vec4 sampleState(vec2 p,bool old){
  if(style!=2)return rawState(p,old);
  // Manual bilinear interpolation also works on devices without float-linear
  // texture filtering. Only the displayed surface is smoothed.
  vec2 cell=p/texel-.5;
  vec2 f=fract(cell),base=(floor(cell)+.5)*texel;
  return mix(mix(rawState(base,old),rawState(base+vec2(texel.x,0.),old),f.x),
    mix(rawState(base+vec2(0.,texel.y),old),rawState(base+texel,old),f.x),f.y);
}
void main(){
  vec2 offset=(vec2(uv.x,1.-uv.y)-.5)*rect.zw;
  vec2 p=rect.xy+rect.zw*.5+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*offset;
  vec2 original=(p-world.xy)/world.zw;
  vec2 st=original;
  float time=evolutionTime;
  st+=variation*.008*vec2(sin(st.y*9.+time*.13),cos(st.x*11.-time*.11));
  vec2 warp=original*6.+variation*.7*vec2(sin(original.y*5.+time*.17),cos(original.x*4.-time*.11));
  float field=.5+.5*sin(warp.x+sin(warp.y+time*.23)-time*.19);
  vec3 living=mix(c0*.3,c1*.8,field)*(.6+.4*sin(warp.y*2.-time*.21));
  float blend=max(variation*.055,recoveryMix);
  float row=scan==2?uv.y:1.-uv.y;
  bool old=scan>0&&age<row*period;
  vec4 v=sampleState(st,old);
  if(!(v.r>=0.&&v.r<=1.)||!(v.g>=0.&&v.g<=1.))v=vec4(0.);
  vec3 color=mix(c0*.08,c1,style==0?0.:v.g*.6);
  color=mix(color,c2,clamp(v.r,0.,1.));
  if(style==2){
    float dx=sampleState(st+vec2(texel.x,0.),old).g-sampleState(st-vec2(texel.x,0.),old).g;
    float dy=sampleState(st+vec2(0.,texel.y),old).g-sampleState(st-vec2(0.,texel.y),old).g;
    vec3 normal=normalize(vec3(-dx*14.,-dy*14.,1.));
    vec3 light=normalize(vec3(-1.+variation*sin(time*.11),-1.+variation*cos(time*.09),2.));
    float material=clamp(v.g*2.8,0.,1.);
    vec3 pigment=mix(c0*.26,c1,smoothstep(.03,.48,material));
    pigment=mix(pigment,c2,smoothstep(.48,.97,material));
    float membrane=exp(-pow((v.g-.17)*35.,2.));
    float fine=sin(v.g*125.+sin(st.x*41.)*.8)*sin(st.y*113.+v.g*83.);
    float specular=pow(max(0.,dot(normal,normalize(light+vec3(0.,0.,1.)))),24.);
    vec3 rich=pigment*(.42+.7*max(0.,dot(normal,light)));
    rich+=c0*.1*(.5+.5*sin(st.x*13.+sin(st.y*17.)));
    rich+=mix(c1,c2,.65)*membrane*.3+vec3(specular)*material*.14;
    rich*=1.+fine*.08;
    vec3 plain=mix(c0,c2,clamp(v.g*2.,0.,1.))*(.7+dot(normal,light))*.5;
    color=mix(plain,rich,richness);
  }else if(style==1){
    vec2 cell=fract(st/texel)-.5;
    float tile=1.-smoothstep(.34,.49,max(abs(cell.x),abs(cell.y)));
    float region=.5+.5*sin(st.x*9.+sin(st.y*7.)*2.);
    float trail=clamp(v.g,0.,1.);
    vec3 pigment=mix(c1,c2,clamp(region*.65+v.r*.35,0.,1.));
    vec3 rich=c0*.09+pigment*trail*(.25+.75*tile);
    rich+=c2*v.r*pow(max(0.,1.-length(cell+vec2(.12)) * 2.),4.)*.5;
    color=mix(color,rich,richness);
  }
  if(style>0)color*=1.+(grain(floor(p*2.))-0.5)*.09*richness;
  if(!(color.r>=0.&&color.r<100.)||!(color.g>=0.&&color.g<100.)||!(color.b>=0.&&color.b<100.))color=living;
  gl_FragColor=vec4(mix(color,living,blend),1.);
}`;
