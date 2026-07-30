// state.js — the MIRAGE simulation. Pure logic: no DOM, no Three, no audio.
// The browser build and the Node test suite run this exact file.
//
// THE ONE IDEA
// Six minds walk into the basin: you and five companions. Each carries a hidden
// LUCIDITY meter that only counts down. At zero, that mind begins to hallucinate
// — and the game never shows you the number. You are meant to read your party,
// not a bar. Companions volunteer remarks and answer check-ins; a fraying one
// shades the truth, a gone one states falsehood with total confidence. And when
// YOUR meter hits zero the lie moves into the renderer itself: markers that
// aren't there, a sixth companion, a pylon that gives nothing back.
//
// So every source of information in the game can be wrong, including the screen.
// The sim's job is to keep an honest, testable record of what is TRUE; `percept.js`
// is the only place allowed to lie about it.

import { generateWorld, worldToCell, cellToWorld, moveWithCollision, isBlockedAt, CELL, ITEM_KINDS } from "./world.js";
import { makeRng } from "./rng.js";
import { updateCompanions, companionRemark } from "./party.js";

export const PARTY_SIZE = 6; // you + 5 companions — the spec's five NPCs, plus the player
export const MAX_LUCIDITY = 100;

// --- tuning -----------------------------------------------------------------
// Aimed at making a careful route through the pylons beat a straight dash for the
// markers, and measured rather than asserted: `tests/balance.mjs` currently reports
// careful 88% vs reckless 75% on standard over 8 seeds — directionally right, and a
// small enough gap that it should not be quoted as settled. Note the harness bot
// reads the sim's truth, so none of these numbers price the hallucination layer.
export const BASE_DRAIN = 1.05; // lucidity/second at rest, before modifiers
export const ISOLATION_DIST = 13; // units from the party centroid before you count as alone
export const ISOLATION_MULT = 1.9; // walking off alone burns you down fastest
export const CONTAGION_DIST = 9; // seeing someone come apart costs you
export const CONTAGION_MULT = 0.28; // per hallucinating neighbour in range
export const SCAR_MULT = 0.16; // per prior recovery — coming back costs something
export const PYLON_RADIUS = 7.5;
export const PYLON_RESTORE = 15; // lucidity/second inside a charged pylon
export const PYLON_DRAIN = 9; // pylon charge/second while it is doing work
export const PYLON_RECHARGE = 2.0; // charge/second while nobody is drawing on it
export const PYLON_MAX_CHARGE = 100;
export const DOSE_COUNT = 3; // "lumen" ampoules — the whole supply, for six people
export const DOSE_RESTORE = 70;
export const RECOVER_AT = 45; // lucidity a mind comes back to after hallucinating
export const RECOVER_TIME = 2.5; // seconds inside a pylon needed to pull someone back
export const SIGHT_RANGE = 38; // how far into the fog a marker can be picked out
export const LOG_RADIUS = 5.0; // how close you must stand to log a monolith
export const CORROBORATE_RADIUS = 11; // a companion this close can confirm what you see
export const DISSOLVE_TIME = 10; // seconds with all six gone before the party dissolves

// --- items -------------------------------------------------------------------
// A found item is not automatically what it appears to be. state.js only ever
// records the TRUE kind of a real pickup; percept.js is where a hallucinating
// lead's own item bar can lie about it — see perceivedInventory(). A pickup made
// WHILE hallucinating can additionally be a PHANTOM: `real:false`, nothing behind
// it at all. Both cases resolve their surprise at USE time, never at pickup —
// the whole point is that you don't find out until you reach for it.
export const ITEM_CAP = 3; // carried at once — forces the same "which do I keep" choice as doses
export const ITEM_PICKUP_RADIUS = 3.2;
export const ITEM_SIGHT_RANGE = 15; // smaller than SIGHT_RANGE — these are ground clutter, not standing stones
export const ITEM_INFO = Object.freeze({
  flare: { label: "Flare", restore: 40 }, // used on self: instant partial lucidity restore
  tether: { label: "Tether", steadyMult: 0.35, steadySeconds: 60 }, // used on the selected companion: steadier for a while, not a cure
  lens: { label: "Lens", clearSeconds: 25 }, // used on self: the SCREEN tells the truth for a while, even if you're still gone
  // Crafted only — never spawn in the world (see CRAFT_RECIPES below). Each
  // does BOTH parent effects at once: the payoff for spending two carried
  // slots and a craft action instead of using the pair separately.
  ember: { label: "Ember", restore: 40, steadyMult: 0.35, steadySeconds: 60 }, // flare + tether
  beacon: { label: "Beacon", restore: 40, clearSeconds: 25 }, // flare + lens
  ward: { label: "Ward", steadyMult: 0.35, steadySeconds: 60, clearSeconds: 25 }, // tether + lens
});
// A phantom item's use is always a bad surprise — there is no real effect to
// fall back on, so reaching for it costs you instead of rewarding you.
export const PHANTOM_ITEM_COST = 8;

