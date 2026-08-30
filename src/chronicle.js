// chronicle.js — what actually happened, and how somebody tells you about it.
// Pure; no DOM, no Three. Reads a chronicle, never mutates one.
//
// THE WOODS rests on one claim: that a player can catch a fake by asking about
// a day they both lived through. Everything in this file exists to keep that
// claim honest, and the honesty has a single rule behind it:
//
//   THE WRONG DETAIL IS DERIVED FROM THE RECORD. IT IS NEVER AUTHORED.
//
// A hand-written list of tells is memorised by run ten and the game is dead.
// So a fake's account is the REAL account with exactly one fact bent, and the
// bent value is drawn from the values that actually occurred that day — a
// place that was really visited, a person who was really there, the weather it
// really was not. Nobody can learn the list because there is no list.
//
// PHRASING, by contrast, is authored and SHARED. Both a real member and a fake
// are rendered by the same function from the same templates. That is not a
// compromise of the rule above, it is what makes the rule matter: if the two
// were phrased differently the player would be reading style rather than
// substance, and the perturbation would be decoration.

/**
 * A FACT is structured, not phrased: verb + actor + object + place, in the
 * order it happened. Facts are appended as the day is played and are never
 * rewritten, because the player's memory of the day is the only copy of the
 * truth the game cannot control.
 */
export function fact({ i, t, verb, actor, object = null, cls = null, place = null, withWhom = [] }) {
  // `cls` is the object's CLASS — timber, supply, structure. It exists so that
  // a wrong-object claim stays grammatical: substituting a tent for the water
  // someone fetched produces "went down to the creek for tent", which the
  // player reads as a bug rather than as a lie, and a tell that reads as a bug
  // is worse than no tell. The class comes from the day's own definition of
  // its beats, not from a list of allowed swaps.
  return { i, t, verb, actor, object, cls, place, withWhom: withWhom.slice() };
}

/** The chronicle: the day's facts plus the conditions they happened under. */
export function makeChronicle(weather) {
  return { weather, facts: [] };
}

export function record(chron, f) {
  chron.facts.push({ ...f, i: chron.facts.length });
  return chron.facts[chron.facts.length - 1];
}

// The weathers a day can have. Not a tells list — this is the domain the day
// is drawn FROM, and the perturbation picks from the members of it that the
// day did not use, which is what makes a wrong-weather claim checkable.
export const WEATHERS = Object.freeze(["clear", "drizzle", "fog", "wind", "cold"]);

// ---------------------------------------------------------------------------
// Phrasing — shared by every speaker, real or not.
// ---------------------------------------------------------------------------

const VERB_PHRASE = {
  gathered: (f, n) => `${n(f.actor)} brought the ${f.object} up from the ${f.place}`,
  fetched: (f, n) => `${n(f.actor)} went down to the ${f.place} for ${f.object}`,
  cut: (f, n) => `${n(f.actor)} took the saw to the ${f.object} at the ${f.place}`,
  pitched: (f, n) => `${n(f.actor)} got the ${f.object} up at the ${f.place}`,
  lit: (f, n) => `${n(f.actor)} got the ${f.object} going`,
  heard: (f, n) => `${n(f.actor)} pulled up — something out past the ${f.place}`,
  watched: (f, n) => `${n(f.actor)} took first watch by the ${f.object}`,
  ate: (f, n) => `we had the ${f.object} round the fire`,
};

export function phrase(f, nameOf) {
  const fn = VERB_PHRASE[f.verb];
  if (!fn) throw new Error(`chronicle: no phrasing for verb "${f.verb}"`);
  return fn(f, nameOf);
}

