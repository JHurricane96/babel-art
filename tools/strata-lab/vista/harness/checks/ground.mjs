// The ground under the ground cover as the camera moves on (the world; nothing drawn, so it is
// quick): for every cover sprite in view and 2 px or taller, how far the ground as drawn (the
// terrain's patches, finer near the camera) stands above or below its foot, in px, and how often
// that moves by 1 px or more from one frame to the next: a bush sinking into the ground or rising
// out of it as the patches under it change detail, which looks like it changing size.
//
//   run.mjs ground at=1620 [frames=300] [mode=auto] [speed=1] [show=10]
export default async ({ page, args, log }) => {
  const at = Number(args.at ?? 1620),
    frames = Number(args.frames ?? 300);
  await page.evaluate(([at, mode, speed]) => {
    const v = window.vista;
    v.paused = false;
    v.speed = speed;
    v.setMode(mode);
    v.setS(at);
    v.coverNow();
  }, [at, String(args.mode ?? "auto"), Number(args.speed ?? 1)]);
  await page.waitForFunction(() => !window.vista.building, null, { timeout: 0, polling: 200 });
  const r = await page.evaluate((frames) => {
    const v = window.vista,
      names = v.slotNames(),
      tan = Math.tan(Math.PI / 6) * 1.05;
    for (let k = 0; k < 8; k++) v.step(1 / 30, false);
    let prev = new Map(),
      cover = v.cover(),
      n = 0,
      moved = 0,
      big = 0;
    const hist = {},
      ev = [];
    for (let f = 0; f < frames; f++) {
      v.step(1 / 30, false);
      if (v.cover().length !== cover.length) cover = v.cover();
      const c = v.camera(),
        fx = Math.sin(c.yaw),
        fz = Math.cos(c.yaw),
        rx = Math.cos(c.yaw),
        rz = -Math.sin(c.yaw),
        pts = [],
        idx = [];
      for (let i = 0; i < cover.length; i += 6) {
        const ex = cover[i] - c.x,
          ez = cover[i + 2] - c.z,
          vz = ex * fx + ez * fz;
        if (vz < 3 || (cover[i + 3] * c.F) / vz < 2 || Math.abs(ex * rx + ez * rz) > vz * tan) continue;
        pts.push(cover[i], cover[i + 2]);
        idx.push(i);
      }
      const g = v.groundUnder(pts),
        now = new Map();
      idx.forEach((i, j) => {
        const vz = (cover[i] - c.x) * fx + (cover[i + 2] - c.z) * fz,
          px = ((g[j * 2] - cover[i + 1]) * c.F) / vz,
          key = `${cover[i].toFixed(2)},${cover[i + 2].toFixed(2)}`;
        now.set(key, [px, g[j * 2 + 1]]);
        const b = Math.max(-3, Math.min(3, Math.round(px)));
        hist[b] = (hist[b] ?? 0) + 1;
        const p = prev.get(key);
        if (!p) return;
        n++;
        if (Math.abs(px - p[0]) >= 1) {
          moved++;
          if (Math.abs(px - p[0]) >= 2) big++;
          if (ev.length < 200) ev.push({ f, name: names[cover[i + 4]], dist: Math.round(vz), want: +((cover[i + 3] * c.F) / vz).toFixed(1), ground: `${p[0].toFixed(1)}->${px.toFixed(1)} px`, patch: `${p[1]}->${g[j * 2 + 1]} m` });
        }
      });
      prev = now;
    }
    return { n, moved, big, hist, ev, s: Math.round(v.state().s) };
  }, frames);
  log(`from ${at} m to ${r.s} m, ${frames} frames, ${r.n} sprite-frames in view: the ground under a sprite moved 1 px or more ${r.moved} times (2 px or more ${r.big})`);
  log(`ground above a sprite's foot (px, rounded, -3..3): ${JSON.stringify(r.hist)}`);
  for (const e of r.ev.slice(0, args.show ?? 10)) log(JSON.stringify(e));
  return { ok: r.big === 0, moved: r.moved, big: r.big };
};
