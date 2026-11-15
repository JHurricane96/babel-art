"""Sketch of a motion model: an "elastic flock". About 1,600 coarse parcels respond to each other;
turns start with a few parcels and travel through the rest as waves; the flock can stretch, tear and
re-merge. About 45,000 visible birds are then placed around the parcels, as a GPU would do.

    python tools/murmuration-lab/sketches/elastic.py <outDir> run <seed> <seconds> [compact|sheet]
    python tools/murmuration-lab/sketches/elastic.py <outDir> sheet <seed> <stepSeconds>
    python tools/murmuration-lab/sketches/elastic.py <outDir> clip <seed> <from s> <to s> <out.mp4>

Two configurations were tried in November 2026, each for 75-80 s with seed 1:
  compact  The flock pulled into two lobes and merged again without any script: one piece 57% of the
           time, two pieces 43%, largest piece never under 0.78. But it looked lumpy (each parcel's
           cloud of birds shows as a bump) and drew itself into a blob about 30% of the frame wide.
  sheet    A wide, thin flock seen from a closer camera. It shattered: three or more pieces 82% of the
           time, and the pieces collapsed into small dark pancakes that never rejoined.
Lessons: the mechanism for pulling apart and rejoining works; the edge-smoothing pull ("surface
tension") compacts fragments; thin sheets tear too easily with these springs; bumps the size of the
parcel spacing need more parcels or birds interpolated between neighbouring parcels. Whether ripples
read clearly was not checked. This is a NumPy probe, not production code.
"""
import numpy as np, cv2, sys, subprocess, time
PRESETS = {
    "compact": dict(D0=6.5, AY=1.7, cam=dict(x=0.0, y=2.0, z=-600.0, focal=1350.0, horizon=364.0),
                    box=dict(cx=0.0, cz=30.0, X=115.0, Z=70.0, ylo=45.0, yhi=115.0), init=(95, -30, 78, 9.0, 42, 25), home=55.0, tension=0.0, pitch=0.3),
    "sheet": dict(D0=6.0, AY=3.2, cam=dict(x=0.0, y=2.0, z=-280.0, focal=620.0, horizon=364.0),
                  box=dict(cx=0.0, cz=40.0, X=140.0, Z=110.0, ylo=55.0, yhi=120.0), init=(105, -30, 85, 2.5, 55, 30), home=95.0, tension=0.35, pitch=0.5),
}
CFG = PRESETS["compact"]
V0, K = 10.0, 8
def use(name):
    global CFG, D0, AY, RC, CAM, BOX
    CFG = PRESETS[name]; D0, AY = CFG["D0"], CFG["AY"]; RC = 3.0 * D0; CAM, BOX = CFG["cam"], CFG["box"]
use("compact")
# J: how strongly a parcel is torqued toward its neighbours' heading (sets how fast a turn travels);
# eta: damping of turning; ks: spring stiffness of the spacing; area/amax: pull back into the sky box.
P = dict(J=324.0, eta=0.6, ks=1.0, turn_every=7.0, zig_every=1.5, area=0.15, amax=4.0)

def neighbours(x):
    xs = x * np.array([1, AY, 1], np.float32)
    g = xs @ xs.T; sq = np.diag(g); d2 = sq[:, None] + sq[None, :] - 2 * g
    np.fill_diagonal(d2, 1e12)
    idx = np.argpartition(d2, K, axis=1)[:, :K]
    return idx

