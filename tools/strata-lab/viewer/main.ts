// Strata land viewer: shows generated land, moving, at an exact whole number
// of screen pixels per art pixel, so it looks on your monitor the way it will
// on the TVs (4 screen pixels per art pixel there: 480 art pixels across 1920).
//
// Regions are generated and lit in web workers (on the main thread if workers
// are unavailable) and uploaded to the GPU as layers. Every frame the WebGL2
// renderer draws them with the sky, water, lava and plants moving; particles
// and creatures go on top; a 2D overlay carries the wall mask and markers.
import { groundAt } from "../../../engine/strata/generate.ts";
import { biomeNameAt } from "../../../engine/strata/worldmap.ts";
import { REGION_W, WORLD_H } from "../../../engine/strata/world.ts";
import { Renderer, type GpuTile } from "./gl.ts";
import { Life } from "./life.ts";
import { APRON, buildTile, type Emitters, type Tile } from "./tile.ts";

declare const WORKER_SOURCE: string;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view"),
  overlay = $<HTMLCanvasElement>("overlay"),
  octx = overlay.getContext("2d")!,
  gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });

/** The view: centre in art pixels, and screen (device) pixels per art pixel. */
const view = {
  seed: 7,
  // Inland, past the ocean at the world's left end.
  x: 40 * REGION_W + 1000,
  y: 560,
  scale: 4,
  drift: false,
  edges: false,
  wall: false,
  hud: true,
  motion: true,
};
const DRIFT = 6; // art pixels per second

let renderer: Renderer | null = null,
  failure = gl
    ? ""
    : "This viewer needs WebGL2, which this browser hasn't made available.";
try {
  if (gl) renderer = new Renderer(gl);
} catch (e) {
  console.error(e);
  failure = `The renderer failed to start: ${(e as Error).message.split("\n")[0]}`;
}
const life = new Life();

// ---- Tiles ---------------------------------------------------------------

interface Entry {
  gpu: GpuTile;
  surface: Int16Array;
  emit: Emitters;
  used: number;
}
const cache = new Map<string, Entry>(),
  key = (seed: number, r: number) => `${seed}:${r}`,
  pending = new Set<string>();
let last = "";

function accept(t: Tile) {
  pending.delete(key(t.seed, t.r));
  if (!renderer) return;
  last = `region ${t.r}: land ${(t.genMs / 1000).toFixed(1)} s, light ${(t.lightMs / 1000).toFixed(1)} s`;
  cache.set(key(t.seed, t.r), {
    gpu: renderer.upload(t),
    surface: t.surface,
    emit: t.emit,
    used: performance.now(),
  });
  evict();
}

function evict() {
  if (cache.size <= 10) return;
  const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [k, e] of old.slice(0, cache.size - 10)) {
    renderer?.release(e.gpu);
    cache.delete(k);
  }
}

// Workers from the bundled source; if they cannot start, build on the main thread.
const idle: Worker[] = [];
let workers = 0,
  mainThread = false,
  mainBusy = false;
try {
  const url = URL.createObjectURL(
      new Blob([WORKER_SOURCE], { type: "text/javascript" }),
    ),
    n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  for (let k = 0; k < n; k++) {
    const w = new Worker(url);
    w.onmessage = (e: MessageEvent<Tile>) => {
      accept(e.data);
      idle.push(w);
    };
    w.onerror = () => {
      // Workers are blocked here: fall back to the main thread.
      mainThread = true;
      pending.clear();
    };
    idle.push(w);
    workers++;
  }
} catch {
  mainThread = true;
}

/** Regions the view needs, nearest first: the visible ones and one either side. */
function wanted() {
  const halfW = canvas.width / view.scale / 2,
    r0 = Math.floor((view.x - halfW) / REGION_W) - 1,
    r1 = Math.floor((view.x + halfW) / REGION_W) + 1,
    rc = view.x / REGION_W - 0.5,
    out: number[] = [];
  for (let r = r0; r <= r1; r++) out.push(r);
  return out.sort((a, b) => Math.abs(a - rc) - Math.abs(b - rc));
}

function schedule() {
  for (const r of wanted()) {
    const k = key(view.seed, r);
    if (cache.has(k)) {
      cache.get(k)!.used = performance.now();
      continue;
    }
    if (pending.has(k)) continue;
    if (mainThread) {
      if (mainBusy) return;
      mainBusy = true;
      pending.add(k);
      const seed = view.seed;
      // Let the "building" note paint before the main thread is busy.
      setTimeout(() => {
        accept(buildTile(seed, r));
        mainBusy = false;
      }, 30);
      return;
    }
    const w = idle.pop();
    if (!w) return;
    pending.add(k);
    w.postMessage({ seed: view.seed, r });
  }
}

