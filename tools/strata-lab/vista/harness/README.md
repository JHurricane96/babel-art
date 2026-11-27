# Vista test harness

Checks of what Vista draws, quick enough to run after every change. There are three levels; use the
smallest one that can show the problem.

| Level | What it is | Ready in | Use it for |
| --- | --- | --- | --- |
| **Node** | The drawing and packing code run in Node (`npx tsx`), no browser | under 1 s | how drawings look at each height, packing, anything that is plain code |
| **Sprite lab** | Vista with `?lab=sprites`: the sprites alone, no land, real shaders | about 1 s warm, 4 s cold | every new or changed sprite: growth, pops, fades, contact sheets |
| **Warm world** | The page as visitors see it, held still and stepped by the check | about 5 s warm (land and sprites saved) | what needs the land: cover lists, the ground, the camera, a whole frame |

One browser (`warm.mjs`) stays open between checks, in a profile of its own, so the land and sprites
the page saves are found again. `run.mjs` builds the page again when its code has changed, starts
the browser if it is not running, and sends it the check. Output goes to `$VISTA_HARNESS` (default:
`vista-harness` in the system's temp folder).

```sh
node tools/strata-lab/vista/harness/run.mjs walk names="sage 0,shrub"   # one check
node tools/strata-lab/vista/harness/run.mjs                              # list the checks
node tools/strata-lab/vista/harness/run.mjs --status | --stop
npx tsx tools/strata-lab/vista/harness/sheet.ts "sage,pine 0" 4,5,6,8,16 --parts
```

Under software GL (SwiftShader: no GPU) a whole world frame costs about 4 s, while frames that are
not drawn cost a few ms. So step without drawing (`vista.step(dt, false)`) and draw only the
frames a check looks at. Better still, answer the question without drawing: the ground under the
cover, sizes and distances are all plain arithmetic. With a GPU, `VISTA_GL=gpu` uses it.

## Checks (`checks/`)

| Check | Page | What it finds |
| --- | --- | --- |
| `walk` | lab | Each sprite walked up to from where it is first drawn to as near as the page draws it, with its list's fades, in parts near the camera, and in pixels twice the size past its tallest drawing. Flags it **shrinking**, **jumping** in height, **popping in or out** (how full its outline is changing 1.6x at once), and **gaps**, outside the fades meant to be there. `all=1` checks every sprite (about 3 min); `variants=1` adds mirrored, off to the side, and near-only. |
| `sheet` | lab | A contact sheet (PNG) of sprites as the GPU draws them, at the sizes given. |
| `ground` | world | Nothing drawn: the ground as drawn (the terrain's patches) under every cover sprite in view, frame to frame. Flags bushes sinking into or rising out of the ground, and bushes big enough to be drawn in parts that the frame's parts leave out. 300 frames take about 8 s. |
| `pops` | world | The ID pass (`vista.idFrame`): every cover sprite as drawn, behind whatever stands in front of it, frame to frame. Flags size pops and puts each down to parts, ground, front (only its foot end changed: something nearer moving across it), or other. Overlap with neighbours still shows up as other, so use it to look, not as a pass or fail. Slow: about 4 s a frame. |

A check is a module: `export const page = "lab" | "world"` and
`export default async ({ page, args, log, out }) => result`. `page` is a Playwright page, so
`page.evaluate(() => window.vista...)`. A result with `ok: false` makes the exit code 1. A one-off
check can live anywhere (`run.mjs path/to/check.mjs`). When a new class of problem comes up, write
a check for it here rather than repeating slow whole runs.

## Hooks in the page (`window.vista`)

- `hold()` and `step(dt, draw = true)`: stop the loop, then move it on with or without drawing.
- `walk(name, opts)`, `spriteGrowth(name, sizes, crops)`: one sprite alone at many sizes.
- `idFrame(list)`: the last frame drawn again as IDs. For each sprite shown: where it stands, its
  pixels, and its top, bottom, left and right.
- `groundUnder([x, z, ...])`: the ground's height as the last frame's terrain patches draw it.
- `camera()`, `cover()`, `readArt([x, y, w, h])`, `setS`, `setMode`, `coverNow`, `saved()`.

Under ANGLE on SwiftShader, a frame cropped to part of the view (`vista.crop`) does not always draw
its sky there. Checks draw whole frames and read back only the part they need.
