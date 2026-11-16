// How well the flock holds together and stays in view over a run.
//   node --import tsx tools/murmuration-lab/groups.mjs <seed> <population> <minutes>
// Pieces are connected sets of occupied 12 m cells (world positions), sampled every 20 s.
import { Murmuration, BIRD_STRIDE as K } from "../../engine/murmuration.ts";
import { defaults } from "../../scenes/registry.ts";
function pieces(d) {
  const C = 12, cells = new Map();
  for (let at = 0; at < d.length; at += K) { const k = `${Math.floor(d[at] / C)},${Math.floor(d[at + 1] / C)},${Math.floor(d[at + 2] / C)}`; cells.set(k, (cells.get(k) ?? 0) + 1); }
  const seen = new Set(), sizes = [];
  for (const [k, c] of cells) {
    if (seen.has(k) || c < 2) continue;
    let tot = 0; const st = [k]; seen.add(k);
    while (st.length) {
      const cur = st.pop(); tot += cells.get(cur); const [x, y, z] = cur.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nk = `${x + dx},${y + dy},${z + dz}`;
        if (!seen.has(nk) && (cells.get(nk) ?? 0) >= 2) { seen.add(nk); st.push(nk); }
      }
    }
    sizes.push(tot);
  }
  return sizes.sort((a, b) => b - a).map((s) => (s * K) / d.length);
}
const [seed, pop, mins] = process.argv.slice(2).map(Number);
const sim = new Murmuration(seed, { ...defaults("murmuration"), population: pop });
let whole = 0, largest = 0, worst = 1, k = 0, out = "", lowY = 1e9, highY = -1e9, maxX = 0;
for (let i = 1; i <= mins * 3600; i++) {
  sim.step(); if (i % 1200) continue;
  const d = sim.captureFrame().data, p = pieces(d);
  k++; largest += p[0]; worst = Math.min(worst, p[0]); if (p[0] > 0.9) whole++; out += p.filter((v) => v > 0.03).length;
  for (let at = 0; at < d.length; at += K) { lowY = Math.min(lowY, d[at + 1]); highY = Math.max(highY, d[at + 1]); maxX = Math.max(maxX, Math.abs(d[at])); }
}
console.log(`seed ${seed}, ${pop} birds, ${mins} min: one piece ${(100 * whole / k).toFixed(0)}% of samples, largest piece mean ${(largest / k).toFixed(2)}, worst ${worst.toFixed(2)}; pieces over time ${out}; altitude ${lowY.toFixed(0)}–${highY.toFixed(0)} m; |x| up to ${maxX.toFixed(0)} m`);
