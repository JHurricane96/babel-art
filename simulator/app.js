import { RELEASE, stages } from "../scenes/release.ts";
import { parseText, applyCommand } from "../engine/commands.ts";
import {
  SCENES,
  PALETTES,
  makeProject,
  makeLayout,
  layoutBounds,
  dailySeed,
  validateProject,
} from "../shared/model.js";
import { frameAt, TIMING_PRESETS } from "../shared/timing.js";
import { Runtime } from "../engine/runtime.ts";
import { defaults } from "../scenes/registry.ts";
import { load, save } from "../engine/storage.ts";
const $ = (id) => document.getElementById(id),
  clone = (v) => structuredClone(v);
let project = makeProject(),
  selected = 0,
  playing = true,
  last = performance.now(),
  fit = { scale: 1, x: 0, y: 0 },
  gallery = [],
  undo = [],
  saveTimer,
  toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").style.display = "none"), 4000);
}
try {
  const saved =
    (await load("project")) ||
    JSON.parse(localStorage.getItem("babel.project.v1") || "null");
  if (saved) project = validateProject(saved);
  gallery = (
    (await load("gallery")) ||
    JSON.parse(localStorage.getItem("babel.gallery.v1") || "[]")
  ).map((item) => ({ ...item, project: validateProject(item.project) }));
} catch {
  toast("Storage could not be restored. Export important work.");
}
const runtime = new Runtime($("wall"));
function portable() {
  return {
    ...project,
    checkpoint: runtime.checkpoint(),
    world: runtime.world,
    events: runtime.events,
    initialParams: runtime.initialParams,
  };
}
async function persist() {
  try {
    await save("project", portable());
    await save("gallery", gallery);
  } catch {
    toast("Storage is unavailable. Export JSON to preserve your work.");
  }
}
function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 300);
}
function remember() {
  undo.push(clone(portable()));
  if (undo.length > 30) undo.shift();
}
function update(fn) {
  remember();
  fn(project);
  sync();
  changed();
}
const panels = project.layout.map((p, i) => {
  const node = document.createElement("div");
  node.className = "panel";
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", `Select and drag panel ${i + 1}`);
  const canvas = document.createElement("canvas");
  const tag = document.createElement("span");
  tag.className = "panel-tag";
  tag.textContent = String(i + 1).padStart(2, "0");
  node.append(canvas, tag);
  $("wall").append(node);
  canvas.hidden = true;
  const renderer = null;
  node.addEventListener("focus", () => {
    selected = i;
    syncInspectors();
  });
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    selected = i;
    syncInspectors();
    remember();
    const start = {
      x: e.clientX,
      y: e.clientY,
      px: project.layout[i].x,
      py: project.layout[i].y,
      scale: fit.scale,
    };
    node.setPointerCapture(e.pointerId);
    const move = (ev) => {
      project.layout[i].x = Math.max(
        -5000,
        Math.min(5000, start.px + (ev.clientX - start.x) / start.scale),
      );
      project.layout[i].y = Math.max(
        -5000,
        Math.min(5000, start.py + (ev.clientY - start.y) / start.scale),
      );
      position(false);
      syncFields();
    };
    const stop = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", stop);
      node.removeEventListener("pointercancel", stop);
      position();
      changed();
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", stop);
    node.addEventListener("pointercancel", stop);
  });
  return { node, canvas, renderer };
});
function position(refit = true) {
  const bounds = layoutBounds(project.layout),
    wall = $("wall");
  if (refit) {
    const scale =
      Math.min(
        wall.clientWidth / bounds.width,
        wall.clientHeight / bounds.height,
      ) * 0.91;
    fit = {
      scale,
      x: (wall.clientWidth - bounds.width * scale) / 2 - bounds.x * scale,
      y: (wall.clientHeight - bounds.height * scale) / 2 - bounds.y * scale,
    };
  }
  project.layout.forEach((p, i) => {
    const s = fit.scale,
      b = p.bezel * s;
    Object.assign(panels[i].node.style, {
      left: `${fit.x + (p.x - p.bezel) * s}px`,
      top: `${fit.y + (p.y - p.bezel) * s}px`,
      width: `${(p.width + 2 * p.bezel) * s}px`,
      height: `${(p.height + 2 * p.bezel) * s}px`,
      borderWidth: `${b}px`,
      transform: `rotate(${p.rotation}deg)`,
    });
  });
  $("wall-size").textContent =
    `${Math.round(bounds.width)} × ${Math.round(bounds.height)} mm · 4 PANELS`;
}
new ResizeObserver(() => position()).observe($("wall"));
for (const [id, s] of Object.entries(SCENES)) {
  if ((stages[id] || 0) > RELEASE) continue;
  const b = document.createElement("button");
  b.className = "scene";
  b.dataset.scene = id;
  b.innerHTML = `<span class="number">${String(Object.keys(SCENES).indexOf(id) + 1).padStart(2, "0")}</span><strong>${s.name}</strong><small>${s.subtitle}</small>`;
  b.onclick = () =>
    update((p) => {
      p.scene.id = id;
      p.scene.params = defaults(id);
      p.scene.style = SCENES[id].styles[0];
      p.time = 0;
      delete p.checkpoint;
      delete p.events;
      delete p.initialParams;
    });
  $("scenes").append(b);
}
for (const [id, p] of Object.entries(PALETTES))
  $("palette").add(new Option(p.name, id));
