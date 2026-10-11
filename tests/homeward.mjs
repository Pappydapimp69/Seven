// homeward.mjs — at the edge: real members + 1 pylons; a fake cannot light one; one mistake.
import { createRun } from "../src/state.js";
import { createExpedition } from "../src/expedition.js";
import { startHomeward, lightHomePylon, homewardOver, finishHomeward, realCompanions } from "../src/seven.js";
import { serializeRun, deserializeRun } from "../src/save.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
function setup(fakes = []) {
  const sim = createRun({ seed: 4 }); sim.seven = true; sim.expedition = createExpedition();
  for (const c of sim.companions) c.replacedDay = fakes.includes(c.id) ? 2 : null;
  return sim;
}

check("the pylons number the real members plus one", () => {
  const sim = setup(["c2", "c4"]);
  assert(startHomeward(sim).pylons === realCompanions(sim).length + 1 && sim.homeward.pylons === 4, `pylons ${sim.homeward.pylons}`);
});
check("a real member goes home; a fake cannot light one, and the pylon is spent", () => {
  const sim = setup(["c2"]); startHomeward(sim);
  const a = lightHomePylon(sim, "c1"), b = lightHomePylon(sim, "c2");
  assert(a.real && sim.homeward.saved.includes("c1"), "a real member did not go home");
  assert(!b.real && sim.homeward.gone.includes("c2") && b.pylonsLeft === sim.homeward.pylons, "a fake lit a pylon, or did not spend it");
  assert(lightHomePylon(sim, "c1") === null, "the same person was tried twice");
});
check("exactly one mistake: try one fake and every real member still gets home", () => {
  const sim = setup(["c3"]); startHomeward(sim);
  for (const id of ["c3", "c1", "c2", "c4", "c5"]) lightHomePylon(sim, id);
  assert(sim.homeward.saved.length === 4, `saved ${sim.homeward.saved.length} of 4 real`);
  const d = finishHomeward(sim);
  assert(sim.status === "won" && sim.ending === "home" && d.leftBehind === 0, JSON.stringify(d));
});
check("two mistakes leave a real member at the edge", () => {
  const sim = setup(["c3", "c4"]); startHomeward(sim);          // 3 real -> 4 pylons
  for (const id of ["c3", "c4", "c1", "c2"]) lightHomePylon(sim, id);
  assert(homewardOver(sim), "pylons left after four tries");
  const d = finishHomeward(sim);
  assert(d.leftBehind === 1 && sim.ending === "home", JSON.stringify(d));
});
check("with nobody real left, the lead stands at the edge alone", () => {
  const sim = setup(["c1", "c2", "c3", "c4", "c5"]); startHomeward(sim);   // 0 real -> 1 pylon
  lightHomePylon(sim, "c1");
  assert(homewardOver(sim), "the edge is not over");
  finishHomeward(sim);
  assert(sim.status === "lost" && sim.ending === "alone", sim.ending);
});
check("the edge survives a save", () => {
  const sim = setup(["c2"]); startHomeward(sim); lightHomePylon(sim, "c1");
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  assert(back.homeward && back.homeward.saved[0] === "c1" && back.homeward.pylons === sim.homeward.pylons, JSON.stringify(back.homeward));
});

if (failures.length) { console.log(`homeward: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`homeward: ${passed} passed`);
