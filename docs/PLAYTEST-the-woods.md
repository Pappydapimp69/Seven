# Playtesting THE WOODS

**https://pappydapimp69.github.io/Seven/** → "The woods"

This is an alpha with one job. It is not trying to be a game yet; it is trying
to answer a single question that the whole design in `docs/IDEAS.md` is built
on top of:

> **Can a player catch a fake by asking about a day they both lived through —
> and does it feel like deduction rather than a coin flip?**

If the answer is no, none of the rest is worth building, and it is much cheaper
to find that out now than after the map, the days, the pylons and the
recruitment are on top of it.

## What happens

**Day one.** Five people you have never met, with names generated for this run
only. Seven jobs: firewood at the deadfall, water at the creek, a leaning birch
on the ridge that has to come down, the tent, the fire, a walk along the ridge
line, first watch. The banner names WHO each job belongs to. Walk to the lit
cairn — they are already on their way there, because it is their job — and
**hold E** while the two of you work.

Watch who does what, and where. That is the whole thing you are being asked to
remember. Nothing else in the run will help you.

**The night.** The screen closes. One of them is replaced by something with the
same name and the same skills. Nothing is announced — no line, no sound, no
mark on the roster, and nobody else finds it strange.

**The morning.** You get **three questions** and there are five of them. Pick a
name (**1**–**5**) and check in to hear their account of yesterday. Everyone
who was really there tells it the same way, word for word. The one who was not
gets **exactly one thing wrong**: a wrong place, the wrong pair of hands, two
things in the wrong order, the weather, or a name a letter off.

Re-reading somebody you have already asked is free and gives back the same
words. Three questions for five people is the point — you cannot lay all five
side by side and read off the odd one out, so the evidence has to be your
memory of the day.

Then press **B** and name somebody.

## What to watch for while you play

These are the things nobody can tell from the code, and they are the reason
this was built before anything else.

1. **Did you catch it, and did catching it feel like working it out?** Losing
   is fine. Losing while feeling you never had the information is not.
2. **Which kind of wrongness did you notice, and which did you miss?** Six
   axes are in play. If one is invisible in practice, or one is a giveaway,
   that is a real finding.
3. **Run five.** This matters more than run one. Does it get more interesting
   as you learn what to listen for, or does it flatten into guessing? The title
   button keeps a count — days walked, how many caught, and how many of your
   last five — precisely so this is measurable rather than remembered.
4. **Seven jobs: too many or too few?** Is that enough of a day to have a
   memory of, or is it already a chore by the fifth cairn?
5. **Three questions.** Too tight, or not tight enough?
6. **Did anything point at the answer?** The design's central rule is that
   nobody finds the swap strange. If any part of the game — a sound, a line, a
   HUD element, a way somebody stands — gave it away, that is a bug and a
   serious one.

## What is deliberately NOT in it

No map, no travel, no crafting, no day/night cycle, no pylons, no recruitment,
no skills, no meta-progression, no ending. All of that is in the design note
and all of it is machinery that works in other games. None of it matters if the
asking is not fun.

## The other game

"Walk in" and "Learn the walk" on the same title screen run MIRAGE — the survey
party crossing a fogged basin, which is the bones THE WOODS is built on. It
still works, and it is where every verb here was built and taught.

## For whoever picks this up next

- `docs/IDEAS.md` — the full design. THE WOODS entry is the design of record.
- `docs/adr/0002-the-woods-alpha.md` — why the alpha is this slice and no more,
  and the two rules that shaped it.
- `docs/adr/0003-two-alphas.md` — this was built twice, in parallel, by two
  sessions that could not see each other. What happened to the other one.
- `docs/blueprint-0.13-what-asking-costs.md` — from that other line of work.
  The best statement in the repo of what the alpha is FOR, with real
  measurements behind it.
- `bash tests/run-all.sh` runs everything. `tests/woods-play.mjs` plays a whole
  day in a real browser, start to verdict.
