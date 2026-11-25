// The scale lab in the browser: the same scene, camera and methods as the video, drawn on the CPU
// at the wall's pixel size and magnified without smoothing.
import { LOOP, METHODS, type Method, PH, PW, SEGMENTS, camAt, frame, scene } from "./scalelab";

const $ = (id: string) => document.getElementById(id)!;
const canvas = $("view") as HTMLCanvasElement,
  ctx = canvas.getContext("2d")!,
  objs = scene(),
  panels = new Map<Method, { img: ImageData; c: HTMLCanvasElement }>();
let shown: Method[] = ["dither", "jumps", "seams", "voxel"],
  single: Method | null = matchMedia("(max-width: 700px)").matches ? "seams" : null,
  playing = !matchMedia("(prefers-reduced-motion: reduce)").matches,
  speed = 0.5,
  t = 0,
  zoom = 0;
for (const m of shown) {
  const c = document.createElement("canvas");
  c.width = PW;
  c.height = PH;
  panels.set(m, { img: new ImageData(PW, PH), c });
}

function layout() {
  const area = $("stage").getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1,
    cols = single ? 1 : 2,
    rows = single ? 1 : 2,
    gap = single ? 0 : 6,
    w = cols * PW + (cols - 1) * gap,
    h = rows * PH + (rows - 1) * gap;
  // Whole-number magnification when it fits, so every art pixel is the same size.
  let k = Math.min((area.width * dpr) / w, (area.height * dpr) / h);
  k = zoom > 0 ? zoom * dpr : k >= 2 ? Math.floor(k) : k;
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  return { k, gap };
}
let L = layout();
addEventListener("resize", () => (L = layout()));

function draw() {
  const list = single ? [single] : shown;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#121419";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  list.forEach((m, i) => {
    const p = panels.get(m)!,
      data = p.img.data;
    frame(objs, t, m, data);
    p.c.getContext("2d")!.putImageData(p.img, 0, 0);
    const col = single ? 0 : i % 2,
      row = single ? 0 : Math.floor(i / 2),
      x = Math.round(col * (PW + L.gap) * L.k),
      y = Math.round(row * (PH + L.gap) * L.k);
    ctx.drawImage(p.c, x, y, Math.round(PW * L.k), Math.round(PH * L.k));
    if (!single) {
      const name = METHODS.find((d) => d.id === m)!.name,
        fs = Math.max(11, Math.round(L.k * 5));
      ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(name).width;
      ctx.fillStyle = "rgba(10,12,16,0.62)";
      ctx.fillRect(x + 6, y + 6, tw + 12, fs + 10);
      ctx.fillStyle = "#f2eee4";
      ctx.fillText(name, x + 12, y + 6 + fs + 1);
    }
  });
  const cam = camAt(t);
  $("seg").textContent = `Camera ${SEGMENTS[cam.seg]} · ${t.toFixed(2)} s of ${LOOP}`;
  ($("scrub") as HTMLInputElement).value = String(t);
  if (single) {
    const d = METHODS.find((x) => x.id === single)!;
    $("note").textContent = `${d.name}: ${d.note}`;
  } else $("note").textContent = "Tap a panel to watch it alone.";
}

let last = 0;
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  if (playing) t = (t + dt * speed) % LOOP;
  draw();
  requestAnimationFrame(loop);
}

// ---- Controls -------------------------------------------------------------------------------------
function setPressed(sel: string, el: Element | null) {
  document.querySelectorAll(sel).forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
}
$("play").onclick = () => {
  playing = !playing;
  $("play").textContent = playing ? "Pause" : "Play";
};
document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach(
  (b) =>
    (b.onclick = () => {
      speed = Number(b.dataset.speed);
      setPressed("[data-speed]", b);
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(
  (b) =>
    (b.onclick = () => {
      playing = false;
      $("play").textContent = "Play";
      t = (t + Number(b.dataset.step) / 30 + LOOP) % LOOP;
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach(
  (b) =>
    (b.onclick = () => {
      zoom = Number(b.dataset.zoom);
      setPressed("[data-zoom]", b);
      L = layout();
    }),
);
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      single = (b.dataset.view as Method) || null;
      setPressed("[data-view]", b);
      L = layout();
    }),
);
($("scrub") as HTMLInputElement).oninput = (e) => {
  t = Number((e.target as HTMLInputElement).value);
};
canvas.onclick = (e) => {
  if (single) {
    single = null;
  } else {
    const r = canvas.getBoundingClientRect(),
      col = e.clientX - r.left > r.width / 2 ? 1 : 0,
      row = e.clientY - r.top > r.height / 2 ? 1 : 0;
    single = shown[row * 2 + col];
  }
  setPressed("[data-view]", document.querySelector(`[data-view="${single ?? ""}"]`));
  L = layout();
};
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === " ") {
    $("play").click();
    e.preventDefault();
  }
  if (e.key === "ArrowRight") (document.querySelector('[data-step="1"]') as HTMLButtonElement).click();
  if (e.key === "ArrowLeft") (document.querySelector('[data-step="-1"]') as HTMLButtonElement).click();
});
if (!playing) $("play").textContent = "Play";
setPressed("[data-view]", document.querySelector(`[data-view="${single ?? ""}"]`));

// ---- Warm up: draw every size the loop will need, a little at a time, then play. ---------------------
async function warm() {
  const steps = 160,
    scratch = new Uint8ClampedArray(PW * PH * 4);
  for (let k = 0; k < steps; k++) {
    for (const m of shown) frame(objs, (k / steps) * LOOP, m, scratch);
    $("loading").textContent = `Drawing the sprites… ${Math.round(((k + 1) / steps) * 100)}%`;
    if (k % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  $("loading").hidden = true;
  L = layout();
  requestAnimationFrame((n) => {
    last = n;
    loop(n);
  });
}
void warm();
