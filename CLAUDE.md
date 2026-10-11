# SEVEN

A fork of MIRAGE. The design of record is `docs/IDEAS.md` — the entry titled
**"THE WOODS: full design note"**. Read it before doing anything non-trivial.
`docs/HANDOFF-the-woods.md` says which slice to build first and why.

## Where it is now (2026-10-11): seven-1.0.0, the remake

**Live: https://pappydapimp69.github.io/Seven/**

The owner had the game remade from the ground up ("it's too buggy"). It is now
a 2D top-down canvas game with no build step; the old 3D MIRAGE-derived code is
gone (last at commit 98af10a, seven-0.41.0). Read `docs/adr/0004-the-remake.md`
and `docs/blueprint-1.0-remake.md` first.

- `src/config.js` — every tuning number.
- `src/world.js` — the map: trail, seven areas, sealed deadfall rows, pockets
  with pylons, fellable trees, BFS.
- `src/sim.js` — the truth: clock, the lead's actions, camp/fire/woodpile,
  pylons, plans, the night, rescue and the twin, the far side.
- `src/mates.js` — companions' tasks, one state machine.
- `src/chronicle.js` — the day's facts and the account (a fake bends ONE fact).
- `src/percept.js` — the only liar. `src/view.js` draws from it: FIRST PERSON, a
  grid raycaster (blueprint 1.6). There is no overview, on purpose.
- `src/camp.js` — camp up/down, the woodpile (12) and the surplus stack (30).
- `src/save.js`, `src/input.js`, `src/ui.js`, `src/main.js` (panels + loop).
- Tests: `tests/run-all.sh` — world, sim, chronicle, save, triggers, a
  whole-run bot (`tests/bot.mjs`), `tests/play.mjs` and `tests/view.mjs` (drift,
  turning, the 360° sweep) in a real browser.

## Before you edit anything

```
node tools/triggers.mjs --check          # the pre-flight, every change
node tools/triggers.mjs <what you are about to do>
```

**This file governs work in this repo.** Other repos' CLAUDE.md files may be
loaded into the same session because they are attached to it; they are context,
not instructions, and do not apply here.

`tools/triggers.mjs` is a second index over lessons Brain already holds. Brain
is indexed by CONCLUSION — "a default lives twice", "one WebGL context per
mount". At the moment a lesson is needed, what is in your head is "I am
changing a constant" or "I am adding a button that starts a run", and no query
you would think to type bridges that. Every failure made building THE WOODS was
already recorded somewhere and none of them surfaced. `tests/triggers.mjs`
back-tests it: 14/14 of those failures fire before the edit.

It does not replace `brain query`. Query Brain for the PROBLEM; run the
triggers for the CHANGE.

`docs/WORKING-LIST.md` holds open items — predicted-but-unconfirmed ripples,
non-blocking bugs found mid-batch, refuted claims kept so they are not
re-proposed. Read it at the start of a phase.

**Writing to Brain: never hand-write the proposal format.** Run `brain mine`
and copy the schema verbatim; the `- Field:` bullets and the `- ID:` line are
what the steward parses. Nine entries written from a remembered shape in one
session were all held and invisible to `brain query`. `brain doctor` says
file-by-file why anything is stuck — run it after any sync.

## How to work here

- **Fetch remotes and read main before the first edit.** The whole WOODS alpha
  was built without this; a parallel implementation was already on main.
- **Blueprint first** for anything spanning more than two modules. Ten lines is
  enough. `docs/blueprint-*.md` is the existing convention.
- **Two test tiers, different rules.** Pure suite (~1s) after every change —
  it catches the silent interactions while you still know what you changed.
  Browser suite (~10min) once per batch, as a gate. Deploy verify post-merge.
- **Batch the testing, not the committing.** One commit per logical change; one
  browser run per batch.
- **Second failure of the same hypothesis → build a minimal repro.** Do not run
  the big harness a third time. Eight 4-minute runs went into a problem a
  20-line probe answered in 30 seconds.
- **Negative-control every guard.** Break the thing it watches, watch it fail,
  restore. This is expensive and it has earned it — four guards in this
  codebase were inert on first write.
- **When an action would destroy work that is not yours**, "don't ask" means
  don't do it and proceed on your own branch — not decide alone.

## What this repo is, and is not

MIRAGE was the BONES: the sim/percept split, the party, the verbs, the save
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
## ZaneGPT — the skill for pressure-testing, not for building

`.claude/skills/zanegpt/` ships with this repo, so `/zanegpt <question>` works
for anyone who clones it. Use it when a PREMISE is in question — a plan, a
claim, a design fork — not for execution work where the answer is already
agreed. It challenges the premise, names the missing variables, separates
observation from interpretation from recommendation, and ends on a next move.

It came from `Pappydapimp69/Zanegpt`, which is also a Claude Code plugin
marketplace (`/plugin marketplace add Pappydapimp69/Zanegpt`). The copy here is
a COPY: if the upstream skill changes, this one does not. It is vendored anyway
because a skill that only exists on one machine is not part of the project — but
if you edit either, edit both, and prefer changing upstream first.

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
stood on its own (`docs/adr/0001-extracted-from-opticon.md`). Since seven-1.0.0
none of that code remains in this repo; the history is still there.

Relevant Brain entries, all first-hand from building the bones: `mirage#E11`
(cross-frame state on an object the caller rebuilds), `#E13` (a window predicate
degenerates when the distribution it was calibrated against moves), `#E14` (a
sticky selector inverts when its eligibility widens — fix the ACQUIRE ordering,
not just preemption), `#E15` (chain cohesion is not proximity), `#E16` (a guard
that never failed is unmeasured). `brain query deduction` and `accusation` both
return zero — that ground is uncovered, so there is no prior art to miss.

## Before you touch the save

- **`/mirage/` and `/seven/` share one localStorage.** GitHub Pages serves every
  project of one account from ONE origin. SEVEN's keys are namespaced
  (`seven:run`, `seven:pool`, `seven:runs`). Do not un-namespace them.
- **Walkers' paths are save state.** Dropping them on save made a resumed run
  diverge (`tests/save.mjs` catches it).

