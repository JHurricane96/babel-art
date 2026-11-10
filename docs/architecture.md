# Architecture and next milestones

## Current runtime

One in-memory `project` is authoritative. Scene, geometry and timing edits flow through the simulator into four WebGL renderers. UI-only state (selected panel, tab, resolution, playback status) stays separate. A monotonic `performance.now()` clock advances the shared playhead; requestAnimationFrame schedules previews rather than establishing independent clocks for each panel. Saved JSON contains the playhead but no running clock.

The localStorage keys `babel.project.v1` and `babel.gallery.v1` hold the working project and named gallery snapshots. Writes are debounced; rendering does not write storage each frame. There is no authentication, server state, or network dependency once application assets are loaded. This is not an offline-installable PWA.

## Project contract (schemaVersion 1)

- `scene`: registered id, version, integer seed, palette, motion speed.
- `layout`: four uniquely identified panels; x/y describe the unrotated active rectangle's upper-left, width/height the active image area in mm, bezel extends outside it, rotation is clockwise around the center in degrees.
- `layout[].timing`: delay/jitter/phase in milliseconds, refresh `hz`, clock `drift` in ppm, and scanout direction.
- `time`: wall playhead in seconds (0–86400); `timingEnabled`: configured timing versus reference.

Import accepts only supported versions, scenes and finite bounded settings. It reconstructs the known fields rather than executing code or preserving arbitrary objects. Export includes the full scene and wall, allowing exact reconstruction in the same rendering environment. Shader precision may vary between GPUs.

## Rendering and spatial mapping

Each panel samples its local normalized coordinates, transforms about its center into wall millimeters, then evaluates an analytic scene at that global point and the timing-selected scene time. Increasing the gap hides more world; it does not squeeze the artwork to fill the remaining screens. Rotating a display rotates its sampling window. Gap Travelers uses seeded analytic particle paths, so objects continue through invisible space without requiring particle-state replication.

`shared/` contains spatial, project-validation and timing contracts; `renderer/` owns shaders and WebGL; `simulator/` owns controls, persistence and playback. Node is only a static development server. The application uses no third-party runtime packages and loads no remote assets.

## Subsequent stages

1. Separate renderer windows on one development computer. Reuse scene/layout definitions, introduce a coordinator with an authoritative scene revision and scheduled start time. A renderer subscribes by panel ID.
2. Introduce versioned, checksum-verified bundles and prepare/acknowledge/commit scene switching. Cache last-known-good content; reconnect and restore without resetting the scene epoch. Report clock offsets, FPS, temperatures and active hashes.
3. Move two renderers to Pi 5 nodes; synchronize clocks with chrony and evaluate 1080p performance, thermal behavior, power recovery and actual cross-monitor timing. Provide cached video fallback for heavy scenes.
4. Add a persistent coordinator gallery, daily scheduling, constrained AI art direction and push-to-talk. Browser-local JSON remains an import/export format; the coordinator becomes authoritative, with local renderer caches for outages.

Stateful simulations need a separate fixed-step/checkpoint protocol. They are deliberately excluded from the analytic first milestone. No current design assumes network clock synchronization provides display genlock.
