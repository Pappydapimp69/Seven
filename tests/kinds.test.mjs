// Perceptual-regression suite for the FOUR hallucination kinds that used to be
// inert: WRONG_WAY, FALSE_ANCHOR, CHORUS and DOUBLED_PARTY.
// Run: node mirage/tests/kinds.test.mjs
//
// Why this file exists.
//
// PHANTOM_MARKER answers the player (its monoliths drift when you sweep the
// camera) and the monster flicker answers the player (it fires on a body you
// are actually looking at). The other four each set ONE value at onset and then
// held it for the rest of the episode: a fixed compass error, a fixed phantom
// pylon, one canned agreement, a sixth body walking a slot nobody ever had.
// Every one of them was CORRECT. Every one of them was also learnable in about
// three seconds and then completely inert — you subtract the compass error and
// carry on, you count the party once and never again.
//
// So this file asks the question tests/hallucination.test.mjs taught us to ask,
// four more times: NOT "does the mechanism fire" but "over a realistic episode,
// at the real rate, with the player doing player things — does anybody
// PERCEIVE it?" And it asks the second half every time, because the answer to
// "make it more noticeable" is not "make it constant": each effect is bounded
// from ABOVE as well as below, so raising a rate to make a floor go green
// breaks a ceiling instead.
//
// The measured numbers quoted in the comments below come from a 40-seed sweep
// over the same drive model used here; the thresholds asserted are set well
// inside them so ordinary seed noise cannot flake the suite.
//
// Same discipline as the rest of the repo: nothing here reads wall-clock time.
// The sim's own clock is driven in fixed slices, and where a test needs an
// exact approach geometry it moves the character itself rather than fighting
// terrain collision — the same thing the monster-flicker tests already do.

import {
  createRun, tick, beginHallucinating, recover, HALLUCINATION, checkIn, BAND,
  CORROBORATE_RADIUS, PYLON_MAX_CHARGE,
} from "../src/state.js";
import {
  createPercept, updatePercept, perceivedYaw, perceivedPylons, perceivedCompanions,
  rosterRead, filterReport, chorusEcho, chorusTier, KIND_TUNING,
} from "../src/percept.js";

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"} — got ${a}, expected ${b}`);
}
function atLeast(a, b, msg) {
  if (!(a >= b)) throw new Error(`${msg || "too low"} — got ${a}, needed >= ${b}`);
}
function atMost(a, b, msg) {
  if (!(a <= b)) throw new Error(`${msg || "too high"} — got ${a}, needed <= ${b}`);
}

const SLICE = 1 / 30;
const SEEDS = 40;
const WALK = 4.3; // the lead's own walk speed (state.js moveHuman)
// The four this file is about. PHANTOM_MARKER is deliberately excluded from
// the shared rules below: its camera-turn drift DOES draw from sim.rng every
// time it reseeds a phantom, which is correct and already covered by
// logic.test.mjs — it just isn't the discipline being asserted here.
const REACTIVE_FOUR = [
  HALLUCINATION.WRONG_WAY, HALLUCINATION.FALSE_ANCHOR,
  HALLUCINATION.CHORUS, HALLUCINATION.DOUBLED_PARTY,
];

/** Past the orientation window, so nothing under test is masked by grace. */
function liveRun(seed) {
  const sim = createRun({ seed });
  sim.time = 400;
  return sim;
}

/**
 * Hold the lead under, in a chosen kind, for the whole measurement. Called
 * every tick on purpose: a lead walking a real basin can wander into a live
 * pylon and RECOVER mid-run, and an un-pinned harness reports that as the lie
 * jumping two radians in one frame. (It cost an afternoon the first time.)
 */
function pinUnder(sim, kind) {
  const p = sim.player;
  if (!p.hallucinating) beginHallucinating(sim, p);
  p.lucidity = 0;
  p.hallucinating = true;
  p.hallucination = kind;
  return p;
}

/** hud.js's own compass reduction — eight letters, which is all a player sees. */
function octant(yaw) {
  return ((Math.round((-yaw / (Math.PI * 2)) * 8) % 8) + 8) % 8;
}

/**
 * The repo's established "realistic player under" view model (the same one
 * tests/hallucination.test.mjs playUnder uses, and for the same reason): walk
 * forward about four seconds, stop and turn right around to look at whatever
 * you just heard, hold, turn back, walk on. A player who only spins on the
 * spot, or only ever walks in a straight line, is not a player.
 */
function drive(t, baseYaw) {
  const phase = t % 9;
  if (phase < 4) return { move: { x: -Math.sin(baseYaw), z: -Math.cos(baseYaw) }, yaw: baseYaw };
  if (phase < 5) return { move: { x: 0, z: 0 }, yaw: baseYaw + (phase - 4) * Math.PI };
  if (phase < 8) return { move: { x: 0, z: 0 }, yaw: baseYaw + Math.PI };
  return { move: { x: 0, z: 0 }, yaw: baseYaw + Math.PI + (phase - 8) * Math.PI };
}

// ===========================================================================
// WRONG_WAY — an error that grows while you commit, and settles when you stop
// ===========================================================================

/**
 * Play `seconds` under WRONG_WAY on the drive model, counting what a player
 * could actually witness: not radians, but the COMPASS LETTER changing at a
 * moment when the lead is neither walking nor turning. That is the whole
 * perceivable event, and it is the only thing worth rating.
 */
function compassRun(seed, seconds) {
  const sim = liveRun(seed);
  const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
  const percept = createPercept(p);
  let baseYaw = 0;
  let lastOct = null;
  let lastStill = false;
  let changesWhileStill = 0;
  let biggestCreep = 0; // largest per-tick move of the LIE that was not a settle
  let prevLie = null;
  let lastPos = { x: p.x, z: p.z };
  const start = sim.time;
  while (sim.time - start < seconds) {
    const t = sim.time - start;
    const { move, yaw } = drive(t, baseYaw);
    if (t % 9 >= 9 - SLICE) baseYaw += 0.7; // a new heading each cycle
    for (const c of sim.companions) c.lucidity = 80;
    const yawBefore = p.yaw;
    const snapsBefore = percept.compassSnaps;
    tick(sim, SLICE, { move, yaw });
    pinUnder(sim, HALLUCINATION.WRONG_WAY);
    updatePercept(percept, sim, SLICE);

    const turned = Math.abs(p.yaw - yawBefore);
    const speed = Math.hypot(p.x - lastPos.x, p.z - lastPos.z) / SLICE;
    lastPos = { x: p.x, z: p.z };
    const lie = perceivedYaw(percept, sim) - p.yaw;
    const settled = percept.compassSnaps !== snapsBefore;
    if (prevLie !== null && !settled) biggestCreep = Math.max(biggestCreep, Math.abs(lie - prevLie));
    prevLie = lie;
    const o = octant(perceivedYaw(percept, sim));
    if (lastOct !== null && o !== lastOct && lastStill) changesWhileStill++;
    lastOct = o;
    lastStill = speed <= 1.0 && turned <= 1e-9;
  }
  return { percept, changesWhileStill, biggestCreep, settles: percept.compassSnaps };
}

