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

Browser storage holds the last working project and saved collection. It is local to the browser/origin and is not cloud synchronized. Storage is best-effort; export important work. Imports are validated before replacing current work. A loaded or imported artwork opens paused at its saved time; the last working session resumes playback on startup. Session persistence occurs after edits and every ten seconds. Stateful scenes save a portable checkpoint; larger saves use IndexedDB. Browser shutdown may interrupt an in-flight save.

WebGL is required. Preview quality controls rendering resolution; the FPS counter measures this browser, not eventual Pi or monitor performance. Browser animation can be throttled in background tabs.

See [Architecture](docs/architecture.md) and [Timing experiments and hardware validation](docs/timing.md).


## Autonomous worlds

- **Living Tapestry:** Conway’s Life and cyclic automata, with generation trails, configurable rate/resolution, and seeded colony injections.
- **Chemical Garden:** GPU Gray–Scott chemistry, coral/dividing-cell/labyrinth presets, feed/kill controls, and embossed/flat styles. Selecting a preset starts a fresh garden; **Restart garden** also recovers a collapsed saved simulation while preserving your chosen parameters. Requires WebGL2 floating-point render targets.
- **Murmuration:** Interacting agents with flocking, obstacle avoidance, changing attractors and an optional predator.
- **Platformer Terrarium:** Autonomous exploration of seeded platform worlds, collectibles, recovery and level progression. Pixel and geometric styles share the same game state. There are no player controls.

Stateful scenes have fixed-step simulation, bounded recent history, saved checkpoints and cancellable replay when seeking. Scene-clock drift remains available only for procedural scenes. Timing still illustrates presentation differences rather than measuring real monitor synchronization.

Use `ENDURANCE=1 npm run test:browser` for accelerated 30-minute simulation checks per new scene. These are simulation-time checks, not a 30-minute wall-clock hardware soak test. Screenshots and performance are captured in the test browser; Pi performance is unverified.

Chemical-specific regression checks: `npm run test:chemical` tests the actual GPU simulation for ongoing activity, spatial contrast, preset selection and restart behavior.
