// chop.mjs — a deadfall in Seven comes down chop by chop, faster with more hands.
import { createRun, chopDeadfall, holdTimeFor, CHOP_HOLD, DEADFALL_HOLD_TIME, CHOP_PROGRESS } from "../src/state.js";
import { createExpedition } from "../src/expedition.js";
import { generateTrail } from "../src/trail.js";
import { serializeRun, deserializeRun } from "../src/save.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

function setup(seed = 7) {
  const world = generateTrail(seed);
  const sim = createRun({ seed, world });
  sim.seven = true;
  sim.expedition = createExpedition();
  const d = sim.deadfalls[0];
  sim.player.x = d.x; sim.player.z = d.z + 2.6;     // on the trail, just south of it
  for (const c of sim.companions) { c.x = d.x + 200; c.z = d.z + 200; c.hallucinating = false; c.skills = {}; }
  return { sim, d };
}
const chopsToClear = (sim, d) => { let n = 0; while (!d.cleared && n < 100) { chopDeadfall(sim); n++; } return n; };

check("alone and unskilled, a deadfall takes 16 chops (8 clock hours)", () => {
  const { sim, d } = setup();
  const n = chopsToClear(sim, d);
  assert(n === Math.ceil(1 / CHOP_PROGRESS), `took ${n} chops`);
  assert(d.cells.every((c) => !sim.world.blocked[c.cz * sim.world.grid + c.cx]), "the way did not open");
});
check("more hands finish it in fewer chops", () => {
  const { sim, d } = setup();
  for (const c of sim.companions.slice(0, 3)) { c.x = d.x + 1; c.z = d.z + 2; }
  assert(chopsToClear(sim, d) === 4, "four pairs of hands did not take a quarter of the chops");
});
check("cut skill makes each chop count for more", () => {
  const a = setup(), b = setup();
  const helperA = a.sim.companions[0], helperB = b.sim.companions[0];
  for (const [h, d] of [[helperA, a.d], [helperB, b.d]]) { h.x = d.x + 1; h.z = d.z + 2; }
  helperB.skills = { cut: 3 };
  assert(chopsToClear(b.sim, b.d) < chopsToClear(a.sim, a.d), "a skilled logger did not chop faster");
});
check("a hallucinating mind does not help", () => {
  const { sim, d } = setup();
  const h = sim.companions[0]; h.x = d.x + 1; h.z = d.z + 2; h.hallucinating = true;
  assert(chopsToClear(sim, d) === 16, "a gone mind added to the chopping");
});
check("progress stays on the deadfall, through a save", () => {
  const { sim, d } = setup();
  for (let i = 0; i < 5; i++) chopDeadfall(sim);
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  assert(back, "the save did not load");
  const d2 = back.deadfalls.find((x) => x.id === d.id);
  assert(Math.abs(d2.progress - 5 * CHOP_PROGRESS) < 1e-9, `progress after resume was ${d2.progress}`);
  assert(!d2.cleared && back.world.blocked[d2.cells[0].cz * back.world.grid + d2.cells[0].cx], "a half-chopped deadfall came back open");
});
check("Seven prices a chop in clock time; the basin keeps its hold", () => {
  const { sim } = setup();
  assert(holdTimeFor({ gatherKind: "deadfall" }, sim) === CHOP_HOLD, "Seven's chop hold");
  assert(holdTimeFor({ gatherKind: "deadfall" }, createRun({ seed: 1 })) === DEADFALL_HOLD_TIME, "the basin's hold changed");
});

if (failures.length) { console.log(`chop: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`chop: ${passed} passed`);
