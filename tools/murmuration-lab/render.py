"""Fast motion-review renderer: draws an export as dark specks on a plain sky and encodes a clip.

    python tools/murmuration-lab/render.py <export.bin> <out.mp4> [--ref video] [--spread 0.8] [--copies 8]

A 60 s clip takes about a minute on a CPU. Use it to judge motion and shape only: tone, grain and
scenery must be judged in the real renderer (capture.mjs). --ref stacks a reference video on top.
--spread/--copies scatter extra visible birds around each simulated bird (metres); the default draws each bird once.
"""
import argparse, json, subprocess
import numpy as np, cv2

ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("out"); ap.add_argument("--ref")
ap.add_argument("--spread", type=float, default=0.0); ap.add_argument("--copies", type=int, default=1)
ap.add_argument("--span", type=float, default=1.8, help="drawn bird size in metres (world scale)")
a = ap.parse_args()
meta = json.load(open(a.src + ".json")); n, frames, fps = meta["n"], meta["frames"], meta["fps"]
d = np.fromfile(a.src, np.float32).reshape(frames, n, 6)
W, H, SS = 960, 600, 2
k = W / 640
off = np.random.default_rng(7).uniform(-a.spread, a.spread, (a.copies, n, 2)).astype(np.float32)
yy = np.arange(H)[:, None] / H; hor = meta["horizon"] / 400
sky = (150 + 50 * np.clip(yy / hor, 0, 1) ** 1.2) * np.ones((1, W)); sky[int(hor * H):] = 38
sky = sky.astype(np.float32)
ref = cv2.VideoCapture(a.ref) if a.ref else None
proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H + (540 if ref else 0)}",
                         "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", a.out], stdin=subprocess.PIPE)
for f in range(frames):
    x, y, s, area, dx, dy = d[f].T
    acc = np.zeros((H * SS, W * SS), np.float32)
    shade = area                                          # the exporter's shade, 0..1
    for c in range(a.copies):
        # A small chevron: wings across the flight direction, swept back.
        for e, w in ((0.0, 0.0), (-0.25, 0.5), (-0.25, -0.5), (-0.1, 0.25), (-0.1, -0.25)):
            ix = ((x + off[c, :, 0] * s + (dx * e - dy * w) * a.span) * k * SS).astype(np.int32)
            iy = ((y + off[c, :, 1] * s + (dy * e + dx * w) * a.span) * k * SS).astype(np.int32)
            ok = (ix >= 0) & (ix < W * SS) & (iy >= 0) & (iy < H * SS)
            np.add.at(acc, (iy[ok], ix[ok]), shade[ok] / 5 * 2.2)
    acc = cv2.resize(cv2.GaussianBlur(acc, (0, 0), 0.8), (W, H), interpolation=cv2.INTER_AREA) * SS * SS
    frame = np.clip(sky * np.exp(-1.1 * acc), 0, 255).astype(np.uint8)
    if ref is not None:
        ok, rf = ref.read()
        if not ok: ref.set(cv2.CAP_PROP_POS_FRAMES, 0); ok, rf = ref.read()
        frame = np.concatenate([cv2.cvtColor(cv2.resize(rf, (W, 540)), cv2.COLOR_BGR2GRAY), frame], 0)
    proc.stdin.write(frame.tobytes())
proc.stdin.close(); proc.wait()
print("wrote", a.out)
