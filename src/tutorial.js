// tutorial.js — the training camp. Pure; writes only sim.tut.
//
// Each step advances on STATE, not on a button: you have felled a tree, the
// fire is lit, the trunk is through. Walking past a verb teaches nothing, and
// a step cannot be skipped by doing a later thing first. Nobody goes under
// here — a new player cannot tell a taught hallucination from a broken game —
// and the text never says what the woods will do.

export const TRAINEES = Object.freeze([
  { name: "Orla", role: "Trainee", skills: { cut: 2, carry: 1, tend: 1, build: 1 } },
  { name: "Benet", role: "Trainee", skills: { carry: 2, track: 1, tend: 0, cut: 1 } },
]);

const away = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Text uses {tokens} for controls ({move} {look} {act} {camp} {fire} {rest}
 * {call}); main.js fills them for the device in the player's hands.
 */
export const STEPS = Object.freeze([
  { id: "walk", text: "Walk with {move}. Look around with {look}. Walk a little way up the trail.",
    done: (s) => away(s.lead, s.start) > 4 },
  { id: "camp", text: "Nothing is safe at night without a camp. Make one here: {camp}. It takes a little while, and everyone helps.",
    done: (s) => s.camp.built },
  { id: "wood", text: "Wood keeps you alive. Walk up to a tree with a pale notch and {act} to fell it. Carry the wood back into camp; it goes on the pile.",
    done: (s) => s.stats.felled >= 1 && s.camp.pile + s.camp.surplus >= 3 },
  { id: "fire", text: "Light the fire: stand at the stones and {fire}. A fire only shields the camp itself, and only at night. Its light reaches further than its safety.",
    done: (s) => s.camp.fire > 0 },
  { id: "ask", text: "Face Orla or Benet and {act}. Ask about today. Out here, what someone remembers is the only evidence there is.",
    done: (s) => s.stats.asked >= 1 },
  { id: "whistle", text: "Whistle with {call}. Anyone who hears it, and is not busy, whistles back and comes. It takes them a moment. Each of them whistles their own way: learn it.",
    done: (s) => s.stats.whistled >= 1 },
  { id: "chop", text: "A trunk lies across the trail to the north. Anyone can chop it; more hands are faster. Stand at it and {act}.",
    done: (s) => s.world.deadfalls[0].cleared },
  { id: "pylon", text: "Off the trail stands an old pylon, mossed over. A pylon takes two pairs of hands. Bring someone close, then {act}.",
    done: (s) => s.world.pylons.some((p) => p.state === "lit") },
  { id: "strike", text: "Last thing. Go back to camp and take it down: {camp}. A camp moves with you, one at a time. The woodpile stays where it is.",
    done: (s) => !s.camp.built },
  { id: "end", text: "That is the training. Out there, you set everyone's work at dawn, and at dusk you say who keeps watch. Then you sleep ({rest}). The woods are north.",
    done: () => false },
]);

export function startTutorial(sim) {
  sim.tut = { step: 0 };
  sim.start = { x: sim.lead.x, y: sim.lead.y };
  return sim;
}

/** Advance past every step whose state is already true, in order. Returns the step. */
export function tutorialStep(sim) {
  if (!sim.tut) return null;
  while (sim.tut.step < STEPS.length - 1 && STEPS[sim.tut.step].done(sim)) sim.tut.step++;
  return STEPS[sim.tut.step];
}
