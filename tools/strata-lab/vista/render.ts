// Vista renderer (WebGL2): the valley at the wall's art resolution (980 x 637,
// four screen pixels per art pixel), upscaled without smoothing.
//
// - The camera stays level, so verticals stay vertical; the horizon sits on a
//   fixed row.
// - Terrain: square patches from a quadtree, finer near the camera, heights
//   read from the grids in the vertex shader; skirts hide the cracks between
//   patches of different detail.
// - The ground is shaded in world-space texels at least an art pixel across
//   (a power of two of metres, coarser with distance), each texel one colour
//   from a six-shade ramp: pixel art that does not shimmer as the camera moves.
//   Steep faces show the rock's beds.
// - Haze comes in eight bands of distance, so the land reads as layers.
// - Sprites are drawn pixel for pixel at their size class, on whole pixels.
import { GRIDS, type Building, type GridSpec, KIND_COUNT } from "./valley";

export const ART_W = 980,
  ART_H = 637,
  FOV = Math.PI / 3,
  F = ART_W / 2 / Math.tan(FOV / 2),
  HORIZON = Math.round(ART_H * 0.4),
  NEAR = 1,
  FAR = 100000;
export const WALL = { w: 1084, h: 705, pw: 531, ph: 299, panels: [[0, 85], [553, 0], [0, 406], [553, 321]] as [number, number][] };

