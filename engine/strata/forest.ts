// Strata forests: crafted, dense, layered woods for the temperate woodland
// biomes (the first slice of the crafted look; others still use plants.ts).
//
// Planted in passes, front to back, each only into open air so nearer
// things stay in front: ground cover (ferns, grass tufts, flowers), then the
// understory (hazel, shrubs, boulders, fallen logs), then trees, small before
// large. Behind the land stand two rows of forest (the back layers), drawn
// into their own layer, hazier with distance, filling the sky behind the
// canopy so the woods read as deep. Trees sit on a world grid with jitter, so
// every window plants the same trees.
import {
  BLOOMS,
  type Canvas,
  TREES,
  TUFTS,
  type TreeKind,
  boulder,
  fern,
  log,
  shrub,
  stamp,
  tree,
} from "./art";
import { BIOMES } from "./biomes";
import { SPECIES } from "./plants";
import { M, hash3, walkRandom } from "./world";

interface ForestKind {
  /** Tree kinds (art.ts TREES), weights, and the species whose colours they take (or the biome's). */
  trees: [string, number, string | null][];
  /** Mean spacing of trees (cells); chance of understory and ground cover per column. */
  spacing: number;
  understory: number;
  cover: number;
  /** Ground cover mix: ferns, grass tufts, flowers. */
  ferns: number;
  tufts: number;
  flowers: number;
}

export const FORESTS: Record<string, ForestKind> = {
  "Oak and beech woods": {
    trees: [["oak", 3, "oak"], ["beech", 3, null], ["birch", 0.6, "birch"]],
    spacing: 12, understory: 0.05, cover: 0.45, ferns: 3, tufts: 2, flowers: 0.6,
  },
  "Oak and maple woods": {
    trees: [["maple", 3, null], ["oak", 2, "oak"], ["birch", 1, "birch"]],
    spacing: 12, understory: 0.05, cover: 0.4, ferns: 2, tufts: 2, flowers: 0.6,
  },
  "Birch and aspen groves": {
    trees: [["birch", 3, "birch"], ["birch", 2, "aspen"], ["oak", 0.4, "oak"]],
    spacing: 10, understory: 0.04, cover: 0.5, ferns: 1, tufts: 3, flowers: 1,
  },
  "Bracken and bluebell glades": {
    trees: [["oak", 1, "oak"], ["birch", 1.5, "birch"]],
    spacing: 34, understory: 0.04, cover: 0.75, ferns: 4, tufts: 2, flowers: 2,
  },
};
const FOREST_IDS = new Map(
  BIOMES.map((b, i) => [i, FORESTS[b.name]] as const).filter(([, f]) => f),
);

/** Is this land biome (biomes.ts index) planted as a crafted forest? */
export const isForest = (biome: number) => FOREST_IDS.has(biome);

const speciesPal = (name: string | null, biome: number) => {
  if (name) {
    const id = SPECIES.findIndex((s) => s.name === name);
    if (id >= 0 && SPECIES[id].leaf) return BIOMES.length + 1 + id;
  }
  return biome + 1;
};

export interface ForestWin {
  seed: number;
  X0: number;
  WW: number;
  H: number;
  cells: Uint8Array;
  state: Uint8Array;
  flora: Uint8Array;
  tone: Uint8Array;
  back: Uint8Array;
  backPal: Uint8Array;
  surface: Int16Array;
  bio: Int16Array;
  /** Marks a plant cell's state (generate.ts's stamp), given the cell. */
  mark: (i: number, colBiomeOf: number) => void;
  colBiome: Uint8Array;
}

// Scratch for the canvases: which plant last wrote each cell, and what.
let owner = new Int32Array(0),
  value = new Uint8Array(0),
  gen = 0;
const touched: number[] = [];
function scratch(n: number) {
  if (owner.length < n) {
    owner = new Int32Array(n);
    value = new Uint8Array(n);
    gen = 0;
  }
}
/** Start a plant: a fresh generation, so its own later cells overwrite its earlier ones. */
function begin() {
  gen++;
  touched.length = 0;
}
function write(i: number, v: number) {
  if (owner[i] !== gen) {
    owner[i] = gen;
    touched.push(i);
  }
  value[i] = v;
}

/**
 * A canvas for one plant: collects its cells (later ones over earlier, so a
 * plant shades itself properly), then lays them into the window only where
 * there is open air, so plants drawn before it stay in front.
 */
