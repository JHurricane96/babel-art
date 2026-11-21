// Published Raspberry Pi 5 figures used for calibration and the GPU budget.
// `seen` records how the figure was obtained from this container (web access is mostly blocked):
//   "opened"         the source file itself was read (fetched with git from GitHub)
//   "search-extract" read only as a search engine's extract of the page; the page itself could not
//                    be opened from this container. Treat as unverified until someone opens the URL.
//   "assumption"     not a published Pi 5 figure: an engineering assumption, stated as such
// Pi 5 = Raspberry Pi 5 Model B, BCM2712, 4x Cortex-A76 at 2.4 GHz, VideoCore VII.
// Same shape as every target profile (see targets.mjs): CPU_REFS, MEMORY, GPU, SCENARIOS, SANITY.

export const id = "pi5";
export const label = "Raspberry Pi 5";
// Fragments shaded together (VideoCore: 16-lane threads, taken here as 4x4 pixel groups).
export const GROUP_LANES = 16;

export const CPU_REFS = {
  sevenZip: {
    what: "7-Zip (p7zip 16.02) `7zr b -mmt1` total rating, MIPS, single thread (as sbc-bench runs it)",
    higherIsBetter: true, group: "native",
    refs: [
      { value: 3160, note: "2400 MHz, kernel 6.1, Bookworm", url: "https://gist.github.com/arkadijs/117934b6a3f011dc7024193bcb0b82a8", seen: "opened" },
      { value: 3196, note: "2400 MHz, kernel 6.1 (sbc-bench result Au3jaA)", url: "https://github.com/ThomasKaiser/sbc-bench/blob/master/Results.md", seen: "opened" },
      { value: 3305, note: "2400 MHz, kernel 6.6, firmware 2025-01 (sbc-bench result 8-NK); RAM timing improvements in later firmware", url: "https://github.com/ThomasKaiser/sbc-bench/blob/master/results/8-NK.txt", seen: "opened" },
      { value: 3136, note: "CNX Software review, Bookworm", url: "https://www.cnx-software.com/2023/11/05/raspberry-pi-5-review-raspberry-pi-os-bookworm-benchmarks-power-consumption/", seen: "search-extract" },
    ],
  },
  speedometer21: {
    what: "Speedometer 2.1 runs/min in Chromium (JavaScript + DOM)",
    higherIsBetter: true, group: "dom",
    // Dominated by DOM, style and layout, run here headless with software compositing, and the Pi figure
    // is from 2023 Chromium: kept in the record but left out of the range for typed-array kernels.
    outlier: true,
    refs: [
      { value: 62.5, note: "Raspberry Pi's own benchmark post (data credited to Core Electronics); Pi 4: 20.5", url: "https://www.raspberrypi.com/news/benchmarking-raspberry-pi-5/", seen: "search-extract" },
    ],
  },
  jetstream21: {
    what: "JetStream 2.1 score in Chromium (JavaScript and WebAssembly engine workloads)",
    higherIsBetter: true, group: "js",
    refs: [
      { value: 87.873, note: "default Chromium on Raspberry Pi OS; Pi 4: 37.868", url: "https://www.hackster.io/news/raspberry-pi-5-review-hands-on-with-the-most-powerful-raspberry-pi-yet-57efaf61b10f", seen: "search-extract" },
    ],
  },
  octane2: {
    what: "Octane 2.0 score in Chromium (JavaScript engine kernels)",
    higherIsBetter: true, group: "js",
    refs: [
      { value: 26334, note: "Pi 4B quoted at ~8000", url: "https://magazinmehatronika.com/en/raspberry-pi-5-model-b-review/", seen: "search-extract" },
      { value: 27542, note: "forum post comparing two Pi 5 configurations (lower of the two)", url: "https://forums.raspberrypi.com/viewtopic.php?t=356922&start=850", seen: "search-extract" },
      { value: 28517, note: "same forum post (higher of the two)", url: "https://forums.raspberrypi.com/viewtopic.php?t=356922&start=850", seen: "search-extract" },
    ],
  },
  coremark: {
    what: "CoreMark 1.0 iterations/s per core (Pi value = Phoronix Test Suite all-core result / 4, assuming one thread per core and linear scaling)",
    higherIsBetter: true, group: "native",
    refs: [
      { value: 96550 / 4, note: "pts/coremark size 666: ~96,500-96,600 it/s on the whole Pi 5 (Pi 4: ~37,400)", url: "https://openbenchmarking.org/result/2404260-NE-2312204WL79", seen: "search-extract" },
    ],
  },
  sysbench: {
    what: "sysbench 1.0.20 cpu, 1 thread, default max prime 10000, events/s (integer division heavy: least representative)",
    higherIsBetter: true, group: "native",
    refs: [
      { value: 2730.5, note: "Pi 4: ~1471", url: "https://elektronicavoorjou.nl/en/blog/benchmark-raspberry-pi-5", seen: "search-extract" },
    ],
  },
};

