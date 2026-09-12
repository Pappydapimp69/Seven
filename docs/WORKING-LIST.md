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

- [ ] **Obstacles cannot earn their keep on the survey basin, and three
      experiments say it is structural rather than tuning.** A deadfall is only
      an obstacle if walking round it costs something. Measured, with placement
      gated on a >=6-cell detour to a feature: random placement 0.2 deadfalls
      per world, a carved 3-wide path with dense sides 0.03, the same path with
      the rock band pushed from 4 cells deep to 10 gave 0.00 and barely moved
      the open-cell count (1517 -> 1397).
      The cause: the basin is 78% walkable, and the generator's contract is that
      every feature is REACHABLE — it flood-fills and carves corridors until
      that holds. A path only matters when most ground is expensive to cross,
      which is the opposite guarantee. Thickening ground near the path just
      hands the repair pass more corridors to carve, and it carves them back
      through the exact routes the path was meant to make costly.
      So: not a placement bug and not a constant to tune. Obstacles, paths and
      regions all want the traverse map, and this is now the third separate
      finding pointing there. The path-carving experiment was reverted rather
      than shipped — it re-rolls every basin (another SAVE_VERSION bump) for a
      feature that does not do its job.

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
