// seven.mjs — pure tests for Seven's expedition-specific rules.

import { createRun, tickLucidity, depthOf, DEPTH_DRAIN } from "../src/state.js";
import { createExpedition } from "../src/expedition.js";
import { restCheck, FIRE_DAYLIGHT, nearbyIds, campIds, applyTeamLoadout, teamSkill, finalDecision, expeditionSummary, finalCount } from "../src/seven.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg} — got ${a}, expected ${b}`); }

// DEPTH: sanity is a place. Same mind, same seed, same ticks — only the ground
// it stands on differs — and the deeper one must lose more.
function drained(depthFrac, expedition = true) {
  const sim = createRun({ seed: 77, difficulty: "standard" });
  if (expedition) sim.expedition = createExpedition();
  sim.time = 600; // well past the dead-calm window
  const ch = sim.companions[0];
  const exitZ = -(sim.world.grid / 2 - 2) * sim.world.cell;
  ch.z = sim.world.camp.z - depthFrac * (sim.world.camp.z - exitZ);
  ch.lucidity = 90; ch.steadyUntil = 0;
  sim.party = [ch]; sim.player = ch; // alone in its own chain either way
  return tickLucidity(sim, ch, 1); // the rate this tick
}
check("depth: the far edge drains faster than camp, by the stated factor", () => {
  const camp = drained(0), edge = drained(1);
  assert(camp > 0, "no drain at camp — the test is not measuring anything");
  const ratio = edge / camp;
  assert(Math.abs(ratio - (1 + DEPTH_DRAIN)) < 1e-9, `edge/camp drain was ${ratio}, expected ${1 + DEPTH_DRAIN}`);
  assert(drained(0.5) > camp && drained(0.5) < edge, "drain is not monotone with depth");
});
check("depth: a run that is not an expedition keeps its exact rates", () => {
  eq(drained(1, false), drained(0, false), "a non-expedition drained differently by position");
  eq(depthOf(createRun({ seed: 1 }), { z: -999 }), 0, "depth is not 0 outside an expedition");
});

check("who was nearby and who stayed at camp come from real positions", () => {
  const sim = createRun({ seed: 91 });
  const [a, b, c] = sim.companions;
  sim.player.x = 0; sim.player.z = 0;
  a.x = 3; a.z = 0; b.x = 8; b.z = 0; c.x = 40; c.z = 0;
  const near = nearbyIds(sim, "you", 11);
  assert(near.includes(a.id) && near.includes(b.id) && !near.includes(c.id), `lead's neighbours wrong: ${near}`);
  const nearA = nearbyIds(sim, a.id, 3.5);
  assert(nearA.includes("you") && !nearA.includes(a.id) && !nearA.includes(b.id), `a's neighbours wrong: ${nearA}`);
  const camp = sim.world.camp;
  a.x = camp.x; a.z = camp.z; b.x = camp.x + 50; b.z = camp.z;
  const stayed = campIds(sim, 9);
  assert(stayed.includes(a.id) && !stayed.includes(b.id), `camp stayers wrong: ${stayed}`);
});

check("resting is a choice made at camp, and means the same to every mind", () => {
  const sim = createRun({ seed: 92 });
  sim.expedition = createExpedition();
  const camp = sim.world.camp;
  sim.player.x = camp.x; sim.player.z = camp.z;
  const here = restCheck(sim, 9);
  assert(here.ok && here.forfeits === sim.expedition.daylight, "could not rest at camp, or forfeit amount is wrong");
  sim.player.x = camp.x + 40;
  eq(restCheck(sim, 9).reason, "away", "rest allowed away from camp");
  // the answer must not depend on how clear the lead's head is
  sim.player.x = camp.x;
  sim.player.hallucinating = true; sim.player.lucidity = 0;
  assert(restCheck(sim, 9).ok, "a hallucinating lead was refused rest at camp: the refusal would be a tell");
  sim.expedition.phase = "night";
  eq(restCheck(sim, 9).reason, "no-day", "rest allowed outside the day");
  eq(restCheck(createRun({ seed: 93 }), 9).reason, "no-day", "rest allowed outside an expedition");
});
check("lighting a fire costs more daylight than keeping one", () => {
  assert(FIRE_DAYLIGHT.build > FIRE_DAYLIGHT.feed && FIRE_DAYLIGHT.feed > 0, "fire costs are not ordered build > feed > 0");
});

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
