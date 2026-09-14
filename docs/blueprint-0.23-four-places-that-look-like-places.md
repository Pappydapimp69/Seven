# Blueprint 0.23 — four places that look like places

## The gap

`woods.js` says why the sites exist: *"a wrong-place claim is only evidence if
the places are distinguishable."* It then satisfies that by SPREADING them to
four quarters and validating the spread in `tests/woods.mjs` — open, reachable,
far apart.

The renderer draws all four with the same `makeSite()`: a cairn, a pole, a lamp.
No argument, no branch. The only difference between the creek and the ridge on
screen is where you are standing when you look at one.

That matters because `place` is one of six perturbation kinds in
`chronicle.js`: a false account swaps one fact's place for another real place —
*"went down to the ridge for water"* when it was the creek. One sixth of the
falsification surface is rendered into something the player cannot read. Brain
already holds the general form of this: *a tell below one display increment
fires into a rounding error*. Here the display increment is the whole cue.

## The change

Each site gets a body that says what it is. The pole and lamp stay exactly as
they are — that pair is the ACTIVE-BEAT indicator and it is the renderer's only
statement about the day, so it must not start doing double duty as identity.

- `creek` — a sunken run of water with bank stones
- `ridge` — a raised rock outcrop
- `deadfall` — downed timber, reusing `makeFall()`'s vocabulary
- `fire` — the camp's stone ring

`syncPool` already passes the item to its factory ("so a factory can vary by
whose it is"), so `makeSite(site)` branching on `site.id` needs no plumbing.

## What it must not break

- The lit/unlit distinction. `userData.lamp` and `userData.glow` are read every
  frame by the update loop; every form keeps both.
- The authored coordinates. The camp is the one authored map — sites staying at
  hand-typed cells is correct here, and pinning them to procedural objects is a
  TRAVERSE problem, not this one.

## How it is verified

A look is not testable in the pure tier, so the pure test asserts the
CONTRACT — every SITE id has a form, and no two share one — and the browser
test asserts the RESULT: walk the four site groups in the live scene and
confirm no two are structurally identical. Negative-control both by collapsing
the branch back to one shape.
