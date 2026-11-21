// Mini PC with an AMD Ryzen 7 8845HS or 8745HS (Zen 4, Phoenix/Hawk Point, 8 cores) and Radeon 780M
// integrated graphics (RDNA 3, 12 CUs), driving four 1080p screens. Same shape as pi5.mjs; `seen` has
// the same meaning ("opened", "search-extract", "assumption").
// Published CPU figures are for the 8845HS (boost 5.1 GHz). The 8745HS is the same chip without the
// NPU, boosting to 4.9 GHz: expect single-thread work about 4% slower (clock ratio; assumption).

export const id = "780m";
export const label = "Ryzen 7 8845HS / Radeon 780M";
// Fragments shaded together: RDNA 3 runs pixel shaders as 32- or 64-wide waves; 64 (8x8 pixels) is
// assumed, which is the conservative choice for divergence.
export const GROUP_LANES = 64;

const NBC_CPU = "https://www.notebookcheck.net/AMD-Ryzen-7-8845HS-Processor-Benchmarks-and-Specs.780991.0.html";
const NBC_CMP = "https://www.notebookcheck.net/R7-8745HS-vs-R7-8845HS_19649_16399.247596.0.html";

export const CPU_REFS = {
  sevenZip: {
    what: "7-Zip single-thread total rating, MIPS. Published: 7-Zip 18.03 (Windows); measured here with p7zip 16.02 and 7-Zip 23.01, which rate 12% apart here, so both are used",
    higherIsBetter: true, group: "native", hereKeys: ["sevenZip", "sevenZip23"],
    refs: [
      { value: 6393, note: "Notebookcheck, 7-Zip 18.03 single thread, median of 4 systems (average 6319, min 5197)", url: NBC_CPU, seen: "search-extract" },
      { value: 6714, note: "same page, best of the 4 systems", url: NBC_CPU, seen: "search-extract" },
    ],
  },
  octane2: {
    what: "Octane 2.0 score (Notebookcheck 'Octane V2', Chromium-based browser on Windows)",
    higherIsBetter: true, group: "js",
    refs: [
      { value: 90739, note: "average over Notebookcheck's 8845HS systems (range 85,632-96,330); Lenovo IdeaPad Pro 5 14AHP9: 91,639", url: NBC_CMP, seen: "search-extract" },
      { value: 96330, note: "best 8845HS system on the same page", url: NBC_CMP, seen: "search-extract" },
    ],
  },
  jetstream20: {
    what: "JetStream 2 total score (Notebookcheck lists JetStream 2.0); measured here with JetStream 2.0",
    higherIsBetter: true, group: "js",
    refs: [
      { value: 322.2, note: "Lenovo IdeaPad Pro 5 14AHP9 review", url: NBC_CPU, seen: "search-extract" },
    ],
  },
  speedometer30: {
    what: "Speedometer 3.0 runs/min",
    higherIsBetter: true, group: "dom",
    // Dominated by DOM, style and layout, as Speedometer 2.1 for the Pi: recorded, left out of the range.
    outlier: true,
    refs: [
      { value: 17.3, note: "Lenovo IdeaPad Pro 5 14AHP9 review", url: NBC_CPU, seen: "search-extract" },
    ],
  },
  // CoreMark and sysbench: no published 8845HS or 8745HS result was found (searched openbenchmarking,
  // Notebookcheck, PassMark pages), so they are not used for this target.
};

export const CPU_CONTEXT = [
  { what: "Geekbench 6.4 single-core 2618 (Pi 5: 774)", url: "https://technical.city/en/cpu/Ryzen-7-8845HS", seen: "search-extract" },
  { what: "Geekbench processor chart: 8845HS 2044 single-core, 7840HS 2057 (same CPU)", url: "https://browser.geekbench.com/processors/amd-ryzen-7-7840hs", seen: "search-extract" },
  { what: "PassMark single thread 3717 MOps/s", url: "https://www.cpubenchmark.net/cpu.php?id=5915", seen: "search-extract" },
  { what: "8745HS: 3.8-4.9 GHz, like the 8845HS without NPU", url: "https://www.notebookcheck.com/AMD-Ryzen-7-8745HS-Prozessor-Benchmarks-und-Specs.1007249.0.html", seen: "search-extract" },
];

