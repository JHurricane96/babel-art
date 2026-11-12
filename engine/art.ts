export function ink(a: number[], b = a, amount = 0, alpha = 1) {
  const channels = a.map((v, i) => Math.round(255 * (v + (b[i] - v) * amount)));
  return `rgba(${channels.join(",")},${alpha})`;
}
export function ground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: number[][],
) {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, ink(colors[0], [0, 0, 0], 0.72));
  gradient.addColorStop(0.55, ink(colors[0], [0, 0, 0], 0.4));
  gradient.addColorStop(1, ink(colors[1], [0, 0, 0], 0.9));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}
