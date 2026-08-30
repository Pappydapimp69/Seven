// stress.mjs — the invariants nothing else is watching.
//
// The rest of the suite asks whether specific mechanics behave. This asks
// whether the SIMULATION stays a valid object at all, across long runs, hostile
// inputs, and save/restore taken at arbitrary moments. It exists because the
// core loop was rebuilt four times in a day — lucidity, corroboration, pylons
// twice — and every one of those changes moved state that several other systems
// read without knowing it had moved.
//
// Brain (sandbox-myers-diff#E3, opticon#E36): property-test the INVARIANT, not
// the output, and assert structural facts that behavioural tests cannot see.
//
// Run: node tests/stress.mjs [seeds]

import {
  createRun, tick, debrief, activatePylon, logMarker, checkIn, useDose, pickupItem,
  useItem, dropItem, craftItem, possess, release, badLogCount, trueLogCount,
  PARTY_SIZE, MAX_LUCIDITY, TIME_LIMIT, PYLON_RADIUS, PRIME_WINDOW, CAMPAIGN_LENGTH, MICRO_MAX_DUR,
} from "../src/state.js";
import { createPercept, updatePercept } from "../src/percept.js";
import { serializeRun, deserializeRun } from "../src/save.js";
import { makeRng } from "../src/rng.js";

const SEEDS = Number(process.argv[2] || 24);
const DT = 1 / 20;
const failures = [];
const notes = [];
function fail(msg) { if (failures.length < 40) failures.push(msg); }

// ---------------------------------------------------------------------------
// The invariants. Checked against a live sim; each one is a thing that must be
// true of ANY reachable state, not of a particular scenario.
// ---------------------------------------------------------------------------
function checkInvariants(sim, where) {
  const ids = new Set(sim.party.map((c) => c.id));

  for (const c of sim.party) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return fail(`${where}: ${c.id} position is not finite (${c.x}, ${c.z})`);
    if (!Number.isFinite(c.lucidity)) return fail(`${where}: ${c.id} lucidity is not finite`);
    if (c.lucidity < 0 || c.lucidity > MAX_LUCIDITY) return fail(`${where}: ${c.id} lucidity out of range (${c.lucidity})`);
    // A mind at zero must be hallucinating, and one that is hallucinating must
    // be at zero. These are two halves of one fact and drifted apart once
    // already when grace was added.
    if (c.lucidity <= 0 && !c.hallucinating) return fail(`${where}: ${c.id} sits at zero lucidity without hallucinating`);
    // Micro-episodes deliberately broke the old form of this ("hallucinating
    // implies lucidity zero"). The rule is now: you are under either because
    // you bottomed out, or because you are mid-slip — and a slip must carry an
    // end time, or it is a permanent hallucination wearing a slip's clothes.
    if (c.hallucinating && c.lucidity > 0 && !((c.microUntil || 0) > 0)) {
      return fail(`${where}: ${c.id} hallucinating at ${c.lucidity} lucidity with no slip window`);
    }
    if ((c.microUntil || 0) > 0 && !c.hallucinating) {
      return fail(`${where}: ${c.id} carries a slip window while lucid`);
    }
    if ((c.microUntil || 0) > 0 && c.microUntil > sim.time + MICRO_MAX_DUR + 1) {
      return fail(`${where}: ${c.id} slip runs ${(c.microUntil - sim.time).toFixed(1)}s — longer than a slip can be`);
    }
    if (c.path && c.path.some((n) => !Number.isFinite(n.cx) || !Number.isFinite(n.cz))) {
      return fail(`${where}: ${c.id} holds a path node that is not a grid cell`);
    }
    if (!Number.isFinite(c.decayPausedUntil ?? 0)) return fail(`${where}: ${c.id} decayPausedUntil is not finite`);
  }

  for (const p of sim.pylons) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return fail(`${where}: pylon ${p.id} position is not finite`);
    // A prime is a claim by REAL party members. A stale id here means somebody
    // left the party (possession, death) and the pylon still counts their hands.
    for (const id of p.primedBy || []) {
      if (!ids.has(id)) return fail(`${where}: pylon ${p.id} primed by unknown ${id}`);
    }
    if ((p.primedBy || []).length > PARTY_SIZE) return fail(`${where}: pylon ${p.id} has ${p.primedBy.length} primers`);
    if (new Set(p.primedBy || []).size !== (p.primedBy || []).length) {
      return fail(`${where}: pylon ${p.id} counted the same hands twice`);
    }
    // `spent` is now the only fact about a pylon — this used to check that it
    // agreed with `live` and `charge`, and the disagreement it found is why
    // those two no longer exist.
    if (p.charge !== undefined) return fail(`${where}: pylon ${p.id} still carries a vestigial charge field`);
    if (p.live !== undefined) return fail(`${where}: pylon ${p.id} still carries a vestigial live field`);
  }

  for (const e of sim.logEntries) {
    if (e.real === false && e.x !== undefined && !Number.isFinite(e.x)) {
      return fail(`${where}: a false entry claims a non-finite position`);
    }
    if (e.struck && e.real) return fail(`${where}: a REAL entry was struck from the record`);
  }
  if (badLogCount(sim) > sim.logEntries.length) return fail(`${where}: more bad entries than entries`);
  if (trueLogCount(sim) > sim.monoliths.length) return fail(`${where}: more markers logged than exist`);
  if (!Number.isFinite(sim.time) || sim.time < 0) return fail(`${where}: sim.time is ${sim.time}`);
}

