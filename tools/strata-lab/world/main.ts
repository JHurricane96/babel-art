// Strata world overview: builds one world's history and draws it: climate
// along the world, the whole world in cross-section, and a close-up window,
// with a slider to replay the eras.
import {
  BIOMES,
  CELL,
  ERAS,
  ROCK,
  ROCKS,
  SEA_ROW,
  biomeRuns,
  describeWorld,
  simulateWorld,
  type Snapshot,
  type World,
} from "../../../engine/strata/history.ts";
import { REGION_W, WORLD_H } from "../../../engine/strata/world.ts";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const PER_REGION = REGION_W / CELL;
/** Elevations drawn: a little above the world's top (to show overshoot) down to its floor. */
const Z_TOP = SEA_ROW + 120,
  Z_BOTTOM = SEA_ROW - WORLD_H;

const hex = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ROCK_RGB = ROCKS.map((r) => hex(r.color)),
  BIOME_RGB = BIOMES.map((b) => hex(b.color));
const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let world: World | null = null,
  era = ERAS - 1,
  centre = 0,
  playing = 0;

// ---- Canvas helpers --------------------------------------------------------

function fit(c: HTMLCanvasElement) {
  const r = c.getBoundingClientRect(),
    w = Math.max(1, Math.round(r.width * devicePixelRatio)),
    h = Math.max(1, Math.round(r.height * devicePixelRatio));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c.getContext("2d")!;
}

/** The state to draw: an era's snapshot, or today's world. */
function stateAt(w: World, e: number) {
  if (e < ERAS - 1 && w.history) return w.history[e];
  return {
    era: ERAS - 1,
    sea: w.sea[ERAS - 1],
    b: w.b,
    offsets: w.offsets,
    kinds: w.kinds,
    tops: w.tops,
    water: w.water,
  } as Snapshot;
}

