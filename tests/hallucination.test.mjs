// Perceptual-regression suite for MIRAGE's two hallucination tells: the monster
// flicker (a real companion briefly reading as something else while the LEAD is
// under) and what a hallucinating COMPANION looks like from the outside.
// Run: node mirage/tests/hallucination.test.mjs
//
// Why this file exists, separately from logic.test.mjs.
//
// logic.test.mjs already proves the monster flicker WORKS: it fires only while
// hallucinating, holds its pick, clears on schedule, never picks someone out of
// range. Every one of those tests passed while a real player finished a whole
// session and reported "I didn't see any monsters" — because a correctness test
// forces the roll (`sim.rng.chance = () => true`) and stands the companion five
// units away. It asks "does the mechanism work", which was never the bug.
//
// This file asks the other question: OVER A REALISTIC EPISODE, AT THE REAL
// RATE, DOES THE PLAYER ACTUALLY SEE IT. Those are different axes and they need
// different tests — a mechanism can be perfectly correct and perfectly
// invisible, which is exactly what shipped.
//
// Same discipline as logic.test.mjs: nothing here reads wall-clock time. The
// sim's own clock is driven in fixed slices and every assertion is against
// sim.time or against a count of sim ticks. tick() clamps dt to 0.1 internally,
// so every advance below is a loop of small slices, never one big dt.

