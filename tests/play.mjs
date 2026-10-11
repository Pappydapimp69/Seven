// play.mjs — the real page in a real browser: title → team → dawn → walk →
// chop → dusk panel → save → continue. Also checks the things the old game got
// wrong: up is straight up (no drift), the canvas is sized to the device's
// pixels, panels work from the keyboard, touch controls appear and work.
//
// Run: node tests/play.mjs

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer(async (q, r) => {
  let u = (q.url || "/").split("?")[0]; if (u === "/") u = "/index.html";
  try { const b = await readFile(path.join(ROOT, u)); r.writeHead(200, { "Content-Type": TYPES[path.extname(u)] || "application/octet-stream" }); r.end(b); }
  catch { r.writeHead(404); r.end(); }
});
await new Promise((r) => server.listen(0, r));
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const fails = [], errs = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log("  ✓ " + m); };

async function page(opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errs.push(m.text()); });
  await p.goto(URL0);
  await p.waitForFunction(() => window.__seven);
  return { p, ctx };
}
const sim = (p, f) => p.evaluate(f);

// ---- desktop ----
{
  const { p, ctx } = await page({ viewport: { width: 1280, height: 800 } });
  ok(await p.evaluate(() => window.__seven.panel === "SEVEN"), "title screen");
  await p.evaluate(() => window.__seven.click("New run"));
  ok(await p.evaluate(() => window.__seven.panel === "Choose your team"), "choose-your-team screen");
  ok(await p.evaluate(() => document.querySelectorAll("#modal [data-do='pick']").length === 8), "eight candidates, each with a trade");
  ok(await p.evaluate(() => document.querySelector("#modal [data-do='next']").disabled), "can't go on with nobody chosen");
  for (let i = 0; i < 6; i++) await p.click(`#modal [data-do='pick'][data-arg='${i}']`).catch(() => {});
  ok(await p.evaluate(() => document.querySelectorAll("#modal .row.on").length === 5), "five, and no more than five, can be chosen");
  ok(await p.evaluate(() => document.activeElement.dataset.do === "next"), "with five chosen, focus moves to Next");
  await p.evaluate(() => window.__seven.click("Next"));
  ok(await p.evaluate(() => window.__seven.panel === "Your team"), "spend screen");
  // Focus stays on the + just pressed while points remain; drops to Set out only when they run out.
  await p.click("#modal [data-do='inc'][data-arg='0:cut']");
  ok(await p.evaluate(() => document.activeElement.dataset.do === "inc" && document.activeElement.dataset.arg === "0:cut"), "focus stays on + after a press");
  await p.keyboard.press("Enter");
  ok(await p.evaluate(() => document.activeElement.dataset.arg === "0:cut" && document.querySelector("#modal").textContent.includes("4 left")), "Enter again adds again, focus kept");
  for (let i = 0; i < 4; i++) await p.keyboard.press("Enter");
  ok(await p.evaluate(() => document.querySelector("#modal").textContent.includes("0 left") && document.activeElement.dataset.do === "go"), "out of points: focus drops to Set out");
  await p.evaluate(() => window.__seven.click("Set out"));
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => (window.__seven.panel || "").startsWith("Dawn")), "dawn plan opens at camp");
  // Keyboard drives the panel: down to the first person, Enter cycles their task.
  const before = await p.evaluate(() => document.querySelector("#modal .task").textContent);
  await p.focus("#modal button[data-do='cycle']");
  await p.keyboard.press("Enter");
  const after = await p.evaluate(() => document.querySelector("#modal .task").textContent);
  ok(before !== after, `Enter cycles a task (${before} → ${after})`);
  await p.keyboard.press("ArrowDown");
  ok(await p.evaluate(() => document.activeElement.dataset.do === "cycle"), "ArrowDown moves focus");
  await p.evaluate(() => window.__seven.click("Start the day"));
  ok(await p.evaluate(() => !window.__seven.panel), "plan closes");

  // Up is up: hold W, x must not move; hold D, y must not move.
  const p0 = await sim(p, () => ({ x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y }));
  await p.keyboard.down("KeyW"); await p.waitForTimeout(900); await p.keyboard.up("KeyW");
  const p1 = await sim(p, () => ({ x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y }));
  ok(p1.y < p0.y - 1 && Math.abs(p1.x - p0.x) < 0.05, `W walks straight north (dx ${(p1.x - p0.x).toFixed(3)}, dy ${(p1.y - p0.y).toFixed(2)})`);
  await p.keyboard.down("KeyD"); await p.waitForTimeout(250); await p.keyboard.up("KeyD");
  const p2 = await sim(p, () => ({ x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y }));
  ok(Math.abs(p2.y - p1.y) < 0.05, `D walks straight east (dy ${(p2.y - p1.y).toFixed(3)})`);

  // Walk to the trunk with the sim's own pathing and chop it with E.
  const chopped = await p.evaluate(async () => {
    const { S, sim } = window.__seven;
    const W = await import(`/src/world.js?v=${window.__seven.build}`);
    const d = S.frontDeadfall(sim), ty = d.row + 1, tx = sim.world.trailX[ty];
    const path = W.pathTo(sim.world, Math.floor(sim.lead.x), Math.floor(sim.lead.y), tx, ty);
    for (const c of path) { sim.lead.x = c.cx + 0.5; sim.lead.y = c.cy + 0.5; }
    return S.contextAction(sim)?.kind;
  });
  ok(chopped === "chop", `standing at the trunk, E offers to chop (${chopped})`);
  const prog0 = await sim(p, () => window.__seven.S.frontDeadfall(window.__seven.sim).progress);
  await p.keyboard.press("KeyE");
  await p.waitForFunction(() => !window.__seven.sim.lead.busy, null, { timeout: 15000 });
  const prog1 = await sim(p, () => window.__seven.S.frontDeadfall(window.__seven.sim).progress);
  ok(prog1 > prog0, `E chopped (${(prog0 * 100).toFixed(0)}% → ${(prog1 * 100).toFixed(0)}%)`);

  // On to dusk at camp: the dusk panel opens.
  await p.evaluate(() => {
    const { sim } = window.__seven; sim.lead.x = sim.camp.x; sim.lead.y = sim.camp.y + 1;
    window.__seven.run(Math.ceil((12 * 60) / 0.2));
  });
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.__seven.panel === "Dusk"), "the dusk panel opens at camp at nightfall");
  await p.evaluate(() => window.__seven.click("Set the night"));

  // Canvas is the device's pixels.
  const cv = await p.evaluate(() => ({ w: document.getElementById("game").width, iw: innerWidth, dpr: devicePixelRatio }));
  ok(cv.w === Math.round(cv.iw * cv.dpr), `canvas backing ${cv.w}px for ${cv.iw}css × ${cv.dpr}`);
  await p.screenshot({ path: path.join(ROOT, "tests", "shot-desktop.png") });

  // Save and continue.
  await p.keyboard.press("Escape");
  await p.evaluate(() => window.__seven.click("Save and leave"));
  await p.reload(); await p.waitForFunction(() => window.__seven);
  ok(await p.evaluate(() => [...document.querySelectorAll("#modal button")].some((b) => b.textContent.startsWith("Continue"))), "Continue after reload");
  await p.evaluate(() => window.__seven.click("Continue"));
  ok(await p.evaluate(() => window.__seven.sim && window.__seven.sim.day >= 1 && window.__seven.sim.world.deadfalls[0].progress > 0), "the resumed run kept the chopping");
  await ctx.close();
}

