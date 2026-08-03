// scenario-deception.mjs — a narrated walk through the crafting-deception
// chain, run against the real sim.
//
// This is not a substitute for tests/logic.test.mjs (which asserts the same
// behaviours in isolation). It exists because this feature's requirements
// arrived as several co-equal clauses in prose, and a suite full of green
// unit assertions is not by itself evidence that the STORY those clauses
// describe actually plays out end to end. Each section below is one clause,
// checked independently, and the script exits non-zero if any of them stops
// being true.
//
// Run: node tests/scenario-deception.mjs

import {
  createRun, craftItem, useItem, companionPickup, handoffToPlayer, offerItem,
  beginHallucinating, ITEM_INFO, MAX_LUCIDITY,
} from "../src/state.js";
import { createPercept, updatePercept, perceivedInventory, believedKinds } from "../src/percept.js";

let failures = 0;
function clause(n, text) {
  console.log(`\n\x1b[1m── CLAUSE ${n}\x1b[0m ${text}`);
}
function show(line) {
  console.log(`   ${line}`);
}
function must(cond, msg) {
  if (cond) {
    console.log(`   \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    console.log(`   \x1b[31m✗ ${msg}\x1b[0m`);
    failures++;
  }
}
/** What the item bar is showing the lead right now, as plain labels. */
const barReads = (percept, sim) =>
  perceivedInventory(percept, sim).map((s) => s.label).join(" · ") || "(empty)";

// ---------------------------------------------------------------------------
clause(1, "“the crafted item might not be real if the player is hallucinating”");
{
  const sim = createRun({ seed: 4001 });
  const percept = createPercept();
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: true, kind: "flare", claimedKind: null });

  beginHallucinating(sim, sim.player);
  updatePercept(percept, sim, 0.1);
  // Pin the bar's lie so the walk-through is deterministic: it reads tether+flare.
  percept.itemLabels.set("a", "tether");
  percept.itemLabels.set("b", "flare");

  show(`truth in hand : flare + flare`);
  show(`bar shows     : ${barReads(percept, sim)}`);

  const res = craftItem(sim, -1, believedKinds(percept, sim));
  show(`craft result  : "${sim.events[sim.events.length - 1].text}"`);
  must(res.ok && res.kind === "ember", "the craft the lead believed in went through");
  must(res.real === false, "and what it produced was never there");
  must(sim.inventory[0].claimedKind === "ember", "the slot goes on insisting it is an Ember");
}

// ---------------------------------------------------------------------------
clause(2, "“…or if the ingredient item was picked up while hallucinating by them or another party member”");
{
  const sim = createRun({ seed: 4002 });
  // This lead is LUCID for every moment of this scene. The rot came in with
  // the ingredient, not with them.
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: false, claimedKind: "tether", kind: null });

  must(sim.player.hallucinating === false, "the lead is not hallucinating and never was");
  const res = craftItem(sim);
  show(`craft result  : "${sim.events[sim.events.length - 1].text}"`);
  must(res.ok && res.kind === "ember", "a lucid lead can still complete the recipe");
  must(res.real === false, "and still end up holding nothing at all");
}

// ---------------------------------------------------------------------------
clause(3, "“combining two of the same ingredients … produces the same final craft item for whoever crafted it”");
{
  // An honest Ember and a false one, side by side. If a player could tell
  // these apart at the moment of crafting, the whole mechanic is dead.
  const honest = createRun({ seed: 4003 });
  honest.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  honest.inventory.push({ id: "b", real: true, kind: "tether", claimedKind: null });
  const hres = craftItem(honest);
  const hev = honest.events[honest.events.length - 1];

  const fake = createRun({ seed: 4004 });
  fake.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  fake.inventory.push({ id: "b", real: false, claimedKind: "tether", kind: null });
  const fres = craftItem(fake);
  const fev = fake.events[fake.events.length - 1];

  show(`honest craft  : [${hev.kind}] "${hev.text}"`);
  show(`false craft   : [${fev.kind}] "${fev.text}"`);
  must(hres.real === true && fres.real === false, "one is real and one is not");
  must(hev.text === fev.text, "the two are word-for-word identical on screen");
  must(hev.kind === fev.kind, "and carry the same event kind, so the HUD styles them the same");
}

// ---------------------------------------------------------------------------
clause(4, "“when that npc or player … uses that hallucination, the hallucination breaks”");
{
  const sim = createRun({ seed: 4005 });
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: false, claimedKind: "tether", kind: null });
  craftItem(sim);
  sim.player.lucidity = 60;
  const before = sim.player.lucidity;

  const ures = useItem(sim, 0);
  show(`reaching for it: "${sim.events[sim.events.length - 1].text}"`);
  must(ures.real === false, "the Ember does nothing an Ember does");
  must(sim.player.lucidity < before, `and reaching for it costs (${before} → ${sim.player.lucidity})`);
  must(sim.stats.phantomItemsUsed === 1, "counted as a phantom use");
}

// ---------------------------------------------------------------------------
clause(5, "“…or tries to trade it … the receiving player sees it as what it is”  (the flashlight)");
{
  const sim = createRun({ seed: 4006 });
  const iren = sim.companions.find((c) => c.name === "IREN") || sim.companions[1];

  // IREN is gone, and closes her hand on something that was never there.
  beginHallucinating(sim, iren);
  const item = sim.items[0];
  item.discovered = true;
  item.taken = false;
  iren.x = item.x; iren.z = item.z;
  sim.rng.chance = () => true; // force the phantom branch so the scene is deterministic
  companionPickup(sim, iren);
  show(`IREN picks up : "${sim.events[sim.events.length - 1].text}"`);
  must(iren.inventory.length === 1 && iren.inventory[0].real === false, "what she is carrying is not there");
  show(`she believes  : ${ITEM_INFO[iren.inventory[0].claimedKind].label}`);

  // She brings it to a lead who is entirely lucid.
  must(sim.player.hallucinating === false, "the lead is lucid");
  const res = handoffToPlayer(sim, iren);
  show(`the handover  : "${sim.events[sim.events.length - 1].text}"`);
  must(res.ok === false && res.reason === "revealed", "the handover does not happen");
  must(sim.inventory.length === 0, "nothing enters the lead's hands");
  must(sim.stats.phantomsRevealed === 1, "and the lead has learned something true about IREN");
}

// ---------------------------------------------------------------------------
clause(6, "the same crossing, but nobody present can see through it");
{
  const sim = createRun({ seed: 4007 });
  const ch = sim.companions[0];
  ch.inventory.push({ id: "c", real: false, claimedKind: "lens", kind: null });
  beginHallucinating(sim, sim.player); // both minds are gone

  const res = handoffToPlayer(sim, ch);
  show(`the handover  : "${sim.events[sim.events.length - 1].text}"`);
  must(res.ok === true && res.real === false, "two deceived minds simply agree");
  must(sim.inventory.length === 1, "and the phantom crosses over intact, to be found out later");
}

// ---------------------------------------------------------------------------
clause(7, "the player's own reading is testable — offering it to someone lucid");
{
  const sim = createRun({ seed: 4008 });
  const voss = sim.companions[0];
  voss.hallucinating = false;
  voss.x = sim.player.x; voss.z = sim.player.z;
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });
  sim.inventory.push({ id: "b", real: false, claimedKind: "tether", kind: null });
  craftItem(sim); // -> a false Ember, and the lead has no way to know

  const res = offerItem(sim, 0, voss.id);
  show(`offering it   : "${sim.events[sim.events.length - 1].text}"`);
  must(res.revealed === true, "a lucid companion says what is actually in your hand");
  must(sim.inventory.length === 0, "the thing that was never there is gone");
  must(sim.stats.phantomsRevealed === 1, "counted");
}

// ---------------------------------------------------------------------------
clause(8, "the same offer costs something — a real item would have helped");
{
  const sim = createRun({ seed: 4009 });
  const nkem = sim.companions[3];
  nkem.hallucinating = false;
  nkem.lucidity = 30;
  nkem.x = sim.player.x; nkem.z = sim.player.z;
  sim.inventory.push({ id: "a", real: true, kind: "flare", claimedKind: null });

  const before = nkem.lucidity;
  const res = offerItem(sim, 0, nkem.id);
  show(`offering it   : "${sim.events[sim.events.length - 1].text}"`);
  must(res.ok && res.reached === true, "a real Flare lands");
  must(nkem.lucidity > before, `and pulls them back (${before} → ${Math.round(nkem.lucidity)})`);
  must(nkem.lucidity <= MAX_LUCIDITY, "without exceeding the ceiling");
}

// ---------------------------------------------------------------------------
console.log("");
if (failures) {
  console.log(`\x1b[31mmirage deception scenario: ${failures} clause check(s) FAILED\x1b[0m`);
  process.exit(1);
}
console.log("\x1b[32mmirage deception scenario: OK — every clause holds end to end\x1b[0m");
