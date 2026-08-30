# ADR 0002 — THE WOODS ships as one day, and the tells are derived

Date: 2026-08-30
Status: accepted

## Context

`docs/IDEAS.md` holds a full design for THE WOODS: one persistent map,
hallucination as geography, days instead of a clock, pylons as a rotting supply
line, recruitment and skill points, a keystone morning where the roster is
empty, and an ending that counts one pylon more than you have real people. It
is months of work and almost all of it is machinery that other games have
already shown works.

Exactly one part of it is unproven, and everything else in the design is
downstream of it:

> Can a player catch a fake by asking about a day they both lived through, and
> does it feel like deduction rather than a coin flip?

If the answer is no, none of the rest is worth building.

## Decision

**Build the smallest thing that answers that question, and nothing else.**

- One scripted day at the camp: seven beats, each one person doing one job in
  one place with the player standing there.
- One night. One member replaced — same name, same skills, no announcement, no
  sound, no flag on the roster.
- One morning, three questions, five people. Then you name somebody and it
  tells you whether you were right.

Not built, deliberately: the map, crafting, day/night, pylons, recruitment,
skills, meta-progression, the keystone morning, the ending.

**The wrong detail is DERIVED from the record, never authored.** A false account
is the real chronicle with one fact bent, and the bent value is drawn from
values the day itself produced — a place really visited, a person really there,
the weather it really was not, a name one edit from a real one. There is no
list of tells anywhere in the codebase, because a list is memorised by run ten
and the game is dead.

**Phrasing is shared.** A real member and a fake are rendered by the same
function from the same templates. If the two were phrased differently the
player would be reading style instead of substance and the perturbation would
be decoration. `tests/chronicle.mjs` reads the source and fails if a second
phrasing table appears or if `phrase()` ever branches on who is speaking.

**Three questions for five people.** Given one question each, the player lays
five accounts side by side and reads off the odd one out, having remembered
nothing. The budget is what makes it a memory game. `ASKS_ALLOWED < PARTY_SIZE`
is asserted rather than left to taste.

## Consequences

- The single most important guard in the repo is "a fake's account always reads
  differently from the truth", swept over 600 seeds. A perturbation that renders
  identically is worse than none: the player spends a third of their morning and
  gets nothing, and no layer errors.
- The day is drawn at DAWN, off a generator derived from the run seed, not at
  dusk off `sim.rng`. Drawn at dusk, what happens in the night would depend on
  how far the player wandered during the day, which is neither reproducible nor
  saveable.
- Names are composed rather than picked, so there is nothing to recognise; they
  are capped at eight characters because a longer one is held as a shape rather
  than as letters, and shapes cannot be compared a letter at a time.
- A wrong-object claim is restricted to objects of the same class. "Went down to
  the creek for tent" reads as a bug, and a tell that reads as a bug teaches the
  player to distrust the renderer instead of the speaker.

## What this forced open on the way

The camp was never routed through the save system: a run saved on it (seed
`-1`, the authored-map sentinel) resumed by regenerating a BASIN from that seed
and pasting the camp positions onto it. No error anywhere, and no save test
caught it because every one of them used a basin. THE WOODS has to resume, so
`deserializeRun` now routes the sentinel to `buildCamp()`. The same bug is live
in MIRAGE's tutorial.
