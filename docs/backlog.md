# Deferred ideas

Ideas that were discussed and set aside for later, with what is known about
each. Nothing here is scheduled.

## Particle Rivers polish

The current look (gliding silk trails, particles that flow off the wall before
wrapping) is the one to keep. Earlier attempts to taper trails, fade them by
age and thin the heads were rejected because they changed that look, so try
each item below on its own and compare side by side before keeping it.

- **Mid-wall pops.** To keep ink circulating, `ParticleRivers.step` moves
  `ceil(population / 720)` particles per tick (2 at the default 1080) to random
  places. Each one's trail vanishes in place and a new trail grows from a dot
  somewhere else, so trails still blink out in the middle of the wall (no
  longer at its edges). A short fade could hide this:
  - The emission schedule is deterministic, so a fade can be derived at render
    time without storing anything. The 2026-11 attempt at this was
    `riverLife()` in commit 12ade16, reverted in dbbfd06 together with the
    taper.
  - A fade-out must finish before the particle is moved, so it has to look
    ahead along the schedule; a fade-in can start when the particle appears.
- **Sourced emission.** Re-emit particles from a few springs or bands instead
  of uniformly at random, so quiet areas stay quiet and new trails arrive along
  currents. This changes the simulation, so it needs a new revision in the
  scene's parameters (like `edgeVersion`) for old saves to keep their
  behaviour.
- **Streaklines.** The flow field is analytic, so long trails could be drawn
  at render time by integrating backward from each head on the GPU. This would
  give long silky filaments with no extra stored state and exact replay. It
  is the biggest change to the look.
- **Stretched currents.** The flow is computed in a unit square that is
  stretched to the wall's shape, so currents run slightly faster across than
  up and down. Correcting it changes the simulation (needs a revision).

## Slime agent pops

Like Rivers, `SlimeNetworks.step` moves `ceil(population / 1200)` agents per
tick (2 at the default 2,400) to random places, so their marks blink out and
reappear elsewhere. Agent marks are already faint away from veins (the
renderer scales them by the local trail), which hides most of it. A
render-time fade derived from the deterministic schedule would hide the rest
without changing the simulation.

## Composition field

A slow, drifting focus area and quiet area across all four panels (in the
original review as S4), so the wall reads as one composed picture rather than
an even texture. Tried as mock-ups in 2026-11 and set aside; the user was not
a fan. What is known:

- The field itself would be a pure function of wall position, time and seed
  (no stored state, exact replay). The mock used two soft blobs on slow
  Lissajous paths (periods of 7 to 13 minutes) that run continuously through
  the gaps.
- Two ways to use it:
  - Shared: every artwork's colour already passes through the shared finish
    (`FINISH_GLSL`), so the field could dim and desaturate the quiet area of
    every artwork with no per-artwork code. It reads as a moving dimmer or
    cloud shadow, and as "the screens are dimming" when strong.
  - Per artwork: each artwork reads the field and changes its own content,
    for example fewer Rivers trails or thinner Slime veins in the quiet area.
    It reads as composition rather than lighting, but each artwork needs its
    own code and tuning, and a revision setting if it changes the simulation.
- Murmuration and Terrarium compose themselves (sky, camera) and would opt
  out.

## Motion between simulation steps

Entity scenes show the latest whole simulation tick on each display frame,
with no blending. At the default speed 0.7, the simulation advances 42 ticks
per second, so on a 90 Hz display about half of the frames repeat the previous
image, irregularly (30% on a 60 Hz display). Drawing positions interpolated
between the two nearest ticks would make motion continuous at any display
rate, at the cost of re-rendering the scene image every display frame.
Discussed and not wanted for now: the stepping reads as character.

## Terrarium lighting

Moved into the Terrarium Worlds rework rather than done on its own: emissive
sprites writing to a light buffer, ambient light following the time of day,
quantized light levels so it stays pixel art, and dark caverns with pools of
light. Building the lighting first in the rework lets the new landforms be
designed under the final light instead of tuning it twice.
