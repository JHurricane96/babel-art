// Strata Atlas: worlds as maps (engine/strata/world2d.ts), made in workers. Pick a world, look at
// its land, height, rain, warmth or rock, point at it, and cut sections through it.
import { BIOMES, ROCKS, type World2D, rockAt } from "../../../engine/strata/world2d";

declare const WORKER_SOURCE: string;
const $ = (id: string) => document.getElementById(id)!;

// ---- Workers --------------------------------------------------------------------------------------
type Job = { id: number; seed: number; n: number; done: (w: World2D) => void; progress?: (f: number) => void };
const workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })),
  nW = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
  idle: Worker[] = [],
  queue: Job[] = [],
  running = new Map<number, Job>();
let jobId = 0;
function pump() {
  while (idle.length && queue.length) {
    const job = queue.shift()!,
      w = idle.pop()!;
    running.set(job.id, job);
    w.postMessage({ id: job.id, seed: job.seed, n: job.n });
  }
}
for (let k = 0; k < nW; k++) {
  const w = new Worker(workerUrl);
  w.onmessage = (e) => {
    const job = running.get(e.data.id);
    if (!job) return;
    if (e.data.world) {
      running.delete(e.data.id);
      idle.push(w);
      job.done(e.data.world);
      pump();
    } else job.progress?.(e.data.progress);
  };
  idle.push(w);
}
function make(seed: number, n: number, first = false, progress?: (f: number) => void) {
  return new Promise<World2D>((done) => {
    const job = { id: jobId++, seed, n, done, progress };
    if (first) queue.unshift(job);
    else queue.push(job);
    pump();
  });
}

// ---- Colour ---------------------------------------------------------------------------------------
const hex = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const BIOME_RGB = BIOMES.map((b) => hex(b.color)),
  ROCK_RGB = ROCKS.map((r) => hex(r.color));
function ramp(stops: [number, string][]) {
  const s = stops.map(([v, c]) => [v, hex(c)] as [number, number[]]);
  return (v: number) => {
    if (v <= s[0][0]) return s[0][1];
    for (let k = 1; k < s.length; k++)
      if (v <= s[k][0]) {
        const t = (v - s[k - 1][0]) / (s[k][0] - s[k - 1][0]);
        return s[k - 1][1].map((a, j) => a + (s[k][1][j] - a) * t);
      }
    return s[s.length - 1][1];
  };
}
const HEIGHT = ramp([[0, "#6f9a5a"], [250, "#93ad62"], [800, "#c8b979"], [1600, "#a98b64"], [2500, "#8e8278"], [3300, "#d8d6d2"], [4200, "#f4f5f7"]]),
  DEPTH = ramp([[-2500, "#1e3a5c"], [-600, "#2c5880"], [0, "#4c84ad"]]),
  RAIN = ramp([[300, "#c9a86b"], [650, "#a9b86a"], [1000, "#5f9e64"], [1600, "#2f7d84"], [2400, "#2a4f8e"]]),
  WARM = ramp([[-14, "#3d5ea6"], [-6, "#86a7d6"], [0, "#eef0f2"], [7, "#e9c779"], [15, "#cf6a3c"]]);
type View = "land" | "height" | "rain" | "warmth" | "rock";
const LEGENDS: Record<View, [string, string][]> = {
  land: BIOMES.map((b) => [b.name, b.color] as [string, string]),
  height: [["sea", "#2c5880"], ["0 m", "#6f9a5a"], ["800 m", "#c8b979"], ["1,600 m", "#a98b64"], ["2,500 m", "#8e8278"], ["3,300 m+", "#e8e8ea"]],
  rain: [["300 mm a year", "#c9a86b"], ["650", "#a9b86a"], ["1,000", "#5f9e64"], ["1,600", "#2f7d84"], ["2,400", "#2a4f8e"]],
  warmth: [["−14 °C", "#3d5ea6"], ["−6", "#86a7d6"], ["0", "#eef0f2"], ["7", "#e9c779"], ["15 °C", "#cf6a3c"]],
  rock: [],
};

