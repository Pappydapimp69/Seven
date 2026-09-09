// fire.mjs — the fire, and the count that lies about feeding it.
//
// Blueprint 0.19. Two things under test and they are separable: the fire is a
// structure the player ADDS to the world (everything else is taken out of one),
// and below BAND.BRITTLE both the fire and the wood count are fabrications that
// BEHAVE — which is the only reason they are convincing.
//
// Run: node tests/fire.mjs

import {
  createRun, tick, buildFire, feedFire, fireAt, gatherResource, recover,
  FIRE_COST, FIRE_FUEL_MAX, FIRE_BURN_RATE, FIRE_FEED, FIRE_FEED_COST, FIRE_RADIUS,
  BAND, bandOf, HALLUCINATION, GATHER_RADIUS,
} from "../src/state.js";
import { createPercept, updatePercept, notePhantomFeed } from "../src/percept.js";
import { serializeRun, deserializeRun } from "../src/save.js";

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(`${m} — got ${a}, expected ~${b}`); };

const run = (over = {}) => {
  const sim = createRun({ seed: 4242, difficulty: "standard", level: 1, campaignLength: 1, ...over });
  sim.noDrain = true;
  return sim;
};
const advance = (sim, secs) => { for (let i = 0; i < secs * 30; i++) tick(sim, 1 / 30); };

// --- the structure ---------------------------------------------------------
check("a fire is built where you stand, costs true wood, and there is only one", () => {
  const sim = run();
  eq(sim.fire, null, "a fresh run already has a fire");
  eq(buildFire(sim).ok, false, "built a fire with no wood");
  sim.wood = FIRE_COST.wood;
  sim.player.x = 12.5; sim.player.z = -7.25;
  assert(buildFire(sim).ok, "could not build a fire with exactly the cost in hand");
  eq(sim.wood, 0, "building did not spend the wood");
  eq(sim.fire.x, 12.5, "the fire is not where the player stood");
  eq(sim.fire.z, -7.25, "the fire is not where the player stood");
  eq(sim.fire.fuel, FIRE_FUEL_MAX, "a new fire did not start full");
  sim.wood = 99;
  eq(buildFire(sim).ok, false, "built a second fire in the same basin");
});

check("a fire burns down on its own and goes out", () => {
  const sim = run();
  sim.wood = FIRE_COST.wood;
  buildFire(sim);
  advance(sim, 10);
  near(sim.fire.fuel, FIRE_FUEL_MAX - FIRE_BURN_RATE * 10, 0.5, "fuel did not burn at the stated rate");
  sim.fire.fuel = 1;
  advance(sim, 10);
  eq(sim.fire.fuel, 0, "the fire did not go out");
  assert(sim.fire !== null, "a spent fire was deleted — it is still the place you built it");
});

check("feeding a real fire costs wood and banks fuel; range is enforced", () => {
  const sim = run();
  sim.wood = FIRE_COST.wood + 2;
  buildFire(sim);
  sim.fire.fuel = 10;
  const before = sim.wood;
  assert(feedFire(sim).fed === true, "feeding the fire you are standing on did not land");
  eq(sim.wood, before - FIRE_FEED_COST, "feeding did not spend wood");
  near(sim.fire.fuel, 10 + FIRE_FEED, 0.01, "feeding did not bank fuel");
  sim.player.x = sim.fire.x + FIRE_RADIUS + 5;
  eq(fireAt(sim), null, "a fire out of reach is still offered");
  eq(feedFire(sim).fed, false, "fed a fire from out of range");
});

// --- the lie ---------------------------------------------------------------
const brittle = (sim) => {
  sim.player.lucidity = 8;             // BAND.BRITTLE is < 14
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.FALSE_ANCHOR;
  eq(bandOf(sim.player.lucidity), BAND.BRITTLE, "fixture is not actually brittle");
};

check("a far-gone mind with no fire is shown one, and it behaves", () => {
  const sim = run();
  const percept = createPercept(sim.player);
  updatePercept(percept, sim, 0.1);
  eq(percept.shownFire, null, "a lucid mind with no fire was shown one");

  brittle(sim);
  updatePercept(percept, sim, 0.1);
  assert(percept.shownFire, "a brittle mind with no fire was shown nothing");
  assert(percept.phantomFire, "the shown fire is not marked as fabricated");
  eq(sim.fire, null, "the sim grew a fire it should not have");

  const before = percept.shownFire.fuel;
  for (let i = 0; i < 30 * 10; i++) updatePercept(percept, sim, 1 / 30);
  near(percept.shownFire.fuel, before - FIRE_BURN_RATE * 10, 0.5,
    "the fabricated fire does not burn down like a real one — it would never ask to be fed");
});

