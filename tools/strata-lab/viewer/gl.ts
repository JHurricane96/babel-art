// The viewer's WebGL2 renderer. Each frame it draws every visible region from
// its layers (baked colour, plants, motion classes, ground line): the sky is
// drawn live (clouds drift, stars twinkle, ridges behind), water, streams,
// waterfalls and lava move in the shader, and plants above the ground sway in
// gusts of wind. A second pass draws particles and creatures as points.
//
// Light stays baked for now: what moves changes pattern, not illumination.
import { REGION_W, WORLD_H } from "../../../engine/strata/world.ts";
import { APRON, type Tile } from "./tile.ts";

const LAND_VS = `#version 300 es
in vec2 aCorner;
uniform vec4 uRect;
uniform vec2 uViewport;
void main() {
  vec2 p = uRect.xy + aCorner * uRect.zw;
  gl_Position = vec4(p.x / uViewport.x * 2.0 - 1.0, 1.0 - p.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const NOISE = `
float hashi(ivec2 q) {
  uint h = uint(q.x) * 374761393u + uint(q.y) * 668265263u + uint(uSeed) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  ivec2 q = ivec2(i);
  float a = hashi(q), b = hashi(q + ivec2(1, 0)), c = hashi(q + ivec2(0, 1)), d = hashi(q + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5, n = 0.0;
  for (int k = 0; k < 3; k++) { v += a * vnoise(p); n += a; a *= 0.5; p *= 2.03; }
  return v / n;
}
float wind(float x, float t) {
  return 0.55 * sin(t * 1.1 + x * 0.013) + 0.45 * (vnoise(vec2(x / 160.0 - t * 0.4, 3.1)) * 2.0 - 1.0);
}`;

const LAND_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform sampler2D uBg;
uniform sampler2D uPlant;
uniform usampler2D uMotion;
uniform sampler2D uSurf;
uniform ivec2 uCamDev;
uniform float uScale;
uniform float uViewH;
uniform float uTime;
uniform int uTileX0;
uniform int uTileW;
uniform int uSeed;
uniform float uMotionOn;
out vec4 o;
${NOISE}
const float BAYER[16] = float[16](0.03125, 0.53125, 0.15625, 0.65625, 0.78125, 0.28125, 0.90625, 0.40625,
  0.21875, 0.71875, 0.09375, 0.59375, 0.96875, 0.46875, 0.84375, 0.34375);
const vec3 SKY0 = vec3(0.098, 0.110, 0.235), SKY1 = vec3(0.353, 0.247, 0.471), SKY2 = vec3(0.941, 0.627, 0.376);
const vec3 CLOUD_TOP = vec3(0.478, 0.361, 0.584), CLOUD_LIT = vec3(0.957, 0.706, 0.565);
const vec3 HAZE = vec3(0.227, 0.173, 0.353), STAR = vec3(1.0, 0.957, 0.878);

// d: rows above the horizon, as in land-render.ts.
vec3 sky(ivec2 a, float d, float t) {
  float x = float(a.x), bay = BAYER[(a.y & 3) * 4 + (a.x & 3)];
  float g = clamp(1.0 - d / 420.0, 0.0, 1.0);
  vec3 c = g < 0.55 ? mix(SKY0, SKY1, g / 0.55) : mix(SKY1, SKY2, (g - 0.55) / 0.45);
  c = floor(c * 18.0 + bay) / 18.0;
  // Clouds drifting, thin bands lit from below toward the horizon.
  float env = clamp((d - 30.0) / 40.0, 0.0, 1.0) * clamp((340.0 - d) / 60.0, 0.0, 1.0);
  float cl = 0.65 * vnoise(vec2((x - t * 2.5) / 230.0, float(a.y) / 30.0)) + 0.35 * vnoise(vec2((x - t * 4.0) / 70.0, float(a.y) / 12.0));
  float amt = floor(clamp((cl - 0.54) / 0.12, 0.0, 1.0) * env * 3.0 + bay) / 3.0;
  if (amt > 0.0) c = mix(c, mix(CLOUD_TOP, CLOUD_LIT, clamp((420.0 - d) / 260.0, 0.0, 1.0)), amt * 0.6);
  else if (d > 230.0) {
    // Each star twinkles at its own pace and phase (hashed apart from the
    // hash that places it, so they never fall into step).
    if (hashi(a + ivec2(17, 91)) > 0.9988) {
      float rate = 0.6 + 2.2 * hashi(a + ivec2(71, 2)), phase = 6.2832 * hashi(a + ivec2(5, 33));
      c = mix(c, STAR, 0.6 * min(1.0, (d - 230.0) / 120.0) * (0.6 + 0.4 * sin(t * rate + phase)));
    }
  }
  // Distant hills: flat silhouettes with crisp tops, far peaks and nearer hills.
  float r1 = 1.0 - abs(2.0 * fbm(vec2(x / 1100.0, 0.5)) - 1.0), r2 = 1.0 - abs(2.0 * fbm(vec2(x / 300.0, 7.5)) - 1.0);
  float far = 50.0 + 70.0 * r1 * r1 + 40.0 * r2 * r2 * r1 + 10.0 * fbm(vec2(x / 60.0, 3.5));
  float near = 22.0 + 28.0 * fbm(vec2(x / 520.0, 11.5)) + 12.0 * fbm(vec2(x / 90.0, 13.5));
  if (d < far) {
    bool nearer = d < near;
    float into = nearer ? near - d : far - d;
    float k = (nearer ? 0.52 : 0.3) + 0.08 * floor(min(1.0, into / 120.0) * 3.0 + bay) / 3.0;
    c = mix(c, HAZE * 0.55, k);
  }
  return c;
}

void main() {
  vec2 dev = vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y);
  ivec2 a = ivec2(floor((dev + vec2(uCamDev)) / uScale));
  ivec2 l = ivec2(a.x - uTileX0, a.y);
  if (l.x < 0 || l.x >= uTileW || l.y < 0 || l.y >= ${WORLD_H}) discard;
  float t = uTime * uMotionOn, x = float(a.x), y = float(a.y);
  uint m = texelFetch(uMotion, l, 0).r;
  vec3 c;
  if (m == 1u) c = sky(a, texelFetch(uSurf, ivec2(l.x, 1), 0).r - y, t);
  else {
    c = texelFetch(uBg, l, 0).rgb;
    if (m == 7u) {
      // A lake's skin: glints that come and go.
      if (vnoise(vec2(x * 0.35 + t * 1.2, y + t * 0.3)) > 0.84) c = mix(c, vec3(1.0, 0.94, 0.84), 0.45);
    } else if (m == 2u) {
      c *= 0.95 + 0.1 * step(0.68, vnoise(vec2(x / 9.0 + t * 0.25, y / 5.0 - t * 0.15)));
    } else if (m == 3u || m == 4u) {
      float dir = m == 3u ? 1.0 : -1.0;
      c *= 0.86 + 0.32 * step(0.6, vnoise(vec2((x - dir * t * 14.0) / 7.0, y / 1.5)));
    } else if (m == 5u) {
      c *= 0.84 + 0.3 * step(0.55, vnoise(vec2(x / 1.6, (y - t * 34.0) / 6.0)));
    } else if (m == 6u) {
      c *= 0.78 + 0.5 * floor(fbm(vec2(x / 7.0 + t * 0.12, y / 4.0 - t * 0.08)) * 4.0) / 4.0;
    }
  }
  // Plants in the open air sway in gusts that travel: each plant bends
  // about its base, row by row, more the higher the row, in the wind at its
  // base (height in the plant layer's alpha, the base's x in the colour
  // layer's). Gather: look along the row for a plant cell whose own sway
  // lands it here.
  if (m == 1u) {
    for (int k = 0; k < 7; k++) {
      int d = (k + 1) / 2 * ((k & 1) == 1 ? -1 : 1), sx = l.x - d;
      if (sx < 0 || sx >= uTileW) continue;
      vec4 p = texelFetch(uPlant, ivec2(sx, l.y), 0);
      if (p.a < 0.5 / 255.0) continue;
      float amp = clamp((p.a * 255.0 - 1.0) / 28.0, 0.0, 1.0),
        base = float(sx + uTileX0) + texelFetch(uBg, ivec2(sx, l.y), 0).a * 255.0 - 128.0;
      if (int(floor(amp * amp * 3.2 * wind(base, t) * uMotionOn + 0.5)) == d) {
        c = p.rgb;
        break;
      }
    }
  }
  o = vec4(c, 1.0);
}`;

const POINT_VS = `#version 300 es
in vec2 aPos;
in float aSize;
in vec4 aCol;
uniform ivec2 uCamDev;
uniform float uScale;
uniform vec2 uViewport;
out vec4 vCol;
void main() {
  // Sprites sit on the art-pixel grid; the finer sparks on a half-pixel grid.
  float snap = aSize >= 1.0 ? 1.0 : 2.0;
  vec2 d = floor(aPos * snap) / snap * uScale - vec2(uCamDev) + 0.5 * aSize * uScale;
  gl_Position = vec4(d.x / uViewport.x * 2.0 - 1.0, 1.0 - d.y / uViewport.y * 2.0, 0.0, 1.0);
  gl_PointSize = aSize * uScale;
  vCol = aCol;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec4 vCol;
out vec4 o;
void main() { o = vCol; }`;

export interface GpuTile {
  bg: WebGLTexture;
  plant: WebGLTexture;
  motion: WebGLTexture;
  surf: WebGLTexture;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as [number, string][]) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader failed");
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link failed");
  return p;
}