// Unordered-pair recipes: combine any two of the three base pickups into one
// stronger, craft-only item. Keyed by the two kinds sorted and joined, so
// order never matters at the call site (see recipeKey below).
export const CRAFT_RECIPES = Object.freeze({
  "flare+tether": "ember",
  "flare+lens": "beacon",
  "lens+tether": "ward",
});
function recipeKey(a, b) {
  return [a, b].sort().join("+");
}

// A short campaign: winning a basin before the last one advances to a fresh
// basin instead of ending the run — see checkEndings(). Callers that don't
// know about campaigns (tests, the balance harness) get campaignLength=1 by
// default in createRun(), which keeps checkEndings' old single-basin "won"
// path exactly as it was; only main.js opts into the multi-basin campaign.
export const CAMPAIGN_LENGTH = 3;
// Seconds of daylight. Finite, so a run cannot be salvaged by camping in a pylon
// forever (otherwise a dominant and extremely boring strategy) — but set from
// measurement rather than taste. The intended pressure is the party's minds, not
// the clock, and at 600s the balance harness showed careful play losing 67% of
// runs to darkness with 5.7 of 6 markers already logged: the clock was deciding
// runs that the design wants the party to decide.
//
// Caveat on that evidence, kept deliberately: it was measured BEFORE the
// movement-basis fix, which made the party actually form up behind the lead and so
// changed both isolation drain and marker sighting. On current code careful play
// ends dark in 1 run of 8 at standard, so 780s is now slack here rather than the
// binding constraint it was tuned against. The value is still right for the reason
// it was chosen — bound pylon camping — but the 67% figure no longer reproduces.
export const TIME_LIMIT = 780;

// Lucidity bands. HALLUCINATING is not a band — it is what happens at zero.
export const BAND = Object.freeze({
  STEADY: "steady",
  UNSETTLED: "unsettled",
  FRAYING: "fraying",
  BRITTLE: "brittle",
  GONE: "gone",
});

export function bandOf(lucidity) {
  if (lucidity <= 0) return BAND.GONE;
  if (lucidity < 14) return BAND.BRITTLE;
  if (lucidity < 36) return BAND.FRAYING;
  if (lucidity < 62) return BAND.UNSETTLED;
  return BAND.STEADY;
}

// The five companions. Each has a temperament that changes both how fast they
// burn and how they TALK — the tells are the interface, so they have to differ.
export const COMPANION_TEMPLATES = Object.freeze([
  { id: "c1", name: "VOSS", role: "Surveyor", drain: 0.86, stoic: 0.85, chatty: 0.4, wander: 0.5 },
  { id: "c2", name: "IREN", role: "Medic", drain: 1.0, stoic: 0.45, chatty: 0.8, wander: 0.35 },
  { id: "c3", name: "HALDER", role: "Rigger", drain: 1.18, stoic: 0.7, chatty: 0.5, wander: 0.8 },
  { id: "c4", name: "NKEM", role: "Signals", drain: 0.94, stoic: 0.3, chatty: 1.0, wander: 0.4 },
  { id: "c5", name: "PAO", role: "Geologist", drain: 1.1, stoic: 0.6, chatty: 0.6, wander: 0.95 },
]);

// The kinds of hallucination a mind can fall into. Which one you draw changes
// what the character DOES (companions) or what the screen SHOWS (the player).
export const HALLUCINATION = Object.freeze({
  PHANTOM_MARKER: "phantomMarker", // a monolith that is not there
  DOUBLED_PARTY: "doubledParty", // a companion who is not there
  FALSE_ANCHOR: "falseAnchor", // a pylon that gives nothing back
  WRONG_WAY: "wrongWay", // north is not north
  CHORUS: "chorus", // voices, and the certainty that comes with them
});

const HALLUCINATION_LIST = Object.values(HALLUCINATION);

function makeCharacter(tpl, spawn, index) {
  return {
    ...tpl,
    index,
    isPlayer: false,
    x: spawn.x,
    z: spawn.z,
    // Hidden state. Nothing in the HUD may read `lucidity` directly — see percept.js.
    lucidity: MAX_LUCIDITY,
    hallucinating: false,
    hallucination: null,
    scars: 0,
    recoverProgress: 0,
    // Where this companion currently believes it is going, and why.
    goal: null,
    goalKind: "follow",
    path: null,
    beliefs: { claimedMarkers: [] },
    aliveTime: 0,
    goneTime: 0, // total seconds spent hallucinating (scored at the end)
    steadyUntil: 0, // sim.time until which a Tether reduces this mind's drain
  };
}

