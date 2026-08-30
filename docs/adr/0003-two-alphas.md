# ADR 0003 — two alphas were built at once, and what happened to the other one

Date: 2026-08-30
Status: accepted

## Context

THE WOODS alpha was built twice, in parallel, by two sessions that could not
see each other's work. Both started from `docs/IDEAS.md` and the handoff note,
and both arrived at the same shape independently: a scripted day at the camp, a
swap in the night with nothing announced, and a morning spent asking, with the
false account derived from the real record rather than authored.

That convergence is worth recording on its own, because it is evidence the
design note was clear enough to be built from twice.

They also converged on the same two corrections, found independently:

- **Asking has to cost something.** Free questions turn the morning into a diff
  — open all five accounts, four are byte-identical, the odd one out falls off
  the page and nobody's memory was ever involved. The other line measured this
  and wrote it up (`docs/blueprint-0.13-what-asking-costs.md`); this line
  shipped `ASKS_ALLOWED = 3` against a party of five and asserted the
  inequality rather than tuning it.
- **A tell axis's share of runs falls out of how many candidates that axis
  happens to offer**, which means nobody chose the weights. Both answered it by
  choosing the KIND first and the instance second.

And both found the same trap: a perturbation that renders identically to the
truth is a fake nobody can catch, it errors nowhere, and it reads to a player
as the investigation being broken.

## Decision

**The line with the wiring is the trunk.**

The deciding difference was not design quality. It was that one of the two was
reachable by a player and the other was not: the other line's day ran headless
and well-tested on the real camp map, but `main.js` and `index.html` had no
button, no prompt, no account panel and no accusation — there was no way to
start it, and no way to ask anybody anything. It also sat on `mirage-0.12.0`
bones, missing the camp scenery, the tutorial's win-condition fix, the analog
stick's cross-axis leak and the lens.

So the merge keeps this line's `src/woods.js`, `src/chronicle.js` and
`src/names.js`, and drops `src/day.js` and the earlier chronicle with it. The
other line's commits stay in the history, and its blueprint stays in `docs/`
with a header noting which of its conclusions shipped.

## What was taken from the other line anyway

- **The blueprint's measurements**, which are real data and were not re-derived.
- **Its reading of the failure mode** ("the alpha answers the wrong question"),
  which is a sharper statement of why the question budget exists than anything
  written on this side.
- **The `__seven` global rename**, which was theirs and is right — the fork
  should not answer to the parent's name. Completed across the whole tree here;
  a half-rename is worse than either state.

## Consequences

- One of the two alphas is gone as code. That is the cost of having built the
  same thing twice, and it is a process failure rather than a technical one:
  two sessions were pointed at one design note with no shared branch.
- The storage keys moved from `mirage:*` to `seven:*` as part of this. GitHub
  Pages serves every project of one account from a SINGLE origin, so `/mirage/`
  and `/seven/` share one localStorage: under the inherited names the two games
  read and overwrote each other's save slot, each finding the other's payload
  at a schema version it refuses and reporting "no save" to a player who had
  one. Neither line had noticed.
- Anyone picking this up should read `docs/blueprint-0.13-what-asking-costs.md`
  before touching the morning. It is the best statement in the repo of what the
  alpha is for.
