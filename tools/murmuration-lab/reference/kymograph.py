"""Ripples and splits made visible, for a reference video or one of our own clips.

    ffmpeg -i clip.mp4 -vf "scale=960:-2" frames25/%04d.png        (25 fps source)
    python tools/murmuration-lab/reference/kymograph.py frames25 spacetime.png [skyRows=400]
    python tools/murmuration-lab/reference/kymograph.py frames25 ripple.png [skyRows] --ripple <startFrame>

The space-time picture has position across the frame left to right and time running downward.
Fine stripes crossing the whole flock are ripples; dark strands that peel away and return are parts of
the flock pulling apart and rejoining. With --ripple it shows eight steps of 0.12 s: red where the flock
is getting darker, blue where it is getting lighter, so a travelling front can be seen and timed.
skyRows is the number of image rows, from the top, that contain only sky and birds.
"""
import cv2, numpy as np, glob, sys
src, out = sys.argv[1], sys.argv[2]
rows = int(sys.argv[3]) if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else 400
fs = sorted(glob.glob(src + '/*.png'))
def dark(f):
    g = cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2GRAY).astype(np.float32)[:rows]
    bg = cv2.GaussianBlur(cv2.dilate(g, np.ones((41, 41), np.uint8)), (0, 0), 20)
    return np.clip((bg - g) / np.maximum(bg, 1), 0, 1), g
if "--ripple" in sys.argv:
    start = int(sys.argv[sys.argv.index("--ripple") + 1]); tiles = []
    for k in range(8):
        i = start + k * 3
        a, g = dark(fs[i]); b, _ = dark(fs[i + 3])
        diff = (cv2.GaussianBlur(b, (0, 0), 3) - cv2.GaussianBlur(a, (0, 0), 3)) * 6
        base = 0.25 + 0.75 * (g / 255); vis = np.zeros(a.shape + (3,), np.float32)
        vis[..., 2] = base + np.clip(diff, 0, 1); vis[..., 0] = base + np.clip(-diff, 0, 1); vis[..., 1] = base - 0.5 * np.abs(diff)
        v = (np.clip(vis, 0, 1) * 255).astype(np.uint8)
        cv2.putText(v, f"t={i / 25:.2f}s", (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1); tiles.append(v)
    cv2.imwrite(out, np.concatenate([np.concatenate(tiles[:4], 0), np.concatenate(tiles[4:], 0)], 1))
else:
    K = np.array([dark(f)[0].sum(0) for f in fs]); K = K / np.percentile(K, 99.5)
    img = cv2.resize((255 * (1 - np.clip(K, 0, 1))).astype(np.uint8), (K.shape[1], len(fs) * 2), interpolation=cv2.INTER_NEAREST)
    for s in range(0, len(fs) // 25 + 1, 5):
        cv2.putText(img, f"{s}s", (4, s * 50 + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.5, 0, 1); cv2.line(img, (0, s * 50), (30, s * 50), 0, 1)
    cv2.imwrite(out, img)
    prev = None; ch = []
    for i in range(0, len(fs), 2):
        d = cv2.GaussianBlur(dark(fs[i])[0], (0, 0), 4)
        if prev is not None:
            m = (d > 0.08) | (prev > 0.08)
            if m.any(): ch.append(np.abs(d - prev)[m].mean() / max(1e-6, d[m].mean()))
        prev = d
    print("shimmer (relative change of density per 0.08 s): median %.3f, 90th percentile %.3f" % (np.median(ch), np.percentile(ch, 90)))
print("wrote", out)
