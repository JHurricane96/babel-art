# Pi 5 budget

Estimates what Strata's two riskiest systems would cost on a target machine (Chromium, WebGL2), from a
machine that is neither and has no GPU. Targets (`--target`):

- `pi5`: Raspberry Pi 5 (Cortex-A76, VideoCore VII). Profile: `lib/pi5.mjs`.
- `780m`: mini PC with a Ryzen 7 8845HS or 8745HS (Zen 4) and Radeon 780M graphics (RDNA 3), driving
  four 1080p screens. Profile: `lib/ryzen780m.mjs`.

The spikes:

- **Spike A, material simulation**: falling sand, water, fire, smoke and rock on 1200 x 800 cells at 30
  steps/s. CPU: JavaScript in a Web Worker, typed arrays, 64 x 64 chunks with dirty rectangles (only
  active chunks update, as in Noita). GPU: a Margolus block automaton in WebGL2 fragment shaders on
  integer textures.
- **Spike B, light flood** at art resolution (991 x 648): sky light and point lights (fire, lanterns,
  fungus, crystals) spread through open space with a distance falloff, are blocked by rock, and are
  stepped into 5 levels with a 4 x 4 Bayer dither, as in `../sketches/mockup.py`. CPU: chamfer sweeps.
  GPU: jump-flood style or iterative max-propagation passes at full, half or quarter resolution.

CPU times are measured here and scaled by a calibration factor. GPU times come from a cost model,
never from SwiftShader timings (SwiftShader is a CPU rasterizer and says nothing about a GPU).

## Run

Node 22, Playwright's Chromium (`require('playwright')`), and for full results `glslang-tools`,
`spirv-tools`, `sysbench` and `7zip` from apt. Write outputs to a scratch folder, not into the repository.

```sh
sh tools/strata-lab/pi-budget/setup.sh /tmp/pi-tools     # p7zip 16.02, CoreMark, Speedometer 2.1/3.0, JetStream 2.0/2.1, Octane 2.0
C="node tools/strata-lab/pi-budget/calibrate.mjs --tools /tmp/pi-tools --out /tmp/pi-out"
$C --only sevenZip,sevenZip23,coremark,sysbench,js,octane2,speedometer21     # about 7 minutes
$C --only jetstream20,speedometer30                                          # about 8 minutes
$C --only jetstream21,octane2                                                # about 6 minutes
node tools/strata-lab/pi-budget/run.mjs --out /tmp/pi-out --target pi5 --throttle      # about 4 minutes
node tools/strata-lab/pi-budget/run.mjs --out /tmp/pi-out --target 780m --from /tmp/pi-out/measurements.json
```

`--only` runs a subset and adds to the earlier results in `calibration.json` (a rerun's best score
counts); without it everything runs in one go (over 20 minutes). The calibration stores the scores
measured here; each target's factors are computed from them (`lib/targets.mjs`), so a new target
needs no new calibration unless it publishes results for other benchmarks. `run.mjs --from` re-estimates
from earlier measurements without the browser; `--quick` shortens the measurements. Ports: 4611 (run),
4621 (calibrate); change with `--port`. Outputs: `calibration.json`, `measurements.json`,
`results-TARGET.json` (measurements and estimates) and `report-TARGET.md` (the table).

## How to read the numbers

- **CPU factor** = target time / time here, from benchmarks run here that have published results for
  the target. Central = median over all of them; low-high = the smallest and largest factor, with
  Speedometer left out of the range (DOM- and layout-bound, run headless here; kept as `highAll`/`lowAll`).
  For the Pi, native compute benchmarks (7-Zip, CoreMark, sysbench) give the low end and the JS-engine
  suites (Octane 2.0, JetStream 2.1) the high end. For the Ryzen the factor is below 1 (it is faster
  than this machine); only 7-Zip, Octane 2.0, JetStream 2.0 and Speedometer 3.0 have published results.
- **CPU rows**: low = time here x low factor; high = time here x high factor, plus a memory term when
  the working set exceeds the target's L2 + L3 (bytes moved / twice its memcpy rate, not overlapped).
