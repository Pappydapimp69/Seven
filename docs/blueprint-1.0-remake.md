# Blueprint 1.0 — the remake

Owner, 2026-10-11: "Remake the seven game from the ground up, it's too buggy."
Bugs named: movement/camera, companions, panels/flow, map/world. Chosen: a
totally new codebase, replacing the old one in place. Only the design carries
over: `docs/IDEAS.md` ("THE WOODS") and `docs/blueprint-0.35-camp-tasks-and-time.md`.
The old game is at commit 98af10a (seven-0.41.0) if anything needs recovering.

## Why each bug class goes away

- **Movement/camera:** no 3D, no camera rig, no zoom. A 2D top-down canvas,
  camera locked on the lead, sized from `devicePixelRatio` re-read on every
  resize (Brain mirage#E10). Movement is screen-aligned: up is north, always.
- **Companions:** a 4-way BFS on one small grid (no corner cuts, Brain
  pathfinding-diagonal#E1); path cache uses `null` for not-computed (opticon#E22).
  One task state machine per companion, in one file.
- **Panels/flow:** one modal at a time, owned by `ui.js`. While a modal is open
  the sim does not tick. Every panel has one way in and one way out.
- **Map/world:** one generator, one grid, one trail. Each area ends in a
  deadfall row that seals the map; a sweep test proves the only way north is
  the trunk, on 50 seeds, and that the far edge is reachable once all are cut.

## Modules (no build step, ES modules)

rng · names · config · world · chronicle · sim (clock, people, camp, tasks,
night, rescue, pylons, ending) · percept · save · render · input · ui · main.

Rules kept from the bones: sim is truth; percept is the only liar; the hidden
meter never reaches the screen; one seed per run; the night draws a FIXED
number of rng values; anything that gates a draw is saved.

## What is in 1.0

Recruit + spend points; seven areas north; deadfalls; fell trees, carry wood,
woodpile at camp (stays when camp comes down); fire shields the camp at night;
pylons shield an area's depth, lit by two, burn 36 h; dawn and dusk plans;
the night takes the exposed; the dawn call (with false calls); find them,
walk them home, two at the fire, ask both, keep one; ask anyone about a
recent day (accounts derived, a fake's has one fact bent); the count says
"Seven of you" always; the far edge: home pylons = real + 1, every attempt
spends one; shared points pool for the next run.

Not in 1.0: the keystone morning, crafting, the tutorial camp as its own map.
