// Sprites walked up to, alone (the sprite lab, no land): each from where it is first drawn to as
// near as the page draws it, as the page draws it (vista.walk). Flags what should never happen:
//   shrink   it gets shorter as it comes nearer
//   jump     it grows by more in one step than it should (more than 2 px, or 6% of its height)
//   out/in   the pixels it draws fall or rise suddenly (a pop out or in), fades being gradual
//   gap      it is not drawn at all where it should be
//
//   run.mjs walk names="sage 0,shrub"   (or match=REGEX, or all=1)
//                [flags=N] [side=0.6] [step=0.01] [variants=1: also mirrored, off to the side,
//                and for cover only near tiles hold] [show=N events per sprite, default 4]
export const page = "lab";

/** Where it fades by design (dithered, so its outline wavers there): within 1.5x its list's near
 * limit, past 85% of its far one, 425-525 m for cover only near tiles hold, and under 3 px. */
const fading = (d, want, o) => d < o.near * 1.5 || d > o.far * 0.85 || want < 3 || (o.flags & 16384 && d > 420);
function judge(rows, o) {
  const ev = [];
  let best = 0,
    seen = false;
  for (let i = 1; i < rows.length; i++) {
    const [d, want, h, , n] = rows[i],
      [, want0, h0, , n0] = rows[i - 1];
    if (fading(d, want, o) || fading(rows[i - 1][0], want0, o)) {
      best = Math.max(best, h);
      if (n) seen = true;
      continue;
    }
    if (!n) {
      // (Tiny, or fading out right by the camera: allowed.)
      if (seen) ev.push(["gap", d, want, `${h0}->0`]);
      continue;
    }
    seen = true;
    if (h < best - 1) ev.push(["shrink", d, want, `${best}->${h}`]);
    if (h0 && h - h0 > Math.max(2, 0.06 * want) + (want - want0)) ev.push(["jump", d, want, `${h0}->${h}`]);
    if (n0 >= 8 && n < n0 * 0.6) ev.push(["out", d, want, `${n0}->${n} px`]);
    if (n0 >= 4 && n > n0 * 1.8 + 4 && want > 3) ev.push(["in", d, want, `${n0}->${n} px`]);
    best = Math.max(best, h);
  }
  return ev;
}

export default async ({ page, args, log }) => {
  const names = await page.evaluate(() => window.vista.slotNames());
  let pick;
  if (args.names) pick = String(args.names).split(",").map((s) => s.trim());
  else if (args.match) pick = names.filter((n) => new RegExp(args.match).test(n));
  else if (args.all) pick = names.filter((n) => !/^person|marker/.test(n));
  else throw new Error("say which: names=a,b or match=REGEX or all=1");
  const bad = [];
  for (const name of pick) {
    const variants = [{ flags: args.flags ?? 0, side: args.side ?? 0 }];
    if (args.variants) variants.push({ flags: 1, side: 0 }, { flags: 0, side: 0.7 }, { flags: 16384, side: 0, list: "cover" });
    for (const v of variants) {
      const rows = await page.evaluate(([n, o]) => window.vista.walk(n, o), [name, { ...v, step: args.step ?? 0.01 }]);
      if (!rows) {
        log(`${name}: no such sprite`);
        bad.push(name);
        break;
      }
      const trees = v.list ? v.list === "trees" : rows.length > 0 && rows[rows.length - 1][0] >= 9,
        ev = judge(rows, { near: trees ? 10 : 3, far: trees ? 1450 : 1400, flags: v.flags }),
        tall = rows.filter((r) => r[1] >= 10 && r[2]),
        ratio = tall.length ? [Math.min(...tall.map((r) => r[2] / r[1])), Math.max(...tall.map((r) => r[2] / r[1]))] : [0, 0];
      const tag = `${name}${v.flags ? ` flags ${v.flags}` : ""}${v.side ? ` side ${v.side}` : ""}`;
      log(`${tag.padEnd(28)} ${rows.length} steps to ${rows.at(-1)?.[1] ?? 0} px, h/want ${ratio[0].toFixed(2)}..${ratio[1].toFixed(2)}, ${ev.length ? `${ev.length} BAD: ${ev.slice(0, args.show ?? 4).map((e) => `${e[0]} at ${e[1]} m (${e[2]} px) ${e[3]}`).join("; ")}` : "ok"}`);
      if (ev.length) bad.push(tag);
    }
  }
  return { ok: bad.length === 0, sprites: pick.length, bad };
};
