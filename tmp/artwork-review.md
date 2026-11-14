ARTWORK REVIEW: BABEL ART
Review of the artworks at commit e228189, November 14, 2026

STATUS (November 14, 2026): Phase 1 is implemented on branch
claude/artwork-review-improvements-bkx0ia. It is not merged or deployed.
- Done: S1 finish (highlight shoulder and dither), S2 perceptual palette
  roles, Julia coloring, Contours as cartography, Rivers taper and age fade,
  Slime vein shading, Chemical ring removal and softer relief, Life role
  colors and hidden lattice, Murmuration ink-on-dusk (now the default style),
  Terrarium sub-pixel panning and depth haze.
- Moved to Phase 2: the Rivers aspect-ratio fix. It changes particle motion,
  so it needs a versioned simulation change like the other Phase 2 items.
- Every Phase 1 change is presentation only. Checkpoints, replay and saved
  projects are unaffected.
- See docs/art-direction.md, "Finish and color roles", for how the new
  shared pieces work.

The rest of this document is the original review. It describes the app as it
was before Phase 1. The two prototypes in tmp/prototypes/ are now part of
scenes/julia.ts and scenes/contours.ts.

How the review was done:
- Ran the dev build headlessly (Chromium, SwiftShader) with the default
  staggered layout and "High" preview quality.
- Seeked every artwork and preset to several times (5 s to 300 s) and captured
  the whole wall.
- Read each scene's simulation and shader code to find the cause of what the
  stills show.
- Software rendering says nothing about the laptop's frame rate. Every
  performance remark below is an estimate and must be measured on the real
  laptop.

======================================================================
1. SUMMARY
======================================================================

Strongest today: Julia garden, Interference bloom, Living contours, and
Particle Rivers in its vortex moments. They have structure, depth of detail,
and continuous change.

Weakest relative to the brief:
- Murmuration: a small blob of multicolored confetti in a mostly empty sky.
- Slime mold networks: thick, blurry tubes. The three presets differ mainly
  in color.
- Terrarium Worlds: rich behavior, but every chunk is the same grid of dirt
  slabs and ladders, and the four biomes read as palette swaps.
- Gap travelers: 38 glowing dots on black.
- Tidal ribbons: looks the same at 10 s and at 5 min.

Most of the problems come from five shared causes, not from individual scenes:

1. Resolution. The stateful artworks draw into one small image that is
   stretched across the whole wall:
   - Rivers, Slime marks, and Murmuration: 640x400, or 1280x800 at "High".
   - Slime field: 192x120.
   - Life and Chemical grids: 128 cells wide by default.
   On the default 1096 mm staggered wall with 1080p panels (about 3,950 px
   across), one source pixel covers about 3 to 6 screen pixels, one Slime
   field cell about 20, and one Life or Chemical cell about 31. The "close up"
   level of the art direction cannot survive that. Slime is soft even in the
   browser preview.

2. Color. There are only three palette stops, mixed in sRGB, with no
   dithering.
   - Where navy meets sand, the mix passes through gray and olive: the
     Murmuration silhouette sky, Contours, and Slime "Copper delta".
   - Some scenes rarely reach the accent color at all (Tidal ribbons).
   - Smooth gradients band in 8-bit color: Julia, the skies, the Slime
     halos.

3. Composition. Pieces are either a uniform all-over texture (Rivers, Slime,
   Ribbons, Interference) or one small subject in an empty field
   (Murmuration, Gap travelers). Nothing composes the four panels as one
   picture with a focal area, a resting area, and motion that pulls the eye
   across the gaps.

4. Long-form time. The analytic scenes run entirely on cycles of 26 to 146
   seconds.
   - Julia's parameter c circles a small loop. Similar forms come back every
     few minutes, and the exact path repeats about every 23 minutes.
   - Murmuration's three chapters repeat every 216 s.
   - No scene changes over an hour the way light changes over a day.