for (const picker of document.querySelectorAll(".panel-picker"))
  for (let i = 0; i < 4; i++) {
    const b = document.createElement("button");
    b.textContent = `0${i + 1}`;
    b.onclick = () => {
      selected = i;
      syncInspectors();
    };
    picker.append(b);
  }
const geometry = {
  x: ["X · mm", -5000, 5000, 1],
  y: ["Y · mm", -5000, 5000, 1],
  width: ["Width · mm", 100, 2000, 1],
  height: ["Height · mm", 100, 2000, 1],
  bezel: ["Bezel · mm", 0, 50, 0.5],
  rotation: ["Rotation · °", -180, 180, 1],
};
const timing = {
  delay: ["Delay · ms", 0, 500, 0.1],
  hz: ["Refresh · Hz", 24, 144, 0.01],
  phase: ["Phase · ms", 0, 50, 0.1],
  jitter: ["Delivery jitter · ms", 0, 30, 0.1],
  drift: ["Clock drift · ppm", -200, 200, 1],
};
function fields(def, target, prefix, isTiming) {
  for (const [key, [name, min, max, step]] of Object.entries(def)) {
    const label = document.createElement("label");
    label.textContent = name;
    const input = document.createElement("input");
    Object.assign(input, { id: prefix + key, type: "number", min, max, step });
    input.onchange = () => {
      if (!input.checkValidity() || input.value === "") {
        syncFields();
        return;
      }
      update((p) => {
        (isTiming ? p.layout[selected].timing : p.layout[selected])[key] =
          Number(input.value);
      });
    };
    label.append(input);
    $(target).append(label);
  }
}
fields(geometry, "geometry-fields", "geo-", false);
fields(timing, "timing-fields", "tim-", true);
function syncFields() {
  const p = project.layout[selected];
  for (const k in geometry) $("geo-" + k).value = p[k];
  for (const k in timing) $("tim-" + k).value = p.timing[k];
  $("scanout").value = p.timing.scanout;
  $("tim-drift").disabled = SCENES[project.scene.id].kind !== "procedural";
  $("tim-drift").title = "Clock drift is available for procedural scenes only.";
}
function syncInspectors() {
  panels.forEach((p, i) => p.node.classList.toggle("selected", i === selected));
  document
    .querySelectorAll(".panel-picker")
    .forEach((p) =>
      [...p.children].forEach((b, i) =>
        b.classList.toggle("active", i === selected),
      ),
    );
  syncFields();
}
function sync() {
  if (!project.world && SCENES[project.scene.id].kind !== "procedural") {
    const b = layoutBounds(project.layout);
    project.world = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  try {
    runtime.setup(
      project.scene,
      project.world,
      project.events,
      project.initialParams,
    );
  } catch (e) {
    toast(e.message);
    project.scene.id = "ribbons";
    project.scene.params = {};
    runtime.setup(project.scene);
  }
  syncParameters();
  document
    .querySelectorAll(".scene")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.scene === project.scene.id),
    );
  $("description").textContent = SCENES[project.scene.id].description;
  $("palette").value = project.scene.palette;
  $("speed").value = project.scene.speed;
  $("speed-label").value = project.scene.speed.toFixed(2) + "×";
  $("seed").value = project.scene.seed;
  $("swatches").replaceChildren(
    ...PALETTES[project.scene.palette].colors.map((c) => {
      const i = document.createElement("i");
      i.style.background = c;
      return i;
    }),
  );
  $("compare").setAttribute("aria-pressed", String(project.timingEnabled));
  $("compare").textContent = project.timingEnabled
    ? "B · Simulated timing"
    : "A / B · Enable timing";
  $("mode-label").textContent = project.timingEnabled
    ? "B · SIMULATED TIMING"
    : "A · ALIGNED REFERENCE";
  syncInspectors();
  position();
}
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-tab]")
        .forEach((t) => t.setAttribute("aria-selected", String(t === b)));
      document
        .querySelectorAll(".tab-content")
        .forEach((t) => (t.hidden = t.id !== b.dataset.tab));
    }),
);
$("palette").onchange = (e) =>
  update((p) => (p.scene.palette = e.target.value));
