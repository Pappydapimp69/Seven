> **Superseded in part, and vindicated in part.** This blueprint was written on
> a parallel line of work whose implementation (`src/day.js`, an earlier
> `src/chronicle.js`) is not what shipped — see `docs/adr/0003-two-alphas.md`.
> Its central finding DID ship: asking is not free. The morning is three
> questions for five people, asserted structurally rather than tuned. Its second
> finding — that a tell axis's share falls out of how many candidates the axis
> happens to offer, so nobody chooses the weights — shipped too: the perturbation
> picker chooses the KIND first and the instance second, which flattens the
> distribution across all six axes. Kept for the measurements and the reasoning,
> which stand on their own.

# Blueprint — 0.13, what asking costs: making the alpha measure the thing it was built to measure

## The problem

The alpha works and answers the wrong question.

It was built to test one claim: *can a player catch a fake by asking about a day
they both lived through, and does it feel like deduction rather than a coin
flip?* What is on screen right now is a **diff**. Asking is free, so a player
opens all five accounts, four of them are byte-identical, one is not, and the
odd one out falls out of the page without anybody's memory being involved.

The player never uses the one piece of evidence the design says is theirs alone.
That is not a bug in the code — every test passes and each part does what it
says. It is the economy missing from around it.

## What the alpha already proves

Worth stating plainly, because it is not nothing and none of it needs redoing.

- A false account is derived, never authored. 500 seeds, 500 different days,
  and no hand-written tell anywhere in the source.
- A fake always says exactly one thing wrong, and never accidentally tells the
  truth. Reverting the guard that ensures this makes 49/200 fakes honest.
- Asking twice gets the same story. Asking anybody costs zero draws from the
  run's stream, so a resumed run cannot fork on who the player questioned.
- The morning after a swap is bit-identical to the morning before it.

## The measurement that changes this design

**Which tell the player gets, over 500 seeds:**

| tell    | share | lines changed | characters differing |
|---------|-------|---------------|----------------------|
| name    | 48%   | 1             | 33.3                 |
| weather | 42%   | 1             | 7.6                  |
| order   | 10%   | 2             | 43.0                 |

Three difficulties, unevenly weighted, nobody chose the weights. They fall out
of how many candidates each axis happens to offer a seven-entry day: 28 name
swaps, 28 weather swaps, 6 adjacent reorderings. A tenth of runs are close to
free; two fifths turn on a single changed word. Which line the difference lands
on is uniform across all seven, so at least there is no position bias.

**And the obvious fix, priced before building it.** Cap the asks, so memory has
to do the work. A perfect player asks *k* of five; if the fake is among them
they know, and if not, every account they heard was clean so the fake is one of
the ones they skipped:

| asks | hears the lie | else guesses 1 of | perfect-play win rate |
|------|---------------|-------------------|-----------------------|
| 0    | 0%            | 5                 | 20%                   |
| 1    | 20%           | 4                 | 40%                   |
| 2    | 40%           | 3                 | 60%                   |
| 3    | 60%           | 2                 | 80%                   |
| 4    | 80%           | 1                 | **100%**              |
| 5    | 100%          | —                 | 100%                  |

A cap does not make the deduction harder. It makes it *rarer*, and fills the gap
with a lottery. Four asks is still deterministic — hearing four clean accounts
names the fifth without asking. At three or fewer the player is right 80/60/40%
of the time for reasons that have nothing to do with what they noticed.

So the cap would have shipped as a difficulty knob and delivered a chance knob.
That is the exact failure `opticon#E19` records: confirm a knob moves the metric
its LABEL claims.

## The actual finding

**A cost is only a cost when something else wants the same resource.** The
design note is right that asking should cost daylight — but in the full game
daylight is also wanted by travel, by chopping, and by going out after the
person who wandered off. In the alpha there is nothing else to spend a morning
on, so "cost" can only mean "fewer", and fewer means chance.

The next phase is therefore not a budget. It is the smallest second use for the
same resource, taken from the design as written.

## Decisions taken (owner may veto)

- **One resource, two uses.** A morning is worth a fixed number of hours. Asking
  someone costs one. Going out to look for the person who wandered off in the
  night costs three, and can be done once.
- **Going out is the design's own verb**, not an invention: *"The missing one
  calls out at night... recovery costs the hours you least want to spend
  outside."* Bringing them back ends the run as a win without an accusation
  ever being made — you did not identify the fake, you retrieved the real one.
- **Both roads stay open to the end.** The player may spend the whole morning
  asking, or gamble the hours on the search. Neither is dominant: asking all
  five is a guaranteed identification, searching is a guaranteed *rescue* at the
  price of only being able to ask two.
- **The search can fail.** Weighted by things the player controlled, per the
  design. In this slice the only thing they control is when they went, so:
  going out first costs three hours and succeeds; going out after asking costs
  the same three and succeeds at a lower rate. Numbers are the owner's call —
  see "Still requires a human".
- **The tell mix gets levelled.** Weight the three axes so the player is not
  handed a 10% freebie or a 42% single-word hunt by accident. Equal thirds is
  the default proposal; the owner may prefer a deliberate spread.
- **The memory panel stays exact.** Fogging the player's own recall was
  considered and rejected here: the design is explicit that memory is the one
  thing that does not lie, and a fallible log turns a deduction into a
  guessing game with extra steps.

## The hard constraint, restated

The hidden state never reaches the screen. `swapped` and `tell` are the mirror
of `checkIn`'s `truth` — they exist for the debrief and the tests. No marker, no
colour, no ordering that puts the fake anywhere in particular. **Nothing on the
page may point at the difference.** A highlighted tell would pass every other
test in this repo and destroy the only thing being measured.

