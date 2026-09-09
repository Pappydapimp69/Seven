// daynight.mjs — the cycle, and what the night costs.
//
// A day is the unit (docs/IDEAS.md). Night raises the rate; a fire holds it
// off. Two things this has to get right and neither is about the numbers:
// the cycle must be a pure function of sim.time (so a resumed run wakes at the
// same hour with nothing saved), and the multipliers must not move a single rng
// draw (so a night is harder, not different).
//
// Run: node tests/daynight.mjs

import {
  createRun, tick, tickLucidity, buildFire, recover,
  DAY_LENGTH, NIGHT_LENGTH, CYCLE_LENGTH, LUCIDITY_GRACE, FIRE_WARMTH, FIRE_COST,
  NIGHT_DRAIN_MULT, dayOf, phaseOf, nightFactor,
} from "../src/state.js";
import { serializeRun, deserializeRun } from "../src/save.js";
import { buildCamp, CAMP_SEED } from "../src/camp.js";

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const run = () => createRun({ seed: 909, difficulty: "standard", level: 1, campaignLength: 1 });

check("daylight is exactly the opening calm — the first thing that bites is nightfall", () => {
  // Written as two literals these drift the first time either is tuned, and the
  // drift is invisible: grace ending mid-afternoon, or a night that costs
  // nothing because the calm is still running.
  eq(DAY_LENGTH, LUCIDITY_GRACE, "the day and the grace window have come apart");
  assert(phaseOf(LUCIDITY_GRACE - 1).night === false, "the calm ends before the day does");
  assert(phaseOf(LUCIDITY_GRACE).night === true, "night does not begin where the calm ends");
});

check("the cycle is a pure function of time, so a resume needs no field", () => {
  const sim = run();
  sim.time = DAY_LENGTH + 40;
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  eq(phaseOf(back.time).night, true, "a run saved at night woke up in daylight");
  eq(dayOf(back.time), dayOf(sim.time), "the day number did not survive");
  const data = serializeRun(sim);
  assert(!("cycle" in data) && !("dayIndex" in data), "the cycle grew a saved field it does not need");
});

check("day numbers advance and the phases tile without a gap", () => {
  eq(dayOf(0), 1, "the run does not start on day one");
  eq(dayOf(CYCLE_LENGTH - 0.001), 1, "day one ended early");
  eq(dayOf(CYCLE_LENGTH), 2, "day two never arrived");
  for (let t = 0; t < CYCLE_LENGTH * 3; t += 7) {
    const p = phaseOf(t);
    assert(p.frac >= 0 && p.frac <= 1, `phase fraction out of range at t=${t}`);
  }
});

check("the night bears down, daylight does not, and the camp never does", () => {
  const sim = run();
  sim.time = 10;
  eq(nightFactor(sim, sim.player), 0, "daylight is bearing down");
  sim.time = DAY_LENGTH + NIGHT_LENGTH / 2;
  assert(nightFactor(sim, sim.player) > 0.9, "the middle of the night barely registers");
  sim.noDrain = true;
  eq(nightFactor(sim, sim.player), 0, "the camp went dark on the player being taught");
});

check("nightfall is ramped, not flicked", () => {
  const sim = run();
  sim.time = DAY_LENGTH + 0.5;
  const first = nightFactor(sim, sim.player);
  sim.time = DAY_LENGTH + NIGHT_LENGTH / 2;
  const middle = nightFactor(sim, sim.player);
  assert(first < middle, "the night arrives at full strength on one tick");
  assert(first > 0, "the first moments of night cost nothing at all");
});

check("a burning fire holds the night off, and only while it burns", () => {
  const sim = run();
  sim.time = DAY_LENGTH + NIGHT_LENGTH / 2;
  sim.wood = FIRE_COST.wood;
  buildFire(sim);
  eq(nightFactor(sim, sim.player), 0, "standing at your own fire, the night still bit");
  sim.fire.fuel = 0;
  assert(nightFactor(sim, sim.player) > 0, "a fire that has gone out still kept the night off");
  sim.fire.fuel = 50;
  sim.player.x = sim.fire.x + FIRE_WARMTH + 6;
  assert(nightFactor(sim, sim.player) > 0, "warmth reached well past its radius");
});

check("the night costs a mind more, and it costs it the same way", () => {
  const sim = run();
  const ch = sim.companions[0];
  ch.lucidity = 80;
  sim.time = 10;                       // daylight, but past nothing — grace is on
  sim.time = LUCIDITY_GRACE + 1;       // day two has not started; this is night one
  assert(phaseOf(sim.time).night, "fixture is not at night");
  const before = ch.lucidity;
  tickLucidity(sim, ch, 1);
  const atNight = before - ch.lucidity;
  ch.lucidity = 80;
  sim.time = CYCLE_LENGTH + 10;        // day two, daylight
  assert(!phaseOf(sim.time).night, "fixture is not in daylight");
  tickLucidity(sim, ch, 1);
  const inDay = 80 - ch.lucidity;
  assert(atNight > inDay, `night (${atNight.toFixed(3)}) is not harder than day (${inDay.toFixed(3)})`);
});

// THE ONE THAT MATTERS FOR DETERMINISM. A night must be HARDER, not DIFFERENT:
// the multipliers scale a rate and a threshold, and touch no draw. If the night
// consumed one extra rng value the whole run would re-phase at every dusk, and
// a resumed run would fork minutes later somewhere else entirely.
check("a night takes exactly as many rng draws as a day", () => {
  const draws = (startTime) => {
    const sim = run();
    sim.time = startTime;
    let n = 0;
    const raw = sim.rng;
    sim.rng = Object.assign(() => { n++; return raw(); }, raw);
    for (const k of ["float", "int", "pick", "chance", "shuffled", "snapshot", "restore"]) sim.rng[k] = raw[k];
    for (let i = 0; i < 30 * 20; i++) tick(sim, 1 / 30);
    return n;
  };
  eq(draws(CYCLE_LENGTH + 10), draws(DAY_LENGTH + 10),
    "a night burns a different number of rng draws than a day — every dusk would re-phase the run");
});

check("the camp runs no cycle at all", () => {
  const world = buildCamp();
  const sim = createRun({ seed: CAMP_SEED, world, difficulty: "gentle", level: 1, campaignLength: 1 });
  sim.noDrain = true;
  sim.time = DAY_LENGTH + NIGHT_LENGTH / 2;
  eq(nightFactor(sim, sim.player), 0, "night fell on the tutorial");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  ✗ " + f);
if (failures.length) process.exit(1);
console.log("seven day/night: OK");