$("speed").onchange = (e) =>
  update((p) => (p.scene.speed = Number(e.target.value)));
$("seed").onchange = (e) => {
  if (e.target.checkValidity() && e.target.value !== "")
    update((p) => (p.scene.seed = Number(e.target.value)));
  else sync();
};
$("random").onclick = () =>
  update((p) => (p.scene.seed = crypto.getRandomValues(new Uint32Array(1))[0]));
$("date").value = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
$("daily").onclick = () => {
  if ($("date").value)
    update(
      (p) =>
        (p.scene.seed = dailySeed(new Date($("date").value + "T12:00:00Z"))),
    );
};
$("apply-layout").onclick = () => {
  const gap = Number($("gap").value);
  if (!$("gap").checkValidity()) return;
  update((p) => {
    const old = p.layout;
    p.layout = makeLayout($("layout-preset").value, gap);
    p.layout.forEach((v, i) => (v.timing = old[i].timing));
  });
};
$("apply-timing").onclick = () =>
  update((p) => {
    p.layout.forEach(
      (v, i) => (v.timing = TIMING_PRESETS[$("timing-preset").value](i)),
    );
    p.timingEnabled = true;
  });
$("scanout").onchange = (e) =>
  update((p) => (p.layout[selected].timing.scanout = e.target.value));
$("test-scene").onclick = () => update((p) => (p.scene.id = "test"));
$("compare").onclick = () =>
  update((p) => (p.timingEnabled = !p.timingEnabled));
