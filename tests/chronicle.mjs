// chronicle.mjs — the account, and the one thing wrong with it.
//
// This is the load-bearing test of THE WOODS. The design has exactly one
// unproven claim in it, and the two ways that claim dies are both checked here:
//
//   IT DIES AS A COIN FLIP if a fake's account can render identically to a real
//   one. The player spends a third of their morning asking, gets nothing back,
//   and no layer errors. Checked over every seed and every perturbation kind.
//
//   IT DIES AS A MEMORY GAME if the wrong details come from a hand-written
//   list. By run ten the player is matching against the list rather than
//   against their memory of the day. So every perturbed value is checked to be
//   a value the day itself produced.
//
// Run: node tests/chronicle.mjs

import { makeChronicle, record, fact, account, accountText, phrase, candidates, pickPerturbation, PERTURBATION_KINDS, WEATHERS } from "../src/chronicle.js";
import { makeRng } from "../src/rng.js";
import { makeRoster, nearMiss, editDistance } from "../src/names.js";
import { readFileSync } from "fs";

let passed = 0;
const failures = [];
const check = (n, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// A day, built the way woods.js builds one: fixed verbs, seeded actors.
function nearMissMap(rng, ids, roster) {
  const m = {};
  for (const id of ids) m[id] = nearMiss(rng, roster[ids.indexOf(id)], roster);
  return m;
}

function aDay(seed, nBeats = 7) {
  const rng = makeRng(seed);
  const ids = ["c1", "c2", "c3", "c4", "c5"];
  const roster = makeRoster(rng, 5);
  const nameOf = (id) => roster[ids.indexOf(id)];
  const spec = [
    ["gathered", "firewood", "timber", "deadfall"],
    ["fetched", "water", "supply", "creek"],
    ["cut", "leaning birch", "timber", "ridge"],
    ["pitched", "tent", "structure", "camp"],
    ["lit", "fire", "structure", "camp"],
    ["heard", null, null, "ridge"],
    ["watched", "fire", "structure", "camp"],
  ].slice(0, nBeats);
  const chron = makeChronicle(WEATHERS[Math.floor(rng() * WEATHERS.length)]);
  const order = rng.shuffled(ids);
  spec.forEach(([verb, object, cls, place], i) => {
    record(chron, fact({ t: i, verb, actor: order[i % order.length], object, cls, place }));
  });
  return { chron, nameOf, roster, ids, rng };
}

check("two real members give the same account, word for word", () => {
  // The identity is the signal. If real accounts varied, one difference would
  // prove nothing and the player would first have to learn what ordinary
  // variation looks like — which is a second game, and not this one.
  for (let s = 1; s <= 60; s++) {
    const { chron, nameOf } = aDay(s);
    const a = accountText(account(chron, nameOf, null));
    const b = accountText(account(chron, nameOf, null));
    assert(a === b, `seed ${s}: real accounts differ`);
  }
});

check("a fake's account ALWAYS reads differently from the truth", () => {
  // The one that matters. A perturbation the player cannot see is worse than
  // no perturbation: they do the work, get nothing, and the run is a coin flip
  // with nothing erroring anywhere.
  let n = 0;
  for (let s = 1; s <= 600; s++) {
    const { chron, nameOf, roster, ids } = aDay(s);
    const prng = makeRng(s * 7919);
    const p = pickPerturbation(prng, chron, nearMissMap(prng, ["c1","c2","c3","c4","c5"], roster));
    assert(p, `seed ${s}: no perturbation available at all`);
    const truth = accountText(account(chron, nameOf, null));
    const lie = accountText(account(chron, nameOf, p));
    assert(truth !== lie, `seed ${s}: ${JSON.stringify(p)} renders identically to the truth`);
    n++;
    void ids;
  }
  assert(n === 600, "sweep did not run");
});

check("a fake's account differs in exactly ONE respect", () => {
  // One bent fact, not two. Two is a different game — it is spot-the-pattern,
  // and it makes a wrong guess feel unfair rather than costly.
  for (let s = 1; s <= 300; s++) {
    const { chron, nameOf, roster } = aDay(s);
    const prng = makeRng(s * 104729);
    const p = pickPerturbation(prng, chron, nearMissMap(prng, ["c1","c2","c3","c4","c5"], roster));
    const t = accountText(account(chron, nameOf, null)).split("\n");
    const l = accountText(account(chron, nameOf, p)).split("\n");
    assert(t.length === l.length, `seed ${s}: line count changed`);
    const diff = t.filter((line, i) => line !== l[i]).length;
    // ONE bent fact, which is not the same as one changed line. An order swap
    // moves the two lines it swapped. A wrong NAME is one wrong belief about
    // one person, and it surfaces in every line that person appears in — a
    // speaker who spelled it wrong once and right afterwards would be holding
    // two beliefs about the same person, which nobody does.
    const chron2 = chron;
    let allowed = 1;
    if (p.kind === "order") allowed = 2;
    if (p.kind === "name") allowed = chron2.facts.filter((f) => f.actor === chron2.facts[p.at].actor).length;
    assert(diff === allowed, `seed ${s}: ${p.kind} changed ${diff} lines, expected ${allowed}`);
  }
});

check("every wrong detail is a value the day actually produced", () => {
  // Derived, not authored. This is the check that keeps the game alive past
  // run ten: there is no list to memorise because every candidate came out of
  // the record.
  for (let s = 1; s <= 400; s++) {
    const { chron, nameOf, roster } = aDay(s);
    const prng = makeRng(s * 15485863);
    const p = pickPerturbation(prng, chron, nearMissMap(prng, ["c1","c2","c3","c4","c5"], roster));
    const actors = new Set(chron.facts.map((f) => f.actor));
    const places = new Set(chron.facts.map((f) => f.place).filter(Boolean));
    const objects = new Set(chron.facts.map((f) => f.object).filter(Boolean));
    switch (p.kind) {
      case "actor": assert(actors.has(p.to), `seed ${s}: actor ${p.to} was never there`); break;
      case "place": assert(places.has(p.to), `seed ${s}: place ${p.to} was never visited`); break;
      case "object": assert(objects.has(p.to), `seed ${s}: object ${p.to} was never handled`); break;
      case "weather":
        assert(WEATHERS.includes(p.to), `seed ${s}: ${p.to} is not a weather`);
        assert(p.to !== chron.weather, `seed ${s}: the "wrong" weather is the real one`);
        break;
      case "name": {
        const real = roster.find((r) => editDistance(r, p.to) === 1);
        assert(real, `seed ${s}: "${p.to}" is not one edit from anybody real`);
        assert(!roster.includes(p.to), `seed ${s}: "${p.to}" IS somebody real`);
        break;
      }
      case "order": assert(p.at + 1 < chron.facts.length, `seed ${s}: order swap out of range`); break;
      default: throw new Error(`seed ${s}: unknown kind ${p.kind}`);
    }
  }
});

check("a wrong object stays grammatical — it never crosses its class", () => {
  // "went down to the creek for tent" reads as a bug, not as a lie, and a tell
  // that reads as a bug is worse than none: the player learns to distrust the
  // renderer rather than the speaker.
  for (let s = 1; s <= 400; s++) {
    const { chron } = aDay(s);
    for (const c of candidates(chron, {})) {
      if (c.kind !== "object") continue;
      const from = chron.facts[c.at];
      const to = chron.facts.find((f) => f.object === c.to);
      assert(to && from.cls === to.cls, `seed ${s}: ${from.object} (${from.cls}) -> ${c.to} (${to?.cls})`);
    }
  }
});

check("all six shapes of wrongness actually occur", () => {
  // A kind that never fires is a kind that does not exist, and the design's
  // whole defence against repetition is that the SHAPE varies, not just the
  // instance.
  const seen = new Set();
  for (let s = 1; s <= 400; s++) {
    const { chron, nameOf, roster } = aDay(s);
    const prng = makeRng(s * 2971215073);
    const p = pickPerturbation(prng, chron, nearMissMap(prng, ["c1","c2","c3","c4","c5"], roster));
    seen.add(p.kind);
  }
  for (const k of PERTURBATION_KINDS) assert(seen.has(k), `"${k}" never occurred in 400 runs`);
});

check("an order swap that would render identically is not offered", () => {
  // Needs a rigged day: 600 natural seeds never produced two adjacent facts
  // that phrase the same, so the filter is a guard that has never been observed
  // to fail. Two identical adjacent facts are the case — swapping them is a
  // perturbation the player cannot see, and it must not be a candidate at all.
  const chron = makeChronicle("clear");
  record(chron, fact({ t: 0, verb: "gathered", actor: "c1", object: "firewood", cls: "timber", place: "deadfall" }));
  record(chron, fact({ t: 1, verb: "gathered", actor: "c1", object: "firewood", cls: "timber", place: "deadfall" }));
  record(chron, fact({ t: 2, verb: "lit", actor: "c2", object: "fire", cls: "structure", place: "camp" }));
  const orders = candidates(chron, {}).filter((c) => c.kind === "order");
  assert(!orders.some((c) => c.at === 0), "the identical adjacent pair was offered as an order swap");
  assert(orders.some((c) => c.at === 1), "the distinguishable pair should still be offered");
});

check("the wrong weather is never today's weather", () => {
  // Asserted at the candidate level, not through pickPerturbation: the
  // visibility fallback there would quietly filter a same-weather candidate
  // out, so a test that only watches the output cannot tell whether the rule
  // exists or whether something downstream is covering for its absence.
  for (const w of WEATHERS) {
    const chron = makeChronicle(w);
    record(chron, fact({ t: 0, verb: "lit", actor: "c1", object: "fire", cls: "structure", place: "camp" }));
    const ws = candidates(chron, {}).filter((c) => c.kind === "weather");
    assert(ws.length === WEATHERS.length - 1, `${w}: got ${ws.length} weather candidates`);
    assert(!ws.some((c) => c.to === w), `${w}: today's weather was offered as the wrong one`);
  }
});

check("picking a perturbation costs a fixed number of draws", () => {
  // Sweeps the DAY SHAPE as well as the seed. Holding the shape fixed makes
  // the candidate list a constant length, and a draw-per-candidate defect is
  // then invisible — which is exactly what this test did until it was broken
  // on purpose and did not fail.
  const counts = new Set();
  for (let s = 1; s <= 200; s++) {
    const { chron, nameOf, roster } = aDay(s, 1 + (s % 7));
    const inner = makeRng(s * 13);
    let n = 0;
    const prng = () => { n++; return inner(); };
    pickPerturbation(prng, chron, nearMissMap(prng, ["c1","c2","c3","c4","c5"], roster));
    counts.add(n);
  }
  assert(counts.size === 1, `draw count varies with the day: ${[...counts].join(",")}`);
});

check("a one-beat day still yields a visible lie or none at all", () => {
  // Degenerate input. A single fact has no adjacent pair to swap and no second
  // actor to blame, so most kinds are unavailable — the function must narrow to
  // what is left rather than return something that renders identically.
  const rng = makeRng(3);
  const roster = makeRoster(rng, 5);
  const chron = makeChronicle("fog");
  record(chron, fact({ t: 0, verb: "lit", actor: "c1", object: "fire", cls: "structure", place: "camp" }));
  for (let s = 1; s <= 50; s++) {
    const prng = makeRng(s);
    const p = pickPerturbation(prng, chron, nearMissMap(prng, ["c1","c2","c3","c4","c5"], roster));
    if (!p) continue;
    const t = accountText(account(chron, (id) => roster[0], null));
    const l = accountText(account(chron, (id) => roster[0], p));
    assert(t !== l, `seed ${s}: ${JSON.stringify(p)} is invisible on a one-fact day`);
  }
});

check("phrasing is shared — there is no separate voice for a fake", () => {
  // Read the source: a second phrasing table, or any branch in `phrase` on who
  // is speaking, would mean the player is reading style rather than substance,
  // and the perturbation would be decoration.
  const src = readFileSync(new URL("../src/chronicle.js", import.meta.url), "utf8");
  const tables = src.match(/_PHRASE\s*=\s*\{/g) || [];
  assert(tables.length === 2, `expected exactly two phrasing tables (verb, weather), found ${tables.length}`);
  assert(!/function phrase\([^)]*\)[\s\S]{0,400}?(fake|lying|perturb)/.test(src),
    "phrase() branches on who is speaking");
});

check("an unknown verb is loud, not silent", () => {
  const chron = makeChronicle("clear");
  record(chron, fact({ t: 0, verb: "invented", actor: "c1", place: "camp" }));
  let threw = false;
  try { phrase(chron.facts[0], (x) => x); } catch { threw = true; }
  assert(threw, "a verb with no phrasing rendered instead of throwing");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log("  ✗ " + f); process.exit(1); }
console.log("woods chronicle: OK");