// Not runnable here; listed for context.
export const CPU_CONTEXT = [
  { what: "Geekbench 6.2 single-core", value: 774, url: "https://www.raspberrypi.com/news/benchmarking-raspberry-pi-5/", seen: "search-extract" },
];

export const MEMORY = {
  type: { what: "LPDDR4X-4267, 32-bit interface (bus width from memory, unverified) -> 17.1 GB/s theoretical", gbs: 17.1, seen: "assumption", url: "https://www.cnx-software.com/2023/09/28/raspberry-pi-5-sbc-broadcom-bcm2712-quad-core-cortex-a76-soc/" },
  memcpy: [
    { gbs: 5.26, note: "tinymembench libc memcpy via sbc-bench, kernel 6.1", url: "https://gist.github.com/arkadijs/117934b6a3f011dc7024193bcb0b82a8", seen: "opened" },
    { gbs: 6.03, note: "tinymembench libc memcpy via sbc-bench, firmware 2025-01", url: "https://github.com/ThomasKaiser/sbc-bench/blob/master/results/8-NK.txt", seen: "opened" },
    { gbs: 5.16, note: "CNX Software review", url: "https://www.cnx-software.com/2023/11/05/raspberry-pi-5-review-raspberry-pi-os-bookworm-benchmarks-power-consumption/", seen: "search-extract" },
  ],
  read: [
    { gbs: 14.9, note: "tinymembench memchr (streaming read) via sbc-bench, firmware 2025-01", url: "https://github.com/ThomasKaiser/sbc-bench/blob/master/results/8-NK.txt", seen: "opened" },
    { gbs: 13.7, note: "single-thread read", url: "https://learn.arm.com/learning-paths/cross-platform/llm-decode-roofline/measure-bandwidth/", seen: "search-extract" },
  ],
  cacheBytes: { l2PerCore: 512 * 1024, l3Shared: 2 * 1024 * 1024, seen: "assumption", note: "Cortex-A76 512 KB L2 per core, 2 MB shared L3 (from memory, unverified)" },
};

