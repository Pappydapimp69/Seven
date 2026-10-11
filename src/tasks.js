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
