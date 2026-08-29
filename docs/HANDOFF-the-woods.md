# Session handoff — SEVEN, the investigation alpha

`CLAUDE.md` loads automatically and now carries the invariants, the fork's
relationship to MIRAGE, the Brain entries and the inherited red test. This file
holds only what that cannot: what to build first, and how the owner works.

Read `docs/IDEAS.md` — **"THE WOODS: full design note"** — before starting.

## Build THIS first, and only this

The full design is months of work. Do not start it.

The alpha tests the single unproven claim: **can a player catch a fake by
asking about a day they both lived through, and does it feel like deduction
rather than a coin flip?** Everything else in the design is known-good
machinery from other games. If the investigation is not fun, none of it matters.

- One short scripted day. Fixed camp, a handful of events the player is present for.
- Overnight, one party member is swapped — SAME name, SAME skills, no announcement.
- Next morning the player can ask anyone about yesterday.
- Real accounts derive from the real event log. The fake's derives from the same
  log with ONE FACT PERTURBED (wrong order, wrong weather, a name slightly off).
- The player names who they think it is. The game says whether they were right.

No map, crafting, day/night, pylons, recruitment, skills or meta-progression.

## What to reuse rather than rebuild

- `emit(sim, kind, text, opts)` in `state.js` — the event stream is already the
  raw material for the accounts.
- `checkIn(sim, id)` — the ask-someone verb exists.
- The roster HUD, the save system, the Playwright harness, `tests/run-all.sh`,
  `tools/stamp-version.mjs` + `tools/verify-deploy.mjs` for deploys.

## How the owner works

- Terse replies. Direct answers. No preamble, no unsolicited work.
- "Stance brief" means: live version, what shipped, what is open, what no test
  can tell them.
- They think out loud across several messages and will say when an idea is
  finished. Do not treat a fragment as a decision.
- They make the design calls. Surface tradeoffs with data; never tune a number
  they chose to make a test pass.
- Develop on the designated branch; never push elsewhere without permission.

## The prior session

Addressable as `user-8d` via SendMessage while it is alive. It holds the design
conversation but cannot transfer context — ask it specific questions, do not
ask it to hand over state.