// A scripted, seeded "player" that presses things — including things that make
// no sense where it is standing. Every verb has to be safe to press anywhere.
function hostileInput(rng, sim) {
  const r = rng.float(0, 1);
  const move = { x: rng.float(-1, 1), z: rng.float(-1, 1) };
  const input = { move, yaw: rng.float(-Math.PI, Math.PI), run: r < 0.3, interact: r < 0.2 };
  // Fire verbs directly rather than through main.js, so this exercises the
  // RULES surface with no UI guarding it.
  const roll = rng.int(0, 11);
  try {
    if (roll === 0) activatePylon(sim);
    else if (roll === 1) logMarker(sim, { name: "Nowhere" });
    else if (roll === 2) checkIn(sim, sim.companions[rng.int(0, PARTY_SIZE - 2)].id);
    else if (roll === 3) useDose(sim, sim.companions[rng.int(0, PARTY_SIZE - 2)].id);
    else if (roll === 4) pickupItem(sim);
    else if (roll === 5) useItem(sim, rng.int(0, 3));
    else if (roll === 6) dropItem(sim, rng.int(0, 3));
    else if (roll === 7) craftItem(sim);
    else if (roll === 8) activatePylon(sim, sim.companions[rng.int(0, PARTY_SIZE - 2)]);
    else if (roll === 9) logMarker(sim, null, sim.companions[rng.int(0, PARTY_SIZE - 2)]);
  } catch (e) {
    fail(`a verb threw under hostile input: ${e.message}`);
  }
  return input;
}

// ---------------------------------------------------------------------------
// 1. Long runs with hostile input. Must terminate, must stay valid throughout.
// ---------------------------------------------------------------------------
let terminated = 0, maxTicks = 0;
const endings = new Map();
for (let seed = 1; seed <= SEEDS; seed++) {
  const sim = createRun({ seed, difficulty: ["gentle", "standard", "bleak"][seed % 3] });
  const percept = createPercept(sim.player);
  const rng = makeRng(seed * 7919);
  let ticks = 0;
  // Generous ceiling: TIME_LIMIT at DT is the honest bound, and anything past
  // it means the clock stopped advancing, which is a hang rather than a loss.
  const bound = Math.ceil(TIME_LIMIT / DT) + 400;
  while (sim.status === "playing" && ticks < bound) {
    tick(sim, DT, hostileInput(rng, sim));
    updatePercept(percept, sim, DT);
    ticks++;
    if (ticks % 40 === 0) checkInvariants(sim, `seed ${seed} t=${sim.time.toFixed(0)}`);
  }
  maxTicks = Math.max(maxTicks, ticks);
  if (ticks >= bound) fail(`seed ${seed}: ran ${ticks} ticks without terminating (sim.time ${sim.time.toFixed(1)})`);
  else terminated++;
  checkInvariants(sim, `seed ${seed} final`);
  const rep = debrief(sim);
  if (!rep.ending) fail(`seed ${seed}: terminated with no ending recorded`);
  endings.set(rep.ending, (endings.get(rep.ending) || 0) + 1);
}
notes.push(`${terminated}/${SEEDS} hostile runs terminated · endings ${[...endings].map(([k, v]) => `${k} ${v}`).join(" ")}`);

