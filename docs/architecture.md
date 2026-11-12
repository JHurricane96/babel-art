# Autonomous-world engine

Babel remains a static frontend deployed by GitHub Pages. Run `npm ci`, `npm start`, `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run build:pages`. Node 22+ is required. Vite bundles assets for `/babel-art/`; TypeScript checks the engine and scene contracts. The existing DOM interface remains JavaScript.

## Scene registration

`scenes/registry.ts` registers each scene with its ID, version, kind, description, parameters, visual styles, and optional simulation factory. Procedural shaders live in individual modules. A new scene adds a definition and factory; the application loop does not need a scene-specific branch. `scenes/release.ts` controls staged availability.

Parameter descriptors generate controls and validate imported values. Restart-required settings include population, rule, and grid resolution. Visual styles are independent of simulation state. `engine/commands.ts` validates structured scene, parameter, style, speed, palette, and reseed commands; the rule-based text parser is an adapter. A future voice interpreter can call the same API. No arbitrary generated code is executed.

## Three runtime foundations

- Procedural functions sample world position and time. The original four scenes are preserved as separate shader modules.
- GPU grids alternate state textures. Tapestry provides exact-cell Life and cyclic automata; Chemical Garden implements Gray–Scott reaction–diffusion on floating-point targets.
- CPU entities update independently of rendering. Flocks use a neighbor spatial grid, separation, alignment, cohesion, obstacle repulsion and a moving predator. Platformers use fixed-step collision against generated platforms and autonomous jump decisions.

The GPU compositor uses one shared context for the whole wall. Entity scenes draw into a reusable Canvas2D surface, upload a cached texture once per requested tick/style, and share it across panel views. They are not yet instanced sprite renderers. GPU grids and entity textures retain up to 192 recent samples within a 96 MiB GPU-grid budget; entity snapshots retain 192 ticks; checkpoints retain eight snapshots. At the largest current grid size, the GPU history is at most 96 MiB. Entity image history is approximately 63 MiB. These buffers are cleared when changing worlds. Preview resolution changes presentation only.

WebGL2 is preferred. Chemical Garden requires `EXT_color_buffer_float`. Unsupported floating-point rendering produces an explanation and falls back to a procedural scene; existing shaders can use WebGL1. Context loss pauses usable rendering and restoration reloads the last persisted project. Browser/GPU precision can vary; do not expect cross-device bitwise identity.

## Time, history and seeking

A 60 Hz simulation tick is distinct from presentation refresh. Live scene speed changes advance the clock at a new rate without multiplying past elapsed time. Hidden tabs pause advancement; per-frame elapsed time is capped to avoid catch-up storms. Playback pauses during asynchronous seeks, which replay in yielding batches and can be cancelled.

World bounds are captured from the panel layout when starting a stateful scene and saved with the project. Moving the panels moves windows into the same world; it does not resize the simulation. All initial scenes use continuous world space through gaps. Portals and boundary-driven rules are future extensions.

The timing model selects older state/image samples per panel and chooses current or previous samples per scanout row. It never advances a separate game per display. Clock drift is deliberately disabled for stateful scenes. A separate presentation clock measures delay and Hz in real milliseconds even as scene speed changes. Sub-tick presentation uses the most recent available state, without interpolation. If requested history predates the retained window (for example immediately after checkpoint restoration), the oldest retained sample is used until history refills.

Live simulation parameter changes are recorded by tick. Checkpoints store their active parameters. Backward seeks restore a nearby checkpoint or the initial recipe and replay parameter events; appearance changes apply to the selected world without changing its physics. CPU state replay is exact in the same runtime. GPU checkpoint replay is tested in the same browser and device.

## Persistence and compatibility

