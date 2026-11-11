# Timing experiments

## Model

Three different problems matter: matching scene state, presenting corresponding frames, and matching the physical refresh/illumination of screens. This simulator approximates the first two and illustrates rolling refresh. It cannot establish actual hardware synchronization.

Each panel generates frames at its configured cadence. Render frame n samples source time n × period. It becomes ready at source time + fixed delay + deterministic jitter in [0, jitter]. Its scene clock has the configured ppm drift. Display refresh starts at phase + n × period and latches the newest frame ready at that instant. A late older frame can never replace newer content. If no newer frame is ready, the previous image remains visible. Frame delivery and refresh use the same nominal Hz in this first model; their relative phase is configurable.

For scanout, each row chooses the current or previous latched frame according to elapsed time since refresh began. Scan duration is approximated as one refresh period; blanking intervals, pixel response, buffering details and panel processing are omitted. Local scan direction rotates with the panel. The A reference uses instantaneous aligned 60 Hz updates, zero delay/jitter/drift; it is an idealized visual baseline, not a simulation of a professional GPU product.

All timing is a pure function of playhead and settings. Seeking recreates jitter and frame selection without replaying a mutable simulation. Negative source time near startup represents a warmed-up system, not a boot sequence. Simulated content age/spread report the newest latched frames, not every row during scanout or measured physical latency. Drift can make content age negative.

Illustrative presets are not measurements of Raspberry Pis, consumer GPUs or particular displays. Lower preview FPS and the host screen's own refresh can hide or distort effects, especially above the host refresh rate. A browser preview cannot recreate four independent physical illumination cycles.

## Suggested experiment

1. Use the grid arrangement and Sync Study; pause around 12 seconds.
2. Apply Exaggerated Differences, switch A/B, then step frame by frame. Inspect moving bars and diagonals at boundaries.
3. Try Independent Phases with small offsets, then Mixed Display Timings. Compare against slower Tidal Ribbons and Gap Travelers at the same settings.
4. Set a long playhead (e.g. 3600 s) to see accumulated clock drift. Export useful configurations with a descriptive filename.

## Real hardware validation

Start with two matching monitors and two renderer nodes before buying four. Record exact hardware, resolution, Hz, scene revision, clock offsets, processing mode and cable topology. Run matching fast horizontal/vertical bars, diagonal lines and periodic flashes as well as slow art. Repeat after warm-up, long operation, reconnect, monitor wake and power loss. Compare different scan directions and physically rotated panels.

Phone slow-motion footage provides an initial qualitative view of discontinuities. Rolling-shutter camera artifacts must be considered; it is not definitive timing metrology. For quantitative work use suitably positioned photodiodes and a shared acquisition clock, or a validated high-frame-rate global-shutter camera. Measure multiple positions across panels and distinguish source frame alignment, scanout and panel response/processing latency. Define acceptable skew from the actual visual results before choosing hardware.

NTP/chrony synchronization does not provide HDMI/DP frame lock. Verify exact professional GPU/controller, driver, operating-system, monitor-timing and panel-latency behavior before treating any hardware path as synchronized.

## Stateful worlds

Living Tapestry, Chemical Garden, Murmuration and Platformer Terrarium share a 60 Hz world simulation. Their display timings select retained states/images, including separate samples for rolling scanout. Clock drift is disabled for these scenes. History holds up to 192 ticks within its memory budget; restoring a checkpoint initially has less history, so the oldest available state is used until buffers refill. A/B switching changes presentation only. Checkpoints plus timestamped parameter edits support backward seeking; long seeks replay asynchronously and can be cancelled.
