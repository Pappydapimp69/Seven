# TODO — the ordered build queue

**This is not `WORKING-LIST.md`.** That file holds OBSERVATIONS: ripples
predicted but unconfirmed, bugs found in passing, claims refuted and kept so
they are not re-proposed. This file holds INTENTIONS, in the order they should
be done, and every item here names the thing that decides whether it is next.

Rules: an item leaves by being built, or by being moved to `WORKING-LIST.md`
with a reason, or by being deleted with one. Nothing sits here unexamined for
two phases.

Last reviewed: 2026-09-25, at seven-0.25.0.

---

## Where the project actually is

- **Live:** https://pappydapimp69.github.io/Seven/ — seven-0.25.0, verified
  across all 16 modules by `tools/verify-deploy.mjs`.
- **Branch:** `claude/brain-install-vohzag`. `main` is what deploys, on push.
- **Suite:** green, pure and browser tiers, except the known `deceived` row.
- **The one question the repo exists to answer is still unanswered.**
  `HANDOFF-the-woods.md`: can a player catch a fake by asking about a day they
  both lived through, and does it feel like deduction rather than a coin flip?
  No human is known to have played a full day since the alpha shipped
  2026-08-30. Releases 0.19-0.25 are all machinery the handoff deferred.

---

## 1. NEXT — make the ask readable (blueprint 0.26)

`docs/blueprint-0.26-the-ask-is-not-readable-yet.md` has the reasoning. The
short version: `chronicle.js` perturbs one of six kinds, and a false account is
only catchable if the player experienced the true value. Two kinds never reach
them.

- [ ] **Render the weather.** `woods.js` draws one of five (`clear`, `drizzle`,
      `fog`, `wind`, `cold`) and stores it on the chronicle. `render.js`
      mentions weather once, in a comment about camp fog; `hud.js` never does.
      A wrong-weather claim asks whether it was drizzling on a day where
      drizzle was never depicted — one sixth of the falsification surface is a
      coin flip. Bind the renderer to `woods.weather` directly, not to a copy
      (Brain: `draw-the-rule-from-the-live-value`).
- [ ] **Make beats leave the world changed.** The seven beats resolve as a
      subtitle and nothing else: no tent is pitched, no firewood stacks by the
      fire, the leaning birch never falls. `woods.js` argues a beat must be a
      HOLD because "a memory needs something to be a memory OF" — and then the
      thing being watched is a progress bar. One mesh each, placed on resolve,
      serialised in the shape `deadfallsCleared` already uses.
- [ ] **A readability guard per perturbation kind.** For each of the six, a
      test that the true value reached the player through something other than
      the account text. This is the guard whose absence let `place` ship as
      four identical cairns for the alpha's entire life. Negative-control each.

**Explicitly out of scope:** the traverse, regions, recruitment, skills,
pylons-as-route, meta-progression. Deferred by the handoff, still deferred.

## 2. THEN — a human plays a day

Nothing in this repo can answer the design question, and tension **T11** says
the automated tier never will. The instrument exists: every finished day writes
to `seven:days` and the title screen shows days walked, caught, and how many of
the last five. The interesting shape is a hit rate that climbs and then flattens.

**This gates everything after it.** If the ask is not fun, the traverse is
built on sand.

## 3. Owner decisions, not engineering

- [ ] **`deceived` bot at 0%** against a 35% bar in `tests/balance.mjs`. It was
      13% before day/night. This is a difficulty decision; the structural bugs
      behind it were found and fixed. Do not tune constants to make it pass.
      Related open fork **T29** — bluffing is a lever on PEOPLE and the sim
      keeps being asked to score it.
- [ ] **Density's default.** Opt-in since 0.22.0. It was made opt-in to protect
      a drift assertion that turned out to be a broken test, so the reason is
      gone and the default is now a choice. Turning it on re-rolls every basin
      (a SAVE_VERSION bump and a balance re-read).

## 4. Known defects, none player-facing today

- [ ] **Two dense seeds where a gone companion never leaves.** On open ground,
      holding one invented goal for a whole 70s episode, travelling under a
      unit. Not penned in, not pathless — stuck on a goal it never revises.
      Only reachable with `dense: true`, which is off, so no player meets it.
      `tests/hallucination.test.mjs` asserts 8 of 12 so it stays visible.
      Diagnose before touching the bar.
- [ ] **`tests/triggers.mjs` recall is optimistic.** It scores against phrasings
      derived from the triggers themselves, so 14/14 says less than it looks.
      `changing the fov default` fires nothing though the first trigger is about
      defaults and cites the FOV incident by name. Score against phrasings
      written without looking at the trigger, or loosen the matcher and
      re-measure precision.

## 5. Housekeeping

- [ ] **Brain intake queue** holds ~6 proposals, four on missing field labels,
      one on the injection deny-pattern. None are mine; a steward must promote
      them. Re-read `brain doctor` before acting — do not trust this count.
- [ ] **`brain sync` from a session with only `seven` attached** is still
      untested. Every clean sync so far ran with the knowledge repos in scope,
      which says nothing about a session without them.
