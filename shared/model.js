import { PERFECT } from "./timing.js";

import { registry, defaults, parameters } from "../scenes/registry.ts";
export const SCENES = registry;
export const PALETTES = {
  aurora: { name: "Aurora", colors: ["#173e72", "#55c5bf", "#e7ba80"] },
  ember: { name: "Ember", colors: ["#59254e", "#f07950", "#ffe4a3"] },
  iris: { name: "Iris", colors: ["#342a76", "#b696ee", "#f0c9c0"] },
  moss: { name: "Moss", colors: ["#214b47", "#9bbd8b", "#e1cf9b"] },
};

export function dailySeed(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  let seed = 2166136261;
  for (const c of day) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  return seed;
}

export function makeLayout(kind = "staggered", gap = 10) {
  // Dimensions describe ACTIVE image area. Bezels extend beyond it.
  const width = 531,
    height = 299,
    bezel = 6,
    stepX = width + 2 * bezel + gap,
    stepY = height + 2 * bezel + gap;
  const points =
    kind === "grid"
      ? [
          [0, 0],
          [stepX, 0],
          [0, stepY],
          [stepX, stepY],
        ]
      : kind === "cascade"
        ? [
            [0, 0],
            [stepX, 115],
            [140, stepY],
            [stepX + 140, stepY + 115],
          ]
        : [
            [0, 85],
            [stepX, 0],
            [0, stepY + 85],
            [stepX, stepY],
          ];
  return points.map(([x, y], i) => ({
    id: `panel-${i + 1}`,
    x,
    y,
    width,
    height,
    bezel,
    rotation: 0,
    timing: { ...PERFECT },
  }));
}

export function makeProject() {
  return {
    schemaVersion: 2,
    scene: {
      id: "ribbons",
      version: 1,
      seed: dailySeed(),
      palette: "aurora",
      speed: 0.7,
      params: {},
      style: "default",
    },
    layout: makeLayout(),
    timingEnabled: false,
    time: 12,
  };
}

