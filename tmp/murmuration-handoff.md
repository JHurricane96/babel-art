# Murmuration: brief for the next phase

Written 15 November 2026 for whoever continues this work (a person or a model). It covers one
artwork, Murmuration. The project-wide notes are in `tmp/model-provider-handoff.txt`.

Read sections 1 to 4 before touching code. The rest is reference.

## 1. Where things stand

- **On main:** a three-dimensional starling flock (`engine/murmuration.ts`, 3,000 birds, based on the
  StarDisplay model) over a winter farmland scene, drawn at the wall's display resolution. Merged in
  PR #2 and PR #3. The user's verdict on this version: "This is very good, we've made progress.
  However, there's still something lacking."
- **The working branch** `claude/artwork-review-improvements-bkx0ia` has the same code as main, plus
  this brief and the lab tools in `tools/murmuration-lab/`.
- **Tried and rejected: a trail.** Commit 8989db9 (reverted in d82839a) made every bird follow the
  path of a guide. It produced long curling shapes, but the user said: "This feels like the birds are
  just following a trail, which looks a lot less dynamic." It also looked sparser in the real
  renderer. Do not make path-following the source of motion again.
- **Tried, promising for looks only: a sheet mock-up** (`sketches/sheet_mock.py`). The user called it
  "an interesting idea" but it "lacks a) ripples, b) pulling apart and joining up again".
- **Tried, unfinished: an elastic flock** (`sketches/elastic.py`). See section 6.

What the user has asked for, in their words, in order:

1. "A real murmuration has beautiful ripples and movements in different directions."
2. "I'd also like for it to look grander and more awe-inspiring", with something on the horizon "to
   convey the sheer scale". "Breaking off into smaller clusters occasionally may be fine."
3. "A murmuration has an almost hypnotic structure, where the birds almost move around in curves and
   waves."
4. "I don't need this to track the video exactly. It was supposed to provide a reference and some
   inspiration. This artwork needs to be viewable for hours, not just 30 seconds."
5. "Make it as beautiful as a real murmuration. Keep in mind compute requirements."
6. Hardware: "Probably raspi latest model" (taken here as a Raspberry Pi 5; confirm).

## 2. The goal

Not a copy of any video. The target is an artwork with its own terms:

> **A living sky for a four-panel wall.** One great flock at dusk over winter farmland that behaves
> like weather: it gathers, breathes, ripples, tears and heals, and is never the same twice. A glance
> finds a composed picture. Ten minutes shows events unfold. A whole evening passes without a loop.

It should pass five tests. Each lists what to check and what evidence to produce. The numbers are
guard rails for catching failure. They do not prove beauty, and the user is the judge of that.

| Test | The artwork passes when | Evidence |
| --- | --- | --- |
| **Glance** (any still) | The flock reads as one translucent body with a clear outline: a pale veil where thin, dark where it folds or is seen edge-on. The sky is the lightest thing, the land the darkest, the flock in between. It is composed across the four panels and their gaps. | Real-renderer stills at five or more moments, in two palettes (`capture.mjs`); `tone.py` on sky-only crops: median darkness 0.10–0.20, 95th percentile 0.30 or more, grain 0.6 or less. |
| **Ten seconds** (ripples) | Something travels through the flock: dark fronts that cross it in about half a second to two seconds, at least every few seconds in active passages, and rarely in calm ones. | A clip; a space-time picture (`reference/kymograph.py` on the clip) showing stripes across the flock. |
| **A minute** (events) | Parts pull away and rejoin: a lobe of roughly 10–40% of the birds separates and merges back within about 5–30 seconds, a few times every five minutes. Different parts move in different directions at once. The outline changes character (band, veil, dome, hook), and no bird follows a scripted path. | Clips of 2–3 minutes; `groups.mjs` and `sheet.py`: one piece 50–90% of the time, two to four pieces otherwise, the largest piece never under half, every split healed. |
| **An hour** | Passages with different character lasting minutes, with calm between them. No visible loop. The flock stays on the wall and never ends as a permanent ball or a permanent scatter. | Two-hour simulated runs per seed, three seeds: one-frame-a-minute sheets (`sheet.py`), and first-versus-last-20-minutes width and piece counts within 15% of each other. |
| **The machine** | Smooth on the target hardware at the wall's resolution, with headroom. | Measured on the Pi (section 5). Until then, say "unmeasured". |

