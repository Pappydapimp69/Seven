# Working list

Brain's local store holds **proposals** — things I already believe and want
promoted. It has nowhere for **open items**: a ripple I predicted but have not
confirmed, a non-blocking bug found mid-batch, a hypothesis to try next. Those
currently live only in an agent's head and evaporate between turns.

This is that file. It is scratch, it is committed (so it survives a container
restart — the `.brain/` local store is gitignored and does not), and it is
short on purpose.

**Rules.**

1. **Read it at the start of every phase.** That is the entire point. Not "when
   appropriate" — that instruction has already been tried in the Brain pointer
   block and it does not fire.
2. **An item leaves only three ways.** Confirmed → write a Brain proposal
   (`brain mine` for the schema — do NOT hand-write it) and delete. Denied →
   delete, and if the refutation was interesting, propose *that*; a refuted
   claim is worth as much as a confirmed one. Stale → dropped after two
   phases unexamined, deliberately, without ceremony.
3. **It never shadows Brain.** If an item starts explaining something general,
   it graduates or it goes. A local store that quietly becomes a second source
   of truth is worse than not having one — see the first trigger in
   `tools/triggers.mjs`.
4. **It does not sync.** Only what graduates travels.

---

## Open — predicted, unconfirmed

- [ ] `brain sync` from a session with only `seven` attached: query and local
      write will work (the cache is per-machine), but sync PUSHES to the
      knowledge repos on GitHub. Untested whether that needs them in the
      session's repo scope or just credentials.
      STILL OPEN after 2026-09-12, and worth saying why so nobody thinks it was
      answered: sync ran clean from this repo several times that day, but the
      knowledge repos were attached to that session the whole time. A pass that
      succeeds with them in scope says nothing about a session without them.

## Open — found in passing, not yet fixed

- [ ] **Touch has no CALL button.** Found writing keys.js (0.26.1): the touch
      bar is Survey, Check in, Dose, Next, Cycle item, Use item, Craft, Give.
      The tutorial's pylon beat needs a call, so a touch-only player cannot
      finish it. keys.js says so in the brief rather than naming a button that
      does not exist. Not fixed: adding a button is a layout change on a phone
      screen that was already tight (see the 720px media query).

- [x] **Obstacles cannot earn their keep on the survey basin — SETTLED by
      weakening the guarantee, not by tuning.** The three experiments were
      right that it was structural: the basin is 78% walkable because the
      generator's contract is that every feature is REACHABLE, and thickening
      ground near a path just hands the repair pass more corridors to carve
      back through the very routes the path was meant to make costly.
      The unlock was the entry's own unasked question — make reachability a
      WEAKER guarantee. `validate()` now runs a distance field and reports
      `worstDistance` / `overBudget` / `withinBudget` against a `DISTANCE_BUDGET`
      of 3x the grid's side, alongside an unchanged `ok`. That gave a density
      pass a keep/reject test it never had: 78% -> 63% walkable, and deadfalls
      clearing the 6-cell detour bar went from 0.2 per world to 3.40, median
      detour 10.
      Density ships OPT-IN (`generateWorld(seed, { dense: true })`) and the
      survey basin stays open — see the successor item below. Shipped in
      seven-0.22.0 (6d2bfb4); the default basin is byte-identical, so no
      SAVE_VERSION bump.

- [ ] **Two dense seeds where a gone companion never leaves, and nobody knows
      why.** What is LEFT of the density/drift worry after the rest of it turned
      out to be a broken test. The test teleported the companion to a computed
      point without checking the ground; inside rock there is no start cell for
      `findPath`, the path is emptied and never refilled, and the character
      records 0.0u of drift for the whole episode. That fires at the rate a
      random point lands in rock, so it rises with density and reads as a map
      regression. Corrected: 9 of 12 seeds clear the departure on dense ground
      against 11 on the open basin, bar 8. Density costs two seeds, not the
      collapse it appeared to cause — the tension filed on the old numbers is
      withdrawn.
      The residual is real: on two dense seeds the companion is on OPEN ground,
      holds ONE invented goal for the whole 70s episode, and travels under a
      unit. Not penned in, not pathless — stuck on a goal it never revises.
      `tests/hallucination.test.mjs` asserts 8 of 12 so this is visible rather
      than tuned away. Diagnose before touching the bar.

