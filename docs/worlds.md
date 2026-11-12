# Autonomous worlds

The entity engines own physics and checkpoints; `engine/world-art.ts` owns their
presentation. Scenery and animation derive from seed, simulation tick, and
checkpoint state. Rendering cannot advance physics or accumulate hidden paint.

## Platformer Terrarium

The terrain generator supplies a bounded 22-platform expedition with varied
widths, elevations, and gaps. Before each jump, the controller estimates flight
time under gravity and selects horizontal velocity to land inside the next
platform. It proceeds along the generated route; it is not a general game agent
or a search through arbitrary terrain. Landmarks create short survey goals and
are remembered by a 22-bit mask. Falls recover at the current platform. Finished
expeditions generate another seeded route and rotate through three biomes.

The renderer adds parallax forests, ruins or mountains, terrain strata,
vegetation, ambient walkers, weather, landmarks and an animated explorer. The
ambient walkers are scenery, not additional collision actors. All panels view
the same camera and world through their physical gaps. Pixel and geometric
styles preserve the same simulation.

New checkpoints contain eleven values: the previous nine movement/progression
values, the survey mask, and a terrain-generation version. Original nine-value
saves retain their original generated platforms until the next expedition;
resaving includes the version so later loads keep that geometry. Import
validation bounds both new fields. New worlds use the more varied generator.

## Murmuration

A spatial hash finds nearby agents across the toroidal world boundary. Alignment
uses a bounded, rotating sample of up to twelve agents per neighboring cell,
so dense formations do not require every bird to compare with the entire flock.
Alignment
and cohesion use neighboring velocities and wrapped offsets. Separation acts
only at close range so it does not force the flock into uniform dispersion.
Steering turns at most 0.075 radians per tick, and speed responds to local
density. Blended chapter weights guide gathering, split streams and circling;
wind and an optional moving predator perturb the formations. Recovery is logged
through the shared evolution timeline, and strong recovery replaces all agents.

The renderer gives birds independent wingbeats, orientation, depth cues and
palette variation above a layered sky and landscape. Depth cues are visual;
the simulation remains two-dimensional. Four-value agent checkpoints and the
existing schedule metadata remain unchanged.

## Validation

Unit tests cover route completion over 50 seeds, survey memory and replay,
legacy terrain restoration, turn limits, formation cohesion and full recovery.
`npm run test:worlds` checks all three biomes in Chromium, visible evolution,
exact checkpoint replay, bounded history and live playback. It writes review
images under `artifacts/terrarium-*.png` and `artifacts/world-*.png`.
These checks do not establish physical installation performance.