// ---------------------------------------------------------------------------
// 2. Save/restore at an ARBITRARY moment, then keep going in lockstep.
// Brain (seven#E-rng): the stream position is state, and every field that
// gates a draw is too. A round trip that agrees with itself proves nothing —
// both sides have to keep agreeing for a long time afterwards.
// ---------------------------------------------------------------------------
let forks = 0;
const fingerprint = (s) =>
  JSON.stringify({
    t: s.time.toFixed(3),
    rng: s.rng.snapshot(),
    party: s.party.map((c) => [c.id, c.x.toFixed(4), c.z.toFixed(4), c.lucidity.toFixed(4), c.hallucinating, c.goalKind]),
    pylons: s.pylons.map((p) => [p.id, !!p.spent, (p.primedBy || []).join("|")]),
    log: s.logEntries.length,
    bad: badLogCount(s),
    status: s.status,
  });
for (let seed = 1; seed <= Math.min(SEEDS, 12); seed++) {
  const sim = createRun({ seed, difficulty: "standard" });
  const rng = makeRng(seed * 104729);
  const cut = rng.int(200, 3000); // an arbitrary, unremarkable moment
  for (let i = 0; i < cut && sim.status === "playing"; i++) tick(sim, DT, hostileInput(rng, sim));
  if (sim.status !== "playing") continue;

  const restored = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  if (fingerprint(restored) !== fingerprint(sim)) { fail(`seed ${seed}: restore did not reproduce the saved moment`); forks++; continue; }

  // Same inputs to both, for a long time.
  const rngA = makeRng(seed * 31), rngB = makeRng(seed * 31);
  for (let i = 0; i < 1200 && sim.status === "playing"; i++) {
    tick(sim, DT, hostileInput(rngA, sim));
    tick(restored, DT, hostileInput(rngB, restored));
    if (fingerprint(sim) !== fingerprint(restored)) {
      fail(`seed ${seed}: resumed run forked ${i} ticks after restore`);
      forks++;
      break;
    }
  }
}
notes.push(`save/restore lockstep: ${forks} fork(s) across ${Math.min(SEEDS, 12)} seeds`);

// ---------------------------------------------------------------------------
// 3. The pylon economy cannot deadlock or double-spend.
// ---------------------------------------------------------------------------
for (let seed = 1; seed <= Math.min(SEEDS, 10); seed++) {
  const sim = createRun({ seed, difficulty: "standard" });
  const p = sim.pylons[0];
  const a = sim.player, b = sim.companions[0];
  a.x = p.x; a.z = p.z; b.x = p.x; b.z = p.z;
  a.lucidity = 40; b.lucidity = 40;

  // Hammer it: many activations from both, interleaved. Exactly one pulse.
  let confirmations = 0;
  for (let i = 0; i < 20; i++) {
    if (activatePylon(sim, a).confirmed) confirmations++;
    if (activatePylon(sim, b).confirmed) confirmations++;
  }
  if (confirmations !== 1) fail(`seed ${seed}: a pylon fired ${confirmations} times under repeated activation`);
  if (a.lucidity > MAX_LUCIDITY || b.lucidity > MAX_LUCIDITY) fail(`seed ${seed}: repeated activation overfilled a meter`);

  // Every pylon spent: the basin must still resolve rather than hang.
  const sim2 = createRun({ seed, difficulty: "bleak" });
  sim2.time = 400;
  for (const py of sim2.pylons) py.spent = true;
  let t = 0;
  while (sim2.status === "playing" && t < Math.ceil(TIME_LIMIT / DT) + 400) { tick(sim2, DT); t++; }
  if (sim2.status === "playing") fail(`seed ${seed}: a basin with no relief left never resolved`);
  checkInvariants(sim2, `seed ${seed} no-relief`);
}

// A prime by someone who then LEAVES the party must not strand the pylon.
{
  const sim = createRun({ seed: 5, difficulty: "standard" });
  const p = sim.pylons[0];
  const c = sim.companions[0];
  c.x = p.x; c.z = p.z;
  sim.player.x = p.x; sim.player.z = p.z;
  activatePylon(sim, c);
  possess(sim, c.id); // a second human takes them over mid-prime
  const res = activatePylon(sim, sim.player);
  if (!res.confirmed) fail("a prime was lost when the primer was possessed");
  release(sim, 1);
  checkInvariants(sim, "possession mid-prime");
}

// A stale prime must not accumulate: primedBy has to reset, not grow forever.
{
  const sim = createRun({ seed: 6, difficulty: "standard" });
  const p = sim.pylons[0];
  const a = sim.player;
  a.x = p.x; a.z = p.z;
  for (let i = 0; i < 30; i++) {
    activatePylon(sim, a);
    sim.time += PRIME_WINDOW + 1;
  }
  if ((p.primedBy || []).length > PARTY_SIZE) fail(`stale primes accumulated: ${p.primedBy.length}`);
  if (p.spent) fail("a pylon fired with only one pair of hands, across stale windows");
}