export interface Camera {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
uniform vec3 uCam;
uniform vec2 uFwd, uRight, uRes;
uniform float uF, uHz, uBands, uTime;
uniform vec3 uHaze, uSun;
const float NEAR = ${NEAR.toFixed(1)}, FAR = ${FAR.toFixed(1)};
float depthClip(float vz) { return (vz * (FAR + NEAR) - 2.0 * FAR * NEAR) / (FAR - NEAR); }
vec4 project(vec3 p, out float vz) {
  vec3 v = p - uCam;
  vz = dot(v.xz, uFwd);
  float vx = dot(v.xz, uRight);
  return vec4((2.0 * uF / uRes.x) * vx, (1.0 - 2.0 * uHz / uRes.y) * vz + (2.0 * uF / uRes.y) * v.y, depthClip(vz), vz);
}
const float BAND0 = 15.0, LOGR = 0.89944;
float bandOf(float d) { return clamp(floor(log(max(d, 1.0) / BAND0) / LOGR), 0.0, 7.0); }
float hazeT(float d) {
  float layer, dd;
  if (uBands > 0.5) { layer = bandOf(d) + 0.5; dd = BAND0 * exp(layer * LOGR); }
  else { layer = max(0.0, log(max(d, 1.0) / BAND0) / LOGR); dd = d; }
  return min(0.9, 0.028 * layer + 0.86 * (1.0 - exp(-dd / 15000.0)));
}
uint hashu(uvec2 v) {
  uint h = v.x * 1597334677u ^ v.y * 3812015801u;
  h = (h ^ (h >> 16)) * 2246822519u;
  h ^= h >> 13;
  return h * 3266489917u ^ (h >> 16);
}
float hashf(ivec2 c, uint salt) { return float(hashu(uvec2(c) + uvec2(salt * 7919u, salt * 104729u)) & 0xffffffu) / 16777216.0; }
float vnoise(vec2 p, uint salt) {
  vec2 i = floor(p), f = p - i;
  ivec2 c = ivec2(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashf(c, salt), hashf(c + ivec2(1, 0), salt), f.x), mix(hashf(c + ivec2(0, 1), salt), hashf(c + ivec2(1, 1), salt), f.x), f.y);
}
// Band-limited: a pattern of wavelength wl fades out as texels (s) grow toward it.
float bn(vec2 P, float wl, float s, uint salt) {
  float k = clamp(wl / s * 0.5 - 1.0, 0.0, 1.0);
  return k > 0.0 ? k * (vnoise(P / wl, salt) - 0.5) * 2.0 : 0.0;
}
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float bayer(ivec2 t) { return (BAYER[(t.y & 3) * 4 + (t.x & 3)] + 0.5) / 16.0; }
`;

const TERRAIN_VS = /* glsl */ `${COMMON}
in vec3 aGrid;
in vec4 iPatch;
uniform sampler2D uH0, uH1, uH2;
uniform vec4 uG0, uG1, uG2;
out vec3 vW;
out float vZ;
float fetchH(sampler2D t, vec4 g, vec2 xz) {
  vec2 f = clamp((xz - g.xy) / g.z, vec2(0.0), vec2(g.w - 1.001));
  ivec2 i = ivec2(floor(f));
  vec2 u = f - vec2(i);
  float a = texelFetch(t, i, 0).r, b = texelFetch(t, i + ivec2(1, 0), 0).r, c = texelFetch(t, i + ivec2(0, 1), 0).r, d = texelFetch(t, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
bool inside(vec4 g, vec2 xz) { vec2 f = (xz - g.xy) / g.z; return all(greaterThanEqual(f, vec2(1.0))) && all(lessThan(f, vec2(g.w - 2.0))); }
void main() {
  vec2 xz = iPatch.xy + aGrid.xy * iPatch.z;
  float sp = iPatch.z / 32.0, h;
  if (sp < 12.0 && inside(uG0, xz)) h = fetchH(uH0, uG0, xz);
  else if (sp < 90.0 && inside(uG1, xz)) h = fetchH(uH1, uG1, xz);
  else h = fetchH(uH2, uG2, xz);
  if (aGrid.z > 0.5) h -= sp * 1.5 + 1.0;
  vW = vec3(xz.x, h, xz.y);
  float vz;
  gl_Position = project(vW, vz);
  vZ = vz;
}`;

// Ramps (rows of the palette texture), see RAMP_COLOURS.
const TERRAIN_FS = /* glsl */ `${COMMON}
in vec3 vW;
in float vZ;
uniform sampler2D uN0, uN1, uN2, uK0, uK1, uK2, uPal, uRoad;
uniform vec4 uG0, uG1, uG2;
out vec4 oColor;
bool inside(vec4 g, vec2 xz) { vec2 f = (xz - g.xy) / g.z; return all(greaterThanEqual(f, vec2(1.0))) && all(lessThan(f, vec2(g.w - 2.0))); }
vec4 nrmAt(int gi, vec2 xz) {
  if (gi == 0) return texture(uN0, ((xz - uG0.xy) / uG0.z + 0.5) / uG0.w);
  if (gi == 1) return texture(uN1, ((xz - uG1.xy) / uG1.z + 0.5) / uG1.w);
  return texture(uN2, ((xz - uG2.xy) / uG2.z + 0.5) / uG2.w);
}
int kindAt(int gi, vec2 xz) {
  if (gi == 0) return int(texelFetch(uK0, ivec2(floor((xz - uG0.xy) / uG0.z + 0.5)), 0).r * 255.0 + 0.5);
  if (gi == 1) return int(texelFetch(uK1, ivec2(floor((xz - uG1.xy) / uG1.z + 0.5)), 0).r * 255.0 + 0.5);
  return int(texelFetch(uK2, ivec2(clamp(floor((xz - uG2.xy) / uG2.z + 0.5), vec2(0.0), vec2(uG2.w - 1.0))), 0).r * 255.0 + 0.5);
}
vec3 pal(int ramp, float tone) { return texelFetch(uPal, ivec2(clamp(int(floor(tone)), 0, 5), ramp), 0).rgb; }
void main() {
  float d = max(vZ, 1.0);
  // Texels: a power of two of metres, at least an art pixel across.
  float s = exp2(ceil(log2(max(d / uF, 1.0 / 64.0))));
  int gi = (s < 4.0 && inside(uG0, vW.xz)) ? 0 : (s < 48.0 && inside(uG1, vW.xz)) ? 1 : 2;
  vec4 nr0 = nrmAt(gi, vW.xz);
  vec3 n0 = vec3(nr0.r * 2.0 - 1.0, 0.0, nr0.g * 2.0 - 1.0);
  bool steep = length(n0.xz) > 0.62;
  // The texel this fragment falls in: on the ground plane, or on a steep face (u along it, y up).
  vec3 P = vW;
  ivec2 ti;
  float u;
  if (!steep) {
    vec2 q = floor(vW.xz / s);
    ti = ivec2(q);
    P.xz = (q + 0.5) * s;
    u = P.x;
  } else {
    bool xFace = abs(n0.x) > abs(n0.z);
    float a = xFace ? vW.z : vW.x;
    vec2 q = floor(vec2(a, vW.y) / s);
    ti = ivec2(q);
    u = (q.x + 0.5) * s;
    P.y = (q.y + 0.5) * s;
    if (xFace) P.z = u; else P.x = u;
  }
  vec4 nr = nrmAt(gi, P.xz);
  vec3 n = vec3(nr.r * 2.0 - 1.0, 0.0, nr.g * 2.0 - 1.0);
  n.y = sqrt(max(0.05, 1.0 - dot(n.xz, n.xz)));
  float hollow = nr.b, forest = nr.a;
  // What the ground is: boundaries wander a little (no 2 m staircases); roads come from their distance.
  vec2 warp = gi == 0 ? (vec2(vnoise(P.xz / 3.1, 33u), vnoise(P.xz / 3.1, 34u)) - 0.5) * 2.6 : vec2(0.0);
  int k = kindAt(gi, P.xz + warp);
  if (gi == 0) {
    float rd = texture(uRoad, ((P.xz - uG0.xy) / uG0.z + 0.5) / uG0.w).r * 12.75;
    if (rd < 1.75 + 0.35 * (vnoise(P.xz / 1.3, 35u) - 0.5) && k != 7 && k != 8) k = 9;
  }
  float lam = max(0.0, dot(n, uSun));
  float light = 0.2 + 0.85 * lam - (hollow - 0.5) * 0.6;
  float dith = bayer(ti) - 0.5;
  int ramp = 0;
  float pat = 0.0;
  vec2 Q = P.xz;
  if (k == 0 || k == 1) { // meadow, alpine meadow
    ramp = k;
    pat = 0.7 * bn(Q, 13.0, s, 1u) + 0.55 * bn(Q, 2.6, s, 2u) + 0.6 * bn(Q, 0.5, s, 3u) + 0.45 * bn(Q, 0.13, s, 4u);
  } else if (k == 2 || k == 3) { // woods: the floor near, the canopy far
    bool canopy = d > 700.0 + 300.0 * bayer(ti) || gi != 0;
    if (canopy) {
      ramp = k == 2 ? 4 : 5;
      float cl = vnoise(Q / (k == 2 ? 7.0 : 5.0), 7u);
      pat = (cl > 0.62 ? 1.1 : cl < 0.32 ? -1.3 : 0.0) * clamp(7.0 / s - 1.0, 0.0, 1.0) + 0.6 * bn(Q, 2.2, s, 8u) + 0.5 * bn(Q, 40.0, s, 9u);
      light = 0.12 + 0.75 * lam;
    } else {
      ramp = k == 2 ? 2 : 3;
      pat = 0.7 * bn(Q, 3.0, s, 10u) + 0.7 * bn(Q, 0.45, s, 11u) + 0.4 * bn(Q, 0.12, s, 12u);
      light = light * 0.72 - 0.05;
    }
  } else if (k == 4 || (k == 5 && steep)) { // rock: its beds, uneven, some standing out as ledges
    float yw = P.y + 0.06 * P.x - 0.045 * P.z + 9.0 * (vnoise(P.xz / 320.0, 13u) - 0.5);
    yw += 2.2 * sin(yw / 6.3) + 1.4 * sin(yw / 2.9 + 1.7) + 1.5 * (vnoise(vec2(u, P.y) / 18.0, 36u) - 0.5);
    float bt = 4.5, bi = floor(yw / bt), bf = fract(yw / bt);
    float bh = hashf(ivec2(int(bi), 3), 5u), ledge = hashf(ivec2(int(bi), 4), 37u);
    ramp = bh < 0.45 ? 6 : bh < 0.78 ? 8 : bh < 0.97 ? 7 : 9;
    float lt = clamp(bt / s * 0.25 - 0.5, 0.0, 1.0);
    pat = (hashf(ivec2(int(bi), 11), 8u) - 0.5) * 0.8;
    if (ledge < 0.35) pat += lt * ((bf > 0.88 ? 1.1 : 0.0) + (bf < 0.1 ? -1.1 : 0.0));
    // Joints: sparse, and only through part of a bed.
    float jw = 5.0 + 9.0 * hashf(ivec2(int(bi), 7), 6u), jq = u / jw + hashf(ivec2(int(bi), 9), 7u);
    if (hashf(ivec2(int(bi), int(floor(jq))), 38u) < 0.45 && fract(jq) < max(0.03, s / jw) && bf > 0.2 && bf < 0.95)
      pat -= 1.1 * clamp(jw / s * 0.3 - 0.5, 0.0, 1.0);
    // Weathering: streaks running down the face, patches of lichen-light and stain-dark.
    pat += 0.9 * bn(vec2(u, P.y * 0.12), 1.6, s, 39u) + 0.6 * bn(vec2(u, P.y), 7.0, s, 15u) + 0.4 * bn(vec2(u, P.y), 0.6, s, 14u);
    light = 0.14 + 0.95 * lam;
  } else if (k == 5) { // scree
    ramp = 10;
    pat = 1.2 * (hashf(ti, 16u) - 0.5) * clamp(0.4 / s - 0.5, 0.0, 1.0) + 0.6 * bn(Q, 1.2, s, 17u) + 0.5 * bn(Q, 9.0, s, 18u);
  } else if (k == 6) { // snow
    ramp = 11;
    pat = 0.5 * bn(Q, 7.0, s, 19u) + 0.3 * bn(Q, 1.1, s, 20u);
    light = 0.3 + 0.8 * lam;
  } else if (k == 7 || k == 8) { // water: the sky in it, ripples
    ramp = k == 7 ? 12 : 13;
    n = vec3(0.0, 1.0, 0.0);
    light = 0.45 + 0.35 * clamp(d / 2500.0, 0.0, 1.0);
    vec2 R = vec2(Q.x * 0.6, Q.y * 2.2) + vec2(0.0, uTime * (k == 7 ? -0.6 : 0.15));
    pat = 1.1 * bn(R, 1.6, s, 21u) + 0.8 * bn(R, 6.0, s, 22u);
    hollow = 0.5;
  } else if (k == 9) { // the road
    ramp = 14;
    pat = 0.6 * bn(Q, 0.7, s, 23u) + 0.7 * (hashf(ti, 24u) - 0.5) * clamp(0.2 / s - 0.5, 0.0, 1.0);
  } else if (k >= 10 && k <= 12) { // fields: furrows
    ramp = 5 + k;
    float fu = dot(Q, vec2(0.83, 0.56));
    pat = (fract(fu / 0.9) < 0.5 ? 0.6 : -0.6) * clamp(0.9 / s * 0.5 - 0.8, 0.0, 1.0) + 0.5 * bn(Q, 6.0, s, 25u) + 0.4 * bn(Q, 0.3, s, 26u);
  } else if (k == 13) { // hedges
    ramp = 18;
    pat = 0.9 * bn(Q, 1.3, s, 27u) - 0.3;
  } else if (k == 14) { // yards and lanes in the town
    ramp = 19;
    pat = 0.7 * bn(Q, 0.5, s, 28u) + 0.5 * bn(Q, 5.0, s, 29u) + 0.5 * (hashf(ti, 30u) - 0.5) * clamp(0.25 / s - 0.5, 0.0, 1.0);
  } else { // shores: gravel
    ramp = 20;
    pat = 1.0 * (hashf(ti, 31u) - 0.5) * clamp(0.3 / s - 0.5, 0.0, 1.0) + 0.5 * bn(Q, 2.0, s, 32u);
  }
  float tone = light * 5.0 + 0.3 + pat + dith * 0.9;
  vec3 c = pal(ramp, tone);
  oColor = vec4(mix(c, uHaze, hazeT(d)), 1.0);
}`;

const BUILD_VS = /* glsl */ `${COMMON}
in vec3 aPos;
in vec3 aNrm;
in vec2 aUV;
in vec2 aMat;
out vec3 vN;
out vec2 vUV;
out float vZ;
flat out ivec2 vMat;
void main() {
  float vz;
  gl_Position = project(aPos, vz);
  vZ = vz;
  vN = aNrm;
  vUV = aUV;
  vMat = ivec2(aMat + 0.5);
}`;
const BUILD_FS = /* glsl */ `${COMMON}
in vec3 vN;
in vec2 vUV;
in float vZ;
flat in ivec2 vMat;
uniform sampler2D uPal;
out vec4 oColor;
vec3 pal(int ramp, float tone) { return texelFetch(uPal, ivec2(clamp(int(floor(tone)), 0, 5), ramp), 0).rgb; }
void main() {
  float d = max(vZ, 1.0), s = exp2(ceil(log2(max(d / uF, 1.0 / 64.0))));
  vec2 q = floor(vUV / s), P = (q + 0.5) * s;
  ivec2 ti = ivec2(q);
  float lam = max(0.0, dot(normalize(vN), uSun)), light = 0.22 + 0.8 * lam, pat = 0.0, dith = bayer(ti) - 0.5;
  int m = vMat.x, ramp;
  float lt = clamp(0.4 / s - 0.6, 0.0, 1.0);
  if (m < 10) { // walls
    ramp = 21 + m;
    if (m == 2 || m == 4) { // stone courses
      float row = floor(P.y / 0.45), off = mod(row, 2.0) * 0.35;
      bool mortar = fract(P.y / 0.45) < 0.16 || fract((P.x + off) / 0.7) < 0.12;
      pat = (mortar ? -1.2 : 0.4 * (hashf(ivec2(int(floor((P.x + off) / 0.7)), int(row)), 41u) - 0.5) * 2.0) * lt;
    }
    if (m == 3) { // timber framing
      bool beam = fract(P.x / 1.4) < 0.14 || P.y < 0.25 || abs(P.y - 2.6) < 0.12 || fract(P.y / 2.6) > 0.95;
      if (beam && s < 0.3) { ramp = 25; pat = 0.0; }
    }
    pat += 0.5 * bn(P, 1.7, s, 42u);
    // Windows: a row on each floor; a door on the front.
    float wx = fract((P.x - 0.6) / 2.6), floor1 = P.y - 1.05, floor2 = P.y - 3.4;
    bool win = (wx > 0.32 && wx < 0.68) && ((floor1 > 0.0 && floor1 < 1.15) || (vMat.y >= 2 && floor2 > 0.0 && floor2 < 1.0));
    bool sill = (wx > 0.28 && wx < 0.72) && (abs(floor1 + 0.06) < 0.1 || (vMat.y >= 2 && abs(floor2 + 0.06) < 0.1));
    if (s < 0.9 && win) { ramp = 26; pat = (fract(P.y) > 0.75 ? 0.8 : 0.0); light = 0.35; }
    else if (s < 0.5 && sill) pat += 1.0;
    if ((vMat.y & 1) == 1 && s < 0.9 && abs(P.x - 0.0) < 0.6 && P.y < 2.1 && P.y > 0.0) { ramp = 25; pat = -0.5; }
    if (P.y < 0.3) pat -= 0.8; // splash at the foot
  } else { // roofs
    ramp = 17 + m;
    float course = m == 13 ? 0.6 : m == 12 ? 0.28 : 0.34;
    float row = floor(P.y / course), off = mod(row, 2.0) * 0.5;
    bool edge = fract(P.y / course) < 0.22;
    pat = (edge ? -0.9 : 0.25) * lt;
    if (m != 13) pat += (fract(P.x / 0.32 + off) < 0.12 ? -0.6 : 0.0) * lt;
    else pat += 0.8 * bn(vec2(P.x * 3.0, P.y * 0.5), 0.8, s, 43u);
    pat += 0.4 * bn(P, 2.0, s, 44u);
    light = 0.12 + 0.95 * lam;
  }
  vec3 c = pal(ramp, light * 5.0 + 0.3 + pat + dith * 0.9);
  oColor = vec4(mix(c, uHaze, hazeT(d)), 1.0);
}`;

// Sprites: each picks the two size classes around its size on screen and hands over from one to
// the other pixel by pixel (a fixed dither pattern that moves with the sprite), so growing and
// shrinking is gradual; it fades in the same way as it grows from 1 to 3 px, and out near the camera.
const SPRITE_VS = /* glsl */ `${COMMON}
in vec2 aCorner;
in vec4 iPos;
in vec2 iInfo;
uniform usampler2D uRect, uAnchor;
uniform float uSunFlip, uFar2, uNear2;
out vec2 vP;
flat out ivec4 vLo, vHi, vA;
flat out float vF, vVis, vDepth;
flat out int vFlip;
const int NC = ${26};
void main() {
  float vz;
  project(iPos.xyz, vz);
  int flags = int(iInfo.y + 0.5);
  bool top = (flags & 4) == 4;
  vec3 v = iPos.xyz - uCam;
  float want = iPos.w * uF / max(vz, 0.01);
  if (vz < 1.5 || vz > uFar2 || (want < 1.0 && !top)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sc = vec2(uRes.x * 0.5 + uF * dot(v.xz, uRight) / vz, uHz - uF * v.y / vz);
  float cf = log2(max(want, 3.0) / 3.0) * 4.0;
  int lo = min(int(floor(cf)), NC - 1), hi = min(lo + 1, NC - 1);
  float f = lo == hi ? 0.0 : smoothstep(0.3, 0.7, fract(cf));
  float vis = clamp((want - 1.0) / 2.0, 0.0, 1.0) * clamp((vz - uNear2) / (uNear2 * 0.5), 0.0, 1.0) * clamp((uFar2 - vz) / (uFar2 * 0.15), 0.0, 1.0);
  if (top) vis = 1.0;
  int slot = int(iInfo.x + 0.5);
  uvec4 rl = texelFetch(uRect, ivec2(lo, slot), 0), al = texelFetch(uAnchor, ivec2(lo, slot), 0);
  uvec4 rh = texelFetch(uRect, ivec2(hi, slot), 0), ah = texelFetch(uAnchor, ivec2(hi, slot), 0);
  bool flip = (flags & 1) == 1;
  if ((flags & 2) == 2 && uSunFlip > 0.5) flip = !flip;
  // The box, relative to the foot, that holds both images.
  vec2 mn = vec2(1e9), mx = vec2(-1e9);
  for (int k = 0; k < 2; k++) {
    uvec4 r = k == 0 ? rl : rh, a = k == 0 ? al : ah;
    vec2 o = flip ? vec2(float(a.x) - float(r.z), -float(a.y)) : vec2(-float(a.x), -float(a.y));
    mn = min(mn, o);
    mx = max(mx, o + vec2(r.zw));
  }
  vec2 P = mix(mn, mx, aCorner), px = floor(sc + 0.5) + P;
  gl_Position = vec4((px.x / uRes.x * 2.0 - 1.0) * vz, (1.0 - px.y / uRes.y * 2.0) * vz, top ? -vz : depthClip(vz), vz);
  vP = P;
  vLo = ivec4(rl);
  vHi = ivec4(rh);
  vA = ivec4(al.xy, ah.xy);
  vF = f;
  vVis = vis;
  vDepth = vz;
  vFlip = flip ? 1 : 0;
}`;
const SPRITE_FS = /* glsl */ `${COMMON}
in vec2 vP;
flat in ivec4 vLo, vHi, vA;
flat in float vF, vVis, vDepth;
flat in int vFlip;
uniform sampler2D uAtlas;
uniform float uGhost;
out vec4 oColor;
void main() {
  ivec2 p = ivec2(floor(vP));
  if (bayer(p) >= vVis) discard;
  bool hiSide = bayer(p + ivec2(2, 1)) < vF;
  ivec4 r = hiSide ? vHi : vLo;
  ivec2 a = hiSide ? vA.zw : vA.xy;
  ivec2 l = ivec2(vFlip == 1 ? a.x - 1 - p.x : p.x + a.x, p.y + a.y);
  if (l.x < 0 || l.y < 0 || l.x >= r.z || l.y >= r.w) discard;
  vec4 t = texelFetch(uAtlas, r.xy + l, 0);
  if (t.a < 0.5) discard;
  // The party seen through what stands in front of them: a pale silhouette.
  if (uGhost > 0.5) { oColor = vec4(0.99, 0.94, 0.78, 0.55); return; }
  oColor = vec4(mix(t.rgb, uHaze, hazeT(vDepth)), 1.0);
}`;

const SKY_VS = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
const SKY_FS = /* glsl */ `${COMMON}
uniform sampler2D uClouds;
uniform float uYaw;
uniform vec3 uZenith;
out vec4 oColor;
void main() {
  float row = uRes.y - gl_FragCoord.y, e = (uHz - row) / uF;
  float t = clamp(e / 0.55, 0.0, 1.0);
  vec3 c = mix(uHaze, uZenith, pow(t, 0.75));
  float az = uYaw + atan((gl_FragCoord.x - uRes.x * 0.5) / uF);
  ivec2 cs = textureSize(uClouds, 0);
  float u = fract(az / 6.2831853) * float(cs.x), v = e * uF;
  if (v >= 0.0 && v < float(cs.y)) {
    vec4 cl = texelFetch(uClouds, ivec2(int(u) % cs.x, int(v)), 0);
    c = mix(c, cl.rgb, cl.a);
  }
  oColor = vec4(c, 1.0);
}`;

const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform vec2 uOut, uArt;
uniform float uWall;
uniform vec4 uPanels[4];
uniform vec3 uBg;
out vec4 oColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) * uArt / uOut;
  ivec2 a = ivec2(floor(p));
  vec3 c = texelFetch(uImg, ivec2(a.x, int(uArt.y) - 1 - a.y), 0).rgb;
  if (uWall > 0.5) {
    bool on = false;
    for (int k = 0; k < 4; k++) { vec4 r = uPanels[k]; if (p.x >= r.x && p.y >= r.y && p.x < r.x + r.z && p.y < r.y + r.w) on = true; }
    if (!on) c = uBg;
  }
  oColor = vec4(c, 1.0);
}`;

// ---- Palette: six-shade ramps --------------------------------------------------------------
import { hex, rampOf } from "./color";
/** Base colours of the ground's ramps, by row (TERRAIN_FS and BUILD_FS index these). */
const RAMP_COLOURS: [string, number][] = [
  ["#6e9a3e", 1], // 0 meadow
  ["#97994e", 1], // 1 alpine meadow
  ["#5a5a32", 0.8], // 2 broadleaf wood floor
  ["#3e4a34", 0.8], // 3 conifer wood floor
  ["#4a7a30", 1], // 4 broadleaf canopy
  ["#2c4634", 1], // 5 conifer canopy
  ["#aaa496", 1], // 6 limestone
  ["#ab9a80", 1], // 7 sandstone
  ["#8a8680", 1], // 8 shale
  ["#9c7a6a", 1], // 9 red beds
  ["#8a847a", 1], // 10 scree
  ["#e6ecf4", 0.8], // 11 snow
  ["#5a8aa4", 0.9], // 12 river
  ["#4f7e9e", 0.9], // 13 lake
  ["#b49a70", 0.9], // 14 road
  ["#cdb05a", 1], // 15 wheat
  ["#7aa040", 1], // 16 green field
  ["#8e7656", 1], // 17 fallow
  ["#3e6030", 1], // 18 hedge
  ["#8c9064", 0.9], // 19 yard: worn grass and earth
  ["#a49a88", 1], // 20 shore gravel
  ["#e2dac6", 0.8], // 21 plaster
  ["#dcbf88", 0.8], // 22 ochre plaster
  ["#a8a08e", 1], // 23 stone wall
  ["#e0d6be", 0.8], // 24 timber house infill
  ["#5a4232", 1], // 25 dark timber, doors
  ["#3a3a40", 0.6], // 26 window glass
  ["#a84a32", 1], // 27 red tile
  ["#8a5236", 1], // 28 brown tile
  ["#5a5e6c", 1], // 29 slate
  ["#a88e56", 1], // 30 thatch
  ["#9a948a", 1], // 31 bridge stone
];

// ---- The renderer ------------------------------------------------------------------------------
export interface SpriteAtlas {
  w: number;
  h: number;
  data: Uint8Array;
  /** Per slot, per class: x, y, w, h; and ax, ay. */
  rects: Uint16Array;
  anchors: Uint16Array;
  slots: number;
  classes: number;
}
export interface Sprites {
  buf: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  count: number;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  fbo: WebGLFramebuffer;
  color: WebGLTexture;
  progs: Record<string, WebGLProgram> = {};
  grids: { h: WebGLTexture; n: WebGLTexture; k: WebGLTexture; spec: GridSpec }[] = [];
  road!: WebGLTexture;
  pal: WebGLTexture;
  patchVao!: WebGLVertexArrayObject;
  patchBuf!: WebGLBuffer;
  patchIdx = 0;
  buildVao: WebGLVertexArrayObject | null = null;
  buildCount = 0;
  quadBuf: WebGLBuffer;
  skyVao: WebGLVertexArrayObject;
  clouds: WebGLTexture | null = null;
  atlas: WebGLTexture | null = null;
  rectTex: WebGLTexture | null = null;
  anchorTex: WebGLTexture | null = null;
  timer: { ext: any; q: WebGLQuery | null; ms: number } = { ext: null, q: null, ms: 0 };
  stats = { patches: 0, tris: 0, sprites: 0 };
  /** Draw only this part of the picture (x, y from the top, w, h in art pixels): for checks under software GL. */
  crop: number[] | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    for (const [name, vs, fs] of [
      ["terrain", TERRAIN_VS, TERRAIN_FS],
      ["build", BUILD_VS, BUILD_FS],
      ["sprite", SPRITE_VS, SPRITE_FS],
      ["sky", SKY_VS, SKY_FS],
      ["blit", SKY_VS, BLIT_FS],
    ]) this.progs[name] = this.program(vs, fs);
    // The art-resolution target.
    this.color = this.tex2d(gl.RGBA8, ART_W, ART_H, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, ART_W, ART_H);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Grids (filled band by band as workers finish).
    for (const spec of GRIDS)
      this.grids.push({
        spec,
        h: this.tex2d(gl.R32F, spec.n, spec.n, gl.RED, gl.FLOAT, null, gl.NEAREST),
        n: this.tex2d(gl.RGBA8, spec.n, spec.n, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR),
        k: this.tex2d(gl.R8, spec.n, spec.n, gl.RED, gl.UNSIGNED_BYTE, null, gl.NEAREST),
      });
    this.road = this.tex2d(gl.R8, GRIDS[0].n, GRIDS[0].n, gl.RED, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    // The palette.
    const pal = new Uint8Array(6 * RAMP_COLOURS.length * 4);
    RAMP_COLOURS.forEach(([c, spread], r) => rampOf(hex(c), spread).forEach((rgb, t) => pal.set([...rgb.map((v) => Math.round(v * 255)), 255], (r * 6 + t) * 4)));
    this.pal = this.tex2d(gl.RGBA8, 6, RAMP_COLOURS.length, gl.RGBA, gl.UNSIGNED_BYTE, pal, gl.NEAREST);
    this.makePatch();
    // A quad for sprites, a triangle pair for full-screen passes.
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.skyVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.skyVao);
    const fs = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fs);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.timer.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  private program(vs: string, fs: string) {
    const gl = this.gl,
      p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as [number, string][]) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const lines = src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
        throw new Error(`shader: ${gl.getShaderInfoLog(s)}\n${lines.slice(0, 200)}`);
      }
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }
  private tex2d(internal: number, w: number, h: number, fmt: number, type: number, data: ArrayBufferView | null, filter: number) {
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, data);
    return t;
  }
  private u(p: WebGLProgram, name: string) {
    return this.gl.getUniformLocation(p, name);
  }

  /** A band of a grid has arrived from a worker. */
  uploadBand(gi: number, r0: number, r1: number, h: Float32Array, nrm: Uint8Array, kind: Uint8Array, road: Uint8Array) {
    const gl = this.gl,
      g = this.grids[gi],
      n = g.spec.n;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, g.h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RED, gl.FLOAT, h);
    gl.bindTexture(gl.TEXTURE_2D, g.n);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RGBA, gl.UNSIGNED_BYTE, nrm);
    gl.bindTexture(gl.TEXTURE_2D, g.k);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RED, gl.UNSIGNED_BYTE, kind);
    if (gi === 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.road);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RED, gl.UNSIGNED_BYTE, road);
    }
  }

  /** The terrain patch: 33 x 33 vertices and a skirt round its edge. */
  private makePatch() {
    const gl = this.gl,
      N = 32,
      verts: number[] = [],
      idx: number[] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) verts.push(i / N, j / N, 0);
    const base = verts.length / 3;
    const edge: number[] = [];
    for (let i = 0; i <= N; i++) edge.push(i); // z = 0
    for (let j = 1; j <= N; j++) edge.push(j * (N + 1) + N); // x = 1
    for (let i = N - 1; i >= 0; i--) edge.push(N * (N + 1) + i); // z = 1
    for (let j = N - 1; j >= 1; j--) edge.push(j * (N + 1)); // x = 0
    edge.push(0);
    for (const e of edge) verts.push(verts[e * 3], verts[e * 3 + 1], 1);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i,
          b = a + 1,
          c = a + N + 1,
          d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    for (let k = 0; k < edge.length - 1; k++) {
      const a = edge[k],
        b = edge[k + 1],
        sa = base + k,
        sb = base + k + 1;
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
    this.patchIdx = idx.length;
    const p = this.progs.terrain;
    this.patchVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.patchVao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const la = gl.getAttribLocation(p, "aGrid");
    gl.enableVertexAttribArray(la);
    gl.vertexAttribPointer(la, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.patchBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.patchBuf);
    const li = gl.getAttribLocation(p, "iPatch");
    gl.enableVertexAttribArray(li);
    gl.vertexAttribPointer(li, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(li, 1);
    gl.bindVertexArray(null);
  }

  /** Buildings: walls and roofs as real geometry, so they turn correctly with the camera. */
  setBuildings(list: Building[], bridge: { ax: number; az: number; bx: number; bz: number; deck: number; bed: (x: number, z: number) => number }) {
    const gl = this.gl,
      v: number[] = [];
    const push = (p: number[], n: number[], uv: number[], mat: number[]) => v.push(...p, ...n, ...uv, ...mat);
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], ua: number[], ub: number[], uc: number[], ud: number[], mat: number[]) => {
      push(a, n, ua, mat); push(b, n, ub, mat); push(c, n, uc, mat);
      push(a, n, ua, mat); push(c, n, uc, mat); push(d, n, ud, mat);
    };
    const tri = (a: number[], b: number[], c: number[], n: number[], ua: number[], ub: number[], uc: number[], mat: number[]) => {
      push(a, n, ua, mat); push(b, n, ub, mat); push(c, n, uc, mat);
    };
    const norm = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
    for (const b of list) {
      const c = Math.cos(b.angle), s = Math.sin(b.angle),
        P = (u: number, w: number, y: number) => [b.x + u * c - w * s, y, b.z + u * s + w * c],
        hw = b.w / 2, hd = b.d / 2, y0 = b.y - 1.2, yw = b.y + b.wallH, yr = yw + b.roofH,
        floors = b.wallH > 5.2 ? 2 : 0;
      // Walls: front (w = -hd), back, and the two ends.
      const walls: [number[], number[], number, number][] = [
        [[-hw, -hd], [hw, -hd], b.w, 1 | floors],
        [[hw, hd], [-hw, hd], b.w, floors],
        [[hw, -hd], [hw, hd], b.d, floors],
        [[-hw, hd], [-hw, -hd], b.d, floors],
      ];
      for (const [[u0, w0], [u1, w1], len, flag] of walls) {
        const n = norm((w1 - w0) * c + (u1 - u0) * s * 0, 0, 0);
        const ex = (u1 - u0) * c - (w1 - w0) * s, ez = (u1 - u0) * s + (w1 - w0) * c, nn = norm(ez, 0, -ex);
        void n;
        quad(P(u0, w0, y0), P(u1, w1, y0), P(u1, w1, yw), P(u0, w0, yw), nn,
          [-len / 2, y0 - b.y], [len / 2, y0 - b.y], [len / 2, b.wallH], [-len / 2, b.wallH], [b.type === 1 ? 2 : b.wall, flag]);
      }
      if (b.type === 1) {
        // The tower's pyramid roof.
        const o = 0.4, apex = [b.x, yr, b.z],
          cs = [P(-hw - o, -hd - o, yw), P(hw + o, -hd - o, yw), P(hw + o, hd + o, yw), P(-hw - o, hd + o, yw)];
        for (let k = 0; k < 4; k++) {
          const a = cs[k], bb = cs[(k + 1) % 4], mx = (a[0] + bb[0]) / 2 - b.x, mz = (a[2] + bb[2]) / 2 - b.z, n = norm(mx, Math.hypot(mx, mz) * 0.8, mz),
            L = Math.hypot(bb[0] - a[0], bb[2] - a[2]), sl = Math.hypot(Math.hypot(mx, mz), b.roofH);
          tri(a, bb, apex, n, [-L / 2, 0], [L / 2, 0], [0, sl], [10 + b.roof, 0]);
        }
        continue;
      }
      // Gable ends up to the ridge, and the two roof slopes, with eaves.
      for (const sd of [1, -1]) {
        const u = sd * hw, n = norm(sd * c, 0, sd * s);
        tri(P(u, -hd * sd, yw), P(u, hd * sd, yw), P(u, 0, yr), n, [-hd, b.wallH], [hd, b.wallH], [0, b.wallH + b.roofH], [b.wall, 0]);
      }
      const o = 0.45, eo = 0.5, slopeLen = Math.hypot(hd + eo, b.roofH);
      for (const sd of [-1, 1]) {
        const n = norm(sd * -s * b.roofH, hd, sd * c * b.roofH),
          ye = yw - (eo * b.roofH) / hd;
        quad(P(-hw - o, sd * (hd + eo), ye), P(hw + o, sd * (hd + eo), ye), P(hw + o, 0, yr), P(-hw - o, 0, yr), n,
          [-hw - o, 0], [hw + o, 0], [hw + o, slopeLen], [-hw - o, slopeLen], [10 + b.roof, 0]);
      }
    }
    // The bridge: a deck with parapets on piers, all stone.
    const L = Math.hypot(bridge.bx - bridge.ax, bridge.bz - bridge.az), ux = (bridge.bx - bridge.ax) / L, uz = (bridge.bz - bridge.az) / L;
    const box = (u0: number, u1: number, w0: number, w1: number, y0: number, y1: number) => {
      const Q = (u: number, w: number, y: number) => [bridge.ax + ux * u - uz * w, y, bridge.az + uz * u + ux * w];
      const faces: [number[][], number[]][] = [
        [[Q(u0, w0, y0), Q(u1, w0, y0), Q(u1, w0, y1), Q(u0, w0, y1)], [uz, 0, -ux]],
        [[Q(u1, w1, y0), Q(u0, w1, y0), Q(u0, w1, y1), Q(u1, w1, y1)], [-uz, 0, ux]],
        [[Q(u0, w1, y0), Q(u0, w0, y0), Q(u0, w0, y1), Q(u0, w1, y1)], [-ux, 0, -uz]],
        [[Q(u1, w0, y0), Q(u1, w1, y0), Q(u1, w1, y1), Q(u1, w0, y1)], [ux, 0, uz]],
        [[Q(u0, w0, y1), Q(u1, w0, y1), Q(u1, w1, y1), Q(u0, w1, y1)], [0, 1, 0]],
      ];
      for (const [[a, b2, c2, d2], n] of faces)
        quad(a, b2, c2, d2, n, [0, y0 - bridge.deck], [u1 - u0 + Math.abs(w1 - w0) * 0, y0 - bridge.deck], [u1 - u0, y1 - bridge.deck], [0, y1 - bridge.deck], [4, 0]);
    };
    const dk = bridge.deck;
    box(-2, L + 2, -2.2, 2.2, dk - 1.1, dk - 0.05);
    box(-2, L + 2, -2.2, -1.8, dk - 0.05, dk + 0.95);
    box(-2, L + 2, 1.8, 2.2, dk - 0.05, dk + 0.95);
    for (let u = 8; u < L - 4; u += 15) {
      const bed = bridge.bed(bridge.ax + ux * u, bridge.az + uz * u) - 2;
      box(u - 1.1, u + 1.1, -2.3, 2.3, bed, dk - 1.1);
    }
    const data = new Float32Array(v);
    this.buildCount = data.length / 10;
    const p = this.progs.build;
    this.buildVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.buildVao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [name, size, off] of [["aPos", 3, 0], ["aNrm", 3, 12], ["aUV", 2, 24], ["aMat", 2, 32]] as [string, number, number][]) {
      const l = gl.getAttribLocation(p, name);
      if (l < 0) continue;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, 40, off);
    }
    gl.bindVertexArray(null);
  }

  setAtlas(a: SpriteAtlas) {
    const gl = this.gl;
    this.atlas = this.tex2d(gl.RGBA8, a.w, a.h, gl.RGBA, gl.UNSIGNED_BYTE, a.data, gl.NEAREST);
    this.rectTex = this.tex2d(gl.RGBA16UI, a.classes, a.slots, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, a.rects, gl.NEAREST);
    this.anchorTex = this.tex2d(gl.RGBA16UI, a.classes, a.slots, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, a.anchors, gl.NEAREST);
  }
  setClouds(w: number, h: number, data: Uint8Array) {
    this.clouds = this.tex2d(this.gl.RGBA8, w, h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data, this.gl.NEAREST);
  }

  /** A sprite list: x, y, z, height in metres, slot, flags (1 mirror, 2 flips with the sun, 4 drawn over everything). */
  sprites(data: Float32Array, old?: Sprites): Sprites {
    const gl = this.gl,
      p = this.progs.sprite;
    if (old) {
      gl.bindBuffer(gl.ARRAY_BUFFER, old.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      old.count = data.length / 6;
      return old;
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    const lc = gl.getAttribLocation(p, "aCorner");
    gl.enableVertexAttribArray(lc);
    gl.vertexAttribPointer(lc, 2, gl.FLOAT, false, 0, 0);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    const lp = gl.getAttribLocation(p, "iPos"),
      li = gl.getAttribLocation(p, "iInfo");
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(lp, 1);
    gl.enableVertexAttribArray(li);
    gl.vertexAttribPointer(li, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(li, 1);
    gl.bindVertexArray(null);
    return { buf, vao, count: data.length / 6 };
  }

  /** Choose the terrain patches for this camera: finer near it, none behind it. */
  private patches(cam: Camera) {
    const out: number[] = [],
      fx = Math.sin(cam.yaw),
      fz = Math.cos(cam.yaw),
      rx = Math.cos(cam.yaw),
      rz = -Math.sin(cam.yaw),
      tanH = Math.tan(FOV / 2) * 1.15,
      Q = 5.5;
    const overlaps = (g: GridSpec, x0: number, z0: number, size: number) =>
      x0 < g.x0 + g.cell * (g.n - 2) && x0 + size > g.x0 + g.cell && z0 < g.z0 + g.cell * (g.n - 2) && z0 + size > g.z0 + g.cell;
    const visit = (x0: number, z0: number, size: number) => {
      // Cull what lies wholly behind or beside the view.
      let behind = 0, left = 0, right = 0;
      for (const [cx, cz] of [[x0, z0], [x0 + size, z0], [x0, z0 + size], [x0 + size, z0 + size]]) {
        const ex = cx - cam.x, ez = cz - cam.z, d = ex * fx + ez * fz, l = ex * rx + ez * rz;
        if (d < -size * 0.05) behind++;
        if (l < -Math.max(d, 0) * tanH - 50) left++;
        if (l > Math.max(d, 0) * tanH + 50) right++;
      }
      if (behind === 4 || left === 4 || right === 4) return;
      const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - size),
        dz = Math.max(z0 - cam.z, 0, cam.z - z0 - size),
        dist = Math.max(1, Math.hypot(dx, dz)),
        sp = size / 32,
        minSp = overlaps(GRIDS[0], x0, z0, size) ? 2 : overlaps(GRIDS[1], x0, z0, size) ? 16 : 96;
      if (sp > minSp && (sp * F) / dist > Q) {
        const h = size / 2;
        visit(x0, z0, h); visit(x0 + h, z0, h); visit(x0, z0 + h, h); visit(x0 + h, z0 + h, h);
      } else out.push(x0, z0, size, dist);
    };
    const R = 131072;
    visit(2000 - R / 2, 2000 - R / 2, R);
    // Near first, so the depth test saves work further off.
    const n = out.length / 4,
      order = Array.from({ length: n }, (_, i) => i).sort((a, b) => out[a * 4 + 3] - out[b * 4 + 3]),
      data = new Float32Array(n * 4);
    order.forEach((i, k) => data.set([out[i * 4], out[i * 4 + 1], out[i * 4 + 2], 0], k * 4));
    return data;
  }

  private common(p: WebGLProgram, cam: Camera, opt: { bands: boolean; time: number }) {
    const gl = this.gl;
    gl.useProgram(p);
    gl.uniform3f(this.u(p, "uCam"), cam.x, cam.y, cam.z);
    gl.uniform2f(this.u(p, "uFwd"), Math.sin(cam.yaw), Math.cos(cam.yaw));
    gl.uniform2f(this.u(p, "uRight"), Math.cos(cam.yaw), -Math.sin(cam.yaw));
    gl.uniform2f(this.u(p, "uRes"), ART_W, ART_H);
    gl.uniform1f(this.u(p, "uF"), F);
    gl.uniform1f(this.u(p, "uHz"), HORIZON);
    gl.uniform1f(this.u(p, "uBands"), opt.bands ? 1 : 0);
    gl.uniform1f(this.u(p, "uTime"), opt.time);
    gl.uniform3f(this.u(p, "uHaze"), 0.79, 0.85, 0.9);
    const sun = [-0.45, 0.72, -0.53],
      l = Math.hypot(...sun);
    gl.uniform3f(this.u(p, "uSun"), sun[0] / l, sun[1] / l, sun[2] / l);
  }
  private bindGrids(p: WebGLProgram, unit0: number, which: ("h" | "n" | "k")[]) {
    const gl = this.gl;
    let unit = unit0;
    this.grids.forEach((g, gi) => {
      gl.uniform4f(this.u(p, `uG${gi}`), g.spec.x0, g.spec.z0, g.spec.cell, g.spec.n);
      for (const w of which) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, g[w]);
        gl.uniform1i(this.u(p, `u${w.toUpperCase()}${gi}`), unit);
        unit++;
      }
    });
    return unit;
  }

  draw(cam: Camera, lists: { sprites: Sprites; near: number; far: number; ghost?: boolean }[], opt: { bands: boolean; wall: boolean; time: number }) {
    const gl = this.gl,
      t = this.timer;
    if (t.ext && !t.q) {
      t.q = gl.createQuery();
      gl.beginQuery(t.ext.TIME_ELAPSED_EXT, t.q!);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, ART_W, ART_H);
    if (this.crop) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(this.crop[0], ART_H - this.crop[1] - this.crop[3], this.crop[2], this.crop[3]);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // Sky.
    let p = this.progs.sky;
    this.common(p, cam, opt);
    gl.uniform1f(this.u(p, "uYaw"), cam.yaw);
    gl.uniform3f(this.u(p, "uZenith"), 0.36, 0.56, 0.8);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.clouds);
    gl.uniform1i(this.u(p, "uClouds"), 0);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Terrain.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CW);
    p = this.progs.terrain;
    this.common(p, cam, opt);
    let unit = this.bindGrids(p, 0, ["h", "n", "k"]);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.pal);
    gl.uniform1i(this.u(p, "uPal"), unit);
    gl.activeTexture(gl.TEXTURE0 + unit + 1);
    gl.bindTexture(gl.TEXTURE_2D, this.road);
    gl.uniform1i(this.u(p, "uRoad"), unit + 1);
    const patches = this.patches(cam);
    gl.bindVertexArray(this.patchVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.patchBuf);
    gl.bufferData(gl.ARRAY_BUFFER, patches, gl.STREAM_DRAW);
    gl.disable(gl.CULL_FACE);
    gl.drawElementsInstanced(gl.TRIANGLES, this.patchIdx, gl.UNSIGNED_SHORT, 0, patches.length / 4);
    this.stats.patches = patches.length / 4;
    this.stats.tris = (this.stats.patches * this.patchIdx) / 3;
    // Buildings.
    if (this.buildVao) {
      p = this.progs.build;
      this.common(p, cam, opt);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.pal);
      gl.uniform1i(this.u(p, "uPal"), 0);
      gl.bindVertexArray(this.buildVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.buildCount);
    }
    // Sprites.
    if (this.atlas) {
      p = this.progs.sprite;
      this.common(p, cam, opt);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.uniform1i(this.u(p, "uAtlas"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.rectTex);
      gl.uniform1i(this.u(p, "uRect"), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.anchorTex);
      gl.uniform1i(this.u(p, "uAnchor"), 2);
      const sunRight = Math.cos(cam.yaw) * -0.45 + -Math.sin(cam.yaw) * -0.53 > 0;
      gl.uniform1f(this.u(p, "uSunFlip"), sunRight ? 1 : 0);
      this.stats.sprites = 0;
      gl.uniform1f(this.u(p, "uGhost"), 0);
      for (const l of lists) {
        if (!l.sprites.count) continue;
        gl.uniform1f(this.u(p, "uNear2"), l.near);
        gl.uniform1f(this.u(p, "uFar2"), l.far);
        gl.bindVertexArray(l.sprites.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, l.sprites.count);
        this.stats.sprites += l.sprites.count;
      }
      // Silhouettes: where something nearer hides them, paler, over it.
      const ghosts = lists.filter((l) => l.ghost && l.sprites.count);
      if (ghosts.length) {
        gl.uniform1f(this.u(p, "uGhost"), 1);
        gl.depthFunc(gl.GREATER);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        for (const l of ghosts) {
          gl.uniform1f(this.u(p, "uNear2"), l.near);
          gl.uniform1f(this.u(p, "uFar2"), l.far);
          gl.bindVertexArray(l.sprites.vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, l.sprites.count);
        }
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
      }
    }
    gl.bindVertexArray(null);
    // Up to the screen, the wall's frame round it.
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    p = this.progs.blit;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.uniform1i(this.u(p, "uImg"), 0);
    gl.uniform2f(this.u(p, "uOut"), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u(p, "uArt"), ART_W, ART_H);
    gl.uniform1f(this.u(p, "uWall"), opt.wall ? 1 : 0);
    const k = ART_W / WALL.w;
    gl.uniform4fv(this.u(p, "uPanels"), new Float32Array(WALL.panels.flatMap(([x, y]) => [x * k, y * k, WALL.pw * k, WALL.ph * k])));
    gl.uniform3f(this.u(p, "uBg"), 0.07, 0.078, 0.098);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    if (t.ext && t.q) {
      gl.endQuery(t.ext.TIME_ELAPSED_EXT);
      const q = t.q;
      t.q = null;
      const poll = () => {
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return requestAnimationFrame(poll);
        if (!gl.getParameter(t.ext.GPU_DISJOINT_EXT)) t.ms = t.ms * 0.9 + (gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6) * 0.1;
        gl.deleteQuery(q);
      };
      requestAnimationFrame(poll);
    }
  }

  /** Read the art-resolution image back (for scripted checks). */
  readArt() {
    const gl = this.gl,
      out = new Uint8Array(ART_W * ART_H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.readPixels(0, 0, ART_W, ART_H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
}
export { KIND_COUNT };
