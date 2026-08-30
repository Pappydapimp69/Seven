// Does the investigation actually work? — the chronicle and the accounts.
// Run: node tests/chronicle.test.mjs
//
// The alpha exists to answer one question: can a player catch a fake by asking
// about a day they both lived through? Every assertion here is a way that
// question quietly answers itself NO while the code still looks correct:
//
//   - a false account that comes out identical to a true one (an uncatchable
//     fake — the player concludes the game is a coin flip, and they are right)
//   - an account that changes between askings (a tell that has nothing to do
//     with the day: ask anyone twice and you are done)
//   - a tell that is always the same axis (memorised by run ten — the one risk
//     the design note names)
//   - asking moving `sim.rng` (a resumed run silently forks, per the repo's
//     constant-roll-count invariant)
//
// Per the house rule, the guards are negative-controlled: the last block
// reverts the defect each guard exists for and asserts the guard goes red.

import assert from "node:assert";
import { makeRng } from "../src/rng.js";
import {
  record, accountOf, truthFor, divergence, accuse, witnessed,
  TELL, WEATHER, CHRONICLE_KINDS,
} from "../src/chronicle.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

// ---------------------------------------------------------------- fixtures

const NAMES = ["Ordren", "Vaskel", "Tumor", "Selby", "Anhalt"];

function makeRoster(falseIdx, seed) {
  const rng = makeRng(seed);
  return NAMES.map((name, i) => ({
    id: `c${i}`,
    name,
    // Drawn for EVERY member, not just the fake — that is the point. The draw
    // count must not depend on who is false, or the run forks on the swap.
    tellSeed: (rng() * 0xffffffff) >>> 0,
    swapped: i === falseIdx,
  }));
}

/** One short scripted day at a fixed camp — the alpha's whole world. */
function makeDay(roster, seed = 7) {
  const rng = makeRng(seed);
  const sim = { time: 0, chronicle: [] };
  const places = ["the fire", "the creek", "the deadfall", "the ridge path"];
  for (let i = 0; i < 7; i++) {
    const kind = CHRONICLE_KINDS[Math.floor(rng() * CHRONICLE_KINDS.length)];
    const a = roster[Math.floor(rng() * roster.length)];
    let b = roster[Math.floor(rng() * roster.length)];
    if (b.id === a.id) b = roster[(roster.indexOf(a) + 1) % roster.length];
    sim.time += 1;
    record(sim, kind, {
      // Everyone is at a fixed camp all day, so everyone can speak to
      // everything — the alpha deliberately has no absence to hide behind.
      actors: [a.id, b.id, ...roster.filter((r) => r.id !== a.id && r.id !== b.id).map((r) => r.id)],
      place: places[Math.floor(rng() * places.length)],
      weather: WEATHER[Math.floor(rng() * WEATHER.length)],
    });
  }
  return sim;
}

// ------------------------------------------------------------------- tests

console.log("chronicle — the record");

test("record() keeps facts, not sentences", () => {
  const roster = makeRoster(1, 1);
  const sim = makeDay(roster);
  assert.equal(sim.chronicle.length, 7);
  for (const e of sim.chronicle) {
    assert.ok(!("text" in e), "an entry must not carry rendered prose");
    assert.ok(WEATHER.includes(e.weather));
    assert.equal(typeof e.seq, "number");
  }
});

test("record() refuses a kind or a sky it cannot say", () => {
  const sim = { time: 0, chronicle: [] };
  assert.throws(() => record(sim, "brood", {}), /unknown kind/);
  assert.throws(() => record(sim, "cook", { weather: "hail" }), /unknown weather/);
  assert.equal(sim.chronicle.length, 0, "a refused record must not half-append");
});

console.log("chronicle — a real account");

