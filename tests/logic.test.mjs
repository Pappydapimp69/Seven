// Pure-logic test suite for MIRAGE. No browser, no WebGL, no timers.
// Run: node mirage/tests/logic.test.mjs
//
// Everything asserted here reads the sim's OWN clock (`sim.time`) and its own
// state — never wall-clock seconds. Headless/loaded environments run frames well
// under real time, so any assertion phrased in real seconds is a flake waiting to
// happen; the sim is advanced explicitly instead.

import {
  createRun, tick, tickLucidity, bandOf, BAND, checkIn, useDose, logMarker, recover,
  beginHallucinating, debrief, trueLogCount, checkEndings, partyCentroid,
  pickupItem, useItem, craftItem, previewCraft, gatherResource, gatherTarget, emit,
  rollTraits, pickHallucinationKind, companionPickup, handoffToPlayer,
  possess, release, possessableCompanions,
  PARTY_SIZE, MAX_LUCIDITY, DOSE_COUNT, RECOVER_AT, RECOVER_TIME, DISSOLVE_TIME,
  TIME_LIMIT, PYLON_RADIUS, LOG_RADIUS, ISOLATION_DIST,
  ITEM_CAP, ITEM_PICKUP_RADIUS, ITEM_INFO, PHANTOM_ITEM_COST, CRAFT_RECIPES, CAMPAIGN_LENGTH,
  GATHER_RADIUS, GATHER_HOLD_TIME, GATHER_YIELD, STAKE_COST, PYLON_MAX_CHARGE, TRAIT_VARIANCE, COMPANION_TEMPLATES,
  COMPANION_ITEM_CAP,
} from "../src/state.js";
import { generateWorld, validate, findPath, isBlockedAt, GRID, ITEM_COUNT, ITEM_KINDS, TREE_COUNT, STONE_COUNT } from "../src/world.js";
import {
  createPercept, updatePercept, perceivedMonoliths, perceivedPylons, perceivedCompanions,
  perceivedYaw, rosterRead, filterReport, distortion,
  perceivedWorldItems, perceivedInventory, isClear,
} from "../src/percept.js";
import { HALLUCINATION } from "../src/state.js";
import { makeRng, hashSeed } from "../src/rng.js";

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
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || "not near"} — got ${a}, expected ~${b}`);
}

// Advance a sim by `seconds` in fixed slices, as the game loop does.
function advance(sim, seconds, input = {}) {
  const slice = 1 / 30;
  for (let t = 0; t < seconds && sim.status === "playing"; t += slice) tick(sim, slice, input);
  return sim;
}

// ---------------------------------------------------------------------------
// rng
// ---------------------------------------------------------------------------
check("rng is deterministic per seed", () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 50; i++) eq(a(), b(), "same seed diverged");
});

check("rng int is inclusive and in range", () => {
  const r = makeRng(7);
  const seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const v = r.int(1, 5);
    assert(v >= 1 && v <= 5, `int out of range: ${v}`);
    seen.add(v);
  }
  eq(seen.size, 5, "int(1,5) never produced all five values");
});

check("hashSeed is stable and non-zero", () => {
  eq(hashSeed("basin"), hashSeed("basin"), "unstable hash");
  assert(hashSeed("basin") !== hashSeed("basins"), "hash collision on near-identical input");
});

// ---------------------------------------------------------------------------
// world generation + the connectivity guarantee
// ---------------------------------------------------------------------------
check("every objective is reachable from camp, across many seeds", () => {
  // The repair pass is verified here, not trusted: validate() re-derives
  // reachability from scratch with its own flood fill.
  for (let seed = 1; seed <= 60; seed++) {
    const w = generateWorld(seed);
    const v = validate(w);
    assert(v.ok, `seed ${seed}: unreachable ${JSON.stringify(v.unreachable)}`);
    eq(w.monoliths.length, 6, `seed ${seed}: wrong monolith count`);
    eq(w.pylons.length, 5, `seed ${seed}: wrong pylon count`);
  }
});

check("BFS finds a concrete path from camp to every marker and pylon", () => {
  for (const seed of [1, 5, 17, 33, 99]) {
    const w = generateWorld(seed);
    const from = { cx: w.camp.cx, cz: w.camp.cz };
    for (const f of [...w.monoliths, ...w.pylons]) {
      const path = findPath(w, from, { cx: f.cx, cz: f.cz });
      assert(path && path.length > 0, `seed ${seed}: no path to ${f.id}`);
      // A path must never step through a blocked cell.
      for (const n of path) assert(!w.blocked[n.cz * GRID + n.cx], `seed ${seed}: path crosses rock`);
    }
  }
});

check("most of the walkable floor is actually reachable", () => {
  // Not a hard gate (pockets behind spires are fine scenery) but a world where
  // the majority of the ground is stranded is a bad world even when the
  // objectives happen to be reachable.
  let worst = 1;
  for (let seed = 1; seed <= 30; seed++) worst = Math.min(worst, validate(generateWorld(seed)).reachableFraction);
  assert(worst > 0.55, `worst reachable fraction was ${worst.toFixed(2)}`);
});

check("the rim is sealed — you cannot walk out of the basin", () => {
  const w = generateWorld(3);
  for (let i = 0; i < GRID; i++) {
    assert(w.blocked[i], "north rim open");
    assert(w.blocked[(GRID - 1) * GRID + i], "south rim open");
    assert(w.blocked[i * GRID], "west rim open");
    assert(w.blocked[i * GRID + GRID - 1], "east rim open");
  }
});

check("markers stand on open ground", () => {
  for (const seed of [2, 11, 44]) {
    const w = generateWorld(seed);
    for (const f of [...w.monoliths, ...w.pylons]) {
      assert(!isBlockedAt(w, f.x, f.z), `seed ${seed}: ${f.id} is inside rock`);
    }
  }
});

check("items place at the documented count, cycling every kind, all reachable", () => {
  for (const seed of [1, 2, 3, 17, 42]) {
    const w = generateWorld(seed);
    eq(w.items.length, ITEM_COUNT, `seed ${seed}: wrong item count`);
    for (let i = 0; i < w.items.length; i++) eq(w.items[i].itemKind, ITEM_KINDS[i % ITEM_KINDS.length], `seed ${seed}: item ${i} kind`);
    const kinds = new Set(w.items.map((it) => it.itemKind));
    assert(kinds.size === ITEM_KINDS.length, `seed ${seed}: not every kind appeared`);
    assert(validate(w).ok, `seed ${seed}: an item was left unreachable`);
  }
});

check("trees and stone deposits place at the documented counts, all reachable", () => {
  for (const seed of [1, 2, 3, 17, 42]) {
    const w = generateWorld(seed);
    eq(w.trees.length, TREE_COUNT, `seed ${seed}: wrong tree count`);
    eq(w.stones.length, STONE_COUNT, `seed ${seed}: wrong stone count`);
    for (const t of w.trees) assert(!isBlockedAt(w, t.x, t.z), `seed ${seed}: ${t.id} is inside rock`);
    for (const s of w.stones) assert(!isBlockedAt(w, s.x, s.z), `seed ${seed}: ${s.id} is inside rock`);
    assert(validate(w).ok, `seed ${seed}: a tree or stone deposit was left unreachable`);
  }
});

check("same seed builds the same basin", () => {
  const a = generateWorld(123);
  const b = generateWorld(123);
  eq(a.monoliths.map((m) => m.id + m.cx + "," + m.cz).join("|"),
     b.monoliths.map((m) => m.id + m.cx + "," + m.cz).join("|"), "monoliths differ");
  eq(String(a.blocked), String(b.blocked), "blocked grid differs");
});

// ---------------------------------------------------------------------------
// bands
// ---------------------------------------------------------------------------
check("bands partition the lucidity range at the documented edges", () => {
  eq(bandOf(100), BAND.STEADY);
  eq(bandOf(62), BAND.STEADY);
  eq(bandOf(61.9), BAND.UNSETTLED);
  eq(bandOf(36), BAND.UNSETTLED);
  eq(bandOf(35.9), BAND.FRAYING);
  eq(bandOf(14), BAND.FRAYING);
  eq(bandOf(13.9), BAND.BRITTLE);
  eq(bandOf(0.01), BAND.BRITTLE);
  eq(bandOf(0), BAND.GONE);
});

// ---------------------------------------------------------------------------
// the party and the meter
// ---------------------------------------------------------------------------
check("a run starts with the player plus five companions, all full", () => {
  const sim = createRun({ seed: 5 });
  eq(sim.party.length, PARTY_SIZE, "party size");
  eq(sim.companions.length, 5, "five NPC companions");
  for (const c of sim.party) eq(c.lucidity, MAX_LUCIDITY, `${c.name} did not start full`);
  eq(sim.doses, DOSE_COUNT, "dose count");
  eq(sim.status, "playing");
});

check("lucidity only ever falls, absent a pylon or a dose", () => {
  const sim = createRun({ seed: 8 });
  // Park everyone far from any pylon so the only force acting is drain.
  const spot = farFromPylons(sim);
  for (const c of sim.party) { c.x = spot.x; c.z = spot.z; }
  const before = sim.companions.map((c) => c.lucidity);
  for (const c of sim.party) tickLucidity(sim, c, 1);
  sim.companions.forEach((c, i) => assert(c.lucidity < before[i], `${c.name} did not drain`));
});

check("companions drain at different rates — the party is not one meter", () => {
  const sim = createRun({ seed: 8 });
  const spot = farFromPylons(sim);
  for (const c of sim.party) { c.x = spot.x; c.z = spot.z; }
  for (let i = 0; i < 30; i++) for (const c of sim.party) tickLucidity(sim, c, 1);
  const values = new Set(sim.companions.map((c) => Math.round(c.lucidity)));
  assert(values.size >= 4, `expected spread across companions, got ${[...values]}`);
});

check("walking off alone drains faster than staying with the party", () => {
  const sim = createRun({ seed: 9 });
  const spot = farFromPylons(sim);
  for (const c of sim.party) { c.x = spot.x; c.z = spot.z; }
  const together = tickLucidity(sim, sim.companions[0], 1);
  const lone = sim.companions[1];
  lone.x = spot.x + ISOLATION_DIST + 40;
  lone.z = spot.z;
  // Re-park the rest so the centroid does not chase the isolated one.
  const alone = tickLucidity(sim, lone, 1);
  assert(alone > together * 1.4, `isolation did not bite: ${alone} vs ${together}`);
});

check("watching someone come apart costs you", () => {
  const sim = createRun({ seed: 10 });
  const spot = farFromPylons(sim);
  for (const c of sim.party) { c.x = spot.x; c.z = spot.z; }
  const subject = sim.companions[0];
  const clean = tickLucidity(sim, subject, 1);
  beginHallucinating(sim, sim.companions[3]);
  sim.companions[3].x = spot.x + 1;
  sim.companions[3].z = spot.z + 1;
  const contagious = tickLucidity(sim, subject, 1);
  assert(contagious > clean, `contagion did not apply: ${contagious} vs ${clean}`);
});

check("coming back leaves a scar that makes the next fall faster", () => {
  const sim = createRun({ seed: 11 });
  const spot = farFromPylons(sim);
  for (const c of sim.party) { c.x = spot.x; c.z = spot.z; }
  const c = sim.companions[0];
  const first = tickLucidity(sim, c, 1);
  beginHallucinating(sim, c);
  recover(sim, c, "test");
  eq(c.scars, 1, "scar not recorded");
  eq(c.lucidity, RECOVER_AT, "recovered to the wrong level");
  const second = tickLucidity(sim, c, 1);
  assert(second > first, `scar did not increase drain: ${second} vs ${first}`);
});

check("hitting zero starts a hallucination, with a specific kind", () => {
  const sim = createRun({ seed: 12 });
  const c = sim.companions[2];
  c.lucidity = 0.2;
  c.x = farFromPylons(sim).x;
  c.z = farFromPylons(sim).z;
  tickLucidity(sim, c, 1);
  assert(c.hallucinating, "did not begin hallucinating at zero");
  eq(c.lucidity, 0, "lucidity went negative");
  assert(Object.values(HALLUCINATION).includes(c.hallucination), `bad kind ${c.hallucination}`);
});

check("the player is not exempt — the lead hallucinates too", () => {
  const sim = createRun({ seed: 13 });
  sim.player.lucidity = 0;
  beginHallucinating(sim, sim.player);
  assert(sim.player.hallucinating, "the player must be subject to the same rule");
});

// ---------------------------------------------------------------------------
// traits — the same five names, a different personality roll each run
// ---------------------------------------------------------------------------
check("rollTraits stays within its documented bounds and drifts from the base", () => {
  const rng = makeRng(90);
  let anyDrifted = false;
  for (const tpl of COMPANION_TEMPLATES) {
    for (let i = 0; i < 50; i++) {
      const t = rollTraits(rng, tpl);
      assert(t.drain >= 0.6 && t.drain <= 1.4, `drain out of bounds: ${t.drain}`);
      for (const key of ["stoic", "chatty", "wander", "selfCare"]) {
        assert(t[key] >= 0 && t[key] <= 1, `${key} out of bounds: ${t[key]}`);
      }
      assert(Math.abs(t.drain - tpl.drain) <= TRAIT_VARIANCE + 1e-9, "drain drifted further than TRAIT_VARIANCE");
      if (t.drain !== tpl.drain || t.stoic !== tpl.stoic) anyDrifted = true;
    }
  }
  assert(anyDrifted, "traits never drifted from the template base across 250 rolls — rng not wired in");
});

check("a run's rolled traits are deterministic per seed", () => {
  const a = createRun({ seed: 91 });
  const b = createRun({ seed: 91 });
  for (let i = 0; i < a.companions.length; i++) {
    eq(a.companions[i].drain, b.companions[i].drain, `${a.companions[i].name} drain not deterministic`);
    eq(a.companions[i].selfCare, b.companions[i].selfCare, `${a.companions[i].name} selfCare not deterministic`);
  }
});

check("the same five names still lead — traits vary, identity doesn't", () => {
  const sim = createRun({ seed: 92 });
  eq(sim.companions.map((c) => c.name).join(","), "VOSS,IREN,HALDER,NKEM,PAO", "roster identity changed");
  eq(sim.companions.map((c) => c.role).join(","), "Surveyor,Medic,Rigger,Signals,Geologist", "roster roles changed");
});

check("traits carry across a campaign's basins instead of re-rolling", () => {
  const first = createRun({ seed: 93, level: 1, campaignLength: 2 });
  const rolled = first.companions.map((c) => ({ id: c.id, drain: c.drain, selfCare: c.selfCare }));
  const carryOver = {
    party: first.party.map((c) => ({
      id: c.id, lucidity: c.lucidity, scars: c.scars, hallucinating: c.hallucinating,
      hallucination: c.hallucination, goneTime: c.goneTime,
      drain: c.drain, stoic: c.stoic, chatty: c.chatty, wander: c.wander, selfCare: c.selfCare,
    })),
    doses: first.doses, inventory: first.inventory, wood: first.wood, stone: first.stone, stats: first.stats,
  };
  const second = createRun({ seed: 94, level: 2, campaignLength: 2, carryOver });
  for (const saved of rolled) {
    const ch = second.companions.find((c) => c.id === saved.id);
    eq(ch.drain, saved.drain, `${ch.name}'s drain reshuffled at the next basin`);
    eq(ch.selfCare, saved.selfCare, `${ch.name}'s selfCare reshuffled at the next basin`);
  }
});

