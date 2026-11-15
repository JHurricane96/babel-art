"""Sketch of a look, not of a motion model: one flexible sheet of 50,000 real-size birds at real
spacing, placed evenly and shaded by how much flock lies along each line of sight.

    python tools/murmuration-lab/sketches/sheet_mock.py <outDir> sheet            contact sheet, every 12 s
    python tools/murmuration-lab/sketches/sheet_mock.py <outDir> still 216 96     full-resolution stills
    python tools/murmuration-lab/sketches/sheet_mock.py <outDir> clip 84 40 out.mp4

What it showed (November 2026): a crisp outline, a light veil and dark folds, and reference-like grain,
all from geometry and bird count alone. What it lacks, and why it was rejected as a motion model:
every bird follows the same path, so there are no ripples and nothing pulls apart or rejoins.
Keep the drawing lessons; do not use path-following for motion. The path here is a made-up curve.
"""
import numpy as np, cv2, sys
S = sys.argv[1]; seed = "mock"
cam = dict(x=0.0, y=2.0, z=-600.0, focal=1350.0, horizon=364.0); DT = 0.1
tt0 = np.arange(0, 400, DT)
route = np.stack([125 * np.sin(0.047 * tt0 + 0.4) + 25 * np.sin(0.131 * tt0), 80 + 22 * np.sin(0.071 * tt0 + 1.0) + 9 * np.sin(0.19 * tt0),
                  30 + 50 * np.sin(0.083 * tt0 + 2.0) + 18 * np.sin(0.157 * tt0 + 0.7)], 1)
