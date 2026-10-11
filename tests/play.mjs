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
  // Four-way focus: right moves along a person's row of skills, down moves down the column.
  await p.focus("#modal [data-do='inc'][data-arg='0:cut']");
  const at = () => p.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { arg: a.dataset.arg || "", do: a.dataset.do || "", x: r.left, y: r.top }; });
  const s0 = await at();
  await p.keyboard.press("ArrowRight");
  const s1 = await at();
  ok(s1.x > s0.x && Math.abs(s1.y - s0.y) < 4 && s1.arg.startsWith("0:") && s1.arg !== "0:cut", `→ moves along the row (${s0.arg} → ${s1.do} ${s1.arg})`);
  await p.keyboard.press("ArrowLeft");
  ok((await at()).arg === "0:cut", "← comes back");
  await p.keyboard.press("ArrowDown");
  const s2 = await at();
  ok(s2.y > s0.y && Math.abs(s2.x - s0.x) < 4, `↓ moves down the column (${s0.arg} → ${s2.arg})`);
  // The same on a pad: d-pad right.
  const padMoved = await p.evaluate(async () => {
    const before = document.activeElement;
    const btns = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    navigator.getGamepads = () => [{ connected: true, axes: [0, 0, 0, 0], buttons: btns }];
    await new Promise((r) => setTimeout(r, 60));
    btns[15] = { pressed: true, value: 1 };
    await new Promise((r) => setTimeout(r, 80));
    btns[15] = { pressed: false, value: 0 };
    await new Promise((r) => setTimeout(r, 60));
    navigator.getGamepads = () => [];
    const a = before.getBoundingClientRect(), b = document.activeElement.getBoundingClientRect();
    return b.left > a.left && Math.abs(b.top - a.top) < 4;
  });
  ok(padMoved, "pad d-pad right moves along the row too");
  await p.focus("#modal [data-do='inc'][data-arg='0:cut']");
  // Focus stays on the + just pressed while points remain; drops to Set out only when they run out.
  await p.click("#modal [data-do='inc'][data-arg='0:cut']");
  ok(await p.evaluate(() => document.activeElement.dataset.do === "inc" && document.activeElement.dataset.arg === "0:cut"), "focus stays on + after a press");
  await p.keyboard.press("Enter");
  ok(await p.evaluate(() => document.activeElement.dataset.arg === "0:cut" && document.querySelector("#modal").textContent.includes("4 left")), "Enter again adds again, focus kept");
  for (let i = 0; i < 4; i++) await p.keyboard.press("Enter");
  ok(await p.evaluate(() => document.querySelector("#modal").textContent.includes("0 left") && document.activeElement.dataset.do === "go"), "out of points: focus drops to Set out");
  await p.evaluate(() => window.__seven.click("Set out"));
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => !window.__seven.panel && !window.__seven.sim.camp.built), "the run starts with no camp and no plan");
  ok(await p.evaluate(() => document.getElementById("hint").textContent.includes("No camp yet") || document.getElementById("hint").textContent.includes("walk")), "a hint points at making camp");
  await p.keyboard.press("KeyQ");
  await p.waitForFunction(() => window.__seven.sim.camp.built || window.__seven.panel, null, { timeout: 20000 });
  ok(await p.evaluate(() => window.__seven.sim.camp.built), "Q made camp");
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => (window.__seven.panel || "").startsWith("Dawn")), "with camp up, the dawn plan opens");
  // Keyboard drives the panel: Enter cycles the focused person's task.
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

  // A gamepad: prompts name pad buttons once the pad is used.
  const padLabel = await p.evaluate(async () => {
    const btn = (on) => ({ pressed: on, value: on ? 1 : 0 });
    let pressed = false;
    navigator.getGamepads = () => [{ connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => btn(i === 6 && pressed)) }];
    pressed = true; await new Promise((r) => setTimeout(r, 120)); pressed = false; await new Promise((r) => setTimeout(r, 120));
    return document.getElementById("hint").textContent + " | " + document.getElementById("prompt").textContent;
  });
  ok(!/\b(WASD|E|F|R|Q) /.test(padLabel.split("|")[0]) && /\b(A|B|X|Y|LB)\b/.test(padLabel), `pad in hand: prompts name pad buttons (${padLabel.trim()})`);

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

// ---- a short screen (a projector): the title stays readable while a pad scrolls the list ----
{
  const { p, ctx } = await page({ viewport: { width: 960, height: 480 } });
  await p.evaluate(() => window.__seven.click("New run"));
  const look = () => p.evaluate(() => {
    const h = document.querySelector("#modal .panel h2").getBoundingClientRect();
    const f = document.activeElement.getBoundingClientRect();
    const head = document.querySelector("#modal .panel .head").getBoundingClientRect();
    return { hTop: h.top, hBottom: h.bottom, fTop: f.top, fBottom: f.bottom, headBottom: head.bottom, vh: innerHeight, scrolled: document.querySelector("#modal .panel").scrollTop, focus: document.activeElement.textContent.trim().slice(0, 20) };
  });
  let worst = null, maxScroll = 0;
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press("ArrowDown"); await p.waitForTimeout(40);
    const q = await look();
    maxScroll = Math.max(maxScroll, q.scrolled);
    if (!(q.hTop >= 0 && q.hBottom <= q.vh && q.fTop >= q.headBottom - 1 && q.fBottom <= q.vh)) worst = worst || q;
  }
  ok(maxScroll > 0 && !worst, `short screen: a pad down the whole list (and round again) keeps the title readable and the focus clear of it${worst ? " — " + JSON.stringify(worst) : ""}`);
  const r = await p.evaluate(() => {
    const h = document.querySelector("#modal .panel h2").getBoundingClientRect();
    const f = document.activeElement.getBoundingClientRect();
    const panel = document.querySelector("#modal .panel").getBoundingClientRect();
    const head = document.querySelector("#modal .panel .head").getBoundingClientRect();
    return { hTop: h.top, hBottom: h.bottom, pTop: panel.top, fTop: f.top, fBottom: f.bottom, headBottom: head.bottom, vh: innerHeight, scrolled: document.querySelector("#modal .panel").scrollTop, focus: document.activeElement.textContent.trim().slice(0, 20) };
  });
  await p.screenshot({ path: path.join(ROOT, "tests", "shot-short.png") });
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
  ok(await sim(p, () => window.__seven.sim.msgs.at(-1).text === "You whistle."), "the Whistle button whistles");
  void msgs0;
  await p.screenshot({ path: path.join(ROOT, "tests", "shot-phone.png") });
  await ctx.close();
}

await browser.close(); server.close();
if (errs.length) fails.push("page errors:\n    " + errs.join("\n    "));
if (fails.length) { console.log("PLAY FAILED:\n  ✗ " + fails.join("\n  ✗ ")); process.exit(1); }
console.log("play: OK");
process.exit(0);
