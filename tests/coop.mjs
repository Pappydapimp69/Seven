// Couch co-op browser test: split-screen, per-player perception, and the
// hand-back to the party AI when a player drops out.
//
// Run: node tests/coop.mjs
//
// Same two lessons as smoke.mjs apply and are followed here: no assertion is
// phrased in wall-clock seconds (the sim is driven through its own clock via
// window.__mirage.advance), and "it loaded and nothing threw" is not accepted
// as proof that anything was drawn — the split-screen assertions read Three's
// own draw-call counter and the actual scissor rectangle.
//
// Joining is driven through window.__mirage.debugJoin rather than a synthetic
// Gamepad: gamepad.mjs already proves the real pad path end to end, and what
// is under test here is the co-op wiring (possession, percepts, viewports),
// not device enumeration.

import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

const failures = [];
const notes = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

(async () => {
  const server = serve();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const PORT = server.address().port;

  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__mirage, null, { timeout: 15000 });
  // Co-op is an explicit title-screen OPTION, default solo — assert the
  // default, then opt in the way a couch player would.
  assert(await page.evaluate(() => window.__mirage.coopAllowed === false),
    "co-op must default OFF");
  assert(await page.evaluate(() => document.querySelector('[data-coop-opt="solo"]').classList.contains("sel")),
    "the title screen should show Solo selected by default");
  await page.click('[data-coop-opt="couch"]');
  assert(await page.evaluate(() => window.__mirage.coopAllowed === true),
    "picking Couch co-op should arm the join poll");
  await page.click('[data-diff="standard"]');
  await page.fill("#seedInput", "4242");
  await page.click("#startBtn");
  await page.waitForFunction(() => !!window.__mirage.sim, null, { timeout: 10000 });

  // ---- solo baseline -------------------------------------------------------
  const solo = await page.evaluate(() => {
    const M = window.__mirage;
    M.advance(1);
    return {
      players: M.players.length,
      humans: M.sim.humans.length,
      coopAttr: document.body.dataset.coop || "",
      badgesVisible: getComputedStyle(document.getElementById("coopBadges")).display !== "none",
    };
  });
  assert(solo.players === 1, `a solo run should have 1 local player, got ${solo.players}`);
  assert(solo.humans === 1, `a solo run should have 1 human in the sim, got ${solo.humans}`);
  assert(!solo.badgesVisible, "co-op badges must stay hidden in single player");

  // ---- player two joins ----------------------------------------------------
  const joined = await page.evaluate(() => {
    const M = window.__mirage;
    const partyBefore = M.sim.party.length;
    const slot = M.debugJoin();
    M.advance(1);
    const p2 = M.players[1];
    return {
      slot,
      partyBefore,
      partyAfter: M.sim.party.length,
      players: M.players.length,
      humans: M.sim.humans.length,
      possessedName: p2.eye.name,
      possessedIsCompanion: M.sim.companions.includes(p2.eye),
      p2IsLead: p2.eye.isPlayer === true,
      // Each human must own a DISTINCT percept bound to their own mind.
      distinctPercepts: M.players[0].percept !== M.players[1].percept,
      p1Eye: M.players[0].percept.eye === M.sim.player,
      p2Eye: p2.percept.eye === p2.eye,
      coopAttr: document.body.dataset.coop,
      badgesVisible: getComputedStyle(document.getElementById("coopBadges")).display !== "none",
      badgeName: document.getElementById("coopName2").textContent,
    };
  });
  assert(joined.slot === 1, `player two should take slot 1, got ${joined.slot}`);
  assert(joined.players === 2 && joined.humans === 2, "the join did not register two humans");
  assert(joined.partyAfter === joined.partyBefore, "co-op must not add a body to the basin");
  assert(joined.possessedIsCompanion, "player two must possess an existing companion");
  assert(!joined.p2IsLead, "possession must not promote a companion to the LEAD");
  assert(joined.distinctPercepts, "each player needs their OWN percept");
  assert(joined.p1Eye && joined.p2Eye, "each percept must be bound to its own mind");
  assert(joined.coopAttr === "2", `body[data-coop] should be "2", got ${JSON.stringify(joined.coopAttr)}`);
  assert(joined.badgesVisible, "co-op identity badges must appear once a second player joins");
  assert(joined.badgeName === joined.possessedName,
    `the P2 badge should name the possessed companion (${joined.possessedName}), got ${joined.badgeName}`);
  notes.push(`player two took ${joined.possessedName}`);

  // ---- the screen actually splits -----------------------------------------
  const split = await page.evaluate(() => {
    const M = window.__mirage;
    const r = M.renderer.renderer;
    M.advance(0.2);
    // Read the ACTUAL GL state rather than our own bookkeeping — this is the
    // same reasoning as smoke.mjs asserting on Three's draw counters instead
    // of trusting that the code ran: it proves the scissor/viewport really
    // reached the driver, not just that a JS field was assigned.
    const gl = r.getContext();
    const vp = Array.from(gl.getParameter(gl.VIEWPORT));
    const box = Array.from(gl.getParameter(gl.SCISSOR_BOX));
    return {
      calls: r.info.render.calls,
      scissorTest: !!gl.getParameter(gl.SCISSOR_TEST),
      // The LAST viewport set in a frame is player two's — the right-hand half.
      lastViewport: { x: vp[0], y: vp[1], w: vp[2], h: vp[3] },
      scissorBox: { x: box[0], y: box[1], w: box[2], h: box[3] },
      canvasW: document.getElementById("gl").width,
    };
  });
  assert(split.scissorTest === true, "split-screen should leave the scissor test enabled");
  assert(split.calls > 0, "nothing was drawn after the split");
  if (split.lastViewport) {
    assert(Math.abs(split.lastViewport.w - split.canvasW / 2) <= 2,
      `player two's viewport should be half the canvas wide, got ${split.lastViewport.w} of ${split.canvasW}`);
    assert(Math.abs(split.lastViewport.x - Math.floor(split.canvasW / 2)) <= 2,
      `player two's viewport should start at the midpoint, got x=${split.lastViewport.x}`);
    assert(split.scissorBox.w === split.lastViewport.w && split.scissorBox.x === split.lastViewport.x,
      `the scissor box must match the viewport, got ${JSON.stringify(split.scissorBox)} vs ${JSON.stringify(split.lastViewport)}`);
    notes.push(`viewport 2 = ${split.lastViewport.w}x${split.lastViewport.h} at x=${split.lastViewport.x}`);
  }

  // ---- the two players are shown DIFFERENT worlds --------------------------
  // This is the whole point of the mode: send ONLY player two under, and the
  // lead's screen must stay honest while player two's starts lying.
  const asym = await page.evaluate(() => {
    const M = window.__mirage;
    const p2 = M.players[1];
    // Past LUCIDITY_GRACE first — the same fix smoke.mjs's hallucination-path
    // block already carries. distortion() deliberately returns 0 for the first
    // five minutes of a basin even for a mind that IS mid-hallucination (see
    // its own comment), so asserting a visible distortion inside the grace
    // window measures the grace window, not the asymmetry this block is about.
    M.sim.time = 300;
    // Drop ONLY player two's meter. The lead's is untouched.
    M.drain(p2.eye.id, 0);
    M.advance(3);
    return {
      p1Active: M.players[0].percept.active,
      p2Active: p2.percept.active,
      p1Phantoms: M.perceivedMonolithsFor(0).filter((m) => m.phantom).length,
      p2Phantoms: M.perceivedMonolithsFor(1).filter((m) => m.phantom).length,
      p1Distortion: M.distortionFor(0),
      p2Distortion: M.distortionFor(1),
      leadHallucinating: M.sim.player.hallucinating,
    };
  });
  assert(!asym.leadHallucinating, "the lead must not have been dragged under with player two");
  assert(!asym.p1Active, "the lead's percept must stay honest while another player is gone");
  assert(asym.p2Active, "player two's own percept must go active");
  assert(asym.p2Distortion > 0, "player two's screen should distort");
  assert(asym.p1Distortion === 0, `the lead's screen must stay undistorted, got ${asym.p1Distortion}`);
  notes.push(`asymmetry: p1 sees ${asym.p1Phantoms} phantom(s), p2 sees ${asym.p2Phantoms}`);

  await page.screenshot({
    path: path.join(ROOT, "tests", "shot-coop.png"),
    animations: "disabled",
    timeout: 90000,
  });

  // ---- player two gets their own prompt, with their own hold progress ------
  const prompt2 = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    const p2 = M.players[1].eye;
    // Park the LEAD away from everything; stand P2 at a discovered tree.
    const t = s.trees.find((x) => !x.chopped);
    t.discovered = true;
    M.teleport(t.x + 200, t.z + 200);
    p2.x = t.x; p2.z = t.z;
    M.advance(0.3, { others: [{}] });
    const before = {
      p2Shown: document.getElementById("actionPrompt2").classList.contains("show"),
      p2Text: document.getElementById("actionPromptText2").textContent,
      leadShown: document.getElementById("actionPrompt").classList.contains("show"),
    };
    // Hold P2's interact partway — progress must appear on P2's fill only.
    M.advance(0.7, { others: [{ interact: true }] });
    const fill = parseFloat(document.getElementById("actionPromptFill2").style.width) || 0;
    const leadFill = parseFloat(document.getElementById("actionPromptFill").style.width) || 0;
    return { ...before, fill, leadFill, chopped: t.chopped };
  });
  assert(prompt2.p2Shown, "player two's prompt should show at their own tree");
  assert(/chop/i.test(prompt2.p2Text), `player two's prompt should offer the chop, got ${JSON.stringify(prompt2.p2Text)}`);
  assert(!prompt2.leadShown, "the lead's prompt must not show player two's context");
  assert(prompt2.fill > 0, "player two's hold progress should fill THEIR bar");
  assert(prompt2.leadFill === 0, "player two's hold must not fill the lead's bar");
  assert(!prompt2.chopped, "0.7s of a 1.2s hold must not have completed the chop");
  notes.push(`p2 prompt "${prompt2.p2Text}" at ${prompt2.fill.toFixed(0)}%`);

  // ---- the shared pack shows a different label to each viewer --------------
  // There is ONE inventory array, not one per player (see state.js's own
  // comment) — but each half of the split screen paints it through THAT
  // player's own percept. Player two is still the one hallucinating from the
  // asymmetry check above; the still-lucid lead must read the SAME slot
  // truthfully, with no "show" or "give" action at all — the existing
  // per-percept split already does it.
  const shared = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    const p2 = M.players[1];
    s.inventory.length = 0;
    s.inventory.push({ id: "shared-flare", real: true, kind: "flare", claimedKind: null });
    p2.percept.itemLabels.set("shared-flare", "lens"); // player two: still lying
    M.advance(0.1); // one frame so hud.update() repaints both panels from this state
    return {
      p1Active: M.players[0].percept.active,
      p2Active: p2.percept.active,
      p1Bar: document.getElementById("itemBar").textContent,
      p2Bar: document.getElementById("itemBar2").textContent,
    };
  });
  assert(!shared.p1Active && shared.p2Active, `test assumes lead lucid / p2 hallucinating still, got p1=${shared.p1Active} p2=${shared.p2Active}`);
  assert(/Flare/.test(shared.p1Bar), `the still-lucid lead's panel should show the truth, got ${JSON.stringify(shared.p1Bar)}`);
  assert(/Lens/.test(shared.p2Bar), `player two's own panel should keep showing their own lie about the SAME slot, got ${JSON.stringify(shared.p2Bar)}`);

  // ---- dropping out hands the mind back to the AI --------------------------
  const dropped = await page.evaluate(() => {
    const M = window.__mirage;
    const who = M.players[1].eye;
    const before = { x: who.x, z: who.z, lucidity: who.lucidity };
    M.debugDrop(1);
    // Put the lead far away so the follow AI has a reason to move.
    M.teleport(who.x + 45, who.z);
    M.advance(3);
    return {
      players: M.players.length,
      humans: M.sim.humans.length,
      humanSlot: who.humanSlot,
      stillInParty: M.sim.party.includes(who) && M.sim.companions.includes(who),
      moved: Math.hypot(who.x - before.x, who.z - before.z),
      lucidityKept: who.lucidity <= before.lucidity, // still draining, not reset
      coopAttr: document.body.dataset.coop,
      badgeName: document.getElementById("coopName2").textContent,
    };
  });
  assert(dropped.players === 1 && dropped.humans === 1, "dropping out should leave one human");
  assert(dropped.humanSlot === null, "the dropped character must be AI-driven again");
  assert(dropped.stillInParty, "the dropped character must STAY in the basin, not be destroyed");
  assert(dropped.moved > 0.1, "the party AI did not take the wheel back after the drop");
  assert(dropped.lucidityKept, "the dropped mind's state must not be reset by the handoff");
  assert(dropped.coopAttr === "1", `body[data-coop] should return to "1", got ${dropped.coopAttr}`);
  assert(dropped.badgeName === "—", "the P2 badge should clear on drop");

  assert(errors.length === 0, `console errors during co-op: ${JSON.stringify(errors.slice(0, 4))}`);

  await browser.close();
  server.close();

  for (const n of notes) console.log("  · " + n);
  if (failures.length) {
    console.log(`\n${failures.length} failed:`);
    for (const f of failures) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log("mirage coop: OK");
})().catch((e) => {
  console.error("COOP CRASHED:", e);
  process.exit(1);
});
