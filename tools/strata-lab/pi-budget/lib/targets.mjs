// Target machines the budget can be estimated for (--target), and the CPU factors for each, computed
// from the benchmark scores measured here (calibration.json `results`) and the target's published ones.
import * as pi5 from "./pi5.mjs";
import * as r780m from "./ryzen780m.mjs";

export const TARGETS = { [pi5.id]: pi5, [r780m.id]: r780m };

export function getTarget(name = "pi5") {
  const t = TARGETS[name];
  if (!t) throw new Error(`unknown target "${name}" (known: ${Object.keys(TARGETS).join(", ")})`);
  return t;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// Factor = target time / time here = (score here) / (score on the target), for higher-is-better scores.
// Central: median over all benchmarks; low-high: smallest and largest factor of the benchmarks not
// marked as outliers (highAll and lowAll include them). Groups: native code, JS-engine suites, DOM.
export function cpuFactors(results, target) {
  const factors = {};
  for (const [k, ref] of Object.entries(target.CPU_REFS)) {
    const keys = (ref.hereKeys || [k]).filter((h) => typeof results[h]?.here === "number");
    if (!keys.length) continue;
    const f = [];
    for (const h of keys) for (const r of ref.refs) f.push(results[h].here / r.value);
    factors[k] = {
      what: ref.what, group: ref.group, outlier: !!ref.outlier, refs: ref.refs,
      here: Object.fromEntries(keys.map((h) => [h, results[h].here])), factor: median(f), factorRange: [Math.min(...f), Math.max(...f)],
    };
  }
  const all = Object.values(factors), inRange = all.filter((f) => !f.outlier);
  const group = (g) => { const v = all.filter((f) => f.group === g).map((f) => f.factor); return v.length ? median(v) : null; };
  const summary = all.length ? {
    central: median(all.map((f) => f.factor)),
    low: Math.min(...inRange.map((f) => f.factorRange[0])), high: Math.max(...inRange.map((f) => f.factorRange[1])),
    lowAll: Math.min(...all.map((f) => f.factorRange[0])), highAll: Math.max(...all.map((f) => f.factorRange[1])),
    native: group("native"), jsKernel: group("js"), dom: group("dom"),
  } : null;
  return { target: target.id, factors, summary };
}
