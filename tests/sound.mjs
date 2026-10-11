// sound.mjs — does sound actually come out? Real Chromium, the real AudioContext,
// and an analyser on the master bus (audio.level() is the RMS of what would go to
// the speakers). Plus: the whistle, the settings, footsteps, and the ripple.
//
// Run: node tests/sound.mjs

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (q, r) => {
  let u = (q.url || "/").split("?")[0]; if (u === "/") u = "/index.html";
  try { const b = await readFile(path.join(ROOT, u)); r.writeHead(200, { "Content-Type": TYPES[path.extname(u)] || "application/octet-stream" }); r.end(b); }
  catch { r.writeHead(404); r.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const fails = [], errs = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log("  ✓ " + m); };

const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(`http://127.0.0.1:${server.address().port}/`);
await p.waitForFunction(() => window.__seven);
await p.keyboard.press("Space");
await p.waitForFunction(() => !window.__seven.splash);
// A day-time run, a lit fire, nobody asleep: a plain scene to measure against.
await p.evaluate(() => {
  const M = window.__seven; M.newRun({ seed: 61, startCamp: true }); M.S.applyPlan(M.sim, "dawn", {});
  M.sim.lead.yaw = -Math.PI / 2; M.sim.camp.fire = 6; M.sim.camp.pile = 8;
});
// peak() watches the master bus for `ms` and reports the loudest moment.
const peak = (ms) => p.evaluate(async (ms) => {
  const A = window.__seven.Audio; let m = 0; const t0 = performance.now();
  while (performance.now() - t0 < ms) { m = Math.max(m, A.level()); await new Promise((r) => setTimeout(r, 15)); }
  return m;
}, ms);

await p.waitForTimeout(1500);
ok(await p.evaluate(() => window.__seven.Audio.state() === "running"), "audio is running after the splash press");
const bed = await peak(900);
ok(bed > 0.0008, `the woods make sound on their own (wind, birds, fire, music): peak ${bed.toFixed(4)}`);

// The whistle: louder than the bed, drawn as rings, then answered by whoever hears it.
await p.evaluate(() => { const M = window.__seven; M.sim.mates.forEach((m, i) => { m.x = M.sim.lead.x + 3 + i; m.y = M.sim.lead.y + 1; m.task = { kind: "camp", chunk: 0, carry: 0 }; m.following = false; }); });
const quiet = await peak(500);
await p.evaluate(() => window.__seven.action("call"));
const loud = await peak(700);
ok(loud > Math.max(quiet * 1.8, 0.01), `a whistle is heard above the bed: ${loud.toFixed(4)} vs ${quiet.toFixed(4)}`);
ok(await p.evaluate(() => window.__seven.pulses > 0), "the whistle is drawn: rings spread from you");
const answered = await p.evaluate(async () => {
  const A = window.__seven.Audio, before = A.stats.plays;
  for (let i = 0; i < 90 && A.stats.plays < before + 2; i++) { window.__seven.run(40); await new Promise((r) => setTimeout(r, 20)); }
  return A.stats.plays - before;
});
ok(answered >= 1, `companions whistle back as they start toward you (${answered} answers heard)`);

// Footsteps come from actually moving, not from standing still.
const steps = await p.evaluate(async () => {
  const A = window.__seven.Audio; const s0 = A.stats.steps;
  await new Promise((r) => setTimeout(r, 1200));
  const still = A.stats.steps - s0;
  const s1 = A.stats.steps;
  return { still, walked: await (async () => { window.__seven.sim.lead.busy = null; return 0; })(), s1 };
});
await p.keyboard.down("KeyW"); await p.waitForTimeout(1600); await p.keyboard.up("KeyW");
const walked = await p.evaluate((s1) => window.__seven.Audio.stats.steps - s1, steps.s1);
ok(steps.still === 0 && walked >= 2, `footsteps follow movement: standing ${steps.still}, walking ${walked}`);

// Settings: effects off silences the whistle; music off thins the bed; both persist.
await p.keyboard.press("Escape");
await p.evaluate(() => window.__seven.click("Sound effects"));
await p.evaluate(() => window.__seven.click("Resume"));
await p.waitForTimeout(500);
const quietOff = await peak(500);
await p.evaluate(() => window.__seven.action("call"));
const loudOff = await peak(700);
ok(loudOff < Math.max(quietOff * 1.5, 0.004) + 0.003, `effects off: a whistle adds nothing (${loudOff.toFixed(4)} vs ${quietOff.toFixed(4)})`);
await p.keyboard.press("Escape");
await p.evaluate(() => window.__seven.click("Music"));
await p.evaluate(() => window.__seven.click("Resume"));
await p.waitForTimeout(900);
const bare = await peak(600);
ok(bare < 0.006 && bare < bed * 0.1, `effects and music both off: near silence, no reverb tails left over (${bare.toFixed(4)} vs ${bed.toFixed(4)})`);
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("seven:settings")));
ok(saved.sfx === false && saved.music === false, `the choices are saved (${JSON.stringify(saved)})`);
await p.reload(); await p.waitForFunction(() => window.__seven);
ok(await p.evaluate(() => { const s = window.__seven.Audio.getSettings(); return s.sfx === false && s.music === false; }), "and still off after a reload");

await ctx.close(); await browser.close(); server.close();
if (errs.length) fails.push("page errors:\n    " + errs.join("\n    "));
if (fails.length) { console.log("SOUND FAILED:\n  ✗ " + fails.join("\n  ✗ ")); process.exit(1); }
console.log("sound: OK");
process.exit(0);
