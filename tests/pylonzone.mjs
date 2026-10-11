// pylonzone.mjs — in Seven a lit pylon shields its area from depth for 36 hours, then burns out.
import { createRun, activatePylon, tickLucidity, areaShielded, pylonBurn, PYLON_BURN, PYLON_RADIUS } from "../src/state.js";
import { createExpedition } from "../src/expedition.js";
import { generateTrail, areaOfRow } from "../src/trail.js";
import { worldToCell } from "../src/world.js";
import { serializeRun, deserializeRun } from "../src/save.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

function setup(area = 2) {
  const world = generateTrail(21);
  const sim = createRun({ seed: 21, world });
  sim.seven = true;
  sim.expedition = createExpedition();
  sim.time = 600;                                   // past the opening calm
  const p = sim.pylons.find((x) => x.area === area);
  return { sim, p };
}
function light(sim, p) {
  const helper = sim.companions[0];
  sim.player.x = p.x; sim.player.z = p.z; helper.x = p.x + 1; helper.z = p.z;
  activatePylon(sim, sim.player);
  activatePylon(sim, helper);
  assert(p.spent && p.litAt === sim.time, "the pylon did not light");
}
const rateAt = (sim, at) => {
  const ch = sim.companions[2];
  ch.x = at.x; ch.z = at.z; ch.lucidity = 90; ch.hallucinating = false; ch.steadyUntil = 0; ch.decayPausedUntil = 0;
  const party = sim.party, keep = sim.player; sim.party = [ch]; sim.player = ch;
  const r = tickLucidity(sim, ch, 1); sim.player = keep; sim.party = party; return r;
};

check("a lit pylon cancels depth for its area, and only its area", () => {
  const { sim, p } = setup(2);
  const spot = { x: p.x, z: p.z };
  const before = rateAt(sim, spot);
  light(sim, p);
  assert(areaShielded(sim, spot), "the pylon's own spot is not shielded");
  const after = rateAt(sim, spot);
  assert(after < before, `drain did not drop under a lit pylon (${before} -> ${after})`);
  const other = sim.pylons.find((x) => x.area === 4);
  assert(!areaShielded(sim, other), "a pylon in area 3 shielded area 5");
});
check("it burns for 36 clock hours, then goes out", () => {
  const { sim, p } = setup(2);
  light(sim, p);
  sim.time += PYLON_BURN * 0.99;
  assert(pylonBurn(sim, p) > 0 && areaShielded(sim, p), "burnt out early");
  sim.time += PYLON_BURN * 0.02;
  assert(pylonBurn(sim, p) === 0 && !areaShielded(sim, p), "still burning after 36 hours");
});
check("the burn survives a save", () => {
  const { sim, p } = setup(1);
  light(sim, p);
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  const p2 = back.pylons.find((x) => x.id === p.id);
  assert(p2 && p2.litAt === p.litAt && p2.area === p.area, `pylon after resume: ${JSON.stringify(p2)}`);
  assert(areaShielded(back, p2), "the shield did not survive the save");
});
check("pylon areas agree with the map", () => {
  const { sim } = setup();
  for (const p of sim.pylons) assert(areaOfRow(worldToCell(p.x, p.z, sim.world.grid).cz) === p.area, `${p.id} is labelled area ${p.area}`);
});
check("the basin's pylons are unchanged: no burn, no area shield", () => {
  const sim = createRun({ seed: 5 });
  const p = sim.pylons[0];
  sim.player.x = p.x; sim.player.z = p.z; sim.companions[0].x = p.x + 1; sim.companions[0].z = p.z;
  activatePylon(sim, sim.player); activatePylon(sim, sim.companions[0]);
  assert(p.spent && p.litAt === undefined && !areaShielded(sim, p), "a basin pylon gained a Seven burn");
});

if (failures.length) { console.log(`pylonzone: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`pylonzone: ${passed} passed`);
