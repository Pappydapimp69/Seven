// chronicle.js — the day's record, and the accounts derived from it.
//
// SEVEN's one rule: TELLS ARE DERIVED, NEVER AUTHORED. The investigation works
// by asking someone about a day you both lived through. A real account is the
// day's log read back faithfully; a false one is the SAME log with one fact
// perturbed. Nothing in this file contains a list of lies.
//
// Why a new module rather than `sim.events`.
//
// `emit()`/`sim.events` looks like the event stream this needs, and the handoff
// says to reuse it. It is not: `tick()` opens with `sim.events.length = 0`, the
// buffer caps at 64, and `serializeRun` does not save it. It is a one-frame
// message bus for the HUD, not a record of the day. An account derived from it
// would recount only whatever happened in the last sixteen milliseconds and
// would come back empty across a save. So the chronicle is its own thing:
// append-only, structured, and save state.
//
// Entries hold FACTS, never sentences. Text is rendered from the facts at the
// moment of asking, so a perturbed fact necessarily changes what is said. Store
// a rendered string on the entry and you get the opposite: an authored tell.

import { makeRng } from "./rng.js?v=seven-0.12.0";

/** The fact axes a false account can get wrong. */
export const TELL = {
  ORDER: "order",     // two things recounted in the wrong sequence
  WEATHER: "weather", // right event, wrong sky
  NAME: "name",       // right event, wrong person in it
};

/**
 * The day's weather vocabulary. A fact domain, not a tell list — the chronicle
 * records which one actually held, and a false account names a different one.
 */
export const WEATHER = ["clear", "overcast", "drizzle", "fog", "wind"];

// How each kind of thing that happens is said out loud. The TEMPLATE is
// authored — English has to come from somewhere — but every value it
// interpolates comes off the entry, which is why perturbing a fact moves the
// sentence and why a player cannot memorise a tell: the tell is WHICH fact is
// wrong, and that varies with the day.
const PHRASING = {
  arrive: (a) => `${a.who} got to ${a.place} first`,
  gather: (a) => `${a.who} was pulling deadwood by ${a.place}`,
  chop: (a) => `${a.who} took the axe to the trunk at ${a.place}`,
  cook: (a) => `${a.who} had the pot on at ${a.place}`,
  watch: (a) => `${a.who} sat first watch at ${a.place}`,
  argue: (a) => `${a.who} and ${a.other} went at it over ${a.place}`,
  rest: (a) => `${a.who} turned in early at ${a.place}`,
};

/** Kinds this module knows how to say. Callers get a hard error, not silence. */
export const CHRONICLE_KINDS = Object.keys(PHRASING);

/**
 * Append one thing that happened. `actors` are character ids; the FIRST is the
 * subject of the sentence. `seq` is the entry's place in the day and is what an
 * ORDER tell permutes — it is assigned here rather than read from the array
 * index so that a recounting can be reordered without disturbing the record.
 */
export function record(sim, kind, { actors = [], place = "camp", weather = "clear" } = {}) {
  if (!PHRASING[kind]) throw new Error(`chronicle: unknown kind '${kind}'`);
  if (!WEATHER.includes(weather)) throw new Error(`chronicle: unknown weather '${weather}'`);
  const entry = { seq: sim.chronicle.length, kind, actors: actors.slice(), place, weather, t: sim.time };
  sim.chronicle.push(entry);
  return entry;
}

/** The entries a given character can honestly speak to: the ones they were in. */
export function witnessed(chronicle, id) {
  return chronicle.filter((e) => e.actors.includes(id));
}

/**
 * Every perturbation that would actually CHANGE this account, built from the
 * log itself. Enumerated first and picked from second, deliberately: choosing a
 * tell type and then discovering the day cannot support it (one entry, so
 * nothing to reorder; a one-name roster, so no other name to swap in) is how a
 * false account silently comes out identical to a true one — a fake nobody can
 * catch, which reads to a player as the investigation being broken.
 */
