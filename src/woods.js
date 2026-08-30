// woods.js — THE WOODS, day one and the morning after. Pure; no DOM, no Three.
//
// This is the ALPHA of a much larger design (docs/IDEAS.md, "THE WOODS: full
// design note"). It builds exactly one thing, because exactly one thing in that
// design is unproven:
//
//   CAN A PLAYER CATCH A FAKE BY ASKING ABOUT A DAY THEY BOTH LIVED THROUGH,
//   AND DOES IT FEEL LIKE DEDUCTION RATHER THAN A COIN FLIP?
//
// So: one scripted day at the camp, seven things that happen with the player
// standing there, a night, and a morning in which somebody at the fire was not
// there yesterday. No map, no crafting, no day/night cycle, no pylons, no
// recruitment, no meta-progression. If the asking is not fun, none of the rest
// is worth building.
//
// SHAPE, inherited deliberately from tutorial.js: this is an OBSERVER and a
// small state machine beside the simulation, not a mode the simulation knows
// about. `tick()` does not branch on it. The player is walking around the same
// camp with the same verbs; this notices where they are and what they pressed.
//
// THE TWO RULES THAT ARE NOT NEGOTIABLE (handoff, and they are why this file
// looks the way it does):
//
//   1. The wrong detail is DERIVED from the record, never authored. See
//      chronicle.js — this file only decides WHO lies, never HOW.
//   2. One seed per run and nothing else. No clock, no device state. A run is
//      saveable, resumable and reproducible, and every draw below is taken
//      unconditionally so the draw count cannot depend on the branch.

import { CELL, GRID, cellToWorld } from "./world.js?v=seven-0.17.0";
import { makeChronicle, record, fact, account, pickPerturbation, WEATHERS } from "./chronicle.js?v=seven-0.17.0";
import { makeRoster, nearMiss } from "./names.js?v=seven-0.17.0";

/**
 * The four places the day happens in, as camp cells.
 *
 * Authored, like the rest of the camp, and for the same reason: the player has
 * to be able to say "the creek" and mean somewhere they have been. They are
 * spread to the four quarters so that "which place" is a real memory rather
 * than a coin flip between two clearings that look alike — a wrong-place claim
 * is only evidence if the places are distinguishable.
 *
 * Validated against the real grid in tests/woods.mjs: open, reachable from
 * spawn, and far enough apart to be told apart.
 */
export const SITES = Object.freeze([
  { id: "fire", label: "camp", cx: 22, cz: 23 },
  { id: "deadfall", label: "deadfall", cx: 12, cz: 31 },
  { id: "creek", label: "creek", cx: 24, cz: 35 },
  { id: "ridge", label: "ridge", cx: 33, cz: 15 },
]);

export const SITE_RADIUS = 5.5;   // how close the player stands to work a site
export const HELPER_RADIUS = 9;   // how close the named hand has to be
export const ASKS_ALLOWED = 3;    // daylight, expressed as questions

/**
 * How long a pair of hands takes over a job.
 *
 * A beat used to resolve on the press. It worked, and it was nothing: the
 * player arrived, tapped a key, and read a subtitle about something they had
 * not watched. The whole design rests on their MEMORY of a day being the
 * evidence, and a memory needs something to be a memory OF — so a beat is a
 * hold, the two of them are working while it runs, and the player is looking
 * at the person whose name they are going to have to remember.
 *
 * Long enough to be a moment, short enough that seven of them is not a chore.
 */
export const WORK_HOLD_TIME = 1.7;

/** Camp-only, like `world.trainer`. Consumers that do not know about it ignore it. */
export function attachSites(world) {
  world.sites = SITES.map((s) => ({ ...s, ...cellToWorld(s.cx, s.cz) }));
  return world;
}

/**
 * The day, as a list of beats. Each is one person doing one thing in one place
 * with the player standing there.
 *
 * The VERB, OBJECT and CLASS are fixed — they are the day, and the day is the
 * same day every run, because a scripted day is what makes the player's memory
 * of it trustworthy enough to be evidence. What varies per run is WHO does
 * which, which is the whole memory load and is drawn from the seed.
 */
export const BEATS = Object.freeze([
  { id: "b1", verb: "gathered", object: "firewood", cls: "timber", site: "deadfall",
    brief: "Take {who} down to the deadfall and bring firewood up." },
  { id: "b2", verb: "fetched", object: "water", cls: "supply", site: "creek",
    brief: "Go with {who} to the creek for water." },
  { id: "b3", verb: "cut", object: "leaning birch", cls: "timber", site: "ridge",
    brief: "{who} has the saw. The leaning birch on the ridge has to come down." },
  { id: "b4", verb: "pitched", object: "tent", cls: "structure", site: "fire",
    brief: "Back at camp — get the tent up with {who}." },
  { id: "b5", verb: "lit", object: "fire", cls: "structure", site: "fire",
    brief: "{who} can get the fire going." },
  { id: "b6", verb: "heard", object: null, cls: null, site: "ridge",
    brief: "Walk the ridge line with {who} before the light goes." },
  { id: "b7", verb: "watched", object: "fire", cls: "structure", site: "fire",
    brief: "That is the day. {who} has first watch — turn in." },
]);

