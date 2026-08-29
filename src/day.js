// day.js — the one scripted day the alpha is built around.
//
// The alpha tests a single claim: can a player catch a fake by asking about a
// day they both lived through? So the day itself has to be REAL — generated
// from the run seed, different every time, and recorded as facts rather than
// prose. Nothing here is authored per-run; change the seed and you get another
// day, another set of things that happened, and therefore another tell.
//
// Deliberately not a level. No map, no daylight, no travel — a fixed camp and
// a handful of things that happened at it, because everything else in the
// design is machinery that already works elsewhere and none of it matters if
// the asking is not fun.

import { createRun, swapOvernight } from "./state.js?v=seven-0.12.0";
import { record, CHRONICLE_KINDS, WEATHER } from "./chronicle.js?v=seven-0.12.0";

/** Where things happen. A fixed camp's landmarks, not a map. */
export const PLACES = ["the fire", "the creek", "the deadfall", "the ridge path", "the tarp"];

/** How many things happen. Fixed, so every run costs the same draws. */
export const DAY_LENGTH = 7;

/**
 * Build the day and then take someone.
 *
 * Every entry lists the WHOLE camp as present, the lead included. That is not
 * a shortcut — it is the alpha's premise. Nobody has an absence to hide behind,
 * so a wrong detail cannot be excused with "I wasn't there", and the player's
 * own memory covers the entire day. Memory is the only evidence, and the player
 * is the only one who has it.
 */
export function buildDay({ seed = 1 } = {}) {
  const sim = createRun({ seed });
  const everyone = [sim.player, ...sim.companions].map((c) => c.id);

  let last = null;
  for (let i = 0; i < DAY_LENGTH; i++) {
    // Five draws per entry, every entry, whatever they come out as — the same
    // constant-roll-count rule the rest of the sim lives by.
    // Nudged off the previous kind rather than re-rolled: a day with three
    // "got there first" lines in it reads as a generator's output, not as a
    // day, and the player is being asked to trust this as memory. The nudge is
    // arithmetic on the draw already made, so the roll count stays fixed.
    let k = Math.floor(sim.rng() * CHRONICLE_KINDS.length);
    if (i > 0 && CHRONICLE_KINDS[k] === last) k = (k + 1) % CHRONICLE_KINDS.length;
    const kind = CHRONICLE_KINDS[k];
    last = kind;
    const a = Math.floor(sim.rng() * sim.companions.length);
    const bRaw = Math.floor(sim.rng() * sim.companions.length);
    const place = PLACES[Math.floor(sim.rng() * PLACES.length)];
    const weather = WEATHER[Math.floor(sim.rng() * WEATHER.length)];
    const b = bRaw === a ? (a + 1) % sim.companions.length : bRaw;
    const subject = sim.companions[a].id;
    const second = sim.companions[b].id;
    sim.time += 1;
    record(sim, kind, {
      // Subject first, the other party to it second, then everyone else who
      // was at camp — which is everyone.
      actors: [subject, second, ...everyone.filter((id) => id !== subject && id !== second)],
      place,
      weather,
    });
  }

  const taken = swapOvernight(sim);
  return { sim, taken };
}

/**
 * The day as the player lived it. Rendered through the same code that renders
 * an account, so "what you remember" and "what they say" are the same kind of
 * sentence and a difference between them is a difference of FACT, not of
 * phrasing. Comparing prose written by two different functions would have the
 * player hunting wording instead of evidence.
 */
export function asLived(sim, accountOf) {
  return accountOf(sim.chronicle, { id: sim.player.id, name: sim.player.name, tellSeed: 0, swapped: false },
                   [sim.player, ...sim.companions]);
}