def simulate(seed, T, N=1600, fps=25, warm=6.0, log=True):
    rng = np.random.default_rng(seed)
    pts = []
    while len(pts) < N:
        p = rng.uniform(-1, 1, 2)
        if p @ p <= 1: pts.append(p)
    pts = np.array(pts)
    ia, ix0, iy, isd, ib, iz0 = CFG["init"]
    x = np.stack([pts[:, 0] * ia + ix0, iy + rng.normal(0, isd, N), pts[:, 1] * ib + iz0], 1)
    e = np.tile([1.0, 0, 0], (N, 1)); u = np.full(N, V0); w = np.zeros((N, 3))
    dt = 1 / 60; steps = int((T + warm) * 60); rec_every = 60 / fps
    events = []; next_turn = warm + 2.0; next_zig = warm + 0.5
    out = dict(x=[], e=[], w=[], L=[], shift=[], groups=[])
    Cs = None; acc = 0.0; up = np.array([0.0, 1.0, 0.0]); idx = neighbours(x)
    for step in range(steps):
        t = step * dt
        if step % 2 == 0: idx = neighbours(x)
        dx = x[idx] - x[:, None, :]
        dxs = dx * [1, AY, 1]; d = np.linalg.norm(dxs, axis=2) + 1e-9
        bond = np.clip((RC - d) / (RC - 1.8 * D0), 0, 1)                 # bonds fade out: the flock can tear
        # Elastic spacing: neighbours settle about D0 apart (closer vertically, so the flock is a sheet).
        f = (P["ks"] * (d - D0) * np.where(d < D0, 1.0, bond))[:, :, None] * dxs / d[:, :, None]
        F = f.sum(1) * [1, AY, 1] / K * 4
        Fm = np.linalg.norm(F, axis=1, keepdims=True); F = F * np.minimum(1, 6 / (Fm + 1e-9))
        # Stay in the sky in front of the viewer: birds past the edge turn back first, the rest follow.
        a = np.zeros_like(x)
        ox = np.abs(x[:, 0] - BOX["cx"]) - BOX["X"]; oz = np.abs(x[:, 2] - BOX["cz"]) - BOX["Z"]
        a[:, 0] = -np.sign(x[:, 0] - BOX["cx"]) * P["area"] * np.maximum(0, ox)
        a[:, 2] = -np.sign(x[:, 2] - BOX["cz"]) * P["area"] * np.maximum(0, oz)
        am = np.linalg.norm(a, axis=1, keepdims=True); a = a * np.minimum(1, P["amax"] / (am + 1e-9))
        fold = np.sin(t / 19.0 + seed) + 0.6 * np.sin(t / 7.3)
        a[:, 1] += 0.45 * np.sign(fold) * np.minimum(P["amax"], am[:, 0])    # the returning part passes above or below
        a[:, 1] += 0.25 * np.maximum(0, BOX["ylo"] - x[:, 1]) - 0.25 * np.maximum(0, x[:, 1] - BOX["yhi"])
        com = x.mean(0); r = x - com; r[:, 1] = 0; rm = np.linalg.norm(r, axis=1, keepdims=True)
        a += -r / (rm + 1e-9) * 1.0 * np.clip((rm - CFG["home"]) / 40, 0, 1)         # strays drift back toward the flock
        mo = (dx * (bond > 0)[:, :, None]).sum(1) / np.maximum(1, (bond > 0).sum(1))[:, None]
        a += CFG["tension"] * mo * [1, 0.3, 1]
        # Turning travels as a wave: each parcel is torqued toward its neighbours' heading.
        eb = (e[idx] * bond[:, :, None]).sum(1) + 1e-6 * e; eb /= np.linalg.norm(eb, axis=1, keepdims=True)
        w += (P["J"] * np.cross(e, eb) - P["eta"] * w) * dt
        # Initiators: a small group starts a turn, a climb or a dive, or a quick zig, and holds it.
        if t >= next_turn:
            c = rng.integers(N); mem = np.nonzero(np.linalg.norm(x - x[c], axis=1) < rng.uniform(20, 35))[0]
            side = np.cross(e[c], up); side /= np.linalg.norm(side) + 1e-9
            # Bias the turn toward the middle of the sky when the group is far out.
            to = np.array([BOX["cx"] - x[c, 0], 0, BOX["cz"] - x[c, 2]]); far = np.linalg.norm(to) / 120
            sgn = np.sign(np.cross(e[c], to)[1]) if rng.random() < min(0.9, far) else rng.choice([-1, 1])
            om = up * sgn * rng.uniform(0.5, 1.0) + side * rng.uniform(-CFG["pitch"], CFG["pitch"])
            events.append([t, t + rng.uniform(1.5, 3.5), mem, om, None]); next_turn = t + rng.exponential(P["turn_every"])
        if t >= next_zig:
            c = rng.integers(N); mem = np.nonzero(np.linalg.norm(x - x[c], axis=1) < rng.uniform(12, 20))[0]
            om = up * rng.choice([-1, 1]) * rng.uniform(1.2, 1.8)
            events.append([t, t + 0.55, mem, om, t + 0.25]); next_zig = t + rng.exponential(P["zig_every"])
        for ev in events:
            if ev[0] <= t < ev[1]:
                om = ev[3] if ev[4] is None or t < ev[4] else -ev[3]
                w[ev[2]] += (om - w[ev[2]]) * min(1, 8 * dt)
        events = [ev for ev in events if t < ev[1]]
        # Move.
        v = e * u[:, None] + (F + a) * dt
        un = np.linalg.norm(v, axis=1); e = v / un[:, None]; u = un + (V0 - un) * dt / 1.0
        e += np.cross(w, e) * dt
        e[:, 1] -= 0.5 * e[:, 1] * dt                                      # level out gently
        e /= np.linalg.norm(e, axis=1, keepdims=True); w -= (w * e).sum(1, keepdims=True) * e
        x = x + e * u[:, None] * dt
        acc = acc + 1 if t >= warm else 0.0
        if t >= warm and acc >= rec_every:
            acc -= rec_every
            dxv = np.where((bond > 0)[:, :, None], dx, np.nan)
            m = np.nan_to_num(np.nanmean(dxv, axis=1)); cnt = (bond > 0).sum(1)
            dc = np.nan_to_num(dxv - m[:, None, :])
            C = np.einsum("nki,nkj->nij", dc, dc) / np.maximum(1, cnt)[:, None, None]
            C[cnt < 3] = np.eye(3) * (D0 * D0 / 5)
            Cs = C if Cs is None else Cs + (C - Cs) * 0.25               # smooth in time
            L = np.linalg.cholesky(Cs + np.eye(3) * 0.5)
            # groups: connected pieces of the bond graph
            lab = np.arange(N); src = np.repeat(np.arange(N), K)[(bond > 0).ravel()]; dst = idx[bond > 0]
            for _ in range(200):
                new = lab.copy(); np.minimum.at(new, src, lab[dst]); np.minimum.at(new, dst, lab[src])
                if (new == lab).all(): break
                lab = new
            sizes = np.bincount(lab, minlength=N); big = np.sort(sizes[sizes > 0.03 * N])[::-1]
            out["x"].append(x.astype(np.float32)); out["e"].append(e.astype(np.float32)); out["w"].append(w.astype(np.float32))
            out["L"].append(L.astype(np.float32)); out["shift"].append((0.5 * m).astype(np.float32)); out["groups"].append((len(big), big[0] / N if len(big) else 0))
    return {k: np.array(v) for k, v in out.items()}

