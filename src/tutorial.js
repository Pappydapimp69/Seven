// tutorial.js — the walk in.
//
// Seven short stages that teach one verb each and, between them, teach the
// thing the verbs are for: that what you are shown and what you are told are
// both claims. Pure logic; no DOM, no Three.
//
// SHAPE (brain: the-game-prologue#E15). This is a passive OBSERVER over the
// events real play already emits, not a tutorial mode with its own sandbox,
// locked inputs or intercepted commands. The player is playing the real game
// from the first frame; the overlay only notices. There is no duplicate
// "tutorial version" of any verb and no mode to exit, so a verb cannot behave
// one way here and another way afterwards.
//
// The tradeoff that shape imposes, taken deliberately: because the teaching
// steps ride the SAME event stream as ordinary play, every step must be pinned
// NARROWLY — to a specific entity id, never to a bare event kind — or ordinary
// play satisfies a teaching step by accident. That discipline is permanent, and
// `tests/tutorial.mjs` enforces it rather than trusting the authoring.

/**
 * A stage is a POST-PROCESS over a normally generated world, never bespoke
 * geometry. `generateWorld` takes a seed and nothing else, and everything that
 * guarantees a basin is walkable — reachability, spire placement, the camp —
 * lives inside it. Authoring terrain by hand would mean re-earning all of that;
 * pruning and repositioning entities in an already-valid world earns it for
 * free.
 *
 * `verb` is what the stage teaches. `clears` names the higher-priority verbs
 * whose targets must be removed from the teaching site — see the note on
 * starvation below.
 */

// The single-action prompt resolver in hud.js answers exactly one question:
// what can happen right now. Its priority order is
//
//     pylon -> pickup -> gather -> survey -> strike
//
// which means a teaching step is silently unreachable if anything ABOVE its
// verb is simultaneously valid where the player is standing. A step pinned to
// "survey this marker" never fires while an item lies in reach; a step pinned
// to "pick this up" never fires inside a pylon radius. Neither system errors —
// the prompt simply shows something else forever.
//
// (brain: sandbox-resolver-starves-tutorial#E1, and #E2's warning that there is
// one such candidate PER pipeline layer, so an endpoint-only "the input fired"
// check would pass while the tutorial never does.)
import { CELL } from "./world.js?v=seven-0.26.3";

export const VERB_PRIORITY = Object.freeze(["pylon", "pickup", "gather", "survey", "strike"]);

/** Verbs that outrank `verb`, i.e. the ones a stage must clear from its site. */
export function outranks(verb) {
  const i = VERB_PRIORITY.indexOf(verb);
  return i <= 0 ? [] : VERB_PRIORITY.slice(0, i);
}

/**
 * The trainer's name.
 *
 * He was the string "TRAINER" and nothing else, which made the one fixed
 * character in the game the only person in it without a name.
 *
 * NINE LETTERS, AND THAT IS THE POINT. `makeRoster` discards any composed name
 * longer than `NAME_MAX` (8), so the roster generator cannot produce this one —
 * a structural guarantee rather than a statistical one. Sampling four thousand
 * seeds and finding no collision says nothing about the four thousand and
 * first; a length rule says something about all of them. tests/tutorial.mjs
 * asserts the rule, not a sample.
 *
 * It also reads as not-crew, which is what he is. The five are VOSS, IREN,
 * HALDER, NKEM, PAO — clipped, carried overnight, compared one against another.
 * He is none of those things and should not sound like he could be swapped.
 */
export const TRAINER_NAME = "ABERNATHY";

/**
 * THE WALK IN — seven objectives, ONE session, ONE map.
 *
 * These used to be seven separate runs: each `startStage` built a fresh basin,
 * wiped it, placed one thing and tore it down again on completion. Nothing
 * persisted and nowhere was anywhere. Now the player spawns into the camp once
 * and the objectives open in sequence around them, in a place that does not
 * change.
 *
 * `opens` is what the objective makes exist or makes possible. Two different
 * gates, deliberately (brain: wrong-sky#E8):
 *
 *   EXISTENCE-GATED — the items. An item lying on the ground before its
 *   objective is an out-of-order pickup, which is exactly the accident the
 *   pinning discipline exists to prevent. They do not spawn until asked for.
 *
 *   EFFECT-GATED — the pylons. They stand in the camp from the first frame
 *   under moss: findable, rememberable, and inert with a reason you can read.
 *   A player who wanders early meets one and learns where it is, which is worth
 *   more than not meeting it at all.
 */
