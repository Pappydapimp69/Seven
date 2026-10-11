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

## Decided by the owner, 2026-10-11

- **Two decision points: dawn and dusk.** Dawn sets the day's tasks. At dusk
  you choose who works through the night, who keeps watch, who sleeps. No
  other plan changes.
- **A task is a shift** (e.g. chopping = 2.5h). A member returns to camp when
  the shift ends, or early if a full shift no longer fits before nightfall.
  Sending them out again after dark is a dusk choice, at night risk.
- **Pylons shield DEPTH, per area.** Area 1 has 3 pylons; every later area
  rolls 2–4 (from the run seed). A lit pylon affects its CURRENT AREA only,
  slows sanity loss for a day or two, then burns out.
- **The fire shields NIGHT, camp only.** Its effect radius is the campsite
  itself; its LIGHT reaches further. Light is not safety.
- The fire burns out overnight unless stocked to last until morning or
  someone is on watch feeding it.

## Self-answered (owner may veto) — Brain had no prior art on any of these

- **Shift lengths (clock hours):** chop 2.5; gather a load 1; set up camp 2;
  dismantle 1; carrying camp = the walk. Watch = the whole night.
- **Who the night takes:** weighted by exposure. Awake, alone and outside the
  camp radius is highest; asleep inside camp with a lit fire is lowest.
- **When the fire dies:** it hits everyone in camp, asleep or not — the fire's
  radius IS the camp, so a dead fire is a camp with no shield. A short
  woodpile is a camp-wide mistake, which is what makes stocking it matter.
- **Stacking:** none needed — the fire and a pylon act on different
  multipliers (night vs depth). A second pylon in an area with one already lit
  does not stack; it only resets the burn to full, so it is mostly wasted.
- **Fire by day:** no effect. It is a night shield.
- **What forces forward motion:** each area's pylons are finite (3, then 2–4)
  and burn out in a day or two, and nights keep taking people. Staying put is
  losing slowly; nothing extra is needed.
- **Pylon burn:** 36 clock hours, blue to red. While lit it cancels the depth
  multiplier for its area (back to camp-level pressure). It never heals.
- **An "area"** is the existing route band (seven of them); that is what "the
  current area zone" means.
- **Legibility:** safety reads from the world only — pylon glow colour, fire
  light — never the HUD. The fire's light reaching past its protection is a
  deliberate trap, consistent with "light is not safety".