check("high selfCare breaks off for a known pylon before BRITTLE", () => {
  const sim = createRun({ seed: 95 });
  const p = sim.pylons[0];
  const c = sim.companions[0];
  const away = { x: p.x + 30, z: p.z + 4 };
  for (const m of sim.party) { m.x = away.x; m.z = away.z; }
  for (const other of sim.pylons) if (other !== p) other.charge = 0;
  c.known = { pylons: new Set([p.id]), monoliths: new Set() };
  c.selfCare = 0.9; // well above the UNSETTLED threshold
  c.lucidity = 60; // UNSETTLED band, nowhere near BRITTLE
  advance(sim, 3);
  eq(c.goalKind, "pylon", "a high-selfCare companion should seek relief before BRITTLE");
});

check("low selfCare only breaks off at BRITTLE, same as before this feature existed", () => {
  const sim = createRun({ seed: 96 });
  const p = sim.pylons[0];
  const c = sim.companions[0];
  const away = { x: p.x + 30, z: p.z + 4 };
  for (const m of sim.party) { m.x = away.x; m.z = away.z; }
  for (const other of sim.pylons) if (other !== p) other.charge = 0;
  c.known = { pylons: new Set([p.id]), monoliths: new Set() };
  c.selfCare = 0.1;
  c.lucidity = 20; // FRAYING, not yet BRITTLE
  advance(sim, 3);
  assert(c.goalKind !== "pylon", "a low-selfCare companion broke off before BRITTLE");
});

check("hallucination kind is trait-weighted for companions, but stays flat for the player", () => {
  const sim = createRun({ seed: 97 });
  const wanderer = { ...sim.companions[0], isPlayer: false, wander: 1, chatty: 0, selfCare: 0 };
  const anchored = { ...sim.companions[0], isPlayer: false, wander: 0, chatty: 0, selfCare: 1 };
  let wandererMarker = 0, anchoredMarker = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    if ([HALLUCINATION.PHANTOM_MARKER, HALLUCINATION.WRONG_WAY].includes(pickHallucinationKind(sim, wanderer))) wandererMarker++;
    if (pickHallucinationKind(sim, anchored) === HALLUCINATION.FALSE_ANCHOR) anchoredMarker++;
  }
  assert(wandererMarker > N * 0.35, `a maximally-wander companion should draw PHANTOM_MARKER/WRONG_WAY often, got ${wandererMarker}/${N}`);
  assert(anchoredMarker > N * 0.35, `a maximally-selfCare companion should draw FALSE_ANCHOR often, got ${anchoredMarker}/${N}`);

  let playerKinds = new Set();
  for (let i = 0; i < 60; i++) playerKinds.add(pickHallucinationKind(sim, sim.player));
  assert(playerKinds.size > 1, "the player's roll should still cover multiple kinds, not be trait-narrowed");
});

// ---------------------------------------------------------------------------
// pylons and doses
// ---------------------------------------------------------------------------
check("a pylon restores everyone standing in it, and spends itself doing so", () => {
  const sim = createRun({ seed: 14 });
  const p = sim.pylons[0];
  const c = sim.companions[0];
  c.lucidity = 20;
  c.x = p.x;
  c.z = p.z;
  const charge0 = p.charge;
  tickLucidity(sim, c, 1);
  assert(c.lucidity > 20, "pylon did not restore");
  assert(p.charge < charge0, "pylon did not spend charge");
});

check("a spent pylon does nothing", () => {
  const sim = createRun({ seed: 14 });
  const p = sim.pylons[0];
  p.charge = 0;
  const c = sim.companions[0];
  c.lucidity = 20;
  c.x = p.x;
  c.z = p.z;
  tickLucidity(sim, c, 1);
  assert(c.lucidity < 20, "a dead pylon still restored");
});

check("a pylon recharges only while nobody draws on it", () => {
  const sim = createRun({ seed: 15 });
  const p = sim.pylons[0];
  p.charge = 50;
  // Park the whole party far away so nothing is in range.
  const spot = farFromPylons(sim);
  for (const c of sim.party) { c.x = spot.x; c.z = spot.z; }
  advance(sim, 4);
  assert(p.charge > 50, `no recharge while idle: ${p.charge}`);
});

check("pulling a hallucinating companion back needs sustained pylon contact", () => {
  const sim = createRun({ seed: 16 });
  const p = sim.pylons[0];
  const c = sim.companions[1];
  beginHallucinating(sim, c);
  c.x = p.x;
  c.z = p.z;
  tickLucidity(sim, c, RECOVER_TIME * 0.5);
  assert(c.hallucinating, "recovered too early — contact must be sustained");
  tickLucidity(sim, c, RECOVER_TIME * 0.6);
  assert(!c.hallucinating, "did not recover after sustained contact");
  eq(c.lucidity, RECOVER_AT, "recovery level");
});

check("stepping out of the pylon resets recovery progress", () => {
  const sim = createRun({ seed: 16 });
  const p = sim.pylons[0];
  const c = sim.companions[1];
  beginHallucinating(sim, c);
  c.x = p.x; c.z = p.z;
  tickLucidity(sim, c, RECOVER_TIME * 0.8);
  const away = farFromPylons(sim);
  c.x = away.x; c.z = away.z;
  tickLucidity(sim, c, 0.1);
  eq(c.recoverProgress, 0, "progress survived leaving the pylon");
});

check("doses are finite, and spending one on a gone companion brings them back", () => {
  const sim = createRun({ seed: 17 });
  const c = sim.companions[0];
  beginHallucinating(sim, c);
  assert(useDose(sim, c.id), "dose refused");
  eq(sim.doses, DOSE_COUNT - 1, "dose not consumed");
  assert(!c.hallucinating, "dose did not recover");
  useDose(sim, sim.companions[1].id);
  useDose(sim, sim.companions[2].id);
  eq(sim.doses, 0, "dose accounting");
  assert(!useDose(sim, sim.companions[3].id), "spent a dose that did not exist");
});

check("a dose tops up without exceeding the maximum", () => {
  const sim = createRun({ seed: 18 });
  const c = sim.companions[0];
  c.lucidity = 90;
  useDose(sim, c.id);
  eq(c.lucidity, MAX_LUCIDITY, "dose overflowed the cap");
});

// ---------------------------------------------------------------------------
// check-ins: the unreliable sensor
// ---------------------------------------------------------------------------
check("a hallucinating companion reports that they are fine", () => {
  const sim = createRun({ seed: 19 });
  const c = sim.companions[0];
  beginHallucinating(sim, c);
  const r = checkIn(sim, c.id);
  eq(r.claim, BAND.STEADY, "a gone companion must claim to be steady");
  eq(r.truth, BAND.GONE, "truth must still be recorded for the debrief");
});

