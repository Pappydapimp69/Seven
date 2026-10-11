# Blueprint 0.35 — camp, tasks, and time

Status: DISCUSSED with the owner 2026-10-11. Design only; nothing built.
Read with `docs/IDEAS.md` ("THE WOODS: full design note") — most of this is
already there and was re-derived in conversation.

## Time, not currency

Daylight is the world clock, not a wallet. Work advances time; time does not
stop at dusk. Work can continue after dark — night is when hallucination rises
and people are taken and replaced. The day ends when the lead sleeps
(IDEAS: "you sleep when you choose and that ends the day").

Consequence that must hold: more hands on one job finishes it SOONER in clock
time. The cost of putting everyone on the deadfall is everything else left
undone (no wood, no camp, no fire when dark comes) — not night arriving faster.

Today's build differs: a 12h wallet, night fires automatically at 0, walking
is free. Replace that.

## The deadfall

- First area: dense forest that cannot be walked through, one path, and a tree
  across it. A time gate, never a wall: ANYONE can chop, a logger chops faster.
  If only a logger could clear it, losing the logger would lock the run.
- Each chop advances the clock. Logging skill scales progress per chop
  (a percentage, never a flat amount that can floor at zero).
- Progress persists across days.
- Needs generator support for a forced corridor (Brain: the resolved
  "reachability cannot host a path that matters" tension).

## The team member, not the commander

The player stays first person and is a member of the team. No free overview.

- **Morning plan, at camp, at DAWN ONLY.** Tasks are assigned at the campsite once a day, at dawn; the plan cannot be changed mid-day. This
  is what makes a camp, a fire and sleep necessary rather than arbitrary.
- **Tasks are bounded:** "bring back a load", "clear this deadfall", "set up
  camp here". "Gather wood" with no end cannot be finished, so it cannot be
  switched from.
- **In the field you can only nudge.** You can redirect someone you can reach —
  standing with you, or by CALL. They finish their current chunk (this load,
  this cut) before switching. The call already looks the same whether or not
  anyone answers; a hallucinating member or a fake may not come.
- **The player's own hands are never locked.** You can gather, chop and build
  yourself at any time.
- **The plan is evidence.** "Who was assigned where" is a fact; a fake can
  misremember it.

If an overview is ever added: camp only, last-seen positions (never live),
drawn from the lead's percept, time running. A live, true top-down map would
be a second honest instrument and would remove "out of sight", which is where
fakes come from.

## Camp

- One camp at a time. It must be DISMANTLED before it can be rebuilt elsewhere.
- Both take time; helpers speed them up. The kit is carried — carry skill
  matters, and losing the carrier mid-move hurts.
- The fire belongs to the camp: a new camp needs a new fire.
- Between dismantle and rebuild there is no fire, no planning and no safe
  sleep. Being caught by dark mid-move is the intended mistake.
- Sleeping without a camp is allowed, at much higher night risk.
- Camp is a front line: move it forward as the route opens.
- Facts: who dismantled, who carried, who lit the new fire.
- Tutorial: the training camp is the first one you take down.

## Open

- What a "chunk" is for each task, in clock time.
- Night risk numbers: alone, away from camp, no fire.
- DECIDED 2026-10-11: fire shields NIGHT only; pylons shield DEPTH and decay —
  one lit in an area slows sanity loss for a day or two, then burns out. The
  campfire burns out overnight unless stocked with enough wood to reach
  morning, or someone is tasked with feeding it (a night watch).
- Open: pylons per area; whether a fire dying hits everyone or only the waking.
- (was) Fire vs pylon roles (leaning: fire shields NIGHT only, as the code does now;
  pylon shields DEPTH, scarce, burns down; neither heals — IDEAS: a pylon slows
  the fill rate, it is not a reset). If fire also blunts depth, pylons become
  redundant and the rotting supply line dies.
- What forces forward motion. A fed fire that holds off everything makes
  turtling at a shallow camp optimal. Candidate: nights keep taking people, so
  staying put is losing slowly.
- Zone radius, whether zones stack, whether fire works by day.
- Legibility: safety must read from the world (light, colour, pylon glow),
  never the HUD. Brain T1 (open): a reactive hallucination vs "stable reads as
  a place".
