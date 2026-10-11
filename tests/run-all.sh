#!/usr/bin/env bash
# run-all.sh — the pure suite (seconds), then the browser test if Playwright is here.
set -e
cd "$(dirname "$0")/.."
for t in world sim chronicle save triggers; do node tests/$t.mjs; done
node tests/bot.mjs "${BOT_SEEDS:-10}"
if [ -d /opt/pw-browsers ] && [ -d /opt/node22/lib/node_modules/playwright ]; then
  node tests/play.mjs
  node tests/view.mjs
else
  echo "play: SKIPPED — Playwright/Chromium not available here"
fi
