# Continuous cellular ecology and Terrarium Worlds

## Living Tapestry

New projects use Conway's B3/S23 update with composed initial colonies and a
versioned ecological director. Crosscurrents, Bloom Fields, and Constellations
combine twelve standard patterns: four spaceships, five long transients, the
Gosper gun, pulsar, and pentadecathlon. Seeded placement, orientation, and
reflection give colonies different encounters. The birth/age channel and fading
traces are appearance; the Conway neighborhood remains exact and toroidal.

The director reads cellular state twice per simulation second, measures change
in twelve regions, and remembers up to 32 regional hashes. This catches fields
that retain a few survivors or repeatedly oscillate without developing. Normal
renewal occurs approximately every four to eight seconds at the default
variation setting; quiet fields receive earlier help. Up to four local patches
are renewed per event, with a combined footprint no larger than ten percent of
the field. Locations rotate across the composition. Cosmetic animation is not
part of the activity measure.

Ecology `unassisted` disables the director and automatic recovery without
replacing the cellular field. Autonomous events and Variation also control
normal renewal. Imported pre-director recipes receive ecology revision 1,
including their saved initial parameters, checkpoint parameters, and edits.
They retain their old schedule until the user restarts or chooses a new preset.
New recipes use revision 2. The director's deadline, serial, previous binary
field, recent hashes, and regional timestamps are checkpointed and validated.

## Terrarium Worlds

`terrarium-worlds` is a separate scene. The original `platformer` artwork and
its nine/ten/eleven-value checkpoint compatibility remain available.

The new world uses nine active 320-pixel chunks around one 960×600 viewport.
Each chunk begins with a connected three-level navigation skeleton. Six height
and placement motifs combine with four biome grammars. Canopy settlements use
narrow boughs and hanging routes; fungal caverns use broader stone shelves;
aqueducts add cargo lifts, arches, and waterwheels; tidal ruins add islands,
ferries, and water. Layout, resources, vegetation, architecture, and palettes
all vary. Unseen chunks ahead are generated as the camera advances; retired
chunks behind it are discarded. The camera travels forward, so retired
modified chunks are not revisited.

The default 72 inhabitants comprise explorers, haulers, builders, grazers,
pollinators, and hunters. Population presets are 48, 72, and 128. Graph routes
include jumping, climbing, lifts, and ferries. Motion uses fixed ticks; route
searches occur on goal changes, with bounded graphs and paths. This is authored
autonomous behavior over generated reachable routes, rather than a learned
agent or arbitrary-platform game solver.

Pollinators replenish nearby fruit growth; grazers eat and distribute seeds;
haulers gather renewing materials and deliver them to structures; builders
consume delivered stock to repair routes; explorers activate landmarks;
hunters create pursuits and faster grazer flight. Hunger sends humanoid actors
to food, and low energy introduces rest. Plants regrow, actors age and are
replaced outside the view, and obsolete routes are replanned. A fixed-size
event director introduces blooms, local maintenance needs, migrations, and
rediscoveries. There is no population extinction loop.

The atlas contains twelve actor archetypes with ten action states and four
animation frames, twenty plant/resource families with four stages per biome,
twelve structures with three conditions, terrain materials, and props. It is
generated from original pixel templates, seed, and palette at startup or on
appearance changes. Normal playback does not redraw or upload a canvas.
Sprites and terrain use nearest-neighbor sampling at a fixed logical pixel
resolution. The shared camera and display history preserve one continuous
world across physical monitor gaps and timing offsets.

Checkpoints retain active chunk resources/structures, actors and routes,
camera travel/dwell state, event deadlines, weather, and counters. Immutable
chunk geometry and atlas resources are regenerated. Render frames hold compact
numeric visual state and references to immutable chunk geometry.

## Validation

`npm run test:compelling` checks reference/GPU Conway agreement, all Life
presets, four distinct terrarium compositions, exact replay, portable saves,
appearance changes that preserve physics, and bounded live playback. It saves
review screenshots in ignored `artifacts/`. Unit tests cover pattern periods,
local renewal, unassisted mode, legacy recipes, connected terrain across 100
seeds, resource interactions, chunk retirement, and replay.

`npm run test:artwork-stress` advances Particle Rivers, Slime, Murmuration, and
each Terrarium Worlds starting biome through thirty **simulated** minutes,
checking finite state, bounded world storage, and exact future replay.
`npm run test:life-stress` advances the actual GPU Life simulation through
thirty simulated minutes per preset, checking distributed activity and quiet
intervals. Set `BABEL_STRESS_MINUTES` to change the simulated duration. These
are accelerated checks, not wall-clock installation qualification. Reports
under `artifacts/` distinguish completed runs from unfinished runs.
