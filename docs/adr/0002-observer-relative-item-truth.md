# ADR 0002 — item truth is observer-relative, and resolves only at crossings

**Status:** accepted · 2026-08-03 · applies to this repo (`Pappydapimp69/mirage`)

## Context

Until now a carried item had exactly one deception mode, decided once and for
all at pickup: a lead who reached for something while hallucinating might get a
PHANTOM (`real:false`, a permanent `claimedKind`, nothing behind it), and the
surprise resolved the moment they tried to use it. Real items could additionally
be *mislabelled* on screen for the duration of a hallucination episode
(`percept.itemLabels`), but that lie never touched the sim — `craftItem` worked
strictly off `sim.inventory`'s true kinds.

That split had a deliberate and defensible property, documented in `craftItem`
itself: a hallucinating lead whose item bar promised a matching pair would press
craft and simply *fail*. The screen lied; the mechanic refused to.

Two problems with stopping there. First, a failed craft is a dead end — the
deception announces itself immediately (the button didn't work) and costs the
player nothing but a press, so it teaches suspicion rather than dread. Second,
and more importantly, the fiction had no way to travel between minds. Every lie
was strictly first-person: *your* meter, *your* screen, *your* mistake. But the
party is the game's real subject, and companions had just gained the ability to
pick items up and hand them over — which meant a mind that had never
hallucinated could now be carrying the product of somebody else's episode with
no mechanism that cared.

## Decision

Truth stops being a property of the object alone.

1. **One truth, on the slot.** `state.js` still records exactly what a slot IS
   (`real`, `kind`). Nothing about this changes.
2. **Belief is a function of (slot, observer).** What a mind thinks it holds
   depends on that mind's own condition. `percept.js` gained `believedKinds()`,
   which is literally the labels the item bar is showing.
3. **Belief becomes consequential only at named RESOLUTION POINTS** — using an
   item, building with it, or putting it in someone else's hands. Everywhere
   else, disagreement is allowed to persist silently. That silence is what lets
   a lie travel and compound instead of being settled the instant it appears.
4. **Crafting matches on belief; honesty is judged on truth.** `craftItem` now
   commits whenever the lead *believes* they hold a matching pair, and the
   result is real only if both ingredients were real AND read correctly.
   Anything else yields a phantom that claims to be exactly what was intended.
5. **At a crossing, the RECEIVER decides.** This is the precedence rule, fixed
   in advance rather than re-litigated per call site. A lucid receiver reaching
   for something that was never there closes on nothing — and because the reach
   is public, that nothing is information about the giver. Two deceived minds
   agree, and the object survives the handover intact.

### Consequences

- **Deception compounds through construction.** A stone-cold-lucid lead can
  build a false item, because one ingredient was a phantom a hallucinating
  companion handed them. This is the whole point: it converts an individual
  affliction into a social one. You can be deceived by someone else's condition
  without ever having shared it.
- **A lucid companion is a test instrument; a gone one is an echo chamber.**
  The new `offerItem` verb (V / D-pad Down / `#btnGive`) is the only mechanism
  in the game that can tell players something about *their own* state — every
  other tell is about somebody else. It is deliberately not free: the same verb
  hands a genuinely useful item to a companion who uses it on the spot, so a
  failed offer means you weren't running an experiment, you were trying to help
  somebody and had nothing in your hand.
- **A false craft must be indistinguishable at the moment it happens.** Same
  event kind, same subtitle text, same sound, same craft-ready indicator naming
  the same output. This is enforced by a test asserting the honest and false
  paths are byte-identical on screen, because any incidental difference —
  wording, styling, audio, ordering — silently destroys the mechanic. The
  craft-ready hint reads the belief view too; it would otherwise have quietly
  become the one honest instrument on the display.
- **A Lens sees through a crossing.** `seesThrough()` counts an active Lens
  window, not just the `hallucinating` flag, so the game's one truth-telling
  item doesn't acquire an arbitrary blind spot.
- **The Stake can never be false.** It is crafted from wood and stone, and raw
  materials carry no deception layer at all (a tree is always a tree). The one
  recipe made entirely of things that cannot lie is the one craft that always
  comes out honest — a deliberate floor under the system.
- **The module boundary held.** `state.js` still does not import `percept.js`;
  the belief view is passed IN by `main.js`/`hud.js`. The sim stays headless-
  testable, which is what makes the whole deception layer assertable without a
  browser.

## What did NOT change

`state.js` remains the only source of truth and `percept.js` the only module
permitted to distort it. The lucidity meter is still never rendered. A phantom's
`claimedKind` is still permanent and still survives recovery — only the
per-episode mislabelling of *real* slots is temporary. And the debrief is still
the single place hidden state is revealed, now including how many of the things
you made were never there.