What makes it this project's own, beyond any reference: the four-panel composition with a flock that
crosses bezels; palettes that act as weather and time of day; light that drifts through an evening;
arrival and descent to roost as the long arc; and a different evening for each daily seed.

## 3. Working agreements with this user

- **Plan, get approval, then implement.** Show results early. The user redirects quickly and well.
- **Judge by looking, in the real renderer.** Two mistakes to avoid repeating: tuning to numbers
  measured from a video, and judging by the grey offline renderer while the real one got worse.
- **Report truthfully and plainly.** Say what was measured and what was not. Never claim laptop or Pi
  performance that was not measured. Say when something got worse.
- **Write for a reader who was not watching.** Plain language, no internal names without explanation.
- Particle Rivers stays exactly as it is. Do not change other artworks while working on this one.
- Push only to the working branch. Open a pull request only when asked; the user has had each one
  squash-merged and the branch then merged with main (force-pushes are blocked here).
- Simulation must stay deterministic: same seed and time give the same picture, checkpoints replay
  exactly, and the unit tests check this.

## 4. Recommended approach and order of work

Two ideas, each with evidence behind it:

1. **Motion comes from birds reacting to each other.** That is where ripples and breakaways came from
   in the version on main, and what both rejected ideas lacked. Keep a real flock simulation, but:
   - Simulate fewer, coarser birds (about 1,500–2,000 "parcels", each standing for a small group).
   - Stop steering the whole flock at once. On main, every bird feels the roost pull at the same
     moment, so the flock wheels like a rigid blob. Instead let turns begin with a few birds (at an
     edge, or where the flock leaves its area) and spread to the rest as a wave. Where the wave is
     fast you see a ripple; where one part commits to another direction the flock stretches and tears.
   - Let the pieces find each other again.
2. **Looks come from drawing many birds cheaply.** About 50,000 visible birds, placed around the
   simulated ones by the graphics card, give fine even grain, a crisp outline and dark folds. The
   processor then builds no per-bird draw data at all.

Order of work, with a gate after each step:

1. **Budget (first, small).** Add a benchmark mode to the preview that draws 15,000 to 100,000 birds
   the proposed way (section 5) and shows frame time. The user runs it on the Pi at the wall's
   resolution. This fixes the bird counts before anything is tuned. *Gate: numbers from the Pi.*
2. **Motion in the lab.** Change the simulation in `engine/murmuration.ts` as above, reviewing with
   `export.mjs`, `render.py`, `sheet.py`, `groups.mjs`. Aim at the ten-second and one-minute tests.
   *Gate: the user watches 2–3 minute clips.*
3. **Drawing.** Move bird placement to the graphics card; tune marks, grain and tone in the real
   renderer against the glance test. Let the flock pass behind the tree line when it is low.
   *Gate: stills, then the live preview on the user's machine.*
4. **Scene and light** (section 8). *Gate: stills in several palettes.*
5. **Hours** (section 9): moods, the evening arc, long-run checks. *Gate: one-frame-a-minute sheets
   and a few real-time minutes from different hours.*
6. **Integrate.** Saved-artwork version, checkpoints, tests, docs, performance check, pull request.

Steps 2 and 3 can swap if the Pi numbers arrive late, but do not polish looks on a motion model that
has not passed its gate.

## 5. Compute budget

Target: Raspberry Pi 5 (four Cortex-A76 cores at 2.4 GHz, VideoCore VII graphics with OpenGL ES 3.1,
two HDMI outputs). Not confirmed with the user: how many Pis drive the four panels, and at what
resolution. **Nothing here has been measured on a Pi.**

Measured in this cloud container (Xeon at 2.1 GHz, no GPU), version on main, 3,000 birds:

| Item | Cost |
| --- | --- |
| Simulation step, in the browser | 5.4 ms (4.3–4.7 ms in Node) |
| Building draw data in JavaScript (24,750 marks) | 2.4 ms per frame |
| Checkpoint | 487 KB, 2.3 ms to take |
| Graphics card time | not measurable here |

So about 8 ms of a 16.7 ms frame goes on the processor, on the main thread, before any drawing. A Pi
core is slower than this one (how much is unmeasured; plan for half the speed until measured).

Budget to design for, to be corrected by the Pi benchmark:

- **Simulation:** at most 2 ms per displayed frame on the Pi, off the main thread. Ways to get there:
  1,500–2,000 parcels; step the flock at 20–30 Hz in a Web Worker and blend between the last two
  states when drawing; keep the hashed neighbour grid and staggered perception that are already in
  `engine/murmuration.ts`; no per-frame allocation.
