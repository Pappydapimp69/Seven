# SEVEN

A fork of MIRAGE. The design of record is `docs/IDEAS.md` — the entry titled
**"THE WOODS: full design note"**. Read it before doing anything non-trivial.
`docs/HANDOFF-the-woods.md` says which slice to build first and why.

## Where it is now (2026-08-30)

**The alpha is built, deployed and playable: https://pappydapimp69.github.io/Seven/**
One scripted day, a swap in the night, three questions in the morning, and a
name. `docs/PLAYTEST-the-woods.md` says what to watch for; it is the first
thing to read before touching anything.

What shipped, and where it lives:

- `src/names.js` — the roster, composed per run rather than picked.
- `src/chronicle.js` — the record of the day, the account derived from it, and
  the ONE fact bent for a fake. This is the file the whole design rests on.
- `src/woods.js` — the day, the night, the morning, the verdict.
- `src/main.js` / `index.html` / `css/style.css` — the wiring and the panels.
- `tests/names.mjs`, `tests/chronicle.mjs`, `tests/woods.mjs`, and
  `tests/woods-play.mjs` (a whole day in a real browser, to a verdict).
- ADRs `0002-the-woods-alpha.md` (why this slice) and `0003-two-alphas.md`
  (it was built twice, in parallel — what happened to the other one).

Nothing beyond the alpha is built, on purpose: no map, no travel, no crafting,
no day/night, no pylons, no recruitment, no skills, no meta-progression, no
ending. All of it is in the design note and none of it matters if the asking
is not fun. **Do not start it before the playtest answers that.**

The one instrument that will answer it: every finished day writes a line to
`seven:days` and the title screen shows days walked, caught, and how many of
the last five. The interesting shape is a hit rate that climbs and then stops.

## What this repo is, and is not

MIRAGE is the BONES: the sim/percept split, the party, the verbs, the save
discipline, the test harness. All of it works and ships. SEVEN adds organs.

The owner's framing: *"If you break the bones, the whole system flops over and
dies."* Build in layers. Do not rewrite what already works to make something new
fit — if the two genuinely conflict, say so rather than quietly bending the old
thing.

This is a FORK, not a branch. Fixes here do not reach MIRAGE and vice versa,
and the two are not expected to merge back.

## Invariants inherited from MIRAGE — these still hold

These are not style preferences. Each one exists because it was violated once
and cost real time.

- **`state.js` is the only source of sim truth.** `percept.js` is the only
  module allowed to lie; it reads sim and never mutates it. Renderers and HUD
  draw from percept, never from sim.
- **The hidden meter never reaches the screen** — not as a number, not as a band
  name ("steady", "fraying", "brittle"), not as an error message. A refused
  action must look identical to a successful one at the moment of the press. The
  difference shows up later, in the world.
- **Constant roll count.** Every decision consumes a FIXED number of `sim.rng`
  draws regardless of which branch it takes, including "no need to roll, it's
  forced". Draw unconditionally, use conditionally. Breaking this silently forks
  resumed runs and surfaces minutes later as a different world.
- **Anything that gates an rng draw is save state**, however cosmetic it looks.
  A missing timer becomes `undefined`, arithmetic on it becomes NaN, comparisons
  against NaN are false, and a resumed run quietly takes a different branch.
- **One seed per run.** The world is a pure function of its seed; saves store a
  seed and regenerate; the rng restores from a raw state word. Never seed from
  device state (time, battery, resolution) — considered and rejected. A run must
  stay saveable, resumable and reproducible.
- **Negative-control every guard.** Revert the defect a test exists for, watch
  it fail, restore. A test written from the same mental model as its feature
  passes on both correct and broken code — that failure mode has appeared
  repeatedly in this codebase.

## SEVEN's own rule

**Tells are DERIVED, never authored.** The investigation works by asking someone
about a day you both lived through; a real account comes from the actual event
log, a false one from the same log with one fact perturbed. If the wrong details
ever come from a hand-written list, a player memorises them and the game is dead
by run ten.
<!-- brain:pointer v2 — managed by `brain link`/`sync`; edits here are overwritten -->
## Cognitive system: Brain (linked via `brain` CLI)
This project is linked to the Brain cognitive system. Do not read the node
repos directly — use the CLI.