function plantCanvas(w: ForestWin, pal: number, R: () => number) {
  begin();
  const c: Canvas = {
    R,
    set(x, y, m, t) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || x >= w.WW || y < 1 || y >= w.H) return;
      write(y * w.WW + x, (m << 3) | t);
    },
  };
  const flush = () => {
    for (const i of touched) {
      if (w.cells[i] !== M.AIR) continue;
      const v = value[i],
        m = v >> 3,
        x = i % w.WW;
      w.cells[i] = m;
      w.tone[i] = v & 7;
      // Stone keeps the rock's own state (its kind sets its colours).
      if (m !== M.ROCK) {
        w.flora[i] = pal;
        w.mark(i, w.colBiome[x]);
      }
    }
  };
  return { c, flush };
}

/** A canvas for the back layers: only into cells the layer hasn't filled yet. */
function backCanvas(w: ForestWin, pal: number, layer: number, R: () => number) {
  begin();
  const c: Canvas = {
    R,
    set(x, y, m, t) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || x >= w.WW || y < 1 || y >= w.H || y > w.surface[x] + 2) return;
      // Only leaves and wood: the back rows are silhouettes of trees.
      if (m !== M.LEAF && m !== M.WOOD) return;
      write(y * w.WW + x, (m === M.WOOD ? 32 : 0) | t);
    },
  };
  const flush = () => {
    for (const i of touched) {
      if (w.back[i]) continue;
      w.back[i] = (layer << 3) | value[i];
      w.backPal[i] = pal;
    }
  };
  return { c, flush };
}

const pick = <T>(list: [T, number, ...unknown[]][], r: number) => {
  let total = 0;
  for (const e of list) total += e[1];
  r *= total;
  for (const e of list) if ((r -= e[1]) < 0) return e;
  return list[list.length - 1];
};

