// tasks.js — what each companion is doing today, and doing it. Pure: no DOM.
//
// docs/blueprint-0.35: the player is a member of the team, not a commander.
// Tasks are set at the camp at DAWN and DUSK and nowhere else. A task is a run
// of bounded CHUNKS (one chop, one load of wood); a companion starts a chunk
// only if it fits before nightfall, and otherwise walks back to camp. In the
// field the lead can only nudge: a companion who is called finishes the chunk
// in their hands first, then drops the task and comes.
//
// Day tasks:   free (their own business), chop, gather, camp
// Night tasks: sleep, watch (keep the fire fed), work (carry on, at night risk), free
//
// Chopping and gathering are real sim actions on the real deadfall and trees;
// gathered wood is CARRIED by the gatherer and only counts once it is on the
// pile. No rng except the wood yield a felled tree already draws.

import { SKILL_MAX } from "./seven.js?v=seven-0.37.0";

export const DAY_TASKS = Object.freeze(["free", "chop", "gather", "camp"]);
export const NIGHT_TASKS = Object.freeze(["sleep", "watch", "work", "free"]);
export const TASK_LABEL = Object.freeze({
  free: "Own business", chop: "Chop the deadfall", gather: "Gather wood", camp: "Stay at camp",
  sleep: "Sleep", watch: "Keep watch (feed the fire)", work: "Keep working", follow: "With you",
});

/** Hours a chunk of each task takes, in clock time. */
export const CHUNK_HOURS = Object.freeze({ chop: 0.5, gather: 1 });

/** Start a task. `day` is the expedition day it was set on. */
export function setTask(c, kind, day, prior = null) {
  c.task = { kind, day, chunk: 0, carry: 0, target: null, work: prior };
}

/** Night "work" carries on with whatever the day task was. */
export function effectiveKind(c) {
  if (!c.task) return "free";
  if (c.task.kind === "work") return c.task.work || "free";
  return c.task.kind;
}

/** A companion is mid-chunk: hands on the tree or the deadfall. */
export function inChunk(c) {
  return !!(c.task && c.task.chunk > 0);
}

// ---- practice: skills grow with the work (blueprint 0.35) -------------------
// A level comes after about PRACTICE_CHUNKS finished chunks of that work, with
// a per-person, per-level spread DERIVED from a hash (no rng draw, so the
// stream never depends on who practised). A fake learns FAKE_LEARNS times as
// fast (IDEAS: the fake is better at the job) — the edge hides inside ordinary
// growth: suspicious, never certain. Capped at SKILL_MAX like training.
export const PRACTICE_CHUNKS = 6;
export const FAKE_LEARNS = 2;
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
export function chunksForLevel(c, skill, level) {
  const spread = 0.7 + 0.6 * hash01(`${c.id}:${skill}:${level}`);
  return (PRACTICE_CHUNKS * spread) / (c.replacedDay != null ? FAKE_LEARNS : 1);
}
/** One finished chunk of work in `skill`. Returns the new level on a level-up, else 0. */
export function practice(c, skill) {
  if (!c || c.isPlayer) return 0;
  const level = (c.skills && c.skills[skill]) || 0;
  if (level >= SKILL_MAX) return 0;
  c.practice = c.practice || {};
  c.practice[skill] = (c.practice[skill] || 0) + 1;
  if (c.practice[skill] < chunksForLevel(c, skill, level)) return 0;
  c.practice[skill] = 0;
  c.skills = { ...(c.skills || {}), [skill]: level + 1 };
  return level + 1;
}