/**
 * Create a run. `seed` fixes the world AND the behavioural jitter, so a seed is
 * a complete description of a run — which is what makes the balance harness and
 * the regression tests meaningful.
 *
 * `level`/`campaignLength`/`carryOver` are the campaign extension: a fresh
 * basin always gets its own world (new seed) and spawn positions, but when
 * `carryOver` is passed the party's lucidity/scars/hallucination state, doses,
 * inventory, and cumulative stats continue from the previous basin instead of
 * resetting — a worn-down party walks into the next fog already worn down.
 * `campaignLength` defaults to 1 (single basin, the original behaviour) so
 * every caller that doesn't know about campaigns — the balance harness, the
 * logic tests — is unaffected; only main.js opts a real playthrough in.
 */
export function createRun({ seed = 1, difficulty = "standard", level = 1, campaignLength = 1, carryOver = null } = {}) {
  const world = generateWorld(seed);
  const rng = makeRng(seed ^ 0x5eed);
  const spawn = { x: world.camp.x, z: world.camp.z };

  const player = {
    id: "you",
    name: "YOU",
    role: "Lead",
    index: 0,
    isPlayer: true,
    drain: 1.0,
    stoic: 0.5,
    chatty: 0,
    wander: 0,
    x: spawn.x,
    z: spawn.z,
    yaw: 0,
    lucidity: MAX_LUCIDITY,
    hallucinating: false,
    hallucination: null,
    scars: 0,
    recoverProgress: 0,
    goneTime: 0,
    steadyUntil: 0,
    lensUntil: 0, // sim.time until which the lead's OWN screen is forced honest
  };

  // Open facing the middle of the basin: camp sits off-centre near the rim, and
  // spawning pointed at the nearest rock wall is a bad first second of a game.
  // forward = (-sin(yaw), -cos(yaw)), so yaw = atan2(-toCentre.x, -toCentre.z).
  player.yaw = Math.atan2(-(0 - spawn.x), -(0 - spawn.z));

  // The party forms up BEHIND the lead — a fan at 5–7 units, not a ring at 3.
  // Any closer and five companions are simply standing in the camera.
  const companions = COMPANION_TEMPLATES.map((tpl, i) => {
    const a = player.yaw + (i - 2) * 0.5;
    const r = 5.2 + (i % 2) * 1.4;
    const spot = { x: spawn.x + Math.sin(a) * r, z: spawn.z + Math.cos(a) * r };
    return makeCharacter(tpl, spot, i + 1);
  });

  const diff = DIFFICULTY[difficulty] || DIFFICULTY.standard;

  // Carry the previous basin's party state forward by id — position/goal/path
  // still reset to a fresh spawn (below), but lucidity, scars, whether a mind
  // is mid-hallucination, and total gone-time survive the jump. A companion
  // roster is a fixed set of ids every run, so lookup by id is exact.
  if (carryOver) {
    for (const saved of carryOver.party) {
      const ch = saved.id === player.id ? player : companions.find((c) => c.id === saved.id);
      if (!ch) continue;
      ch.lucidity = saved.lucidity;
      ch.scars = saved.scars;
      ch.hallucinating = saved.hallucinating;
      ch.hallucination = saved.hallucination;
      ch.goneTime = saved.goneTime;
    }
  }

  return {
    seed,
    difficulty,
    diffMult: diff.drain,
    rng,
    world,
    player,
    companions,
    // A stable array rather than a fresh one per access: `party` is read a dozen
    // times per tick (drain, contagion, sightings, endings) and rebuilding it each
    // time was pure allocation churn in the long-run simulations.
    party: [player, ...companions],
    pylons: world.pylons.map((p) => ({ ...p, charge: PYLON_MAX_CHARGE, live: true })),
    // `discovered` is what makes this a game about EXPLORING rather than about
    // walking a known route: a marker's position is not knowledge the party
    // starts with. It is set when somebody in the party actually picks it out of
    // the fog (see `discover`).
    monoliths: world.monoliths.map((m) => ({ ...m, logged: false, discovered: false, foundBy: null })),
    // World pickups. `taken` is set the instant a pickup resolves (Brain: never
    // gate a one-shot pickup's deactivation on a despawn animation) — nothing
    // downstream ever gets a second chance to grab an already-taken item.
    items: world.items.map((it) => ({ ...it, discovered: false, taken: false })),
    // The party's carried items. A slot with `real:false` is a phantom picked up
    // while hallucinating: it has no true kind, only a `claimedKind` baked in at
    // pickup time — permanent, exactly like a false survey log entry, so it does
    // NOT reveal itself just because the lead later recovers. Discovery only
    // happens at use time. Carries forward across a campaign's basins.
    inventory: carryOver ? carryOver.inventory : [],
    // The survey log. Entries can be FALSE — that is the point.
    logEntries: [],
    doses: carryOver ? carryOver.doses : DOSE_COUNT,
    time: 0, // the sim's own clock. Tests assert against THIS, never wall time.
    status: "playing", // playing | levelComplete | won | lost
    ending: null,
    dissolveTimer: 0,
    events: [], // transient, drained by the HUD each frame
    // Reused across a campaign's basins (not recreated) so the end-of-campaign
    // debrief reports cumulative totals, not just the final basin's.
    stats: carryOver ? carryOver.stats : { doseUses: 0, pylonSeconds: 0, recoveries: 0, falseLogs: 0, itemsUsed: 0, phantomItemsUsed: 0, itemsCrafted: 0 },
    level,
    campaignLength,
  };
}