SPEED = 8.5
def smooth1(a, sig):
    k = int(sig * 4) | 1; x = np.arange(k) - k // 2; w = np.exp(-x * x / (2 * sig * sig)); w /= w.sum()
    return np.stack([np.convolve(np.pad(a[:, i], (k // 2, k // 2), mode="edge"), w, "valid") for i in range(a.shape[1])], 1)
P = smooth1(route, 6)
T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True)
B = np.zeros_like(T); b = np.cross([0, 1, 0], T[0]); b /= np.linalg.norm(b)
for k in range(len(T)):
    b = b - (b @ T[k]) * T[k]; b /= np.linalg.norm(b); B[k] = b          # parallel transport: no flips in loops
head = np.unwrap(np.arctan2(T[:, 2], T[:, 0])); yaw = smooth1(np.gradient(head)[:, None] / DT, 15)[:, 0]
def vnoise(x, s):
    i = np.floor(x).astype(np.int64); f = x - i; u = f * f * (3 - 2 * f)
    h = lambda n: (np.sin(n * 127.1 + s * 311.7) * 43758.5453) % 1.0
    return h(i) * (1 - u) + h(i + 1) * u
tt = np.arange(len(P)) * DT
roll = np.clip(-1.4 * yaw, -0.8, 0.8) + 0.8 * (vnoise(tt * 0.03, 3.0) - 0.5) + 0.4 * (vnoise(tt * 0.08, 4.0) - 0.5)
Nn = np.cross(T, B)
Br = np.cos(roll)[:, None] * B + np.sin(roll)[:, None] * Nn
Nr = np.cross(T, Br)
# --- birds ------------------------------------------------------------------
N = 50000
LENGTH = 26.0                                             # seconds of path the flock covers (~220 m)
i = np.arange(N) + 0.5
q0 = (i * 0.7548776662466927) % 1.0; q1 = (i * 0.5698402909980532) % 1.0   # even (low-discrepancy) spacing
taper = lambda m: np.sqrt(np.clip(1 - (2 * np.clip(m, 0, 1) - 1) ** 2, 0, 1)) ** 0.7 * (1.15 - 0.5 * m) + 0.02
mm = np.linspace(0, 1, 2001); cdf = np.cumsum(taper(mm)); cdf /= cdf[-1]
m = np.interp(q0, cdf, mm)                                # place along the flock, head (0) to tail (1)
u0 = 2 * q1 - 1; u0 = np.sign(u0) * np.abs(u0) ** 0.85    # across the sheet, a little denser at the rim
rng = np.random.default_rng(5)
v0 = rng.uniform(-1, 1, N)
ph = rng.uniform(0, 6.283, (4, N)); om = rng.uniform(0.3, 0.9, (4, N))
def birds(t):
    lag = m * LENGTH + 0.35 * np.sin(om[0] * t + ph[0])
    # A compression wave runs down the flock: birds bunch and spread (dark bands that travel).
    lag = lag + 0.5 * np.sin(6.283 * (m * 2.6 - t / 7.0)) * (0.5 + 0.5 * np.sin(t / 23.0))
    tau = (t - lag) / DT
    k = np.clip(np.floor(tau).astype(int), 0, len(P) - 2); f = (tau - k)[:, None]
    p = P[k] * (1 - f) + P[k + 1] * f; br = Br[k] * (1 - f) + Br[k + 1] * f; nr = Nr[k] * (1 - f) + Nr[k + 1] * f; tg = T[k]
    # Width breathes and carries bulges that travel with the birds.
    w = 46 * taper(m) * (0.35 + 0.75 * vnoise(m * 3.2 + t * 0.03, 1.0) + 0.45 * vnoise(m * 1.3 - t * 0.02, 2.0)) * (0.85 + 0.25 * np.sin(t / 17.0))
    h = (5.0 + 6.0 * vnoise(m * 5 + t * 0.05, 6.0)) * np.sqrt(np.clip(1 - u0 * u0, 0.03, 1))
    u = u0 + 0.05 * np.sin(om[1] * t + ph[1]); v = v0 + 0.25 * np.sin(om[2] * t + ph[2])
    # The sheet ripples like fabric: a travelling undulation out of its own plane.
    ripple = 4.0 * np.sin(6.283 * (m * 2.6 - t / 7.0) + 1.2 * u) + 3.5 * np.sin(6.283 * (m * 1.1 + t / 15.0) - 2.0 * u)
    x = p + br * (u * w)[:, None] + nr * (v * h + ripple)[:, None]
    return x, tg
def project(x):
    depth = np.maximum(1, x[:, 2] - cam["z"]); s = cam["focal"] / depth
    return 320 + (x[:, 0] - cam["x"]) * s, cam["horizon"] - (x[:, 1] - cam["y"]) * s, s
def sky(W, H, k):
    yy = (np.arange(H)[:, None] / H); xx = np.arange(W)[None, :] / W
    hor = cam["horizon"] / 400
    g = 0.60 + 0.20 * np.clip(yy / hor, 0, 1) ** 1.5 - 0.10 * ((xx - 0.5) ** 2 + (yy - 0.55) ** 2)
    g = g * np.ones((1, W))
    r = np.random.default_rng(3)
    # treeline: irregular dark masses and single trees, land near black
    x = np.arange(W) / W
    tree = 0.012 * (vnoise(x * 60, 9.0) > 0.45) * (0.5 + vnoise(x * 240, 10.0)) + 0.02 * np.clip(vnoise(x * 9, 11.0) - 0.55, 0, 1) * (0.6 + 0.8 * vnoise(x * 300, 12.0))
    for c in range(W):
        g[int((hor - tree[c]) * H):int(hor * H), c] = 0.13
    g[int(hor * H):] = 0.10 + 0.03 * (1 - (yy[int(hor * H):] - hor) / (1 - hor))
    return g.astype(np.float32)
def render(t, W=1920, H=1200, bg=None):
    k = W / 640
    x, tg = birds(t)
    sx, sy, s = project(x)
    x2, y2, _ = project(x + tg * 0.5)
    dx, dy = (x2 - sx), (y2 - sy); dl = np.hypot(dx, dy) + 1e-9; dx /= dl; dy /= dl
    acc = np.zeros((H, W), np.float32)
    size = np.clip(0.42 * s * k, 0.6, 3.0)                 # half-length of the mark in px (a 0.4 m bird)
    for e in (-0.6, 0.0, 0.6):
        px = sx * k + dx * size * e; py = sy * k + dy * size * e
        ix = np.round(px).astype(int); iy = np.round(py).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        np.add.at(acc, (iy[ok], ix[ok]), 1 / 3)
    acc = cv2.GaussianBlur(acc, (0, 0), 0.75)
    bg = sky(W, H, k) if bg is None else bg
    img = bg * (0.14 + 0.86 * np.exp(-2.1 * acc))
    return np.clip(img * 255, 0, 255).astype(np.uint8)
if __name__ == "__main__":
    mode = sys.argv[2] if len(sys.argv) > 2 else "sheet"
    if mode == "sheet":
        tiles = []
        for t in range(60, 300, 12):
            im = cv2.resize(render(float(t), 960, 600), (480, 300), interpolation=cv2.INTER_AREA)
            cv2.putText(im, f"{t}s", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, 255, 2); tiles.append(im)
        cv2.imwrite(f"{S}/sheet-mock.png", np.concatenate([np.concatenate(tiles[r:r + 5], 1) for r in range(0, 20, 5)], 0))
    elif mode == "still":
        for t in sys.argv[3:]:
            cv2.imwrite(f"{S}/sheet-mock-{t}.png", render(float(t)))
    elif mode == "clip":
        import subprocess, time
        t0, secs, out = float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
        W, H = 1280, 800
        bg = sky(W, H, W / 640)
        p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", "25", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21", out], stdin=subprocess.PIPE)
        st = time.time()
        for f in range(int(secs * 25)):
            p.stdin.write(render(t0 + f / 25, W, H, bg).tobytes())
        p.stdin.close(); p.wait(); print("clip", out, round(time.time() - st), "s")
