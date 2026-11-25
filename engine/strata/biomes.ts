// Strata's climate zones, habitats, soils and biomes.
//
// A place's biome comes from three things the world already knows:
//   - its climate zone: warmth, rain, seasonality (how unevenly the year's
//     rain falls, and whether the dry season is summer or winter), how
//     oceanic the air is, and height;
//   - its habitat: where it sits in the land (ridge, slope, cliff, flat,
//     valley floor, riverside, wetland, shore);
//   - its soil: what the rock underfoot weathers into.
// A hand-written table turns those into one of 59 biomes, so the land
// changes every few screens even within one zone. Each biome has a stand-in
// look (colours, ground cover, and a mix of the plant shapes the generator
// has) until the life loop gives it species of its own.
import { M } from "./world";

// ---- Climate zones ------------------------------------------------------------

export const ZONE = {
  OCEAN: 0,
  LAKE: 1,
  SALT_FLAT: 2,
  ICE: 3,
  TUNDRA: 4,
  BOREAL: 5,
  ALPINE: 6,
  OCEANIC: 7,
  CONTINENTAL: 8,
  MEDITERRANEAN: 9,
  STEPPE: 10,
  DESERT: 11,
  SAVANNA: 12,
  MONSOON: 13,
  RAINFOREST: 14,
} as const;

export const ZONES: { name: string; color: string }[] = [
  { name: "Ocean", color: "#2a4f7a" },
  { name: "Lake", color: "#3f7fa8" },
  { name: "Salt flat", color: "#ece6dc" },
  { name: "Ice cap", color: "#dcecf6" },
  { name: "Tundra", color: "#8fa49a" },
  { name: "Boreal", color: "#3f6a5a" },
  { name: "Alpine", color: "#8a8490" },
  { name: "Oceanic temperate", color: "#4f8a3a" },
  { name: "Continental temperate", color: "#7a9a3a" },
  { name: "Mediterranean", color: "#a8a058" },
  { name: "Steppe", color: "#c8b878" },
  { name: "Desert", color: "#e0b870" },
  { name: "Savanna", color: "#c8a448" },
  { name: "Monsoon", color: "#5a8a30" },
  { name: "Rainforest", color: "#1f7a3a" },
];

/**
 * The climate zone of a land place: T warmth (°C, colder with height),
 * P rain (mm a year), S seasonality (-1 dry winters .. 0 even .. +1 dry
 * summers), O how oceanic (0 inland .. 1 by the sea), z height above sea.
 */
export function zoneOf(T: number, P: number, S: number, O: number, z: number) {
  if (T < -9) return ZONE.ICE;
  if (z > 300 && T < 5) return ZONE.ALPINE;
  if (T < -2) return ZONE.TUNDRA;
  if (T < 4) return ZONE.BOREAL;
  if (P < 260) return T >= 12 ? ZONE.DESERT : ZONE.STEPPE;
  if (T >= 20) {
    if (P < 650) return ZONE.SAVANNA;
    if (Math.abs(S) > 0.4) return P > 900 ? ZONE.MONSOON : ZONE.SAVANNA;
    return P > 1400 ? ZONE.RAINFOREST : ZONE.MONSOON;
  }
  if (P < 520) return T >= 14 && S > 0.3 ? ZONE.MEDITERRANEAN : ZONE.STEPPE;
  if (T >= 13 && S > 0.35 && P < 1100) return ZONE.MEDITERRANEAN;
  return O > 0.5 ? ZONE.OCEANIC : ZONE.CONTINENTAL;
}

// ---- Habitats and soils -----------------------------------------------------------

export const HABITAT = {
  RIDGE: 0,
  SLOPE: 1,
  CLIFF: 2,
  FLAT: 3,
  VALLEY: 4,
  RIVERSIDE: 5,
  WETLAND: 6,
  SHORE: 7,
} as const;
export const HABITATS = [
  "Ridge",
  "Slope",
  "Cliff",
  "Flat",
  "Valley floor",
  "Riverside",
  "Wetland",
  "Shore",
];