import {
  createRun, tick, beginHallucinating, beginMicroEpisode, recover, bandOf, BAND,
  FULL_DRAIN_AT, MICRO_REFRACTORY,
} from "../src/state.js";
import {
  createPercept, updatePercept, perceivedCompanions, MONSTER_TUNING,
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
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// The renderer's real horizontal half-FOV (72° vertical at 16:9). percept.js's
// own on-screen test is deliberately narrower than this, so anything it calls
// visible passes here too.
const FOV_HALF = 0.94;
function angularDelta(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function onScreen(eye, target) {
  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  if (dx === 0 && dz === 0) return true;
  return Math.abs(angularDelta(Math.atan2(-dx, -dz), eye.yaw)) <= FOV_HALF;
}

/** Past the orientation window, so nothing under test is masked by grace. */
function liveRun(seed) {
  const sim = createRun({ seed });
  sim.time = 400;
  return sim;
}

// ---------------------------------------------------------------------------
// A player who has gone under and is playing normally.
//
// The view model matters more than anything else in this file, so it is spelled
// out rather than hidden in a helper: walk forward a few seconds, stop, turn
// right around to look at whatever you just heard, walk on. A lead who only
// spins on the spot never sees their own party at ALL — party.js's formation
// slot is derived from the lead's yaw, so it rotates with them and stays
// exactly behind forever. That is not a quirk of the test; it is why an
// unbiased flicker pick was landing behind the player four times in five.
// ---------------------------------------------------------------------------
function playUnder(seed, seconds, opts = {}) {
  const sim = liveRun(seed);
  const p = sim.player;
  beginHallucinating(sim, p);
  const percept = createPercept(p);
  let baseYaw = 0;
  const out = {
    sim, percept,
    flickers: 0,        // distinct flicker episodes that started
    seenFlickers: 0,    // ...that were on screen when they did
    monsterTicks: 0,    // ticks with any flicker active
    seenTicks: 0,       // ...with it on screen
    ticks: 0,
    firstSeenAt: null,  // sim.time of the first on-screen flicker frame
  };
  let last = null;
  const start = sim.time;
  while (sim.time - start < seconds) {
    // The party's own meters are held steady: this test is about the lead's
    // perception, and a companion going under mid-test would move them.
    for (const c of sim.companions) c.lucidity = 80;
    const t = sim.time - start;
    const phase = t % 9;
    let yaw = baseYaw;
    let move = { x: 0, z: 0 };
    if (phase < 4) move = { x: -Math.sin(baseYaw), z: -Math.cos(baseYaw) }; // forward
    else if (phase < 5) yaw = baseYaw + (phase - 4) * Math.PI;             // turning
    else if (phase < 8) yaw = baseYaw + Math.PI;                           // looking back
    else { yaw = baseYaw + Math.PI + (phase - 8) * Math.PI; baseYaw += 0.7; }
    if (opts.still) { move = { x: 0, z: 0 }; yaw = opts.yaw || 0; }
    tick(sim, SLICE, { move, yaw });
    updatePercept(percept, sim, SLICE);
    out.ticks++;
    if (percept.monsterId !== null) {
      out.monsterTicks++;
      const c = sim.companions.find((x) => x.id === percept.monsterId);
      const visible = c && onScreen(p, c);
      if (percept.monsterId !== last) {
        out.flickers++;
        if (visible) out.seenFlickers++;
      }
      if (visible) {
        out.seenTicks++;
        if (out.firstSeenAt === null) out.firstSeenAt = sim.time;
      }
    }
    last = percept.monsterId;
  }
  return out;
}

const SEEDS = 40;
function acrossSeeds(seconds, opts) {
  const runs = [];
  for (let s = 1; s <= SEEDS; s++) runs.push(playUnder(s, seconds, opts));
  return runs;
}

// ---------------------------------------------------------------------------
// monster flicker — the rate the player actually experiences
// ---------------------------------------------------------------------------

// THE REGRESSION TEST. This is the assertion that would have caught the shipped
// bug: at the old tuning a 20-second episode showed a monster in 37% of seeds
// (and an 8-second one — the measured MEDIAN episode length in careful play —
// in 8%). The thresholds below are set well under the measured 85% so ordinary
// seed noise can't flake them, but far above the old numbers, which is the
// whole point: this fails loudly if the rate is ever quietly walked back.
check("a lead who goes under sees a monster within a normal-length episode", () => {
  const runs = acrossSeeds(20);
  const withSighting = runs.filter((r) => r.seenTicks > 0).length;
  atLeast(withSighting / SEEDS, 0.6, "a 20s hallucination should show a monster in most runs");
});

check("even a short episode shows a monster in a substantial minority of runs", () => {
  // 8 seconds is roughly the measured median lead-hallucination in careful play
  // (you go under, you reach a pylon). It must not be a dead window.
  const runs = acrossSeeds(8);
  const withSighting = runs.filter((r) => r.seenTicks > 0).length;
  atLeast(withSighting / SEEDS, 0.25, "a short hallucination should still sometimes show a monster");
});

check("a long episode shows one to essentially everybody", () => {
  const runs = acrossSeeds(60);
  const withSighting = runs.filter((r) => r.seenTicks > 0).length;
  atLeast(withSighting / SEEDS, 0.9, "a 60s hallucination should show a monster to nearly every run");
});

// The other half of the tuning, and the one that keeps this honest. "Briefly,
// at times" is a two-sided claim: the previous test forbids never, this one
// forbids a strobe. Raising the rate to force the test above green would fail
// here instead.
check("the flicker stays brief — never a strobe", () => {
  const runs = acrossSeeds(60);
  const duty = runs.reduce((a, r) => a + r.monsterTicks, 0) / runs.reduce((a, r) => a + r.ticks, 0);
  atMost(duty, 0.25, "a monster is on screen too much of a hallucination to read as 'briefly'");
  const perMinute = runs.reduce((a, r) => a + r.flickers, 0) / runs.length;
  atMost(perMinute, 20, "too many separate flickers per minute of hallucinating");
  atLeast(perMinute, 2, "too few separate flickers per minute of hallucinating");
});

// Every flicker that fires is one the player is looking at, so main.js's audio
// sting always arrives with something visible attached.
check("every flicker that fires is on screen when it does", () => {
  const runs = acrossSeeds(60);
  const started = runs.reduce((a, r) => a + r.flickers, 0);
  const seen = runs.reduce((a, r) => a + r.seenFlickers, 0);
  atLeast(started, 40, "not enough flickers fired to judge the on-screen rule");
  eq(seen, started, "a flicker fired on a companion who was not on screen");
});

check("a flicker never fires on a companion behind the lead, however often the roll succeeds", () => {
  const sim = liveRun(600);
  const p = sim.player;
  p.x = 0; p.z = 0; p.yaw = 0; // facing -Z
  // +Z is directly behind the camera. Everyone stands there, well in range.
  sim.companions.forEach((c, i) => { c.x = i * 0.5; c.z = 8; });
  const percept = createPercept(p);
  sim.rng.chance = () => true;
  beginHallucinating(sim, p);
  updatePercept(percept, sim, SLICE); // onset tick never rolls
  for (let i = 0; i < 60; i++) {
    sim.time += SLICE;
    for (const c of sim.companions) { c.z = 8; }
    updatePercept(percept, sim, SLICE);
    eq(percept.monsterId, null, "a companion at the lead's back must never wear the flicker");
  }
});

check("a flicker fires on a companion in front of the lead", () => {
  const sim = liveRun(601);
  const p = sim.player;
  p.x = 0; p.z = 0; p.yaw = 0;
  const front = sim.companions[0];
  front.x = 0; front.z = -8; // -Z is dead ahead
  for (let i = 1; i < sim.companions.length; i++) { sim.companions[i].x = 900; sim.companions[i].z = 900; }
  const percept = createPercept(p);
  sim.rng.chance = () => true;
  beginHallucinating(sim, p);
  updatePercept(percept, sim, SLICE); // onset
  updatePercept(percept, sim, SLICE);
  eq(percept.monsterId, front.id, "the one companion in front should have been picked");
});

check("the sight gate matches the tuned radius, not the old one", () => {
  // Inside the radius it can fire; outside it never does. Both companions sit
  // dead ahead, so facing is not what is being measured here.
  const near = (radius) => {
    const sim = liveRun(602);
    const p = sim.player;
    p.x = 0; p.z = 0; p.yaw = 0;
    sim.companions.forEach((c, i) => { c.x = 0; c.z = i === 0 ? -radius : 900; });
    const percept = createPercept(p);
    sim.rng.chance = () => true;
    beginHallucinating(sim, p);
    updatePercept(percept, sim, SLICE);
    for (let i = 0; i < 40; i++) {
      sim.time += SLICE;
      updatePercept(percept, sim, SLICE);
      if (percept.monsterId !== null) return true;
    }
    return false;
  };
  assert(near(MONSTER_TUNING.sight - 1), "a companion just inside the sight radius must be able to flicker");
  assert(!near(MONSTER_TUNING.sight + 4), "a companion outside the sight radius must never flicker");
  // The old radius was 20 and the measured median distance from the lead while
  // under was ~22 — this is the specific gap that kept the gate shut.
  atLeast(MONSTER_TUNING.sight, 22, "the sight radius is back under the measured median party distance");
});

check("a flicker lasts long enough to survive a glance", () => {
  atLeast(MONSTER_TUNING.minDur, 0.45, "too short to register at all");
  atMost(MONSTER_TUNING.maxDur, 2.0, "long enough to stop reading as a flicker");
  const sim = liveRun(603);
  const p = sim.player;
  p.x = 0; p.z = 0; p.yaw = 0;
  sim.companions.forEach((c, i) => { c.x = 0; c.z = i === 0 ? -8 : 900; });
  const percept = createPercept(p);
  sim.rng.chance = () => true;
  beginHallucinating(sim, p);
  updatePercept(percept, sim, SLICE);
  updatePercept(percept, sim, SLICE);
  assert(percept.monsterId !== null, "expected a flicker to have started");
  const held = percept.monsterUntil - sim.time;
  atLeast(held, MONSTER_TUNING.minDur - 1e-9, "flicker shorter than the tuned floor");
  atMost(held, MONSTER_TUNING.maxDur + 1e-9, "flicker longer than the tuned ceiling");
});

check("the flicker is reproducible from the seed alone", () => {
  const trace = (seed) => {
    const r = playUnder(seed, 25);
    return `${r.flickers}/${r.seenFlickers}/${r.monsterTicks}/${r.seenTicks}`;
  };
  eq(trace(7), trace(7), "the same seed produced two different flicker histories");
  const a = trace(7);
  const b = trace(8);
  assert(a !== b, "two different seeds produced identical flicker histories — is the rng being consumed?");
});

check("a flicker never touches the sim's truth about the companion", () => {
  const runs = acrossSeeds(30);
  for (const r of runs) {
    if (!r.flickers) continue;
    for (const c of r.sim.companions) {
      assert(!("monstrous" in c), "percept wrote `monstrous` onto a real companion");
      eq(c.hallucinating, false, "percept pushed a companion into hallucinating");
    }
    // The lie is only ever in the perceived view, and only about identity.
    const seen = perceivedCompanions(r.percept, r.sim);
    for (const s of seen.filter((x) => !x.phantom)) {
      const real = r.sim.companions.find((c) => c.id === s.id);
      eq(s.x, real.x, "the perceived companion moved relative to the real one");
      eq(s.z, real.z, "the perceived companion moved relative to the real one");
    }
  }
});

// ---------------------------------------------------------------------------
// a hallucinating COMPANION — is the tell perceivable at all?
//
// The second half of the same player report: "other ai members didn't seem to
// hallucinate." The mechanism was firing; recorded runs put the MEDIAN distance
// from the lead while a companion was hallucinating at ~48 units, with only
// ~10% of all gone-seconds spent both in legible range and on screen. They went
// under and left, in the same beat, every time.
// ---------------------------------------------------------------------------

/** One companion breaks at `startDist` from a standing lead; run `seconds`. */
function breakdown(seed, startDist, seconds) {
  const sim = liveRun(seed);
  const p = sim.player;
  p.x = 0; p.z = 0; p.yaw = 0;
  sim.companions.forEach((c, i) => {
    const a = (i - 2) * 0.55;
    c.x = Math.sin(a) * 5; c.z = Math.cos(a) * 5;
    c.lucidity = 80; c.goal = null; c.path = null;
  });
  const victim = sim.companions[0];
  const bearing = (seed / 17) * Math.PI * 2;
  victim.x = Math.cos(bearing) * startDist;
  victim.z = Math.sin(bearing) * startDist;
  const from = { x: victim.x, z: victim.z };
  beginHallucinating(sim, victim);

  const lines = [];
  let firstLineAt = null;
  const samples = [];
  const start = sim.time;
  while (sim.time - start < seconds) {
    for (const c of sim.companions) if (c !== victim) c.lucidity = 80;
    tick(sim, SLICE, { move: { x: 0, z: 0 }, yaw: (sim.time - start) * 0.55 });
    for (const ev of sim.events) {
      if (ev.kind === "chatter" && ev.gone && ev.who === victim.id) {
        lines.push(ev.text);
        if (firstLineAt === null) firstLineAt = sim.time - start;
      }
    }
    samples.push({ t: sim.time - start, fromBreak: dist(victim, from), fromLead: dist(victim, p) });
  }
  return { sim, victim, from, lines, firstLineAt, samples };
}

check("a companion who breaks stays where it can be witnessed, before they wander", () => {
  // The dwell. They do not commit to an errand the instant their meter empties
  // — they stand roughly where they stopped, which is the whole difference
  // between "X stops making sense" being an event and being a notification
  // about something that already left.
  for (let seed = 1; seed <= 12; seed++) {
    const r = breakdown(seed, 10, 6);
    const drift = r.samples[r.samples.length - 1].fromBreak;
    atMost(drift, 5, `seed ${seed}: a freshly-broken companion left immediately (${drift.toFixed(1)}u in 6s)`);
  }
});

check("but they DO wander off — the dwell is a beat, not a leash", () => {
  // The design is that a gone companion abandons the party for an errand they
  // invented. Holding them near the lead forever would be a different (worse)
  // game, so this asserts the departure still happens.
  let left = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = breakdown(seed, 10, 70);
    if (r.samples[r.samples.length - 1].fromBreak > 8) left++;
  }
  atLeast(left, 8, "gone companions are no longer wandering off at all");
});

check("a phantom errand stays in the neighbourhood instead of crossing the basin", () => {
  // Each leg is drawn from a bounded radius, so a single episode drifts rather
  // than teleporting: the lead can follow the voice and catch up.
  const dists = [];
  for (let seed = 1; seed <= 12; seed++) {
    const r = breakdown(seed, 10, 45);
    dists.push(Math.max(...r.samples.map((s) => s.fromBreak)));
  }
  const median = [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)];
  atMost(median, 70, "a gone companion is still crossing the basin in one leg");
});

