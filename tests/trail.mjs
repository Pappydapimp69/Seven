// trail.mjs — the woods Seven walks: big, zoned, and gated by time, not walls.
import { generateTrail, TRAIL_GRID, TRAIL_AREAS, areaOfRow, DEADFALL_AREAS, PYLONS_FIRST, PYLONS_MIN, PYLONS_MAX } from "../src/trail.js";
import { floodFill } from "../src/world.js";

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const G = TRAIL_GRID;
const reach = (w, blocked = w.blocked) => floodFill(blocked, w.camp.cx, w.camp.cz);
const cleared = (w, except = -1) => {
  const b = Uint8Array.from(w.blocked);
  w.deadfalls.forEach((d, i) => { if (i !== except) for (const c of d.cells) b[c.cz * G + c.cx] = 0; });
  return b;
};
const exitReached = (w, r) => { const x = w.trail.trailX[w.trail.exitCz]; return !!(r[w.trail.exitCz * G + x] || r[w.trail.exitCz * G + x + 1]); };
const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 777777];

check("same seed, same woods", () => {
  const a = generateTrail(42), b = generateTrail(42);
  assert(a.blocked.every((v, i) => v === b.blocked[i]), "blocked differs");
  assert(JSON.stringify(a.pylons) === JSON.stringify(b.pylons), "pylons differ");
  assert(generateTrail(43).blocked.some((v, i) => v !== a.blocked[i]), "a different seed made the same woods");
});

check("the map is considerably larger than the 46-cell basin", () => {
  const w = generateTrail(1);
  assert(w.grid === G && G >= 100, `grid is ${w.grid}`);
  assert(w.cellKind && w.cellKind.length === G * G, "no cellKind: the renderer would draw rock");
});

for (const s of SEEDS) {
  check(`seed ${s}: the way north is closed until the deadfalls are cut, and open after`, () => {
    const w = generateTrail(s);
    assert(w.deadfalls.length === DEADFALL_AREAS.length, `${w.deadfalls.length} deadfalls`);
    assert(!exitReached(w, reach(w)), "the exit is reachable with every deadfall standing");
    assert(exitReached(w, reach(w, cleared(w))), "the exit is unreachable with every deadfall cut");
    // Each one is a gate on its own: cut the others, leave this one, still closed.
    w.deadfalls.forEach((d, i) => assert(!exitReached(w, reach(w, cleared(w, i))), `deadfall ${i} (area ${d.area}) can be walked round`));
  });
  check(`seed ${s}: everything that matters is reachable once the way is cut`, () => {
    const w = generateTrail(s);
    const r = reach(w, cleared(w));
    for (const f of [...w.pylons, ...w.trees, ...w.stones, ...w.items]) {
      assert(!w.blocked[f.cz * G + f.cx], `${f.id} stands in forest`);
      assert(r[f.cz * G + f.cx], `${f.id} is unreachable`);
    }
  });
  check(`seed ${s}: pylons — ${PYLONS_FIRST} in area 1, ${PYLONS_MIN}-${PYLONS_MAX} in every later one`, () => {
    const w = generateTrail(s);
    for (let a = 0; a < TRAIL_AREAS; a++) {
      const n = w.pylons.filter((p) => p.area === a).length;
      if (a === 0) assert(n === PYLONS_FIRST, `area 1 has ${n}`);
      else assert(n >= PYLONS_MIN && n <= PYLONS_MAX, `area ${a + 1} has ${n}`);
    }
    for (const p of w.pylons) assert(areaOfRow(p.cz) === p.area, `${p.id} sits in area ${areaOfRow(p.cz)} but says ${p.area}`);
  });
  check(`seed ${s}: area 1 is dense forest, not a clearing`, () => {
    const w = generateTrail(s);
    let openCells = 0, total = 0;
    for (let cz = 0; cz < G; cz++) {
      if (areaOfRow(cz) !== 0 || cz > w.trail.campCz - 6) continue;
      for (let cx = 3; cx < G - 3; cx++) { total++; if (!w.blocked[cz * G + cx]) openCells++; }
    }
    assert(openCells / total < 0.12, `area 1 is ${(100 * openCells / total).toFixed(1)}% open`);
  });
}

check("sweep: 60 seeds — every deadfall is a gate, and everything is reachable once they are cut", () => {
  const bad = [];
  for (let s = 2000; s < 2060; s++) {
    const w = generateTrail(s);
    if (exitReached(w, reach(w))) bad.push(`${s}: exit open with every deadfall standing`);
    w.deadfalls.forEach((d, i) => { if (exitReached(w, reach(w, cleared(w, i)))) bad.push(`${s}: deadfall ${i} can be walked round`); });
    const r = reach(w, cleared(w));
    for (const f of [...w.pylons, ...w.trees, ...w.stones, ...w.items]) if (!r[f.cz * G + f.cx]) bad.push(`${s}: ${f.id} unreachable`);
    if (w.pylons.filter((p) => p.area === 0).length !== PYLONS_FIRST) bad.push(`${s}: area 1 pylons`);
  }
  assert(!bad.length, bad.slice(0, 6).join("; ") + (bad.length > 6 ? ` (+${bad.length - 6} more)` : ""));
});

check("later areas roll different pylon counts across seeds", () => {
  const counts = new Set();
  for (const s of SEEDS) { const w = generateTrail(s); for (let a = 1; a < TRAIL_AREAS; a++) counts.add(w.pylons.filter((p) => p.area === a).length); }
  assert(counts.size >= 2, `every later area always has ${[...counts]}`);
});

if (failures.length) { console.log(`trail: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
console.log(`trail: ${passed} passed`);
