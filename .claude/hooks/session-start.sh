#!/bin/bash
# SessionStart — bring the cognitive system up before any work starts.
#
# CLAUDE.md tells every session to run `brain query` before non-trivial work
# and to write lessons back. In a fresh container none of that exists: the CLI
# is not on PATH, the knowledge cache is not cloned, and the project is not
# linked. The instruction then reads as "the system is empty" rather than "the
# system is not installed", which is the single most expensive way to start.
#
# NEVER BLOCKS. Every step is best-effort and the script always exits 0. A
# session that cannot reach GitHub should still start; it just starts without
# Brain, and says so. `set -e` is deliberately absent for the same reason.
set -uo pipefail

PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CACHE="$HOME/.brain"
BRAIN="$CACHE/Brain/bin/brain"
note() { echo "[brain-hook] $*" >&2; }

# ---- 1. the CLI itself ------------------------------------------------------
# Cloned, not vendored: Brain is its own repo and a copy here would drift from
# it, which is the first lesson in its own trigger index.
if [ ! -f "$BRAIN" ]; then
  note "cloning Brain into $CACHE/Brain"
  mkdir -p "$CACHE"
  git clone --depth 1 https://github.com/Pappydapimp69/Brain.git "$CACHE/Brain" \
    >/dev/null 2>&1 || note "clone failed — continuing without Brain"
fi

if [ -f "$BRAIN" ]; then
  # Puts `brain` on PATH. Idempotent, and self-updates on the way.
  python3 "$BRAIN" install >/dev/null 2>&1 || note "brain install failed"

  # ---- 2. link THIS project, in full mode ----------------------------------
  # full = may push to the knowledge repos' main. read-only would make every
  # write in a session land in a local store nobody ever promotes.
  # `link` prompts interactively on a first link with no --mode, so --mode is
  # always passed: a hook has no tty and would hang without it.
  if [ ! -f "$PROJECT/.brain/config.json" ]; then
    note "linking $PROJECT in full mode"
    ( cd "$PROJECT" && python3 "$BRAIN" link --mode full >/dev/null 2>&1 ) \
      || note "brain link failed"
  else
    # Already linked — make sure it is FULL, not a read-only link from before.
    if ! grep -q '"mode"[[:space:]]*:[[:space:]]*"full"' "$PROJECT/.brain/config.json" 2>/dev/null; then
      note "re-linking in full mode (was not full)"
      ( cd "$PROJECT" && python3 "$BRAIN" link --mode full >/dev/null 2>&1 ) \
        || note "brain re-link failed"
    fi
  fi

  # Terse by default, which is how this project is worked.
  ( cd "$PROJECT" && python3 "$BRAIN" stance brief >/dev/null 2>&1 ) || true

  ( cd "$PROJECT" && python3 "$BRAIN" status 2>&1 | head -1 >&2 ) || true
fi

# ---- 3. zanegpt -------------------------------------------------------------
# VENDORED, not installed: .claude/skills/zanegpt ships with the repo so
# /zanegpt works for anyone who clones it, with no marketplace step. This only
# reports, because a missing skill is a repo problem a hook must not paper over
# by fetching a copy that would then drift from upstream.
if [ -f "$PROJECT/.claude/skills/zanegpt/SKILL.md" ]; then
  note "zanegpt: vendored and present"
else
  note "zanegpt: MISSING from .claude/skills — /zanegpt will not resolve."
  note "  upstream is Pappydapimp69/Zanegpt (also a plugin marketplace)"
fi

exit 0
