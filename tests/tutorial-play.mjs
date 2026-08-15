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
  const done = await page.evaluate(async () => {
    const M = window.__mirage;
    for (let i = 0; i < 200; i++) {
      M.advance(0.1, { move: { x: 0, z: -1 }, run: true });
      if (M.tutorialDone().includes("walk-in")) return true;
    }
    return false;
  });
  assert(done, "walking never completed the movement stage — the step starved");
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