export const PHASE = Object.freeze({
  DAY: "day",           // walking the beats
  NIGHT: "night",       // the swap, one frame
  MORNING: "morning",   // asking
  VERDICT: "verdict",   // named someone, been told
});

/**
 * Set up a run. `rng` is the run's own generator — every draw here is taken
 * unconditionally, in a fixed order, so a resumed run cannot fork.
 *
 * Draw order, and it is load-bearing:
 *   1. the roster (names)
 *   2. the weather
 *   3. the beat assignment (a shuffle of five over seven beats)
 *   4. who gets taken in the night
 *   5. the perturbation
 *
 * 4 and 5 are drawn HERE, at dawn, not at dusk. That is not an optimisation —
 * it is the only way the night's outcome is a function of the seed alone. Drawn
 * at dusk it would be a function of however many draws the player's walking
 * happened to consume, which is not reproducible and not saveable.
 */
export function startDay(sim, rng, partyIds) {
  const roster = makeRoster(rng, partyIds.length);
  const nameById = {};
  partyIds.forEach((id, i) => { nameById[id] = roster[i]; });

  const weather = WEATHERS[Math.floor(rng() * WEATHERS.length)];

  // Every beat gets a named hand. Shuffled so the five are spread over the
  // seven rather than clustered, then the two remainders drawn separately —
  // a player who has to remember "PONVRIK did two of them" is remembering
  // something real about the day.
  const shuffled = rng.shuffled(partyIds);
  const assign = {};
  BEATS.forEach((b, i) => {
    const r = rng();
    assign[b.id] = i < shuffled.length ? shuffled[i] : partyIds[Math.floor(r * partyIds.length)];
  });

  const takenAt = rng();
  const taken = partyIds[Math.floor(takenAt * partyIds.length)];

  const woods = {
    phase: PHASE.DAY,
    beat: 0,
    weather,
    assign,
    nameById,
    taken,
    chronicle: makeChronicle(weather),
    perturbation: null,     // drawn at dusk, from a SEPARATE derived stream
    perturbSeed: (rng() * 0xffffffff) >>> 0,
    hold: { beatId: null, progress: 0 },
    asked: [],
    answers: {},          // what each asked person said, kept verbatim
    asksLeft: ASKS_ALLOWED,
    accused: null,
    correct: null,
  };
  return woods;
}

export const beatAt = (woods) => (woods.beat < BEATS.length ? BEATS[woods.beat] : null);

export function briefFor(woods) {
  const b = beatAt(woods);
  if (!b) return "";
  return b.brief.replace("{who}", woods.nameById[woods.assign[b.id]] || "someone");
}

/**
 * Can the current beat be worked right now? Returns a reason, never a bare
 * false — "nothing happens when I press it" is the failure mode this whole
 * codebase keeps producing, and a reason is what turns it into a instruction.
 */
export function canWork(sim, woods) {
  const b = beatAt(woods);
  if (!b || woods.phase !== PHASE.DAY) return { ok: false, why: null };
  const site = (sim.world.sites || []).find((s) => s.id === b.site);
  if (!site) return { ok: false, why: null };
  const near = Math.hypot(sim.player.x - site.x, sim.player.z - site.z) <= SITE_RADIUS;
  if (!near) return { ok: false, why: null, site };
  const hand = sim.companions.find((c) => c.id === woods.assign[b.id]);
  if (!hand) return { ok: false, why: null, site };
  const handNear = Math.hypot(hand.x - site.x, hand.z - site.z) <= HELPER_RADIUS;
  if (!handNear) return { ok: false, why: `Waiting on ${hand.name}.`, site, hand };
  return { ok: true, why: null, site, hand };
}

/**
 * Advance (or reset) the hold on the current beat.
 *
 * Same shape as the gather hold this borrows from, and the same rule: a hold
 * is a commitment to ONE beat, not a meter to bank. Walking out of the site,
 * letting go, or the named hand wandering off all put it back to zero — you
 * cannot help with half a job.
 *
 * Returns true on the tick it completes, so the caller can do the rest.
 */
