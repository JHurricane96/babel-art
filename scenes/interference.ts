import { proceduralFragment } from "./procedural";
export const fragment = proceduralFragment(`
vec2 q=p+vec2(sin(p.y*2.1+t*.17+phase),cos(p.x*1.8-t*.13))*.6;
float a=sin(q.x*5.+t*.41)*cos(q.y*4.-t*.29);
float b=sin(length(q-vec2(sin(t*.11),cos(t*.073)))*7.-t*.67+phase);
float f=.5+.25*a+.25*b;
float filaments=pow(.5+.5*sin((a+b)*7.+t*.23),8.);
color=mix(c0*.25,c1,f)+c2*filaments*.8;
`);
