import { LifeDirector, directedLife, initialLifeState } from "./life";
import { EvolutionSchedule, variationOf } from "./evolution";
import type { EvolutionAction } from "./evolution";
import { initialChemicalState } from "./chemical";
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
const update = `precision highp float;varying vec2 uv;uniform sampler2D state;uniform vec2 size;uniform float tick,seed,trail;uniform int cyclic,inject;uniform vec3 event;uniform float variation;
vec4 cell(vec2 d){return texture2D(state,fract(uv+d/size));}
void main(){vec4 c=cell(vec2(0.));float n=0.;float next=mod(floor(c.r*15.+.5)+1.,16.);float near=0.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){if(x==0&&y==0)continue;float v=cell(vec2(float(x),float(y))).r;n+=step(.5,v);near+=1.-step(.1,abs(floor(v*15.+.5)-next));}
float alive=step(.5,c.r);float v=cyclic==1?(near>=2.?next/15.:c.r):((n>2.5&&n<3.5)||(alive>.5&&n>1.5&&n<2.5)?1.:0.);
if(inject>0){vec2 d=(uv-event.xy)*size;float radius=inject==1?5.:inject==2?12.:22.;if(length(d)<radius){float pattern=mod(floor(d.x)+2.*floor(d.y)+floor(event.z),7.);vec2 q=inject==1?floor(d)+vec2(1.):mod(floor(d)+vec2(radius),7.);float glider=((q.y==0.&&q.x==1.)||(q.y==1.&&q.x==2.)||(q.y==2.&&q.x>=0.&&q.x<=2.))?1.:0.;v=cyclic==1?mod(pattern+event.z,16.)/15.:glider;}}

gl_FragColor=vec4(v,max(v,c.g*trail),v>.5?min(1.,c.b+.045):0.,1.);}`;
export class Grid implements Simulation {
  tick = 0;
  width: number;
  height: number;
  textures: WebGLTexture[] = [];
  fb: WebGLFramebuffer;
  prog: WebGLProgram;
  quad: WebGLBuffer;
  index = 0;
  schedule: EvolutionSchedule;
  pending?: EvolutionAction;
  life?: LifeDirector;
  lifeBytes?: Uint8Array;
  metrics?: {
    program: WebGLProgram;
    fb: WebGLFramebuffer;
    texture: WebGLTexture;
  };
  constructor(
    public gl: WebGLRenderingContext,
    public seed: number,
    public params: Params,
    public chemical = false,
  ) {
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.schedule = new EvolutionSchedule(seed);
    this.width = Number(params.resolution);
    this.height = Math.round(this.width * 0.625);
    this.fb = gl.createFramebuffer()!;
    if (chemical && !gl.getExtension("EXT_color_buffer_float"))
      throw new Error(
        "Chemical Garden requires WebGL2 floating-point render targets.",
      );
    this.prog = program(gl, vertex, chemical ? chemistry : update);
    const random = rng(seed);
    const data = chemical
      ? initialChemicalState(this.width, this.height, seed)
      : directedLife(params)
        ? initialLifeState(this.width, this.height, seed, params)
        : new Uint8Array(this.width * this.height * 4);
    if (directedLife(params)) {
      this.life = new LifeDirector(seed);
      this.lifeBytes = new Uint8Array(this.width * this.height * 4);
    }
    if (!chemical && !this.life)
      for (let i = 0; i < data.length; i += 4) {
        data[i] =
          params.rule === "cyclic"
            ? Math.floor(random() * 16) * 17
            : random() > 0.78
              ? 255
              : 0;
        data[i + 1] = data[i];
        data[i + 3] = 255;
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
    // Sampling and ecological deadlines are tied to engine ticks, including during replay.
    if (this.life && this.tick % 30 === 0) {
      const gl = this.gl;
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
        gl.UNSIGNED_BYTE,
        this.lifeBytes!,
      );
      const patches = this.life.observe(
        this.lifeBytes!,
        this.width,
        this.height,
        this.tick,
        this.params,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[this.index]);
      for (const p of patches)
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          p.x,
          p.y,
          p.width,
          p.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p.data,
        );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const scheduled = this.schedule.advance(
      this.tick,
      variationOf(this.params),
      !!this.params.autonomous && !this.life,
    );
    if (scheduled && (!this.pending || scheduled.kind >= this.pending.kind))
      this.pending = scheduled;
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
      this.pending ? this.pending.kind : 0,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.prog, "feed"),
      Number(this.params.feed || 0.0367),
    );
    gl.uniform1f(
      gl.getUniformLocation(this.prog, "kill"),
      Number(this.params.kill || 0.0649),
    );
    gl.uniform3f(
      gl.getUniformLocation(this.prog, "event"),
      this.pending?.x ?? 0.5,
      this.pending?.y ?? 0.5,
      this.pending?.serial ?? 0,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.prog, "variation"),
      variationOf(this.params),
    );
    const p = gl.getAttribLocation(this.prog, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.index = 1 - this.index;
    this.pending = undefined;
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
    return {
      tick: this.tick,
      data: Array.from(data),
      extra: {
        schedule: this.schedule.snapshot(),
        ...(this.life ? { lifeDirector: this.life.snapshot() } : {}),
        ...(this.pending ? { pending: this.pending } : {}),
      },
    };
  }
  restore(s: Snapshot) {
    if (s.data.length !== this.width * this.height * 4)
      throw new Error("Checkpoint dimensions mismatch");
    this.tick = s.tick;
    this.schedule.restore(s.extra?.schedule as any, this.tick);
    this.pending = s.extra?.pending as EvolutionAction | undefined;
    this.life?.restore(s.extra?.lifeDirector as any);
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
  intervene(action: EvolutionAction) {
    if (this.life) {
      const gl = this.gl;
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
        gl.UNSIGNED_BYTE,
        this.lifeBytes!,
      );
      const patches = this.life.renew(
        this.lifeBytes!,
        this.width,
        this.height,
        this.tick,
        this.params,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[this.index]);
      for (const p of patches)
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          p.x,
          p.y,
          p.width,
          p.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p.data,
        );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
    if (action.kind === 3) {
      const data = this.chemical
        ? initialChemicalState(
            this.width,
            this.height,
            this.seed + action.serial,
          )
        : new Uint8Array(this.width * this.height * 4);
      if (!this.chemical) {
        const random = rng(this.seed + action.serial);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = random() > 0.75 ? 255 : 0;
          data[i + 1] = data[i];
          data[i + 3] = 255;
        }
      }
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
        data,
      );
    }
    this.pending = action;
  }
  activitySample() {
    const gl = this.gl;
    if (!this.metrics) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        32,
        20,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.metrics = {
        texture,
        fb: gl.createFramebuffer()!,
        program: program(
          gl,
          vertex,
          `precision highp float;varying vec2 uv;uniform sampler2D state;uniform int chemical;void main(){vec4 v=texture2D(state,uv);float value=chemical==1?v.g:v.r;bool bad=!(v.r>=0.&&v.r<=1.)||!(v.g>=0.&&v.g<=1.);gl_FragColor=vec4(bad?0.:value,bad?1.:0.,0.,1.);}`,
        ),
      };
    }
    const m = this.metrics;
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      m.texture,
      0,
    );
    gl.viewport(0, 0, 32, 20);
    gl.useProgram(m.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.index]);
    gl.uniform1i(gl.getUniformLocation(m.program, "state"), 0);
    gl.uniform1i(
      gl.getUniformLocation(m.program, "chemical"),
      this.chemical ? 1 : 0,
    );
    const p = gl.getAttribLocation(m.program, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const bytes = new Uint8Array(32 * 20 * 4);
    gl.readPixels(0, 0, 32, 20, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Float32Array.from({ length: 640 }, (_, i) =>
      bytes[i * 4 + 1] > 0 ? NaN : bytes[i * 4] / 255,
    );
  }
  dispose() {
    if (this.metrics) {
      this.gl.deleteTexture(this.metrics.texture);
      this.gl.deleteFramebuffer(this.metrics.fb);
      this.gl.deleteProgram(this.metrics.program);
    }
    this.textures.forEach((t) => this.gl.deleteTexture(t));
    this.gl.deleteFramebuffer(this.fb);
    this.gl.deleteProgram(this.prog);
    this.gl.deleteBuffer(this.quad);
  }
}