Schema version 2 adds parameters, visual style, world bounds, parameter events, and optional checkpoints. Gallery records and the last project use IndexedDB. Legacy localStorage records are read and migrated without deleting the original keys. Version-1 scene time is converted from its old speed-multiplied representation. Imported world bounds, parameters, event ticks, and checkpoints are validated before replacement. JSON exports carry portable numeric arrays instead of GPU handles; there is a 16 MB import limit.

The gallery includes named snapshots and favorites. Each new gallery entry includes a local preview thumbnail. Export important projects: browser-local storage has no cross-device synchronization and can be cleared by the user/browser.

## Future deployment

The renderer does not assume HDMI topology or hardware frame lock. A coordinator can later distribute versioned recipes, scheduled changes and authoritative snapshots, while renderer nodes retain caches. Stateful GPU simulations need a state-authority/checkpoint strategy; matching seeds and network clocks alone is insufficient. Voice, other autonomous game genres, player controls, and multi-Pi networking remain outside this release.


## Continuous evolution and recovery

Chemical Garden now has a changing divergence-free transport field and seeded moving reagent emissions. Living Tapestry emits gliders or cyclic waves on deadlines checked every engine tick, so a generation rate such as 9 Hz cannot skip the event schedule. Murmuration continuously blends gathering, split-stream and vortex influences, changes predator presence, and gently redirects selected agents. `Variation` controls these influences independently from playback speed; `Automatic recovery` controls the stagnation policy. For an unforced experiment, use Variation 0 and disable recovery and autonomous events.

The shared evolution module owns deterministic deadlines and activity policy. GPU grids expose a 32×20 activity sample rather than reading the full-resolution display. Entity scenes expose compact occupancy samples. The monitor samples at staggered intervals, keeps eight observations, and detects low spatial contrast or low temporal change. Empty fields receive a first intervention after two sampled seconds; otherwise quiet states receive help after ten seconds. Actions escalate no faster than once per eight seconds, from local nudges through regional renewal to strong regeneration. Pause and hidden tabs freeze monitoring. Numerical failure requests strong regeneration. The renderer has an independently evolving world-space layer that gradually becomes more prominent during recovery, and hides invalid colors. This is a product fallback, not a promise that every arbitrary simulation parameter will remain physically self-sustaining.

Schedules and pending actions are included in checkpoints. Health-driven interventions are recorded with their simulation tick and validated on import. After 2,048 recorded edits/interventions, the runtime summarizes the preceding history in an exact checkpoint. Replay is then limited to that anchor and later times; the time controls reflect this limit. GPU/image/state history retains the existing fixed budgets. Background project persistence is once per minute, with immediate debounced saves for edits.

Interference Bloom and Living Contours are analytic shader scenes with continuously changing geometry. They have no population or concentration state that can become extinct. All presentation still uses common wall coordinates and per-panel timing. Physical presentation time continues advancing in real milliseconds even when simulation catch-up is capped on a slow host.

## Validation for long runs

Normal artwork changes use fast unit/browser regressions and accelerated runs of the actual simulation across seeds. A multi-hour soak is an occasional shared-runtime or installation qualification check, rather than a requirement for each new artwork.

`npm run test:evolution` checks forced extinction recovery on the GPU, intervention replay, compaction round trips, and visible change in both analytic scenes. Unit checks also advance the controller through eight simulated hours; that is not a wall-clock soak.

For an actual real-time run: `npm run test:soak -- --hours 8 --scene chemical`. The command builds an isolated instrumented production bundle under ignored `artifacts/soak-site/`, launches its own browser, and writes `artifacts/soak-chemical.json`. Supported scenes also include tapestry, murmuration, interference, contours, and platformer. The runner samples visible frame changes, JS heap, FPS, activity and recovery counts, and every bounded history container. A failed invariant stops the run and records the failure. Reports explicitly say running, failed or passed; only a completed run establishes the corresponding duration. Normal production builds omit the test instrumentation.

## Materials, chapters, and Particle Rivers

