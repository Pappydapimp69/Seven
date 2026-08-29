# Ideas — a place to put things before they get lost

Raw capture. Nothing here is committed to, planned, or designed. An entry
existing is not a decision to build it.

**This is not Brain.** Brain holds *verified lessons* and *portable kernels* —
things that earned their place by being confirmed. This file holds unverified
sparks, half-thoughts and "what if", including ones that turn out to be bad.
Something graduates from here into Brain (or into a blueprint) only after it
has been thought through and, where it makes a claim about behaviour, tested.

## How to add one

Append to the top of the list. Keep it short — enough to rebuild the thought
later, not a spec. Date it so a stale idea is obvious.

    ## YYYY-MM-DD — short title
    Whatever the thought was, in as few lines as it takes.
    (optional) Why it came up / what prompted it.

Leave it alone after that. Editing an idea into a plan is what blueprints are
for; the value of this file is that writing in it costs nothing.

## Status markers (optional)

- `[open]` — untouched, the default; assume this if unmarked
- `[building]` — has a blueprint or is being worked on
- `[dropped]` — considered and rejected; keep the entry and say why, so it
  does not get re-proposed from scratch in six months
- `[graduated]` — became a blueprint, an ADR, or a Brain entry; say which

---

## 2026-08-28 — replay your own actions back at yourself: the phantom possesses, it does not appear  [open]

Follow-on from the investigation idea, after learning the phantom is only ever
an episode today and making it permanent would be a large change. This gets the
same effect without ever adding a seventh body.

**The move.** Never add a seventh entity. Instead, the phantom POSSESSES an
existing member — one, or two, or three — and the tell is that a possessed
member does not replay what you actually did.

**How it works across levels.**

- Basin one is ordered, like the tutorial: gather wood, then stone, then build
  a fire, then a tent, then go activate something. A given sequence, done in
  order.
- Basin two you play as a DIFFERENT member, walking through the same events —
  their account of the same day.
- Everyone else in that level replays what they did the first time round. The
  character you played as in basin one should now be a bot repeating YOUR
  actions: going where you went for the wood, coming back to build the fire, in
  the order you did it.
- Where a member has been possessed, the replay is subtly wrong. They fetch
  stone before wood. They pitch the tent before the fire. Nothing announces
  itself; the order is just not what you remember doing.

**Why this is the good version.** The player is the recording. You are not
comparing two accounts the game hands you — you are comparing the game's
account against your own memory of a level you personally played. That makes
the evidence something the game cannot fake and cannot hand you by mistake, and
it means no HUD, no log and no meter is involved at any point.

It also solves the thing that started this: a possessed member behaves like a
member. They are not broken, they do not fail to answer, they are not
identifiable by anything not working. They are only identifiable by being out
of order.

**What it needs, and none of this exists yet.** A recording of the player's
action sequence per level, kept in the save. A replay driver that can make a
companion re-perform a recorded sequence rather than run its own AI. A
per-level ordered objective list for the basin, which the tutorial now has a
working shape for. Some notion of the same events being replayable from another
member's viewpoint.

**Open questions.** How exact the replay has to be before "different" reads as
deliberate rather than as the AI being loose. Whether the player will actually
remember an order from a level or two ago without a crutch — and whether giving
them a crutch destroys it. What happens if the player does the first level in a
weird order, or badly. Whether a possessed member should ever be right by
coincidence.

## 2026-08-28 — MIRAGE as an investigation: play the party one at a time, find who was never there  [open]

Came out of asking how the balance bots are set up, and noticing the phantom
sixth companion is a problem in normal play rather than just a stat.

**The problem that started it.** A hallucinated companion who is always present
and never works is either solved instantly or is just irritating. You call them,
they do not come; they never confirm a pylon. Within a level or two the player
knows which one is fake and there is no mystery left — and until then it reads
as the game being broken, not as the game lying. A permanent unreliable
teammate is a bug the player learns to route around.

**The idea.** Stop making the fake one detectable by behaviour, and make finding
them the actual game.

- You play as ONE named character for a level or two, not as a generic lead.
  The whole party is present, phantoms included, and the phantom behaves like a
  real member — maybe slightly less reliable, but not obviously broken.
- Then you switch and play through as a DIFFERENT member of the party, and go
  through their version of events.
- Each perspective legitimately differs — different people saw different things
  — so disagreement alone proves nothing. That is the point.
- Eventually you play as the hallucinated one. Their level looks correct: same
  map, same gameplay. The tells are small and textual — a teammate's name
  spelled differently (Stephanie / Stefanie), trees slightly wrong, small
  omissions in the account.
- The object becomes: reconstruct who was actually there. Possibly more than
  one was not.

**The other half — days instead of a clock.** Instead of lucidity being a timer
that runs down every level, a level becomes a DAY:

- Clear an area: activate one or two pylons, then make camp.
- Making camp lets the party rest and ends the day.
- Waking up starts the next day, and the hallucination pressure steps up.
- The campaign is something like ten days before the hallucinated member takes
  the whole party.
- So pylons and camps stop being "turn on the lights, walk A to B" and become
  the thing that SLOWS how fast the hallucination spreads. The race is against
  takeover, not against a clock.

**Why it might be worth doing.** It reframes the loop from "complete objectives
before a meter empties" to "work out what is true before it stops mattering",
which is what the deception layer was always for. It also gives the phantom
somewhere to go other than being an annoyance.

**Open questions, not answered here.** How a rest/camp verb interacts with
pylons firing once. Whether per-character playthroughs mean per-character saves.
Whether "play as the phantom" is a twist that only works once. Whether multiple
fakes is legible or just noise. How much of the current basin loop survives.
