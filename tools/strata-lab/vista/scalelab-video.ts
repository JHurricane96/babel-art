// Render the scale lab to video: the four methods side by side (2 x 2), each panel at the wall's
// pixel size, magnified 3x without smoothing, labelled.
//
//   node --import tsx tools/strata-lab/vista/scalelab-video.ts OUT.mp4 [--seconds 16] [--methods jumps,dither,pixel,nearest] [--zoom 3]
import { spawn } from "node:child_process";
import { METHODS, type Method, PH, PW, SEGMENTS, frame, scene, cached } from "./scalelab";

const args = process.argv.slice(2),
  flag = (n: string, d: string) => {
    const k = args.indexOf(n);
    return k >= 0 ? args[k + 1] : d;
  },
  out = args.find((a) => a.endsWith(".mp4")) ?? "scalelab.mp4",
  seconds = Number(flag("--seconds", "16")),
  zoom = Number(flag("--zoom", "3")),
  methods = flag("--methods", "jumps,dither,pixel,nearest").split(",") as Method[],
  FPS = 30,
  cols = methods.length > 2 ? 2 : methods.length,
  rows = Math.ceil(methods.length / cols),
  GAP = 2,
  W = cols * PW + (cols - 1) * GAP,
  H = rows * PH + (rows - 1) * GAP,
  objs = scene(),
  panel = new Uint8ClampedArray(PW * PH * 4),
  img = Buffer.alloc(W * H * 3);

// Labels: each panel's method at its top left, and what the camera is doing.
const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  esc = (s: string) => s.replace(/[:\\']/g, (c) => `\\${c}`),
  labels = methods.map((m, i) => {
    const x = (i % cols) * (PW + GAP) * zoom + 10,
      y = Math.floor(i / cols) * (PH + GAP) * zoom + 8,
      name = METHODS.find((d) => d.id === m)!.name;
    return `drawtext=fontfile=${font}:text='${esc(name)}':x=${x}:y=${y}:fontsize=${Math.round(9 * zoom)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6`;
  });
const segText = SEGMENTS.map(
  (s, k) => `drawtext=fontfile=${font}:text='camera ${esc(s)}':x=w-tw-10:y=h-th-10:fontsize=${Math.round(8 * zoom)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:enable='between(mod(t\\,16)\\,${k * 4}\\,${k * 4 + 3.99})'`,
);
const ff = spawn("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-",
  "-vf", [`scale=${W * zoom}:${H * zoom}:flags=neighbor`, ...labels, ...segText].join(","),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", out,
], { stdio: ["pipe", "inherit", "inherit"] });

const t0 = performance.now();
for (let f = 0; f < seconds * FPS; f++) {
  const t = f / FPS;
  img.fill(18);
  methods.forEach((m, i) => {
    frame(objs, t, m, panel);
    const ox = (i % cols) * (PW + GAP),
      oy = Math.floor(i / cols) * (PH + GAP);
    for (let y = 0; y < PH; y++)
      for (let x = 0; x < PW; x++) {
        const s = (y * PW + x) * 4,
          d = ((oy + y) * W + ox + x) * 3;
        img[d] = panel[s];
        img[d + 1] = panel[s + 1];
        img[d + 2] = panel[s + 2];
      }
  });
  if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once("drain", r));
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
console.log(`${out}: ${seconds} s, ${methods.length} methods, ${W * zoom}x${H * zoom}, ${((performance.now() - t0) / 1000).toFixed(1)} s to render, ${cached()} sprites drawn`);
