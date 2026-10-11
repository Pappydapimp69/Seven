# ADR 0004 — the remake

Date: 2026-10-11. Status: accepted.

## Decision

SEVEN was rebuilt from nothing as a 2D top-down canvas game (seven-1.0.0),
replacing the MIRAGE-derived 3D codebase in place. The owner asked for it:
"Remake the seven game from the ground up, it's too buggy", naming movement
and camera, companions, panels and flow, and the map. They chose a totally new
codebase over rebuilding the woods layer on the old bones.

## What carried over

Only design: `docs/IDEAS.md` ("THE WOODS") and the owner's decisions in
`docs/blueprint-0.35-camp-tasks-and-time.md`, plus the bones' rules (sim is
truth, percept is the only liar, the hidden meter never reaches the screen,
one seed per run, constant roll count, gating state is save state, tells are
derived). The old game is at commit 98af10a (seven-0.41.0).

## What changed, and why it fixes each bug class

- No 3D, no camera rig, no zoom: up is north, always. Canvas sized from
  devicePixelRatio, re-read on resize.
- Companions: one state machine in `src/mates.js`, 4-way BFS, a path cache
  where null means not computed. Paths are save state (resuming re-planned
  differently without them — found by `tests/save.mjs`).
- Panels: one modal at a time (`src/ui.js`); the sim does not tick while one
  is open; every panel is reachable by keyboard, pad and touch.
- Map: one generator; each deadfall row is sealed; a 50-seed test proves the
  trunk is the only way north.

## Consequences

MIRAGE's game, the scripted alpha day, the 3D tutorial camp and the old test
suite are gone. CLAUDE.md's MIRAGE-specific notes no longer describe the code.
Not built in 1.0: the keystone morning, crafting, a separate tutorial map.
