"""Shape and motion measures of an export, computed the way reference/video_metrics.py measures a video.

    python tools/murmuration-lab/metrics.py <export.bin> [--spread 0]

Guard rails only. These numbers can rule out a wrong shape (a blob, a flock that never splits); they
cannot show that the motion is beautiful. Judge that from clips and stills, and let the user decide.
"""
import argparse, json
import numpy as np, cv2

ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("--spread", type=float, default=0.0); a = ap.parse_args()
meta = json.load(open(a.src + ".json")); n, frames, fps = meta["n"], meta["frames"], meta["fps"]
d = np.fromfile(a.src, np.float32).reshape(frames, n, 6)
W, H = 640, 400
off = np.random.default_rng(7).uniform(-a.spread, a.spread, (8, n, 2)).astype(np.float32)
rows, masks = [], []
step = max(1, int(round(fps / 10)))
for f in range(0, frames, step):
    x, y, s = d[f, :, 0], d[f, :, 1], d[f, :, 2]
    img = np.zeros((H, W), np.float32)
    for c in range(8):
        ix = (x + off[c, :, 0] * s).astype(int); iy = (y + off[c, :, 1] * s).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H); np.add.at(img, (iy[ok], ix[ok]), 1)
    mask = cv2.GaussianBlur(img, (0, 0), 2.5) > 0.35
    nl, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep = np.zeros(nl, bool); keep[1:] = stats[1:, cv2.CC_STAT_AREA] > 0.0008 * W * H
    mask = keep[lab]; masks.append(mask)
    m = {}
    ys, xs = np.nonzero(mask)
    if len(xs) > 50:
        x0, x1 = np.percentile(xs, [1, 99]); y0, y1 = np.percentile(ys, [1, 99])
        m.update(width=(x1 - x0) / W, height=(y1 - y0) / H, aspect=(x1 - x0) / max(1, y1 - y0), coverage=mask.mean())
        big = [v for v in stats[1:, cv2.CC_STAT_AREA] if v > 0.002 * W * H]
        m["pieces"] = len(big); m["largest_share"] = max(big) / sum(big) if big else 0
    if f + step < frames:
        vx = (d[f + step, :, 0] - x) / W * fps / step; vy = (d[f + step, :, 1] - y) / W * fps / step
        sel = np.hypot(vx, vy) > 0.002
        if sel.sum() > 100:
            mx, my = np.median(vx[sel]), np.median(vy[sel])
            m["speed"] = float(np.median(np.hypot(vx[sel], vy[sel])))
            m["internal"] = float(np.median(np.hypot(vx[sel] - mx, vy[sel] - my)))        # motion relative to the bulk
            m["counterflow"] = float(min((vx[sel] > 0).mean(), (vx[sel] < 0).mean()))     # share moving against the majority
    rows.append(m)
iou = lambda p, q: (p & q).sum() / max(1, (p | q).sum())
for key in ["width", "height", "aspect", "coverage", "pieces", "largest_share", "speed", "internal", "counterflow"]:
    v = np.array([r[key] for r in rows if key in r]); print(f"  {key:14s} median {np.median(v):.3f}  p10 {np.percentile(v, 10):.3f}  p90 {np.percentile(v, 90):.3f}")
w = np.array([r["width"] for r in rows if "width" in r]); sp = np.array([r["speed"] for r in rows if "speed" in r])
print(f"  pace (flock widths per second) {np.median(sp) / np.median(w):.3f}")
if len(masks) > 30:
    print(f"  shape kept after 1 s {np.median([iou(masks[i], masks[i + 10]) for i in range(0, len(masks) - 10, 5)]):.2f}, after 3 s {np.median([iou(masks[i], masks[i + 30]) for i in range(0, len(masks) - 30, 5)]):.2f}  (overlap, 1 = unchanged)")