/** Ground height at world column x: from a loaded tile if there is one. */
function ground(x: number) {
  const r = Math.floor(x / REGION_W),
    e = cache.get(key(view.seed, r));
  if (e) return e.surface[Math.floor(x) - (r * REGION_W - APRON)];
  return groundAt(view.seed, x);
}

// ---- Drawing -------------------------------------------------------------

// The default wall (staggered): four 531 x 299 mm panels, 6 mm bezels, 10 mm
// gaps; 480 art pixels across each panel's 531 mm.
const MM = 480 / 531,
  PANELS = [
    [0, 85],
    [553, 0],
    [0, 406],
    [553, 321],
  ],
  WALL_W = 553 + 531,
  WALL_H = 406 + 299;

function frame_(t: number, dt: number) {
  const W = canvas.width,
    H = canvas.height,
    s = view.scale,
    left = view.x - W / s / 2,
    top = view.y - H / s / 2,
    ox = Math.round(left * s),
    oy = Math.round(top * s),
    r0 = Math.floor(left / REGION_W),
    r1 = Math.floor((left + W / s) / REGION_W),
    visible: { r: number; g: GpuTile }[] = [],
    sources: Emitters[] = [];
  for (let r = r0 - 1; r <= r1 + 1; r++) {
    const e = cache.get(key(view.seed, r));
    if (!e) continue;
    if (r >= r0 && r <= r1) visible.push({ r, g: e.gpu });
    sources.push(e.emit);
  }
  if (view.motion)
    life.update(
      dt,
      t,
      { left, top, right: left + W / s, bottom: top + H / s },
      sources,
      ground,
    );
  renderer!.draw(
    visible,
    { left, top, scale: s, W, H },
    t,
    view.seed,
    view.motion,
    life.buf,
    life.count,
  );

  // Overlay: regions still building, region edges, the wall mask.
  octx.clearRect(0, 0, W, H);
  for (let r = r0; r <= r1; r++) {
    if (cache.has(key(view.seed, r))) continue;
    const dx = Math.max(0, r * REGION_W * s - ox),
      dx1 = Math.min(W, (r + 1) * REGION_W * s - ox);
    octx.fillStyle = "#0e0e16";
    octx.fillRect(dx, 0, dx1 - dx, H);
    octx.fillStyle = "#8d8aa6";
    octx.font = `${Math.round(13 * devicePixelRatio)}px "IBM Plex Mono", ui-monospace, monospace`;
    octx.textAlign = "center";
    octx.fillText(`Building region ${r}…`, (dx + dx1) / 2, H / 2);
  }
  if (view.edges) {
    octx.fillStyle = "rgba(255, 210, 150, 0.55)";
    for (let r = r0; r <= r1 + 1; r++) {
      const x = r * REGION_W * s - ox;
      for (let y = 0; y < H; y += 12 * devicePixelRatio)
        octx.fillRect(
          x,
          y,
          Math.max(1, Math.round(devicePixelRatio)),
          6 * devicePixelRatio,
        );
    }
  }
  if (view.wall) {
    // Everything outside the four screens goes dark, as on the wall.
    const ax = Math.round(view.x - (WALL_W * MM) / 2),
      ay = Math.round(view.y - (WALL_H * MM) / 2);
    octx.beginPath();
    octx.rect(0, 0, W, H);
    for (const [px, py] of PANELS)
      octx.rect(
        (ax + Math.round(px * MM)) * s - ox,
        (ay + Math.round(py * MM)) * s - oy,
        Math.round(531 * MM) * s,
        Math.round(299 * MM) * s,
      );
    octx.fillStyle = "rgba(4, 4, 7, 0.94)";
    octx.fill("evenodd");
  }
  // Below the world's floor and above its top there is nothing.
  if (top < 0 || top + H / s > WORLD_H) {
    octx.fillStyle = "#07070b";
    if (top < 0) octx.fillRect(0, 0, W, -oy);
    if (top + H / s > WORLD_H) octx.fillRect(0, WORLD_H * s - oy, W, H);
  }
}

// ---- HUD -----------------------------------------------------------------

