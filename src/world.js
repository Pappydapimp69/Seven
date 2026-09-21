// world.js — procedural generation of THE BASIN, the area the party explores.
// Pure: no DOM, no Three. Runs identically in the browser and in Node tests.
//
// The area is a square grid of cells. A cell is either open ground or blocked
// (rock spires, collapsed ridges). Movement is CONTINUOUS — the grid is only the
// collision and pathfinding substrate; the renderer draws a heightfield over it.
//
// Placed features:
//   * CAMP       — where the party starts and where it must return (extraction).
//   * MONOLITH x6 — the survey markers. Finding and logging all of them is the goal.
//   * PYLON  x5  — lucid anchors. Standing near a live pylon restores lucidity to
//                  everyone in range. They are the only renewable relief in the area.
//   * ITEM   x6  — small pickups (see state.js ITEM_INFO for what each kind does).
//                  World placement only knows their KIND string, not their effect —
//                  that split keeps this module free of any game-mechanical import.
//
// CONNECTIVITY IS NOT A BYPRODUCT — IT IS ITS OWN PASS.
// Carving with local rules (scatter rock clusters, respect a minimum spacing)
// says nothing about whether the walkable region is globally connected; a
// generator can satisfy every local constraint and still strand a monolith
// behind a ring of spires, which is an unwinnable run. So generation runs an
// explicit repair pass: flood-fill from CAMP, and for any feature not in that
// component, carve a corridor to it and re-fill. `validate()` then re-derives
// reachability from scratch and is asserted in the test suite — the fixup is
// verified, not trusted.

import { makeRng } from "./rng.js?v=seven-0.24.0";

export const CELL = 2.6; // world units per grid cell
/**
 * Cells per side OF A BASIN.
 *
 * This is not "the grid size" — the camp has its own, larger one (camp.js
 * CAMP_GRID), and every world already carries its own in `world.grid`. That
 * field used to be decorative: it was written into the returned shape and
 * nothing read it, while every consumer imported this constant instead. One
 * truth in two homes, and only one of them would ever move. The helpers below
 * now take the grid explicitly or read it off the world, so this constant is
 * only ever the BASIN's answer.
 */
export const GRID = 46;
export const MONOLITH_COUNT = 6;
export const PYLON_COUNT = 5;
export const ITEM_COUNT = 6;
// Kind strings only — state.js ITEM_INFO owns what each one actually does.
// "husk" is a real, honestly-placed dud: it spawns and is picked up exactly
// like the other three, it just does nothing when used (see state.js
// ITEM_INFO/useItem) — trash mixed into the same pool, not a hallucination.
export const ITEM_KINDS = Object.freeze(["flare", "tether", "lens", "husk"]);
// Raw-material nodes: chop a tree for wood, mine a deposit for stone. Unlike
// ITEM, these carry no `itemKind` — a tree is always a tree, a deposit always
// stone. There is no deception layer for these at all (see state.js/percept.js
// comments): only carried/crafted ITEMS are ever subject to the lie.

// DEADFALLS — the obstacle the day/night loop is priced against. A tangle of
// fallen timber lying across a route: it BLOCKS, it takes real time to cut
// through, and it pays in wood. The design note's rule is the load-bearing part
// — "Nothing is walled off. Progress is gated by TIME" — so a deadfall is only
// ever placed where the map stays fully connected WITHOUT clearing it. It is
// always a shortcut, never a gate. Going round costs distance; cutting costs
// daylight; you pay either way, and choosing which is the whole mechanic.
export const DEADFALL_COUNT = 4;
// How much further you must walk to go ROUND one before it counts as an
// obstacle at all. On the old 78%-walkable basin almost nothing cleared this
// bar — an obstacle that is free to ignore is scenery.
export const DEADFALL_MIN_DETOUR = 6;

