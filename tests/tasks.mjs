// tasks.mjs — companions do the day's work: chop, gather, keep camp, keep watch.
import { createRun, tick, chopDeadfall, tickLucidity, GAME_HOUR, CHOP_PROGRESS, CHOP_HOLD, sevenClock } from "../src/state.js";
import { createExpedition } from "../src/expedition.js";
import { generateTrail } from "../src/trail.js";
import { createCamp } from "../src/seven.js";
import { setTask, inChunk } from "../src/tasks.js";
import { serializeRun, deserializeRun } from "../src/save.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const still = { move: { x: 0, z: 0 } };

function setup(seed = 31) {
  const world = generateTrail(seed);
  const sim = createRun({ seed, world });
  sim.seven = true;
  sim.expedition = createExpedition();
  sim.camp = createCamp(world.camp);
  sim.time = 5 * GAME_HOUR;            // 11:00, long before dusk
  for (const c of sim.companions) { c.x = sim.camp.x + 1; c.z = sim.camp.z + 1; c.skills = {}; c.lucidity = 100; }
  sim.player.x = sim.camp.x; sim.player.z = sim.camp.z;
  return sim;
}
const run = (sim, seconds) => { for (let t = 0; t < seconds; t += 0.1) tick(sim, 0.1, still); };
const nearest = (sim, c) => [...sim.deadfalls].sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];

check("a chopper walks to the deadfall and chops it", () => {
  const sim = setup();
  const c = sim.companions[0];
  setTask(c, "chop", 1);
  const d = nearest(sim, c);
  run(sim, 90);
  assert(d.progress > 0, `no progress after 90s (companion at ${c.x.toFixed(1)},${c.z.toFixed(1)}, deadfall ${d.x.toFixed(1)},${d.z.toFixed(1)})`);
});
check("a gatherer fells a tree and carries the wood onto the pile", () => {
  const sim = setup();
  const c = sim.companions[1];
  setTask(c, "gather", 1);
  run(sim, 160);
  assert(sim.camp.pile > 0, `pile ${sim.camp.pile}, carrying ${c.task.carry}`);
  assert(sim.wood === 0, "gathered wood went into the lead's pack");
});
check("a chunk that will not fit before dusk is not started", () => {
  const sim = setup();
  sim.time = 11.8 * GAME_HOUR;         // 17:48 — less than half an hour of light
  const c = sim.companions[0];
  setTask(c, "chop", 1);
  const d = nearest(sim, c);
  run(sim, 40);
  assert(!(d.progress > 0), "chopped into the dusk on a day task");
  assert(Math.hypot(c.x - sim.camp.x, c.z - sim.camp.z) < 6, "did not head back to camp");
});
check("night work carries the day's task on into the dark", () => {
  const sim = setup();
  sim.time = 14 * GAME_HOUR;           // 20:00
  const c = sim.companions[0];
  setTask(c, "work", 1, "chop");
  const d = nearest(sim, c);
  run(sim, 90);
  assert(d.progress > 0, "a night worker did not chop");
});
check("called mid-chop, they finish the chop first, then drop the task", () => {
  const sim = setup();
  const c = sim.companions[0];
  setTask(c, "chop", 1);
  let guard = 0;
  while (!inChunk(c) && guard++ < 2000) tick(sim, 0.1, still);
  assert(inChunk(c), "never started chopping");
  const d = nearest(sim, c);
  const before = d.progress || 0;
  c.summonBy = sim.player.id; c.summonUntil = sim.time + 600;
  run(sim, CHOP_HOLD + 1);
  assert((d.progress || 0) > before, "the chop in hand was abandoned");
  run(sim, 1);
  assert(c.task === null, "still on the task after the chop was done");
});
check("the lead's chop does not count a tasked chopper twice", () => {
  const sim = setup();
  const c = sim.companions[0];
  const d = sim.deadfalls[0];
  setTask(c, "chop", 1);
  c.x = d.x; c.z = d.z + 3; sim.player.x = d.x + 1; sim.player.z = d.z + 2.6;
  const before = d.progress || 0;
  chopDeadfall(sim);
  assert(Math.abs((d.progress - before) - CHOP_PROGRESS) < 1e-9, `lead's chop added ${d.progress - before}`);
});
check("sleeping through the night drains less than staying up", () => {
  const sim = setup();
  sim.time = 16 * GAME_HOUR;           // 22:00
  const a = sim.companions[0], b = sim.companions[1];
  for (const x of [a, b]) { x.x = sim.camp.x + 30; x.z = sim.camp.z; x.drain = 1; x.lucidity = 90; x.steadyUntil = 0; x.decayPausedUntil = 0; }
  setTask(a, "sleep", 1); setTask(b, "free", 1);
  assert(tickLucidity(sim, a, 1) < tickLucidity(sim, b, 1), "a sleeper drained as fast as someone awake");
});
check("a task, its chunk and carried wood survive a save", () => {
  const sim = setup();
  const c = sim.companions[2];
  setTask(c, "gather", 1); c.task.carry = 3; c.task.chunk = 7;
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  const c2 = back.companions.find((x) => x.id === c.id);
  assert(c2.task && c2.task.kind === "gather" && c2.task.carry === 3 && c2.task.chunk === 7, `task after resume: ${JSON.stringify(c2.task)}`);
});

if (failures.length) { console.log(`tasks: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`tasks: ${passed} passed`);
