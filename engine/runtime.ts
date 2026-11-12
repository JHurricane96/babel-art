import { display, entityDisplay } from "./display";
import { ActivityMonitor, actionFor, variationOf } from "./evolution";
import type { EvolutionAction } from "./evolution";
import type { EntitySimulation } from "./types";
import { registry } from "../scenes/registry";
import { Grid, program, vertex } from "./grid";
import type { Simulation, Snapshot, World } from "./types";
function isEntity(s: Simulation | undefined): s is EntitySimulation {
  return !!s && "paint" in s;
}
const positioned = vertex
  .replace(
    "void main()",
    "uniform vec4 outputRect;uniform vec2 view;uniform float rotation;void main()",
  )
  .replace(
    "gl_Position=vec4(p,0.,1.);",
    "vec2 a=p*outputRect.zw*.5;a.y=-a.y;vec2 b=outputRect.xy+mat2(cos(rotation),sin(rotation),-sin(rotation),cos(rotation))*a;gl_Position=vec4(b.x/view.x*2.-1.,1.-b.y/view.y*2.,0.,1.);",
  );
export class Runtime {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  programs = new Map<string, WebGLProgram>();
  sim?: Simulation;
  entityCanvas = document.createElement("canvas");
  id = "";
  key = "";
  events: { tick: number; params?: any; intervention?: EvolutionAction }[] = [];
  health = new ActivityMonitor();
  fallbackLevel = 0;
  fallbackTarget = 0;
  fadeTime = -1;
  initialParams: any = {};
  requestedParams = "";
  replayFloor = 0;
  baseCheckpoint?: Snapshot;
  history = new Map<number, WebGLTexture>();
  states = new Map<number, Snapshot>();
  entityTextures = new Map<string, WebGLTexture>();
  checkpoints = new Map<number, Snapshot>();
  pending = false;
  generation = 0;
  world: World = { x: -100, y: -100, width: 1300, height: 950 };
  error = "";
  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "compositor";
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "3",
    });
    container.append(this.canvas);
    this.gl =
      this.canvas.getContext("webgl2", {
        alpha: true,
        preserveDrawingBuffer: true,
      }) ||
      this.canvas.getContext("webgl", {
        alpha: true,
        preserveDrawingBuffer: true,
      })!;
    if (!this.gl) throw new Error("WebGL is required");
    const gl = this.gl,
      b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.error = "Graphics context lost. Restoring…";
    });
    this.canvas.addEventListener("webglcontextrestored", () =>
      location.reload(),
    );
  }
  setup(
    scene: any,
    world?: World,
    events: {
      tick: number;
      params?: any;
      intervention?: EvolutionAction;
    }[] = [],
    initialParams?: any,
    replayFloor = 0,
    baseCheckpoint?: Snapshot,
  ) {
    const key =
      scene.id +
      ":" +
      scene.seed +
      ":" +
      (scene.params?.population || 0) +
      ":" +
      (scene.params?.resolution || 128) +
      ":" +
      (scene.params?.rule || "");
    if (this.key === key) {
      if (this.sim && JSON.stringify(scene.params) !== this.requestedParams) {
        this.events = this.events.filter((e) => e.tick < this.sim!.tick);
        this.recordEvent({
          tick: this.sim.tick,
          params: structuredClone(scene.params),
        });
        (this.sim as Grid).params = structuredClone(scene.params);
        this.requestedParams = JSON.stringify(scene.params);
        this.entityTextures.forEach((t) => this.gl.deleteTexture(t));
        this.entityTextures.clear();
      }
      return;
    }
    this.health.reset();
    this.fallbackLevel = 0;
    this.fallbackTarget = 0;
    this.fadeTime = -1;
    this.generation++;
    this.pending = false;
    this.sim?.dispose();
    this.history.forEach((t) => this.gl.deleteTexture(t));
    this.history.clear();
    this.states.clear();
    this.entityTextures.forEach((t) => this.gl.deleteTexture(t));
    this.entityTextures.clear();
    this.checkpoints.clear();
    this.key = key;
    this.id = scene.id;
    this.events = structuredClone(events);
    this.replayFloor = replayFloor;
    this.baseCheckpoint = baseCheckpoint;
    if (baseCheckpoint)
      this.checkpoints.set(baseCheckpoint.tick, baseCheckpoint);
    this.initialParams = structuredClone(initialParams || scene.params);
    this.requestedParams = JSON.stringify(scene.params);
    if (world) this.world = world;
    this.sim = registry[scene.id].create?.(
      this.gl,
      scene.seed,
      this.initialParams,
    );
    if (this.sim) this.capture();
  }
  capture() {
    if (!this.sim) return;
    if (!(this.sim instanceof Grid)) {
      const snap = this.snapshotWithParams();
      this.states.set(snap.tick, snap);
      const stateLimit = Math.max(
        2,
        Math.min(
          192,
          Math.floor((24 * 1024 * 1024) / Math.max(1, snap.data.length * 8)),
        ),
      );
      while (this.states.size > stateLimit)
        this.states.delete(this.states.keys().next().value!);
      if (snap.tick % 300 === 0) {
        this.checkpoints.set(snap.tick, snap);
        while (this.checkpoints.size > 8)
          this.checkpoints.delete(this.checkpoints.keys().next().value!);
      }
      return;
    }
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sim.fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.sim.textures[this.sim.index],
      0,
    );
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.sim.chemical ? (gl as WebGL2RenderingContext).RGBA32F : gl.RGBA,
      this.sim.width,
      this.sim.height,
      0,
      gl.RGBA,
      this.sim.chemical ? gl.FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.copyTexSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      0,
      0,
      this.sim.width,
      this.sim.height,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const previous = this.history.get(this.sim.tick);
    if (previous) gl.deleteTexture(previous);
    this.history.set(this.sim.tick, t);
    const historyLimit = Math.min(
      192,
      Math.floor(
        (96 * 1024 * 1024) /
          (this.sim.width * this.sim.height * 4 * (this.sim.chemical ? 4 : 1)),
      ),
    );
    while (this.history.size > historyLimit) {
      const k = this.history.keys().next().value!;
      gl.deleteTexture(this.history.get(k)!);
      this.history.delete(k);
    }
    if (this.sim.tick % 300 === 0) {
      this.checkpoints.set(this.sim.tick, this.snapshotWithParams());
      while (this.checkpoints.size > 8)
        this.checkpoints.delete(this.checkpoints.keys().next().value!);
    }
  }
  async seek(seconds: number, checkpoint?: Snapshot) {
    if (!this.sim || this.pending) return;
    const target = Math.max(this.replayFloor, Math.floor(seconds * 60));
    if (checkpoint && checkpoint.tick < this.replayFloor)
      checkpoint = undefined;
    if (!checkpoint) checkpoint = this.baseCheckpoint;
    if (target === this.sim.tick) return;
    this.pending = true;
    const generation = this.generation;
    try {
      if (
        checkpoint &&
        checkpoint.tick <= target &&
        (this.sim.tick === 0 || Math.abs(target - this.sim.tick) > 120)
      ) {
        this.sim.restore(checkpoint);
        if (checkpoint.extra?.params)
          (this.sim as Grid).params = checkpoint.extra.params as any;
        this.capture();
      }
      if (this.history.size === 0 && this.states.size === 0) this.capture();
      if (target < this.sim.tick) {
        const nearest = [...this.checkpoints.values()]
          .filter((s) => s.tick <= target)
          .sort((a, b) => b.tick - a.tick)[0];
        if (nearest) {
          this.sim.restore(nearest);
          if (nearest.extra?.params)
            (this.sim as Grid).params = nearest.extra.params as any;
        } else {
          const old = this.sim;
          this.sim.dispose();
          this.sim = registry[this.id].create!(
            this.gl,
            old.seed,
            this.initialParams,
          );
        }
        this.history.forEach((t) => this.gl.deleteTexture(t));
        this.history.clear();
        this.states.clear();
        this.capture();
      }
      while (this.sim.tick < target && generation === this.generation) {
        for (let i = 0; i < 120 && this.sim.tick < target; i++) {
          for (const event of this.events)
            if (event.tick === this.sim.tick) {
              if (event.params) this.sim.params = structuredClone(event.params);
              if (event.intervention) this.sim.intervene?.(event.intervention);
            }
          this.sim.step();
          this.capture();
        }
        if (this.sim.tick < target) await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      if (generation === this.generation) this.pending = false;
    }
  }
  recordEvent(event: {
    tick: number;
    params?: any;
    intervention?: EvolutionAction;
  }) {
    if (this.sim && this.events.length >= 2048) {
      const anchor = this.snapshotWithParams();
      this.baseCheckpoint = anchor;
      this.replayFloor = anchor.tick;
      this.checkpoints.clear();
      this.checkpoints.set(anchor.tick, anchor);
      this.events = [];
    }
    this.events.push(event);
  }
  observeHealth(seconds: number) {
    if (!this.sim?.activitySample || !this.health.due(seconds) || this.pending)
      return;
    const sample = this.sim.activitySample(),
      enabled = this.sim.params.autoRecovery !== false;
    const stage = this.health.observe(seconds, sample, enabled);
    this.fallbackTarget = this.health.fallback(
      variationOf(this.sim.params),
      enabled,
    );
    if (stage && this.sim.intervene) {
      const action = actionFor(
        this.sim.seed,
        this.health.state.interventions + 1000000,
        stage,
      );
      this.sim.intervene(action);
      this.recordEvent({ tick: this.sim.tick, intervention: action });
      this.capture();
      this.entityTextures.forEach((t) => this.gl.deleteTexture(t));
      this.entityTextures.clear();
    }
  }
  snapshotWithParams(): Snapshot {
    const s = this.sim!.snapshot();
    s.extra = {
      ...s.extra,
      params: structuredClone((this.sim as Grid).params),
    };
    return s;
  }
  checkpoint() {
    return this.sim ? this.snapshotWithParams() : undefined;
  }
  begin(width: number, height: number, seconds = 0) {
    const elapsed =
      this.fadeTime < 0
        ? 0
        : Math.max(0, Math.min(0.1, seconds - this.fadeTime));
    this.fadeTime = seconds;
    this.fallbackLevel +=
      (this.fallbackTarget - this.fallbackLevel) * Math.min(1, elapsed / 2);
    const gl = this.gl;
    if (this.canvas.width !== Math.round(width))
      this.canvas.width = Math.max(1, Math.round(width));
    if (this.canvas.height !== Math.round(height))
      this.canvas.height = Math.max(1, Math.round(height));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  draw(
    panel: any,
    scene: any,
    frame: any,
    output: number[],
    colors: number[][],
  ) {
    const gl = this.gl,
      key = isEntity(this.sim) ? "entity" : this.sim ? "grid" : scene.id;
    let p = this.programs.get(key);
    if (!p) {
      p = program(
        gl,
        positioned,
        isEntity(this.sim)
          ? entityDisplay
          : this.sim
            ? display
            : registry[scene.id].fragment!,
      );
      this.programs.set(key, p);
    }
    gl.useProgram(p);
    const at = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(p!, n);
    gl.uniform4fv(u("outputRect"), output);
    gl.uniform2f(u("view"), this.canvas.width, this.canvas.height);
    gl.uniform4f(u("rect"), panel.x, panel.y, panel.width, panel.height);
    gl.uniform1f(u("rotation"), (panel.rotation * Math.PI) / 180);
    gl.uniform2f(u("times"), frame.current / 1000, frame.previous / 1000);
    gl.uniform1f(u("seed"), scene.seed % 100000);
    gl.uniform1f(u("speed"), 1);
    gl.uniform1f(u("age"), frame.age);
    gl.uniform1f(u("period"), frame.period);
    gl.uniform1i(
      u("scan"),
      ["none", "top-down", "bottom-up"].indexOf(frame.scan),
    );
    const renderSeconds = (frame.sourceWallMs ?? frame.current) / 1000;
    gl.uniform1f(u("evolutionTime"), renderSeconds);
    gl.uniform1f(u("variation"), this.sim ? variationOf(this.sim.params) : 0);
    gl.uniform1f(u("recoveryMix"), this.fallbackLevel);
    gl.uniform1f(u("richness"), Number(scene.params?.richness ?? 0.8));
    colors.forEach((c, i) => gl.uniform3fv(u("c" + i), c));
    if (isEntity(this.sim)) {
      const live = this.sim.snapshot();
      const makeTexture = (time: number) => {
        const wanted = Math.max(0, Math.floor((time / 1000) * 60)),
          available = [...this.states.keys()].filter((t) => t <= wanted);
        const snap = this.states.get(
          available.length
            ? Math.max(...available)
            : Math.min(...this.states.keys()),
        );
        const cacheKey =
          String(snap?.tick || 0) + ":" + scene.style + ":" + scene.palette;
        const cached = this.entityTextures.get(cacheKey);
        if (cached) {
          this.entityTextures.delete(cacheKey);
          this.entityTextures.set(cacheKey, cached);
          gl.bindTexture(gl.TEXTURE_2D, cached);
          return cached;
        }
        if (snap) this.sim!.restore(snap);
        this.entityCanvas.width = 640;
        this.entityCanvas.height = 400;
        (this.sim as EntitySimulation).paint(
          this.entityCanvas.getContext("2d", { willReadFrequently: true })!,
          640,
          400,
          scene.style,
          colors,
        );
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.entityCanvas,
        );
        this.entityTextures.set(cacheKey, texture);
        while (this.entityTextures.size > 64) {
          const key = this.entityTextures.keys().next().value!;
          gl.deleteTexture(this.entityTextures.get(key)!);
          this.entityTextures.delete(key);
        }
        return texture;
      };
      gl.activeTexture(gl.TEXTURE0);
      const texture = makeTexture(frame.current);
      gl.uniform1i(u("state"), 0);
      gl.activeTexture(gl.TEXTURE1);
      const old = makeTexture(frame.previous);
      gl.uniform1i(u("previous"), 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform4f(
        u("world"),
        this.world.x,
        this.world.y,
        this.world.width,
        this.world.height,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.sim.restore(live);
      return;
    }

    if (this.sim) {
      gl.uniform1i(
        u("style"),
        scene.style === "flat" ? 0 : scene.style === "embossed" ? 2 : 1,
      );
      gl.uniform2f(
        u("texel"),
        1 / (this.sim as Grid).width,
        1 / (this.sim as Grid).height,
      );
      const oldTick = Math.max(0, Math.floor((frame.previous / 1000) * 60));
      const oldIds = [...this.history.keys()].filter((t) => t <= oldTick);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(
        gl.TEXTURE_2D,
        this.history.get(
          oldIds.length
            ? Math.max(...oldIds)
            : Math.min(...this.history.keys()),
        )!,
      );
      gl.uniform1i(u("previous"), 1);
      const tick = Math.max(0, Math.floor((frame.current / 1000) * 60));
      const ids = [...this.history.keys()].filter((t) => t <= tick);
      const texture = this.history.get(
        ids.length ? Math.max(...ids) : Math.min(...this.history.keys()),
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture!);
      gl.uniform1i(u("state"), 0);
      gl.uniform4f(
        u("world"),
        this.world.x,
        this.world.y,
        this.world.width,
        this.world.height,
      );
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