5. Birth and death are not drawn.
   - Rivers moves 2 particles to random places every tick, so every particle
     is replaced about every 8 s.
   - Slime does the same for 2 agents per tick, replacing every agent about
     every 20 s.
   - New marks appear at full strength wherever they land. That scatters
     even speckle and short dashes across the quiet areas, the "uniform
     noise" the art direction says to avoid.

======================================================================
2. SHARED IMPROVEMENTS (benefit every artwork)
======================================================================

S1. Finishing pass in the compositor. Small change; affects every scene.
    - Dither (blue-noise or hash, about +/-0.5 LSB, fixed in screen space)
      before 8-bit output. This removes banding in Julia, skies, and halos.
    - Gentle filmic tone curve so highlights roll off instead of clipping to
      flat white. Interference's cream crests and Julia's rim need this.
    - Optional soft bloom for the "luminous" styles. Compute it from world
      coordinates so the glow continues through the gaps.

S2. Perceptual palettes with roles. Small to medium change.
    - Mix colors in OKLab, not sRGB. Navy to sand then passes through clean
      teal and ochre instead of gray-olive.
    - Grow each palette from 3 stops to about 6 roles: void/ground, shadow,
      body, secondary, accent, highlight.
    - Keep the accent rare (a few percent of pixels) so it marks a focal
      point.
    - Existing palette IDs keep working; the extra roles are derived from the
      current three colors unless a palette defines them.

S3. Render at the wall's real resolution. Medium change.
    - Size each entity scene's offscreen image from the panels' physical
      pixel density, or draw each panel's view directly with a
      world-to-panel transform.
    - The 640x400 image is also 1.6:1 while the default wall is about 1.5:1,
      so everything is stretched horizontally by about 6%.
    - Raise grid defaults: Chemical 256 (512 optional) and Life 256. Both are
      cheap on a GPU.
    - Slime needs a GPU simulation to reach this resolution (see A6).

S4. A wall composition field. Medium change.
    - A slowly drifting, low-frequency world-space mask, shared by scenes
      that want it.
    - It modulates density, emission, brightness, and vein weight, so at any
      moment the wall has a focal region and a quiet region.
    - The regions move across panels over minutes, which uses the gaps
      ("four windows, one world") instead of ignoring them.

S5. An "almanac" clock for hours-long variety. Medium change.
    - A deterministic slow schedule built from incommensurate periods (for
      example 11, 23, and 47 minutes, plus a day cycle) that scenes can read.
      Uses include time-of-day light, palette warmth, density acts, zoom,
      and chapter selection.
    - It derives from simulation time and seed, so replay and seeking stay
      exact.
    - Analytic scenes then stop repeating on 1 to 4 minute loops.

S6. Fade-in and fade-out by age. Small change.
    - Give recycled particles and agents an age.
    - Ramp alpha and width up after birth and down before recycling.
    - Emit from sources (springs, edges, bands), not uniformly at random.

======================================================================
3. ARTWORK BY ARTWORK
======================================================================

Effort labels: Quick = hours to a day. Medium = a few days. Signature = a
week or more.

----------------------------------------------------------------------
Julia garden: keep and polish
----------------------------------------------------------------------
What works:
- Strong silhouette and an intricate boundary. You have cited it as the
  model for sustained interest.

What weakens it:
- The iteration count is integer, so the far field shows stepped terraces.
- The palette lookup wraps with fract(), which draws hard seams.
- The interior is flat black.
- The 90-iteration cap loses filaments.
- c traces a small closed loop, so similar forms recur every few minutes.

Suggestions:
- Quick, prototyped: continuous escape-time coloring; a distance-estimated
  luminous rim along the boundary; an orbit-trap texture for the interior;
  dithering. The c path is unchanged, and the result is much more luminous
  with no banding.
- Medium: move c along the Mandelbrot boundary (main cardioid and bulbs)
  over hours. Add slow zoom and rotation from the almanac clock. Avoid
  near-empty "dust" regions with a cheap interest estimate (fraction of
  pixels near the boundary).
