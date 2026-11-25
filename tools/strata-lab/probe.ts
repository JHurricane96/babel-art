// Strata probe: everything that made one place, layer by layer, so "why does
// this look wrong?" takes one look instead of rounds of guessing.
//
//   node --import tsx tools/strata-lab/probe.ts SEED X [Y] [--png OUT.png] [--zoom 4]
//
// Prints the world's column (history), the landform, climate, habitat, soil
// and biome, the ground and water, the rock beds, the generated column at X
// as runs of material, and the renderer's depth and light there. With --png,
// writes a crop around (X, Y) (Y defaults to the ground) at the given zoom.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import * as history from "../../engine/strata/history.ts";
import * as worldmap from "../../engine/strata/worldmap.ts";
import { generateWindow } from "../../engine/strata/generate.ts";
import { LANDFORMS, landformAt, landformNameAt } from "../../engine/strata/landforms.ts";
import { BIOMES, HABITATS, SOILS, ZONES } from "../../engine/strata/biomes.ts";
import { M, REGION_W, WORLD_H, bandOf } from "../../engine/strata/world.ts";
import { floorRow, horizonRow, renderLand } from "./land-render.ts";
import { installWorldCache } from "./world-cache.ts";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
installWorldCache(ROOT, history, worldmap);

const args = process.argv.slice(2),
  flag = (n: string) => {
    const k = args.indexOf(n);
    return k >= 0 ? args[k + 1] : undefined;
  },
  pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const seed = Number(pos[0]),
  x = Math.round(Number(pos[1]));
if (!Number.isFinite(seed) || !Number.isFinite(x)) {
  console.error("usage: probe.ts SEED X [Y] [--png OUT.png] [--zoom 4]");
  process.exit(1);
}
const MNAME: Record<number, string> = Object.fromEntries(
  Object.entries(M).map(([k, v]) => [v as number, k]),
);
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const { SEA_ROW, ROCKS, CELL } = history;

// ---- The world ---------------------------------------------------------------
const w = worldmap.worldOf(seed),
  c = Math.max(0, Math.min(w.n - 1, Math.floor(x / CELL))),
  place = worldmap.placeAt(seed, x),
  lf = landformAt(w, seed, x),
  ground = worldmap.groundElevation(seed, x),
  row = worldmap.groundRow(seed, x),
  water = worldmap.waterAt(seed, x),
  near = w.events.filter((e) => Math.abs(c - e.c) < e.w / 2 + 8).map((e) => `${e.kind} (eras ${e.e0}-${e.e1})`);
console.log(`seed ${seed} · x ${x} · region ${Math.floor(x / REGION_W)} (+${x % REGION_W}) · coarse column ${c}`);
console.log(`\nWORLD   surface ${f1(w.surface[c])} · warmth ${f1(w.T[c])}°C · rain ${Math.round(w.P[c])} mm · seasonality ${f1(w.S[c])} · sea-ness ${f1(w.O[c])} · wet ${w.wet[c]} · zone ${ZONES[w.zone[c]].name}`);
console.log(`        made by: ${near.join(", ") || "nothing in particular"}`);
console.log(`LANDFORM ${landformNameAt(w, seed, x)} · L ${f1(lf.L)} · U (beds lifted) ${f1(lf.U)} · gorge cut ${f1(lf.cut)} (${LANDFORMS[lf.form]})`);
console.log(`GROUND  elevation ${f1(ground)} · row ${f1(row)} · warmth there ${f1(worldmap.warmthAt(seed, x, row))}°C · rain ${Math.round(worldmap.rainAt(seed, x))} mm`);
console.log(`        water: ${water ? `${water.kind} at ${f1(water.level)} (row ${f1(SEA_ROW - water.level)})` : "none"}`);
console.log(`PLACE   ${place.biome >= 0 ? BIOMES[place.biome].name : "(water)"} · ${ZONES[place.zone].name} · ${HABITATS[place.habitat]} · ${SOILS[place.soil]} soil`);
const col = worldmap.rockAt(seed, x);
console.log(`ROCK    basement top ${f1(col.b)}; beds bottom up:`);
let below = col.b;
for (let k = 0; k < col.kinds.length; k++) {
  console.log(`        ${ROCKS[col.kinds[k]].name.padEnd(16)} ${f1(below)} .. ${f1(col.tops[k])} (rows ${Math.round(SEA_ROW - col.tops[k])}..${Math.round(SEA_ROW - below)})`);
  below = col.tops[k];
}

