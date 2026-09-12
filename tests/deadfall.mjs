// deadfall.mjs — the obstacle the day is priced against.
//
// The design note's rule is the load-bearing one: "Nothing is walled off.
// Progress is gated by TIME." So a deadfall is only ever a SHORTCUT closed, and
// the generator may never lay one that cuts the map in two. Going round costs
// distance, cutting costs daylight, and choosing is the mechanic.
//
// Run: node tests/deadfall.mjs

import {
  createRun, gatherTarget, holdTimeFor, deadfallAt, clearDeadfall, recover,
  DEADFALL_HOLD_TIME, DEADFALL_WOOD, GATHER_HOLD_TIME, HALLUCINATION,
} from "../src/state.js";
import { generateWorld, validate, floodFill, DEADFALL_COUNT } from "../src/world.js";
import { createPercept, updatePercept } from "../src/percept.js";
import { serializeRun, deserializeRun } from "../src/save.js";
import { buildCamp } from "../src/camp.js";

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

// THE ONE THAT MATTERS. Everything else here is convenience; this is the design
// rule. A deadfall that seals anything off is a wall, and the design says there
// are none.
check("no deadfall ever walls anything off, across many seeds", () => {
  let stranded = [];
  for (let seed = 1; seed <= 40; seed++) {
    const w = generateWorld(seed);
    const withThem = floodFill(w.blocked, w.camp.cx, w.camp.cz);
    const cleared = Uint8Array.from(w.blocked);
    for (const d of w.deadfalls) for (const c of d.cells) cleared[c.cz * w.grid + c.cx] = 0;
    const withoutThem = floodFill(cleared, w.camp.cx, w.camp.cz);
    const own = new Set(w.deadfalls.flatMap((d) => d.cells.map((c) => c.cz * w.grid + c.cx)));
    for (let i = 0; i < withoutThem.length; i++) {
      if (withoutThem[i] && !withThem[i] && !own.has(i)) { stranded.push(seed); break; }
    }
  }
  eq(stranded.length, 0, `deadfalls sealed ground off on seeds ${stranded.slice(0, 6).join(",")} — that is a wall, and nothing is walled off`);
});

check("a deadfall never buries a feature", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const w = generateWorld(seed);
    const v = validate(w);
    assert(v.ok, `seed ${seed}: ${v.unreachable.join(",")} unreachable — a deadfall landed on something`);
  }
});

check("every basin gets deadfalls; the camp gets the field and none of them", () => {
  for (let seed = 1; seed <= 12; seed++) {
    eq(generateWorld(seed).deadfalls.length, DEADFALL_COUNT, `seed ${seed} did not get its deadfalls`);
  }
  const camp = buildCamp();
  assert(Array.isArray(camp.deadfalls), "the camp is missing the deadfalls field every basin has");
  eq(camp.deadfalls.length, 0, "something is blocking the walk in");
});

check("cutting through costs real time, and far more than a tree", () => {
  const sim = createRun({ seed: 5, difficulty: "standard" });
  const d = sim.deadfalls[0];
  sim.player.x = d.x; sim.player.z = d.z;
  const t = gatherTarget(sim, sim.player);
  eq(t.gatherKind, "deadfall", "standing at a deadfall, the verb offered something else");
  eq(holdTimeFor(t), DEADFALL_HOLD_TIME, "the deadfall hold is not its own time");
  assert(DEADFALL_HOLD_TIME > GATHER_HOLD_TIME * 10, "cutting through is not meaningfully more expensive than a chop");
});

check("cutting through opens the ground and pays in timber", () => {
  const sim = createRun({ seed: 5, difficulty: "standard" });
  const d = sim.deadfalls[0];
  const grid = sim.world.grid;
  const i = d.cells[0].cz * grid + d.cells[0].cx;
  eq(sim.world.blocked[i], 1, "the deadfall was not blocking anything to begin with");
  sim.player.x = d.x; sim.player.z = d.z;
  const before = sim.wood;
  assert(clearDeadfall(sim).ok, "could not cut through a deadfall stood right at");
  eq(sim.world.blocked[i], 0, "cutting through did not open the way");
  eq(sim.wood, before + DEADFALL_WOOD, "cutting through paid nothing");
  eq(deadfallAt(sim, sim.player), null, "a cleared deadfall is still offered");
});

check("timber cut by a hallucinating pair of hands is not timber", () => {
  const sim = createRun({ seed: 5, difficulty: "standard" });
  const percept = createPercept(sim.player);
  const d = sim.deadfalls[0];
  sim.player.x = d.x; sim.player.z = d.z;
  sim.player.lucidity = 8;
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.FALSE_ANCHOR;
  const before = sim.wood;
  clearDeadfall(sim);
  eq(sim.wood, before, "wood cut while under entered the true count");
  updatePercept(percept, sim, 0.1);
  eq(percept.shownWood, before + DEADFALL_WOOD, "the shown count did not move");
  // ...but the ROUTE is real either way. The timber is a lie; the gap is not.
  eq(sim.world.blocked[d.cells[0].cz * sim.world.grid + d.cells[0].cx], 0,
    "a hallucinating crew failed to actually open the way — the world is not what lies");
  recover(sim, sim.player, "test");
  updatePercept(percept, sim, 0.1);
  eq(percept.shownWood, sim.wood, "the count did not reconcile");
});

check("a way cut stays cut across a save", () => {
  const sim = createRun({ seed: 5, difficulty: "standard" });
  const d = sim.deadfalls[1];
  sim.player.x = d.x; sim.player.z = d.z;
  clearDeadfall(sim);
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  const grid = back.world.grid;
  eq(back.deadfalls.find((x) => x.id === d.id).cleared, true, "the cut deadfall came back standing");
  eq(back.world.blocked[d.cells[0].cz * grid + d.cells[0].cx], 0,
    "the world was regenerated from the seed and the way closed again");
  const other = back.deadfalls.find((x) => !x.cleared);
  eq(back.world.blocked[other.cells[0].cz * grid + other.cells[0].cx], 1,
    "an uncleared deadfall came back already open");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  ✗ " + f);
if (failures.length) process.exit(1);
console.log("seven deadfall: OK");