const WEATHER_PHRASE = {
  clear: "It was clear all day.",
  drizzle: "It drizzled on us most of the day.",
  fog: "Fog sat in the whole day, never lifted.",
  wind: "Wind all day, up in the tops.",
  cold: "Cold enough that the water skinned over.",
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Turn a chronicle into what one person says about it.
 *
 * `perturb` is null for a real member — their account is the record, in order,
 * and it is IDENTICAL to every other real member's account. That identity is
 * deliberate and it is the reason a lone difference means something.
 */
export function account(chron, nameOf, perturb = null) {
  let facts = chron.facts.map((f) => ({ ...f }));
  let weather = chron.weather;
  let names = nameOf;

  if (perturb) {
    switch (perturb.kind) {
      case "order": {
        const a = perturb.at;
        [facts[a], facts[a + 1]] = [facts[a + 1], facts[a]];
        break;
      }
      case "actor":
        facts[perturb.at] = { ...facts[perturb.at], actor: perturb.to };
        break;
      case "place":
        facts[perturb.at] = { ...facts[perturb.at], place: perturb.to };
        break;
      case "object":
        facts[perturb.at] = { ...facts[perturb.at], object: perturb.to };
        break;
      case "weather":
        weather = perturb.to;
        break;
      case "name": {
        const who = facts[perturb.at].actor;
        names = (id) => (id === who ? perturb.to : nameOf(id));
        break;
      }
      default:
        throw new Error(`chronicle: unknown perturbation "${perturb.kind}"`);
    }
  }

  return {
    weather: WEATHER_PHRASE[weather] || WEATHER_PHRASE.clear,
    lines: facts.map((f) => phrase(f, names)),
  };
}

/** Flat text, for comparison and for tests. */
export function accountText(acc) {
  return [acc.weather].concat(acc.lines).join("\n");
}

// ---------------------------------------------------------------------------
// Choosing the one wrong detail
// ---------------------------------------------------------------------------

const KINDS = Object.freeze(["order", "actor", "place", "object", "weather", "name"]);

/**
 * What perturbations this particular chronicle can support. Every candidate
 * value comes out of the record itself — the actors are people who were really
 * there, the places are places really visited, the objects really handled. The
 * weather is the one inversion: the candidates are the weathers that did NOT
 * happen, because a day can only have been one.
 */
export function candidates(chron, nearMisses = {}) {
  const actors = [...new Set(chron.facts.map((f) => f.actor))];
  const places = [...new Set(chron.facts.map((f) => f.place).filter(Boolean))];
  const objects = [];
  for (const f of chron.facts) {
    if (f.object && !objects.some((o) => o.name === f.object)) objects.push({ name: f.object, cls: f.cls });
  }
  const out = [];

  // ORDER: any adjacent pair that is actually distinguishable once phrased.
  // Swapping two facts that render identically is a perturbation the player
  // cannot see, which would be indistinguishable from a real account and would
  // therefore make the game a coin flip on that seed.
  for (let a = 0; a + 1 < chron.facts.length; a++) {
    if (phrase(chron.facts[a], String) !== phrase(chron.facts[a + 1], String)) out.push({ kind: "order", at: a });
  }
  for (let i = 0; i < chron.facts.length; i++) {
    const f = chron.facts[i];
    for (const a of actors) if (a !== f.actor) out.push({ kind: "actor", at: i, to: a });
    if (f.place) for (const p of places) if (p !== f.place) out.push({ kind: "place", at: i, to: p });
    if (f.object) {
      for (const o of objects) {
        if (o.name === f.object || (f.cls && o.cls !== f.cls)) continue;
        out.push({ kind: "object", at: i, to: o.name });
      }
    }

  }
  // NAME is per PERSON, not per line. Somebody who has a name slightly wrong
  // has it wrong every time they say it — a speaker who misspelled it once and
  // got it right afterwards would be a speaker with two beliefs about one
  // person, which is not a thing people do. `at` therefore selects the FIRST
  // line the actor appears in, and the substitution applies wherever they
  // appear. One wrong belief, however many lines it surfaces in.
  for (const a of actors) {
    const nm = nearMisses[a] || null;
    if (nm) out.push({ kind: "name", at: chron.facts.findIndex((f) => f.actor === a), to: nm });
  }
  for (const w of WEATHERS) if (w !== chron.weather) out.push({ kind: "weather", to: w });
  return out;
}

/**
 * Pick one. Spreads across KINDS first and then within the kind, so a run does
 * not get six order-swaps in a row just because order-swaps are numerous — the
 * player is meant to meet a different SHAPE of wrongness each time, not a
 * different instance of the same shape.
 *
 * CONSTANT ROLL COUNT: exactly two draws, always, whatever the day was.
 *
 * `nearMisses` is a PREPARED MAP of actor id -> almost-right name, not a
 * callback. It used to be a callback, and `candidates` called it once per
 * distinct actor — so the draw count moved with the number of people who
 * happened to do something that day, and a short day and a long one consumed
 * different amounts of the caller's stream. The caller now draws its near
 * misses up front, one per party member whether or not that member appears, so
 * the cost is fixed before this function is entered.
 */
export function pickPerturbation(rng, chron, nearMisses = {}) {
  const all = candidates(chron, nearMisses);
  const rKind = rng();
  const rWhich = rng();
  if (!all.length) return null;
  const kinds = KINDS.filter((k) => all.some((c) => c.kind === k));
  const kind = kinds[Math.floor(rKind * kinds.length)];
  const pool = all.filter((c) => c.kind === kind);
  const chosen = pool[Math.floor(rWhich * pool.length)];

  // The guarantee this function exists to make: a fake's account must actually
  // READ differently from a real one. A perturbation that renders identically
  // is worse than none — the player does the work and gets nothing back, and
  // no error is raised anywhere. Verified here rather than trusted.
  const truth = accountText(account(chron, (id) => id, null));
  const lied = accountText(account(chron, (id) => id, chosen));
  if (truth === lied) {
    const visible = all.filter((c) => accountText(account(chron, (id) => id, c)) !== truth);
    return visible.length ? visible[Math.floor(rWhich * visible.length)] : null;
  }
  return chosen;
}

export const PERTURBATION_KINDS = KINDS;
