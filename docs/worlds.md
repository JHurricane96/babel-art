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

New Murmuration projects use a three-dimensional flock of 30,000 starlings by
default (up to 40,000), every one drawn (`engine/murmuration.ts`). The approach
follows Frank Force's LittleJS murmuration demo (MIT licence): birds steer from
averages kept on a coarse 3D grid (alignment and cohesion from a bird's cell and
the six it touches, separation from how the count changes across them), so the
cost grows linearly with the number of birds, and a finer density grid read with
smooth interpolation keeps the spacing even. Three slow plane waves, each
drifting and turning on its own, push birds toward their moving crests, so bands
of tighter-packed and darker birds roll through the flock: this is its shimmer.
Panic spreads as in an excitable medium from occasional spontaneous startles,
so each sweeps across the flock once as a band. A slowly drifting
divergence-free flow folds the flock into sheets, and two drifting attractors
each pull half of it, so it splits and rejoins. There is no falcon in this
revision. The simulation runs in the demo's units and is scaled to world metres
for drawing (`WORLD_SCALE`).

Every bird is drawn as one short dash, wing tip to wing tip, in the same ink:
birds are not shaded one by one, so the flock's darkness comes only from how
many overlap along the line of sight. Birds in a panic band are drawn slightly
darker (`engine/murmuration-look.ts`). Each mark's soft falloff is computed per pixel and spans at least about three
output pixels; smaller birds fade instead of shrinking, so they stay smooth and
do not blink. The image is drawn at the displayed size of
the wall (`wallResolution` on the renderer), not 640×400 times preview quality,
so birds stay sharp on large panels. The scenery is a winter evening over
farmland: woodland bands at several distances pale into the sky, with lacy
tops of bare twigs over solid trunks; a poplar row, a hazy barn and a few
nearer bare trees (lopsided, with bending limbs and lacy twig crowns) give scale; flood water across the middle
distance mirrors the horizon glow and the treeline, with reeds on its near
shore, in front of fields furrowed toward a vanishing point; a low mist
softens the tree bases. The horizon sits low, so on the default staggered
layout the lower-right panel shows only the crowns of the nearest trees; stratus, a horizon glow and a fixed grain keep
the sky from looking flat. It is rendered once per appearance and size and
reused. Silhouette is the default
style; luminous shows light birds against a night sky.

Checkpoints hold eight values per bird (position, velocity, panic and its
refractory clock) plus the evolution schedule; at 30,000 birds that is about
4.1 MB of JSON, so shrinking it is a known follow-up. The hidden `flockVersion` parameter is 2 for new projects. Imported
projects without it receive revision 1 and keep the original two-dimensional
flock and its rendering until they start a new variation.

## Validation

Unit tests cover route completion over 50 seeds, survey memory and replay,
legacy terrain restoration, turn limits, formation cohesion and full recovery.
`npm run test:worlds` checks all three biomes in Chromium, visible evolution,
exact checkpoint replay, bounded history and live playback. It writes review
images under `artifacts/terrarium-*.png` and `artifacts/world-*.png`.
These checks do not establish physical installation performance.
