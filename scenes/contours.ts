import { proceduralFragment } from "./procedural";
export const fragment = proceduralFragment(`
vec2 q=p;
float height=0.;float weight=.55;
for(int i=0;i<4;i++){float k=float(i);q=mat2(.8,-.6,.6,.8)*q*1.9+vec2(sin(t*.071+k+phase),cos(t*.097-k))*.35;height+=weight*sin(q.x+t*.09)*cos(q.y-t*.12);weight*=.5;}
float bands=height*11.+t*.08;
float line=1.-smoothstep(.015,.10,abs(fract(bands)-.5));
float f=.5+.5*sin(height*2.+t*.043);
float terraces=floor(bands*2.)*.5;
float strata=.5+.5*sin(terraces*.7+phase);
vec3 pigment=mix(c0*.35,c1*.7,f);
pigment=mix(pigment,mix(c0,c2,strata)*.7,richness*.48);
float fine=1.-smoothstep(.015,.075,abs(fract(bands*4.)-.5));
float shadow=smoothstep(.35,.5,fract(bands))*(1.-smoothstep(.5,.67,fract(bands)));
color=pigment*(1.-shadow*.22*richness)+mix(c1,c2,f)*line*.8;
color+=mix(c1,c2,strata)*fine*.16*richness;
color*=1.+(grain(floor(p*820.))-.5)*.13*richness;
`);
