import { program, vertex } from "./grid";
import { ROLE_GLSL, paletteRoles, setRoleUniforms } from "./finish";
import { variationOf } from "./evolution";
import { BIRD_STRIDE, falcon, falconPresence } from "./murmuration";
import type { Appearance, RenderFrame, SceneRenderer } from "./render-frame";
import { PARTICLE_STRIDE } from "./particles";
import { SLIME_WIDTH, SLIME_HEIGHT, SLIME_CELLS } from "./slime";

export type Color = number[];
export const mixColor = (a: Color, b: Color, t: number, alpha = 1): Color => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  alpha,
];
const batchVertex = `attribute vec2 p;attribute vec4 pigment;attribute vec2 texcoord;uniform vec2 size;varying vec4 color;varying vec2 uv;void main(){color=pigment;uv=texcoord;gl_Position=vec4(p/size*2.-1.,0.,1.);}`;
const batchFragment = `precision highp float;varying vec4 color;varying vec2 uv;uniform sampler2D atlas;uniform int textured;void main(){vec4 c=color;if(textured==1)c*=texture2D(atlas,uv);gl_FragColor=c;}`;
/** A single reusable vertex stream for strokes, tiles, and atlas sprites. */
export class Batch {
  data = new Float32Array(262144 * 8);
  count = 0;
  buffer: WebGLBuffer;
  prog: WebGLProgram;
  white: WebGLTexture;
  constructor(public gl: WebGLRenderingContext) {
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.buffer = gl.createBuffer()!;
    this.prog = program(gl, batchVertex, batchFragment);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }
  point(x: number, y: number, c: Color, u = 0, v = 0) {
    if (this.count + 8 > this.data.length)
      throw new Error("Artwork vertex budget exceeded");
    const d = this.data,
      n = this.count;
    d[n] = x;
    d[n + 1] = y;
    d[n + 2] = c[0];
    d[n + 3] = c[1];
    d[n + 4] = c[2];
    d[n + 5] = c[3] ?? 1;
    d[n + 6] = u;
    d[n + 7] = v;
    this.count += 8;
  }
  rect(x: number, y: number, w: number, h: number, c: Color, uv?: number[]) {
    const [u, v, uw, vh] = uv ?? [0, 0, 0, 0];
    this.point(x, y, c, u, v);
    this.point(x + w, y, c, u + uw, v);
    this.point(x, y + h, c, u, v + vh);
    this.point(x, y + h, c, u, v + vh);
    this.point(x + w, y, c, u + uw, v);
    this.point(x + w, y + h, c, u + uw, v + vh);
  }
  triangle(
    x: number,
    y: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    c: Color,
  ) {
    this.point(x, y, c);
    this.point(x1, y1, c);
    this.point(x2, y2, c);
  }
  line(x: number, y: number, x1: number, y1: number, width: number, c: Color) {
    const len = Math.hypot(x1 - x, y1 - y) || 1,
      dx = ((y1 - y) / len) * width * 0.5,
      dy = (-(x1 - x) / len) * width * 0.5;
    this.point(x + dx, y + dy, c);
    this.point(x1 + dx, y1 + dy, c);
    this.point(x - dx, y - dy, c);
    this.point(x - dx, y - dy, c);
    this.point(x1 + dx, y1 + dy, c);
    this.point(x1 - dx, y1 - dy, c);
  }
  draw(w: number, h: number, texture?: WebGLTexture) {
    if (!this.count) return;
    const gl = this.gl,
      p = this.prog;
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count));
    for (const [name, size, offset] of [
      ["p", 2, 0],
      ["pigment", 4, 8],
      ["texcoord", 2, 24],
    ] as const) {
      const at = gl.getAttribLocation(p, name);
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, 32, offset);
    }
    gl.uniform2f(gl.getUniformLocation(p, "size"), w, h);
    gl.uniform1i(gl.getUniformLocation(p, "textured"), texture ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture ?? this.white);
    gl.uniform1i(gl.getUniformLocation(p, "atlas"), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this.count / 8);
    gl.disable(gl.BLEND);
    for (const name of ["p", "pigment", "texcoord"])
      gl.disableVertexAttribArray(gl.getAttribLocation(p, name));
    this.count = 0;
  }
  dispose() {
    this.gl.deleteTexture(this.white);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.prog);
  }
}
/** Endpoint instances avoid expanding every trail segment into colored vertices. */
class RibbonGPU {
  instances = new Float32Array(1800 * 6 * 5);
  quad: WebGLBuffer;
  buffer: WebGLBuffer;
  prog: WebGLProgram;
  extension: ANGLE_instanced_arrays | null;
  gl2: WebGL2RenderingContext | undefined;
  constructor(public gl: WebGLRenderingContext) {
    this.gl2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext
        ? gl
        : undefined;
    this.extension = this.gl2
      ? null
      : gl.getExtension("ANGLE_instanced_arrays");
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, -1, 1, -1, 0, 1, 0, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
    this.prog = program(
      gl,
      `attribute vec2 p;attribute vec4 endpoints;attribute float warmth;uniform float width;varying float warm;varying float edge;void main(){vec2 delta=endpoints.zw-endpoints.xy;vec2 n=vec2(-delta.y,delta.x)/max(.001,length(delta));vec2 q=mix(endpoints.xy,endpoints.zw,p.x)+n*p.y*width*.5;warm=warmth;edge=p.y;gl_Position=vec4(q/vec2(640.,400.)*2.-1.,0.,1.);}`,
      `precision highp float;varying float warm,edge;uniform vec3 c1,c2;uniform float opacity;void main(){gl_FragColor=vec4(mix(c1,c2,warm),opacity*(1.-smoothstep(.65,1.,abs(edge))));}`,
    );
  }
  divisor(at: number, n: number) {
    if (this.gl2) this.gl2.vertexAttribDivisor(at, n);
    else this.extension!.vertexAttribDivisorANGLE(at, n);
  }
  draw(d: Float32Array, colors: number[][], detail: number) {
    const gl = this.gl,
      p = this.prog;
    let n = 0;
    for (let i = 0; i < d.length; i += PARTICLE_STRIDE)
      for (let j = 0; j < PARTICLE_STRIDE - 2; j += 2) {
        this.instances[n++] = d[i + j] * 640;
        this.instances[n++] = d[i + j + 1] * 400;
        this.instances[n++] = d[i + j + 2] * 640;
        this.instances[n++] = d[i + j + 3] * 400;
        this.instances[n++] = ((i / PARTICLE_STRIDE) % 6) / 5;
      }
    gl.useProgram(p);
    const pos = gl.getAttribLocation(p, "p"),
      ends = gl.getAttribLocation(p, "endpoints"),
      warm = gl.getAttribLocation(p, "warmth");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instances.subarray(0, n));
    gl.enableVertexAttribArray(ends);
    gl.vertexAttribPointer(ends, 4, gl.FLOAT, false, 20, 0);
    this.divisor(ends, 1);
    gl.enableVertexAttribArray(warm);
    gl.vertexAttribPointer(warm, 1, gl.FLOAT, false, 20, 16);
    this.divisor(warm, 1);
    gl.uniform3fv(gl.getUniformLocation(p, "c1"), colors[1]);
    gl.uniform3fv(gl.getUniformLocation(p, "c2"), colors[2]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (let pass = 0; pass < 2; pass++) {
      gl.uniform1f(
        gl.getUniformLocation(p, "width"),
        pass === 0 ? 3.5 + detail * 3 : 1.35,
      );
      gl.uniform1f(
        gl.getUniformLocation(p, "opacity"),
        pass === 0 ? 0.08 + detail * 0.08 : 0.36 + detail * 0.36,
      );
      if (this.gl2) this.gl2.drawArraysInstanced(gl.TRIANGLES, 0, 6, n / 5);
      else this.extension!.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, n / 5);
    }
    this.divisor(ends, 0);
    this.divisor(warm, 0);
    gl.disableVertexAttribArray(ends);
    gl.disableVertexAttribArray(warm);
    gl.disableVertexAttribArray(pos);
    gl.disable(gl.BLEND);
  }
  dispose() {
    this.gl.deleteBuffer(this.quad);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.prog);
  }
}
const background = `precision highp float;varying vec2 uv;uniform vec3 c0,c1,c2;uniform float time,seed;uniform int kind,silhouette,dusk;
${ROLE_GLSL}
void main(){vec2 p=uv;vec3 c;if(kind==0){float f=.5+.5*sin(p.x*7.+sin(p.y*8.+time*.04)*1.3);c=mix(c0*.15,c0*.7,f)+c1*.025;}
else if(dusk==1){
 vec3 zenith=silhouette==1?mix(toneShadow,toneBody,.55):toneGround*1.15;
 vec3 middle=silhouette==1?mix(toneBody,toneDusk,.6):mix(toneShadow,toneDusk,.42);
 vec3 low=silhouette==1?mix(toneDusk,toneHighlight,.58):mix(toneDusk,c2,.32);
 vec3 sky=mix(zenith,middle,smoothstep(0.,.55,p.y));
 sky=mix(sky,low,smoothstep(.42,.8,p.y));
 vec2 sp=(p-vec2(.7,.745))*vec2(1.6,1.);float sun=length(sp);
 sky+=mix(c2,toneHighlight,.5)*(exp(-sun*5.)*.3+exp(-sun*18.)*.22);
 sky=mix(sky,mix(toneHighlight,vec3(1.),.25),(1.-smoothstep(.026,.031,sun))*.85);
 float haze=.5+.5*sin(p.x*3.1+seed*.01+sin(p.x*7.3)*.6);
 sky=mix(sky,low,haze*smoothstep(.5,.8,p.y)*.22);
 c=sky;
 for(int i=0;i<3;i++){float n=float(i);
  float ridge=.80+n*.045-(sin(p.x*5.+n*1.7+seed*.01)*.022+sin(p.x*13.+n*2.3)*.008+sin(p.x*41.+n)*.003);
  vec3 land=mix(mix(low,toneShadow,.5),mix(toneShadow,toneGround,.55),n*.5);
  c=mix(c,land,smoothstep(ridge,ridge+.003,p.y));}
}
else{float sky=smoothstep(0.,1.,p.y);c=mix(silhouette==1?mix(c0,c2,.45):c0*.3,mix(c0,c2,.28),sky);float sun=length((p-vec2(.72,.34))*vec2(1.6,1.));c+=c2*.16*exp(-sun*4.);c=mix(c,mix(c2,c1,.3),1.-smoothstep(.071,.078,sun));for(int i=0;i<3;i++){float n=float(i);float hill=.88+n*.035-sin(p.x*6.+n+seed*.01)*.035;c=mix(c,c0*(.8-n*.2),smoothstep(hill,hill+.004,p.y));}}
gl_FragColor=vec4(c,1.);}`;
// Slime field: a soft halo plus a vein band thresholded from the bilinear
// field, so the low-resolution trail reads as crisp veins with bright cores
// instead of blurred tubes. Grain lives on a fine world-fixed lattice.
const slimeFragment = `precision highp float;varying vec2 uv;uniform sampler2D field;uniform vec3 c0,c1,c2;uniform float detail,seed;uniform int etched;
${ROLE_GLSL}
float value(vec2 p){vec2 v=texture2D(field,p).rg;return v.r+v.g/255.;}
void main(){vec2 p=uv*vec2(192.,120.);float v=value(uv);
float halo=1.-exp(-v*1.7);
float vein=smoothstep(.3,.78,v);
// How far inside a vein this pixel is, precomputed per cell in blue.
float depth=smoothstep(.5,1.,texture2D(field,uv).b);
float junction=clamp((v-.48)*1.7,0.,1.);
float grain=fract(sin(dot(floor(uv*vec2(960.,600.)),vec2(127.1,311.7))+seed)*43758.5453)-.5;
float mineral=.5+.5*sin(p.x*.033+sin(p.y*.047));
float warm=etched==1?.58+junction*.25+mineral*.15:.08+junction*.45+mineral*.15;
vec3 pigment=mix(mix(c1,toneBridge,smoothstep(0.,.5,warm)),c2,smoothstep(.5,1.,warm));
vec3 c=toneGround*(.6+detail*.1*grain);
c+=pigment*halo*.18;
c+=pigment*vein*(.4+.3*depth+detail*.07*grain);
c+=mix(pigment,toneHighlight,.55)*depth*depth*.28;
gl_FragColor=vec4(c,1.);}`;