// ---- The generated column and the renderer's view ------------------------------------
const PAD = 160,
  W = 2 * PAD + 1,
  x0 = x - PAD,
  g = generateWindow(seed, x0, W),
  X = PAD,
  surf = g.surface[X],
  y = pos[2] !== undefined ? Number(pos[2]) : surf;
const runs: string[] = [];
let last = -1,
  n = 0,
  start = 0;
for (let yy = Math.max(0, surf - 60); yy <= Math.min(WORLD_H - 1, surf + 120); yy++) {
  const i = yy * W + X,
    m = g.cells[i],
    key = m === M.ROCK ? 1000 + bandOf(g.state[i]) : m;
  if (key !== last) {
    if (n) runs.push(`${last >= 1000 ? `ROCK(${ROCKS[last - 1000]?.name ?? last - 1000})` : MNAME[last] ?? last}×${n} @${start}`);
    last = key;
    n = 0;
    start = yy;
  }
  n++;
}
runs.push(`${last >= 1000 ? `ROCK(${ROCKS[last - 1000]?.name ?? last - 1000})` : MNAME[last] ?? last}×${n} @${start}`);
console.log(`\nCOLUMN  surface row ${surf}; from row ${Math.max(0, surf - 60)} down:\n        ${runs.join(" · ")}`);
const fl = g.flora[y * W + X];
console.log(`CELL    row ${y}: ${MNAME[g.cells[y * W + X]]} · rock band ${bandOf(g.state[y * W + X])} · flora ${fl ? (fl <= BIOMES.length ? BIOMES[fl - 1].name : `species palette ${fl - BIOMES.length - 1}`) : "none"}`);
const hz = horizonRow(seed, x0, W)[X],
  floor = floorRow(seed, x0, W)[X];
let reach = surf;
for (let d = 1; d <= PAD; d++) reach = Math.min(reach, g.surface[X - d] + 2 * d, g.surface[X + d] + 2 * d);
const top = reach,
  flr = Math.max(floor, top),
  dim = 0.3 * Math.max(0, Math.min(y, flr) - top) + Math.max(0, y - flr),
  cut = dim <= 4 ? 0.95 : 0.95 * (0.3 + 0.7 * Math.exp(-(dim - 4) / 85));
console.log(`LIGHT   horizon row ${f1(hz)} · valley floor row ${f1(floor)} · open ground reached at row ${f1(reach)} · depth ${f1(y - reach)} · dim depth ${f1(dim)} · cut-away light ${f1(cut)}`);

// ---- A zoomed crop -----------------------------------------------------------------
const out = flag("--png");
if (out) {
  const zoom = Number(flag("--zoom") ?? 4),
    CW = 160,
    CH = 90,
    rgba = renderLand({ W, H: WORLD_H, cells: g.cells, state: g.state, flora: g.flora, surface: g.surface, x0, seed }),
    cy0 = Math.max(0, Math.min(WORLD_H - CH, y - CH / 2)),
    cx0 = X - CW / 2,
    PW = CW * zoom,
    PH = CH * zoom,
    img = Buffer.alloc((PW * 4 + 1) * PH);
  for (let py = 0; py < PH; py++)
    for (let px = 0; px < PW; px++) {
      const sx = cx0 + Math.floor(px / zoom),
        sy = cy0 + Math.floor(py / zoom),
        o = (sy * W + sx) * 4,
        d = py * (PW * 4 + 1) + 1 + px * 4,
        mark = (sx === X && Math.abs(sy - y) <= 2) || (sy === y && Math.abs(sx - X) <= 2);
      img[d] = mark ? 255 : rgba[o];
      img[d + 1] = mark ? 0 : rgba[o + 1];
      img[d + 2] = mark ? 255 : rgba[o + 2];
      img[d + 3] = 255;
    }
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4),
      td = Buffer.concat([Buffer.from(t), d]),
      cc = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    cc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, cc]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(PW, 0);
  ih.writeUInt32BE(PH, 4);
  ih[8] = 8;
  ih[9] = 6;
  writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(img)), chunk("IEND", Buffer.alloc(0))]));
  console.log(`\nPNG     ${out}: ${CW}x${CH} cells around the point (magenta cross), zoom ${zoom}`);
}
