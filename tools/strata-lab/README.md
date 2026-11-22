# Strata lab

Tools for developing Strata, a new artwork (see the vision doc linked from the
session). Write outputs to a scratch folder, not into the repository.

| Tool | What it does |
| --- | --- |
| `viewer/` | A self-contained HTML viewer for the land: regions generated and lit in web workers, drawn at a whole number of screen pixels per art pixel (4 by default, as on the TVs) so it looks crisp on any monitor. Pan, zoom, change seeds, jump between biome edges, drift, and mask to the four-screen wall. Build with `node tools/strata-lab/viewer/build.mjs OUT.html --standalone`. |
| `land-render.ts` | The lab's land renderer (sky, strata, cave light), shared by the viewer and `regions.ts`. |
| `regions.ts` | Renders land from the region generator (`engine/strata/generate.ts`): a four-region panorama, wall-sized close-ups of each region edge, and a 12-seed contact sheet (skip it with `--quick`). Prints generation time, scaled to the mini PC. |
| `pi-budget/` | Estimates frame cost on the target machine from this one (`--target 780m` for the Ryzen 7 / Radeon 780M mini PC, `pi5` for a Raspberry Pi 5): CPU time scaled by a calibration factor from published benchmarks, GPU time from a cost model. Spikes for the material simulation and the light flood. See its README. |
| `sketches/motion.py` | A 20-second motion test of the cavern panel, with light options (stepped, steady, calm, banded, smooth) and a count of pixels the light alone changes per frame. |
| `sketches/mockup.py` | A static mock-up of one dusk tableau on the default four-screen wall, used to settle the look: pixel size, light, palette. Needs numpy and Pillow. |

```sh
node --import tsx tools/strata-lab/regions.ts /tmp/strata-land 7 --quick   # seed 7
python tools/strata-lab/sketches/mockup.py /tmp/strata 320 480 640   # pixel sizes
python tools/strata-lab/sketches/mockup.py /tmp/strata --variants   # looks at 480
```

The look variants (`VARIANTS` in the script) are a dark cut-away with pools of
light, a brighter illustrated cross-section, smooth instead of stepped light,
a warm sandstone day, and a cold granite night.

Each size is the pixel-art width of one 531 mm panel (480 = 4×4 screen pixels
per art pixel on a 1080p panel). It writes the full wall at screen resolution,
a 1600-pixel preview, and a 1:1 crop around the camp.