check("the first line after going under lands almost immediately", () => {
  // A spoken line is the ONLY tell that survives distance and fog — colour and
  // heading both need line of sight. Before, the remark clock could leave a
  // freshly-broken companion silent for half a minute after the announcement.
  const waits = [];
  for (let seed = 1; seed <= 12; seed++) {
    const r = breakdown(seed, 10, 20);
    assert(r.firstLineAt !== null, `seed ${seed}: a gone companion said nothing at all in 20s`);
    waits.push(r.firstLineAt);
  }
  const worst = Math.max(...waits);
  atMost(worst, 1.0, `a gone companion stayed silent for ${worst.toFixed(1)}s after breaking`);
});

check("a gone companion keeps narrating at a rate that carries across the basin", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const r = breakdown(seed, 10, 60);
    atLeast(r.lines.length, 4, `seed ${seed}: only ${r.lines.length} lines in a 60s episode`);
    atMost(r.lines.length, 16, `seed ${seed}: ${r.lines.length} lines in 60s is a stream, not speech`);
  }
});

check("a gone companion never says the same line twice running", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const r = breakdown(seed, 10, 90);
    for (let i = 1; i < r.lines.length; i++) {
      assert(r.lines[i] !== r.lines[i - 1], `seed ${seed}: repeated "${r.lines[i]}" back to back`);
    }
  }
});