## Brain retrieval that changed this design

- **`T23` (resolved, evidence)** — an AI-vs-AI sim is a valid oracle for
  *reachability*, not for human-facing difficulty. Its fix was to move
  difficulty onto a mechanical lever the sim can see. The table above is exactly
  that kind of lever, and it says the cap is a chance knob. It says nothing
  about whether spotting a bent fact is satisfying — that stays unmeasurable
  here, and is why "Still requires a human" is not a formality.
- **`T29` (open, and it touches this work)** — a belief lever swung outcomes by
  0 points across 300 games a tier while structurally changing ~40% of games. A
  knob can change the game and not move the score. Whatever we add, measure the
  score, not the fact that something changed.
- **`opticon#E19`** — "the better agent is the more careful agent" is a
  hypothesis, not a premise; measure a difficulty knob against a whole-run score
  and confirm it moves the way its label claims.
- **`brain-builder#E5`** — assert SMOOTHNESS, not just monotonicity. The
  win-rate curve above is monotonic and still wrong, because it saturates at
  k=4 rather than at k=5.
- **`prologue#E19`** — adding draws re-phases the shared stream. Any new roll
  (the search outcome) must be drawn unconditionally.

## What must remain UNCHANGED

- `sim.chronicle` is the only record of the day, and `chronicle.js` the only
  thing that renders an account. Two renderers means the player hunts phrasing
  instead of facts.
- Tells stay DERIVED. No list, no table of lies, no per-day authoring.
- Accounts stay stable under re-asking, and stay free of `sim.rng` draws.
- `tellSeed` stays derived from the run seed, never drawn — five draws at
  `createRun` would re-phase every existing seed.
- The swap announces nothing.
- `?seed=N` replays a day exactly. No clock seeding, ever.
- The 3D game is untouched. The alpha is a second page beside the bones.

## Preflight — what to check before writing code

Done, on the code as it stands at `8793f18`.

**Who owns what.** One writer per piece of state, verified by grep:

| state | written by | read by |
|---|---|---|
| `sim.chronicle` | `createRun` (init), `day.js record()`, `save.js` restore | `chronicle.js accountOf`, `state.js askAbout` |
| `c.swapped` | `state.js swapOvernight`, `save.js` restore | `chronicle.js` (tell gate, `accuse`) |
| `c.tellSeed` | `createRun` only, derived via `hashSeed` | `chronicle.js accountOf` |

No competing override, no duplicate definition, no second code path that sets
any of the three. This is the property to preserve, not to rediscover later.

**One boundary is already bent, and the next phase is where it starts to
matter.** The repo's invariant is that renderers draw from `percept`, never from
`sim`. `woods.js` draws straight from `sim` — it reads `sim.companions` and
calls `askAbout(sim, id)` with no percept layer in between. That is defensible
today: the alpha is a standalone page with no perceptual lying in it, and
inserting a percept it does not need would be ceremony. It stops being
defensible the moment the investigation moves into the main HUD, where a
hallucinating lead must be able to misread an account. **Decide that at the move,
not during it** — and until then, keep every read in `woods.js` in one place so
there is a single seam to reroute.

**Regression risks.**

1. `SAVE_VERSION` is 4 and old saves are already dead. Hours-remaining and the
   search outcome are both save state — anything that gates a draw is — so this
   phase spends a **v5** and kills saves again. Do it in one bump, not two.
2. The search rolls. Draw it unconditionally, whether or not the player goes,
   or two runs that made different choices fork the stream.
3. Re-weighting the tell mix changes which tell every existing seed produces.
   Seed 3 will stop being the day in the screenshots. That is acceptable and
   should be said out loud rather than discovered.
4. `finish()` pairs the fake's statements against truth **by index**. That is
   correct for an order tell today because a swap keeps both lines in range; a
   future tell that inserts or drops a line would silently misreport the
   debrief.

**Verification seams that already exist and should be extended, not replaced.**

- `tests/chronicle.test.mjs` — unit, save/restore, and two negative controls.
- `tests/woods-play.mjs` — the whole loop in a real browser, including the two
  rules a unit test cannot see (roster unchanged, nothing marked up).
- `tests/stress.mjs` save/restore lockstep — the thing that will catch an
  unconditional-draw mistake, and did catch nothing this time because there was
  nothing to catch.

## Verification plan

Machine-checkable, and each one is a claim this blueprint makes:

1. **The hours are spent, exactly.** Asking five costs five; asking two and
   searching costs five; no path spends more than the morning has.
2. **The search draws the same number of times whether or not it is used.**
   Two runs, same seed, different choices, identical `rng.snapshot()` at the
   point the morning ends.
3. **The tell mix is level.** Sweep 500 seeds, assert each axis lands within a
   stated band, and assert the assertion fails when the weighting is removed.
4. **Both roads win.** A scripted perfect-asker and a scripted searcher both
   reach a win state on the same seed set — neither road is dead.
5. **The page still points at nothing.** Extend the markup assertions to the new
   controls; an hours counter must not gain a state that only appears when the
   fake is still unasked.
6. **Save at every phase boundary**, restore, and assert the account, the hours
   and the search outcome all come back identical.

## Still requires a human

Everything the phase is actually for.

- Whether spotting a bent fact is satisfying, or tedious.
- Whether a single wrong word (42% of runs today) reads as a tell or as a typo.
- Whether the choice between asking and searching is a real dilemma or an
  obvious answer once you have played three runs.
- What the search odds should be. The blueprint deliberately does not pick them.

No harness in this repo can answer any of these. `T23` says so in the ledger,
with evidence, and this is the second project to hit it.
