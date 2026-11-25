// Strata routes: where a travelling party goes, region by region.
//
// A region's route runs from a fixed crossing on its left edge to one on its
// right (the ground where the edge column first meets something to stand
// on), so every region can be planned on its own, in parallel, and the
// routes join exactly. Inside the region the party walks the ground, and
// where the ground won't do it scrambles, climbs or descends (by ladder or
// rope), bridges a gap, or wades and boats across water. Some regions send
// it on a detour: down into a cave to cross a chamber, or up to the highest
// ground to rest and look out.
//
// The planner works on the region's cells (generate.ts): a "stand" is an
// open cell with something solid under it. Stands in neighbouring columns
// are joined by moves, each with a cost; A* finds the cheapest way.
import { M, hash3 } from "./world";

/** What the party is doing on a step of its route. */
export const VERB = {
  WALK: 0,
  SCRAMBLE: 1,
  CLIMB: 2,
  DESCEND: 3,
  BRIDGE: 4,
  WADE: 5,
  /** A pause: at a viewpoint or in a cave; its length (seconds) rides in the step's y. */
  REST: 6,
  /** Through rock, along a dug passage (where the world needs a way in that it hasn't got). */
  TUNNEL: 7,
  /** Up or down a dug shaft, by ladder. */
  SHAFT: 8,
} as const;
export const VERB_NAMES = ["walk", "scramble", "climb", "descend", "bridge", "wade", "rest", "tunnel", "shaft"];

/** Cells the party walks through: open air, plants, falling water, streams. */
const OPEN = new Uint8Array(64);
for (const m of [
  M.AIR,
  M.LEAF,
  M.WOOD,
  M.GRASS,
  M.FLOWER,
  M.REED,
  M.VINE,
  M.ROPE,
  M.FALLS,
  M.STALK,
  M.CAP,
  M.SHROOM,
  M.TOADSTOOL,
  M.SPOT,
  M.BACKWALL,
  M.CRYSTAL,
])
  OPEN[m] = 1;
/** What can't be stood on or passed: lava (and water, which is waded, not stood on). */
const isOpen = (m: number) => OPEN[m] === 1;

export interface RouteInput {
  cells: Uint8Array;
  W: number;
  H: number;
  /** World x of column 0. */
  x0: number;
  seed: number;
  /** The region's index and its edges, as window columns. */
  r: number;
  left: number;
  right: number;
}

/**
 * The route through one region: world x, row and verb per step, the party's
 * feet on the row; the first step on the left crossing and the last on the
 * right.
 */
export interface Route {
  xs: Int32Array;
  ys: Int16Array;
  verbs: Uint8Array;
  /** What kind of route the region chose: "ground", "cave" or "high". */
  plan: string;
  /** Why a detour was or wasn't taken (for review). */
  why: string;
}

/** Where a column's crossing is: the first stand from the top (water counts: it is waded). */
function crossing(cells: Uint8Array, W: number, H: number, x: number) {
  for (let y = 1; y < H - 1; y++) {
    const below = cells[(y + 1) * W + x];
    if (isOpen(cells[y * W + x]) && (!isOpen(below) || below === M.WATER)) return y;
  }
  return H - 2;
}

