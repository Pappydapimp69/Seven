// percept.js — what the lead sees. The ONLY module allowed to lie. It reads the
// sim and never writes to it. The renderer and HUD draw from this, never from
// the sim directly.
//
// The lies are small and in the world, never in a meter: past a point a dead
// pylon still looks lit, a dead fire still looks lit, and at night someone
// stands at the edge of the light who is not there. The count always says
// "Seven of you" — that one is not the percept lying, it is the game.

import { hash01 } from "./rng.js?v=seven-1.12.2";
import { walkable } from "./world.js?v=seven-1.12.2";
import { isNight, minutes, found } from "./sim.js?v=seven-1.12.2";
import { working } from "./mates.js?v=seven-1.12.2";
import { LIE_BELOW, FIRE_LIE_BELOW, PYLON_BURN } from "./config.js?v=seven-1.12.2";

export function perceive(sim) {
  const L = sim.lead, luc = L.lucidity, now = minutes(sim);
  const lying = luc < LIE_BELOW;
  const people = sim.mates.filter((m) => !m.hidden).map((m) => ({ id: m.id, name: m.name, slot: m.slot, x: m.x, y: m.y, asleep: m.asleep, carrying: !!(m.task && m.task.carry), work: working(m) }));
  const f = found(sim);
  if (f) people.push({ id: f.id + "f", name: f.name, slot: f.slot, x: f.x, y: f.y, asleep: false });

  if (lying && isNight(sim)) {
    const hour = Math.floor(now / 60);
    const ang = hash01(`${sim.seed}:${hour}:a`) * Math.PI * 2;
    const x = L.x + Math.cos(ang) * 6.5, y = L.y + Math.sin(ang) * 6.5;
    if (walkable(sim.world, Math.floor(x), Math.floor(y))) {
      const r = sim.roster[Math.floor(hash01(`${sim.seed}:${hour}:n`) * sim.roster.length)];
      people.push({ id: "phantom", name: r.name, slot: sim.roster.indexOf(r), x, y, asleep: false });
    }
  }

  const pylons = sim.world.pylons.map((p) => {
    let state = p.state, age = p.state === "lit" ? (now - p.litAt) / PYLON_BURN : 0;
    if (lying && p.state === "spent") { state = "lit"; age = 0.4; }
    return { id: p.id, x: p.x, y: p.y, state, age };
  });

  const c = sim.camp;
  let fire = c.built && c.fire > 0 ? c.fire : 0;
  if (c.built && fire <= 0 && luc < FIRE_LIE_BELOW) fire = 2;

  // A camp going up (or coming down) shows how far along it is.
  let building = null;
  const b = L.busy;
  if (b && (b.kind === "camp_make" || b.kind === "camp_down") && Number.isFinite(b.total)) {
    const p = 1 - b.left / b.total;
    building = b.kind === "camp_make" && b.at ? { x: b.at.x, y: b.at.y, frac: p } : null;
  }
  for (const m of sim.mates) {
    const t = m.task;
    if (t && t.kind === "move" && t.stage === "up" && t.dest && t.need) building = { x: t.dest.cx + 0.5, y: t.dest.cy + 0.5, frac: Math.min(1, t.chunk / t.need) };
  }
  const takingDown = b && b.kind === "camp_down" && Number.isFinite(b.total) ? 1 - (1 - b.left / b.total) : 1;

  return {
    building, takingDown,
    lead: { x: L.x, y: L.y, facing: L.facing, busy: L.busy ? L.busy.kind : null, carry: L.carry, asleep: L.asleep },
    people, pylons,
    camp: c.built ? { x: c.x, y: c.y, pile: c.pile, surplus: c.surplus || 0, fire } : null,
    piles: sim.piles.map((p) => ({ id: p.id, x: p.x, y: p.y, wood: p.wood, surplus: !!p.surplus })),
    count: "Seven of you",
  };
}