export const SOIL = {
  /** Thin, on limestone, chalk and marble. */
  ALKALINE: 0,
  /** Sandstone, dune sand, conglomerate. */
  SANDY: 1,
  /** Shale, mudstone, red beds, till: heavy and wet. */
  CLAY: 2,
  /** Granite, gneiss: thin and stony. */
  STONY: 3,
  /** Basalt and ash: rich. */
  RICH: 4,
  /** Over salt. */
  SALTY: 5,
  /** Peat: anywhere cold and wet enough. */
  PEAT: 6,
} as const;
export const SOILS = [
  "Thin alkaline",
  "Sandy",
  "Clay",
  "Stony",
  "Rich",
  "Salty",
  "Peat",
];

// ---- Biomes ------------------------------------------------------------------------

type Ground = "grass" | "moss" | "sand" | "snow" | "gravel" | "rock" | "ash" | "soil";

export interface Look {
  /** Leaves, grass, bark and flowers, and the bare earth. */
  leaf: string;
  grass: string;
  bark: string;
  bloom: string;
  earth: string;
  ground: Ground;
  /** Plants per column (chance), and features, as the generator's parameters. */
  pines: number;
  broad: number;
  giants: number;
  shrubs: number;
  cacti: number;
  dead: number;
  logs: number;
  shrooms: number;
  flowers: number;
  reeds: number;
  ivy: number;
  boulders: number;
  scree: number;
  hoodoos: number;
  hoodooCap: number;
  mouths: number;
  dunes: number;
  soil: number;
  /** Grass along the skyline: tufts per column (chance) and their tallest, in cells. */
  tufts: number;
  tall: number;
}

export interface BiomeDef extends Look {
  name: string;
  zone: number;
}

const BASE: Look = {
  leaf: "#3e6428",
  grass: "#6f8f3e",
  bark: "#5b4330",
  bloom: "#f2d35a",
  earth: "#6b4a34",
  ground: "grass",
  pines: 0,
  broad: 0,
  giants: 0,
  shrubs: 0,
  cacti: 0,
  dead: 0,
  logs: 0,
  shrooms: 0,
  flowers: 0,
  reeds: 0,
  ivy: 0,
  boulders: 0.002,
  scree: 0.6,
  hoodoos: 0,
  hoodooCap: 1,
  mouths: 0.4,
  dunes: 0,
  soil: 8,
  tufts: 0.3,
  tall: 3,
};

const b = (zone: number, name: string, look: Partial<Look>): BiomeDef => ({
  ...BASE,
  ...look,
  name,
  zone,
});
const Z = ZONE;

