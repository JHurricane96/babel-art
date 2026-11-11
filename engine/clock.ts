// Simulation time advances at a chosen speed. Display time always measures real ms.
export class PresentationClock {
  wallMs = 0;
  sceneMs = 0;
  rate = 1;
  points: { wall: number; scene: number; rate: number }[] = [];
  align(seconds: number, rate: number) {
    if (
      !this.points.length ||
      Math.abs(seconds * 1000 - this.sceneMs) > 0.00001
    ) {
      this.sceneMs = seconds * 1000;
      this.wallMs = this.sceneMs / rate;
      this.points = [{ wall: this.wallMs, scene: this.sceneMs, rate }];
    }
    this.rate = rate;
  }
  advance(seconds: number, rate: number) {
    this.wallMs += seconds * 1000;
    this.sceneMs += seconds * 1000 * rate;
    this.rate = rate;
    this.points.push({ wall: this.wallMs, scene: this.sceneMs, rate });
    while (this.points.length > 2 && this.points[1].wall < this.wallMs - 2000)
      this.points.shift();
  }
  sceneAt(wall: number) {
    const first = this.points[0],
      last = this.points.at(-1)!;
    if (wall <= first.wall)
      return first.scene + (wall - first.wall) * first.rate;
    if (wall >= last.wall) return last.scene + (wall - last.wall) * this.rate;
    for (let i = 1; i < this.points.length; i++) {
      const b = this.points[i],
        a = this.points[i - 1];
      if (wall <= b.wall)
        return (
          a.scene +
          ((b.scene - a.scene) * (wall - a.wall)) / (b.wall - a.wall || 1)
        );
    }
    return last.scene;
  }
  frame(frame: any) {
    return {
      ...frame,
      contentAge: this.wallMs - frame.current,
      sourceWallMs: frame.current,
      current: this.sceneAt(frame.current),
      previous: this.sceneAt(frame.previous),
    };
  }
}