- **Drawing:** all per-bird work on the graphics card. Send one small table per frame (each parcel's
  position, heading, bank and local spread, a few floats) as a float texture. A vertex shader places
  each visible bird from its parcel's row plus a fixed per-bird offset. Draw points or small quads of
  2–4 pixels. Quality levels by bird count (for example 15,000, 30,000, 60,000), with marks slightly
  larger and darker at lower counts so the tone holds.
- **Scenery** is drawn once per palette and size and reused, so it costs almost nothing per frame.
  Keep it that way; if the light changes over time, re-render rarely or cross-fade two cached skies.
- **WebGL 1** must keep working (`npm run test:webgl1`). Float textures read in a vertex shader need
  `OES_texture_float` there. Keep the current processor-built path (`MarkStream`) as the fallback at
  a low bird count.
- A flock that is a deterministic function of a seed and a small state also suits a wall driven by
  more than one Pi later (see `docs/architecture.md`).

## 6. What each experiment taught

| Experiment | Result | Lesson |
| --- | --- | --- |
| Flock on main (3,000 birds; roost pull on every bird; escape waves; a breakaway group about every 40 s) | Liked. Has ripples and breakaways. Wheels as one fairly rigid blob about 0.45 of the wall wide; one piece 92% of the time; crosses its own width in about 10 s. | The base to build on. Its weakness is large-scale shape: every bird is steered at once. |
| Trail (commit 8989db9, reverted) | Long curling bands, right pace. Rejected: "just following a trail". In the real renderer it was sparse and faint. Over 30 minutes it drifted to the edges and tightened into balls. | Do not script the path. Do not judge by the offline renderer alone. Long runs reveal drift that short clips hide. |
| Sheet mock-up (`sketches/sheet_mock.py`) | 50,000 real-size birds, about 1 m apart, as a flexible body 10–20 m thick: crisp outline, pale veil, dark folds, grain like real footage. Rejected for motion (same path-following). | Count, even spacing and line-of-sight darkness give the look. Bird marks about 0.4 m, placed with a low-discrepancy sequence, not at random. |
| Elastic flock, "compact" (`sketches/elastic.py`) | 1,600 parcels with spring spacing, turning that spreads as a wave, turns started by small groups. Pulled into two lobes and merged again unscripted: one piece 57% of the time, two 43%, largest never under 0.78. Looked lumpy and shrank to a blob 30% of the frame wide. | The mechanism for pulling apart and rejoining works. Each parcel's cloud of birds shows as a bump: use more parcels or place birds between neighbouring parcels. |
| Elastic flock, "sheet" | Wide thin flock, closer camera. Shattered: three or more pieces 82% of the time; the pieces collapsed into dark pancakes and never rejoined. | Thin sheets tear too easily with those springs. A pull that smooths the edge also compacts fragments. Rejoining needs its own mechanism. |

Untested ideas worth trying:

- **Camera distance.** A flat flock seen from far away at a low angle is always edge-on (a dark band).
  Seen from closer and below it shows its underside (a broad veil), and it changes between the two as
  it moves toward and away from the viewer. Real footage gets much of its drama this way. The camera
  on main is 200 m from the roost with a long lens.
- **Ripples from banking.** A bird shows more wing, and reads darker, when it banks. If a turn spreads
  quickly through the flock, the dark front sweeps across it. The renderer on main already shades by
  wing area. Whether fronts read clearly at the new scale is unverified.
- **Conflicting leaders.** Two groups that commit to different directions at the same time should tear
  the flock between them. That may give splits more reliably than weakening the bonds.
- **Wave-like turning.** In the "inertial spin" model of Cavagna and others, neighbours' headings
  exert a torque on a bird's rate of turn (not on its heading directly), so a turn travels as a wave
  that does not die out. On main, birds copy each other's bank angle, which only diffuses.

## 7. Reference observations