/** Draw columns c0..c1 of a state as a cross-section into the canvas. */
function section(
  ctx: CanvasRenderingContext2D,
  s: Snapshot,
  c0: number,
  c1: number,
  w: World,
  showBiomes: boolean,
) {
  const W = ctx.canvas.width,
    H = ctx.canvas.height,
    strip = showBiomes ? Math.round(6 * devicePixelRatio) : 0,
    img = ctx.createImageData(W, H),
    d = img.data,
    sky = hex(css("--sky")),
    sea = [42, 79, 122],
    lake = [63, 127, 168],
    span = c1 - c0,
    zAt = (py: number) =>
      Z_TOP - ((py - strip) / (H - strip)) * (Z_TOP - Z_BOTTOM);
  for (let px = 0; px < W; px++) {
    const c = Math.min(w.n - 1, Math.max(0, Math.floor(c0 + (px / W) * span))),
      o0 = s.offsets[c],
      o1 = s.offsets[c + 1],
      ground = o1 > o0 ? s.tops[o1 - 1] : s.b[c],
      water = s.water[c];
    let k = o1 - 1;
    for (let py = 0; py < H; py++) {
      const i = (py * W + px) * 4;
      let rgb: number[];
      if (py < strip) {
        const b = BIOME_RGB[w.biome[c]],
          b2 = BIOME_RGB[w.biome2[c]],
          t = w.blend[c] * ((px + py) & 1 ? 1.6 : 0.4);
        rgb = t > 0.5 ? b2 : b;
      } else {
        const z = zAt(py);
        if (z > ground)
          rgb =
            z <= water
              ? water <= s.sea + 0.5 && ground < s.sea
                ? sea
                : lake
              : sky;
        else {
          while (k >= o0 && k - 1 >= o0 && s.tops[k - 1] >= z) k--;
          rgb =
            k >= o0 && z > s.b[c]
              ? ROCK_RGB[s.kinds[k]]
              : ROCK_RGB[ROCK.BASEMENT];
        }
      }
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // The world's top and the sea level of this era.
  const yOf = (z: number) =>
    strip + ((Z_TOP - z) / (Z_TOP - Z_BOTTOM)) * (H - strip);
  ctx.save();
  ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
  ctx.strokeStyle = css("--muted");
  ctx.lineWidth = devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(0, yOf(SEA_ROW));
  ctx.lineTo(W, yOf(SEA_ROW));
  ctx.stroke();
  ctx.restore();
  return yOf;
}

function ticks(
  ctx: CanvasRenderingContext2D,
  c0: number,
  c1: number,
  every: number,
) {
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  ctx.fillStyle = css("--muted");
  ctx.font = `${11 * devicePixelRatio}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "bottom";
  const r0 = Math.ceil(c0 / PER_REGION / every) * every;
  for (let r = r0; r * PER_REGION <= c1; r += every) {
    const x = ((r * PER_REGION - c0) / (c1 - c0)) * W;
    ctx.fillRect(
      x,
      H - 6 * devicePixelRatio,
      devicePixelRatio,
      6 * devicePixelRatio,
    );
    ctx.fillText(String(r), x + 3 * devicePixelRatio, H - 2 * devicePixelRatio);
  }
}

/** Mark where rivers cross the strip: a short blue line down into the ground. */
function rivers(
  ctx: CanvasRenderingContext2D,
  s: Snapshot,
  w: World,
  c0: number,
  c1: number,
  len: number,
  yOf?: (z: number) => number,
) {
  const W = ctx.canvas.width,
    H = ctx.canvas.height,
    y = yOf ?? ((z: number) => ((Z_TOP - z) / (Z_TOP - Z_BOTTOM)) * H);
  ctx.strokeStyle = css("--rain");
  ctx.lineWidth = 2 * devicePixelRatio;
  for (const r of w.rivers) {
    if (r.c < c0 || r.c >= c1) continue;
    const o1 = s.offsets[r.c + 1],
      ground = o1 > s.offsets[r.c] ? s.tops[o1 - 1] : s.b[r.c],
      x = ((r.c + 0.5 - c0) / (c1 - c0)) * W,
      top = y(Math.max(ground, s.water[r.c]));
    ctx.beginPath();
    ctx.moveTo(x, top - len * devicePixelRatio);
    ctx.lineTo(x, top);
    ctx.stroke();
  }
}

// ---- Charts -----------------------------------------------------------------

function drawClimate(w: World) {
  const ctx = fit($("climate")),
    W = ctx.canvas.width,
    H = ctx.canvas.height,
    strip = 10 * devicePixelRatio,
    plotH = H - strip - 4 * devicePixelRatio,
    yT = (t: number) => ((35 - t) / 65) * plotH,
    yP = (p: number) => plotH - (Math.min(p, 3000) / 3000) * plotH;
  ctx.clearRect(0, 0, W, H);
  // Rain bars.
  ctx.fillStyle = css("--rain");
  ctx.globalAlpha = 0.55;
  for (let px = 0; px < W; px++) {
    const c = Math.floor((px / W) * w.n);
    if (w.wet[c] === 3) continue;
    const y = yP(w.P[c]);
    ctx.fillRect(px, y, 1, plotH - y);
  }
  ctx.globalAlpha = 1;
  // Freezing line and warmth.
  ctx.strokeStyle = css("--muted");
  ctx.lineWidth = devicePixelRatio;
  ctx.setLineDash([3 * devicePixelRatio, 4 * devicePixelRatio]);
  ctx.beginPath();
  ctx.moveTo(0, yT(0));
  ctx.lineTo(W, yT(0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = css("--warm");
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.beginPath();
  for (let px = 0; px < W; px++) {
    const c = Math.floor((px / W) * w.n),
      y = yT(w.T[c]);
    if (px) ctx.lineTo(px, y);
    else ctx.moveTo(px, y);
  }
  ctx.stroke();
  // Biome strip.
  for (let px = 0; px < W; px++) {
    const c = Math.floor((px / W) * w.n),
      rgb = BIOME_RGB[w.biome[c]];
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.fillRect(px, H - strip, 1, strip);
  }
  ctx.fillStyle = css("--muted");
  ctx.font = `${11 * devicePixelRatio}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "top";
  ctx.fillText("0 °C", 4 * devicePixelRatio, yT(0) + 2 * devicePixelRatio);
  ctx.fillText("30 °C · 2,600 mm", 4 * devicePixelRatio, 2 * devicePixelRatio);
}

function drawWorld(w: World) {
  const ctx = fit($("world")),
    s = stateAt(w, era);
  section(ctx, s, 0, w.n, w, false);
  ticks(ctx, 0, w.n, 20);
  rivers(ctx, s, w, 0, w.n, 4);
  // The close-up window.
  const W = ctx.canvas.width,
    H = ctx.canvas.height,
    half = zoomSpan(w) / 2,
    x0 = ((centre - half) / w.n) * W,
    x1 = ((centre + half) / w.n) * W;
  ctx.strokeStyle = css("--glow");
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.strokeRect(x0, 1, x1 - x0, H - 2);
}

const zoomSpan = (w: World) => Math.min(w.n, 10 * PER_REGION);

function drawZoom(w: World) {
  const ctx = fit($("zoom")),
    s = stateAt(w, era),
    half = zoomSpan(w) / 2,
    c0 = Math.max(0, Math.min(w.n - 2 * half, centre - half)),
    c1 = c0 + 2 * half,
    yOf = section(ctx, s, c0, c1, w, era === ERAS - 1);
  ticks(ctx, c0, c1, 1);
  rivers(ctx, s, w, c0, c1, 10, yOf);
  // Faults that have formed by this era.
  ctx.strokeStyle = css("--ink");
  ctx.lineWidth = devicePixelRatio;
  ctx.setLineDash([2 * devicePixelRatio, 3 * devicePixelRatio]);
  for (const f of w.faults) {
    if (f.era > era || f.c < c0 || f.c > c1) continue;
    const x = ((f.c - c0) / (c1 - c0)) * ctx.canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, yOf(SEA_ROW + 200));
    ctx.lineTo(x, ctx.canvas.height);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const r0 = Math.floor(c0 / PER_REGION);
  $("zoom-note").textContent =
    `regions ${r0} to ${r0 + 9} · height exaggerated about 6 times · blue ticks: rivers crossing · dashed lines: faults`;
}

function drawAll() {
  if (!world) return;
  drawClimate(world);
  drawWorld(world);
  drawZoom(world);
  $("era-label").textContent =
    era === ERAS - 1 ? `Era ${era} (today)` : `Era ${era} of ${ERAS - 1}`;
}

// ---- Building a world -------------------------------------------------------

function build(seed: number) {
  $("status").textContent = "Building…";
  playing = 0;
  $("play").textContent = "Play history";
  setTimeout(() => {
    const w = simulateWorld(seed, { record: true });
    world = w;
    era = ERAS - 1;
    ($("era") as HTMLInputElement).value = String(era);
    if (!centre || centre > w.n) centre = w.n / 2;
    $("status").textContent = `Built in ${(w.ms / 1000).toFixed(2)} s`;
    const story = $("story");
    story.replaceChildren(
      ...describeWorld(w).map((t) =>
        Object.assign(document.createElement("li"), { textContent: t }),
      ),
    );
    const runs = biomeRuns(w, 2 * PER_REGION),
      p = $("runs");
    p.replaceChildren();
    p.append(
      Object.assign(document.createElement("b"), {
        textContent: "Along the world: ",
      }),
    );
    p.append(
      runs
        .map(
          (r) =>
            `${BIOMES[r.biome].name} (${Math.max(1, Math.round((r.to - r.from) / PER_REGION))})`,
        )
        .join(" → "),
    );
    drawAll();
  }, 30);
}

$<HTMLFormElement>("seed-form").addEventListener("submit", (e) => {
  e.preventDefault();
  build(
    Math.max(0, Math.floor(Number(($("seed") as HTMLInputElement).value) || 0)),
  );
});
$("new").onclick = () => {
  const s = Math.floor(Math.random() * 100000);
  ($("seed") as HTMLInputElement).value = String(s);
  build(s);
};
$("era").addEventListener("input", (e) => {
  era = Number((e.target as HTMLInputElement).value);
  drawAll();
});
$("play").onclick = () => {
  if (playing) {
    playing = 0;
    $("play").textContent = "Play history";
    return;
  }
  playing = 1;
  $("play").textContent = "Pause";
  if (era >= ERAS - 1) era = 0;
  const step = () => {
    if (!playing || !world) return;
    era = Math.min(ERAS - 1, era + 1);
    ($("era") as HTMLInputElement).value = String(era);
    drawAll();
    if (era < ERAS - 1) setTimeout(step, 180);
    else {
      playing = 0;
      $("play").textContent = "Play history";
    }
  };
  drawAll();
  setTimeout(step, 180);
};

// Drag on the whole world to move the close-up window.
const worldCanvas = $("world");
let dragging = false;
const moveTo = (ev: PointerEvent) => {
  if (!world) return;
  const r = worldCanvas.getBoundingClientRect();
  centre = Math.max(
    0,
    Math.min(world.n, ((ev.clientX - r.left) / r.width) * world.n),
  );
  drawWorld(world);
  drawZoom(world);
};
worldCanvas.addEventListener("pointerdown", (ev) => {
  dragging = true;
  worldCanvas.setPointerCapture(ev.pointerId);
  moveTo(ev);
});
worldCanvas.addEventListener("pointermove", (ev) => dragging && moveTo(ev));
worldCanvas.addEventListener("pointerup", () => (dragging = false));
worldCanvas.addEventListener("pointercancel", () => (dragging = false));

new ResizeObserver(() => drawAll()).observe(document.body);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawAll);

// Legends.
for (const [id, list] of [
  ["rocks", ROCKS],
  ["biomes", BIOMES],
] as const) {
  const box = $(id);
  for (const item of list) {
    const s = document.createElement("span"),
      i = document.createElement("i");
    i.style.background = item.color;
    s.append(i, document.createTextNode(item.name));
    box.append(s);
  }
}

Object.assign(window, {
  strataWorld: (seed: number, region?: number) => {
    if (region !== undefined) centre = (region + 5) * PER_REGION;
    build(seed);
  },
});
build(Number(($("seed") as HTMLInputElement).value));
