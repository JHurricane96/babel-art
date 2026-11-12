import { fragment as interference } from "./interference";
import { fragment as contours } from "./contours";
import { CHEMICAL_PRESETS, DEFAULT_CHEMICAL_PRESET } from "../engine/chemical";
import { Grid } from "../engine/grid";
import { Flock, Platformer } from "../engine/entities";
import { ParticleRivers } from "../engine/particles";
import { SlimeNetworks, SLIME_PRESETS } from "../engine/slime";
import type { Scene, Params } from "../engine/types";
import { fragment as ribbons } from "./ribbons";
import { fragment as julia } from "./julia";
import { fragment as fireflies } from "./fireflies";
import { fragment as test } from "./test";
const procedural = (
  name: string,
  subtitle: string,
  description: string,
  fragment: string,
): Scene => ({
  name,
  subtitle,
  description,
  fragment,
  version: 1,
  kind: "procedural",
  parameters: {},
  styles: ["default"],
});
export const registry: Record<string, Scene> = {
  ribbons: procedural(
    "Tidal ribbons",
    "A current without edges",
    "Silken waves travel through a world larger than its windows.",
    ribbons,
  ),
  julia: procedural(
    "Julia garden",
    "Order, endlessly unfolding",
    "A slowly breathing fractal, seen through four windows.",
    julia,
  ),
  fireflies: procedural(
    "Gap travelers",
    "The space between is alive",
    "Fireflies continue through the invisible world.",
    fireflies,
  ),
  test: procedural(
    "Sync study",
    "Make time visible",
    "Moving bars and lines reveal presentation timing differences.",
    test,
  ),
  tapestry: {
    name: "Living tapestry",
    subtitle: "Tiny rules, endless life",
    description: "Living cells and cyclic waves weave a changing tapestry.",
    version: 1,
    kind: "grid",
    create: (gl, seed, params) => new Grid(gl, seed, params),
    styles: ["luminous", "flat"],
    parameters: {
      rule: {
        label: "Rule",
        value: "life",
        options: ["life", "cyclic"],
        restart: true,
      },
      resolution: {
        label: "Grid width · restart",
        value: 128,
        options: ["128", "256"],
        restart: true,
      },
      rate: {
        label: "Generations / second",
        value: 12,
        min: 1,
        max: 30,
        step: 1,
      },
      autonomous: { label: "Seed new colonies", value: true },
      trails: {
        label: "Generation trails",
        value: 0.92,
        min: 0,
        max: 0.99,
        step: 0.01,
      },
    },
  },
};
registry.chemical = {
  name: "Chemical garden",
  subtitle: "Coral, cells and labyrinths",
  description:
    "Virtual chemicals react and diffuse into evolving organic patterns.",
  version: 1,
  kind: "grid",
  create: (gl, seed, params) => new Grid(gl, seed, params, true),
  styles: ["embossed", "flat"],
  parameters: {
    resolution: {
      label: "Grid width · restart",
      value: 128,
      options: ["128", "256"],
      restart: true,
    },
    feed: {
      label: "Feed rate",
      value: CHEMICAL_PRESETS[DEFAULT_CHEMICAL_PRESET].feed,
      min: 0.01,
      max: 0.08,
      step: 0.0001,
    },
    kill: {
      label: "Kill rate",
      value: CHEMICAL_PRESETS[DEFAULT_CHEMICAL_PRESET].kill,
      min: 0.03,
      max: 0.075,
      step: 0.0001,
    },
    autonomous: { label: "Autonomous disturbances", value: true },
  },
};
registry.murmuration = {
  name: "Murmuration",
  subtitle: "A thousand small decisions",
  description:
    "A flock organizes, scatters, and reunites around changing attractors.",
  version: 1,
  kind: "entities",
  create: (gl, seed, params) => new Flock(seed, params),
  styles: ["luminous"],
  parameters: {
    population: {
      label: "Population · restart",
      value: 220,
      min: 20,
      max: 300,
      step: 10,
      restart: true,
    },
    cohesion: { label: "Cohesion", value: 0.4, min: 0.05, max: 1, step: 0.05 },
    velocity: {
      label: "Flight speed",
      value: 0.12,
      min: 0.03,
      max: 0.3,
      step: 0.01,
    },
    predator: { label: "Autonomous predator", value: true },
  },
};
registry.platformer = {
  name: "Platformer terrarium",
  subtitle: "A little adventure, forever",
  description:
    "An autonomous explorer crosses generated worlds. Change its style without interrupting the journey.",
  version: 1,
  kind: "entities",
  create: (gl, seed, params) => new Platformer(seed, params),
  styles: ["pixel", "geometric"],
  parameters: {},
};
registry.rivers = {
  name: "Particle rivers",
  subtitle: "Currents drawn in light",
  description:
    "Luminous filaments stream through changing currents, split into tributaries and coil around moving vortices.",
  version: 1,
  kind: "entities",
  create: (gl, seed, params) => new ParticleRivers(seed, params),
  styles: ["silk"],
  parameters: {
    population: {
      label: "Particles · restart",
      value: 960,
      min: 240,
      max: 1800,
      step: 120,
      restart: true,
    },
    velocity: {
      label: "Current speed",
      value: 0.14,
      min: 0.04,
      max: 0.3,
      step: 0.01,
    },
    turbulence: {
      label: "Flow complexity",
      value: 1.1,
      min: 0.5,
      max: 2,
      step: 0.1,
    },
  },
};
registry.slime = {
  name: "Slime mold networks",
  subtitle: "A living map of connections",
  description:
    "Sensing agents weave branching trails between moving nutrient pools. Old paths dissolve as new connections take shape.",
  version: 1,
  kind: "entities",
  create: (gl, seed, params) => new SlimeNetworks(seed, params),
  styles: ["luminous", "etched"],
  presets: SLIME_PRESETS,
  parameters: {
    recipe: {
      label: "Network topology",
      value: "mycelium",
      options: Object.keys(SLIME_PRESETS),
      restart: true,
      hidden: true,
    },
    population: {
      label: "Agents · restart",
      value: 2400,
      min: 600,
      max: 4000,
      step: 100,
      restart: true,
    },
    branching: {
      label: "Branching",
      value: 0.65,
      min: 0.1,
      max: 1,
      step: 0.05,
    },
    persistence: {
      label: "Trail memory",
      value: 0.968,
      min: 0.94,
      max: 0.985,
      step: 0.001,
    },
  },
};
export const defaults = (id: string): Params =>
  Object.fromEntries(
    Object.entries(registry[id].parameters).map(([k, v]) => [k, v.value]),
  );
