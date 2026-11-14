import { program, vertex } from "./grid";
import { ROLE_GLSL, paletteRoles, setRoleUniforms } from "./finish";
import { BIRD_STRIDE, CAMERA } from "./murmuration";
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
/**
 * Many small textured marks of one ink: 12 bytes per vertex (position and
 * opacity), four vertices per mark, static corner coordinates and indices.
 * Drawn in chunks so 16-bit indices suffice on WebGL1.
 */
const MARK_CHUNK = 16384;
class MarkStream {
  capacity = 65536;
  data = new Float32Array(this.capacity * 12);
  count = 0;
  buffer: WebGLBuffer;
  corners: WebGLBuffer;
  index: WebGLBuffer;
  prog: WebGLProgram;
  constructor(public gl: WebGLRenderingContext) {
    this.prog = program(
      gl,
      `attribute vec3 p;attribute vec2 corner;uniform vec2 size;varying vec2 uv;varying float alpha;void main(){uv=corner;alpha=p.z;gl_Position=vec4(p.xy/size*2.-1.,0.,1.);}`,
      `precision highp float;varying vec2 uv;varying float alpha;uniform sampler2D mark;uniform vec3 ink;void main(){gl_FragColor=vec4(ink,alpha*texture2D(mark,uv).a);}`,
    );
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const corners = new Float32Array(MARK_CHUNK * 8),
      index = new Uint16Array(MARK_CHUNK * 6);
    for (let i = 0; i < MARK_CHUNK; i++) {
      corners.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      index.set(
        [i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3],
        i * 6,
      );
    }
    this.corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    this.index = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
  }
  /** Centre, the two half-axes, and opacity. */
  add(
    x: number,
    y: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    alpha: number,
  ) {
    if (this.count >= this.capacity) return;
    const d = this.data,
      n = this.count++ * 12;
    d[n] = x - ax - bx;
    d[n + 1] = y - ay - by;
    d[n + 2] = alpha;
    d[n + 3] = x + ax - bx;
    d[n + 4] = y + ay - by;
    d[n + 5] = alpha;
    d[n + 6] = x - ax + bx;
    d[n + 7] = y - ay + by;
    d[n + 8] = alpha;
    d[n + 9] = x + ax + bx;
    d[n + 10] = y + ay + by;
    d[n + 11] = alpha;
  }
  draw(w: number, h: number, texture: WebGLTexture, ink: number[]) {
    if (!this.count) return;
    const gl = this.gl,
      p = this.prog;
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.data.subarray(0, this.count * 12),
    );
    gl.uniform2f(gl.getUniformLocation(p, "size"), w, h);
    gl.uniform3f(gl.getUniformLocation(p, "ink"), ink[0], ink[1], ink[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(p, "mark"), 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const at = gl.getAttribLocation(p, "p"),
      corner = gl.getAttribLocation(p, "corner");
    gl.enableVertexAttribArray(at);
    gl.enableVertexAttribArray(corner);
    for (let start = 0; start < this.count; start += MARK_CHUNK) {
      const n = Math.min(MARK_CHUNK, this.count - start);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 12, start * 48);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    }
    gl.disableVertexAttribArray(at);
    gl.disableVertexAttribArray(corner);
    gl.disable(gl.BLEND);
    this.count = 0;
  }
  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteBuffer(this.corners);
    this.gl.deleteBuffer(this.index);
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
/** Visible birds per simulated bird, and their placement around it. */
const VISIBLE_PER_BIRD = 8,
  OFFSET_COUNT = 4093,
  BIRD_HALF_SPAN = 0.12, // m, drawn smaller than a starling so the flock reads vast
  BIRD_THICK = 0.075, // m
  HAZE_RADIUS = 1.5, // m, soft mass behind the specks
  HAZE_ALPHA = 0.075,
  HAZE_EVERY = 4, // one disc per this many simulated birds (fill cost)
  OFFSETS = (() => {
    const o = new Float32Array(OFFSET_COUNT * 4);
    let h = 0x2f6b9a1d;
    const next = () => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
      h ^= h >>> 15;
      return (h >>> 0) / 4294967296;
    };
    for (let i = 0; i < OFFSET_COUNT; i++) {
      // Forward, sideways and up, in metres around the simulated bird,
      // about half the spacing between simulated birds; then a wingbeat phase.
      o[i * 4] = (next() - 0.5) * 1.6;
      o[i * 4 + 1] = (next() - 0.5) * 1.6;
      o[i * 4 + 2] = (next() - 0.5) * 0.8;
      o[i * 4 + 3] = next() * Math.PI * 2;
    }
    return o;
  })();
