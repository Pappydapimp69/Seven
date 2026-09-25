# Prompt for a fresh session

Copy everything between the rules below into a new session. It is written to
survive an empty context window: it says where to look rather than restating
what the repo already holds.

---

Work on `Pappydapimp69/seven`, branch `claude/brain-install-vohzag`. The game is
THE WOODS; the repo name and the game are the same thing.

Brain stance brief. Terse replies. Direct response to my prompt and no extra
explanations. Use conversational language.

A SessionStart hook (`.claude/hooks/session-start.sh`) has already cloned the
Brain CLI, linked this project in FULL mode and set the stance to brief, so
`brain query` works from the first message. If it did not, it said so on stderr
and the session started anyway — check `brain status`.

**Read first, in this order:** `CLAUDE.md`, then `docs/TODO.md` (the ordered
build queue and where the project actually is), then
`docs/blueprint-0.26-the-ask-is-not-readable-yet.md`. Run
`node tools/triggers.mjs --check` before your first edit and
`brain query <1-2 keywords>` at each new sub-problem, not just at the start.

**Build item 1 from `docs/TODO.md`: make the ask readable.** Render the weather,
make the seven beats leave the world changed, and add a readability guard per
perturbation kind. Nothing else — the traverse, regions, recruitment, skills
and pylons-as-route are deferred by `docs/HANDOFF-the-woods.md` and stay
deferred until a human has played a day.

Things that will save you a cycle, learned the hard way in the session that
wrote this:

- **A green suite says nothing about whether the player can SEE a mechanism.**
  Four identical cairns made one sixth of the falsification surface unreadable
  for the alpha's whole life with every test passing. Brain `dog#E93/E95/E101`
  is three variants of this lesson. Audit presentation separately from logic.
- **`tools/shoot.mjs` is how you judge anything visual** — fixed seed, position
  and sim time, so two runs differ only by your edit. Do not try to aim the
  camera by rotation: the page's own rAF loop overwrites `sim.player.yaw` every
  frame. Frame by POSITION; default facing is `-z`, so stand south of the
  subject, and pick the offset off the blocked grid or you will stand inside a
  tree. The comment in that file has the full account.
- **Constant roll count is the house rule.** Anything that gates an `rng` draw
  is save state. When you need to suppress something, draw unconditionally and
  suppress the effect — see `sim.noChatter` in `party.js` for the pattern and
  the test that holds it.
- **Negative-control every guard, and check the control itself.** One control
  in that session was wrong in a way that made a live guard look inert; it only
  came right when the defect was reproduced the way it had actually occurred.
- **Never hand-write a Brain proposal.** `brain mine` prints the schema; a
  remembered shape parses as an empty entry. `brain doctor` after any sync. A
  provenance field that negates a verification verb ("not verified: whether X")
  is held by the steward — phrase open scope as "Open, and outside what this
  entry claims: whether X".

Ship as `seven-0.26.0`: `node tools/stamp-version.mjs 0.26.0`, then
`bash tests/run-all.sh` as the gate. The `deceived` row in balance is RED and
is the owner's open difficulty decision — do not tune constants to make it
pass. Commit on the branch; do not merge to `main` or publish without asking.

When 0.26 is done, say so and stop. The next step is not code — it is a human
playing a day, and no test in this repo can substitute for it.