def project(p):
    depth = np.maximum(1, p[..., 2] - CAM["z"]); s = CAM["focal"] / depth
    return 320 + (p[..., 0] - CAM["x"]) * s, CAM["horizon"] - (p[..., 1] - CAM["y"]) * s, s

def background(W, H):
    yy = np.arange(H)[:, None] / H; xx = np.arange(W)[None, :] / W; hor = CAM["horizon"] / 400
    g = 0.62 + 0.19 * np.clip(yy / hor, 0, 1) ** 1.5 - 0.10 * ((xx - 0.5) ** 2 + (yy - 0.55) ** 2) + 0 * xx
    def vn(x, s):
        i = np.floor(x); f = x - i; q = f * f * (3 - 2 * f); h = lambda n: (np.sin(n * 127.1 + s * 311.7) * 43758.5453) % 1.0
        return h(i) * (1 - q) + h(i + 1) * q
    x = np.arange(W) / W
    tree = 0.012 * (vn(x * 60, 9.0) > 0.45) * (0.5 + vn(x * 240, 10.0)) + 0.02 * np.clip(vn(x * 9, 11.0) - 0.55, 0, 1) * (0.6 + 0.8 * vn(x * 300, 12.0))
    for c in range(W): g[int((hor - tree[c]) * H):int(hor * H), c] = 0.13
    g[int(hor * H):] = 0.11
    return g.astype(np.float32)