/** Every biome, by id. */
export const BIOMES: BiomeDef[] = [
  // Ice cap
  b(Z.ICE, "Ice sheet", { ground: "snow", soil: 6, boulders: 0.0008, scree: 0.2 , tufts: 0, tall: 1 }),
  b(Z.ICE, "Bare peaks through the ice", { ground: "rock", soil: 0, scree: 1, boulders: 0.004 , tufts: 0, tall: 1 }),
  b(Z.ICE, "Frozen coast", { ground: "snow", soil: 4, boulders: 0.003 , tufts: 0, tall: 1 }),
  // Tundra
  b(Z.TUNDRA, "Moss and sedge tundra", { ground: "moss", grass: "#6a7a48", leaf: "#7a5a3a", shrubs: 0.012, flowers: 0.012, bloom: "#e8e0f0", soil: 5 , tufts: 0.5, tall: 1 }),
  b(Z.TUNDRA, "Lichen tundra", { grass: "#8a9a88", leaf: "#6a5a40", shrubs: 0.004, boulders: 0.006, scree: 0.8, soil: 3 , tufts: 0.15, tall: 1 }),
  b(Z.TUNDRA, "Permafrost bog", { ground: "moss", grass: "#4a5a3a", leaf: "#5a4a30", reeds: 0.6, shrubs: 0.006, earth: "#3a2e24", soil: 6 , tufts: 0.5, tall: 2 }),
  b(Z.TUNDRA, "Shrub tundra", { grass: "#8a6a4a", leaf: "#6a7a3a", shrubs: 0.09, dead: 0.002, soil: 5 , tufts: 0.4, tall: 2 }),
  b(Z.TUNDRA, "Frozen shore", { ground: "gravel", boulders: 0.004, soil: 3 , tufts: 0.05, tall: 1 }),
  // Boreal
  b(Z.BOREAL, "Spruce forest", { ground: "moss", grass: "#3f5a3a", leaf: "#24402f", pines: 0.09, shrubs: 0.02, logs: 0.003 , tufts: 0.1, tall: 2 }),
  b(Z.BOREAL, "Pine and lichen woodland", { grass: "#8a9a80", leaf: "#2f4a2c", pines: 0.04, boulders: 0.003 , tufts: 0.15, tall: 1 }),
  b(Z.BOREAL, "Bog", { ground: "moss", grass: "#5a6a3a", leaf: "#3a4a2c", reeds: 0.8, pines: 0.006, dead: 0.004, earth: "#3a2e24" , tufts: 0.6, tall: 2 }),
  b(Z.BOREAL, "Birch and alder valley", { grass: "#6f8f3e", leaf: "#7a9a3a", bark: "#d8d4c8", broad: 0.035, shrubs: 0.05, reeds: 0.4, flowers: 0.02 , tufts: 0.5, tall: 4 }),
  b(Z.BOREAL, "Burnt forest and fireweed", { ground: "soil", grass: "#6a6040", leaf: "#3a5a30", bark: "#2a2420", pines: 0.01, dead: 0.03, flowers: 0.09, bloom: "#d0509a", logs: 0.006 , tufts: 0.4, tall: 3 }),
  b(Z.BOREAL, "Larch ridge", { grass: "#7a7a48", leaf: "#8a7a2a", pines: 0.05, boulders: 0.004, scree: 0.8 , tufts: 0.4, tall: 2 }),
  // Alpine
  b(Z.ALPINE, "Alpine meadow", { grass: "#7a9a50", flowers: 0.08, bloom: "#8fb0f0", boulders: 0.003, soil: 5 , tufts: 0.7, tall: 2 }),
  b(Z.ALPINE, "Scree slope", { ground: "gravel", scree: 1, boulders: 0.008, soil: 2 , tufts: 0.05, tall: 1 }),
  b(Z.ALPINE, "Treeline", { grass: "#6a7a48", leaf: "#2a3a30", pines: 0.05, shrubs: 0.06, boulders: 0.003, soil: 4 , tufts: 0.3, tall: 2 }),
  b(Z.ALPINE, "Snowfield", { ground: "snow", boulders: 0.002, soil: 6 , tufts: 0, tall: 1 }),
  // Oceanic temperate
  b(Z.OCEANIC, "Oak and beech woods", { leaf: "#4f7a2e", broad: 0.05, giants: 0.006, shrubs: 0.05, logs: 0.004, flowers: 0.01, ivy: 0.6 , tufts: 0.15, tall: 2 }),
  b(Z.OCEANIC, "Temperate rainforest", { ground: "moss", grass: "#3a6a2a", leaf: "#2a4a2a", giants: 0.02, pines: 0.03, shrubs: 0.1, logs: 0.008, ivy: 1 , tufts: 0.3, tall: 3 }),
  b(Z.OCEANIC, "Heath and moor", { grass: "#6a5a3a", leaf: "#7a4a6a", shrubs: 0.12, boulders: 0.004, flowers: 0.01, bloom: "#c87ab0", soil: 5 , tufts: 0.6, tall: 2 }),
  b(Z.OCEANIC, "Bracken and bluebell glades", { grass: "#8a7a3a", leaf: "#4f7a2e", broad: 0.012, shrubs: 0.07, flowers: 0.05, bloom: "#7a86d8", logs: 0.002 , tufts: 0.85, tall: 5 }),
  b(Z.OCEANIC, "Fen and reedbed", { grass: "#5a7a3a", leaf: "#3f6a34", reeds: 1, shrubs: 0.02, broad: 0.004 , tufts: 0.7, tall: 5 }),
  b(Z.OCEANIC, "River meadow", { grass: "#7a9a40", leaf: "#5a8a3a", flowers: 0.07, broad: 0.01, reeds: 0.4 , tufts: 0.8, tall: 5 }),
  b(Z.OCEANIC, "Sea cliffs and coastal grass", { grass: "#7a9a50", flowers: 0.04, bloom: "#e889b0", shrubs: 0.02, scree: 0.8, soil: 4 , tufts: 0.7, tall: 3 }),
  // Continental temperate
  b(Z.CONTINENTAL, "Oak and maple woods", { leaf: "#8a4a2a", broad: 0.06, shrubs: 0.04, logs: 0.004 , tufts: 0.15, tall: 2 }),
  b(Z.CONTINENTAL, "Birch and aspen groves", { leaf: "#9aa040", bark: "#d0cec0", broad: 0.04, shrubs: 0.03, flowers: 0.02 , tufts: 0.5, tall: 3 }),
  b(Z.CONTINENTAL, "Prairie", { grass: "#a8a050", flowers: 0.06, bloom: "#e06a4a", shrubs: 0.01 , tufts: 0.95, tall: 7 }),
  b(Z.CONTINENTAL, "River bottomland", { leaf: "#5a8a30", giants: 0.012, broad: 0.03, reeds: 0.5, logs: 0.005 , tufts: 0.4, tall: 4 }),
  b(Z.CONTINENTAL, "Limestone grassland", { grass: "#8aa050", flowers: 0.05, bloom: "#f0ece0", boulders: 0.004, shrubs: 0.008, soil: 3 , tufts: 0.6, tall: 1 }),
  // Mediterranean
  b(Z.MEDITERRANEAN, "Dense scrub", { grass: "#a09050", leaf: "#5a6a44", shrubs: 0.14, broad: 0.006, soil: 4 , tufts: 0.2, tall: 2 }),
  b(Z.MEDITERRANEAN, "Evergreen oak woodland", { grass: "#a09a58", leaf: "#3a5232", broad: 0.035, shrubs: 0.03, flowers: 0.01 , tufts: 0.5, tall: 2 }),
  b(Z.MEDITERRANEAN, "Bare limestone and herbs", { ground: "gravel", leaf: "#7a8a6a", shrubs: 0.06, boulders: 0.006, flowers: 0.02, bloom: "#b48cff", soil: 2 , tufts: 0.1, tall: 1 }),
  b(Z.MEDITERRANEAN, "Pine woods on sand", { ground: "sand", leaf: "#3a5a34", pines: 0.05, shrubs: 0.02, soil: 5 , tufts: 0.15, tall: 2 }),
  b(Z.MEDITERRANEAN, "Oleander gully", { grass: "#8a9a50", leaf: "#4a6a3a", shrubs: 0.08, flowers: 0.06, bloom: "#e889b0", reeds: 0.3 , tufts: 0.4, tall: 3 }),
  // Steppe
  b(Z.STEPPE, "Steppe in flower", { grass: "#9aa050", flowers: 0.16, bloom: "#e0403a", shrubs: 0.01 , tufts: 0.7, tall: 3 }),
  b(Z.STEPPE, "Grass steppe", { grass: "#b0a060", flowers: 0.012, shrubs: 0.004 , tufts: 0.8, tall: 4 }),
  b(Z.STEPPE, "Sagebrush", { grass: "#a89a6a", leaf: "#7a8a7a", shrubs: 0.1 , tufts: 0.3, tall: 2 }),
  b(Z.STEPPE, "Salt steppe", { ground: "gravel", grass: "#a8a08a", leaf: "#8a8a78", shrubs: 0.03, soil: 3 , tufts: 0.2, tall: 1 }),
  b(Z.STEPPE, "Silt bluffs and ravines", { ground: "soil", earth: "#a8885a", grass: "#a09860", shrubs: 0.01, scree: 0.5, soil: 10 , tufts: 0.3, tall: 2 }),
  b(Z.STEPPE, "Riverside poplars", { grass: "#8a9a50", leaf: "#7a9a3a", broad: 0.04, reeds: 0.4 , tufts: 0.6, tall: 4 }),
  // Desert
  b(Z.DESERT, "Dune sea", { ground: "sand", dunes: 1, soil: 6 , tufts: 0, tall: 1 }),
  b(Z.DESERT, "Rocky desert", { ground: "rock", soil: 0, boulders: 0.006, scree: 1, dead: 0.002 , tufts: 0.01, tall: 1 }),
  b(Z.DESERT, "Gravel plain", { ground: "gravel", shrubs: 0.004, dead: 0.002, leaf: "#7a7a5a", soil: 3 , tufts: 0.03, tall: 1 }),
  b(Z.DESERT, "Slickrock canyons", { ground: "sand", soil: 1, hoodoos: 0.6, cacti: 0.004 , tufts: 0.02, tall: 1 }),
  b(Z.DESERT, "Badlands", { ground: "rock", soil: 0, hoodoos: 1, scree: 0.8 , tufts: 0, tall: 1 }),
  b(Z.DESERT, "Salt pan", { ground: "sand", earth: "#e8e2d8", soil: 4 , tufts: 0, tall: 1 }),
  b(Z.DESERT, "Dry wash with acacias", { ground: "sand", leaf: "#6a7a3a", broad: 0.012, cacti: 0.006, shrubs: 0.02, soil: 4 , tufts: 0.08, tall: 2 }),
  b(Z.DESERT, "Oasis", { leaf: "#3f7a30", grass: "#6f8f3e", giants: 0.02, reeds: 0.8, flowers: 0.02, shrubs: 0.04 , tufts: 0.6, tall: 4 }),
  // Savanna
  b(Z.SAVANNA, "Tree savanna", { grass: "#c0a050", leaf: "#6a7a3a", broad: 0.012, shrubs: 0.01 , tufts: 0.95, tall: 6 }),
  b(Z.SAVANNA, "Thorn scrub", { grass: "#b09a58", leaf: "#7a7a4a", shrubs: 0.1, dead: 0.004 , tufts: 0.4, tall: 3 }),
  b(Z.SAVANNA, "Baobab woodland", { grass: "#b8a050", leaf: "#5a7040", bark: "#8a7a6a", giants: 0.01, broad: 0.01 , tufts: 0.8, tall: 5 }),
  b(Z.SAVANNA, "Gallery forest", { leaf: "#2f6a30", giants: 0.02, broad: 0.04, reeds: 0.5, ivy: 0.6 , tufts: 0.3, tall: 3 }),
  b(Z.SAVANNA, "Seasonal floodplain", { grass: "#6f8f3e", reeds: 0.8, broad: 0.006, flowers: 0.02 , tufts: 0.8, tall: 5 }),
  // Monsoon
  b(Z.MONSOON, "Dry deciduous forest", { grass: "#9a9048", leaf: "#6a6030", broad: 0.05, shrubs: 0.04, logs: 0.004 , tufts: 0.4, tall: 3 }),
  b(Z.MONSOON, "Bamboo thickets", { leaf: "#8aa83a", shrubs: 0.15, broad: 0.01, reeds: 0.4 , tufts: 0.5, tall: 4 }),
  b(Z.MONSOON, "Red laterite scrub", { ground: "soil", earth: "#9a4a2a", grass: "#a09048", leaf: "#6a7030", shrubs: 0.06, broad: 0.008, boulders: 0.004, scree: 0.8, soil: 5 , tufts: 0.3, tall: 2 }),
  b(Z.MONSOON, "Karst hills with figs", { grass: "#7a9040", leaf: "#3f6a2a", broad: 0.03, giants: 0.004, ivy: 0.8, boulders: 0.005, mouths: 1, scree: 0.9, soil: 4 , tufts: 0.3, tall: 2 }),
  b(Z.MONSOON, "Monsoon wetland", { grass: "#5a8a3a", reeds: 1, flowers: 0.03, bloom: "#e889b0", broad: 0.004 , tufts: 0.8, tall: 5 }),
  // Rainforest
  b(Z.RAINFOREST, "Vine tangle and wild bananas", { ground: "soil", grass: "#4a8a2a", leaf: "#5a9a2a", broad: 0.03, shrubs: 0.16, ivy: 1, logs: 0.01, flowers: 0.03, bloom: "#e04a3a" , tufts: 0.6, tall: 4 }),
  b(Z.RAINFOREST, "Lowland rainforest", { ground: "moss", grass: "#3a6a2a", leaf: "#1f5a2a", giants: 0.035, broad: 0.05, shrubs: 0.1, ivy: 1, logs: 0.006 , tufts: 0.2, tall: 3 }),
  b(Z.RAINFOREST, "Cloud forest", { ground: "moss", grass: "#3a5a3a", leaf: "#2a5a44", broad: 0.05, giants: 0.01, ivy: 1, shrubs: 0.08 , tufts: 0.3, tall: 2 }),
  b(Z.RAINFOREST, "Mangroves", { ground: "soil", earth: "#4a3a2a", leaf: "#2a4a2a", broad: 0.04, reeds: 0.3 , tufts: 0.05, tall: 1 }),
  b(Z.RAINFOREST, "Swamp forest", { ground: "moss", leaf: "#2f4a28", giants: 0.015, broad: 0.03, reeds: 0.6, logs: 0.006 , tufts: 0.3, tall: 3 }),
  b(Z.RAINFOREST, "Jungle among limestone towers", { leaf: "#2a6a2a", hoodoos: 1, hoodooCap: 0, broad: 0.04, giants: 0.01, ivy: 1 , tufts: 0.3, tall: 3 }),
];

