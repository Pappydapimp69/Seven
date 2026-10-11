// view.mjs — first person, in a real browser, guarded against the bugs it had
// before (Brain mirage#E10, #E6):
//   - W walks exactly where you look, at four headings and three device scales
//     (the old game drifted ~18° on PC under display scaling and zoom);
//   - ← → turn, and turning does not move you;
//   - a slow 360° turn sees every companion standing around you;
//   - the canvas backing is CSS size × devicePixelRatio at every scale.
//
// Run: node tests/view.mjs

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
const deg = (r) => (r * 180) / Math.PI;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const mouseTurns = [];
for (const scale of [1, 1.25, 2]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.__seven);
  await p.evaluate(() => { const M = window.__seven; M.newRun({ seed: 12, startCamp: true }); M.S.applyPlan(M.sim, "dawn", {}); });
  await p.waitForTimeout(150);
  const cv = await p.evaluate(() => ({ w: document.getElementById("game").width, iw: innerWidth, dpr: devicePixelRatio }));
  ok(cv.w === Math.round(cv.iw * cv.dpr), `scale ${scale}: canvas backing ${cv.w} = ${cv.iw} × ${cv.dpr}`);
  for (const yaw of [-Math.PI / 2, 0.6, 2.4, -2.2]) {
    const start = await p.evaluate((yaw) => {
      const s = window.__seven.sim; s.lead.x = s.camp.x; s.lead.y = s.camp.y; s.lead.yaw = yaw;
      s.mates.forEach((m) => { m.x = s.camp.x + 30; m.y = s.camp.y; });     // out of the way
      return { x: s.lead.x, y: s.lead.y };
    }, yaw);
    await p.keyboard.down("KeyW"); await p.waitForTimeout(350); await p.keyboard.up("KeyW");
    const end = await p.evaluate(() => ({ x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y, yaw: window.__seven.sim.lead.yaw }));
    const moved = Math.hypot(end.x - start.x, end.y - start.y), dir = Math.atan2(end.y - start.y, end.x - start.x);
    ok(moved > 0.5 && angDiff(dir, yaw) < (1 * Math.PI) / 180 && Math.abs(end.yaw - yaw) < 1e-9,
      `scale ${scale}, heading ${deg(yaw).toFixed(0)}°: W walks where you look (off by ${deg(angDiff(dir, yaw)).toFixed(2)}°, ${moved.toFixed(2)} cells)`);
  }
  // Strafe right is 90° clockwise of the view (y grows south on the grid).
  const s0 = await p.evaluate(() => { const s = window.__seven.sim; s.lead.x = s.camp.x; s.lead.y = s.camp.y; s.lead.yaw = -Math.PI / 2; return { x: s.lead.x, y: s.lead.y }; });
  await p.keyboard.down("KeyD"); await p.waitForTimeout(300); await p.keyboard.up("KeyD");
  const s1 = await p.evaluate(() => ({ x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y }));
  ok(s1.x - s0.x > 0.4 && Math.abs(s1.y - s0.y) < 0.01, `scale ${scale}: D steps right (east, facing north)`);
  // Mouse look: the same PHYSICAL sweep turns the same at every device scale
  // (movementX arrives in CSS px; mirage#E10). Then W follows the new heading.
  const mouse = await p.evaluate(async () => {
    const s = window.__seven.sim, cv = document.getElementById("game");
    s.lead.x = s.camp.x; s.lead.y = s.camp.y; s.lead.yaw = -Math.PI / 2;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => cv });
    const phys = 240;                                   // device pixels of hand movement
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: phys / devicePixelRatio }));
    await new Promise((r) => setTimeout(r, 80));
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => null });
    return s.lead.yaw - -Math.PI / 2;
  });
  mouseTurns.push(mouse);
  const m0 = await p.evaluate(() => ({ x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y, yaw: window.__seven.sim.lead.yaw }));
  await p.keyboard.down("KeyW"); await p.waitForTimeout(250); await p.keyboard.up("KeyW");
  const m1 = await p.evaluate(() => ({ x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y }));
  ok(mouse > 0.3 && angDiff(Math.atan2(m1.y - m0.y, m1.x - m0.x), m0.yaw) < Math.PI / 180, `scale ${scale}: mouse turns ${deg(mouse).toFixed(1)}° and W follows it`);
  // A gamepad: left stick up walks where you look; right stick turns.
  const pad = await p.evaluate(async () => {
    const s = window.__seven.sim;
    s.lead.x = s.camp.x; s.lead.y = s.camp.y; s.lead.yaw = 0.9;
    const btns = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    let axes = [0, -1, 0, 0];
    navigator.getGamepads = () => [{ connected: true, axes, buttons: btns }];
    const a = { x: s.lead.x, y: s.lead.y };
    await new Promise((r) => setTimeout(r, 300));
    axes = [0, 0, 0, 0];
    const b = { x: s.lead.x, y: s.lead.y }, y0 = s.lead.yaw;
    axes = [0, 0, 1, 0];
    await new Promise((r) => setTimeout(r, 200));
    axes = [0, 0, 0, 0];
    await new Promise((r) => setTimeout(r, 50));
    navigator.getGamepads = () => [];
    return { dir: Math.atan2(b.y - a.y, b.x - a.x), moved: Math.hypot(b.x - a.x, b.y - a.y), turned: s.lead.yaw - y0 };
  });
  ok(pad.moved > 0.3 && angDiff(pad.dir, 0.9) < Math.PI / 180 && pad.turned > 0.2, `scale ${scale}: pad stick walks where you look (off ${deg(angDiff(pad.dir, 0.9)).toFixed(2)}°), right stick turns`);

  // Turning turns and does not walk.
  const t0 = await p.evaluate(() => ({ yaw: window.__seven.sim.lead.yaw, x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y }));
  await p.keyboard.down("ArrowRight"); await p.waitForTimeout(300); await p.keyboard.up("ArrowRight");
  const t1 = await p.evaluate(() => ({ yaw: window.__seven.sim.lead.yaw, x: window.__seven.sim.lead.x, y: window.__seven.sim.lead.y }));
  ok(t1.yaw - t0.yaw > 0.3 && t1.x === t0.x && t1.y === t0.y, `scale ${scale}: → turns right (${deg(t1.yaw - t0.yaw).toFixed(0)}°) without moving`);
  await ctx.close();
}