check("feeding the fire that is not there spends real wood and does nothing", () => {
  const sim = run();
  const percept = createPercept(sim.player);
  brittle(sim);
  updatePercept(percept, sim, 0.1);
  sim.wood = 5;
  const res = feedFire(sim);
  eq(res.ok, true, "the feed was refused, which is itself a tell");
  eq(res.fed, false, "the sim banked fuel into a fire that does not exist");
  eq(sim.wood, 5 - FIRE_FEED_COST, "feeding nothing did not spend real wood");
  eq(sim.fire, null, "feeding created a fire");
  // ...and the fabrication accepts it, because a fire that ignored being fed
  // would be visible as a lie.
  const before = percept.shownFire.fuel;
  notePhantomFeed(percept);
  near(percept.shownFire.fuel, Math.min(FIRE_FUEL_MAX, before + FIRE_FEED), 0.01,
    "the fabricated fire did not take the fuel — the player would see it ignore them");
});

check("a real live fire is never replaced by a fabrication, however far gone", () => {
  const sim = run();
  sim.wood = FIRE_COST.wood;
  buildFire(sim);
  const percept = createPercept(sim.player);
  brittle(sim);
  updatePercept(percept, sim, 0.1);
  eq(percept.phantomFire, null, "fabricated a fire on top of a real burning one");
  eq(percept.shownFire, sim.fire, "shown the wrong fire while one was actually burning");
});

check("a DEAD fire looks live to a far-gone mind, in the place it was built", () => {
  const sim = run();
  sim.wood = FIRE_COST.wood;
  sim.player.x = -20; sim.player.z = 33;
  buildFire(sim);
  sim.fire.fuel = 0;
  sim.player.x = -19; sim.player.z = 33;
  const percept = createPercept(sim.player);
  brittle(sim);
  updatePercept(percept, sim, 0.1);
  assert(percept.phantomFire, "a brittle mind saw its dead fire as dead");
  eq(percept.phantomFire.x, -20, "the fabricated fire is not where the real one was built");
  assert(percept.shownFire.fuel > 0, "the fabricated fire is shown already out");
});

// --- the count -------------------------------------------------------------
check("wood cut while under is shown but never banked, and reconciles on recovery", () => {
  const sim = run();
  const percept = createPercept(sim.player);
  const tree = sim.trees[0];
  tree.discovered = true;
  sim.player.x = tree.x; sim.player.z = tree.z;
  assert(Math.hypot(tree.x - sim.player.x, tree.z - sim.player.z) <= GATHER_RADIUS, "fixture is not in reach");

  brittle(sim);
  const trueBefore = sim.wood;
  const got = gatherResource(sim);
  assert(got.ok && got.amount > 0, "the chop did not land");
  eq(sim.wood, trueBefore, "wood cut by a hallucinating pair of hands entered the true count");
  updatePercept(percept, sim, 0.1);
  eq(percept.shownWood, trueBefore + got.amount, "the shown count did not move — the HUD would give it away for free");

  recover(sim, sim.player, "test");
  updatePercept(percept, sim, 0.1);
  eq(percept.shownWood, sim.wood, "the count did not reconcile on recovery");
});

check("feeding lowers shown and true together, so the arithmetic stays consistent", () => {
  const sim = run();
  const percept = createPercept(sim.player);
  sim.wood = 4;
  brittle(sim);
  sim.player.phantomWood = 3;
  updatePercept(percept, sim, 0.1);
  eq(percept.shownWood, 7, "shown wood is not true + phantom");
  feedFire(sim);
  updatePercept(percept, sim, 0.1);
  eq(sim.wood, 4 - FIRE_FEED_COST, "true wood did not fall");
  eq(percept.shownWood, 7 - FIRE_FEED_COST, "shown wood did not fall with it — the gap must not widen on a spend");
});

// --- it has to survive a resume -------------------------------------------
check("the fire and the false count survive a save", () => {
  const sim = run();
  sim.wood = FIRE_COST.wood;
  sim.player.x = 5; sim.player.z = -5;
  buildFire(sim);
  sim.fire.fuel = 42;
  sim.player.phantomWood = 6;
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  assert(back.fire, "the built fire did not survive the save — the player wakes beside cold ground");
  eq(back.fire.x, 5, "the fire moved across a save");
  eq(back.fire.fuel, 42, "the fire's fuel did not survive");
  eq(back.party.find((c) => c.isPlayer).phantomWood, 6, "the false count did not survive");
  const p = createPercept(back.player);
  updatePercept(p, back, 0.1);
  assert(Number.isFinite(p.shownWood), "shown wood came back NaN after a resume");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  ✗ " + f);
if (failures.length) process.exit(1);
console.log("seven fire: OK");