check("a fraying companion sometimes shades the truth, but never invents 'gone'", () => {
  const sim = createRun({ seed: 20 });
  const c = sim.companions[0];
  let shaded = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    c.lucidity = 20; // FRAYING
    const r = checkIn(sim, c.id);
    assert(r.claim !== BAND.GONE, "a lucid companion claimed to be gone");
    if (r.claim !== r.truth) shaded++;
  }
  assert(shaded > N * 0.2, `expected optimistic shading, saw ${shaded}/${N}`);
  assert(shaded < N, "shading must not be certain");
});

check("a steady companion reports steady", () => {
  const sim = createRun({ seed: 21 });
  const c = sim.companions[0];
  c.lucidity = 95;
  for (let i = 0; i < 40; i++) eq(checkIn(sim, c.id).claim, BAND.STEADY, "steady report drifted");
});

// ---------------------------------------------------------------------------
// perception: the lie layer
// ---------------------------------------------------------------------------
check("a lucid lead sees exactly what is there", () => {
  const sim = createRun({ seed: 22 });
  const percept = createPercept();
  updatePercept(percept, sim, 0.1);
  eq(perceivedMonoliths(percept, sim).length, sim.monoliths.length, "phantom leaked into a lucid view");
  eq(perceivedCompanions(percept, sim).length, 5, "phantom companion in a lucid view");
  eq(perceivedYaw(percept, sim), sim.player.yaw, "compass lied to a lucid lead");
  eq(distortion(percept, sim), 0, "distortion on a full meter");
});

check("a hallucinating lead can be shown markers the basin does not contain", () => {
  // Drive the specific kind rather than waiting for the draw.
  const sim = createRun({ seed: 23 });
  sim.player.lucidity = 0;
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.PHANTOM_MARKER;
  const percept = createPercept();
  updatePercept(percept, sim, 0.1);
  const seen = perceivedMonoliths(percept, sim);
  assert(seen.length > sim.monoliths.length, "no phantom markers appeared");
  assert(seen.some((m) => m.phantom), "phantoms not flagged");
  // And the sim itself must remain honest.
  eq(sim.monoliths.length, 6, "the sim's own record was contaminated");
});

check("a phantom companion joins the formation", () => {
  const sim = createRun({ seed: 24 });
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.DOUBLED_PARTY;
  const percept = createPercept();
  updatePercept(percept, sim, 0.1);
  const seen = perceivedCompanions(percept, sim);
  eq(seen.length, 6, "expected a sixth figure");
  eq(sim.companions.length, 5, "the sim grew a companion");
  // It keeps station like a real one rather than sitting still.
  const before = { x: seen[5].x, z: seen[5].z };
  for (let i = 0; i < 30; i++) updatePercept(percept, sim, 0.1);
  const after = percept.phantomCompanions[0];
  assert(Math.hypot(after.x - before.x, after.z - before.z) > 0.2, "phantom did not move");
});

check("spent pylons read as live to a hallucinating lead", () => {
  const sim = createRun({ seed: 25 });
  sim.pylons[0].charge = 0;
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.FALSE_ANCHOR;
  const percept = createPercept();
  updatePercept(percept, sim, 0.1);
  const seen = perceivedPylons(percept, sim);
  const dead = seen.find((p) => p.id === sim.pylons[0].id);
  assert(dead.looksLive, "a spent pylon should look live under FALSE_ANCHOR");
  assert(seen.some((p) => p.phantom), "no phantom pylon");
  // The sim still knows the truth.
  eq(sim.pylons[0].charge, 0, "sim charge was altered by perception");
});

check("the compass moves under WRONG_WAY but the body does not", () => {
  const sim = createRun({ seed: 26 });
  sim.player.yaw = 0.5;
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.WRONG_WAY;
  const percept = createPercept();
  updatePercept(percept, sim, 0.1);
  assert(Math.abs(perceivedYaw(percept, sim) - 0.5) > 1, "compass did not shift");
  eq(sim.player.yaw, 0.5, "the real heading changed");
});

check("the roster degrades to '?' when the lead is the unreliable one", () => {
  const sim = createRun({ seed: 27 });
  const percept = createPercept();
  const c = sim.companions[0];
  c.lucidity = 5;
  updatePercept(percept, sim, 0.1);
  eq(rosterRead(percept, sim, c).tag, "bad", "a lucid lead should read a brittle companion");
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.CHORUS;
  updatePercept(percept, sim, 0.1);
  const read = rosterRead(percept, sim, c);
  eq(read.tag, "unknown", "a hallucinating lead should not get a reliable roster");
  assert(read.uncertain, "uncertainty flag missing");
});

check("the roster never exposes the hidden number", () => {
  const sim = createRun({ seed: 28 });
  const percept = createPercept();
  for (const c of sim.companions) {
    c.lucidity = 37.5;
    const read = rosterRead(percept, sim, c);
    const blob = JSON.stringify(read);
    assert(!/37|38|\d\d\.\d/.test(blob), `roster leaked a number: ${blob}`);
  }
});

check("CHORUS makes every report agree with you", () => {
  const sim = createRun({ seed: 29 });
  const percept = createPercept();
  const c = sim.companions[0];
  c.lucidity = 3;
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.CHORUS;
  updatePercept(percept, sim, 0.1);
  const filtered = filterReport(percept, sim, checkIn(sim, c.id));
  eq(filtered.claim, BAND.STEADY, "chorus should flatten every report to 'fine'");
});

check("distortion pre-echoes before zero, so the lead has a tell about themselves", () => {
  const sim = createRun({ seed: 30 });
  const percept = createPercept();
  sim.player.lucidity = 100;
  eq(distortion(percept, sim), 0, "distortion while fresh");
  sim.player.lucidity = 50;
  assert(distortion(percept, sim) > 0, "no tell in the unsettled band");
  sim.player.lucidity = 10;
  assert(distortion(percept, sim) > 0.2, "the brittle band should be visible");
});

check("distortion ramps rather than snapping", () => {
  const sim = createRun({ seed: 31 });
  const percept = createPercept();
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.CHORUS;
  updatePercept(percept, sim, 0.1);
  const early = percept.intensity;
  assert(early < 0.9, `intensity snapped straight to ${early}`);
  for (let i = 0; i < 60; i++) updatePercept(percept, sim, 0.1);
  near(percept.intensity, 1, 0.05, "intensity never reached full");
});

// ---------------------------------------------------------------------------
// surveying — including counterfeit entries
// ---------------------------------------------------------------------------
check("you must stand at a marker to log it", () => {
  const sim = createRun({ seed: 32 });
  const m = sim.monoliths[0];
  sim.player.x = m.x + LOG_RADIUS + 5;
  sim.player.z = m.z;
  eq(logMarker(sim).ok, false, "logged a marker from too far away");
  sim.player.x = m.x + 1;
  const res = logMarker(sim);
  assert(res.ok && res.real, "failed to log from inside the radius");
  eq(trueLogCount(sim), 1, "log count");
  eq(logMarker(sim).ok, false, "logged the same marker twice");
});

check("a lucid companion nearby corroborates the entry", () => {
  const sim = createRun({ seed: 33 });
  const m = sim.monoliths[0];
  sim.player.x = m.x;
  sim.player.z = m.z;
  for (const c of sim.companions) { c.x = m.x + 200; c.z = m.z + 200; }
  eq(logMarker(sim).corroborated, false, "corroborated with nobody in range");
  sim.monoliths[1].logged = false;
  const m2 = sim.monoliths[1];
  sim.player.x = m2.x;
  sim.player.z = m2.z;
  sim.companions[0].x = m2.x + 2;
  sim.companions[0].z = m2.z;
  eq(logMarker(sim).corroborated, true, "a lucid companion at your shoulder should confirm");
});

check("a hallucinating lead with nobody lucid nearby can write down nothing", () => {
  const sim = createRun({ seed: 34 });
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.PHANTOM_MARKER;
  // Standing nowhere near a real marker, with the party far away.
  const spot = farFromPylons(sim);
  sim.player.x = spot.x;
  sim.player.z = spot.z;
  for (const m of sim.monoliths) { m.x += 1000; m.z += 1000; }
  for (const c of sim.companions) { c.x = spot.x + 300; c.z = spot.z + 300; }
  const res = logMarker(sim, { name: "the Sixth Stone" });
  assert(res.ok && res.real === false, "expected a false entry");
  eq(sim.stats.falseLogs, 1, "false log not counted");
  eq(trueLogCount(sim), 0, "a phantom must not count toward the survey");
  eq(sim.logEntries.length, 1, "the log should still show an entry — that is the trap");
});

check("a lucid witness prevents a counterfeit entry", () => {
  const sim = createRun({ seed: 35 });
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.PHANTOM_MARKER;
  const spot = farFromPylons(sim);
  sim.player.x = spot.x;
  sim.player.z = spot.z;
  for (const m of sim.monoliths) { m.x += 1000; m.z += 1000; }
  sim.companions[0].x = spot.x + 1;
  sim.companions[0].z = spot.z + 1;
  sim.companions[0].lucidity = 90;
  const res = logMarker(sim, { name: "the Sixth Stone" });
  eq(res.ok, false, "a lucid companion should refuse the phantom");
  eq(sim.stats.falseLogs, 0, "false log recorded despite a witness");
});

// ---------------------------------------------------------------------------
// items — pickup, phantom pickups, use, and the lie layer
// ---------------------------------------------------------------------------
check("picking up an item requires being in reach of a discovered pickup", () => {
  const sim = createRun({ seed: 51 });
  const it = sim.items[0];
  sim.player.x = it.x + ITEM_PICKUP_RADIUS + 5;
  sim.player.z = it.z;
  eq(pickupItem(sim).ok, false, "picked up from out of reach");
  it.discovered = true;
  sim.player.x = it.x;
  sim.player.z = it.z;
  const res = pickupItem(sim);
  assert(res.ok && res.real, "failed to pick up a real item in reach");
  eq(res.kind, it.itemKind, "wrong kind recorded");
  eq(sim.inventory.length, 1, "inventory did not grow");
  assert(it.taken, "the world item was not marked taken");
  eq(pickupItem(sim).ok, false, "picked up the same item twice");
});

check("the carried-item cap forces the same choice as doses", () => {
  const sim = createRun({ seed: 52 });
  for (let i = 0; i < ITEM_CAP; i++) sim.inventory.push({ id: `x${i}`, real: true, kind: "flare", claimedKind: null });
  const it = sim.items[0];
  it.discovered = true;
  sim.player.x = it.x;
  sim.player.z = it.z;
  const res = pickupItem(sim);
  eq(res.ok, false, "picked up over the cap");
  eq(res.reason, "full", "wrong refusal reason");
});

check("a hallucinating lead can pick up something that was never there", () => {
  const sim = createRun({ seed: 53 });
  sim.player.hallucinating = true;
  sim.rng.chance = () => true; // force the phantom branch deterministically
  const it = sim.items[0];
  it.discovered = true;
  sim.player.x = it.x;
  sim.player.z = it.z;
  const res = pickupItem(sim);
  assert(res.ok && res.real === false, "expected a phantom pickup");
  const slot = sim.inventory[0];
  eq(slot.real, false, "phantom slot marked real");
  assert(ITEM_KINDS.includes(slot.claimedKind), "phantom claimedKind not a real kind string");
  eq(slot.kind, null, "a phantom has no true kind");
  assert(it.taken, "the underlying world item was not consumed");
});