export class Renderer {
  private land: WebGLProgram;
  private points: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private pointVao: WebGLVertexArrayObject;
  private pointBuf: WebGLBuffer;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private pu: Record<string, WebGLUniformLocation | null> = {};
  private timer: { ext: unknown; query: WebGLQuery | null; ms: number } = { ext: null, query: null, ms: 0 };

  constructor(public gl: WebGL2RenderingContext) {
    this.land = compile(gl, LAND_VS, LAND_FS);
    this.points = compile(gl, POINT_VS, POINT_FS);
    for (const n of ["uRect", "uViewport", "uBg", "uPlant", "uMotion", "uSurf", "uCamDev", "uScale", "uViewH", "uTime", "uTileX0", "uTileW", "uSeed", "uMotionOn"])
      this.u[n] = gl.getUniformLocation(this.land, n);
    for (const n of ["uCamDev", "uScale", "uViewport"]) this.pu[n] = gl.getUniformLocation(this.points, n);
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const ac = gl.getAttribLocation(this.land, "aCorner");
    gl.enableVertexAttribArray(ac);
    gl.vertexAttribPointer(ac, 2, gl.FLOAT, false, 0, 0);
    this.pointVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.pointVao);
    this.pointBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    const stride = 7 * 4;
    for (const [name, size, off] of [
      ["aPos", 2, 0],
      ["aSize", 1, 8],
      ["aCol", 4, 12],
    ] as [string, number, number][]) {
      const loc = gl.getAttribLocation(this.points, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    }
    gl.bindVertexArray(null);
    this.timer.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  }