ok(Math.max(...mouseTurns) - Math.min(...mouseTurns) < 1e-6, `the same hand movement turns the same at every scale (${mouseTurns.map((t) => deg(t).toFixed(2)).join(", ")}°)`);

// Trailing followers (mirage#E6): walk a while with everyone following, then
// stop and turn around once — every one of them must come into view.
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.__seven);
  const from = await p.evaluate(() => { const M = window.__seven; M.newRun({ seed: 16, startCamp: true }); M.S.applyPlan(M.sim, "dawn", {}); M.sim.lead.yaw = -Math.PI / 2; return { x: M.sim.lead.x, y: M.sim.lead.y }; });
  // Hold W and steer along the trail like a player would (it bends every few rows).
  await p.keyboard.down("KeyW");
  for (let i = 0; i < 35; i++) {
    await p.evaluate(() => { const s = window.__seven.sim, row = Math.floor(s.lead.y) - 2; s.lead.yaw = Math.atan2(row + 0.5 - s.lead.y, s.world.trailX[row] + 0.5 - s.lead.x); });
    await p.waitForTimeout(100);
  }
  await p.keyboard.up("KeyW");
  const walked = await p.evaluate((f) => Math.hypot(window.__seven.sim.lead.x - f.x, window.__seven.sim.lead.y - f.y), from);
  ok(walked >= 8, `the lead walked ${walked.toFixed(1)} cells up the trail`);
  await p.waitForTimeout(1500);                          // let them catch up and settle
  await p.keyboard.press("Escape");
  const seen = new Set();
  for (let k = 0; k < 24; k++) {
    await p.evaluate((k) => { window.__seven.sim.lead.yaw = -Math.PI / 2 + (k / 24) * Math.PI * 2; }, k);
    await p.waitForTimeout(60);
    for (const id of await p.evaluate(() => window.__seven.visible)) seen.add(id);
  }
  const info = await p.evaluate(() => { const s = window.__seven.sim; return s.mates.map((m) => `${m.id}@${Math.hypot(m.x - s.lead.x, m.y - s.lead.y).toFixed(1)}`); });
  const ids = info.map((x) => x.split("@")[0]);
  ok(ids.every((id) => seen.has(id)) && info.every((x) => +x.split("@")[1] <= 4), `after walking, every follower kept up (≤4 cells) and one turn round sees them all (${info.join(" ")}; saw ${[...seen].join(",")})`);
  await ctx.close();
}