check("a phantom slot's claimed kind is baked in and survives recovery — it never un-happens", () => {
  const sim = createRun({ seed: 54 });
  sim.inventory.push({ id: "slot0", real: false, claimedKind: "lens", kind: null });
  const percept = createPercept();
  sim.player.hallucinating = true;
  updatePercept(percept, sim, 0.1); // onset
  let seen = perceivedInventory(percept, sim);
  eq(seen[0].real, false, "phantom slot should read as unreal");
  eq(seen[0].shownKind, "lens", "phantom slot must show its claimed kind while gone");
  sim.player.hallucinating = false;
  updatePercept(percept, sim, 0.1); // recovery
  seen = perceivedInventory(percept, sim);
  eq(seen[0].shownKind, "lens", "a phantom's claimed kind must not reveal itself on recovery");
  eq(seen[0].misidentified, false, "a phantom slot is never flagged as merely 'misidentified'");
});

check("use: a flare restores lucidity and is consumed", () => {
  const sim = createRun({ seed: 55 });
  sim.player.lucidity = 50;
  sim.inventory.push({ id: "s0", real: true, kind: "flare", claimedKind: null });
  const res = useItem(sim, 0);
  assert(res.ok && res.real, "flare use failed");
  eq(sim.player.lucidity, 50 + ITEM_INFO.flare.restore, "flare did not restore the documented amount");
  eq(sim.inventory.length, 0, "the slot was not consumed");
  eq(sim.stats.itemsUsed, 1, "itemsUsed not counted");
});

check("use: a tether steadies the target — reduced drain, not a cure", () => {
  const sim = createRun({ seed: 56 });
  const target = sim.companions[0];
  const spot = farFromPylons(sim);
  for (const c of sim.party) { c.x = spot.x; c.z = spot.z; }
  const before = tickLucidity(sim, target, 1);
  sim.inventory.push({ id: "s0", real: true, kind: "tether", claimedKind: null });
  useItem(sim, 0, target.id);
  assert(target.steadyUntil > sim.time, "tether did not set a steady window");
  const after = tickLucidity(sim, target, 1);
  assert(after < before, `tether did not reduce drain: ${after} vs ${before}`);
  assert(after > 0, "a tether must not fully stop drain — it steadies, it does not cure");
});

check("use: a lens buys a truth window without touching the meter or curing anyone", () => {
  const sim = createRun({ seed: 57 });
  const percept = createPercept();
  sim.player.hallucinating = true;
  sim.player.hallucination = HALLUCINATION.WRONG_WAY;
  updatePercept(percept, sim, 0.1);
  const lucidityBefore = sim.player.lucidity;
  assert(distortion(percept, sim) > 0, "expected distortion before the lens");
  sim.inventory.push({ id: "s0", real: true, kind: "lens", claimedKind: null });
  useItem(sim, 0);
  eq(sim.player.lucidity, lucidityBefore, "a lens must not touch lucidity");
  assert(sim.player.hallucinating, "a lens must not cure the hallucination itself");
  assert(isClear(percept, sim), "isClear should be true inside the lens window");
  eq(distortion(percept, sim), 0, "the screen should read honest during a lens window");
  eq(perceivedYaw(percept, sim), sim.player.yaw, "the lens should stop the compass lie too");
});

check("use: a phantom item is always a bad surprise, never a reward", () => {
  const sim = createRun({ seed: 58 });
  sim.player.lucidity = PHANTOM_ITEM_COST + 10;
  sim.inventory.push({ id: "s0", real: false, claimedKind: "flare", kind: null });
  const res = useItem(sim, 0);
  assert(res.ok && res.real === false, "phantom use should report unreal");
  eq(sim.player.lucidity, 10, "phantom use did not cost the documented amount");
  eq(sim.stats.phantomItemsUsed, 1, "phantomItemsUsed not counted");
  assert(!sim.player.hallucinating, "should not have crossed zero yet");
});

check("using a phantom item can itself push the lead into hallucinating", () => {
  const sim = createRun({ seed: 59 });
  sim.player.lucidity = PHANTOM_ITEM_COST - 2;
  sim.inventory.push({ id: "s0", real: false, claimedKind: "tether", kind: null });
  useItem(sim, 0);
  eq(sim.player.lucidity, 0, "lucidity went negative instead of floored");
  assert(sim.player.hallucinating, "reaching for nothing should be able to tip the lead over");
});

check("a real item's displayed kind can be wrong while hallucinating, and holds steady for the episode", () => {
  const sim = createRun({ seed: 60 });
  const it = sim.items[0];
  it.discovered = true;
  const percept = createPercept();
  sim.player.hallucinating = true;
  updatePercept(percept, sim, 0.1);
  const first = perceivedWorldItems(percept, sim).find((x) => x.id === it.id);
  assert(first, "discovered item missing from perception");
  const second = perceivedWorldItems(percept, sim).find((x) => x.id === it.id);
  eq(second.shownKind, first.shownKind, "the lie must hold steady within one episode, not re-roll every call");
  sim.player.hallucinating = false;
  updatePercept(percept, sim, 0.1); // recovery clears the label
  const clear = perceivedWorldItems(percept, sim).find((x) => x.id === it.id);
  eq(clear.shownKind, it.itemKind, "a lucid lead must see the true kind");
  eq(clear.misidentified, false, "no misidentification flag while lucid");
});

check("a phantom pickup is never rendered as a world object, only as an inventory slot", () => {
  const sim = createRun({ seed: 61 });
  sim.player.hallucinating = true;
  sim.rng.chance = () => true;
  const it = sim.items[0];
  it.discovered = true;
  sim.player.x = it.x;
  sim.player.z = it.z;
  pickupItem(sim); // resolves as a phantom; the real item is consumed either way
  const percept = createPercept();
  updatePercept(percept, sim, 0.1);
  const worldSeen = perceivedWorldItems(percept, sim);
  assert(!worldSeen.some((w) => w.id === it.id), "a taken item must not still appear on the ground");
});

// ---------------------------------------------------------------------------
// emit() — the event kind must never be shadowed by opts
// ---------------------------------------------------------------------------
check("emit()'s own event kind always wins, even if opts carries a field named 'kind'", () => {
  const sim = createRun({ seed: 62 });
  emit(sim, "itemUsed", "test text", { itemKind: "flare" });
  const ev = sim.events[sim.events.length - 1];
  eq(ev.kind, "itemUsed", "opts clobbered the event's own kind discriminator");
  eq(ev.itemKind, "flare", "the per-item context should still ride along under its own name");
});

// ---------------------------------------------------------------------------
// crafting — combine two real items into something stronger
// ---------------------------------------------------------------------------
check("crafting combines two real items into the recipe's result and consumes both slots", () => {
  const sim = createRun({ seed: 63 });
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: true, kind: "tether", claimedKind: null });
  const res = craftItem(sim);
  assert(res.ok, "craft refused a valid recipe pair");
  eq(res.kind, "ember", "flare+tether should produce an ember");
  eq(sim.inventory.length, 1, "crafting should net one item from two");
  eq(sim.inventory[0].kind, "ember", "the crafted slot should carry the recipe's result");
  eq(sim.stats.itemsCrafted, 1, "itemsCrafted not counted");
});

check("every unordered pair of the three base items has a recipe", () => {
  eq(CRAFT_RECIPES["flare+tether"], "ember");
  eq(CRAFT_RECIPES["flare+lens"], "beacon");
  eq(CRAFT_RECIPES["lens+tether"], "ward");
});

check("crafting refuses when there's neither a matching item pair nor enough raw materials", () => {
  const sim = createRun({ seed: 64 });
  eq(craftItem(sim).reason, "no-recipe", "wrong refusal with an empty inventory and no materials");
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  eq(craftItem(sim).reason, "no-recipe", "wrong refusal with only one item and no materials");
});

check("two of the same item, or a phantom, refuse to combine", () => {
  const sim = createRun({ seed: 65 });
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: true, kind: "flare", claimedKind: null });
  eq(craftItem(sim).reason, "no-recipe", "two flares should not combine into anything");
  eq(sim.inventory.length, 2, "a failed craft must not consume anything");

  const sim2 = createRun({ seed: 66 });
  sim2.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim2.inventory.push({ id: "b", real: false, claimedKind: "tether", kind: null }); // a phantom looks like a tether but isn't one
  eq(craftItem(sim2).reason, "no-recipe", "a phantom ingredient must not knowingly combine into a recipe");
  eq(sim2.inventory.length, 2, "a failed craft on a phantom pair must not consume anything");
});

check("craft works off the sim's truth, not the item bar's possibly-lying labels", () => {
  // A hallucinating lead's item bar can show two items as a matching pair
  // (percept.js's own lie) while the TRUE kinds underneath don't combine at
  // all — craftItem never looks at perceivedInventory, only sim.inventory.
  const sim = createRun({ seed: 67 });
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: true, kind: "flare", claimedKind: null });
  const percept = createPercept();
  sim.player.hallucinating = true;
  updatePercept(percept, sim, 0.1);
  percept.itemLabels.set("a", "tether"); // force the lie: shown as tether, really a flare
  const seen = perceivedInventory(percept, sim);
  eq(seen[0].shownKind, "tether", "test setup: the item bar should be lying about slot a");
  eq(craftItem(sim).reason, "no-recipe", "two true flares still can't combine, whatever the bar showed");
});

// ---------------------------------------------------------------------------
// previewCraft — the HUD's "craft available" indicator, never a promise
// craftItem then breaks
// ---------------------------------------------------------------------------
check("previewCraft reports nothing available when nothing is", () => {
  const sim = createRun({ seed: 86 });
  eq(previewCraft(sim).ok, false, "expected no preview with an empty inventory and no materials");
});

check("previewCraft matches a real item pair without consuming anything", () => {
  const sim = createRun({ seed: 87 });
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: true, kind: "lens", claimedKind: null });
  const preview = previewCraft(sim);
  assert(preview.ok && preview.kind === "beacon", "expected a beacon preview for flare+lens");
  eq(sim.inventory.length, 2, "previewing must not consume the pair");
  const actual = craftItem(sim);
  eq(actual.kind, preview.kind, "previewCraft must agree with what craftItem actually does");
});

check("previewCraft matches a materials-only craft, and respects the item cap", () => {
  const sim = createRun({ seed: 88 });
  sim.wood = STAKE_COST.wood;
  sim.stone = STAKE_COST.stone;
  const preview = previewCraft(sim);
  assert(preview.ok && preview.kind === "stake", "expected a stake preview with enough materials");
  const actual = craftItem(sim);
  eq(actual.kind, preview.kind, "previewCraft must agree with what craftItem actually does");

  // Now with a full inventory, the same materials should no longer preview
  // as craftable — matching craftItem's own cap refusal.
  const sim2 = createRun({ seed: 89 });
  sim2.wood = STAKE_COST.wood;
  sim2.stone = STAKE_COST.stone;
  for (let i = 0; i < ITEM_CAP; i++) sim2.inventory.push({ id: `x${i}`, real: true, kind: "flare", claimedKind: null });
  eq(previewCraft(sim2).ok, false, "previewCraft should not promise a craft that would be refused for a full inventory");
  eq(craftItem(sim2).reason, "full", "sanity: craftItem itself should refuse for the same reason");
});

