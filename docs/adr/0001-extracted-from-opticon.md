# ADR 0001 — MIRAGE is extracted into its own repo

**Status:** accepted · 2026-07-30 · applies to this repo (now `Pappydapimp69/Seven`; written when it was `Pappydapimp69/mirage`)

## Context

MIRAGE was originally built inside `Pappydapimp69/Opticon`, under `mirage/`, on
branch `claude/3d-party-hallucination-game-f31dj0` (see that repo's
`docs/adr/0001-mirage-separate-game.md` for the original reasoning). That ADR's
first decision was explicit: build it as a separate GAME, but not a separate
REPO — sharing Opticon's vendored Three.js via a one-line re-export shim
(`mirage/lib/three.module.js` re-exporting `../../game/lib/three.module.js`)
rather than carrying a second 1.3 MB checkout.

That decision recorded its own cost up front, and tracked it as Opticon's
tension **T26** ("shared vendored library vs standalone deployability"): the dev
server had to run from the Opticon repo root, not from `mirage/` alone, and
Opticon's existing GitHub Pages workflow (which publishes `game/` as the site
root) could not serve MIRAGE at all without either a workflow rewrite or
copying in the real Three.js file. Both were left unpaid at the time because
publishing MIRAGE was not yet in scope.

## Decision

Extract MIRAGE into its own repository, `Pappydapimp69/mirage`, once gamepad
support and a full test suite made it clear the game was staying: standalone,
with the real vendored Three.js checked in directly rather than a shim, its own
GitHub Pages workflow, and its own git history from here forward.

### Consequences

- **T26 is resolved by removing the tradeoff, not by picking a side.** There is
  no longer a sibling `game/` directory to shim against, so the standalone-
  deployability cost that tension weighed no longer exists — the repo just
  vendors its own copy, like any other project would.
- **The repo root shifted.** Everything that used to be `mirage/<path>` inside
  Opticon is now `/<path>` here — `index.html`, `src/`, `css/`, `tests/`. The
  test harnesses (`tests/smoke.mjs`, `tests/gamepad.mjs`) serve and navigate to
  `/index.html`, not `/mirage/index.html`.
- **Opticon's copy of `mirage/` is removed** on that branch, with a pointer back
  to this repo, so there is exactly one canonical copy of the game going
  forward rather than two that can silently drift apart.
- **History split.** This repo's git history starts fresh from the extracted
  snapshot; the full build history (world generation, the hallucination-layer
  design, the movement-basis bug, gamepad support, and the lessons recorded
  along the way) lives in Opticon's feature branch and its own Brain-linked
  cognitive-update docs, referenced from here rather than replayed.
- **Deployability, actually cashed in.** With a real vendored Three.js and no
  sibling-folder assumption, this repo can now run a normal single-purpose
  GitHub Pages workflow (`.github/workflows/deploy.yml`) triggered on push to
  `main`, publishing the repo root directly — the thing T26 said was blocked.

## What did NOT change

The architectural rules that mattered are untouched by the move: `state.js`
keeps the honest record, `percept.js` is still the only module allowed to lie
about it, the meter is still never rendered, and the test suite still refuses
to phrase any assertion in wall-clock time or treat "loaded without throwing"
as proof a 3D scene actually drew. Moving repos changes where the code lives,
not what any of it is for.