/** Light from the north-west on the land's slopes (1 flat, more or less on slopes). */
const shades = new WeakMap<World2D, Float32Array>();
function shadeOf(w: World2D) {
  let s = shades.get(w);
  if (s) return s;
  const n = w.n;
  s = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const hx = w.h[y * n + Math.min(n - 1, x + 1)] - w.h[y * n + Math.max(0, x - 1)],
        hy = w.h[Math.min(n - 1, y + 1) * n + x] - w.h[Math.max(0, y - 1) * n + x],
        nx = -hx / (2 * w.cell),
        ny = -hy / (2 * w.cell),
        l = (nx * -0.62 + ny * -0.62 + 0.48) / Math.sqrt(nx * nx + ny * ny + 1);
      s[y * n + x] = Math.max(0.45, Math.min(1.35, 0.42 + l * 1.25));
    }
  shades.set(w, s);
  return s;
}
const RIVER = [64, 120, 172];
function paint(w: World2D, view: View) {
  const n = w.n,
    out = new ImageData(n, n),
    d = out.data,
    sh = shadeOf(w),
    riverMin = 6e7;
  for (let i = 0; i < n * n; i++) {
    let c: number[];
    const water = w.sea[i] || w.lake[i] > 0;
    if (w.sea[i]) c = DEPTH(w.h[i]);
    else if (w.lake[i] > 0) c = DEPTH(-w.lake[i] * 4);
    else if (view === "land") c = BIOME_RGB[w.biome[i]];
    else if (view === "height") c = HEIGHT(w.h[i]);
    else if (view === "rain") c = RAIN(w.rain[i]);
    else if (view === "warmth") c = WARM(w.temp[i]);
    else c = ROCK_RGB[w.rock[i]];
    if (!water) {
      const k = view === "rain" || view === "warmth" ? 0.55 + 0.45 * sh[i] : sh[i] * (1 + Math.min(0.2, Math.max(0, w.h[i]) / 15000));
      c = c.map((v) => v * k);
      if (view !== "rock" && w.flow[i] > riverMin) {
        const t = Math.min(1, Math.log10(w.flow[i] / riverMin) / 2);
        c = c.map((v, j) => v * (0.4 - 0.3 * t) + RIVER[j] * (0.6 + 0.3 * t));
      }
    }
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = 255;
  }
  return out;
}

// ---- State ---------------------------------------------------------------------------------------
const today = new Date(),
  todaySeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
let seeds = [todaySeed, 1, 5, 6, 8, 9],
  current = todaySeed,
  world: World2D | null = null,
  view: View = "land",
  A: [number, number] | null = null,
  B: [number, number] | null = null,
  dragging = false;
const thumbs = new Map<number, World2D>(),
  full = new Map<number, World2D>(),
  mapCanvas = $("map") as HTMLCanvasElement,
  mctx = mapCanvas.getContext("2d")!,
  img = document.createElement("canvas"),
  ictx = img.getContext("2d")!;
const label = (sd: number) => (sd === todaySeed ? "Today" : String(sd));