- Signature: occasional "acts" from related families (z^3 + c, Phoenix)
  with blended transitions.

----------------------------------------------------------------------
Interference bloom: keep and widen the value range
----------------------------------------------------------------------
What works:
- A liquid silk look, continuous motion, and fine veins.

What weakens it:
- Almost one hue.
- Cream crests clip to near-white over large areas.
- Equal-weight iso-veins cover the whole wall evenly, with no quiet region.

Suggestions:
- Quick: apply the tone curve (S1); let parts of the field fall to deep c0;
  weight vein density by the composition field (S4).
- Medium: add two or three slowly drifting wave sources whose circular
  fronts actually meet. Their positions cross panels, so the interference
  has a readable cause.

----------------------------------------------------------------------
Living contours: draw it as cartography
----------------------------------------------------------------------
What works:
- Calm, organic, and legible.

What weakens it:
- Line width depends on slope, so lines swell into fat blobs at saddles and
  flat tops.
- Navy mixed with sand gives olive-gray mud.
- There is no sense of relief.

Suggestions:
- Quick, prototyped: constant-width isolines (distance divided by gradient);
  an index contour on every fifth line; hillshade; a hypsometric tint. It
  reads like a fine relief map.
- Medium: slow geographic events from the almanac clock, such as a water
  level that floods basins and recedes over an hour, or channels carved
  along valleys.

----------------------------------------------------------------------
Tidal ribbons: rebuild or retire
----------------------------------------------------------------------
What works:
- A soft glow and gentle motion.

What weakens it:
- Seven near-identical sine bands plus one hard diagonal ray.
- The accent color almost never appears.
- Every period is 52 s or shorter, so the scene looks the same at 10 s and at
  5 min. It reads as a screensaver.

Suggestions:
- Medium: three to five wide translucent ribbons with a real twist, whose
  front and back faces shade differently. Add edge highlights where they
  turn, depth ordering with soft shadows, and slow changes in count and
  direction.
- Otherwise, fold its best qualities into Interference.

----------------------------------------------------------------------
Gap travelers (fireflies): the concept is right, the piece is thin
----------------------------------------------------------------------
What works:
- Lights that travel through the gaps suit the installation exactly.

What weakens it:
- 38 identical dots drift in straight lines over flat black.
- There is no environment and no behavior.

Suggestions:
- Medium to Signature: a dusk meadow with synchronous fireflies.
  - Coupled phase oscillators, a Kuramoto-style model like real synchronous
    fireflies, make flashes sweep across all four panels in waves.
  - Short light trails, grass and reed silhouettes, and a pond with
    reflections on the lower panels.
  - Population rises at dusk and thins at night on the almanac clock.
  - Hundreds of agents are cheap and deterministic.

----------------------------------------------------------------------
Particle rivers: promising, fix the dashes
----------------------------------------------------------------------
What works:
- Vortices and confluences are beautiful at moments (the 60 s frame).

What weakens it:
- Each trail is six straight segments with equal width and alpha, so
  trails read as dashes. At 180 s the wall looks like a warp-speed
  starfield.
- Random re-emission sprinkles short dashes evenly through the quiet areas.
- Every head is equally bright.
- The flow is computed in a unit square and stretched to 16:10, so the
  currents are anisotropic.

Suggestions:
- Quick: taper width and alpha from head to tail; fade by age (S6); keep
  only a few bright heads; correct the aspect ratio.
- Medium: the flow field is analytic. Draw long trails at render time by
  integrating backward from each head on the GPU (streaklines). This gives
  long, smooth silk with no extra stored state, and checkpoints and replay
  stay exact. Emit from springs and bands instead of uniformly.
- Signature: a dye layer advected through the same field on the GPU, giving
  marbled color masses behind the filaments.

----------------------------------------------------------------------
Slime mold networks: needs a resolution jump
----------------------------------------------------------------------
What works:
- The network topology, and the moving nutrient pools that redirect it.

