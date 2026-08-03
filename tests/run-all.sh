#!/usr/bin/env bash
# Run the full MIRAGE test suite. Exits non-zero on any failure.
#
# The smoke test needs Playwright + Chromium. If they are absent it is SKIPPED
# with a loud note rather than silently passing — a suite that quietly stops
# testing the 3D layer is worse than one that fails.
set -e
cd "$(dirname "$0")/.."

echo "== logic =="
node tests/logic.test.mjs
echo

echo "== save/resume (pure) =="
node tests/save.test.mjs
echo

echo "== hallucination rates (pure) =="
node tests/hallucination.test.mjs
echo

echo "== hallucination (does the player actually SEE the tells?) =="
node tests/hallucination.test.mjs
echo

echo "== balance (whole runs to a terminal state) =="
node tests/balance.mjs "${BALANCE_SEEDS:-12}"
echo

if [ -d /opt/pw-browsers ] && node -e 'require("/opt/node22/lib/node_modules/playwright")' 2>/dev/null; then
  echo "== smoke (real browser) =="
  node tests/smoke.mjs
  echo
  echo "== gamepad (real browser, fake pad) =="
  node tests/gamepad.mjs
  echo
  echo "== coop (real browser, split-screen) =="
  node tests/coop.mjs
  echo
  echo "== resume (real browser, save slot) =="
  node tests/resume.mjs
  echo
  echo "== menu nav (real browser, changing menu shape) =="
  node tests/menu-nav.mjs
  echo
  echo "== campaign (real browser, basin -> basin + save) =="
  node tests/campaign.mjs
else
  echo "== smoke + gamepad: SKIPPED — Playwright/Chromium not available here =="
  echo "   (the 3D layer was NOT exercised in this run)"
fi
echo

echo "ALL MIRAGE TESTS PASSED"
