// chronicle.mjs — accounts are DERIVED: a real one is the day told straight; a
// fake's differs in exactly one sentence; nothing draws from the rng.

import { harness, assert, S } from "./lib.mjs";
import { account, facts, record, recordPlan } from "../src/chronicle.js";
import { LANDMARK_NAME } from "../src/world.js";

const T = harness("chronicle");

function livedDay(seed) {
  const s = S.createSim({ seed });
  S.applyPlan(s, "dawn", { m0: "chop", m1: "chop", m2: "gather", m3: "camp" });
  record(s, "chop", ["m0"]); record(s, "chop", ["m1"]); record(s, "fell", ["m2"]);
  record(s, "fire", ["lead"]); record(s, "cleared", ["m1"]);
  if (seed % 2) record(s, "call", [], { dir: "north-east" });
  S.resolveNight(s);   // day 2 now
  return s;
}

T.check("a real account is the day's facts, told straight, and the same every time", () => {
  const s = livedDay(3);
  const a = account(s, s.mates[0], 1), b = account(s, s.mates[0], 1);
  assert(a.length === facts(s, 1).length && a.join() === b.join(), "real account unstable or wrong length");
  assert(a.some((l) => l.includes("I")), `the teller never says I: ${a.join(" ")}`);
});

T.check("a fake's account differs in exactly one sentence — 300 tellers and days", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = livedDay(seed);
    for (const m of s.mates) {
      const real = account(s, m, 1);
      const fake = account(s, { ...m, fake: true, since: 2 }, 1);
      const diff = real.filter((l, i) => l !== fake[i]).length;
      assert(real.length === fake.length && diff === 1, `seed ${seed} ${m.name}: ${diff} sentences differ\n${real.join(" | ")}\n${fake.join(" | ")}`);
    }
  }
});

T.check("a fake tells the truth about days it was there for", () => {
  const s = livedDay(5);
  const m = s.mates[2];
  assert(account(s, m, 1).join() === account(s, { ...m, fake: true, since: 1 }, 1).join(), "a fake that was there bent the day anyway");
});

T.check("telling never touches the rng", () => {
  const s = livedDay(7);
  const before = s.rng.state;
  for (const m of s.mates) { account(s, m, 1); account(s, { ...m, fake: true, since: 2 }, 1); }
  assert(s.rng.state === before, "an account drew from the run's stream");
});

T.check("the bent fact varies across runs — not a list of tells", () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const s = livedDay(seed), m = s.mates[0];
    const real = account(s, m, 1), fake = account(s, { ...m, fake: true, since: 2 }, 1);
    const i = real.findIndex((l, k) => l !== fake[k]);
    kinds.add(i);
  }
  assert(kinds.size >= 3, `the bend always lands on the same ${kinds.size} sentence slot(s)`);
});

void recordPlan;
T.check("a pylon is told with its place; a fake bends the PLACE to another real clearing of the same woods", () => {
  let bentPlace = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = S.createSim({ seed });
    const pk = s.world.pylons.find((p) => p.area === 0);
    S.applyPlan(s, "dawn", {});
    record(s, "pylon", ["lead", "m1"], { place: pk.landmark, area: pk.area });
    S.resolveNight(s);
    const real = account(s, s.mates[0], 1);
    assert(real.some((l) => l.includes(LANDMARK_NAME[pk.landmark])), `seed ${seed}: the account does not name ${pk.landmark}`);
    const fake = account(s, { ...s.mates[0], fake: true, since: 2 }, 1);
    const diff = real.filter((l, i) => l !== fake[i]);
    assert(diff.length === 1, `seed ${seed}: ${diff.length} sentences differ`);
    const said = fake.find((l) => l.includes("pylon at"));
    if (said && !said.includes(LANDMARK_NAME[pk.landmark])) {
      bentPlace++;
      const named = Object.entries(LANDMARK_NAME).find(([, n]) => said.includes(n));
      assert(named && s.world.pockets.some((p) => p.area === 0 && p.kind === named[0]), `seed ${seed}: the wrong place is not a clearing in these woods: ${said}`);
    }
  }
  assert(bentPlace > 5, `only ${bentPlace} of 60 fakes ever got the place wrong`);
});

T.done();
