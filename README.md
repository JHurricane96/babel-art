# Babel Art

A frontend-only generative art wall lab: four movable display windows into one continuous physical world, plus a deterministic simulator of display timing differences.

## Run

Requires Node.js 22+; no package installation is needed.

```sh
npm start
# Open http://localhost:4173
npm test
```

For automated browser checks, install Chromium on your system and run `npm run test:browser`. Set `CHROME_BIN` to a different Chromium binary if necessary. The check uses local ports 4174 and 9223 and writes ignored screenshots to `artifacts/`.

The app itself is static HTML/CSS/ES modules and WebGL. The Node server is a development convenience; static hosting can serve the project without a backend. Serve over HTTP rather than opening index.html as a file. A GitHub Actions workflow packages and deploys the frontend to GitHub Pages.

## GitHub Pages

The `Deploy GitHub Pages` workflow runs core tests, packages only browser assets into `dist/`, and deploys on pushes to `main`. It can also be run manually from Actions. No API keys or custom secrets are needed.

One-time setup: open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. Then open **Actions → Deploy GitHub Pages** and run the workflow (or re-run a failed deployment after enabling Pages).

Expected default address: https://JHurricane96.github.io/babel-art/ . The successful deployment job reports the actual URL. Private repositories require a GitHub plan that supports Pages; keep the repository private unless you intentionally choose to change its visibility. The published app and its frontend assets are normally publicly accessible even when the source repository is private.

To inspect the deployment package locally, run `npm run build:pages`. Only `index.html`, `style.css`, `simulator/`, `renderer/`, `shared/`, and `.nojekyll` are included. Tests, development scripts, documentation, and Git metadata are excluded. Relative URLs support the `/babel-art/` project path without rewriting the app.

The hosted app uses browser storage at its hosting origin. Localhost saves do not transfer automatically; export and import JSON to move work to the hosted app.

## Explore

- Choose Tidal Ribbons, Julia Garden, Gap Travelers, or Sync Study. Change palettes, speed, and seeds. The daily seed uses the date displayed in the inspector.
- Drag panels or use Layout to edit their active dimensions, position, rotation, and bezel in millimeters. Preset gaps measure housing-to-housing distance; two bezels add to the hidden image distance.
- Pause, enter a time, scrub, or step by 1/60 second. Time is an unscaled simulation clock; scene speed applies after timing calculations.
- In Timing, apply an illustrative preset, select a panel, and tune delay, Hz, refresh phase, delivery jitter, drift, and scanout direction. Switch A/B to compare configured timing against a common 60 Hz aligned reference. Pause first for exact comparisons.
- Type simple commands: calmer/slower, faster, fireflies/particles, ribbons/waves, fractal/Julia, warmer, cooler. Commands are rule-based; Undo restores the previous project edit.
- Save named artworks, mark favorites, and restore them from Gallery. Export/import JSON for portable backups.

Browser storage holds the last working project and saved collection. It is local to the browser/origin and is not cloud synchronized. Storage is best-effort; export important work. Imports are validated before replacing current work. A loaded or imported artwork opens paused at its saved time; the last working session resumes playback on startup. Automatic session persistence occurs after edits, every ten seconds, and when leaving the page.

WebGL is required. Preview quality controls rendering resolution; the FPS counter measures this browser, not eventual Pi or monitor performance. Browser animation can be throttled in background tabs.

See [Architecture](docs/architecture.md) and [Timing experiments and hardware validation](docs/timing.md).