export const DIFFICULTY = Object.freeze({
  gentle: { drain: 0.75, label: "Gentle" },
  standard: { drain: 1.0, label: "Standard" },
  bleak: { drain: 1.35, label: "Bleak" },
});

export function emit(sim, kind, text, opts = {}) {
  // `...opts` spreads FIRST: an opts field that happens to be named `kind`
  // (e.g. an item's own kind, passed as extra context) must never be able to
  // silently overwrite the event's own type discriminator. It did, briefly —
  // pickup/itemUsed events carried an `opts.kind` and ended up with `ev.kind`
  // reading "flare" instead of "itemUsed", so the HUD's pumpEvents() switch
  // never matched and the subtitle was silently dropped.
  sim.events.push({ ...opts, kind, text, t: sim.time });
  if (sim.events.length > 64) sim.events.shift();
}

const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function partyCentroid(sim) {
  const p = sim.party;
  return {
    x: p.reduce((s, c) => s + c.x, 0) / p.length,
    z: p.reduce((s, c) => s + c.z, 0) / p.length,
  };
}

/** The pylon a character is currently standing in, if it has charge left. */
export function pylonAt(sim, ch) {
  for (const p of sim.pylons) {
    if (p.charge > 0 && dist2D(p, ch) <= PYLON_RADIUS) return p;
  }
  return null;
}

/**
 * Drain (or restore) one mind for `dt` seconds. Returns the effective rate used,
 * which the balance harness reports on.
 */
export function tickLucidity(sim, ch, dt) {
  const inPylon = pylonAt(sim, ch);
  if (inPylon) {
    sim.stats.pylonSeconds += dt;
    inPylon.charge = Math.max(0, inPylon.charge - PYLON_DRAIN * dt);
    if (ch.hallucinating) {
      // Pulling someone back takes sustained contact, not a drive-by.
      ch.recoverProgress += dt;
      if (ch.recoverProgress >= RECOVER_TIME) recover(sim, ch, "pylon");
      return 0;
    }
    ch.lucidity = Math.min(MAX_LUCIDITY, ch.lucidity + PYLON_RESTORE * dt);
    return -PYLON_RESTORE;
  }
  ch.recoverProgress = 0;
  if (ch.hallucinating) {
    ch.goneTime += dt;
    return 0; // already at the floor; nothing left to take
  }

  const centroid = partyCentroid(sim);
  let mult = 1;
  if (dist2D(centroid, ch) > ISOLATION_DIST) mult *= ISOLATION_MULT;
  const witnessed = sim.party.filter((o) => o !== ch && o.hallucinating && dist2D(o, ch) <= CONTAGION_DIST).length;
  mult *= 1 + CONTAGION_MULT * witnessed;
  mult *= 1 + SCAR_MULT * ch.scars;
  // A Tether steadies without curing: it only ever reduces the rate feeding
  // into the meter, never restores lucidity directly, so it can't substitute
  // for a pylon — just buy time to reach one.
  if (ch.steadyUntil > sim.time) mult *= ITEM_INFO.tether.steadyMult;

  const rate = BASE_DRAIN * ch.drain * sim.diffMult * mult;
  ch.lucidity = Math.max(0, ch.lucidity - rate * dt);
  if (ch.lucidity <= 0) beginHallucinating(sim, ch);
  return rate;
}

export function beginHallucinating(sim, ch) {
  if (ch.hallucinating) return;
  ch.hallucinating = true;
  ch.lucidity = 0;
  ch.recoverProgress = 0;
  ch.hallucination = sim.rng.pick(HALLUCINATION_LIST);
  // A companion who has gone abandons the party's plan for their own.
  ch.goal = null;
  ch.goalKind = "hallucinating";
  emit(sim, "hallucinate", ch.isPlayer ? "Something is wrong with the light." : `${ch.name} stops making sense.`, {
    who: ch.id,
  });
}

export function recover(sim, ch, cause) {
  ch.hallucinating = false;
  ch.hallucination = null;
  ch.recoverProgress = 0;
  ch.scars += 1;
  ch.lucidity = RECOVER_AT;
  ch.goalKind = "follow";
  ch.goal = null;
  sim.stats.recoveries += 1;
  emit(sim, "recover", ch.isPlayer ? "The basin resolves. You are here." : `${ch.name} comes back.`, {
    who: ch.id,
    cause,
  });
}