// These sweeps are the expensive part of the file — forty seeds of full
// tick()s — and several assertions want the same one. Computed once, read
// many times; nothing below mutates a run it was handed.
const memo = new Map();
function sweep(key, build) {
  if (!memo.has(key)) memo.set(key, build());
  return memo.get(key);
}
function compassAcross(seconds) {
  return sweep(`compass${seconds}`, () => {
    const runs = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(compassRun(s, seconds));
    return runs;
  });
}
function reliefAcross(seconds) {
  return sweep(`relief${seconds}`, () => {
    const runs = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(reliefRun(s, seconds));
    return runs;
  });
}
function chorusAcross(seconds, opts = {}) {
  return sweep(`chorus${seconds}${JSON.stringify(opts)}`, () => {
    const runs = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(chorusRun(s, seconds, opts));
    return runs;
  });
}
function doubledAcross(seconds) {
  return sweep(`doubled${seconds}`, () => {
    const runs = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(doubledRun(s, seconds));
    return runs;
  });
}

// THE REGRESSION TEST for this kind. The old compass set one number at onset
// and never moved again, so the count below was structurally ZERO — the needle
// could not change while the lead stood still, ever, in any episode of any
// length. Measured on the shipped code: a settle lands in 55% of 8-second
// episodes, 95% of 20-second ones and 100% of 60-second ones.
check("a lead under WRONG_WAY watches the needle move while they are standing still", () => {
  const runs = compassAcross(20);
  const witnessed = runs.filter((r) => r.changesWhileStill > 0).length;
  atLeast(witnessed / SEEDS, 0.75, "a 20s WRONG_WAY should settle where the player can see it");
});

check("even a short episode settles for a substantial minority of runs", () => {
  // ~8s is the measured median lead-hallucination in careful play. It must not
  // be a dead window for this kind either.
  const runs = compassAcross(8);
  const witnessed = runs.filter((r) => r.changesWhileStill > 0).length;
  atLeast(witnessed / SEEDS, 0.3, "a short WRONG_WAY episode never shows the needle move");
});

check("a long episode settles for essentially everybody", () => {
  const runs = compassAcross(60);
  const witnessed = runs.filter((r) => r.changesWhileStill > 0).length;
  atLeast(witnessed / SEEDS, 0.9, "a 60s WRONG_WAY should settle in nearly every run");
});

// The ceiling, and the reason the floor above cannot simply be bought by
// turning the rate up. A needle that jumps every time you pause is not a
// hallucination, it is a broken instrument, and the player stops reading it.
check("the needle settles rarely enough to stay unnerving — never a twitch", () => {
  const runs = compassAcross(60);
  const perMinute = runs.reduce((a, r) => a + r.settles, 0) / runs.length;
  atMost(perMinute, 8, "the compass settles too often to read as anything but broken");
  atLeast(perMinute, 1.5, "the compass barely settles at all over a whole minute");
});

check("stop-starting as fast as possible cannot make it strobe", () => {
  // The adversarial player: two seconds of walk, one second of dead stop,
  // forever. This is the shortest cycle that can bank a whole compass point,
  // so it is the true ceiling on the effect — measured at 10.0 settles/min.
  let settles = 0;
  const N = 12;
  for (let seed = 1; seed <= N; seed++) {
    const sim = liveRun(seed);
    const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
    p.x = 0; p.z = 0; p.yaw = 0;
    const percept = createPercept(p);
    for (let i = 0; i < 1800; i++) { // 60 seconds
      if ((i * SLICE) % 3 < 2) p.z -= WALK * SLICE;
      sim.time += SLICE;
      pinUnder(sim, HALLUCINATION.WRONG_WAY);
      updatePercept(percept, sim, SLICE);
    }
    settles += percept.compassSnaps;
  }
  atMost(settles / N, 14, "a player mashing walk/stop can make the compass twitch");
});

// The other half of "not a strobe", and the one that keeps the growth itself
// invisible: between settles the error creeps by less than a hundredth of a
// radian per frame (measured max 0.0069), which is far below anything the eye
// resolves on an eight-letter compass. The lie accumulates where you cannot
// watch it accumulate.
check("the drift itself is never visible frame to frame — only the settle is", () => {
  const runs = compassAcross(60);
  const worst = Math.max(...runs.map((r) => r.biggestCreep));
  atMost(worst, 0.02, `the compass error visibly slides while walking (${worst.toFixed(4)} rad/tick)`);
});

check("a settle always crosses a whole compass point, so the letter really changes", () => {
  // This is why the threshold is π/4 and not some rounder number: the HUD
  // shows eight letters, so an error released below one octant is a settle
  // that fires correctly and changes nothing on screen — the exact failure
  // mode the monster flicker shipped with.
  atLeast(KIND_TUNING.compass.snapMin, Math.PI / 4, "a settle can be smaller than one compass point");
  const sim = liveRun(700);
  const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  // Walk a long straight line, then stop dead.
  for (let i = 0; i < 300; i++) {
    p.z -= WALK * SLICE;
    sim.time += SLICE;
    updatePercept(percept, sim, SLICE);
  }
  const before = octant(perceivedYaw(percept, sim));
  const snapsBefore = percept.compassSnaps;
  for (let i = 0; i < 30; i++) { // stand still
    sim.time += SLICE;
    updatePercept(percept, sim, SLICE);
  }
  eq(percept.compassSnaps, snapsBefore + 1, "standing still after a long walk did not settle the needle");
  assert(octant(perceivedYaw(percept, sim)) !== before, "the needle settled without the compass letter changing");
  atLeast(percept.lastSnapSize, Math.PI / 4, "the settle was smaller than one compass point");
});

