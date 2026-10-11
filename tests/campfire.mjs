// campfire.mjs — Seven's camp: one at a time, a woodpile, and a fire that lasts a night if stocked.
import { createRun, buildFire, feedFire, tickFire, nightFactor, GAME_HOUR, SEVEN_CAMP_RADIUS, FIRE_FUEL_MAX } from "../src/state.js";
import { createExpedition } from "../src/expedition.js";
import { generateTrail } from "../src/trail.js";
import { createCamp, depositWood, dismantleCamp, makeCamp, campIds } from "../src/seven.js";
import { serializeRun, deserializeRun } from "../src/save.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const R = SEVEN_CAMP_RADIUS;

function setup() {
  const world = generateTrail(11);
  const sim = createRun({ seed: 11, world });
  sim.seven = true;
  sim.expedition = createExpedition();
  sim.camp = createCamp(world.camp);
  sim.player.x = sim.camp.x; sim.player.z = sim.camp.z;
  return sim;
}
const burnHours = (sim, h) => { for (let t = 0; t < h * GAME_HOUR; t += 0.1) tickFire(sim, 0.1); };

check("wood counts once it is carried back: walking into camp stacks it on the pile", () => {
  const sim = setup();
  sim.player.x += 40; sim.wood = 5;
  assert(depositWood(sim, R) === 0 && sim.camp.pile === 0, "wood went on the pile from forty metres away");
  sim.player.x = sim.camp.x;
  assert(depositWood(sim, R) === 5 && sim.camp.pile === 5 && sim.wood === 0, "wood was not stacked at camp");
});
check("the fire is lit from the pile, at the camp, and a lit one lasts three hours", () => {
  const sim = setup();
  sim.wood = 10;   // carried, not stacked: does not count
  assert(buildFire(sim).reason === "no-wood", "lit a fire from wood still on someone's back");
  depositWood(sim, R);
  sim.player.x += 40;
  assert(buildFire(sim).reason === "no-camp", "lit the camp's fire from forty metres away");
  sim.player.x = sim.camp.x;
  assert(buildFire(sim).ok && sim.fire && sim.camp.pile === 8, "lighting did not take two wood from the pile");
  assert(Math.abs(sim.fire.x - sim.camp.x) < 1e-9, "the fire is not at the camp");
  burnHours(sim, 2.9);
  assert(sim.fire.fuel > 0, "a lit fire died before three hours");
  burnHours(sim, 0.2);
  assert(sim.fire.fuel === 0, "a lit fire outlasted three hours unfed");
});
check("a fully stocked fire reaches morning; feeding draws the pile even for a fire that is not there", () => {
  const sim = setup();
  sim.wood = 12; depositWood(sim, R);
  buildFire(sim);
  for (let i = 0; i < 8; i++) feedFire(sim);
  assert(Math.abs(sim.fire.fuel - FIRE_FUEL_MAX) < 1e-9, `fuel ${sim.fire.fuel} after stocking`);
  burnHours(sim, 11.9);
  assert(sim.fire.fuel > 0, "a full fire did not last the night");
  const before = sim.camp.pile;
  sim.fire = null;                       // a believed fire with nothing there
  const r = feedFire(sim);
  assert(r.ok && !r.fed && sim.camp.pile === before - 1, "feeding nothing did not cost wood: the pile would be a tell");
});
check("the fire shields the night inside the campsite only", () => {
  const sim = setup();
  sim.wood = 4; depositWood(sim, R); buildFire(sim);
  sim.time = 18 * GAME_HOUR;             // midnight
  assert(nightFactor(sim, sim.player) === 0, "no shield at the fire");
  const away = { x: sim.camp.x + R + 3, z: sim.camp.z };
  assert(nightFactor(sim, away) > 0.9, "the shield reached past the campsite");
});
check("one camp at a time: take it down before making it again", () => {
  const sim = setup();
  sim.wood = 6; depositWood(sim, R); buildFire(sim);
  assert(makeCamp(sim).reason === "already", "made a second camp while one stands");
  sim.player.x += 40;
  assert(dismantleCamp(sim, R).reason === "away", "took the camp down from forty metres away");
  sim.player.x = sim.camp.x;
  const pile = sim.camp.pile;
  assert(dismantleCamp(sim, R).ok && !sim.camp.built && sim.fire === null && sim.wood === pile, "taking camp down did not douse the fire and carry the pile");
  assert(buildFire(sim).reason === "no-camp", "lit a fire with no camp");
  assert(campIds(sim, R).length === 0, "somebody 'stayed at camp' while there was no camp");
  sim.player.x += 30;
  assert(makeCamp(sim).ok && sim.camp.built && Math.abs(sim.camp.x - sim.player.x) < 1e-9, "the new camp is not where the lead stands");
});
check("the camp and its pile survive a save", () => {
  const sim = setup();
  sim.wood = 7; depositWood(sim, R);
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  assert(back && back.camp && back.camp.pile === 7 && back.camp.built, `camp after resume: ${JSON.stringify(back && back.camp)}`);
});

if (failures.length) { console.log(`campfire: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`campfire: ${passed} passed`);
