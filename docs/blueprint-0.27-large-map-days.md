# Blueprint 0.27 — one woods, many days

## Decision

SEVEN is no longer two adjacent games: THE WOODS as a one-day investigation
alpha and MIRAGE as the traversal run. The next shape joins them.

The target game is: recruit a team, enter the woods, and make it out the far
side with whoever is still real and still with you. The first buildable slice
is:

1. one large persistent woods map with a far side,
2. obstacles along the route that slow progress instead of hard-blocking it,
3. a daily survival/work loop on that map,
4. companion history accumulated from what actually happened,
5. nighttime disappearance, with replacement as the cover story,
6. a starting team chosen for specific skills.

Morning interrogation and accusation still matter, but they should consume this
multi-day history rather than remain the whole game by themselves. The missing
person is a real body out in the woods, not just a flag flipped at camp.

## Why this is the next layer

The alpha proved the core question in isolation: a fake account can be derived
from a real day. What it does not yet prove is whether the day can be authored
by play instead of by `BEATS`.

The old basin already has the missing machinery: a generated map, travel,
companions, resources, deadfalls, fire, save discipline, and hallucination
pressure. The new job is not to replace those systems with THE WOODS. It is to
make those systems write the evidence THE WOODS needs.

## Slice

### 1. Large persistent map, end to end

Use `generateWorld(seed, { dense: true })` as the first traverse woods. It
already has the properties this layer wants:

- one connected map,
- camp as the return point,
- trees, stones, items and deadfalls,
- deadfalls that cost either walking distance or daylight,
- density held by a distance budget instead of raw reachability.

The current basin goal is circular: survey markers and return to camp. The
SEVEN goal should be directional: start at one edge/camp, push through the
woods, and reach an exit on the far side. The first map can still use one
generated world, but it needs a start and an exit, not just a camp.

Do not start by stitching many basins together. That creates save, pathfinding
and camera questions before the game has answered whether a single persistent
woods can carry several days.

### 2. Obstacles that slow progress

Obstacles are the route's price. A fallen tree, flood, steep ridge, washed-out
bridge or blocked trail should never say "you cannot continue." It should say
"you can continue, but this costs daylight, supplies or the right person's
skill."

Deadfalls are already the best first obstacle: the code has them, they are
validated not to seal the map, and their design rule is already right:
progress is gated by time.

### 3. Days

Add a day object beside the run, not a new mode:

```js
sim.expedition = {
  day: 1,
  phase: "day",
  daylight: ...,
  days: [],
  night: null,
}
```

Daylight is the unit that prices work. Clearing a deadfall, gathering wood,
building or feeding a fire, scouting a landmark and checking in should spend
the same currency. Sleeping ends the day when the player chooses, if camp is
safe enough to do it.

Day one should be quiet. It establishes the party, the map and the baseline
without replacement pressure.

### 4. Companion history

Keep the chronicle rule and broaden what writes to it.

Today `woods.js` writes facts from seven scripted beats. The traverse should
write facts from real verbs:

- who helped cut a deadfall,
- who gathered or carried wood,
- who found water or supplies,
- who stayed at camp,
- who answered a call,
- who was nearby when a landmark or pylon was found,
- who was absent when something important happened.

This should remain structured data, not prose. `chronicle.js` should still be
the place that turns facts into accounts and perturbs one fact for a false
speaker.

### 5. Disappearance first, replacement second

At night, choose from the day history, not from a hand-authored scene.

The first version can be simple:

- no replacement on day one,
- after later days, one party member may go missing,
- what stands at camp keeps the same id, name and skill surface,
- nobody else comments on the change,
- the original is recorded as missing in this area, not deleted from history,
- the original can be recovered inside a spatial window,
- walking forward past that window is how the player abandons them.

The player should not get a banner, sting, roster mark or tutorialized warning.
The system state changes; the world does not point.

### 6. Starting team and skills

The older design note is explicit: the player starts by recruiting a team and
spending points on skills. That is not flavor. It is how the player decides who
matters before the woods starts taking people.

The first skill set should be small and tied directly to route pressure:

- cutting: reduces daylight cost for deadfalls,
- carrying: improves wood/water/supply movement,
- scouting: finds safer or shorter routes,
- building: improves camp/fire work,
- logging: improves the reliability or richness of remembered facts.

Skill must not become evidence. A fake keeps the same skill surface, because a
replacement who is worse at the job is caught by a stopwatch. Skills are for
surviving the route; memory is for identifying who is real.

## First implementation path

1. Add `src/expedition.js` as the owner of day state, daylight spending, sleep
   eligibility, disappearance, recovery and abandonment.
2. Let ordinary sim verbs emit structured expedition facts as well as their
   current HUD/log events.
3. Add a tiny team model: generated candidates, chosen party, and skill values
   carried on the same companion objects the run already uses.
4. Start a new "Seven" run on a dense generated world instead of the authored
   camp, while leaving the existing "The woods" alpha intact until the new loop
   can stand on its own.
5. Put an exit on the far side of that world and make obstacles spend daylight
   rather than serve as walls.
6. Save and restore `sim.expedition` as branch-gating state. Treat daylight,
   day number, day facts, missing-person state, replacement state, recovery
   windows and any pending night draw as save state.
7. Add pure tests first: day start/end, daylight spending, fact recording, team
   skills affecting obstacle cost, deterministic disappearance from the run
   seed, and abandonment when the route moves beyond the recovery window.

## Non-goals for this slice

- No multi-map world.
- No final ending.
- No meta-progression.
- No full interrogation redesign.
- No new authored tell list.

The test for the slice is narrower: can the player spend several days on one
map and leave behind a truthful structured history that a future fake can lie
about?
