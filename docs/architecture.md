# Autonomous-world engine

Babel remains a static frontend deployed by GitHub Pages. Run `npm ci`, `npm start`, `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run build:pages`. Node 22+ is required. Vite bundles assets for `/babel-art/`; TypeScript checks the engine and scene contracts. The existing DOM interface remains JavaScript.

## Scene registration

`scenes/registry.ts` registers each scene with its ID, version, kind, description, parameters, visual styles, and optional simulation factory. Procedural shaders live in individual modules. A new scene adds a definition and factory; the application loop does not need a scene-specific branch. `scenes/release.ts` controls staged availability.

Parameter descriptors generate controls and validate imported values. Restart-required settings include population, rule, and grid resolution. Visual styles are independent of simulation state. `engine/commands.ts` validates structured scene, parameter, style, speed, palette, and reseed commands; the rule-based text parser is an adapter. A future voice interpreter can call the same API. No arbitrary generated code is executed.

## Three runtime foundations

- Procedural functions sample world position and time. The original four scenes are preserved as separate shader modules.
- GPU grids alternate state textures. Tapestry provides exact-cell Life and cyclic automata; Chemical Garden implements Gray–Scott reaction–diffusion on floating-point targets.
- CPU entities update independently of rendering. Flocks use a neighbor spatial grid, separation, alignment, cohesion, obstacle repulsion and a moving predator. Platformers use fixed-step collision against generated platforms and autonomous jump decisions.

The GPU compositor uses one shared context for the whole wall. Entity scenes draw into a reusable Canvas2D surface, upload a cached texture once per requested tick/style, and share it across panel views. They are not yet instanced sprite renderers. GPU grids and entity textures retain at most 64 recent samples; entity snapshots retain 64 ticks; checkpoints retain eight snapshots. At the largest current grid size, the GPU history is approximately 40 MiB. Entity image history is approximately 63 MiB. These buffers are cleared when changing worlds. Preview resolution changes presentation only.

WebGL2 is preferred. Chemical Garden requires `EXT_color_buffer_float`. Unsupported floating-point rendering produces an explanation and falls back to a procedural scene; existing shaders can use WebGL1. Context loss pauses usable rendering and restoration reloads the last persisted project. Browser/GPU precision can vary; do not expect cross-device bitwise identity.

## Time, history and seeking

A 60 Hz simulation tick is distinct from presentation refresh. Live scene speed changes advance the clock at a new rate without multiplying past elapsed time. Hidden tabs pause advancement; per-frame elapsed time is capped to avoid catch-up storms. Playback pauses during asynchronous seeks, which replay in yielding batches and can be cancelled.

World bounds are captured from the panel layout when starting a stateful scene and saved with the project. Moving the panels moves windows into the same world; it does not resize the simulation. All initial scenes use continuous world space through gaps. Portals and boundary-driven rules are future extensions.

The timing model selects older state/image samples per panel and chooses current or previous samples per scanout row. It never advances a separate game per display. Clock drift is deliberately disabled for stateful scenes. Sub-tick presentation uses the most recent available state, without interpolation. If requested history predates the retained window (for example immediately after checkpoint restoration), the oldest retained sample is used until history refills.

Live simulation parameter changes are recorded by tick. Checkpoints store their active parameters. Backward seeks restore a nearby checkpoint or the initial recipe and replay parameter events; appearance changes apply to the selected world without changing its physics. CPU state replay is exact in the same runtime. GPU checkpoint replay is tested in the same browser and device.

## Persistence and compatibility

Schema version 2 adds parameters, visual style, world bounds, parameter events, and optional checkpoints. Gallery records and the last project use IndexedDB. Legacy localStorage records are read and migrated without deleting the original keys. Version-1 scene time is converted from its old speed-multiplied representation. Imported world bounds, parameters, event ticks, and checkpoints are validated before replacement. JSON exports carry portable numeric arrays instead of GPU handles; there is a 16 MB import limit.

The gallery includes named snapshots and favorites. Each new gallery entry includes a local preview thumbnail. Export important projects: browser-local storage has no cross-device synchronization and can be cleared by the user/browser.

## Future deployment

The renderer does not assume HDMI topology or hardware frame lock. A coordinator can later distribute versioned recipes, scheduled changes and authoritative snapshots, while renderer nodes retain caches. Stateful GPU simulations need a state-authority/checkpoint strategy; matching seeds and network clocks alone is insufficient. Voice, other autonomous game genres, player controls, and multi-Pi networking remain outside this release.