/** A colour that stands for a biome on maps: its ground, its trees, or its grass. */
export function swatchOf(b: BiomeDef) {
  switch (b.ground) {
    case "sand":
      return b.earth === BASE.earth ? "#d8c48a" : b.earth;
    case "snow":
      return "#e4ecf4";
    case "gravel":
      return "#a09a8e";
    case "rock":
      return "#8a7e76";
  }
  if (b.reeds >= 0.6) return "#6a9a8a";
  return b.pines + b.broad + b.giants > 0.025 ? b.leaf : b.grass;
}

const byName = new Map(BIOMES.map((d, i) => [d.name, i]));
const id = (name: string) => {
  const i = byName.get(name);
  if (i === undefined) throw new Error(`no biome ${name}`);
  return i;
};

// ---- The table: zone x habitat x soil -> biome ------------------------------------

const H = HABITAT,
  S = SOIL;
interface Rule {
  biome: number;
  h?: number[];
  s?: number[];
  wet?: boolean;
  dry?: boolean;
  high?: boolean;
  open?: boolean;
}
const r = (name: string, when: Omit<Rule, "biome"> = {}): Rule => ({
  biome: id(name),
  ...when,
});

/** For each zone, rules in order; the first that fits decides, the last is the default. */
const RULES: Rule[][] = [];
RULES[Z.ICE] = [
  r("Frozen coast", { h: [H.SHORE] }),
  r("Bare peaks through the ice", { h: [H.RIDGE, H.CLIFF] }),
  r("Ice sheet"),
];
RULES[Z.TUNDRA] = [
  r("Frozen shore", { h: [H.SHORE] }),
  r("Permafrost bog", { h: [H.WETLAND] }),
  r("Permafrost bog", { s: [S.PEAT] }),
  r("Shrub tundra", { h: [H.VALLEY, H.RIVERSIDE] }),
  r("Lichen tundra", { h: [H.RIDGE, H.CLIFF] }),
  r("Lichen tundra", { s: [S.STONY] }),
  r("Moss and sedge tundra"),
];
RULES[Z.BOREAL] = [
  r("Bog", { h: [H.WETLAND] }),
  r("Bog", { s: [S.PEAT] }),
  r("Birch and alder valley", { h: [H.VALLEY, H.RIVERSIDE, H.SHORE] }),
  r("Larch ridge", { h: [H.RIDGE, H.CLIFF] }),
  r("Burnt forest and fireweed", { open: true }),
  r("Pine and lichen woodland", { s: [S.SANDY, S.STONY] }),
  r("Spruce forest"),
];
RULES[Z.ALPINE] = [
  r("Snowfield", { h: [H.RIDGE] }),
  r("Scree slope", { h: [H.CLIFF] }),
  r("Scree slope", { h: [H.SLOPE], s: [S.STONY] }),
  r("Alpine meadow", { h: [H.FLAT, H.VALLEY, H.RIVERSIDE, H.WETLAND, H.SHORE] }),
  r("Treeline"),
];
RULES[Z.OCEANIC] = [
  r("Sea cliffs and coastal grass", { h: [H.SHORE] }),
  r("Fen and reedbed", { h: [H.WETLAND] }),
  r("River meadow", { h: [H.RIVERSIDE, H.VALLEY] }),
  r("Heath and moor", { h: [H.RIDGE] }),
  r("Heath and moor", { s: [S.STONY, S.PEAT] }),
  r("Bracken and bluebell glades", { open: true }),
  r("Temperate rainforest", { wet: true }),
  r("Oak and beech woods"),
];
RULES[Z.CONTINENTAL] = [
  r("River bottomland", { h: [H.RIVERSIDE, H.VALLEY, H.WETLAND, H.SHORE] }),
  r("Limestone grassland", { s: [S.ALKALINE], h: [H.FLAT, H.RIDGE] }),
  r("Prairie", { h: [H.FLAT], dry: true }),
  r("Birch and aspen groves", { h: [H.RIDGE, H.SLOPE, H.CLIFF], s: [S.SANDY, S.STONY] }),
  r("Birch and aspen groves", { open: true }),
  r("Oak and maple woods"),
];
RULES[Z.MEDITERRANEAN] = [
  r("Oleander gully", { h: [H.RIVERSIDE, H.VALLEY, H.WETLAND] }),
  r("Bare limestone and herbs", { s: [S.ALKALINE] }),
  r("Bare limestone and herbs", { h: [H.RIDGE, H.CLIFF] }),
  r("Pine woods on sand", { s: [S.SANDY] }),
  r("Dense scrub", { open: true }),
  r("Evergreen oak woodland", { h: [H.FLAT, H.SHORE] }),
  r("Dense scrub"),
];
RULES[Z.STEPPE] = [
  r("Riverside poplars", { h: [H.RIVERSIDE] }),
  r("Salt steppe", { s: [S.SALTY] }),
  r("Salt steppe", { h: [H.WETLAND, H.SHORE] }),
  r("Silt bluffs and ravines", { h: [H.CLIFF, H.VALLEY], s: [S.CLAY] }),
  r("Sagebrush", { h: [H.SLOPE, H.RIDGE, H.CLIFF] }),
  r("Steppe in flower", { open: true }),
  r("Grass steppe"),
];
RULES[Z.DESERT] = [
  r("Oasis", { h: [H.RIVERSIDE] }),
  r("Salt pan", { s: [S.SALTY] }),
  r("Salt pan", { h: [H.WETLAND] }),
  r("Dry wash with acacias", { h: [H.VALLEY, H.SHORE] }),
  r("Slickrock canyons", { s: [S.SANDY], h: [H.CLIFF, H.SLOPE, H.RIDGE] }),
  r("Badlands", { s: [S.CLAY], h: [H.CLIFF, H.SLOPE] }),
  r("Rocky desert", { h: [H.RIDGE, H.CLIFF] }),
  r("Dune sea", { s: [S.SANDY] }),
  r("Gravel plain"),
];
RULES[Z.SAVANNA] = [
  r("Gallery forest", { h: [H.RIVERSIDE] }),
  r("Seasonal floodplain", { h: [H.WETLAND, H.VALLEY, H.SHORE] }),
  r("Thorn scrub", { h: [H.RIDGE, H.CLIFF] }),
  r("Thorn scrub", { s: [S.STONY], dry: true }),
  r("Tree savanna", { open: true }),
  r("Baobab woodland", { s: [S.RICH, S.ALKALINE] }),
  r("Tree savanna"),
];
RULES[Z.MONSOON] = [
  r("Monsoon wetland", { h: [H.WETLAND, H.SHORE] }),
  r("Bamboo thickets", { h: [H.VALLEY, H.RIVERSIDE] }),
  r("Bamboo thickets", { open: true }),
  r("Karst hills with figs", { s: [S.ALKALINE], h: [H.SLOPE, H.RIDGE, H.CLIFF, H.VALLEY] }),
  r("Red laterite scrub", { h: [H.RIDGE, H.CLIFF] }),
  r("Red laterite scrub", { s: [S.STONY, S.SANDY], dry: true }),
  r("Dry deciduous forest"),
];
RULES[Z.RAINFOREST] = [
  r("Mangroves", { h: [H.SHORE] }),
  r("Swamp forest", { h: [H.WETLAND] }),
  r("Vine tangle and wild bananas", { open: true }),
  r("Jungle among limestone towers", { s: [S.ALKALINE] }),
  r("Cloud forest", { high: true }),
  r("Lowland rainforest"),
];

