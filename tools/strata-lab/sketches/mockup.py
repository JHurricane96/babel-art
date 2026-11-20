"""Static mock-up of one Strata tableau on the default four-screen wall.

A throwaway sketch to settle the look before any real code: a dusk cross-section
with a guild town on a cliff, a sinkhole down to a fungal cavern where the
party camps, and drowned ruins under a lake. Light floods from the open sky and
from glowing things (fire, fungus, windows) through open space, is blocked by
rock, and is stepped into a few levels with an ordered dither, as pixel-art
games light their scenes. Bloom is added at screen resolution.

    python tools/strata-lab/sketches/mockup.py OUT_DIR [art_px_per_panel ...]

art_px_per_panel is the pixel-art width of one 531 mm panel (480 = 4 screen
pixels per art pixel on a 1080p panel). Writes wall-<n>.png (full wall at
1080p-per-panel screen resolution), preview-<n>.png and crop-<n>.png.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

# Default staggered wall (shared/model.js makeLayout), millimetres.
PANELS = [(0, 85), (553, 0), (0, 406), (553, 321)]
PW, PH = 531, 299
WX0, WY0, WW, WH = -6.0, -6.0, 1096.0, 717.0
SCREEN_PX_PER_MM = 1920 / PW
LEVEL = 246.0  # lake surface, mm


def hex3(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255


BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16


def hash2(ix, iy, seed):
    v = np.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453
    return v - np.floor(v)


def vnoise(x, y, seed=0):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = hash2(ix, iy, seed), hash2(ix + 1, iy, seed)
    c, d = hash2(ix, iy + 1, seed), hash2(ix + 1, iy + 1, seed)
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy


def fbm(x, y, seed=0, octaves=4):
    v, a, f = 0.0, 0.5, 1.0
    for o in range(octaves):
        v = v + a * vnoise(x * f, y * f, seed + o * 13)
        a, f = a * 0.5, f * 2.03
    return v


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


ROCKS = {
    "dusk": ("#b98a5e", "#a26f4c", "#8c5a44", "#7a5a52", "#5f5560", "#4d4a5c", "#3e3d52", "#353246"),
    "warm": ("#d9a36a", "#c98a55", "#b06e45", "#9a5a3e", "#84503c", "#6f4538", "#5a3a32", "#47302c"),
    "cold": ("#9aa3ad", "#848f9c", "#6f7b8b", "#5d6878", "#4c5666", "#3e4656", "#323947", "#282e3a"),
}
SKIES = {
    "dusk": dict(stops=("#191c3c", "#5a3f78", "#f0a060"), sun=(930, 236, 15, "#ffe3a8", "#ffb070", 0.5), stars=0.9975,
                 ridges=(("#6b4f86", 0.55), ("#3f2f5a", 0.3)), cloud=("#a77aa8", "#f4b39a"), water=("#2f6f86", "#0d2233"),
                 surf="#ffd9a8", skylight=("#ffd2b0", 1.15), ambient="#9aa0d0"),
    "day": dict(stops=("#2f6db5", "#6fa8dc", "#e6e2c6"), sun=(820, 60, 11, "#fffbe8", "#fff2c0", 0.35), stars=None,
                ridges=(("#8fa6c4", 0.5), ("#6f86a8", 0.35)), cloud=("#f4f6fa", "#c3c8d6"), water=("#3f8fb0", "#123a55"),
                surf="#e8f6ff", skylight=("#fff6e6", 1.45), ambient="#b8bcc8"),
    "night": dict(stops=("#04050c", "#0d1430", "#263060"), sun=(880, 80, 10, "#e8ecff", "#9fb0ff", 0.25), stars=0.993,
                  ridges=(("#1c2244", 0.5), ("#121734", 0.35)), cloud=("#1f2850", "#56608f"), water=("#14304a", "#050d18"),
                  surf="#9fb0e0", skylight=("#8ea0e0", 0.7), ambient="#6870a8"),
}
DEFAULTS = dict(sky="dusk", rock="dusk", cut_top=0.66, cut_bottom=0.40, cave_back=0.2, levels=5)
VARIANTS = {
    "a-dark": {},
    "b-bright": dict(cut_top=0.95, cut_bottom=0.7, cave_back=0.34),
    "c-smooth": dict(levels=0),
    "e-day-warm": dict(sky="day", rock="warm", cut_top=0.9, cut_bottom=0.6, cave_back=0.28),
    "f-night-cold": dict(sky="night", rock="cold", cut_top=0.55, cut_bottom=0.32, cave_back=0.16),
}


def render(D, out, seed=7, name=None, **opt):
    V = {**DEFAULTS, **opt}
    SK = SKIES[V["sky"]]
    name = name or str(D)
    k = D / PW  # art px per mm
    W, H = int(round(WW * k)), int(round(WH * k))
    xs = (np.arange(W) + 0.5) / k + WX0  # mm at pixel centres
    ys = (np.arange(H) + 0.5) / k + WY0
    X, Y = np.meshgrid(xs, ys)
    rng = np.random.default_rng(seed)
    px = lambda mm: int(round((mm - WX0) * k))
    py = lambda mm: int(round((mm - WY0) * k))

    # ---- Terrain: rock top height per column (mm) ----
    x = xs
    plateau = 168 + 4 * (fbm(x / 40, 0.3, 1) - 0.5)
    cliff = 168 + (300 - 168) * smooth(300, 410, x + 18 * (fbm(x / 25, 2.1, 2) - 0.5))
    ledges = 9 * np.round(3 * smooth(300, 410, x)) / 3 * (x > 300) * (x < 410)
    bed = 300 + 225 * smooth(410, 620, x) + 10 * (fbm(x / 30, 5.0, 3) - 0.5)
    top = np.where(x < 300, plateau, np.where(x < 410, cliff - ledges * 0, bed))
    top = np.where((x >= 410), bed, top)
    solid = Y > top[None, :]

    # Sinkhole shaft and cavern carved out of the rock.
    shaft_w = 20 + 5 * (fbm(Y / 30, 1.7, 4) - 0.5)
    shaft = (np.abs(X - (225 + 6 * np.sin(Y / 55))) < shaft_w) & (Y > 150) & (Y < 520)
    cx, cy, rx, ry = 255, 585, 228, 98
    edge = 1 + 0.18 * (fbm(X / 35, Y / 35, 6) - 0.5)
    cavern = (((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 < edge) & (Y < 652 + 6 * (fbm(X / 40, 9.0, 7) - 0.5))
    # A crystal geode and the guild's mine: a shaft from the town to a gallery.
    geode = ((X - 150) / 26) ** 2 + ((Y - 315) / 15) ** 2 < 1 + 0.25 * (fbm(X / 8, Y / 8, 40) - 0.5)
    mine = ((np.abs(X - 112) < 5) & (Y > 160) & (Y < 345)) | ((Y > 330) & (Y < 346) & (X > 107) & (X < 205))
    lava = ((X - 980) / 90) ** 2 + ((Y - 640) / 30) ** 2 < 1 + 0.3 * (fbm(X / 12, Y / 12, 41) - 0.5)
    solid &= ~(shaft | cavern | geode | mine | lava)
    water = (~solid) & (Y > LEVEL) & (X > 380) & (Y <= top[None, :] + 1) & ~cavern & ~shaft & ~lava
    water |= (~solid) & (Y > LEVEL) & (X > 380) & (Y < top[None, :])
    cave_air = (~solid) & (Y > top[None, :]) & ~water
    sky = (~solid) & (~cave_air) & (~water)

    # ---- Albedo of rock: strata bands, textured, darker with depth ----
    strata = [hex3(h) for h in ROCKS[V["rock"]]]
    band = np.floor((Y + 14 * np.sin(X / 75) + 8 * fbm(X / 50, Y / 50, 8) - 150) / 24).astype(int)
    band = np.clip(band, 0, len(strata) - 1)
    rock = np.stack([np.choose(band, [c[i] for c in strata]) for i in range(3)], -1)
    tex = fbm(X / 6, Y / 6, 11, 3)
    yy, xx = np.indices((H, W))
    bayer = BAYER[yy % 4, xx % 4]
    shade = np.floor((tex - 0.5) * 3 + bayer) / 3 * 0.14
    rock = np.clip(rock * (1 + shade[..., None]) * (1 + 0.12 * ((band % 2) - 0.5))[..., None], 0, 1)
    # Cave back wall: the rock behind the open space, darker and cooler.
    backwall = rock * 0.42 + hex3("#1c1a2e") * 0.25
    alb = np.where(solid[..., None], rock, backwall)

    # Outlines and lit top edges where rock meets open space.
    open_ = ~solid
    up_open = np.zeros_like(solid)
    up_open[1:] = open_[:-1]
    down_open = np.zeros_like(solid)
    down_open[:-1] = open_[1:]
    side_open = np.zeros_like(solid)
    side_open[:, 1:] |= open_[:, :-1]
    side_open[:, :-1] |= open_[:, 1:]
    surface_top = solid & up_open
    alb[solid & (down_open | side_open)] *= 0.62
    grass = surface_top & sky_above(sky, 1)
    moss = surface_top & ~grass
    alb[grass] = hex3("#6f8f3e")
    grass2 = np.zeros_like(grass)
    grass2[1:] = grass[:-1]
    alb[grass2 & solid] = hex3("#4f6b32")
    alb[moss] = rock[moss] * 1.25 + hex3("#1e3a30") * 0.2
    emis = np.zeros((H, W, 3))
    # A fossil in one band of strata.
    fx0, fy0 = 70, 430
    for i in range(26):
        xm = fx0 + i * 3.2
        ym = fy0 + 4 * math.sin(i / 4)
        alb[py(ym):py(ym) + 2, px(xm):px(xm) + 2] = hex3("#efe6cf")
        if i % 3 == 0 and i < 22:
            for r in range(1, 6):
                yy_ = py(ym + r * 1.6)
                alb[yy_, px(xm - r * 0.8)] = hex3("#d8ccb0")
    # A colossus fossilised in the strata under the lake: spine, ribs, skull.
    bone, bone_d = hex3("#e8dcc0"), hex3("#b7a888")
    def dot(xm, ym, r_mm, col):
        m = ((X - xm) ** 2 + (Y - ym) ** 2 < r_mm ** 2) & solid
        alb[m] = col
    spine = [(610 + i * 10, 585 - 22 * math.sin(i / 7) + 0.02 * i * i) for i in range(30)]
    for i, (sx_, sy_) in enumerate(spine):
        dot(sx_, sy_, 4.2 - i * 0.07, bone if i % 2 else bone_d)
        if 4 <= i <= 18 and i % 2 == 0:
            for t_ in np.linspace(0, 1, 26):
                ang = math.pi * (0.55 + 0.9 * t_)
                rx2 = sx_ + 9 * math.cos(ang) * (1 - 0.3 * t_)
                ry2 = sy_ - 26 * math.sin(ang) * -1 * t_ + 30 * t_
                dot(rx2, ry2, 1.6, bone)
    hx, hy = 600, 575
    skull = (((X - hx) / 28) ** 2 + ((Y - hy) / 17) ** 2 < 1) & solid
    jaw = (((X - (hx - 14)) / 22) ** 2 + ((Y - (hy + 12)) / 7) ** 2 < 1) & solid
    alb[skull | jaw] = bone
    alb[(((X - (hx - 8)) / 6) ** 2 + ((Y - (hy - 3)) / 5) ** 2 < 1) & solid] = hex3("#2a2633")
    for i in range(5):
        dot(hx - 30 + i * 5, hy + 10, 1.5, hex3("#f4ecd8"))
    # An older culture's wall and arch, buried under the cliff.
    for i in range(7):
        for j in range(3):
            bx0, by0 = 300 + i * 11 + (j % 2) * 5, 262 + j * 7
            m = (X > bx0) & (X < bx0 + 10) & (Y > by0) & (Y < by0 + 6) & solid
            alb[m] = hex3("#8f8aa6") * (0.85 + 0.15 * ((i + j) % 2))
    arch = (np.abs(np.hypot(X - 345, (Y - 262) * 1.3) - 22) < 3) & (Y < 262) & solid
    alb[arch] = hex3("#9d98b6")

    # Tree roots reaching into the rock under the plateau's edge.
    for xm in (268, 284, 296, 318):
        rx_, ry_ = px(xm), py(float(np.interp(xm, xs, top))) + 1
        for r in range(int(rng.integers(10, 22))):
            rx_ += int(rng.integers(-1, 2))
            if 0 <= ry_ + r < H:
                alb[ry_ + r, rx_] = hex3("#4a3426")

    # ---- Sky, far ridges, sun ----
    t = np.clip((Y + 6) / 260, 0, 1)
    skyc = np.where(
        (t < 0.55)[..., None],
        hex3(SK["stops"][0])[None, None] * (1 - t[..., None] / 0.55) + hex3(SK["stops"][1]) * (t[..., None] / 0.55),
        hex3(SK["stops"][1]) * (1 - (t[..., None] - 0.55) / 0.45) + hex3(SK["stops"][2]) * ((t[..., None] - 0.55) / 0.45),
    )
    sunx, suny, sunr, sun_col, glow_col, glow_amt = SK["sun"]
    glow = np.exp(-((X - sunx) ** 2 + ((Y - suny) * 1.8) ** 2) / (2 * 70 ** 2))
    skyc = skyc + hex3(glow_col) * glow_amt * glow[..., None]
    # Dither the gradient into bands, as pixel skies are.
    skyc = np.floor(skyc * 18 + bayer[..., None]) / 18
    stars = (hash2(xx, yy, 3) > (SK["stars"] or 2)) & (Y < (200 if V["sky"] == "night" else 120))
    skyc[stars] = hex3("#e8e4ff") * (0.6 + 0.4 * hash2(xx, yy, 4)[stars])[:, None]
    for i, (base, amp, col, mix) in enumerate(((200, 26) + SK["ridges"][0], (222, 16) + SK["ridges"][1])):
        ridge = base + amp * (fbm(X / (60 + 30 * i), 1.3 + i, 20 + i) - 0.5) * 2
        mask = sky & (Y > ridge) & (X > 300)
        skyc[mask] = skyc[mask] * mix + hex3(col) * (1 - mix)
    sun = ((X - sunx) ** 2 + (Y - suny) ** 2 < sunr ** 2) & (Y < LEVEL) & sky
    skyc[sun] = hex3(sun_col)
    clouds = np.zeros_like(sky)
    for cx_, cy_, cw_ in ((180, 60, 70), (420, 40, 50), (640, 85, 90), (820, 55, 60), (1000, 110, 45)):
        for j, (ox, oy, sc) in enumerate(((0, 0, 1.0), (-0.45, 0.25, 0.6), (0.5, 0.2, 0.55), (0.15, -0.35, 0.5))):
            lump = fbm(X / 14, Y / 9, 30 + cx_ + j) * 0.5 + 0.6
            ww = cw_ * sc
            clouds |= (((X - cx_ - ox * cw_) / ww) ** 2 + ((Y - cy_ - oy * cw_ * 0.3) / (ww * 0.32)) ** 2 < lump) & sky
    under_lit = np.roll(clouds, -3, 0) & ~clouds
    skyc[clouds] = skyc[clouds] * 0.45 + hex3(SK["cloud"][0]) * 0.55
    belly = clouds & ~np.roll(clouds, -2, 0)
    skyc[belly] = hex3(SK["cloud"][1])

    # ---- Water: reflection near the surface, depth tint below ----
    refl_y = np.clip(2 * LEVEL - Y + 3 * np.sin(X / 9 + Y / 3), WY0, LEVEL - 1)
    ry_px = np.clip(((refl_y - WY0) * k).astype(int), 0, H - 1)
    refl = skyc[ry_px, xx]
    depth = np.clip((Y - LEVEL) / 220, 0, 1)
    waterc = hex3(SK["water"][0]) * (1 - depth[..., None]) + hex3(SK["water"][1]) * depth[..., None]
    near = np.clip(1 - (Y - LEVEL) / 45, 0, 1) ** 1.5
    surf_line = water & (Y < LEVEL + 1.2 / k + 0.5)

    # ---- Town on the plateau (sizes in art px) ----
    def put(mask_fn):
        pass

    spr = np.zeros((H, W, 3))
    spr_a = np.zeros((H, W), bool)

    def rect(x0, y0, w, h, col, target=None, emissive=False):
        x0, y0 = int(x0), int(y0)
        sl = (slice(max(0, y0), min(H, y0 + h)), slice(max(0, x0), min(W, x0 + w)))
        spr[sl] = hex3(col)
        spr_a[sl] = True
        if emissive:
            emis[sl] = hex3(col)

    def ground_y(xmm):
        return py(float(np.interp(xmm, xs, top)))

    s = max(1, round(D / 480))  # sprite scale: sprites are authored at 480 px per panel
    houses = [(22, 18, 15, "#d8c9a8", "#a2463c"), (48, 22, 19, "#c7b08a", "#3f6b6e"), (78, 16, 13, "#e0d2b0", "#a2463c"),
              (104, 26, 24, "#b9a07a", "#5a4a7a"), (140, 18, 16, "#d8c9a8", "#3f6b6e"), (168, 14, 12, "#c7b08a", "#a2463c")]
    lights = []
    for xm, w, h, wall, roof in houses:
        w, h = w * s, h * s
        gx, gy = px(xm), ground_y(xm + 5)
        rect(gx, gy - h, w, h, wall)
        rect(gx, gy - h, 1, h, "#5b4636")
        rect(gx + w - 1, gy - h, 1, h, "#5b4636")
        rect(gx + w * 2 // 3, gy - h, w - w * 2 // 3, h, "#9c8a6c")
        rh = w // 2 + 2
        for r in range(rh):
            half = r + 1
            rect(gx + w // 2 - half, gy - h - rh + r, 2 * half, 1, roof)
            rect(gx + w // 2 - half, gy - h - rh + r, 1, 1, "#2a1f24")
            rect(gx + w // 2 + half - 1, gy - h - rh + r, 1, 1, "#2a1f24")
        rect(gx + w // 2 - 1 * s, gy - 5 * s, 3 * s, 5 * s, "#3b2b22")
        for wx in range(gx + 3 * s, gx + w - 4 * s, 7 * s):
            rect(wx, gy - h + 4 * s, 3 * s, 3 * s, "#ffc66b", emissive=True)
            lights.append((gy - h + 5 * s, wx + 1, 0.85))
        if w > 20 * s:
            rect(gx + w - 7 * s, gy - h - rh - 6 * s, 3 * s, 8 * s, "#6b5a50")
            for j in range(6):
                sx, sy = gx + w - 6 * s + int(3 * s * math.sin(j * 1.3)), gy - h - rh - 9 * s - j * 4 * s
                if 0 <= sy < H:
                    rect(sx, sy, 2 * s, s, "#9a92ab")
    # Street lamps along the cliff edge.
    for xm in (64, 128, 190, 262):
        gx, gy = px(xm), ground_y(xm)
        rect(gx, gy - 9 * s, s, 9 * s, "#2b2a35")
        rect(gx - s, gy - 11 * s, 3 * s, 2 * s, "#ffd27a", emissive=True)
        lights.append((gy - 10 * s, gx, 0.7))

    # Pines on the plateau's edge and the cliff ledges.
    def pine(xm, hgt):
        gx, gy = px(xm), ground_y(xm)
        hgt *= s
        rect(gx, gy - 4 * s, s, 4 * s, "#3b2b22")
        for r in range(hgt):
            half = int((r / hgt) * hgt * 0.32) + 1
            col = "#2f4a35" if (r // (3 * s)) % 2 else "#253c2d"
            rect(gx - half + 1, gy - 4 * s - hgt + r, 2 * half - 1, 1, col)

    for xm, hgt in ((268, 20), (284, 14), (296, 24), (318, 12), (345, 16), (372, 11)):
        pine(xm, hgt)

    # ---- Mine and geode ----
    for yl in range(py(170), py(340), 3 * s):
        rect(px(108), yl, 7 * s, s, "#7a5a3a")
    rect(px(108), py(170), s, py(340) - py(170), "#5b4330")
    rect(px(116), py(170), s, py(340) - py(170), "#5b4330")
    lx, ly = px(185), py(334)
    rect(lx, ly, 2 * s, 3 * s, "#ffcf70", emissive=True)
    lights.append((ly + s, lx, 0.8))
    miner = ["..ooo..", ".oyyyo.", "..off..", ".occco.", "occccco", "..obo..", ".ob.bo."]
    mcol = {"o": "#16121c", "y": "#e0b23a", "f": "#f0c9a0", "c": "#7a6a5a", "b": "#3a2e2a"}
    mx, my = px(160), py(345) - len(miner) * s
    for r, row in enumerate(miner):
        for c, ch in enumerate(row):
            if ch != ".":
                rect(mx + c * s, my + r * s, s, s, mcol[ch])
    rect(mx + 7 * s, my + 2 * s, s, 4 * s, "#8a7a6a")
    rect(mx + 6 * s, my + s, 3 * s, s, "#b0b0b8")
    crystals = []
    gcells = np.argwhere(geode & ~np.roll(geode, -2, 0))
    for (gy_, gx_) in gcells[:: max(1, len(gcells) // 22)]:
        hgt = int(rng.integers(2, 6)) * s
        rect(gx_, gy_ - hgt + 1, s, hgt, "#d7b4ff", emissive=True)
        crystals.append((gy_ - hgt // 2, gx_, 0.7))

    # ---- Cavern: stalactites, mushrooms, fungus, camp ----
    cave_cols = np.where(cavern.any(0))[0]
    for c in rng.choice(cave_cols, size=len(cave_cols) // 9, replace=False):
        rows = np.where(cave_air[:, c])[0]
        if not len(rows):
            continue
        r0 = rows[0]
        if r0 < py(470):
            continue
        L = int(rng.integers(3, 12)) * s
        for r in range(L):
            wdt = max(1, int((1 - r / L) * 2 * s))
            alb[r0 + r, c - wdt // 2:c - wdt // 2 + wdt] = rock[r0 + r, c] * 0.8
            solid[r0 + r, c - wdt // 2:c - wdt // 2 + wdt] = True
    floor_y = lambda xm: next(r for r in range(H - 1, 0, -1) if cave_air[r, px(xm)]) + 1
    fungus = []
    warm = []
    for xm, sh, cw, cap in ((70, 34, 30, "#3d6f7a"), (120, 22, 20, "#5a4a8a"), (405, 40, 36, "#3d6f7a"), (452, 26, 22, "#5a4a8a")):
        gx, gy = px(xm), floor_y(xm)
        sh, cw = sh * s, cw * s
        rect(gx - 2 * s, gy - sh, 4 * s, sh, "#b7a9c9")
        rect(gx - 2 * s, gy - sh, s, sh, "#8d80a6")
        ch = cw // 3
        for r in range(ch):
            half = int(cw / 2 * math.sqrt(1 - ((ch - r) / ch) ** 2))
            rect(gx - half, gy - sh - ch + r, 2 * half, 1, cap)
        for j in range(6):
            sx = gx - cw // 2 + 3 * s + int(rng.integers(0, max(1, cw - 6 * s)))
            sy = gy - sh - int(rng.integers(1, max(2, ch)))
            rect(sx, sy, s, s, "#9ff7ea", emissive=True)
            fungus.append((sy, sx, 0.55))
        rect(gx - cw // 2, gy - sh - 1, cw, 1, "#bff9f0", emissive=True)
        fungus.append((gy - sh, gx, 1.0))
    floor_cells = [(floor_y(xm) - 1, px(xm)) for xm in rng.uniform(40, 470, 40)]
    for fy, fx in floor_cells:
        rect(fx, fy - s, s, s, "#7ff0e0", emissive=True)
        fungus.append((fy, fx, 0.35))
    # Glow-worms hanging from the cavern ceiling, like a starfield underground.
    ceil_cells = np.argwhere(cave_air & np.roll(solid, 1, 0) & (Y > 470) & (Y < 600))
    for (cy2, cx2) in ceil_cells[rng.choice(len(ceil_cells), size=min(len(ceil_cells), 140), replace=False)]:
        L_ = int(rng.integers(1, 7)) * s
        rect(cx2, cy2, 1, L_, "#2c4a55")
        rect(cx2, cy2 + L_, s, s, "#a6fff4", emissive=True)
        if rng.random() < 0.25:
            fungus.append((cy2 + L_, cx2, 0.25))
    # Lava deep in the rock.
    lava_cells = np.argwhere(lava)
    for (ly2, lx2) in lava_cells:
        h_ = hash2(lx2, ly2, 9)
        col = "#ffd36b" if h_ > 0.85 else ("#ff7a2a" if h_ > 0.3 else "#c2361e")
        emis[ly2, lx2] = hex3(col)
        alb[ly2, lx2] = hex3(col)
    for (ly2, lx2) in lava_cells[:: max(1, len(lava_cells) // 12)]:
        warm.append((ly2, lx2, 1.0))
    # A climber halfway down a rope in the sinkhole.
    rope_x = px(232)
    rect(rope_x, py(160), s, py(470) - py(160), "#a8906a")
    climber = ["..ooo..", ".ohhho.", "..off..", "foccco.", ".occcof", "..obo..", "..ob.o.", ".ob..o."]
    ccol = {"o": "#16121c", "h": "#2f6a8a", "f": "#f0c9a0", "c": "#d07a3a", "b": "#3a2e2a"}
    for r, row in enumerate(climber):
        for c, ch in enumerate(row):
            if ch != ".":
                rect(rope_x - 3 * s + c * s, py(330) + r * s, s, s, ccol[ch])
    rect(rope_x + 3 * s, py(330) + 2 * s, 2 * s, 2 * s, "#ffcf70", emissive=True)
    lights.append((py(330) + 3 * s, rope_x + 4 * s, 0.6))

    # Camp: tent, fire, three adventurers.
    camp = 255
    gx, gy = px(camp), floor_y(camp)
    th = 12 * s
    for r in range(th):
        half = 2 + int(r * 1.1)
        rect(gx - 24 * s - half, gy - th + r, 2 * half, 1, "#c9a46a" if (r // 2) % 3 else "#a8844f")
    rect(gx - 24 * s - 1, gy - 6 * s, 3, 6 * s, "#3b2b22")
    rect(gx - 2 * s, gy - 3 * s, 4 * s, 2 * s, "#ff9a3c", emissive=True)
    rect(gx - s, gy - 5 * s, 2 * s, 2 * s, "#ffd36b", emissive=True)
    rect(gx - 3 * s, gy - s, 6 * s, s, "#5b3a22")
    warm.append((gy - 3 * s, gx, 1.6))
    hero = ["...ooo...", "..ohhho..", ".ohhhhho.", "..offfo..", "..offfo..", ".occccco.", "ocfcccfco", "ocfcccfco", "o.occco.o", "..obbbo..", "..ob.bo..", "..ob.bo..", ".obb.bbo."]
    for dx, (hat, cloak) in zip((-12, 9, 17), (("#8a3b3b", "#c46a3a"), ("#3b5a8a", "#4f8a6a"), ("#6a4a8a", "#d8b45a"))):
        cols = {"h": hat, "f": "#f0c9a0", "c": cloak, "b": "#3a2e2a", "o": "#16121c"}
        for r, row in enumerate(hero):
            for c, ch in enumerate(row):
                if ch != ".":
                    rect(gx + dx * s + c * s - 4 * s, gy - len(hero) * s + r * s, s, s, cols[ch])
    # Vines down the shaft.
    for xm in (209, 241):
        top_r = ground_y(xm)
        L = int(rng.integers(30, 60)) * s
        cxp = px(xm)
        for r in range(L):
            c = cxp + int(2 * math.sin(r / 7))
            if 0 <= top_r + r < H and not solid[top_r + r, c]:
                rect(c, top_r + r, s, 1, "#4f7a3a")

    # ---- Drowned ruins in the lake ----
    ruin = np.zeros((H, W), bool)
    for xm in (650, 712, 774, 836, 898, 960):
        bx = px(xm)
        by = py(525)
        hgt = int((120 + 40 * math.sin(xm)) * k)
        ruin[by - hgt:by, bx - 3 * s:bx + 3 * s] = True
        ruin[by - hgt:by - hgt + 2 * s, bx - 5 * s:bx + 5 * s] = True
    for a, b in ((650, 712), (712, 774), (836, 898)):
        x0, x1 = px(a), px(b)
        r_ = (x1 - x0) / 2
        cxr, cyr = (x0 + x1) / 2, py(410)
        ang = np.linspace(math.pi, 2 * math.pi, 200)
        for th in range(3 * s):
            ax = (cxr + (r_ + th) * np.cos(ang)).astype(int)
            ay = (cyr + (r_ * 0.7 + th) * np.sin(ang)).astype(int)
            ruin[np.clip(ay, 0, H - 1), np.clip(ax, 0, W - 1)] = True
    bell_x, bell_y = px(743), py(420)
    for r in range(9 * s):
        half = int(2 * s + r * 0.45)
        ruin[bell_y + r, bell_x - half:bell_x + half] = True
    ruinc = hex3("#c9c2b0") * (0.7 + 0.3 * tex[..., None])
    bellmask = np.zeros_like(ruin)
    bellmask[bell_y:bell_y + 9 * s, bell_x - 7 * s:bell_x + 7 * s] = True
    ruin &= water

    # ---- Lighting: flood from sources through open space ----
    trans = (~solid) | ruin

    def flood(src, decay_mm, water_decay_mm=None):
        L = src.copy()
        per = 1 / (decay_mm * k)
        dec = np.where(water & ~ruin, 1 / ((water_decay_mm or decay_mm) * k), per)
        peak = float(src.max()) if src.size else 1.0
        iters = int(decay_mm * k * peak * 1.5) + 2
        if water_decay_mm:
            iters = max(iters, int(water_decay_mm * k * peak * 1.1) + 2)
        moves = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)]
        for _ in range(iters):
            n = L.copy()
            for dy, dx, c in moves:
                sh = np.roll(np.roll(L, dy, 0), dx, 1)
                n = np.maximum(n, sh - dec * c)
            L = np.where(trans, n, L)
        # Light reaches a few pixels into rock faces, so they read as lit surfaces.
        lit = L.copy()
        inner = np.where(trans, L, 0.0)
        for depth in range(4):
            nb = inner.copy()
            for dy, dx, c in moves[:4]:
                nb = np.maximum(nb, np.roll(np.roll(inner, dy, 0), dx, 1))
            inner = np.where(trans, inner, nb * 0.78)
        lit = np.where(trans, L, inner)
        # Round off the octagonal shapes of the flood.
        im = Image.fromarray(np.clip(lit * 120, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6 * k * 2))
        return np.asarray(im, float) / 120

    def point_lights(srcs, R_mm, reach):
        L = np.zeros((H, W))
        for y_, x_, a in srcs:
            R = R_mm * k * (0.6 + 0.6 * a)
            y0, y1 = max(0, int(y_ - R)), min(H, int(y_ + R) + 1)
            x0, x1 = max(0, int(x_ - R)), min(W, int(x_ + R) + 1)
            d = np.hypot(yy[y0:y1, x0:x1] - y_, xx[y0:y1, x0:x1] - x_)
            f = np.clip(1 - d / R, 0, 1) ** 1.6 * (0.6 + 0.8 * a)
            L[y0:y1, x0:x1] = np.maximum(L[y0:y1, x0:x1], f)
        return L * reach

    sky_src = np.where(sky, SK["skylight"][1], 0.0)
    Ls = flood(sky_src, 120, water_decay_mm=420)
    warm_src = np.zeros((H, W))
    for y_, x_, a in lights + warm:
        if 0 <= y_ < H and 0 <= x_ < W:
            warm_src[y_, x_] = max(warm_src[y_, x_], a)
    Lw = point_lights(lights + warm, 60, flood(warm_src, 60) > 0.02)
    cyan_src = np.zeros((H, W))
    for y_, x_, a in fungus:
        if 0 <= y_ < H and 0 <= x_ < W:
            cyan_src[y_, x_] = max(cyan_src[y_, x_], a)
    Lc = point_lights(fungus, 42, flood(cyan_src, 42) > 0.02)
    violet_src = np.zeros((H, W))
    for y_, x_, a in crystals:
        violet_src[y_, x_] = a
    Lv = point_lights(crystals, 30, flood(violet_src, 30) > 0.02)

    def step(L, levels=None):
        levels = V["levels"] if levels is None else levels
        if not levels:
            return np.clip(L, 0, 1.6)
        return np.floor(np.clip(L, 0, 1.6) * levels + bayer) / levels

    # The cross-section is cut open toward the viewer: the rock body carries a
    # faint, cool cut-away light so its strata stay readable, fading with depth.
    cut = np.where(solid, V["cut_top"] - (V["cut_top"] - V["cut_bottom"]) * np.clip((Y - 170) / 520, 0, 1), V["cave_back"])
    light = (step(Ls)[..., None] * hex3(SK["skylight"][0]) + step(Lw)[..., None] * hex3("#ffae5a") * 1.1
             + step(Lc)[..., None] * hex3("#5ff0e0") * 0.9 + step(Lv)[..., None] * hex3("#c08cff") * 0.9
             + cut[..., None] * hex3(SK["ambient"]))
    img = alb * light

    # Water and ruins seen through it.
    img_r = ruinc * light * np.where(bellmask, 1.0, 1.0)[..., None]
    img_r[bellmask & ruin] = hex3("#c89b3c") * light[bellmask & ruin]
    u = X + (Y - LEVEL) * 0.45
    rays = np.clip(fbm(u / 22, 0.5, 50, 2) * 2.2 - 1.15, 0, 1) * np.clip(1 - (Y - LEVEL) / 260, 0, 1)
    rays = np.floor(rays * 3 + bayer) / 3 * 0.18
    under = np.where(ruin[..., None], img_r * 0.55 + waterc * 0.45, waterc * (0.35 + 0.65 * step(Ls, 6)[..., None]))
    under = under + rays[..., None] * hex3("#9fe0d0")
    wimg = under * (1 - near[..., None] * 0.75) + refl * near[..., None] * 0.75
    img = np.where(water[..., None], wimg, img)
    img[surf_line] = hex3(SK["surf"]) * 0.85
    img = np.where(sky[..., None], skyc, img)
    for xm, ym in ((600, 300), (612, 306), (700, 370), (880, 330), (893, 336), (905, 330), (960, 450)):
        fx_, fy_ = px(xm), py(ym)
        img[fy_:fy_ + s, fx_:fx_ + 3 * s] = hex3("#e8a060")
        img[fy_ - s:fy_ + 2 * s, fx_ + 3 * s:fx_ + 4 * s] = hex3("#c07840")
    for xm in rng.uniform(560, 1080, 30):
        bx_, by_ = px(xm), py(float(np.interp(xm, xs, top)))
        for r in range(int(rng.integers(6, 22)) * s):
            c_ = bx_ + int(1.5 * math.sin(r / 4 + xm))
            if 0 <= by_ - r < H and water[by_ - r, c_]:
                img[by_ - r, c_] = hex3("#3f7a5a") * 0.8
    sprite_light = np.maximum(light, 0.32)
    img = np.where(spr_a[..., None], spr * sprite_light, img)
    em = emis.max(-1) > 0
    img[em] = emis[em]
    img = np.clip(img, 0, 1)

    # ---- To screen: nearest-neighbour upscale, bloom, panels ----
    S = SCREEN_PX_PER_MM / k
    SW, SH = int(round(WW * SCREEN_PX_PER_MM)), int(round(WH * SCREEN_PX_PER_MM))
    art = Image.fromarray((img * 255).astype(np.uint8))
    screen = art.resize((SW, SH), Image.NEAREST)
    bright = np.clip(np.maximum(emis.max(-1, keepdims=True) * emis, 0), 0, 1)
    sun_b = np.zeros_like(img)
    sun_b[sun] = hex3("#ffd9a0")
    bloom_src = Image.fromarray(((bright + sun_b * 0.8) * 255).astype(np.uint8)).resize((SW, SH), Image.NEAREST)
    bloom = np.asarray(bloom_src.filter(ImageFilter.GaussianBlur(radius=10 * S / 4)), float) / 255
    bloom2 = np.asarray(bloom_src.filter(ImageFilter.GaussianBlur(radius=40 * S / 4)), float) / 255
    out_img = np.asarray(screen, float) / 255 + bloom * 0.55 + bloom2 * 0.35
    out_img = np.clip(out_img, 0, 1)
    mask = np.zeros((SH, SW), bool)
    for x0, y0 in PANELS:
        a, b = int(round((x0 - WX0) * SCREEN_PX_PER_MM)), int(round((y0 - WY0) * SCREEN_PX_PER_MM))
        mask[b:b + 1080, a:a + 1920] = True
    out_img[~mask] = 0.02
    final = Image.fromarray((out_img * 255).astype(np.uint8))
    os.makedirs(out, exist_ok=True)
    final.save(f"{out}/wall-{name}.png")
    final.resize((1600, int(1600 * SH / SW)), Image.LANCZOS).save(f"{out}/preview-{name}.png")
    # A 1:1 crop of screen pixels around the camp, as on a real 1080p panel.
    cxs, cys = int((camp - WX0) * SCREEN_PX_PER_MM), int((600 - WY0) * SCREEN_PX_PER_MM)
    final.crop((cxs - 700, cys - 420, cxs + 700, cys + 280)).save(f"{out}/crop-{name}.png")
    print(name, "art", W, "x", H, "screen", SW, "x", SH)


def sky_above(sky, n):
    above = np.zeros_like(sky)
    above[n:] = sky[:-n]
    return above


if __name__ == "__main__":
    # mockup.py OUT 320 480 640      pixel sizes, default look
    # mockup.py OUT --variants       the look variants at 480
    out = sys.argv[1]
    if "--variants" in sys.argv:
        for name, opt in VARIANTS.items():
            render(480, out, name=name, **opt)
    else:
        for D in [int(v) for v in sys.argv[2:]] or [480]:
            render(D, out)
