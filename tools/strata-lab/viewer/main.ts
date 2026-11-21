// Strata land viewer: shows generated land at an exact whole number of screen
// pixels per art pixel, so it looks on your monitor the way it will on the
// TVs (4 screen pixels per art pixel there: 480 art pixels across 1920).
//
// Regions are generated and lit in web workers (on the main thread if workers
// are unavailable), kept as bitmaps, and drawn with smoothing off at integer
// device-pixel offsets, so edges stay crisp at any position.
import {
  BIOMES,
  BLEND,
  groundAt,
  regionBiome,
} from "../../../engine/strata/generate.ts";
import { REGION_W, WORLD_H } from "../../../engine/strata/world.ts";
import { buildTile, type Tile } from "./tile.ts";

declare const WORKER_SOURCE: string;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view"),
  ctx = canvas.getContext("2d", { alpha: false })!;

/** The view: centre in art pixels, and screen (device) pixels per art pixel. */
const view = {
  seed: 7,
  x: 2 * REGION_W - 150,
  y: 560,
  scale: 4,
  drift: false,
  edges: false,
  wall: false,
  hud: true,
};
const DRIFT = 6; // art pixels per second

// ---- Tiles ---------------------------------------------------------------

interface Entry {
  bitmap?: ImageBitmap;
  surface?: Int16Array;
  genMs?: number;
  lightMs?: number;
  used: number;
}
const cache = new Map<string, Entry>(),
  key = (seed: number, r: number) => `${seed}:${r}`,
  pending = new Set<string>();
let last = "";

function accept(t: Tile) {
  const e: Entry = {
    surface: t.surface,
    genMs: t.genMs,
    lightMs: t.lightMs,
    used: performance.now(),
  };
  last = `region ${t.r}: land ${(t.genMs / 1000).toFixed(1)} s, light ${(t.lightMs / 1000).toFixed(1)} s`;
  createImageBitmap(
    new ImageData(t.rgba as Uint8ClampedArray<ArrayBuffer>, REGION_W, WORLD_H),
  ).then((b) => {
    e.bitmap = b;
    cache.set(key(t.seed, t.r), e);
    pending.delete(key(t.seed, t.r));
    evict();
    dirty = true;
  });
}