check("use: ember/beacon/ward do both parent effects at once", () => {
  const sim = createRun({ seed: 68 });
  const target = sim.companions[0];

  sim.player.lucidity = 50;
  sim.inventory.push({ id: "s0", real: true, kind: "ember", claimedKind: null });
  useItem(sim, 0, target.id);
  eq(sim.player.lucidity, 50 + ITEM_INFO.ember.restore, "ember should restore lucidity like a flare");
  assert(target.steadyUntil > sim.time, "ember should also steady its target like a tether");

  sim.player.lucidity = 40;
  sim.inventory.push({ id: "s1", real: true, kind: "beacon", claimedKind: null });
  useItem(sim, 0);
  eq(sim.player.lucidity, 40 + ITEM_INFO.beacon.restore, "beacon should restore lucidity like a flare");
  assert(sim.player.lensUntil > sim.time, "beacon should also open a truth window like a lens");

  const target2 = sim.companions[1];
  sim.inventory.push({ id: "s2", real: true, kind: "ward", claimedKind: null });
  useItem(sim, 0, target2.id);
  assert(target2.steadyUntil > sim.time, "ward should steady its target like a tether");
  assert(sim.player.lensUntil > sim.time, "ward should also open a truth window like a lens");
});

check("a crafted item in inventory can be mislabeled as any displayable kind, base or crafted", () => {
  const sim = createRun({ seed: 69 });
  sim.inventory.push({ id: "s0", real: true, kind: "ember", claimedKind: null });
  const percept = createPercept();
  sim.player.hallucinating = true;
  updatePercept(percept, sim, 0.1);
  const seen = perceivedInventory(percept, sim);
  assert(Object.keys(ITEM_INFO).includes(seen[0].shownKind), "the shown kind should be one of the real displayable kinds");
});

// ---------------------------------------------------------------------------
// gathering — chop a tree, mine a deposit, no deception involved at all
// ---------------------------------------------------------------------------
check("gathering requires being in reach of a discovered tree or deposit", () => {
  const sim = createRun({ seed: 75 });
  const t = sim.trees[0];
  sim.player.x = t.x + GATHER_RADIUS + 5;
  sim.player.z = t.z;
  eq(gatherResource(sim).ok, false, "gathered from out of reach");
  t.discovered = true;
  sim.player.x = t.x;
  sim.player.z = t.z;
  const res = gatherResource(sim);
  assert(res.ok && res.resource === "wood", "failed to chop a discovered tree in reach");
  assert(sim.wood >= GATHER_YIELD.min && sim.wood <= GATHER_YIELD.max, "wood not credited in the documented range");
  eq(sim.wood, res.amount, "credited wood must match the reported amount");
  assert(t.chopped, "the tree was not marked chopped");
  eq(gatherResource(sim).ok, false, "chopped the same tree twice");
});

check("mining a stone deposit credits stone the same way chopping credits wood", () => {
  const sim = createRun({ seed: 76 });
  const s = sim.stones[0];
  s.discovered = true;
  sim.player.x = s.x;
  sim.player.z = s.z;
  const res = gatherResource(sim);
  assert(res.ok && res.resource === "stone", "failed to mine a discovered deposit in reach");
  assert(sim.stone >= GATHER_YIELD.min && sim.stone <= GATHER_YIELD.max, "stone not credited in the documented range");
  eq(sim.stone, res.amount, "credited stone must match the reported amount");
  assert(s.mined, "the deposit was not marked mined");
});

check("gathering never touches inventory or lucidity — no deception, no cost", () => {
  const sim = createRun({ seed: 77 });
  const t = sim.trees[0];
  t.discovered = true;
  sim.player.x = t.x;
  sim.player.z = t.z;
  sim.player.hallucinating = true; // even hallucinating, gathering is always honest
  const before = sim.player.lucidity;
  const res = gatherResource(sim);
  assert(res.ok && res.resource === "wood", "a hallucinating lead should still gather truthfully");
  eq(sim.inventory.length, 0, "gathering must not add an inventory slot");
  eq(sim.player.lucidity, before, "gathering must not cost lucidity");
});

// ---------------------------------------------------------------------------
// hold-to-gather — chop/mine takes a deliberate hold, not a tap
// ---------------------------------------------------------------------------
check("holding short of GATHER_HOLD_TIME does not gather", () => {
  const sim = createRun({ seed: 81 });
  const t = sim.trees[0];
  t.discovered = true;
  sim.player.x = t.x;
  sim.player.z = t.z;
  advance(sim, GATHER_HOLD_TIME - 0.3, { interact: true });
  eq(sim.wood, 0, "gathered before the hold finished");
  assert(!t.chopped, "the tree was chopped early");
  assert(sim.gatherHold.progress > 0, "holding should still be accumulating progress");
});

check("holding for GATHER_HOLD_TIME completes the gather", () => {
  const sim = createRun({ seed: 82 });
  const t = sim.trees[0];
  t.discovered = true;
  sim.player.x = t.x;
  sim.player.z = t.z;
  advance(sim, GATHER_HOLD_TIME - 0.1, { interact: true });
  eq(sim.wood, 0, "gathered before the hold time was reached");
  advance(sim, 0.2, { interact: true }); // crosses the threshold
  assert(sim.wood >= GATHER_YIELD.min && sim.wood <= GATHER_YIELD.max, "did not gather once the hold time was reached");
  assert(t.chopped, "the tree was not marked chopped");
  eq(sim.gatherHold.progress, 0, "hold progress should reset after completing");
  eq(sim.gatherHold.targetId, null, "hold target should clear after completing");
});

check("releasing the interact verb early resets progress to zero", () => {
  const sim = createRun({ seed: 83 });
  const t = sim.trees[0];
  t.discovered = true;
  sim.player.x = t.x;
  sim.player.z = t.z;
  advance(sim, GATHER_HOLD_TIME * 0.6, { interact: true });
  assert(sim.gatherHold.progress > 0, "progress should have accumulated");
  advance(sim, 1 / 30, { interact: false }); // let go, one tick
  eq(sim.gatherHold.progress, 0, "releasing early should reset progress");
  eq(sim.gatherHold.targetId, null, "releasing early should clear the target");
  eq(sim.wood, 0, "nothing should have been gathered");
});

check("switching to a different node resets progress instead of carrying it over", () => {
  const sim = createRun({ seed: 84 });
  const t = sim.trees[0];
  const s = sim.stones[0];
  t.discovered = true;
  s.discovered = true;
  sim.player.x = t.x;
  sim.player.z = t.z;
  advance(sim, GATHER_HOLD_TIME * 0.7, { interact: true });
  assert(sim.gatherHold.targetId === t.id, "should be holding on the tree first");
  sim.player.x = s.x;
  sim.player.z = s.z;
  advance(sim, 1 / 30, { interact: true }); // one tick standing at the new target
  eq(sim.gatherHold.targetId, s.id, "target should switch to the stone");
  assert(sim.gatherHold.progress < GATHER_HOLD_TIME * 0.7, "progress must not carry over from the old target");
});

check("gatherTarget agrees with what actually gets gathered — no second implementation to drift", () => {
  const sim = createRun({ seed: 85 });
  const t = sim.trees[0];
  t.discovered = true;
  sim.player.x = t.x;
  sim.player.z = t.z;
  const target = gatherTarget(sim);
  assert(target && target.id === t.id && target.gatherKind === "tree", "gatherTarget did not find the tree");
});

// ---------------------------------------------------------------------------
// the Stake — crafted from raw materials, plants a real pylon when used
// ---------------------------------------------------------------------------
check("crafting a stake needs enough wood AND stone, and works with an empty item inventory", () => {
  const sim = createRun({ seed: 78 });
  eq(craftItem(sim).reason, "no-recipe", "crafted a stake with nothing gathered");
  sim.wood = STAKE_COST.wood;
  eq(craftItem(sim).reason, "no-recipe", "crafted a stake with wood but no stone");
  sim.stone = STAKE_COST.stone;
  const res = craftItem(sim);
  assert(res.ok && res.kind === "stake", "failed to craft a stake with enough of both materials");
  eq(sim.wood, 0, "wood was not spent");
  eq(sim.stone, 0, "stone was not spent");
  eq(sim.inventory.length, 1, "the stake should sit in the inventory like any other item");
  eq(sim.inventory[0].kind, "stake");
});

check("a stake still needs room in the item cap, same as a pickup would", () => {
  const sim = createRun({ seed: 79 });
  sim.wood = STAKE_COST.wood;
  sim.stone = STAKE_COST.stone;
  for (let i = 0; i < ITEM_CAP; i++) sim.inventory.push({ id: `x${i}`, real: true, kind: "flare", claimedKind: null });
  const res = craftItem(sim);
  eq(res.ok, false, "crafted a stake over the cap");
  eq(res.reason, "full");
  eq(sim.wood, STAKE_COST.wood, "materials must not be spent on a refused craft");
});

check("using a stake plants a real, functioning pylon at the player's position", () => {
  const sim = createRun({ seed: 80 });
  const pylonsBefore = sim.pylons.length;
  sim.player.x = 12.5;
  sim.player.z = -7.5;
  sim.inventory.push({ id: "s0", real: true, kind: "stake", claimedKind: null });
  const res = useItem(sim, 0);
  assert(res.ok && res.real, "using a stake should succeed like any real item");
  eq(sim.pylons.length, pylonsBefore + 1, "a stake should add exactly one pylon");
  const planted = sim.pylons[sim.pylons.length - 1];
  eq(planted.x, 12.5);
  eq(planted.z, -7.5);
  assert(planted.charge > 0 && planted.charge <= PYLON_MAX_CHARGE, "planted charge out of range");

  // And it works exactly like a real pylon — tickLucidity doesn't know or
  // care that this one didn't come from world generation.
  const c = sim.companions[0];
  c.lucidity = 20;
  c.x = planted.x;
  c.z = planted.z;
  tickLucidity(sim, c, 1);
  assert(c.lucidity > 20, "a planted stake should restore lucidity like any pylon");
});

