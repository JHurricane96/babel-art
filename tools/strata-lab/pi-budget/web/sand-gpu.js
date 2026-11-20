// GPU falling sand as a Margolus block cellular automaton in WebGL2 fragment shaders, on integer
// textures. Each texel holds one 2x2 block (RGBA16UI; per cell: material in the low byte, lifetime in
// the high byte), so one fragment updates one whole block. Two layouts alternate: L0 holds even-aligned
// blocks, L1 odd-aligned blocks (offset by one cell); a pass gathers its block from four texels of the
// other layout and writes its own. Integer arithmetic and an integer hash only: no float in the state
// path, so results are bit-exact on any conformant GPU (driver bugs aside).
import { M } from "./world.js";
import { FULLSCREEN_VS, compile, intTexture, fboFor } from "./gl-count.js";

export const SAND_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uSrc;
uniform ivec2 uOff;
uniform ivec2 uSrcSize;
uniform uint uSeed;
out uvec4 o;
const uint EMPTY = 0u, ROCK = 1u, SAND = 2u, WATER = 3u, FIRE = 4u, SMOKE = 5u, WOOD = 6u;
const uint WSRC = 7u, SSRC = 8u, FSRC = 9u, SINK = 10u;
uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
// The world has a two-cell rock frame, so a clamped read past the edge only ever sees rock.
uvec4 at(ivec2 p) { return texelFetch(uSrc, clamp(p, ivec2(0), uSrcSize - 1), 0); }
const uint INERT = (1u << EMPTY) | (1u << ROCK) | (1u << WOOD);
uint dens(uint m) { return (m == SMOKE || m == FIRE) ? 0u : m == EMPTY ? 1u : m == WATER ? 2u : m == SAND ? 3u : 9u; }
void sw(inout uint x, inout uint y) { uint t = x; x = y; y = t; }
void react(inout uint m, inout uint a, uint rk, bool anyWater, bool anyFire) {
  if (m == FIRE) {
    if (anyWater) { m = SMOKE; a = 30u; }
    else if (a <= 1u) { m = SMOKE; a = 40u + (rk & 31u); }
    else { a -= 1u; }
  } else if (m == SMOKE) {
    if (a <= 1u) { m = EMPTY; a = 0u; } else { a -= 1u; }
  } else if (m == WOOD && anyFire && (rk & 7u) == 0u) { m = FIRE; a = 40u + ((rk >> 3) & 31u); }
}
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy) + uOff;
  uint c0 = at(b).w, c1 = at(b + ivec2(1, 0)).z, c2 = at(b + ivec2(0, 1)).y, c3 = at(b + ivec2(1, 1)).x;
  uint m0 = c0 & 255u, m1 = c1 & 255u, m2 = c2 & 255u, m3 = c3 & 255u;
  // Early out: only rock/empty/wood, or a uniform block of sand or water; nothing can change.
  uint seen = (1u << m0) | (1u << m1) | (1u << m2) | (1u << m3);
  bool early = (seen & ~INERT) == 0u || seen == (1u << SAND) || seen == (1u << WATER);
#ifdef COST_EARLY_OUT_ONLY
  o = early ? uvec4(c0, c1, c2, c3) : uvec4(0u); return; // cost-model variant: the early-out path alone