**How to invoke it (try in order, use the first that runs):**
1. `brain <cmd>`
2. if `brain` is not found: `python "$HOME/.brain/Brain/bin/brain" <cmd>`
   (Windows PowerShell: `python "$env:USERPROFILE\.brain\Brain\bin\brain" <cmd>`)

When the user asks anything like "query save" / "ask brain X" / "mine this",
run the matching `brain` command yourself — do not make the user type paths.
Before non-trivial work: `brain query <terms>`. To capture lessons, write a
proposal file + `brain sync` (or `brain mine` for a work-list). `brain sync`
reconciles with main. Keep session output minimal.

### Using Brain well (read this before deciding it's empty)
- **Query with 1-2 KEYWORDS, not sentences.** `brain query reachability`, not
  `brain query "ai cannot reach the exit on a walled map"`. The matcher is
  keyword-based; long phrases return 0. **A 0-result query almost always means
  rephrase, not "empty system"** — try broader / single terms first, and read
  the `local:` bucket, not just the shared counts.
- **Re-query at each NEW sub-problem, not only at session start.** Every
  non-trivial bug or decision is its own retrieval trigger.
- **Capture non-bugs too, not only bugs:** reusable pattern -> `ideas`;
  unresolved fork -> `tension`; experiment/synthesis -> `exploration`; a
  committed decision -> an ADR in the build (and if it generalizes, ALSO an
  `ideas` kernel). See `orchestration.md`'s write-back table.
- **At each milestone, produce a Cognitive Update UNPROMPTED** (New Ideas,
  Memory, Tensions, Exploration, Graduation Candidates) — the standing rule in
  `orchestration.md`.
- **Surface any open (red/yellow) tension that touches your work to the user**
  before committing to that fork.
- **Never hand-write a proposal format.** `brain mine` prints the current
  schema verbatim from the memory repo — follow it exactly. A format you
  invent parses as an EMPTY entry and is held on every field at once.
<!-- /brain:pointer -->

## This project's history
SEVEN is a fork of `Pappydapimp69/mirage` at `mirage-0.12.0`, carrying its full
history — `git log` before 2ddae20 is MIRAGE's, and the commit messages there
are the best record of why things are shaped the way they are.

MIRAGE itself was built inside `Pappydapimp69/Opticon` and extracted once it
stood on its own (`docs/adr/0001-extracted-from-opticon.md`). `lib/three.module.js`
is a real vendored copy, not a shim.

Relevant Brain entries, all first-hand from building the bones: `mirage#E11`
(cross-frame state on an object the caller rebuilds), `#E13` (a window predicate
degenerates when the distribution it was calibrated against moves), `#E14` (a
sticky selector inverts when its eligibility widens — fix the ACQUIRE ordering,
not just preemption), `#E15` (chain cohesion is not proximity), `#E16` (a guard
that never failed is unmeasured). `brain query deduction` and `accusation` both
return zero — that ground is uncovered, so there is no prior art to miss.

## Two things worth knowing before you touch the save

- **The camp is not a seed.** Its map is authored, so `deserializeRun` routes
  the sentinel seed to `buildCamp()`. Before that existed, a saved camp run
  resumed as a procedurally generated BASIN with the camp positions pasted on,
  and nothing errored anywhere.
- **`/mirage/` and `/seven/` share one localStorage.** GitHub Pages serves every
  project of one account from ONE origin; the project name is a path. SEVEN's
  keys are namespaced (`seven:run`, `seven:settings`, `seven:days`) for that
  reason. Do not un-namespace them.

## Inherited open item
`tests/balance.mjs` is RED: the `deceived` bot policy wins 17% of standard seeds
against a 35% assertion, `deceived/bleak` 0%. This is a difficulty decision the
owner has not made, not a bug — the structural bugs behind it were found and
fixed. Do not "fix" it by tuning constants they chose.