- **Lighting:** a fire can be lit any time, but it only shields at night and
  burns wood whenever lit, so the natural moment is dusk. Lighting it is a
  dusk choice (or the lead's own hands).
- **The woodpile belongs to camp.** Wood counts only once it is carried back
  to the pile; a gatherer still out at dark is wood not yet in it. Stocking
  the fire at dusk draws from the pile. Moving camp means carrying the pile or
  leaving it behind. (Today `sim.wood` is one global number; that changes.)

- **Nobody is alerted.** IDEAS: nothing is announced; the replacement takes the
  slot. A sleeping lead wakes to a full roster.
- **One call, at first light, heard by everyone at camp.** A direction, never a
  name. No watch dependency, no second-hand reports. It repeats each dawn while
  the missing one is inside the spatial window (this area or the next); when it
  stops, they are gone. (Replaces an earlier "only the waking hear it" draft —
  the owner found it messy.)
- **Only the lead can bring someone back.** Search cannot be delegated; others
  may come WITH you. (Delegating it made rescue a chore.)
- **Finding them is chance** (IDEAS): you always find a pylon; finding THEM is
  weighted by nights out, depth, and how soon you went.
- **Searching takes the lead off everything else:** no field nudges, no hands
  on the deadfall; a companion brought along is off their task too.
- **Getting back is part of it:** finding them is not the end; you walk them
  home before dark.

- **From Brain's disappearance training (2026-10-11), adopted:**
  - The dawn call must NOT only happen when someone is missing, or it
    announces the disappearance (posterior 1.0). Add false calls that depend
    on nobody; the learnable tell is a bearing that stays consistent across
    dawns.
  - Find-chance comes from the missing one's hidden position plus the call
    bearing, not dice (dice leave no skill gap).
  - The call fades with nights missing but has a floor, or it becomes a hidden
    time window on top of the spatial one.
  - Size the bearing to what can be heard (8 directions).
  - Determinism: the night step draws drift, call and bearing every night for
    every slot, missing or not.
- **Rescue returns a DUPLICATE (Brain, doppelganger kernel — adopted,
  replacing the earlier lean that rescue exposes the fake).** Gating rescue on
  exposing the fake first brought the real one back only 0.27 of the time;
  letting rescue expose the fake for free bypassed the investigation. So the
  one you walk home stands at the fire beside the one who never left, same
  name. One of two is real; the player decides with memory (ask both the same
  question; comparing answers locates the bent fact, memory decides) or pays a
  pylon to test one.
- **A pylon test is inviolable (Brain kernel):** no scripted turn after a
  passed test. A pylon that clears someone means they are real, full stop.
- **Rescue and pylons:** the found member can be the second pair of hands at a
  pylon out there; lighting it with them TESTS them (and lights the area) at
  the cost of that pylon. Paid, not free.
- Brain RED tension (open): how is abandonment by walking forward made a felt
  choice with no prompt? Leaning on the fading-with-a-floor call: the dawn
  call still comes from behind you, and stops when you leave the window.

- **Lost means stuck in an area.** Moving camp into a new area is moving
  forward; that is how someone is abandoned (owner, 2026-10-11).
- **The fake is better, and keeping it costs.** IDEAS says both "SAME SKILLS"
  (line ~199) and "the fake logger is BETTER" (line ~241) — a contradiction.
  Owner's call: better. Holding a fake upgrades the team AND raises the chance
  of the next abduction (IDEAS: "holding a fake raises the chance of losing
  another"). Guard against the stopwatch: skills grow a little with practice
  for EVERYONE, with noise, so a fake's larger step hides inside ordinary
  growth — suspicious, never certain. (Self-answered; Brain had no prior art.)
- **The ending (IDEAS, confirmed by owner):** at the far side, the pylons home
  number real members + 1. A pylon needs a second pair of hands and a
  hallucination cannot light one, so the run must end with at least one real
  member. Every attempt spends the pylon. Certainty only comes from rescuing
  everyone, which is impractical by design.

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

## What was built (seven-0.35.0) — items 1–5 and 9 of the build list

- **Map:** `src/trail.js` — 120 cells a side (~310 m), seven areas south to
  north. Area 1 dense forest + one path + a deadfall; clearings off the trail
  later; deadfalls on the trail in areas 1, 3, 5 are the only way north.
  Renderer draws only trees within 4 cells of walkable ground (551k → 124k
  triangles). `tests/trail.mjs`.
- **Clock:** 1 game hour = 30 sim s; 06:00 dawn, 18:00 dusk. Work and sleep
  run the simulation faster (8 / 60 ticks a frame); an action's hours run at
  20. Dawn resolves the night. Seven drain scaled 0.045 (halved asleep) —
  unscaled, the party went under before 20:00 on day one. `tests/seven.mjs`.
- **Deadfall:** chop = 15 s hold (half an hour); 1/16 per unskilled chop; cut
  skill +15%/level; lucid companions within 6 m chop alongside; progress saved.
  `tests/chop.mjs`.
- **Camp:** `sim.camp` movable, one at a time; take down 1h / make 2h (pause
  menu). Woodpile fills when you walk in; fire lit/fed from the pile at camp;
  lit 3h, +1.5h per wood, full = 12h; shield = campsite only. `tests/campfire.mjs`.
- **Pylons:** lit pylon cancels depth for its area for 36h, drawn blue→red.
  `tests/pylonzone.mjs`.
- **HUD:** compass, wood, pile, time, day/night, area.

Not built yet (items 6–8, 10): tasks and the dawn/dusk screens, the
disappearance rework, the stronger fake with practice growth, the ending.
Companions do not take tasks yet — they follow you and help chop when near.
Numbers to watch in play: chop length, fire stocking, the 0.045 drain scale.
