import { proceduralFragment } from "./procedural";
export const fragment = proceduralFragment(`
vec2 q=p+vec2(sin(p.y*2.1+t*.17+phase),cos(p.x*1.8-t*.13))*.6;
float a=sin(q.x*5.+t*.41)*cos(q.y*4.-t*.29);
float b=sin(length(q-vec2(sin(t*.11),cos(t*.073)))*7.-t*.67+phase);
float f=.5+.25*a+.25*b;
float filaments=pow(.5+.5*sin((a+b)*7.+t*.23),8.);
float veins=pow(.5+.5*cos((a-b)*27.+sin(q.y*9.)),18.);
float wash=.5+.5*sin(q.x*1.7-q.y*1.2+phase);
color=mix(c0*.18,c1,f*.85)+c2*filaments*.7;
vec3 detail=mix(c1,c2,wash)*veins*.4+vec3(filaments*filaments)*.16;
color+=detail*richness;
color*=1.+(grain(floor(p*720.))-.5)*.1*richness;
`);
