// seven.mjs — pure tests for Seven's expedition-specific rules.

import { createRun } from "../src/state.js";
import { createExpedition } from "../src/expedition.js";
import { applyTeamLoadout, teamSkill, finalDecision, expeditionSummary, finalCount } from "../src/seven.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg} — got ${a}, expected ${b}`); }

check("team loadouts assign different useful skills", () => {
  const trail = createRun({ seed: 51 });
  applyTeamLoadout(trail, "trail", { overwrite: true });
  const haul = createRun({ seed: 51 });
  applyTeamLoadout(haul, "haul", { overwrite: true });
  eq(trail.sevenTeam, "trail", "trail team id was not recorded");
  eq(haul.sevenTeam, "haul", "haul team id was not recorded");
  assert(teamSkill(trail, "scout") > teamSkill(haul, "scout"), "trail team should scout better than haul");
  assert(teamSkill(haul, "carry") > teamSkill(trail, "carry"), "haul team should carry better than trail");
});

check("loadout application preserves a saved custom team unless asked to overwrite", () => {
  const sim = createRun({ seed: 52 });
  sim.companions[0].skills = { scout: 99 };
  applyTeamLoadout(sim, "recovery");
  eq(sim.companions[0].skills.scout, 99, "resume-time loadout assignment overwrote saved skills");
  applyTeamLoadout(sim, "recovery", { overwrite: true });
  assert(sim.companions[0].skills.scout < 99, "explicit overwrite did not replace skills");
});

check("final choices produce distinct Seven endings", () => {
  const leave = createRun({ seed: 53 });
  leave.seven = true;
  leave.expedition = createExpedition();
  leave.expedition.missing.push({ id: "c1", recovered: false, abandoned: false });
  finalDecision(leave, "leave");
  eq(leave.status, "won", "leaving should end the run as a completion");
  eq(leave.ending, "leftSomeone", "leaving with somebody unresolved should be named");
  eq(leave.finalDecision.unresolved, 1, "unresolved count was wrong");
  eq(leave.finalDecision.finalCount.real, 5, "final count did not expose the real count");
  eq(leave.finalDecision.finalCount.pylons, 6, "final pylon count should be one more than real");

  const back = createRun({ seed: 54 });
  back.seven = true;
  back.expedition = createExpedition();
  back.expedition.missing.push({ id: "c2", recovered: false, abandoned: true });
  finalDecision(back, "return");
  eq(back.status, "lost", "turning back should be a failure branch");
  eq(back.ending, "turnedBack", "turning back with somebody behind should be named");

  const sealed = createRun({ seed: 55 });
  sealed.seven = true;
  sealed.expedition = createExpedition();
  finalDecision(sealed, "seal");
  eq(sealed.status, "won", "sealing should complete the run");
  eq(sealed.ending, "sealedClean", "sealing with everyone accounted for should be named");
});

check("expedition summary separates recovered, abandoned and unresolved", () => {
  const e = createExpedition();
  e.missing.push({ id: "c1", recovered: true, abandoned: false });
  e.missing.push({ id: "c2", recovered: false, abandoned: true });
  e.missing.push({ id: "c3", recovered: false, abandoned: false });
  const got = expeditionSummary(e);
  eq(got.missing, 3, "missing total wrong");
  eq(got.recovered, 1, "recovered total wrong");
  eq(got.abandoned, 1, "abandoned total wrong");
  eq(got.unresolved, 1, "unresolved total wrong");
});

check("the final count names how many are real, not which ones", () => {
  const e = createExpedition();
  e.missing.push({ id: "c1", recovered: false, abandoned: false });
  e.missing.push({ id: "c2", recovered: false, abandoned: true });
  e.missing.push({ id: "c3", recovered: true, abandoned: false });
  const count = finalCount(e, 6);
  eq(count.bodies, 6, "body count wrong");
  eq(count.real, 4, "real count wrong");
  eq(count.falseOrLost, 2, "false/lost count wrong");
  eq(count.pylons, 5, "pylons should be one more than the real count");
});

if (failures.length) {
  console.error(`seven: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`seven: ${passed} passed`);