What weakens it:
- 2,400 agents on a 192x120 field, magnified 6x in the preview and about
  20x on a real wall. The result is fat, blurry, uniformly thick tubes.
- The trail clamps at 1.0, so tubes become flat plateaus.
- A sin(v*65) texture term draws contour "terraces" inside every tube.
- The three presets differ mostly in color.

Suggestions:
- Quick: remove the terrace term; tone-map log(trail) instead of clamping.
- Medium to Signature: a GPU Physarum simulation.
  - Agents live in a float texture: 200k to 1M agents on a 1024x640 or
    wall-resolution trail.
  - Deposit with additive points.
  - Thick veins with fine capillaries then emerge on their own.
  - Presets can then differ in sensor angle, distance, and decay, which
    gives truly different forms: reticulated, dendritic, coral, galaxy.
  - Optionally, two or three colored species that attract or avoid each
    other.
  - Replay would be same-device only, as Chemical garden already is.

----------------------------------------------------------------------
Murmuration: rethink the image
----------------------------------------------------------------------
What works:
- The gather, split, and vortex chapters, and the response to the predator.

What weakens it:
- 480 birds fill about a twentieth of the wall.
- Birds are 2 to 4 pixel strokes in alternating teal and sand, so they look
  like confetti, not a flock.
- The moon is a flat disc, the hills are flat bands, and the reeds are sticks.
- The silhouette style's sky is muddy gray.
- The predator is drawn as a ">" glyph.

Suggestions:
- Medium (interim): draw birds as dark ink against a graded dusk sky (warm
  horizon, cool zenith, haze), with opacity that rises with local density.
  Scale the flock to span two or three panels.
- Signature:
  - Simulate the flock in 3D with a fixed camera, with 3,000 to 10,000
    birds. The real beauty of a murmuration is the folding sheet, whose
    projected density changes as it turns.
  - A falcon silhouette that dives and tears the flock.
  - Reed-bed silhouettes with depth, and water reflections on the lower
    panels.
  - Murmurations happen at dusk, so the almanac clock can bring them in and
    out.

----------------------------------------------------------------------
Living tapestry (Life): strong ecology, presentation holds it back
----------------------------------------------------------------------
What works:
- The director keeps the field alive with spaceships, guns, and long
  transients.

What weakens it:
- At 128 wide, each cell is a large tile, and trails smear into blocky
  blobs.
- "Ash" still lifes and blinkers are drawn bright cream and pile up as
  clutter.
- A faint grid lattice covers even empty space.
- The presets look alike apart from color.

Suggestions:
- Quick: hide the lattice where there is no trail; color by role (newborn =
  accent, long-lived still life = dim and cool, oscillators = middle) so ash
  recedes and active fronts stand out.
- Medium:
  - Default to 256 wide.
  - Draw cells as soft round beads.
  - Draw trails as blurred afterglow instead of ghost tiles.
  - Place guns near panel edges so glider streams cross the gaps.
- Signature: renew by collision. The director aims glider or spaceship
  streams at ash clusters instead of only stamping patches. It stays pure
  Conway and produces visible explosions with a cause.

----------------------------------------------------------------------
Chemical garden
----------------------------------------------------------------------
Reviewed from stills at 40 s and 150 s for each preset.

What works:
- Stable and evolving; the earlier collapse is fixed.
- The three presets have distinct behavior.

What weakens it:
- At 128 cells wide, the reaction's natural wavelength spans a large part
  of a panel. Each preset shows about ten large forms across the whole
  wall: broad stripes (Coral), big eggs (Dividing cells), soft worms that
  do not read as a maze (Labyrinth).
- Strong emboss and specular read as glossy plastic.
- A sin(g*125) texture term draws concentric rings inside every form.
- Neon teal halos sit on every edge at equal weight.

Suggestions:
- Quick: 256 default; remove the ring term; soften the emboss; reserve the
  membrane accent for growing fronts; S1 dithering and tone curve.