`engine/display.ts` owns grid presentation independently of GPU simulation updates. Chemical concentration is bilinearly interpolated for shading without requiring float-linear texture extensions. Lighting, pigment, membrane accents, and world-space grain only affect presentation. Flat rendering remains available. Procedural scenes receive the same Surface detail control; entity scenes draw palette-aware layers through shared canvas helpers. The palette catalog is shared by project validation and text commands.

`engine/choreography.ts` supplies continuous, seeded chapter weights from simulation time. Murmuration and Particle Rivers blend gathering, splitting, and vortex influences rather than jumping between modes. The particle engine advects a fixed population, stores six previous trail points per agent, and recirculates a small deterministic source each tick to prevent permanent concentration on a few orbits. The full trail is included in checkpoints and validated on import. Rendering does not depend on a growing trail canvas or hidden paint history.

Entities use a separate, lightweight compositing shader. Their canvas requests `willReadFrequently` because each new image is transferred into a WebGL texture; this avoids expensive cross-context transfers with the software renderer. Entity snapshot history is capped at 192 frames and an estimated 24 MiB of numeric payload, with eight checkpoints and 64 cached image textures. JavaScript object overhead and GPU allocations are additional to the numeric payload. This preserves recent delayed frames while limiting the memory cost of larger particle populations. `npm run test:visuals` checks GPU rendering, still-frame color/contrast, appearance controls that preserve physics, exact browser replay of particle trails, and minimum progress during a short live playback check. Visual review remains necessary to assess composition and material quality.

## Slime Mold Networks and adaptive presentation

The network engine uses a 192×120 scalar trail field and 600–4,000 fixed agents. Each agent compares three forward trail/nutrient sensors, turns, moves and deposits trail. Diffusion and decay prune abandoned paths; five moving nutrient pools and a deterministic recirculating source sustain renewal. A fixed 120-step warm start supplies an established initial weave at playhead zero. Mycelium, Copper Delta and Night Bloom use different sensor geometry, steering, persistence, population and appearance. Preset data lives with the scene; the editor uses the optional `Scene.presets` interface. Restart identity is derived from all parameters marked `restart`, including hidden topology settings.

Trail values are clamped to [0,1], positions wrap in the shared world, and every agent plus the full trail field is checkpointed. Nutrient fields are derived from the seed, tick and Variation, so they do not add hidden replay state. Strong recovery clears the trail and replaces every agent; interventions use the shared recorded timeline. Rendering combines a tone-mapped pigment field, grain and fine directional marks following actual agents. Canvas image buffers are reused and redrawn completely, without accumulating paint history.

The network requests a 32 MiB numeric history budget to retain enough recent state for the timing simulator at high playback speeds. Other entities retain their 24 MiB budget; the runtime caps any requested budget at 48 MiB and 192 frames. Cached entity images now also have a 64 MiB pixel payload budget, in addition to the 64-image cap. Object overhead and driver allocations are additional. Presentation-scale changes delete cached image textures while preserving simulation history, checkpoints and events.

`AdaptiveQuality` evaluates active frame intervals in one-second windows. After a two-second warmup, two slow windows below 28 FPS lower resolution by 12.5 percentage points; twelve fast windows above 52 FPS raise it. Auto is bounded between 50% and 150%. Pauses, hidden tabs, pending replay and long stalls reset observation windows without changing scale. The compositor and entity image generation share the scale; automatic quality never changes agent populations, simulation resolution, rules, speed or physical display timing. Manual Economy/Balanced/High bypass adaptation. The controller has constant-size state and is independent of project persistence.

`tests/slime.test.js` exercises actual feedback evolution across presets/seeds, exact diffusion-tick checkpoint replay, invalid-state recovery, nutrient renewal and quality hysteresis. `npm run test:networks` checks the rendered presets, their UI, exact recovery replay, saves, adaptive/manual resolution changes and bounded live playback in Chromium. Accelerated simulation checks and still-frame review complement short live browser tests; they do not establish installation hardware performance or an hours-long soak result.