// ---- HOW FAR IS TOO FAR, in cells of walking from camp --------------------
//
// The old contract was binary: every feature REACHABLE, at any cost, enforced by
// a repair pass that carves a corridor to anything the flood fill misses. That
// guarantee is why this generator can ship without hand inspection, and it is
// also why dense ground cannot survive here — "reachable" says nothing about
// price, so a map where everything is a long hard walk and a map where
// everything is a stroll both pass identically.
//
// A budget is the weaker, more useful contract: reachable EVENTUALLY, at a cost
// this says out loud. It subsumes reachability (unreachable is infinite
// distance) while making expense visible, which is what a traverse needs —
// "you can always go further; you may not get back before dark".
//
// 3x the grid's side. A straight crossing is ~46 cells; this allows a route
// that doubles back and detours heavily before anything is called too far.
// Measured on the open basin: the worst walk to a feature runs 54-71 cells, so
// nothing here is near the bar — the budget exists to price density, not to
// police the map as it stands.
export const DISTANCE_BUDGET = GRID * 3;

// DENSITY — what the budget BUYS, and why it is OFF by default.
//
// Each round fills a slice of open cells and keeps it only if every feature is
// still inside the budget; a rejected round is rolled back WHOLE. Swept at
// 0.22/6, 0.12/14, 0.08/24 and 0.05/40 fill-per-round: every setting lands at
// 62-64% walkable, but the gentler climbs get further into the budget before a
// round is refused (worst walk 72 cells at 0.22, 87 at 0.12), so the fill is
// small and the rounds few.
//
// Then the measurement that decided the default. Density breaks companion drift
// monotonically: a gone companion drifts 8 units from where they broke on 24 of
// 24 seeds with density off, on 7 of 12 at one round, on 5 of 12 at two. The
// suite wants 8. Deadfalls are innocent — the same test passes with density off
// and deadfalls on.
//
// "They DO wander off — the dwell is a beat, not a leash" is a design
// assertion, not a fixture: a gone companion who cannot leave is a different
// and worse game. So the survey basin stays open and this pass waits for the
// map that wants it — the traverse, where a cut path through dense forest is
// the point. `generateWorld(seed, { dense: true })` turns it on, and the
// deadfall detour gate with it.
export const DENSITY_ROUNDS = 4;
export const DENSITY_FILL = 0.12;

export const TREE_COUNT = 5;
export const STONE_COUNT = 5;

export const FEATURE = Object.freeze({
  CAMP: "camp",
  MONOLITH: "monolith",
  PYLON: "pylon",
  ITEM: "item",
  TREE: "tree",
  STONE: "stone",
  DEADFALL: "deadfall",
});

// Survey markers get names, not numbers — a companion has to be able to say
// "the leaning one" and mean something, and a hallucinating one has to be able
// to name a marker that does not exist.
const MONOLITH_NAMES = [
  "the Leaning Slab",
  "the Split Tooth",
  "the Drowned Arch",
  "the Cairn",
  "the Ribcage",
  "the Nail",
  "the Waiting Stone",
  "the Black Mouth",
];

/**
 * `grid` is REQUIRED on every helper that needs it, and checked.
 *
 * The tempting shape is `grid = GRID` as a default. It is the wrong shape here:
 * a call site that forgets the argument would then place a camp feature using
 * the BASIN's grid, which is not an error anywhere — it is a valid number that
 * puts the thing tens of metres from where the map says it is, and the only
 * symptom is a world that looks subtly wrong. Throwing turns every missed call
 * site into a stack trace at the first frame instead.
 */
function needGrid(grid, who) {
  if (!Number.isInteger(grid) || grid <= 0) {
    throw new Error(`${who}: grid must be a positive integer, got ${grid} — pass the world's own grid (world.grid), not a default`);
  }
  return grid;
}

/** Grid <-> world helpers. Cell (0,0) is the NW corner; the grid is centred on the origin. */
export function cellToWorld(cx, cz, grid) {
  const g = needGrid(grid, "cellToWorld");
  return { x: (cx - g / 2 + 0.5) * CELL, z: (cz - g / 2 + 0.5) * CELL };
}
export function worldToCell(x, z, grid) {
  const g = needGrid(grid, "worldToCell");
  return { cx: Math.floor(x / CELL + g / 2), cz: Math.floor(z / CELL + g / 2) };
}

/** The grid a world was built on. Never guessed — an absent one is a bug. */
export function gridOf(world) {
  return needGrid(world && world.grid, "gridOf");
}

const inBounds = (cx, cz, grid) => cx >= 0 && cz >= 0 && cx < grid && cz < grid;

