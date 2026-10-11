// whistle.mjs — everyone whistles their own way; a fake's is theirs with ONE
// thing slightly off. Derived, never random, never labelled.

import { harness, assert, S } from "./lib.mjs";
import { createRng } from "../src/rng.js";
import { signature, bend, whistleOf, differs, SHAPES, SEMITONE } from "../src/whistle.js";

const T = harness("whistle");
const HOUR = 60 / 0.2;

T.check("a whistle is the same every time, and each of seven people has their own", () => {
  const ids = ["lead", "m0", "m1", "m2", "m3", "m4"];
  const sigs = ids.map((id) => JSON.stringify(signature(77, id)));
  assert(sigs.every((x, i) => x === JSON.stringify(signature(77, ids[i]))), "a whistle changed between calls");
  assert(new Set(sigs).size === ids.length, "two people whistle exactly alike");
  for (let seed = 1; seed < 40; seed++) {
    const sg = signature(seed, "m1");
    assert(sg.reg > 0.75 && sg.reg < 1.4 && sg.jump > 1.2 && sg.jump < 1.7 && sg.pace > 0.7 && sg.pace < 1.4 && SHAPES.includes(sg.shape), `seed ${seed}: ${JSON.stringify(sg)} out of range`);
  }
  assert(signature(1, "m1").reg !== signature(2, "m1").reg || signature(1, "m1").jump !== signature(2, "m1").jump, "the same person whistles the same in every run");
});

T.check("a fake's whistle is theirs with exactly ONE thing slightly off — 300 people, every kind of bend", () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const real = signature(i, `m${i % 5}`), { sig, which } = bend(real, i, `m${i % 5}`, 2 + (i % 6));
    const d = differs(real, sig);
    assert(d.length === 1 && d[0] === which, `bend ${i}: differs on ${d.join(",")} (said ${which})`);
    assert(sig.shape === real.shape, "the shape changed");
    if (which === "reg") assert(Math.abs(Math.log(sig.reg / real.reg) / Math.log(SEMITONE)) > 0.99 && Math.abs(Math.log(sig.reg / real.reg) / Math.log(SEMITONE)) < 1.01, "register is not one semitone off");
    if (which === "jump") assert(sig.jump < real.jump && (real.jump - sig.jump) / (real.jump - 1) < 0.3, "the leap is not slightly narrower");
    if (which === "pace") assert(Math.abs(sig.pace / real.pace - 1) > 0.19 && Math.abs(sig.pace / real.pace - 1) < 0.21, "pace is not a fifth off");
    seen.add(which);
  }
  assert(seen.size === 3, `only ${[...seen]} ever bent: the tell is always the same kind`);
});

T.check("bending costs no random draw and does not depend on being asked twice", () => {
  const s = S.createSim({ seed: 71, startCamp: true });
  const before = s.rng.state;
  s.mates[1].fake = true; s.mates[1].since = 3;
  const a = JSON.stringify(whistleOf(s, s.mates[1])), b = JSON.stringify(whistleOf(s, s.mates[1]));
  assert(a === b && s.rng.state === before, "a whistle drew from the run's stream or changed between asks");
  s.mates[1].fake = false;
  assert(JSON.stringify(whistleOf(s, s.mates[1])) === JSON.stringify(signature(71, "m1")), "the real one's whistle is not their signature");
});

T.check("in the world: a real answer carries the real whistle, a fake's the bent one — same fields, no flag", () => {
  const s = S.createSim({ seed: 72, startCamp: true });
  S.applyPlan(s, "dawn", {});
  s.mates[1].fake = true; s.mates[1].since = 2;
  s.mates.forEach((m, i) => { m.task = { kind: "camp", chunk: 0, carry: 0 }; m.following = false; m.x = s.lead.x + 3; m.y = s.lead.y; m.heard = { wait: 0.1 }; });
  S.tick(s, {});
  const ans = Object.fromEntries(s.sounds.filter((e) => e.name === "answer").map((e) => [e.slot, e]));
  assert(JSON.stringify(ans[0].sig) === JSON.stringify(signature(72, "m0")), "a real one answered in someone else's way");
  const fake = ans[1].sig, real = signature(72, "m1");
  assert(differs(real, fake).length === 1, `the fake's reply differs from the real one's on ${differs(real, fake)}`);
  assert(Object.keys(ans[0]).join() === Object.keys(ans[1]).join() && !("fake" in ans[1]) && !("which" in ans[1].sig), "the event labels the fake");
});

T.check("at the fire, hearing each of the two whistle: the real one the way they always did", () => {
  const s = S.createSim({ seed: 73, startCamp: true });
  s.day = 4; s.mates[2].fake = true; s.mates[2].since = 3;
  s.missing = { id: "m2", name: s.mates[2].name, role: null, slot: 2, skills: {}, points: 0, practice: {}, lucidity: 90, x: s.camp.x, y: s.camp.y, area: 0, lastDay: 2, nights: 2, found: true };
  const t = S.twinAccounts(s);
  s.sounds.length = 0;
  S.hearTwin(s, t.realLeft); S.hearTwin(s, !t.realLeft);
  const [real, fake] = s.sounds.filter((e) => e.name === "hear");
  assert(JSON.stringify(real.sig) === JSON.stringify(signature(73, "m2")), "the real one does not whistle as they always did");
  assert(differs(real.sig, fake.sig).length === 1, "the other is not the real one with one thing off");
  assert(real.pan !== fake.pan, "they come from the same side");
});

void createRng; void HOUR;
T.done();