/** Spend a lumen dose on one character. Returns true if it was spent. */
export function useDose(sim, targetId) {
  if (sim.doses <= 0 || sim.status !== "playing") return false;
  const ch = sim.party.find((c) => c.id === targetId);
  if (!ch) return false;
  sim.doses -= 1;
  sim.stats.doseUses += 1;
  if (ch.hallucinating) recover(sim, ch, "dose");
  else {
    ch.lucidity = Math.min(MAX_LUCIDITY, ch.lucidity + DOSE_RESTORE);
    emit(sim, "dose", `${ch.isPlayer ? "You take" : `${ch.name} takes`} a lumen dose.`, { who: ch.id });
  }
  return true;
}

/**
 * Ask a companion how they are holding up. This is the game's primary sensor,
 * and it is deliberately unreliable: the answer is filtered by the SPEAKER's
 * state here, and again by the LISTENER's state in percept.js.
 */
export function checkIn(sim, id) {
  const ch = sim.companions.find((c) => c.id === id);
  if (!ch) return null;
  const truth = bandOf(ch.lucidity);
  let claim = truth;
  if (ch.hallucinating) {
    // Total confidence, no contact with the truth.
    claim = BAND.STEADY;
  } else if (truth === BAND.BRITTLE || truth === BAND.FRAYING) {
    // Fraying minds shade optimistic — more so the more stoic they are.
    claim = sim.rng() < 0.35 + ch.stoic * 0.5 ? BAND.UNSETTLED : truth;
  }
  const report = {
    who: ch.id,
    name: ch.name,
    claim,
    truth, // for tests and the end-of-run debrief ONLY — never shown mid-run
    text: reportText(ch, claim),
  };
  emit(sim, "report", `${ch.name}: ${report.text}`, { who: ch.id, claim });
  return report;
}

function reportText(ch, claim) {
  switch (claim) {
    case BAND.STEADY:
      return ch.stoic > 0.6 ? "Fine. Keep moving." : "I'm good. Clear head.";
    case BAND.UNSETTLED:
      return "Bit of a headache. Nothing I can't walk off.";
    case BAND.FRAYING:
      return "I keep hearing the ridge breathe. I don't love it.";
    case BAND.BRITTLE:
      return "I can't— I need a pylon. Soon.";
    default:
      return "…the stones are counting us.";
  }
}

/** Line of sight on the collision grid — spires block a sighting. */
export function hasSight(sim, from, to) {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.ceil(d / CELL);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isBlockedAt(sim.world, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) return false;
  }
  return true;
}

/**
 * Pick markers out of the fog. Anyone in the party can make the sighting — which
 * is a quiet argument for keeping them close, and a real loss when they scatter.
 *
 * A companion who has gone can still call out a marker, and it will be a real
 * one: they are not lying about the basin, they have simply stopped being able to
 * tell which basin they are in. Their FALSE calls are chatter, not sightings.
 */
export function discover(sim) {
  for (const m of sim.monoliths) {
    if (m.discovered) continue;
    for (const ch of sim.party) {
      if (Math.hypot(m.x - ch.x, m.z - ch.z) > SIGHT_RANGE) continue;
      if (!hasSight(sim, ch, m)) continue;
      m.discovered = true;
      m.foundBy = ch.id;
      emit(sim, "discover", ch.isPlayer ? `${m.name}, off in the fog.` : `${ch.name}: there — ${m.name}.`, {
        id: m.id,
        who: ch.id,
      });
      break;
    }
  }
  for (const it of sim.items) {
    if (it.discovered || it.taken) continue;
    for (const ch of sim.party) {
      if (Math.hypot(it.x - ch.x, it.z - ch.z) > ITEM_SIGHT_RANGE) continue;
      if (!hasSight(sim, ch, it)) continue;
      it.discovered = true;
      // Deliberately kind-agnostic: naming the item here would leak its true
      // kind straight through the subtitle, bypassing percept.js entirely —
      // the one place a hallucinating lead's item bar is allowed to lie about
      // what they're looking at (see perceivedWorldItems).
      emit(sim, "discoverItem", ch.isPlayer ? "Something in the grass, off to the side." : `${ch.name}: there's something over there.`, {
        id: it.id,
        who: ch.id,
      });
      break;
    }
  }
}

export const discoveredCount = (sim) => sim.monoliths.filter((m) => m.discovered).length;

/**
 * Log a survey marker. This is the win condition's currency, and it can be
 * counterfeit: a hallucinating lead with nobody lucid nearby to contradict them
 * writes down a monolith that does not exist.
 */
