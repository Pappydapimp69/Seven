// lib.mjs — shared helpers for the pure tests: a tiny harness, and a lead
// who can walk somewhere by the real tick() with real input.

import * as S from "../src/sim.js";
import { pathTo, deadfallRow, areaBottom } from "../src/world.js";

export function harness(name) {
  let passed = 0; const failures = [];
  return {
    check(n, f) { try { f(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } },
    done() {
      if (failures.length) { console.log(`${name}: ${passed} passed, ${failures.length} failed`); for (const f of failures) console.log(" - " + f); process.exit(1); }
      console.log(`${name}: ${passed} passed`);
    },
  };
}
export const assert = (c, m) => { if (!c) throw new Error(m); };

/** Answer whatever panel is pending with sensible defaults. */
export function autoPanels(sim, { dawn, dusk } = {}) {
  if (sim.pending === "dawn") S.applyPlan(sim, "dawn", dawn || {});
  else if (sim.pending === "dusk") S.applyPlan(sim, "dusk", dusk || {});
}

/** Walk the lead to a world point with real input. Returns true on arrival. */
export function walk(sim, x, y, { maxTicks = 20000, onPending = autoPanels } = {}) {
  const c = { cx: Math.floor(sim.lead.x), cy: Math.floor(sim.lead.y) };
  const path = pathTo(sim.world, c.cx, c.cy, Math.floor(x), Math.floor(y));
  if (!path) return false;
  const pts = path.map((p) => ({ x: p.cx + 0.5, y: p.cy + 0.5 })).concat([{ x, y }]);
  let n = 0;
  for (const p of pts) {
    while (Math.hypot(sim.lead.x - p.x, sim.lead.y - p.y) > 0.15) {
      if (sim.status !== "playing" || n++ > maxTicks) return false;
      if (sim.pending) { onPending(sim); if (sim.pending) return false; continue; }
      if (sim.lead.busy) { S.tick(sim, {}); continue; }
      const dx = p.x - sim.lead.x, dy = p.y - sim.lead.y, d = Math.hypot(dx, dy);
      const k = Math.min(1, d / 0.13);
      S.tick(sim, { mx: (dx / d) * k, my: (dy / d) * k });
    }
  }
  return true;
}

/** Tick until the lead's hands are free (or a panel needs answering). */
export function finish(sim, onPending = autoPanels, max = 200000) {
  for (let i = 0; i < max && sim.status === "playing"; i++) {
    if (sim.pending) { onPending(sim); if (sim.pending) return; continue; }
    if (!sim.lead.busy) return;
    S.tick(sim, {});
  }
}

/** Where to stand to chop a deadfall: the trail cell just south of it. */
export const chopSpot = (sim, d) => ({ x: sim.world.trailX[d.row + 1] + 0.5, y: d.row + 1.5 });
/** A camp spot near the south end of an area, on the trail. */
export const campSpotIn = (sim, a) => { const y = areaBottom(a) - 3; return { x: sim.world.trailX[y] + 0.5, y: y + 0.5 }; };
export { S, deadfallRow };
