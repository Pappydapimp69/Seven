// Headless browser smoke test for MIRAGE. Boots the real page in Chromium,
// starts a run, drives it, and asserts on observable state.
// Run: node tests/smoke.mjs [scenario]
//   scenario: play (default) | hallucinate | phantomLog
//
// Two lessons are baked into this file:
//
// 1. NEVER ASSERT ON WALL-CLOCK TIME. Headless rAF runs at a fraction of real
//    speed, so "wait 3 seconds, expect ~3 seconds of drain" is a flake. Every
//    timing assertion below drives `window.__mirage.advance(seconds)`, which
//    steps the sim in fixed slices, and then reads the sim's own clock.
//
// 2. "IT LOADED AND NOTHING THREW" IS A FALSE GREEN FOR 3D. Software GL will
//    happily load a scene that draws nothing. So this asserts on Three's own
//    draw-call counter, and degrades gracefully (reporting SKIP, not PASS) if the
//    environment has no working WebGL at all.

import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // this repo's root — MIRAGE is standalone, served at "/"
// The static server binds port 0 — the OS picks a free one. A hardcoded port
// fails with EADDRINUSE when an earlier run's server is still up, and that
// failure looks nothing like the game being broken; it just burns a debug cycle.
const SCENARIO = process.argv[2] || "play";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

// Screenshot options. Both parts matter under software GL:
//   animations: "disabled" — the hallucinating vignette runs an infinite CSS
//     animation, and a capture that waits for the page to settle never settles.
//   timeout — a 1280x800 readback with the full-screen overlay composited over a
//     live WebGL canvas measured ~5s here and occasionally blew the 30s default.
//     That is the environment being slow, not the game being wrong, so the fix is
//     a real timeout rather than a smaller assertion.
const SHOT = { animations: "disabled", timeout: 90000 };

const failures = [];
const notes = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