const background = `precision highp float;varying vec2 uv;uniform vec3 c0,c1,c2;uniform float time,seed;uniform int kind,silhouette;
${ROLE_GLSL}
void main(){vec2 p=uv;vec3 c;if(kind==0){float f=.5+.5*sin(p.x*7.+sin(p.y*8.+time*.04)*1.3);c=mix(c0*.15,c0*.7,f)+c1*.025;}
else{float sky=smoothstep(0.,1.,p.y);c=mix(silhouette==1?mix(c0,c2,.45):c0*.3,mix(c0,c2,.28),sky);float sun=length((p-vec2(.72,.34))*vec2(1.6,1.));c+=c2*.16*exp(-sun*4.);c=mix(c,mix(c2,c1,.3),1.-smoothstep(.071,.078,sun));for(int i=0;i<3;i++){float n=float(i);float hill=.88+n*.035-sin(p.x*6.+n+seed*.01)*.035;c=mix(c,c0*(.8-n*.2),smoothstep(hill,hill+.004,p.y));}}
gl_FragColor=vec4(c,1.);}`;
/**
 * Murmuration scenery, rendered once per size and appearance: an overcast
 * evening sky over flat fields, with a far wood line, rows of bare poplars,
 * round bare trees and the odd farmhouse along the horizon. Kept low and small
 * so the flock above reads at its true scale. X and Y are in 640×400 image
 * units, Y measured up from the horizon. Edges are antialiased over one
 * output pixel. Silhouette is the dusk style, luminous a darker night sky.
 */
