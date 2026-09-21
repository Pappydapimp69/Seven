# Blueprint 0.25 — the trainer is a person, and the camp is quiet

Three things the camp gets wrong, reported from play.

## 1. The trainer is an obelisk

`ensureTrainerMark()` builds a 3.2-unit pole with a glowing octahedron on top
and nothing else. Its own doc comment says the marker exists so the objective
does not "point at one of six identical figures standing in a field" — but
`campParty()` puts the companions around the spawn yard at the WEST end and the
trainer is at the EAST end, so there was never a figure there to mark. The
marker is the whole character.

So: a real figure, built distinct from `BUILDS` on every axis a silhouette
carries — taller, a long coat instead of a capsule, a wide flat brim, and the
lantern moved from a pole into his hand. The glow stays; it is how you find him
down eighty metres of path.

## 2. He has no name

He is the string `"TRAINER:"` in two places. Give him one, and make it
structurally impossible for the roster to collide with it rather than
statistically unlikely: `makeRoster` discards anything longer than `NAME_MAX`
(8), so a 9-letter name can never be drawn. **ABERNATHY**. The test asserts the
LENGTH RULE, not a sample of seeds — sampling 4000 seeds proves nothing about
the 4001st.

## 3. The camp chatters at you

Nobody is in your party at the training camp, but all five companions run
`companionRemark()` every tick. They are all STEADY (`noDrain`), and a steady
companion still speaks 40% of the time it rolls, every 36-130s each. Five of
them makes a line every 20-60s of ambient noise over the top of a tutorial
whose whole job is one instruction at a time.

Suppress it — but **keep the rng draws**. `companionRemark` consumes
`float`/`chance`/`pick`, the camp is saveable, and skipping the function would
fork a resumed tutorial. The rolls happen; the emit does not. Constant roll
count is the house rule and this is exactly the case it exists for.

What must still reach the log: the trainer's own scripted lines, stage briefs,
and check-in `report` events — none of which come from `companionRemark`.

## How it is verified

Pure: the name cannot be drawn (length rule), and a camp tick emits no chatter
while a basin tick still does. Browser: the trainer draws as a figure whose
geometry signature differs from every companion's. Negative-control all three.