export function logMarker(sim, phantom = null) {
  if (sim.status !== "playing") return { ok: false, reason: "over" };

  const near = sim.monoliths
    .filter((m) => !m.logged && dist2D(m, sim.player) <= LOG_RADIUS)
    .sort((a, b) => dist2D(a, sim.player) - dist2D(b, sim.player))[0];

  const lucidWitness = sim.companions.find(
    (c) => !c.hallucinating && bandOf(c.lucidity) !== BAND.BRITTLE && dist2D(c, sim.player) <= CORROBORATE_RADIUS,
  );

  // Hallucinating lead, standing at nothing, nobody to say so: a false entry.
  if (!near && sim.player.hallucinating && phantom && !lucidWitness) {
    sim.logEntries.push({ name: phantom.name, real: false, t: sim.time, corroborated: false });
    sim.stats.falseLogs += 1;
    emit(sim, "logFalse", `Logged ${phantom.name}.`, { phantom: true });
    return { ok: true, real: false };
  }
  if (!near) return { ok: false, reason: "nothing-here" };

  // A lucid companion at your shoulder is what keeps the record honest.
  if (sim.player.hallucinating && !lucidWitness && sim.rng() < 0.5) {
    sim.logEntries.push({ name: near.name, real: false, t: sim.time, corroborated: false });
    sim.stats.falseLogs += 1;
    emit(sim, "logFalse", `Logged ${near.name}.`, { phantom: true });
    return { ok: true, real: false };
  }

  near.logged = true;
  sim.logEntries.push({
    id: near.id,
    name: near.name,
    real: true,
    t: sim.time,
    corroborated: !!lucidWitness,
    by: lucidWitness ? lucidWitness.name : null,
  });
  emit(sim, "log", `${near.name} surveyed.${lucidWitness ? ` ${lucidWitness.name} confirms.` : " Uncorroborated."}`, {
    id: near.id,
  });
  return { ok: true, real: true, corroborated: !!lucidWitness };
}

export const trueLogCount = (sim) => sim.monoliths.filter((m) => m.logged).length;

/**
 * Pick up whatever the lead is standing next to. Two ways this can go wrong,
 * neither visible until later:
 *   - if the lead is hallucinating, the pickup has a real chance of being a
 *     PHANTOM — a slot with `real:false` and no true kind at all;
 *   - even when it IS real, what the lead currently believes they picked up
 *     is percept.js's business, not this function's — this only ever records
 *     the truth.
 */
export function pickupItem(sim) {
  if (sim.status !== "playing") return { ok: false, reason: "over" };
  if (sim.inventory.length >= ITEM_CAP) return { ok: false, reason: "full" };

  const near = sim.items
    .filter((it) => !it.taken && it.discovered && dist2D(it, sim.player) <= ITEM_PICKUP_RADIUS)
    .sort((a, b) => dist2D(a, sim.player) - dist2D(b, sim.player))[0];
  if (!near) return { ok: false, reason: "nothing-here" };

  // Deactivate the instant it's taken — no despawn animation gates a second
  // pickup attempt racing in behind this one.
  near.taken = true;

  // A hallucinating lead has a real (not certain) chance that what their hand
  // closed on was never there at all.
  if (sim.player.hallucinating && sim.rng.chance(0.45)) {
    const claimedKind = sim.rng.pick(ITEM_KINDS);
    sim.inventory.push({ id: `slot${sim.inventory.length}-${sim.time.toFixed(2)}`, real: false, claimedKind, kind: null });
    emit(sim, "pickupFalse", `You pick up ${ITEM_INFO[claimedKind].label}. It's warm in your hand.`, { phantom: true });
    return { ok: true, real: false };
  }

  sim.inventory.push({ id: `slot${sim.inventory.length}-${sim.time.toFixed(2)}`, real: true, kind: near.itemKind, claimedKind: null });
  emit(sim, "pickup", `${ITEM_INFO[near.itemKind].label} secured.`, { itemKind: near.itemKind });
  return { ok: true, real: true, kind: near.itemKind };
}

/**
 * Use a carried item slot. A real item does exactly what its TRUE kind does —
 * which is "the wrong thing" from the lead's point of view whenever percept.js
 * had them convinced it was some other kind. A phantom slot has no true effect
 * to fall back on, so it always costs instead of helping: reaching for
 * something that was never there is worse than not reaching at all.
 */
