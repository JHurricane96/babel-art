"""Motion test: 20 seconds of the cavern panel, to judge seconds-scale life
and whether stepped, dithered light shimmers when lights flicker or move.

    python tools/strata-lab/sketches/motion.py OUT_DIR [seconds] [--smooth | --calm] [--tag NAME]

--smooth draws light without steps; --calm keeps the steps but changes the
fire's light only 4 times a second, so stepped edges jump instead of crawl.

Renders one 1080p panel (480 x 270 art pixels, 4 x 4 screen pixels each) at
30 fps into OUT_DIR/frames-NAME/, encodes OUT_DIR/cavern-NAME.mp4 with ffmpeg,
and prints how many art pixels change per frame where nothing moving was drawn:
those changes come from the light alone (flicker crossing a step, dither
crawl). Light A from the mock-up: dark cut-away rock, stepped light.
"""
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mockup import BAYER, fbm, hash2, hex3  # noqa: E402

W, H, S = 480, 270, 4  # art pixels, screen pixels per art pixel
FPS = 30
K = 480 / 531  # art px per mm, as in the mock-up


def build():
    rng = np.random.default_rng(3)
    yy, xx = np.indices((H, W))
    X, Y = xx.astype(float), yy.astype(float)
    # Cavern, floor, the sinkhole shaft coming down from above.
    edge = 1 + 0.18 * (fbm(X / 32, Y / 32, 6) - 0.5)
    cav = (((X - 236) / 222) ** 2 + ((Y - 168) / 92) ** 2 < edge) & (Y < 230 + 5 * (fbm(X / 36, 9.0, 7) - 0.5))
    shaft = (np.abs(X - (196 + 5 * np.sin(Y / 50))) < 17 + 4 * (fbm(Y / 27, 1.7, 4) - 0.5)) & (Y < 120)
    open_ = cav | shaft
    solid = ~open_
    # Stalactites.
    for c in rng.choice(np.where(cav.any(0))[0], 60, replace=False):
        rows = np.where(cav[:, c])[0]
        if len(rows) and rows[0] > 70:
            L = int(rng.integers(3, 11))
            for r in range(L):
                w = max(1, int((1 - r / L) * 2))
                solid[rows[0] + r, c - w // 2:c - w // 2 + w] = True
    open_ = ~solid
    # Rock albedo: strata bands, texture, outlines.
    strata = [hex3(h) for h in ("#7a5a52", "#5f5560", "#4d4a5c", "#3e3d52", "#353246", "#2e2b3e")]
    band = np.clip(((Y + 12 * np.sin(X / 68) + 8 * fbm(X / 45, Y / 45, 8) + 20) / 46).astype(int), 0, 5)
    rock = np.stack([np.choose(band, [c[i] for c in strata]) for i in range(3)], -1)
    bay = BAYER[yy % 4, xx % 4]
    tex = fbm(X / 5.4, Y / 5.4, 11, 3)
    rock = np.clip(rock * (1 + (np.floor((tex - 0.5) * 3 + bay) / 3 * 0.14))[..., None]
                   * (1 + 0.12 * ((band % 2) - 0.5))[..., None], 0, 1)
    back = rock * 0.42 + hex3("#1c1a2e") * 0.25
    alb = np.where(solid[..., None], rock, back)
    up_open = np.zeros_like(solid)
    up_open[1:] = open_[:-1]
    edge_px = solid & (np.roll(open_, 1, 1) | np.roll(open_, -1, 1) | np.roll(open_, -1, 0))
    alb[edge_px & ~up_open] *= 0.62
    alb[solid & up_open] = rock[solid & up_open] * 1.25 + hex3("#1e3a30") * 0.2
    floor = np.array([max([r for r in range(H) if open_[r, x]] or [0]) for x in range(W)])
    return dict(rng=rng, X=X, Y=Y, xx=xx, yy=yy, solid=solid, open=open_, cav=cav, alb=alb, bay=bay, floor=floor)


def flood(src, trans, decay_px):
    L = src.copy()
    moves = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)]
    for _ in range(int(decay_px * float(src.max()) * 1.5) + 2):
        n = L.copy()
        for dy, dx, c in moves:
            n = np.maximum(n, np.roll(np.roll(L, dy, 0), dx, 1) - c / decay_px)
        L = np.where(trans, n, L)
    inner = np.where(trans, L, 0.0)
    for _ in range(4):
        nb = inner.copy()
        for dy, dx, _c in moves[:4]:
            nb = np.maximum(nb, np.roll(np.roll(inner, dy, 0), dx, 1))
        inner = np.where(trans, inner, nb * 0.78)
    out = np.where(trans, L, inner)
    im = Image.fromarray(np.clip(out * 120, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.9))
    return np.asarray(im, float) / 120


