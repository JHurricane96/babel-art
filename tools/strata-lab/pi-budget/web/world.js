// Deterministic test worlds for the Pi budget spikes. One cell = one art pixel.
// "realistic": mostly static rock with caves, a lake, and a few active regions
// (a waterfall, a campfire with smoke, a burning grove, a sand trickle).
// "busy": realistic plus rain over a third of the width and a slab of sand dropped into the lake.
// "worst": no static rock; every cell starts as loose material, so every chunk is active.

export const M = {
  EMPTY: 0, ROCK: 1, SAND: 2, WATER: 3, FIRE: 4, SMOKE: 5, WOOD: 6,
  WATER_SRC: 7, SAND_SRC: 8, FIRE_SRC: 9, SINK: 10,
};

// Light channels (RGBA order in every implementation).
export const CH = { SKY: 0, WARM: 1, CYAN: 2, VIOLET: 3 };

export function xorshift(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function fbm(x, y, seed, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { v += a * vnoise(x * f, y * f, seed + o * 13); a *= 0.5; f *= 2.03; }
  return v;
}

// Every world keeps a two-cell rock frame: the GPU simulation relies on it to read past the edges
// without bounds tests. (In the artwork the frame would be the edge of the streamed region.)
function frame(set, w, h) {
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) set(x, y, M.ROCK);
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) set(x, y, M.ROCK);
}

export const ART_W = 991, ART_H = 648; // default four-panel wall at 480 art px per panel width

