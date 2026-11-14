# Babel Art

A frontend-only generative art wall lab: four movable display windows into one continuous physical world, plus a deterministic simulator of display timing differences.

## Run

Requires Node.js 22+. Install the locked development dependencies first.

```sh
npm ci
npm start
# Open http://localhost:4173
npm test
npm run typecheck
```

For automated browser checks, install Chromium on your system and run `npm run test:browser`. Set `CHROME_BIN` to a different Chromium binary if necessary. The check uses local ports 4174 and 9223 and writes ignored screenshots to `artifacts/`.

The app is a static Vite bundle with TypeScript scene modules and WebGL. The development server is a local convenience; static hosting can serve the project without a backend. Serve over HTTP rather than opening index.html as a file. A GitHub Actions workflow packages and deploys the frontend to GitHub Pages.

## GitHub Pages

The `Deploy GitHub Pages` workflow runs core tests, packages only browser assets into `dist/`, and deploys on pushes to `main`. It can also be run manually from Actions. No API keys or custom secrets are needed.

One-time setup: open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. Then open **Actions → Deploy GitHub Pages** and run the workflow (or re-run a failed deployment after enabling Pages).

Expected default address: https://JHurricane96.github.io/babel-art/ . The successful deployment job reports the actual URL. Private repositories require a GitHub plan that supports Pages; keep the repository private unless you intentionally choose to change its visibility. The published app and its frontend assets are normally publicly accessible even when the source repository is private.

To inspect the deployment package locally, run `npm run build:pages`. Only the HTML entry point and bundled browser assets are included. Tests, development scripts, documentation, and Git metadata are excluded. Relative URLs support the `/babel-art/` project path without rewriting the app.

The hosted app uses browser storage at its hosting origin. Localhost saves do not transfer automatically; export and import JSON to move work to the hosted app.

## Explore

- Choose Tidal Ribbons, Julia Garden, Gap Travelers, Sync Study, Living Tapestry, Chemical Garden, Murmuration, or Platformer Terrarium. Change palettes, speed, and seeds. The daily seed uses the date displayed in the inspector.
- Drag panels or use Layout to edit their active dimensions, position, rotation, and bezel in millimeters. Preset gaps measure housing-to-housing distance; two bezels add to the hidden image distance.
- Pause, enter a time, scrub, or step by 1/60 second. Time is an unscaled simulation clock; scene speed applies after timing calculations.
- In Timing, apply an illustrative preset, select a panel, and tune delay, Hz, refresh phase, delivery jitter, drift, and scanout direction. Switch A/B to compare configured timing against a common 60 Hz aligned reference. Pause first for exact comparisons.
- Type simple commands such as “show chemical garden”, “show flocking”, “show platformer”, “geometric”, or the existing commands: calmer/slower, faster, fireflies/particles, ribbons/waves, fractal/Julia, warmer, cooler. Commands are rule-based; Undo restores the previous project edit.
- Save named artworks, mark favorites, and restore them from Gallery. Export/import JSON for portable backups.

Browser storage holds the last working project and saved collection. It is local to the browser/origin and is not cloud synchronized. Storage is best-effort; export important work. Imports are validated before replacing current work. A loaded or imported artwork opens paused at its saved time; the last working session resumes playback on startup. Session persistence occurs after edits and every minute. Stateful scenes save a portable checkpoint; larger saves use IndexedDB. Browser shutdown may interrupt an in-flight save.

WebGL is required. Preview quality controls rendering resolution; the FPS counter measures this browser, not eventual Pi or monitor performance. Browser animation can be throttled in background tabs.

See [Architecture](docs/architecture.md) and [Timing experiments and hardware validation](docs/timing.md).

## Autonomous worlds

- **Living Tapestry:** Conway’s Life and cyclic automata, with generation trails, configurable rate/resolution, and seeded colony injections.
- **Chemical Garden:** GPU Gray–Scott chemistry, coral/dividing-cell/labyrinth presets, feed/kill controls, and embossed/flat styles. Selecting a preset starts a fresh garden; **Restart garden** also recovers a collapsed saved simulation while preserving your chosen parameters. Requires WebGL2 floating-point render targets.
- **Murmuration:** Interacting agents with flocking, obstacle avoidance, changing attractors and an optional predator.
- **Particle Rivers:** Seeded agents trace luminous currents, tributaries and moving vortices. Fixed-length trails and continuous recirculation keep the ink flowing without accumulating canvas history.
- **Slime Mold Networks:** Sensing agents build and abandon a shared trail field around moving nutrient pools. Mycelium, Copper Delta and Night Bloom presets combine topology, trail memory, color and surface style. The field starts with an established weave; use **Restart network** to start it again.
- **Platformer Terrarium:** Autonomous exploration of seeded platform worlds, collectibles, recovery and level progression. Pixel and geometric styles share the same game state. There are no player controls.