def point(L, reach, yy, xx, y, x, a, R_mm):
    R = R_mm * K * (0.6 + 0.6 * a)
    y0, y1, x0, x1 = max(0, int(y - R)), min(H, int(y + R) + 1), max(0, int(x - R)), min(W, int(x + R) + 1)
    d = np.hypot(yy[y0:y1, x0:x1] - y, xx[y0:y1, x0:x1] - x)
    f = np.clip(1 - d / R, 0, 1) ** 1.6 * (0.6 + 0.8 * a) * reach[y0:y1, x0:x1]
    L[y0:y1, x0:x1] = np.maximum(L[y0:y1, x0:x1], f)


HERO = ["...ooo...", "..ohhho..", ".ohhhhho.", "..offfo..", "..offfo..", ".occccco.", "ocfcccfco", "ocfcccfco",
        "o.occco.o", "..obbbo..", "..ob.bo..", "..ob.bo..", ".obb.bbo."]
HERO_WALK = HERO[:10] + ["..obbo...", "..ob.bo..", ".obb..bo."]
GRAZER = [[".....oo......", "....oeeo.....", "oooooeeoooo..", "obbbbbbbbbbo.", ".obbbbbbbbbo.", "..o.o...o.o..",
           "..o.o...o.o..", ".o..o..o..o..", ".o...o.o...o."],
          [".....oo......", "....oeeo.....", "oooooeeoooo..", "obbbbbbbbbbo.", ".obbbbbbbbbo.", "..o.o...o.o..",
           "...oo....oo..", "...o.o...o.o.", "..o..o..o..o."]]
CLIMBER = ["..ooo..", ".ohhho.", "..off..", "foccco.", ".occcof", "..obo..", "..ob.o.", ".ob..o."]


def blit(spr, spr_a, tmpl, cols, x, y, flip=False):
    for r, row in enumerate(tmpl):
        row = row[::-1] if flip else row
        for c, ch in enumerate(row):
            if ch != "." and 0 <= y + r < H and 0 <= x + c < W:
                spr[y + r, x + c] = hex3(cols[ch])
                spr_a[y + r, x + c] = True


