// perf.mjs — the game must stay light, and must adapt when a machine is slow.
//   - the first-person view fits a frame budget (the old one took 12-17 ms in
//     this software-rendered browser; the budget is 11);
//   - when the CPU is slowed 6x, the view drops its INTERNAL resolution on its
//     own, gets cheaper, and gives the pixels back when the machine recovers;
//   - the canvas backing stays CSS × devicePixelRatio throughout (crisp text);
//   - the HUD does not touch the DOM when nothing it shows has changed.
//
// Run: node tests/perf.mjs

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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(`http://127.0.0.1:${server.address().port}/`);
await p.waitForFunction(() => window.__seven);
await p.keyboard.press("Space"); await p.waitForFunction(() => !window.__seven.splash);
await p.evaluate(() => {
  const M = window.__seven; M.newRun({ seed: 5, startCamp: true }); M.S.applyPlan(M.sim, "dawn", { m0: "chop", m1: "gather", m2: "tend" });
  M.sim.camp.fire = 6; M.sim.lead.yaw = -Math.PI / 2;
});
await p.waitForTimeout(1200);

// Budget: the view at full quality.
await p.evaluate(() => window.__seven.setQ(1));
// Best of three: a busy machine adds noise, never speed.
let prof = null;
for (let i = 0; i < 3; i++) { const r = await p.evaluate(() => window.__seven.profile(40)); if (!prof || r.view < prof.view) prof = r; }
const total = prof.view;
ok(total < 11, `the view costs ${total.toFixed(1)} ms a frame at full quality (budget 11; it was 12-17 before)`);
ok(prof.perceive + prof.context + prof.hud + prof.audio < 1.5, `everything else in a frame costs ${(prof.perceive + prof.context + prof.hud + prof.audio).toFixed(2)} ms`);

// Adaptive quality: slow the CPU, wait, and the view should have stepped down.
const cdp = await ctx.newCDPSession(p);
await p.evaluate(() => window.__seven.setQ(1));
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
await p.waitForTimeout(6000);
const slow = await p.evaluate(() => ({ q: window.__seven.quality, ms: window.__seven.avgMs, RW: window.__seven.seenSize.RW }));
ok(slow.q < 0.9, `on a machine 6x slower the view drops its internal resolution by itself (quality ${slow.q.toFixed(2)}, ${slow.RW} columns)`);
const cv = await p.evaluate(() => ({ w: document.getElementById("game").width, iw: innerWidth, dpr: devicePixelRatio }));
ok(cv.w === Math.round(cv.iw * cv.dpr), `the canvas backing stays ${cv.w} = ${cv.iw} × ${cv.dpr}: only the internal image gets coarser`);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
// It climbs a step every ~second; give it up to 25 s rather than guessing how long.
await p.waitForFunction((q) => window.__seven.quality >= q + 0.1, slow.q, { timeout: 25000 }).catch(() => {});
const back = await p.evaluate(() => window.__seven.quality);
ok(back >= slow.q + 0.1, `and when the machine recovers it gives the pixels back (${slow.q.toFixed(2)} → ${back.toFixed(2)})`);

// The HUD leaves the DOM alone when nothing it shows has changed.
const muts = await p.evaluate(async () => {
  const M = window.__seven; M.sim.lead.busy = null;
  let n = 0;
  const ids = ["hud-count", "hud-day", "hud-area", "hud-wood", "hud-pile", "prompt", "hint"];
  const mo = new MutationObserver((l) => { n += l.length; });
  for (const id of ids) mo.observe(document.getElementById(id), { childList: true, characterData: true, subtree: true, attributes: true });
  M.sim.pending = "x";                       // hold the world still: nothing the HUD shows can change
  await new Promise((r) => setTimeout(r, 1200));
  M.sim.pending = null; mo.disconnect();
  return n;
});
ok(muts <= 2, `a still HUD makes ${muts} DOM writes in 1.2 s (it used to make about 8 a frame)`);

await ctx.close(); await browser.close(); server.close();
if (errs.length) fails.push("page errors:\n    " + errs.join("\n    "));
if (fails.length) { console.log("PERF FAILED:\n  ✗ " + fails.join("\n  ✗ ")); process.exit(1); }
console.log("perf: OK");
process.exit(0);