export const MEMORY = {
  type: { what: "DDR5-5600 dual channel (128-bit) = 89.6 GB/s theoretical, as in e.g. the Beelink SER8 review; LPDDR5x-7500 = 120 GB/s", gbs: 89.6, url: "https://www.cpu-monkey.com/en/cpu-amd_ryzen_7_pro_8845hs", seen: "search-extract" },
  memcpy: [], // no published measurement found
  read: [],
  cacheBytes: { l2PerCore: 1024 * 1024, l3Shared: 16 * 1024 * 1024, seen: "search-extract", note: "16 MB L3 (Notebookcheck); 1 MB L2 per Zen 4 core (from memory)" },
};

export const GPU = {
  units: { value: "12 CUs, 768 shaders, 48 TMUs, 32 ROPs, boost 2700 MHz: 129.6 GTexel/s, 86.4 GPixel/s, 8.29 TFLOPS FP32 with dual issue (4.15 without)", url: "https://techpowerup.com/gpu-specs/radeon-780m.c4020", seen: "search-extract" },
  glmark2: { value: "per-scene glmark2 2023.01, Mesa 24.0.5 radeonsi, 800x600 windowed: [build] 0.034 ms/frame, [effect2d] 5x3 kernel 0.114 ms/frame, score 15383", url: "https://gist.github.com/pythoninthegrass/92f860613573c8b3ac2520f73f05db61", seen: "opened" },
  context: [
    { what: "Ryzen 7 8700G (desktop, same 780M at up to 2.9 GHz): Unigine Superposition 1080p above 60 fps on Linux", url: "https://phoronix.com/review/amd-ryzen7-8700g-linux/4", seen: "search-extract" },
    { what: "WebGPU browser benchmarks only (no WebGL results found): gpubenchtest.com average 49,109 points over 225 runs", url: "https://gpubenchtest.com/gpu/amd-radeon-780m-graphics", seen: "search-extract" },
  ],
};

// GPU model limits. Unit counts and clock are published; efficiencies, the sustained clock in a small
// chassis (2.2 GHz in the pessimistic bound), dual issue for these integer-heavy shaders, the CPU copy
// rate for uploads (8-15 GB/s), and the
// memory bandwidth the GPU gets next to the CPU and four screens' scanout are assumptions.
// Immediate-mode GPU: a framebuffer change is cheap (no tile load/store).
const CU_LANES = 768;
export const SCENARIOS = {
  low: {
    label: "optimistic", aluPeak: CU_LANES * 2.7e9, aluEff: 0.7, dualIssue: 1.2, pathFrac: 0.75,
    texPeak: 48 * 2.7e9, tmuEff: 0.8, wideTexelCost: 1, fillPeak: 32 * 2.7e9, bwGBs: 60, readReuse: 1.0, farTapPenalty: 0,
    passMs: 0.005, drawCpuMs: 0.002, uploadCopies: 2, memcpyGBs: 15,
  },
  high: {
    label: "pessimistic", aluPeak: CU_LANES * 2.2e9, aluEff: 0.4, dualIssue: 1.0, pathFrac: 1.0,
    texPeak: 48 * 2.2e9, tmuEff: 0.5, wideTexelCost: 2, fillPeak: 32 * 2.2e9, bwGBs: 35, readReuse: 1.25, farTapPenalty: 1,
    passMs: 0.03, drawCpuMs: 0.01, uploadCopies: 3, memcpyGBs: 8,
  },
};

// glmark2 [effect2d] with a 5x3 kernel at 800x600: one full-window pass of 15 texture reads per pixel.
// Its 0.114 ms frame includes per-frame overhead, taken as the 0.034 ms of glmark2's lightest scene.
export const SANITY = [
  {
    name: "glmark2 [effect2d] 5x3 kernel, 800x600: 0.114 ms per frame (lightest scene 0.034 ms) vs a 15-fetch, 75-op pass",
    measuredMs: 0.114, baselineMs: 0.034, url: GPU.glmark2.url, seen: "opened",
    draws: [{ frags: 800 * 600, ops: 75, fetches: 15, uniqueReadBytes: 4, writeBytes: 4 }],
  },
];