check("a gone companion is reported on their own heading, not turned to face the lead", () => {
  // The renderer turns a lucid companion toward the lead and draws a gone one
  // on `facing` instead — "not with us" at a distance where the body colour has
  // already fogged out. That only works if perception carries the heading.
  const r = breakdown(3, 10, 20);
  const seen = perceivedCompanions(createPercept(r.sim.player), r.sim);
  const v = seen.find((c) => c.id === r.victim.id);
  assert(v, "the gone companion vanished from the perceived list");
  eq(v.hallucinating, true, "the gone companion is not reported as hallucinating");
  eq(typeof v.facing, "number", "perception did not carry the companion's heading");
  eq(v.facing, r.victim.facing || 0, "the reported heading is not the real one");
});

check("coming back resets the episode, so a second break gets its own dwell", () => {
  const r = breakdown(5, 10, 20);
  const v = r.victim;
  recover(r.sim, v, "test");
  eq(v.hallucinating, false, "recover did not clear the flag");
  // Advance lucidly for a moment, then break again from a known spot.
  for (let i = 0; i < 30; i++) tick(r.sim, SLICE, { move: { x: 0, z: 0 }, yaw: 0 });
  v.x = 12; v.z = 0;
  const from = { x: v.x, z: v.z };
  beginHallucinating(r.sim, v);
  const start = r.sim.time;
  while (r.sim.time - start < 5) {
    for (const c of r.sim.companions) if (c !== v) c.lucidity = 80;
    tick(r.sim, SLICE, { move: { x: 0, z: 0 }, yaw: 0 });
  }
  atMost(dist(v, from), 5, "the second episode skipped its dwell — the first one's clock leaked");
});

