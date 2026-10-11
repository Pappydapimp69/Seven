// rescue.mjs — the missing are out in the woods, a call gives a direction, only
// the lead finds them, and the one brought home stands beside the one who never left.
import { createRun } from "../src/state.js";
import { createExpedition, recordFact, sleep, resolveNight, placeMissing, twinAccounts, resolveTwin, activeMystery, accuseMystery, proveMystery, advanceArea } from "../src/expedition.js";
import { generateTrail, areaOfRow } from "../src/trail.js";
import { worldToCell } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { dawnCalls, callLoudness, CALL_FLOOR, FALSE_CALL_RATE, missingSpot, checkFound, stepFound, bearingWord, FIND_RADIUS } from "../src/seven.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const PARTY = ["c1", "c2", "c3", "c4", "c5"];

function disappeared(seed = 3) {
  const e = createExpedition({ day: 2, replacementChance: 1 });
  recordFact(e, { kind: "deadfall", actor: "c3", object: "deadfall", withWhom: ["c2"] });
  recordFact(e, { kind: "camp", actor: "c1", object: "camp", withWhom: [] });
  sleep(e);
  const r = resolveNight(e, makeRng(seed), PARTY);
  return { e, id: r.missing.id };
}

check("a missing one is placed on open ground in their area, away from camp, the same way every time", () => {
  const w = generateTrail(9);
  const a = missingSpot(w, 1, w.camp, 0.37), b = missingSpot(w, 1, w.camp, 0.37);
  assert(a && a.x === b.x && a.z === b.z, "placement is not deterministic");
  const cell = worldToCell(a.x, a.z, w.grid);
  assert(!w.blocked[cell.cz * w.grid + cell.cx], "placed inside the forest");
  assert(areaOfRow(cell.cz) === 1, `placed in area ${areaOfRow(cell.cz)}, not 1`);
  assert(Math.hypot(a.x - w.camp.x, a.z - w.camp.z) >= 15, "placed on the camp's doorstep");
});
check("the real call points at them and keeps its bearing from dawn to dawn", () => {
  const { e, id } = disappeared();
  const camp = { x: 0, z: 0 };
  placeMissing(e, id, 30, -30);              // north-east of camp
  const first = dawnCalls(e, camp, 0.99, 0.9).filter((c) => c.real);
  e.missing[0].nights = 3;
  const later = dawnCalls(e, camp, 0.99, 0.9).filter((c) => c.real);
  assert(first.length === 1 && first[0].bearing === "north-east", `bearing ${first[0] && first[0].bearing}`);
  assert(later[0].bearing === first[0].bearing, "the bearing wandered");
  assert(later[0].loud < first[0].loud, "the call did not fade");
});
check("the call fades but never to silence", () => {
  assert(callLoudness(20) === CALL_FLOOR && CALL_FLOOR > 0, "the call went silent");
});
check("a call can come when nobody is missing, so a call is not an announcement", () => {
  const e = createExpedition({ day: 3 });
  const calls = dawnCalls(e, { x: 0, z: 0 }, FALSE_CALL_RATE / 2, 0.2);
  assert(calls.length === 1 && !calls[0].real, "no false call on a morning nobody went");
  assert(dawnCalls(e, { x: 0, z: 0 }, 0.99, 0.2).length === 0, "a false call came above its rate");
});
check("only walking up to them finds them, and they walk home with you", () => {
  const w = generateTrail(9);
  const sim = createRun({ seed: 9, world: w });
  sim.expedition = createExpedition({ day: 2 });
  sim.expedition.missing.push({ id: "c2", recovered: false, abandoned: false, x: sim.player.x + 20, z: sim.player.z });
  assert(checkFound(sim) === null, "found from twenty metres");
  sim.player.x += 20 - FIND_RADIUS + 0.5;
  const m = checkFound(sim);
  assert(m && m.id === "c2", "not found when standing at them");
  // On the camp clearing, where a body can walk.
  sim.player.x = w.camp.x; sim.player.z = w.camp.z;
  sim.found = { id: "c2", x: w.camp.x, z: w.camp.z - 9 };
  const before = Math.hypot(sim.found.x - sim.player.x, sim.found.z - sim.player.z);
  for (let i = 0; i < 30; i++) stepFound(sim, 0.1);
  assert(Math.hypot(sim.found.x - sim.player.x, sim.found.z - sim.player.z) < before, "the found one did not follow");
});
check("two at the fire tell the same day differently — one fact bent", () => {
  const { e, id } = disappeared();
  const acc = twinAccounts(e, id);
  assert(acc && acc.real.length && acc.fake.length, "no accounts");
  assert(JSON.stringify(acc.real) !== JSON.stringify(acc.fake), "the two accounts are identical: nothing to catch");
});
check("keeping the real one brings them home; keeping the other loses them for good", () => {
  const a = disappeared();
  assert(resolveTwin(a.e, a.id, true) && a.e.missing[0].recovered, "keeping the real one did not recover them");
  const b = disappeared();
  assert(resolveTwin(b.e, b.id, false) && b.e.missing[0].abandoned && b.e.missing[0].sentAway, "keeping the fake did not lose the real one");
  assert(activeMystery(b.e) === null, "the mystery stayed open after the real one was sent away");
});
check("proving the fake at a pylon exposes it but brings nobody home", () => {
  const { e, id } = disappeared();
  accuseMystery(e, id);
  const v = proveMystery(e);
  const m = e.mysteries[0];
  assert(v.correct && m.exposed && !m.searchReady, "a correct proof did not expose, or unlocked an instant search");
  assert(!e.missing[0].recovered, "a correct proof brought the missing one home");
});
check("moving camp two areas on abandons them", () => {
  const { e } = disappeared();
  const m = e.missing[0];
  advanceArea(e, m.recoverByArea - e.area);
  assert(!m.abandoned, "abandoned inside the window");
  advanceArea(e, 1);
  assert(m.abandoned, "still recoverable past the window");
});

if (failures.length) { console.log(`rescue: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`rescue: ${passed} passed`);