export function updateWorkHold(sim, woods, dt, holding) {
  const h = woods.hold || (woods.hold = { beatId: null, progress: 0 });
  const b = beatAt(woods);
  const ok = holding && b && canWork(sim, woods).ok;
  if (!ok) {
    h.beatId = null;
    h.progress = 0;
    return false;
  }
  if (h.beatId !== b.id) {
    h.beatId = b.id;
    h.progress = 0;
  }
  h.progress += dt;
  if (h.progress < WORK_HOLD_TIME) return false;
  h.beatId = null;
  h.progress = 0;
  return true;
}

/** How far through the current beat, 0..1, for the prompt fill. */
export function holdFraction(woods) {
  const b = beatAt(woods);
  const h = woods.hold;
  if (!b || !h || h.beatId !== b.id) return 0;
  return Math.max(0, Math.min(1, h.progress / WORK_HOLD_TIME));
}

/**
 * Work the beat. Writes ONE fact and advances.
 *
 * The fact is the truth, permanently. It is written here, at the moment the
 * player watches it happen, and never rewritten — the player's own memory of
 * this moment is the only copy of the record the game cannot reach, and it is
 * the evidence the whole design rests on.
 */
export function workBeat(sim, woods, emit) {
  const state = canWork(sim, woods);
  if (!state.ok) return null;
  const b = beatAt(woods);
  const hand = state.hand;
  const f = record(woods.chronicle, fact({
    t: sim.time, verb: b.verb, actor: hand.id, object: b.object, cls: b.cls, place: state.site.label,
  }));
  woods.beat += 1;
  emit(sim, "beat", beatLine(b, hand.name, state.site.label), { id: b.id, who: hand.id });
  if (woods.beat >= BEATS.length) woods.phase = PHASE.NIGHT;
  return f;
}

/**
 * What the player sees happen. Phrased in the moment and in the present, unlike
 * chronicle.js's phrasing, which is somebody recounting it the next morning.
 * Two different registers on purpose: the player should not be comparing a
 * remembered SENTENCE against a spoken one, they should be comparing a
 * remembered EVENT against a spoken one.
 */
function beatLine(b, who, place) {
  switch (b.verb) {
    case "gathered": return `${who} loads the ${b.object} and starts back up.`;
    case "fetched": return `${who} fills the cans at the ${place}.`;
    case "cut": return `${who} works the saw. The ${b.object} goes over.`;
    case "pitched": return `${who} walks the ${b.object} up and pegs it out.`;
    case "lit": return `${who} gets the ${b.object} going. It takes.`;
    case "heard": return `${who} stops. Something out past the ${place}.`;
    case "watched": return `${who} takes first watch. You turn in.`;
    default: return `${who}.`;
  }
}

/**
 * The night. Exactly one thing happens and NOTHING IS ANNOUNCED — no line, no
 * sound, no flag on the roster. The tell is not that something is different,
 * it is that nobody else finds it strange, and that only works if the game
 * never points.
 *
 * The perturbation is drawn from a SEPARATE generator seeded off `perturbSeed`,
 * not from `sim.rng`. Two reasons, both structural: the number of draws
 * `pickPerturbation` needs depends on how many candidates the day threw up, and
 * feeding a variable-length draw into the shared stream is exactly the fork the
 * constant-roll-count rule exists to prevent. And it means the lie is a pure
 * function of the seed and the day, so a test can ask for it without playing.
 */
export function fallNight(sim, woods, makeRngFn, emit) {
  if (woods.phase !== PHASE.NIGHT) return null;
  const prng = makeRngFn(woods.perturbSeed);
  const roster = Object.values(woods.nameById);
  // One near-miss per PARTY MEMBER, drawn in a fixed order, whether or not that
  // member did anything yesterday. Drawing them lazily inside the candidate
  // walk made the cost depend on the shape of the day.
  const nearMisses = {};
  for (const id of Object.keys(woods.nameById).sort()) {
    nearMisses[id] = nearMiss(prng, woods.nameById[id], roster);
  }
  woods.perturbation = pickPerturbation(prng, woods.chronicle, nearMisses);
  woods.phase = PHASE.MORNING;
  // The one line the morning gets. It is about the light, not about a person.
  emit(sim, "morning", "Grey light. The fire is down to ash and everyone is up.", { id: "morning" });
  return woods.taken;
}

