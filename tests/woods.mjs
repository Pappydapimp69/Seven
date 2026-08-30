// woods.mjs — the day, the night, and the morning.
//
// tests/chronicle.mjs proves the ACCOUNT is sound in isolation. This proves the
// day around it holds: that the record is written from what the player actually
// watched, that the night costs nothing but is not free, that the morning is
// short enough to be a memory game rather than a diffing exercise, and that a
// run saved halfway through comes back the same run.
//
// Run: node tests/woods.mjs

import {
  SITES, BEATS, PHASE, ASKS_ALLOWED, SITE_RADIUS, HELPER_RADIUS,
  attachSites, startDay, beatAt, briefFor, canWork, workBeat, fallNight, ask, accuse,
  serializeWoods, deserializeWoods, leaks, FORBIDDEN,
} from "../src/woods.js";
import { accountText } from "../src/chronicle.js";
import { buildCamp } from "../src/camp.js";
import { createRun } from "../src/state.js";
import { GRID, CELL, floodFill } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import { readFileSync } from "fs";

let passed = 0;
const failures = [];
const check = (n, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

const PARTY = ["c1", "c2", "c3", "c4", "c5"];
const noEmit = () => {};

function aRun(seed = 1) {
  const world = attachSites(buildCamp());
  const sim = createRun({ seed: -1, world });
  const rng = makeRng(seed);
  const woods = startDay(sim, rng, PARTY);
  return { sim, woods, rng };
}

/** Stand the player, and the beat's named hand, at the beat's site. */
function standAtBeat(sim, woods, { hand = true } = {}) {
  const b = beatAt(woods);
  const site = sim.world.sites.find((s) => s.id === b.site);
  sim.player.x = site.x; sim.player.z = site.z;
  const who = sim.companions.find((c) => c.id === woods.assign[b.id]);
  for (const c of sim.companions) { c.x = site.x + 400; c.z = site.z + 400; }
  if (hand) { who.x = site.x + 1; who.z = site.z + 1; }
  return { site, who };
}

function playTheDay(sim, woods) {
  const guard = BEATS.length + 5;
  for (let i = 0; i < guard && woods.phase === PHASE.DAY; i++) {
    standAtBeat(sim, woods);
    workBeat(sim, woods, noEmit);
  }
  return woods;
}

// --- the ground the day happens on --------------------------------------

check("every site is open, reachable and somewhere you could actually stand", () => {
  const w = buildCamp();
  const reach = floodFill(w.blocked, w.camp.cx, w.camp.cz);
  for (const s of SITES) {
    const i = s.cz * GRID + s.cx;
    eq(w.blocked[i], 0, `site "${s.id}" is inside something solid`);
    assert(reach[i], `site "${s.id}" is not reachable from spawn`);
  }
});

check("the four places are far enough apart to be told apart", () => {
  // A wrong-place claim is only evidence if the player can distinguish the
  // places. Two clearings thirty paces apart are one clearing as far as memory
  // is concerned, and the tell becomes a coin flip.
  for (let a = 0; a < SITES.length; a++) {
    for (let b = a + 1; b < SITES.length; b++) {
      const d = Math.hypot(SITES[a].cx - SITES[b].cx, SITES[a].cz - SITES[b].cz) * CELL;
      assert(d > SITE_RADIUS * 4, `${SITES[a].id} and ${SITES[b].id} are only ${d.toFixed(1)}m apart`);
    }
  }
});

check("every beat names a site that exists", () => {
  const ids = new Set(SITES.map((s) => s.id));
  for (const b of BEATS) assert(ids.has(b.site), `beat "${b.id}" happens at "${b.site}", which is nowhere`);
});

// --- the day is a function of the seed -----------------------------------

check("the same seed gives the same day", () => {
  for (const s of [1, 88, 5150]) {
    const a = JSON.stringify(serializeWoods(aRun(s).woods));
    const b = JSON.stringify(serializeWoods(aRun(s).woods));
    eq(a, b, `seed ${s} produced two different days`);
  }
});

check("setting up a day costs the same number of draws every time", () => {
  const counts = new Set();
  for (let s = 1; s <= 120; s++) {
    const inner = makeRng(s);
    let n = 0;
    const rng = () => { n++; return inner(); };
    rng.shuffled = (a) => { const o = a.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
    const world = attachSites(buildCamp());
    startDay(createRun({ seed: -1, world }), rng, PARTY);
    counts.add(n);
  }
  eq(counts.size, 1, `draw count varies across seeds: ${[...counts].join(",")}`);
});

check("who gets taken is not always the same person", () => {
  const taken = {};
  for (let s = 1; s <= 400; s++) taken[aRun(s).woods.taken] = (taken[aRun(s).woods.taken] || 0) + 1;
  for (const id of PARTY) assert((taken[id] || 0) > 20, `${id} was taken only ${taken[id] || 0} times in 400 runs`);
});

check("the beats are spread across the party, not handed to one person", () => {
  // The memory load IS the assignment. If one member drew five of the seven,
  // there would be almost nothing to remember about the other four and a
  // wrong-actor tell would be unreadable.
  for (let s = 1; s <= 200; s++) {
    const { woods } = aRun(s);
    const counts = {};
    for (const b of BEATS) counts[woods.assign[b.id]] = (counts[woods.assign[b.id]] || 0) + 1;
    eq(Object.keys(counts).length, PARTY.length, `seed ${s}: only ${Object.keys(counts).length} people did anything`);
    for (const id of PARTY) assert(counts[id] <= 3, `seed ${s}: ${id} drew ${counts[id]} of ${BEATS.length} beats`);
  }
});

// --- working the day ------------------------------------------------------

check("a beat needs the player AT the site", () => {
  const { sim, woods } = aRun(4);
  const { site } = standAtBeat(sim, woods);
  sim.player.x = site.x + SITE_RADIUS + 3;
  assert(!canWork(sim, woods).ok, "worked a beat from outside the site");
  assert(workBeat(sim, woods, noEmit) === null, "workBeat wrote a fact from outside the site");
  eq(woods.chronicle.facts.length, 0, "a fact was recorded anyway");
});

check("a beat needs the NAMED hand, not just anybody", () => {
  // The whole memory load is who did what. A beat that resolves with whoever
  // happens to be standing there records a fact the player has no reason to
  // remember, and the account built on it is unfalsifiable.
  const { sim, woods } = aRun(9);
  const { site, who } = standAtBeat(sim, woods, { hand: false });
  const other = sim.companions.find((c) => c.id !== who.id);
  other.x = site.x + 1; other.z = site.z + 1;
  const state = canWork(sim, woods);
  assert(!state.ok, "a beat resolved with the wrong person standing there");
  assert(state.why && state.why.includes(who.name), `the refusal should name who is missing, got "${state.why}"`);
});

check("a full day writes one fact per beat, in the order they were played", () => {
  const { sim, woods } = aRun(12);
  playTheDay(sim, woods);
  eq(woods.chronicle.facts.length, BEATS.length, "wrong number of facts");
  eq(woods.phase, PHASE.NIGHT, "the day did not end");
  BEATS.forEach((b, i) => {
    const f = woods.chronicle.facts[i];
    eq(f.verb, b.verb, `fact ${i} verb`);
    eq(f.actor, woods.assign[b.id], `fact ${i} actor`);
    eq(f.i, i, `fact ${i} index`);
  });
});

check("the brief always names somebody real", () => {
  for (let s = 1; s <= 50; s++) {
    const { sim, woods } = aRun(s);
    for (let i = 0; i < BEATS.length; i++) {
      const text = briefFor(woods);
      assert(!text.includes("{who}"), `seed ${s} beat ${i}: the placeholder survived`);
      assert(!text.includes("someone"), `seed ${s} beat ${i}: fell back to "someone"`);
      standAtBeat(sim, woods);
      workBeat(sim, woods, noEmit);
    }
  }
});

// --- the night ------------------------------------------------------------

check("the night takes somebody and says nothing about it", () => {
  const { sim, woods } = aRun(21);
  playTheDay(sim, woods);
  const said = [];
  const taken = fallNight(sim, woods, makeRng, (s, kind, text) => said.push(text));
  assert(taken === woods.taken, "fallNight did not report who was taken");
  eq(woods.phase, PHASE.MORNING, "the morning did not come");
  assert(woods.perturbation, "nobody got anything wrong");
  for (const t of said) {
    assert(!t.includes(woods.nameById[woods.taken]), `the night named the taken member: "${t}"`);
    eq(leaks(t).length, 0, `the night leaked ${leaks(t).join(",")}: "${t}"`);
  }
});

check("what happens in the night depends on the seed, not on the walking", () => {
  // The player's route consumes draws from sim.rng. If the night were rolled at
  // dusk off that stream, two players with the same seed who wandered
  // differently would meet different nights, and no save could reproduce one.
  const a = aRun(33), b = aRun(33);
  for (let i = 0; i < 500; i++) a.sim.rng(); // one player wandered, the other did not
  playTheDay(a.sim, a.woods); playTheDay(b.sim, b.woods);
  fallNight(a.sim, a.woods, makeRng, noEmit); fallNight(b.sim, b.woods, makeRng, noEmit);
  eq(a.woods.taken, b.woods.taken, "a different person was taken");
  eq(JSON.stringify(a.woods.perturbation), JSON.stringify(b.woods.perturbation), "a different thing went wrong");
});

// --- the morning ----------------------------------------------------------

check("you cannot ask everybody — the morning is shorter than the party", () => {
  // This is the difference between a memory game and a diffing exercise. Given
  // one question per member, the player lays five accounts side by side and
  // reads off the odd one out without remembering anything at all.
  assert(ASKS_ALLOWED < PARTY.length, `${ASKS_ALLOWED} questions for ${PARTY.length} people is a spreadsheet, not a morning`);
});

check("every real member tells it the same way, and the taken one does not", () => {
  for (let s = 1; s <= 200; s++) {
    const { sim, woods } = aRun(s);
    playTheDay(sim, woods);
    fallNight(sim, woods, makeRng, noEmit);
    const real = PARTY.filter((id) => id !== woods.taken);
    const texts = real.map((id) => {
      woods.asksLeft = 99; woods.asked = [];
      return accountText(ask(sim, woods, id));
    });
    assert(new Set(texts).size === 1, `seed ${s}: real members disagree with each other`);
    woods.asksLeft = 99; woods.asked = [];
    const lie = accountText(ask(sim, woods, woods.taken));
    assert(lie !== texts[0], `seed ${s}: the taken member's account is identical to everyone else's`);
  }
});

check("a question is spent whether or not it told you anything", () => {
  const { sim, woods } = aRun(41);
  playTheDay(sim, woods);
  fallNight(sim, woods, makeRng, noEmit);
  eq(woods.asksLeft, ASKS_ALLOWED, "started with the wrong number of questions");
  for (let i = 0; i < ASKS_ALLOWED; i++) {
    assert(ask(sim, woods, PARTY[i]), `ask ${i} refused`);
    eq(woods.asksLeft, ASKS_ALLOWED - 1 - i, `ask ${i} did not cost a question`);
  }
  assert(ask(sim, woods, PARTY[4]) === null, "asked a fourth question with three in the morning");
});

check("asking the same person twice is free and tells you nothing new", () => {
  const { sim, woods } = aRun(43);
  playTheDay(sim, woods);
  fallNight(sim, woods, makeRng, noEmit);
  ask(sim, woods, PARTY[0]);
  const left = woods.asksLeft;
  assert(ask(sim, woods, PARTY[0]) === null, "asked the same person twice");
  eq(woods.asksLeft, left, "a repeat question cost daylight");
});

check("you cannot ask before the night or after naming somebody", () => {
  const { sim, woods } = aRun(47);
  assert(ask(sim, woods, PARTY[0]) === null, "asked about yesterday during yesterday");
  playTheDay(sim, woods);
  fallNight(sim, woods, makeRng, noEmit);
  accuse(sim, woods, PARTY[0]);
  assert(ask(sim, woods, PARTY[1]) === null, "asked a question after the verdict");
});

check("naming the taken member is right, and naming anyone else is wrong", () => {
  for (let s = 1; s <= 120; s++) {
    for (const guess of PARTY) {
      const { sim, woods } = aRun(s);
      playTheDay(sim, woods);
      fallNight(sim, woods, makeRng, noEmit);
      const v = accuse(sim, woods, guess);
      eq(v.correct, guess === woods.taken, `seed ${s}: naming ${guess} when ${woods.taken} was taken`);
      eq(v.taken, woods.nameById[woods.taken], `seed ${s}: the verdict named the wrong person`);
      eq(woods.phase, PHASE.VERDICT, "the run did not end");
    }
  }
});

// --- saving halfway through ----------------------------------------------

check("a run saved mid-morning comes back the same run", () => {
  // Anything that gates a draw or a branch is save state. The chronicle IS the
  // day; a fact lost in the round trip is a question the player asked and can
  // never get an answer to.
  for (let s = 1; s <= 60; s++) {
    const { sim, woods } = aRun(s);
    playTheDay(sim, woods);
    fallNight(sim, woods, makeRng, noEmit);
    ask(sim, woods, PARTY[0]);
    const restored = deserializeWoods(JSON.parse(JSON.stringify(serializeWoods(woods))));
    eq(JSON.stringify(serializeWoods(restored)), JSON.stringify(serializeWoods(woods)), `seed ${s}: round trip changed the day`);
    for (const id of PARTY) {
      const a = { ...woods, asksLeft: 9, asked: [] };
      const b = { ...restored, asksLeft: 9, asked: [] };
      eq(accountText(ask(sim, b, id)), accountText(ask(sim, a, id)), `seed ${s}: ${id} tells it differently after a reload`);
    }
    const a2 = { ...woods, phase: PHASE.MORNING };
    const b2 = { ...restored, phase: PHASE.MORNING };
    eq(accuse(sim, b2, PARTY[2]).correct, accuse(sim, a2, PARTY[2]).correct, `seed ${s}: the verdict changed after a reload`);
  }
});

check("the save carries every field the day branches on", () => {
  const { sim, woods } = aRun(71);
  playTheDay(sim, woods);
  fallNight(sim, woods, makeRng, noEmit);
  const saved = serializeWoods(woods);
  for (const key of Object.keys(woods)) {
    assert(key in saved, `"${key}" is live state and is not saved`);
  }
});

// --- what may never be said ----------------------------------------------

check("no authored string in the day points at the swap", () => {
  // Same discipline as the tutorial's meter rule, different withheld fact. The
  // tell is that NOBODY ELSE FINDS IT STRANGE; a caption that hints at a swap
  // hands the player the answer and there is nothing left to deduce.
  for (const b of BEATS) {
    const bad = leaks(b.brief);
    eq(bad.length, 0, `beat "${b.id}" brief leaks ${bad.join(", ")}`);
  }
  const src = readFileSync(new URL("../src/woods.js", import.meta.url), "utf8");
  // Only the literal strings that can reach a player, not the commentary that
  // explains why they may not.
  for (const m of src.matchAll(/emit\([^,]+,\s*"[^"]*",\s*"([^"]*)"/g)) {
    const bad = leaks(m[1]);
    eq(bad.length, 0, `an emitted line leaks ${bad.join(", ")}: "${m[1]}"`);
  }
  assert(FORBIDDEN.length > 0, "the forbidden list is empty");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log("  ✗ " + f); process.exit(1); }
console.log("woods day: OK");