  /** Upload a tile's layers to the GPU. */
  upload(t: Tile): GpuTile {
    const gl = this.gl,
      W = t.width,
      tex = (fmt: number, internal: number, type: number, w: number, h: number, data: ArrayBufferView) => {
        const x = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, x);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, data);
        return x;
      };
    return {
      bg: tex(gl.RGBA, gl.RGBA8, gl.UNSIGNED_BYTE, W, WORLD_H, new Uint8Array(t.rgba.buffer)),
      plant: tex(gl.RGBA, gl.RGBA8, gl.UNSIGNED_BYTE, W, WORLD_H, new Uint8Array(t.plants.buffer)),
      motion: tex(gl.RED_INTEGER, gl.R8UI, gl.UNSIGNED_BYTE, W, WORLD_H, t.motion),
      // Row 0: the ground line (plants sway above it); row 1: the sky's horizon.
      surf: (() => {
        const rows = new Float32Array(W * 2);
        rows.set(Float32Array.from(t.surface));
        rows.set(t.horizon, W);
        return tex(gl.RED, gl.R32F, gl.FLOAT, W, 2, rows);
      })(),
    };
  }

  release(g: GpuTile) {
    for (const x of [g.bg, g.plant, g.motion, g.surf]) this.gl.deleteTexture(x);
  }

  /** GPU time of the last measured frame, in ms (0 if the browser can't say). */
  get gpuMs() {
    return this.timer.ms;
  }

  draw(
    tiles: { r: number; g: GpuTile }[],
    view: { left: number; top: number; scale: number; W: number; H: number },
    time: number,
    seed: number,
    motionOn: boolean,
    points: Float32Array,
    count: number,
  ) {
    const gl = this.gl,
      u = this.u,
      s = view.scale,
      camX = Math.round(view.left * s),
      camY = Math.round(view.top * s),
      ext = this.timer.ext as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    // Read back the previous frame's GPU time if it's ready.
    if (ext && this.timer.query && gl.getQueryParameter(this.timer.query, gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) this.timer.ms = gl.getQueryParameter(this.timer.query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(this.timer.query);
      this.timer.query = null;
    }
    let query: WebGLQuery | null = null;
    if (ext && !this.timer.query) {
      query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query!);
    }
    gl.viewport(0, 0, view.W, view.H);
    gl.clearColor(0.027, 0.027, 0.043, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.land);
    gl.bindVertexArray(this.quad);
    gl.uniform2f(u.uViewport, view.W, view.H);
    gl.uniform2i(u.uCamDev, camX, camY);
    gl.uniform1f(u.uScale, s);
    gl.uniform1f(u.uViewH, view.H);
    gl.uniform1f(u.uTime, time);
    gl.uniform1i(u.uSeed, seed);
    gl.uniform1f(u.uMotionOn, motionOn ? 1 : 0);
    gl.uniform1i(u.uTileW, REGION_W + 2 * APRON);
    gl.uniform1i(u.uBg, 0);
    gl.uniform1i(u.uPlant, 1);
    gl.uniform1i(u.uMotion, 2);
    gl.uniform1i(u.uSurf, 3);
    for (const { r, g } of tiles) {
      const x0 = r * REGION_W,
        dx = x0 * s - camX,
        dy = -camY;
      gl.uniform4f(u.uRect, dx, dy, REGION_W * s, WORLD_H * s);
      gl.uniform1i(u.uTileX0, x0 - APRON);
      [g.bg, g.plant, g.motion, g.surf].forEach((t, k) => {
        gl.activeTexture(gl.TEXTURE0 + k);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (count > 0) {
      gl.useProgram(this.points);
      gl.bindVertexArray(this.pointVao);
      gl.uniform2i(this.pu.uCamDev, camX, camY);
      gl.uniform1f(this.pu.uScale, s);
      gl.uniform2f(this.pu.uViewport, view.W, view.H);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
      gl.bufferData(gl.ARRAY_BUFFER, points.subarray(0, count * 7), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    if (query && ext) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.timer.query = query;
    }
  }
}
