// Turns measurements on this machine into estimates for a target machine.

export const FRAME_MS = 1000 / 60;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// CPU: time here x calibration factor (`f` = cpuFactors(...).summary). The high bound adds a
// memory-traffic term when the working set is larger than the target's L2 + L3 (the benchmark machine
// has 2 MB of L2 per core and a very large L3, so this traffic is mostly free here): bytes / (2 x the
// target's measured memcpy rate), i.e. read + write traffic at copy speed, not overlapped.
export function cpuEstimate(hereMs, f, memory, { workingSetBytes = 0, dramBytes = 0 } = {}, drift = 1) {
  const ms = hereMs * drift;
  const cache = memory.cacheBytes.l2PerCore + memory.cacheBytes.l3Shared;
  const copy = memory.memcpy.map((m) => m.gbs);
  if (workingSetBytes > cache && !copy.length) throw new Error("working set exceeds the target's cache and no memcpy figure is known");
  const memMs = workingSetBytes > cache ? (dramBytes / (2 * Math.min(...copy) * 1e9)) * 1e3 : 0;
  return { hereMs: ms, low: ms * f.low, central: ms * f.central, high: ms * f.high + memMs, memMs };
}

export const share = (ms) => (100 * ms) / FRAME_MS;

export function fmtRange(r, digits = 2) {
  const f = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(digits));
  return r.central !== undefined ? `${f(r.low)}-${f(r.high)} (central ${f(r.central)})` : `${f(r.low)}-${f(r.high)}`;
}

export { median };
