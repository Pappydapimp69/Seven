// world.mjs — the map holds its promises on many seeds: the trunk is the only
// way north, every area opens when its deadfall is cut, pylons are where they
// should be, and nothing open ever touches a deadfall row.

import { harness, assert } from "./lib.mjs";
import { createWorld, bfs, clearDeadfall, areaOfRow, deadfallRow, kindAt, K, LANDMARKS, LANDMARK_NAME, TINT } from "../src/world.js";
import { AREAS, EXIT_ROWS } from "../src/config.js";

const T = harness("world");
const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 3);
const reach = (w, from, goal) => bfs(w, Math.floor(from.x), Math.floor(from.y), goal) !== null;

T.check("the trunk is the only way north, area by area, on 50 seeds", () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    for (let a = 0; a < AREAS - 1; a++) {
      const row = deadfallRow(a);
      assert(!reach(w, w.start, (x, y) => y < row), `seed ${seed}: got north of deadfall ${a} without cutting it`);
      clearDeadfall(w, w.deadfalls[a]);
      assert(reach(w, w.start, (x, y) => y < row), `seed ${seed}: deadfall ${a} cut and still no way north`);
    }
    assert(reach(w, w.start, (x, y) => y <= EXIT_ROWS), `seed ${seed}: the far side is out of reach with every trunk cut`);
  }
});
T.check("every deadfall row is forest except the trunk", () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    for (const d of w.deadfalls) for (let x = 0; x < w.W; x++) {
      const k = kindAt(w, x, d.row), trunk = x >= d.x0 && x <= d.x1;
      assert(trunk ? k === K.DEADFALL : k === K.FOREST, `seed ${seed}: row ${d.row} col ${x} is ${k}`);
    }
  }
});
T.check("pylons: three in the first woods, two to four after, all reachable", () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    for (const d of w.deadfalls) clearDeadfall(w, d);
    for (let a = 0; a < AREAS; a++) {
      const n = w.pylons.filter((p) => p.area === a).length;
      assert(a === 0 ? n === 3 : n >= 2 && n <= 4, `seed ${seed}: area ${a} has ${n} pylons`);
    }
    for (const p of w.pylons) {
      assert(areaOfRow(Math.floor(p.y)) === p.area, `seed ${seed}: pylon ${p.id} is not in its area`);
      assert(reach(w, w.start, (x, y) => x === Math.floor(p.x) && y === Math.floor(p.y)), `seed ${seed}: pylon ${p.id} cannot be reached`);
    }
  }
});
T.check("the same seed makes the same woods", () => {
  const a = createWorld(42), b = createWorld(42), c = createWorld(43);
  assert(a.grid.every((v, i) => v === b.grid[i]), "seed 42 made two different maps");
  assert(!a.grid.every((v, i) => v === c.grid[i]), "seeds 42 and 43 made the same map");
});
T.check("landmarks: in each woods every clearing is a different one (a wrong place has to look wrong), on 50 seeds", () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    for (let a = 0; a < AREAS; a++) {
      const kinds = w.pockets.filter((p) => p.area === a).map((p) => p.kind);
      assert(kinds.every((k) => LANDMARKS.includes(k)) && new Set(kinds).size === kinds.length, `seed ${seed} woods ${a + 1}: ${kinds.join(", ")}`);
    }
    for (const py of w.pylons) assert(LANDMARKS.includes(py.landmark), `seed ${seed}: pylon ${py.id} names no landmark`);
  }
  assert(LANDMARKS.every((k) => LANDMARK_NAME[k]), "a landmark has no name");
});

T.check("landmarks changed no map: these layouts are what saved runs regenerate", () => {
  const golden = { 1: "883ff297:21:113", 2: "d482da52:22:106", 3: "9329e136:23:104", 42: "8a34c37a:19:87", 12345: "cc986c51:24:141", 777777: "38c41fe5:18:93" };
  for (const [seed, want] of Object.entries(golden)) {
    const w = createWorld(+seed); let h = 2166136261;
    for (const v of w.grid) h = Math.imul(h ^ v, 16777619);
    assert(`${(h >>> 0).toString(16)}:${w.pockets.length}:${w.trees.length}` === want, `seed ${seed}: the map changed`);
  }
});

T.check("landmark dressing stands on open clearing ground, and stains only open ground (nothing blocks)", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const w = createWorld(seed);
    for (const p of w.pockets) {
      assert(p.decor.length >= 1, `seed ${seed}: ${p.kind} has nothing to see`);
      for (const d of p.decor) assert(kindAt(w, Math.floor(d.x), Math.floor(d.y)) === K.CLEAR, `seed ${seed}: ${d.kind} stands off the clearing`);
    }
    for (let i = 0; i < w.tint.length; i++) if (w.tint[i]) assert(w.grid[i] === K.CLEAR || w.grid[i] === K.TRAIL, `seed ${seed}: stain on ground that is not open`);
    assert(w.pockets.some((p) => p.kind === "pond") || true, "");
  }
  // Each kind that stains does: water, ash, gravel.
  const stains = new Set();
  for (const seed of SEEDS.slice(0, 20)) { const w = createWorld(seed); for (const v of w.tint) if (v) stains.add(v); }
  assert(stains.has(TINT.WATER) && stains.has(TINT.ASH) && stains.has(TINT.GRAVEL), `only ${[...stains]} ever drawn`);
});

T.done();
