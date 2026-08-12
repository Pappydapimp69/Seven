# Blueprint — MIRAGE 0.10: make the lie land

## The problem, stated as a measurement

MIRAGE is a game about being lied to by your own perception. Measured against
the `deceived` policy over 20 seeds at the shipped 0.9.10 constants:

| | standard | bleak |
|---|---|---|
| false log entries per run | **0.2** | 0.5 |
| runs ending `discredited` | 1/20 | 2/20 |
| runs ending `dissolved` | 4/20 | 14/20 |

The deception layer is complete — phantom markers, a drifting compass, a
doubled party, relief that recedes, mislabelled items, pylons that prime and are
never confirmed — and on a standard run it touches the player's record roughly
**once every five runs**. Everything built this session made the lie *legible*
(companions visible, tells on screen, a record that can be corrupted and
repaired). Nothing made it *frequent*.

The reason is structural, not tuning: **a mind only hallucinates at lucidity
zero**, and zero is close to terminal. The whole deception layer is gated behind
the worst moment of a run, so a competent player either never sees it or is
already losing when they do.

## The change

**Micro-episodes.** A mind can slip briefly and come back, well before zero.

1. Onset stops being "lucidity hit 0" only. Below a band threshold, a mind rolls
   for a SHORT episode — seconds, not the rest of the run — with a rate that
   rises as the band worsens.
2. A micro-episode uses the existing `HALLUCINATION` kinds and the existing
   percept machinery unchanged. It ends on its own; no pylon, no dose.
3. Zero-lucidity onset keeps its current meaning: the long, unrecoverable kind.
   The two must be distinguishable in the debrief and NOT distinguishable from
   the inside.

## What must not happen

- **Constant lying is not deception, it is noise.** A channel that fires on
  every event stops carrying information. Micro-episodes need a ceiling and a
  refractory gap, asserted as a duty cycle, not just a floor.
- **The onset must not be a tell.** No sound, no flash, no HUD change that says
  "you are under now" — the whole point is that you cannot tell from the inside.
- Difficulty must not move by accident. The `deceived` policy is the only oracle
  entitled to say whether it did.

## How it gets verified

- `tests/hallucination.test.mjs` — observed-rate floors AND strobe ceilings for
  micro-episodes, the same two-sided shape the monster flicker already uses.
- `tests/balance.mjs` — false entries per run and `discredited` rate should
  rise; win rate should stay inside the existing two-sided band.
- `tests/stress.mjs` — the lucidity/hallucinating invariant currently asserts
  "hallucinating implies lucidity zero", which this change deliberately breaks.
  It has to be rewritten to the new rule rather than deleted.

## Open question for brain

Onset shape: a per-second probability, a rising pressure that discharges, or a
scheduled beat? And how to keep a short episode from reading as a glitch rather
than as a lapse.

---

## Outcome (measured, not claimed)

Built as specified, with three constraints brain supplied that were not in the
original blueprint:

- **waiting-city#E9 / #E17 — constant roll count.** Both the slip roll and the
  duration roll are drawn UNCONDITIONALLY at the top of `tickLucidity`, before
  any branch. The first draft put the duration draw inside the success branch,
  which is the same violation one level down: a mind that slipped would have
  burned one more draw than a mind that did not, shifting every other mind in
  that tick. E17's "no need to roll, it's forced" boundary is exactly this.
- **rate-a-perceptual-tell-by-its-observed-rate** — asserted two-sided (a floor
  on lapses per run AND a duty-cycle ceiling), never on the nominal probability.
- **brain-builder#E6** — a refractory gap, tested directly rather than inferred
  from the duty cycle.

**What moved:** slips per run 0 → **2.6** on standard, 3.6 on bleak. A player
past the calm window now meets the deception several times a run instead of
once every five runs.

**What did NOT move:** false log entries, 0.2 → 0.3. A 4-9 second lapse is not
long enough for the `deceived` policy to walk to a phantom marker and write it
down, so the CONSEQUENCE path still belongs almost entirely to the long
episodes. Frequency was solved; consequence was not. Whether that matters is a
play question, not a measurement one — a brief lapse you notice and distrust may
be the better beat, and the record has other ways to get corrupted.

**A guard that earned nothing:** the dissolve ending now ignores minds that are
merely mid-slip, on the theory that six brief overlaps were being read as the
party coming apart. Measured before and after: identical. The dissolutions in
bleak are real. Kept as a definition, not as a fix.
