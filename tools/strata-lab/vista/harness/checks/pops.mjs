// Size pops in the world: walk on from `at` metres and, frame by frame, measure every ground-cover
// sprite (or tree) as drawn (the ID pass, vista.idFrame: the pixels it covers, behind what stands in
// front of it). A pop: one that changes height (or width) by 2 px and a fifth or more from one frame
// to the next when its distance hardly changed. Each is put down to what changed with it:
//   parts   it went from being drawn whole to in parts (near the camera), or back
//   ground  the ground as drawn under it moved (the terrain's patches changing detail) by 1 px or more
//   other   neither (something in front of it, or the sprite itself)
// Only the frames measured are drawn (vista.step(dt, false) between), so it runs at a few frames a
// second under software GL.
//
//   run.mjs pops at=1620 [frames=150] [mode=auto] [speed=1] [list=1 (0 trees)] [show=12]
export default async ({ page, args, log }) => {
  const at = Number(args.at ?? 1620),
    frames = Number(args.frames ?? 150),
    list = Number(args.list ?? 1);
  await page.evaluate(([at, mode, speed]) => {
    const v = window.vista;
    v.paused = false;
    v.speed = speed;
    v.setMode(mode);
    v.setS(at);
    v.coverNow();
  }, [at, String(args.mode ?? "auto"), Number(args.speed ?? 1)]);
  // (A seek far off builds the land there first.)
  await page.waitForFunction(() => !window.vista.building, null, { timeout: 0, polling: 200 });
  await page.evaluate(() => {
    for (let k = 0; k < 8; k++) window.vista.step(1 / 30, false);
  });
  await page.evaluate((list) => {
    window.__pops = { prev: new Map(), ev: [], tracked: 0, ground: 0, list, names: window.vista.slotNames() };
  }, list);
  for (let f = 0; f < frames; f += 10)
    await page.evaluate(([f0, n]) => {
      const v = window.vista,
        P = window.__pops;
      for (let f = f0; f < f0 + n; f++) {
        v.step(1 / 30, false);
        const r = v.idFrame(P.list),
          { cam, F } = r,
          fx = Math.sin(cam.yaw),
          fz = Math.cos(cam.yaw),
          pts = [];
        for (const s of r.seen) pts.push(s.x, s.z);
        const g = v.groundUnder(pts),
          now = new Map();
        r.seen.forEach((s, j) => {
          const vz = (s.x - cam.x) * fx + (s.z - cam.z) * fz,
            want = (s.h * F) / vz,
            buried = ((g[j * 2] - s.y) * F) / vz,
            key = `${s.x.toFixed(2)},${s.z.toFixed(2)},${s.slot}`,
            cur = { h: s.bottom - s.top + 1, w: s.right - s.left + 1, n: s.n, top: s.top, bottom: s.bottom, want, vz, buried, sp: g[j * 2 + 1], parts: s.parts };
          now.set(key, cur);
          const p = P.prev.get(key);
          if (!p) return;
          P.tracked++;
          if (want >= 2 && Math.abs(buried - p.buried) >= 1) P.ground++;
          const dh = cur.h - p.h,
            dw = cur.w - p.w,
            still = Math.abs(want - p.want) < Math.max(0.6, 0.05 * want);
          if (!still || !((Math.abs(dh) >= 2 && Math.abs(dh) / Math.max(cur.h, p.h) >= 0.2) || (Math.abs(dw) >= 3 && Math.abs(dw) / Math.max(cur.w, p.w) >= 0.25))) return;
          const cause = p.parts !== cur.parts ? "parts" : Math.abs(buried - p.buried) >= 1 ? "ground" : "other";
          P.ev.push({ f, name: P.names[s.slot], cause, dist: Math.round(vz), want: +want.toFixed(1), h: `${p.h}->${cur.h}`, w: `${p.w}->${cur.w}`, top: `${p.top}->${cur.top}`, bottom: `${p.bottom}->${cur.bottom}`, buried: `${p.buried.toFixed(1)}->${buried.toFixed(1)} px`, patch: `${p.sp}->${cur.sp} m` });
        });
        P.prev = now;
      }
    }, [f, Math.min(10, frames - f)]);
  const P = await page.evaluate(() => {
    const P = window.__pops;
    return { ev: P.ev, tracked: P.tracked, ground: P.ground, s: Math.round(window.vista.state().s) };
  });
  const by = {};
  for (const e of P.ev) by[`${e.cause} ${e.name}`] = (by[`${e.cause} ${e.name}`] ?? 0) + 1;
  log(`from ${at} m to ${P.s} m, ${frames} frames, ${P.tracked} sprite-frames: ${P.ev.length} pops; the ground under a sprite 2 px or taller moved 1 px or more ${P.ground} times`);
  if (P.ev.length) log(`by cause and sprite: ${JSON.stringify(by)}`);
  for (const e of P.ev.slice(0, args.show ?? 12)) log(JSON.stringify(e));
  return { ok: P.ev.length === 0, pops: P.ev.length, by };
};