function setPlaying(value) {
  playing = value;
  last = performance.now();
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute("aria-label", playing ? "Pause playback" : "Play");
  changed();
}
$("play").onclick = () => setPlaying(!playing);
$("step").onclick = () => {
  setPlaying(false);
  project.time = Math.min(86400, project.time + 1 / 60);
  changed();
};
$("scrub").oninput = (e) => {
  setPlaying(false);
  project.time = Number(e.target.value);
  changed();
};
$("time").onchange = (e) => {
  if (e.target.checkValidity() && e.target.value !== "") {
    setPlaying(false);
    project.time = Number(e.target.value);
    changed();
  }
};
$("undo").onclick = () => {
  if (!undo.length) return toast("Nothing to undo yet.");
  project = undo.pop();
  runtime.key = "";
  sync();
  changed();
};
$("command-form").onsubmit = (e) => {
  e.preventDefault();
  const command = parseText($("command").value, project);
  if (!command)
    return toast(
      "Try calmer, chemical garden, flocking, platformer, pixel, geometric, or warmer.",
    );
  update((p) => applyCommand(p, command));
  toast("Art direction applied. Undo is available.");
  $("command").value = "";
};
$("save").onclick = () => {
  gallery.unshift({
    id: crypto.randomUUID(),
    name: $("save-name").value.trim() || "Untitled current",
    favorite: false,
    project: clone(portable()),
    thumbnail: runtime.canvas.toDataURL("image/webp", 0.4),
  });
  persist();
  toast("Saved to your collection.");
};
function showGallery() {
  const list = $("gallery-list");
  list.replaceChildren();
  if (!gallery.length)
    list.textContent = "Your collection is waiting for its first artwork.";
  gallery.forEach((item) => {
    const row = document.createElement("div");
    row.className = "saved";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const star = document.createElement("button");
    star.textContent = item.favorite ? "★" : "☆";
    star.setAttribute("aria-label", "Toggle favorite");
    star.onclick = () => {
      item.favorite = !item.favorite;
      persist();
      showGallery();
    };
    const load = document.createElement("button");
    load.textContent = "Open";
    load.onclick = () => {
      remember();
      project = validateProject(item.project);
      runtime.key = "";
      setPlaying(false);
      sync();
      changed();
      $("gallery").close();
    };
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.onclick = () => {
      gallery = gallery.filter((x) => x !== item);
      persist();
      showGallery();
    };
    if (
      typeof item.thumbnail === "string" &&
      item.thumbnail.startsWith("data:image/webp;")
    ) {
      const image = document.createElement("img");
      image.src = item.thumbnail;
      image.alt = "";
      image.width = 80;
      image.height = 52;
      image.style.objectFit = "contain";
      row.append(image);
    }
    row.append(star, name, load, remove);
    list.append(row);
  });
}
$("gallery-open").onclick = () => {
  showGallery();
  $("gallery").showModal();
};
$("gallery-close").onclick = () => $("gallery").close();
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(portable(), null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "babel-art.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("import").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 16000000)
      throw new Error("Artwork JSON must be smaller than 16 MB.");
    const imported = validateProject(JSON.parse(await file.text()));
    remember();
    project = imported;
    runtime.key = "";
    setPlaying(false);
    sync();
    changed();
    toast("Artwork imported.");
  } catch (err) {
    toast("Import failed: " + err.message);
  }
  e.target.value = "";
};
window.addEventListener("pagehide", persist);
setInterval(persist, 10000);
let fpsAt = performance.now(),
  frames = 0,
  diagnosticAt = 0;