#endif
  if (early) { o = uvec4(c0, c1, c2, c3); return; }
  uint a0 = c0 >> 8, a1 = c1 >> 8, a2 = c2 >> 8, a3 = c3 >> 8;
  uint r = hash(uint(b.x) * 73856093u ^ uint(b.y) * 19349663u ^ uSeed * 83492791u);
  bool anyWater = m0 == WATER || m1 == WATER || m2 == WATER || m3 == WATER;
  bool anyFire = m0 == FIRE || m1 == FIRE || m2 == FIRE || m3 == FIRE || m0 == FSRC || m1 == FSRC || m2 == FSRC || m3 == FSRC;
  react(m0, a0, r, anyWater, anyFire);
  react(m1, a1, r >> 5, anyWater, anyFire);
  react(m2, a2, r >> 10, anyWater, anyFire);
  react(m3, a3, r >> 15, anyWater, anyFire);
  // Sources in the top row emit into the cell below; fire sources in the bottom row emit upwards.
  if (m0 == WSRC && m2 == EMPTY) { m2 = WATER; a2 = 0u; }
  if (m1 == WSRC && m3 == EMPTY) { m3 = WATER; a3 = 0u; }
  if (m0 == SSRC && m2 == EMPTY && (r & (1u << 20)) != 0u) { m2 = SAND; a2 = 0u; }
  if (m1 == SSRC && m3 == EMPTY && (r & (1u << 21)) != 0u) { m3 = SAND; a3 = 0u; }
  if (m2 == FSRC && m0 == EMPTY && (r & (3u << 22)) != 0u) { m0 = FIRE; a0 = 8u + ((r >> 24) & 15u); }
  if (m3 == FSRC && m1 == EMPTY && (r & (3u << 24)) != 0u) { m1 = FIRE; a1 = 8u + ((r >> 26) & 15u); }
  if (m0 == SINK || m1 == SINK || m2 == SINK || m3 == SINK) {
    if (m0 == SAND || m0 == WATER || m0 == SMOKE) { m0 = EMPTY; a0 = 0u; }
    if (m1 == SAND || m1 == WATER || m1 == SMOKE) { m1 = EMPTY; a1 = 0u; }
    if (m2 == SAND || m2 == WATER || m2 == SMOKE) { m2 = EMPTY; a2 = 0u; }
    if (m3 == SAND || m3 == WATER || m3 == SMOKE) { m3 = EMPTY; a3 = 0u; }
  }
  // Gravity and buoyancy within each column (heavier over lighter swaps).
  uint t0 = dens(m0), t1 = dens(m1), b0 = dens(m2), b1 = dens(m3);
  bool mv = false;
  if (t0 < 9u && b0 < 9u && t0 > b0) { sw(m0, m2); sw(a0, a2); mv = true; }
  if (t1 < 9u && b1 < 9u && t1 > b1) { sw(m1, m3); sw(a1, a3); mv = true; }
  if (!mv) {
    // Diagonal slides when the column below is blocked; a random bit picks the diagonal tried first.
    bool d = (r & (1u << 28)) != 0u;
    bool can03 = t0 < 9u && b1 < 9u && t0 > b1 && b0 >= t0;
    bool can12 = t1 < 9u && b0 < 9u && t1 > b0 && b1 >= t1;
    if (can03 && (d || !can12)) { sw(m0, m3); sw(a0, a3); mv = true; }
    else if (can12) { sw(m1, m2); sw(a1, a2); mv = true; }
  }
  if (!mv && (r & (1u << 29)) != 0u) {
    // Water spreads sideways along the bottom row, and along the top row where it is supported;
    // smoke drifts sideways along the top row.
    if ((m2 == WATER && (m3 == EMPTY || m3 == SMOKE)) || ((m2 == EMPTY || m2 == SMOKE) && m3 == WATER)) { sw(m2, m3); sw(a2, a3); }
    if (((m0 == WATER && m1 == EMPTY) || (m0 == EMPTY && m1 == WATER)) && dens(m2) >= 2u && dens(m3) >= 2u) { sw(m0, m1); sw(a0, a1); }
    else if ((m0 == SMOKE && m1 == EMPTY) || (m0 == EMPTY && m1 == SMOKE)) { sw(m0, m1); sw(a0, a1); }
  }
  o = uvec4(m0 | (a0 << 8), m1 | (a1 << 8), m2 | (a2 << 8), m3 | (a3 << 8));
}`;

export class SandGPU {
  constructor(gl, world, { passesPerStep = 4 } = {}) {
    this.gl = gl;
    this.w = world.w; this.h = world.h;
    this.bw = world.w >> 1; this.bh = world.h >> 1;
    this.passesPerStep = passesPerStep;
    this.pass = 0;
    const packed = new Uint16Array(this.bw * this.bh * 4);
    for (let j = 0; j < this.bh; j++) for (let i = 0; i < this.bw; i++) for (let k = 0; k < 4; k++) {
      const x = 2 * i + (k & 1), y = 2 * j + (k >> 1), c = y * world.w + x;
      packed[(j * this.bw + i) * 4 + k] = world.mat[c] | (world.aux[c] << 8);
    }
    const ROCKS = new Uint16Array((this.bw + 1) * (this.bh + 1) * 4).fill(M.ROCK);
    this.t0 = intTexture(gl, gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, this.bw, this.bh, packed);
    this.t1 = intTexture(gl, gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, this.bw + 1, this.bh + 1, ROCKS);
    this.f0 = fboFor(gl, this.t0); this.f1 = fboFor(gl, this.t1);
    this.prog = compile(gl, FULLSCREEN_VS, SAND_FS, "sand-block");
    this.vao = gl.createVertexArray();
  }

  static programs() { return [{ name: "sand-block", vs: FULLSCREEN_VS, fs: SAND_FS, trivialDefine: "COST_EARLY_OUT_ONLY" }]; }

  step() {
    const gl = this.gl, P = this.prog;
    gl.useProgram(P.p); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(P.u.uSrc, 0);
    for (let k = 0; k < this.passesPerStep; k++, this.pass++) {
      const toOdd = (this.pass & 1) === 0; // L0 -> L1, then L1 -> L0
      gl.bindFramebuffer(gl.FRAMEBUFFER, toOdd ? this.f1 : this.f0);
      gl.viewport(0, 0, toOdd ? this.bw + 1 : this.bw, toOdd ? this.bh + 1 : this.bh);
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]); // whole target is rewritten
      gl.bindTexture(gl.TEXTURE_2D, toOdd ? this.t0 : this.t1);
      gl.uniform2i(P.u.uOff, toOdd ? -1 : 0, toOdd ? -1 : 0);
      gl.uniform2i(P.u.uSrcSize, toOdd ? this.bw : this.bw + 1, toOdd ? this.bh : this.bh + 1);
      gl.uniform1ui(P.u.uSeed, this.pass);
      // Per fragment: 4 fetches of 8-byte texels; each source texel is shared by 4 fragments, so with a
      // perfect texture cache the pass reads each source texel once (8 B per fragment) and writes 8 B.
      gl.__tag = { prog: "sand-block", fetches: 4, fetchBytes: 8, uniqueReadBytes: 8, writeBytes: 8, farTaps: 0 };
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.__tag = null;
  }

  // Cell grid (material, lifetime) read back from L0 (valid after a whole step).
  readCells() {
    const gl = this.gl, { bw, bh, w, h } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.f0);
    const px = new Uint32Array(bw * bh * 4);
    gl.readPixels(0, 0, bw, bh, gl.RGBA_INTEGER, gl.UNSIGNED_INT, px);
    const mat = new Uint8Array(w * h), aux = new Uint8Array(w * h);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) for (let k = 0; k < 4; k++) {
      const v = px[(j * bw + i) * 4 + k], c = (2 * j + (k >> 1)) * w + 2 * i + (k & 1);
      mat[c] = v & 255; aux[c] = v >> 8;
    }
    return { mat, aux };
  }
}

// Fraction of blocks, and of 4x4-fragment groups (16 lanes), that take the shader's full path rather
// than the early-out, for both block partitions. Used by the GPU cost model for divergence.
export function sandActivity(mat, w, h) {
  const inert = (m) => m === M.EMPTY || m === M.ROCK || m === M.WOOD;
  const out = {};
  for (const off of [0, 1]) {
    const bw = (w >> 1) + off, bh = (h >> 1) + off;
    const act = new Uint8Array(bw * bh);
    let nAct = 0;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const ms = [];
      for (let k = 0; k < 4; k++) {
        const x = 2 * i - off + (k & 1), y = 2 * j - off + (k >> 1);
        ms.push(x < 0 || y < 0 || x >= w || y >= h ? M.ROCK : mat[y * w + x]);
      }
      const same = ms[0] === ms[1] && ms[1] === ms[2] && ms[2] === ms[3] && (ms[0] === M.SAND || ms[0] === M.WATER);
      const triv = same || ms.every(inert);
      if (!triv) { act[j * bw + i] = 1; nAct++; }
    }
    let groups = 0, gAct = 0;
    for (let gy = 0; gy < bh; gy += 4) for (let gx = 0; gx < bw; gx += 4) {
      groups++;
      let any = 0;
      for (let y = gy; y < Math.min(bh, gy + 4); y++) for (let x = gx; x < Math.min(bw, gx + 4); x++) any |= act[y * bw + x];
      gAct += any;
    }
    out[off ? "odd" : "even"] = { blockFrac: nAct / (bw * bh), groupFrac: gAct / groups };
  }
  return {
    blockFrac: (out.even.blockFrac + out.odd.blockFrac) / 2,
    groupFrac: (out.even.groupFrac + out.odd.groupFrac) / 2,
    ...out,
  };
}