def main():
    out = sys.argv[1]
    secs = float(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else 20
    smooth = "--smooth" in sys.argv
    calm = "--calm" in sys.argv
    tag = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else ("smooth" if smooth else "calm" if calm else "stepped")
    B = build()
    rng, X, Y, xx, yy, open_, alb, bay, floor = B["rng"], B["X"], B["Y"], B["xx"], B["yy"], B["open"], B["alb"], B["bay"], B["floor"]
    reach = np.asarray(Image.fromarray(open_.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(9)), bool)

    # Static light: the sky down the shaft, mushrooms and glow-worms.
    sky_src = np.zeros((H, W))
    sky_src[0, :] = np.where(open_[0], 1.15, 0)
    Ls = flood(sky_src, open_, 120 * K)
    mush = [(26, 30, 26, "#3d6f7a"), (68, 20, 18, "#5a4a8a"), (372, 36, 32, "#3d6f7a"), (414, 24, 20, "#5a4a8a")]
    static_spr = np.zeros((H, W, 3))
    static_a = np.zeros((H, W), bool)
    static_em = np.zeros((H, W, 3))
    Lc = np.zeros((H, W))
    for x, sh, cw, cap in mush:
        gy = floor[x] + 1
        static_spr[gy - sh:gy, x - 2:x + 2] = hex3("#b7a9c9")
        static_spr[gy - sh:gy, x - 2:x - 1] = hex3("#8d80a6")
        static_a[gy - sh:gy, x - 2:x + 2] = True
        ch = cw // 3
        for r in range(ch):
            half = int(cw / 2 * math.sqrt(1 - ((ch - r) / ch) ** 2))
            static_spr[gy - sh - ch + r, x - half:x + half] = hex3(cap)
            static_a[gy - sh - ch + r, x - half:x + half] = True
        static_em[gy - sh - 1, x - cw // 2:x + cw // 2] = hex3("#bff9f0")
        point(Lc, reach, yy, xx, gy - sh, x, 1.0, 42)
        for j in range(6):
            sx, sy = x - cw // 2 + 3 + int(rng.integers(0, max(1, cw - 6))), gy - sh - int(rng.integers(1, max(2, ch)))
            static_em[sy, sx] = hex3("#9ff7ea")
    worms = []
    ceil = np.argwhere(open_ & np.roll(~open_, 1, 0) & (Y > 70) & (Y < 150) & B["cav"])
    for (cy, cx) in ceil[rng.choice(len(ceil), 120, replace=False)]:
        L_ = int(rng.integers(1, 7))
        static_spr[cy:cy + L_, cx] = hex3("#2c4a55")
        static_a[cy:cy + L_, cx] = True
        worms.append((cy + L_, cx, rng.uniform(0, 6.28), rng.uniform(0.4, 1.3)))
        if rng.random() < 0.25:
            point(Lc, reach, yy, xx, cy + L_, cx, 0.25, 42)
    floor_glow = [(floor[x], x) for x in rng.integers(20, 460, 40)]
    for fy, fx in floor_glow:
        static_em[fy, fx] = hex3("#7ff0e0")
        point(Lc, reach, yy, xx, fy, fx, 0.35, 42)
    # Tent.
    camp = 230
    fy0 = floor[camp] + 1
    for r in range(12):
        half = 2 + int(r * 1.1)
        static_spr[fy0 - 12 + r, camp - 24 - half:camp - 24 + half] = hex3("#c9a46a" if (r // 2) % 3 else "#a8844f")
        static_a[fy0 - 12 + r, camp - 24 - half:camp - 24 + half] = True
    static_spr[fy0 - 6:fy0, camp - 25:camp - 22] = hex3("#3b2b22")

    def step(L, levels=5):
        if smooth:
            return np.clip(L, 0, 1.6)
        return np.floor(np.clip(L, 0, 1.6) * levels + bay) / levels

    cut = np.where(~open_, 0.66 - 0.26 * np.clip(Y / 270, 0, 1) * 0.6, 0.2)
    base_light = step(Ls)[..., None] * hex3("#ffd2b0") + step(Lc)[..., None] * hex3("#5ff0e0") * 0.9 + cut[..., None] * hex3("#9aa0d0")

    spores = [(rng.uniform(10, 470), rng.uniform(60, 230), rng.uniform(0, 1), rng.uniform(4, 9)) for _ in range(70)]
    frames = int(secs * FPS)
    fdir = f"{out}/frames-{tag}"
    os.makedirs(fdir, exist_ok=True)
    prev, prev_moving, changes = None, None, []
    rope_x = 197
    for n in range(frames):
        t = n / FPS
        spr = static_spr.copy()
        spr_a = static_a.copy()
        em = static_em.copy()
        warm = np.zeros((H, W))
        # Fire: flicker as a smooth sum of three slow waves.
        tf = math.floor(t * 4) / 4 if calm else t  # calm: the fire's light changes 4 times a second
        flick = 0.82 + 0.1 * math.sin(tf * 7.3) + 0.06 * math.sin(tf * 13.1 + 1) + 0.04 * math.sin(tf * 23.7 + 2)
        point(warm, reach, yy, xx, fy0 - 3, camp, 1.6 * flick, 60)
        em[fy0 - 3:fy0 - 1, camp - 2:camp + 2] = hex3("#ff9a3c")
        tip = 2 + int(1.5 + 1.5 * math.sin(t * 11))
        em[fy0 - 3 - tip:fy0 - 3, camp - 1:camp + 1] = hex3("#ffd36b")
        spr[fy0 - 1, camp - 3:camp + 3] = hex3("#5b3a22")
        spr_a[fy0 - 1, camp - 3:camp + 3] = True
        for j in range(5):  # sparks
            age = (t * 0.9 + j * 0.21) % 1
            sx = camp + int(4 * math.sin(j * 2.3 + t * 3))
            sy = fy0 - 6 - int(age * 30)
            if age < 0.8:
                em[sy, sx] = hex3("#ffb04a")
        # Party: the cook stirs, the sharpener's blade sparks, the third paces.
        cols = [{"h": "#8a3b3b", "f": "#f0c9a0", "c": "#c46a3a", "b": "#3a2e2a", "o": "#16121c"},
                {"h": "#3b5a8a", "f": "#f0c9a0", "c": "#4f8a6a", "b": "#3a2e2a", "o": "#16121c"},
                {"h": "#6a4a8a", "f": "#f0c9a0", "c": "#d8b45a", "b": "#3a2e2a", "o": "#16121c"}]
        bob = int((t * 1.3) % 2 < 1)
        blit(spr, spr_a, HERO, cols[0], camp - 16, fy0 - 13 + (bob if n % 60 < 30 else 0), flip=False)
        stir = int(t * 3) % 2
        spr[fy0 - 6, camp - 8 + stir] = hex3("#8a6a4a")
        spr_a[fy0 - 6, camp - 8 + stir] = True
        blit(spr, spr_a, HERO, cols[1], camp + 6, fy0 - 13, flip=True)
        if int(t * 2.5) % 3 == 0:
            em[fy0 - 7, camp + 5] = hex3("#fff2b0")
        pace = 20 * math.sin(t * 0.35)
        walking = abs(math.cos(t * 0.35)) > 0.3
        frame = HERO_WALK if (walking and int(t * 6) % 2) else HERO
        blit(spr, spr_a, frame, cols[2], camp + 22 + int(pace), fy0 - 13, flip=math.cos(t * 0.35) < 0)
        # Grazer wanders in from the left, pauses by a mushroom, moves on.
        gx = -14 + 8 * t if t < 9 else (58 if t < 13 else 58 + 8 * (t - 13))
        gframe = GRAZER[int(t * 5) % 2] if (t < 9 or t >= 13) else GRAZER[0]
        gyy = floor[int(np.clip(gx + 6, 0, W - 1))] + 1 - 9
        blit(spr, spr_a, gframe, {"o": "#1a1626", "b": "#b9a6d6", "e": "#8ff7ff"}, int(gx), int(gyy))
        # Climber with a lantern descends the rope.
        cy = int(10 + 6.5 * t)
        spr[0:min(H, 140), rope_x] = hex3("#a8906a")
        spr_a[0:min(H, 140), rope_x] = True
        blit(spr, spr_a, CLIMBER, {"o": "#16121c", "h": "#2f6a8a", "f": "#f0c9a0", "c": "#d07a3a", "b": "#3a2e2a"}, rope_x - 3, cy)
        lx, ly = rope_x + 4 + int(1.5 * math.sin(t * 2.1)), cy + 3
        em[ly:ly + 2, lx:lx + 2] = hex3("#ffcf70")
        point(warm, reach, yy, xx, ly + 1, lx, 0.6, 60)
        # Glow-worms twinkle, spores drift up, a drip falls every 3 seconds.
        for (wy, wx, ph, sp) in worms:
            v = 0.55 + 0.45 * math.sin(t * sp + ph)
            em[wy, wx] = hex3("#a6fff4") * (0.45 + 0.55 * round(v * 3) / 3)
        for (sx0, sy0, ph, sp) in spores:
            yy_s = sy0 - ((t * sp + ph * 200) % 170)
            if yy_s < 50:
                yy_s += 170
            xs_ = int(sx0 + 3 * math.sin(t * 0.8 + ph * 6))
            ys_ = int(yy_s)
            if 0 <= ys_ < H and 0 <= xs_ < W and open_[ys_, xs_]:
                em[ys_, xs_] = hex3("#7fe8d8") * 0.7
        dt = t % 3
        drip_x = 300
        if dt < 1.2:
            dy_ = int(80 + dt * dt * 90)
            if dy_ < floor[drip_x]:
                spr[dy_, drip_x] = hex3("#9fd8ff")
                spr_a[dy_, drip_x] = True
            else:
                spr[floor[drip_x] - 1, drip_x - 1:drip_x + 2] = hex3("#9fd8ff")
                spr_a[floor[drip_x] - 1, drip_x - 1:drip_x + 2] = True

        light = base_light + step(warm)[..., None] * hex3("#ffae5a") * 1.1
        img = alb * light
        img = np.where(spr_a[..., None], spr * np.maximum(light, 0.32), img)
        emm = em.max(-1) > 0
        img[emm] = em[emm]
        img = np.clip(img, 0, 1)
        art8 = (img * 255).astype(np.uint8)
        moving = spr_a | emm
        if prev is not None:
            still = ~(moving | prev_moving)
            diff = np.any(art8 != prev, -1) & still
            changes.append(diff.mean())
        prev, prev_moving = art8, moving
        screen = Image.fromarray(art8).resize((W * S, H * S), Image.NEAREST)
        bsrc = Image.fromarray((np.clip(em, 0, 1) * 255).astype(np.uint8)).resize((W * S, H * S), Image.NEAREST)
        b1 = np.asarray(bsrc.filter(ImageFilter.GaussianBlur(10)), float) / 255
        b2 = np.asarray(bsrc.filter(ImageFilter.GaussianBlur(40)), float) / 255
        frame_img = np.clip(np.asarray(screen, float) / 255 + b1 * 0.55 + b2 * 0.35, 0, 1)
        Image.fromarray((frame_img * 255).astype(np.uint8)).save(f"{fdir}/f{n:04d}.png")
        if n % 150 == 0:
            print("frame", n, flush=True)
    ch = np.array(changes)
    print(f"{tag}: art pixels changing per frame where nothing moving was drawn: mean {ch.mean() * 100:.3f}%, "
          f"95th percentile {np.percentile(ch, 95) * 100:.3f}%, max {ch.max() * 100:.3f}%")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", f"{fdir}/f%04d.png",
                    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", f"{out}/cavern-{tag}.mp4"], check=True)


if __name__ == "__main__":
    main()