export function planRoute(inp: RouteInput): Route {
  const { cells, W, H, left, right } = inp;
  // Stands per column, top down: open cells with something to stand on.
  const standY: number[] = [],
    standStart = new Int32Array(W + 1);
  for (let x = 0; x < W; x++) {
    standStart[x] = standY.length;
    for (let y = 2; y < H - 2; y++) {
      const m = cells[y * W + x],
        b = cells[(y + 1) * W + x];
      if (!isOpen(m) || isOpen(b) || b === M.LAVA) continue;
      // Room to stand: a few open cells overhead.
      if (!isOpen(cells[(y - 1) * W + x]) || !isOpen(cells[(y - 2) * W + x])) continue;
      standY.push(y);
    }
  }
  standStart[W] = standY.length;
  const N = standY.length,
    colOf = new Int32Array(N);
  for (let x = 0; x < W; x++) for (let k = standStart[x]; k < standStart[x + 1]; k++) colOf[k] = x;
  const water = (k: number) => cells[(standY[k] + 1) * W + colOf[k]] === M.WATER;
  const find = (x: number, y: number) => {
    let best = -1,
      bd = 1e9;
    for (let k = standStart[x]; k < standStart[x + 1]; k++) {
      const d = Math.abs(standY[k] - y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  // Is the column x open from row a to row b (a < b)? (For climbing past a face.)
  const clear = (x: number, a: number, b: number) => {
    for (let y = a; y <= b; y++) if (!isOpen(cells[y * W + x]) && cells[y * W + x] !== M.WATER) return false;
    return true;
  };

  // The moves out of a stand, with their costs and verbs.
  const moves = (k: number, dig: boolean, out: (j: number, cost: number, verb: number) => void) => {
    const x = colOf[k],
      y = standY[k];
    if (dig) {
      // Underground detours may dig where the world has no way in: a shaft
      // straight up or down to another stand in this column, or a level
      // passage through a face to the next stand at this height.
      for (let j = standStart[x]; j < standStart[x + 1]; j++) {
        const dy = standY[j] - y;
        if (j === k || Math.abs(dy) < 4 || Math.abs(dy) > 160) continue;
        if (!clear(x, Math.min(y, standY[j]) - 2, Math.max(y, standY[j]))) out(j, 40 + 2 * Math.abs(dy), VERB.SHAFT);
      }
      for (const dir of [-1, 1])
        for (let d = 1; d <= 48; d++) {
          const nx = x + dir * d;
          if (nx < 0 || nx >= W) break;
          const j = find(nx, y);
          if (j < 0 || Math.abs(standY[j] - y) > 2) continue;
          if (d > 1) {
            // A tunnel goes through rock: most of the way must be solid
            // (across open air it would be a bridge, and those are found below).
            let solid = 0;
            for (let s = 1; s < d; s++) if (!clear(x + dir * s, y - 3, y)) solid++;
            if (solid * 2 >= d - 1) out(j, 12 + 3 * d, VERB.TUNNEL);
          }
          break;
        }
    }
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (nx < 0 || nx >= W) continue;
      for (let j = standStart[nx]; j < standStart[nx + 1]; j++) {
        const ny = standY[j],
          dy = ny - y;
        const wade = water(j) || water(k);
        if (Math.abs(dy) <= 2) out(j, wade ? 4 : 1 + Math.abs(dy) * 0.4, wade ? VERB.WADE : VERB.WALK);
        else if (Math.abs(dy) <= 6) out(j, 4 + Math.abs(dy), VERB.SCRAMBLE);
        else if (dy < 0 && -dy <= 80 && clear(x, ny - 2, y)) out(j, 14 + -dy * 1.6, VERB.CLIMB);
        else if (dy > 0 && dy <= 80 && clear(nx, y - 2, ny)) out(j, 10 + dy * 1.1, VERB.DESCEND);
      }
    }
    // Bridges: across a gap to a stand at about the same height, with clear air between.
    for (const dir of [-1, 1])
      for (let g = 3; g <= 24; g++) {
        const nx = x + dir * g;
        if (nx < 0 || nx >= W) break;
        const j = find(nx, y);
        if (j < 0 || Math.abs(standY[j] - y) > 3) continue;
        let ok = true,
          gap = false;
        for (let s = 1; s < g && ok; s++) {
          const cx = x + dir * s;
          if (!clear(cx, y - 3, y)) ok = false;
          // A real gap: nothing to stand on near this height in between.
          const near = find(cx, y);
          if (near < 0 || standY[near] > y + 6) gap = true;
        }
        if (ok && gap) out(j, 20 + g * 1.5, VERB.BRIDGE);
        break;
      }
  };

  // A* between two stands, returning the stands and the verb taken into each.
  const astar = (a: number, b: number, maxCost = 1e9, dig = false) => {
    const g = new Float64Array(N).fill(Infinity),
      from = new Int32Array(N).fill(-1),
      via = new Uint8Array(N),
      closed = new Uint8Array(N),
      heap: number[] = [],
      fOf = new Float64Array(N),
      gx = colOf[b];
    const push = (k: number) => {
      heap.push(k);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (fOf[heap[p]] <= fOf[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0],
        last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1,
            r = l + 1;
          let m = i;
          if (l < heap.length && fOf[heap[l]] < fOf[heap[m]]) m = l;
          if (r < heap.length && fOf[heap[r]] < fOf[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    g[a] = 0;
    fOf[a] = Math.abs(colOf[a] - gx);
    push(a);
    while (heap.length) {
      const k = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === b) break;
      if (g[k] > maxCost) return null;
      moves(k, dig, (j, cost, verb) => {
        const ng = g[k] + cost;
        if (ng < g[j]) {
          g[j] = ng;
          from[j] = k;
          via[j] = verb;
          fOf[j] = ng + Math.abs(colOf[j] - gx);
          push(j);
        }
      });
    }
    if (from[b] < 0 && a !== b) return null;
    const path: number[] = [],
      verbs: number[] = [];
    for (let k = b; k >= 0 && k !== a; k = from[k]) {
      path.push(k);
      verbs.push(via[k]);
    }
    path.push(a);
    verbs.push(VERB.WALK);
    path.reverse();
    verbs.reverse();
    return { path, verbs, cost: g[b] };
  };

  const start = find(left, crossing(cells, W, H, left)),
    end = find(right, crossing(cells, W, H, right)),
    direct = astar(start, end);
  // Some regions take a detour: down through a cave, or up to the heights.
  let plan = "ground",
    legs = direct ? [direct] : [],
    stopAt = -1,
    stopFor = 0,
    why = "";
  const h = hash3(inp.r, 91, inp.seed);
  if (direct && h < 0.35) {
    // The roomiest chamber floor in the region, well under the ground: tall
    // and wide (a crack is tall but not a place to stop).
    let best = -1,
      room = 0;
    for (let x = left + 200; x < right - 200; x += 4)
      for (let k = standStart[x]; k < standStart[x + 1]; k++) {
        const y = standY[k],
          top = standY[standStart[x]];
        if (y < top + 30) continue;
        let r = 0;
        while (r < 60 && isOpen(cells[(y - r) * W + x])) r++;
        if (r < 10) continue;
        const row = (y - 3) * W;
        let a = 0,
          b = 0;
        while (a < 90 && x - a > 0 && isOpen(cells[row + x - a - 1])) a++;
        while (b < 90 && x + b < W - 1 && isOpen(cells[row + x + b + 1])) b++;
        const score = Math.min(r, (a + b) / 3);
        if (score > room) {
          room = score;
          best = k;
        }
      }
    why = `cave: roomiest chamber ${room.toFixed(0)}`;
    if (best >= 0 && room >= 9) {
      const a = astar(start, best, direct.cost * 3 + 400, true),
        b = a && astar(best, end, direct.cost * 3 + 400, true);
      if (a && b) {
        plan = "cave";
        legs = [a, b];
        stopAt = best;
        stopFor = 12;
      } else why += `, no way ${a ? "out" : "in"} at row ${standY[best]}`;
    }
  } else if (direct && h < 0.6) {
    // The highest ground in the region: up to it, a rest to look out.
    let best = -1,
      top = H;
    for (let x = left + 100; x < right - 100; x += 2) {
      const k = standStart[x];
      if (k < standStart[x + 1] && standY[k] < top) {
        top = standY[k];
        best = k;
      }
    }
    const y0 = standY[start];
    why = `high: top ${standY[start] - top} rows above the start`;
    if (best >= 0 && y0 - top > 30) {
      const a = astar(start, best, direct.cost * 2.5 + 300),
        b = a && astar(best, end, direct.cost * 2.5 + 300);
      if (a && b) {
        plan = "high";
        legs = [a, b];
        stopAt = best;
        stopFor = 15;
      }
    }
  }

  // Lay the legs out as steps; climbs and descents become one step per row,
  // so the party moves smoothly up and down ladders.
  const xs: number[] = [],
    ys: number[] = [],
    vs: number[] = [];
  const step = (x: number, y: number, v: number) => {
    xs.push(inp.x0 + x);
    ys.push(y);
    vs.push(v);
  };
  if (!legs.length) {
    // No way through (it shouldn't happen): walk the crossings' straight line.
    step(left, standY[start] ?? 0, VERB.WALK);
    step(right, standY[end] ?? 0, VERB.WALK);
  }
  for (let li = 0; li < legs.length; li++) {
    const { path, verbs } = legs[li];
    for (let i = li === 0 ? 0 : 1; i < path.length; i++) {
      const k = path[i],
        x = colOf[k],
        y = standY[k],
        v = verbs[i];
      if (i > 0 && (v === VERB.CLIMB || v === VERB.DESCEND || v === VERB.SHAFT)) {
        const px = colOf[path[i - 1]],
          py = standY[path[i - 1]],
          // Up: on the ladder at the face (the lower column); down: on the rope
          // by the face; a shaft is in its own column.
          lx = v === VERB.DESCEND ? x : px,
          dir = y < py ? -1 : 1;
        for (let yy = py + dir; yy !== y; yy += dir) step(lx, yy, v);
      } else if (i > 0 && (v === VERB.BRIDGE || v === VERB.TUNNEL)) {
        const px = colOf[path[i - 1]],
          py = standY[path[i - 1]],
          n = Math.abs(x - px);
        for (let s = 1; s < n; s++) step(px + Math.sign(x - px) * s, Math.round(py + ((y - py) * s) / n), v);
      }
      step(x, y, v);
      if (k === stopAt && li === 0) {
        step(x, stopFor, VERB.REST);
        step(x, y, VERB.WALK);
      }
    }
  }
  return { xs: Int32Array.from(xs), ys: Int16Array.from(ys), verbs: Uint8Array.from(vs), plan, why };
}
