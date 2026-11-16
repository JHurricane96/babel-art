"""Tone and grain of a flock in a still (ours or a reference frame), from sky-only crops.

    python tools/murmuration-lab/tone.py <image[:x0,y0,x1,y1]> [more images...]

Give a crop that contains only sky and birds (no bezels, no land). Prints, inside the flock:
darkness relative to the sky (0 = sky, 1 = black) at several percentiles, and how noisy the grain is.
Reference footage measured this way: median 0.11-0.16, 95th percentile 0.29-0.55, maximum 0.44-0.84,
grain 0.3-0.6. The artwork on main in November 2026 (seed of the day, three moments): median 0.07-0.27,
95th percentile 0.21-0.56, maximum 0.30-0.66, grain 0.37-0.98. So tone was already close; grain was
rougher, and tone says nothing about outline or shape.
"""
import sys
import cv2, numpy as np

def darkness(g):
    g = g.astype(np.float32); H, W = g.shape
    yy, xx = np.mgrid[0:H, 0:W]; xn = xx / W; yn = yy / H
    A = np.stack([np.ones_like(xn), xn, yn, xn * xn, xn * yn, yn * yn, xn ** 3, xn * xn * yn, xn * yn * yn, yn ** 3], -1).reshape(-1, 10)
    z = g.reshape(-1); keep = np.ones_like(z, bool)
    for _ in range(5):                                   # fit a smooth sky to the pixels that are not birds
        coef, *_ = np.linalg.lstsq(A[keep][::11], z[keep][::11], rcond=None)
        fit = A @ coef; keep = (fit - z) < 0.03 * fit
    bg = fit.reshape(H, W)
    return np.clip((bg - g) / np.maximum(bg, 1), 0, 1).astype(np.float32)

for arg in sys.argv[1:]:
    name, _, crop = arg.partition(":")
    g = cv2.cvtColor(cv2.imread(name), cv2.COLOR_BGR2GRAY)
    if crop: x0, y0, x1, y1 = map(int, crop.split(",")); g = g[y0:y1, x0:x1]
    dark = darkness(g); dens = cv2.GaussianBlur(dark, (0, 0), 7.5)
    mask = dens > 0.05
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep = np.zeros(n, bool); keep[1:] = st[1:, cv2.CC_STAT_AREA] > 0.004 * g.size
    mask = keep[lab]
    if not mask.any(): print(arg, "no flock found"); continue
    v = dens[mask]; fine = dark - cv2.GaussianBlur(dark, (0, 0), 3)
    print(f"{arg}: flock covers {mask.mean() * 100:.1f}% of the crop; darkness median {np.percentile(v, 50):.2f}, 95th percentile {np.percentile(v, 95):.2f}, max {v.max():.2f}; grain {fine[mask].std() / max(1e-6, dark[mask].mean()):.2f}")
