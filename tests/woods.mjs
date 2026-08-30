// THE WOODS — the scripted day, in the real camp, headless.
// Run: node tests/woods.mjs
//
// The alpha's claim is that a player can catch a fake by asking about a day
// they both lived through. That rests on the day being LIVED: the chronicle has
// to be written from what actually happened in the world, where and when it
// happened, or an account derived from it is not evidence about anything the
// player saw.
//
// So these drive a real run on the real camp map through a real tick loop, and
// assert against the world's own positions. Every guard is negative-controlled.

import assert from "node:assert";
import { createRun, tick, swapOvernight, askAbout } from "../src/state.js";
import { buildCamp, CAMP_SEED } from "../src/camp.js";
import { beginWoodsDay, updateWoodsDay, sleepAtCamp, campPlaces, WITNESS_RADIUS, BEAT_COUNT } from "../src/woods.js";
import { truthFor, divergence } from "../src/chronicle.js";

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`  ok  ${n}`); };

function campRun(seed = CAMP_SEED) {
  const world = buildCamp();
  const sim = createRun({ seed, difficulty: "gentle", level: 1, campaignLength: 1, world });
  sim.noDrain = true;                 // nobody decays while the day is being lived
  for (const c of sim.companions) { c.x = world.camp.x; c.z = world.camp.z; }
  sim.player.x = world.camp.x; sim.player.z = world.camp.z;
  beginWoodsDay(sim, world);
  return { sim, world };
}

/** Live the day out, with the player standing at the fire the whole time. */
function liveIt(sim, { follow = true, world = null } = {}) {
  const events = [];
  for (let i = 0; i < 20000 && !sim.woods.over; i++) {
    if (follow) {
      // The player is present: stand where the beat is.
      const b = sim.woods.beats[sim.woods.at];
      sim.player.x = b.spot.x; sim.player.z = b.spot.z;
    }
    tick(sim, 1 / 30, {});
    const r = updateWoodsDay(sim, 1 / 30);
    // Snapshot WHERE they were at the instant it was recorded. Reading their
    // positions after the day has finished asks a different question — by then
    // they have walked to the next beat.
    if (r) events.push({ ...r, where: [r.beat.subject, r.beat.second].map((id) => {
      const c = sim.companions.find((x) => x.id === id);
      return { id, x: c.x, z: c.z };
    }) });
  }
  return events;
}

console.log("the woods — the day is lived, not read");

test("the camp gives the day real places", () => {
  const { world } = campRun();
  const places = campPlaces(world);
  assert.ok(places.length >= 3, "not enough landmarks to make a day out of");
  for (const p of places) {
    assert.equal(typeof p.key, "string");
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), `${p.key} has no position`);
  }
});

test("a beat is not recorded until it actually happens", () => {
  const { sim } = campRun();
  assert.equal(sim.chronicle.length, 0, "the day was written before it was lived");
  assert.equal(sim.woods.beats.length, BEAT_COUNT);
  tick(sim, 1 / 30, {});
  updateWoodsDay(sim, 1 / 30);
  assert.equal(sim.chronicle.length, 0, "a beat landed on the first frame");
});

test("the day plays out and writes itself as it goes", () => {
  const { sim } = campRun();
  const seen = liveIt(sim);
  assert.equal(sim.woods.over, true, "the day never ended");
  assert.equal(sim.chronicle.length, BEAT_COUNT, `recorded ${sim.chronicle.length} of ${BEAT_COUNT}`);
  assert.equal(sim.woods.missed, 0, "the player missed a beat they were standing on");
  assert.equal(seen.length, BEAT_COUNT);
  // Written where it happened: the people were at the spot, not on their way.
  for (const e of seen) {
    for (const w of e.where) {
      assert.ok(Math.hypot(w.x - e.beat.spot.x, w.z - e.beat.spot.z) < 6,
        `${w.id} was recorded at ${e.beat.spot.key} without being there`);
    }
  }
});

test("scripted people are handed back to the AI afterwards", () => {
  const { sim } = campRun();
  liveIt(sim);
  for (const c of sim.companions) {
    assert.ok(!c.scripted, `${c.name} is still under orders after the day ended`);
  }
});

test("a beat the player walked away from is NOT in their memory", () => {
  const { sim, world } = campRun();
  // Stand a long way off for the whole day.
  const far = { x: world.camp.x + WITNESS_RADIUS * 3, z: world.camp.z + WITNESS_RADIUS * 3 };
  for (let i = 0; i < 20000 && !sim.woods.over; i++) {
    sim.player.x = far.x; sim.player.z = far.z;
    tick(sim, 1 / 30, {});
    updateWoodsDay(sim, 1 / 30);
  }
  assert.equal(sim.woods.over, true);
  assert.equal(sim.chronicle.length, 0, "the day recorded itself with nobody watching");
  assert.equal(sim.woods.missed, BEAT_COUNT, "missed beats were dropped instead of counted");
});

test("NC: without the witness check, the absent player still 'remembers'", () => {
  // Reverted defect: record every beat regardless of where the player is. If
  // the test above passes under that too, it is proving nothing.
  const { sim, world } = campRun();
  const far = { x: world.camp.x + WITNESS_RADIUS * 3, z: world.camp.z + WITNESS_RADIUS * 3 };
  let wouldRecord = 0;
  for (let i = 0; i < 20000 && !sim.woods.over; i++) {
    sim.player.x = far.x; sim.player.z = far.z;
    tick(sim, 1 / 30, {});
    const r = updateWoodsDay(sim, 1 / 30);
    if (r) wouldRecord++;          // the beat DID happen; only witnessing failed
  }
  assert.equal(wouldRecord, BEAT_COUNT,
    "NEGATIVE CONTROL FAILED: the beats did not happen at all, so the witness " +
    "check was never what kept them out of the chronicle");
});

console.log("the woods — the night, and the morning");

test("sleeping takes someone, and says nothing", () => {
  const { sim } = campRun();
  liveIt(sim);
  const before = sim.companions.map((c) => `${c.id}/${c.name}/${c.drain}`);
  sim.events.length = 0;
  const taken = sleepAtCamp(sim);
  assert.ok(taken, "nobody was taken");
  assert.deepEqual(sim.companions.map((c) => `${c.id}/${c.name}/${c.drain}`), before,
    "the roster changed overnight");
  assert.equal(sim.events.length, 0, "the swap announced itself");
});

test("you cannot sleep through a day you have not finished", () => {
  const { sim } = campRun();
  assert.equal(sleepAtCamp(sim), null, "slept before the day was over");
  assert.equal(sim.companions.filter((c) => c.swapped).length, 0);
});

test("the morning: one account is wrong about the day that happened", () => {
  const { sim } = campRun();
  liveIt(sim);
  const taken = sleepAtCamp(sim);
  let odd = [];
  for (const c of sim.companions) {
    if (divergence(askAbout(sim, c.id), truthFor(sim.chronicle, c, sim.companions)).length) {
      odd.push(c.id);
    }
  }
  assert.deepEqual(odd, [taken.id], `expected only ${taken.name} to be wrong, got ${odd}`);
});

console.log(`\n${passed} passed`);
