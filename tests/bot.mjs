// bot.mjs — whole runs of the real sim, played by a sensible bot. Pure node.
//
// It plans the day, chops the deadfall with the choppers, stocks the fire,
// moves camp forward when the way is open, follows a real call (it reads where
// the missing one stands, standing in for a player who followed the bearing),
// keeps the right one at the fire with MEMORY_ODDS, and lights the home pylons
// in an order it cannot see past. Asserts only that every run ENDS — home,
// alone or lost — without an exception and without stalling.
//
// Run: node tests/bot.mjs [seeds=10] [maxDays=16]   (--json for the raw rows)

import { S, walk, finish, chopSpot, campSpotIn, assert } from "./lib.mjs";
import { areaOfRow, deadfallRow } from "../src/world.js";
import { createRng } from "../src/rng.js";
import { EXIT_ROWS, AREAS } from "../src/config.js";

const NUMS = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const SEEDS = NUMS[0] || 10, MAX_DAYS = NUMS[1] || 16;
const MEMORY_ODDS = 0.65;

export function playRun(seed) {
  const sim = S.createSim({ seed });
  const rand = createRng(seed ^ 0xabcdef).next;
  const log = { lieDay: 0, lieArea: 0, deadFireDay: 0, fireNights: 0, coldNights: 0, campsMoved: 0, calls: 0, found: 0, keptReal: 0, keptFake: 0 };
  const panels = (s) => {
    if (s.pending === "dawn") {
      const ranked = [...s.mates].sort((a, b) => (b.skills.cut || 0) - (a.skills.cut || 0));
      const ch = {}; ranked.forEach((m, k) => { ch[m.id] = k < 3 ? "chop" : k < 5 ? "gather" : "camp"; });
      S.applyPlan(s, "dawn", ch);
    } else if (s.pending === "dusk") {
      const ch = {}; s.mates.forEach((m, k) => { ch[m.id] = k === 0 ? "watch" : "sleep"; });
      S.applyPlan(s, "dusk", ch);
    } else if (s.pending === "twin") {
      const t = S.twinAccounts(s), right = rand() < MEMORY_ODDS;
      const left = right ? t.realLeft : !t.realLeft;
      if (left === t.realLeft) log.keptReal++; else log.keptFake++;
      S.keepTwin(s, left);
    } else if (s.pending === "home") {
      // Wait for whoever is walking behind, then light.
      S.turnBack(s);
      for (let k = 0; k < 600 && s.status === "playing" && !s.pending; k++) S.tick(s, {});
      if (s.pending) return;
      const order = S.homeCandidates(s).sort(() => rand() - 0.5);
      for (const c of order) { if (s.status !== "playing") break; S.lightHome(s, c.id); }
      if (s.status === "playing") S.finishRun(s);
    }
  };
  const opts = { onPending: panels, maxTicks: 30000 };
  const campArea = () => areaOfRow(Math.floor(sim.camp.y));
  let guard = 0, triedDay = 0, calledHome = false;
  while (sim.status === "playing" && sim.day <= MAX_DAYS && guard++ < 3000) {
    if (sim.pending) { panels(sim); continue; }
    if (sim.lead.lucidity < 40 && !log.lieDay) { log.lieDay = sim.day; log.lieArea = campArea() + 1; }
    if (sim.lead.lucidity < 25 && !log.deadFireDay) log.deadFireDay = sim.day;
    if (!sim.camp.built && guard === 1) { S.campAction(sim); finish(sim, panels); continue; }
    const left = S.lightLeft(sim);
    // Dusk: home, fire stocked, sleep through.
    if (left < 130) {
      if (sim.camp.built) {
        walk(sim, sim.camp.x, sim.camp.y + 0.5, opts);
        if (sim.camp.fire <= 0) { S.fireAction(sim); finish(sim, panels); }
        for (let k = 0; k < 12 && sim.camp.fire > 0 && sim.camp.fire < 11 && sim.camp.pile > 0; k++) { S.fireAction(sim); finish(sim, panels); }
        if (sim.camp.fire >= 8) log.fireNights++; else log.coldNights++;
      }
      for (let k = 0; k < 5000 && sim.pending; k++) panels(sim);
      S.rest(sim); finish(sim, panels);
      continue;
    }
    // A real call: go and get them while there is light.
    const ms = sim.missing;
    if (ms && !ms.found && left > 240 && triedDay !== sim.day) {
      triedDay = sim.day;
      log.calls++;
      if (walk(sim, ms.x, ms.y, opts) && sim.missing && sim.missing.found) {
        log.found++;
        if (sim.camp.built) walk(sim, sim.camp.x, sim.camp.y, opts);
        for (let k = 0; k < 50 && sim.status === "playing"; k++) { if (sim.pending) panels(sim); else S.tick(sim, {}); }
      }
      continue;
    }
    // The far side.
    if (campArea() === AREAS - 1 || !sim.world.deadfalls.some((d) => !d.cleared) && campArea() >= AREAS - 2) {
      const y = EXIT_ROWS - 1;
      if (sim.camp.built && !calledHome) { walk(sim, sim.camp.x, sim.camp.y, opts); S.callOut(sim); calledHome = true; }
      walk(sim, sim.world.trailX[y] + 0.5, y + 0.5, opts);
      for (let k = 0; k < 10 && sim.status === "playing"; k++) { if (sim.pending) panels(sim); else S.tick(sim, {}); }
      if (sim.status === "playing" && Math.floor(sim.lead.y) <= EXIT_ROWS) S.finishRun(sim);
      continue;
    }
    const d = S.frontDeadfall(sim);
    // The deadfall in this area: chop it, alongside the choppers.
    if (d && d.area <= campArea()) {
      const sp = chopSpot(sim, d);
      if (!walk(sim, sp.x, sp.y, opts)) { S.rest(sim); finish(sim, panels); continue; }
      for (let k = 0; k < 40 && !d.cleared && S.lightLeft(sim) > 120 && sim.status === "playing"; k++) {
        if (sim.pending) { panels(sim); continue; }
        S.act(sim); finish(sim, panels);
      }
      continue;
    }
    // The way is open: carry camp forward an area, if the day allows it.
    if (left > 300) {
      if (sim.camp.built) {
        walk(sim, sim.camp.x, sim.camp.y, opts); S.campAction(sim); finish(sim, panels);
        // The woodpile stays where it is: carry it, by walking onto it.
        for (const p of sim.piles.slice()) { walk(sim, p.x, p.y - 2, opts); walk(sim, p.x, p.y, opts); }
      }
      const next = Math.min(AREAS - 1, campArea() + 1);
      const sp = campSpotIn(sim, next);
      walk(sim, sp.x, sp.y, opts);
      S.campAction(sim); finish(sim, panels); log.campsMoved++;
      continue;
    }
    // Late in the day: fell a tree near camp for the pile, or rest.
    S.rest(sim); finish(sim, panels);
  }
  if (sim.status === "playing") return { seed, ending: "stuck", day: sim.day, area: campArea() + 1, ...log };
  return {
    seed, ending: sim.ending.kind, day: sim.ending.day, area: campArea() + 1,
    saved: sim.ending.saved.length, tried: sim.ending.tried.length, lost: sim.ending.lost.length,
    fakesHeld: sim.mates.filter((m) => m.fake).length, minLuc: Math.round(sim.lead.lucidity), ...log,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < SEEDS; i++) {
    const r = playRun(1000 + i * 37);
    rows.push(r);
    if (process.argv.includes("--json")) console.log(JSON.stringify(r));
  }
  const by = (k) => rows.filter((r) => r.ending === k).length;
  const avg = (k) => (rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length).toFixed(1);
  const lied = rows.filter((r) => r.lieDay);
  console.log(`hallucinations begin (lucidity under 40): ${lied.length}/${rows.length} runs, on day ${lied.length ? (lied.reduce((a, r) => a + r.lieDay, 0) / lied.length).toFixed(1) : "-"} (range ${lied.length ? Math.min(...lied.map((r) => r.lieDay)) + "-" + Math.max(...lied.map((r) => r.lieDay)) : "-"}), in woods ${lied.length ? (lied.reduce((a, r) => a + r.lieArea, 0) / lied.length).toFixed(1) : "-"}`);
  console.log(`bot: ${rows.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s — home ${by("home")}, alone ${by("alone")}, lost ${by("lost")}, stuck ${by("stuck")} · days ${avg("day")} · saved ${avg("saved")} · taken→found ${avg("calls")}/${avg("found")} · cold nights ${avg("coldNights")}`);
  assert(by("stuck") === 0, "a run stalled");
}
void deadfallRow;
