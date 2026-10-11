// trail.js — the woods Seven walks through. Pure: no DOM, no Three.
//
// The basin (world.js) is one 46-cell clearing; seven route bands across it were
// seventeen metres each, barely a clearing apiece. This is the traverse the
// design note asks for (docs/IDEAS.md, "THE WOODS"; docs/blueprint-0.35): ONE
// large map, south to north, cut into SEVEN AREAS stacked along the route.
//
//   * Area 1 (nearest camp) is dense forest with one path through it, and a
//     deadfall across the path. There is no way round. It is a TIME gate, not a
//     wall: anyone can chop it, a logger chops it faster.
//   * Later areas open into clearings off the main trail. Every clearing hangs
//     off the trail by a spur, so the trail is still the only way north, and a
//     deadfall on it in areas 3 and 5 is a gate too.
//   * Pylons: 3 in area 1, then 2–4 in each later area, each in its own pocket
//     off the trail. Every area's count is DRAWN, area 1's included, so the
//     stream position never depends on which area is which.
//
// The world shape is the same plain object world.js and camp.js return, so every
// consumer takes it without knowing where it came from. It carries `cellKind`,
// which is what makes the renderer draw trees and a dirt path instead of rock.
//
// CONSTANT ROLL COUNT: every loop below draws a fixed number of values per
// iteration whatever it decides. A generator whose draw count depends on what it
// already placed re-phases every later consumer of the same stream.

import { makeRng } from "./rng.js?v=seven-0.34.0";
import { CELL, FEATURE, cellToWorld } from "./world.js?v=seven-0.34.0";
import { CELL_KIND } from "./camp.js?v=seven-0.34.0";

/** Cells per side. 120 x 2.6 m is about 310 m — seven areas of ~16 cells each. */
export const TRAIL_GRID = 120;
export const TRAIL_AREAS = 7;
/** Areas (0-based) whose stretch of trail is crossed by a deadfall. */
export const DEADFALL_AREAS = Object.freeze([0, 2, 4]);
/** Pylons in the first area; later areas roll PYLONS_MIN..PYLONS_MAX. */
export const PYLONS_FIRST = 3;
export const PYLONS_MIN = 2;
export const PYLONS_MAX = 4;

const G = TRAIL_GRID;
const RIM = 3;
const CAMP_CZ = G - 9;          // camp sits near the south edge
const EXIT_CZ = 2;              // the route ends at the north edge
const at = (cx, cz) => cz * G + cx;
const inside = (cx, cz) => cx >= RIM && cz >= 1 && cx < G - RIM && cz < G - RIM;

/** Which area (0-based) a row of the map belongs to. Row CAMP_CZ is area 0. */
export function areaOfRow(cz) {
  const span = (CAMP_CZ - EXIT_CZ) / TRAIL_AREAS;
  return Math.max(0, Math.min(TRAIL_AREAS - 1, Math.floor((CAMP_CZ - cz) / span)));
}
/** The rows [north, south] an area spans. */
export function areaRows(a) {
  const span = (CAMP_CZ - EXIT_CZ) / TRAIL_AREAS;
  const south = Math.round(CAMP_CZ - a * span);
  const north = Math.round(CAMP_CZ - (a + 1) * span) + 1;
  return { north, south };
}