const fmt = new Intl.NumberFormat("en");
/** The world's biome here, and the one it is turning into. */
function biomeLabel(x: number) {
  return biomeNameAt(view.seed, x);
}

let hudText = "",
  fps = 0,
  cpuMs = 0;
function updateHud() {
  const busy = pending.size,
    region = Math.floor(view.x / REGION_W),
    status = failure
      ? failure
      : busy
        ? `Building ${busy} region${busy > 1 ? "s" : ""}${mainThread ? " on the page (workers unavailable)" : ""}…`
        : last
          ? `Ready · ${last}`
          : "Ready",
    gpu = renderer?.gpuMs ? ` · GPU ${renderer.gpuMs.toFixed(1)} ms` : "",
    perf = `${Math.round(fps)} fps · frame ${cpuMs.toFixed(1)} ms${gpu} · ${life.count} sprites`,
    where = `region ${region} · x ${fmt.format(Math.round(view.x))} · y ${fmt.format(Math.round(view.y))}`,
    text = [
      biomeLabel(view.x),
      where,
      view.scale,
      status,
      perf,
      view.drift,
      view.edges,
      view.wall,
      view.motion,
    ].join("|");
  if (text === hudText) return;
  hudText = text;
  $("biome").textContent = biomeLabel(view.x);
  $("where").textContent = where;
  $("scale").textContent = `${view.scale}`;
  $("scale-note").textContent =
    `${fmt.format(Math.round(1920 / view.scale))} art px across a 1920 px screen`;
  $("status").textContent = status;
  $("perf").textContent = perf;
  for (const [id, on] of [
    ["drift", view.drift],
    ["edges", view.edges],
    ["wall", view.wall],
    ["motion", view.motion],
  ] as [string, boolean][])
    $(id).setAttribute("aria-pressed", String(on));
}

// ---- Canvas size: exact device pixels -------------------------------------

function resize(w: number, h: number) {
  if (w === canvas.width && h === canvas.height) return;
  canvas.width = overlay.width = w;
  canvas.height = overlay.height = h;
}
const ro = new ResizeObserver((entries) => {
  const e = entries[0],
    box = e.devicePixelContentBoxSize?.[0];
  if (box) resize(box.inlineSize, box.blockSize);
  else
    resize(
      Math.round(e.contentRect.width * devicePixelRatio),
      Math.round(e.contentRect.height * devicePixelRatio),
    );
});
try {
  ro.observe(canvas, { box: "device-pixel-content-box" });
} catch {
  ro.observe(canvas);
}

// ---- Controls ------------------------------------------------------------

function setScale(s: number, ax = canvas.width / 2, ay = canvas.height / 2) {
  s = Math.max(1, Math.min(12, Math.round(s)));
  if (s === view.scale) return;
  // Keep the art pixel under the anchor where it is.
  const wx = view.x + (ax - canvas.width / 2) / view.scale,
    wy = view.y + (ay - canvas.height / 2) / view.scale;
  view.scale = s;
  view.x = wx - (ax - canvas.width / 2) / s;
  view.y = wy - (ay - canvas.height / 2) / s;
}
/** Where the camera sits to frame the land at x: the ground, smoothed over the screen, a little below the middle. */
function surfaceY(x: number) {
  const half = canvas.width / view.scale / 2;
  let sum = 0;
  for (let k = -4; k <= 4; k++) sum += groundAt(view.seed, x + (k * half) / 4);
  // Never above the world's top.
  return Math.max(
    canvas.height / view.scale / 2,
    sum / 9 - (0.14 * canvas.height) / view.scale,
  );
}
function toSurface() {
  view.y = surfaceY(view.x);
}
function toEdge(dir: number) {
  const k = view.x / REGION_W;
  view.x =
    (dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) * REGION_W;
  toSurface();
  life.reset();
}
function setSeed(seed: number) {
  if (!Number.isFinite(seed)) return;
  view.seed = Math.max(0, Math.min(2 ** 31 - 1, Math.floor(seed)));
  $<HTMLInputElement>("seed").value = String(view.seed);
  last = "";
  life.reset();
  toSurface();
}
function toggle(name: "drift" | "edges" | "wall" | "hud" | "motion") {
  view[name] = !view[name];
  if (name === "hud") $("hud").hidden = !view.hud;
}
function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