- **GPU rows**: `lib/gpu-model.mjs`. Each draw is counted in the browser (fragments, passes, uploads;
  `web/gl-count.js`), each shader is compiled to SPIR-V and its ops counted (`lib/shader-cost.mjs`,
  all paths and the early-out path, weighted by the fraction of 16-lane groups that take each), and the
  draw costs the slowest of ALU, texture, memory and fill (low) or the sum of the two slowest with
  pessimistic rates (high), plus a fixed cost per render pass. Central = geometric mean of the bounds.
  The limits are in the target profile (`SCENARIOS`), and the model is checked against the target's
  published GPU results (`SANITY`; listed under the table).
- **Share of frame** is against 16.7 ms. A 30 steps/s workload counts half a step per frame. A worker
  runs on another core: its share is of that core, not of the main thread.
- **Context rows** estimate presenting the wall itself (4 x 1080p) with assumed shaders. They are
  there because presentation competes for the same GPU and memory; measure it first on real hardware.
- `--throttle` reruns some workloads under DevTools CPU throttling at the central factor. It only
  multiplies main-thread time (workers are not throttled) and models no cache or memory effects, so it
  is a check of the arithmetic, not a second estimate. It cannot emulate a faster target (factor < 1).

## Sources and their status

`lib/pi5.mjs` and `lib/ryzen780m.mjs` list every published figure with its URL and how it was
obtained. From this container only GitHub was reachable, so only files on GitHub were read
(`seen: "opened"`): the sbc-bench 7-Zip and memory figures for the Pi, and a per-scene glmark2 log of a
Radeon 780M. Everything else was read only as search-engine extracts of the pages
(`seen: "search-extract"`), and several model limits are assumptions (`seen: "assumption"` or stated
in the profile). Open those URLs before relying on a number.

## Main uncertainties

- Pi: the CPU factor spans 1.15-2.9 (5.4 with Speedometer): typed-array kernels sit somewhere between
  native code and the JS suites. Published Pi results are from older Chromium builds.
- Pi: VideoCore VII texture rate, fill rate, ALU efficiency, and the memory bandwidth the GPU actually
  gets next to the CPU, the compositor and the scanout are not published; the GPU range is wide (3-6x).
- Ryzen: no published CoreMark or sysbench result; the published browser results are laptops on
  Windows with 2024 browsers; 7-Zip was published for a different version (18.03). The 780M unit counts
  are published, but its sustained clock in a small chassis and the memory bandwidth it gets are not.
- Nothing here measures Chromium's compositor or the display path. Measure an empty full-screen WebGL
  page on four 1080p screens on the real machine first.

## Files

| File | What it does |
| --- | --- |
| `calibrate.mjs` | Runs 7-Zip (16.02 and 23.01), CoreMark, sysbench, Speedometer 2.1/3.0, JetStream 2.0/2.1, Octane 2.0 and JS memory probes; writes the scores and every target's factors. |
| `run.mjs` | Runs both spikes on CPU and GPU, counts GPU work, writes estimates and the report for one target. |
| `setup.sh` | Fetches the calibration tools into a scratch folder. |
| `lib/targets.mjs` | Target list and the CPU factor computation. |
| `lib/pi5.mjs`, `lib/ryzen780m.mjs` | Target profiles: published figures with sources and status, GPU model limits, sanity checks. |
| `lib/gpu-model.mjs` | GPU cost model, presentation context and sanity checks, for a target's limits. |
| `lib/shader-cost.mjs` | Static op counts of the fragment shaders (glslang + spirv-opt). |
| `lib/estimate.mjs`, `lib/server.mjs`, `lib/browser.mjs` | CPU scaling, static server (COOP/COEP), Chromium launcher. |
| `web/world.js` | Test worlds: realistic, busy (rain and a sand slab), worst (everything loose). |
| `web/sand-cpu.js`, `web/sand-worker.js` | Chunked CPU simulation and its worker. |
| `web/sand-gpu.js` | Margolus block automaton on RGBA16UI textures. |
| `web/light-cpu.js`, `web/light-gpu.js` | Light flood on CPU and GPU (four variants). |
| `web/gl-count.js`, `web/bench.js`, `web/calib.js` | WebGL counters, in-page benchmark API, JS probes. |