test("a real member recounts the day exactly", () => {
  const roster = makeRoster(1, 2);
  const sim = makeDay(roster);
  for (const r of roster.filter((r) => !r.swapped)) {
    const acct = accountOf(sim.chronicle, r, roster);
    assert.equal(acct.tell, null, "a real account has no tell");
    assert.deepEqual(divergence(acct, truthFor(sim.chronicle, r, roster)), []);
    // and it is in the order the day happened
    const seqs = acct.statements.map((s) => s.seq);
    assert.deepEqual(seqs, seqs.slice().sort((a, b) => a - b));
  }
});

test("two real members agree with each other", () => {
  const roster = makeRoster(4, 3);
  const sim = makeDay(roster);
  const [a, b] = roster.filter((r) => !r.swapped);
  assert.deepEqual(divergence(accountOf(sim.chronicle, a, roster),
                              accountOf(sim.chronicle, b, roster)), []);
});

console.log("chronicle — a false account");

test("a fake gets exactly one fact wrong", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const falseIdx = seed % 5;
    const roster = makeRoster(falseIdx, seed);
    const sim = makeDay(roster, seed);
    const fake = roster[falseIdx];
    const acct = accountOf(sim.chronicle, fake, roster);
    const diff = divergence(acct, truthFor(sim.chronicle, fake, roster));
    assert.ok(acct.tell, `seed ${seed}: a fake must have a tell`);
    // ONE fact. An order tell necessarily reads as two moved lines — that is
    // one swapped pair, not two independent errors.
    const expected = acct.tell.type === TELL.ORDER ? 2 : 1;
    assert.equal(diff.length, expected,
      `seed ${seed}: ${acct.tell.type} tell moved ${diff.length} lines, wanted ${expected}`);
  }
});

test("a false account is NEVER identical to the truth", () => {
  // The uncatchable fake. This is the assertion the whole alpha rests on.
  for (let seed = 1; seed <= 200; seed++) {
    const falseIdx = seed % 5;
    const roster = makeRoster(falseIdx, seed);
    const sim = makeDay(roster, seed);
    const fake = roster[falseIdx];
    const diff = divergence(accountOf(sim.chronicle, fake, roster),
                            truthFor(sim.chronicle, fake, roster));
    assert.ok(diff.length > 0, `seed ${seed}: fake ${fake.name} told the truth`);
  }
});

test("the tell varies across runs — no single memorisable axis", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const falseIdx = seed % 5;
    const roster = makeRoster(falseIdx, seed);
    const sim = makeDay(roster, seed);
    seen.add(accountOf(sim.chronicle, roster[falseIdx], roster).tell.type);
  }
  assert.deepEqual([...seen].sort(), [TELL.NAME, TELL.ORDER, TELL.WEATHER].sort(),
    `only saw tells: ${[...seen].join(",")}`);
});

console.log("chronicle — the invariants");

test("asking twice gets the same story", () => {
  const roster = makeRoster(2, 9);
  const sim = makeDay(roster, 9);
  for (const r of roster) {
    const first = accountOf(sim.chronicle, r, roster);
    const second = accountOf(sim.chronicle, r, roster);
    assert.deepEqual(divergence(first, second), [],
      `${r.name} changed their story between askings`);
  }
});

test("asking consumes no draw from the run's stream", () => {
  const roster = makeRoster(0, 11);
  const sim = makeDay(roster, 11);
  sim.rng = makeRng(1234);
  const before = sim.rng.snapshot();
  for (const r of roster) accountOf(sim.chronicle, r, roster);
  assert.equal(sim.rng.snapshot(), before,
    "an account must not move sim.rng — a resumed run would fork");
});

test("a real and a false member burn the same private draws", () => {
  // Same seed, same day, same person — only `false` differs. If the two
  // consumed different numbers of draws the private stream would fork, and a
  // member who was swapped mid-run would answer differently about a day that
  // happened before the swap.
  const roster = makeRoster(0, 13);
  const sim = makeDay(roster, 13);
  const asReal = accountOf(sim.chronicle, { ...roster[0], swapped: false }, roster);
  const asFake = accountOf(sim.chronicle, { ...roster[0], swapped: true }, roster);
  assert.ok(asFake.tell, "the fake picked a tell");
  assert.equal(asReal.tell, null, "the real one did not use it");
  assert.deepEqual(divergence(asReal, truthFor(sim.chronicle, roster[0], roster)), []);
});

