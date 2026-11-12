import { proceduralFragment } from "./procedural";
export const fragment = proceduralFragment(`
vec2 q=p;
float height=0.;float weight=.55;
for(int i=0;i<4;i++){float k=float(i);q=mat2(.8,-.6,.6,.8)*q*1.9+vec2(sin(t*.071+k+phase),cos(t*.097-k))*.35;height+=weight*sin(q.x+t*.09)*cos(q.y-t*.12);weight*=.5;}
float bands=height*11.+t*.08;
float line=1.-smoothstep(.015,.10,abs(fract(bands)-.5));
float f=.5+.5*sin(height*2.+t*.043);
color=mix(c0*.3,c1*.6,f)+mix(c1,c2,f)*line*.85;
`);