/**
 * The biome for a land place, or -1 for a zone with no land biome (sea,
 * lake, salt flat: those are water or bare). wet: very rainy; dry: on the
 * dry side for its zone; high: well above the sea.
 */
export function classify(
  zone: number,
  habitat: number,
  soil: number,
  flags: { wet: boolean; dry: boolean; high: boolean; open?: boolean },
) {
  const rules = RULES[zone];
  if (!rules) return zone === Z.SALT_FLAT ? id("Salt pan") : -1;
  for (const rule of rules) {
    if (rule.h && !rule.h.includes(habitat)) continue;
    if (rule.s && !rule.s.includes(soil)) continue;
    if (rule.wet && !flags.wet) continue;
    if (rule.dry && !flags.dry) continue;
    if (rule.high && !flags.high) continue;
    if (rule.open && !flags.open) continue;
    return rule.biome;
  }
  return rules[rules.length - 1].biome;
}

/** Ground cover materials for a look: the top cell and what lies under it. */
export function coverOf(look: Look) {
  switch (look.ground) {
    case "sand":
      return { top: M.SAND, sub: M.SAND };
    case "snow":
      return { top: M.SNOW, sub: M.SNOW };
    case "gravel":
      return { top: M.GRAVEL, sub: M.GRAVEL };
    case "ash":
      return { top: M.ASH, sub: M.ASH };
    case "moss":
      return { top: M.MOSS, sub: M.SOIL };
    case "soil":
      return { top: M.SOIL, sub: M.SOIL };
    case "rock":
      return { top: M.ROCK, sub: M.ROCK };
    default:
      return { top: M.GRASS, sub: M.SOIL };
  }
}
