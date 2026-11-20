# Pi 5 budget

Estimates what Strata's two riskiest systems would cost on a Raspberry Pi 5 (Chromium, WebGL2), from a
machine that is not a Pi and has no GPU:

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
`spirv-tools` and `sysbench` from apt. Write outputs to a scratch folder, not into the repository.

```sh
sh tools/strata-lab/pi-budget/setup.sh /tmp/pi-tools          # p7zip 16.02, CoreMark, Speedometer 2.1, JetStream 2.1, Octane 2.0
node tools/strata-lab/pi-budget/calibrate.mjs --tools /tmp/pi-tools --out /tmp/pi-out \
  --only sevenZip,coremark,sysbench,js,speedometer21                                    # about 5 minutes
node tools/strata-lab/pi-budget/calibrate.mjs --tools /tmp/pi-tools --out /tmp/pi-out \
  --only jetstream21,octane2                                                            # about 6 minutes
node tools/strata-lab/pi-budget/run.mjs --out /tmp/pi-out --throttle                    # about 3 minutes
```

`--only` runs a subset and keeps the earlier results in `calibration.json`; without it everything
runs in one go (about 12 minutes). `run.mjs --quick` shortens the measurements. Ports: 4611 (run), 4621
(calibrate); change with `--port`. Outputs: `calibration.json`, `results.json` (everything) and
`report.md` (the table).

## How to read the numbers

- **CPU factor** = Pi 5 time / time here, from benchmarks run here that have published Pi 5 results.
  Central = median over all of them; low-high = the smallest and largest factor, with Speedometer 2.1
  left out of the range (its Pi figure is DOM- and layout-bound, from 2023 Chromium, and it runs
  headless here; it is kept in `calibration.json` as `highAll`). Native compute benchmarks (7-Zip,
  CoreMark, sysbench) give the low end; the JS-engine suites (Octane 2.0, JetStream 2.1) the high end.
- **CPU rows**: low = time here x low factor; high = time here x high factor, plus a memory term when
  the working set exceeds the Pi 5's L2 + L3 (bytes moved / twice the Pi's memcpy rate, not overlapped).
- **GPU rows**: `lib/gpu-model.mjs`. Each draw is counted in the browser (fragments, passes, uploads;
  `web/gl-count.js`), each shader is compiled to SPIR-V and its ops counted (`lib/shader-cost.mjs`,
  all paths and the early-out path, weighted by the fraction of 16-lane groups that take each), and the
  draw costs the slowest of ALU, texture, memory and fill (low) or the sum of the two slowest with
  pessimistic rates (high), plus a fixed cost per render pass. Central = geometric mean of the bounds.
- **Share of frame** is against 16.7 ms. A 30 steps/s workload counts half a step per frame. A worker
  runs on another core: its share is of that core, not of the main thread.
- **Context rows** estimate presenting the wall itself (4 x 1080p) with assumed shaders. They are
  there because presentation competes for the same GPU and memory; measure it first on real hardware.
- `--throttle` reruns some workloads under DevTools CPU throttling at the central factor. It only
  multiplies main-thread time (workers are not throttled) and models no cache or memory effects, so it
  is a check of the arithmetic, not a second estimate.

## Sources and their status

`lib/pi5.mjs` lists every published figure with its URL and how it was obtained. From this container
only GitHub was reachable: the sbc-bench 7-Zip and memory figures were read in the source files
(`seen: "opened"`). Everything else (Speedometer, JetStream, Octane, CoreMark, sysbench, the VideoCore
VII clock and QPU count, glmark2, WebGL Aquarium) was read only as search-engine extracts of the
pages (`seen: "search-extract"`), and the GPU texture and fill rates are assumptions. Open those URLs
before relying on a number.

## Main uncertainties

- The CPU factor spans 1.15-2.9 (5.4 with Speedometer): typed-array kernels sit somewhere between
  native code and the JS suites. Published Pi results are from older Chromium builds.
- VideoCore VII texture rate, fill rate, ALU efficiency, and the memory bandwidth the GPU actually gets
  next to the CPU, the compositor and the scanout are not published; the GPU range is wide (3-6x).
- Nothing here measures Chromium's compositor or the display path on a Pi. Measure an empty full-screen
  WebGL page on four 1080p screens first.

## Files

| File | What it does |
| --- | --- |
| `calibrate.mjs` | Runs 7-Zip, CoreMark, sysbench, Speedometer 2.1, JetStream 2.1, Octane 2.0 and JS memory probes; writes the factors. |
| `run.mjs` | Runs both spikes on CPU and GPU, counts GPU work, writes estimates and the report. |
| `setup.sh` | Fetches the calibration tools into a scratch folder. |
| `lib/pi5.mjs` | Published Pi 5 figures, sources and their status. |
| `lib/gpu-model.mjs` | VideoCore VII cost model and presentation context. |
| `lib/shader-cost.mjs` | Static op counts of the fragment shaders (glslang + spirv-opt). |
| `lib/estimate.mjs`, `lib/server.mjs`, `lib/browser.mjs` | CPU scaling, static server (COOP/COEP), Chromium launcher. |
| `web/world.js` | Test worlds: realistic, busy (rain and a sand slab), worst (everything loose). |
| `web/sand-cpu.js`, `web/sand-worker.js` | Chunked CPU simulation and its worker. |
| `web/sand-gpu.js` | Margolus block automaton on RGBA16UI textures. |
| `web/light-cpu.js`, `web/light-gpu.js` | Light flood on CPU and GPU (four variants). |
| `web/gl-count.js`, `web/bench.js`, `web/calib.js` | WebGL counters, in-page benchmark API, JS probes. |