function draw(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && !runtime.pending && !document.hidden) {
    project.time = Math.min(86400, project.time + dt * project.scene.speed);
    if (project.time === 86400) setPlaying(false);
  }
  const samples = project.layout.map((p, i) =>
    frameAt(
      project.time * 1000,
      {
        ...p.timing,
        drift:
          SCENES[project.scene.id].kind === "procedural" ? p.timing.drift : 0,
      },
      i,
      project.timingEnabled,
    ),
  );
  if (!runtime.pending) {
    runtime
      .seek(project.time, project.checkpoint)
      .catch((e) => toast(e.message));
  }
  const quality = Number($("quality").value);
  runtime.begin(
    $("wall").clientWidth * quality,
    $("wall").clientHeight * quality,
  );
  const colors = PALETTES[project.scene.palette].colors.map((hex) =>
    [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16) / 255),
  );
  try {
    project.layout.forEach((panel, i) =>
      runtime.draw(
        panel,
        project.scene,
        samples[i],
        [
          fit.x + (panel.x + panel.width / 2) * fit.scale,
          fit.y + (panel.y + panel.height / 2) * fit.scale,
          panel.width * fit.scale,
          panel.height * fit.scale,
        ].map((v) => v * quality),
        colors,
      ),
    );
  } catch (e) {
    toast(e.message);
    setPlaying(false);
  }

  if (document.activeElement !== $("time"))
    $("time").value = project.time.toFixed(3);
  $("scrub").max = Math.max(120, Math.ceil(project.time / 60) * 60);
  $("scrub").value = project.time;
  frames++;
  if (now - fpsAt > 750) {
    $("fps").textContent =
      `${Math.round((frames * 1000) / (now - fpsAt))} FPS · WEBGL`;
    fpsAt = now;
    frames = 0;
  }
  if (now - diagnosticAt > 150) {
    const ages = samples.map((f) => project.time * 1000 - f.current),
      spread =
        Math.max(...samples.map((f) => f.current)) -
        Math.min(...samples.map((f) => f.current));
    $("diagnostics").replaceChildren(
      ...ages.map((v, i) => {
        const d = document.createElement("div");
        const s = document.createElement("strong");
        s.textContent = `PANEL 0${i + 1} · ${v.toFixed(1)} ms`;
        d.append(
          s,
          document.createTextNode(
            `content age · spread ${spread.toFixed(1)} ms`,
          ),
        );
        return d;
      }),
    );
    diagnosticAt = now;
  }
  $("replay-status").hidden = !runtime.pending;
  $("replay-status").textContent = runtime.pending
    ? `Replaying · ${((runtime.sim?.tick || 0) / 60).toFixed(1)} s · click to cancel`
    : "";
  requestAnimationFrame(draw);
}
function syncParameters() {
  const box = $("scene-parameters");
  box.replaceChildren();
  if (project.scene.id === "chemical") {
    const preset = document.createElement("select");
    [
      "Choose a chemical preset",
      "Coral",
      "Dividing cells",
      "Labyrinth",
    ].forEach((v) => preset.add(new Option(v, v)));
    preset.onchange = () => {
      const values = {
        Coral: [0.0545, 0.062],
        "Dividing cells": [0.0367, 0.0649],
        Labyrinth: [0.029, 0.057],
      };
      if (values[preset.value])
        update((p) => {
          [p.scene.params.feed, p.scene.params.kill] = values[preset.value];
        });
    };
    box.append(preset);
  }
  const def = SCENES[project.scene.id];
  for (const [key, spec] of Object.entries(def.parameters)) {
    const label = document.createElement("label");
    label.textContent = spec.label;
    const field = document.createElement(spec.options ? "select" : "input");
    if (spec.options) spec.options.forEach((v) => field.add(new Option(v, v)));
    else if (typeof spec.value === "boolean") field.type = "checkbox";
    else
      Object.assign(field, {
        type: "number",
        min: spec.min,
        max: spec.max,
        step: spec.step,
      });
    if (field.type === "checkbox") field.checked = project.scene.params[key];
    else field.value = project.scene.params[key];
    field.onchange = () => {
      if (!field.checkValidity()) return;
      update((p) => {
        p.scene.params[key] =
          field.type === "checkbox"
            ? field.checked
            : typeof spec.value === "number"
              ? Number(field.value)
              : field.value;
        if (spec.restart) {
          p.time = 0;
          delete p.checkpoint;
          delete p.events;
          delete p.initialParams;
        }
      });
    };
    label.append(field);
    box.append(label);
  }
  const label = document.createElement("label");
  label.textContent = "Visual style";
  const select = document.createElement("select");
  def.styles.forEach((v) => select.add(new Option(v, v)));
  select.value = project.scene.style;
  select.onchange = () => update((p) => (p.scene.style = select.value));
  label.append(select);
  box.append(label);
}
$("replay-status").onclick = () => {
  runtime.generation++;
  runtime.pending = false;
  delete project.checkpoint;
  project.time = (runtime.sim?.tick || 0) / 60;
};
document.addEventListener("visibilitychange", () => {
  last = performance.now();
});
sync();
requestAnimationFrame(draw);
if (import.meta.env.DEV)
  window.babelDebug = { runtime, project: () => project };