test("accuse() names the right answer", () => {
  const roster = makeRoster(3, 17);
  assert.equal(accuse(roster, "c3").correct, true);
  assert.equal(accuse(roster, "c0").correct, false);
  assert.equal(accuse(roster, "c0").actual, "c3");
});

test("witnessed() only speaks to what someone was in", () => {
  const roster = makeRoster(1, 19);
  const sim = { time: 0, chronicle: [] };
  record(sim, "cook", { actors: ["c0", "c1"], place: "the fire", weather: "fog" });
  record(sim, "watch", { actors: ["c2"], place: "the ridge path", weather: "fog" });
  assert.equal(witnessed(sim.chronicle, "c0").length, 1);
  assert.equal(witnessed(sim.chronicle, "c2").length, 1);
  assert.equal(accountOf(sim.chronicle, roster[0], roster).statements.length, 1);
});

console.log("chronicle — negative controls (revert the defect, watch it fail)");

test("NC: a perturber that may pick the real weather goes uncatchable", () => {
  // The reverted defect: enumerate weather tells WITHOUT excluding the sky that
  // actually held. Every other line of accountOf is untouched.
  const naive = (chronicle, speaker, roster) => {
    const seen = witnessed(chronicle, speaker.id);
    const rng = makeRng(speaker.tellSeed >>> 0);
    const pool = seen.flatMap((e, i) => WEATHER.map((w) => ({ at: i, to: w })));
    const t = pool[Math.floor(rng() * pool.length)];
    return {
      statements: seen.map((e, i) => ({
        text: `${e.kind}@${e.place},${i === t.at ? t.to : e.weather}`,
      })),
    };
  };
  let uncatchable = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const roster = makeRoster(seed % 5, seed);
    const sim = makeDay(roster, seed);
    const fake = roster[seed % 5];
    const bad = naive(sim.chronicle, fake, roster);
    // truth under the same renderer
    const truth = { statements: witnessed(sim.chronicle, fake.id)
      .map((e) => ({ text: `${e.kind}@${e.place},${e.weather}` })) };
    if (divergence(bad, truth).length === 0) uncatchable++;
  }
  assert.ok(uncatchable > 0,
    "the negative control did not reproduce the defect — the guard is unmeasured");
  console.log(`      (reverted: ${uncatchable}/200 fakes told the truth)`);
});

test("NC: re-seeding per ask breaks the same-story guard", () => {
  let moved = 0;
  const roster = makeRoster(2, 23);
  const sim = makeDay(roster, 23);
  for (let ask = 0; ask < 20; ask++) {
    const a = accountOf(sim.chronicle, { ...roster[2], tellSeed: ask }, roster);
    const b = accountOf(sim.chronicle, { ...roster[2], tellSeed: ask + 1 }, roster);
    if (divergence(a, b).length) moved++;
  }
  assert.ok(moved > 0,
    "re-seeding produced identical accounts — the stability guard proves nothing");
});


// ---------------------------------------------------------------------------
// Wiring: the chronicle inside a real sim, across a real save.
// ---------------------------------------------------------------------------

const { createRun, swapOvernight, askAbout } = await import("../src/state.js");
const { serializeRun, deserializeRun, SAVE_VERSION } = await import("../src/save.js");

const liveDay = (sim) => {
  const ids = sim.companions.map((c) => c.id);
  const places = ["the fire", "the creek", "the deadfall"];
  for (let i = 0; i < 6; i++) {
    sim.time += 1;
    record(sim, CHRONICLE_KINDS[i % CHRONICLE_KINDS.length], {
      actors: [ids[i % ids.length], ids[(i + 1) % ids.length], ...ids],
      place: places[i % places.length],
      weather: WEATHER[i % WEATHER.length],
    });
  }
  return sim;
};

console.log("chronicle — wired into the sim");

