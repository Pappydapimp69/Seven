// seven-bot.mjs — a whole Seven run, played by a sensible bot, many seeds.
//
// Nobody has played the woods end to end, and its numbers (drain scale, the
// 30 s game hour, 16 chops a deadfall, the 0.45 nightly loss) were each set
// alone. This plays the REAL game in a real page — the same step(), the same
// panels' functions, the same tasks — and reports what a run looks like:
// days to the edge, who was lost, who came back, who went home.
//
// The bot is a good player, not a perfect one: it plans a sensible day, stocks
// the fire, follows a real call (it reads where the missing stand, standing in
// for a player who followed the bearing), keeps the right one at the fire with
// MEMORY_ODDS (Brain: comparing two accounts locates the bent fact, memory
// decides, 0.633 measured), and lights the home pylons in an order it cannot
// see past. It reports; it asserts only that runs finish without errors.
//
// Run: node tests/seven-bot.mjs [seeds=8] [maxDays=14]   → also writes
//      tests/sandbox/seven-bot.json for the pictogram.

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const SEEDS = Number(process.argv[2] || 8);
const MAX_DAYS = Number(process.argv[3] || 14);
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const server = createServer(async (q, r) => {
  const u = (q.url || "/").split("?")[0];
  try { const b = await readFile(path.join(ROOT, u === "/" ? "index.html" : u)); r.writeHead(200, { "Content-Type": T[path.extname(u)] || "application/octet-stream" }); r.end(b); }
  catch { r.writeHead(404); r.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => !!window.__seven, null, { timeout: 20000 });

const results = [];
for (let i = 0; i < SEEDS; i++) {
  const seed = 1000 + i * 37;
  const r = await page.evaluate(async ({ seed, MAX_DAYS }) => {
    const v = window.__seven.build;
    const W = await import(`/src/world.js?v=${v}`);
    const TR = await import(`/src/trail.js?v=${v}`);
    const S = await import(`/src/state.js?v=${v}`);
    const M = window.__seven;
    M.headless = true;
    M.startSeven({ seed });
    const sim = M.sim, e = sim.expedition, world = sim.world, G = world.grid;
    let rs = seed >>> 0;
    const rand = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
    const MEMORY_ODDS = 0.65;
    const log = { calls: 0, found: 0, keptReal: 0, keptFake: 0, chops: 0, campsMoved: 0, fireNights: 0, coldNights: 0 };
    const SLICE = 0.1;
    const step = (interact = false) => M.advance(SLICE, { interact }, SLICE);
    const clock = () => S.sevenClock(sim.time);
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    // Walk the lead along a real route at walking pace; time passes as it would.
    function walkTo(target, budgetHours = 6) {
      const from = W.worldToCell(sim.player.x, sim.player.z, G), to = W.worldToCell(target.x, target.z, G);
      const cells = W.findPath(world, { cx: from.cx, cz: from.cz }, { cx: to.cx, cz: to.cz }) || [];
      const pts = cells.map((c) => W.cellToWorld(c.cx, c.cz, G)).concat([target]);
      const t0 = sim.time;
      for (const p of pts) {
        while (dist(sim.player, p) > 0.6) {
          if (sim.status !== "playing" || M.planOpen || M.twin || sim.time - t0 > budgetHours * S.GAME_HOUR) return false;
          const d = dist(sim.player, p), sp = Math.min(d, 4.3 * SLICE);
          sim.player.x += ((p.x - sim.player.x) / d) * sp; sim.player.z += ((p.z - sim.player.z) / d) * sp;
          step();
        }
      }
      return true;
    }
    function handlePanels() {
      if (M.planOpen === "dawn") {
        const ranked = [...sim.companions].sort((a, b) => ((b.skills?.cut || 0) - (a.skills?.cut || 0)));
        const ch = {};
        ranked.forEach((c, k) => { ch[c.id] = k < 3 ? "chop" : k === 3 ? "gather" : "camp"; });
        M.plan(ch);
      } else if (M.planOpen === "dusk") {
        const ch = {};
        sim.companions.forEach((c, k) => { ch[c.id] = k === 0 ? "watch" : "sleep"; });
        M.plan(ch);
      }
      const tw = M.twin;
      if (tw) {
        const right = rand() < MEMORY_ODDS;
        const left = right ? tw.realLeft : !tw.realLeft;
        if (left === tw.realLeft) log.keptReal++; else log.keptFake++;
        M.chooseTwin(left);
      }
    }
    const openDeadfall = () => (sim.deadfalls || []).filter((d) => !d.cleared).sort((a, b) => dist(a, sim.camp) - dist(b, sim.camp))[0];
    const areaOf = (p) => TR.areaOfRow(W.worldToCell(p.x, p.z, G).cz);
    function stockFire() {
      walkTo(sim.camp, 3);
      if (!sim.fire || sim.fire.fuel <= 0) M.act("survey");
      for (let k = 0; k < 10 && sim.fire && sim.fire.fuel < 90 && (sim.camp.pile || 0) > 0; k++) M.act("survey");
      if (sim.fire && sim.fire.fuel > 60) log.fireNights++; else log.coldNights++;
    }
    let guard = 0;
    while (sim.status === "playing" && e.day <= MAX_DAYS && guard++ < 4000) {
      handlePanels();
      if (sim.status !== "playing") break;
      const c = clock();
      // Dusk: home, fire stocked, sleep to dawn.
      if (c.night || c.hoursToDusk < 1.2) {
        if (sim.camp.built) stockFire();
        handlePanels();
        M.rest();
        let n = 0; while (e.sleeping && n++ < 20000 && sim.status === "playing") step();
        handlePanels();
        continue;
      }
      // A real call: go and get them while there is light (bot reads the spot).
      const miss = (e.missing || []).find((m) => !m.recovered && !m.abandoned && m.x != null);
      if (miss && !sim.found && c.hoursToDusk > 3) {
        log.calls++;
        if (walkTo(miss, 4) && sim.found) { log.found++; walkTo(sim.camp, 4); for (let k = 0; k < 20; k++) step(); handlePanels(); }
        continue;
      }
      // The deadfall nearest camp: chop it with the choppers.
      const d = openDeadfall();
      if (d && areaOf(d) <= areaOf(sim.camp) + 1) {
        const row = d.cz + 1, tx = world.trail.trailX[row];
        walkTo(W.cellToWorld(tx, row, G), 3);
        const before = d.progress || 0;
        for (let k = 0; k < 400 && !d.cleared && !clock().night && clock().hoursToDusk > 1.2; k++) step(true);
        if ((d.progress || 0) > before || d.cleared) log.chops++;
        continue;
      }
      // Way open: carry the camp forward one area.
      if (sim.camp.built) { walkTo(sim.camp, 3); M.campAction(); for (let k = 0; k < 600 && e.lapse > 0; k++) step(); }
      const next = Math.min(TR.TRAIL_AREAS - 1, areaOf(sim.player) + 1);
      const rows = TR.areaRows(next), row = rows.south - 3;
      const tx = world.trail.trailX[row];
      if (next === TR.TRAIL_AREAS - 1 && areaOf(sim.player) === next) {
        // Last area: walk to the edge.
        walkTo(W.cellToWorld(world.trail.trailX[2], 1, G), 8);
        for (let k = 0; k < 20; k++) step();
        break;
      }
      walkTo(W.cellToWorld(tx, row, G), 5);
      M.campAction(); log.campsMoved++;
      for (let k = 0; k < 900 && e.lapse > 0; k++) step();
    }
    // The edge: light the home pylons in an order the bot cannot see past.
    if (sim.status === "decision" && sim.homeward) {
      const order = [...sim.companions].sort(() => rand() - 0.5);
      for (const c of order) { if (sim.status !== "decision") break; M.lightWith(c.id); }
    }
    const minLuc = Math.min(...sim.party.map((p) => p.lucidity));
    const fd = sim.finalDecision || {};
    return {
      seed, status: sim.status, ending: sim.ending || (sim.status === "playing" ? "stuck" : sim.status),
      day: e.day, area: (e.hereArea ?? 0) + 1,
      missing: (e.missing || []).length, recovered: (e.missing || []).filter((m) => m.recovered).length,
      abandoned: (e.missing || []).filter((m) => m.abandoned).length,
      fakesHeld: sim.companions.filter((c) => c.replacedDay != null).length,
      saved: fd.saved ?? null, leftBehind: fd.leftBehind ?? null,
      deadfallsCleared: (sim.deadfalls || []).filter((d) => d.cleared).length, deadfalls: (sim.deadfalls || []).length,
      minLucidity: Math.round(minLuc), ...log,
    };
  }, { seed, MAX_DAYS });
  results.push(r);
  console.log(JSON.stringify(r));
}
await mkdir(path.join(ROOT, "tests", "sandbox"), { recursive: true });
await writeFile(path.join(ROOT, "tests", "sandbox", "seven-bot.json"), JSON.stringify({ when: new Date().toISOString(), maxDays: MAX_DAYS, results }, null, 1));
await browser.close(); server.close();
if (errs.length) { console.log("SEVEN BOT: page errors:\n  " + errs.join("\n  ")); process.exit(1); }
console.log(`seven bot: ${results.length} runs — ${results.filter((x) => x.ending === "home").length} home, ${results.filter((x) => x.ending === "alone").length} alone, ${results.filter((x) => x.ending === "dissolved").length} dissolved, ${results.filter((x) => x.ending === "stuck").length} still in the woods at day ${MAX_DAYS}`);
process.exit(0);
