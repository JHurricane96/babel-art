// GPU light flood in WebGL2: several fragment-shader passes on integer textures (RGBA16UI, one 16-bit
// integer per light channel), so it uses the same fixed-point units, falloff and Bayer stepping as
// light-cpu.js. Variants:
//   jfa-full     art resolution, jump-flood style max-propagation with steps 128..1, plus an extra 1
//   jfa-half     half resolution, steps 64..1 (+1)
//   jfa-quarter  quarter resolution, steps 32..1 (+1)
//   iter-quarter quarter resolution, 32 passes of nearest-neighbour max-propagation (exact flood)
// Jumps longer than one pixel are tested against a max-pooled opacity pyramid at their midpoint,
// which can let light leak through thin walls; the comparison with the CPU flood measures that.
// Below art resolution, the result is converted to normalized RGBA8 and upsampled by the texture
// unit's bilinear filter in the final pass: the flood is exact, the presentation step uses floats.
import { ART_W, ART_H } from "./world.js";
import { UNIT, UNIT_SHIFT, LMAX, BAYER4, BAYER_U, lightParams, mediumOf, AIR } from "./light-cpu.js";
import { FULLSCREEN_VS, compile, intTexture, fboFor } from "./gl-count.js";

export const VARIANTS = {
  "jfa-full": { scale: 1, steps: [128, 64, 32, 16, 8, 4, 2, 1, 1] },
  "jfa-half": { scale: 2, steps: [64, 32, 16, 8, 4, 2, 1, 1] },
  "jfa-quarter": { scale: 4, steps: [32, 16, 8, 4, 2, 1, 1] },
  "iter-quarter": { scale: 4, steps: Array(32).fill(1) },
};

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
#ifndef UNROLL
#define UNROLL
#endif
`;

const MEDIUM_FS = (S) => HEAD + `#define SCALE ${S}
uniform usampler2D uMat;
uniform ivec2 uArt;
out uvec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * SCALE;
  uint opaque = 0u, water = 0u;
  UNROLL for (int j = 0; j < SCALE; j++) UNROLL for (int i = 0; i < SCALE; i++) {
    uint m = texelFetch(uMat, min(p + ivec2(i, j), uArt - 1), 0).r;
    bool open = m == 0u || m == 4u || m == 5u;
    water += m == 3u ? 1u : 0u;
    opaque += (open || m == 3u) ? 0u : 1u;
  }
  o = uvec4(opaque * 2u >= uint(SCALE * SCALE) ? 2u : water > 0u ? 1u : 0u, 0u, 0u, 0u);
}`;

const MIP_FS = HEAD + `
uniform usampler2D uSrc;
uniform ivec2 uSrcSize;
out uvec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  uint a = texelFetch(uSrc, min(p, uSrcSize - 1), 0).r;
  uint b = texelFetch(uSrc, min(p + ivec2(1, 0), uSrcSize - 1), 0).r;
  uint c = texelFetch(uSrc, min(p + ivec2(0, 1), uSrcSize - 1), 0).r;
  uint d = texelFetch(uSrc, min(p + ivec2(1, 1), uSrcSize - 1), 0).r;
  o = uvec4(max(max(a, b), max(c, d)), 0u, 0u, 0u);
}`;

const SKY = (S) => `#define SCALE ${S}
uniform usampler2D uMed;
uniform usampler2D uSky;
uniform uint uSkyPeak;
uniform ivec2 uArt;
uvec4 skyAt(ivec2 p) {
  uint m = texelFetch(uMed, p, 0).r;
  int fx = min(p.x * SCALE + SCALE / 2, uArt.x - 1), fy = p.y * SCALE + SCALE / 2;
  uint top = texelFetch(uSky, ivec2(fx, 0), 0).r;
  return uvec4(m == 0u && uint(fy) < top ? uSkyPeak : 0u, 0u, 0u, 0u);
}
`;

const SEED_FS = (S) => HEAD + SKY(S) + `
out uvec4 o;
void main() { o = skyAt(ivec2(gl_FragCoord.xy)); }`;

const POINTS_VS = `#version 300 es
in vec4 aLight;
uniform vec2 uSize;
flat out uvec4 vVal;
void main() {
  gl_Position = vec4((aLight.xy + 0.5) / uSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  uint ch = uint(aLight.z), v = uint(aLight.w);
  vVal = uvec4(ch == 0u ? v : 0u, ch == 1u ? v : 0u, ch == 2u ? v : 0u, ch == 3u ? v : 0u);
}`;

const POINTS_FS = (S) => HEAD + SKY(S) + `
flat in uvec4 vVal;
out uvec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (texelFetch(uMed, p, 0).r == 2u) discard;
  o = max(skyAt(p), vVal);
}`;

const PROP_FS = (occ) => HEAD + `#define OCC ${occ ? 1 : 0}
uniform usampler2D uL;
uniform usampler2D uMed;
uniform usampler2D uOcc;
uniform int uOccShift;
uniform int uStep;
uniform ivec2 uSize;
uniform uvec4 uA1, uA2, uW1, uW2; // per-channel falloff over one jump (straight, diagonal) in air and water
out uvec4 o;
// Branch-free tap: coordinates are clamped at the edges, and a jump whose midpoint block holds rock
// contributes nothing.
void tap(inout uvec4 v, ivec2 p, ivec2 d, uvec4 dec) {
  ivec2 q = clamp(p + d * uStep, ivec2(0), uSize - 1);
  uvec4 l = texelFetch(uL, q, 0);
#if OCC
  l = texelFetch(uOcc, (p + d * (uStep / 2)) >> uOccShift, 0).r == 2u ? uvec4(0u) : l;
#endif
  v = max(v, max(l, dec) - dec);
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uint m = texelFetch(uMed, p, 0).r;
  uvec4 v = texelFetch(uL, p, 0);
  bool early = m == 2u;
#ifdef COST_EARLY_OUT_ONLY
  o = early ? v : uvec4(m); return; // cost-model variant: the early-out path alone
#endif
  if (early) { o = v; return; }
  bool wet = m == 1u;
  uvec4 d1 = wet ? uW1 : uA1, d2 = wet ? uW2 : uA2;
  tap(v, p, ivec2(1, 0), d1); tap(v, p, ivec2(-1, 0), d1); tap(v, p, ivec2(0, 1), d1); tap(v, p, ivec2(0, -1), d1);
  tap(v, p, ivec2(1, 1), d2); tap(v, p, ivec2(-1, 1), d2); tap(v, p, ivec2(1, -1), d2); tap(v, p, ivec2(-1, -1), d2);
  o = v;
}`;

// For working resolutions below art resolution: convert the integer light to a normalized RGBA8
// texture so the final pass can upsample it with the texture unit's bilinear filter (one fetch).
// The flood itself stays integer and exact; only this presentation step uses floating point.
const PACK_FS = HEAD + `
uniform usampler2D uL;
out vec4 o;
void main() { o = vec4(min(texelFetch(uL, ivec2(gl_FragCoord.xy), 0), uvec4(${LMAX}u))) / ${LMAX}.0; }`;

const COMPOSITE_HW_FS = HEAD + `
uniform sampler2D uLn;   // normalized light at the working resolution, LINEAR filtered
uniform vec2 uScale;     // working texels per art pixel
out uvec4 o;
const float BAYER[16] = float[16](${BAYER4.map((b) => ((b + 0.5) / 16).toFixed(6)).join(", ")});
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 l = texture(uLn, gl_FragCoord.xy * uScale);
  float b = BAYER[(p.y & 3) * 4 + (p.x & 3)];
  o = uvec4(floor(l * ${(LMAX / UNIT) * 5} + b));
}`;

// Art resolution only: light from the flood, plus rock faces lit from open cells up to 2 px away.
const COMPOSITE_FS = HEAD + `
uniform usampler2D uMat;
uniform usampler2D uL;
uniform ivec2 uLSize;
uniform uint uRock;
out uvec4 o;
const uint LMAX = ${LMAX}u;
const uint BAYER[16] = uint[16](${Array.from(BAYER_U).map((b) => b + "u").join(", ")});
uvec4 Lat(ivec2 q) { return texelFetch(uL, clamp(q, ivec2(0), uLSize - 1), 0); }
uvec4 sat(uvec4 v, uint d) { return max(v, uvec4(d)) - uvec4(d); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uint m = texelFetch(uMat, p, 0).r;
  uvec4 v = Lat(p);
  if (!(m == 0u || m == 3u || m == 4u || m == 5u)) {
    v = max(v, sat(Lat(p + ivec2(1, 0)), uRock)); v = max(v, sat(Lat(p + ivec2(-1, 0)), uRock));
    v = max(v, sat(Lat(p + ivec2(0, 1)), uRock)); v = max(v, sat(Lat(p + ivec2(0, -1)), uRock));
    v = max(v, sat(Lat(p + ivec2(2, 0)), 2u * uRock)); v = max(v, sat(Lat(p + ivec2(-2, 0)), 2u * uRock));
    v = max(v, sat(Lat(p + ivec2(0, 2)), 2u * uRock)); v = max(v, sat(Lat(p + ivec2(0, -2)), 2u * uRock));
  }
  uint b = BAYER[(p.y & 3) * 4 + (p.x & 3)];
  o = (min(v, uvec4(LMAX)) * 5u + b) >> ${UNIT_SHIFT}u;
}`;

export class LightGPU {
  constructor(gl, variant = "jfa-half") {
    const V = VARIANTS[variant];
    this.gl = gl; this.variant = variant; this.S = V.scale; this.steps = V.steps;
    const S = this.S;
    this.lw = Math.ceil(ART_W / S); this.lh = Math.ceil(ART_H / S);
    this.p = lightParams();
    this.matTex = intTexture(gl, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, ART_W, ART_H);
    this.skyTex = intTexture(gl, gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, ART_W, 1);
    const levels = Math.max(0, ...this.steps.map((s) => (s > 1 ? Math.log2(s) - 1 : 0)));
    this.occ = []; this.occFbo = []; this.occSize = [];
    for (let k = 0; k <= levels; k++) {
      const w = Math.ceil(this.lw / 2 ** k), h = Math.ceil(this.lh / 2 ** k);
      const t = intTexture(gl, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, w, h);
      this.occ.push(t); this.occFbo.push(fboFor(gl, t)); this.occSize.push([w, h]);
    }
    this.L = [0, 1].map(() => intTexture(gl, gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, this.lw, this.lh));
    this.LF = this.L.map((t) => fboFor(gl, t));
    this.out = intTexture(gl, gl.RGBA8UI, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, ART_W, ART_H);
    if (this.S > 1) {
      this.ln = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.ln);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.lw, this.lh);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.lnF = fboFor(gl, this.ln);
    }
    this.outF = fboFor(gl, this.out);
    this.progs = LightGPU.programs(variant).reduce((a, p) => { a[p.name] = compile(gl, p.vs, p.fs, p.name); return a; }, {});
    this.vao = gl.createVertexArray();
    this.pvao = gl.createVertexArray();
    this.pbuf = gl.createBuffer();
    gl.bindVertexArray(this.pvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    const loc = gl.getAttribLocation(this.progs["light-points"].p, "aLight");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 16, 0);
    gl.bindVertexArray(null);
  }

  static programs(variant) {
    const S = VARIANTS[variant].scale;
    return [
      { name: "light-medium", vs: FULLSCREEN_VS, fs: MEDIUM_FS(S) },
      { name: "light-mip", vs: FULLSCREEN_VS, fs: MIP_FS },
      { name: "light-seed", vs: FULLSCREEN_VS, fs: SEED_FS(S) },
      { name: "light-points", vs: POINTS_VS, fs: POINTS_FS(S) },
      { name: "light-prop1", vs: FULLSCREEN_VS, fs: PROP_FS(false), trivialDefine: "COST_EARLY_OUT_ONLY" },
      { name: "light-propJ", vs: FULLSCREEN_VS, fs: PROP_FS(true), trivialDefine: "COST_EARLY_OUT_ONLY" },
      ...(S === 1 ? [{ name: "light-composite", vs: FULLSCREEN_VS, fs: COMPOSITE_FS }] : [
        { name: "light-pack", vs: FULLSCREEN_VS, fs: PACK_FS },
        { name: "light-composite", vs: FULLSCREEN_VS, fs: COMPOSITE_HW_FS },
      ]),
    ];
  }

  // Inputs from the CPU each update: the material grid of the view (R8UI), the first non-open row
  // of each column (sky), and the point lights.
  upload(world, mat, sources) {
    const gl = this.gl, { view, w } = world;
    const m = new Uint8Array(ART_W * ART_H), sky = new Uint16Array(ART_W);
    for (let y = 0; y < ART_H; y++) m.set(mat.subarray((y + view.y0) * w + view.x0, (y + view.y0) * w + view.x0 + ART_W), y * ART_W);
    for (let x = 0; x < ART_W; x++) { let y = 0; while (y < ART_H && mediumOf(m[y * ART_W + x]) === AIR) y++; sky[x] = y; }
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ART_W, ART_H, gl.RED_INTEGER, gl.UNSIGNED_BYTE, m);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ART_W, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, sky);
    const S = this.S, pts = new Float32Array(sources.length * 4);
    sources.forEach((s, i) => { pts.set([Math.floor(s.x / S), Math.floor(s.y / S), s.ch, Math.round((0.6 + 0.8 * s.a) * UNIT)], i * 4); });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW);
    this.nPoints = sources.length;
  }

  run() {
    const gl = this.gl, P = this.progs, S = this.S, { lw, lh } = this;
    const fs = (prog, fbo, w, h, tag) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
      // The pass overwrites the whole target: tell a tile-based GPU not to load the old contents.
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
      gl.__tag = tag; gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tex = (unit, t, prog, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u[name], unit); };
    gl.bindVertexArray(this.vao);
    // 1. Medium at the working resolution.
    gl.useProgram(P["light-medium"].p);
    tex(0, this.matTex, P["light-medium"], "uMat");
    gl.uniform2i(P["light-medium"].u.uArt, ART_W, ART_H);
    fs(P["light-medium"], this.occFbo[0], lw, lh, { prog: "light-medium", fetches: S * S, fetchBytes: 1, uniqueReadBytes: S * S, writeBytes: 1, farTaps: 0 });
    // 2. Max-pooled opacity pyramid for the long jumps.
    gl.useProgram(P["light-mip"].p);
    for (let k = 1; k < this.occ.length; k++) {
      tex(0, this.occ[k - 1], P["light-mip"], "uSrc");
      gl.uniform2i(P["light-mip"].u.uSrcSize, ...this.occSize[k - 1]);
      fs(P["light-mip"], this.occFbo[k], ...this.occSize[k], { prog: "light-mip", fetches: 4, fetchBytes: 1, uniqueReadBytes: 4, writeBytes: 1, farTaps: 0 });
    }
    // 3. Seed: open sky, then point lights drawn as points into the same pass.
    for (const name of ["light-seed", "light-points"]) {
      const pr = P[name]; gl.useProgram(pr.p);
      tex(0, this.occ[0], pr, "uMed"); tex(1, this.skyTex, pr, "uSky");
      gl.uniform1ui(pr.u.uSkyPeak, this.p.skyPeak); gl.uniform2i(pr.u.uArt, ART_W, ART_H);
    }
    gl.useProgram(P["light-seed"].p);
    fs(P["light-seed"], this.LF[0], lw, lh, { prog: "light-seed", fetches: 2, fetchBytes: 1.5, uniqueReadBytes: 1, writeBytes: 8, farTaps: 0 });
    if (this.nPoints) {
      gl.useProgram(P["light-points"].p);
      gl.uniform2f(P["light-points"].u.uSize, lw, lh);
      gl.bindVertexArray(this.pvao);
      gl.__tag = { prog: "light-points", fetches: 3, fetchBytes: 1.5, uniqueReadBytes: 3, writeBytes: 8, farTaps: 0 };
      gl.drawArrays(gl.POINTS, 0, this.nPoints);
      gl.bindVertexArray(this.vao);
    }
    // 4. Propagation passes.
    const d = this.p;
    let src = 0;
    for (const s of this.steps) {
      const pr = s > 1 ? P["light-propJ"] : P["light-prop1"];
      gl.useProgram(pr.p);
      tex(0, this.L[src], pr, "uL"); tex(1, this.occ[0], pr, "uMed");
      const lev = s > 1 ? Math.log2(s) - 1 : 0;
      if (pr.u.uOcc) { tex(2, this.occ[lev], pr, "uOcc"); gl.uniform1i(pr.u.uOccShift, lev); }
      gl.uniform1i(pr.u.uStep, s); gl.uniform2i(pr.u.uSize, lw, lh);
      // Falloff per jump: per-pixel decay x working-resolution scale x jump length.
      const sc = (a) => Array.from(a, (x) => x * S * s);
      gl.uniform4uiv(pr.u.uA1, sc(d.d1.slice(0, 4))); gl.uniform4uiv(pr.u.uW1, sc(d.d1.slice(4, 8)));
      gl.uniform4uiv(pr.u.uA2, sc(d.d2.slice(0, 4))); gl.uniform4uiv(pr.u.uW2, sc(d.d2.slice(4, 8)));
      // 9 light fetches (8 B) + 1 medium fetch, plus 8 opacity fetches for jumps. Taps further than a
      // 32-pixel tile apart do not share cache lines with the fragment's own tile.
      fs(pr, this.LF[1 - src], lw, lh, {
        prog: pr.name, fetches: s > 1 ? 18 : 10, fetchBytes: s > 1 ? (9 * 8 + 9) / 18 : (9 * 8 + 1) / 10,
        uniqueReadBytes: 9, writeBytes: 8, farTaps: s >= 32 ? 8 : s >= 16 ? 4 : 0, step: s,
      });
      src = 1 - src;
    }
    // 5. Composite at art resolution: rock faces (full resolution) or bilinear upsampling (lower
    // resolutions), then 5 levels with the 4x4 Bayer dither.
    if (S === 1) {
      const pc = P["light-composite"];
      gl.useProgram(pc.p);
      tex(0, this.matTex, pc, "uMat"); tex(1, this.L[src], pc, "uL");
      gl.uniform2i(pc.u.uLSize, lw, lh); gl.uniform1ui(pc.u.uRock, d.rock1);
      fs(pc, this.outF, ART_W, ART_H, { prog: "light-composite", fetches: 10, fetchBytes: 7.3, uniqueReadBytes: 9, writeBytes: 4, farTaps: 0 });
    } else {
      const pk = P["light-pack"];
      gl.useProgram(pk.p); tex(0, this.L[src], pk, "uL");
      fs(pk, this.lnF, lw, lh, { prog: "light-pack", fetches: 1, fetchBytes: 8, uniqueReadBytes: 8, writeBytes: 4, farTaps: 0 });
      const pc = P["light-composite"];
      gl.useProgram(pc.p); tex(0, this.ln, pc, "uLn");
      gl.uniform2f(pc.u.uScale, 1 / (S * lw), 1 / (S * lh));
      fs(pc, this.outF, ART_W, ART_H, { prog: "light-composite", fetches: 1, fetchBytes: 4, uniqueReadBytes: 4 / (S * S), writeBytes: 4, farTaps: 0 });
    }
    gl.__tag = null;
  }

  readOut() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outF);
    const px = new Uint32Array(ART_W * ART_H * 4);
    gl.readPixels(0, 0, ART_W, ART_H, gl.RGBA_INTEGER, gl.UNSIGNED_INT, px);
    return px;
  }
}
