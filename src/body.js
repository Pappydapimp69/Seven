// body.js — moving a body on the grid, and walking a path. Pure.

import { walkable, pathTo } from "./world.js?v=seven-1.18.0";
import { BODY_R } from "./config.js?v=seven-1.18.0";

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const cellOf = (p) => ({ cx: Math.floor(p.x), cy: Math.floor(p.y) });

function clear(w, x, y) {
  const r = BODY_R;
  return walkable(w, Math.floor(x - r), Math.floor(y - r)) && walkable(w, Math.floor(x + r), Math.floor(y - r))
    && walkable(w, Math.floor(x - r), Math.floor(y + r)) && walkable(w, Math.floor(x + r), Math.floor(y + r));
}

/** Move by (dx, dy), axis by axis, stopping at blocked cells. Returns true if it moved. */
export function moveBody(w, b, dx, dy) {
  let moved = false;
  if (dx && clear(w, b.x + dx, b.y)) { b.x += dx; moved = true; }
  if (dy && clear(w, b.x, b.y + dy)) { b.y += dy; moved = true; }
  if (dx || dy) b.facing = Math.atan2(dy, dx);
  return moved;
}

/**
 * Walk toward goal cell along a BFS path. `b.path` is null when not computed
 * (Brain opticon#E22: an EMPTY path means "computed, nothing to walk" and must
 * not trigger a re-search every tick). Returns "arrived" | "walking" | "stuck".
 */
export function walkTo(w, b, gx, gy, speed) {
  if (!b.goal || b.goal.cx !== gx || b.goal.cy !== gy || (b.repath = (b.repath || 0) - 1) <= 0) {
    const c = cellOf(b);
    b.goal = { cx: gx, cy: gy };
    b.path = pathTo(w, c.cx, c.cy, gx, gy);
    b.repath = 150;
  }
  if (b.path === null) return "stuck";
  const target = b.path.length ? { x: b.path[0].cx + 0.5, y: b.path[0].cy + 0.5 } : { x: gx + 0.5, y: gy + 0.5 };
  const d = dist(b, target);
  if (d < 0.12) {
    if (b.path.length) { b.path.shift(); return "walking"; }
    return "arrived";
  }
  const s = Math.min(speed, d);
  const dx = ((target.x - b.x) / d) * s, dy = ((target.y - b.y) / d) * s;
  if (!moveBody(w, b, dx, dy)) {
    // Snag on a corner: snap to the cell centre we are in, then carry on.
    const c = cellOf(b);
    b.x += (c.cx + 0.5 - b.x) * 0.5; b.y += (c.cy + 0.5 - b.y) * 0.5;
  }
  return "walking";
}

/** The nearest walkable cell to a point, searching outward. */
export function nearestWalkable(w, x, y) {
  const cx = Math.floor(x), cy = Math.floor(y);
  for (let r = 0; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (walkable(w, cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy };
    }
  }
  return { cx, cy };
}
