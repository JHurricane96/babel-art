// Small in-browser probes: typed-array memory bandwidth, and a fixed integer kernel used to detect
// machine-speed drift between runs (another job shares the benchmark machine).

export function memoryBandwidth(mb = 64, reps = 5) {
  const n = (mb * 1024 * 1024) >> 2;
  const a = new Uint32Array(n), b = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i * 2654435761;
  const best = (fn) => { let t = Infinity; for (let r = 0; r < reps; r++) { const t0 = performance.now(); fn(); t = Math.min(t, performance.now() - t0); } return t; };
  let sink = 0;
  const readMs = best(() => { let s = 0; for (let i = 0; i < n; i += 4) s = (s + a[i] + a[i + 1] + a[i + 2] + a[i + 3]) | 0; sink ^= s; });
  const loopCopyMs = best(() => { for (let i = 0; i < n; i++) b[i] = a[i]; });
  const setCopyMs = best(() => b.set(a));
  const bytes = n * 4;
  return {
    mb, readGBs: bytes / readMs / 1e6, loopCopyGBs: (2 * bytes) / loopCopyMs / 1e6, setCopyGBs: (2 * bytes) / setCopyMs / 1e6,
    // copy figures count bytes read + bytes written; tinymembench's memcpy figure counts bytes copied once
    setCopyTinymembenchGBs: bytes / setCopyMs / 1e6, sink,
  };
}

// About 0.2-0.5 s of branchy integer work on typed arrays; returns milliseconds.
export function driftProbe() {
  const n = 1 << 16, a = new Int32Array(n);
  let s = 12345;
  const t0 = performance.now();
  for (let r = 0; r < 300; r++) {
    for (let i = 0; i < n; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const j = (s >>> 0) & (n - 1);
      a[i] = (a[j] > a[i] ? a[j] - (s & 7) : a[i] + (s & 3)) | 0;
    }
  }
  const ms = performance.now() - t0;
  return { ms, check: a[123] };
}
