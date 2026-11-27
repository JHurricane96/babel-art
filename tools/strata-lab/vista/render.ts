// Vista renderer (WebGL2): the land at the wall's art resolution (980 x 637,
// four screen pixels per art pixel), upscaled without smoothing.
//
// - The camera stays level, so verticals stay vertical; the horizon's row shifts
//   (a lens shift) only to keep the party in frame on steep ground.
// - Terrain: square patches from a quadtree, finer near the camera, heights
//   read from the grids in the vertex shader; skirts hide the cracks between
//   patches of different detail.
// - The ground is shaded in world-space texels at least an art pixel across
//   (a power of two of metres, coarser with distance), each texel one colour
//   from a six-shade ramp: pixel art that does not shimmer as the camera moves.
//   Steep faces show the rock's beds.
// - Haze comes in eight bands of distance, so the land reads as layers.
// - Sprites are drawn pixel for pixel at their exact height, on whole pixels: the tiniest (and
//   grass, flowers and ferns) from images made for each height, the rest by whole rows and
//   columns of one drawing, trees and shrubs near the camera in parts (pack.ts).
import { GRIDS, type GridSpec, KIND_COUNT } from "./common";

/** Ground cover only near tiles hold has faded out by this distance (m), short of where main.ts
 * stops holding it (NEAR_COVER, 560 m, less a tile's reach). */
