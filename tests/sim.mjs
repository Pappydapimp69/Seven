// sim.mjs — the rules, one at a time, on the real sim.

import { harness, assert, walk, finish, chopSpot, S } from "./lib.mjs";
import { createRng } from "../src/rng.js";
import * as C from "../src/config.js";
import { clearDeadfall } from "../src/world.js";

const T = harness("sim");
const HOUR = 60 / C.TICK_MIN;
const fresh = (seed = 11) => { const s = S.createSim({ seed }); S.applyPlan(s, "dawn", {}); return s; };
const run = (s, ticks, inp = {}) => { for (let i = 0; i < ticks; i++) { if (s.pending) S.applyPlan(s, s.pending, {}); S.tick(s, inp); } };
const setClock = (s, day, hhmm) => { s.ticks = Math.round(((day - 1) * 1440 + (hhmm - 6 * 60)) / C.TICK_MIN); s.day = day; s.duskSeen = day - 1; };

T.check("the clock: 06:00 on day one, dusk at 18:00, a game hour is 300 ticks", () => {
  const s = fresh();
  assert(S.clockText(s) === "06:00" && !S.isNight(s), S.clockText(s));
  run(s, 12 * HOUR);
  assert(S.clockText(s) === "18:00" && S.isNight(s), `at 12h: ${S.clockText(s)}`);
});

T.check("dawn draws exactly NIGHT_DRAWS from the stream, taken or not", () => {
  const seen = { taken: 0, not: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const s = fresh(seed);
    s.day = 3; s.nightHours = 12;
    for (const m of s.mates) s.exposure[m.id] = 12 * (seed % 2 ? 6 : 0.01);
    const probe = createRng(0); probe.state = s.rng.state;
    for (let i = 0; i < C.NIGHT_DRAWS; i++) probe.next();
    S.resolveNight(s);
    seen[s.missing ? "taken" : "not"]++;
    assert(s.rng.state === probe.state, `seed ${seed}: dawn drew a different number of values (missing: ${!!s.missing})`);
  }
  assert(seen.taken > 0 && seen.not > 0, `only one branch exercised: ${JSON.stringify(seen)}`);
});

T.check("the first night takes nobody", () => {
  for (let seed = 1; seed < 30; seed++) {
    const s = fresh(seed);
    for (const m of s.mates) s.exposure[m.id] = 99;
    s.nightHours = 1;
    S.resolveNight(s);
    assert(!s.missing, `seed ${seed}: someone was taken on night one`);
  }
});

T.check("the night takes the exposed: awake and out of camp, not asleep by the fire", () => {
  let awake = 0, asleep = 0;
  for (let seed = 1; seed < 200; seed++) {
    const s = fresh(seed);
    s.day = 3;
    s.nightHours = 12;
    s.mates.forEach((m, i) => { s.exposure[m.id] = 12 * (i === 0 ? C.EXPOSURE.awake * C.EXPOSURE.away : 1); });
    S.resolveNight(s);
    if (s.missing) { if (s.missing.id === "m0") awake++; else asleep++; }
  }
  assert(awake > asleep / 5 * 2, `exposed one taken ${awake}x vs five sleepers ${asleep}x`);
});

T.check("someone taken is replaced: same name, same skills, nobody told", () => {
  let s = null;
  for (let seed = 1; seed < 300 && !(s && s.missing); seed++) {
    s = fresh(seed); s.day = 3; s.nightHours = 12;
    for (const m of s.mates) s.exposure[m.id] = 12 * 6;
    S.resolveNight(s);
  }
  assert(s.missing, "no seed took anyone");
  const fake = s.mates.find((m) => m.id === s.missing.id);
  assert(fake && fake.fake && fake.name === s.missing.name, "the slot is not held by a same-named fake");
  assert(JSON.stringify(fake.skills) === JSON.stringify(s.missing.skills), "the fake's skills differ");
  assert(s.mates.length === C.TEAM, "the roster count changed");
  const said = s.msgs.map((m) => m.text).join(" ");
  assert(!said.includes(s.missing.name), `a dawn message names them: ${said}`);
});

