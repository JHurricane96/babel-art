import { rng } from "./types";
export interface EvolutionAction {
  kind: 1 | 2 | 3;
  x: number;
  y: number;
  serial: number;
}
export interface ScheduleState {
  next: number;
  index: number;
}
export const variationOf = (params: Record<string, unknown>) =>
  Math.max(0, Math.min(1, Number(params.variation ?? 0.65)));
export function actionFor(
  seed: number,
  serial: number,
  kind: 1 | 2 | 3 = 1,
): EvolutionAction {
  const random = rng(seed ^ Math.imul(serial + 1, 0x45d9f3b));
  return { kind, x: 0.1 + 0.8 * random(), y: 0.1 + 0.8 * random(), serial };
}
// Checked on every engine tick, independently from CA generation cadence.
export class EvolutionSchedule {
  next = 480;
  index = 0;
  constructor(public seed: number) {}
  advance(
    tick: number,
    variation: number,
    enabled = true,
  ): EvolutionAction | undefined {
    if (!enabled || variation <= 0 || tick < this.next) return;
    const action = actionFor(this.seed, this.index++);
    const random = rng(this.seed + this.index * 997);
    this.next =
      tick + Math.round(((8 + 12 * random()) * 60) / (0.35 + variation));
    return action;
  }
  snapshot(): ScheduleState {
    return { next: this.next, index: this.index };
  }
  restore(s: ScheduleState | undefined, tick: number) {
    this.next = s?.next ?? tick + 480;
    this.index = s?.index ?? Math.floor(tick / 600);
  }
}
export interface HealthState {
  score: number;
  contrast: number;
  quietSeconds: number;
  stage: number;
  interventions: number;
}
export class ActivityMonitor {
  state: HealthState = {
    score: 1,
    contrast: 1,
    quietSeconds: 0,
    stage: 0,
    interventions: 0,
  };
  last = -1;
  next = 0;
  previous?: Float32Array;
  recent: number[] = [];
  lastIntervention = -1;
  reset() {
    this.state = {
      score: 1,
      contrast: 1,
      quietSeconds: 0,
      stage: 0,
      interventions: 0,
    };
    this.last = -1;
    this.next = 0;
    this.previous = undefined;
    this.recent = [];
    this.lastIntervention = -1;
  }
  due(now: number) {
    return now >= this.next || now < this.last;
  }
  observe(
    now: number,
    sample: Float32Array,
    enabled: boolean,
  ): 1 | 2 | 3 | undefined {
    if (now < this.last || (now - this.last > 5 && this.last >= 0))
      this.reset();
    const dt = this.last < 0 ? 0 : Math.min(2, now - this.last);
    this.last = now;
    this.next = now + [0.73, 0.91, 0.83][Math.floor(now) % 3];
    if (!sample.length) return;
    let difference = 0,
      sum = 0,
      squares = 0,
      finite = true;
    for (let i = 0; i < sample.length; i++) {
      const v = sample[i];
      finite &&= Number.isFinite(v);
      sum += v;
      squares += v * v;
      if (this.previous?.length === sample.length)
        difference += Math.abs(v - this.previous[i]);
    }
    difference /= sample.length;
    const mean = sum / sample.length;
    const contrast = Math.sqrt(
      Math.max(0, squares / sample.length - mean * mean),
    );
    this.previous = finite ? new Float32Array(sample) : undefined;
    this.recent.push(Number.isFinite(difference) ? difference : 0);
    if (this.recent.length > 8) this.recent.shift();
    const score = this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    const empty = mean < 0.002 || mean > 0.998;
    const quiet = !finite || contrast < 0.008 || score < 0.001;
    this.state.score = score;
    this.state.contrast = Number.isFinite(contrast) ? contrast : 0;
    this.state.quietSeconds = quiet ? this.state.quietSeconds + dt : 0;
    if (!quiet) this.state.stage = 0;
    if (!enabled) {
      this.state.quietSeconds = 0;
      this.state.stage = 0;
      return;
    }
    if (
      (!finite || this.state.quietSeconds >= (empty ? 2 : 10)) &&
      (this.lastIntervention < 0 || now - this.lastIntervention >= 8)
    ) {
      this.lastIntervention = now;
      this.state.stage = !finite ? 3 : Math.min(3, this.state.stage + 1);
      this.state.interventions++;
      return this.state.stage as 1 | 2 | 3;
    }
  }
  fallback(variation: number, enabled: boolean) {
    return enabled
      ? Math.min(0.8, Math.max(0, (this.state.quietSeconds - 3) / 12))
      : 0.0;
  }
}
export function validateSchedule(value: unknown): ScheduleState | undefined {
  if (value === undefined) return;
  const s = value as ScheduleState;
  if (
    !s ||
    !Number.isInteger(s.next) ||
    s.next < 0 ||
    s.next > 2e10 ||
    !Number.isInteger(s.index) ||
    s.index < 0 ||
    s.index > 2e10
  )
    throw new Error("Invalid evolution schedule");
  return { next: s.next, index: s.index };
}
export function validateAction(value: unknown): EvolutionAction | undefined {
  if (value === undefined) return;
  const a = value as EvolutionAction;
  if (
    !a ||
    ![1, 2, 3].includes(a.kind) ||
    !Number.isFinite(a.x) ||
    a.x < 0 ||
    a.x > 1 ||
    !Number.isFinite(a.y) ||
    a.y < 0 ||
    a.y > 1 ||
    !Number.isInteger(a.serial) ||
    a.serial < 0 ||
    a.serial > 2e10
  )
    throw new Error("Invalid evolution event");
  return { kind: a.kind, x: a.x, y: a.y, serial: a.serial };
}
