// camp.js — putting camp up and taking it down, whoever's hands do it. Pure.
// Shared by the lead's actions (sim.js) and a companion's Move camp task
// (mates.js), so both follow the same rules: one camp at a time, the woodpile
// stays where it was, and walking camp forward past someone lost abandons
// them with no prompt and no message.

import { record } from "./chronicle.js?v=seven-1.18.0";
import { areaOfRow } from "./world.js?v=seven-1.18.0";
import { PILE_CAP, SURPLUS_CAP, CAMPDOWN_FALSE, DIRS8, FIRE_LIGHT_WOOD, LIGHT_WOOD_PER_AREA, BURN_PER_AREA } from "./config.js?v=seven-1.18.0";

const areaOf = (p) => areaOfRow(Math.floor(p.y));

export function makeCampAt(sim, x, y, who) {
  const prevArea = areaOf(sim.camp);
  sim.camp = { x, y, built: true, pile: 0, surplus: 0, fire: 0 };
  record(sim, "camp_made", who);
  if (areaOf(sim.camp) > prevArea) record(sim, "area", [], { area: areaOf(sim.camp) });
  sim.say(who.includes("lead") ? "Camp is up. The pile starts empty." : "Word comes back: camp is up further on.");
  const ms = sim.missing;
  if (ms && !ms.found && areaOf(sim.camp) > ms.area) { sim.lost.push({ name: ms.name, how: "left" }); sim.missing = null; }
}

export function takeCampDown(sim, who) {
  const c = sim.camp;
  if (c.pile > 0) sim.piles.push({ id: `pile${++sim.pileSeq}`, x: c.x, y: c.y + 1.2, wood: c.pile });
  if (c.surplus > 0) sim.piles.push({ id: `pile${++sim.pileSeq}`, x: c.x + 1.6, y: c.y + 1.2, wood: c.surplus, surplus: true });
  sim.camp = { x: c.x, y: c.y, built: false, pile: 0, surplus: 0, fire: 0 };
  record(sim, "camp_down", who);
  sim.say(who.includes("lead") ? "Camp comes down. The woodpile stays where it is." : "Camp is coming down. The woodpile stays.");
  // As camp comes down, a voice — from someone lost in this stretch, whom the
  // move would leave behind; or from nobody, as often as a dawn call lies.
  // Two draws every time (constant roll count). Its weight is in agreeing with
  // the bearing of this morning's call; alone it is only a voice.
  const r0 = sim.rng.next(), r1 = sim.rng.next();
  const ms = sim.missing, behind = ms && !ms.found && ms.area <= areaOf(c);
  let dir = null;
  if (behind) dir = bearingTo(c, ms);
  else if (r0 < CAMPDOWN_FALSE) dir = DIRS8[Math.floor(r1 * 8)];
  if (dir) { record(sim, "call", [], { dir }); sim.say(`As the camp comes down, a voice calls from the ${dir}.`); if (sim.sfx) sim.sfx("voice", { dir }); }
}

// ---- the woodpile and the surplus stack ----------------------------------------
/** All the wood at camp. */
export const campWood = (c) => (c.built ? (c.pile || 0) + (c.surplus || 0) : 0);
/** Stack wood: the pile by the fire fills first, then the surplus stack. Returns what would not fit. */
export function stackWood(c, n) {
  const toPile = Math.min(n, Math.max(0, PILE_CAP - (c.pile || 0)));
  c.pile = (c.pile || 0) + toPile; n -= toPile;
  const toSurplus = Math.min(n, Math.max(0, SURPLUS_CAP - (c.surplus || 0)));
  c.surplus = (c.surplus || 0) + toSurplus;
  return n - toSurplus;
}
/** Take wood for the fire: the pile first, then the surplus. Returns how many were taken. */
export function takeWood(c, n) {
  const a = Math.min(n, c.pile || 0); c.pile -= a;
  const b = Math.min(n - a, c.surplus || 0); c.surplus = (c.surplus || 0) - b;
  return a + b;
}

function bearingTo(from, to) {
  const ang = Math.atan2(to.x - from.x, -(to.y - from.y));
  return DIRS8[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
}

// ---- the deeper the camp, the hungrier the fire ----------------------------------
/** Wood to light a fire at a camp in woods `area` (0 = the first). */
export const lightWoodFor = (area) => FIRE_LIGHT_WOOD + area * LIGHT_WOOD_PER_AREA;
/** How many times faster a fire burns there. */
export const burnMultFor = (area) => 1 + BURN_PER_AREA * area;
