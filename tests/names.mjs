// names.mjs — the roster has to be unfamiliar, sayable, and reproducible.
//
// The investigation asks a player to hold five never-before-seen names
// overnight. Every check here defends one of the three properties that makes
// that possible: they must not repeat run to run (or the player recognises
// rather than remembers), they must be pronounceable (an unsayable name is
// held as a shape, and shapes cannot be compared one letter at a time), and
// they must be a pure function of the seed (or a resumed run has a different
// party in it).
//
// Run: node tests/names.mjs

import { makeName, makeRoster, nearMiss, editDistance, mayFollow, FRAGMENTS, NAME_MIN, NAME_MAX } from "../src/names.js";
import { makeRng } from "../src/rng.js";

let passed = 0;
const failures = [];
const check = (n, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// A generator that counts how many times it was called. The constant-roll-count
// rule is invisible to any test that only looks at return values.
function counting(seed) {
  const inner = makeRng(seed);
  let n = 0;
  const f = () => { n++; return inner(); };
  f.shuffled = (a) => { const out = a.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  f.count = () => n;
  return f;
}

check("a seed gives the same roster twice", () => {
  for (const s of [1, 17, 4242, 999983]) {
    const a = makeRoster(makeRng(s), 5).join(",");
    const b = makeRoster(makeRng(s), 5).join(",");
    assert(a === b, `seed ${s}: ${a} != ${b}`);
  }
});

check("different seeds give different rosters", () => {
  const seen = new Set();
  for (let s = 1; s <= 200; s++) seen.add(makeRoster(makeRng(s), 5).join(","));
  // Not a uniqueness guarantee, a recognition one: if the space were small
  // enough to collide often, a player would start recognising names by run ten
  // and the whole premise would rot.
  assert(seen.size >= 198, `only ${seen.size}/200 distinct rosters`);
});

check("makeName draws the same number of times whatever it returns", () => {
  const counts = new Set();
  const lens = new Set();
  for (let s = 1; s <= 400; s++) {
    const r = counting(s);
    const n = makeName(r);
    counts.add(r.count());
    lens.add(n.split("").length);
  }
  assert(counts.size === 1, `draw count varies: ${[...counts].join(",")}`);
  assert(lens.size > 3, `names are all one length — the 2/3 syllable branch is not firing`);
});

check("every name is within the length a player can hold", () => {
  for (let s = 1; s <= 500; s++) {
    for (const n of makeRoster(makeRng(s), 5)) {
      assert(n.length >= NAME_MIN && n.length <= NAME_MAX, `seed ${s}: "${n}" is ${n.length} long`);
    }
  }
});

check("the roster REJECTS a pair within one edit, when one comes up", () => {
  // The natural-seed sweep below has never once produced a colliding pair, so
  // on its own it proves nothing about the rejection rule — it is a guard that
  // has never been observed to fail, which is not a guard. So: rig a generator
  // that hands makeRoster the same name over and over, and check that what
  // comes back is still five distinct ones rather than five copies.
  const canned = ["VOLKA", "VOLKA", "VOLKAN", "VOLAK", "TRESIM", "BRANOTH", "SULDEK", "FIRMOL"];
  let i = 0;
  const out = makeRoster(makeRng(1), 5, canned.length, () => canned[Math.min(i++, canned.length - 1)]);
  assert(!out.includes("VOLKAN"), `VOLKAN is one edit from VOLKA and should have been rejected: ${out.join(",")}`);
  assert(!out.includes("VOLAK"), `VOLAK is one transposition from VOLKA and should have been rejected: ${out.join(",")}`);
  assert(out.length === 5, `expected five distinct, got ${out.length}: ${out.join(",")}`);
  assert(new Set(out).size === out.length, `duplicates survived: ${out.join(",")}`);
});

check("no two names in a roster are within one edit of each other", () => {
  // Not cosmetic. A one-letter difference IS a tell in this game; if the roster
  // itself contains a pair that close, a perturbed name is unreadable as
  // evidence because it might be a different real person.
  for (let s = 1; s <= 500; s++) {
    const r = makeRoster(makeRng(s), 5);
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        assert(editDistance(r[i], r[j]) > 1, `seed ${s}: ${r[i]} / ${r[j]} are one edit apart`);
      }
    }
  }
});

check("names stay sayable across the syllable seam", () => {
  const hard = FRAGMENTS.CODA_HARD, cluster = FRAGMENTS.ONSET_CLUSTER;
  assert(!mayFollow("st", "tr"), "a hard coda plus a cluster onset should be refused");
  assert(!mayFollow("n", "n"), "a repeated consonant across the seam should be refused");
  assert(mayFollow("", "tr"), "an empty coda should allow anything");
  assert(mayFollow("l", "kr"), "a soft coda should allow a cluster");
  // And the generator must actually obey it: four consonants in a row is the
  // shape that comes out when it does not.
  for (let s = 1; s <= 800; s++) {
    for (const n of makeRoster(makeRng(s), 5)) {
      assert(!/[BCDFGHJKLMNPQRSTVWXZ]{4}/.test(n), `seed ${s}: "${n}" has four consonants in a row`);
      assert(!/(.)\1/.test(n), `seed ${s}: "${n}" doubles a letter`);
    }
  }
});

check("a near-miss is exactly one edit away and never a real name", () => {
  for (let s = 1; s <= 400; s++) {
    const rng = makeRng(s);
    const roster = makeRoster(rng, 5);
    for (const n of roster) {
      const nm = nearMiss(rng, n, roster);
      if (nm === null) continue;
      assert(editDistance(n, nm) === 1, `"${n}" -> "${nm}" is ${editDistance(n, nm)} edits`);
      assert(!roster.includes(nm), `"${nm}" collides with a real name in the roster`);
    }
  }
});

check("nearMiss costs the same draw whether or not it finds one", () => {
  const r = counting(11);
  const before = r.count();
  nearMiss(r, "AAAA", ["AAAA"]);   // a name with legal near-misses
  const one = r.count() - before;
  const r2 = counting(11);
  const b2 = r2.count();
  nearMiss(r2, "A", ["A"]);         // pathological: no legal candidate at all
  assert(r2.count() - b2 === one, `draw count differs when no near-miss exists`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log("  ✗ " + f); process.exit(1); }
console.log("woods names: OK");