export function useItem(sim, slotIndex, targetCompanionId) {
  if (sim.status !== "playing") return { ok: false, reason: "over" };
  const slot = sim.inventory[slotIndex];
  if (!slot) return { ok: false, reason: "empty" };
  sim.inventory.splice(slotIndex, 1);

  if (!slot.real) {
    sim.player.lucidity = Math.max(0, sim.player.lucidity - PHANTOM_ITEM_COST);
    sim.stats.phantomItemsUsed += 1;
    emit(sim, "itemPhantom", "It wasn't there. It was never there.", {});
    if (sim.player.lucidity <= 0) beginHallucinating(sim, sim.player);
    return { ok: true, real: false, kind: null };
  }

  sim.stats.itemsUsed += 1;
  const info = ITEM_INFO[slot.kind];
  switch (slot.kind) {
    case "flare":
      sim.player.lucidity = Math.min(MAX_LUCIDITY, sim.player.lucidity + info.restore);
      emit(sim, "itemUsed", "The flare catches. Your head clears, sharply.", { itemKind: "flare" });
      break;
    case "tether": {
      const target = sim.companions.find((c) => c.id === targetCompanionId) || sim.companions[0];
      target.steadyUntil = sim.time + info.steadySeconds;
      emit(sim, "itemUsed", `${target.name} steadies.`, { itemKind: "tether", who: target.id });
      break;
    }
    case "lens":
      sim.player.lensUntil = sim.time + info.clearSeconds;
      emit(sim, "itemUsed", "For a while, you can trust your own eyes again.", { itemKind: "lens" });
      break;
    // Crafted items do both parent effects at once — the payoff for spending
    // two carried slots and a craft action instead of using them separately.
    case "ember": {
      sim.player.lucidity = Math.min(MAX_LUCIDITY, sim.player.lucidity + info.restore);
      const target = sim.companions.find((c) => c.id === targetCompanionId) || sim.companions[0];
      target.steadyUntil = sim.time + info.steadySeconds;
      emit(sim, "itemUsed", `The ember flares. Your head clears, and ${target.name} steadies.`, { itemKind: "ember", who: target.id });
      break;
    }
    case "beacon":
      sim.player.lucidity = Math.min(MAX_LUCIDITY, sim.player.lucidity + info.restore);
      sim.player.lensUntil = sim.time + info.clearSeconds;
      emit(sim, "itemUsed", "The beacon burns bright. Your head clears, and so does the screen.", { itemKind: "beacon" });
      break;
    case "ward": {
      const target = sim.companions.find((c) => c.id === targetCompanionId) || sim.companions[0];
      target.steadyUntil = sim.time + info.steadySeconds;
      sim.player.lensUntil = sim.time + info.clearSeconds;
      emit(sim, "itemUsed", `The ward holds. ${target.name} steadies, and you can trust your own eyes again.`, { itemKind: "ward", who: target.id });
      break;
    }
    default:
      break;
  }
  return { ok: true, real: true, kind: slot.kind };
}

/**
 * Combine two carried REAL items into a stronger one. Works off the sim's own
 * truth (like everything else in this file) — never the lead's PERCEIVED
 * inventory labels. That split is what makes a hallucinating lead's craft
 * attempt able to fail even though the item bar told them they were holding a
 * matching pair: the screen lied about what they were carrying, not this
 * function.
 *
 * Scans every pair of carried slots for the first one that both are real AND
 * form a known recipe — no slot-picking UI needed since the cap is only 3.
 * A phantom slot's `kind` is null and can never match a recipe, so it's
 * silently skipped rather than treated as a wrong guess.
 */
export function craftItem(sim) {
  if (sim.status !== "playing") return { ok: false, reason: "over" };
  if (sim.inventory.length < 2) return { ok: false, reason: "need-two" };
  for (let i = 0; i < sim.inventory.length; i++) {
    for (let j = i + 1; j < sim.inventory.length; j++) {
      const a = sim.inventory[i];
      const b = sim.inventory[j];
      if (!a.real || !b.real) continue;
      const result = CRAFT_RECIPES[recipeKey(a.kind, b.kind)];
      if (!result) continue;
      sim.inventory.splice(j, 1);
      sim.inventory.splice(i, 1);
      sim.inventory.push({ id: `slot${sim.inventory.length}-${sim.time.toFixed(2)}`, real: true, kind: result, claimedKind: null });
      sim.stats.itemsCrafted += 1;
      emit(sim, "craft", `The two combine. ${ITEM_INFO[result].label} forms in your hands.`, { itemKind: result });
      return { ok: true, kind: result };
    }
  }
  return { ok: false, reason: "no-recipe" };
}

/** Everyone at camp, or close enough to walk in together. */
export function partyAtCamp(sim) {
  return sim.party.filter((c) => dist2D(c, sim.world.camp) <= 9).length;
}