Stateful scenes have fixed-step simulation, bounded recent history, saved checkpoints and cancellable replay when seeking. Scene-clock drift remains available only for procedural scenes. Timing still illustrates presentation differences rather than measuring real monitor synchronization.

Use `ENDURANCE=1 npm run test:browser` for accelerated 30-minute simulation checks per new scene. These are simulation-time checks, not a 30-minute wall-clock hardware soak test. Screenshots and performance are captured in the test browser; Pi performance is unverified.

Chemical-specific regression checks: `npm run test:chemical` tests the actual GPU simulation for ongoing activity, spatial contrast, preset selection and restart behavior.

## Continuous evolution

- **Variation** adds changing chemical currents, timed cellular emitters, and evolving flock formations.
- **Automatic recovery** detects low activity and renews exhausted regions. It is independent of the optional autonomous-event controls.
- A continuously evolving visual layer supports the scene while it recovers. The simulation stays shared across all screens.
- **Interference Bloom** and **Living Contours** add two continuously morphing procedural artworks.
- Save/load retains evolution schedules and recovery events. Very long event histories are compacted into a checkpoint, which becomes the earliest replayable time.

Run `npm run test:evolution` for the recovery and visual regressions. Run `npm run test:soak -- --hours 8 --scene chemical` for a real eight-hour browser soak. Its JSON report is written under `artifacts/`; simulated-time tests do not replace this validation.

## Richer still frames

The simulation scenes now expose **Surface detail**, independent of Variation and playback speed. Chemical Garden adds smooth pigment shading and membrane relief; Tapestry has colored mosaic cells; Murmuration adds fine flight trails and connections. Interference Bloom and Living Contours add veins and strata. Four new palettes bring the catalog to eight. Appearance changes preserve the simulation state.

All artworks except the sync study share a finishing pass: highlights roll off instead of clipping, a fixed dither removes 8-bit banding, and palettes expand into perceptual color roles so blends keep their saturation. Julia, Contours, Slime, Chemical, Life and Terrarium Worlds have presentation-only refinements on top of that. They change no simulation state, checkpoint or replay.

See [art direction](docs/art-direction.md) for the composition goals. `npm run test:visuals` checks real browser rendering, color/contrast, appearance controls, particle replay and portable checkpoints, and saves review images in `artifacts/rich-*.png`. Normal per-artwork validation uses short browser checks and accelerated simulations; multi-hour soaks are reserved for runtime or installation qualification.

## Autonomous world upgrade

Platformer Terrarium traverses three biomes: Glasswood, Amber Ruins and Tidal Observatory. The explorer plans jumps over varied terrain, surveys landmarks once, and proceeds through seeded expeditions. Parallax scenery, vegetation, ambient creatures, weather and an articulated explorer add activity at several scales. Gameplay remains autonomous.

Murmuration supports 20–900 birds (480 by default), with local alignment, short-range separation, wrap-aware cohesion, limited turning and density-dependent speed. Gathering, splitting and circling chapters shape coordinated groups above a landscape. Luminous and silhouette styles use individual wingbeats and depth cues. A visible hunting bird corresponds to the optional predator influence.

Run `npm run test:worlds` for biome review images, exact replay and bounded live playback of both artworks. See [world implementation](docs/worlds.md) for behavior and save compatibility.

## Adaptive preview quality

Preview resolution defaults to **Auto**. It reduces resolution after sustained slow frames and cautiously restores it after a longer period of fast frames. The same scale applies to all four panels and to entity image textures. Pauses, hidden tabs and replay work do not drive adaptation. Economy, Balanced and High remain available for a fixed resolution.

Quality changes preserve every agent, trail, simulation rule, playhead and timing setting. They adjust the displayed image resolution; they cannot eliminate a CPU simulation bottleneck. Preview quality is a local session setting, independent of saved artwork recipes.

`npm run test:networks` reviews all three network presets, their visual range and evolution, invalid-state recovery, exact replay, project validation, non-destructive quality changes and bounded live playback. Review screenshots are saved under `artifacts/slime-*.png`.

Living Tapestry now offers directed Conway ecology with composed colonies and
an unassisted mode. **Terrarium Worlds** adds an autonomous pixel-art world with
six interacting inhabitant roles, procedural terrain, renewable resources,
construction, weather, and a roaming camera; the original terrarium is still
available. Particle Rivers, Slime Mold, and Murmuration use native WebGL
renderers and compact display history. See [artwork behavior and validation](docs/compelling-artworks.md)
and [performance qualification](docs/performance.md).