/** Plant the crafted forests in the window. */
export function plantForests(w: ForestWin) {
  scratch(w.WW * w.H);
  const { seed, X0, WW, surface, cells, bio } = w,
    forestAt = (x: number) => (x >= 0 && x < WW && bio[x] >= 0 ? FOREST_IDS.get(bio[x]) : undefined),
    ground = (x: number) => surface[Math.max(0, Math.min(WW - 1, x))],
    rnd = (wx: number, salt: number) => walkRandom(Math.floor(hash3(wx, salt, seed) * 4294967296)),
    // Plants stand on soil, turf or moss in the open, not on water, rock or snow.
    groundOk = (x: number) => {
      const top = cells[surface[x] * WW + x];
      return top === M.GRASS || top === M.MOSS || top === M.SOIL || top === M.SAND;
    },
    standable = (x: number) => groundOk(x) && cells[(surface[x] - 1) * WW + x] === M.AIR,
    slope = (x: number) => Math.abs(ground(x + 3) - ground(x - 3));

  // How far each column is from the edge of the woods: trees thin out and
  // shrink toward it, and scrub thickens there.
  const edge = new Float32Array(WW).fill(999);
  let last = -999;
  for (let x = 0; x < WW; x++) {
    if (!forestAt(x)) last = x;
    edge[x] = x - last;
  }
  last = 9999;
  for (let x = WW - 1; x >= 0; x--) {
    if (!forestAt(x)) last = x;
    edge[x] = Math.min(edge[x], last - x);
  }
  const ramp = (e: number, a: number, b: number) => Math.min(1, Math.max(0, (e - a) / (b - a)));

  // 0. The forest floor: leaf litter over the earth, fallen leaves in it,
  // moss in patches; no turf under the trees.
  for (let x = 0; x < WW; x++) {
    if (!forestAt(x) || !groundOk(x)) continue;
    const wx = X0 + x,
      inside = ramp(edge[x], 4, 30);
    for (let d = 0; d < 3; d++) {
      const y = surface[x] + d,
        i = y * WW + x,
        m = cells[i];
      if (m !== M.GRASS && m !== M.MOSS && m !== M.SOIL) continue;
      const h = hash3(wx, y, seed + 71),
        moss = hash3(Math.floor(wx / 9), 72, seed) < 0.25;
      // Near the edge of the woods the grass comes back.
      if (hash3(wx, 73, seed) > inside) continue;
      if (d === 0 && h < 0.1) {
        cells[i] = M.LEAF;
        w.tone[i] = 3 + Math.floor(h * 30);
      } else {
        cells[i] = d === 0 && moss ? M.MOSS : M.SOIL;
        w.tone[i] = d === 0 ? 2 + Math.floor(hash3(wx, y, seed + 74) * 3.99) : d === 1 ? 2 + Math.floor(h * 2) : 1 + Math.floor(h * 2);
      }
      w.flora[i] = bio[x] + 1;
    }
  }

  // 1. Ground cover, every few columns.
  for (let x = 2; x < WW - 2; x++) {
    const f = forestAt(x);
    if (!f || !standable(x)) continue;
    const wx = X0 + x;
    if (hash3(wx, 51, seed) >= f.cover) continue;
    const R = rnd(wx, 52),
      kind = pick(
        [
          ["fern", f.ferns],
          ["tuft", f.tufts],
          ["flower", f.flowers],
        ] as [string, number][],
        R(),
      )[0],
      pal = kind === "fern" ? speciesPal("fern", bio[x]) : bio[x] + 1,
      { c, flush } = plantCanvas(w, pal, R);
    if (kind === "fern") fern(c, x, surface[x], 8 + Math.floor(R() * 6));
    else if (kind === "tuft") stamp(c, TUFTS[Math.floor(R() * TUFTS.length)], x - 3, surface[x] - 1, R() < 0.5);
    else stamp(c, BLOOMS[Math.floor(R() * BLOOMS.length)], x - 2, surface[x] - 1);
    flush();
  }

  // 2. Understory: hazel, shrubs, boulders, logs.
  for (let x = 4; x < WW - 4; x++) {
    const f = forestAt(x);
    if (!f || !standable(x) || slope(x) > 6) continue;
    const wx = X0 + x;
    // Scrub thickens along the edge of the woods.
    if (hash3(wx, 53, seed) >= f.understory * (1 + 3 * (1 - ramp(edge[x], 0, 40)))) continue;
    const R = rnd(wx, 54),
      r = R(),
      { c, flush } = plantCanvas(w, r < 0.55 ? speciesPal("bush", bio[x]) : bio[x] + 1, R);
    if (r < 0.3) tree(c, TREES.hazel, x, surface[x]);
    else if (r < 0.55) shrub(c, x, surface[x], 12 + R() * 12, 7 + R() * 5);
    else if (r < 0.8) boulder(c, x, surface[x], 10 + R() * 14, 6 + R() * 8, 0.5);
    else log(c, x, surface[x], 12 + Math.floor(R() * 14), 4 + Math.floor(R() * 2), R() < 0.5 ? 1 : -1);
    flush();
  }

  // 3. Trees: one per cell of a world grid, jittered; small ones first.
  const placeTrees = (
    spacingScale: number,
    salt: number,
    draw: (x: number, kind: TreeKind, pal: number, R: () => number, grow: number) => void,
  ) => {
    const list: { x: number; size: number; kind: TreeKind; pal: number; R: () => number; grow: number }[] = [];
    const step = 6;
    for (let g = Math.floor((X0 - 40) / step); g <= Math.floor((X0 + WW + 40) / step); g++) {
      const wx = g * step + Math.floor(hash3(g, salt, seed) * step),
        x = wx - X0;
      const f = forestAt(x);
      if (!f) continue;
      // Thin the grid to this forest's spacing, and toward the woods' edge.
      const thin = salt === 55 ? ramp(edge[x], 3, 45) : ramp(edge[x], 25, 100);
      if (hash3(g, salt + 1, seed) >= (step / f.spacing) * spacingScale * thin) continue;
      // (Ground cover in front of a trunk is fine: the trunk goes behind it.)
      if (!groundOk(x) || slope(x) > 9) continue;
      const R = rnd(wx, salt + 2),
        [kindName, , sp] = pick(f.trees, R());
      list.push({ x, size: R(), kind: TREES[kindName as string], pal: speciesPal(sp as string | null, bio[x]), R, grow: 0.72 + 0.28 * ramp(edge[x], 8, 70) });
    }
    list.sort((a, b) => a.size - b.size);
    for (const t of list) draw(t.x, t.kind, t.pal, t.R, t.grow);
  };
  placeTrees(1, 55, (x, kind, pal, R, grow) => {
    const { c, flush } = plantCanvas(w, pal, R);
    tree(c, kind, x, surface[x], (0.85 + 0.3 * R()) * grow);
    flush();
  });

  // 4. The back layers: two rows of forest behind, smaller with distance.
  for (const [layer, scale, salt] of [
    [1, 0.82, 61],
    [2, 0.66, 67],
  ] as const)
    placeTrees(1.3, salt, (x, kind, pal, R, grow) => {
      const { c, flush } = backCanvas(w, pal, layer, R);
      tree(c, kind, x, surface[x] + Math.round(6 * scale), scale * (0.85 + 0.3 * R()) * grow);
      flush();
    });
}
