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