// ---- The map --------------------------------------------------------------------------------------
function redrawMap() {
  if (!world) return;
  mapCanvas.width = world.n * 2;
  mapCanvas.height = world.n * 2;
  mctx.imageSmoothingEnabled = false;
  mctx.drawImage(img, 0, 0, mapCanvas.width, mapCanvas.height);
  if (A && B) {
    // Marks the same size on screen however big the map is shown.
    const k = 2,
      u = Math.max(1, mapCanvas.width / Math.max(1, mapCanvas.clientWidth));
    mctx.lineWidth = 3 * u;
    mctx.strokeStyle = "rgba(17,20,24,0.75)";
    mctx.beginPath();
    mctx.moveTo(A[0] * k, A[1] * k);
    mctx.lineTo(B[0] * k, B[1] * k);
    mctx.stroke();
    mctx.lineWidth = 1.5 * u;
    mctx.strokeStyle = "#f4efe2";
    mctx.stroke();
    mctx.font = `600 ${Math.round(12 * u)}px Space Grotesk, system-ui, sans-serif`;
    for (const [p, t] of [[A, "A"], [B, "B"]] as [[number, number], string][]) {
      mctx.fillStyle = "rgba(17,20,24,0.8)";
      mctx.beginPath();
      mctx.arc(p[0] * k, p[1] * k, 9 * u, 0, Math.PI * 2);
      mctx.fill();
      mctx.fillStyle = "#e8a95c";
      mctx.textAlign = "center";
      mctx.textBaseline = "middle";
      mctx.fillText(t, p[0] * k, p[1] * k + 1);
    }
  }
}
function showWorld(w: World2D) {
  world = w;
  img.width = w.n;
  img.height = w.n;
  ictx.putImageData(paint(w, view), 0, 0);
  if (!A || !B) defaultSection(w);
  redrawMap();
  drawSection();
  // What this world holds.
  const n = w.n;
  let top = -1e9,
    topI = 0,
    lakes = 0,
    sea = 0,
    wood = 0,
    snow = 0;
  for (let i = 0; i < n * n; i++) {
    if (w.h[i] > top) (top = w.h[i]), (topI = i);
    if (w.lake[i] > 0) lakes++;
    if (w.sea[i]) sea++;
    if (w.biome[i] === 6 || w.biome[i] === 7) wood++;
    if (w.biome[i] === 11) snow++;
  }
  const pct = (v: number) => `${Math.round((100 * v) / (n * n))}%`,
    story = w.plan.story,
    first = story[0][0].toUpperCase() + story[0].slice(1);
  $("story").innerHTML = "";
  const b = document.createElement("b");
  b.textContent = w.seed === todaySeed ? `Today's world (${w.seed})` : `World ${w.seed}`;
  $("story").append(b, document.createTextNode(`${first}${story.length > 1 ? ", " + story.slice(1).join(", ") : ""}.`));
  const facts: [string, string][] = [
    ["Size", `${((n * w.cell) / 1000).toFixed(0)} km a side, ${w.cell} m cells`],
    ["Highest", `${Math.round(top).toLocaleString()} m, ${((topI % n) * w.cell / 1000).toFixed(0)} km E, ${(Math.floor(topI / n) * w.cell / 1000).toFixed(0)} km S`],
    ["Woods", pct(wood)],
    ["Water", `${pct(lakes)} lakes${sea ? `, ${pct(sea)} sea` : ""}`],
    ["Snow and ice", pct(snow)],
  ];
  $("facts").innerHTML = "";
  for (const [k, v] of facts) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    $("facts").append(dt, dd);
  }
  legend();
}
function legend() {
  const el = $("legend");
  el.innerHTML = "";
  let items = LEGENDS[view];
  if (view === "rock" && world) {
    const seen = new Set<number>();
    for (let i = 0; i < world.rock.length; i++) if (!world.sea[i] && !(world.lake[i] > 0)) seen.add(world.rock[i]);
    items = [...seen].sort((a, b) => a - b).map((r) => [ROCKS[r].name, ROCKS[r].color]);
  }
  if (view === "land" && world) {
    const seen = new Set(world.biome);
    items = items.filter((_, k) => seen.has(k));
  }
  for (const [name, color] of items) {
    const i = document.createElement("i"),
      b = document.createElement("b");
    b.style.background = color;
    i.append(b, document.createTextNode(name));
    el.append(i);
  }
}
/** At rest: a section straight across the first range, through its middle. */
function defaultSection(w: World2D) {
  const p = w.plan.ranges[0].p,
    t = 0.5,
    u = 1 - t,
    cx = u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0],
    cy = u * u * p[0][1] + 2 * u * t * p[1][1] + t * t * p[2][1],
    tx = 2 * u * (p[1][0] - p[0][0]) + 2 * t * (p[2][0] - p[1][0]),
    ty = 2 * u * (p[1][1] - p[0][1]) + 2 * t * (p[2][1] - p[1][1]),
    l = Math.hypot(tx, ty) || 1,
    nx = -ty / l,
    ny = tx / l,
    half = w.n * 0.36,
    clamp = (v: number) => Math.min(w.n - 2, Math.max(1, v)),
    mx = clamp(cx),
    my = clamp(cy);
  A = [clamp(mx - nx * half), clamp(my - ny * half)];
  B = [clamp(mx + nx * half), clamp(my + ny * half)];
}