// Landmarks: each clearing LOOKS like what it is called, so a wrong place is checkable.
// Assert it in the live scene (pixels), not in the data: six different clearings, six different pictures.
{
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.__seven);
  await p.keyboard.press("Space"); await p.waitForFunction(() => !window.__seven.splash);
  const seen = {};
  for (const kind of ["creek", "birches", "rocks", "old burn", "pond", "stones"]) {
    await p.evaluate((kind) => {
      const M = window.__seven; let pk = null;
      for (let seed = 1; seed < 80 && !pk; seed++) { M.newRun({ seed, startCamp: true }); pk = M.sim.world.pockets.find((q) => q.kind === kind); }
      const sim = M.sim; M.S.applyPlan(sim, "dawn", {}); M.setQ(1);
      const side = pk.x > sim.world.trailX[pk.y] ? 1 : -1;
      sim.lead.x = pk.x + 0.5 - side * 4.5; sim.lead.y = pk.y + 0.5; sim.lead.yaw = side > 0 ? 0 : Math.PI;
      sim.mates.forEach((m) => { m.x = sim.camp.x; m.y = sim.camp.y; });
      window.__pk = pk; window.__decor = pk.decor; window.__tint = sim.world.tint.slice();
    }, kind);
    await p.keyboard.press("Escape");                   // hold still and draw
    const grab = async () => { await p.waitForTimeout(300); return p.evaluate(() => {
      const c = document.getElementById("game"), g = c.getContext("2d");
      const x0 = Math.floor(c.width * 0.25), y0 = Math.floor(c.height * 0.25), w = Math.floor(c.width * 0.5), h = Math.floor(c.height * 0.5);
      return Array.from(g.getImageData(x0, y0, w, h).data);
    }); };
    const withIt = await grab();
    // The same spot, the same pose, with only the clearing's dressing taken away.
    await p.evaluate(() => { window.__pk.decor = []; window.__seven.sim.world.tint.fill(0); });
    const without = await grab();
    await p.evaluate(() => { window.__pk.decor = window.__decor; window.__seven.sim.world.tint.set(window.__tint); });
    let n = 0, r = 0, gg = 0, b = 0;
    for (let i = 0; i < withIt.length; i += 4) {
      if (Math.abs(withIt[i] - without[i]) + Math.abs(withIt[i + 1] - without[i + 1]) + Math.abs(withIt[i + 2] - without[i + 2]) > 24) { n++; r += withIt[i]; gg += withIt[i + 1]; b += withIt[i + 2]; }
    }
    seen[kind] = { n, rgb: n ? [r / n, gg / n, b / n].map(Math.round) : [0, 0, 0] };
    await p.keyboard.press("Escape");
  }
  const kinds = Object.keys(seen);
  ok(kinds.every((k) => seen[k].n > 120), `every clearing adds something to the picture (changed pixels: ${kinds.map((k) => `${k} ${seen[k].n}`).join(" · ")})`);
  const sig = kinds.map((k) => seen[k].rgb.map((v) => Math.round(v / 14)).join(","));
  ok(new Set(sig).size >= 4, `and not the same thing each time (colour of what each adds: ${kinds.map((k, i) => `${k} ${seen[k].rgb}`).join(" · ")})`);
  const blueness = (k) => seen[k].rgb[2] - seen[k].rgb[0];
  ok(blueness("pond") > blueness("old burn") && blueness("creek") > blueness("rocks"), "water reads bluer than burn and rock");
  await ctx.close();
}

// The 360° sweep: everyone around you is seen at some heading.
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${server.address().port}/`);
  await p.waitForFunction(() => window.__seven);
  await p.evaluate(() => {
    const M = window.__seven; M.newRun({ seed: 14, startCamp: true }); M.S.applyPlan(M.sim, "dawn", {});
    const s = M.sim; s.lead.x = s.camp.x; s.lead.y = s.camp.y;
    s.mates.forEach((m, i) => { const a = (i / s.mates.length) * Math.PI * 2 + 0.3; m.x = s.camp.x + Math.cos(a) * 2.2; m.y = s.camp.y + Math.sin(a) * 1.6; });
  });
  await p.keyboard.press("Escape");                     // pause: the world holds still, the view still draws
  const seen = new Set();
  for (let k = 0; k < 24; k++) {
    await p.evaluate((k) => { window.__seven.sim.lead.yaw = (k / 24) * Math.PI * 2; }, k);
    await p.waitForTimeout(60);
    for (const id of await p.evaluate(() => window.__seven.visible)) seen.add(id);
  }
  const ids = await p.evaluate(() => window.__seven.sim.mates.map((m) => m.id));
  ok(ids.every((id) => seen.has(id)), `a 360° turn sees all ${ids.length} companions (saw ${[...seen].join(", ")})`);
  await p.keyboard.press("Escape");
  await p.screenshot({ path: path.join(ROOT, "tests", "shot-view.png") });
  await ctx.close();
}

await browser.close(); server.close();
if (errs.length) fails.push("page errors:\n    " + errs.join("\n    "));
if (fails.length) { console.log("VIEW FAILED:\n  ✗ " + fails.join("\n  ✗ ")); process.exit(1); }
console.log("view: OK");
process.exit(0);
