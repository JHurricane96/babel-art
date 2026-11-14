# A moving artwork should also work as a still

Each frame should have a deliberate composition, a distinctive palette, and
enough material detail to reward sustained viewing. Motion adds another layer
of interest; it should not be needed to make a sparse or muddy image work.

## Composition at three distances

- Across the room: broad color masses, clear value contrast, and one or more
  focal structures. The full wall should read as one composition through gaps.
- Near the wall: branching currents, membranes, cellular mosaics, contour
  strata, and other intermediate structures with a recognizable identity.
- Close up: fine filaments, restrained grain, highlights, and surface relief.

Preserve quiet space around dense areas. Avoid a uniform field of noise or
making every particle equally bright. Texture belongs to world coordinates so
it remains continuous between monitors. Grain should stay attached to the
surface rather than flickering independently every frame.

## Color and materials

Use a deep base, saturated middle, and restrained warm or luminous accent.
Palettes include Aurora, Ember, Iris, Moss, Cobalt & copper, Bioluminescent
lagoon, Orchid & gold, and Mineral fire. Palette and Surface detail changes
must preserve the simulation state. Keep a simple flat style where useful for
examining cellular or chemical rules.

Chemical Garden uses smooth concentration shading, membrane accents, and
relief. Living Tapestry uses individual mosaic cells and fading colored trails.
Murmuration combines colored agents with fine connections and soft background
color masses. Particle Rivers combines broad streams, fine silk-like trails,
and occasional bright heads. Contours and Interference add strata and fine
veins to their larger moving structures.

Slime Mold Networks layers an organic concentration field with fine directional
filaments and bright agent tips. Tone mapping keeps pigment visible in dense
regions. Mycelium, Copper Delta and Night Bloom have curated combinations of
topology, density, trail memory, palette and surface style. Moving nutrient pools
redirect the network while old trails decay. Broad paths and quiet gaps provide
structure at a distance; fine marks reward a closer view.

## Finish and color roles

Every artwork shader except the sync study ends in a shared finish
(`engine/finish.ts`). Highlights above about 82% roll off softly instead of
clipping to flat white, and a fixed sub-LSB dither breaks 8-bit banding in
skies, halos and fractal gradients. The dither depends only on screen
position, so a paused frame stays identical.

The three palette stops are expanded once per draw into named roles: ground,
shadow, body (deep to middle), bridge (middle to accent), highlight, and dusk
(deep to accent). Roles are blended in OKLCh along the shorter hue arc and
muted when the two hues are nearly opposite, so a navy-to-sand blend becomes a
dusky mauve rather than gray. Shaders read them as `toneGround`, `toneShadow`,
`toneBody`, `toneBridge`, `toneHighlight` and `toneDusk`. Blend between
nearby roles; avoid mixing the deep and accent stops directly in sRGB.

Applied so far:
- Julia uses continuous escape-time coloring, a distance-estimated rim and a
  textured interior.
- Contours draws constant-width isolines with index contours, hillshade and
  a hypsometric tint.
- Slime veins are thresholded from the field with a tube profile instead of a
  blurred plateau. Chemical relief is softer and has no concentration rings.
- Life colors cells by role: newborn cells take the accent, active cells the
  middle tones, and long-lived still lifes recede. The residue that 8-bit
  trails leave behind no longer draws a lattice over empty space.
- Terrarium Worlds samples its pixel art "sharp bilinear" with the camera's
  sub-pixel offset, so slow pans glide and pixel widths stay even. Distant
  ridges dissolve toward the haze color.

## Time and review

Chapter transitions blend gradually between gathering, splitting, and vortex
behavior. Seeded currents and recirculating emissions maintain structure and
coverage over time. Recovery handles failed states; it is separate from the
normal visual composition.

Review representative stills at several times and seeds as well as motion.
Check palette clipping, excessive darkness, density, focal structure, and
continuity across panel gaps. Automated color/contrast checks catch gross
regressions; they cannot judge beauty or lasting engagement.

Fast browser regressions and accelerated runs of the actual simulation are
the normal artwork checks. Reserve multi-hour soaks for shared-runtime changes
or installation qualification on representative hardware.