function evict() {
  if (cache.size <= 12) return;
  const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [k, e] of old.slice(0, cache.size - 12)) {
    e.bitmap?.close();
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

// ---- Drawing -------------------------------------------------------------

let dirty = true;

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

function draw() {
  const W = canvas.width,
    H = canvas.height,
    s = view.scale,
    left = view.x - W / s / 2,
    top = view.y - H / s / 2,
    ox = Math.round(left * s),
    oy = Math.round(top * s);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#07070b";
  ctx.fillRect(0, 0, W, H);
  const r0 = Math.floor(left / REGION_W),
    r1 = Math.floor((left + W / s) / REGION_W);
  for (let r = r0; r <= r1; r++) {
    const rx = r * REGION_W,
      sx0 = Math.max(0, Math.floor(left - rx)),
      sx1 = Math.min(REGION_W, Math.ceil(left + W / s - rx) + 1),
      sy0 = Math.max(0, Math.floor(top)),
      sy1 = Math.min(WORLD_H, Math.ceil(top + H / s) + 1);
    if (sx1 <= sx0 || sy1 <= sy0) continue;
    const dx = (rx + sx0) * s - ox,
      dy = sy0 * s - oy,
      e = cache.get(key(view.seed, r));
    if (e?.bitmap)
      ctx.drawImage(
        e.bitmap,
        sx0,
        sy0,
        sx1 - sx0,
        sy1 - sy0,
        dx,
        dy,
        (sx1 - sx0) * s,
        (sy1 - sy0) * s,
      );
    else {
      ctx.fillStyle = "#0e0e16";
      ctx.fillRect(dx, dy, (sx1 - sx0) * s, (sy1 - sy0) * s);
      ctx.fillStyle = "#8d8aa6";
      ctx.font = `${Math.round(13 * devicePixelRatio)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`Building region ${r}…`, dx + ((sx1 - sx0) * s) / 2, H / 2);
    }
  }
  if (view.edges) {
    ctx.fillStyle = "rgba(255, 210, 150, 0.55)";
    for (let r = r0; r <= r1 + 1; r++) {
      const x = r * REGION_W * s - ox;
      for (let y = 0; y < H; y += 12 * devicePixelRatio)
        ctx.fillRect(
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
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    for (const [px, py] of PANELS) {
      const x0 = ax + Math.round(px * MM),
        y0 = ay + Math.round(py * MM),
        w = Math.round(531 * MM),
        h = Math.round(299 * MM);
      ctx.rect(x0 * s - ox, y0 * s - oy, w * s, h * s);
    }
    ctx.fillStyle = "rgba(4, 4, 7, 0.94)";
    ctx.fill("evenodd");
  }
}

// ---- HUD -----------------------------------------------------------------

const fmt = new Intl.NumberFormat("en");
function biomeLabel(x: number) {
  const r = Math.floor(x / REGION_W),
    local = x - r * REGION_W,
    here = BIOMES[regionBiome(view.seed, r)].name;
  const nearLeft = local < BLEND,
    nearRight = REGION_W - local < BLEND;
  if (nearLeft || nearRight) {
    const other = BIOMES[regionBiome(view.seed, nearLeft ? r - 1 : r + 1)].name;
    if (other !== here)
      return nearLeft ? `${other} → ${here}` : `${here} → ${other}`;
  }
  return here;
}

let hudText = "";
function updateHud() {
  const busy = pending.size,
    region = Math.floor(view.x / REGION_W),
    status = busy
      ? `Building ${busy} region${busy > 1 ? "s" : ""}${mainThread ? " on the page (workers unavailable)" : ""}…`
      : last
        ? `Ready · ${last}`
        : "Ready",
    text = [
      biomeLabel(view.x),
      `region ${region} · x ${fmt.format(Math.round(view.x))} · y ${fmt.format(Math.round(view.y))}`,
      `${view.scale}`,
      `${Math.round(1920 / view.scale)}`,
      status,
    ].join("|");
  if (text === hudText) return;
  hudText = text;
  $("biome").textContent = biomeLabel(view.x);
  $("where").textContent =
    `region ${region} · x ${fmt.format(Math.round(view.x))} · y ${fmt.format(Math.round(view.y))}`;
  $("scale").textContent = `${view.scale}`;
  $("scale-note").textContent =
    `${fmt.format(Math.round(1920 / view.scale))} art px across a 1920 px screen`;
  $("status").textContent = status;
  for (const [id, on] of [
    ["drift", view.drift],
    ["edges", view.edges],
    ["wall", view.wall],
  ] as [string, boolean][])
    $(id).setAttribute("aria-pressed", String(on));
}

// ---- Canvas size: exact device pixels -------------------------------------

function resize(w: number, h: number) {
  if (w === canvas.width && h === canvas.height) return;
  canvas.width = w;
  canvas.height = h;
  dirty = true;
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
  dirty = true;
}
function toSurface() {
  view.y = groundAt(view.seed, view.x) + (0.1 * canvas.height) / view.scale;
  dirty = true;
}
function toEdge(dir: number) {
  const k = view.x / REGION_W;
  view.x =
    (dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) * REGION_W;
  toSurface();
}
function setSeed(seed: number) {
  if (!Number.isFinite(seed)) return;
  view.seed = Math.max(0, Math.min(2 ** 31 - 1, Math.floor(seed)));
  $<HTMLInputElement>("seed").value = String(view.seed);
  last = "";
  toSurface();
}
function toggle(name: "drift" | "edges" | "wall" | "hud") {
  view[name] = !view[name];
  if (name === "hud") $("hud").hidden = !view.hud;
  dirty = true;
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
  dirty = true;
};
$("drift").onclick = () => toggle("drift");
$("edges").onclick = () => toggle("edges");
$("wall").onclick = () => toggle("wall");
$("full").onclick = fullscreen;
$("new-seed").onclick = () => setSeed(Math.floor(Math.random() * 100000));
$<HTMLFormElement>("seed-form").onsubmit = (e) => {
  e.preventDefault();
  setSeed(Number($<HTMLInputElement>("seed").value));
};

// Drag to move, wheel to zoom around the pointer, double-click to centre.
let drag: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const d = devicePixelRatio / view.scale;
  view.x -= (e.clientX - drag.x) * d;
  view.y -= (e.clientY - drag.y) * d;
  drag = { x: e.clientX, y: e.clientY };
  dirty = true;
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointercancel", () => (drag = null));
let wheel = 0;
canvas.addEventListener(
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
canvas.addEventListener("dblclick", (e) => {
  view.x += (e.offsetX * devicePixelRatio - canvas.width / 2) / view.scale;
  view.y += (e.offsetY * devicePixelRatio - canvas.height / 2) / view.scale;
  dirty = true;
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
  else if (k === "PageUp") {
    view.y = Math.max(0, view.y - (0.5 * canvas.height) / view.scale);
    dirty = true;
  } else if (k === " ") {
    e.preventDefault();
    toggle("drift");
  } else if (k === "g" || k === "G") toggle("edges");
  else if (k === "w" || k === "W") toggle("wall");
  else if (k === "f" || k === "F") fullscreen();
  else if (k === "h" || k === "H") toggle("hud");
  else if (k === "n" || k === "N") $("new-seed").click();
  else return;
  dirty = true;
});
addEventListener("keyup", (e) => held.delete(e.key));
addEventListener("blur", () => held.clear());

// ---- Loop ----------------------------------------------------------------

let prev = performance.now();
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
    dirty = true;
  }
  if (view.drift) {
    view.x += DRIFT * dt;
    dirty = true;
  }
  schedule();
  if (dirty) {
    draw();
    dirty = false;
  }
  updateHud();
  requestAnimationFrame(frame);
}

$<HTMLInputElement>("seed").value = String(view.seed);
$("workers").textContent = mainThread
  ? "on the page"
  : `${workers} worker${workers === 1 ? "" : "s"}`;
requestAnimationFrame((t) => {
  prev = t;
  toSurface();
  frame(t);
});
