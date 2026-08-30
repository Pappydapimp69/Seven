// woods-play.mjs — a whole day, in a real browser, start to verdict.
//
// tests/woods.mjs proves the day's LOGIC without a DOM. This proves the game
// is actually playable: that the real interact key works a beat, that the real
// party AI walks the named hand to the site on its own, that the morning's
// panels open with real text in them, and that a run reloaded from real
// localStorage comes back the same day.
//
// The failure this exists to catch is the one this codebase produces over and
// over: every unit test green while the thing is unreachable in play, with
// nothing erroring anywhere.
//
// Run: node tests/woods-play.mjs

import { createRequire } from "module";
import http from "http"; import fs from "fs"; import path from "path";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const serve = () => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
});
const fails = [];
const A = (c, m) => { if (!c) fails.push(m); };

(async () => {
  const s = serve(); await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const url = `http://localhost:${s.address().port}/index.html`;
  const b = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await b.newPage({ viewport: { width: 1100, height: 640 } });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: "networkidle" });

  // --- the title offers it at all ----------------------------------------
  const title = await page.evaluate(() => ({
    hasBtn: !!document.getElementById("woodsBtn"),
    visible: document.getElementById("woodsBtn")?.offsetParent !== null,
    label: document.getElementById("woodsBtn")?.textContent.trim(),
  }));
  A(title.hasBtn && title.visible, "there is no way into THE WOODS from the title screen");

  // --- the day starts -----------------------------------------------------
  const start = await page.evaluate(() => {
    const M = window.__mirage;
    M.startWoods("woods-test");
    M.advance(0.3);
    const w = M.woods;
    return {
      phase: w.phase,
      beat: w.beat,
      names: M.sim.companions.map((c) => c.name),
      sites: M.sim.world.sites.map((x) => x.id),
      lit: w.activeSiteId,
      objective: document.getElementById("objectiveText").textContent,
      objectiveShown: !document.getElementById("objective").classList.contains("hidden"),
      drew: M.renderer.renderer.info.render.calls,
    };
  });
  A(start.phase === "day", `the day did not start: phase ${start.phase}`);
  A(start.sites.length === 4, `expected four worksites, got ${start.sites.length}`);
  A(start.lit, "no worksite is lit — the player is told to go somewhere with nothing to walk to");
  A(start.objectiveShown && start.objective.length > 20, `the first brief is missing: "${start.objective}"`);
  A(new Set(start.names).size === 5, `the party is not five distinct people: ${start.names.join(",")}`);
  A(start.names.every((n) => /^[A-Z]{4,8}$/.test(n)), `a generated name is malformed: ${start.names.join(",")}`);
  A(start.drew > 40, `the camp barely drew (${start.drew} calls) — geometry is missing`);

  // --- the prompt appears where the work is, and nowhere else ------------
  const prompts = await page.evaluate(() => {
    const M = window.__mirage;
    const out = {};
    M.advance(0.2);
    out.awayFromSite = document.getElementById("actionPromptText").textContent;
    out.awayShown = document.getElementById("actionPrompt").classList.contains("show");
    // Stand at the site with nobody there: the prompt must say who is missing
    // rather than going blank, or "nothing happens" is the whole feedback.
    const w = M.woods; const sim = M.sim;
    const beat = w.assign;
    const site = sim.world.sites.find((x) => x.id === w.activeSiteId);
    sim.player.x = site.x; sim.player.z = site.z;
    for (const c of sim.companions) { c.x = site.x + 300; c.z = site.z + 300; }
    M.advance(0.2);
    out.alone = document.getElementById("actionPromptText").textContent;
    out.aloneShown = document.getElementById("actionPrompt").classList.contains("show");
    void beat;
    return out;
  });
  A(!prompts.awayShown || !prompts.awayFromSite.includes("Load"),
    `the work prompt shows from across the camp: "${prompts.awayFromSite}"`);
  A(prompts.aloneShown && /Waiting on/.test(prompts.alone),
    `standing at the site alone said "${prompts.alone}" instead of naming who is missing`);

  // --- the named hand walks there on their own ---------------------------
  // From the far end of the camp, across the whole map, with nobody calling
  // them. This is the load-bearing behaviour of the whole day: if the hand does
  // not come, every beat needs a CALL, and CALL_PERSONAL is 120 seconds, so a
  // seven-beat day would spend most of itself waiting.
  const walked = await page.evaluate(async () => {
    const M = window.__mirage; const sim = M.sim; const w = M.woods;
    const site = sim.world.sites.find((x) => x.id === w.activeSiteId);
    const hand = sim.companions.find((c) => c.jobSite);
    // Put everyone back on the map first — the prompt probe above deliberately
    // threw them off it, and a companion outside the world is not a case the
    // game produces.
    for (const c of sim.companions) { c.x = sim.world.spawn.x; c.z = sim.world.spawn.z + (c.index || 0); }
    const before = Math.hypot(hand.x - site.x, hand.z - site.z);
    for (let i = 0; i < 900; i++) M.advance(0.1);
    const after = Math.hypot(hand.x - site.x, hand.z - site.z);
    return { before, after, name: hand.name, goal: hand.goalKind, site: site.id };
  });
  A(walked.after < walked.before,
    `${walked.name} did not walk to their job (${walked.before.toFixed(1)}m -> ${walked.after.toFixed(1)}m, goal "${walked.goal}")`);
  A(walked.after < 10, `${walked.name} never got to the ${walked.site} — still ${walked.after.toFixed(1)}m out after 90s`);

  // --- play the whole day with the real key ------------------------------
  const day = await page.evaluate(() => {
    const M = window.__mirage;
    const seen = [];
    for (let i = 0; i < 12 && M.woods.phase === "day"; i++) {
      const at = M.debugWalkToBeat();
      M.advance(0.2);
      const shown = document.getElementById("actionPromptText").textContent;
      M.act(M.ACTIONS.SURVEY);          // the real interact key
      M.advance(0.2);
      seen.push({ ...at, prompt: shown });
    }
    return {
      seen,
      phase: M.woods.phase,
      facts: M.woods.chronicle.facts.length,
      lit: M.woods.activeSiteId,
      objective: document.getElementById("objectiveText").textContent,
    };
  });
  A(day.phase === "morning", `the day did not reach the morning: stuck in "${day.phase}" after ${day.seen.length} presses`);
  A(day.facts === 7, `expected seven things to have happened, got ${day.facts}`);
  A(day.seen.every((x) => x.prompt && x.prompt.length > 4), `a beat offered no prompt: ${JSON.stringify(day.seen)}`);
  A(!day.lit, "a worksite is still lit in the morning");
  A(/Ask about yesterday/.test(day.objective), `the morning does not tell you what to do: "${day.objective}"`);

  // --- asking -------------------------------------------------------------
  const asked = await page.evaluate(() => {
    const M = window.__mirage;
    const out = { accounts: [], taken: M.woods.taken };
    for (let i = 0; i < 3; i++) {
      M.act(M.ACTIONS.CHECK_IN, i);
      M.advance(0.1);
      out.accounts.push({
        who: M.sim.companions[i].id,
        panel: M.woodsPanel,
        name: document.getElementById("accountName").textContent,
        weather: document.getElementById("accountWeather").textContent,
        lines: [...document.querySelectorAll("#accountLines li")].map((li) => li.textContent),
        left: document.getElementById("asksLeft").textContent,
      });
    }
    M.act(M.ACTIONS.CHECK_IN, 3);
    M.advance(0.1);
    out.fourth = M.woods.asksLeft;
    return out;
  });
  for (const a of asked.accounts) {
    A(a.panel === "accountPanel", `asking ${a.who} opened "${a.panel}"`);
    A(a.lines.length === 7, `${a.who} recounted ${a.lines.length} things, not seven`);
    A(a.weather.length > 8, `${a.who} said nothing about the weather`);
    A(/left/.test(a.left), `the questions-left line is missing: "${a.left}"`);
  }
  A(asked.fourth === 0, `a fourth question was answered — asksLeft ${asked.fourth}`);
  {
    const real = asked.accounts.filter((a) => a.who !== asked.taken).map((a) => a.lines.join("|"));
    const fake = asked.accounts.filter((a) => a.who === asked.taken).map((a) => a.lines.join("|"));
    if (real.length > 1) A(new Set(real).size === 1, "two people who were both here told it differently");
    if (fake.length && real.length) A(fake[0] !== real[0], "the one who was not here told it exactly like everyone else");
  }

  // --- naming somebody ----------------------------------------------------
  const verdict = await page.evaluate(() => {
    const M = window.__mirage;
    M.act(M.ACTIONS.OFFER_ITEM);        // the real "name them" key
    M.advance(0.1);
    const names = [...document.querySelectorAll("#accuseRow button")].map((x) => x.textContent);
    const panelBefore = M.woodsPanel;
    const taken = M.woods.taken;
    M.woodsAccuse(taken);
    M.advance(0.1);
    return {
      panelBefore, names,
      panel: M.woodsPanel,
      head: document.getElementById("verdictHead").textContent,
      body: document.getElementById("verdictBody").textContent,
      tell: document.getElementById("verdictTell").textContent,
      correct: M.woods.correct,
      phase: M.woods.phase,
      saveGone: localStorage.getItem("mirage:run") === null,
    };
  });
  A(verdict.panelBefore === "accusePanel", `the name list did not open (got "${verdict.panelBefore}")`);
  A(verdict.names.length === 5, `the name list offered ${verdict.names.length} people`);
  A(verdict.correct === true, "naming the one who was taken came back wrong");
  A(/right/i.test(verdict.head), `the verdict reads "${verdict.head}"`);
  A(verdict.tell.length > 10, "the verdict does not say what they got wrong");
  A(verdict.phase === "verdict", `phase is "${verdict.phase}" after the verdict`);
  A(verdict.saveGone, "a finished morning is still in the save slot — Resume would hand it back");

  // --- and a day picked back up after a reload ---------------------------
  await page.evaluate(() => {
    const M = window.__mirage;
    M.toTitle();
    M.startWoods("reload-test");
    M.debugWalkToBeat(); M.act(M.ACTIONS.SURVEY); M.advance(0.2);
    M.debugWalkToBeat(); M.act(M.ACTIONS.SURVEY); M.advance(0.2);
    // The REAL autosave, not a test-only writer: it fires on the sim clock
    // every AUTOSAVE_EVERY seconds, so six seconds of standing still is what a
    // player quitting mid-day would actually have left behind.
    M.advance(6);
  });
  await page.reload({ waitUntil: "networkidle" });
  const resumed = await page.evaluate(() => {
    document.getElementById("continueBtn").click();
    const M = window.__mirage;
    M.advance(0.3);
    return {
      phase: M.woods?.phase ?? null,
      beat: M.woods?.beat ?? null,
      facts: M.woods?.chronicle.facts.length ?? null,
      names: M.sim?.companions.map((c) => c.name) ?? [],
      lit: M.woods?.activeSiteId ?? null,
      camp: !!M.sim?.world.cellKind,
      sites: M.sim?.world.sites?.length ?? 0,
      detail: document.getElementById("continueDetail").textContent,
    };
  });
  A(resumed.camp, "a resumed day came back on a BASIN, not the camp");
  A(resumed.sites === 4, `a resumed day has ${resumed.sites} worksites`);
  A(resumed.beat === 2 && resumed.facts === 2, `the resumed day is at beat ${resumed.beat} with ${resumed.facts} facts, expected 2/2`);
  A(resumed.lit, "the resumed day lit no worksite");
  A(resumed.names.every((n) => /^[A-Z]{4,8}$/.test(n)), `the party came back under different names: ${resumed.names.join(",")}`);

  A(errs.length === 0, `page errors: ${JSON.stringify(errs.slice(0, 3))}`);
  await b.close(); s.close();
  if (fails.length) { console.log(fails.length + " failed:"); fails.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
  console.log("the woods: OK — a day, a night, and somebody who was not there");
})().catch((e) => { console.error("CRASH:", e.message); process.exit(1); });
