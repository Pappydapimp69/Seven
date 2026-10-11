// world.js — the woods. One grid, one trail, seven areas south to north. Pure.
//
// Dense forest everywhere except a 3-wide trail, a clearing at the start camp,
// pockets off the trail (each holds a pylon), and the far side at the top.
// Each area 0..5 ends in a DEADFALL row: the trunk across the trail, and forest
// on every other cell of that row. The trunk is the only way north. Pockets
// stay 4+ rows clear of every deadfall row, so nothing ever opens beside one.
//
// Felled trees leave STUMPS, which are blocked: felling can never open a way
// round a deadfall. All world generation draws from its own rng (seed-derived),
// so the run's sim stream is independent of the map.

import { createRng } from "./rng.js?v=seven-1.7.0";
import { MAP_W, MAP_H, AREA_H, AREAS, TRAIL_HALF, EXIT_ROWS } from "./config.js?v=seven-1.7.0";

export const K = Object.freeze({ FOREST: 0, TRAIL: 1, CLEAR: 2, DEADFALL: 3, STUMP: 4, TREE: 5, EXIT: 6 });
const WALKABLE = [false, true, true, false, false, false, true];

export const areaOfRow = (r) => Math.max(0, Math.min(AREAS - 1, Math.floor((MAP_H - 1 - r) / AREA_H)));
export const areaTop = (a) => MAP_H - (a + 1) * AREA_H;
export const areaBottom = (a) => MAP_H - a * AREA_H - 1;
export const deadfallRow = (a) => areaTop(a) + 1;

export function createWorld(seed) {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const W = MAP_W, H = MAP_H;
  const grid = new Uint8Array(W * H);          // all forest
  const at = (x, y) => y * W + x;
  const inside = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  const set = (x, y, k) => { if (inside(x, y)) grid[at(x, y)] = k; };

  // The trail: a walk north that drifts, straight across every deadfall row.
  const dfRows = new Set();
  for (let a = 0; a < AREAS - 1; a++) dfRows.add(deadfallRow(a));
  const trailX = new Array(H).fill(-1);
  let x = Math.floor(W / 2), drift = 0;
  for (let y = H - 2; y >= 1; y--) {
    const nearDf = dfRows.has(y) || dfRows.has(y + 1) || dfRows.has(y - 1) || dfRows.has(y + 2) || dfRows.has(y - 2);
    if (!nearDf && y % 3 === 0) {
      const r = rng.next();
      drift = r < 0.3 ? -1 : r < 0.6 ? 1 : drift;
      x = Math.max(6, Math.min(W - 7, x + drift));
    } else rng.next();
    trailX[y] = x;
    for (let k = -TRAIL_HALF; k <= TRAIL_HALF; k++) set(x + k, y, K.TRAIL);
  }

  // The start camp: a clearing round the trail near the south edge.
  const campY = H - 6, campX = trailX[campY];
  carveEllipse(campX, campY, 5, 3.5, K.CLEAR);

  // Pockets, each with a pylon, off the trail. Area 0 has 3; later areas 2-4.
  const pockets = [], pylons = [];
  for (let a = 0; a < AREAS; a++) {
    const top = areaTop(a);
    const n = a === 0 ? 3 : rng.int(2, 4);
    const used = [];
    for (let i = 0, guard = 0; i < n && guard < 400; guard++) {
      const y = rng.int(top + 7, top + 17);
      const side = rng.next() < 0.5 ? -1 : 1;
      const px = Math.max(4, Math.min(W - 5, trailX[y] + side * rng.int(7, 11)));
      if (Math.abs(px - trailX[y]) < 5) continue;
      if (used.some((u) => Math.abs(u.y - y) < 4 && Math.sign(u.x - trailX[u.y]) === side)) continue;
      if (a === 0 && Math.abs(y - campY) < 5 && Math.abs(px - campX) < 9) continue;
      used.push({ x: px, y });
      // spur from the trail edge to the pocket
      const from = trailX[y] + side * (TRAIL_HALF + 1);
      for (let cx = from; cx !== px; cx += side) set(cx, y, K.TRAIL);
      carveEllipse(px, y, 2.6, 2.2, K.CLEAR);
      pockets.push({ id: `k${pockets.length}`, area: a, x: px, y });
      pylons.push({ id: `p${pylons.length}`, area: a, x: px + 0.5, y: y + 0.5, state: "dark", litAt: null });
      i++;
    }
  }

  // The far side.
  for (let y = 1; y <= EXIT_ROWS; y++) for (let cx = 3; cx <= W - 4; cx++) set(cx, y, K.EXIT);

  // Deadfalls: the trunk across the trail; the whole row sealed.
  const deadfalls = [];
  for (let a = 0; a < AREAS - 1; a++) {
    const y = deadfallRow(a);
    for (let cx = 1; cx < W - 1; cx++) set(cx, y, K.FOREST);
    const x0 = trailX[y] - TRAIL_HALF, x1 = trailX[y] + TRAIL_HALF;
    for (let cx = x0; cx <= x1; cx++) set(cx, y, K.DEADFALL);
    deadfalls.push({ id: `d${a}`, area: a, row: y, x0, x1, x: trailX[y] + 0.5, y: y + 0.5, progress: 0, cleared: false });
  }

  // Trees that can be felled: forest cells beside clearings and the trail.
  const trees = [];
  const nearOpen = (cx, cy) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const k = grid[at(cx + dx, cy + dy)];
    return k === K.CLEAR || k === K.TRAIL;
  });
  for (let cy = 2; cy < H - 2; cy++) {
    for (let cx = 2; cx < W - 2; cx++) {
      if (grid[at(cx, cy)] !== K.FOREST || dfRows.has(cy)) { rng.next(); continue; }
      const p = nearOpen(cx, cy) ? 0.16 : 0;
      if (rng.next() < p) { grid[at(cx, cy)] = K.TREE; trees.push({ id: `t${trees.length}`, cx, cy, felled: false }); }
    }
  }

  return {
    seed, W, H, grid, trailX, pockets, pylons, deadfalls, trees,
    start: { x: campX + 0.5, y: campY + 0.5 },
  };

  function carveEllipse(cx0, cy0, rx, ry, k) {
    for (let cy = Math.floor(cy0 - ry); cy <= Math.ceil(cy0 + ry); cy++) {
      for (let cx = Math.floor(cx0 - rx); cx <= Math.ceil(cx0 + rx); cx++) {
        const dx = (cx - cx0) / rx, dy = (cy - cy0) / ry;
        if (dx * dx + dy * dy <= 1 && inside(cx, cy) && grid[at(cx, cy)] === K.FOREST) grid[at(cx, cy)] = k;
      }
    }
  }
}