export const OBJECTIVES = Object.freeze([
  {
    id: "walk-in",
    title: "The walk in",
    verb: "move",
    brief: `You are late. ${TRAINER_NAME} is waiting at the far end of the path — walk over to him with {move}.`,
    // A PLACE, not a distance. "Cover 30m" is satisfied by pacing in a circle
    // and teaches nothing; walking the length of the camp to a person who is
    // waiting for you teaches the map and introduces the man in one action.
    step: { id: "reachedTrainer", on: "reachTrainer", target: "trainer" },
    debrief: "Everyone else finished this yesterday. They are around here somewhere.",
  },
  {
    id: "ground",
    title: "What the ground gives",
    verb: "pickup",
    brief: "He has put something down for you. Walk onto it and press {act} to take it.",
    opens: { items: [{ id: "tut-item-a", kind: "flare", near: "trainer", dx: 3, dz: 2 }] },
    step: { id: "tookItem", on: "pickup", target: "tut-item-a" },
    line: { who: 5, text: "A flare, I think. Good for a dark stretch." },
    debrief: "Everything you know about that flare, you know because someone told you.",
  },
  {
    id: "craft",
    title: "Two things become one",
    verb: "craft",
    brief: "There is a second piece by his feet. Take it with {act}, then press {craft} to combine the two into something better.",
    opens: { items: [{ id: "tut-item-b", kind: "tether", near: "trainer", dx: -2, dz: 3 }] },
    step: { id: "crafted", on: "craft", targetKind: "ember", target: null, kindPinned: true },
    debrief: "A recipe is a claim about two objects. Hold on to that.",
  },
  {
    id: "hands",
    title: "Hands",
    verb: "give",
    brief: "Press {select} to pick IREN on the roster (the list of names, top left). Walk up to her and press {give} to hand it over.",
    step: { id: "gave", on: "offerUsed", target: "c2" },
    debrief: "Things change hands. The person handing one to you believes something about it.",
  },
  {
    id: "pylon",
    title: "The pylon takes two",
    verb: "pylon",
    // TWO BEATS, ONE LESSON. Find the thing under the moss and clear it; then
    // the trainer asks whether you are sure it is really there, and the answer
    // is another pair of eyes. Teaching CALL here rather than in its own
    // objective is the difference between learning a verb and needing one.
    brief: "There is something out here under the moss. Find it, stand on it and press {act} to clear it off.",
    opens: { canClearMoss: true },
    step: { id: "firedPylon", on: "draw", target: null, kindPinned: true },
    beats: [
      {
        on: "unmoss",
        say: `${TRAINER_NAME}: A pylon. Or it looks like one. Are you sure it is there? Call someone over with {call}, then press {act} once you are both standing in it.`,
        opens: { call: true },
      },
    ],
    debrief: "It only ever fires once, and it always takes two. One pair of hands is a claim.",
  },
  {
    id: "ask",
    title: "Ask them",
    verb: "checkin",
    brief: "Check in on HALDER, then on NKEM — to check in, {checkin}.",
    step: { id: "askedBoth", on: "report", target: ["c3", "c4"] },
    debrief: "One of them told you what they wanted to be true. An answer is evidence, not fact.",
  },
  {
    // The id is SAVE STATE (it is in every returning player's `done` list), so
    // it stays "first-lie" although the objective no longer is one.
    //
    // NOBODY GOES UNDER DURING THE WALK IN. This objective used to put the
    // lead under and have them log a marker that was not there. The owner's
    // call from a playtest: the walk in teaches the verbs and nothing lies
    // while it does — a new player cannot tell a taught hallucination from a
    // broken game. So this is a REAL marker, surveyed for real, and the lie is
    // left for the game itself to show them.
    id: "first-lie",
    title: "Survey",
    verb: "survey",
    brief: "There is a survey marker standing north of him, a tall dark stone. Walk up to it and press {act} to write it into the record.",
    opens: { marker: { id: "tut-marker", name: "the Tally Stone", near: "trainer", dcx: -2, dcz: -6 } },
    step: { id: "surveyed", on: "log", target: "tut-marker" },
    debrief: "Written down. Nobody vouched for it — out there, ask someone to stand with you when you do.",
  },
]);

