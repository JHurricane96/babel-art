# Murmuration lab

Tools for developing the Murmuration artwork without a GPU. The full brief is in
`tmp/murmuration-handoff.md`; read that first.

The browser renderer in a container without a GPU takes about 10 seconds per still and about
2 seconds per video frame. So motion is reviewed offline, from the simulation's own output, and only
the final look (tone, grain, scenery) is checked through the browser, as stills.

## Setup

```sh
npm ci
python3 -m venv .venv-lab && .venv-lab/bin/pip install -r tools/murmuration-lab/requirements.txt
```

`ffmpeg` must be on the path. Write outputs to a scratch folder, not into the repository.

## Motion (fast, offline)

| Tool | What it does |
| --- | --- |
| `export.mjs` | Runs the flock headless and writes each bird's screen position, size, wing area and span per frame. Also prints simulation milliseconds per step. |
| `render.py` | Turns an export into a clip of dark specks on a plain sky. About one minute per minute of clip. `--ref video` stacks a reference on top. |
| `sheet.py` | Contact sheet from an export, plus position, size and piece count over time. Use a low export rate and a 60 s step for runs of 30–120 minutes. |
| `metrics.py` | Shape and motion measures of an export (width, length ÷ height, pieces, pace, counter-flow, how fast the outline changes). |
| `groups.mjs` | How often the flock is one piece, how small the largest piece gets, altitude and area limits. |

```sh
node --import tsx tools/murmuration-lab/export.mjs 4209 60 25 /tmp/lab/a.bin
.venv-lab/bin/python tools/murmuration-lab/render.py /tmp/lab/a.bin /tmp/lab/a.mp4
.venv-lab/bin/python tools/murmuration-lab/metrics.py /tmp/lab/a.bin
node --import tsx tools/murmuration-lab/export.mjs 4209 1800 0.2 /tmp/lab/long.bin      # 30 minutes
.venv-lab/bin/python tools/murmuration-lab/sheet.py /tmp/lab/long.bin /tmp/lab/long.png 60
```

`render.py`, `sheet.py` and `metrics.py` scatter a few visible birds around each simulated bird
(`--spread`, metres). When the renderer or the model changes how visible birds are placed, change these
to match, or the offline picture will mislead.

## Look (slow, real renderer)

| Tool | What it does |
| --- | --- |
| `capture.mjs` | Stills of the wall from the real renderer at chosen times, palettes and styles. `DPR=2` for full resolution. |
| `tone.py` | Darkness and grain of the flock inside a sky-only crop of a still or a reference frame. |
| `cost.mjs` | Processor cost in the browser: simulation step, checkpoint, and building draw data. Does not measure the GPU. |

```sh
DPR=2 node tools/murmuration-lab/capture.mjs /tmp/lab '[{"scene":"murmuration","palette":"aurora","times":[20,64,100],"name":"m"}]'
.venv-lab/bin/python tools/murmuration-lab/tone.py /tmp/lab/m-t0064.png:1365,870,2540,1420
node tools/murmuration-lab/cost.mjs
```

## Reference footage

`reference/video_metrics.py` and `reference/kymograph.py` measure a video of a real flock (or one of
our own clips) for comparison. The footage itself is not in the repository; ask the user for it. The
figures already measured are in the brief.

## Sketches

Throwaway probes kept for what they taught, described at the top of each file:

- `sketches/sheet_mock.py`: a look. Fifty thousand real-size birds as one flexible sheet give a crisp
  outline, a pale veil and dark folds. Rejected as a motion model because every bird follows one path.
- `sketches/elastic.py`: a motion model. Coarse parcels that react to each other, with turns that
  travel as waves; the flock pulled apart and rejoined on its own in one configuration and shattered in
  another.