// ---- The section --------------------------------------------------------------------------------
function drawSection() {
  const cv = $("section") as HTMLCanvasElement;
  if (!world || !A || !B) return;
  const w = world,
    n = w.n,
    dpr = Math.min(2, window.devicePixelRatio || 1),
    W = Math.max(200, Math.round(cv.clientWidth * dpr)),
    H = Math.round(cv.clientHeight * dpr),
    ctx = cv.getContext("2d")!;
  cv.width = W;
  cv.height = H;
  const lenKm = (Math.hypot(B[0] - A[0], B[1] - A[1]) * w.cell) / 1000,
    cells: number[] = [];
  let zmax = 0,
    zmin = 1e9;
  for (let c = 0; c < W; c++) {
    const t = c / (W - 1),
      x = Math.round(A[0] + (B[0] - A[0]) * t),
      y = Math.round(A[1] + (B[1] - A[1]) * t),
      i = Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x));
    cells.push(i);
    zmax = Math.max(zmax, w.h[i] + Math.max(0, w.lake[i]));
    zmin = Math.min(zmin, w.h[i]);
  }
  zmax += 350;
  zmin = Math.min(zmin, 0) - 1800;
  const left = 46 * dpr,
    bottom = 18 * dpr,
    plotW = W - left - 6 * dpr,
    plotH = H - bottom - 6 * dpr,
    zAt = (row: number) => zmax - (row / plotH) * (zmax - zmin),
    rowOf = (z: number) => ((zmax - z) / (zmax - zmin)) * plotH;
  const im = ctx.createImageData(W, H),
    d = im.data,
    sky1 = hex("#9fbad0"),
    sky0 = hex("#d9e3ea"),
    bg = hex("#191d23"),
    waterC = hex("#4c84ad");
  for (let p = 0; p < W * H; p++) d.set([bg[0], bg[1], bg[2], 255], p * 4);
  for (let c = 0; c < plotW; c++) {
    const i = cells[Math.round((c / (plotW - 1)) * (W - 1))],
      surf = w.h[i],
      waterTop = w.sea[i] ? 0 : w.lake[i] > 0 ? surf + w.lake[i] : -1e9;
    for (let r = 0; r < plotH; r++) {
      const z = zAt(r + 0.5);
      let col: number[];
      if (z > surf) {
        if (z <= waterTop) col = waterC.map((v, k) => v * (0.75 + 0.25 * (1 - Math.min(1, (waterTop - z) / 1500))) + 0 * k);
        else {
          const t = r / plotH;
          col = sky1.map((v, k) => v + (sky0[k] - v) * t);
        }
      } else {
        const rk = rockAt(w, i, z);
        col = ROCK_RGB[Math.max(0, rk)];
        // Darker with depth, a lit line along the surface.
        const depth = surf - z;
        col = col.map((v) => v * (depth < (zmax - zmin) / plotH * 1.5 ? 1.15 : 1 - Math.min(0.35, depth / 9000)));
      }
      const o = ((r + 6 * dpr) * W + left + c) * 4;
      d[o] = col[0];
      d[o + 1] = col[1];
      d[o + 2] = col[2];
    }
  }
  ctx.putImageData(im, 0, 0);
  // Scales: sea level, heights, distance.
  ctx.font = `${11 * dpr}px IBM Plex Mono, ui-monospace, monospace`;
  ctx.fillStyle = "#979aa3";
  ctx.strokeStyle = "rgba(233,229,218,0.35)";
  ctx.lineWidth = dpr;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const stepZ = zmax - zmin > 6000 ? 2000 : 1000;
  for (let z = Math.ceil(zmin / stepZ) * stepZ; z <= zmax; z += stepZ) {
    const y = rowOf(z) + 6 * dpr;
    ctx.fillText(z === 0 ? "sea" : `${(z / 1000).toFixed(0)} km`, left - 6 * dpr, y);
    ctx.beginPath();
    ctx.moveTo(left - 3 * dpr, y);
    ctx.lineTo(left, y);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const stepX = lenKm > 60 ? 20 : lenKm > 25 ? 10 : 5;
  for (let km = 0; km <= lenKm; km += stepX) ctx.fillText(`${km}`, left + (km / lenKm) * plotW, H - 4 * dpr);
  ctx.fillStyle = "#e8a95c";
  ctx.font = `600 ${13 * dpr}px Space Grotesk, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("A", left + 4 * dpr, 20 * dpr);
  ctx.textAlign = "right";
  ctx.fillText("B", W - 10 * dpr, 20 * dpr);
  const exag = (lenKm * 1000) / plotW / ((zmax - zmin) / plotH);
  $("sect-note").textContent = `A to B, ${lenKm.toFixed(0)} km; heights drawn ${exag.toFixed(1)} times steeper than they are`;
  // The rocks this section cuts.
  const seen = new Set<number>();
  for (const i of cells) for (let z = w.h[i]; z > zmin; z -= 60) seen.add(Math.max(0, rockAt(w, i, z)));
  const el = $("rock-legend");
  el.innerHTML = "";
  for (const r of [...seen].sort((a, b) => a - b)) {
    const it = document.createElement("i"),
      b = document.createElement("b");
    b.style.background = ROCKS[r].color;
    it.append(b, document.createTextNode(ROCKS[r].name));
    el.append(it);
  }
}

// ---- Pointing -----------------------------------------------------------------------------------
function cellAt(e: PointerEvent): [number, number] {
  const r = mapCanvas.getBoundingClientRect(),
    n = world?.n ?? 512;
  return [Math.min(n - 1, Math.max(0, ((e.clientX - r.left) / r.width) * n)), Math.min(n - 1, Math.max(0, ((e.clientY - r.top) / r.height) * n))];
}
function readout(p: [number, number]) {
  if (!world) return;
  const w = world,
    n = w.n,
    i = Math.floor(p[1]) * n + Math.floor(p[0]),
    km = (v: number) => ((v * w.cell) / 1000).toFixed(1),
    lines = [`${km(p[0])} km east, ${km(p[1])} km south`];
  if (w.sea[i]) lines.push(`Sea, ${Math.round(-w.h[i])} m deep`);
  else if (w.lake[i] > 0) lines.push(`Lake, ${Math.round(w.lake[i])} m deep, its surface at ${Math.round(w.h[i] + w.lake[i])} m`);
  else lines.push(`${Math.round(w.h[i]).toLocaleString()} m · ${BIOMES[w.biome[i]].name}`);
  if (!w.sea[i]) lines.push(`${ROCKS[w.rock[i]].name} at the surface`);
  lines.push(`Rain ${Math.round(w.rain[i] / 10) * 10} mm a year · ${w.temp[i].toFixed(1)} °C`);
  if (!w.sea[i] && w.flow[i] > 6e7) lines.push(`A river, about ${Math.max(1, Math.round((w.flow[i] * 0.8) / 3.15e7))} m³ a second`);
  $("readout").textContent = lines.join("\n");
}
mapCanvas.addEventListener("pointerdown", (e) => {
  if (!world) return;
  dragging = true;
  mapCanvas.setPointerCapture(e.pointerId);
  const p = cellAt(e);
  dragStart = p;
  readout(p);
});
let dragStart: [number, number] | null = null;
mapCanvas.addEventListener("pointermove", (e) => {
  if (!world) return;
  const p = cellAt(e);
  if (dragging && dragStart && Math.hypot(p[0] - dragStart[0], p[1] - dragStart[1]) > 4) {
    A = dragStart;
    B = p;
    redrawMap();
  }
  readout(p);
});
mapCanvas.addEventListener("pointerup", () => {
  if (dragging && A && B) drawSection();
  dragging = false;
  dragStart = null;
});

// ---- Choosing worlds ------------------------------------------------------------------------------
function thumbButtons() {
  const el = $("worlds");
  el.innerHTML = "";
  for (const sd of seeds) {
    const b = document.createElement("button"),
      c = document.createElement("canvas"),
      s = document.createElement("span");
    b.className = "world";
    b.id = `w-${sd}`;
    b.setAttribute("aria-pressed", String(sd === current));
    b.setAttribute("aria-label", `World ${label(sd)}`);
    c.width = 256;
    c.height = 256;
    s.textContent = label(sd);
    b.append(c, s);
    b.onclick = () => choose(sd);
    el.append(b);
    const t = thumbs.get(sd);
    if (t) c.getContext("2d")!.putImageData(paint(t, "land"), 0, 0);
    else
      make(sd, 256).then((w) => {
        thumbs.set(sd, w);
        c.getContext("2d")!.putImageData(paint(w, "land"), 0, 0);
      });
  }
}
async function choose(sd: number) {
  current = sd;
  A = B = null;
  document.querySelectorAll(".world").forEach((b) => b.setAttribute("aria-pressed", String(b.id === `w-${sd}`)));
  if (full.has(sd)) {
    $("busy").hidden = true;
    showWorld(full.get(sd)!);
    return;
  }
  const busy = $("busy");
  busy.hidden = false;
  busy.textContent = `Making ${sd === todaySeed ? "today's world" : `world ${sd}`}…`;
  const w = await make(sd, 512, true, (f) => {
    if (current === sd) busy.textContent = `Making ${sd === todaySeed ? "today's world" : `world ${sd}`}… ${Math.round(f * 100)}%`;
  });
  full.set(sd, w);
  if (current !== sd) return;
  busy.hidden = true;
  showWorld(w);
}
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      view = b.dataset.view as View;
      document.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (world) {
        ictx.putImageData(paint(world, view), 0, 0);
        redrawMap();
        legend();
      }
    }),
);
$("more").onclick = () => {
  seeds = [todaySeed, ...Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 99999))];
  thumbButtons();
};
const seedGo = () => {
  const v = parseInt(($("seed-in") as HTMLInputElement).value, 10);
  if (!Number.isFinite(v)) return;
  if (!seeds.includes(v)) {
    seeds = [v, ...seeds.filter((s) => s !== v)].slice(0, 6);
    if (!seeds.includes(todaySeed)) seeds[seeds.length - 1] = todaySeed;
    thumbButtons();
  }
  void choose(v);
};
$("seed-go").onclick = seedGo;
($("seed-in") as HTMLInputElement).addEventListener("keydown", (e) => {
  if (e.key === "Enter") seedGo();
});
addEventListener("resize", () => {
  drawSection();
  redrawMap();
});

void choose(current);
thumbButtons();
Object.assign(window, { atlas: { get world() { return world; }, choose, setView: (v: View) => (document.querySelector(`[data-view="${v}"]`) as HTMLButtonElement).click() } });
