// Journey (prototype): a small party walks the route regions plan
// (engine/strata/route.ts), and the camera follows them. The party, and the
// ladders, ropes and bridges the route needs, are drawn on the overlay as
// placeholders; nothing is built into the world yet.
import { VERB } from "../../../engine/strata/route.ts";

export interface RouteData {
  xs: Int32Array;
  ys: Int16Array;
  verbs: Uint8Array;
  plan: string;
}

/** Steps per second for each verb, at 1x: walking about a body length a second. */
const PACE = [6, 3, 2.5, 3.2, 4, 3, 1, 4, 2.5];
/** What the party is doing, by verb (for the panel). */
export const DOING = ["walking", "scrambling", "climbing", "descending", "crossing a bridge", "wading", "resting", "in a dug tunnel", "in a dug shaft"];

/** People: tunic colours, skin, hair, legs, packs; ladder wood and rope. */
const PEOPLE = ["#b5452e", "#3d6fa0", "#c8a040", "#5a7a3a"],
  SKIN = "#e0b48a",
  HAIR = "#3a2a1e",
  LEGS = "#3a3028",
  PACK = "#8a6a44",
  WOODC = "#7a5a3a",
  ROPEC = "#c8b48a",
  DUG = "#17120e";

/** Where along the route: a region, a step, and the fraction to the next step. */
interface Pos {
  r: number;
  i: number;
  f: number;
}

export class Journey {
  routes = new Map<number, RouteData>();
  active = false;
  speed = 1;
  showRoute = false;
  seed = -1;
  pos: Pos = { r: 0, i: 0, f: 0 };
  rest = 0;
  dir = 1;
  /** The leader's position (art cells), for the camera. */
  x = 0;
  y = 0;
  /** What the leader is doing now. */
  verb = 0;
  plan = "";
  walked = 0;

  reset(seed: number) {
    this.routes.clear();
    this.seed = seed;
  }

  add(seed: number, r: number, route: RouteData) {
    if (seed !== this.seed) this.reset(seed);
    this.routes.set(r, route);
    // Keep the routes near the party, or near where the viewer is looking
    // (they are small, but not endless).
    const c = this.active ? this.pos.r : r;
    for (const k of this.routes.keys()) if (Math.abs(k - c) > 40) this.routes.delete(k);
  }

  start(seed: number, r: number) {
    this.seed = seed;
    this.pos = { r, i: 0, f: 0 };
    this.rest = 0;
    this.walked = 0;
    this.active = true;
  }

  /** The step k steps from a position (negative: behind), crossing regions. */
  private at(p: Pos, k: number): { x: number; y: number; v: number; ok: boolean } {
    let r = p.r,
      i = p.i + k;
    let route = this.routes.get(r);
    while (route && i < 0) {
      const prev = this.routes.get(r - 1);
      if (!prev) return { x: route.xs[0], y: route.ys[0], v: 0, ok: false };
      r--;
      i += prev.xs.length - 1;
      route = prev;
    }
    while (route && i >= route.xs.length) {
      const next = this.routes.get(r + 1);
      if (!next) return { x: route.xs[route.xs.length - 1], y: route.ys[route.ys.length - 1], v: 0, ok: false };
      i -= route.xs.length - 1;
      r++;
      route = next;
    }
    if (!route) return { x: 0, y: 0, v: 0, ok: false };
    const v = route.verbs[i],
      // A rest step's y holds its length; stand where the step before stood.
      y = v === VERB.REST ? route.ys[Math.max(0, i - 1)] : route.ys[i];
    return { x: route.xs[i], y, v, ok: true };
  }

  /** Advance the party; returns false while it waits for the next region's route. */
  update(dt: number) {
    if (!this.active) return true;
    const route = this.routes.get(this.pos.r);
    if (!route) return false;
    let time = dt * this.speed;
    for (let guard = 0; guard < 10000 && time > 0; guard++) {
      const here = this.routes.get(this.pos.r);
      if (!here) return false;
      if (this.pos.i >= here.xs.length - 1) {
        if (!this.routes.get(this.pos.r + 1)) return false;
        this.pos = { r: this.pos.r + 1, i: 0, f: 0 };
        continue;
      }
      const v = here.verbs[this.pos.i + 1];
      if (v === VERB.REST && this.rest <= 0 && this.pos.f === 0) this.rest = here.ys[this.pos.i + 1];
      if (this.rest > 0) {
        const t = Math.min(time, this.rest);
        this.rest -= t;
        time -= t;
        if (this.rest > 0) break;
        this.pos.i++;
        continue;
      }
      const stepTime = 1 / PACE[v],
        need = (1 - this.pos.f) * stepTime;
      if (time >= need) {
        time -= need;
        this.pos.i++;
        this.pos.f = 0;
        this.walked++;
      } else {
        this.pos.f += time / stepTime;
        time = 0;
      }
    }
    const a = this.at(this.pos, 0),
      b = this.at(this.pos, 1);
    this.x = a.x + (b.x - a.x) * this.pos.f;
    this.y = a.y + (b.y - a.y) * this.pos.f;
    if (b.x !== a.x) this.dir = Math.sign(b.x - a.x);
    this.verb = b.v;
    this.plan = this.routes.get(this.pos.r)?.plan ?? "";
    return true;
  }