function candidates(seen, roster) {
  const out = [];
  for (let i = 0; i + 1 < seen.length; i++) out.push({ type: TELL.ORDER, at: i });
  for (let i = 0; i < seen.length; i++) {
    for (const w of WEATHER) if (w !== seen[i].weather) out.push({ type: TELL.WEATHER, at: i, to: w });
  }
  for (let i = 0; i < seen.length; i++) {
    // A name tell replaces the SUBJECT — who did the thing — not who was
    // standing around. Gating it on "was not present" produced no name tells at
    // all in the alpha, because the alpha is a fixed camp where everyone is
    // present for everything; the pool silently collapsed to order and weather
    // and the tell became memorisable in two axes, which is most of the way to
    // the failure the design note warns about. Being at the fire all day does
    // not make "Vaskel took the axe" true when Selby did.
    for (const r of roster) {
      if (r.id !== seen[i].actors[0]) out.push({ type: TELL.NAME, at: i, to: r.id });
    }
  }
  return out;
}

const nameOf = (roster, id) => roster.find((r) => r.id === id)?.name ?? id;

/**
 * Recount a day.
 *
 * `speaker.tellSeed` is the whole source of randomness here, NOT `sim.rng`.
 * Two invariants ride on that:
 *
 *   - Constant roll count. Asking must not move the shared stream, or a run
 *     where the player asked three people diverges from the same run where
 *     they asked two, and a resumed save takes a different branch minutes
 *     later. Every draw in here comes off a private stream seeded from a word
 *     drawn once, for EVERY companion, at swap time — drawn unconditionally so
 *     the stream does not fork on who happens to be false.
 *   - Stability. Ask the same person twice and the same private stream
 *     replays, so the account is word-identical. Regenerating it per ask would
 *     hand the player a tell that has nothing to do with the day: ask anyone
 *     twice, see the story move, done. The fake has to be able to hold its
 *     story.
 *
 * `tell` is the mirror of checkIn's `truth` field: tests and the end-of-run
 * debrief only. It must never reach the screen.
 */
export function accountOf(chronicle, speaker, roster) {
  const seen = witnessed(chronicle, speaker.id).slice().sort((a, b) => a.seq - b.seq);
  const rng = makeRng(speaker.tellSeed >>> 0);
  const pool = candidates(seen, roster);
  // Drawn unconditionally, used conditionally — a true account burns the same
  // draw a false one does, so the two are indistinguishable from the outside
  // and a later change to `false === no draw` cannot re-phase anything.
  const chosen = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  const tell = speaker.false && chosen ? chosen : null;

  let order = seen.map((e) => e);
  if (tell?.type === TELL.ORDER) {
    order = order.slice();
    [order[tell.at], order[tell.at + 1]] = [order[tell.at + 1], order[tell.at]];
  }

  const statements = order.map((e, i) => {
    // `i` indexes the RECOUNTING, `seen` the truth. A weather or name tell is
    // pinned to the entry's real position, so it lands on the same event
    // whether or not an order tell moved it.
    const truthIdx = seen.indexOf(e);
    const weather = tell?.type === TELL.WEATHER && tell.at === truthIdx ? tell.to : e.weather;
    const actors = tell?.type === TELL.NAME && tell.at === truthIdx
      ? [tell.to, ...e.actors.slice(1)]
      : e.actors;
    return {
      seq: e.seq,
      kind: e.kind,
      place: e.place,
      weather,
      actors,
      text: `${PHRASING[e.kind]({
        who: nameOf(roster, actors[0]),
        other: nameOf(roster, actors[1]),
        place: e.place,
      })}, ${weather}.`,
    };
  });

  return { who: speaker.id, name: speaker.name, statements, tell };
}

/**
 * The truth an account is checked against — the same shape `accountOf` returns
 * for a speaker who is real, so a test can diff the two field by field instead
 * of eyeballing prose.
 */
export function truthFor(chronicle, speaker, roster) {
  return accountOf(chronicle, { ...speaker, false: false }, roster);
}

/** Where two accounts disagree. Returns the differing statement indices. */
export function divergence(a, b) {
  const out = [];
  const n = Math.max(a.statements.length, b.statements.length);
  for (let i = 0; i < n; i++) {
    const x = a.statements[i], y = b.statements[i];
    if (!x || !y || x.text !== y.text) out.push(i);
  }
  return out;
}

/**
 * The player's call. Returns whether they were right, and who was actually
 * false — the run is over at this point, so the truth is finally sayable.
 */
export function accuse(roster, id) {
  const actual = roster.find((r) => r.false)?.id ?? null;
  return { accused: id, actual, correct: id === actual };
}
