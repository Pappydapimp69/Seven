# TODO — the ordered build queue

**This is not `WORKING-LIST.md`.** That file holds OBSERVATIONS: ripples
predicted but unconfirmed, bugs found in passing, claims refuted and kept so
they are not re-proposed. This file holds INTENTIONS, in the order they should
be done, and every item here names the thing that decides whether it is next.

Rules: an item leaves by being built, or by being moved to `WORKING-LIST.md`
with a reason, or by being deleted with one. Nothing sits here unexamined for
two phases.

Last reviewed: 2026-09-25, at seven-0.26.0.

---

## Where the project actually is

- **Live:** https://pappydapimp69.github.io/Seven/ — seven-0.26.3, verified
  across all 17 modules by `tools/verify-deploy.mjs`.
- **Branch:** `claude/brain-install-vohzag`. `main` is what deploys, on push.
- **Suite:** green, pure and browser tiers, except the known `deceived` row.
- **The one question the repo exists to answer is still unanswered.**
  `HANDOFF-the-woods.md`: can a player catch a fake by asking about a day they
  both lived through, and does it feel like deduction rather than a coin flip?
  No human is known to have played a full day since the alpha shipped
  2026-08-30. Releases 0.19-0.25 are all machinery the handoff deferred.

---

## 1. DONE — the ask is readable (seven-0.26.0, blueprint 0.26)

Built as the blueprint said; its "What was built" section has the detail.

- [x] **Weather rendered.** `woods.js` `WEATHER_LOOK`, read off
      `sim.woods.weather` every frame in `render.js`: sky, fog, light, rain,
      wind in the treeline plus blowing leaves, frost and a skinned-over creek.
      The day's first line says it too, in the present register.
- [x] **Beats leave the world changed.** Firewood, water cans, tent and fire at
      the hearth; the birch leans on the ridge until it is cut, then lies down.
      DERIVED from `woods.beat`/`woods.phase` (`dayMarks`), not serialised as a
      second list — both are already save state, so nothing can drift.
- [x] **A readability guard per kind.** `tests/readability.mjs`, one guard per
      perturbation kind, each with its negative controls in the file. The
      browser half is in `tests/woods-play.mjs`: marks read off the live scene
      at dawn, morning and after a reload; the five weathers read back off the
      canvas and required pairwise distinct.

## 2. NEXT — a human plays a day

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
