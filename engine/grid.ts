import type { Params, Simulation, Snapshot } from "./types";
import { rng } from "./types";
export function program(gl: WebGLRenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as [number, string][]) {
    const s = gl.createShader(type)!;
    let text = source;
    if (
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext
    ) {
      text =
        "#version 300 es\n" +
        source
          .replace(/attribute/g, "in")
          .replace(/varying/g, type === gl.VERTEX_SHADER ? "out" : "in")
          .replace(/texture2D/g, "texture");
      if (type === gl.FRAGMENT_SHADER)
        text = text
          .replace(
            "precision highp float;",
            "precision highp float;out vec4 fragmentColor;",
          )
          .replace(/gl_FragColor/g, "fragmentColor");
    }
    text = text.replace(/;/g, ";\n");
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(
        (gl.getShaderInfoLog(s) || "Shader failed") +
          "\n" +
          text.replace(/;/g, ";\n"),
      );
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) || "Link failed");
  return p;
}
export const vertex =
  "attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}";
const update = `precision highp float;varying vec2 uv;uniform sampler2D state;uniform vec2 size;uniform float tick,seed,trail;uniform int cyclic,inject;
vec4 cell(vec2 d){return texture2D(state,fract(uv+d/size));}
void main(){vec4 c=cell(vec2(0.));float n=0.;float next=mod(floor(c.r*15.+.5)+1.,16.);float near=0.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){if(x==0&&y==0)continue;float v=cell(vec2(float(x),float(y))).r;n+=step(.5,v);near+=1.-step(.1,abs(floor(v*15.+.5)-next));}
float alive=step(.5,c.r);float v=cyclic==1?(near>=2.?next/15.:c.r):((n>2.5&&n<3.5)||(alive>.5&&n>1.5&&n<2.5)?1.:0.);
if(inject==1&&mod(tick,600.)<.5){vec2 center=vec2(fract(sin(tick+seed)*437.1),fract(cos(tick+seed)*173.3));if(distance(uv,center)<.04)v=step(.45,fract(sin(dot(uv,vec2(123.,987.))+tick)*43758.));}
gl_FragColor=vec4(v,max(v,c.g*trail),0.,1.);}`;
export class Grid implements Simulation {
  tick = 0;
  width: number;
  height: number;
  textures: WebGLTexture[] = [];
  fb: WebGLFramebuffer;
  prog: WebGLProgram;
  index = 0;
  constructor(
    public gl: WebGLRenderingContext,
    public seed: number,
    public params: Params,
    public chemical = false,
  ) {
    this.width = Number(params.resolution);
    this.height = Math.round(this.width * 0.625);
    this.fb = gl.createFramebuffer()!;
    if (chemical && !gl.getExtension("EXT_color_buffer_float"))
      throw new Error(
        "Chemical Garden requires WebGL2 floating-point render targets.",
      );
    this.prog = program(gl, vertex, chemical ? chemistry : update);
    const random = rng(seed),
      data = chemical
        ? new Float32Array(this.width * this.height * 4)
        : new Uint8Array(this.width * this.height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] =
        params.rule === "cyclic"
          ? Math.floor(random() * 16) * 17
          : random() > 0.78
            ? 255
            : 0;
      data[i + 1] = data[i];
      data[i + 3] = 255;
      if (chemical) {
        data[i] = 1;
        data[i + 1] = random() > 0.96 ? 0.8 : 0;
        data[i + 3] = 1;
      }
    }
    for (let i = 0; i < 2; i++) this.textures.push(this.texture(data));
  }
  texture(data: Uint8Array | Float32Array) {
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.chemical ? (gl as WebGL2RenderingContext).RGBA32F : gl.RGBA,
      this.width,
      this.height,
      0,
      gl.RGBA,
      this.chemical ? gl.FLOAT : gl.UNSIGNED_BYTE,
      data,
    );
    return t;
  }
  step() {
    this.tick++;
    if (
      !this.chemical &&
      this.tick % Math.max(1, Math.round(60 / Number(this.params.rate))) !== 0
    )
      return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.textures[1 - this.index],
      0,
    );
    gl.viewport(0, 0, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.index]);
    gl.uniform1i(gl.getUniformLocation(this.prog, "state"), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.prog, "size"),
      this.width,
      this.height,
    );
    gl.uniform1f(gl.getUniformLocation(this.prog, "tick"), this.tick);
    gl.uniform1f(gl.getUniformLocation(this.prog, "seed"), this.seed % 10000);
    gl.uniform1f(
      gl.getUniformLocation(this.prog, "trail"),
      Number(this.params.trails),
    );
    gl.uniform1i(
      gl.getUniformLocation(this.prog, "cyclic"),
      this.params.rule === "cyclic" ? 1 : 0,
    );
    gl.uniform1i(
      gl.getUniformLocation(this.prog, "inject"),
      this.params.autonomous ? 1 : 0,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.prog, "feed"),
      Number(this.params.feed || 0.0367),
    );
    gl.uniform1f(
      gl.getUniformLocation(this.prog, "kill"),
      Number(this.params.kill || 0.0649),
    );
    const p = gl.getAttribLocation(this.prog, "p");
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.index = 1 - this.index;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  snapshot(): Snapshot {
    const gl = this.gl,
      data = this.chemical
        ? new Float32Array(this.width * this.height * 4)
        : new Uint8Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.textures[this.index],
      0,
    );
    gl.readPixels(
      0,
      0,
      this.width,
      this.height,
      gl.RGBA,
      this.chemical ? gl.FLOAT : gl.UNSIGNED_BYTE,
      data,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tick: this.tick, data: Array.from(data) };
  }
  restore(s: Snapshot) {
    if (s.data.length !== this.width * this.height * 4)
      throw new Error("Checkpoint dimensions mismatch");
    this.tick = s.tick;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.index]);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.width,
      this.height,
      gl.RGBA,
      this.chemical ? gl.FLOAT : gl.UNSIGNED_BYTE,
      this.chemical ? new Float32Array(s.data) : new Uint8Array(s.data),
    );
  }
  dispose() {
    this.textures.forEach((t) => this.gl.deleteTexture(t));
    this.gl.deleteFramebuffer(this.fb);
    this.gl.deleteProgram(this.prog);
  }
}

const chemistry = `precision highp float;varying vec2 uv;uniform sampler2D state;uniform vec2 size;uniform float feed,kill,tick,seed;uniform int inject;
vec2 cell(vec2 d){return texture2D(state,fract(uv+d/size)).rg;}
void main(){vec2 c=cell(vec2(0.)),lap=-c;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){if(x==0&&y==0)continue;lap+=cell(vec2(float(x),float(y)))*(x==0||y==0?.2:.05);}float reaction=c.r*c.g*c.g;vec2 next=c+vec2(lap.r-reaction+feed*(1.-c.r),.5*lap.g+reaction-(kill+feed)*c.g);if(inject==1&&mod(tick,1800.)<.5&&distance(uv,vec2(fract(sin(tick+seed)*437.1),.5))<.04)next=vec2(.5,1.);gl_FragColor=vec4(clamp(next,0.,1.),0.,1.);}`;