  /** Draw the route's structures, the route (if shown) and the party on the overlay. */
  draw(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number, W: number, H: number) {
    if (!this.active && !this.showRoute) return;
    const px = (x: number, y: number, c: string, w = 1, h = 1) => {
      const sx = x * s - ox,
        sy = y * s - oy;
      if (sx < -s * 4 || sx > W || sy < -s * 4 || sy > H) return;
      ctx.fillStyle = c;
      ctx.fillRect(sx, sy, w * s, h * s);
    };
    // Dug passages first (dark, behind everything else), then ladders,
    // ropes, bridges and timbering along every route in view.
    for (const [, rt] of this.routes)
      for (let i = 1; i < rt.xs.length; i++) {
        const v = rt.verbs[i],
          x = rt.xs[i],
          y = rt.ys[i];
        if (v === VERB.TUNNEL) px(x, y - 5, DUG, 1, 6);
        else if (v === VERB.SHAFT) px(x - 2, y - 2, DUG, 5, 1);
      }
    for (const [, rt] of this.routes) {
      const n = rt.xs.length;
      for (let i = 1; i < n; i++) {
        const v = rt.verbs[i],
          x = rt.xs[i],
          y = rt.ys[i];
        if (v === VERB.TUNNEL) {
          // Timber sets every few columns: two props and a cap.
          if (x % 6 === 0) {
            px(x, y - 5, WOODC, 1, 6);
            px(x - 1, y - 5, WOODC, 3, 1);
          }
        } else if (v === VERB.SHAFT) {
          px(x - 1, y - 2, WOODC);
          px(x + 1, y - 2, WOODC);
          if (y % 2 === 0) px(x, y - 2, WOODC);
        } else if (v === VERB.CLIMB) {
          // A ladder against the face: two rails, a rung every other row.
          px(x - 1, y - 2, WOODC, 1, 1);
          px(x + 1, y - 2, WOODC, 1, 1);
          if (y % 2 === 0) px(x, y - 2, WOODC, 1, 1);
        } else if (v === VERB.DESCEND) px(x, y - 3, ROPEC);
        else if (v === VERB.BRIDGE) {
          px(x, y + 1, (x & 1) === 0 ? WOODC : PACK);
          if (x % 4 === 0) px(x, y - 3, ROPEC, 1, 4);
          else px(x, y - 3, ROPEC);
        }
        if (this.showRoute && i % 3 === 0 && v !== VERB.REST)
          px(x, y - 1, ["#ffffff", "#f0d060", "#ff8060", "#60c0ff", "#c080ff", "#60e0c0", "#fff", "#ff60c0", "#ff60c0"][v] ?? "#fff");
      }
    }
    if (!this.active) return;
    // The party: four people strung out along the route behind the leader,
    // each with a pack. Feet stand on the step's row (the open cell above the ground).
    const stride = Math.floor(this.walked / 2) % 2;
    const members = [0, -8, -15, -23];
    for (let m = members.length - 1; m >= 0; m--) {
      const p = this.at(this.pos, members[m]),
        q = this.at(this.pos, members[m] + 1);
      if (!p.ok) continue;
      const x = Math.round(p.x + (q.x - p.x) * this.pos.f),
        y = Math.round(p.y + (q.y - p.y) * this.pos.f) + 1,
        climbing = q.v === VERB.CLIMB || q.v === VERB.DESCEND || q.v === VERB.SHAFT,
        face = q.x !== p.x ? Math.sign(q.x - p.x) : this.dir,
        walkFrame = (stride + m) % 2;
      const c = PEOPLE[m];
      px(x, y - 7, HAIR);
      px(x, y - 6, SKIN);
      px(x - 1, y - 5, c, 3, 2);
      px(x, y - 3, c);
      px(x - face, y - 5, PACK, 1, 2);
      if (climbing) {
        // Arms up the ladder or rope.
        px(x - 1, y - 7, SKIN);
        px(x + 1, y - 7, SKIN);
        px(x - 1, y - 2, LEGS, 1, 2);
        px(x + 1, y - 2, LEGS, 1, 2);
      } else if (q.v === VERB.REST && this.rest > 0) {
        px(x - 1, y - 1, LEGS, 3, 1);
      } else if (walkFrame) {
        px(x - 1, y - 2, LEGS, 1, 2);
        px(x + 1, y - 2, LEGS, 1, 2);
      } else px(x, y - 2, LEGS, 1, 2);
    }
  }
}
