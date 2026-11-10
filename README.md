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

The app itself is static HTML/CSS/ES modules and WebGL. The Node server is a development convenience; static hosting can serve the project without a backend. Serve over HTTP rather than opening index.html as a file. No hosted deployment is configured in this milestone.

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
