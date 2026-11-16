/**
 * How dark a bird is drawn, shared by the renderer and the lab tools. Birds
 * are not shaded one by one by their wing angle (that read as random
 * twinkling): every bird is the same ink, and the flock's darkness comes
 * from how many birds overlap along the line of sight. A bird caught in a
 * panic band is drawn a little darker, as its banking shows more wing, and
 * that band is coherent across many birds.
 */
export function birdShade(frame: ArrayLike<number>, at: number) {
  return 0.55 + 0.35 * Math.min(1, frame[at + 6]);
}