class Renderer:
    def __init__(self, N, M=28, seed=3):
        r = np.random.default_rng(seed); xi = r.normal(size=(N, M * 3, 3)); xi /= np.linalg.norm(xi, axis=2, keepdims=True)
        xi = (xi * r.uniform(0, 1, (N, M * 3, 1)) ** (1 / 3))[:, :M] * 1.9      # even fill of the unit ball, scaled
        self.xi = xi.astype(np.float32); self.M = M
    def frame(self, x, e, w, L, shift, W=1280, H=800, bg=None):
        k = W / 640
        p = x[:, None, :] + shift[:, None, :] + np.einsum("nij,nmj->nmi", L, self.xi)
        up = np.array([0, 1, 0], np.float32)
        side = np.cross(e, up); side /= np.linalg.norm(side, axis=1, keepdims=True) + 1e-9; upb = np.cross(side, e)
        bank = np.clip(np.arctan(V0 * w[:, 1] / 9.81), -1.3, 1.3)
        n = np.cos(bank)[:, None] * upb + np.sin(bank)[:, None] * side
        view = x - [CAM["x"], CAM["y"], CAM["z"]]; view /= np.linalg.norm(view, axis=1, keepdims=True)
        area = np.abs((n * view).sum(1))
        shade = np.repeat(0.40 + 0.95 * area ** 1.3, self.M)
        sx, sy, s = project(p.reshape(-1, 3))
        hx, hy, _ = project((p + e[:, None, :] * 0.5).reshape(-1, 3)); ddx, ddy = hx - sx, hy - sy; dl = np.hypot(ddx, ddy) + 1e-9
        size = np.clip(0.45 * s * k, 0.6, 3.0)
        acc = np.zeros((H, W), np.float32)
        for o in (-0.6, 0.0, 0.6):
            ix = np.round(sx * k + ddx / dl * size * o).astype(int); iy = np.round(sy * k + ddy / dl * size * o).astype(int)
            ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H); np.add.at(acc, (iy[ok], ix[ok]), shade[ok] / 3)
        acc = cv2.GaussianBlur(acc, (0, 0), 0.75)
        bg = background(W, H) if bg is None else bg
        return np.clip(bg * (0.14 + 0.86 * np.exp(-1.7 * acc)) * 255, 0, 255).astype(np.uint8)

if __name__ == "__main__":
    S, mode, seed = sys.argv[1], sys.argv[2], int(sys.argv[3])
    path = f"{S}/elastic-run{seed}.npz"
    if mode == "run":
        preset = sys.argv[5] if len(sys.argv) > 5 else "compact"; use(preset)
        t0 = time.time(); d = simulate(seed, float(sys.argv[4])); np.savez(path, preset=preset, **d)
        g = d["groups"]; print("simulated", len(d["x"]), "frames in", round(time.time() - t0), "s; groups: one piece %.0f%% of the time, 2: %.0f%%, 3+: %.0f%%; largest share median %.2f min %.2f" % (100 * (g[:, 0] == 1).mean(), 100 * (g[:, 0] == 2).mean(), 100 * (g[:, 0] >= 3).mean(), np.median(g[:, 1]), g[:, 1].min()))
        sx, sy, _ = project(d["x"]); print("on-screen x p2 %.0f p98 %.0f, y p2 %.0f p98 %.0f (of 640x400)" % (np.percentile(sx, 2), np.percentile(sx, 98), np.percentile(sy, 2), np.percentile(sy, 98)))
    else:
        d = np.load(path); use(str(d["preset"])); R = Renderer(d["x"].shape[1])
        if mode == "sheet":
            step = int(sys.argv[4]); tiles = []
            for f in range(0, len(d["x"]), step * 25)[:20]:
                im = cv2.resize(R.frame(d["x"][f], d["e"][f], d["w"][f], d["L"][f], d["shift"][f], 960, 600), (480, 300), interpolation=cv2.INTER_AREA)
                cv2.putText(im, f"{f // 25}s", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, 255, 2); tiles.append(im)
            while len(tiles) % 5: tiles.append(np.zeros_like(tiles[0]))
            cv2.imwrite(f"{S}/elastic-sheet{seed}.png", np.concatenate([np.concatenate(tiles[r:r + 5], 1) for r in range(0, len(tiles), 5)], 0))
        elif mode == "clip":
            f0, f1, out = int(float(sys.argv[4]) * 25), int(float(sys.argv[5]) * 25), sys.argv[6]; W, H = 1280, 800; bg = background(W, H)
            p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", "25", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21", out], stdin=subprocess.PIPE)
            for f in range(f0, min(f1, len(d["x"]))): p.stdin.write(R.frame(d["x"][f], d["e"][f], d["w"][f], d["L"][f], d["shift"][f], W, H, bg).tobytes())
            p.stdin.close(); p.wait(); print("wrote", out)