/** Kept as the old name so nothing downstream has to care that these are objectives now. */
export const STAGES = OBJECTIVES;

/** Every verb a stage teaches, for the coverage assertion. */
export const TAUGHT_VERBS = Object.freeze(STAGES.map((s) => s.verb));

/**
 * A fresh progress record. Lives INSIDE the save payload — never as its own
 * localStorage key.
 *
 * brain: dog#E64. A "seen once ever" bit kept as a raw key outside the save
 * payload becomes a cross-slot leak the moment a game grows more than one slot:
 * finishing the gated content in ANY slot disables it for every future new game
 * in every slot. This repo already keeps two raw keys, so a third would have
 * been the third chance to make that mistake.
 */
export function freshProgress() {
  return { done: [], current: 0 };
}

export const stageById = (id) => STAGES.find((s) => s.id === id) || null;
export const isComplete = (progress) => (progress?.done?.length || 0) >= STAGES.length;

/**
 * Watch one frame's events and mark the active stage's step done.
 *
 * READ-ONLY with respect to `sim`. It never intercepts a command, never
 * rewrites one, and never emits — the simulation runs identically whether or
 * not this is watching, which is what makes a non-tutorial run byte-identical
 * with this module present.
 *
 * `events` MUST be main.js's merged frame stream. `sim.events` alone is not the
 * event stream: `tick()` wipes it on its first line for its own internal emits,
 * so every verb this tutorial teaches — pickup, craft, offer, draw, report —
 * would be invisible to an observer reading it. That is the same silent
 * starvation as the resolver case, one layer further out.
 */
export function observe(progress, stage, events, sim, scratch) {
  if (!progress || !stage || progress.done.includes(stage.id)) return false;
  const want = stage.step;
  for (const ev of events || []) {
    if (ev.kind !== want.on) continue;
    // PINNED. A bare `ev.kind` match is what lets ordinary play tick a teaching
    // step off by accident, so every step names the exact entity it is about.
    if (want.target !== null) {
      const id = ev.id ?? ev.who ?? ev.itemId ?? ev.name;
      const targets = Array.isArray(want.target) ? want.target : [want.target];
      if (!targets.includes(id)) continue;
      // A MULTI-TARGET step spans frames, so the half-finished tally needs a
      // home that outlives one call. It must be `scratch` — an object the
      // CALLER guarantees is the same one next frame — and never `progress`:
      // `progress` comes back from loadSettings(), which re-parses localStorage
      // and rebuilds the object every single frame, so anything written there
      // mid-stage is thrown away before the next event arrives. The only
      // multi-target stage in the tutorial ("ask HALDER, then NKEM") could
      // therefore never complete in real play, while a unit test that reused
      // one `progress` object across calls saw it pass.
      if (Array.isArray(want.target)) {
        if (!scratch) throw new Error(`observe: stage "${stage.id}" is multi-target and needs a scratch object`);
        scratch.seen = scratch.seen || [];
        if (!scratch.seen.includes(id)) scratch.seen.push(id);
        if (scratch.seen.length < want.target.length) continue;
      }
    }
    progress.done.push(stage.id);
    if (scratch) scratch.seen = [];
    return true;
  }
  return false;
}

/**
 * Words that must never reach a player during a stage. The meter is the one
 * fact this game withholds, and a tutorial is exactly where a well-meaning
 * caption leaks it — "your sanity is dropping", "VOSS is hallucinating". Once a
 * player has been told the number exists, every later run is played against it.
 *
 * Checked against every authored string in this file by tests/tutorial.mjs.
 */
export const FORBIDDEN = Object.freeze([
  "lucidity", "sanity", "hallucinat", "meter", "bar", "percent", "%",
  "steady", "unsettled", "fraying", "brittle",
]);