T.check("the woodpile counts once carried in, and stays where camp comes down", () => {
  const s = fresh();
  s.lead.carry = 5; s.lead.x = s.camp.x; s.lead.y = s.camp.y + 1;
  const before = s.camp.pile;
  run(s, 1);
  assert(s.camp.pile === before + 5 && s.lead.carry === 0, "carried wood did not go on the pile");
  const pile = s.camp.pile, at = { x: s.camp.x, y: s.camp.y };
  S.campAction(s); finish(s);
  assert(!s.camp.built && s.lead.carry === 0, "taking camp down carried the pile off");
  assert(s.piles.length === 1 && s.piles[0].wood === pile && Math.abs(s.piles[0].x - at.x) < 1e-9, `pile not left behind: ${JSON.stringify(s.piles)}`);
  s.lead.x += 30;
  run(s, 1);
  assert(s.piles.length === 1, "picked up a pile from thirty cells away");
  s.lead.x = s.piles[0].x; s.lead.y = s.piles[0].y - 2;
  run(s, 20, { mx: 0, my: 1 });
  assert(s.piles.length === 0 && s.lead.carry === pile, "walking onto the old pile did not take it");
});

T.check("a gatherer hauls an old pile in before felling anything", () => {
  const s = fresh();
  s.piles.push({ id: "pile9", x: s.camp.x, y: s.camp.y - 6, wood: 4 });
  for (const t of s.world.trees) t.felled = true;
  s.world.grid.fill(s.world.grid[0], 0, 0);
  const g = s.mates[0];
  S.applyPlan(s, "dawn", { [g.id]: "gather" });
  const pile0 = s.camp.pile;
  run(s, HOUR);
  assert(s.camp.pile === pile0 + 4 && s.piles.length === 0, `pile ${s.camp.pile} (was ${pile0}), old piles ${JSON.stringify(s.piles)}, carrying ${g.task.carry}`);
});

T.check("choppers on the deadfall cut it; nobody chops past a cleared trunk", () => {
  const s = fresh();
  const d = s.world.deadfalls[0];
  S.applyPlan(s, "dawn", { m0: "chop", m1: "chop", m2: "chop" });
  run(s, 8 * HOUR);
  assert(d.cleared, `three choppers left the first deadfall at ${Math.round(d.progress * 100)}% by 14:00`);
  assert(s.world.deadfalls[1].progress < 0.5, "the next deadfall was half cut the same day by three people");
});

T.check("the fire: lit from the pile, fed, burns down, shields only the camp at night", () => {
  const s = fresh();
  s.lead.x = s.camp.x; s.lead.y = s.camp.y + 1;
  s.camp.pile = 10;
  assert(S.fireAction(s).ok, "could not light"); finish(s);
  assert(Math.abs(s.camp.fire - C.FIRE_LIGHT_HOURS) < 0.05 && s.camp.pile === 8, `fire ${s.camp.fire}, pile ${s.camp.pile}`);
  S.fireAction(s); finish(s);
  assert(Math.abs(s.camp.fire - (C.FIRE_LIGHT_HOURS + C.FIRE_FEED_HOURS)) < 0.3, `fed fire at ${s.camp.fire}`);
  assert(S.warm(s, s.lead) && !S.warm(s, { x: s.camp.x + C.CAMP_RADIUS + 1, y: s.camp.y }), "the shield is not the campsite");
  run(s, 5 * HOUR);
  assert(s.camp.fire === 0, "the fire did not burn out");
});

T.check("the hidden meter: the night outside a camp costs more than inside a lit one", () => {
  const a = fresh(), b = fresh();
  for (const s of [a, b]) { setClock(s, 3, 20 * 60); s.lead.lucidity = 80; s.camp.fire = 10; s.dawnDone = s.duskDone = 99; }
  b.lead.x = b.camp.x; b.lead.y = b.camp.y - 6;
  a.lead.x = a.camp.x; a.lead.y = a.camp.y + 1;
  run(a, HOUR); run(b, HOUR);
  assert(b.lead.lucidity < a.lead.lucidity - 1, `outside ${b.lead.lucidity.toFixed(2)} vs inside ${a.lead.lucidity.toFixed(2)}`);
});

