# Blueprint 0.19 — the fire that lies

First slice of the traverse work (`docs/IDEAS.md`, 2026-09-09). Proves the
percept idea end to end and touches as little else as possible.

**Build.**
1. `sim.fire` — a crafted, placed structure. `{ x, z, fuel }`, one per basin,
   position decided at craft time. Follows the planted Stake, not an item: it
   exists in no seed-generated world, so it lives in `sim` and is serialised
   WHOLE (`save.js` already says why for pylons).
2. Fuel burns down on a schedule. Feeding costs real wood from `sim.wood`. The
   readout is the fire itself — flame height, light radius — never a number.
3. `percept.fireLooksLive`, modelled on the existing `deadPylonsLookLive`. Below
   `BAND.BRITTLE` (`lucidity < 14`, from `bandOf()`, never a fresh literal) a
   dead or absent fire renders COMPLETE: burning normally, shrinking on
   schedule, asking to be fed. Feeding it spends the wood and does nothing.
4. `percept.shownWood` — the number the HUD reads instead of `sim.wood`, the way
   `percept.itemLabels` already replaces item names. Chopping a phantom tree
   raises shown only; feeding lowers both together so the arithmetic stays
   consistent. Recovery reconciles shown to true.

**Do NOT build here.** Regions, obstacles, day/night, skills, the traverse map.
This slice runs in the basin that exists.

**Ripples predicted.**
- `sim.wood` gains a second reader. Every existing site that reads it directly
  (`STAKE_COST` check, craft, HUD) has to be sorted into true or shown, and the
  gate must use TRUE or a hallucinating player can plant a Stake from nothing.
- Fire is the first thing a player adds to the world. Renderer pooling,
  collision and save all assume the feature list is fixed at generation.
- `SAVE_VERSION` bump: a resumed run without `sim.fire` restores `undefined`,
  and `undefined` fuel arithmetic is NaN — the exact shape of `lostSince`.

**Verify.**
- Pure suite after each step.
- Negative-control every guard: break it, watch it go red, restore.
- The one that matters: a run where the lead is brittle must spend real wood on
  a fire that does not exist, and the sim's true wood must fall while shown
  tracks it. Assert on TRUE and SHOWN separately or the test cannot see the lie.
- Determinism: anything gating an rng draw is save state. Fuel burn and the
  brittle check both decide WHICH TICK something happens on.
