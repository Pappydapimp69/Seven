// expedition.mjs — one woods, many days.
//
// Run: node tests/expedition.mjs

import {
  DEFAULT_DAYLIGHT,
  EXPEDITION_PHASE,
  MYSTERY_ASKS_ALLOWED,
  createExpedition,
  spendDaylight,
  recordFact,
  sleep,
  resolveNight,
  activeMystery,
  askMystery,
  accuseMystery,
  proveMystery,
  startKeystoneMorning,
  advanceKeystoneMorning,
  recoverMissing,
  advanceArea,
  serializeExpedition,
  deserializeExpedition,
} from "../src/expedition.js";
import { makeRng } from "../src/rng.js";

let passed = 0;
const failures = [];
const check = (n, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

const PARTY = ["c1", "c2", "c3", "c4", "c5"];

check("a new expedition starts as day one with daylight to spend", () => {
  const e = createExpedition();
  eq(e.day, 1, "day");
  eq(e.phase, EXPEDITION_PHASE.DAY, "phase");
  eq(e.daylight, DEFAULT_DAYLIGHT, "daylight");
  eq(e.current.facts.length, 0, "current facts");
});

check("work spends daylight and refuses work it cannot afford", () => {
  const e = createExpedition({ daylight: 3 });
  assert(spendDaylight(e, 2, "deadfall"), "first spend refused");
  eq(e.daylight, 1, "daylight after spend");
  assert(!spendDaylight(e, 2, "deadfall"), "overspend was allowed");
  eq(e.daylight, 1, "failed spend changed daylight");
  eq(e.lastSpend.reason, "deadfall", "spend reason");
});

check("facts are a day history, not prose", () => {
  const e = createExpedition();
  const f = recordFact(e, {
    kind: "work",
    verb: "cut",
    actor: "c2",
    object: "deadfall",
    place: "north trail",
    withWhom: ["lead", "c4"],
  });
  eq(f.day, 1, "fact day");
  eq(f.i, 0, "fact index");
  eq(f.actor, "c2", "fact actor");
  eq(e.current.facts.length, 1, "fact count");
  f.withWhom.push("mutated");
  eq(e.current.facts[0].withWhom.length, 3, "returned fact is the stored fact");
});

check("sleep closes the day and opens the night", () => {
  const e = createExpedition();
  recordFact(e, { kind: "work", actor: "c1", object: "fire" });
  const day = sleep(e);
  eq(e.phase, EXPEDITION_PHASE.NIGHT, "phase");
  eq(day.day, 1, "closed day");
  eq(day.facts.length, 1, "closed facts");
  eq(e.days.length, 1, "stored days");
});

check("day one is quiet: no replacement when the first night resolves", () => {
  const e = createExpedition({ replacementChance: 1 });
  recordFact(e, { kind: "work", actor: "c1", object: "fire" });
  sleep(e);
  const r = resolveNight(e, makeRng(1), PARTY);
  eq(r, null, "replacement");
  eq(e.day, 2, "next day");
  eq(e.phase, EXPEDITION_PHASE.DAY, "phase");
  eq(e.replacements.length, 0, "replacement count");
});

check("later nights make someone missing and leave a competent replacement at the fire", () => {
  const e = createExpedition({ day: 2, replacementChance: 1 });
  recordFact(e, { kind: "work", actor: "c3", object: "water", withWhom: ["c2"] });
  sleep(e);
  const r = resolveNight(e, makeRng(11), PARTY);
  assert(r && r.missing && r.replacement, "no disappearance chosen");
  assert(["c2", "c3"].includes(r.missing.id), `missing ${r.missing.id} was not in the day's witnessed history`);
  eq(r.replacement.id, r.missing.id, "replacement slot");
  eq(r.replacement.silent, true, "silent flag");
  eq(r.replacement.sameName, true, "sameName flag");
  eq(r.replacement.sameSkills, true, "sameSkills flag");
  eq(e.missing.length, 1, "missing count");
  eq(e.replacements.length, 1, "replacement count");
  eq(e.day, 3, "next day");
});

check("a disappearance opens a multi-day mystery with stable accounts", () => {
  const e = createExpedition({ day: 2, replacementChance: 1 });
  recordFact(e, { kind: "gather", actor: "c3", object: "wood", withWhom: ["c2"] });
  recordFact(e, { kind: "pylon", actor: "c2", object: "P1", withWhom: ["c4"] });
  sleep(e);
  const r = resolveNight(e, makeRng(11), PARTY);
  const m = activeMystery(e);
  assert(r && m, "no active mystery");
  eq(m.suspect, r.missing.id, "suspect follows missing person");
  const nameOf = (id) => id.toUpperCase();
  const first = askMystery(e, m.suspect, nameOf);
  const again = askMystery(e, m.suspect, nameOf);
  assert(first && again, "ask failed");
  eq(again.repeat, true, "repeat flag");
  eq(JSON.stringify(first.lines), JSON.stringify(again.lines), "stable answer");
  eq(m.asksLeft, MYSTERY_ASKS_ALLOWED - 1, "repeat spent daylight");
});

check("accounts carry who was close by, who stayed at camp and who answered a call", () => {
  const e = createExpedition({ day: 2, replacementChance: 1 });
  recordFact(e, { kind: "deadfall", actor: "c3", object: "deadfall", withWhom: ["c2", "you"] });
  recordFact(e, { kind: "call", actor: "c4", object: "your call", withWhom: [] });
  recordFact(e, { kind: "camp", actor: "c1", object: "camp", withWhom: [] });
  recordFact(e, { kind: "fire", actor: "c2", object: "the fire", withWhom: [] });
  sleep(e);
  resolveNight(e, makeRng(11), PARTY);
  const m = activeMystery(e);
  const lines = askMystery(e, m.suspect, (id) => id.toUpperCase()).lines;
  assert(lines.some((l) => /close by/.test(l) && /C2/.test(l)), `no "close by" line naming a neighbour: ${lines.join(" | ")}`);
  assert(lines.some((l) => /came when you called/.test(l)), "no answered-call line");
  assert(lines.some((l) => /stayed at camp/.test(l)), "no stayed-at-camp line");
  assert(lines.some((l) => /lit the fire/.test(l)), "no lit-the-fire line");
});

check("naming the replacement requires a pylon proof before recovery", () => {
  const good = createExpedition({ day: 2, area: 2, replacementChance: 1 });
  recordFact(good, { kind: "gather", actor: "c1", object: "wood", withWhom: ["c4"] });
  sleep(good);
  const r = resolveNight(good, makeRng(17), PARTY);
  const m = activeMystery(good);
  const verdict = accuseMystery(good, m.suspect, (id) => id);
  assert(verdict.proofPending, "accusation did not wait for proof");
  eq(activeMystery(good).searchReady, false, "search unlocked before pylon proof");
  const proved = proveMystery(good, (id) => id);
  assert(proved.correct, "correct proof failed");
  eq(activeMystery(good).searchReady, true, "search not unlocked");
  assert(recoverMissing(good, r.missing.id), "recovery failed");
  eq(activeMystery(good), null, "recovered mystery still active");

  const bad = createExpedition({ day: 2, replacementChance: 1 });
  recordFact(bad, { kind: "gather", actor: "c1", object: "wood", withWhom: ["c4"] });
  sleep(bad);
  resolveNight(bad, makeRng(17), PARTY);
  const bm = activeMystery(bad);
  const wrong = PARTY.find((id) => id !== bm.suspect);
  const badVerdict = accuseMystery(bad, wrong, (id) => id);
  assert(badVerdict.proofPending, "wrong accusation resolved without proof");
  const badProof = proveMystery(bad, (id) => id);
  assert(!badProof.correct, "wrong proof passed");
  eq(activeMystery(bad), null, "wrong closed case still active");
});

check("the keystone morning happens once and returns the party one by one", () => {
  const e = createExpedition({ day: 3 });
  const k = startKeystoneMorning(e, makeRng(5), PARTY, 100);
  assert(k?.active, "keystone did not start");
  eq(k.returned.length, 0, "keystone returned someone immediately");
  eq(startKeystoneMorning(e, makeRng(6), PARTY, 100), null, "keystone started twice");
  eq(advanceKeystoneMorning(e, 101).length, 0, "returned before the first beat");
  const first = advanceKeystoneMorning(e, 102);
  eq(first.length, 1, "first return count");
  assert(PARTY.includes(first[0]), "first return is not a party id");
  const rest = advanceKeystoneMorning(e, 200);
  eq(rest.length, PARTY.length - 1, "remaining return count");
  eq(e.keystone.active, false, "keystone still active after everyone returned");
  eq(JSON.stringify(e.keystone.returned), JSON.stringify(e.keystone.order), "return order drifted");
});

check("disappearance choice is deterministic from the same state and seed", () => {
  const one = createExpedition({ day: 2, replacementChance: 1 });
  const two = createExpedition({ day: 2, replacementChance: 1 });
  for (const e of [one, two]) {
    recordFact(e, { kind: "work", actor: "c1", object: "wood", withWhom: ["c4"] });
    sleep(e);
  }
  const a = resolveNight(one, makeRng(99), PARTY);
  const b = resolveNight(two, makeRng(99), PARTY);
  eq(JSON.stringify(a), JSON.stringify(b), "disappearance");
});

check("a missing person can be recovered inside the spatial window", () => {
  const e = createExpedition({ day: 2, area: 4, replacementChance: 1 });
  recordFact(e, { kind: "work", actor: "c1", object: "wood" });
  sleep(e);
  const r = resolveNight(e, makeRng(17), PARTY);
  assert(r, "no disappearance");
  assert(recoverMissing(e, r.missing.id), "recovery failed");
  eq(e.missing[0].recovered, true, "recovered flag");
  eq(e.missing[0].recoveredArea, 4, "recovered area");
});

check("walking too far forward abandons an unrecovered missing person", () => {
  const e = createExpedition({ day: 2, area: 4, recoveryWindowAreas: 1, replacementChance: 1 });
  recordFact(e, { kind: "work", actor: "c1", object: "wood" });
  sleep(e);
  const r = resolveNight(e, makeRng(17), PARTY);
  assert(r, "no disappearance");
  eq(advanceArea(e, 1).length, 0, "abandoned too early");
  const abandoned = advanceArea(e, 1);
  eq(abandoned.length, 1, "abandoned count");
  eq(abandoned[0].id, r.missing.id, "abandoned id");
  eq(e.missing[0].abandoned, true, "abandoned flag");
});

check("save round-trips all branch-gating expedition state", () => {
  const e = createExpedition({ day: 2, daylight: 8, replacementChance: 1 });
  spendDaylight(e, 3, "scout");
  recordFact(e, { kind: "found", actor: "c5", object: "pylon", place: "ridge" });
  sleep(e);
  resolveNight(e, makeRng(7), PARTY);
  const restored = deserializeExpedition(serializeExpedition(e));
  eq(JSON.stringify(serializeExpedition(restored)), JSON.stringify(serializeExpedition(e)), "round trip");
});

if (failures.length) {
  console.error(`expedition: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log(`expedition: ${passed} passed`);