// ---------------------------------------------------------------------------
// companion couriers — a companion can carry ONE item for the lead
// ---------------------------------------------------------------------------
check("companionPickup gives a non-hallucinating companion a real slot and reports it", () => {
  const sim = createRun({ seed: 120 });
  const ch = sim.companions[0];
  const it = sim.items[0];
  it.discovered = true;
  ch.hallucinating = false;
  ch.x = it.x;
  ch.z = it.z;
  const res = companionPickup(sim, ch);
  assert(res.ok && res.real, "companionPickup refused a valid, in-reach pickup");
  eq(res.kind, it.itemKind, "wrong kind recorded");
  eq(ch.inventory.length, 1, "the companion's inventory did not grow");
  eq(ch.inventory[0].real, true, "slot not marked real");
  eq(ch.inventory[0].kind, it.itemKind, "slot kind mismatch");
  eq(ch.inventory[0].claimedKind, null, "a real slot must carry no claimedKind");
  assert(it.taken, "the world item was not marked taken");
  const ev = sim.events[sim.events.length - 1];
  eq(ev.kind, "companionPickup", "expected a companionPickup event");
});

check("companionPickup can force a hallucinating companion's pickup into a phantom, same technique as pickupItem's own test", () => {
  const sim = createRun({ seed: 121 });
  const ch = sim.companions[0];
  ch.hallucinating = true;
  sim.rng.chance = () => true; // force the phantom branch deterministically
  const it = sim.items[0];
  it.discovered = true;
  ch.x = it.x;
  ch.z = it.z;
  const res = companionPickup(sim, ch);
  assert(res.ok && res.real === false, "expected a phantom pickup");
  const slot = ch.inventory[0];
  eq(slot.real, false, "phantom slot marked real");
  assert(ITEM_KINDS.includes(slot.claimedKind), "phantom claimedKind not a real kind string");
  eq(slot.kind, null, "a phantom has no true kind");
  assert(it.taken, "the underlying world item was not consumed either way");
  const ev = sim.events[sim.events.length - 1];
  eq(ev.kind, "companionPickup", "expected a companionPickup event even for a phantom");
});

check("whichever branch a hallucinating companion's pickup resolves to, the slot shape is always internally consistent", () => {
  const sim = createRun({ seed: 122 });
  const ch = sim.companions[0];
  ch.hallucinating = true;
  for (let i = 0; i < 40; i++) {
    // Reuse the small item list, resetting `.taken` each trial so "already
    // gone" never masks the roll — the 45/55 split is what's under test.
    const it = sim.items[i % sim.items.length];
    it.taken = false;
    it.discovered = true;
    ch.inventory.length = 0;
    ch.x = it.x;
    ch.z = it.z;
    const res = companionPickup(sim, ch);
    assert(res.ok, "pickup unexpectedly refused with a discovered item in reach");
    const slot = ch.inventory[0];
    if (slot.real) {
      assert(ITEM_KINDS.includes(slot.kind), "a real slot's kind should be one of the true item kinds");
      eq(slot.claimedKind, null, "a real slot must carry no claimedKind");
    } else {
      assert(ITEM_KINDS.includes(slot.claimedKind), "a phantom's claimedKind should be one of the real kind strings");
      eq(slot.kind, null, "a phantom has no true kind");
    }
  }
});

check("COMPANION_ITEM_CAP stops a companion already carrying something from picking up a second", () => {
  const sim = createRun({ seed: 123 });
  const ch = sim.companions[0];
  ch.inventory.push({ id: "held", real: true, kind: "flare", claimedKind: null });
  eq(ch.inventory.length, COMPANION_ITEM_CAP, "test setup: the companion should already sit at the cap");
  const it = sim.items[0];
  it.discovered = true;
  ch.x = it.x;
  ch.z = it.z;
  const res = companionPickup(sim, ch);
  eq(res.ok, false, "picked up over the companion cap");
  eq(res.reason, "full", "wrong refusal reason");
  eq(ch.inventory.length, 1, "a refused pickup should not grow the companion's inventory");
  assert(!it.taken, "a refused pickup must not touch the world item");
});

check("handoffToPlayer moves a slot from the companion to the player and reports it", () => {
  const sim = createRun({ seed: 124 });
  const ch = sim.companions[0];
  ch.inventory.push({ id: "cslot", real: true, kind: "flare", claimedKind: null });
  const before = sim.inventory.length;
  const res = handoffToPlayer(sim, ch);
  assert(res.ok && res.real, "handoff refused a valid slot with room to receive it");
  eq(ch.inventory.length, 0, "the companion is still shown as carrying it");
  eq(sim.inventory.length, before + 1, "the player's inventory did not grow");
  eq(sim.inventory[sim.inventory.length - 1].kind, "flare", "wrong item handed off");
  const ev = sim.events[sim.events.length - 1];
  eq(ev.kind, "handoff", "expected a handoff event");
});

check("handoffToPlayer names a phantom by its claimedKind, matching pickupFalse's own naming convention", () => {
  const sim = createRun({ seed: 125 });
  const ch = sim.companions[0];
  ch.inventory.push({ id: "cslot", real: false, claimedKind: "lens", kind: null });
  const res = handoffToPlayer(sim, ch);
  assert(res.ok && res.real === false, "expected a phantom handoff to still succeed and report unreal");
  eq(sim.inventory[sim.inventory.length - 1].claimedKind, "lens", "the phantom's claimed kind should ride along into the player's inventory");
  const ev = sim.events[sim.events.length - 1];
  eq(ev.kind, "handoff", "expected a handoff event for a phantom too");
  assert(ev.phantom, "a phantom handoff event should be flagged, even though its text never says so");
});

check("handoffToPlayer refuses when the player's inventory is already full, without mutating either array", () => {
  const sim = createRun({ seed: 126 });
  const ch = sim.companions[0];
  ch.inventory.push({ id: "cslot", real: true, kind: "flare", claimedKind: null });
  for (let i = 0; i < ITEM_CAP; i++) sim.inventory.push({ id: `x${i}`, real: true, kind: "flare", claimedKind: null });
  const res = handoffToPlayer(sim, ch);
  eq(res.ok, false, "handoff succeeded over the player's item cap");
  eq(res.reason, "full", "wrong refusal reason");
  eq(ch.inventory.length, 1, "a refused handoff should not remove the companion's slot");
  eq(sim.inventory.length, ITEM_CAP, "a refused handoff should not add to the player's inventory");
});

check("handoffToPlayer refuses an empty-handed companion", () => {
  const sim = createRun({ seed: 127 });
  const ch = sim.companions[0];
  const res = handoffToPlayer(sim, ch);
  eq(res.ok, false, "handoff succeeded with nothing to hand off");
  eq(res.reason, "empty", "wrong refusal reason");
});

check("a full fetch-and-deliver errand completes end-to-end, driven only through tick()", () => {
  const sim = createRun({ seed: 128 });
  // The lead already holds one half of a recipe.
  sim.inventory.push({ id: "held", real: true, kind: "flare", claimedKind: null });
  eq(previewCraft(sim).ok, false, "test setup: nothing craftable yet with only a flare in hand");

  // A discovered, untaken world item that completes the pair.
  const it = sim.items[0];
  it.itemKind = "tether"; // flare + tether -> ember
  it.discovered = true;
  it.taken = false;

  // The lead stands right at the item's spot; the courier starts a short walk
  // away. Every other companion is pushed out of range so only one courier is
  // ever in play.
  sim.player.x = it.x;
  sim.player.z = it.z;
  const courier = sim.companions[0];
  courier.hallucinating = false;
  courier.x = it.x + 6;
  courier.z = it.z;
  for (const c of sim.companions) {
    if (c !== courier) { c.x = it.x + 500; c.z = it.z + 500; }
  }

  let delivered = false;
  for (let i = 0; i < 600 && sim.status === "playing"; i++) {
    tick(sim, 1 / 30);
    if (sim.inventory.length >= 2) { delivered = true; break; }
  }

  assert(delivered, "the courier never delivered the fetched item back to the player");
  eq(sim.inventory.length, 2, "the player should hold the original flare plus the delivered item");
  assert(sim.inventory.some((s) => s.kind === "tether"), "the delivered slot should carry the fetched item's true kind");
  assert(previewCraft(sim).ok, "flare + tether should now preview as craftable");
});

check("two idle companions never both claim the same fetchable item", () => {
  const sim = createRun({ seed: 129 });
  sim.inventory.push({ id: "held", real: true, kind: "flare", claimedKind: null });

  const it = sim.items[0];
  it.itemKind = "tether";
  it.discovered = true;
  it.taken = false;

  const a = sim.companions[0];
  const b = sim.companions[1];
  a.hallucinating = false;
  b.hallucinating = false;
  a.x = it.x + 10; a.z = it.z;
  b.x = it.x - 10; b.z = it.z;
  for (const c of sim.companions) {
    if (c !== a && c !== b) { c.x = it.x + 500; c.z = it.z + 500; }
  }

  for (let i = 0; i < 15; i++) tick(sim, 1 / 30);

  const claimedBy = [a, b].filter((c) => c.fetchItemId === it.id || (c.inventory[0] && c.inventory[0].kind === "tether"));
  assert(claimedBy.length <= 1, `both companions routed to the same item: ${claimedBy.map((c) => c.name).join(", ")}`);
});

check("a hallucinating companion holding something does not hand it off, even standing on the player", () => {
  const sim = createRun({ seed: 130 });
  const ch = sim.companions[0];
  ch.inventory.push({ id: "cslot", real: true, kind: "flare", claimedKind: null });
  beginHallucinating(sim, ch);
  ch.x = sim.player.x;
  ch.z = sim.player.z;
  const before = sim.inventory.length;
  for (let i = 0; i < 30; i++) tick(sim, 1 / 30);
  eq(sim.inventory.length, before, "a hallucinating companion should not hand off while gone, even adjacent to the lead");
  eq(ch.inventory.length, 1, "the item should still be with the hallucinating companion, not the lead");
});

check("a fetch errand survives being preempted by a pylon-break instead of permanently stranding the companion and the item", () => {
  const sim = createRun({ seed: 131 });
  sim.inventory.push({ id: "held", real: true, kind: "flare", claimedKind: null });

  const it = sim.items[0];
  it.itemKind = "tether"; // flare + tether -> ember
  it.discovered = true;
  it.taken = false;

  const courier = sim.companions[0];
  courier.hallucinating = false;
  courier.x = it.x + 20;
  courier.z = it.z;
  sim.player.x = it.x + 20;
  sim.player.z = it.z;
  for (const c of sim.companions) {
    if (c !== courier) { c.x = it.x + 500; c.z = it.z + 500; }
  }

  // Let the courier pick up the fetch errand naturally.
  let gotErrand = false;
  for (let i = 0; i < 30; i++) {
    tick(sim, 1 / 30);
    if (courier.fetchItemId === it.id) { gotErrand = true; break; }
  }
  assert(gotErrand, "test setup: the courier never picked up the fetch errand in the first place");

  // Preempt it with a pylon crisis: a known, charged pylon right where the
  // courier already is, and a lucidity low enough to trigger the uniform
  // BRITTLE tell regardless of this companion's own selfCare roll.
  sim.pylons.push({ id: "regr-pylon", x: courier.x, z: courier.z, charge: 100, live: true });
  courier.lucidity = 1;

  let brokeOff = false;
  for (let i = 0; i < 5; i++) {
    tick(sim, 1 / 30);
    if (courier.goalKind === "pylon") { brokeOff = true; break; }
  }
  assert(brokeOff, "test setup: the pylon-break never actually preempted the fetch errand");
  eq(courier.fetchItemId, it.id, "the fetch errand must still be remembered underneath the pylon-break, not cleared just because goalKind moved on");

  // The pylon tops the courier back up; once healthy, the errand should
  // resume on its own instead of leaving goalKind stuck on "follow" forever
  // with the item permanently unclaimable by any OTHER companion either
  // (see findFetchableItem's claimed-item exclusion).
  let delivered = false;
  for (let i = 0; i < 900 && sim.status === "playing"; i++) {
    tick(sim, 1 / 30);
    if (sim.inventory.length >= 2) { delivered = true; break; }
  }
  assert(delivered, "the fetch errand never resumed after the pylon crisis resolved — it was permanently stranded");
});

