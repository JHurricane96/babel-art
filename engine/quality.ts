// Presentation resolution only. Physics, checkpoints, and display timing are
// independent of this controller. Hysteresis avoids repeated size oscillation.
export class AdaptiveQuality {
  scale = 1;
  elapsed = 0;
  frames = 0;
  slow = 0;
  fast = 0;
  warmup = 2;
  reset() {
    this.scale = 1;
    this.elapsed = this.frames = this.slow = this.fast = 0;
    this.warmup = 2;
  }
  observe(seconds: number, active: boolean) {
    if (!active || seconds <= 0 || seconds > 2) {
      this.elapsed = this.frames = this.slow = this.fast = 0;
      this.warmup = 2;
      return this.scale;
    }
    if (this.warmup > 0) {
      this.warmup -= seconds;
      return this.scale;
    }
    this.elapsed += seconds;
    this.frames++;
    if (this.elapsed < 1) return this.scale;
    const fps = this.frames / this.elapsed;
    this.elapsed = this.frames = 0;
    this.slow = fps < 50 ? this.slow + 1 : 0;
    this.fast = fps > 58 ? this.fast + 1 : 0;
    if (this.slow >= 2) {
      this.scale = Math.max(0.5, Math.round((this.scale - 0.125) * 8) / 8);
      this.slow = this.fast = 0;
    } else if (this.fast >= 12) {
      this.scale = Math.min(1.5, Math.round((this.scale + 0.125) * 8) / 8);
      this.slow = this.fast = 0;
    }
    return this.scale;
  }
}
