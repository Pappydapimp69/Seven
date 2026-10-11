// practice.mjs — skills grow with the work; a fake grows faster; a held fake makes the next loss likelier.
import { practice, chunksForLevel, PRACTICE_CHUNKS, FAKE_LEARNS } from "../src/tasks.js";
import { SKILL_MAX } from "../src/seven.js";
import { createExpedition, chooseDisappearance, HOLD_FAKE_BONUS } from "../src/expedition.js";
import { createRun, chopDeadfall } from "../src/state.js";
import { generateTrail } from "../src/trail.js";
import { serializeRun, deserializeRun } from "../src/save.js";

let passed = 0; const failures = [];
const check = (n, f) => { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const chunksTo = (c, skill, level) => { let n = 0; while (((c.skills && c.skills[skill]) || 0) < level && n < 500) { practice(c, skill); n++; } return n; };

check("a level comes after a few chunks of work, about PRACTICE_CHUNKS, never instantly", () => {
  const c = { id: "c3", skills: {} };
  const n = chunksTo(c, "cut", 1);
  assert(n >= Math.ceil(PRACTICE_CHUNKS * 0.7) && n <= Math.ceil(PRACTICE_CHUNKS * 1.3), `took ${n} chunks`);
});
check("the spread is per person: two people do not level on the same chunk", () => {
  const lens = new Set(["c1", "c2", "c3", "c4", "c5"].map((id) => Math.ceil(chunksForLevel({ id }, "cut", 0))));
  assert(lens.size >= 2, "everyone needs exactly the same chunks — the growth is a clock, not a person");
});
check("a fake learns faster, and the same person's numbers otherwise", () => {
  const real = { id: "c2", skills: {} }, fake = { id: "c2", skills: {}, replacedDay: 1 };
  const nr = chunksTo(real, "cut", 3), nf = chunksTo(fake, "cut", 3);
  assert(nf < nr, `fake ${nf} chunks vs real ${nr}`);
  assert(Math.abs(nr / nf - FAKE_LEARNS) < 0.5, `fake learns ${(nr / nf).toFixed(2)}x, expected about ${FAKE_LEARNS}x`);
});
check("growth stops at the cap", () => {
  const c = { id: "c1", skills: { cut: SKILL_MAX } };
  assert(practice(c, "cut") === 0 && c.skills.cut === SKILL_MAX, "grew past the cap");
});
check("chopping is practice for every pair of hands on it, never the lead's", () => {
  const world = generateTrail(7); const sim = createRun({ seed: 7, world });
  sim.seven = true; sim.expedition = createExpedition();
  const d = sim.deadfalls[0];
  sim.player.x = d.x; sim.player.z = d.z + 2.6;
  for (const c of sim.companions) { c.x = d.x + 200; c.z = d.z; c.skills = {}; c.hallucinating = false; }
  const h = sim.companions[0]; h.x = d.x + 1; h.z = d.z + 2;
  chopDeadfall(sim);
  assert(h.practice && h.practice.cut === 1, "a helper got no practice");
  assert(!sim.player.practice, "the lead was given practice");
});
check("holding a fake makes the next night's loss likelier", () => {
  const e = createExpedition({ day: 3, replacementChance: 0.45 });
  const roll = (held) => { e.heldFakes = held; let i = 0; const rng = () => [0.55, 0.1][i++ % 2]; return chooseDisappearance(e, rng, ["c1", "c2", "c3"]); };
  assert(roll(0) === null, "0.55 against 0.45 took someone with no fake held");
  assert(roll(1) !== null, `0.55 against ${0.45 + HOLD_FAKE_BONUS} spared everyone with a fake held`);
});
check("practice survives a save", () => {
  const sim = createRun({ seed: 8 }); sim.expedition = createExpedition();
  sim.companions[1].practice = { cut: 4 };
  const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(sim))));
  assert(back.companions[1].practice && back.companions[1].practice.cut === 4, "practice lost across a save");
});

if (failures.length) { console.log(`practice: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`practice: ${passed} passed`);