check("the party's own meters are untouched by any of this", () => {
  // party.js may change where a gone companion GOES; it must never change how
  // gone they are. bandOf is the only reading anything outside state.js takes.
  const r = breakdown(9, 10, 40);
  for (const c of r.sim.companions) {
    assert(c.lucidity >= 0 && c.lucidity <= 100, "a lucidity value left its range");
    if (c.hallucinating) eq(bandOf(c.lucidity), BAND.GONE, "a hallucinating companion is not reading as gone");
  }
});

// ---------------------------------------------------------------------------
// Micro-episodes. Rated by OBSERVED behaviour over whole runs, two-sided —
// brain: rate-a-perceptual-tell-by-its-observed-rate (a floor alone lets you
// "fix" a quiet mechanic by making it a strobe) and brain-builder#E6 (a channel
// that fires on every event stops carrying information).
// ---------------------------------------------------------------------------
function advance(sim, seconds) {
  for (let t = 0; t < seconds; t += 1 / 20) tick(sim, 1 / 20, {});
}

function slipRun(seed, seconds) {
  const sim = createRun({ seed, difficulty: "standard" });
  sim.time = FULL_DRAIN_AT;
  const lead = sim.player;
  let ticks = 0, underTicks = 0, episodes = 0, wasUnder = false, longest = 0, cur = 0;
  const DTS = 1 / 20;
  for (let t = 0; t < seconds; t += DTS) {
    tick(sim, DTS, { move: { x: 0.3, z: -0.9 }, yaw: 0.2 });
    if (sim.status !== "playing") break;
    ticks++;
    const under = !!lead.hallucinating;
    if (under) {
      underTicks++;
      cur += DTS;
      if (!wasUnder) episodes++;
    } else {
      longest = Math.max(longest, cur);
      cur = 0;
    }
    wasUnder = under;
  }
  return { ticks, underTicks, episodes, longest: Math.max(longest, cur), duty: ticks ? underTicks / ticks : 0 };
}

