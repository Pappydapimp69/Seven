# Cognitive Update — THE WOODS alpha, and four bugs it dragged out

Date: 2026-08-30 · Project: pappydapimp69/seven (and mirage)

## New ideas

- **Derived vs authored tells** (`ideas`, pushed). In any game where the player
  has to detect a liar, the wrong details must be produced by perturbing the
  real record, never drawn from a hand-written list — a list is finite and is
  memorised. Two conditions make it work, both learned the hard way: the
  perturbation must be VERIFIED VISIBLE (one that renders identically to the
  truth is worse than none — the player does the work and gets nothing, and no
  layer errors), and the PHRASING must be shared between honest and dishonest
  speakers or the player reads style instead of substance.
- **A question budget is what makes it a memory game** (`ideas`, pushed). One
  question per suspect collapses the puzzle into a diff: collect every account,
  lay them side by side, read off the odd one out, remember nothing. The
  deduction only exists if the budget is SMALLER than the cast. Worth asserting
  structurally rather than tuning — `ASKS_ALLOWED < PARTY_SIZE` is a property
  of the design, not a difficulty knob.
- **Memorability is a length and pronounceability constraint** (`ideas`,
  pushed). When a system generates names the player must HOLD rather than
  merely recognise, generation quality is functional: an unsayable name is
  stored as a shape and shapes cannot be compared one letter at a time, which
  kills any mechanic where a one-letter difference is a clue. Compose from
  fragments under adjacency rules, cap the length, and enforce a minimum edit
  distance that counts an adjacent TRANSPOSITION as one — because that is how a
  reader counts it, and because a swap is the most natural near-miss to
  generate.

## Memory (all pushed to main)

- **E17** — a default lives twice, and only one copy moved. A default that is
  also rendered as a pre-selected control is declared in code AND in markup;
  changing the constant alone ships a first-launch-only lie. Assert the two
  copies against each other on a cleared profile, not each against a literal.
- **E18** — a sentinel that nothing routes regenerates as valid-but-wrong. The
  camp's reserved seed had no consumer, so a saved camp run resumed by handing
  the sentinel to the procedural generator and got back a real, walkable,
  entirely different map with the saved positions pasted on. Live in MIRAGE's
  tutorial too, which autosaves every five seconds.
- **E19** — a source window measured in characters is a guard with an expiry
  date. Two tests sliced a fixed character count into a source file; both went
  red on untouched code once their subjects grew, each blaming the subject
  rather than its own reach.
- **E20** — a callback that draws makes a constant-roll-count function
  variable. The rule binds the function's TOTAL consumption, not its own
  visible draws. Also: sweep the DATA SHAPE, not just the seed, when measuring
  a draw count — holding the shape fixed is precisely what hides this.
- **E21** — a verifier pinned to the project's own name cannot fail after a
  fork. Every check of the form "for each X found, assert P" is vacuously
  satisfied by an empty X, so the tool printed its success line over a graph it
  had verified nothing in, on every run.
- **E22** — two projects on one GitHub Pages account share ONE localStorage.
  The project name is a path; storage is scoped to the origin. With a schema
  guard in place the collision presents as "no save" to a player who had one.
- **E23** — a known-red test under `set -e` silently deletes the rest of the
  suite. One accepted difficulty assertion had been switching off eleven
  Playwright suites for as long as it had been red, invisibly: a suite that
  stops early looks exactly like a suite that ran.
- **E24** — one WebGL context per mount, and the browser discards the OLDEST.
  Survivable at three mounts a session; not survivable once "walk another day"
  sat one press from the verdict. The symptom is an earlier canvas going black
  with nothing thrown.
- **E25** — a rAF timestamp is not "now", and under throttling it is behind it.
  A duration computed against it went NEGATIVE every frame and the effect never
  ended, with the loop running and nothing thrown.

## Tensions

No new ones opened. The inherited red — `tests/balance.mjs`, the `deceived`
bot at 17% against a 35% bar — is untouched and remains the owner's difficulty
decision, not a defect. It is now reported at the END of the suite rather than
in the middle of it, which is E23.

## Exploration

None this session; every finding above came out of building rather than out of
a sandbox.

## Graduation candidates

- **E19 + E23 + E21 together** are one family: *a guard that quietly stops
  guarding*. A character window that narrows as its subject grows, a fail-fast
  runner that deletes everything below an accepted failure, and a matcher
  pinned to a name that changes. All three are green-looking, all three are
  silent, and all three were found by accident. That family is worth a kernel
  of its own — the shared shape is **a check whose SCOPE can shrink to nothing
  without its RESULT changing**.
- **E18 + E22** are also one shape: *an identifier that is assumed to isolate
  and does not*. A seed that is assumed to reconstruct, a path that is assumed
  to scope storage.
