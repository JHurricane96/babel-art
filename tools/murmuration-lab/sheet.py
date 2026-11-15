"""Contact sheet from an export: one small frame every <step> seconds, and shape measures over time.

    python tools/murmuration-lab/sheet.py <export.bin> <out.png> <stepSeconds> [--spread 0.8]

For hours-long checks export at a low rate (for example 0.2 fps for 30–120 minutes) and use a
60 s step: the sheet shows one frame a minute and the printout shows drift over five-minute blocks.
"""
import argparse, json
import numpy as np, cv2

ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("out"); ap.add_argument("step", type=float)
ap.add_argument("--spread", type=float, default=0.8); a = ap.parse_args()
meta = json.load(open(a.src + ".json")); n, fps, frames = meta["n"], meta["fps"], meta["frames"]
d = np.fromfile(a.src, np.float32).reshape(frames, n, 6)
off = np.random.default_rng(7).uniform(-a.spread, a.spread, (8, n, 2))
tiles, stats = [], []
every = max(1, int(round(a.step * fps)))
for f in range(frames):
    x, y, s = d[f, :, 0], d[f, :, 1], d[f, :, 2]
    acc = np.zeros((400, 640), np.float32)
    for c in range(8):
        ix = (x + off[c, :, 0] * s).astype(int); iy = (y + off[c, :, 1] * s).astype(int)
        ok = (ix >= 0) & (ix < 640) & (iy >= 0) & (iy < 400); np.add.at(acc, (iy[ok], ix[ok]), 1)
    m = cv2.GaussianBlur(acc, (0, 0), 2.5) > 0.35
    ys, xs = np.nonzero(m)
    if len(xs) > 50:
        x0, x1 = np.percentile(xs, [1, 99]); y0, y1 = np.percentile(ys, [1, 99])
        _, _, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
        stats.append(((x0 + x1) / 1280, (y0 + y1) / 800, (x1 - x0) / 640, (y1 - y0) / 400, sum(st[1:, cv2.CC_STAT_AREA] > 0.002 * 256000), f / fps))
    if f % every == 0 and len(tiles) < 60:
        img = 175 * np.exp(-0.9 * cv2.GaussianBlur(acc, (0, 0), 0.7)); img[int(meta["horizon"]):] = 40
        t = f / fps; label = f"{t / 60:.0f} min" if a.step >= 60 else f"{t:.0f}s"
        im = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_GRAY2BGR); cv2.putText(im, label, (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        tiles.append(cv2.resize(im, (320, 200)))
cols = 6
while len(tiles) % cols: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(a.out, np.concatenate([np.concatenate(tiles[i:i + cols], 1) for i in range(0, len(tiles), cols)], 0))
s = np.array(stats)
for name, col in (("centre x", 0), ("centre y", 1), ("width", 2), ("height", 3)):
    print("%-9s p5 %.2f p50 %.2f p95 %.2f  (fractions of the 640x400 image)" % ((name,) + tuple(np.percentile(s[:, col], [5, 50, 95]))))
print("pieces    one %.0f%%  two %.0f%%  three or more %.0f%% of frames" % (100 * (s[:, 4] == 1).mean(), 100 * (s[:, 4] == 2).mean(), 100 * (s[:, 4] >= 3).mean()))
block = 300 if s[-1, 5] > 900 else max(10, s[-1, 5] / 6)
for t0 in np.arange(0, s[-1, 5], block):
    c = s[(s[:, 5] >= t0) & (s[:, 5] < t0 + block)]
    if len(c): print("  %5.1f-%5.1f min: width %.2f height %.2f centre-y %.2f pieces %.1f" % (t0 / 60, (t0 + block) / 60, c[:, 2].mean(), c[:, 3].mean(), c[:, 1].mean(), c[:, 4].mean()))
print("wrote", a.out)
