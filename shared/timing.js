export const PERFECT = Object.freeze({ delay: 0, hz: 60, phase: 0, jitter: 0, drift: 0, scanout: 'none' });
function noise(frame, salt) {
  let n = (frame | 0) ^ Math.imul(salt + 1, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
// Stateless event lookup: a render becomes ready, then a display refresh latches it.
export function frameAt(wallMs, timing = PERFECT, panelIndex = 0, enabled = true) {
  const t = enabled ? timing : PERFECT, period = 1000 / t.hz;
  const cycle = Math.floor((wallMs - t.phase) / period + 1e-9);
  const sourceAt = refresh => {
    // Render cadence starts at zero; display refresh has its own phase.
    const last = Math.floor(refresh / period + 1e-9);
    const count = Math.ceil((t.delay + t.jitter) / period) + 2;
    for (let id = last; id >= last - count; id--) {
      const source = id * period;
      if (source + t.delay + noise(id, panelIndex) * t.jitter <= refresh + 1e-7)
        return source * (1 + t.drift / 1e6);
    }
    throw new Error('Frame readiness search failed');
  };
  const refresh = cycle * period + t.phase;
  return { current: sourceAt(refresh), previous: sourceAt(refresh - period), age: Math.max(0, wallMs - refresh), period, scan: t.scanout };
}
export function sampleAtRow(frame, row) {
  if (frame.scan === 'none') return frame.current;
  return frame.age < (frame.scan === 'bottom-up' ? 1 - row : row) * frame.period ? frame.previous : frame.current;
}
export const TIMING_PRESETS = {
  aligned: () => ({ ...PERFECT }),
  independent: i => ({ ...PERFECT, phase: i * 4.1, scanout: 'top-down' }),
  mixed: i => ({ ...PERFECT, delay: [0,18,42,67][i], hz: [60,59.94,60,50][i], phase: i * 3.1, jitter: i ? 1.5 : 0, drift: [0,15,-25,40][i], scanout: i === 2 ? 'bottom-up' : 'top-down' }),
  exaggerated: i => ({ ...PERFECT, delay: i * 75, phase: i * 4, jitter: i * 3, scanout: 'top-down' })
};