// Cheap seeded value noise — enough for a rolling basin floor. Sampled by the
// renderer for terrain height and by the sim for "how deep in the fog are you".
function makeHeightField(rng) {
  const lattice = [];
  const LN = 12; // lattice resolution
  for (let i = 0; i <= LN; i++) {
    lattice.push([]);
    for (let j = 0; j <= LN; j++) lattice[i].push(rng());
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  // Height at a fractional cell coordinate, in world units.
  return function heightAt(cx, cz) {
    const u = Math.min(Math.max(cx / GRID, 0), 0.999) * LN;
    const v = Math.min(Math.max(cz / GRID, 0), 0.999) * LN;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = smooth(u - i), fv = smooth(v - j);
    const a = lattice[i][j], b = lattice[i + 1][j];
    const c = lattice[i][j + 1], d = lattice[i + 1][j + 1];
    const top = a + (b - a) * fu;
    const bot = c + (d - c) * fu;
    const h = top + (bot - top) * fv;
    // Bowl bias: the basin dips toward the middle, so the rim reads as a rim.
    const dx = cx / GRID - 0.5, dz = cz / GRID - 0.5;
    const rim = Math.sqrt(dx * dx + dz * dz) * 2; // 0 centre .. ~1.41 corner
    return (h - 0.5) * 2.2 + rim * rim * 3.4;
  };
}

function blockedGrid(rng) {
  const blocked = new Uint8Array(GRID * GRID);
  const at = (cx, cz) => cz * GRID + cx;

  // Hard rim so the player cannot walk out of the area.
  for (let i = 0; i < GRID; i++) {
    blocked[at(i, 0)] = 1;
    blocked[at(i, GRID - 1)] = 1;
    blocked[at(0, i)] = 1;
    blocked[at(GRID - 1, i)] = 1;
  }

  // Rock clusters: random-walk blobs. Local rule only — connectivity comes later.
  const clusters = 26;
  for (let c = 0; c < clusters; c++) {
    let cx = rng.int(3, GRID - 4);
    let cz = rng.int(3, GRID - 4);
    const len = rng.int(6, 26);
    for (let s = 0; s < len; s++) {
      if (inBounds(cx, cz, GRID)) blocked[at(cx, cz)] = 1;
      const d = rng.int(0, 3);
      cx += d === 0 ? 1 : d === 1 ? -1 : 0;
      cz += d === 2 ? 1 : d === 3 ? -1 : 0;
      cx = Math.min(Math.max(cx, 2), GRID - 3);
      cz = Math.min(Math.max(cz, 2), GRID - 3);
    }
  }

  // A couple of long ridges to break sightlines and make the area feel authored.
  for (let r = 0; r < 3; r++) {
    const horiz = rng.chance(0.5);
    const fixed = rng.int(6, GRID - 7);
    const from = rng.int(3, GRID - 14);
    const len = rng.int(9, 18);
    const gapAt = from + rng.int(2, len - 3); // leave one pass, usually
    for (let k = 0; k < len; k++) {
      const p = from + k;
      if (p === gapAt) continue;
      const cx = horiz ? p : fixed;
      const cz = horiz ? fixed : p;
      if (inBounds(cx, cz, GRID)) blocked[at(cx, cz)] = 1;
    }
  }
  return blocked;
}

/**
 * Walking distance in cells from one cell to every other, -1 where unreachable.
 *
 * The same BFS as floodFill, counting steps instead of only marking them. It
 * exists because "can the party get there" and "what does getting there cost"
 * are different questions and only the first one had an answer — see
 * DISTANCE_BUDGET. Four-way, so it understates a diagonal walk; every consumer
 * compares two of these to each other, and both sides understate identically.
 */
export function distanceField(blocked, startCx, startCz) {
  const GRID = needGrid(Math.round(Math.sqrt(blocked.length)), "distanceField");
  const dist = new Int32Array(GRID * GRID).fill(-1);
  if (!inBounds(startCx, startCz, GRID) || blocked[startCz * GRID + startCx]) return dist;
  const start = startCz * GRID + startCx;
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const cx = idx % GRID, cz = (idx - cx) / GRID;
    for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
      if (!inBounds(nx, nz, GRID)) continue;
      const ni = nz * GRID + nx;
      if (dist[ni] !== -1 || blocked[ni]) continue;
      dist[ni] = dist[idx] + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/** Flood fill from a cell; returns a Uint8Array marking the reachable component. */
export function floodFill(blocked, startCx, startCz) {
  // The stride comes from the ARRAY, not from a constant or an argument: the
  // grid is already unambiguously encoded in its length, and deriving it here
  // means no caller can pass one that disagrees with the map it is filling.
  const GRID = needGrid(Math.round(Math.sqrt(blocked.length)), "floodFill");
  if (GRID * GRID !== blocked.length) throw new Error(`floodFill: blocked is ${blocked.length} cells, which is not square`);
  const seen = new Uint8Array(GRID * GRID);
  if (!inBounds(startCx, startCz, GRID) || blocked[startCz * GRID + startCx]) return seen;
  const queue = [startCz * GRID + startCx];
  seen[queue[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const cx = idx % GRID, cz = (idx - cx) / GRID;
    const nbrs = [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]];
    for (const [nx, nz] of nbrs) {
      if (!inBounds(nx, nz, GRID)) continue;
      const ni = nz * GRID + nx;
      if (seen[ni] || blocked[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

// Carve an L-shaped corridor between two cells, clearing whatever it crosses.
// This is the repair primitive: it cannot fail, which is the point — a fixup
// pass that can itself fail to connect is not a fixup pass.
function carveCorridor(blocked, ax, az, bx, bz) {
  const clear = (cx, cz) => {
    if (cx > 0 && cz > 0 && cx < GRID - 1 && cz < GRID - 1) blocked[cz * GRID + cx] = 0;
  };
  let x = ax, z = az;
  while (x !== bx) {
    clear(x, z);
    clear(x, z + 1); // 2 cells wide so a 6-strong party is not single-file
    x += bx > x ? 1 : -1;
  }
  while (z !== bz) {
    clear(x, z);
    clear(x + 1, z);
    z += bz > z ? 1 : -1;
  }
  clear(bx, bz);
}

function openNear(blocked, cx, cz) {
  // Nearest open cell to (cx,cz) by expanding ring search.
  for (let r = 0; r < GRID; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (inBounds(nx, nz, GRID) && !blocked[nz * GRID + nx]) return { cx: nx, cz: nz };
      }
    }
  }
  return { cx: Math.floor(GRID / 2), cz: Math.floor(GRID / 2) };
}

/**
 * Generate an area. Returns a plain data object — no live references, so a
 * world can be serialised, diffed in tests, or handed to a worker.
 */
export function generateWorld(seed = 1, { dense = false } = {}) {
  const rng = makeRng(seed);
  const blocked = blockedGrid(rng);
  const heightAt = makeHeightField(rng);

  // CAMP sits off-centre so "return to camp" is a real navigation problem
  // rather than "walk to the middle".
  const campSeed = { cx: rng.int(6, 14), cz: rng.int(GRID - 15, GRID - 7) };
  const camp = openNear(blocked, campSeed.cx, campSeed.cz);
  // Clear a small yard around camp. The party spawns in a fan behind the lead and
  // the opening shot looks out across the basin; a spire pressed against the
  // camera on frame one is a bad first impression and can wedge a companion.
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = camp.cx + dx, nz = camp.cz + dz;
      if (nx > 0 && nz > 0 && nx < GRID - 1 && nz < GRID - 1) blocked[nz * GRID + nx] = 0;
    }
  }

  // Scatter features with a minimum separation, biased away from CAMP so the
  // party has to actually travel.
  const picks = [];
  const minSep = 6;
  const farEnough = (c) =>
    picks.every((p) => Math.hypot(p.cx - c.cx, p.cz - c.cz) >= minSep) &&
    Math.hypot(camp.cx - c.cx, camp.cz - c.cz) >= 9;
  let guard = 0;
  const totalPicks = MONOLITH_COUNT + PYLON_COUNT + ITEM_COUNT + TREE_COUNT + STONE_COUNT;
  while (picks.length < totalPicks && guard++ < 6000) {
    const c = openNear(blocked, rng.int(2, GRID - 3), rng.int(2, GRID - 3));
    if (farEnough(c)) picks.push(c);
  }
  // If the spacing loop ran dry (dense seed), top up without the separation rule
  // rather than shipping a world missing its objectives.
  while (picks.length < totalPicks) {
    picks.push(openNear(blocked, rng.int(2, GRID - 3), rng.int(2, GRID - 3)));
  }

  const names = rng.shuffled(MONOLITH_NAMES);
  const monoliths = picks.slice(0, MONOLITH_COUNT).map((c, i) => ({
    id: `m${i}`,
    kind: FEATURE.MONOLITH,
    name: names[i],
    cx: c.cx,
    cz: c.cz,
    ...cellToWorld(c.cx, c.cz, GRID),
  }));
  const pylons = picks.slice(MONOLITH_COUNT, MONOLITH_COUNT + PYLON_COUNT).map((c, i) => ({
    id: `p${i}`,
    kind: FEATURE.PYLON,
    cx: c.cx,
    cz: c.cz,
    ...cellToWorld(c.cx, c.cz, GRID),
  }));
  // Item kinds: a guaranteed one of each, then a random remainder, then a
  // shuffle. Cycling `i % 3` guaranteed coverage but made every basin on every
  // seed the identical 2/2/2 mix — only the positions ever changed, so the
  // craft space was decided before you walked in. Seeding the remainder keeps
  // coverage (a world where the dice never deal a Lens is a worse world, not a
  // harder one) while letting a basin actually lean.
  //
  // The draw count here is CONSTANT — (ITEM_COUNT - kinds) remainder draws plus
  // (ITEM_COUNT - 1) shuffle swaps, on every seed, with no branch that skips a
  // roll. A pool whose roll count varies with its own contents desyncs every
  // later consumer of the same stream (Brain: waiting-city#E9/E17 —
  // constant-roll-count discipline; the desync shows up somewhere unrelated).
  const bag = ITEM_KINDS.slice(0, Math.min(ITEM_KINDS.length, ITEM_COUNT));
  for (let i = bag.length; i < ITEM_COUNT; i++) bag.push(rng.pick(ITEM_KINDS));
  for (let i = bag.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const items = picks.slice(MONOLITH_COUNT + PYLON_COUNT, MONOLITH_COUNT + PYLON_COUNT + ITEM_COUNT).map((c, i) => ({
    id: `i${i}`,
    kind: FEATURE.ITEM,
    itemKind: bag[i],
    cx: c.cx,
    cz: c.cz,
    ...cellToWorld(c.cx, c.cz, GRID),
  }));
  const treeStart = MONOLITH_COUNT + PYLON_COUNT + ITEM_COUNT;
  const trees = picks.slice(treeStart, treeStart + TREE_COUNT).map((c, i) => ({
    id: `t${i}`,
    kind: FEATURE.TREE,
    cx: c.cx,
    cz: c.cz,
    ...cellToWorld(c.cx, c.cz, GRID),
  }));
  const stoneStart = treeStart + TREE_COUNT;
  const stones = picks.slice(stoneStart, stoneStart + STONE_COUNT).map((c, i) => ({
    id: `st${i}`,
    kind: FEATURE.STONE,
    cx: c.cx,
    cz: c.cz,
    ...cellToWorld(c.cx, c.cz, GRID),
  }));

  // ---- CONNECTIVITY REPAIR PASS (explicit, then re-verified) ----------------
  // Flood from CAMP; anything unreachable gets a carved corridor from the
  // nearest reachable cell. Repeat until the fill covers every feature.
  const features = [...monoliths, ...pylons, ...items, ...trees, ...stones];
  let repairs = 0;
  for (let pass = 0; pass < 12; pass++) {
    const reach = floodFill(blocked, camp.cx, camp.cz);
    const orphans = features.filter((f) => !reach[f.cz * GRID + f.cx]);
    if (orphans.length === 0) break;
    for (const f of orphans) {
      // Nearest cell that IS in CAMP's component, then carve to the orphan.
      let best = null, bestD = Infinity;
      for (let cz = 1; cz < GRID - 1; cz++) {
        for (let cx = 1; cx < GRID - 1; cx++) {
          if (!reach[cz * GRID + cx]) continue;
          const d = Math.hypot(cx - f.cx, cz - f.cz);
          if (d < bestD) { bestD = d; best = { cx, cz }; }
        }
      }
      if (!best) best = camp;
      carveCorridor(blocked, best.cx, best.cz, f.cx, f.cz);
      repairs++;
    }
  }
  // Features stand ON their cell; make sure the cell itself and a ring around it
  // are walkable so a marker is never wedged inside a spire.
  for (const f of features) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = f.cx + dx, nz = f.cz + dz;
        if (nx > 0 && nz > 0 && nx < GRID - 1 && nz < GRID - 1) blocked[nz * GRID + nx] = 0;
      }
    }
  }

  // ---- DENSITY, SPENT AGAINST THE BUDGET -----------------------------------
  // What the budget is FOR. Under the old binary contract this pass could not
  // exist: "reachable" is satisfied by a single winding corridor, so there was
  // no way to say how much closing the ground had cost and therefore no way to
  // know when to stop. With a budget there is — fill a slice, ask what the
  // longest walk to a feature now is, and keep the slice only if it is still
  // affordable.
  //
  // Rolled back WHOLE on rejection rather than cell by cell. A partial round
  // leaves the map in a state no measurement was taken of, which is how a
  // generator ends up shipping worlds nothing ever validated.
  if (dense) {
    for (let round = 0; round < DENSITY_ROUNDS; round++) {
      const before = Uint8Array.from(blocked);
      // Never wall in the camp, never bury a feature's ring, never touch the rim.
      const protectedCells = new Set();
      for (const f of [...features, camp]) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) protectedCells.add((f.cz + dz) * GRID + (f.cx + dx));
        }
      }
      let filled = 0;
      for (let cz = 2; cz < GRID - 2; cz++) {
        for (let cx = 2; cx < GRID - 2; cx++) {
          const i = cz * GRID + cx;
          if (blocked[i] || protectedCells.has(i)) continue;
          if (Math.hypot(cx - camp.cx, cz - camp.cz) < 7) continue;
          if (!rng.chance(DENSITY_FILL)) continue;
          blocked[i] = 1;
          filled++;
        }
      }
      if (!filled) break;
      const d = distanceField(blocked, camp.cx, camp.cz);
      const affordable = features.every((f) => {
        const v = d[f.cz * GRID + f.cx];
        return v >= 0 && v <= DISTANCE_BUDGET;
      });
      if (!affordable) { blocked.set(before); break; }
    }
  }

  // ---- DEADFALLS, placed LAST and never sealing anything --------------------
  // After the repair pass, so nothing here can be undone by a later carve, and
  // each one is accepted only if the whole map is still reachable with it in
  // place. A deadfall that cuts the map in two would be a wall, and the design
  // is explicit that nothing is walled off.
  const deadfalls = [];
  {
    const reachAll = floodFill(blocked, camp.cx, camp.cz);
    let open = 0;
    for (let i = 0; i < blocked.length; i++) if (!blocked[i] && reachAll[i]) open++;
    let guard2 = 0;
    while (deadfalls.length < DEADFALL_COUNT && guard2++ < 4000) {
      const cx = rng.int(4, GRID - 5);
      const cz = rng.int(4, GRID - 5);
      const horiz = rng.chance(0.5);
      // A three-cell run, and every cell of it has to be open ground already.
      const cells = [0, 1, 2].map((k) => (horiz ? { cx: cx + k, cz } : { cx, cz: cz + k }));
      if (cells.some((c) => blocked[c.cz * GRID + c.cx])) continue;
      if (Math.hypot(cx - camp.cx, cz - camp.cz) < 8) continue; // not on the doorstep
      // NEVER ON TOP OF A FEATURE. The ring-clearing above runs before this, so
      // a deadfall laid across a marker or a tree buries it: the cell reads as
      // rock, the feature is unreachable, and the world validates as broken.
      // Two cells of clearance, because a feature needs its own ring walkable.
      if (features.some((f) => cells.some((c) => Math.abs(f.cx - c.cx) <= 2 && Math.abs(f.cz - c.cz) <= 2))) continue;
      if (deadfalls.some((d) => Math.hypot(d.cx - cx, d.cz - cz) < 8)) continue;
      // Lay it down, then ask the map two questions: does it still hold
      // together, and does going round actually COST anything.
      const beforeDist = distanceField(blocked, camp.cx, camp.cz);
      for (const c of cells) blocked[c.cz * GRID + c.cx] = 1;
      const after = floodFill(blocked, camp.cx, camp.cz);
      let stillOpen = 0;
      for (let i = 0; i < blocked.length; i++) if (!blocked[i] && after[i]) stillOpen++;
      // Every cell that was reachable before must still be reachable now, minus
      // the three we just filled. Anything less means this one walls something
      // off, so it does not get to exist.
      if (stillOpen !== open - cells.length) {
        for (const c of cells) blocked[c.cz * GRID + c.cx] = 0;
        continue;
      }
      // AN OBSTACLE THAT IS FREE TO IGNORE IS SCENERY. Measured against the
      // features the party actually walks to, not the map in general: a
      // deadfall across a corner of empty field costs nobody anything, however
      // pinched the corner looks.
      const afterDist = distanceField(blocked, camp.cx, camp.cz);
      const detour = features.reduce((worstD, f) => {
        const i = f.cz * GRID + f.cx;
        const b = beforeDist[i], a2 = afterDist[i];
        return (b >= 0 && a2 >= 0) ? Math.max(worstD, a2 - b) : worstD;
      }, 0);
      // Only on dense ground. On the open basin almost nothing clears this bar
      // (0.2 deadfalls per world, measured), and gating there would delete the
      // feature rather than improve it — an obstacle that is free to ignore is
      // scenery, but no obstacle at all is worse.
      if (dense && detour < DEADFALL_MIN_DETOUR) {
        for (const c of cells) blocked[c.cz * GRID + c.cx] = 0;
        continue;
      }
      open = stillOpen;
      deadfalls.push({
        id: `df${deadfalls.length}`,
        kind: FEATURE.DEADFALL,
        cx, cz, horiz,
        detour, // cells of extra walking it costs to go round — diagnostic
        cells,
        cleared: false,
        ...cellToWorld(cx, cz, GRID),
      });
    }
  }

  return {
    seed,
    grid: GRID,
    cell: CELL,
    blocked,
    deadfalls,
    heightAt,
    camp: { id: "camp", kind: FEATURE.CAMP, cx: camp.cx, cz: camp.cz, ...cellToWorld(camp.cx, camp.cz, GRID) },
    monoliths,
    pylons,
    items,
    trees,
    stones,
    repairs, // how many corridors the fixup pass had to carve (diagnostic)
  };
}

