import { Grid } from "../engine/grid";
import { Flock, Platformer } from "../engine/entities";
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
      value: 0.0367,
      min: 0.01,
      max: 0.08,
      step: 0.0001,
    },
    kill: {
      label: "Kill rate",
      value: 0.0649,
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
      value: 120,
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