const chemistry = `precision highp float;varying vec2 uv;uniform sampler2D state;uniform vec2 size;uniform float feed,kill,tick,seed;uniform int inject;uniform vec3 event;uniform float variation;
vec2 cell(vec2 d){return texture2D(state,fract(uv+d/size)).rg;}
void main(){vec2 c=cell(vec2(0.)),lap=-c;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){if(x==0&&y==0)continue;lap+=cell(vec2(float(x),float(y)))*(x==0||y==0?.2:.05);}float reaction=c.r*c.g*c.g;
float t=tick/60.;
vec2 flow=.10*variation*vec2(cos(uv.y*6.283+t*.19+seed*.001),sin(uv.x*6.283-t*.13));
vec2 transport=-flow.x*(cell(vec2(1.,0.))-cell(vec2(-1.,0.)))*.5-flow.y*(cell(vec2(0.,1.))-cell(vec2(0.,-1.)))*.5;
vec2 next=c+vec2(lap.r-reaction+feed*(1.-c.r),.5*lap.g+reaction-(kill+feed)*c.g)+transport;
if(inject>0){vec2 d=(uv-event.xy)*size;float radius=inject==1?6.:inject==2?10.:16.;if(length(d)<radius){float edge=1.-smoothstep(radius-2.,radius,length(d));next=mix(next,vec2(.5,.25),edge*.8);}}
gl_FragColor=vec4(clamp(next,0.,1.),0.,1.);}`;
