// camp.js — putting camp up and taking it down, whoever's hands do it. Pure.
// Shared by the lead's actions (sim.js) and a companion's Move camp task
// (mates.js), so both follow the same rules: one camp at a time, the woodpile
// stays where it was, and walking camp forward past someone lost abandons
// them with no prompt and no message.

import { record } from "./chronicle.js?v=seven-1.3.0";
import { areaOfRow } from "./world.js?v=seven-1.3.0";

const areaOf = (p) => areaOfRow(Math.floor(p.y));

export function makeCampAt(sim, x, y, who) {
  const prevArea = areaOf(sim.camp);
  sim.camp = { x, y, built: true, pile: 0, fire: 0 };
  record(sim, "camp_made", who);
  if (areaOf(sim.camp) > prevArea) record(sim, "area", [], { area: areaOf(sim.camp) });
  sim.say(who.includes("lead") ? "Camp is up. The pile starts empty." : "Word comes back: camp is up further on.");
  const ms = sim.missing;
  if (ms && !ms.found && areaOf(sim.camp) > ms.area) { sim.lost.push({ name: ms.name, how: "left" }); sim.missing = null; }
}

export function takeCampDown(sim, who) {
  const c = sim.camp;
  if (c.pile > 0) sim.piles.push({ id: `pile${++sim.pileSeq}`, x: c.x, y: c.y + 1.2, wood: c.pile });
  sim.camp = { x: c.x, y: c.y, built: false, pile: 0, fire: 0 };
  record(sim, "camp_down", who);
  sim.say(who.includes("lead") ? "Camp comes down. The woodpile stays where it is." : "Camp is coming down. The woodpile stays.");
}
