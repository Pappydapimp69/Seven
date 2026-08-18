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
export const VERB_PRIORITY = Object.freeze(["pylon", "pickup", "gather", "survey", "strike"]);

/** Verbs that outrank `verb`, i.e. the ones a stage must clear from its site. */
export function outranks(verb) {
  const i = VERB_PRIORITY.indexOf(verb);
  return i <= 0 ? [] : VERB_PRIORITY.slice(0, i);
}

export const STAGES = Object.freeze([
  {
    id: "walk-in",
    title: "The walk in",
    verb: "move",
    // Nothing to press. The stage exists so that five named people holding a
    // formation and talking to each other is established BEFORE the party is
    // established as a tool.
    brief: "Walk with them. Look around. They will keep up.",
    step: { id: "walked", on: "moved", target: null, minDistance: 30 },
    debrief: "That is your party. You will learn to read them before you learn to read the basin.",
  },
  {
    id: "ground",
    title: "What the ground gives",
    verb: "pickup",
    brief: "PAO has found something. Take it.",
    // Pinned to ONE item id placed by the stage, so picking up anything else —
    // now or in a later stage — cannot satisfy it.
    step: { id: "tookItem", on: "pickup", target: "tut-item-a" },
    // A companion names the item, not the HUD. The seed this plants is
    // collected in stage 7: information in this game arrives through people,
    // and people can be wrong.
    line: { who: 5, text: "A flare, I think. Good for a dark stretch." },
    debrief: "Everything you know about that flare, you know because someone told you.",
  },
  {
    id: "craft",
    title: "Two things become one",
    verb: "craft",
    brief: "Two of those make something better. Combine them.",
    // Crafting has no entity to pin to — the recipe consumes two slots and
    // produces a kind, not an id — so this pins to the RESULT KIND and the
    // stage guarantees it is the only way to make one. Declared as an explicit
    // exception so the pinning test can hold every other step to the strict rule.
    step: { id: "crafted", on: "craft", targetKind: "ember", target: null, kindPinned: true },
    debrief: "A recipe is a claim about two objects. Hold on to that.",
  },
  {
    id: "hands",
    title: "Hands",
    verb: "give",
    // Names the AIMING step, not the key. `give` acts on the roster selection
    // and has no direct-target form, so "give it to IREN" alone is an
    // instruction a player cannot carry out — but spelling out a keybind here
    // would duplicate the legend in prose that drifts the next time a binding
    // moves, and it would be WRONG for whichever scheme the player is not on.
    // The always-visible hint strip carries the keys
    // (brain: the-game-the-answering-deep#E9); this says what to do with them.
    brief: "Pick IREN out on the roster, then hand it to her.",
    step: { id: "gave", on: "offerUsed", target: "c2" },
    debrief: "Things change hands. The person handing one to you believes something about it.",
  },
  {
    id: "pylon",
    title: "The pylon takes two",
    verb: "pylon",
    brief: "That is a pylon. Stand in it and set hands on it — then get someone to join you.",
    step: { id: "firedPylon", on: "draw", target: "p0" },
    debrief: "It only ever fires once, and it always takes two. Remember what it looked like when nobody joined.",
  },
  {
    id: "ask",
    title: "Ask them",
    verb: "checkin",
    // `check in` IS directly targetable — every name on the roster carries its
    // own number — so this points at the numbers rather than at the selection
    // cycle. Same rule as stage 4: say how to aim, let the legend say with what.
    brief: "Check in on HALDER, then on NKEM. Their numbers are beside their names.",
    step: { id: "askedBoth", on: "report", target: ["c3", "c4"] },
    // The stage forces a check-in on someone who shades the truth and someone
    // who does not, and never says which was which until the debrief. The
    // player is not told a meter moved; they are shown two answers and what was
    // actually true.
    debrief: "One of them told you what they wanted to be true. An answer is evidence, not fact.",
  },
  {
    id: "first-lie",
    title: "The first lie",
    verb: "survey",
    brief: "There is a marker out there. Survey it.",
    step: { id: "metTheLie", on: "logFalse", target: null, kindPinned: true },
    debrief: "It was never there. Someone standing with you would have said so.",
  },
]);

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
export function applyStage(sim, stage) {
  // A clean slate: nothing discovered, nothing in reach, no clock pressure.
  sim.time = 0;
  sim.status = "playing";
  for (const m of sim.monoliths) { m.discovered = false; m.logged = false; m.x += 4000; m.z += 4000; }
  for (const it of sim.items) { it.discovered = false; it.taken = true; }
  for (const t of sim.trees) { t.discovered = false; t.chopped = true; }
  for (const st of sim.stones || []) { st.discovered = false; st.taken = true; }
  for (const p of sim.pylons) { p.spent = true; p.primedBy = []; }
  sim.inventory.length = 0;

  const at = sim.player;
  const near = (dx, dz) => ({ x: at.x + dx, z: at.z + dz });

  switch (stage.id) {
    case "walk-in":
      // Nothing to press. Five people, a formation, and room to walk.
      break;

    case "ground": {
      // ONE item, pinned by id, and no pylon anywhere near it — pylon outranks
      // pickup, so a pylon in radius would replace the prompt this stage exists
      // to show.
      const spot = near(6, -8);
      sim.items.push({ id: "tut-item-a", ...spot, itemKind: "flare", discovered: true, taken: false });
      break;
    }

    case "craft":
      // The two halves of one recipe, already in hand: this stage teaches the
      // combine, not the finding.
      sim.inventory.push({ id: "tut-craft-a", real: true, kind: "flare", claimedKind: null });
      sim.inventory.push({ id: "tut-craft-b", real: true, kind: "tether", claimedKind: null });
      break;

    case "hands":
      sim.inventory.push({ id: "tut-give", real: true, kind: "flare", claimedKind: null });
      break;

    case "pylon": {
      // The one live pylon in the basin, on top of the party, so the two-hands
      // rule is the only thing the stage is about.
      const p = sim.pylons[0];
      p.spent = false;
      p.primedBy = [];
      p.primedAt = -1e9;
      p.x = at.x + 3;
      p.z = at.z - 5;
      break;
    }

    case "ask":
      // One mind that will shade its answer and one that will not. The player
      // is never told which; the debrief is.
      sim.companions[2].lucidity = 22; // HALDER — low enough to shade
      sim.companions[3].lucidity = 96; // NKEM — steady
      break;

    case "first-lie": {
      // The lead goes under, here, on purpose, with no real marker in reach and
      // nobody close enough to refuse the entry. Survivable and reversible: the
      // stage ends the moment the false entry is written.
      const lead = sim.player;
      lead.lucidity = 0;
      lead.hallucinating = true;
      lead.hallucination = "phantomMarker";
      lead.microUntil = 0;
      for (const c of sim.companions) { c.x = at.x + 300; c.z = at.z + 300; }
      break;
    }

    default:
      break;
  }
  return sim;
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