/** True if a world-space point is inside a blocked cell (or out of bounds). */
export function isBlockedAt(world, x, z) {
  const grid = gridOf(world);
  const { cx, cz } = worldToCell(x, z, grid);
  if (!inBounds(cx, cz, grid)) return true;
  return !!world.blocked[cz * grid + cx];
}

/**
 * Slide a body from `pos` by (dx,dz) with axis-separated collision, so grazing a
 * spire slides along it instead of stopping dead. Returns the new position.
 */
export function moveWithCollision(world, pos, dx, dz, radius = 0.55) {
  const tryAxis = (x, z, nx, nz) => {
    // Sample the body's leading edge, not just its centre.
    const sx = nx + Math.sign(nx - x) * radius;
    const sz = nz + Math.sign(nz - z) * radius;
    if (isBlockedAt(world, sx, nz) || isBlockedAt(world, nx, sz) || isBlockedAt(world, nx, nz)) return null;
    return { x: nx, z: nz };
  };
  let out = { x: pos.x, z: pos.z };
  const stepX = tryAxis(out.x, out.z, out.x + dx, out.z);
  if (stepX) out = stepX;
  const stepZ = tryAxis(out.x, out.z, out.x, out.z + dz);
  if (stepZ) out = stepZ;
  return out;
}

