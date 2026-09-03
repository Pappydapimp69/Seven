// triggers.mjs — does the trigger index actually fire on the mistakes it exists for?
//
// This index is a claim: that every failure made while building THE WOODS was
// already recorded somewhere, and the only reason none of them surfaced is that
// the corpus is indexed by CONCLUSION rather than by SITUATION. The way to test
// a claim like that is to replay the situations and see what fires.
//
// Two numbers, and the second is the one that decays first:
//
//   RECALL    — of the mistakes actually made, how many would have been caught
//               before the edit. This is what the index is for.
//   PRECISION — of the trivial edits, how many it stays quiet on. A checklist
//               that fires on everything is noise, and noise is how a checklist
//               stops being read. Adding triggers is easy and always improves
//               recall; this is the number that stops it becoming a wall.
//
// Run: node tests/triggers.mjs

import { TRIGGERS, PREFLIGHT } from "../tools/triggers.mjs";

// Every entry is a real mistake from the 2026-08-30 session, phrased the way it
// sat in my head at the moment I made it — not the way the lesson was later
// filed. That gap IS the thing being tested.
const MISTAKES = [
  ["changing a default", "DEFAULT_HFOV 90 -> 78 left the pause ladder and main.js on the old value"],
  ["adding a field", "sim.woods gated branches and was nearly not save state"],
  ["play again", "a new run one press from the verdict, mounting a renderer each time"],
  ["setting once", "camp fog set at build time, overwritten by the per-frame drift"],
  ["adding a verb", "the woods work prompt had to outrank the moss or starve"],
  ["sentinel", "the camp's reserved seed had no consumer and regenerated a basin"],
  ["forking", "mirage and seven shared one origin and one set of storage keys"],
  ["adding a guard", "four guards were inert on first write"],
  ["reading source in a test", "two fixed-character windows expired as their subjects grew"],
  ["passing a callback", "nearMiss drew per actor, making a two-draw function data-dependent"],
  ["timing", "the nightfall measured elapsed off the rAF timestamp and went negative"],
  ["known failure", "balance sat mid-file under set -e and deleted the browser tier"],
  ["renaming a project", "the deploy verifier matched /mirage-/ and verified nothing"],
  ["starting work", "built the whole alpha without fetching main, where a rival already sat"],
];

// Edits this must stay silent on. Without these, adding triggers is free and
// the index grows until nobody reads it.
const TRIVIAL = [
  ["renaming a css class", "no ripple"],
  ["fixing a typo in a comment", "no ripple"],
  ["reformatting whitespace", "no ripple"],
  ["updating a docs link", "no ripple"],
];

const match = (q) => TRIGGERS.filter((t) => t.when.some((w) => q.toLowerCase().includes(w)));

let recall = 0, quiet = 0;
const misses = [], noise = [];
for (const [phrase, why] of MISTAKES) {
  if (match(phrase).length) recall++;
  else misses.push(`${phrase} — ${why}`);
}
for (const [phrase] of TRIVIAL) {
  if (!match(phrase).length) quiet++;
  else noise.push(phrase);
}

console.log(`recall:    ${recall}/${MISTAKES.length} real mistakes fire before the edit`);
console.log(`precision: ${quiet}/${TRIVIAL.length} trivial edits stay quiet`);

const fails = [];
if (recall < MISTAKES.length) fails.push(`no trigger fires for: ${misses.join(" | ")}`);
if (noise.length) fails.push(`fires on trivial edits: ${noise.join(", ")}`);
// A pre-flight nobody can enumerate is a pre-flight nobody runs.
if (PREFLIGHT.length < 4 || PREFLIGHT.length > 8) {
  fails.push(`the pre-flight is ${PREFLIGHT.length} items — under 4 it is not a list, over 8 it is not read`);
}
for (const t of TRIGGERS) {
  if (!t.from) fails.push(`a trigger with no source entry: "${t.ask}"`);
  // It holds a QUESTION and a POINTER. The moment it holds explanations it is a
  // second copy of Brain, and a second copy drifts from the first — which is
  // literally the first entry in this table.
  if (t.then.length > 320) fails.push(`a trigger is explaining rather than pointing: "${t.ask}"`);
}

if (fails.length) { console.log(); for (const f of fails) console.log("  ✗ " + f); process.exit(1); }
console.log("triggers: OK — the index fires on what it was built from, and stays quiet otherwise");