/** Called once per tick after movement. Sets `status`/`ending` when the run ends. */
export function checkEndings(sim) {
  if (sim.status !== "playing") return;

  const gone = sim.party.filter((c) => c.hallucinating).length;
  if (gone === PARTY_SIZE) {
    sim.dissolveTimer += sim.lastDt || 0;
    if (sim.dissolveTimer >= DISSOLVE_TIME) {
      sim.status = "lost";
      sim.ending = "dissolved";
      emit(sim, "end", "Six minds, no witnesses. The basin keeps you.");
    }
  } else {
    sim.dissolveTimer = 0;
  }

  if (sim.time >= TIME_LIMIT && sim.status === "playing") {
    sim.status = "lost";
    sim.ending = "darkness";
    emit(sim, "end", "The light goes. Whatever is still out here stays out here.");
    return;
  }

  if (trueLogCount(sim) >= sim.monoliths.length && sim.status === "playing") {
    // Survey complete — now walk it home. Extraction needs YOU plus at least
    // two others physically at camp; a lone lead with a written record is a
    // rumour, not a survey.
    const atCamp = sim.party.filter((c) => dist2D(c, sim.world.camp) <= 9);
    if (atCamp.includes(sim.player) && atCamp.length >= 3) {
      if (sim.level < sim.campaignLength) {
        // More basins in this campaign — main.js catches this status and
        // rebuilds a fresh basin (advanceLevel), carrying the party forward
        // instead of ending the run. The clock doesn't stop for a mind still
        // mid-hallucination at the exact moment of extraction: that state
        // carries into the next basin too.
        sim.status = "levelComplete";
        sim.ending = "advance";
        emit(sim, "advance", `Basin ${sim.level} cleared. The party pushes on.`);
      } else {
        sim.status = "won";
        sim.ending = "extracted";
        emit(sim, "end", "Camp. The record holds.");
      }
    }
  }
}

/**
 * Advance the whole simulation by `dt` seconds. Deterministic given the seed and
 * the sequence of inputs — the smoke test drives this directly through a debug
 * hook rather than waiting on wall-clock time (headless rAF runs well under
 * real time, so asserting on real seconds is a known way to get flaky tests).
 */
export function tick(sim, dt, input = {}) {
  if (sim.status !== "playing") return sim;
  const step = Math.min(dt, 0.1); // clamp: a background tab must not teleport the run
  sim.lastDt = step;
  sim.time += step;
  sim.events.length = 0;

  // Player movement. `input.move` is already yaw-rotated by the caller.
  if (input.move && (input.move.x || input.move.z)) {
    const speed = (input.run ? 7.4 : 4.3) * step;
    const len = Math.hypot(input.move.x, input.move.z) || 1;
    const next = moveWithCollision(
      sim.world,
      sim.player,
      (input.move.x / len) * speed,
      (input.move.z / len) * speed,
    );
    sim.player.x = next.x;
    sim.player.z = next.z;
  }
  if (typeof input.yaw === "number") sim.player.yaw = input.yaw;

  // Pylons recharge only while nobody is drawing on them.
  for (const p of sim.pylons) {
    const inUse = sim.party.some((c) => Math.hypot(p.x - c.x, p.z - c.z) <= PYLON_RADIUS);
    if (!inUse) p.charge = Math.min(PYLON_MAX_CHARGE, p.charge + PYLON_RECHARGE * step);
    p.live = p.charge > 0;
  }

  updateCompanions(sim, step);
  // Sightings are throttled: six markers × six pairs of eyes is a lot of
  // line-of-sight tracing to redo every frame, and a quarter-second of latency on
  // "there it is" is imperceptible in play while being ~8× cheaper in the
  // long-run simulations the balance harness does.
  sim.sightTimer = (sim.sightTimer || 0) - step;
  if (sim.sightTimer <= 0) {
    sim.sightTimer = 0.25;
    discover(sim);
  }

  for (const ch of sim.party) tickLucidity(sim, ch, step);

  // Unprompted chatter is the other half of the sensor: a companion who is
  // fraying will say so sideways, if you are listening.
  for (const c of sim.companions) companionRemark(sim, c, step);

  checkEndings(sim);
  return sim;
}

/** End-of-run debrief. Only here is the hidden state allowed to be revealed. */
export function debrief(sim) {
  return {
    status: sim.status,
    ending: sim.ending,
    time: Math.round(sim.time),
    found: discoveredCount(sim),
    logged: trueLogCount(sim),
    total: sim.monoliths.length,
    falseLogs: sim.stats.falseLogs,
    doseUses: sim.stats.doseUses,
    recoveries: sim.stats.recoveries,
    itemsUsed: sim.stats.itemsUsed,
    phantomItemsUsed: sim.stats.phantomItemsUsed,
    itemsCrafted: sim.stats.itemsCrafted,
    level: sim.level,
    campaignLength: sim.campaignLength,
    party: sim.party.map((c) => ({
      name: c.name,
      role: c.role,
      lucidity: Math.round(c.lucidity),
      band: bandOf(c.lucidity),
      hallucinating: c.hallucinating,
      scars: c.scars,
      goneSeconds: Math.round(c.goneTime),
    })),
  };
}

export { worldToCell, cellToWorld };