T.check("a pylon takes two: alone it will not light; with a fake it dies and so does the fake; with a real one it burns 36h", () => {
  const s = fresh();
  for (const d of s.world.deadfalls) clearDeadfall(s.world, d);
  const p = s.world.pylons[0];
  s.mates.forEach((m) => { m.x = s.camp.x; m.y = s.camp.y; });
  s.lead.x = p.x + 0.8; s.lead.y = p.y;
  assert(S.contextAction(s).kind === "none", "a pylon offered to light with nobody beside you");
  const fake = s.mates[0]; fake.fake = true; fake.since = 2; fake.x = p.x - 0.8; fake.y = p.y; s.mates[0].task = { kind: "camp", chunk: 0, carry: 0 };
  s.ticks = 1;
  const a = S.act(s);
  assert(a.kind === "light" && a.partner === fake, `act was ${a && a.kind}`);
  finish(s);
  assert(p.state === "spent" && !s.mates.includes(fake), `pylon ${p.state}, fake still here: ${s.mates.includes(fake)}`);
  const q = s.world.pylons[1], real = s.mates[0];
  s.lead.x = q.x + 0.8; s.lead.y = q.y; real.x = q.x - 0.8; real.y = q.y;
  S.act(s); finish(s);
  assert(q.state === "lit" && S.pylonLit(s, q.area), `real partner: ${q.state}`);
  s.ticks += Math.ceil(C.PYLON_BURN / C.TICK_MIN);
  run(s, 1);
  assert(q.state === "spent", "the pylon did not burn out after 36 hours");
});

T.check("walking camp forward abandons someone lost behind — no prompt, no message", () => {
  const s = fresh();
  for (const d of s.world.deadfalls) clearDeadfall(s.world, d);
  s.missing = { id: "m2", name: s.mates[2].name, slot: 2, skills: {}, points: 0, practice: {}, lucidity: 90, x: 5, y: 140, area: 0, lastDay: 2, nights: 1, found: false };
  s.mates[2].fake = true; s.mates[2].since = 3;
  const n = s.msgs.length;
  S.campAction(s); finish(s);
  const sp = { x: s.world.trailX[100] + 0.5, y: 100.5 };
  walk(s, sp.x, sp.y);
  S.campAction(s); finish(s);
  assert(s.camp.built && s.missing === null && s.lost.length === 1, `missing ${JSON.stringify(s.missing)}, lost ${JSON.stringify(s.lost)}`);
  assert(!s.msgs.slice(n).some((m) => m.text.includes(s.lost[0].name)), "a message named the abandoned one");
});

T.check("the far side: pylons are real people + 1, each try spends one, a fake cannot light one", () => {
  const s = fresh();
  s.mates[1].fake = true; s.mates[1].since = 2;
  s.mates.forEach((m) => { m.x = 20; m.y = 3.5; });
  s.lead.x = 21; s.lead.y = 3.5;
  for (const d of s.world.deadfalls) clearDeadfall(s.world, d);
  run(s, 1);
  assert(s.pending === "home" && s.home.pylons === 6, `pending ${s.pending}, pylons ${s.home && s.home.pylons}`);
  S.lightHome(s, "m1");
  assert(s.home.pylons === 5 && s.home.tried.length === 1 && s.home.saved.length === 0, "the fake was sent home");
  S.lightHome(s, "m0");
  assert(s.home.saved.length === 1 && s.home.pylons === 4, "a real one did not go home");
  S.finishRun(s);
  assert(s.status === "ended" && s.ending.kind === "home", `ending ${s.ending && s.ending.kind}`);
});

T.check("a call sounds the same whether anyone answers", () => {
  const s = fresh();
  s.mates.forEach((m) => { m.x = 1e3; });
  S.callOut(s);
  const a = s.msgs[s.msgs.length - 1].text;
  const t = fresh(); S.callOut(t);
  assert(a === t.msgs[t.msgs.length - 1].text, "the call reads differently when nobody hears");
});

void chopSpot;
T.done();
