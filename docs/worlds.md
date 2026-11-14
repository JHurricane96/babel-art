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

## Murmuration, revision 2

New Murmuration projects use a three-dimensional starling flock
(`engine/murmuration.ts`), 3,000 birds by default and up to 4,000, modelled on
StarDisplay (Hildenbrandt, Carere & Hemelrijk 2010). Units are SI. Each bird
reacts to its seven nearest neighbours, refreshed every 50 ms: separation,
alignment and cohesion that is stronger for birds at the edge. Birds turn by
banking, so turns carry momentum across the flock. A roost area, deeper than
it is wide, keeps the flock wheeling in front of the viewer. A preferred height
and a floor keep it aloft.

Escape manoeuvres spread from bird to bird with the published recognition and
reaction delays (Hemelrijk et al. 2015). A banking bird shows the camera more of
its wings, so these waves read as dark bands. Startles, turns started by a few
birds, and roughly every 40 seconds a breakaway group keep the flock changing
without a predator. A weak pull toward the whole flock draws breakaway groups
back. Falcon attacks (optional, on by default) come mostly from above, after
Storms et al. (2019). The flock parts around the falcon, and a fast attack
makes it burst outward.

The renderer draws each simulated bird as several visible birds placed around
it, each a soft mark whose darkness and thickness follow the wing area facing
the camera. Every fourth bird also contributes a faint wide disc, so deep parts
of the flock gain a smooth body. The image is drawn at the displayed size of
the wall (`wallResolution` on the renderer), not 640×400 times preview quality,
so birds stay sharp on large panels. The scenery is an overcast evening over
fields with bare trees, poplar rows and farmhouses along a low horizon. It is
rendered once per appearance and size and reused. Silhouette is the default
style; luminous shows light birds against a night sky.

Checkpoints hold eight values per bird (position, velocity, bank and escape
clock), plus the evolution schedule, the current attack's aim and the neighbour
lists. The hidden `flockVersion` parameter is 2 for new projects. Imported
projects without it receive revision 1 and keep the original two-dimensional
flock and its rendering until they start a new variation.

## Validation

Unit tests cover route completion over 50 seeds, survey memory and replay,
legacy terrain restoration, turn limits, formation cohesion and full recovery.
`npm run test:worlds` checks all three biomes in Chromium, visible evolution,
exact checkpoint replay, bounded history and live playback. It writes review
images under `artifacts/terrarium-*.png` and `artifacts/world-*.png`.
These checks do not establish physical installation performance.
