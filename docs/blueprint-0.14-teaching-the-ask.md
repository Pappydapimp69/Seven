# Blueprint — 0.14, teaching the ask: a walk-in for the investigation

## The problem

The alpha drops a player cold. It shows a day, says "sleep", and then shows a
roster with buttons on it. Nothing has told them that one of these people is not
the person who went to bed, that the account they are about to read is derived
from the same day they just read, or that the morning is a budget. A player who
has not had this conversation with the designer is being asked to notice
something nobody told them to look for.

There IS a tutorial in this repo. It works — seven objectives, all completing in
one browser session, 24 logic tests and a full play-through green. It teaches
MIRAGE's verbs: move, gather, chop, log, call, pylon, dose. **None of them is the
verb this game is about.** It is the right tutorial for the bones and says
nothing about the organ.

## What this is not

Not "wire the investigation into the 3D game's tutorial." That means moving the
investigation into the main game, and the 0.13 preflight named the boundary it
would cross: `woods.js` reads `sim` directly, and the repo's invariant is that
renderers read `percept`. That decision belongs to the move, made deliberately,
not smuggled in behind a teaching pass.

So: a walk-in on the woods page, and the 3D tutorial left alone.

## Decisions taken (owner may veto)

- **A first day that is taught, not a tutorial mode.** Same page, same code
  path, same verbs. The teaching is a sequence of lines that appear beside what
  the player is already doing, and it ends. Nothing to exit, no second
  implementation of asking.
- **The taught day is a REAL day at a chosen seed** — not a bespoke script. Of
  the first 60 seeds, 27 give a name tell, 23 a weather tell, 10 an order tell,
  so any teaching shape can be had from a genuine day. Authoring one would put a
  hand-written account in the codebase, which is the one thing this fork forbids
  even once.
- **Teach on an order tell.** It is the loudest — 43 characters differ against
  weather's 7.6 — so the first fake a player ever meets is one they will
  actually catch. Seeds 4, 8, 11 and 16 all qualify. The subtle ones are what
  the game is; the first one is what makes them believe there is something to
  find.
- **Four beats, and the fourth is the point.** (1) This is your day, you were
  there. (2) Somebody at this fire is not who they were last night, and nobody
  will tell you who. (3) Asking costs an hour of five. (4) There is something
  else those hours can buy.
- **Beat 4 must be shown, not stated.** A first-time player who spends all five
  hours asking never learns the search exists. The walk-in ends before the
  budget does, with the search still affordable.
- **It is skippable and it is repeatable**, from a link on the page, because the
  people most likely to replay it are the ones who came back a week later.

## What must remain UNCHANGED

- `sim.chronicle` is the only record; `chronicle.js` is the only thing that
  renders an account. A teaching pass that paraphrases a line to make it clearer
  is a second renderer, and the player would then be comparing two dialects.
- Tells stay DERIVED. A taught day selects a SEED, never a tell.
- Nothing marks the difference — including here. The walk-in may say "one of
  these accounts disagrees with what you remember". It may not say which.
- The swap announces nothing. The teaching may explain that a swap happened;
  it may not indicate who.
- `?seed=N` still replays exactly, and the taught seed is just another N.
- The 3D game and its tutorial are untouched.

## Preflight — what to check before writing code

Done, against `926e802`.

**The existing tutorial's machinery does not transfer, and reaching for it would
be the mistake.** `observe()` is an event-stream observer, and its own docstring
records why it takes main.js's merged frame stream rather than `sim.events`:
`tick()` wipes that on its first line, so every verb it teaches would be
invisible. It is coupled to a frame loop the woods page does not have.

**The alpha has no event stream at all,** and that is a feature here. Brain has
four separate first-hand entries on this exact hazard — a tutorial step pinned
to an entity can be starved by a resolver that outranks its verb
(`sandbox-resolver-starves-tutorial#E1`), by a capture layer that drops the
event before the resolver sees it (`sandbox-capture-layer-starves-tutorial#E1`),
by a safety guard placed at a shared entry point (`#E3`), and in general by any
layer in a multi-layer pipeline, with one starvation candidate PER LAYER
(`sandbox-resolver-starves-tutorial#E2`). Every one of those needs a pipeline.
The woods page has click handlers calling `spendAsk` and `searchForMissing`
directly.

