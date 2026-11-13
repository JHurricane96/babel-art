# Entity rendering and performance qualification

The authoritative CPU simulations remain fixed-step and deterministic.
Portable `snapshot`/`restore` state is used for saves and five-second
checkpoints. A separate `captureFrame` interface supplies reusable Float32
buffers for display history. Rendering consumes these buffers without
restoring, copying, or otherwise changing live physics. Numerical simulation
precision is unchanged; Float32 conversion is presentation-only.

The scene's optional renderer factory owns its GL resources and renders into
pooled framebuffer textures in the existing shared context. Rivers use
instanced ribbon endpoints on accelerated drivers and expanded triangle
batches on software rasterizers. Slime uploads a small packed 16-bit scalar
field and shades it on the GPU, with batched agent marks. Murmuration uses
reusable numeric spatial bins, stable neighbor order, shared per-tick
choreography, and batched wing geometry. Terrarium Worlds uses one generated
pixel atlas. The original Platformer Terrarium retains its Canvas renderer.

Before drawing panels, the runtime gathers source times, prepares each unique
image, and omits previous frames when scanout does not need them. Aligned views
use two images; timing offsets expand the working cache within the existing
64-image/64-MiB limits. Textures are reused after the cache fills. Presentation
resolution changes invalidate images while preserving physics, history, and
checkpoints. Entity history retains at most 192 typed frames and its 24-MiB
budget, or 32 MiB for Slime. Atlas and working vertex buffers are additional
renderer resources and are disposed when changing scenes.

`npm run test:performance` profiles default populations/aligned panels and
maximum populations/exaggerated timing for the three optimized artworks and
Terrarium Worlds. The JSON report includes the graphics driver, frame interval
percentiles, simulation progress, method timings, numeric history bytes,
cached-image bytes, and resource counters. It asserts bounded resources,
checkpoint-only serialization, zero canvas uploads after warmup, and image
reuse when paused. `BABEL_PROFILE_SECONDS=30 npm run test:performance` extends
each measurement window. Default short measurements are regression probes,
not hardware certification.

The laptop goal is 55+ average FPS with p95 intervals below 25 ms in a 1080p
four-panel preview at default settings. A SwiftShader/CPU graphics measurement
cannot establish that target for an integrated GPU. Maximum-density scenes
with four different historical views can require several distinct source
renders per presentation frame, which is explicitly included in the report.
Automatic presentation lowers resolution after two active one-second windows
below 50 FPS and raises it only after twelve windows above 58 FPS. It preserves
populations, rules, simulation speed, and pixel-art logical resolution.
Physical installation qualification must also include the actual displays and
GPU.

In the initial short local profile, the old path created 775–930 full snapshots
per five-second sample and spent 2–3.7 seconds transferring canvas images.
The new aligned samples serialize only at checkpoint deadlines, upload no
canvases, and hold two image textures (about 2 MiB for a 640×400 artwork), while
retaining all trail and agent data. Compare before/after timing on the same
hardware, driver, settings, and measurement window; do not compare software
rasterizer FPS to an installation GPU.
