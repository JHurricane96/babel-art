// Blended chapters rather than abrupt mode switches. Evaluated from simulation
// time so paused frames, delayed displays, and checkpoint replay agree.
export function choreography(seconds: number, seed: number) {
  const phase = seconds / 72 + ((seed % 997) / 997) * 3;
  const chapter = Math.floor(phase) % 3;
  const fraction = phase - Math.floor(phase);
  const mix = fraction * fraction * (3 - 2 * fraction);
  const weights = [0, 0, 0];
  weights[chapter] = 1 - mix;
  weights[(chapter + 1) % 3] = mix;
  return { gather: weights[0], split: weights[1], vortex: weights[2] };
}