- [ ] **Density's default is now an open decision, not a settled one.** It was
      made opt-in to protect the drift assertion, and that reason is gone.
      Turning it on by default re-rolls every basin (a SAVE_VERSION bump and a
      balance re-read), which is a real cost, and the survey basin is a
      survey-and-return loop rather than the traverse density was built for.
      So: still opt-in, but now by choice rather than by measurement. The
      owner's call, not a test's.

- [ ] **`tests/triggers.mjs` measures recall against the phrasings the triggers
      were written for, so 14/14 is optimistic.** The matcher is whole-phrase
      substring in both directions (`q.includes(w) || w.includes(q)`), which
      means a trigger fires only on wording that contains one of its keys
      verbatim. Found while adding the 0.23.0 place-distinguishability trigger:
      the first draft used whole phrases and fired on NONE of the natural ways
      to describe the work that had just produced it. Shortening the keys fixed
      that one, but the back-test could not have caught it — it feeds each
      trigger a phrasing derived from the trigger.
      Spot check: `changing the fov default` fires nothing, though the very
      first trigger is about changing a default and cites the FOV incident by
      name. So the index's real recall on unseen wording is unmeasured and
      lower than the number printed.
      Worth doing: score recall against phrasings written WITHOUT looking at the
      trigger, or loosen the matcher to token overlap and re-measure precision.

- [ ] **The shared intake queue holds held proposals, and the count moves.**
      This said 22 for a long time; on 2026-09-12 the queue was empty in the
      morning and held 5 by the evening, all from other sessions. So the number
      is not the item — the pattern is. Two of the five are missing field
      labels the validator looks for (the hand-written-format failure); the rest
      pass every field name and are held on provenance, which needs a human.
      Until a steward promotes them the system has been told things it cannot
      answer with. Re-read `brain doctor` before acting on this; do not trust
      any count written here.
- [ ] `tests/balance.mjs` — the `deceived` bot, the one row difficulty may be
      read from, is at **0%** against a 35% bar as of seven-0.21.0. It was 13%
      before day/night landed. The owner's open difficulty decision, not a
      defect: do not tune it. What is new is that the decision is now forced
      rather than deferred — at 0% the row cannot get worse and can no longer be
      read. The five oracle rows are a separate problem: they finish inside
      daylight, never meet a night, and report identical numbers, so `@night`
      rows were added to give the harness something that discriminates.

## Denied — kept so it is not re-proposed

- **"The trigger index should be GENERATED from each Brain entry's own
  `Where/why it failed` field, which is where the precondition already lives."**
  Measured, refuted. Back-test over the 14 hand-written triggers, 12 of which
  have a source entry in the canon: how much of each trigger's `when:`
  vocabulary each field of its source entry could have produced —

  | field | mean recall | wins | lift vs shuffled |
  |---|---|---|---|
  | `What` (67 words) | 44.5% | 8/12 | +39.7 |
  | `Rule of thumb` (39 words) | 41.9% | 2/12 | +37.9 |
  | `Where/why it failed` (42 words) | 19.4% | **0/12** | +15.0 |

  Not a length artefact — `Rule of thumb` is the SHORTER field and still more
  than doubles it — and every field was negative-controlled against shuffled
  trigger/entry pairings. Hand-reading 24 failure fields sampled at a fixed
  stride agrees: 1 states a precondition, ~7 a general mechanism, ~16 a
  past-tense narrative of one incident. The field answers "what went wrong",
  which is only knowable after the fact.
  Two of the 14 triggers have no canon entry at all, so a generator can seed
  this table but never own it. Settled in `mirage` and carried here, which is
  why it sat open in this copy for a day after it was answered.

- **"The nightfall stall was a code bug."** It was environment saturation: a
  headless page under software GL with three mounted runs. Six attempts went
  into this before a 20-line isolated probe answered it in 30 seconds. The real
  lesson is the stopping rule, not the timer. (The rAF-timestamp finding was
  real and separate, and is filed.)
- **"Re-entering `activatePylon` evicts chatter from the 64-entry event
  buffer."** Refuted by sandbox at every re-entry length. The code comment
  claiming it was corrected.