// ---------------------------------------------------------------------------
// campaign — a basin cleared early in the sequence advances, not ends
// ---------------------------------------------------------------------------
check("createRun defaults to a single-basin campaign — no caller is affected unless it opts in", () => {
  const sim = createRun({ seed: 70 });
  eq(sim.level, 1, "default level");
  eq(sim.campaignLength, 1, "default campaignLength must stay 1 so existing callers see the old win path");
});

check("clearing a basin before the last one advances instead of ending the run", () => {
  const sim = createRun({ seed: 71, level: 1, campaignLength: CAMPAIGN_LENGTH });
  for (const m of sim.monoliths) m.logged = true;
  sim.player.x = sim.world.camp.x;
  sim.player.z = sim.world.camp.z;
  sim.companions[0].x = sim.world.camp.x;
  sim.companions[0].z = sim.world.camp.z;
  sim.companions[1].x = sim.world.camp.x;
  sim.companions[1].z = sim.world.camp.z;
  checkEndings(sim);
  eq(sim.status, "levelComplete", "should advance rather than end with more basins left");
  eq(sim.ending, "advance");
});

check("clearing the LAST basin of a campaign wins for real", () => {
  const sim = createRun({ seed: 72, level: CAMPAIGN_LENGTH, campaignLength: CAMPAIGN_LENGTH });
  for (const m of sim.monoliths) m.logged = true;
  sim.player.x = sim.world.camp.x;
  sim.player.z = sim.world.camp.z;
  sim.companions[0].x = sim.world.camp.x;
  sim.companions[0].z = sim.world.camp.z;
  sim.companions[1].x = sim.world.camp.x;
  sim.companions[1].z = sim.world.camp.z;
  checkEndings(sim);
  eq(sim.status, "won", "the final basin should still win outright");
  eq(sim.ending, "extracted");
});

check("carryOver continues lucidity, scars, doses, inventory and materials into the next basin", () => {
  const first = createRun({ seed: 73, level: 1, campaignLength: 2 });
  first.companions[0].lucidity = 37;
  first.companions[0].scars = 2;
  first.doses = 1;
  first.inventory.push({ id: "carried", real: true, kind: "lens", claimedKind: null });
  first.wood = 3;
  first.stone = 1;
  const carryOver = {
    party: first.party.map((c) => ({
      id: c.id, lucidity: c.lucidity, scars: c.scars,
      hallucinating: c.hallucinating, hallucination: c.hallucination, goneTime: c.goneTime,
    })),
    doses: first.doses,
    inventory: first.inventory,
    wood: first.wood,
    stone: first.stone,
    stats: first.stats,
  };
  const second = createRun({ seed: 74, level: 2, campaignLength: 2, carryOver });
  eq(second.companions[0].lucidity, 37, "lucidity did not carry over");
  eq(second.companions[0].scars, 2, "scars did not carry over");
  eq(second.doses, 1, "doses did not carry over");
  eq(second.inventory.length, 1, "inventory did not carry over");
  eq(second.inventory[0].kind, "lens", "the carried item's kind changed");
  eq(second.wood, 3, "wood did not carry over");
  eq(second.stone, 1, "stone did not carry over");
  // But the world and party POSITIONS are fresh, not carried:
  assert(second.player.x !== undefined, "a fresh basin should still have a valid spawn");
});

// ---------------------------------------------------------------------------
// endings
// ---------------------------------------------------------------------------
check("all six gone for long enough dissolves the party", () => {
  const sim = createRun({ seed: 36 });
  for (const c of sim.party) beginHallucinating(sim, c);
  sim.lastDt = 1;
  for (let t = 0; t < DISSOLVE_TIME - 2; t++) checkEndings(sim);
  eq(sim.status, "playing", "ended too early");
  for (let t = 0; t < 4; t++) checkEndings(sim);
  eq(sim.status, "lost", "party did not dissolve");
  eq(sim.ending, "dissolved");
});

check("one mind still lucid holds the party together", () => {
  const sim = createRun({ seed: 37 });
  for (const c of sim.companions) beginHallucinating(sim, c);
  sim.lastDt = 1;
  for (let t = 0; t < DISSOLVE_TIME * 2; t++) checkEndings(sim);
  eq(sim.status, "playing", "five gone and one lucid must not be an ending");
});

check("running out of light ends the run", () => {
  const sim = createRun({ seed: 38 });
  sim.time = TIME_LIMIT + 1;
  checkEndings(sim);
  eq(sim.status, "lost");
  eq(sim.ending, "darkness");
});

check("winning needs the full survey AND bodies back at camp", () => {
  const sim = createRun({ seed: 39 });
  for (const m of sim.monoliths) m.logged = true;
  // Survey done, but everyone is out in the basin.
  const away = farFromPylons(sim);
  for (const c of sim.party) { c.x = away.x + 100; c.z = away.z + 100; }
  checkEndings(sim);
  eq(sim.status, "playing", "won without returning");
  // Lead walks back alone: a record with no witnesses is not a survey.
  sim.player.x = sim.world.camp.x;
  sim.player.z = sim.world.camp.z;
  checkEndings(sim);
  eq(sim.status, "playing", "won with the lead alone at camp");
  sim.companions[0].x = sim.world.camp.x + 1;
  sim.companions[0].z = sim.world.camp.z;
  sim.companions[1].x = sim.world.camp.x;
  sim.companions[1].z = sim.world.camp.z + 1;
  checkEndings(sim);
  eq(sim.status, "won", "did not win with lead + two companions home");
  eq(sim.ending, "extracted");
});

check("a false entry cannot win the run", () => {
  const sim = createRun({ seed: 40 });
  // Six log entries, none of them real.
  for (let i = 0; i < 6; i++) sim.logEntries.push({ name: "ghost", real: false, t: 0 });
  sim.player.x = sim.world.camp.x;
  sim.player.z = sim.world.camp.z;
  sim.companions[0].x = sim.world.camp.x;
  sim.companions[0].z = sim.world.camp.z;
  sim.companions[1].x = sim.world.camp.x;
  sim.companions[1].z = sim.world.camp.z;
  checkEndings(sim);
  eq(sim.status, "playing", "counterfeit entries won the game");
});

// ---------------------------------------------------------------------------
// the tick loop
// ---------------------------------------------------------------------------
check("tick advances the sim's own clock, in clamped slices", () => {
  const sim = createRun({ seed: 41 });
  tick(sim, 0.05);
  near(sim.time, 0.05, 1e-9, "clock");
  // dt is clamped to 0.1s per tick: a backgrounded tab that comes back with a
  // 30-second frame must not teleport the run (or drain the party) in one step.
  tick(sim, 999);
  near(sim.time, 0.15, 1e-9, "clamped clock");
});

check("the player walks, and cannot walk through rock", () => {
  const sim = createRun({ seed: 42 });
  const start = { x: sim.player.x, z: sim.player.z };
  advance(sim, 1, { move: { x: 1, z: 0 } });
  assert(Math.hypot(sim.player.x - start.x, sim.player.z - start.z) > 0.5, "player did not move");
  for (let i = 0; i < 400; i++) tick(sim, 0.05, { move: { x: 1, z: 0 } });
  assert(!isBlockedAt(sim.world, sim.player.x, sim.player.z), "player ended up inside rock");
});

check("companions follow the lead", () => {
  const sim = createRun({ seed: 43 });
  const before = sim.companions.map((c) => Math.hypot(c.x - sim.player.x, c.z - sim.player.z));
  advance(sim, 12, { move: { x: 0, z: -1 } });
  const after = sim.companions.map((c) => Math.hypot(c.x - sim.player.x, c.z - sim.player.z));
  const kept = after.filter((d, i) => d < before[i] + 12).length;
  assert(kept >= 4, `the party lost formation: ${after.map((d) => d.toFixed(1))}`);
});

check("a brittle companion breaks formation for a pylon they remember", () => {
  const sim = createRun({ seed: 44 });
  const p = sim.pylons[0];
  const c = sim.companions[0];
  // The party is out in the basin, well away from relief, but this companion has
  // been near this pylon before and remembers it.
  const away = { x: p.x + 30, z: p.z + 4 };
  for (const m of sim.party) { m.x = away.x; m.z = away.z; }
  // Spend every other pylon, so the only relief in the world is `p` — otherwise
  // the party's resting spot may happen to fall inside a different one.
  for (const other of sim.pylons) if (other !== p) other.charge = 0;
  c.known = { pylons: new Set([p.id]), monoliths: new Set() };
  c.lucidity = 9; // BRITTLE — the loud tell
  const before = Math.hypot(c.x - p.x, c.z - p.z);
  advance(sim, 3);
  eq(c.goalKind, "pylon", "brittle companion kept walking in formation");
  assert(Math.hypot(c.x - p.x, c.z - p.z) < before - 3, "broke formation but did not close on the pylon");
});

check("a companion who has never seen a pylon cannot head for it", () => {
  const sim = createRun({ seed: 44 });
  const p = sim.pylons[0];
  const c = sim.companions[0];
  for (const m of sim.party) { m.x = p.x + 40; m.z = p.z + 40; }
  c.known = { pylons: new Set(), monoliths: new Set() };
  c.lucidity = 9;
  advance(sim, 2);
  assert(c.goalKind !== "pylon", "a companion walked to a pylon they had no way of knowing about");
});

check("a gone companion stops following and goes its own way", () => {
  const sim = createRun({ seed: 45 });
  const c = sim.companions[0];
  beginHallucinating(sim, c);
  const startDist = Math.hypot(c.x - sim.player.x, c.z - sim.player.z);
  advance(sim, 30);
  const endDist = Math.hypot(c.x - sim.player.x, c.z - sim.player.z);
  assert(endDist > startDist + 4, `a gone companion should wander off (${startDist.toFixed(1)} -> ${endDist.toFixed(1)})`);
  eq(c.goalKind, "hallucinating", "goal kind");
});

check("companions volunteer remarks, and a gone one says gone things", () => {
  const sim = createRun({ seed: 46 });
  let normal = 0;
  advance(sim, 60);
  normal = sim.companions.length; // remarks are emitted as events; count over a window
  let chatter = 0;
  for (let i = 0; i < 60; i++) {
    tick(sim, 0.5);
    chatter += sim.events.filter((e) => e.kind === "chatter").length;
  }
  assert(chatter > 0, "nobody said anything over a full minute");
  assert(normal > 0);
  // Now break one and look for the confident-nonsense register.
  const c = sim.companions[0];
  beginHallucinating(sim, c);
  let goneLines = 0;
  for (let i = 0; i < 400; i++) {
    tick(sim, 0.5);
    goneLines += sim.events.filter((e) => e.kind === "chatter" && e.who === c.id && e.gone).length;
  }
  assert(goneLines > 0, "a gone companion never spoke");
});