export const NEAR_ONLY_FADE = 525;
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
  /** The horizon's row (a lens shift up or down, so the party stays in frame on steep ground). */
  hz?: number;
}

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
uniform vec3 uCam;
uniform vec2 uFwd, uRight, uRes;
uniform float uF, uHz, uBands, uTime, uPath;
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
uniform int uBiome0;
out vec4 oColor;
bool inside(vec4 g, vec2 xz) { vec2 f = (xz - g.xy) / g.z; return all(greaterThanEqual(f, vec2(1.0))) && all(lessThan(f, vec2(g.w - 2.0))); }
vec4 nrmAt(int gi, vec2 xz) {
  if (gi == 0) return texture(uN0, ((xz - uG0.xy) / uG0.z + 0.5) / uG0.w);
  if (gi == 1) return texture(uN1, ((xz - uG1.xy) / uG1.z + 0.5) / uG1.w);
  return texture(uN2, ((xz - uG2.xy) / uG2.z + 0.5) / uG2.w);
}
vec2 kindTex(int gi, vec2 xz) {
  if (gi == 0) return texelFetch(uK0, ivec2(floor((xz - uG0.xy) / uG0.z + 0.5)), 0).rg;
  if (gi == 1) return texelFetch(uK1, ivec2(floor((xz - uG1.xy) / uG1.z + 0.5)), 0).rg;
  return texelFetch(uK2, ivec2(clamp(floor((xz - uG2.xy) / uG2.z + 0.5), vec2(0.0), vec2(uG2.w - 1.0))), 0).rg;
}
int kindAt(int gi, vec2 xz) { return int(kindTex(gi, xz).r * 255.0 + 0.5); }
// Rows of a biome's own ramps: grass, leaves, sand (or -1 where there is no biome: water).
int biomeRamp(int gi, vec2 xz, int which) {
  int b = int(kindTex(gi, xz).g * 255.0 + 0.5);
  return b == 255 ? -1 : uBiome0 + b * 3 + which;
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
    if (uPath > 0.5 && rd < 1.75 + 0.35 * (vnoise(P.xz / 1.3, 35u) - 0.5) && k != 7 && k != 8) k = 9;
  }
  float lam = max(0.0, dot(n, uSun));
  float light = 0.2 + 0.85 * lam - (hollow - 0.5) * 0.6;
  float dith = bayer(ti) - 0.5;
  int ramp = 0;
  float pat = 0.0;
  vec2 Q = P.xz;
  int bg = biomeRamp(gi, P.xz + warp, 0);
  if (k == 0 || k == 1) { // meadow, alpine meadow: the biome's own grass
    ramp = bg >= 0 ? bg : k;
    pat = 0.7 * bn(Q, 13.0, s, 1u) + 0.55 * bn(Q, 2.6, s, 2u) + 0.6 * bn(Q, 0.5, s, 3u) + 0.45 * bn(Q, 0.13, s, 4u);
  } else if (k == 2 || k == 3) { // woods: the floor near, the canopy far
    bool canopy = d > 700.0 + 300.0 * bayer(ti) || gi != 0;
    if (canopy) {
      ramp = bg >= 0 ? bg + 1 : k == 2 ? 4 : 5;
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
  } else if (k == 6) { // snow: wind ripples on it, blue ice showing in the hollows
    ramp = 11;
    float rip = dot(Q, vec2(0.8, 0.6)) / 2.6 + 0.5 * vnoise(Q / 13.0, 50u);
    pat = 0.5 * bn(Q, 7.0, s, 19u) + 0.3 * bn(Q, 1.1, s, 20u) + (fract(rip) < 0.3 ? -0.55 : 0.0) * clamp(2.6 / s * 0.5 - 0.8, 0.0, 1.0);
    if (vnoise(Q / 55.0, 49u) + 0.9 * (hollow - 0.5) > 0.7) {
      ramp = 16;
      pat = 0.6 * bn(Q, 4.0, s, 51u) + 0.4 * bn(Q, 0.8, s, 52u);
    }
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
  } else if (k == 11) { // sand: ripples on the flat, the biome's own colour
    ramp = bg >= 0 ? bg + 2 : 15;
    float ru = dot(Q, vec2(0.6, 0.8));
    pat = (fract(ru / 1.7 + 0.3 * vnoise(Q / 9.0, 46u)) < 0.35 ? 0.55 : 0.0) * clamp(1.7 / s * 0.5 - 0.8, 0.0, 1.0) + 0.6 * bn(Q, 11.0, s, 47u) + 0.3 * bn(Q, 0.4, s, 48u);
    light = 0.3 + 0.85 * lam;
  } else { // shores: gravel
    ramp = 15;
    pat = 1.0 * (hashf(ti, 31u) - 0.5) * clamp(0.3 / s - 0.5, 0.0, 1.0) + 0.5 * bn(Q, 2.0, s, 32u);
  }
  float tone = light * 5.0 + 0.3 + pat + dith * 0.9;
  vec3 c = pal(ramp, tone);
  oColor = vec4(mix(c, uHaze, hazeT(d)), 1.0);
}`;

// Sprites, at their exact height in whole pixels (pack.ts): small ones as images made for each
// height; bigger ones from one drawing, the rows and columns each height keeps read from a table;
// trees and shrubs near the camera in parts, a second pass (PARTS_VS) putting each group of clumps
// at its own place. Trees, shrubs and ground cover are stored as material and shade, and coloured
// here: each tree its own leaf colour (one of 16 per kind), some with a few cells turned for autumn.
// They fade in as they grow from 1 to 3 px, and out near the camera and far off.
const SPRITE_COLOUR = /* glsl */ `
uniform highp usampler2D uIdx, uMat;
uniform sampler2D uRgb, uSPal;
uniform int uAutumn0, uWeather0;
uniform float uGhost;
ivec2 wrap(int i) { return ivec2(i & 4095, i >> 12); }
// info: the instance's own colour (a row added to its material's first, for materials that take
// one: a rock's bedrock, a plant's biome), and its weathering (1 moss, 2 lichen, 3 snow; and how
// much, 0..3, in the bits above), laid where the drawing is open to the sky (green: 0..255).
vec4 spriteColour(int atlas, ivec2 src, int slot, uint seed, ivec2 info) {
  if (atlas == 1) return texelFetch(uRgb, src, 0);
  uvec2 v = texelFetch(uIdx, src, 0).rg;
  if (v.r == 0u) return vec4(0.0);
  uint m = v.r >> 3, t = v.r & 7u;
  uint re = texelFetch(uMat, ivec2(int(m), slot), 0).r;
  int ramp = int(re & 0x1fffu);
  if ((re & 0x2000u) != 0u) {
    // (With 0x8000 too, each value has 16 rows, and the 0x8000 below picks one per plant.)
    ramp += info.x * ((re & 0x8000u) != 0u ? 16 : 1);
    int wk = info.y & 3;
    if (wk > 0 && v.g > 0u) {
      // Patterns on the drawing's own pixels (so they stay put as it grows), different on each rock:
      // lichen in blotches wherever the stone faces at all upward; moss and snow on what is most
      // open, their edges ragged.
      float o = float(v.g) / 255.0, amt = float(info.y >> 2);
      vec2 q = vec2(src);
      uint sl = (seed & 0xffffu) + 101u;
      bool on;
      if (wk == 2) on = o > 0.25 && vnoise(q / 3.5, sl) * 0.6 + vnoise(q / 11.0, sl + 1u) * 0.4 > 0.7 - 0.05 * amt;
      else {
        float nz = vnoise(q / 7.0, sl) * 0.65 + vnoise(q / 2.2, sl + 2u) * 0.35 - 0.5;
        on = wk == 1 ? o + nz * 0.55 > 0.88 - 0.07 * amt : o + nz * 0.3 > 0.8 - 0.12 * amt;
      }
      if (on) ramp = uWeather0 + wk - 1;
    }
  }
  if ((re & 0x8000u) != 0u) {
    ramp += int(seed & 15u);
    // About one broadleaf in ten turning: some of its cells, all in one shade.
    if (m == 11u && (re & 0x4000u) != 0u && ((seed >> 8) & 255u) < 26u) {
      float a = 0.15 + float((seed >> 16) & 255u) / 255.0 * 0.35;
      if (float(hashu(uvec2(v.g, seed)) & 1023u) / 1024.0 < a) ramp = uAutumn0 + int((seed >> 24) % 3u);
    }
  }
  // (Shade 0 is the darkest shade too: some big drawings shade a pixel right down.)
  return vec4(texelFetch(uSPal, ivec2(max(int(t) - 1, 0), ramp), 0).rgb, 1.0);
}
uint treeSeed(vec3 p) { return hashu(uvec2(ivec2(floor(p.xz * 4.0)) + ivec2(1 << 20))); }
`;
const SPRITE_VS = /* glsl */ `${COMMON}
in vec2 aCorner;
in vec4 iPos;
in vec2 iInfo;
uniform highp usampler2D uEntry;
uniform float uSunFlip, uFar2, uNear2;
out vec2 vP;
flat out ivec4 vRect, vMap;
flat out ivec2 vA;
flat out float vVis, vDepth;
flat out int vFlip, vSlot;
flat out uint vSeed;
flat out ivec2 vInfo;
uint treeSeed(vec3 p) { return hashu(uvec2(ivec2(floor(p.xz * 4.0)) + ivec2(1 << 20))); }
void main() {
  float vz;
  project(iPos.xyz, vz);
  int flags = int(iInfo.y + 0.5);
  vInfo = ivec2((flags >> 3) & 127, (flags >> 10) & 15);
  bool top = (flags & 4) == 4;
  vec3 v = iPos.xyz - uCam;
  float want = iPos.w * uF / max(vz, 0.01);
  if (vz < 1.5 || vz > uFar2 || (want < 1.0 && !top)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int slot = int(iInfo.x + 0.5);
  int K = int(texelFetch(uEntry, ivec2(0, slot), 0).x);
  // Taller than its tallest drawing (close to the camera): drawn in pixels twice or three times
  // the size, so it keeps growing as it comes nearer instead of stopping (and seeming to shrink).
  // (Not those with one drawing at one size, like the party's marker.)
  int m = K <= 1 || top ? 1 : max(1, int(ceil(want / float(K))));
  int H = clamp(int(floor(want / float(m) + 0.5)), 1, K);
  uvec4 e0 = texelFetch(uEntry, ivec2(H * 2, slot), 0), e1 = texelFetch(uEntry, ivec2(H * 2 + 1, slot), 0);
  int mode = int(e1.x & 15u);
  if (mode == 0 || mode == 3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sc = vec2(uRes.x * 0.5 + uF * dot(v.xz, uRight) / vz, uHz - uF * v.y / vz);
  float vis = clamp((want - 1.0) / 2.0, 0.0, 1.0) * clamp((vz - uNear2) / (uNear2 * 0.5), 0.0, 1.0) * clamp((uFar2 - vz) / (uFar2 * 0.15), 0.0, 1.0);
  // Cover only near tiles hold (flag 16384): gone by NEAR_ONLY_FADE (main.ts holds it within
  // NEAR_COVER, 560 m), fading over the 100 m before.
  if ((flags & 16384) != 0) vis *= clamp((${NEAR_ONLY_FADE.toFixed(1)} - length(v.xz)) / 100.0, 0.0, 1.0);
  if (top) vis = 1.0;
  bool flip = (flags & 1) == 1;
  if ((flags & 2) == 2 && uSunFlip > 0.5) flip = !flip;
  ivec2 sz = ivec2(e0.z & 0xffffu, e0.z >> 16), a = ivec2(int(e0.w & 0xffffu) - 32768, int(e0.w >> 16) - 32768);
  vec2 o = flip ? vec2(float(a.x - sz.x), -float(a.y)) : vec2(-float(a.x), -float(a.y));
  vec2 P = o + aCorner * vec2(sz), px = floor(sc + 0.5) + P * float(m);
  gl_Position = vec4((px.x / uRes.x * 2.0 - 1.0) * vz, (1.0 - px.y / uRes.y * 2.0) * vz, top ? -vz : depthClip(vz), vz);
  vP = P;
  vRect = ivec4(int(e0.x & 0xffffu), int(e0.x >> 16), sz);
  vMap = ivec4(mode, int(e1.x >> 4), int(e1.y), int(e1.z));
  vA = a;
  vVis = vis;
  vDepth = vz;
  vFlip = flip ? 1 : 0;
  vSlot = slot;
  vSeed = treeSeed(iPos.xyz);
}`;
const SPRITE_FS = /* glsl */ `${COMMON}${SPRITE_COLOUR}
in vec2 vP;
flat in ivec4 vRect, vMap;
flat in ivec2 vA;
flat in float vVis, vDepth;
flat in int vFlip, vSlot;
flat in uint vSeed;
flat in ivec2 vInfo;
uniform highp usampler2D uTab;
out vec4 oColor;
void main() {
  ivec2 p = ivec2(floor(vP));
  if (bayer(p) >= vVis) discard;
  ivec2 l = ivec2(vFlip == 1 ? vA.x - 1 - p.x : p.x + vA.x, p.y + vA.y);
  if (l.x < 0 || l.y < 0 || l.x >= vRect.z || l.y >= vRect.w) discard;
  ivec2 s = l;
  if (vMap.x == 2) s = ivec2(int(texelFetch(uTab, wrap(vMap.w + l.x), 0).r), int(texelFetch(uTab, wrap(vMap.z + l.y), 0).r));
  vec4 c = spriteColour(vMap.y, vRect.xy + s, vSlot, vSeed, vInfo);
  if (c.a < 0.5) discard;
  // The party seen through what stands in front of them: a pale silhouette.
  if (uGhost > 0.5) { oColor = vec4(0.99, 0.94, 0.78, 0.55); return; }
  oColor = vec4(mix(c.rgb, uHaze, hazeT(vDepth)), 1.0);
}`;
// Parts: one instance per group of clumps per tree (trees of one kind and variant per draw). The
// tree's height on screen is worked out exactly as SPRITE_VS does, so each tree is drawn by one
// pass or the other; each part's size and place follow from it in whole numbers, as in pack.ts.
const PARTS_VS = /* glsl */ `${COMMON}
in vec2 aCorner;
uniform highp usampler2D uMeta, uPer;
uniform sampler2D uTrees;
uniform int uNC, uPartBase, uTreeBase, uK, uT;
uniform float uSunFlip, uFar2, uNear2;
out vec2 vP;
flat out ivec4 vRect;
flat out ivec2 vOrg, vTab;
flat out float vVis, vDepth;
flat out int vFlip;
flat out uint vSeed;
flat out ivec2 vInfo;
ivec2 wrap(int i) { return ivec2(i & 4095, i >> 12); }
uint treeSeed(vec3 p) { return hashu(uvec2(ivec2(floor(p.xz * 4.0)) + ivec2(1 << 20))); }
void main() {
  int ti = gl_InstanceID / uNC, pi = gl_InstanceID - ti * uNC, tb = (uTreeBase + ti) * 2;
  vec4 tp = texelFetch(uTrees, wrap(tb), 0), tq = texelFetch(uTrees, wrap(tb + 1), 0);
  float vz;
  project(tp.xyz, vz);
  vec3 v = tp.xyz - uCam;
  float want = tp.w * uF / max(vz, 0.01);
  if (vz < 1.5 || vz > uFar2 || want < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int m = max(1, int(ceil(want / float(uK))));
  int H = clamp(int(floor(want / float(m) + 0.5)), 1, uK);
  if (H < uT) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int gi = uPartBase + pi;
  uvec4 m0 = texelFetch(uMeta, wrap(gi * 2), 0), m1 = texelFetch(uMeta, wrap(gi * 2 + 1), 0);
  int ph = int(m0.y >> 16), h = max(1, (2 * ph * H + uK) / (2 * uK));
  uvec4 pe = texelFetch(uPer, wrap(int(m1.x) + h - int(m0.w)), 0);
  int nc = int(pe.z & 0xffffu), ci = int(pe.z >> 16), ri = int(pe.w);
  int cx = int(m0.z & 0xffffu) - 32768, cy = int(m0.z >> 16) - 32768;
  int x = int(floor(float((2 * cx + 1) * H) / float(2 * uK))) - ci, y = int(floor(float((2 * cy + 1) * H) / float(2 * uK))) - ri;
  int flags = int(tq.y + 0.5);
  vInfo = ivec2((flags >> 3) & 127, (flags >> 10) & 15);
  bool flip = (flags & 1) == 1;
  if ((flags & 2) == 2 && uSunFlip > 0.5) flip = !flip;
  vec2 sc = vec2(uRes.x * 0.5 + uF * dot(v.xz, uRight) / vz, uHz - uF * v.y / vz);
  vec2 o = flip ? vec2(float(-x - nc), float(y)) : vec2(float(x), float(y));
  vec2 P = o + aCorner * vec2(float(nc), float(h)), px = floor(sc + 0.5) + P * float(m);
  gl_Position = vec4((px.x / uRes.x * 2.0 - 1.0) * vz, (1.0 - px.y / uRes.y * 2.0) * vz, depthClip(vz), vz);
  vP = P;
  vRect = ivec4(int(m0.x & 0xffffu), int(m0.x >> 16), nc, h);
  vOrg = ivec2(x, y);
  vTab = ivec2(int(pe.x), int(pe.y));
  vVis = clamp((vz - uNear2) / (uNear2 * 0.5), 0.0, 1.0) * clamp((uFar2 - vz) / (uFar2 * 0.15), 0.0, 1.0);
  vDepth = vz;
  vFlip = flip ? 1 : 0;
  vSeed = treeSeed(tp.xyz);
}`;
const PARTS_FS = /* glsl */ `${COMMON}${SPRITE_COLOUR}
in vec2 vP;
flat in ivec4 vRect;
flat in ivec2 vOrg, vTab;
flat in float vVis, vDepth;
flat in int vFlip;
flat in uint vSeed;
flat in ivec2 vInfo;
uniform highp usampler2D uPTab;
uniform int uSlot;
out vec4 oColor;
void main() {
  ivec2 p = ivec2(floor(vP));
  if (bayer(p) >= vVis) discard;
  ivec2 l = ivec2(vFlip == 1 ? -vOrg.x - 1 - p.x : p.x - vOrg.x, p.y - vOrg.y);
  if (l.x < 0 || l.y < 0 || l.x >= vRect.z || l.y >= vRect.w) discard;
  ivec2 s = ivec2(int(texelFetch(uPTab, wrap(vTab.y + l.x), 0).r), int(texelFetch(uPTab, wrap(vTab.x + l.y), 0).r));
  vec4 c = spriteColour(0, vRect.xy + s, uSlot, vSeed, vInfo);
  if (c.a < 0.5) discard;
  oColor = vec4(mix(c.rgb, uHaze, hazeT(vDepth)), 1.0);
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
/** Base colours of the ground's ramps, by row (TERRAIN_FS indexes these). */
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
  ["#a49a88", 1], // 15 shore gravel
  ["#9cc2d8", 0.9], // 16 blue ice
];

// ---- The renderer ------------------------------------------------------------------------------
/** Everything the sprite passes read, made from the workers' packs (main.ts). */
export interface SpriteData {
  idx: { w: number; h: number; data: Uint8Array };
  rgb: { w: number; h: number; data: Uint8Array };
  entry: { w: number; h: number; data: Uint32Array };
  tab: { w: number; h: number; data: Uint16Array };
  ptab: { w: number; h: number; data: Uint8Array };
  mat: { w: number; h: number; data: Uint16Array };
  pal: { h: number; data: Uint8Array };
  meta: { w: number; h: number; data: Uint32Array };
  per: { w: number; h: number; data: Uint32Array };
  autumn0: number;
  /** The first of the weathering ramps: moss, lichen, snow. */
  weather0: number;
}
/** Trees drawn in parts this frame: one draw per slot. */
export interface PartsFrame {
  trees: Float32Array;
  draws: { slot: number; partBase: number; nc: number; treeBase: number; count: number; K: number; T: number; near: number; far: number }[];
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
  /** A second set of each grid's textures: the next placement is built into it while the first is
   * drawn, then the two are swapped (swapGrid). */
  back: { h: WebGLTexture; n: WebGLTexture; k: WebGLTexture }[] = [];
  road!: WebGLTexture;
  roadBack!: WebGLTexture;
  pal: WebGLTexture;
  palBase: Uint8Array;
  patchVao!: WebGLVertexArrayObject;
  patchBuf!: WebGLBuffer;
  patchIdx = 0;
  quadBuf: WebGLBuffer;
  skyVao: WebGLVertexArrayObject;
  partsVao: WebGLVertexArrayObject;
  clouds: WebGLTexture | null = null;
  spr: Record<string, WebGLTexture> | null = null;
  autumn0 = 0;
  weather0 = 0;
  treesTex: WebGLTexture | null = null;
  treesCap = 0;
  timer: { ext: any; q: WebGLQuery | null; ms: number } = { ext: null, q: null, ms: 0 };
  stats = { patches: 0, tris: 0, sprites: 0, parts: 0, partTrees: 0 };
  /** Draw only this part of the picture (x, y from the top, w, h in art pixels): for checks under software GL. */
  crop: number[] | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    for (const [name, vs, fs] of [
      ["terrain", TERRAIN_VS, TERRAIN_FS],
      ["sprite", SPRITE_VS, SPRITE_FS],
      ["parts", PARTS_VS, PARTS_FS],
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
    const set = (spec: GridSpec) => ({
      h: this.tex2d(gl.R32F, spec.n, spec.n, gl.RED, gl.FLOAT, null, gl.NEAREST),
      n: this.tex2d(gl.RGBA8, spec.n, spec.n, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR),
      k: this.tex2d(gl.RG8, spec.n, spec.n, gl.RG, gl.UNSIGNED_BYTE, null, gl.NEAREST),
    });
    for (const spec of GRIDS) {
      this.grids.push({ spec, ...set(spec) });
      this.back.push(set(spec));
    }
    this.road = this.tex2d(gl.R8, GRIDS[0].n, GRIDS[0].n, gl.RED, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    this.roadBack = this.tex2d(gl.R8, GRIDS[0].n, GRIDS[0].n, gl.RED, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    // The palette.
    const pal = new Uint8Array(6 * RAMP_COLOURS.length * 4);
    RAMP_COLOURS.forEach(([c, spread], r) => rampOf(hex(c), spread).forEach((rgb, t) => pal.set([...rgb.map((v) => Math.round(v * 255)), 255], (r * 6 + t) * 4)));
    this.pal = this.tex2d(gl.RGBA8, 6, RAMP_COLOURS.length, gl.RGBA, gl.UNSIGNED_BYTE, pal, gl.NEAREST);
    this.palBase = pal;
    this.makePatch();
    // A quad for sprites, a triangle pair for full-screen passes.
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.partsVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.partsVao);
    const lc = gl.getAttribLocation(this.progs.parts, "aCorner");
    gl.enableVertexAttribArray(lc);
    gl.vertexAttribPointer(lc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
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

  /** A band of a grid's next placement has arrived from a worker (into the back set). */
  uploadBand(gi: number, r0: number, r1: number, h: Float32Array, nrm: Uint8Array, kind: Uint8Array, road: Uint8Array) {
    const gl = this.gl,
      g = this.back[gi],
      n = this.grids[gi].spec.n;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, g.h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RED, gl.FLOAT, h);
    gl.bindTexture(gl.TEXTURE_2D, g.n);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RGBA, gl.UNSIGNED_BYTE, nrm);
    gl.bindTexture(gl.TEXTURE_2D, g.k);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RG, gl.UNSIGNED_BYTE, kind);
    if (gi === 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.roadBack);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, n, r1 - r0, gl.RED, gl.UNSIGNED_BYTE, road);
    }
  }
  /** The grid's next placement is complete: draw from it (its spec is set by the caller). */
  swapGrid(gi: number) {
    const g = this.grids[gi],
      b = this.back[gi];
    [g.h, b.h] = [b.h, g.h];
    [g.n, b.n] = [b.n, g.n];
    [g.k, b.k] = [b.k, g.k];
    if (gi === 0) [this.road, this.roadBack] = [this.roadBack, this.road];
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

  setSprites(d: SpriteData) {
    const gl = this.gl,
      t = (internal: number, fmt: number, type: number, x: { w: number; h: number; data: ArrayBufferView }) => this.tex2d(internal, x.w, x.h, fmt, type, x.data, gl.NEAREST);
    this.spr = {
      idx: t(gl.RG8UI, gl.RG_INTEGER, gl.UNSIGNED_BYTE, d.idx),
      rgb: t(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, d.rgb),
      entry: t(gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, d.entry),
      tab: t(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, d.tab),
      ptab: t(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, d.ptab),
      mat: t(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, d.mat),
      pal: t(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, { w: 6, h: d.pal.h, data: d.pal.data }),
      meta: t(gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, d.meta),
      per: t(gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, d.per),
    };
    this.autumn0 = d.autumn0;
    this.weather0 = d.weather0;
  }
  private bindSpriteTextures(p: WebGLProgram, names: [string, string][]) {
    const gl = this.gl;
    names.forEach(([u, k], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, k === "trees" ? this.treesTex : this.spr![k]);
      gl.uniform1i(this.u(p, u), i);
    });
    gl.uniform1i(this.u(p, "uAutumn0"), this.autumn0);
    gl.uniform1i(this.u(p, "uWeather0"), this.weather0);
  }
  /** Each biome's grass, leaves and sand (three ramps a biome, after the ground's own). */
  setBiomeRamps(ramps: number[][][]) {
    const gl = this.gl,
      rows = RAMP_COLOURS.length + ramps.length,
      pal = new Uint8Array(6 * rows * 4);
    pal.set(this.palBase);
    ramps.forEach((r, k) => r.forEach((rgb, t) => pal.set([...rgb.map((v) => Math.round(v * 255)), 255], ((RAMP_COLOURS.length + k) * 6 + t) * 4)));
    gl.deleteTexture(this.pal);
    this.pal = this.tex2d(gl.RGBA8, 6, rows, gl.RGBA, gl.UNSIGNED_BYTE, pal, gl.NEAREST);
  }
  setClouds(w: number, h: number, data: Uint8Array) {
    this.clouds = this.tex2d(this.gl.RGBA8, w, h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, data, this.gl.NEAREST);
  }

  /** A sprite list: x, y, z, height in metres, slot, flags (1 mirror, 2 flips with the sun, 4 drawn
   * over everything; bits 3-9 its own colour, bits 10-13 its weathering: see spriteColour). */
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
    // The root square: centred on the far grid (the whole world), with room past its edges.
    const R = 131072,
      far = GRIDS[GRIDS.length - 1],
      cx = far.x0 + (far.cell * far.n) / 2,
      cz = far.z0 + (far.cell * far.n) / 2;
    visit(cx - R / 2, cz - R / 2, R);
    // Near first, so the depth test saves work further off.
    const n = out.length / 4,
      order = Array.from({ length: n }, (_, i) => i).sort((a, b) => out[a * 4 + 3] - out[b * 4 + 3]),
      data = new Float32Array(n * 4);
    order.forEach((i, k) => data.set([out[i * 4], out[i * 4 + 1], out[i * 4 + 2], 0], k * 4));
    return data;
  }

  private common(p: WebGLProgram, cam: Camera, opt: { bands: boolean; path?: boolean; time: number }) {
    const gl = this.gl;
    gl.useProgram(p);
    gl.uniform3f(this.u(p, "uCam"), cam.x, cam.y, cam.z);
    gl.uniform2f(this.u(p, "uFwd"), Math.sin(cam.yaw), Math.cos(cam.yaw));
    gl.uniform2f(this.u(p, "uRight"), Math.cos(cam.yaw), -Math.sin(cam.yaw));
    gl.uniform2f(this.u(p, "uRes"), ART_W, ART_H);
    gl.uniform1f(this.u(p, "uF"), F);
    gl.uniform1f(this.u(p, "uHz"), cam.hz ?? HORIZON);
    gl.uniform1f(this.u(p, "uBands"), opt.bands ? 1 : 0);
    gl.uniform1f(this.u(p, "uPath"), opt.path ? 1 : 0);
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

  draw(cam: Camera, lists: { sprites: Sprites; near: number; far: number; ghost?: boolean }[], opt: { bands: boolean; wall: boolean; path?: boolean; time: number; spritesOnly?: boolean }, parts?: PartsFrame) {
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
    if (!opt.spritesOnly) {
    p = this.progs.terrain;
    this.common(p, cam, opt);
    let unit = this.bindGrids(p, 0, ["h", "n", "k"]);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.pal);
    gl.uniform1i(this.u(p, "uPal"), unit);
    gl.activeTexture(gl.TEXTURE0 + unit + 1);
    gl.bindTexture(gl.TEXTURE_2D, this.road);
    gl.uniform1i(this.u(p, "uRoad"), unit + 1);
    gl.uniform1i(this.u(p, "uBiome0"), RAMP_COLOURS.length);
    const patches = this.patches(cam);
    gl.bindVertexArray(this.patchVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.patchBuf);
    gl.bufferData(gl.ARRAY_BUFFER, patches, gl.STREAM_DRAW);
    gl.disable(gl.CULL_FACE);
    gl.drawElementsInstanced(gl.TRIANGLES, this.patchIdx, gl.UNSIGNED_SHORT, 0, patches.length / 4);
    this.stats.patches = patches.length / 4;
    this.stats.tris = (this.stats.patches * this.patchIdx) / 3;
    }
    // Sprites.
    if (this.spr) {
      p = this.progs.sprite;
      this.common(p, cam, opt);
      this.bindSpriteTextures(p, [["uIdx", "idx"], ["uRgb", "rgb"], ["uMat", "mat"], ["uSPal", "pal"], ["uEntry", "entry"], ["uTab", "tab"]]);
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
      // Trees near the camera, in parts; drawn in order, so each part covers those before it.
      this.stats.parts = 0;
      this.stats.partTrees = 0;
      if (parts && parts.draws.length) {
        const n = parts.trees.length / 4,
          rows = Math.ceil(n / 4096);
        if (!this.treesTex || this.treesCap < rows) {
          if (this.treesTex) gl.deleteTexture(this.treesTex);
          this.treesCap = Math.max(1, rows);
          this.treesTex = this.tex2d(gl.RGBA32F, 4096, this.treesCap, gl.RGBA, gl.FLOAT, null, gl.NEAREST);
        }
        gl.bindTexture(gl.TEXTURE_2D, this.treesTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        const full = Math.floor(n / 4096),
          rest = n - full * 4096;
        if (full) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4096, full, gl.RGBA, gl.FLOAT, parts.trees.subarray(0, full * 4096 * 4));
        if (rest) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, full, rest, 1, gl.RGBA, gl.FLOAT, parts.trees.subarray(full * 4096 * 4, n * 4));
        p = this.progs.parts;
        this.common(p, cam, opt);
        this.bindSpriteTextures(p, [["uIdx", "idx"], ["uRgb", "rgb"], ["uMat", "mat"], ["uSPal", "pal"], ["uMeta", "meta"], ["uPer", "per"], ["uPTab", "ptab"], ["uTrees", "trees"]]);
        gl.uniform1f(this.u(p, "uSunFlip"), sunRight ? 1 : 0);
        gl.uniform1f(this.u(p, "uGhost"), 0);
        gl.depthFunc(gl.LEQUAL);
        gl.bindVertexArray(this.partsVao);
        for (const d of parts.draws) {
          gl.uniform1i(this.u(p, "uSlot"), d.slot);
          gl.uniform1i(this.u(p, "uNC"), d.nc);
          gl.uniform1i(this.u(p, "uPartBase"), d.partBase);
          gl.uniform1i(this.u(p, "uTreeBase"), d.treeBase);
          gl.uniform1i(this.u(p, "uK"), d.K);
          gl.uniform1i(this.u(p, "uT"), d.T);
          gl.uniform1f(this.u(p, "uNear2"), d.near);
          gl.uniform1f(this.u(p, "uFar2"), d.far);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.count * d.nc);
          this.stats.parts += d.count * d.nc;
          this.stats.partTrees += d.count;
        }
        gl.depthFunc(gl.LESS);
        p = this.progs.sprite;
        gl.useProgram(p);
        this.bindSpriteTextures(p, [["uIdx", "idx"], ["uRgb", "rgb"], ["uMat", "mat"], ["uSPal", "pal"], ["uEntry", "entry"], ["uTab", "tab"]]);
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