const scenery = `#define HORIZON ${CAMERA.horizon.toFixed(1)}
precision highp float;varying vec2 uv;uniform float seed,pixel;uniform int silhouette;
${ROLE_GLSL}
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+seed*.0131)*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.03+17.1;a*=.5;}return v;}
float edge(float d){return clamp(.5+d/pixel,0.,1.);}
float seg(vec2 p,vec2 a,vec2 b,out float h){vec2 pa=p-a,ba=b-a;h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
float bareTree(vec2 q,float cx,float H,float W,float id){
 vec2 r=q-vec2(cx,0.);
 if(abs(r.x)>W+1.||r.y>H+1.)return 0.;
 float k=H/18.,h;
 float o=edge(.45*k+.25*pixel-seg(r,vec2(0.,-1.),vec2(0.,H*.4),h))*edge(r.y+1.);
 for(int j=0;j<9;j++){float fj=float(j);
  float u=h21(vec2(id,fj)),w=h21(vec2(fj,id+.5));
  float side=(fj-4.)/4.;
  vec2 a=vec2(0.,H*(.18+.28*u));
  vec2 b=vec2(W*side*(.55+.45*w),H*(.62+.38*(1.-side*side)*(.6+.4*u)));
  float d=seg(r,a,b,h);
  o=max(o,edge(mix(.32,.07,h)*k+.2*pixel-d)*mix(1.,.75,h));
 }
 vec2 e=vec2(r.x/W,(r.y-H*.64)/(H*.4));
 float m=1.-dot(e,e);
 float twig=vnoise(r*vec2(1.3,.9)+id*7.)*.6+vnoise(r*3.1+id)*.4;
 float haze=smoothstep(0.,.7,m)*(.18+.42*smoothstep(.25,.75,twig));
 return max(o,haze);}
float trees(float X,float Y){
 if(Y>34.)return 0.;
 vec2 q=vec2(X,Y);float o=0.;
 float cell=floor(X/5.);
 for(int j=-1;j<=1;j++){float i=cell+float(j);
  float a=h21(vec2(i,3.)),b=h21(vec2(i,5.));
  float cx=(i+.5+.6*(a-.5))*5.;
  float row=smoothstep(.5,.6,vnoise(vec2(cx*.008+3.,1.)));
  if(row<=0.||b<.12)continue;
  float H=(13.+9.*b)*(.55+.45*row);
  o=max(o,bareTree(q,cx,H,H*(.13+.06*a),i));
 }
 cell=floor(X/11.);
 for(int j=-1;j<=1;j++){float i=cell+float(j);
  float a=h21(vec2(i,7.)),b=h21(vec2(i,9.));
  float cx=(i+.5+.7*(a-.5))*11.;
  float stand=smoothstep(.45,.55,vnoise(vec2(cx*.012+11.,2.)));
  if(stand<=0.||a<.2)continue;
  float H=(9.+11.*b)*(.6+.4*stand);
  o=max(o,bareTree(q,cx,H,H*(.45+.25*b),i+100.));
 }
 return o;}
float farm(float X,float Y){
 float o=0.;
 for(int k=0;k<2;k++){float fk=float(k);
  float fx=640.*(.18+.6*h21(vec2(fk,21.)))+fk*90.;
  float w=5.+3.*h21(vec2(fk,23.)),wall=3.2+1.4*h21(vec2(fk,25.));
  float dx=abs(X-fx);
  float house=edge(w-dx)*edge(wall+2.6*(1.-dx/w)-Y)*edge(Y+1.);
  float bush=0.;
  for(int m=0;m<3;m++){float fm=float(m);
   vec2 bc=vec2(fx+(fm-1.)*(w+3.)+4.*h21(vec2(fk,fm)),2.);
   float r=3.5+3.*h21(vec2(fm,fk+30.));
   float d=r-length((vec2(X,Y)-bc)*vec2(1.,1.3))+.9*(vnoise(vec2(X,Y)*.7)-.5);
   bush=max(bush,edge(d)*edge(Y+1.));}
  o=max(o,max(house,bush));
 }
 return o;}
void main(){
 float X=uv.x*640.,Y=(HORIZON/400.-uv.y)*400.;
 float lum=silhouette==1?1.:.42;
 vec3 high=mix(toneShadow,toneBody,.55);
 vec3 low=mix(toneHighlight,toneDusk,.3);
 float k=clamp(Y/HORIZON,0.,1.);
 vec3 sky=mix(low,high,pow(k,.75));
 float grey=dot(sky,vec3(.2126,.7152,.0722));
 sky=mix(vec3(grey),sky,.4);
 float streak=fbm(vec2(X*.0045,Y*.04)+seed*.001);
 sky*=1.+.07*(streak-.5)*smoothstep(5.,60.,Y);
 sky*=1.+.05*exp(-length(vec2(X-430.,Y*1.6))/220.);
 sky*=lum;
 vec3 ink=toneGround*.45;
 vec3 far=mix(ink,sky,.55);
 float fh=2.+3.*fbm(vec2(X*.018,4.))+2.5*pow(vnoise(vec2(X*.06,6.)),3.)+.7*vnoise(vec2(X*.9,8.));
 vec3 c=mix(sky,far,edge(fh-Y)*edge(Y+1.));
 float near=max(trees(X,Y),farm(X,Y));
 c=mix(c,mix(ink,sky,.14),near);
 if(Y<0.){
  float depth=clamp(-Y/(400.-HORIZON),0.,1.);
  vec3 field=mix(mix(ink,sky,.3),mix(ink,sky,.1),pow(depth,.6));
  field*=1.+.05*(vnoise(vec2(X*.05,-Y*.9))-.5);
  c=mix(c,field,edge(-Y));
 }
 gl_FragColor=vec4(c,1.);
}`;
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
  marks?: MarkStream;
  quad: WebGLBuffer;
  bg: WebGLProgram;
  fieldProgram?: WebGLProgram;
  field?: WebGLTexture;
  packed = new Uint8Array(SLIME_CELLS * 4);
  ribbons?: RibbonGPU;
  sky?: WebGLTexture;
  skyBuffer?: WebGLFramebuffer;
  skyKey = "";
  sceneryProgram?: WebGLProgram;
  speck?: WebGLTexture;
  wallResolution: boolean;
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
    this.wallResolution = kind === "murmuration";
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
      this.drawFlock3D(f, a, t, detail, width);
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
  /** The scenery, rendered once per appearance and image size. */
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
    const p = (this.sceneryProgram ??= program(gl, vertex, scenery));
    gl.useProgram(p);
    setRoleUniforms(gl, p, a.colors);
    gl.uniform1f(gl.getUniformLocation(p, "seed"), a.seed % 10000);
    gl.uniform1f(gl.getUniformLocation(p, "pixel"), 640 / width);
    gl.uniform1i(
      gl.getUniformLocation(p, "silhouette"),
      a.style === "luminous" ? 0 : 1,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const at = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(at);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    this.skyKey = key;
    return this.sky;
  }
  /** A soft round mark with mipmaps, so tiny birds stay antialiased. */
  speckTexture() {
    if (this.speck) return this.speck;
    const gl = this.gl,
      size = 32,
      pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const r = Math.hypot(
            (x + 0.5) / (size / 2) - 1,
            (y + 0.5) / (size / 2) - 1,
          ),
          t = Math.min(1, Math.max(0, (1 - r) / 0.6)),
          at = (y * size + x) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
        pixels[at + 3] = Math.round(255 * t * t * (3 - 2 * t));
      }
    this.speck = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.speck);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return this.speck;
  }
  /**
   * Revision-2 murmuration. Each simulated bird stands for a few visible
   * birds placed around it in its own frame (a fixed pattern per bird), so the
   * flock reads as tens of thousands of specks without simulating them all.
   * Every bird is a soft speck stretched along its wing span as seen from the
   * camera. Its darkness and thickness follow the wing area it shows the
   * viewer: a level bird seen edge-on is a faint dash, a banking bird shows
   * the flat of its wings and goes dark, so turning waves cross the flock as
   * dark bands. Marks never shrink below about one output pixel; below that
   * their opacity falls instead, which keeps the far flock from shimmering.
   */
  drawFlock3D(
    f: RenderFrame,
    a: Appearance,
    t: number,
    detail: number,
    width: number,
  ) {
    const b = (this.marks ??= new MarkStream(this.gl)),
      d = f.data,
      roles = paletteRoles(a.colors),
      ink = a.style !== "luminous",
      base = ink
        ? mixColor(roles.toneGround, [0, 0, 0], 0.55)
        : mixColor(a.colors[1], roles.toneHighlight, 0.6),
      pixel = 640 / Math.max(1, width),
      minLength = 0.9 * pixel,
      minThick = 0.55 * pixel,
      copies = Math.max(
        1,
        Math.min(VISIBLE_PER_BIRD, 3 + Math.round(6 * detail)),
      ),
      focal = CAMERA.focal;
    for (let i = 0, n = 0; i < d.length; i += BIRD_STRIDE, n++) {
      const x = d[i],
        y = d[i + 1],
        z = d[i + 2],
        vx = d[i + 3],
        vy = d[i + 4],
        vz = d[i + 5],
        bank = d[i + 6],
        v = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1,
        ex = vx / v,
        ey = vy / v,
        ez = vz / v;
      let sx = -ez,
        sz = ex;
      const sl = Math.sqrt(sx * sx + sz * sz) || 1;
      sx /= sl;
      sz /= sl;
      let ux = -ey * ex,
        uy = 1 - ey * ey,
        uz = -ey * ez;
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const cb = Math.cos(bank),
        sb = Math.sin(bank),
        // Wing normal (the bird's up after rolling) and the span axis.
        nx = cb * ux + sb * sx,
        ny = cb * uy,
        nz = cb * uz + sb * sz,
        wx = cb * sx - sb * ux,
        wy = -sb * uy,
        lx = x - CAMERA.x,
        ly = y - CAMERA.y,
        lz = z - CAMERA.z,
        ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1,
        area = Math.abs((nx * lx + ny * ly + nz * lz) / ll),
        shade = 0.42 + 0.55 * Math.pow(area, 1.3),
        thick = BIRD_THICK * (0.35 + 0.65 * area);
      // A faint soft disc for every fourth simulated bird: where the flock is
      // deep along the line of sight the discs pile up into a smooth dark
      // mass. Sparse and large, to keep the blended fill affordable.
      if (detail > 0 && n % HAZE_EVERY === 0) {
        const depth = z - CAMERA.z;
        if (depth > 1) {
          const scale = focal / depth,
            r = HAZE_RADIUS * scale;
          b.add(
            320 + (x - CAMERA.x) * scale,
            CAMERA.horizon - (y - CAMERA.y) * scale,
            r,
            0,
            0,
            r,
            HAZE_ALPHA * shade * Math.min(1, detail / 0.8),
          );
        }
      }
      for (let k = 0; k < copies; k++) {
        const o = ((n * VISIBLE_PER_BIRD + k) % OFFSET_COUNT) * 4,
          of = OFFSETS[o],
          os = OFFSETS[o + 1],
          ou = OFFSETS[o + 2],
          px = x + ex * of + sx * os + ux * ou,
          py = y + ey * of + uy * ou,
          pz = z + ez * of + sz * os + uz * ou,
          depth = pz - CAMERA.z;
        if (depth < 1) continue;
        const scale = focal / depth,
          cx = 320 + (px - CAMERA.x) * scale,
          cy = CAMERA.horizon - (py - CAMERA.y) * scale;
        if (cx < -8 || cx > 648 || cy < -8 || cy > 408) continue;
        // Wingbeat: the span shortens on the downstroke.
        const beat = 1 - 0.3 * Math.max(0, Math.sin(t * 14 + OFFSETS[o + 3])),
          half = BIRD_HALF_SPAN * beat * scale,
          dx = wx * half,
          dy = -wy * half,
          length = Math.sqrt(dx * dx + dy * dy),
          along = Math.max(length, minLength),
          across = Math.max(thick * scale, minThick),
          // Coverage the mark would have had at its true size.
          coverage = Math.min(
            1,
            (Math.max(length, 0.25 * pixel) * thick * scale) / (along * across),
          ),
          ax = length > 1e-6 ? dx / length : 1,
          ay = length > 1e-6 ? dy / length : 0;
        b.add(
          cx,
          cy,
          ax * along,
          ay * along,
          -ay * across,
          ax * across,
          shade * coverage,
        );
      }
    }
    const hawk = f.extra?.falcon as number[] | null | undefined;
    if (hawk) {
      // A falcon about three starlings across: long pointed wings
      // swept back, flapping slowly; drawn with the same soft marks.
      const depth = hawk[2] - CAMERA.z;
      if (depth > 1) {
        const scale = focal / depth,
          x = 320 + (hawk[0] - CAMERA.x) * scale,
          y = CAMERA.horizon - (hawk[1] - CAMERA.y) * scale,
          hx = hawk[3] * scale,
          hy = -hawk[4] * scale,
          hl = Math.sqrt(hx * hx + hy * hy) || 1,
          fx = hx / hl,
          fy = hy / hl,
          span = Math.max(BIRD_HALF_SPAN * 3.4 * scale, 2.5 * pixel),
          flap = 0.75 + 0.25 * Math.sin(t * 7),
          thin = Math.max(span * 0.13, minThick);
        b.add(
          x,
          y,
          fx * span * 0.42,
          fy * span * 0.42,
          -fy * thin * 1.3,
          fx * thin * 1.3,
          0.95,
        );
        for (const side of [-1, 1]) {
          // Wing: out to the side and swept back toward the tail.
          const wx = -fy * side * flap - fx * 0.45,
            wy = fx * side * flap - fy * 0.45,
            wl = Math.sqrt(wx * wx + wy * wy) || 1,
            mx = x + (wx / wl) * span * 0.5,
            my = y + (wy / wl) * span * 0.5;
          b.add(
            mx,
            my,
            (wx / wl) * span * 0.52,
            (wy / wl) * span * 0.52,
            (-wy / wl) * thin,
            (wx / wl) * thin,
            0.95,
          );
        }
      }
    }
    b.draw(640, 400, this.speckTexture(), base);
  }
  dispose() {
    this.ribbons?.dispose();
    this.batch.dispose();
    this.marks?.dispose();
    this.gl.deleteBuffer(this.quad);
    this.gl.deleteProgram(this.bg);
    if (this.fieldProgram) this.gl.deleteProgram(this.fieldProgram);
    if (this.sky) this.gl.deleteTexture(this.sky);
    if (this.speck) this.gl.deleteTexture(this.speck);
    if (this.sceneryProgram) this.gl.deleteProgram(this.sceneryProgram);
    if (this.skyBuffer) this.gl.deleteFramebuffer(this.skyBuffer);
    if (this.field) this.gl.deleteTexture(this.field);
  }
}