From one 30-second clip of a real murmuration supplied by the user (National Geographic, "Flight of
the Starlings", 1080p, 25 fps; not in the repository). The camera pans slightly and there may be a
cut near 20 s, so speeds are approximate. Use these as a description of the phenomenon, not as targets.

- The flock is a long band: 0.84 of the frame wide (0.68–0.97), 4.6 times longer than tall (3.5–15),
  covering about 6% of the frame.
- It drifts slowly for its size: about 0.03 of its own width per second.
- About a quarter of it moves against the majority at a typical moment.
- It is in two pieces at a typical moment (one to four), the largest holding about 90% of the birds.
  Twice in 30 seconds a strand peeled away and rejoined about 5–6 seconds later.
- Ripples: about ten dark fronts in the first 8 seconds, each crossing the flock in about a second.
- Its outline overlaps itself 59% after 1 s and 37% after 3 s.
- Tone: a pale veil (11–16% darker than the sky at the median) with folds 29–55% darker at the 95th
  percentile and up to 84% at the darkest. Grain is even, like stippling.
- Scene: luminous near-neutral sky, near-black land, small dark irregular trees.

From the papers behind the model on main (read during this work; details in `docs/worlds.md`):

- Hildenbrandt, Carere and Hemelrijk 2010 (StarDisplay): birds react to about seven nearest
  neighbours; banked turns; roost attraction.
- Hemelrijk and Hildenbrandt 2011: flock shape varies more when the flock is larger, birds track
  fewer neighbours, turns are stronger and birds roll into them.
- Hemelrijk, van Zuidam and Hildenbrandt 2015: dark bands are waves of birds banking (showing wing
  area), passed from neighbour to neighbour.
- Cavagna and others 2014 (inertial spin model, arXiv 1403.1202): turns travel as waves; turning
  flocks follow equal-radius paths.
- Storms and others 2019: falcon attacks come mostly from above; the commonest reaction is the flock
  darkening, and waves, splits and merges also occur.

From memory, not re-read (verify before relying on them): Ballerini and others 2008 found starling
flocks thin relative to their width and somewhat denser at the border; Attanasi and others 2014
measured turning information crossing flocks at tens of metres per second.

## 8. Scene, tone and light

Problems seen in the scene on main, compared with real dusk footage:

- **Values are muddled.** The sky is darkest (a saturated teal in the default palette) where the
  birds fly, the far trees are paler than the flock, and the land is only mid-dark. Wanted: the sky
  luminous and lightest behind the flock with a gentle fall-off to the corners, the land near-black,
  the flock between them.
- **Colour is too strong.** A teal or maroon sky reads as illustration. Real dusk is close to neutral
  with a slight warm-to-cool drift. Design the sky in light and dark first, then let the palette tint
  it lightly. Palettes become weather and hour, not colour schemes.
- **The landscape still looks drawn.** The single symmetric tree with a soft halo, the frosted
  conifer-like tree line and the busy mirrored water are the culprits. Wanted: small, dark, irregular
  bare trees in uneven rows with gaps, one cluster of farm buildings, quiet near-black ground, and the
  water reduced to a calm strip of reflected sky.
- **Depth.** The flock is drawn over everything. When it is low it should pass behind the tree line.
- **Composition.** The flock's area should be set from the panel layout so it mostly sits where the
  panels are and crosses between them, instead of hiding in a gap or sitting in one panel.
- **Falcon.** At this scale it is two or three pixels. Either make it a clear small silhouette or
  keep only its effect on the flock.
- The second style, "luminous" (light birds on a night sky), needs retuning after the flock changes.

The user's own comments on backgrounds: an early dusk sky with hills "looks cheap"; the first tree
line "still looks like clipart"; on the plain field, "lower the ground level ... or make the ground itself more
interesting" (the water was the answer to that, with no verdict yet).

## 9. Hours

The user wants this "viewable for hours". Findings from a 30-minute run of the trail version, which
apply to any model: it drifted to an edge or out of view about one minute in five; its width fell
steadily from 0.77 to 0.53 of the frame; it sometimes frayed into crumbs; and each minute differed but
the character never changed. Check for all four.

Proposed structure, not yet agreed in detail with the user:

- **Moods lasting 2–6 minutes**, blending over about half a minute, in a seeded order with no
  immediate repeats and calm moods most common: drift (long quiet bands), coil (folding and rolling),
  divide (two or three clouds that wander and merge), unrest (tight turns, frequent ripples), high
  veil (the flock rises and thins), falcon (attacks grouped into an episode, not on a timer).
- **An evening arc of roughly 25–40 minutes:** small groups arrive and merge; the display; funnels
  pour down to roost; a short quiet sky while the light changes; then a new evening. The user has not
  yet said whether a minute or two of nearly empty sky is acceptable. Ask.
- **Light** drifts slowly through each evening.
- The app already has a seeded schedule for long-run events (`engine/evolution.ts`) and a "Variation"
  setting; use them instead of inventing new controls.

## 10. Code map and gotchas

- `engine/murmuration.ts`: the flock. `CAMERA` and `project()` are shared with the renderer. Forces
  are computed once per step, flight physics in two sub-steps. Neighbour lists are part of the saved
  state (they are refreshed for a third of the birds per step). `attackAt()` schedules falcons.
- `engine/gpu-art.ts`: `EntityGPU` draws Rivers, Slime and Murmuration. For Murmuration:
  `staticSky()` renders the `scenery` shader once and caches it; `drawFlock3D()` builds marks through
  `MarkStream` (12 bytes per vertex, indexed); `wallResolution` asks the runtime for an image the
  size of the displayed wall. Do not disturb the Rivers and Slime paths.
- `engine/runtime.ts`: `imageScale()` and `setOutputDensity()` size the image. The runtime renders
  one image per simulated moment it needs and caches a few, because panels can show different moments
  (the timing simulator).
- `engine/grid.ts` `program()` converts shaders for WebGL 2. It strips `//` comments and splits on
  `;`. Fragment shaders must begin with exactly `precision highp float;`. Avoid GLSL reserved words as
  names (`active` broke once).
- `scenes/registry.ts`: parameters and the hidden `flockVersion` (1 is the old 2D flock, 2 the current
  one). `shared/model.js` validates and migrates saved artworks. A new model should become version 3;
  decide with the user whether version 2 saves keep the old flock or re-form as the new one.
- Tests: `npm test` (58 unit tests; `tests/murmuration.test.js` covers replay, limits, cohesion and
  migration), `npm run typecheck`, and browser suites `test:browser`, `test:worlds`, `test:webgl1`,
  `test:performance` (run with `CHROME_BIN=/opt/pw-browsers/chromium` in the cloud container).
  Cohesion thresholds in the unit test were set for the flock on main; a model that splits by design
  needs them restated, not just loosened.
- Docs to keep in step: `README.md`, `docs/worlds.md`, `docs/art-direction.md`.
- Format touched files with `npx prettier --write`.

## 11. Environment notes

- A cloud container has no GPU. The browser falls back to software rendering: about 10 s per still,
  2 s per video frame. Use the lab tools for motion (section 12). Ask the user to judge the live look
  on their own machine through the preview.
- The preview is an Artifact at https://claude.ai/artifact/RopA9XVnVn7p2YjyhMov3c. To update it: build
  with `npx vite build --base=./ --outDir <scratch>/preview-dist --emptyOutDir`, read the artifact
  first if this session has not published it, then publish `index.html` to that URL with the new
  `assets/*.js` file added and the old one removed.
- GitHub is reached through the GitHub tools, not the `gh` command. Force-pushes are refused; merge
  main into the branch instead.

## 12. Lab tools

See `tools/murmuration-lab/README.md`. In short: `export.mjs` then `render.py` for clips (a minute of
clip in about a minute), `sheet.py` for contact sheets and long runs, `metrics.py` and `groups.mjs`
for guard-rail numbers, `capture.mjs` and `tone.py` for the real look, `cost.mjs` for processor cost.

Baseline for the flock on main (seed 4209, 120 s): width 0.46 of the image (0.33–0.66), length ÷
height 2.8, one piece (two at times), pace 0.10 widths per second, counter-flow 0.31, outline overlap
0.67 after 1 s and 0.36 after 3 s. Over 4 minutes: one piece 92% of the time, largest piece never
under 0.86. Tone in the real renderer: median darkness 0.07–0.27, 95th percentile 0.21–0.56, grain
0.37–0.98.

## 13. Open questions for the user

1. Which Pi, how many of them for the four panels, and what resolution per panel?
2. Is a minute or two of nearly empty sky between "evenings" acceptable?
3. Should artworks saved with the current flock keep it, or re-form as the new one when loaded?
4. Is the flood water in the scene wanted? (No verdict yet.)

## 14. A prompt to start the next session

> Read `tmp/murmuration-handoff.md` and `tools/murmuration-lab/README.md` in the babel-art repository.
> Continue the Murmuration work from step 1 of section 4 (or step 2 if I have not sent Pi numbers
> yet). Tell me your plan for that step before changing code, and show me clips or stills at each
> gate. Work on the branch `claude/artwork-review-improvements-bkx0ia`.