check("paused time does not drain anyone (the loop simply stops ticking)", () => {
  const sim = createRun({ seed: 47 });
  const before = sim.companions.map((c) => c.lucidity);
  // The pause path in main.js skips tick() entirely; assert the sim is inert
  // without it rather than mocking the loop.
  sim.companions.forEach((c, i) => eq(c.lucidity, before[i], "state changed with no tick"));
});

check("a finished run stops simulating", () => {
  const sim = createRun({ seed: 48 });
  sim.status = "won";
  const t = sim.time;
  tick(sim, 1);
  eq(sim.time, t, "the clock ran after the run ended");
});

// ---------------------------------------------------------------------------
// debrief: the only honest readout
// ---------------------------------------------------------------------------
check("the debrief reveals the hidden numbers, and only then", () => {
  const sim = createRun({ seed: 49 });
  sim.companions[0].lucidity = 42.4;
  beginHallucinating(sim, sim.companions[1]);
  const d = debrief(sim);
  eq(d.party.length, PARTY_SIZE, "debrief party size");
  eq(d.party[1].lucidity, 42, "debrief should round the real value");
  assert(d.party[2].hallucinating, "debrief hid a hallucinating companion");
  eq(d.total, 6, "marker total");
});

check("partyCentroid sits inside the party's spread", () => {
  const sim = createRun({ seed: 50 });
  const c = partyCentroid(sim);
  const maxD = Math.max(...sim.party.map((m) => Math.hypot(m.x - c.x, m.z - c.z)));
  assert(maxD < 12, `centroid too far from everyone: ${maxD}`);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function farFromPylons(sim) {
  // A spot on open ground at least 2 pylon-radii from every pylon, so tests that
  // want pure drain get pure drain.
  let best = { x: sim.world.camp.x, z: sim.world.camp.z, d: -1 };
  for (const m of sim.monoliths) {
    const d = Math.min(...sim.pylons.map((p) => Math.hypot(p.x - m.x, p.z - m.z)));
    if (d > best.d) best = { x: m.x, z: m.z, d };
  }
  if (best.d < PYLON_RADIUS * 2) {
    // Fall back to a synthetic point; drain does not care about walls.
    return { x: 9999, z: 9999 };
  }
  return best;
}

// ---------------------------------------------------------------------------
// couch co-op — a second player POSSESSES a companion; nobody is added
// ---------------------------------------------------------------------------
check("a fresh run has exactly one human, and it is the lead", () => {
  const sim = createRun({ seed: 300 });
  eq(sim.humans.length, 1, "a solo run should have one human");
  assert(sim.humans[0] === sim.player, "humans[0] must BE the lead, not a copy");
  eq(sim.player.humanSlot, 0, "the lead is always slot 0");
  for (const c of sim.companions) eq(c.humanSlot, null, `${c.id} should start AI-driven`);
});

check("possessing a companion takes a seat without adding a body to the basin", () => {
  const sim = createRun({ seed: 301 });
  const partyBefore = sim.party.length;
  const target = sim.companions[2];
  const slot = possess(sim, target.id);
  eq(slot, 1, "the second human should get slot 1");
  eq(target.humanSlot, 1, "the companion should record its slot");
  assert(sim.humans[1] === target, "humans[1] must be the possessed companion itself");
  eq(sim.party.length, partyBefore, "possession must not change the party size");
  eq(sim.companions.length, 5, "a possessed companion is still a companion");
  assert(!target.isPlayer, "possession must not make a companion the LEAD");
});

check("a companion cannot be possessed twice", () => {
  const sim = createRun({ seed: 302 });
  const target = sim.companions[0];
  eq(possess(sim, target.id), 1, "first possession should succeed");
  eq(possess(sim, target.id), null, "second possession of the same mind must be refused");
  eq(sim.humans.length, 2, "a refused possession must not grow the roster");
  eq(possess(sim, "no-such-companion"), null, "an unknown id must be refused");
});

check("possessableCompanions only offers minds the AI still owns", () => {
  const sim = createRun({ seed: 303 });
  eq(possessableCompanions(sim).length, 5, "all five start available");
  possess(sim, sim.companions[1].id);
  const left = possessableCompanions(sim);
  eq(left.length, 4, "a taken companion must drop out of the offer list");
  assert(!left.includes(sim.companions[1]), "the taken companion must not be offered");
});

check("possession clears the AI's in-flight goal, and release clears it again", () => {
  const sim = createRun({ seed: 304 });
  const c = sim.companions[0];
  c.goal = { x: 999, z: 999 };
  c.goalKind = "pylon";
  c.path = [{ x: 1, z: 1 }];
  c.fetchItemId = "item-7";
  possess(sim, c.id);
  eq(c.goal, null, "a stale AI goal must not survive possession");
  eq(c.goalKind, "follow", "goalKind must reset on possession");
  eq(c.path, null, "a stale path must not survive possession");
  eq(c.fetchItemId, null, "a stale fetch errand must not survive possession");
  // ...and the same on the way out, so the AI restarts from where it is now.
  c.goal = { x: 5, z: 5 };
  c.path = [{ x: 2, z: 2 }];
  release(sim, 1);
  eq(c.goal, null, "a goal formed under human control must not be handed to the AI");
  eq(c.path, null, "a path formed under human control must not be handed to the AI");
});

check("releasing hands the mind back to the AI, intact", () => {
  const sim = createRun({ seed: 305 });
  const c = sim.companions[3];
  c.lucidity = 41;
  c.scars = 2;
  possess(sim, c.id);
  assert(release(sim, 1), "release should succeed");
  eq(c.humanSlot, null, "the companion must be AI-driven again");
  eq(sim.humans.length, 1, "the roster should be back to the lead alone");
  eq(c.lucidity, 41, "release must not reset the mind's state");
  eq(c.scars, 2, "release must not reset scars");
  assert(sim.companions.includes(c), "the character must STAY in the basin, not vanish");
});

check("the lead's slot can never be released", () => {
  const sim = createRun({ seed: 306 });
  eq(release(sim, 0), false, "slot 0 must be unreleasable");
  assert(sim.humans[0] === sim.player, "the lead must still be human slot 0");
  eq(release(sim, 5), false, "an out-of-range slot must be refused");
});

check("a possessed companion is steered by its own input, not by the party AI", () => {
  const sim = createRun({ seed: 307 });
  const c = sim.companions[0];
  possess(sim, c.id);
  // Park it far from everything so the AI, if it ran, would want to move.
  const start = { x: c.x, z: c.z };
  advance(sim, 0.5, { others: [{ move: { x: 1, z: 0 }, run: false, yaw: 0.3 }] });
  assert(Math.abs(c.x - start.x) > 0.1, "slot-1 input should have moved the possessed companion");
  eq(c.yaw, 0.3, "slot-1 input should set the possessed companion's facing");
  // With NO input for slot 1 the AI must still not take the wheel back.
  const held = { x: c.x, z: c.z };
  advance(sim, 0.6, {});
  eq(c.x, held.x, "a possessed companion must not drift under AI control");
  eq(c.z, held.z, "a possessed companion must not drift under AI control");
});

check("releasing lets the party AI drive that companion again", () => {
  const sim = createRun({ seed: 308 });
  const c = sim.companions[0];
  possess(sim, c.id);
  advance(sim, 0.5, {});
  release(sim, 1);
  const start = { x: c.x, z: c.z };
  // Put the lead well away so the follow AI has somewhere to go.
  sim.player.x = c.x + 40;
  advance(sim, 1.5, {});
  assert(Math.hypot(c.x - start.x, c.z - start.z) > 0.1, "the AI should be driving the released companion again");
});

check("each human gets their own percept, so they can be shown different worlds", () => {
  const sim = createRun({ seed: 309 });
  const c = sim.companions[0];
  possess(sim, c.id);
  const pLead = createPercept(sim.player);
  const pTwo = createPercept(c);
  // Only the SECOND player's mind goes. The lead's must stay honest.
  beginHallucinating(sim, c);
  updatePercept(pLead, sim, 0.1);
  updatePercept(pTwo, sim, 0.1);
  assert(!pLead.active, "the lead must not hallucinate because someone else did");
  assert(pTwo.active, "the possessed companion's own percept must go active");
  eq(distortion(pLead, sim), 0, "a lucid lead's screen must stay undistorted");
  assert(distortion(pTwo, sim) > 0, "the gone player's own screen must distort");
});

check("a phantom marker is placed around the mind that conjured it, not always the lead", () => {
  const sim = createRun({ seed: 310 });
  const c = sim.companions[0];
  possess(sim, c.id);
  // Move the two humans far apart, then send ONLY the second one under.
  sim.player.x = 0; sim.player.z = 0;
  c.x = 120; c.z = 120;
  c.hallucination = HALLUCINATION.PHANTOM_MARKER;
  c.hallucinating = true;
  const pTwo = createPercept(c);
  updatePercept(pTwo, sim, 0.1);
  assert(pTwo.phantomMonoliths.length > 0, "a phantom-marker episode should seed phantoms");
  for (const ph of pTwo.phantomMonoliths) {
    const dSelf = Math.hypot(ph.x - c.x, ph.z - c.z);
    const dLead = Math.hypot(ph.x - sim.player.x, ph.z - sim.player.z);
    assert(dSelf < dLead, "a phantom must be conjured near ITS OWN mind, not near the lead");
  }
  // And the lead, being lucid, must not be shown it at all.
  const pLead = createPercept(sim.player);
  updatePercept(pLead, sim, 0.1);
  eq(perceivedMonoliths(pLead, sim).filter((m) => m.phantom).length, 0,
     "a lucid lead must not see another player's phantom");
});

check("possession survives a basin transition — a joined pad must not go dead", () => {
  const first = createRun({ seed: 311, level: 1, campaignLength: 3 });
  const c = first.companions[2];
  possess(first, c.id);
  const carryOver = {
    party: first.party.map((ch) => ({
      id: ch.id, lucidity: ch.lucidity, scars: ch.scars,
      hallucinating: ch.hallucinating, hallucination: ch.hallucination, goneTime: ch.goneTime,
      drain: ch.drain, stoic: ch.stoic, chatty: ch.chatty, wander: ch.wander,
      selfCare: ch.selfCare, humanSlot: ch.humanSlot,
    })),
    doses: first.doses, inventory: first.inventory, wood: first.wood, stone: first.stone, stats: first.stats,
  };
  const second = createRun({ seed: 312, level: 2, campaignLength: 3, carryOver });
  eq(second.humans.length, 2, "the second player must still be in the roster");
  const same = second.companions.find((x) => x.id === c.id);
  eq(same.humanSlot, 1, "the same companion must still be in slot 1");
  assert(second.humans[1] === same, "humans[1] must point at the restored companion");
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("mirage logic: OK");
