import { RELEASE, stages } from "../scenes/release";
import { registry, defaults, parameters } from "../scenes/registry";
import { PALETTES } from "./palettes";
export type Command =
  | { type: "scene"; id: string }
  | { type: "parameter"; key: string; value: string | number | boolean }
  | { type: "style"; value: string }
  | { type: "speed"; value: number }
  | { type: "palette"; value: string }
  | { type: "reseed"; seed: number };
export function applyCommand(project: any, command: Command) {
  const scene = project.scene;
  switch (command.type) {
    case "scene":
      if (!registry[command.id] || (stages[command.id] || 0) > RELEASE)
        throw new Error("Unknown scene");
      scene.id = command.id;
      scene.params = defaults(scene.id);
      scene.style = registry[scene.id].styles[0];
      project.time = 0;
      delete project.checkpoint;
      break;
    case "parameter":
      if (!registry[scene.id].parameters[command.key])
        throw new Error("Unknown parameter");
      if (registry[scene.id].parameters[command.key].restart) {
        project.time = 0;
        delete project.checkpoint;
        delete project.events;
        delete project.initialParams;
        delete project.replayFloor;
        delete project.baseCheckpoint;
      }
      scene.params = parameters(scene.id, {
        ...scene.params,
        [command.key]: command.value,
      });
      break;
    case "style":
      if (!registry[scene.id].styles.includes(command.value))
        throw new Error("Unknown style");
      scene.style = command.value;
      break;
    case "speed":
      if (
        !Number.isFinite(command.value) ||
        command.value < 0.05 ||
        command.value > 3
      )
        throw new Error("Invalid speed");
      scene.speed = command.value;
      break;
    case "palette":
      if (!Object.hasOwn(PALETTES, command.value))
        throw new Error("Invalid palette");
      scene.palette = command.value;
      break;
    case "reseed":
      if (
        !Number.isInteger(command.seed) ||
        command.seed < 0 ||
        command.seed > 4294967295
      )
        throw new Error("Invalid seed");
      scene.seed = command.seed;
      project.time = 0;
      delete project.checkpoint;
  }
}
export function parseText(text: string, project: any): Command | undefined {
  const t = text.toLowerCase();
  if (/calmer|slower/.test(t))
    return { type: "speed", value: Math.max(0.05, project.scene.speed * 0.65) };
  if (/faster|energetic/.test(t))
    return { type: "speed", value: Math.min(3, project.scene.speed * 1.5) };
  if (/warmer|ember/.test(t)) return { type: "palette", value: "ember" };
  if (/cooler|aurora/.test(t)) return { type: "palette", value: "aurora" };
  for (const id of Object.keys(PALETTES))
    if (t === id || t === `palette ${id}`)
      return { type: "palette", value: id };
  for (const style of registry[project.scene.id].styles)
    if (t.includes(style)) return { type: "style", value: style };
  const aliases: Record<string, string[]> = {
    slime: ["slime", "mycelium", "network"],
    rivers: ["particle", "river", "flow field"],
    interference: ["interference", "bloom"],
    contours: ["contour", "topography", "landscape"],
    tapestry: ["life", "cellular", "tapestry"],
    chemical: ["chemical", "coral", "reaction"],
    murmuration: ["flock", "birds", "murmuration"],
    platformer: ["platform", "game", "mario"],
    fireflies: ["fireflies", "gap travelers"],
    ribbons: ["ribbon", "wave"],
    julia: ["julia", "fractal"],
    test: ["sync study"],
  };
  for (const [id, words] of Object.entries(aliases))
    if (words.some((w) => t.includes(w))) return { type: "scene", id };
  return undefined;
}
