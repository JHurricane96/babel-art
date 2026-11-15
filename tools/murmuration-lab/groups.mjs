// How well the flock holds together, stays aloft and stays in its area over a run.
//   node --import tsx tools/murmuration-lab/groups.mjs <seed> <population> <minutes>
// Groups are connected pieces of the nearest-neighbour graph, sampled every 20 s.
import { Murmuration, BIRD_STRIDE } from "../../engine/murmuration.ts";
import { defaults } from "../../scenes/registry.ts";
const [seed, pop, mins] = process.argv.slice(2).map(Number);
const sim = new Murmuration(seed, { ...defaults("murmuration"), population: pop });
let sum = 0, whole = 0, k = 0, worst = 1, low = 0, far = 0, all = 0, pieces = [];
for (let i = 1; i <= mins * 3600; i++) {
  sim.step(); if (i % 1200) continue;
  const n = pop, parent = Int32Array.from({ length: n }, (_, i) => i), find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (let a = 0; a < n; a++) for (let j = 0; j < sim.counts[a]; j++) parent[find(a)] = find(sim.neighbours[a * 7 + j]);
  const sizes = new Map(); for (let a = 0; a < n; a++) sizes.set(find(a), (sizes.get(find(a)) ?? 0) + 1);
  const big = Math.max(...sizes.values()) / n; sum += big; k++; if (big > 0.9) whole++; worst = Math.min(worst, big);
  pieces.push([...sizes.values()].filter((v) => v > 0.03 * n).length);
  const b = sim.birds; for (let at = 0; at < b.length; at += BIRD_STRIDE) { all++; if (!(b[at + 1] > 15 && b[at + 1] < 110)) low++; if (Math.hypot(b[at], b[at + 2]) >= 140) far++; }
}
console.log(`seed ${seed}, ${pop} birds, ${mins} min: largest group mean ${(sum / k).toFixed(2)}, worst ${worst.toFixed(2)}; one piece ${(100 * whole / k).toFixed(0)}% of samples; pieces over time ${pieces.join("")}; outside 15–110 m altitude ${(low / all * 100).toFixed(2)}%; beyond 140 m ${(far / all * 100).toFixed(2)}%`);