export function localToWorld(panel, u, v) {
  const angle = (panel.rotation * Math.PI) / 180,
    x = (u - 0.5) * panel.width,
    y = (v - 0.5) * panel.height;
  return {
    x: panel.x + panel.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: panel.y + panel.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

export function layoutBounds(panels) {
  const corners = panels.flatMap((p) => {
    const bX = p.bezel / p.width,
      bY = p.bezel / p.height;
    return [
      [-bX, -bY],
      [1 + bX, -bY],
      [-bX, 1 + bY],
      [1 + bX, 1 + bY],
    ].map(([u, v]) => localToWorld(p, u, v));
  });
  const xs = corners.map((p) => p.x),
    ys = corners.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function validateProject(input) {
  const number = (v, min, max, name) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
      throw new Error(`Invalid ${name} (${min}–${max}).`);
    return v;
  };
  if (!input || ![1, 2].includes(input.schemaVersion))
    throw new Error("Unsupported artwork schema version.");
  const scene = input.scene;
  if (
    !scene ||
    !Number.isInteger(scene.seed) ||
    !Object.hasOwn(SCENES, scene.id) ||
    scene.version !== 1 ||
    !Object.hasOwn(PALETTES, scene.palette)
  )
    throw new Error("Unknown scene version or palette.");
  if (!Array.isArray(input.layout) || input.layout.length !== 4)
    throw new Error("This prototype requires four panels.");
  const ids = new Set();
  const layout = input.layout.map((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      !/^panel-[0-9]+$/.test(p.id) ||
      ids.has(p.id)
    )
      throw new Error("Panel IDs must be unique.");
    ids.add(p.id);
    const t = p.timing;
    if (!t || !["none", "top-down", "bottom-up"].includes(t.scanout))
      throw new Error("Invalid scanout direction.");
    return {
      id: p.id,
      x: number(p.x, -5000, 5000, "x"),
      y: number(p.y, -5000, 5000, "y"),
      width: number(p.width, 100, 2000, "width"),
      height: number(p.height, 100, 2000, "height"),
      bezel: number(p.bezel, 0, 50, "bezel"),
      rotation: number(p.rotation, -180, 180, "rotation"),
      timing: {
        delay: number(t.delay, 0, 500, "delay"),
        hz: number(t.hz, 24, 144, "refresh rate"),
        phase: number(t.phase, 0, 50, "phase"),
        jitter: number(t.jitter, 0, 30, "jitter"),
        drift: number(t.drift, -200, 200, "drift"),
        scanout: t.scanout,
      },
    };
  });
  if (typeof input.timingEnabled !== "boolean")
    throw new Error("Invalid timing toggle.");
  return {
    schemaVersion: 2,
    scene: {
      id: scene.id,
      version: 1,
      seed: number(scene.seed, 0, 4294967295, "seed"),
      palette: scene.palette,
      speed: number(scene.speed, 0.05, 3, "speed"),
      params: parameters(scene.id, scene.params),
      style: SCENES[scene.id].styles.includes(scene.style)
        ? scene.style
        : SCENES[scene.id].styles[0],
    },
    layout,
    timingEnabled: input.timingEnabled,
    time:
      number(input.time, 0, 86400, "time") *
      (input.schemaVersion === 1 ? scene.speed : 1),
    ...(input.checkpoint
      ? { checkpoint: validateCheckpoint(input.checkpoint, scene) }
      : {}),
    ...(input.world ? { world: validateWorld(input.world) } : {}),
    ...(input.events ? { events: validateEvents(input.events, scene.id) } : {}),
    ...(input.initialParams
      ? { initialParams: parameters(scene.id, input.initialParams) }
      : {}),
  };
}

function validateCheckpoint(c, scene) {
  if (
    !c ||
    !Number.isInteger(c.tick) ||
    c.tick < 0 ||
    c.tick > 5184000 ||
    !Array.isArray(c.data) ||
    !c.data.every((v) => typeof v === "number" && Number.isFinite(v))
  )
    throw new Error("Invalid checkpoint");
  const params = parameters(scene.id, scene.params),
    kind = SCENES[scene.id].kind;
  if (kind === "procedural")
    throw new Error("Procedural scenes do not use checkpoints");
  if (kind === "grid") {
    const width = Number(params.resolution),
      expected = width * Math.round(width * 0.625) * 4;
    if (
      c.data.length !== expected ||
      !c.data.every(
        (v) =>
          v >= 0 &&
          v <= (scene.id === "chemical" ? 1 : 255) &&
          (scene.id === "chemical" || Number.isInteger(v)),
      )
    )
      throw new Error("Invalid grid checkpoint");
  }
  if (
    scene.id === "murmuration" &&
    (c.data.length !== Number(params.population) * 4 ||
      !c.data.every((v, i) =>
        i % 4 < 2 ? v >= 0 && v <= 1 : Math.abs(v) <= 1,
      ))
  )
    throw new Error("Invalid flock checkpoint");
  if (
    scene.id === "platformer" &&
    (c.data.length !== 9 ||
      !Number.isInteger(c.data[4]) ||
      c.data[4] < 0 ||
      c.data[4] > 21 ||
      !Number.isInteger(c.data[5]) ||
      c.data[5] < 0 ||
      c.data[5] > 1000000 ||
      c.data.some((v) => Math.abs(v) > 1e9))
  )
    throw new Error("Invalid platformer checkpoint");
  return {
    tick: c.tick,
    data: c.data,
    ...(c.extra?.params
      ? { extra: { params: parameters(scene.id, c.extra.params) } }
      : {}),
  };
}

function validateWorld(w) {
  if (
    !w ||
    !["x", "y", "width", "height"].every(
      (k) => typeof w[k] === "number" && Number.isFinite(w[k]),
    ) ||
    w.width < 100 ||
    w.height < 100 ||
    w.width > 10000 ||
    w.height > 10000
  )
    throw new Error("Invalid world bounds");
  return { x: w.x, y: w.y, width: w.width, height: w.height };
}
function validateEvents(events, id) {
  if (!Array.isArray(events) || events.length > 10000)
    throw new Error("Invalid timeline");
  return events.map((e) => {
    if (!Number.isInteger(e.tick) || e.tick < 0 || e.tick > 5184000)
      throw new Error("Invalid event");
    return { tick: e.tick, params: parameters(id, e.params) };
  });
}
