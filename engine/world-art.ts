import { ink } from "./art";
import { rng } from "./types";
import type { Platform, Platformer, Flock } from "./entities";
const TAU = Math.PI * 2;
export const biomeNames = ["Glasswood", "Amber ruins", "Tidal observatory"];
const palettes = [
  [
    [0.035, 0.09, 0.15],
    [0.19, 0.61, 0.53],
    [0.98, 0.79, 0.43],
  ],
  [
    [0.12, 0.055, 0.16],
    [0.64, 0.31, 0.36],
    [1, 0.77, 0.42],
  ],
  [
    [0.025, 0.09, 0.2],
    [0.22, 0.52, 0.74],
    [0.76, 0.85, 0.94],
  ],
];
export function paintTerrarium(
  s: Platformer,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: string,
  colors?: number[][],
) {
  const t = s.tick / 60,
    biome = (s.seed + s.stage) % 3,
    p = palettes[biome],
    cam = Math.max(0, s.x - 210);
  const pixel = style === "pixel",
    detail = Number(s.params.richness ?? 0.8);
  ctx.save();
  ctx.scale(w / 640, h / 400);
  const sky = ctx.createLinearGradient(0, 0, 0, 400);
  sky.addColorStop(0, ink(p[0]));
  sky.addColorStop(1, ink(p[0], p[1], 0.45));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 640, 400);
  const sunX = 480 - ((cam * 0.015) % 180),
    sunY = 82 + Math.sin(t * 0.023) * 15;
  const halo = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 180);
  halo.addColorStop(0, ink(p[2], p[2], 0, 0.25));
  halo.addColorStop(1, ink(p[2], p[2], 0, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 640, 400);
  ctx.fillStyle = ink(p[2], p[1], 0.2, 0.7);
  ctx.beginPath();
  ctx.arc(sunX, sunY, 27, 0, TAU);
  ctx.fill();
  for (let layer = 0; layer < 3; layer++) {
    const r = rng(s.seed + layer * 97 + biome * 71),
      parallax = 0.08 + layer * 0.16;
    ctx.fillStyle = ink(p[0], p[1], 0.18 + layer * 0.08);
    for (let i = 0; i < 34; i++) {
      const height = 55 + r() * 125,
        raw = i * 95 - cam * parallax,
        x = (((raw % 3100) + 3100) % 3100) - 160;
      if (x > 720) continue;
      const base = 220 + layer * 48;
      if (biome === 1) {
        ctx.fillRect(x, base - height, 28, height);
        ctx.fillRect(x - 8, base - height, 44, 8);
        ctx.fillRect(x + 10, base - height - 25, 8, 25);
        ctx.strokeStyle = ink(p[2], p[1], 0.5, 0.12 * detail);
        ctx.lineWidth = 0.7;
        for (let k = 0; k < 7; k++) {
          const yy = base - height + 14 + k * 16;
          ctx.strokeRect(x + 5, yy, 17, 6);
        }
      } else if (biome === 2) {
        ctx.beginPath();
        ctx.moveTo(x - 70, base);
        ctx.lineTo(x + 15, base - height);
        ctx.lineTo(x + 100, base);
        ctx.fill();
      } else {
        ctx.fillRect(x + 18, base - height, 7, height);
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.ellipse(
            x + 20,
            base - height + k * 30,
            35 - k * 3,
            45,
            0,
            0,
            TAU,
          );
          ctx.fill();
        }
        ctx.strokeStyle = ink(p[1], p[2], 0.25, 0.2 * detail);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x + 21, base);
        ctx.lineTo(x + 21, base - height - 10);
        for (let k = 0; k < 9; k++) {
          const yy = base - height + k * 17;
          ctx.moveTo(x + 21, yy + 12);
          ctx.lineTo(x + (k % 2 ? 44 : -2), yy - 6);
        }
        ctx.stroke();
      }
    }
  }
  // Seeded vines, strata, grass and landmarks belong to terrain coordinates.
  for (let i = 0; i < s.platforms.length; i++) {
    const platform = s.platforms[i],
      x = platform.x - cam;
    if (x > 680 || x + platform.width < -40) continue;
    const r = rng(s.seed + s.stage * 997 + i * 23),
      accent = colors?.[2] || p[2];
    const earth = ctx.createLinearGradient(0, platform.y, 0, 400);
    earth.addColorStop(0, ink(p[1], p[0], 0.25));
    earth.addColorStop(1, ink(p[0]));
    ctx.fillStyle = earth;
    ctx.beginPath();
    ctx.moveTo(x, platform.y);
    ctx.lineTo(x + platform.width, platform.y);
    ctx.lineTo(x + platform.width - 14, 400);
    ctx.lineTo(x + 8, 400);
    ctx.fill();
    ctx.fillStyle = ink(p[1], p[2], 0.3);
    ctx.fillRect(x, platform.y, platform.width, 4);
    ctx.strokeStyle = ink(p[0], p[1], 0.35, 0.55);
    ctx.lineWidth = 0.7;
    for (let k = 0; k < 14 * detail; k++) {
      const yy = platform.y + 12 + k * 7;
      ctx.beginPath();
      ctx.moveTo(x + 6, yy);
      ctx.lineTo(x + platform.width - 6, yy + Math.sin(i + k) * 3);
      ctx.stroke();
    }
    for (let k = 0; k < platform.width / 8; k++) {
      const xx = x + k * 8,
        hh = 4 + r() * 12;
      ctx.strokeStyle = ink(p[1], accent, r() * 0.6, 0.7);
      ctx.beginPath();
      ctx.moveTo(xx, platform.y);
      ctx.quadraticCurveTo(
        xx + Math.sin(t * 1.2 + k + i) * 3,
        platform.y - hh,
        xx + 3,
        platform.y - hh,
      );
      ctx.stroke();
    }
    if (i % 4 === 2) {
      ctx.fillStyle = ink(p[0], p[1], 0.35);
      ctx.fillRect(x + platform.width * 0.65 - 10, platform.y - 45, 20, 45);
      ctx.strokeStyle = ink(accent);
      ctx.strokeRect(x + platform.width * 0.65 - 7, platform.y - 38, 14, 20);
    }
    if (i > s.ground) {
      const cx = x + platform.width * 0.55,
        cy = platform.y - 27 + Math.sin(t * 2 + i) * 3;
      ctx.fillStyle = ink(accent);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx + 4, cy);
      ctx.lineTo(cx, cy + 6);
      ctx.lineTo(cx - 4, cy);
      ctx.fill();
    }
    // Small autonomous walkers inhabit platforms independently of the explorer.
    if (i % 3 === 1) {
      const bx = x + platform.width * (0.5 + 0.32 * Math.sin(t * 0.35 + i));
      ctx.fillStyle = ink(p[2], p[1], 0.45);
      ctx.beginPath();
      ctx.ellipse(bx, platform.y - 5, 6, 4, 0, 0, TAU);
      ctx.fill();
      ctx.fillRect(bx - 5, platform.y - 1, 2, 3);
      ctx.fillRect(bx + 3, platform.y - 1, 2, 3);
    }
  }
  const px = s.x - cam,
    py = s.y,
    bob = s.vy === 0 ? Math.sin(t * 10) * 1.2 : 0;
  ctx.fillStyle = ink(p[0], p[0], 0, 0.4);
  ctx.beginPath();
  ctx.ellipse(px, py + 2, 12, 3, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(px, py + bob);
  ctx.rotate(Math.max(-0.16, Math.min(0.16, s.vy * 0.0004)));
  ctx.fillStyle = ink(p[2]);
  if (pixel) ctx.fillRect(-6, -27, 12, 10);
  else {
    ctx.beginPath();
    ctx.arc(0, -22, 6, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = ink(colors?.[1] || p[1], p[2], 0.15);
  ctx.fillRect(-7, -17, 14, 13);
  ctx.fillStyle = ink(p[0]);
  ctx.fillRect(-11, -16, 5, 10);
  ctx.strokeStyle = ink(p[2], p[0], 0.35);
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    const stride = s.vy === 0 ? Math.sin(t * 10) * 4 * side : side * 4;
    ctx.beginPath();
    ctx.moveTo(side * 3, -5);
    ctx.lineTo(side * 3 + stride, 0);
    ctx.stroke();
  }
  ctx.fillStyle = ink(p[0]);
  ctx.fillRect(2, -24, 2, 2);
  ctx.restore();
  // Weather and near-field foliage use a different spatial scale from terrain.
  const random = rng(s.seed + biome);
  for (let i = 0; i < 60 * detail; i++) {
    const x = (random() * 640 + t * (biome === 2 ? 13 : 3) + i * 3) % 640,
      y = (random() * 410 + t * (biome === 2 ? 42 : 2)) % 410;
    ctx.fillStyle = ink(p[2], p[1], random(), 0.15 + 0.3 * random());
    if (biome === 2) ctx.fillRect(x, y, 0.7, 5);
    else {
      ctx.beginPath();
      ctx.arc(x, y, 0.6 + random(), 0, TAU);
      ctx.fill();
    }
  }
  const vignette = ctx.createLinearGradient(0, 300, 0, 400);
  vignette.addColorStop(0, "transparent");
  vignette.addColorStop(1, ink(p[0], p[0], 0, 0.75));
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 300, 640, 100);
  ctx.fillStyle = ink(p[2], p[1], 0.3, 0.8);
  ctx.font = "10px monospace";
  ctx.fillText(
    `${biomeNames[biome].toUpperCase()} · EXPEDITION ${s.stage + 1}`,
    16,
    24,
  );
  ctx.restore();
}