export class EntityGPU implements SceneRenderer {
  width = 640;
  height = 400;
  batch: Batch;
  quad: WebGLBuffer;
  bg: WebGLProgram;
  fieldProgram?: WebGLProgram;
  field?: WebGLTexture;
  packed = new Uint8Array(SLIME_CELLS * 4);
  ribbons?: RibbonGPU;
  sky?: WebGLTexture;
  skyBuffer?: WebGLFramebuffer;
  skyKey = "";
  constructor(
    public gl: WebGLRenderingContext,
    public kind: "rivers" | "slime" | "murmuration",
  ) {
    this.batch = new Batch(gl);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.bg = program(gl, vertex, background);
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const software =
      info &&
      /swiftshader|llvmpipe|software/i.test(
        String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)),
      );
    // Small-instance dispatch is expensive in CPU rasterizers; the expanded batch is faster there.
    if (
      kind === "rivers" &&
      !software &&
      ((typeof WebGL2RenderingContext !== "undefined" &&
        gl instanceof WebGL2RenderingContext) ||
        gl.getExtension("ANGLE_instanced_arrays"))
    )
      this.ribbons = new RibbonGPU(gl);
    if (kind === "slime") {
      this.fieldProgram = program(gl, vertex, slimeFragment);
      this.field = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.field);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        SLIME_WIDTH,
        SLIME_HEIGHT,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.packed,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }
  render(f: RenderFrame, a: Appearance, width = 640, height = 400) {
    const gl = this.gl,
      b = this.batch,
      d = f.data,
      t = f.tick / 60,
      detail = Number(a.params.richness ?? 0.8),
      p = this.kind === "slime" ? this.fieldProgram! : this.bg;
    gl.disable(gl.BLEND);
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const at = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    a.colors.forEach((c, i) =>
      gl.uniform3fv(gl.getUniformLocation(p, "c" + i), c),
    );
    setRoleUniforms(gl, p, a.colors);
    gl.uniform1f(gl.getUniformLocation(p, "time"), t);
    gl.uniform1f(gl.getUniformLocation(p, "seed"), a.seed % 10000);
    gl.uniform1i(
      gl.getUniformLocation(p, "kind"),
      this.kind === "rivers" ? 0 : 1,
    );
    const flock3d =
      this.kind === "murmuration" && Number(f.params.flockVersion) >= 2;
    gl.uniform1i(gl.getUniformLocation(p, "dusk"), flock3d ? 1 : 0);
    gl.uniform1i(
      gl.getUniformLocation(p, "silhouette"),
      a.style === "silhouette" ? 1 : 0,
    );
    if (this.kind === "slime") {
      for (let i = 0; i < SLIME_CELLS; i++) {
        const v = Math.round(Math.max(0, Math.min(1, d[i])) * 65025);
        this.packed[i * 4] = Math.floor(v / 255);
        this.packed[i * 4 + 1] = v % 255;
        this.packed[i * 4 + 3] = 255;
      }
      // Tube depth: the weakest trail one cell away in each direction. One
      // pass here saves four filtered texture reads per pixel in the shader.
      for (let y = 0; y < SLIME_HEIGHT; y++)
        for (let x = 0; x < SLIME_WIDTH; x++) {
          const l = Math.max(0, x - 1),
            r = Math.min(SLIME_WIDTH - 1, x + 1),
            u = Math.max(0, y - 1),
            w = Math.min(SLIME_HEIGHT - 1, y + 1),
            inner = Math.min(
              d[y * SLIME_WIDTH + l],
              d[y * SLIME_WIDTH + r],
              d[u * SLIME_WIDTH + x],
              d[w * SLIME_WIDTH + x],
            );
          this.packed[(y * SLIME_WIDTH + x) * 4 + 2] = Math.round(
            Math.max(0, Math.min(1, inner)) * 255,
          );
        }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.field!);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        SLIME_WIDTH,
        SLIME_HEIGHT,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.packed,
      );
      gl.uniform1i(gl.getUniformLocation(p, "field"), 0);
      gl.uniform1f(gl.getUniformLocation(p, "detail"), detail);
      gl.uniform1i(
        gl.getUniformLocation(p, "etched"),
        a.style === "etched" ? 1 : 0,
      );
    }
    if (flock3d) {
      gl.disableVertexAttribArray(at);
      b.rect(0, 0, 640, 400, [1, 1, 1, 1], [0, 0, 1, 1]);
      b.draw(640, 400, this.staticSky(a, width, height));
    } else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const [c0, c1, c2] = a.colors;
    if (this.kind === "rivers") {
      if (this.ribbons) this.ribbons.draw(d, a.colors, detail);
      else
        for (let pass = 0; pass < 2; pass++)
          for (let i = 0; i < d.length; i += PARTICLE_STRIDE) {
            const warm = ((i / PARTICLE_STRIDE) % 6) / 5,
              c = mixColor(
                c1,
                c2,
                warm,
                pass === 0 ? 0.08 + detail * 0.08 : 0.36 + detail * 0.36,
              );
            for (let j = 0; j < PARTICLE_STRIDE - 2; j += 2)
              b.line(
                d[i + j] * 640,
                d[i + j + 1] * 400,
                d[i + j + 2] * 640,
                d[i + j + 3] * 400,
                pass === 0 ? 3.5 + detail * 3 : 0.55 + warm * 0.7,
                c,
              );
          }
      for (let i = 0; i < d.length; i += PARTICLE_STRIDE * 7)
        b.rect(d[i] * 640 - 0.7, d[i + 1] * 400 - 0.7, 1.4, 1.4, [...c2, 0.8]);
    } else if (this.kind === "slime") {
      const slimeRoles = paletteRoles(a.colors);
      for (let i = SLIME_CELLS; i < d.length; i += 3) {
        const x = d[i] * 640,
          y = d[i + 1] * 400,
          dx = Math.cos(d[i + 2]) * 2.5,
          dy = Math.sin(d[i + 2]) * 2.5,
          // Agents wandering through empty space stay faint; agents riding
          // a vein are drawn as directional marks along it.
          local =
            d[
              Math.min(SLIME_HEIGHT - 1, Math.floor(d[i + 1] * SLIME_HEIGHT)) *
                SLIME_WIDTH +
                Math.min(SLIME_WIDTH - 1, Math.floor(d[i] * SLIME_WIDTH))
            ],
          presence =
            0.15 + 0.85 * Math.min(1, Math.max(0, (local - 0.2) / 0.5));
        if (detail > 0)
          b.line(
            x - dx,
            y - dy,
            x + dx,
            y + dy,
            0.65,
            mixColor(
              a.style === "etched" ? slimeRoles.toneBridge : c1,
              c2,
              (i % 12) / 12,
              0.5 * detail * presence,
            ),
          );
        if ((i - SLIME_CELLS) % 45 === 0)
          b.rect(x - 0.7, y - 0.7, 1.4, 1.4, [
            ...c2,
            (0.3 + detail * 0.35) * presence,
          ]);
      }
    } else if (flock3d) {
      this.drawFlock3D(f, a, t, detail);
    } else {
      for (let i = 0; i < d.length; i += 4) {
        const n = i / 4,
          x = d[i] * 640,
          y = d[i + 1] * 400,
          depth = 0.5 + (n % 7) / 10,
          size = (a.style === "silhouette" ? 3.2 : 2.5) * depth;
        const angle = Math.atan2(d[i + 3] * 400, d[i + 2] * 640),
          ca = Math.cos(angle),
          sa = Math.sin(angle),
          wing = Math.sin(t * (5.5 + (n % 5) * 0.37) + n * 1.7);
        const c =
          a.style === "silhouette"
            ? mixColor(c0, [0, 0, 0], 0.6, 0.55 + depth * 0.4)
            : mixColor(c1, c2, (n % 13) / 13, 0.4 + depth * 0.5);
        const wingSpan = size * (0.5 + wing * 0.8),
          lx = -size * 0.7;
        b.line(
          x + lx * ca + wingSpan * sa,
          y + lx * sa - wingSpan * ca,
          x,
          y,
          0.6 + depth * 0.6,
          c,
        );
        b.line(
          x,
          y,
          x + lx * ca - wingSpan * sa,
          y + lx * sa + wingSpan * ca,
          0.6 + depth * 0.6,
          c,
        );
        if (detail > 0.3)
          b.line(
            x - size * ca,
            y - size * sa,
            x + size * 0.7 * ca,
            y + size * 0.7 * sa,
            0.4,
            mixColor(c2, c1, 0.3, 0.3 * detail),
          );
      }
      if (f.params.predator) {
        const x = (0.5 + 0.3 * Math.sin(t * 0.3)) * 640,
          y = (0.5 + 0.3 * Math.cos(t * 0.23)) * 400,
          c = mixColor(
            c0,
            [0, 0, 0],
            0.8,
            Math.pow(0.5 + 0.5 * Math.sin(t * 0.083 + a.seed * 0.001), 2),
          );
        b.line(x - 8, y - 5, x + 1, y, 2, c);
        b.line(x + 1, y, x - 8, y + 5, 2, c);
      }
      const reed = mixColor(c0, [0, 0, 0], 0.6, 0.8);
      for (let i = 0; i < 45 * detail; i++) {
        const x = (i * 640) / 45,
          y = 400 - (12 + 17 * Math.sin(i * 2.3));
        b.line(x, 400, x + Math.sin(t * 0.8 + i) * 4, y, 1, reed);
        b.line(x + Math.sin(t * 0.8 + i) * 4, y, x + 6, y - 8, 1, reed);
      }
    }
    b.draw(640, 400);
  }
  /** The dusk sky and hills, rendered once per appearance and image size. */
  staticSky(a: Appearance, width: number, height: number) {
    const gl = this.gl,
      key = [
        a.style,
        a.seed % 10000,
        JSON.stringify(a.colors),
        width,
        height,
      ].join(":");
    if (this.sky && this.skyKey === key) return this.sky;
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    if (!this.sky) {
      this.sky = gl.createTexture()!;
      this.skyBuffer = gl.createFramebuffer()!;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sky);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.skyBuffer!);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.sky,
      0,
    );
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.bg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const at = gl.getAttribLocation(this.bg, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(at);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    this.skyKey = key;
    return this.sky;
  }
  /**
   * Revision-2 murmuration: birds projected from 3D with mild perspective.
   * Semi-transparent ink overlaps, so where the flock's sheet folds or turns
   * edge-on it darkens into a line, and where it faces the viewer it thins
   * into a veil. Far birds take on the sky color.
   */
  drawFlock3D(f: RenderFrame, a: Appearance, t: number, detail: number) {
    const b = this.batch,
      d = f.data,
      roles = paletteRoles(a.colors),
      [, c1, c2] = a.colors,
      ink = a.style !== "luminous",
      light = mixColor(c1, mixColor(c2, roles.toneHighlight, 0.3), 0.5),
      inkTone = mixColor(roles.toneGround, [0, 0, 0], 0.4),
      color = [0, 0, 0, 0];
    const project = (x: number, y: number, z: number) => {
      const s = 1 / (1 + 0.5 * z);
      return [(0.5 + (x - 0.5) * s) * 640, (0.42 + (y - 0.42) * s) * 400, s];
    };
    for (let i = 0, n = 0; i < d.length; i += BIRD_STRIDE, n++) {
      const [x, y, s] = project(d[i], d[i + 1], d[i + 2]),
        far = Math.min(1, Math.max(0, d[i + 2] + 0.5)),
        size = 2.3 * s,
        angle = Math.atan2(d[i + 4] * 400, d[i + 3] * 640),
        ca = Math.cos(angle),
        sa = Math.sin(angle),
        wing = Math.sin(t * (6.2 + (n % 5) * 0.41) + n * 1.7),
        span = size * (0.45 + 0.75 * wing),
        lx = -size * 0.7,
        base = ink ? inkTone : light,
        haze = ink ? roles.toneDusk : roles.toneShadow;
      for (let k = 0; k < 3; k++)
        color[k] = base[k] + (haze[k] - base[k]) * far * 0.45;
      color[3] = (ink ? 0.62 : 0.42) * (0.8 + 0.2 * s);
      const weight = 0.55 + 0.5 * s;
      b.line(
        x + lx * ca + span * sa,
        y + lx * sa - span * ca,
        x,
        y,
        weight,
        color,
      );
      b.line(
        x,
        y,
        x + lx * ca - span * sa,
        y + lx * sa + span * ca,
        weight,
        color,
      );
      if (detail > 0.3)
        b.line(
          x - size * ca,
          y - size * sa,
          x + size * 0.6 * ca,
          y + size * 0.6 * sa,
          0.6 * s,
          color,
        );
    }
    if (f.params.predator) {
      const presence = falconPresence(t, a.seed, variationOf(f.params)),
        now = falcon(t, a.seed),
        soon = falcon(t + 0.05, a.seed),
        [x, y, s] = project(now[0], now[1], now[2]),
        [x2, y2] = project(soon[0], soon[1], soon[2]),
        heading = Math.atan2(y2 - y, x2 - x),
        hc = Math.cos(heading),
        hs = Math.sin(heading),
        flap = 0.7 + 0.3 * Math.sin(t * 6.3),
        scale = 0.9 * s,
        c = mixColor(roles.toneGround, [0, 0, 0], 0.4, 0.92 * presence),
        at = (u: number, v: number): [number, number] => [
          x + (u * hc - v * hs) * scale,
          y + (u * hs + v * hc) * scale,
        ],
        tri = (p: [number, number], q: [number, number], r: [number, number]) =>
          b.triangle(p[0], p[1], q[0], q[1], r[0], r[1], c);
      if (presence > 0.02) {
        tri(at(6, 0), at(-4, -1.3), at(-4, 1.3));
        tri(at(-3, 0), at(-9, -1.4), at(-9, 1.4));
        for (const side of [-1, 1]) {
          const wrist = at(0.5, side * 6.5 * flap);
          tri(at(2.5, side * 0.6), wrist, at(-2.5, side * 0.6));
          tri(wrist, at(-9.5, side * 10.5 * flap), at(-2.2, side * 4.6 * flap));
        }
      }
    }
    // A reed bed along the lower edge: varied heights, gentle sway, seed heads.
    const reed = mixColor(roles.toneGround, [0, 0, 0], 0.35, 0.9),
      count = Math.round(150 * detail);
    for (let i = 0; i < count; i++) {
      const h = Math.abs(Math.sin(i * 12.9898 + 1.3) * 43758.5453) % 1,
        x = ((i + h * 0.8) * 640) / Math.max(1, count),
        height = 18 + 46 * h * (0.6 + 0.4 * Math.sin(i * 0.37)),
        sway = Math.sin(t * 0.7 + i * 0.53 + x * 0.01) * (2 + 3 * h),
        top = 400 - height;
      b.line(x, 400, x + sway, top, 0.7 + 0.5 * h, reed);
      if (h > 0.45)
        b.line(
          x + sway,
          top,
          x + sway * 1.15 + 0.4,
          top - 4 - 3 * h,
          1.6,
          reed,
        );
    }
  }
  dispose() {
    this.ribbons?.dispose();
    this.batch.dispose();
    this.gl.deleteBuffer(this.quad);
    this.gl.deleteProgram(this.bg);
    if (this.fieldProgram) this.gl.deleteProgram(this.fieldProgram);
    if (this.sky) this.gl.deleteTexture(this.sky);
    if (this.skyBuffer) this.gl.deleteFramebuffer(this.skyBuffer);
    if (this.field) this.gl.deleteTexture(this.field);
  }
}
