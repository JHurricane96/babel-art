// Counts what a WebGL2 workload asks of the GPU: draw calls, render passes (framebuffer changes, which
// on a tile-based GPU such as VideoCore VII mean a full tile load/store cycle), fragments shaded and
// bytes uploaded or read back. Each draw also carries the caller's tag (gl.__tag), which describes the
// program's texture fetches and bytes, for the cost model. Counting is independent of the rasterizer,
// so the numbers are the same under SwiftShader as on a real GPU.
export function instrument(gl) {
  const st = {
    draws: [], passes: 0, uploadBytes: 0, readBytes: 0, bufferBytes: 0,
    reset() { this.draws = []; this.passes = 0; this.uploadBytes = 0; this.readBytes = 0; this.bufferBytes = 0; },
  };
  let fbo = null, lastDrawFbo = undefined, dirty = true, vp = [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight];
  const wrap = (name, fn) => { const orig = gl[name].bind(gl); gl[name] = (...a) => fn(orig, ...a); };
  wrap("bindFramebuffer", (o, target, f) => { if (target !== gl.READ_FRAMEBUFFER) { if (f !== fbo) dirty = true; fbo = f; } return o(target, f); });
  wrap("viewport", (o, x, y, w, h) => { vp = [x, y, w, h]; return o(x, y, w, h); });
  const draw = (mode, count) => {
    if (dirty || fbo !== lastDrawFbo) { st.passes++; dirty = false; lastDrawFbo = fbo; }
    const frags = mode === gl.POINTS ? count : vp[2] * vp[3];
    st.draws.push({ tag: gl.__tag || null, w: vp[2], h: vp[3], frags, mode: mode === gl.POINTS ? "points" : "tris", count });
  };
  wrap("drawArrays", (o, mode, first, count) => { draw(mode, count); return o(mode, first, count); });
  const upBytes = (args) => { for (const a of args) if (ArrayBuffer.isView(a)) return a.byteLength; return 0; };
  wrap("texImage2D", (o, ...a) => { st.uploadBytes += upBytes(a); return o(...a); });
  wrap("texSubImage2D", (o, ...a) => { st.uploadBytes += upBytes(a); return o(...a); });
  wrap("bufferData", (o, ...a) => { st.bufferBytes += upBytes(a); return o(...a); });
  wrap("bufferSubData", (o, ...a) => { st.bufferBytes += upBytes(a); return o(...a); });
  wrap("readPixels", (o, ...a) => { st.readBytes += upBytes(a); return o(...a); });
  return st;
}

export function compile(gl, vs, fs, name) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
  return { p, u, name, vs, fs };
}

export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export function intTexture(gl, internal, format, type, w, h, data = null) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, data);
  return t;
}

export function fboFor(gl, tex) {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const s = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (s !== gl.FRAMEBUFFER_COMPLETE) throw new Error("framebuffer incomplete " + s);
  return f;
}