check("walking grows the error; standing still and turning on the spot do not", () => {
  const sim = liveRun(701);
  const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  const seeded = percept.compassOffset;
  assert(Math.abs(seeded) > 1, "WRONG_WAY must still open with an error worth having");

  // Stand still (but under the settle threshold, so nothing is released).
  for (let i = 0; i < 60; i++) { sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  eq(percept.compassOffset, seeded, "the error moved while the lead did nothing at all");

  // Spin on the spot: a lot of turning, no ground covered.
  for (let i = 0; i < 60; i++) { p.yaw += 0.15; sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  eq(percept.compassOffset, seeded, "turning on the spot banked compass error");

  // Now walk.
  for (let i = 0; i < 60; i++) { p.z -= WALK * SLICE; sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  assert(Math.abs(percept.compassOffset) > Math.abs(seeded) + 0.2, "walking a straight line did not grow the error");
  assert(Math.sign(percept.compassOffset) === Math.sign(seeded), "the error changed direction rather than deepening");
});

check("the error only ever deepens — it never quietly corrects itself", () => {
  // The whole point is that committing costs you. If the drift could reduce
  // the magnitude, a long enough walk would accidentally hand the player a
  // working compass.
  const sim = liveRun(702);
  const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  let worst = Math.abs(percept.compassOffset);
  const seeded = Math.abs(percept.compassOffset);
  for (let i = 0; i < 400; i++) {
    p.z -= WALK * SLICE;
    if (i % 90 === 0) p.yaw += 1.2; // change course now and then
    sim.time += SLICE;
    updatePercept(percept, sim, SLICE);
    const mag = Math.abs(percept.compassOffset);
    atLeast(mag, seeded - 1e-9, "the compass error fell below the error it started with");
    worst = Math.max(worst, mag);
  }
  atMost(worst, seeded + KIND_TUNING.compass.driftMax + 1e-9, "the error grew past its own documented cap");
  // ...and the whole thing stays inside half a turn. The compass may end up
  // reading almost exactly backwards; it must never wrap through and start
  // reading correct again, which is the one outcome that would hand a
  // committed player a working instrument as a reward for committing.
  atMost(worst, Math.PI - 1e-9, "the compass error wrapped past 'exactly backwards'");
});

check("weaving costs nothing — only a committed line does", () => {
  // "The longer you walk a CONSISTENT heading" is load-bearing: a player
  // picking their way around rocks, or changing their mind every few paces,
  // must not be quietly accumulating the same error as one striding off in a
  // straight line. The first few units of every new leg are free.
  const legs = (turnEvery) => {
    const sim = liveRun(705);
    const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
    p.x = 0; p.z = 0; p.yaw = 0;
    const percept = createPercept(p);
    updatePercept(percept, sim, SLICE);
    let yaw = 0;
    for (let i = 0; i < 600; i++) {
      if (turnEvery && i % turnEvery === 0) yaw += 0.9; // a real change of course
      p.yaw = yaw;
      p.x -= Math.sin(yaw) * WALK * SLICE;
      p.z -= Math.cos(yaw) * WALK * SLICE;
      sim.time += SLICE;
      updatePercept(percept, sim, SLICE);
    }
    return percept.compassDrift;
  };
  const straight = legs(0);
  const weaving = legs(20); // a new heading every ~3 units — under the commit
  atLeast(straight, KIND_TUNING.compass.snapMin, "a long straight walk did not bank a settle's worth");
  atMost(weaving, 1e-9, "weaving accumulated compass error it should not have");
});

check("recovering clears the banked error — a second episode starts fresh", () => {
  // The same "credit banked while lucid" bug the camera-turn drift already has
  // a regression test for, one field over.
  const sim = liveRun(703);
  const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  for (let i = 0; i < 300; i++) { p.z -= WALK * SLICE; sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  assert(percept.compassDrift > 0.5, "expected a large banked drift before recovering");

  recover(sim, p, "test");
  updatePercept(percept, sim, SLICE);
  eq(percept.compassDrift, 0, "recovery left the walk's banked error in place");
  eq(percept.compassOffset, 0, "a recovered lead still has a compass offset");

  // Go under again and stop immediately — nothing should be waiting to cash in.
  pinUnder(sim, HALLUCINATION.WRONG_WAY);
  updatePercept(percept, sim, SLICE); // onset
  const fresh = percept.compassOffset;
  for (let i = 0; i < 60; i++) { sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  eq(percept.compassSnaps, 0, "the new episode settled off the previous one's walking");
  eq(percept.compassOffset, fresh, "the new episode inherited banked error");
});

check("a lens window freezes the compass where it is", () => {
  const sim = liveRun(704);
  const p = pinUnder(sim, HALLUCINATION.WRONG_WAY);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  p.lensUntil = sim.time + 30;
  const held = percept.compassOffset;
  for (let i = 0; i < 300; i++) { p.z -= WALK * SLICE; sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  eq(percept.compassOffset, held, "the compass kept drifting through a truth window");
  eq(perceivedYaw(percept, sim), p.yaw, "a lens must show the true heading");
});

// ===========================================================================
// FALSE_ANCHOR — relief that keeps its distance
// ===========================================================================

/**
 * Walk straight at the phantom pylon for `seconds`, sweeping the camera
 * around every five seconds the way a frightened person does (or not, in the
 * `sweep:false` control). Positions are driven directly rather than through
 * tick()'s collision so that terrain cannot quietly become the thing under
 * test — this measures the recede, not the rocks.
 */
function reliefRun(seed, seconds, { sweep = true } = {}) {
  const sim = liveRun(seed);
  const p = pinUnder(sim, HALLUCINATION.FALSE_ANCHOR);
  p.x = 0; p.z = 0; p.yaw = Math.PI;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  const ph = percept.phantomPylons[0];
  ph.x = 0; ph.z = -24; // a clean 24 units dead ahead
  // seedHallucination put it 12–24u away on a random bearing, which on some
  // seeds is already inside the hold and behind the lead — i.e. one recede has
  // legitimately fired before the approach under test even starts. Reset the
  // count so this measures the walk, not the setup.
  percept.reliefRecedes = 0;
  const START = 24;
  let minD = Infinity;
  let movedOnScreen = 0;
  let walked = 0;
  let landings = [];
  for (let i = 0; i < Math.round(seconds / SLICE); i++) {
    const t = i * SLICE;
    const bearing = Math.atan2(-(ph.x - p.x), -(ph.z - p.z));
    p.yaw = sweep && t % 5 >= 3.5 ? bearing + Math.PI : bearing;
    // Stop on arrival rather than walking through and out the far side — past
    // it the bearing flips 180° and the thing is behind you, which is a
    // different situation from an approach.
    const arrived = Math.hypot(ph.x - p.x, ph.z - p.z) <= 1;
    const stepX = arrived ? 0 : -Math.sin(bearing) * WALK * SLICE;
    const stepZ = arrived ? 0 : -Math.cos(bearing) * WALK * SLICE;
    p.x += stepX; p.z += stepZ;
    walked += Math.hypot(stepX, stepZ);
    sim.time += SLICE;

    const inView = Math.abs(((Math.atan2(-(ph.x - p.x), -(ph.z - p.z)) - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) <= 0.85;
    const before = { x: ph.x, z: ph.z };
    const recedesBefore = percept.reliefRecedes;
    updatePercept(percept, sim, SLICE);
    if (inView && Math.hypot(ph.x - before.x, ph.z - before.z) > 1e-9) movedOnScreen++;
    if (percept.reliefRecedes !== recedesBefore) landings.push(Math.hypot(ph.x - p.x, ph.z - p.z));
    minD = Math.min(minD, Math.hypot(ph.x - p.x, ph.z - p.z));
  }
  const finalD = Math.hypot(ph.x - p.x, ph.z - p.z);
  return { minD, finalD, walked, gained: START - finalD, recedes: percept.reliefRecedes, movedOnScreen, landings };
}

// THE REGRESSION TEST for this kind. The old phantom pylon sat still, so a
// forty-second walk at it ended standing inside it, every time, in every seed:
// "gained" was the full 24 units. Measured on the shipped code, the same walk
// covers ~122 units of ground and gains a median of 5.3 (worst 7.6), leaving
// the relief 18.7 units away — almost exactly where it started.
check("a lead who walks at the phantom pylon does not get there", () => {
  const runs = reliefAcross(40);
  const worstGain = Math.max(...runs.map((r) => r.gained));
  const walked = runs.reduce((a, r) => a + r.walked, 0) / runs.length;
  atLeast(walked, 90, "sanity: the harness did not actually walk anywhere");
  atMost(worstGain, 14, `forty seconds of walking closed ${worstGain.toFixed(1)}u on the relief`);
  for (const r of runs) atLeast(r.recedes, 3, "the relief never backed off at all");
});

check("...but a lead who never takes their eyes off it arrives, and gets nothing", () => {
  // The control, and the reason this is a rule rather than a cheat. Discipline
  // is rewarded with the actual punchline: you are standing in a pylon that
  // does not exist. Nothing here is unreachable, it is only expensive.
  for (let seed = 1; seed <= 12; seed++) {
    const r = reliefRun(seed, 40, { sweep: false });
    eq(r.recedes, 0, `seed ${seed}: the relief receded from a lead who never looked away`);
    atMost(r.minD, 1, `seed ${seed}: an unbroken approach still failed to arrive (${r.minD.toFixed(1)}u)`);
  }
});

// The strobe ceiling for this kind, and it is a hard zero rather than a rate:
// the one thing that would read as a graphics bug instead of a place is the
// pylon moving while it is on screen. It never does — same rule
// shiftOneUnseenPhantom obeys for phantom monoliths.
check("the phantom pylon never moves while the lead is looking at it", () => {
  const onScreenMoves = reliefAcross(40).reduce((a, r) => a + r.movedOnScreen, 0);
  eq(onScreenMoves, 0, "the relief moved under the player's eye");
});

check("every recede lands at the same distance, on the same bearing", () => {
  // Bounded by construction: it is not a random reseed, it is a push back out
  // along the line you were already walking. Anything else and the "it's still
  // over there, just further" reading breaks.
  const r = reliefAcross(40)[8];
  atLeast(r.landings.length, 3, "not enough recedes to judge");
  for (const d of r.landings) {
    assert(Math.abs(d - KIND_TUNING.relief.distance) < 1e-6, `a recede landed at ${d.toFixed(2)}u, not the documented distance`);
  }
});

check("a recede keeps the bearing it had — it never jumps to a new direction", () => {
  const sim = liveRun(710);
  const p = pinUnder(sim, HALLUCINATION.FALSE_ANCHOR);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  const ph = percept.phantomPylons[0];
  ph.x = 0; ph.z = 10; // directly BEHIND the lead (yaw 0 faces -Z), and inside the hold
  const bearingBefore = Math.atan2(ph.z - p.z, ph.x - p.x);
  sim.time += SLICE;
  updatePercept(percept, sim, SLICE);
  const bearingAfter = Math.atan2(ph.z - p.z, ph.x - p.x);
  assert(Math.abs(bearingAfter - bearingBefore) < 1e-6, "the relief changed direction when it backed off");
  assert(Math.abs(Math.hypot(ph.x - p.x, ph.z - p.z) - KIND_TUNING.relief.distance) < 1e-6, "the relief did not land at its documented distance");
});

check("a pylon that dies during the episode keeps reading as live", () => {
  // FALSE_ANCHOR's other half used to be a set frozen at onset, so a pylon the
  // player drained THEMSELVES by camping it honestly went dark on screen — the
  // one moment the lie had a reason to hold and it let go. Now the screen keeps
  // insisting: you stand in the light and never come back.
  const sim = liveRun(711);
  const p = pinUnder(sim, HALLUCINATION.FALSE_ANCHOR);
  const percept = createPercept(p);
  const target = sim.pylons[0];
  eq(target.charge, PYLON_MAX_CHARGE, "sanity: pylons start charged");
  updatePercept(percept, sim, SLICE); // onset, while it is still live
  assert(!percept.deadPylonsLookLive.has(target.id), "a live pylon should not be in the set yet");

  target.charge = 0; // as if the party had camped it flat
  sim.time += SLICE;
  updatePercept(percept, sim, SLICE);
  const seen = perceivedPylons(percept, sim).find((x) => x.id === target.id);
  assert(seen.looksLive, "a pylon that died mid-episode stopped lying");
  eq(sim.pylons[0].charge, 0, "perception altered the sim's own charge");
});

check("a lucid lead is told the truth about a spent pylon, mid-episode or not", () => {
  const sim = liveRun(712);
  const percept = createPercept(sim.player);
  sim.pylons[0].charge = 0;
  updatePercept(percept, sim, SLICE);
  const seen = perceivedPylons(percept, sim).find((x) => x.id === sim.pylons[0].id);
  assert(!seen.looksLive, "a spent pylon lied to a perfectly lucid lead");
});

// ===========================================================================
// CHORUS — agreement that answers what you DO, and escalates
// ===========================================================================

const VERBS = ["log", "pickup", "itemUsed", "gather", "logFalse", "itemPhantom", "craft", "dose"];

/**
 * Play `seconds` under CHORUS, performing a decision verb every `verbEvery`
 * seconds and collecting whatever the chorus says back. `scatter` places the
 * party at a fixed radius — 22 units is the measured median nearest-companion
 * distance while the lead is under, which is the geometry that actually
 * matters here (see the impossible-voice test below).
 */
function chorusRun(seed, seconds, { verbEvery = 4, scatter = 0 } = {}) {
  const sim = liveRun(seed);
  const p = pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(p);
  let baseYaw = 0;
  const lines = [];
  let impossible = 0;
  let nextVerb = 0;
  let n = 0;
  const start = sim.time;
  while (sim.time - start < seconds) {
    const t = sim.time - start;
    const { move, yaw } = drive(t, baseYaw);
    if (t % 9 >= 9 - SLICE) baseYaw += 0.7;
    tick(sim, SLICE, { move, yaw });
    pinUnder(sim, HALLUCINATION.CHORUS);
    if (scatter) {
      sim.companions.forEach((c, k) => {
        const a = (k / sim.companions.length) * Math.PI * 2;
        c.x = p.x + Math.cos(a) * scatter;
        c.z = p.z + Math.sin(a) * scatter;
      });
    }
    updatePercept(percept, sim, SLICE);
    if (t >= nextVerb) {
      nextVerb += verbEvery;
      const echo = chorusEcho(percept, sim, { kind: VERBS[n++ % VERBS.length], text: "x", t: sim.time });
      if (echo) {
        lines.push(echo);
        const bad = echo.voices.some((id) => {
          const c = sim.companions.find((x) => x.id === id);
          return c.hallucinating || Math.hypot(c.x - p.x, c.z - p.z) > CORROBORATE_RADIUS;
        });
        if (bad) impossible++;
      }
    }
  }
  return { lines, impossible, percept, sim };
}

// THE REGRESSION TEST for this kind. CHORUS used to be reachable ONLY by
// asking for a check-in — a verb a player under can go an entire episode
// without pressing, and one the HUD gives no reason to press once every answer
// is the same. On the old build the count below is zero for every seed no
// matter what the player does.
check("the chorus answers what the lead DOES, not only what they ask", () => {
  const runs = chorusAcross(20);
  const spoke = runs.filter((r) => r.lines.length > 0).length;
  eq(spoke, SEEDS, "a lead making decisions under CHORUS was met with silence");
});

check("a passive lead is not shouted at — the chorus needs something to agree with", () => {
  // The flip side of the rule above, and deliberate: this channel is a reply.
  // A lead who does nothing under CHORUS gets the check-in filter and the
  // whispers, exactly as before.
  const sim = liveRun(720);
  pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(sim.player);
  for (let i = 0; i < 1800; i++) { sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  eq(percept.chorusLines, 0, "the chorus spoke to a lead who did nothing at all");
});

// The ceiling. A feedback channel that fires on EVERY event stops carrying
// information and starts destroying it (Brain: brain-builder#E6) — and the
// subtitle stack is four lines deep, so a chorus that answered every pickup
// would bury the companion chatter that is the game's actual sensor.
check("the chorus is gated hard enough that mashing verbs cannot flood it", () => {
  const runs = [];
  for (let s = 1; s <= 8; s++) runs.push(chorusRun(s, 60, { verbEvery: 0.2 }));
  const perMinute = runs.reduce((a, r) => a + r.lines.length, 0) / runs.length;
  atMost(perMinute, 8, "a player pressing everything can flood the subtitle stack with chorus");
  atLeast(perMinute, 3, "the chorus barely speaks even to a player doing everything");
});

check("only decisions earn an answer — the world being noticed does not", () => {
  const sim = liveRun(721);
  pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(sim.player);
  updatePercept(percept, sim, SLICE);
  for (const kind of ["discover", "discoverItem", "discoverResource", "chatter", "report", "break", "hallucinate", "recover"]) {
    sim.time += 30; // well past the gap, so only the KIND is under test
    eq(chorusEcho(percept, sim, { kind, text: "x" }), null, `"${kind}" should not earn a chorus line`);
  }
  sim.time += 30;
  assert(chorusEcho(percept, sim, { kind: "log", text: "x" }), "a survey should earn a chorus line");
});

check("two decisions in the same breath get one answer, not two", () => {
  const sim = liveRun(722);
  pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(sim.player);
  updatePercept(percept, sim, SLICE);
  assert(chorusEcho(percept, sim, { kind: "log", text: "x" }), "expected a first line");
  eq(chorusEcho(percept, sim, { kind: "pickup", text: "x" }), null, "a second verb in the same instant spoke over the first");
  sim.time += KIND_TUNING.chorus.gap - 0.1;
  eq(chorusEcho(percept, sim, { kind: "pickup", text: "x" }), null, "the gap was not respected");
  sim.time += 0.2;
  assert(chorusEcho(percept, sim, { kind: "pickup", text: "x" }), "the gap never reopened");
});

check("a check-in and an action echo share one clock — they cannot stack", () => {
  const sim = liveRun(723);
  pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(sim.player);
  updatePercept(percept, sim, SLICE);
  const rep = filterReport(percept, sim, checkIn(sim, sim.companions[0].id));
  eq(rep.claim, BAND.STEADY, "chorus should still flatten a check-in to 'fine'");
  eq(chorusEcho(percept, sim, { kind: "log", text: "x" }), null, "an action echo landed on top of a check-in reply");
});

// The tell. Agreement from the person at your elbow is merely eerie; agreement
// in HALDER's voice while HALDER is twenty-two units away with his back to you
// is a thing the player can CHECK, and checking it is the only way anybody
// catches this kind at all. Measured: 100% of lines name an impossible voice
// once the party has spread to the 22-unit median it actually sits at while
// the lead is under; 5–13% when everyone happens to be in formation, which is
// correct — there is nobody impossible to name.
check("the chorus prefers a voice that could not possibly be speaking", () => {
  const runs = chorusAcross(60, { scatter: 22 });
  const total = runs.reduce((a, r) => a + r.lines.length, 0);
  const impossible = runs.reduce((a, r) => a + r.impossible, 0);
  atLeast(total, 100, "not enough chorus lines to judge who is speaking");
  atLeast(impossible / total, 0.9, "the chorus keeps picking voices that were plausibly in earshot");
});

check("...and falls back gracefully when the whole party really is at your elbow", () => {
  const sim = liveRun(724);
  const p = pinUnder(sim, HALLUCINATION.CHORUS);
  p.x = 0; p.z = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  for (const c of sim.companions) { c.x = 2; c.z = 2; c.lucidity = 80; c.hallucinating = false; }
  const echo = chorusEcho(percept, sim, { kind: "log", text: "x" });
  assert(echo, "the chorus went silent instead of falling back");
  eq(echo.voices.length, 1, "a tier-0 chorus should be one voice");
  assert(sim.companions.some((c) => c.id === echo.voices[0]), "the chorus named somebody who is not in the party");
});

check("a gone companion is exactly the voice the chorus reaches for", () => {
  const sim = liveRun(725);
  const p = pinUnder(sim, HALLUCINATION.CHORUS);
  p.x = 0; p.z = 0;
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  for (const c of sim.companions) { c.x = 2; c.z = 2; c.lucidity = 80; c.hallucinating = false; }
  const victim = sim.companions[3];
  beginHallucinating(sim, victim); // still standing right next to you, but gone
  const echo = chorusEcho(percept, sim, { kind: "log", text: "x" });
  eq(echo.voices[0], victim.id, "the chorus ignored the one person who could not have said it");
  assert(echo.text.startsWith(victim.name), "the line does not name the impossible speaker");
});

check("the chorus escalates: one voice, then a certain one, then all of them", () => {
  const sim = liveRun(726);
  const p = pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  eq(chorusTier(percept, sim), 0, "a fresh episode should open at its quietest");

  const first = chorusEcho(percept, sim, { kind: "log", text: "x" });
  eq(first.tier, 0, "the first line should be tier 0");
  eq(first.voices.length, 1, "tier 0 is one voice");

  sim.time += KIND_TUNING.chorus.gap + 1;
  chorusEcho(percept, sim, { kind: "log", text: "x" });
  sim.time += KIND_TUNING.chorus.gap + 1;
  const third = chorusEcho(percept, sim, { kind: "log", text: "x" });
  atLeast(third.tier, 1, "the chorus never gained a tier however much it said");

  // Time under, and the party going with you, are the other two axes. Jump
  // past BOTH the deepen threshold and the gate's own gap — landing inside
  // the gap just gets silence, which is the gate doing its job.
  sim.time = Math.max(sim.time, percept.since + KIND_TUNING.chorus.deepenAfter) + KIND_TUNING.chorus.gap + 1;
  for (const c of sim.companions.slice(0, 3)) beginHallucinating(sim, c);
  const loud = chorusEcho(percept, sim, { kind: "log", text: "x" });
  eq(loud.tier, 2, "a long episode with half the party gone should be at full volume");
  eq(loud.voices.length, 2, "tier 2 should speak with more than one voice");
});

check("at full volume, somebody you did not ask answers the check-in", () => {
  const sim = liveRun(727);
  const p = pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(p);
  updatePercept(percept, sim, SLICE);
  sim.time = percept.since + KIND_TUNING.chorus.deepenAfter + 1;
  for (const c of sim.companions.slice(0, 3)) beginHallucinating(sim, c);
  percept.chorusLines = 5;
  eq(chorusTier(percept, sim), 2, "sanity: expected full volume");
  const asked = sim.companions[4];
  const rep = filterReport(percept, sim, checkIn(sim, asked.id));
  eq(rep.claim, BAND.STEADY, "the reply must still be agreement");
  assert(rep.name !== asked.name, "at full volume the wrong person should answer");
  eq(rep.who, asked.id, "the report must still record who was actually asked");
});

check("a hollow action gets congratulated anyway — the bite of the whole kind", () => {
  // Logging an entry at nothing, closing your hand on air, using an item that
  // was never there. The chorus does not merely fail to warn you: it tells you
  // that was the one you needed.
  for (const kind of ["logFalse", "pickupFalse", "itemPhantom", "dropPhantom"]) {
    const sim = liveRun(728);
    pinUnder(sim, HALLUCINATION.CHORUS);
    const percept = createPercept(sim.player);
    updatePercept(percept, sim, SLICE);
    const echo = chorusEcho(percept, sim, { kind, text: "x" });
    assert(echo, `"${kind}" should be met`);
    assert(echo.hollow, `"${kind}" should be answered in the hollow register`);
  }
  const sim = liveRun(729);
  pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(sim.player);
  updatePercept(percept, sim, SLICE);
  assert(!chorusEcho(percept, sim, { kind: "log", text: "x" }).hollow, "a real survey should not read as hollow");
});

check("consecutive chorus lines never repeat the same words", () => {
  const runs = [];
  for (let s = 1; s <= 8; s++) runs.push(chorusRun(s, 60, { scatter: 22, verbEvery: 3 }));
  for (const r of runs) {
    for (let i = 1; i < r.lines.length; i++) {
      assert(r.lines[i].text !== r.lines[i - 1].text, `repeated "${r.lines[i].text}" back to back`);
    }
  }
});

check("the chorus never speaks for another kind, a lucid lead, or through a lens", () => {
  for (const kind of [HALLUCINATION.WRONG_WAY, HALLUCINATION.FALSE_ANCHOR, HALLUCINATION.DOUBLED_PARTY, HALLUCINATION.PHANTOM_MARKER]) {
    const sim = liveRun(730);
    pinUnder(sim, kind);
    const percept = createPercept(sim.player);
    updatePercept(percept, sim, SLICE);
    eq(chorusEcho(percept, sim, { kind: "log", text: "x" }), null, `${kind} should have no chorus`);
    eq(chorusTier(percept, sim), -1, `${kind} should report no chorus tier`);
  }
  const lucid = liveRun(731);
  const lp = createPercept(lucid.player);
  updatePercept(lp, lucid, SLICE);
  eq(chorusEcho(lp, lucid, { kind: "log", text: "x" }), null, "a lucid lead heard a chorus");

  const lensed = liveRun(732);
  pinUnder(lensed, HALLUCINATION.CHORUS);
  const lensP = createPercept(lensed.player);
  updatePercept(lensP, lensed, SLICE);
  lensed.player.lensUntil = lensed.time + 30;
  eq(chorusEcho(lensP, lensed, { kind: "log", text: "x" }), null, "a truth window did not silence the chorus");
});

// ===========================================================================
// DOUBLED_PARTY — the sixth body fills a gap that is really there
// ===========================================================================

/**
 * Play `seconds` under DOUBLED_PARTY on the drive model. One companion breaks
 * five seconds in; everything measured is about whether the party still LOOKS
 * whole afterwards.
 */
function doubledRun(seed, seconds) {
  const sim = liveRun(seed);
  const p = pinUnder(sim, HALLUCINATION.DOUBLED_PARTY);
  const percept = createPercept(p);
  let baseYaw = 0;
  const victim = sim.companions[2];
  let ghostTicks = 0;
  let victimTicks = 0;
  let confidentTicks = 0;
  let maxRows = 0;
  let maxStep = 0;
  let ticks = 0;
  let broke = false;
  let filledAt = null;
  let prev = null;
  const start = sim.time;
  while (sim.time - start < seconds) {
    const t = sim.time - start;
    const { move, yaw } = drive(t, baseYaw);
    if (t % 9 >= 9 - SLICE) baseYaw += 0.7;
    for (const c of sim.companions) if (c !== victim) c.lucidity = 80;
    if (t >= 5 && !broke) { victim.lucidity = 0; beginHallucinating(sim, victim); broke = true; }
    tick(sim, SLICE, { move, yaw });
    pinUnder(sim, HALLUCINATION.DOUBLED_PARTY);
    updatePercept(percept, sim, SLICE);
    ticks++;
    const ph = percept.phantomCompanions[0];
    if (prev) maxStep = Math.max(maxStep, Math.hypot(ph.x - prev.x, ph.z - prev.z));
    prev = { x: ph.x, z: ph.z };
    if (percept.ghostOf) ghostTicks++;
    if (percept.ghostOf === victim.id) {
      victimTicks++;
      if (filledAt === null) filledAt = t - 5;
    }
    let rows = 0;
    for (const c of sim.companions) if (!rosterRead(percept, sim, c).uncertain) rows++;
    maxRows = Math.max(maxRows, rows);
    if (rows > 0) confidentTicks++;
  }
  return { percept, sim, victim, ghostTicks, victimTicks, confidentTicks, maxRows, maxStep, ticks, filledAt, swaps: percept.ghostSwaps };
}

// THE REGRESSION TEST for this kind. The old phantom walked a circle nobody had
// ever occupied, so a companion going under left a hole in the formation that
// stayed a hole — countable, and the one thing a player under DOUBLED_PARTY
// could still trust. Measured on the shipped code: the vacated slot is taken in
// 100% of episodes, and it is the slot of the person who actually broke.
check("when somebody goes under, the sixth body takes their place", () => {
  const runs = doubledAcross(20);
  const took = runs.filter((r) => r.victimTicks > 0).length;
  atLeast(took / SEEDS, 0.9, "the phantom did not move into the slot of the companion who broke");
  const waits = runs.filter((r) => r.filledAt !== null).map((r) => r.filledAt);
  atMost(Math.max(...waits), 6, "the phantom took too long to cover the gap to read as covering it");
});

check("the roster is confident about exactly the person who is missing", () => {
  const runs = doubledAcross(20);
  const duty = runs.reduce((a, r) => a + r.confidentTicks, 0) / runs.reduce((a, r) => a + r.ticks, 0);
  atLeast(duty, 0.4, "the roster almost never shows the false-steady row");
  for (const r of runs) atMost(r.maxRows, 1, "more than one roster row was confident at once");
});

check("nobody missing, nothing claimed — the roster stays honestly blank", () => {
  // The control. A confident line next to every name would be noise; it is the
  // asymmetry against five "you can't tell"s that makes the one lie legible
  // (Brain: brain-builder#E6 — float ONE headline marker, never a stack).
  let confident = 0;
  let ticks = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const sim = liveRun(seed);
    const p = pinUnder(sim, HALLUCINATION.DOUBLED_PARTY);
    p.x = 0; p.z = 0; p.yaw = 0;
    const percept = createPercept(p);
    for (let i = 0; i < 600; i++) {
      sim.companions.forEach((c, k) => {
        const a = (k - 2) * 0.55;
        c.x = Math.sin(a) * 5; c.z = Math.cos(a) * 5;
        c.lucidity = 80; c.hallucinating = false;
      });
      sim.time += SLICE;
      updatePercept(percept, sim, SLICE);
      ticks++;
      for (const c of sim.companions) if (!rosterRead(percept, sim, c).uncertain) confident++;
    }
  }
  atLeast(ticks, 5000, "sanity: the control did not run");
  eq(confident, 0, "the roster claimed to know something with the whole party present");
});

check("the roster never leaks the hidden number, false row included", () => {
  const runs = doubledAcross(20).slice(0, 6);
  for (const r of runs) {
    for (const c of r.sim.companions) {
      const blob = JSON.stringify(rosterRead(r.percept, r.sim, c));
      assert(!/\d/.test(blob), `roster leaked a number: ${blob}`);
    }
  }
});

// The strobe ceilings for this kind, and there are two: the phantom must not
// snap between slots, and it must not move faster than a person.
check("the sixth body walks into the gap — it never snaps into it", () => {
  const runs = doubledAcross(60);
  const worst = Math.max(...runs.map((r) => r.maxStep));
  atMost(worst, KIND_TUNING.doubled.ease > 0 ? 4.6 * SLICE + 1e-6 : Infinity,
    `the phantom moved ${(worst / SLICE).toFixed(1)}u/s — faster than anything alive in the basin`);
  const swaps = runs.reduce((a, r) => a + r.swaps, 0) / runs.length;
  atMost(swaps, 8, "the phantom changes whose place it is holding too often to read as one person");
});

check("hovering at the edge of formation cannot make the phantom flicker", () => {
  // Hysteresis. Without it, a companion sitting exactly on the vacancy
  // threshold hands the slot back and forth every few frames — the sixth body
  // teleporting between two places, which is a bug, not a hallucination.
  const sim = liveRun(740);
  const p = pinUnder(sim, HALLUCINATION.DOUBLED_PARTY);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  sim.companions.forEach((c, k) => { const a = (k - 2) * 0.55; c.x = Math.sin(a) * 5; c.z = Math.cos(a) * 5; c.lucidity = 80; });
  updatePercept(percept, sim, SLICE);
  const drifter = sim.companions[0];
  for (let i = 0; i < 900; i++) {
    // Oscillate straight across the vacancy threshold, once a second.
    const d = KIND_TUNING.doubled.vacancy + Math.sin(i * SLICE * Math.PI * 2) * 1.5;
    drifter.x = d; drifter.z = 0;
    sim.time += SLICE;
    updatePercept(percept, sim, SLICE);
  }
  atMost(percept.ghostSwaps, 3, `the slot changed hands ${percept.ghostSwaps} times against one wobbling companion`);
});

check("a companion who comes properly back gets their slot back", () => {
  const sim = liveRun(741);
  const p = pinUnder(sim, HALLUCINATION.DOUBLED_PARTY);
  p.x = 0; p.z = 0; p.yaw = 0;
  const percept = createPercept(p);
  sim.companions.forEach((c, k) => { const a = (k - 2) * 0.55; c.x = Math.sin(a) * 5; c.z = Math.cos(a) * 5; c.lucidity = 80; });
  updatePercept(percept, sim, SLICE);
  const strayer = sim.companions[1];
  strayer.x = 30; strayer.z = 0;
  for (let i = 0; i < 30; i++) { sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  eq(percept.ghostOf, strayer.id, "the phantom did not take the strayer's slot");
  strayer.x = 5; strayer.z = 0;
  for (let i = 0; i < 30; i++) { sim.time += SLICE; updatePercept(percept, sim, SLICE); }
  eq(percept.ghostOf, null, "the phantom kept a slot whose owner walked back into it");
  for (const c of sim.companions) assert(rosterRead(percept, sim, c).uncertain, "the roster stayed confident after the gap closed");
});

check("recovering ends the impersonation immediately", () => {
  const r = doubledRun(4, 22);
  assert(r.percept.ghostOf !== null || r.ghostTicks > 0, "sanity: expected an impersonation to have happened");
  recover(r.sim, r.sim.player, "test");
  updatePercept(r.percept, r.sim, SLICE);
  eq(r.percept.ghostOf, null, "the phantom held a slot after the lead came back");
  eq(r.percept.slotMemory.size, 0, "slot memory survived recovery");
  eq(perceivedCompanions(r.percept, r.sim).length, 5, "a recovered lead still sees six people");
});

// ===========================================================================
// the rules all four have to obey
// ===========================================================================

check("none of the four reactive paths draws from the sim's rng", () => {
  // Constant roll count (Brain: waiting-city#E9/E17). Every draw any of these
  // needs is taken once, at onset, in seedHallucination — so a run's rng
  // stream cannot fork on how the player happened to move, which is what makes
  // a seed a complete description of a run at all.
  for (const kind of REACTIVE_FOUR) {
    const sim = liveRun(750);
    const p = pinUnder(sim, kind);
    p.x = 0; p.z = 0; p.yaw = 0;
    // Form the party up around the lead, so DOUBLED_PARTY has slots to
    // remember before the lead walks away from them.
    sim.companions.forEach((c, k) => { const a = (k - 2) * 0.55; c.x = Math.sin(a) * 5; c.z = Math.cos(a) * 5; });
    const percept = createPercept(p);
    // Two OTHER per-tick systems in this module legitimately draw, and both
    // predate this work: the monster flicker rolls once a tick, and the
    // camera-turn drift reseeds a phantom every TURN_SHIFT_ANGLE of sweep.
    // They are held out rather than measured — the roll is stubbed and the
    // head is kept still — so anything left is the four kinds' own doing.
    sim.rng.chance = () => false;
    updatePercept(percept, sim, SLICE); // onset — this one IS allowed to draw
    const after = sim.rng.snapshot();
    for (let i = 0; i < 600; i++) {
      // Walk, then hold — both halves, so the compass both accumulates and
      // settles inside this loop rather than only ever doing one of them.
      if (i % 90 < 60) {
        p.x += Math.sin(i * 0.11) * 0.4;
        p.z += Math.cos(i * 0.07) * 0.4;
      }
      sim.time += SLICE;
      updatePercept(percept, sim, SLICE);
    }
    eq(sim.rng.snapshot(), after, `${kind}'s per-tick path consumed rng draws`);
    // ...and prove the loop above actually drove each kind's reactive path,
    // so "no draws" cannot be passing because nothing happened. CHORUS's own
    // path is event-driven and gets its own test immediately below.
    const exercised = {
      [HALLUCINATION.WRONG_WAY]: percept.compassSnaps > 0,
      [HALLUCINATION.FALSE_ANCHOR]: percept.reliefRecedes > 0,
      [HALLUCINATION.DOUBLED_PARTY]: percept.ghostSwaps > 0,
      [HALLUCINATION.CHORUS]: true,
    }[kind];
    assert(exercised, `${kind}: the harness never actually exercised its reactive path`);
  }
});

check("a chorus line costs no rng either — it fires from a render path", () => {
  const sim = liveRun(751);
  pinUnder(sim, HALLUCINATION.CHORUS);
  const percept = createPercept(sim.player);
  updatePercept(percept, sim, SLICE);
  const before = sim.rng.snapshot();
  for (let i = 0; i < 30; i++) {
    sim.time += KIND_TUNING.chorus.gap + 1;
    chorusEcho(percept, sim, { kind: "log", text: "x" });
  }
  eq(sim.rng.snapshot(), before, "chorusEcho consumed the sim's rng stream");
});

check("none of the four touches the sim's own truth", () => {
  // percept.js is the only module allowed to lie, and it lies by ANSWERING
  // differently — never by editing the record it is answering about.
  for (const kind of Object.values(HALLUCINATION)) {
    if (kind === HALLUCINATION.PHANTOM_MARKER) continue; // camera-turn drift owns its own suite
    const sim = liveRun(752);
    const p = pinUnder(sim, kind);
    const percept = createPercept(p);
    const before = JSON.stringify({
      pylons: sim.pylons.map((x) => ({ id: x.id, x: x.x, z: x.z, charge: x.charge, live: x.live })),
      companions: sim.companions.map((c) => ({ id: c.id, name: c.name, x: c.x, z: c.z, lucidity: c.lucidity, hallucinating: c.hallucinating })),
      monoliths: sim.monoliths.map((m) => ({ id: m.id, x: m.x, z: m.z, logged: m.logged })),
      self: { lucidity: p.lucidity, hallucinating: p.hallucinating, hallucination: p.hallucination, lensUntil: p.lensUntil },
      log: sim.logEntries.length, doses: sim.doses, inventory: sim.inventory.length,
    });
    for (let i = 0; i < 300; i++) {
      p.yaw += 0.05;
      sim.time += SLICE;
      updatePercept(percept, sim, SLICE);
      chorusEcho(percept, sim, { kind: "log", text: "x" });
      perceivedPylons(percept, sim);
      perceivedCompanions(percept, sim);
      for (const c of sim.companions) rosterRead(percept, sim, c);
    }
    const after = JSON.stringify({
      pylons: sim.pylons.map((x) => ({ id: x.id, x: x.x, z: x.z, charge: x.charge, live: x.live })),
      companions: sim.companions.map((c) => ({ id: c.id, name: c.name, x: c.x, z: c.z, lucidity: c.lucidity, hallucinating: c.hallucinating })),
      monoliths: sim.monoliths.map((m) => ({ id: m.id, x: m.x, z: m.z, logged: m.logged })),
      self: { lucidity: p.lucidity, hallucinating: p.hallucinating, hallucination: p.hallucination, lensUntil: p.lensUntil },
      log: sim.logEntries.length, doses: sim.doses, inventory: sim.inventory.length,
    });
    eq(after, before, `${kind} mutated the sim's own record`);
    for (const c of sim.companions) assert(!("doubled" in c), "percept wrote onto a real companion");
  }
});

check("all four are reproducible from the seed alone", () => {
  const trace = (seed) => {
    const c = compassRun(seed, 15);
    const r = reliefRun(seed, 15);
    const h = chorusRun(seed, 15, { scatter: 22 });
    const d = doubledRun(seed, 15);
    return [
      c.settles, c.changesWhileStill,
      r.recedes, r.finalD.toFixed(4),
      h.lines.length, h.lines.map((l) => l.tier).join(""),
      d.swaps, d.victimTicks,
    ].join("|");
  };
  eq(trace(11), trace(11), "the same seed produced two different histories");
  assert(trace(11) !== trace(12), "two different seeds produced identical histories — is anything seeded?");
});

check("a lucid lead is never shown any of it", () => {
  const sim = liveRun(753);
  const percept = createPercept(sim.player);
  sim.pylons[0].charge = 0;
  for (let i = 0; i < 300; i++) {
    sim.player.z -= WALK * SLICE;
    sim.time += SLICE;
    updatePercept(percept, sim, SLICE);
  }
  eq(perceivedYaw(percept, sim), sim.player.yaw, "a lucid lead's compass drifted");
  eq(percept.compassSnaps, 0, "a lucid lead's compass settled");
  eq(percept.reliefRecedes, 0, "a lucid lead had something recede from them");
  eq(percept.ghostOf, null, "a lucid lead had a slot impersonated");
  eq(perceivedCompanions(percept, sim).length, 5, "a lucid lead was shown a sixth body");
  assert(!perceivedPylons(percept, sim).find((x) => x.id === sim.pylons[0].id).looksLive, "a lucid lead was lied to about a spent pylon");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("mirage kinds: OK");
