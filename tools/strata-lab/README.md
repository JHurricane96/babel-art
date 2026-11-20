# Strata lab

Tools for developing Strata, a new artwork (see the vision doc linked from the
session). Write outputs to a scratch folder, not into the repository.

| Tool | What it does |
| --- | --- |
| `pi-budget/` | Estimates Raspberry Pi 5 cost from this machine: CPU time scaled by a calibration factor from benchmarks with published Pi 5 results, GPU time from a cost model. Spikes for the material simulation and the light flood. See its README. |
| `sketches/motion.py` | A 20-second motion test of the cavern panel, with light options (stepped, steady, calm, banded, smooth) and a count of pixels the light alone changes per frame. |
| `sketches/mockup.py` | A static mock-up of one dusk tableau on the default four-screen wall, used to settle the look: pixel size, light, palette. Needs numpy and Pillow. |

```sh
python tools/strata-lab/sketches/mockup.py /tmp/strata 320 480 640   # pixel sizes
python tools/strata-lab/sketches/mockup.py /tmp/strata --variants   # looks at 480
```

The look variants (`VARIANTS` in the script) are a dark cut-away with pools of
light, a brighter illustrated cross-section, smooth instead of stepped light,
a warm sandstone day, and a cold granite night.

Each size is the pixel-art width of one 531 mm panel (480 = 4×4 screen pixels
per art pixel on a 1080p panel). It writes the full wall at screen resolution,
a 1600-pixel preview, and a 1:1 crop around the camp.