(async () => {
  const server = serve();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const PORT = server.address().port;

  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: [
      "--use-gl=swiftshader",
      // Note the spelling: `--enable-unsafe-swiftshader`, not `--allow-...`.
      // Without it, newer Chromium refuses the software path and getContext
      // returns null, which looks exactly like a broken game.
      "--enable-unsafe-swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__mirage, null, { timeout: 15000 });

  const build = await page.$eval("#buildLabel", (el) => el.textContent);
  assert(build && build !== "—", `build label never populated (got ${JSON.stringify(build)})`);

  // Is there usable WebGL here at all? If not, the 3D assertions are skipped
  // rather than reported as passing.
  const glOk = await page.evaluate(() => {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  });
  if (!glOk) notes.push("SKIP: no WebGL in this environment — 3D assertions not run");

  // Start a run on a fixed seed so the basin is the same every time.
  await page.click('[data-diff="standard"]');
  await page.fill("#seedInput", "1234");
  await page.click("#startBtn");
  await page.waitForFunction(() => !!window.__mirage.sim, null, { timeout: 10000 });

  const start = await page.evaluate(() => {
    const s = window.__mirage.sim;
    return {
      party: s.party.length,
      companions: s.companions.length,
      monoliths: s.monoliths.length,
      pylons: s.pylons.length,
      doses: s.doses,
      seed: s.seed,
      status: s.status,
      hudVisible: !document.getElementById("hudLayer").classList.contains("hidden"),
      // No meter may be rendered anywhere in the HUD.
      hudText: document.getElementById("hudLayer").innerText,
    };
  });
  assert(start.party === 6, `expected 6 in the party, got ${start.party}`);
  assert(start.companions === 5, `expected 5 NPC companions, got ${start.companions}`);
  assert(start.monoliths === 6 && start.pylons === 5, "world features missing");
  assert(start.seed === 1234, `seed not honoured: ${start.seed}`);
  assert(start.hudVisible, "HUD did not appear");
  assert(!/\b\d{2}\s*\/\s*100\b/.test(start.hudText), "the HUD appears to render a lucidity value");

  // A frame from the opening position, for visual review: the party in
  // formation, in daylight, before any of the test's teleports.
  await page.screenshot({ path: path.join(ROOT, "tests", "shot-start.png"), ...SHOT });

  // --- drive the sim on ITS OWN CLOCK -------------------------------------
  const walked = await page.evaluate(() => {
    const before = { x: window.__mirage.sim.player.x, z: window.__mirage.sim.player.z };
    const t = window.__mirage.advance(8, { move: { x: 0, z: -1 }, run: true });
    const s = window.__mirage.sim;
    return {
      simTime: t,
      moved: Math.hypot(s.player.x - before.x, s.player.z - before.z),
      lucidity: s.player.lucidity,
      companionSpread: s.companions.map((c) => Math.hypot(c.x - s.player.x, c.z - s.player.z)),
    };
  });
  assert(walked.simTime >= 7.9, `sim clock only reached ${walked.simTime}s after advancing 8s`);
  assert(walked.moved > 3, `player barely moved (${walked.moved.toFixed(2)} units in 8 sim-seconds)`);
  assert(walked.lucidity < 100, "nobody drained over 8 sim-seconds");
  assert(walked.companionSpread.filter((d) => d < 22).length >= 3, `party did not keep up: ${walked.companionSpread}`);

  if (glOk) {
    const drew = await page.evaluate(() => {
      const info = window.__mirage.renderer.renderer.info;
      return { calls: info.render.calls, triangles: info.render.triangles };
    });
    assert(drew.calls > 0, "the renderer made zero draw calls — the scene is not being drawn");
    assert(drew.triangles > 1000, `suspiciously few triangles drawn: ${drew.triangles}`);
    notes.push(`drew ${drew.calls} calls / ${drew.triangles} triangles`);
  }

  // --- the hallucination path ---------------------------------------------
  const gone = await page.evaluate(() => {
    const M = window.__mirage;
    M.drain("you", 0.05);
    M.advance(1);
    const s = M.sim;
    const p = M.percept;
    M.advance(4); // let the distortion ramp
    return {
      hallucinating: s.player.hallucinating,
      kind: s.player.hallucination,
      perceptActive: p.active,
      intensity: p.intensity,
      // The INLINE target opacity, not getComputedStyle: the vignette has a
      // 0.6s CSS transition, so the computed value right after the change is
      // still mid-fade and reads ~0. Asserting on it tests the transition, not
      // the game.
      vignette: Number(document.getElementById("vignette").style.opacity || 0),
      vignetteLost: document.getElementById("vignette").classList.contains("lost"),
      rosterText: document.getElementById("roster").innerText,
      // The sim's own record must be untouched by the lie layer.
      realMonoliths: s.monoliths.length,
    };
  });
  assert(gone.hallucinating, "the player did not begin hallucinating at zero lucidity");
  assert(gone.perceptActive, "the perception layer did not activate");
  assert(gone.intensity > 0.1, `distortion never ramped (${gone.intensity})`);
  assert(gone.vignette > 0.05, `vignette stayed invisible (opacity ${gone.vignette})`);
  assert(/can't tell/.test(gone.rosterText), `the roster should stop claiming to know: ${JSON.stringify(gone.rosterText.slice(0, 120))}`);
  assert(gone.vignetteLost, "the vignette did not switch to its hallucinating variant");
  assert(gone.realMonoliths === 6, "perception contaminated the sim's own record");

  // A frame from inside a hallucination, for visual review.
  await page.screenshot({ path: path.join(ROOT, "tests", "shot-gone.png"), ...SHOT });

  // Whatever kind was drawn, the perceived world must diverge from the real one
  // in the way that kind promises.
  const divergence = await page.evaluate(() => {
    const M = window.__mirage;
    const p = M.percept;
    const s = M.sim;
    return {
      kind: p.kind,
      phantomMarkers: p.phantomMonoliths.length,
      phantomCompanions: p.phantomCompanions.length,
      phantomPylons: p.phantomPylons.length,
      compassOffset: p.compassOffset,
      deadLookLive: p.deadPylonsLookLive.size,
      whisper: p.whisper,
      realCompanions: s.companions.length,
    };
  });
  const diverged =
    divergence.phantomMarkers > 0 ||
    divergence.phantomCompanions > 0 ||
    divergence.phantomPylons > 0 ||
    Math.abs(divergence.compassOffset) > 0.5 ||
    divergence.whisper !== null;
  assert(diverged, `hallucination kind ${divergence.kind} produced no perceptual divergence`);
  assert(divergence.realCompanions === 5, "a phantom companion leaked into the sim");
  notes.push(`hallucination kind: ${divergence.kind}`);

  // --- recovery -----------------------------------------------------------
  const recovered = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    const p = s.pylons.find((x) => x.charge > 50) || s.pylons[0];
    p.charge = 100;
    M.teleport(p.x, p.z);
    M.advance(5);
    return { hallucinating: s.player.hallucinating, lucidity: s.player.lucidity, perceptActive: M.percept.active };
  });
  assert(!recovered.hallucinating, "sustained pylon contact did not bring the lead back");
  assert(!recovered.perceptActive, "the perception layer stayed active after recovery");
  assert(recovered.lucidity > 20, `recovered to a suspicious level: ${recovered.lucidity}`);

  // --- verbs --------------------------------------------------------------
  const verbs = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    const before = s.doses;
    M.act(M.ACTIONS.DOSE, 0);
    const afterDose = s.doses;
    M.act(M.ACTIONS.CHECK_IN, 1);
    const subtitles = document.getElementById("subtitles").innerText;
    // Walk to a marker and survey it for real.
    const m = s.monoliths[0];
    M.teleport(m.x + 1, m.z + 1);
    M.advance(0.5);
    M.act(M.ACTIONS.SURVEY);
    M.advance(0.2); // the HUD repaints on the frame loop, so give it a frame
    return {
      doseSpent: before - afterDose,
      subtitles,
      logged: s.monoliths.filter((x) => x.logged).length,
      entries: s.logEntries.length,
      surveyPill: document.getElementById("surveyCount").textContent,
      foundPill: document.getElementById("foundCount").textContent,
    };
  });
  assert(verbs.doseSpent === 1, `dose was not consumed (${verbs.doseSpent})`);
  assert(verbs.subtitles.trim().length > 0, "check-in produced no visible line");
  assert(verbs.logged === 1, `survey did not log the marker (${verbs.logged})`);
  assert(/1 \/ 6/.test(verbs.surveyPill), `log counter did not update: ${verbs.surveyPill}`);
  assert(/[1-6] \/ 6/.test(verbs.foundPill), `found counter never moved: ${verbs.foundPill}`);

  // --- items: pick up via the contextual survey verb, cycle, use ---------
  const items = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    const it = s.items.find((x) => !x.taken);
    it.discovered = true;
    M.teleport(it.x, it.z);
    M.advance(0.2);
    M.act(M.ACTIONS.SURVEY); // pickup takes priority over marker-survey when both are in reach
    M.advance(0.2);
    const pickedUp = s.inventory.length > 0 && it.taken;
    const barAfterPickup = document.getElementById("itemBar").innerText;
    // Push a second, known-real flare slot directly so USE_ITEM has a
    // deterministic effect to assert on, regardless of what the world roll gave us.
    s.inventory.push({ id: "smoke-flare", real: true, kind: "flare", claimedKind: null });
    M.act(M.ACTIONS.CYCLE_ITEM);
    const before = s.inventory.length;
    M.act(M.ACTIONS.USE_ITEM);
    M.advance(0.2);
    return {
      pickedUp,
      barAfterPickup,
      inventoryBeforeUse: before,
      inventoryAfterUse: s.inventory.length,
      itemsUsed: s.stats.itemsUsed + s.stats.phantomItemsUsed,
      subtitles: document.getElementById("subtitles").innerText,
    };
  });
  assert(items.pickedUp, "the survey verb did not pick up an item in reach");
  assert(items.barAfterPickup.trim().length > 0 && items.barAfterPickup !== "—", "the item bar did not show a carried item");
  assert(items.inventoryAfterUse === items.inventoryBeforeUse - 1, `USE_ITEM did not consume a slot (${items.inventoryBeforeUse} -> ${items.inventoryAfterUse})`);
  assert(items.itemsUsed >= 1, "no item use was recorded in stats");
  assert(items.subtitles.trim().length > 0, "using an item produced no visible line");

  // --- crafting: two real items combine into one via the CRAFT verb -------
  const craft = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    s.inventory.length = 0;
    s.inventory.push({ id: "craft-a", real: true, kind: "flare", claimedKind: null });
    s.inventory.push({ id: "craft-b", real: true, kind: "tether", claimedKind: null });
    M.act(M.ACTIONS.CRAFT);
    M.advance(0.2);
    return {
      inventory: s.inventory.map((slot) => slot.kind),
      itemsCrafted: s.stats.itemsCrafted,
      subtitles: document.getElementById("subtitles").innerText,
    };
  });
  assert(craft.inventory.length === 1 && craft.inventory[0] === "ember", `crafting flare+tether should leave one ember, got ${JSON.stringify(craft.inventory)}`);
  assert(craft.itemsCrafted === 1, "craft was not recorded in stats");
  assert(craft.subtitles.trim().length > 0, "crafting produced no visible line");

  // --- gathering: chop a tree, mine a deposit, craft and plant a Stake ----
  // Gathering is a HOLD, not a tap: a single M.act(SURVEY) must NOT gather,
  // and only holding interact for long enough should.
  const gather = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    const t = s.trees.find((x) => !x.chopped);
    t.discovered = true;
    M.teleport(t.x, t.z);
    M.advance(0.2);
    M.act(M.ACTIONS.SURVEY); // a bare tap must not chop
    M.advance(0.1);
    const choppedAfterTap = t.chopped;
    M.advance(1.5, { interact: true }); // now hold it
    const woodAfterChop = s.wood;
    const st = s.stones.find((x) => !x.mined);
    st.discovered = true;
    M.teleport(st.x, st.z);
    M.advance(0.2);
    M.advance(1.5, { interact: true });
    return {
      choppedAfterTap,
      chopped: t.chopped,
      mined: st.mined,
      woodAfterChop,
      stoneAfterMine: s.stone,
      woodPill: document.getElementById("woodCount").textContent,
      stonePill: document.getElementById("stoneCount").textContent,
    };
  });
  assert(!gather.choppedAfterTap, "a bare tap should not chop a tree — gathering must be a hold");
  assert(gather.chopped, "holding interact did not chop a tree in reach");
  assert(gather.mined, "holding interact did not mine a deposit in reach");
  assert(gather.woodAfterChop >= 1, "wood was not credited");
  assert(gather.stoneAfterMine >= 1, "stone was not credited");
  assert(gather.woodPill !== "0", `wood pill did not update: ${gather.woodPill}`);
  assert(gather.stonePill !== "0", `stone pill did not update: ${gather.stonePill}`);

  const stake = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    s.wood = 2;
    s.stone = 2;
    M.act(M.ACTIONS.CRAFT); // no matching item pair carried -> falls back to the wood+stone recipe
    const pylonsBefore = s.pylons.length;
    const stakeSlot = s.inventory.findIndex((slot) => slot.kind === "stake");
    M.teleport(30, 30);
    M.advance(0.2);
    // Cycle selection onto whichever slot actually holds the stake — it may
    // not be slot 0 depending on what else is carried.
    while (M.sim.inventory[M.selectedItem]?.kind !== "stake" && M.sim.inventory.some((x) => x.kind === "stake")) {
      M.act(M.ACTIONS.CYCLE_ITEM);
    }
    M.act(M.ACTIONS.USE_ITEM);
    M.advance(0.2);
    return {
      craftedStake: stakeSlot >= 0,
      pylonsAfter: s.pylons.length,
      pylonsBefore,
      plantedAt: s.pylons[s.pylons.length - 1] ? { x: s.pylons[s.pylons.length - 1].x, z: s.pylons[s.pylons.length - 1].z } : null,
    };
  });
  assert(stake.craftedStake, "wood+stone did not craft a stake");
  assert(stake.pylonsAfter === stake.pylonsBefore + 1, `using a stake should plant exactly one pylon (${stake.pylonsBefore} -> ${stake.pylonsAfter})`);
  assert(stake.plantedAt && Math.abs(stake.plantedAt.x - 30) < 0.5 && Math.abs(stake.plantedAt.z - 30) < 0.5, `stake planted at the wrong spot: ${JSON.stringify(stake.plantedAt)}`);

  // --- campaign: clearing a basin before the last one advances in place ---
  const level = await page.evaluate(() => {
    const M = window.__mirage;
    const s = M.sim;
    const levelBefore = s.level;
    const monolithPosBefore = s.monoliths.map((m) => `${m.x.toFixed(1)},${m.z.toFixed(1)}`).join("|");
    for (const m of s.monoliths) m.logged = true;
    s.logEntries = s.monoliths.map((m) => ({ id: m.id, name: m.name, real: true, t: s.time }));
    M.teleport(s.world.camp.x, s.world.camp.z);
    s.companions[0].x = s.world.camp.x;
    s.companions[0].z = s.world.camp.z;
    s.companions[1].x = s.world.camp.x;
    s.companions[1].z = s.world.camp.z;
    M.advance(0.5);
    return {
      levelBefore,
      levelAfter: M.sim.level,
      campaignLength: M.sim.campaignLength,
      monolithPosBefore,
      monolithPosAfter: M.sim.monoliths.map((m) => `${m.x.toFixed(1)},${m.z.toFixed(1)}`).join("|"),
      allUnlogged: M.sim.monoliths.every((m) => !m.logged),
      status: M.sim.status,
      hudVisible: !document.getElementById("hudLayer").classList.contains("hidden"),
      debriefVisible: !document.getElementById("debriefLayer").classList.contains("hidden"),
      levelPill: document.getElementById("levelLabel").textContent,
    };
  });
  assert(level.campaignLength > 1, `expected a real playthrough to opt into a multi-basin campaign, got length ${level.campaignLength}`);
  assert(level.levelAfter === level.levelBefore + 1, `clearing a basin should advance the level (${level.levelBefore} -> ${level.levelAfter})`);
  assert(level.status === "playing", `the new basin should be live and playing, got ${level.status}`);
  assert(level.hudVisible && !level.debriefVisible, "advancing a level should stay on the HUD, not drop to the debrief screen");
  assert(level.monolithPosAfter !== level.monolithPosBefore, "the next basin should be genuinely new geometry, not the same markers again");
  assert(level.allUnlogged, "the new basin's markers should start unlogged");
  assert(new RegExp(`${level.levelAfter} / ${level.campaignLength}`).test(level.levelPill), `level pill did not update: ${level.levelPill}`);

  // --- pause really stops the world ---------------------------------------
  const paused = await page.evaluate(async () => {
    const M = window.__mirage;
    M.act(M.ACTIONS.PAUSE);
    const t0 = M.sim.time;
    const l0 = M.sim.player.lucidity;
    await new Promise((r) => setTimeout(r, 400));
    const res = { pausedDuring: M.paused, dt: M.sim.time - t0, dl: l0 - M.sim.player.lucidity };
    M.act(M.ACTIONS.PAUSE);
    res.pausedAfter = M.paused;
    return res;
  });
  assert(paused.pausedDuring === true, "pause did not engage");
  assert(paused.pausedAfter === false, "pause did not toggle back off");
  assert(paused.dt === 0, `the sim advanced ${paused.dt}s while paused`);
  assert(paused.dl === 0, `the party drained ${paused.dl} while paused`);

  const shot = path.join(ROOT, "tests", `shot-${SCENARIO}.png`);
  await page.screenshot({ path: shot, ...SHOT });

  // Console errors are checked LAST so a functional failure is reported first.
  assert(errors.length === 0, `console errors: ${errors.slice(0, 5).join(" | ")}`);

  await browser.close();
  server.close();

  for (const n of notes) console.log("  · " + n);
  console.log(`SCREENSHOT: ${shot}`);
  if (failures.length) {
    console.log("\nSMOKE FAILED:");
    for (const f of failures) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log("mirage smoke: OK");
})().catch((e) => {
  console.error("SMOKE CRASHED:", e);
  process.exit(1);
});