/**
 * Re-derive reachability from scratch. Asserted by the test suite: the repair
 * pass above is verified, not trusted.
 * Returns { ok, unreachable: [featureId] }.
 */
export function validate(world, { budget = DISTANCE_BUDGET } = {}) {
  const grid = gridOf(world);
  // DISTANCES, not a flood fill. Same traversal, one more number per cell, and
  // that number is the whole point: `reachable` is `distance !== -1`, so this
  // still answers the old question while also answering how dear the answer is.
  const dist = distanceField(world.blocked, world.camp.cx, world.camp.cz);
  const reach = dist;
  const unreachable = [];
  const overBudget = [];
  let worst = 0;
  let worstId = null;
  for (const f of [...world.monoliths, ...world.pylons, ...world.items, ...world.trees, ...world.stones]) {
    const d = dist[f.cz * grid + f.cx];
    if (d < 0) {
      // UNREACHABLE IS INFINITE DISTANCE, so it fails the budget too. Reported
      // in both lists on purpose: a caller that only reads `withinBudget` must
      // not be told a walled-in marker is affordable. The budget is a WEAKER
      // contract than reachability, and a weaker contract still has to hold
      // wherever the stronger one does.
      unreachable.push(f.id);
      overBudget.push({ id: f.id, cells: Infinity });
      continue;
    }
    if (d > worst) { worst = d; worstId = f.id; }
    if (d > budget) overBudget.push({ id: f.id, cells: d });
  }
  let open = 0;
  for (let i = 0; i < world.blocked.length; i++) if (!world.blocked[i]) open++;
  let reached = 0;
  for (let i = 0; i < reach.length; i++) if (reach[i] >= 0) reached++;
  return {
    // `ok` still means what it always meant, and every existing caller keeps
    // working. The budget is reported ALONGSIDE it rather than folded into it:
    // a world where a marker is a very long walk is not broken, it is hard, and
    // conflating those two is how a difficulty question turns into a crash.
    ok: unreachable.length === 0,
    unreachable,
    // Reachable, but dear. A generator that wants dense ground reads these.
    overBudget,
    withinBudget: overBudget.length === 0,
    budget,
    worstDistance: worst,
    worstId,
    openCells: open,
    reachableCells: reached,
    // Fraction of walkable ground the party can actually get to. Not a pass/fail
    // gate (pockets behind spires are fine scenery) but a smell test: a world
    // where most of the floor is stranded is a bad world even if the objectives
    // happen to be reachable.
    reachableFraction: open ? reached / open : 0,
  };
}

