// tutorial-play.mjs — does the tutorial actually run, in a browser?
//
// tests/tutorial.mjs proves the step table is well-formed and the observer is
// pure. Neither of those is evidence that a stage COMPLETES: the characteristic
// tutorial bug is silent starvation somewhere in the pipeline between a key
// press and the step, and every layer of that pipeline only exists in the
// browser. So this drives the real verbs through the real frame loop and asserts
// progress actually moves.
//
// Run: node tests/tutorial-play.mjs

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  try {
    const body = await readFile(path.join(ROOT, url === "/" ? "index.html" : url));
    res.writeHead(200, { "Content-Type": TYPES[path.extname(url)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("no"); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const failures = [];
const notes = [];
const assert = (c, m) => { if (!c) failures.push(m); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__mirage, null, { timeout: 20000 });

// --- the entry point exists and is reachable --------------------------------
{
  const btn = await page.evaluate(() => {
    const b = document.getElementById("learnBtn");
    return b ? { text: b.textContent.trim(), visible: b.offsetParent !== null, row: b.dataset.row } : null;
  });
  assert(btn, "no Learn the walk button on the title screen");
  assert(btn && btn.visible, "the tutorial entry point is not visible");
  assert(btn && btn.row !== undefined, "the tutorial button is outside the gamepad menu grid — unreachable on a pad");
}

// --- stage 1: movement -------------------------------------------------------
{
  await page.evaluate(() => window.__mirage.startStage(0));
  await page.waitForFunction(() => !!window.__mirage.sim, null, { timeout: 15000 });
  const shown = await page.evaluate(() => ({
    objective: document.getElementById("objective")?.classList.contains("hidden") === false,
    title: document.getElementById("objectiveTitle")?.textContent || "",
    text: document.getElementById("objectiveText")?.textContent || "",
  }));
  assert(shown.objective, "the objective banner is not shown during a stage");
  assert(/1\/7/.test(shown.title), `objective title does not say which stage: "${shown.title}"`);

  // Walk far enough to satisfy the distance bound.
  // Walk like a player, not like a rail. The camp is placed in a real basin and
  // there is no guarantee the ground due north of it is open — an earlier version
  // of this held ONE heading for the whole attempt, covered 8m into a rock face
  // and reported the tutorial step as starved. That would have sent someone
  // looking for a bug in the observer that was never there. Anything that stops
  // making ground here turns, the way a person does.
  const walk = await page.evaluate(async () => {
    const M = window.__mirage;
    const s = M.sim, x0 = s.player.x, z0 = s.player.z;
    let heading = 0, lastX = s.player.x, lastZ = s.player.z;
    for (let i = 0; i < 400; i++) {
      M.advance(0.1, { move: { x: Math.sin(heading), z: -Math.cos(heading) }, run: true });
      if (M.tutorialDone().includes("walk-in")) {
        return { ok: true, i, moved: +Math.hypot(s.player.x - x0, s.player.z - z0).toFixed(1) };
      }
      // Made less than a walking pace's worth of ground this slice: something is
      // in the way. Turn and keep going.
      if (Math.hypot(s.player.x - lastX, s.player.z - lastZ) < 0.25) heading += 0.9;
      lastX = s.player.x; lastZ = s.player.z;
    }
    return {
      ok: false,
      moved: +Math.hypot(s.player.x - x0, s.player.z - z0).toFixed(1),
      status: s.status,
      stored: JSON.parse(localStorage.getItem("mirage:settings") || "{}").tutorial,
    };
  });
  assert(walk.ok, `walking never completed the movement stage — the step starved (${JSON.stringify(walk)})`);
  notes.push(`stage 1 walked ${walk.moved}m in ${((walk.i + 1) * 0.1).toFixed(1)}s`);
}

// --- stage 2: a pinned pickup ------------------------------------------------
{
  const r = await page.evaluate(async () => {
    const M = window.__mirage;
    M.startStage(1);
    const s = M.sim;
    const it = s.items.find((i) => i.id === "tut-item-a");
    if (!it) return { placed: false };
    // Stand on it and press the real verb through the real handler.
    s.player.x = it.x; s.player.z = it.z;
    M.advance(0.1);
    const promptBefore = document.getElementById("actionPromptText")?.textContent || "";
    M.act(M.ACTIONS.SURVEY);
    M.advance(0.1);
    return { placed: true, prompt: promptBefore, done: M.tutorialDone().includes("ground") };
  });
  assert(r.placed, "stage 2 did not place its pinned item");
  // The starvation check, in the browser: the prompt must be offering PICKUP,
  // not something that outranks it.
  assert(/Pick up/i.test(r.prompt), `stage 2's prompt was "${r.prompt}" — the taught verb is outranked at its own teaching site`);
  assert(r.done, "picking up the pinned item did not complete the stage");
  notes.push(`stage 2 prompt: "${r.prompt}"`);
}

// --- stage 5: the pylon, which needs two ------------------------------------
{
  const r = await page.evaluate(async () => {
    const M = window.__mirage;
    M.startStage(4);
    const s = M.sim;
    const p = s.pylons.find((x) => !x.spent);
    if (!p) return { live: false };
    s.player.x = p.x; s.player.z = p.z;
    const mate = s.companions[0];
    mate.x = p.x; mate.z = p.z; mate.lucidity = 90;
    M.advance(0.1);
    const prompt = document.getElementById("actionPromptText")?.textContent || "";
    M.act(M.ACTIONS.SURVEY);            // primes
    const afterPrime = M.tutorialDone().includes("pylon");
    M.advance(1.0);                     // the companion joins
    return { live: true, prompt, afterPrime, done: M.tutorialDone().includes("pylon"), spent: !!p.spent };
  });
  assert(r.live, "stage 5 had no live pylon");
  assert(/pylon/i.test(r.prompt), `stage 5's prompt was "${r.prompt}"`);
  assert(!r.afterPrime, "one pair of hands completed the pylon stage — the two-hands rule is not being taught");
  assert(r.done && r.spent, "a confirmed pylon did not complete the stage");
}

// --- every remaining stage must actually complete ---------------------------
// Stages 3, 4, 6 and 7 shipped without a browser check. Silent starvation is
// the failure mode here, so "it is in the table" is not evidence it fires.
{
  const r = await page.evaluate(async () => {
    const M = window.__mirage;
    const out = {};

    // 3 — craft: the two halves are already in hand.
    M.startStage(2);
    M.advance(0.1);
    out.craftHeld = M.sim.inventory.length;
    M.act(M.ACTIONS.CRAFT);
    M.advance(0.2);
    out.craft = M.tutorialDone().includes("craft");

    // 4 — hands: give the held item to IREN, who must be in reach. OFFER_ITEM
    // takes no target argument — it acts on the roster SELECTION — so the only
    // honest way to aim it is the selection verb a player would press.
    M.startStage(3);
    const s4 = M.sim;
    const iren = s4.companions[1];
    out.irenId = iren.id;
    iren.x = s4.player.x + 1; iren.z = s4.player.z; iren.lucidity = 80;
    M.advance(0.1);
    out.giveHeld = s4.inventory.length;
    M.act(M.ACTIONS.NEXT_TARGET);           // selection 0 -> 1, i.e. IREN
    out.selectedForGive = M.selected;
    M.act(M.ACTIONS.OFFER_ITEM);
    M.advance(0.2);
    out.hands = M.tutorialDone().includes("hands");

    // 6 — ask: both named companions, and only both. CHECK_IN's argument is a
    // roster INDEX (the digit key), not an id.
    M.startStage(5);
    const s6 = M.sim;
    out.askIds = [s6.companions[2].id, s6.companions[3].id];
    M.act(M.ACTIONS.CHECK_IN, 2);
    M.advance(0.2);
    out.askAfterOne = M.tutorialDone().includes("ask");
    M.act(M.ACTIONS.CHECK_IN, 3);
    M.advance(0.2);
    out.ask = M.tutorialDone().includes("ask");

    // 7 — the first lie: the lead is under, alone, at nothing. The phantom is
    // seeded 14-30m out and LOG_RADIUS is 5, so the stage genuinely requires
    // walking to it — surveying from the spawn point proves nothing.
    M.startStage(6);
    const s7 = M.sim;
    out.leadUnder = !!s7.player.hallucinating;
    M.advance(0.1);                         // percept seeds the phantoms
    const ph = M.percept.phantomMonoliths[0];
    out.phantoms = M.percept.phantomMonoliths.length;
    if (ph) { s7.player.x = ph.x; s7.player.z = ph.z; M.advance(0.1); }
    out.liePrompt = document.getElementById("actionPromptText")?.textContent || "";
    M.act(M.ACTIONS.SURVEY);
    M.advance(0.2);
    out.lie = M.tutorialDone().includes("first-lie");
    out.badLogs = s7.logEntries.filter((e) => !e.real && !e.struck).length;
    return out;
  });

  assert(r.craftHeld === 2, `stage 3 handed the player ${r.craftHeld} ingredients, not 2`);
  assert(r.craft, "crafting did not complete stage 3");
  assert(r.giveHeld === 1, `stage 4 handed the player ${r.giveHeld} items, not 1`);
  assert(r.irenId === "c2", `stage 4's step is pinned to c2 but roster slot 1 is ${r.irenId}`);
  assert(r.selectedForGive === 1, `the selection verb landed on ${r.selectedForGive}, not IREN`);
  assert(r.hands, "giving an item to IREN did not complete stage 4");
  assert(String(r.askIds) === "c3,c4", `stage 6's step is pinned to c3/c4 but slots 2-3 are ${r.askIds}`);
  assert(!r.askAfterOne, "one check-in completed stage 6 — it is meant to need both");
  assert(r.ask, "checking in on both did not complete stage 6 — the two-answer tally did not survive the frame");
  assert(r.leadUnder, "stage 7 did not put the lead under — the lie cannot happen");
  assert(r.phantoms > 0, "stage 7 put the lead under but percept seeded no phantom to find");
  assert(/survey/i.test(r.liePrompt), `stage 7's prompt at the phantom was "${r.liePrompt}"`);
  assert(r.lie, "logging the phantom did not complete stage 7");
  assert(r.badLogs >= 1, "stage 7 completed without a false entry actually reaching the record");
  notes.push(`stages 3/4/6/7 complete · stage 7 left ${r.badLogs} false entr${r.badLogs === 1 ? "y" : "ies"}`);
}

// --- the meter never reaches the screen -------------------------------------
{
  const leaked = await page.evaluate(() => {
    const words = ["lucidity", "sanity", "hallucinat", "steady", "unsettled", "fraying", "brittle"];
    const hud = document.getElementById("hudLayer")?.innerText?.toLowerCase() || "";
    return words.filter((w) => hud.includes(w));
  });
  assert(leaked.length === 0, `the HUD showed the hidden meter during a stage: ${leaked.join(", ")}`);
}

// --- progress persists --------------------------------------------------------
{
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mirage:settings") || "{}"));
  assert(Array.isArray(stored.tutorial?.done), "tutorial progress is not in the settings payload");
  assert(stored.tutorial.done.length >= 2, `only ${stored.tutorial?.done?.length} stages recorded as done`);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert(keys.length <= 2, `a third localStorage key appeared: ${keys.join(", ")} (dog#E64)`);
}

assert(consoleErrors.length === 0, `page errors: ${consoleErrors.slice(0, 3).join(" | ")}`);

await browser.close();
server.close();
for (const n of notes) console.log("  · " + n);
if (failures.length) {
  console.log("\nTUTORIAL PLAY FAILED:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("tutorial play: OK — stages start, steps fire, the meter stays hidden");
