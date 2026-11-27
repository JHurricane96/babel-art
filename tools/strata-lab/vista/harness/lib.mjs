// What the harness's pieces share: where it keeps things, its ports, how Chromium draws, and a PNG
// writer for checks that make pictures.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

export const HERE = dirname(fileURLToPath(import.meta.url)),
  VISTA = dirname(HERE),
  REPO = join(VISTA, "..", "..", ".."),
  /** The build, the browser's profile (with the saved land and sprites), the server's log and what
   * checks write: VISTA_HARNESS, or a folder in the system's temp. */
  DIR = process.env.VISTA_HARNESS ?? join(tmpdir(), "vista-harness"),
  HTML = join(DIR, "vista.html"),
  OUT = join(DIR, "out"),
  /** The warm browser's control port; the page is served from the next (an origin that stays the
   * same, so what the page saves is found again). */
  CONTROL_PORT = Number(process.env.VISTA_HARNESS_PORT ?? 47710),
  PAGE_PORT = CONTROL_PORT + 1;
/** How Chromium draws: VISTA_GL=gpu uses the machine's GPU; otherwise SwiftShader (software). */
export const GL_ARGS =
  process.env.VISTA_GL === "gpu" ? ["--ignore-gpu-blocklist", "--enable-gpu"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

/** Write RGBA pixels (top row first) as a PNG, each pixel `scale` x `scale`; returns the path. */
export function png(path, w, h, rgba, scale = 1) {
  mkdirSync(dirname(path), { recursive: true });
  const W = w * scale,
    H = h * scale,
    raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = (((y / scale) | 0) * w + ((x / scale) | 0)) * 4,
        o = y * (W * 4 + 1) + 1 + x * 4;
      raw[o] = rgba[s];
      raw[o + 1] = rgba[s + 1];
      raw[o + 2] = rgba[s + 2];
      raw[o + 3] = rgba[s + 3];
    }
  const chunk = (t, d) => {
    const l = Buffer.alloc(4),
      td = Buffer.concat([Buffer.from(t), d]),
      c = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    c.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(W, 0);
  ih.writeUInt32BE(H, 4);
  ih[8] = 8;
  ih[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  return path;
}
/** A path in the harness's output folder. */
export const out = (name) => join(OUT, name);
