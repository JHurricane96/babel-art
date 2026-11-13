import { program, vertex } from "./grid";
import { Batch, mixColor } from "./gpu-art";
import type { Color } from "./gpu-art";
import type { SceneRenderer, RenderFrame, Appearance } from "./render-frame";
import { ACTOR_STRIDE } from "./terrarium";
import type { WorldChunk } from "./terrarium-gen";
import {
  makeWorldAtlas,
  tileUV,
  PLANT_BASE,
  STRUCTURE_BASE,
  TERRAIN_BASE,
  DECOR_BASE,
  WORLD_PALETTES,
} from "./terrarium-atlas";
const bg = `precision highp float;varying vec2 uv;uniform vec3 c0,c1,c2;uniform float time,camera,seed;uniform int biome;
float ridge(float x,float scale,float phase){return sin(x*scale+phase)*.55+sin(x*scale*2.3-phase)*.25+sin(x*scale*.47+phase*2.)*.2;}
void main(){vec2 p=floor(uv*vec2(960.,600.));float day=.82+.18*sin(time*.018+seed*.003);vec3 sky=mix(c0*.9,c1*.5,smoothstep(0.,600.,p.y));sky+=c2*.08*exp(-length((p-vec2(720.,110.))/vec2(300.,200.)));float cloud=sin((p.x+camera*.1+time*1.8)*.012)+sin(p.y*.06+sin(p.x*.005));sky=mix(sky,c2*.3,smoothstep(1.45,1.7,cloud)*.2*(1.-p.y/600.));
for(int i=0;i<4;i++){float n=float(i),x=p.x+camera*(.12+n*.14);float horizon=145.+n*105.+ridge(x,.004+n*.002,seed*.03+n)*55.;float band=step(horizon,p.y);vec3 tone=mix(c0,c1,.10+n*.07);sky=mix(sky,tone,band);float stem=mod(x+sin(floor(x/76.)*1.7)*15.,76.);float crown=125.+sin(floor(x/76.)*2.1)*35.;float tree=step(stem,7.+n*2.)*step(horizon-crown,p.y)*step(p.y,horizon+10.);sky=mix(sky,c0*(.6+n*.12),tree*.75);}
if(biome==0){float worldX=p.x+camera*.35;float trunk=mod(worldX,210.);float branch=sin(worldX*.012)*18.;sky=mix(sky,c0*.55,step(trunk,18.)*step(60.,p.y));float leaf=length(vec2(mod(worldX+70.,210.)-105.,(p.y-80.-branch)*1.9));sky=mix(sky,mix(c0,c1,.25),1.-smoothstep(62.,65.,leaf));}
if(biome==2){float x=mod(p.x+camera*.28,180.);float arch=length(vec2((x-90.)*.8,(p.y-185.)));float stone=step(65.,arch)*step(arch,83.)*step(p.y,185.)+step(x,14.)*step(175.,p.y);sky=mix(sky,c1*.32,clamp(stone,0.,1.));}
if(biome==3){float x=mod(p.x+camera*.2,140.);sky=mix(sky,c1*.32,step(x,12.)*step(95.+sin(floor((p.x+camera*.2)/140.)*2.)*20.,p.y));}
if(biome==1){float ceiling=20.+ridge(p.x+camera*.25,.012,seed)*30.;sky=mix(sky,c0*.3,step(p.y,ceiling));float stars=step(.997,fract(sin(dot(floor(p/3.),vec2(12.9898,78.233))+seed)*43758.5453));sky+=c2*stars*.3;}
float sun=length(p-vec2(740.,92.));if(biome!=1)sky=mix(sky,c2*.8,(1.-smoothstep(25.,27.,sun))*.65);gl_FragColor=vec4(sky*day,1.);}`;
const color = (hex: string): Color =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export class WorldRenderer implements SceneRenderer {
  width = 960;
  height = 600;
  pixelated = true;
  batch: Batch;
  quad: WebGLBuffer;
  background: WebGLProgram;
  atlas?: WebGLTexture;
  atlasKey = "";
  constructor(public gl: WebGLRenderingContext) {
    this.batch = new Batch(gl);
    this.background = program(gl, vertex, bg);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
  }
  sprite(
    id: number,
    x: number,
    y: number,
    w = 32,
    h = 48,
    c: Color = [1, 1, 1, 1],
    flip = false,
  ) {
    if (x + w < 0 || x > 960 || y + h < 0 || y > 600) return;
    const uv = tileUV(id);
    if (flip) {
      uv[0] += uv[2];
      uv[2] *= -1;
    }
    this.batch.rect(Math.round(x), Math.round(y), w, h, c, uv);
  }
  render(f: RenderFrame, a: Appearance) {
    const gl = this.gl,
      b = this.batch,
      extra = f.extra!,
      chunks = extra.chunks as WorldChunk[],
      cam = extra.camera as number,
      t = f.tick / 60,
      d = f.data,
      pop = extra.population as number;
    const key = a.seed + JSON.stringify(a.colors);
    if (key !== this.atlasKey) {
      if (this.atlas) gl.deleteTexture(this.atlas);
      this.atlas = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        makeWorldAtlas(a.seed, a.colors),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.atlasKey = key;
    }
    const biome =
        chunks.find((c) => c.index === Math.floor(cam / 320))?.biome ?? 0,
      native = WORLD_PALETTES[biome].map(color),
      p = this.background;
    gl.disable(gl.BLEND);
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const at = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    [native[0], native[3], mixColor(native[6], a.colors[2], 0.25)].forEach(
      (c, i) => gl.uniform3fv(gl.getUniformLocation(p, "c" + i), c.slice(0, 3)),
    );
    gl.uniform1f(gl.getUniformLocation(p, "time"), t);
    gl.uniform1f(gl.getUniformLocation(p, "camera"), cam);
    gl.uniform1f(gl.getUniformLocation(p, "seed"), a.seed % 10000);
    gl.uniform1i(gl.getUniformLocation(p, "biome"), biome);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const day = 0.8 + 0.2 * Math.sin(t * 0.018 + a.seed * 0.003),
      tint = [day, day, day, 1],
      detail = Number(a.params.richness ?? 0.9);
    // Platforms, strata, plants, shelters, and background artifacts share one atlas batch.
    for (let ci = 0; ci < chunks.length; ci++) {
      const c = chunks[ci];
      if (c.index * 320 > cam + 1000 || c.index * 320 + 320 < cam - 40)
        continue;
      const offset = pop * ACTOR_STRIDE + ci * 89,
        soil = TERRAIN_BASE + c.biome * 24;
      for (let layer = 0; layer < 2; layer++)
        for (let j = 0; j < 6; j++) {
          const x = c.index * 320 - cam + j * 58 + (layer ? 20 : 0),
            y = 95 + layer * 230 + Math.sin(j * 2 + c.seed) * 22;
          this.sprite(
            DECOR_BASE + c.biome * 12 + ((j + c.motif) % 4),
            x,
            y,
            48,
            72,
            [day * 0.55, day * 0.6, day * 0.65, 0.65],
          );
        }
      for (let i = 0; i < c.platforms.length; i++) {
        const platform = c.platforms[i],
          x = platform.x - cam,
          depth =
            c.biome === 0
              ? platform.tier === 2
                ? 65
                : 20
              : c.biome === 1
                ? 72 + ((i + c.motif) % 3) * 16
                : c.biome === 2
                  ? 88
                  : 48 + ((i + c.motif) % 3) * 12;
        for (let y = 0; y < depth; y += 32)
          for (let dx = 0; dx < platform.width; dx += 32) {
            if (c.biome === 2 && y > 30 && dx > 25 && dx < platform.width - 30)
              continue;
            const inset = c.biome === 3 && y > 0 ? y * 0.22 : 0;
            if (dx < inset || dx > platform.width - inset) continue;
            const w = Math.min(32, platform.width - dx - inset),
              uv = tileUV(
                soil + (y === 0 ? (i + c.motif) % 6 : 6 + ((i + c.motif) % 6)),
              );
            uv[2] *= w / 32;
            b.rect(
              Math.round(x + dx),
              platform.y + y,
              w,
              Math.min(32, depth - y),
              tint,
              uv,
            );
          }
        // Hanging roots and ivy make the terraces look grown rather than tiled boxes.
        if (detail > 0.3)
          for (let j = 0; j < 2; j++)
            this.sprite(
              DECOR_BASE + c.biome * 12 + ((i + j) % 4),
              x + 8 + j * 28,
              platform.y + depth - 14,
              22,
              44,
              [day * 0.65, day * 0.75, day * 0.68, 0.8],
            );
      }
      for (let i = 0; i < 20; i++) {
        const site = c.plants[i],
          stage = Math.max(
            0,
            Math.min(3, Math.floor(d[offset + i * 4] * 3.99)),
          );
        const size = i < 5 ? 1 : i < 10 ? 1.3 : 1;
        this.sprite(
          PLANT_BASE + c.biome * 80 + site.kind * 4 + stage,
          site.x - cam - 16 * size,
          site.y - 47 * size,
          32 * size,
          48 * size,
          tint,
        );
      }
      for (let i = 0; i < 3; i++) {
        const site = c.structures[i],
          state =
            d[offset + 80 + i * 3] > 0.6
              ? d[offset + 80 + i * 3 + 2] > 0
                ? 2
                : 1
              : 0;
        this.sprite(
          STRUCTURE_BASE + site.kind * 3 + state,
          site.x - cam - 24,
          site.y - 71,
          48,
          72,
          tint,
        );
        this.sprite(
          DECOR_BASE + c.biome * 12 + 8 + (i % 4),
          site.x - cam - 40,
          site.y - 48,
          32,
          48,
          tint,
        );
      }
      for (let j = 0; j < 6 * detail; j++)
        this.sprite(
          DECOR_BASE + c.biome * 12 + 4 + (j % 4),
          c.index * 320 - cam + 12 + j * 53,
          520 + (j % 2) * 14,
          24,
          36,
          tint,
        );
    }
    b.draw(960, 600, this.atlas);
    // Navigation links are visible: ropes, ladders, bridges, and working lifts.
    for (let ci = 0; ci < chunks.length; ci++) {
      const c = chunks[ci];
      if (c.index * 320 > cam + 1000 || c.index * 320 + 320 < cam - 40)
        continue;
      const palette = WORLD_PALETTES[c.biome].map(color),
        offset = pop * ACTOR_STRIDE + ci * 89;
      for (let tier = 0; tier < 2; tier++)
        for (const col of [0, 1, 2]) {
          if (
            (col === 1 && c.biome !== 1) ||
            (col === 2 && (c.biome === 1 || c.biome === 3))
          )
            continue;
          const from = c.nodes[tier * 3 + col],
            to = c.nodes[(tier + 1) * 3 + col],
            x = from.x - cam;
          b.line(x - 5, from.y + 3, x - 5, to.y, 2, [...palette[8], 1]);
          b.line(x + 5, from.y + 3, x + 5, to.y, 2, [...palette[8], 1]);
          for (let y = from.y + 7; y < to.y; y += 9)
            b.line(x - 5, y, x + 5, y, 1, [...palette[10], 0.8]);
        }
      const left = c.nodes[4],
        right = c.nodes[5],
        repair = d[offset + 80],
        x0 = left.x + 38 - cam,
        x1 = right.x - 38 - cam;
      b.line(x0, left.y - 12, x1, right.y - 12, 1, [...palette[9], 1]);
      for (let x = x0; x < x1; x += 5) {
        const u = (x - x0) / (x1 - x0),
          y = left.y + (right.y - left.y) * u;
        if (repair > 0.6 || Math.floor(x / 5) % 3)
          b.rect(x, Math.round(y), 4, 3, [...palette[10], 1]);
      }
      if (c.biome >= 2) {
        for (let tier = 0; tier < 2; tier++) {
          const from = c.nodes[tier * 3 + 1],
            to = c.nodes[(tier + 1) * 3 + 1],
            x = from.x - cam + 20,
            phase = ((f.tick + Math.abs(from.id) * 13) % 300) / 300,
            y =
              from.y +
              (to.y - from.y) * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
          b.line(x - 14, from.y, x - 14, to.y, 1, [...palette[9], 0.7]);
          b.line(x + 14, from.y, x + 14, to.y, 1, [...palette[9], 0.7]);
          b.rect(x - 16, Math.round(y), 32, 4, [...palette[10], 1]);
        }
      }
      if (c.biome === 2) {
        const site = c.structures[0],
          x = site.x - cam + 30,
          y = site.y - 20;
        for (let j = 0; j < 8; j++) {
          const angle = t * 0.5 + (j * Math.PI) / 4;
          b.line(x, y, x + Math.cos(angle) * 18, y + Math.sin(angle) * 18, 2, [
            ...palette[10],
            1,
          ]);
          b.rect(
            Math.round(x + Math.cos(angle) * 20) - 2,
            Math.round(y + Math.sin(angle) * 20) - 2,
            4,
            4,
            [...palette[9], 1],
          );
        }
      }
      if (c.biome === 3) {
        const y = 553 + Math.sin(t * 0.08 + c.index) * 9;
        for (let row = 0; row < 5; row++)
          for (let j = 0; j < 9; j++)
            b.rect(
              c.index * 320 - cam + j * 39 + Math.sin(t * 0.7 + row + j) * 6,
              y + row * 7,
              22,
              1,
              [...palette[11], 0.3 - row * 0.04],
            );
      }
    }
    b.draw(960, 600);
    // Actors are sorted by height so feet and carried objects read clearly.
    const order = Array.from({ length: pop }, (_, i) => i).sort(
      (x, y) => d[x * ACTOR_STRIDE + 1] - d[y * ACTOR_STRIDE + 1],
    );
    for (const i of order) {
      const off = i * ACTOR_STRIDE,
        x = d[off] - cam,
        y = d[off + 1],
        role = d[off + 2],
        variant = d[off + 3],
        state = d[off + 4],
        carry = d[off + 5],
        flip = d[off + 6] < 0;
      const frame =
          Math.floor(t * (state === 4 ? 7 : state === 0 ? 1 : 8) + i * 0.7) % 4,
        id = (role * 2 + (variant % 2)) * 40 + state * 4 + frame,
        bob = role === 4 ? Math.sin(t * 3 + i) * 3 : 0;
      this.sprite(
        id,
        x - 16,
        y - 45 + bob,
        32,
        48,
        [day + 0.1, day + 0.1, day + 0.1, 1],
        flip,
      );
      if (carry && role !== 4)
        this.sprite(
          role === 3
            ? PLANT_BASE + biome * 80 + 15 * 4 + 3
            : DECOR_BASE + biome * 12 + 4,
          x + (flip ? -21 : 9),
          y - 32,
          16,
          24,
          tint,
          flip,
        );
    }
    b.draw(960, 600, this.atlas);
    const bright = mixColor(native[11], a.colors[2], 0.35, 0.7);
    for (let i = 0; i < pop; i++) {
      const off = i * ACTOR_STRIDE,
        x = d[off] - cam,
        y = d[off + 1];
      if (x < 0 || x > 960) continue;
      if (d[off + 4] === 4) {
        const spark = Math.sin(t * 11 + i);
        b.rect(
          Math.round(x + spark * 9),
          Math.round(y - 32 - ((t * 19 + i * 3) % 17)),
          2,
          2,
          bright,
        );
      }
      if (d[off + 2] === 4)
        b.rect(Math.round(x), Math.round(y - 12), 2, 1, bright);
    }
    if (extra.weather === 1 || biome === 3)
      for (let i = 0; i < 70 * detail; i++) {
        const x = (i * 67 + Math.floor(t * 25)) % 960,
          y = (i * 137 + Math.floor(t * 110)) % 600;
        b.rect(x, y, 1, 4, [...native[11], 0.2]);
      }
    else
      for (let i = 0; i < 45 * detail; i++) {
        const x = (i * 97 + Math.floor(t * 7) + cam * 0.03) % 960,
          y = 35 + ((i * 83 + Math.sin(t * 0.25 + i) * 15) % 520);
        b.rect(Math.round(x), Math.round(y), 1, 1, [
          ...native[6],
          0.18 + 0.2 * Math.sin(i + t),
        ]);
      }
    b.draw(960, 600);
  }
  dispose() {
    this.batch.dispose();
    this.gl.deleteBuffer(this.quad);
    this.gl.deleteProgram(this.background);
    if (this.atlas) this.gl.deleteTexture(this.atlas);
  }
}
