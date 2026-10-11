// nightrisk.mjs — the night takes the exposed first: awake, alone, outside the fire.
import { createRun } from "../src/state.js";
import { createExpedition, chooseDisappearance } from "../src/expedition.js";
import { generateTrail } from "../src/trail.js";
import { createCamp, nightExposure, EXPOSURE } from "../src/seven.js";
import { setTask } from "../src/tasks.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
function setup() {
  const world = generateTrail(13); const sim = createRun({ seed: 13, world });
  sim.expedition = createExpedition({ day: 3 }); sim.camp = createCamp(world.camp);
  for (const c of sim.companions) { c.x = sim.camp.x; c.z = sim.camp.z; setTask(c, "sleep", 2); }
  sim.fire = { x: sim.camp.x, z: sim.camp.z, fuel: 80 };
  return sim;
}

check("asleep at a lit fire weighs least; awake, away and cold weigh more", () => {
  const sim = setup();
  const [a, b, c] = sim.companions;
  setTask(b, "watch", 2);
  c.x += 60;
  const w = nightExposure(sim, 9);
  assert(w[a.id] === 1, `sleeper at the fire ${w[a.id]}`);
  assert(w[b.id] === EXPOSURE.awake, `watcher ${w[b.id]}`);
  assert(w[c.id] === EXPOSURE.away, `sleeper sixty metres out ${w[c.id]}`);
  sim.fire.fuel = 0;
  assert(nightExposure(sim, 9)[a.id] === EXPOSURE.coldCamp, "a dead fire did not raise the sleepers' exposure");
});
check("the one most exposed is taken far more often", () => {
  const counts = { c1: 0, c2: 0, c3: 0 };
  for (let i = 0; i < 300; i++) {
    const e = createExpedition({ day: 3, replacementChance: 1 });
    e.exposure = { c1: 1, c2: 1, c3: 6 };
    const rng = (() => { let k = 0; return () => [0.01, (i + 0.5) / 300][k++ % 2]; })();
    const r = chooseDisappearance(e, rng, ["c1", "c2", "c3"]);
    counts[r.missing.id]++;
  }
  assert(counts.c3 > 2 * (counts.c1 + counts.c2), `taken ${JSON.stringify(counts)}`);
});
check("with no exposure given, the pick is the same as before", () => {
  const e1 = createExpedition({ day: 3, replacementChance: 1 }), e2 = createExpedition({ day: 3, replacementChance: 1 });
  e2.exposure = { c1: 1, c2: 1, c3: 1 };
  for (const r of [0.1, 0.5, 0.9]) {
    const rng = () => r;
    assert(chooseDisappearance(e1, rng, ["c1", "c2", "c3"]).missing.id === chooseDisappearance(e2, rng, ["c1", "c2", "c3"]).missing.id, `even weights changed the pick at ${r}`);
  }
});

if (failures.length) { console.log(`nightrisk: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`nightrisk: ${passed} passed`);