export const kindAt = (w, cx, cy) => (cx < 0 || cy < 0 || cx >= w.W || cy >= w.H ? K.FOREST : w.grid[cy * w.W + cx]);
export const walkable = (w, cx, cy) => WALKABLE[kindAt(w, cx, cy)];

export function clearDeadfall(w, d) {
  d.cleared = true; d.progress = 1;
  for (let cx = d.x0; cx <= d.x1; cx++) w.grid[d.row * w.W + cx] = K.TRAIL;
}
export function fellTree(w, t) {
  t.felled = true;
  w.grid[t.cy * w.W + t.cx] = K.STUMP;
}

/**
 * Breadth-first search, 4-way (no corner cuts), from a cell until `goal(cx,cy)`
 * holds. Returns the path as cells AFTER the start, ending on the goal cell;
 * [] when already there; null when there is no route.
 */
export function bfs(w, sx, sy, goal, maxNodes = w.W * w.H) {
  if (goal(sx, sy)) return [];
  const W = w.W, prev = new Int32Array(W * w.H).fill(-1);
  const start = sy * W + sx;
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length && qi < maxNodes; qi++) {
    const cur = queue[qi], cx = cur % W, cy = (cur - cx) / W;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(w, nx, ny)) continue;
      const ni = ny * W + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      if (goal(nx, ny)) {
        const path = [];
        for (let i = ni; i !== start; i = prev[i]) path.push({ cx: i % W, cy: Math.floor(i / W) });
        return path.reverse();
      }
      queue.push(ni);
    }
  }
  return null;
}
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const pathTo = (w, sx, sy, tx, ty) => bfs(w, sx, sy, (x, y) => x === tx && y === ty);

/** Walkable cells off the trail in an area — where someone lost can be standing. */
export function lostSpots(w, a) {
  const out = [];
  for (const p of w.pockets) if (p.area === a) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if ((dx || dy) && kindAt(w, p.x + dx, p.y + dy) === K.CLEAR) out.push({ cx: p.x + dx, cy: p.y + dy });
    }
  }
  return out;
}
