// camp.mjs — the authored map has to earn what the generator gave for free.
//
// generateWorld guarantees connectivity with an explicit repair pass and a
// validate() that re-derives it from scratch. buildCamp() opts out of all of
// that by placing cells by hand, so every guarantee it needs is asserted here
// instead. A cabin wall one cell too long seals a pocket and nothing complains.
//
// Run: node tests/camp.mjs

import { buildCamp, longestWalk, CAMP_SEED } from "../src/camp.js";
import { generateWorld, validate, floodFill, GRID, CELL } from "../src/world.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

// --- the shape contract -----------------------------------------------------
// save.js, render.js, state.js and party.js all take a world without caring
// where it came from. A missing or mistyped field surfaces far away as a NaN
// position or an invisible floor, so it is pinned here against the real thing.
check("the camp returns exactly the shape generateWorld does", () => {
  const camp = buildCamp();
  const basin = generateWorld(12345);
  for (const key of Object.keys(basin)) {
    assert(key in camp, `the camp is missing "${key}", which every basin has`);
    eq(typeof camp[key], typeof basin[key], `the camp's "${key}" is the wrong type`);
  }
  eq(camp.blocked.length, basin.blocked.length, "the camp's grid is a different size");
  eq(camp.grid, GRID, "the camp reports the wrong grid size");
  eq(camp.cell, CELL, "the camp reports the wrong cell size");
  eq(typeof camp.heightAt(3, 4), "number", "the camp's heightAt does not return a number");
});

check("the camp seed is reserved and cannot collide with a real one", () => {
  assert(CAMP_SEED < 0, "the camp sentinel is not negative — a hashed seed could collide with it");
});

// --- connectivity, the thing hand-placement throws away ---------------------
check("every open cell in the camp is reachable from spawn", () => {
  const camp = buildCamp();
  const reach = floodFill(camp.blocked, camp.camp.cx, camp.camp.cz);
  let open = 0, reached = 0, stranded = [];
  for (let cz = 0; cz < GRID; cz++) {
    for (let cx = 0; cx < GRID; cx++) {
      const i = cz * GRID + cx;
      if (camp.blocked[i]) continue;
      open++;
      if (reach[i]) reached++;
      else if (stranded.length < 6) stranded.push(`${cx},${cz}`);
    }
  }
  eq(reached, open, `${open - reached} open cells are sealed off (e.g. ${stranded.join(" ")}) — a cabin or the treeline pinched the map shut`);
});

check("the camp passes the same validate() a basin does", () => {
  const v = validate(buildCamp());
  assert(v.ok, `unreachable features: ${v.unreachable.join(", ")}`);
  eq(v.reachableFraction, 1, "some walkable ground is stranded");
});

// --- what the objectives actually require -----------------------------------
check("the trainer is reachable, and standing at him is a real walk", () => {
  const camp = buildCamp();
  const reach = floodFill(camp.blocked, camp.camp.cx, camp.camp.cz);
  assert(reach[camp.trainer.cz * GRID + camp.trainer.cx], "the trainer is standing somewhere you cannot walk to");
  const d = Math.hypot(camp.trainer.x - camp.spawn.x, camp.trainer.z - camp.spawn.z);
  assert(d >= 30, `the walk to the trainer is only ${d.toFixed(1)}m — objective 1 wants a real crossing`);
});

check("both pylons exist, are reachable, and start mossed", () => {
  const camp = buildCamp();
  const reach = floodFill(camp.blocked, camp.camp.cx, camp.camp.cz);
  assert(camp.pylons.length >= 2, `only ${camp.pylons.length} pylon(s) in camp`);
  for (const p of camp.pylons) {
    assert(reach[p.cz * GRID + p.cx], `pylon ${p.id} is unreachable`);
    assert(p.mossed === true, `pylon ${p.id} does not start mossed — it is live before its objective`);
    assert(p.spent === false, `pylon ${p.id} starts spent`);
  }
});

check("one pylon is on the way to the trainer", () => {
  // Effect-gating only pays off if the player MEETS the inert thing before the
  // objective needs it (brain: wrong-sky#E8). A pylon nobody walks past is no
  // better than one that does not exist yet.
  const camp = buildCamp();
  const near = camp.pylons.some((p) => {
    const t = (p.x - camp.spawn.x) * (camp.trainer.x - camp.spawn.x) + (p.z - camp.spawn.z) * (camp.trainer.z - camp.spawn.z);
    const len2 = (camp.trainer.x - camp.spawn.x) ** 2 + (camp.trainer.z - camp.spawn.z) ** 2;
    const u = Math.max(0, Math.min(1, t / len2));
    const px = camp.spawn.x + (camp.trainer.x - camp.spawn.x) * u;
    const pz = camp.spawn.z + (camp.trainer.z - camp.spawn.z) * u;
    return Math.hypot(p.x - px, p.z - pz) <= 8;
  });
  assert(near, "neither pylon is near the walk to the trainer — nobody will meet one before objective 5");
});

check("the camp carries nothing an objective has not opened", () => {
  const camp = buildCamp();
  eq(camp.items.length, 0, "an item exists in camp before its objective opens");
  eq(camp.monoliths.length, 0, "the camp has survey markers");
});

// --- it is the SAME map every time ------------------------------------------
check("the camp is byte-identical across builds", () => {
  const a = buildCamp(), b = buildCamp();
  eq(Buffer.from(a.blocked).toString("hex"), Buffer.from(b.blocked).toString("hex"), "the camp's geometry differs between builds");
  eq(JSON.stringify(a.pylons), JSON.stringify(b.pylons), "the camp's pylons moved between builds");
  eq(a.heightAt(7, 9), b.heightAt(7, 9), "the camp's floor differs between builds");
});

check("the camp is smaller than a basin but not cramped", () => {
  const camp = buildCamp();
  let open = 0;
  for (let i = 0; i < camp.blocked.length; i++) if (!camp.blocked[i]) open++;
  const basinOpen = (() => { const b = generateWorld(4242); let n = 0; for (let i = 0; i < b.blocked.length; i++) if (!b.blocked[i]) n++; return n; })();
  assert(open < basinOpen, `the camp (${open} cells) is not smaller than a basin (${basinOpen})`);
  assert(open > 300, `the camp is only ${open} cells — too cramped to wander`);
  assert(longestWalk(camp) >= 30, `the longest walk in camp is ${longestWalk(camp).toFixed(1)}m`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  ✗ " + f);
if (failures.length) process.exit(1);
console.log("mirage camp: OK");