- Medium: 512 optional; anisotropic diffusion or a slowly rotating flow so
  forms stream instead of only filling; a second "pigment" channel
  deposited where reactions are active, giving layered color history.

----------------------------------------------------------------------
Terrarium worlds: the largest gap between potential and result
----------------------------------------------------------------------
What works:
- Many inhabitants with real jobs, an ecology, a panorama, and
  well-executed sprite work.

What weakens it:
- Every 320 px chunk is a 3x3 lattice: platforms at x = 40 + 110 * column,
  on three fixed tiers, joined by long ladders. It reads as a platform-game
  level, not a canopy, cave, aqueduct, or wetland.
- The four biomes share that geometry and start with actors in the same
  places, so they read as palette swaps.
- Values sit in a narrow mid-dark band, so actors do not separate from
  scenery.
- "Luminous" caverns have no light, aqueducts have no flowing water, tidal
  water is barely visible, and the sun is a flat disc.
- The camera rounds to whole logical pixels, and the 960x600 source is
  scaled by a non-integer factor. Slow pans therefore step in jumps of about
  4 screen pixels, and pixel widths are uneven.

Suggestions:
- Quick:
  - Sub-pixel camera offset in the compositor, so pans are smooth.
  - Integer-scale or "sharp bilinear" sampling for even pixels.
  - Stronger atmospheric perspective: far layers lighter and less
    saturated.
- Medium: a lighting pass.
  - Emissive sprites (lanterns, windows, fungi, fireflies) write to a light
    buffer, and ambient light darkens with time of day.
  - Use quantized light levels so it stays pixel-art.
  - Caverns become dark spaces with pools of light; this is the biggest
    single visual gain for this scene.
- Signature: biome landforms and set pieces.
  - Generate continuous terrain first: trunks with branching boughs, carved
    cave chambers, arches with channels of water, islands with shorelines.
    Then derive the navigation graph from it.
  - Vary tier count (2 to 5) and platform shapes.
  - Set pieces that span two or three chunks: a giant tree, a waterfall,
    a vaulted cave.
  - Animated water with reflections, and aqueducts that actually drive the
    waterwheels.
  - The ecology and navigation code can stay; only the generator and art
    change.

----------------------------------------------------------------------
Platformer terrarium (original): keep for compatibility, stop investing
----------------------------------------------------------------------
Terrarium Worlds supersedes it. Spend effort there.

Sync study is a diagnostic and is out of scope.

======================================================================
4. PROPOSED ORDER
======================================================================

Phase 1: finish (quick, low risk, render-only, so saves and replay are
unaffected)
- S1 dithering and tone curve.
- S2 OKLab mixing with derived palette roles.
- Julia coloring (prototype ready).
- Contours as cartography (prototype ready).
- Rivers taper, fade, and aspect fix.
- Slime: drop the terraces and use a log tone map.
- Life: role colors and hiding the lattice.
- Terrarium: sub-pixel camera and atmospheric depth.
- Murmuration: interim ink-on-dusk rendering.

Phase 2: resolution and light (medium; measure on the laptop)
- S3 wall-resolution rendering.
- Grid defaults at 256.
- Rivers streaklines.
- Terrarium lighting pass.
- S6 sourced emission with fades.
- S4 composition field.

Phase 3: signature pieces (larger; one at a time, plan first)
- GPU Physarum.
- 3D murmuration.
- Terrarium landforms and set pieces.
- Synchronous firefly meadow.
- Almanac clock (S5) across scenes.
- Life collision director.

Compatibility notes:
- Render-only changes (Phase 1, most of Phase 2) do not alter checkpoints.
- Simulation changes (Rivers emission, GPU Slime, 3D flock, terrarium
  generator) need a scene or ecology version, as Life already does, so old
  saves keep their behavior until restarted.
- GPU Slime replay would be same-device only, like Chemical garden.
- Laptop FPS is still unmeasured. Profile Phase 2 and 3 work on the real
  hardware before relying on it.