export function paintMurmuration(
  s: Flock,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: string,
  colors?: number[][],
) {
  const p = colors || palettes[0],
    t = s.tick / 60,
    detail = Number(s.params.richness ?? 0.8);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(
    0,
    style === "silhouette" ? ink(p[0], p[2], 0.45) : ink(p[0], [0, 0, 0], 0.7),
  );
  sky.addColorStop(0.65, ink(p[0], p[1], 0.18));
  sky.addColorStop(1, ink(p[0], p[2], 0.28));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(
    w * 0.72,
    h * 0.34,
    0,
    w * 0.72,
    h * 0.34,
    w * 0.55,
  );
  glow.addColorStop(0, ink(p[2], p[1], 0.3, 0.3));
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ink(p[2], p[1], 0.3, 0.65);
  ctx.beginPath();
  ctx.arc(w * 0.72, h * 0.34, h * 0.075, 0, TAU);
  ctx.fill();
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = ink(p[0], [0, 0, 0], 0.2 + layer * 0.2);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 12; x += 12)
      ctx.lineTo(
        x,
        h * (0.88 + layer * 0.035) -
          Math.sin((x / w) * 6 + layer + s.seed * 0.01) * h * 0.035,
      );
    ctx.lineTo(w, h);
    ctx.fill();
  }
  // Far and near cohorts have different wingbeats, scale and color value.
  s.agents.forEach((a, i) => {
    const depth = 0.5 + (i % 7) / 10,
      size = (style === "silhouette" ? 3.2 : 2.5) * depth;
    const wing = Math.sin(t * (5.5 + (i % 5) * 0.37) + i * 1.7),
      bank = Math.sin(Math.atan2(a[3], a[2])) * 0.4;
    ctx.save();
    ctx.translate(a[0] * w, a[1] * h);
    ctx.rotate(Math.atan2(a[3] * h, a[2] * w));
    ctx.strokeStyle =
      style === "silhouette"
        ? ink(p[0], [0, 0, 0], 0.6, 0.55 + depth * 0.4)
        : ink(p[1], p[2], (i % 13) / 13, 0.4 + depth * 0.5);
    ctx.lineWidth = 0.6 + depth * 0.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-size * 0.7, -size * (0.5 + wing * 0.8));
    ctx.quadraticCurveTo(size * 0.35, -size * 0.2, 0, bank);
    ctx.quadraticCurveTo(
      size * 0.35,
      size * 0.2,
      -size * 0.7,
      size * (0.5 + wing * 0.8),
    );
    ctx.stroke();
    if (detail > 0.3) {
      ctx.strokeStyle = ink(p[2], p[1], 0.3, 0.3 * detail);
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(-size, 0);
      ctx.lineTo(size * 0.7, 0);
      ctx.stroke();
    }
    ctx.restore();
  });
  if (s.params.predator) {
    const presence = Math.pow(
      0.5 + 0.5 * Math.sin(t * 0.083 + s.seed * 0.001),
      2,
    );
    ctx.save();
    ctx.globalAlpha = presence;
    ctx.translate(
      (0.5 + 0.3 * Math.sin(t * 0.3)) * w,
      (0.5 + 0.3 * Math.cos(t * 0.23)) * h,
    );
    ctx.strokeStyle = ink(p[0], [0, 0, 0], 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.quadraticCurveTo(-2, -3, 1, 0);
    ctx.quadraticCurveTo(-2, 3, -8, 5);
    ctx.stroke();
    ctx.restore();
  }
  // Foreground reeds anchor the flock's scale and leave the sky dominant.
  ctx.strokeStyle = ink(p[0], [0, 0, 0], 0.6, 0.8);
  ctx.lineWidth = 1;
  for (let i = 0; i < 45 * detail; i++) {
    const x = (i * w) / 45,
      y = h - (12 + 17 * Math.sin(i * 2.3));
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.quadraticCurveTo(x + Math.sin(t * 0.8 + i) * 4, y, x + 6, y - 8);
    ctx.stroke();
  }
}