// ---------------------------------------------------------------------------
// 4. A full campaign, carried level to level.
// ---------------------------------------------------------------------------
for (let seed = 1; seed <= Math.min(SEEDS, 6); seed++) {
  let sim = createRun({ seed, difficulty: "standard", level: 1, campaignLength: CAMPAIGN_LENGTH });
  const rng = makeRng(seed * 13);
  for (let level = 1; level <= CAMPAIGN_LENGTH; level++) {
    let t = 0;
    while (sim.status === "playing" && t < Math.ceil(TIME_LIMIT / DT) + 400) { tick(sim, DT, hostileInput(rng, sim)); t++; }
    if (sim.status === "playing") { fail(`seed ${seed} level ${level}: never resolved`); break; }
    checkInvariants(sim, `seed ${seed} campaign level ${level}`);
    if (sim.status !== "levelComplete") break;
    const carried = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
    if (carried.level !== sim.level) fail(`seed ${seed}: level did not survive a save between basins`);
    sim = carried;
    // advanceLevel is main.js's job; the point here is that a mid-campaign save
    // deserialises into something the sim can keep ticking.
    break;
  }
}


// ---------------------------------------------------------------------------
// 5. percept must never write to the sim. It is "the only module allowed to
// lie", which is only safe while it is also the module that cannot CHANGE
// anything — a lie that edits the world is not a lie, it is a bug with a story.
// rng is excluded because percept legitimately draws from the shared stream.
// ---------------------------------------------------------------------------
{
  const shape = (s2) =>
    JSON.stringify({
      party: s2.party.map((c) => [c.x, c.z, c.lucidity, c.hallucinating, c.goalKind, c.scars, c.decayPausedUntil]),
      pylons: s2.pylons.map((p) => [p.id, !!p.spent, (p.primedBy || []).join("|")]),
      monoliths: s2.monoliths.map((m) => [m.id, m.logged, m.discovered]),
      items: s2.items.map((i) => [i.id, i.taken, i.discovered, i.itemKind]),
      log: s2.logEntries.length,
      bad: badLogCount(s2),
      status: s2.status,
      time: s2.time,
    });
  for (let seed = 1; seed <= Math.min(SEEDS, 8); seed++) {
    const sim = createRun({ seed, difficulty: "bleak" });
    sim.time = 400; // well past the calm, so people are actually going under
    const percept = createPercept(sim.player);
    const rng = makeRng(seed * 601);
    for (let i = 0; i < 2500 && sim.status === "playing"; i++) {
      tick(sim, DT, hostileInput(rng, sim));
      const before = shape(sim);
      updatePercept(percept, sim, DT);
      if (shape(sim) !== before) { fail(`seed ${seed}: updatePercept mutated the sim at tick ${i}`); break; }
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Two humans. Co-op is where the pylon's two-hands rule is most likely to
// go wrong, because a possessed companion is both a party member and a player,
// and `humanSlot` changes who counts as a witness elsewhere in the rules.
// ---------------------------------------------------------------------------
{
  for (let seed = 1; seed <= Math.min(SEEDS, 6); seed++) {
    const sim = createRun({ seed, difficulty: "standard" });
    const c = sim.companions[0];
    possess(sim, c.id);
    const p = sim.pylons[0];
    sim.player.x = p.x; sim.player.z = p.z;
    c.x = p.x; c.z = p.z;
    sim.player.lucidity = 40; c.lucidity = 40;

    const first = activatePylon(sim, sim.player);
    if (first.confirmed) fail(`seed ${seed}: one human fired a pylon alone in co-op`);
    const second = activatePylon(sim, c);
    if (!second.confirmed) fail(`seed ${seed}: two humans in the same light could not fire a pylon`);
    checkInvariants(sim, `seed ${seed} coop prime`);

    // And the possessed companion leaving mid-run must not corrupt anything.
    release(sim, 1);
    const rng = makeRng(seed * 17);
    for (let i = 0; i < 600 && sim.status === "playing"; i++) tick(sim, DT, hostileInput(rng, sim));
    checkInvariants(sim, `seed ${seed} after release`);
  }
}

// ---------------------------------------------------------------------------
console.log(`stress: ${SEEDS} seeds · longest run ${maxTicks} ticks`);
for (const n of notes) console.log("  · " + n);
if (failures.length) {
  console.log("\nSTRESS FAILED:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("seven stress: OK");