export const GPU = {
  clockMHz: { value: 800, url: "https://www.cnx-software.com/2023/09/28/raspberry-pi-5-sbc-broadcom-bcm2712-quad-core-cortex-a76-soc/", seen: "search-extract", note: "also in the Raspberry Pi 5 product brief" },
  qpus: { value: 12, url: "https://www.notebookcheck.net/Broadcom-VideoCore-VII-Benchmarks-and-Specs.873281.0.html", seen: "search-extract", note: "'12 cores'; Raspberry Pi's processor documentation page is reported to say the same" },
  qpuWidth: {
    value: 4, url: "https://docs.broadcom.com/doc/12358545", seen: "search-extract",
    note: "VideoCore IV reference guide: a QPU is 4-way SIMD multiplexed over 4 cycles (16 lanes); VC IV: 12 QPUs x 4 lanes x 2 ops x 250 MHz = 24 GFLOPS, which matches its published figure. Assumed unchanged in VideoCore VII.",
  },
  gflops: [
    { value: 76.8, note: "derived: 12 QPUs x 4 lanes x 2 ops (add + mul) x 0.8 GHz", seen: "assumption" },
    { value: 120, note: "CPU-Monkey listing, FP32, basis not stated", url: "https://www.cpu-monkey.com/en/igpu-broadcom_videocore_vii", seen: "search-extract" },
  ],
  texelsPerClock: { value: [3, 6], seen: "assumption", note: "no published VideoCore VII texture rate found; 1-2 texture units per 4-QPU slice as in VideoCore IV, 1 texel/clock each, from memory" },
  pixelsPerClock: { value: [2, 4], seen: "assumption", note: "no published fill rate found; VideoCore IV was quoted at 1 Gpixel/s at 250 MHz (4/clock), from memory" },
  sanity: [
    { what: "glmark2 at 1920x1080, V3D 7.1: score ~189-193 (average fps over its scenes)", url: "https://openbenchmarking.org/result/2407270-NE-RPI5GLMAR05", seen: "search-extract" },
    { what: "glmark2: Pi 5 at 4.3x Pi 4", url: "https://www.phoronix.com/review/raspberry-pi-5-graphics", seen: "search-extract" },
    { what: "WebGL Aquarium in Chrome on Pi 5: 30 fps with 5,000 fish (so at most ~6.7 us per fish draw, all work included)", url: "https://www.cnx-software.com/2026/08/17/google-chrome-is-now-available-for-arm-linux-we-tested-it-on-a-raspberry-pi-5/", seen: "search-extract" },
    { what: "WebGL Aquarium in Chromium on Raspberry Pi OS: 60 fps with 1,000 fish", url: "https://mvysny.github.io/rpi5-ubuntu-disaster", seen: "search-extract" },
  ],
};

// GPU model limits (lib/gpu-model.mjs) for the optimistic (low) and pessimistic (high) bounds.
//   shader ALU   12 QPUs x 4 lanes x 800 MHz = 38.4 G lane-ops/s peak (76.8 GFLOPS counting add+mul)
//   texture      3-6 texels/clock (assumption: no published VideoCore VII texture rate)
//   fill         2-4 pixels/clock written (assumption: no published VideoCore VII fill rate)
//   memory       4-8 GB/s for the GPU out of LPDDR4X-4267 (17 GB/s theoretical, 14-15 GB/s measured CPU
//                streaming read, 5-6 GB/s memcpy), shared with the CPU, Chromium's compositor and the
//                scanout of four 1080p screens (about 2 GB/s on its own)
//   passes       tile-based: every framebuffer change is a full binning and tile load/store cycle
const VC_ALU = 12 * 4 * 800e6;
export const SCENARIOS = {
  low: {
    label: "optimistic", aluPeak: VC_ALU, aluEff: 0.7, dualIssue: 1.3, pathFrac: 0.75,
    texPeak: 6 * 800e6, tmuEff: 0.8, wideTexelCost: 1, fillPeak: 4 * 800e6, bwGBs: 8, readReuse: 1.0, farTapPenalty: 0,
    passMs: 0.02, drawCpuMs: 0.005, uploadCopies: 2, memcpyGBs: 6.0,
  },
  high: {
    label: "pessimistic", aluPeak: VC_ALU, aluEff: 0.4, dualIssue: 1.0, pathFrac: 1.0,
    texPeak: 3 * 800e6, tmuEff: 0.5, wideTexelCost: 2, fillPeak: 2 * 800e6, bwGBs: 4, readReuse: 1.25, farTapPenalty: 1,
    passMs: 0.1, drawCpuMs: 0.02, uploadCopies: 3, memcpyGBs: 5.2,
  },
};

// Published GPU results the model is checked against (lib/gpu-model.mjs sanityChecks).
// glmark2 (score ~190 at 1920x1080, i.e. ~5.3 ms per frame averaged over its scenes) against one
// full-screen 1080p draw with a 60-op shader and 2 fetches.
export const SANITY = [
  {
    name: "glmark2 at 1920x1080: score ~190, i.e. ~5.3 ms per frame averaged over its scenes, vs a full-screen 60-op, 2-fetch draw",
    measuredMs: 1000 / 190, url: "https://openbenchmarking.org/result/2407270-NE-RPI5GLMAR05", seen: "search-extract",
    draws: [{ frags: 1920 * 1080, ops: 60, fetches: 2, uniqueReadBytes: 2, writeBytes: 4 }],
  },
];