$("zoom-in").onclick = () => setScale(view.scale + 1);
$("zoom-out").onclick = () => setScale(view.scale - 1);
$("prev-edge").onclick = () => toEdge(-1);
$("next-edge").onclick = () => toEdge(1);
$("surface").onclick = toSurface;
$("deeper").onclick = () => {
  view.y = Math.min(WORLD_H, view.y + (0.5 * canvas.height) / view.scale);
};
$("drift").onclick = () => toggle("drift");
$("edges").onclick = () => toggle("edges");
$("wall").onclick = () => toggle("wall");
$("motion").onclick = () => toggle("motion");
$("full").onclick = fullscreen;
$("new-seed").onclick = () => setSeed(Math.floor(Math.random() * 100000));
$<HTMLFormElement>("seed-form").onsubmit = (e) => {
  e.preventDefault();
  setSeed(Number($<HTMLInputElement>("seed").value));
};

// Drag to move, wheel to zoom around the pointer, double-click to centre.
let drag: { x: number; y: number } | null = null;
overlay.addEventListener("pointerdown", (e) => {
  overlay.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY };
});
overlay.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const d = devicePixelRatio / view.scale;
  view.x -= (e.clientX - drag.x) * d;
  view.y -= (e.clientY - drag.y) * d;
  drag = { x: e.clientX, y: e.clientY };
});
overlay.addEventListener("pointerup", () => (drag = null));
overlay.addEventListener("pointercancel", () => (drag = null));
let wheel = 0;
overlay.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    wheel += e.deltaY;
    if (Math.abs(wheel) < 60) return;
    setScale(
      view.scale + (wheel < 0 ? 1 : -1),
      e.offsetX * devicePixelRatio,
      e.offsetY * devicePixelRatio,
    );
    wheel = 0;
  },
  { passive: false },
);
overlay.addEventListener("dblclick", (e) => {
  view.x += (e.offsetX * devicePixelRatio - canvas.width / 2) / view.scale;
  view.y += (e.offsetY * devicePixelRatio - canvas.height / 2) / view.scale;
});

const held = new Set<string>();
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  const k = e.key;
  if (k.startsWith("Arrow")) {
    held.add(k);
    e.preventDefault();
  } else if (k === "+" || k === "=") setScale(view.scale + 1);
  else if (k === "-" || k === "_") setScale(view.scale - 1);
  else if (k >= "1" && k <= "9") setScale(Number(k));
  else if (k === "[") toEdge(-1);
  else if (k === "]") toEdge(1);
  else if (k === "Home") toSurface();
  else if (k === "PageDown") $("deeper").click();
  else if (k === "PageUp")
    view.y = Math.max(0, view.y - (0.5 * canvas.height) / view.scale);
  else if (k === " ") {
    e.preventDefault();
    toggle("drift");
  } else if (k === "g" || k === "G") toggle("edges");
  else if (k === "w" || k === "W") toggle("wall");
  else if (k === "m" || k === "M") toggle("motion");
  else if (k === "f" || k === "F") fullscreen();
  else if (k === "h" || k === "H") toggle("hud");
  else if (k === "n" || k === "N") $("new-seed").click();
});
addEventListener("keyup", (e) => held.delete(e.key));
addEventListener("blur", () => held.clear());

// ---- Loop ----------------------------------------------------------------

let prev = performance.now(),
  clock = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  if (held.size) {
    // Arrow keys move a steady number of screen pixels per second.
    const v = (720 * devicePixelRatio * dt) / view.scale;
    if (held.has("ArrowLeft")) view.x -= v;
    if (held.has("ArrowRight")) view.x += v;
    if (held.has("ArrowUp")) view.y -= v;
    if (held.has("ArrowDown")) view.y += v;
  }
  if (view.drift) {
    // Drifting, the camera rises and falls with the land, gently.
    view.x += DRIFT * dt;
    view.y += (surfaceY(view.x) - view.y) * Math.min(1, 0.6 * dt);
  }
  if (view.motion) clock += dt;
  schedule();
  const t0 = performance.now();
  if (renderer) frame_(clock, dt);
  cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  fps = fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
  updateHud();
  requestAnimationFrame(frame);
}

// For scripted checks: jump to a seed and world column (and row).
Object.assign(window, {
  strataGo(seed: number, x: number, y?: number) {
    view.x = x;
    setSeed(seed);
    if (y !== undefined) view.y = y;
  },
});
$<HTMLInputElement>("seed").value = String(view.seed);
$("workers").textContent = mainThread
  ? "on the page"
  : `${workers} worker${workers === 1 ? "" : "s"}`;
requestAnimationFrame((t) => {
  prev = t;
  toSurface();
  frame(t);
});