// ---- a retina screen ----
{
  const { p, ctx } = await page({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
  await p.evaluate(() => { window.__seven.newRun({ seed: 3 }); });
  await p.waitForTimeout(200);
  const cv = await p.evaluate(() => document.getElementById("game").width);
  ok(cv === 1800, `DPR 2: canvas backing is 1800px (${cv})`);
  await ctx.close();
}

// ---- a phone ----
{
  const { p, ctx } = await page({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  await p.evaluate(() => { window.__seven.newRun({ seed: 9 }); window.__seven.S.applyPlan(window.__seven.sim, "dawn", {}); });
  await p.touchscreen.tap(100, 500);
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById("touch")).display !== "none"), "touch controls show after a tap");
  const y0 = await sim(p, () => window.__seven.sim.lead.y);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 90, y: 600 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 90, y: 600 - i * 10 }] }); await p.waitForTimeout(30); }
  await p.waitForTimeout(600);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const y1 = await sim(p, () => window.__seven.sim.lead.y);
  ok(y1 < y0 - 0.5, `dragging up on the left walks north (${(y1 - y0).toFixed(2)})`);
  const msgs0 = await sim(p, () => window.__seven.sim.msgs.length);
  await p.tap("[data-act='call']");
  ok(await sim(p, () => window.__seven.sim.msgs.at(-1).text === "You call out."), "the Call button calls");
  void msgs0;
  await p.screenshot({ path: path.join(ROOT, "tests", "shot-phone.png") });
  await ctx.close();
}

await browser.close(); server.close();
if (errs.length) fails.push("page errors:\n    " + errs.join("\n    "));
if (fails.length) { console.log("PLAY FAILED:\n  ✗ " + fails.join("\n  ✗ ")); process.exit(1); }
console.log("play: OK");
process.exit(0);