export function parameters(id: string, value: Params = {}): Params {
  const result = defaults(id);
  for (const [k, spec] of Object.entries(registry[id].parameters)) {
    const v = value[k];
    if (v === undefined) continue;
    if (spec.options) {
      if (!spec.options.includes(String(v))) throw new Error("Invalid " + k);
      result[k] = typeof spec.value === "number" ? Number(v) : v;
    } else if (typeof spec.value === "number") {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        (k === "population" && !Number.isInteger(v)) ||
        v < spec.min! ||
        v > spec.max!
      )
        throw new Error("Invalid " + k);
      result[k] = v;
    } else {
      if (typeof v !== typeof spec.value) throw new Error("Invalid " + k);
      result[k] = v;
    }
  }
  return result;
}

for (const id of ["tapestry", "chemical", "murmuration", "rivers", "slime"])
  Object.assign(registry[id].parameters, {
    variation: { label: "Variation", value: 0.65, min: 0, max: 1, step: 0.05 },
    autoRecovery: { label: "Automatic recovery", value: true },
  });

registry.interference = procedural(
  "Interference bloom",
  "Waves that never settle",
  "Interacting fields continuously form, fold and dissolve luminous structures.",
  interference,
);
registry.contours = procedural(
  "Living contours",
  "An evolving landscape",
  "Contour lines reveal a landscape that continuously reshapes itself.",
  contours,
);

for (const id of [
  "tapestry",
  "chemical",
  "murmuration",
  "rivers",
  "slime",
  "interference",
  "contours",
])
  registry[id].parameters.richness = {
    label: "Surface detail",
    value: 0.8,
    min: 0,
    max: 1,
    step: 0.05,
  };