export function makeWorld(kind = "realistic", w = 1200, h = 800, seed = 7) {
  const mat = new Uint8Array(w * h), aux = new Uint8Array(w * h);
  const rnd = xorshift(seed * 7919 + 13);
  const set = (x, y, m, a = 0) => { if (x >= 0 && y >= 0 && x < w && y < h) { mat[y * w + x] = m; aux[y * w + x] = a; } };
  const get = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mat[y * w + x] : M.ROCK);
  const lights = []; // {x, y, ch, a} in world cells; a = intensity 0..1.6
  const view = { x0: (w - ART_W) >> 1, y0: (h - ART_H) >> 1, w: Math.min(ART_W, w), h: Math.min(ART_H, h) };

  if (kind === "worst") {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = rnd();
      let m = M.EMPTY;
      if (r < 0.30) m = M.SAND; else if (r < 0.60) m = M.WATER; else if (r < 0.68) m = M.SMOKE;
      else if (r < 0.72) m = M.FIRE; else if (r < 0.80) m = M.WOOD;
      set(x, y, m, m === M.FIRE ? 10 + ((rnd() * 20) | 0) : m === M.SMOKE ? 40 + ((rnd() * 60) | 0) : 0);
    }
    frame(set, w, h);
    for (let x = 8; x < w - 8; x += 16) { set(x, 2, M.SAND_SRC); set(x + 8, 2, M.WATER_SRC); }
    for (let i = 0; i < 40; i++) lights.push({ x: (rnd() * w) | 0, y: (rnd() * h) | 0, ch: 1 + (i % 3), a: 0.7 });
    return { w, h, mat, aux, lights, view, kind };
  }

  // Terrain: a high plateau on the left, a cliff, a lake basin on the right.
  const surf = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    let s = 185 + 45 * (fbm(x / 260, 0.5, seed) - 0.5) + 6 * (vnoise(x / 9, 3.3, seed + 5) - 0.5);
    if (x > 700) s += 95 * Math.min(1, (x - 700) / 25);          // cliff down to the lake basin
    if (x > 760 && x < 1150) s += 70 * Math.sin(Math.PI * (x - 760) / 390); // basin
    surf[x] = Math.round(s);
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    if (y < surf[x]) continue;
    let solid = true;
    if (y > surf[x] + 25 && fbm(x / 95, y / 55, seed + 21) > 0.63) solid = false;           // caves
    const ex = (x - 350) / 190, ey = (y - 575) / 95; if (ex * ex + ey * ey < 1) solid = false; // great cavern
    if (Math.abs(x - 470) < 16 && y < 560) solid = false;                                      // sinkhole shaft
    if (solid) set(x, y, M.ROCK);
  }
  // Lake: fill the basin with water up to the waterline.
  const waterline = 300;
  for (let x = 705; x < w; x++) for (let y = waterline; y < h; y++) {
    if (get(x, y) !== M.EMPTY) break;
    set(x, y, M.WATER);
  }
  // Waterfall: a spring under a rock overhang at the top of the cliff, falling into the lake.
  for (let x = 700; x < 748; x++) for (let y = 196; y < 202; y++) set(x, y, M.ROCK);
  for (let i = 0; i < 8; i++) set(736 + i, 202, M.WATER_SRC);
  // A spillway in the far bank at the waterline keeps the lake level steady.
  let bank = w - 1; while (bank > 760 && get(bank, waterline) !== M.WATER) bank--;
  for (let y = waterline - 2; y <= waterline + 1; y++) set(bank + 1, y, M.SINK);
  // Sand trickle from the cavern ceiling onto a pile with a drain in it.
  let cy = 575; while (cy > 0 && get(300, cy - 1) === M.EMPTY) cy--;
  set(299, cy - 1, M.SAND_SRC); set(300, cy - 1, M.SAND_SRC);
  let fy = 575; while (fy < h - 1 && get(300, fy + 1) === M.EMPTY) fy++;
  set(312, fy + 1, M.SINK); set(288, fy + 1, M.SINK);
  // Campfire on the cavern floor with a log pile.
  let gy = 575; while (gy < h - 1 && get(420, gy + 1) === M.EMPTY) gy++;
  for (let i = 0; i < 3; i++) set(419 + i, gy, M.FIRE_SRC);
  for (let i = 0; i < 6; i++) set(426 + i, gy, M.WOOD);
  lights.push({ x: 420, y: gy - 3, ch: 1, a: 0.95 });
  // A grove of trees joined by undergrowth on the plateau, lit by one ember: a fire front that
  // moves through it for several hundred steps.
  for (let x = 505; x < 690; x++) set(x, surf[x] - 1, M.WOOD);
  for (let t = 0; t < 19; t++) {
    const tx = 512 + t * 9, base = surf[tx] - 2, th = 14 + ((rnd() * 12) | 0);
    for (let k = 0; k < th; k++) set(tx, base - k, M.WOOD);
    for (let k = -5; k <= 5; k++) for (let j = 0; j < 6; j++) if (Math.abs(k) + j < 7 && rnd() < 0.8) set(tx + k, base - th - j + 3, M.WOOD);
  }
  set(504, surf[504] - 1, M.FIRE_SRC);
  // Loose sand lying on cave floors (settles during warm-up).
  for (let i = 0; i < 60; i++) {
    const x = 20 + ((rnd() * (w - 40)) | 0), y = 280 + ((rnd() * (h - 300)) | 0);
    if (get(x, y) !== M.EMPTY) continue;
    let yy = y; while (yy < h - 1 && get(x, yy + 1) === M.EMPTY) yy++;
    for (let k = -6; k <= 6; k++) for (let j = 0; j < 4 - Math.abs(k) / 2; j++) if (get(x + k, yy - j) === M.EMPTY) set(x + k, yy - j, M.SAND);
  }
  // Point lights: lanterns in town and caves, glowing fungus, crystals.
  const place = (n, ch, a, minY) => {
    for (let i = 0, tries = 0; i < n && tries < 5000; tries++) {
      const x = 30 + ((rnd() * (w - 60)) | 0), y = minY + ((rnd() * (h - minY - 30)) | 0);
      if (get(x, y) !== M.EMPTY || get(x, y + 1) === M.EMPTY && ch !== 1) continue;
      lights.push({ x, y, ch, a }); i++;
    }
  };
  for (let i = 0; i < 6; i++) { const x = 120 + i * 70; lights.push({ x, y: surf[x] - 6, ch: 1, a: 0.8 }); }
  place(8, 1, 0.75, 260);  // cave lanterns
  place(14, 2, 0.7, 300);  // fungus
  place(6, 3, 0.8, 350);   // crystals
  if (kind === "busy") {
    // A heavier moment: a rain band over the left plateau (it pours down the sinkhole into the cavern)
    // and a slab of sand dropped into the lake.
    for (let x = 100; x < 500; x += 8) set(x, 2, M.WATER_SRC);
    for (let y = 100; y < 160; y++) for (let x = 800; x < 1000; x++) set(x, y, M.SAND);
  }
  frame(set, w, h);
  return { w, h, mat, aux, lights, view, kind };
}
