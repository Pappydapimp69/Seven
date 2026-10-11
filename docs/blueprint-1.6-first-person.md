# Blueprint 1.6 — first person, back

Owner: "What happened to first person view?" then "fix it, don't ask". ZaneGPT
pass: first person is load-bearing (blueprint 0.35: a live overview removes
"out of sight", which is where fakes come from). The old bugs were unit
errors around a 3D view, not first person itself (Brain mirage#E10, #E6).

- View: a grid RAYCASTER on a 2D canvas, reading the percept. Forest cells are
  tree walls; people, pylons, fire, tent, piles, deadfalls, stumps are
  billboards. Darkness is per-pixel light: daylight, fire (FIRE_LIGHT), the
  lead's lantern, lit pylons. No WebGL.
- Fixed horizontal FOV; screen shape only changes the vertical. Render at a
  capped internal width, scaled up; the canvas backing stays devicePixelRatio.
- Controls: W/S forward/back, A/D strafe, ←/→ turn, mouse look (pointer lock,
  movementX × DPR), pad right stick, touch: drag on the right half to look.
  Movement is turned into a world vector from the lead's yaw BEFORE tick(), so
  the sim is unchanged.
- E acts on what you face (±75°) first.
- The top-down renderer is removed from play (no overview).
- Guards: W walks along yaw at four yaws and three device scales (drift);
  a 360° sweep sees every companion (mirage#E6); canvas backing = CSS × DPR.
