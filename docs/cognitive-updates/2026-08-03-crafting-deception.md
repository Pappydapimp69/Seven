# Cognitive Update — 2026-08-03 · crafting deception

Milestone: item truth became observer-relative. Crafting now matches on belief,
a false craft is indistinguishable from an honest one at the moment it happens,
and a phantom crossing between two minds is exposed only if the RECEIVER isn't
sharing the delusion. See `docs/adr/0002-observer-relative-item-truth.md`.

## New Ideas (proposed to the `ideas` repo)

- **`[multiplayer / unreliable-narrator / per-viewer-derivation-gives-asymmetry-not-reveal / npc-observers-have-no-panel-to-read-truth-on]`**
  A refinement of the retrieved kernel `shared-state-per-viewer-truth /
  no-transfer-verb-needed`. Retrieval surfaced that kernel as directly on-point,
  and it was — but its conclusion rests on a precondition it never states:
  every observer must be a VIEWER with a rendered panel. Swap the second human
  for an AI companion and the asymmetry still exists in the data with nowhere
  to surface, because nobody renders the NPC's reading. So this build needed an
  explicit verb after all — and the verb turned out to be the better design,
  because it converts ambient truth into a resolution point that costs
  something.
- **`[SYSTEM / deception / truth-on-the-object-belief-on-the-observer / resolve-only-at-named-crossings]`**
  The general shape: one truth on the object, belief as a function of (object,
  observer), consequences only at a small enumerated set of resolution points.
  Plus the two rules that make it tractable — fix the tiebreak in advance
  ("at a crossing the receiver decides"), and let deception compound through
  construction so an individual affliction becomes a social one.

## New Memory (proposed to the `memory` repo)

- **Repaired and resubmitted `2026-08-03__cache-bust-gap-recurrence`**, which was
  sitting on a steward hold for missing every schema field (it would have
  promoted EMPTY). Filled in the full template and added this session's new
  finding: a PARTIAL cache-bust is strictly worse than none. Entry-point-only
  `?v=` stamping guarantees a fresh `main.js` resolved against possibly-stale
  nested modules, and the moment a release adds an export — exactly what
  `believedKinds` did here — that skew stops being "old content" and becomes an
  unresolved import and a black screen. Uniformly unstamped at least degrades
  to one self-consistent old set that still runs.
  Independently converged on: a parallel session had already closed the gap
  in-source with `tools/stamp-version.mjs` plus a suite assertion that every
  import and asset URL carries the current `BUILD` token. Two sessions reached
  the same diagnosis from opposite ends — one from a live black-screen risk,
  one from the recurrence itself — which is itself the strongest evidence the
  filed lesson is right. Theirs is the better implementation (the source that
  ships is the source that is checked), so this session's deploy-time rewrite
  was dropped in favour of it; the empirical `curl -I` measurement of
  `max-age=600` and the "partial is worse than none" argument are the parts
  that survive as new.

## New Tensions

None opened. One resolved-by-removal: the "should the source tree gain a build
step to fix cache-busting?" fork dissolved once the rewrite moved to the deploy
artifact — the source stays no-build AND the browser and the Node suite still
run byte-identical files, which is what makes the logic suite meaningful.

## New Exploration

`tests/scenario-deception.mjs` — a narrated end-to-end walk through the eight
clauses of the original request, run against the real sim. Written in response
to the retrieved lesson `dog#E23` (a request with multiple co-equal named
clauses ships half-done because nothing anyone checked was evidence for the
plainer clause). A green unit suite is not evidence that the STORY the clauses
describe actually plays out; this asserts each clause independently and prints
the resulting subtitles, so the fiction is inspectable, not just the state.

## Graduation Candidates

- The **no-tells test section** in `tests/logic.test.mjs` is the generalizable
  artifact here. A deception mechanic is only as good as its worst leak, and an
  adversarial review found four independent ones — a subtitle naming the true
  kind, a different sentence shape for a phantom, a missing definite article,
  and a refusal that only ever refused real items. Each individually let a
  player decide an item's truth for free. Candidate rule: for any
  hidden-information mechanic, assert that the honest and deceptive paths are
  BYTE-IDENTICAL on every channel the player can observe (text, event kind,
  styling, audio, ordering, and whether state was consumed) — and treat that
  assertion as part of the mechanic, not as test hygiene.
- **T11 (🔴 automated 3D verification has a ceiling: logic, not looks)** touches
  this work and is worth restating: this feature sits almost entirely on the
  GOOD side of that ceiling. It is logic and text, both fully assertable
  headless. The one part that is not — whether the false-craft moment actually
  *reads* as unremarkable in play — remains a human-eye question.
