# Blueprint 0.26 — the ask is not readable yet

## The fork, and why it is not a three-way choice

`HANDOFF-the-woods.md`: *"The full design is months of work. Do not start it."*
The alpha exists to answer one question — **can a player catch a fake by asking
about a day they both lived through, and does it feel like deduction rather
than a coin flip?** Five releases since (0.19-0.25) added fire, day/night,
deadfalls, a distance budget, a look pass and a named trainer. Every one of
them is machinery the handoff deferred. None of it is the ask.

So the live options were: (a) build the traverse, (b) get a human to play the
ask, (c) audit whether the ask is READABLE before anyone judges whether it is
fun.

It is not a three-way choice. **(c) gates (b), and (b) gates (a)** — because
the audit is already done below and it found the ask is partly uncatchable. A
playtest run now returns a FALSE NEGATIVE: the player concludes deduction is a
coin flip, and on two of the six axes they would be literally correct, for
reasons that have nothing to do with whether the design works.

Brain's canon predicted this before the audit ran. `dog#E95`: *five independent
playtest failures were one defect five times, every mechanism intact and every
suite green, because presentation absence subtracts nothing from any test.*
`dog#E93`: *a system nothing on screen points at scores the same as one that
does not exist.* This session already found three of that shape — four
identical cairns, a trainer who was a lamp on a stick, a lantern behind its own
coat — all invisible to a green suite.

## The audit: what carries each perturbation to the player

`chronicle.js` perturbs one of six kinds. A false account is only catchable if
the player experienced the true value.

| kind | what carries it | verdict |
|---|---|---|
| `place` | four worksite bodies | **fixed in 0.23.0** — was four identical cairns for the alpha's whole life |
| `actor` | the banner names who, five distinct figure builds | readable |
| `name` | the roster panel | readable |
| `order` | the player lives the sequence | readable, as memory only |
| `object` | a subtitle line, and nothing else | **weak** |
| `weather` | **nothing** | **uncatchable** |

### weather is uncatchable by construction

`woods.js` draws a weather from `WEATHERS` and stores it on the chronicle.
`render.js` mentions weather once, in a comment about camp fog. `hud.js` never
mentions it. Nothing in the scene, the HUD or the event stream ever tells the
player what the weather was.

So a wrong-weather claim asks "was it drizzling yesterday?" about a day in
which drizzle was never depicted. That is not a hard tell. It is a coin flip,
and it is one sixth of the falsification surface.

### object is nearly as bad

The seven beats resolve as a subtitle and nothing else. No tent is ever
pitched, no firewood appears at the fire, the leaning birch never falls. The
player is TOLD "the tent" and never shown one, so a swapped object is a
memory test of a line of text rather than of a day.

This also costs the beat its point. `woods.js` already says a beat is a HOLD
rather than a press *because* "the whole design rests on their MEMORY of a day
being the evidence, and a memory needs something to be a memory OF" — and then
the thing they are watching is a progress bar.

## The build

**0.26 — make the six axes perceivable. Nothing else.**

1. **Weather, rendered.** Each of the five gets a visible signature the player
   cannot miss across a day: fog density and colour, a wind that moves the
   treeline, drizzle, cold light, clear. It is already a per-run seeded value;
   this only draws it. Bind the renderer to `woods.weather` directly — per
   Brain's `draw-the-rule-from-the-live-value` kernel, a copy drifts.

2. **Beats leave the world changed.** A pitched tent stands. Firewood stacks by
   the fire. The birch is down on the ridge. Each is one mesh, placed when the
   beat resolves and serialised with `deadfallsCleared`'s existing shape. Then
   "the tent" is a thing the player walked past for the rest of the day.

3. **A readability guard per axis.** For each of the six kinds, a test that the
   true value reached the player through something other than the account text.
   This is the guard whose absence let `place` ship unreadable for a month —
   and, negative-controlled, the one that would have caught it.

**Out of scope, explicitly:** the traverse, regions, recruitment, skills,
pylons-as-route, meta-progression. All deferred by the handoff and still
deferred.

## Then, and only then

Play it. The instrument already exists: `seven:days` records days walked,
caught, and the last five, and the interesting shape is a hit rate that climbs
and then flattens. Until a human plays a day, nothing in this repo can answer
the question the repo exists to answer — and tension **T11** says the automated
tier never will.

## What would change this plan

- If the owner has play data already, this is wrong: the question is answered
  and the fork reopens.
- If a human plays 0.26 and still reads it as a coin flip on the four axes that
  WERE readable, the design claim is in trouble and the traverse should not be
  built on it.
- If `order` also proves unreadable in play — seven beats is a lot to hold —
  the fix is the day's length, not its presentation, and that is a design call.
