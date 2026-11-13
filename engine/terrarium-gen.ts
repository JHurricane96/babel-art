import { rng } from "./types";
export const CHUNK_WIDTH = 320,
  WORLD_WIDTH = 960,
  WORLD_HEIGHT = 600;
export const BIOMES = [
  "Canopy settlements",
  "Fungal caverns",
  "Rusted aqueducts",
  "Tidal ruins",
];
export type Travel = "walk" | "jump" | "climb" | "lift" | "ferry";
export interface NavNode {
  id: number;
  chunk: number;
  x: number;
  y: number;
  tier: number;
  col: number;
}
export interface NavEdge {
  to: number;
  kind: Travel;
  gate?: number;
}
export interface PlantSite {
  x: number;
  y: number;
  kind: number;
  node: number;
  variant: number;
}
export interface StructureSite {
  x: number;
  y: number;
  kind: number;
  node: number;
}
export interface WorldChunk {
  index: number;
  seed: number;
  biome: number;
  motif: number;
  nodes: NavNode[];
  plants: PlantSite[];
  structures: StructureSite[];
  platforms: { x: number; y: number; width: number; tier: number }[];
}
export function chunkBiome(seed: number, index: number, start = 0) {
  return (((Math.floor(index / 6) + start + (seed % 4)) % 4) + 4) % 4;
}
/** Reachable terraces form the grammar's skeleton; decoration never changes it. */
export function generateChunk(
  seed: number,
  index: number,
  start = 0,
): WorldChunk {
  const random = rng(seed ^ Math.imul(index + 400001, 0x45d9f3b)),
    biome = chunkBiome(seed, index, start),
    motif = Math.floor(random() * 6);
  const nodes: NavNode[] = [],
    platforms: WorldChunk["platforms"] = [];
  for (let tier = 0; tier < 3; tier++) {
    const base = [145, 315, 505, 185, 345, 520, 150, 330, 505, 180, 350, 515][
      biome * 3 + tier
    ];
    for (let col = 0; col < 3; col++) {
      const shape = [
        [-18, 0, 18],
        [12, -20, 12],
        [-10, 24, -10],
        [20, -24, 12],
        [0, 0, 0],
        [-24, -5, 20],
      ][motif];
      const x =
          index * 320 + 40 + col * 110 + Math.round((random() - 0.5) * 12),
        y = base + shape[col] + Math.round((random() - 0.5) * 14);
      nodes.push({
        id: index * 9 + tier * 3 + col,
        chunk: index,
        x,
        y,
        tier,
        col,
      });
      const width =
        biome === 0
          ? 64 + Math.floor(random() * 30)
          : biome === 1
            ? 82 + Math.floor(random() * 35)
            : biome === 2
              ? 76 + Math.floor(random() * 20)
              : 58 + Math.floor(random() * 35);
      platforms.push({ x: x - width / 2, y, width, tier });
    }
  }
  const plants: PlantSite[] = Array.from({ length: 20 }, (_, i) => {
    const node = nodes[(i * 5 + motif) % 9];
    return {
      x: node.x + Math.round((random() - 0.5) * 42),
      y: node.y,
      kind: i,
      variant: Math.floor(random() * 4),
      node: node.id,
    };
  });
  const structures = Array.from({ length: 3 }, (_, i) => {
    const node = nodes[[4, 7, 1][i]];
    return {
      x: node.x + (i === 0 ? 25 : 0),
      y: node.y,
      kind: biome * 3 + i,
      node: node.id,
    };
  });
  return {
    index,
    seed: Math.floor(random() * 4294967295),
    biome,
    motif,
    nodes,
    plants,
    structures,
    platforms,
  };
}
export function navigation(chunks: WorldChunk[]) {
  const nodes = new Map<number, NavNode>(),
    edges = new Map<number, NavEdge[]>();
  for (const c of chunks)
    for (const n of c.nodes) {
      nodes.set(n.id, n);
      edges.set(n.id, []);
    }
  const connect = (a: number, b: number, kind: Travel, gate?: number) => {
    if (nodes.has(a) && nodes.has(b)) {
      edges.get(a)!.push({ to: b, kind, gate });
      edges.get(b)!.push({ to: a, kind, gate });
    }
  };
  for (const c of chunks)
    for (let tier = 0; tier < 3; tier++) {
      for (let col = 0; col < 2; col++)
        connect(
          c.index * 9 + tier * 3 + col,
          c.index * 9 + tier * 3 + col + 1,
          "jump",
          tier === 1 && col === 1 ? c.index * 3 : undefined,
        );
      connect(c.index * 9 + tier * 3 + 2, (c.index + 1) * 9 + tier * 3, "jump");
      if (tier < 2) {
        connect(c.index * 9 + tier * 3, c.index * 9 + (tier + 1) * 3, "climb");
        if (c.biome !== 1)
          connect(
            c.index * 9 + tier * 3 + 2,
            c.index * 9 + (tier + 1) * 3 + 2,
            c.biome === 3 ? "ferry" : "climb",
          );
        if (c.biome !== 0)
          connect(
            c.index * 9 + tier * 3 + 1,
            c.index * 9 + (tier + 1) * 3 + 1,
            c.biome === 2 ? "lift" : c.biome === 3 ? "ferry" : "climb",
          );
      }
    }
  return { nodes, edges };
}
export function route(
  graph: ReturnType<typeof navigation>,
  from: number,
  to: number,
  open: (gate: number) => boolean = () => true,
): number[] {
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return [];
  const target = graph.nodes.get(to)!,
    front = [from],
    cost = new Map([[from, 0]]),
    came = new Map<number, number>();
  while (front.length) {
    front.sort(
      (a, b) =>
        cost.get(a)! +
        Math.hypot(
          graph.nodes.get(a)!.x - target.x,
          graph.nodes.get(a)!.y - target.y,
        ) -
        (cost.get(b)! +
          Math.hypot(
            graph.nodes.get(b)!.x - target.x,
            graph.nodes.get(b)!.y - target.y,
          )),
    );
    const current = front.shift()!;
    if (current === to) {
      const result = [to];
      let n = to;
      while (n !== from) {
        n = came.get(n)!;
        result.unshift(n);
      }
      return result.slice(1);
    }
    for (const edge of graph.edges.get(current)!) {
      if (edge.gate !== undefined && !open(edge.gate)) continue;
      const a = graph.nodes.get(current)!,
        b = graph.nodes.get(edge.to)!;
      const next =
        cost.get(current)! +
        Math.hypot(a.x - b.x, a.y - b.y) +
        (edge.kind === "lift" || edge.kind === "ferry" ? 90 : 0);
      if (next < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, next);
        came.set(edge.to, current);
        if (!front.includes(edge.to)) front.push(edge.to);
      }
    }
  }
  return [];
}
export function validChunk(c: WorldChunk) {
  const graph = navigation([c]);
  return (
    c.nodes.length === 9 &&
    c.plants.length === 20 &&
    c.platforms.every((p) => p.width >= 55 && p.width <= 120) &&
    c.nodes.every(
      (n) =>
        n.id === c.nodes[0].id || route(graph, c.nodes[0].id, n.id).length > 0,
    )
  );
}
