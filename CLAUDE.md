# Working in this repo

## Testing what Vista draws

Cloud sessions have no GPU. Chromium draws in software (SwiftShader), so a whole world frame takes
about 4 s, and a cold page load (making today's land) takes many seconds more. Slow checks have had
to be sped up again and again. Keep them fast from the start:

- **Use the harness** (`tools/strata-lab/vista/harness/README.md`). One browser stays open with the
  land and sprites saved, and checks are small scripts sent to it. Never cold-load the page for each
  check, and don't write one-off Playwright scripts that start their own browser.
- **Test at the smallest level that can show the problem:** Node (drawings, packing: `sheet.ts`),
  then the sprite lab (`?lab=sprites`, no land), then the warm world.
- **Every new or changed sprite** gets `run.mjs walk names=...`, which catches shrinking, jumps, and
  pops in and out from far off to right by the camera. It also gets a contact sheet to look at
  (`sheet.ts`, or `run.mjs sheet`).
- **Don't draw what you don't need.** Step without drawing (`vista.step(dt, false)`) and draw only
  the frames you measure. Answer the question with arithmetic where you can, as the `ground` check
  does.
- **For a new class of problem, write a dedicated check** in `harness/checks/` and add it to the
  README's table, rather than repeating slow whole runs.
- **Time checks** (`run.mjs` prints timings). If one takes more than a minute or two, make it faster
  before running it again.
