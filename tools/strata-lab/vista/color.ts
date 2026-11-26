// Colour ramps for Vista, in the pixel artist's way (the same rules as the
// land renderer's rampOf): six shades darkest first, shadows cooler and
// toward blue-violet, highlights warmer and toward yellow.

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklab(r: number, g: number, b: number) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
export const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** Six shades of a colour (0..1 RGB), darkest first; the colour itself sits at shade 3-4. */
export function rampOf(base: number[], spread = 1): number[][] {
  const [L, a, b] = oklab(toLin(base[0]), toLin(base[1]), toLin(base[2])),
    steps = [-0.2, -0.12, -0.05, 0.02, 0.09, 0.17],
    out: number[][] = [];
  for (let k = 0; k < 6; k++) {
    const s = steps[k] * spread,
      warm = s * 0.35,
      chroma = k === 0 ? 0.8 : k === 5 ? 0.75 : 1.05,
      [r, g, bb] = fromOklab(Math.min(0.97, Math.max(0.08, L + s)), a * chroma + warm * 0.15, b * chroma + warm * 0.55);
    out.push([r, g, bb].map((v) => toSrgb(Math.min(1, Math.max(0, v)))));
  }
  return out;
}

/** A colour moved in OKLab: lighter or darker by dL, turned by dHue radians, chroma scaled. */
export function shiftColor(base: number[], dL: number, dHue: number, chroma = 1): number[] {
  const [L, a, b] = oklab(toLin(base[0]), toLin(base[1]), toLin(base[2])),
    c = Math.cos(dHue),
    s = Math.sin(dHue),
    [r, g, bb] = fromOklab(Math.min(0.97, Math.max(0.05, L + dL)), (a * c - b * s) * chroma, (a * s + b * c) * chroma);
  return [r, g, bb].map((v) => toSrgb(Math.min(1, Math.max(0, v))));
}
