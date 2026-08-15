# Blueprint — the walk in: MIRAGE's tutorial campaign

## The problem

MIRAGE's core mechanic is deliberately unstated, and the game is not
trial-and-error friendly: the punishment for not understanding it is a run you
lose without learning why.

The obvious tutorial — one stage per verb — teaches the CONTROLS and none of the
GAME. MIRAGE's actual skill is epistemic: deciding whether to trust what you are
shown and what you are told. So the progression has to do both, and the second
has to be taught the way the game teaches it: by being done to you.

## Decisions taken (owner may veto)

- **Stage 7 betrays a first-time player.** It is seeded by 2/3/4/6, it is
  survivable, and the debrief explains it. A tutorial that only foreshadows
  leaves the player's first real betrayal in a run that matters.
- **Stages gate on DEMONSTRATION, not completion.** Walking past a verb teaches
  nothing. This is also the reason brain's starvation lessons apply at all — a
  completion gate cannot starve.

## The hard constraint

**No lucidity value, band name, or hallucination state is ever rendered during a
tutorial stage.** No bar, no number, no "you are hallucinating" caption — the
last is the same leak one step down. What gets taught is the READ: lag, silence,
a wrong colour, someone narrating a ridge that isn't moving.

## The stages

Each teaches ONE verb and plants ONE seed a later stage collects.

1. **The walk in** — movement, look, sprint. *Seed:* five named people who hold
   a formation and talk.
2. **What the ground gives** — discover and pick up. *Seed:* a companion
   describes the item, not the HUD. Information arrives through people.
3. **Two things become one** — crafting. *Seed:* a recipe is a claim about two
   objects.
4. **Hands** — give, drop, receive. *Seed:* things change hands, and the person
   handing it over believes something about it.
5. **The pylon takes two** — the level goal and the two-hands rule. *Seed:*
   relief is finite and needs someone else.
6. **Ask them** — check-in. Forces one on someone fraying and one on someone
   fine, never says which; the debrief shows both answers against the truth.
   *Seed collected:* an answer is evidence, not fact.
7. **The first lie** — a scripted, survivable hallucination. Shown a marker that
   is not there, invited to log it, with a lucid companion in range to refuse
   it. *Seeds 2/3/4/6 collect here.*

## What must remain UNCHANGED

- A non-tutorial run must be byte-identical with this code present. The overlay
  is read-only and inert outside stages.
- `generateWorld` and its reachability guarantees. Stages POST-PROCESS a
  normally generated world; no bespoke geometry, no new generator parameters.
- The single-action prompt resolver's priority order. The tutorial adapts to it;
  it does not get a special case.
- The save schema's existing fields, and the rng draw sequence.

## Preflight

**Authoritative state and functions**

- `createRun({seed, difficulty, level, campaignLength, carryOver})` — the only
  run constructor. `generateWorld(seed)` takes a seed and nothing else.
- `tick(sim, dt, input)` — sole mutator; wipes `sim.events` on its first line.
- `emit(sim, kind, text, opts)` — sole event producer.
- `saveRun/loadSave` in save.js are the ONLY `localStorage` callers (verified:
  two keys, both behind `store()`).
- `paintPrompt` in hud.js — the single-action resolver.

**Conflicting overrides / listeners — two found, both design-changing**

1. **`sim.events` is not the event stream.** `tick()` clears it on entry, so the
   verbs the tutorial is built on (pickup, craft, give, log, dose — all emitted
   by `handleAction`) exist only in main.js's merged
   `actionEvents.concat(sim.events)` at frame end. An observer placed in
   state.js would silently never see them. **The observer hooks the merged array
   in main.js.** This is brain's per-layer starvation lesson landing on real
   code before a line was written.
2. **The resolver's priority ladder is pylon → pickup → gather → survey →
   strike.** A step teaching SURVEY starves if an item or a tree is in reach; a
   step teaching PICKUP starves inside a pylon radius. Stage post-processing
   must clear higher-priority targets from the teaching site, and a test must
   prove it rather than trusting the authoring.

**Invariants the finished build must satisfy**

- **I1** No tutorial-reachable string contains a lucidity number, a band name,
  or the word "hallucinat*".
- **I2** The observer never mutates the sim (fingerprint before/after).
- **I3** Every step is pinned to a specific entity id, never a bare event kind.
- **I4** For every step, the target verb is the resolver's TOP choice at the
  teaching site — no starvation.
- **I5** Tutorial progress lives inside the save payload; no third raw
  localStorage key anywhere in the codebase.
- **I6** Every bound verb is taught by at least one stage.
- **I7** A non-tutorial run is unchanged: same rng stream, same outcomes.

**Regression risks**

- R1 Observer hooked into the frame path could reorder audio/HUD calls.
- R2 A new save field changes the schema — resume/campaign tests.
- R3 Post-processing a world could strand an entity behind geometry.
- R4 Stage runs create sims; the constant-roll-count discipline must hold.

**How CI verifies them**

- `tests/tutorial.mjs` (node): I1 by scanning all stage copy for forbidden
  tokens; I2 by fingerprint; I3 and I6 by walking the step table; I4 by calling
  the REAL resolver at each teaching site; I7 by running a seeded normal run
  with and without the overlay loaded and comparing fingerprints.
- `tests/stress.mjs`: I5 by grepping the tree for `localStorage` outside
  save.js.
- Browser: one stage played end to end, asserting the step fires and no
  forbidden token ever reaches the DOM.

## Still requires a human

Whether stage 7's betrayal lands as a lesson or as a cheat; whether the pacing
of seven stages is tolerable; whether the read-the-people teaching actually
transfers to a real basin. None of that is measurable here.