check("a mind under pressure slips, often enough to be met", () => {
  let withSlip = 0, totalEpisodes = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = slipRun(seed, 240);
    if (r.episodes > 0) withSlip++;
    totalEpisodes += r.episodes;
  }
  atLeast(withSlip / SEEDS, 0.5, "most runs past the calm window should contain at least one lapse");
  atLeast(totalEpisodes / SEEDS, 0.8, "too few lapses per run for a player to ever meet the deception");
});

check("...and it never becomes a strobe", () => {
  let duty = 0, worstEpisodes = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = slipRun(seed, 240);
    duty += r.duty;
    worstEpisodes = Math.max(worstEpisodes, r.episodes);
  }
  atMost(duty / SEEDS, 0.45, "the lead spends too much of a run under for 'under' to mean anything");
  atMost(worstEpisodes, 12, "too many separate lapses in one run — a channel that fires constantly carries nothing");
});

// The refractory gap is the ceiling's mechanism, so it gets its own check
// rather than being inferred from the duty cycle.
check("a slip is followed by a stretch of being reliably yourself", () => {
  const sim = createRun({ seed: 3, difficulty: "standard" });
  sim.time = FULL_DRAIN_AT;
  const ch = sim.player;
  ch.lucidity = 10; // brittle: the highest slip rate there is
  beginMicroEpisode(sim, ch, 1);
  advance(sim, 2);
  assert(!ch.hallucinating, "a slip did not end on its own");
  assert(ch.microCooldownUntil > sim.time, "no refractory gap was set");

  // Count SLIPS, not `hallucinating`. Held at brittle the lead drains to zero
  // and goes under for good partway through the gap, which is the long kind
  // doing its job — asserting on the flag conflated the two and failed here.
  const slipsBefore = sim.stats.slips;
  for (let t = 0; t < MICRO_REFRACTORY - 3; t += 1 / 20) {
    ch.lucidity = 10; // hold the band so the rate stays at its maximum
    tick(sim, 1 / 20, {});
  }
  eq(sim.stats.slips, slipsBefore, "a second slip fired inside the refractory gap");
});

// From the inside, a lapse and the beginning of the end must be the same thing.
check("a slip announces itself exactly as the long kind does", () => {
  const a = createRun({ seed: 11 });
  a.time = FULL_DRAIN_AT;
  beginMicroEpisode(a, a.player, 5);
  const slipEv = a.events.find((e) => e.kind === "hallucinate");

  const b = createRun({ seed: 11 });
  b.time = FULL_DRAIN_AT;
  beginHallucinating(b, b.player);
  const goneEv = b.events.find((e) => e.kind === "hallucinate");

  assert(slipEv && goneEv, "one of the two onsets emitted nothing");
  eq(slipEv.text, goneEv.text, "a lapse reads differently from going under for good");
  eq(slipEv.kind, goneEv.kind, "a lapse is a different event kind — that is a tell");
});

console.log("mirage hallucination: OK");


console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