/**
 * Ask someone about yesterday. Costs one of the day's questions.
 *
 * A real member's account is IDENTICAL to every other real member's — same
 * facts, same order, same phrasing. That is deliberate. If real accounts varied
 * the player would have to first learn what ordinary variation looks like, and
 * a lone difference would prove nothing. Here, one difference is the whole
 * signal, and it costs a third of the morning to look for it.
 *
 * ASKING AGAIN IS FREE, and returns the SAME WORDS. Two reasons, and neither is
 * generosity:
 *
 *   The difficulty this game is for is remembering the DAY — a day the player
 *   played. Forgetting what somebody told you four seconds ago is a different
 *   difficulty, it is not interesting, and the only counterplay for it is
 *   taking notes, which is a chore rather than a decision.
 *
 *   And the account has to be STABLE. If re-asking regenerated it, a player
 *   could ask anybody twice, watch the story move, and have their answer with
 *   no memory involved at all. A fake that cannot hold its own story is caught
 *   by a stopwatch. So the words are kept, and they are save state.
 */
export function ask(sim, woods, id) {
  if (woods.phase !== PHASE.MORNING) return null;
  const nameOf = (cid) => woods.nameById[cid] || cid;
  if (woods.asked.includes(id)) {
    const kept = woods.answers[id];
    return kept ? { who: id, name: nameOf(id), repeat: true, ...kept } : null;
  }
  if (woods.asksLeft <= 0) return null;
  const lying = id === woods.taken;
  const acc = account(woods.chronicle, nameOf, lying ? woods.perturbation : null);
  woods.asked.push(id);
  woods.answers[id] = acc;
  woods.asksLeft -= 1;
  return { who: id, name: nameOf(id), repeat: false, ...acc };
}

/** Name one. This is the run. */
export function accuse(sim, woods, id) {
  if (woods.phase !== PHASE.MORNING) return null;
  woods.accused = id;
  woods.correct = id === woods.taken;
  woods.phase = PHASE.VERDICT;
  return {
    correct: woods.correct,
    accused: woods.nameById[id],
    taken: woods.nameById[woods.taken],
    // For the debrief screen only, once the run is over and nothing is at
    // stake. Never reachable while the player is still deciding.
    tell: woods.perturbation,
  };
}

/** Everything about `woods` that gates a draw or a branch. All of it. */
export function serializeWoods(woods) {
  if (!woods) return null;
  return {
    phase: woods.phase, beat: woods.beat, weather: woods.weather,
    assign: { ...woods.assign }, nameById: { ...woods.nameById },
    taken: woods.taken, perturbSeed: woods.perturbSeed,
    perturbation: woods.perturbation ? { ...woods.perturbation } : null,
    chronicle: { weather: woods.chronicle.weather, facts: woods.chronicle.facts.map((f) => ({ ...f })) },
    hold: { beatId: woods.hold?.beatId ?? null, progress: woods.hold?.progress ?? 0 },
    asked: woods.asked.slice(), asksLeft: woods.asksLeft,
    // The words themselves, not just who was asked. A reload that regenerated
    // them would be safe today — the perturbation is fixed and the renderer is
    // pure — but "the account is stable" is a RULE of this design, and a rule
    // that holds by coincidence is one edit from not holding.
    answers: Object.fromEntries(Object.entries(woods.answers || {}).map(([k, v]) => [k, { weather: v.weather, lines: v.lines.slice() }])),
    accused: woods.accused, correct: woods.correct,
  };
}

export function deserializeWoods(d) {
  if (!d) return null;
  return {
    phase: d.phase, beat: d.beat, weather: d.weather,
    assign: { ...d.assign }, nameById: { ...d.nameById },
    taken: d.taken, perturbSeed: d.perturbSeed,
    perturbation: d.perturbation ? { ...d.perturbation } : null,
    chronicle: { weather: d.chronicle.weather, facts: d.chronicle.facts.map((f) => ({ ...f, withWhom: (f.withWhom || []).slice() })) },
    hold: { beatId: d.hold?.beatId ?? null, progress: d.hold?.progress ?? 0 },
    asked: (d.asked || []).slice(), asksLeft: d.asksLeft,
    answers: Object.fromEntries(Object.entries(d.answers || {}).map(([k, v]) => [k, { weather: v.weather, lines: (v.lines || []).slice() }])),
    accused: d.accused ?? null, correct: d.correct ?? null,
  };
}

/**
 * Words that must never reach the player, same discipline as the tutorial's.
 * Here the withheld fact is not a meter — it is WHO. Nothing this module says
 * may name the taken member, hint at a swap, or describe anyone as wrong,
 * off, different, or not themselves.
 */
export const FORBIDDEN = Object.freeze([
  "hallucinat", "fake", "impost", "replaced", "swap", "not themselves", "wrong one", "suspicious",
  "lucidity", "sanity", "meter", "%",
]);

export function leaks(text) {
  const low = String(text || "").toLowerCase();
  return FORBIDDEN.filter((w) => low.includes(w));
}

export const CELL_SIZE = CELL;
export const GRID_SIZE = GRID;