So the rule for this build is: **the walk-in advances off the same function
calls the player is already making, and no event bus is invented to observe.**
Building one to reuse `observe()` would import four documented failure modes to
solve a problem this page does not have.

**The "seen it once" flag is a known trap, already sprung once in this
codebase.** `dog#E64`: a shown-once bit kept outside the save payload became a
cross-slot leak, found by a human in minutes after 130+ passing tests said
nothing. The existing tutorial's progress lives in `loadSettings().tutorial`,
under the `seven:settings` key — outside the run save by design. The walk-in
must reuse that one object or hold its state in the page. It must NOT add a
second raw `localStorage` key; the alpha currently writes none, and that is
worth keeping true.

**And the object it is held in is rebuilt every read.** `observe()` carries a
comment about exactly this: `progress` comes back from `loadSettings()`, which
re-parses localStorage and rebuilds the object, so anything written to it
mid-stage is discarded before the next event. The one multi-target stage in the
existing tutorial could never complete in real play while a unit test that
reused one object saw it pass. Any per-step tally in the walk-in needs a home
the page owns.

**Who owns what, at `926e802`:**

| state | written by | read by |
|---|---|---|
| `sim.chronicle` | `createRun`, `day.js record()`, `save.js` | `accountOf`, `askAbout` |
| `sim.morning` | `spendAsk`, `searchForMissing`, `save.js` | `canAsk`, `canSearch`, `woods.js` |
| `sim.searchRoll` | `swapOvernight` only | `searchForMissing` |
| `c.swapped` | `swapOvernight`, `save.js` | `accountOf`, `accuse` |

One writer each. A walk-in that sets any of them to stage a lesson becomes a
second writer, and the next bug in this area costs a day to find.

**Regression risks.**

1. The walk-in spends hours. If it demonstrates an ask, that hour is really
   gone, and a taught run has four hours where an untaught one has five. Decide
   whether the lesson is free or paid — and if free, that is a fifth writer of
   `sim.morning` unless it is a separate run.
2. A skip control that skips to "morning" without running the day leaves
   `sim.chronicle` empty and every account seven lines shorter. Skip must skip
   the TEACHING, never the day.
3. Pinning the taught seed hard-codes a day into the build. When the tell mix is
   re-weighted, seed 4 may stop being an order tell, and the walk-in silently
   starts teaching on a single changed word. Assert the taught seed's tell type
   in a test, so the re-weighting breaks the build instead of the lesson.
4. `?seed=N` and the walk-in can disagree — a player deep-linking a seed should
   not be dragged into the tutorial.

**Verification seams.** `tests/chronicle.test.mjs` for anything with a seed in
it; `tests/woods-play.mjs` for the page — it already asserts the two rules a
unit test cannot see, and both apply harder here.

## Verification plan

1. **The taught seed still teaches what it was chosen to teach.** Assert its
   tell type by name. This is the test that catches a re-weighting.
2. **A taught run and an untaught run of the same seed are the same run.**
   Identical chronicle, identical accounts, and `rng.snapshot()` equal at the
   end of the morning.
3. **The walk-in ends with the search still affordable.** Assert hours remaining
   ≥ `SEARCH_COST` when the last beat clears.
4. **Skip leaves a playable day**, not an empty one: seven lines in the record,
   five askable people.
5. **Nothing is marked.** Extend the existing markup assertion over the new
   teaching elements — no class, no emphasis on any account line.
6. **Second visit.** Complete it, reload, and the walk-in does not reappear;
   then replay it from the link and it does.
7. **No new localStorage key.** Assert the page writes only the key it already
   uses, if any.

## Still requires a human

- Whether a taught first day makes the second one better or spoils it.
- Whether beat 2 — "somebody here is not who they were" — should be said at all,
  or whether the game is better when the player finds that out by being wrong
  once.
- Which seed. Four qualify; they are different days, and one of them will read
  better out loud than the others.