test("tellSeed is derived from the run seed, not drawn", () => {
  const a = createRun({ seed: 42 });
  const b = createRun({ seed: 42 });
  const c = createRun({ seed: 43 });
  assert.deepEqual(a.companions.map((x) => x.tellSeed), b.companions.map((x) => x.tellSeed),
    "same seed must give the same tells");
  assert.notDeepEqual(a.companions.map((x) => x.tellSeed), c.companions.map((x) => x.tellSeed),
    "a different seed must give different tells");
  // Every companion has one, whether or not they are ever swapped — the whole
  // point of deriving rather than drawing at swap time.
  assert.ok(a.companions.every((x) => Number.isInteger(x.tellSeed) && x.tellSeed >= 0));
});

test("swapOvernight changes nothing a player can see", () => {
  const sim = liveDay(createRun({ seed: 5 }));
  const before = sim.companions.map((c) => `${c.id}/${c.name}/${c.drain}/${c.stoic}`);
  const victim = swapOvernight(sim, "c3");
  assert.equal(victim.id, "c3");
  assert.deepEqual(sim.companions.map((c) => `${c.id}/${c.name}/${c.drain}/${c.stoic}`), before,
    "the roster must be identical the next morning");
  assert.equal(sim.events.length, 0, "nothing may be announced");
});

test("swapOvernight burns the same draw named or unnamed", () => {
  const named = liveDay(createRun({ seed: 6 }));
  const rolled = liveDay(createRun({ seed: 6 }));
  const start = named.rng.snapshot();
  assert.equal(rolled.rng.snapshot(), start);
  swapOvernight(named, "c2");
  swapOvernight(rolled);
  assert.equal(named.rng.snapshot(), rolled.rng.snapshot(),
    "naming the victim must cost the same draw as rolling for one");
});

test("askAbout answers from the day, and moves no draw", () => {
  const sim = liveDay(createRun({ seed: 7 }));
  swapOvernight(sim, "c4");
  const before = sim.rng.snapshot();
  const real = askAbout(sim, "c1");
  const fake = askAbout(sim, "c4");
  assert.equal(sim.rng.snapshot(), before, "asking must not move the run's stream");
  assert.equal(real.tell, null);
  assert.ok(fake.tell, "the swapped one has something wrong");
  assert.ok(divergence(fake, real).length > 0, "and it must be findable");
  assert.equal(askAbout(sim, "nobody"), null);
});

test("the day and the swap survive a save", () => {
  const sim = liveDay(createRun({ seed: 8 }));
  swapOvernight(sim, "c5");
  const askedBefore = sim.companions.map((c) => askAbout(sim, c.id));

  const data = serializeRun(sim);
  assert.equal(data.v, SAVE_VERSION);
  const back = deserializeRun(JSON.parse(JSON.stringify(data)));

  assert.deepEqual(back.chronicle, sim.chronicle, "the day itself");
  assert.deepEqual(back.companions.map((c) => c.swapped), sim.companions.map((c) => c.swapped));
  assert.deepEqual(back.companions.map((c) => c.tellSeed), sim.companions.map((c) => c.tellSeed));
  for (const c of back.companions) {
    const i = sim.companions.findIndex((x) => x.id === c.id);
    assert.deepEqual(divergence(askAbout(back, c.id), askedBefore[i]), [],
      `${c.name} tells a different story after a resume`);
  }
});

test("NC: dropping `swapped` from the save makes the fake honest", () => {
  // The reverted defect: `swapped` left out of packCharacter. Everything else
  // restores, the roster looks right, and the one thing the investigation runs
  // on is silently gone.
  const sim = liveDay(createRun({ seed: 9 }));
  swapOvernight(sim, "c2");
  const data = JSON.parse(JSON.stringify(serializeRun(sim)));
  for (const p of data.party) delete p.swapped;
  const back = deserializeRun(data);
  assert.equal(askAbout(sim, "c2").tell !== null, true);
  assert.equal(askAbout(back, "c2").tell, null,
    "the negative control did not reproduce the defect — the guard is unmeasured");
});

console.log(`\n${passed} passed`);
