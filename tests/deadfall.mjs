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
import { generateWorld, validate, floodFill, distanceField, DEADFALL_COUNT, DEADFALL_MIN_DETOUR, DISTANCE_BUDGET } from "../src/world.js";
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

// THE CONTRACT THAT REPLACED "REACHABLE AT ANY COST".
// Binary reachability is satisfied by a single winding corridor, so it says
// nothing about price — a map where everything is a long hard walk and one
// where everything is a stroll pass identically. That is why dense ground could
// not survive here, and why obstacles had nothing to block.
check("validate reports what the walk COSTS, not only that it exists", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const v = validate(generateWorld(seed));
    assert(v.ok, `seed ${seed}: ${v.unreachable.join(",")} unreachable`);
    assert(v.withinBudget, `seed ${seed}: ${v.overBudget.map((o) => `${o.id}@${o.cells}`).join(",")} beyond the budget`);
    assert(v.worstDistance > 0, `seed ${seed}: the longest walk measured zero`);
    assert(v.worstDistance <= DISTANCE_BUDGET, `seed ${seed}: worst walk ${v.worstDistance} over budget ${DISTANCE_BUDGET}`);
    eq(typeof v.worstId, "string", `seed ${seed}: the worst walk names nobody`);
  }
});

check("the budget is a weaker contract than reachability, and still subsumes it", () => {
  const w = generateWorld(9);
  // Wall a marker in completely: unreachable is infinite distance, so it has to
  // fail BOTH checks, not just the old one.
  const m = w.monoliths[0];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx || dz) w.blocked[(m.cz + dz) * w.grid + (m.cx + dx)] = 1;
    }
  }
  const v = validate(w);
  assert(!v.ok, "walling a marker in did not break reachability");
  assert(!v.withinBudget, "walling a marker in left it inside the budget — unreachable must never be affordable");
  // ...and a budget tight enough to bite reports the same world as too dear
  // while still calling it connected.
  const w2 = generateWorld(9);
  const tight = validate(w2, { budget: 5 });
  assert(tight.ok, "a tight budget broke reachability, which it must not touch");
  assert(!tight.withinBudget, "a 5-cell budget called a whole basin affordable");
  assert(tight.overBudget.length > 0, "nothing was reported over a 5-cell budget");
});

check("the density pass spends the budget, and only when asked", () => {
  let walkable = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = generateWorld(seed, { dense: true });
    let open = 0;
    for (const b of w.blocked) if (!b) open++;
    walkable += open / (w.grid * w.grid);
  }
  const pct = (walkable / 20) * 100;
  // It was 78% before the budget existed, and at 78% almost nothing was worth
  // walking round. Both bounds matter: too open and obstacles are scenery, too
  // closed and it stops being a basin.
  assert(pct < 72, `dense ground is ${pct.toFixed(0)}% walkable — the density pass is not spending the budget`);
  assert(pct > 50, `dense ground is only ${pct.toFixed(0)}% walkable — that is a maze, not a basin`);

  // ...and the survey basin is NOT dense, deliberately. Density costs the
  // companion drift ("they DO wander off"), measured at 7 of 12 seeds with one
  // round and 5 with two, against a suite that wants 8. The default has to stay
  // open until a map exists that wants the trade.
  let openPct = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = generateWorld(seed);
    let open = 0;
    for (const b of w.blocked) if (!b) open++;
    openPct += open / (w.grid * w.grid);
  }
  assert((openPct / 20) * 100 > 74, "the default basin has quietly become dense — that breaks the lost-drift wander");
});

check("on dense ground a deadfall is worth walking round, or it does not exist", () => {
  let placed = 0, cheap = [];
  for (let seed = 1; seed <= 20; seed++) {
    const w = generateWorld(seed, { dense: true });
    for (const d of w.deadfalls) {
      placed++;
      if (d.detour < DEADFALL_MIN_DETOUR) cheap.push(`${seed}/${d.id}@${d.detour}`);
    }
  }
  eq(cheap.length, 0, `deadfalls that cost nothing to ignore: ${cheap.slice(0, 5).join(",")}`);
  // On the old open basin this was 0.2 per world. An obstacle nobody meets is
  // not an obstacle, so the count is part of the assertion.
  assert(placed / 20 >= 2, `only ${(placed / 20).toFixed(2)} deadfalls per world clear the detour bar — obstacles are not landing`);
});

check("a deadfall never buries a feature", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const w = generateWorld(seed);
    const v = validate(w);
    assert(v.ok, `seed ${seed}: ${v.unreachable.join(",")} unreachable — a deadfall landed on something`);
  }
});

check("basins get deadfalls where the ground allows, and the camp gets none", () => {
  // NOT an exact count any more, and the change is the point. Placement is
  // gated on a real detour now, so a seed whose ground offers few chokepoints
  // gets few deadfalls — and it should. Asserting DEADFALL_COUNT exactly would
  // be asserting that the gate never refuses anything, which would quietly turn
  // the gate off. The floor is per-world, the average is checked separately.
  let total = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const n = generateWorld(seed).deadfalls.length;
    assert(n >= 1, `seed ${seed} got no deadfalls at all`);
    assert(n <= DEADFALL_COUNT, `seed ${seed} got ${n} deadfalls, over the cap of ${DEADFALL_COUNT}`);
    total += n;
  }
  assert(total / 12 >= 2, `only ${(total / 12).toFixed(2)} deadfalls per world`);
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
