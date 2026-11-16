"""Shape and motion measures of a reference video of a flock against the sky.

    ffmpeg -i video.webm -vf "fps=10,scale=640:-2" frames10/%04d.png
    python tools/murmuration-lab/reference/video_metrics.py frames10

Assumes a fixed camera, sky above a dark treeline, dark birds. The same measures for our own flock
come from metrics.py. The reference footage is not in the repository: ask the user for it.
"""
import cv2, numpy as np, glob, sys
fs = sorted(glob.glob(sys.argv[1] + '/*.png'))
frames = [cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2GRAY).astype(np.float32) for f in fs]
H, W = frames[0].shape
# Treeline: the first row (from the top) where the median of the row is much darker than the sky.
med = np.median(frames[0], axis=1)
sky_row = np.argmax(med < med[:int(H*0.5)].mean() * 0.6)
top = int(sky_row) - 12
print("frame", W, H, "treeline row", sky_row)
out = []
allmasks = []
prev = None
for i, g in enumerate(frames):
    region = g[:top]
    # Sky: a smooth cubic surface fitted to pixels that are not birds.
    yy, xx = np.mgrid[0:top, 0:W]; xn = xx / W; yn = yy / H
    A = np.stack([np.ones_like(xn), xn, yn, xn*xn, xn*yn, yn*yn, xn**3, xn*xn*yn, xn*yn*yn, yn**3], -1).reshape(-1, 10)
    z = region.reshape(-1); keep = np.ones_like(z, bool)
    for it in range(4):
        coef, *_ = np.linalg.lstsq(A[keep][::7], z[keep][::7], rcond=None)
        fit = A @ coef
        keep = (fit - z) < 0.04 * fit
    bg = fit.reshape(top, W)
    dark = np.clip((bg - region) / np.maximum(bg, 1), 0, 1)       # 0 = sky, 1 = black
    dens = cv2.GaussianBlur(dark, (0, 0), 2.5)
    mask = dens > 0.07
    # Keep flock blobs: drop specks and anything hugging the frame's top edge (cloud).
    n, lab, stats, cen = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    good = np.zeros(n, bool)
    for k in range(1, n):
        if stats[k, cv2.CC_STAT_AREA] > 0.0008 * W * top and stats[k, cv2.CC_STAT_TOP] > 2:
            good[k] = True
    mask = good[lab]
    m = {}
    ys, xs = np.nonzero(mask)
    m["t"] = i / 10
    if len(xs) > 50:
        x0, x1 = np.percentile(xs, [1, 99]); y0, y1 = np.percentile(ys, [1, 99])
        m["width"] = (x1 - x0) / W
        m["height"] = (y1 - y0) / H
        m["aspect"] = (x1 - x0) / max(1, y1 - y0)
        m["coverage"] = mask.mean() * top / H
        vals = dens[mask]
        m["dens_p50"] = float(np.percentile(vals, 50)); m["dens_p95"] = float(np.percentile(vals, 95))
        # Edge softness: share of the flock area that is only faintly dense.
        m["faint_share"] = float((vals < 0.12).mean())
        n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
        big = [s for s in stats[1:, cv2.CC_STAT_AREA] if s > 0.002 * W * top]
        m["clusters"] = len(big)
        m["largest_share"] = float(max(big) / sum(big)) if big else 0
        # Height of the flock bottom above the treeline (fraction of frame height).
        m["bottom_gap"] = (sky_row - y1) / H
    if prev is not None:
        flow = cv2.calcOpticalFlowFarneback(prev[:top].astype(np.uint8), g[:top].astype(np.uint8), None, 0.5, 3, 9, 3, 5, 1.1, 0)
        fx, fy = flow[..., 0] * 10 / W, flow[..., 1] * 10 / W   # frame widths per second
        sel = mask & (np.hypot(fx, fy) > 0.002)
        if sel.sum() > 100:
            vx, vy = fx[sel], fy[sel]
            mx, my = np.median(vx), np.median(vy)
            m["speed"] = float(np.median(np.hypot(vx, vy)))
            m["bulk"] = [float(mx), float(my)]
            rel = np.hypot(vx - mx, vy - my)
            m["internal"] = float(np.median(rel))                    # motion relative to the bulk
            ang = np.arctan2(vy, vx); 
            R = np.hypot(np.cos(ang).mean(), np.sin(ang).mean())
            m["dir_coherence"] = float(R)                             # 1 = all one way
            m["counterflow"] = float(min((vx > 0).mean(), (vx < 0).mean()))
    prev = g
    out.append(m)
    allmasks.append(mask)
keys = ["width","height","aspect","coverage","dens_p50","dens_p95","faint_share","clusters","largest_share","bottom_gap","speed","internal","dir_coherence","counterflow"]
for k in keys:
    v = np.array([m[k] for m in out if k in m])
    print(f"{k:14s} median {np.median(v):.3f}  p10 {np.percentile(v,10):.3f}  p90 {np.percentile(v,90):.3f}")
# Shape change: overlap of the flock's outline with itself 1 s and 3 s later. The frame ranges that
# are skipped held a cut in the footage first measured; adjust or remove them for other footage.

def iou(a, b): return (a & b).sum() / max(1, (a | b).sum())
i1 = [iou(allmasks[i], allmasks[i+10]) for i in range(0, len(allmasks)-10, 5) if not (190 <= i <= 205)]
i3 = [iou(allmasks[i], allmasks[i+30]) for i in range(0, len(allmasks)-30, 5) if not (170 <= i <= 205)]
print(f"iou_1s median {np.median(i1):.3f}   iou_3s median {np.median(i3):.3f}")
