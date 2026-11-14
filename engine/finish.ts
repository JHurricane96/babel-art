// Shared presentation finish for artwork shaders. Pure functions of color and
// screen position: nothing here feeds back into a simulation or checkpoint.
//
// - okMix: hue-preserving interpolation in OKLCh, so a blend between two
//   palette colors keeps its saturation instead of passing through gray.
// - okShade: derive a darker/lighter role from a palette color while keeping
//   its hue (shadows and highlights without mud).
// - paletteRoles: the three palette stops expanded to named roles once per
//   draw (in JS), so shaders blend between nearby perceptual stops cheaply.
// - softShoulder: highlights above the knee roll off instead of clipping flat.
// - screenDither: fixed sub-LSB dither that breaks 8-bit banding. It depends
//   only on the pixel position, so a paused frame stays identical.
type RGB = number[];
const toLinear = (v: number) => Math.pow(Math.max(v, 0), 2.2);
const toDisplay = (v: number) => Math.pow(Math.min(1, Math.max(v, 0)), 1 / 2.2);
export function toOklab(c: RGB): RGB {
  const [r, g, b] = c.slice(0, 3).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function fromOklab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toDisplay);
}
/** Interpolate lightness and chroma linearly and hue along the shorter arc. */
export function okMix(a: RGB, b: RGB, t: number): RGB {
  const p = toOklab(a),
    q = toOklab(b),
    ca = Math.hypot(p[1], p[2]),
    cb = Math.hypot(q[1], q[2]);
  let ha = Math.atan2(p[2], p[1]),
    hb = Math.atan2(q[2], q[1]);
  if (ca < 0.015) ha = hb;
  if (cb < 0.015) hb = ha;
  let dh = hb - ha;
  dh -= 2 * Math.PI * Math.floor((dh + Math.PI) / (2 * Math.PI));
  const h = ha + dh * t,
    chroma = ca + (cb - ca) * t;
  return fromOklab([
    p[0] + (q[0] - p[0]) * t,
    chroma * Math.cos(h),
    chroma * Math.sin(h),
  ]);
}
export function okShade(c: RGB, lightness: number, chromaScale: number): RGB {
  const [L, a, b] = toOklab(c);
  return fromOklab([
    Math.min(1, Math.max(0, L + lightness)),
    a * chromaScale,
    b * chromaScale,
  ]);
}
/** Midpoint on the hue arc, muted when the two hues are nearly opposite. */
function bridge(a: RGB, b: RGB): RGB {
  const p = toOklab(a),
    q = toOklab(b);
  let dh = Math.abs(Math.atan2(q[2], q[1]) - Math.atan2(p[2], p[1]));
  if (dh > Math.PI) dh = 2 * Math.PI - dh;
  const far = Math.min(1, Math.max(0, (dh - Math.PI / 2) / (Math.PI / 2)));
  return okShade(okMix(a, b, 0.5), 0, 1 - 0.45 * far);
}
export const ROLE_NAMES = [
  "toneGround",
  "toneShadow",
  "toneBody",
  "toneBridge",
  "toneHighlight",
  "toneDusk",
] as const;
const roleCache = new Map<string, Record<string, RGB>>();
/**
 * Derived roles for a deep / middle / accent palette: a near-black ground that
 * keeps the palette's hue, a shadow, a body between deep and middle, a bridge
 * between middle and accent, a soft highlight, and a dusk tone between deep
 * and accent. Hue-arc blends keep each role saturated.
 */
export function paletteRoles(colors: RGB[]): Record<string, RGB> {
  const key = colors.map((c) => c.slice(0, 3).join(",")).join("|");
  let roles = roleCache.get(key);
  if (roles) return roles;
  const [c0, c1, c2] = colors;
  const deep = toOklab(c0);
  roles = {
    toneGround: okShade(c0, -deep[0] * 0.62, 0.85),
    toneShadow: okShade(c0, -deep[0] * 0.25, 0.95),
    toneBody: bridge(c0, c1),
    toneBridge: bridge(c1, c2),
    toneHighlight: okShade(c2, 0.08, 0.55),
    toneDusk: bridge(c0, c2),
  };
  if (roleCache.size > 64) roleCache.clear();
  roleCache.set(key, roles);
  return roles;
}
/** Set role uniforms on the program currently in use. Missing names are ignored. */
export function setRoleUniforms(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  colors: RGB[],
) {
  const roles = paletteRoles(colors);
  for (const name of ROLE_NAMES)
    gl.uniform3fv(gl.getUniformLocation(program, name), roles[name]);
}
export const ROLE_GLSL = `uniform vec3 toneGround,toneShadow,toneBody,toneBridge,toneHighlight,toneDusk;`;
export const FINISH_GLSL = `
vec3 toLinear(vec3 c){return pow(max(c,vec3(0.)),vec3(2.2));}
vec3 toDisplay(vec3 c){return pow(clamp(c,0.,1.),vec3(1./2.2));}
vec3 toOklab(vec3 c){
 vec3 lin=toLinear(c);
 vec3 lms=vec3(.4122214708*lin.r+.5363325363*lin.g+.0514459929*lin.b,
  .2119034982*lin.r+.6806995451*lin.g+.1073969566*lin.b,
  .0883024619*lin.r+.2817188376*lin.g+.6299787005*lin.b);
 lms=pow(max(lms,vec3(0.)),vec3(1./3.));
 return vec3(.2104542553*lms.x+.7936177850*lms.y-.0040720468*lms.z,
  1.9779984951*lms.x-2.4285922050*lms.y+.4505937099*lms.z,
  .0259040371*lms.x+.7827717662*lms.y-.8086757660*lms.z);
}
vec3 fromOklab(vec3 o){
 vec3 lms=vec3(o.x+.3963377774*o.y+.2158037573*o.z,
  o.x-.1055613458*o.y-.0638541728*o.z,
  o.x-.0894841775*o.y-1.2914855480*o.z);
 lms=lms*lms*lms;
 return toDisplay(vec3(4.0767416621*lms.x-3.3077115913*lms.y+.2309699292*lms.z,
  -1.2684380046*lms.x+2.6097574011*lms.y-.3413193965*lms.z,
  -.0041960863*lms.x-.7034186147*lms.y+1.7076147010*lms.z));
}
vec3 okMix(vec3 a,vec3 b,float t){
 vec3 p=toOklab(a),q=toOklab(b);
 float ca=length(p.yz),cb=length(q.yz);
 float ha=atan(p.z,p.y+1e-6),hb=atan(q.z,q.y+1e-6);
 if(ca<.015)ha=hb;
 if(cb<.015)hb=ha;
 float dh=hb-ha;
 dh-=6.2831853*floor((dh+3.1415927)/6.2831853);
 float h=ha+dh*t,chroma=mix(ca,cb,t);
 return fromOklab(vec3(mix(p.x,q.x,t),chroma*cos(h),chroma*sin(h)));
}
vec3 okShade(vec3 c,float lightness,float chromaScale){
 vec3 o=toOklab(c);
 return fromOklab(vec3(clamp(o.x+lightness,0.,1.),o.yz*chromaScale));
}
vec3 softShoulder(vec3 c){
 vec3 x=max(c,vec3(0.));
 vec3 over=max(x-vec3(.82),vec3(0.));
 return min(x,vec3(.82))+.18*(1.-exp(-over/.18));
}
float screenNoise(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
vec3 screenDither(vec3 c){return c+(screenNoise(gl_FragCoord.xy)-.5)/255.;}
vec3 finishColor(vec3 c){return screenDither(softShoulder(c));}
`;