export function leaks(text) {
  const low = String(text || "").toLowerCase();
  return FORBIDDEN.filter((w) => low.includes(w));
}

// ---------------------------------------------------------------------------
// Stage construction
// ---------------------------------------------------------------------------

/**
 * Shape a normally generated basin into one stage.
 *
 * POST-PROCESS, never bespoke geometry: `generateWorld` owns reachability,
 * spire placement and the camp, and re-earning any of that by hand would be a
 * new class of bug for no gain. Everything below only prunes, moves and flags
 * entities in a world that is already known-good.
 *
 * Two rules every stage obeys:
 *
 * 1. CLEAR WHAT OUTRANKS. The prompt resolver surfaces exactly one verb, so
 *    anything above the taught verb must be removed from the teaching site or
 *    the step is unreachable and nothing errors. `siteVerb` below is the same
 *    ladder, and tests/tutorial.mjs asserts it agrees with hud.js's real order.
 * 2. THE CLOCK STAYS OFF. `sim.time` starts at 0, inside the calm window, so no
 *    stage is secretly a race and no meter moves while someone is learning to
 *    press a button. The one stage that needs a mind to go under puts it there
 *    directly rather than by waiting.
 */
export function openObjective(sim, obj) {
  if (!obj || !obj.opens) return sim;
  const o = obj.opens;

  if (o.items) {
    for (const spec of o.items) {
      if (sim.items.some((it) => it.id === spec.id)) continue;
      const anchor = spec.near === "trainer" && sim.trainer ? sim.trainer : sim.player;
      sim.items.push({
        id: spec.id,
        x: anchor.x + (spec.dx || 0),
        z: anchor.z + (spec.dz || 0),
        itemKind: spec.kind,
        discovered: true,
        taken: false,
      });
    }
  }
  if (o.canClearMoss) sim.canClearMoss = true;
  if (o.call) sim.callUnlocked = true;
  if (o.marker) {
    // EXISTENCE-GATED like the items: the stone is not there until the
    // objective asks for it. Placed in cells off the trainer, on open ground
    // well clear of both pylons (tests/tutorial.mjs checks both).
    const m = o.marker;
    if (!sim.monoliths.some((x) => x.id === m.id)) {
      const anchor = m.near === "trainer" && sim.trainer ? sim.trainer : sim.player;
      sim.monoliths.push({
        id: m.id, kind: "monolith", name: m.name,
        x: anchor.x + (m.dcx || 0) * CELL, z: anchor.z + (m.dcz || 0) * CELL,
        logged: false,
      });
    }
  }
  return sim;
}

/**
 * Has the lead reached the trainer? Emits once, the first time.
 *
 * The objective is a PLACE, so something has to notice arrival. Kept here
 * rather than in state.js because the trainer only exists in the camp, and
 * state.js should not grow a concept that only one map has.
 */
export const TRAINER_RADIUS = 4.5;
export function checkTrainer(sim, emit) {
  if (!sim.trainer || sim.reachedTrainer) return false;
  if (Math.hypot(sim.player.x - sim.trainer.x, sim.player.z - sim.trainer.z) > TRAINER_RADIUS) return false;
  sim.reachedTrainer = true;
  emit(sim, "reachTrainer", `${TRAINER_NAME}: There you are. Right — from the top.`, { id: "trainer" });
  return true;
}

/**
 * Which verb the prompt resolver would surface for `actor` right now.
 *
 * The same ladder as hud.js's `paintPrompt`, expressed over rules primitives so
 * a stage's reachability can be asserted without a DOM. It is not a second
 * source of truth: tests/tutorial.mjs parses the real order out of hud.js and
 * fails if the two ever disagree, which is what makes this safe to rely on.
 */
export function siteVerb(sim, actor, helpers) {
  const { pylonAt, nearestItem, gatherTarget, nearestMarker } = helpers;
  if (pylonAt(sim, actor)) return "pylon";
  if (nearestItem(sim, actor)) return "pickup";
  if (gatherTarget(sim, actor)) return "gather";
  if (nearestMarker(sim, actor)) return "survey";
  return null;
}

/** The line shown while a stage is running. Never names the hidden meter. */
export const objectiveText = (stage) => (stage ? stage.brief : "");