// Scratch buffers for findPath. Reused rather than reallocated: the companions
// repath several times a second each, and two fresh typed arrays per call is
// avoidable garbage in the long-run simulations. Safe because findPath is
// synchronous, single-threaded, and never re-entrant.
// SIZED TO THE WORLD, not to GRID. Sized to the basin they silently truncated
// every path on the camp's larger grid: the BFS would run off the end of `seen`,
// read undefined, and return null or a path through a wall — a companion that
// stops following, with nothing thrown.
let PATH_PREV = new Int32Array(GRID * GRID);
let PATH_SEEN = new Uint8Array(GRID * GRID);
function scratch(cells) {
  if (PATH_PREV.length < cells) {
    PATH_PREV = new Int32Array(cells);
    PATH_SEEN = new Uint8Array(cells);
  }
}

/** Grid path (BFS) between two cells, as an array of {cx,cz}. Used by NPC AI. */
export function findPath(world, from, to) {
  const GRID = gridOf(world);
  const startIdx = from.cz * GRID + from.cx;
  const goalIdx = to.cz * GRID + to.cx;
  if (startIdx === goalIdx) return [];
  scratch(GRID * GRID);
  const prev = PATH_PREV.fill(-1);
  const seen = PATH_SEEN.fill(0);
  if (!inBounds(from.cx, from.cz, GRID) || world.blocked[startIdx]) return null;
  const queue = [startIdx];
  seen[startIdx] = 1;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    if (idx === goalIdx) break;
    const cx = idx % GRID, cz = (idx - cx) / GRID;
    for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
      if (!inBounds(nx, nz, GRID)) continue;
      const ni = nz * GRID + nx;
      if (seen[ni] || world.blocked[ni]) continue;
      seen[ni] = 1;
      prev[ni] = idx;
      queue.push(ni);
    }
  }
  if (!seen[goalIdx]) return null;
  const path = [];
  for (let idx = goalIdx; idx !== -1 && idx !== startIdx; idx = prev[idx]) {
    const cx = idx % GRID;
    path.push({ cx, cz: (idx - cx) / GRID });
  }
  return path.reverse();
}