function makeHeight(rng) {
  const LN = 24;
  const lattice = [];
  for (let i = 0; i <= LN; i++) {
    lattice.push([]);
    for (let j = 0; j <= LN; j++) lattice[i].push(rng());
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  return function heightAt(cx, cz) {
    const u = Math.min(Math.max(cx / G, 0), 0.999) * LN;
    const v = Math.min(Math.max(cz / G, 0), 0.999) * LN;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = smooth(u - i), fv = smooth(v - j);
    const top = lattice[i][j] + (lattice[i + 1][j] - lattice[i][j]) * fu;
    const bot = lattice[i][j + 1] + (lattice[i + 1][j + 1] - lattice[i][j + 1]) * fu;
    return (top + (bot - top) * fv - 0.5) * 2.4;
  };
}

/**
 * Generate the woods. Same seed, same woods, always.
 */
export function generateTrail(seed = 1) {
  const rng = makeRng((seed ^ 0x7a11c0de) >>> 0);
  const blocked = new Uint8Array(G * G).fill(1);
  const cellKind = new Uint8Array(G * G).fill(CELL_KIND.WOOD);
  for (let cz = 0; cz < G; cz++) {
    for (let cx = 0; cx < G; cx++) {
      if (!inside(cx, cz)) cellKind[at(cx, cz)] = CELL_KIND.TREELINE;
    }
  }
  const open = (cx, cz, kind) => {
    if (cx < 1 || cz < 0 || cx >= G - 1 || cz >= G - 1) return;
    blocked[at(cx, cz)] = 0;
    cellKind[at(cx, cz)] = kind;
  };
  const clearDisc = (ccx, ccz, r, kind = CELL_KIND.NONE) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + r) continue;
        const cx = ccx + dx, cz = ccz + dz;
        if (inside(cx, cz) && cellKind[at(cx, cz)] !== CELL_KIND.PATH) open(cx, cz, kind);
      }
    }
  };

  // ---- the main trail, south to north ---------------------------------------
  // A drifting walk with momentum, two cells wide. `trailX[cz]` is the trail's
  // west cell on row cz; the trail is that cell and the one east of it.
  const trailX = new Int16Array(G).fill(-1);
  let x = G / 2, vel = 0;
  for (let cz = CAMP_CZ; cz >= EXIT_CZ - 1; cz--) {
    const r = rng();                 // one draw per row, always
    if (r < 0.18) vel = -1; else if (r < 0.36) vel = 1; else if (r < 0.62) vel = 0;
    x = Math.max(RIM + 10, Math.min(G - RIM - 11, x + vel));
    trailX[cz] = x;
    open(x, cz, CELL_KIND.PATH);
    open(x + 1, cz, CELL_KIND.PATH);
    // A diagonal step needs its corner opened or the two rows only touch at a
    // point, and a body cannot pass a point.
    const prev = trailX[cz + 1];
    if (cz < CAMP_CZ && prev >= 0 && prev !== x) {
      const lo = Math.min(prev, x), hi = Math.max(prev, x) + 1;
      for (let k = lo; k <= hi; k++) open(k, cz, CELL_KIND.PATH);
    }
  }
  // The rim opens where the trail leaves, so the far edge is a way out.
  open(trailX[EXIT_CZ - 1], 0, CELL_KIND.PATH);
  open(trailX[EXIT_CZ - 1] + 1, 0, CELL_KIND.PATH);

  // ---- camp ------------------------------------------------------------------
  const campCx = trailX[CAMP_CZ];
  clearDisc(campCx, CAMP_CZ, 5);
  for (let cz = CAMP_CZ - 5; cz <= CAMP_CZ + 3; cz++) open(campCx, cz, CELL_KIND.PATH), open(campCx + 1, cz, CELL_KIND.PATH);

  // ---- deadfalls across the trail --------------------------------------------
  // Rows are chosen first so clearings can keep away from them: a clearing that
  // spans a deadfall's row could connect the two sides and turn the gate into
  // a stroll round it.
  const deadfallRows = [];
  for (let a = 0; a < TRAIL_AREAS; a++) {
    const { north, south } = areaRows(a);
    const r = rng();                 // drawn for every area, used for three
    if (!DEADFALL_AREAS.includes(a)) continue;
    const row = Math.round(south - (south - north) * (0.55 + r * 0.25));
    deadfallRows.push({ a, row });
  }
  const nearDeadfall = (cz, margin) => deadfallRows.some((d) => Math.abs(d.row - cz) <= margin);

  // ---- pockets and clearings off the trail ------------------------------------
  // A pocket is a small clearing next to the trail; a clearing is a larger one
  // further out, joined by a straight spur. Both hang off ONE row of the trail.
  const carveSpur = (fromCx, cz, toCx) => {
    const lo = Math.min(fromCx, toCx), hi = Math.max(fromCx, toCx);
    for (let k = lo; k <= hi; k++) if (cellKind[at(k, cz)] !== CELL_KIND.PATH) open(k, cz, CELL_KIND.PATH);
  };
  const pockets = [];   // { a, cx, cz }
  const clearings = []; // { a, cx, cz, r }
  for (let a = 0; a < TRAIL_AREAS; a++) {
    const { north, south } = areaRows(a);
    const rolledPylons = rng.int(PYLONS_MIN, PYLONS_MAX); // drawn for every area
    const nPylons = a === 0 ? PYLONS_FIRST : rolledPylons;
    for (let p = 0; p < PYLONS_MAX; p++) {
      const rRow = rng(), rSide = rng(), rOff = rng();   // three draws per slot, always
      if (p >= nPylons) continue;
      let cz = Math.round(north + 2 + rRow * Math.max(1, south - north - 4));
      if (a === 0 && cz > CAMP_CZ - 7) cz = CAMP_CZ - 7;
      if (nearDeadfall(cz, 2)) cz = Math.max(north + 1, cz - 4);
      const side = rSide < 0.5 ? -1 : 1;
      const off = 4 + Math.floor(rOff * 4);
      const tx = trailX[cz];
      const pcx = side < 0 ? tx - off : tx + 1 + off;
      clearDisc(pcx, cz, 2);
      carveSpur(side < 0 ? tx : tx + 1, cz, pcx);
      pockets.push({ a, cx: pcx, cz });
    }
    // Clearings: none in area 0 (it is the dense forest), 3 in every other.
    for (let k = 0; k < 3; k++) {
      const rRow = rng(), rSide = rng(), rOff = rng(), rRad = rng();
      if (a === 0) continue;
      const r = 3 + Math.floor(rRad * 3);
      let cz = Math.round(north + r + 1 + rRow * Math.max(1, south - north - 2 * r - 2));
      if (nearDeadfall(cz, r + 3)) continue;
      const side = rSide < 0.5 ? -1 : 1;
      const tx = trailX[cz];
      const off = r + 3 + Math.floor(rOff * 14);
      const ccx = Math.max(RIM + r + 1, Math.min(G - RIM - r - 2, side < 0 ? tx - off : tx + 1 + off));
      if (Math.abs(ccx - tx) <= r + 2) continue; // would swallow the trail
      clearDisc(ccx, cz, r);
      carveSpur(side < 0 ? tx : tx + 1, cz, ccx);
      clearings.push({ a, cx: ccx, cz, r });
    }
  }

  // Deadfall cells close the trail on their row. Laid last, over PATH, so the
  // spurs above can never re-open them. Tagged PATH, so they draw as the trail
  // under a fallen trunk rather than as rock.
  const deadfalls = deadfallRows.map(({ a, row }, i) => {
    const tx = trailX[row];
    const cells = [];
    for (let k = tx - 1; k <= tx + 2; k++) {
      if (!blocked[at(k, row)]) { blocked[at(k, row)] = 1; cells.push({ cx: k, cz: row }); }
    }
    return {
      id: `df${i}`, kind: FEATURE.DEADFALL, area: a,
      cx: tx, cz: row, horiz: true, cells, cleared: false, progress: 0,
      ...cellToWorld(tx + 0.5, row, G),
    };
  });

  // ---- features ---------------------------------------------------------------
  const pylons = pockets.map((p, i) => ({
    id: `p${i}`, kind: FEATURE.PYLON, area: p.a, cx: p.cx, cz: p.cz, ...cellToWorld(p.cx, p.cz, G),
  }));
  // Raw materials and items, in clearings (and, in area 0, round the camp, where
  // the first fire's wood has to come from).
  const trees = [], stones = [], items = [];
  const placeIn = (spots, list, kind, prefix, extra = () => ({})) => {
    for (const s of spots) {
      const ang = rng() * Math.PI * 2, rr = rng();      // two draws, always
      const rad = Math.max(1, (s.r || 2) - 1) * (0.4 + rr * 0.6);
      let cx = Math.round(s.cx + Math.cos(ang) * rad), cz = Math.round(s.cz + Math.sin(ang) * rad);
      if (blocked[at(cx, cz)]) { cx = s.cx; cz = s.cz; }
      list.push({ id: `${prefix}${list.length}`, kind, cx, cz, ...cellToWorld(cx, cz, G), ...extra() });
    }
  };
  const campRing = [0, 1, 2, 3].map((k) => ({ cx: campCx + [-3, 4, -3, 4][k], cz: CAMP_CZ + [-2, -2, 2, 2][k], r: 1 }));
  placeIn(campRing.slice(0, 3), trees, FEATURE.TREE, "t");
  placeIn(campRing.slice(3), stones, FEATURE.STONE, "st");
  for (const c of clearings) {
    placeIn([c, c], trees, FEATURE.TREE, "t");
    placeIn([c], stones, FEATURE.STONE, "st");
  }
  const ITEM_KINDS = ["flare", "tether", "lens", "husk"];
  const itemSpots = clearings.filter((_, i) => i % 2 === 0);
  placeIn(itemSpots, items, FEATURE.ITEM, "i", () => ({ itemKind: ITEM_KINDS[Math.floor(rng() * ITEM_KINDS.length)] }));

  const camp = { id: "camp", kind: FEATURE.CAMP, cx: campCx, cz: CAMP_CZ, ...cellToWorld(campCx + 0.5, CAMP_CZ, G) };
  return {
    seed,
    grid: G,
    cell: CELL,
    blocked,
    cellKind,
    heightAt: makeHeight(rng),
    camp,
    spawn: { ...camp },
    monoliths: [],
    pylons,
    items,
    trees,
    stones,
    deadfalls,
    repairs: 0,
    // Trail-only. Ignored by consumers that do not know about them.
    trail: { areas: TRAIL_AREAS, exitCz: EXIT_CZ, campCz: CAMP_CZ, trailX: Array.from(trailX) },
  };
}
