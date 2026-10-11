// sim.mjs — the rules, one at a time, on the real sim.

import { harness, assert, walk, finish, chopSpot, S } from "./lib.mjs";
import { createRng } from "../src/rng.js";
import * as C from "../src/config.js";
import { clearDeadfall } from "../src/world.js";

const T = harness("sim");
const HOUR = 60 / C.TICK_MIN;
const fresh = (seed = 11) => { const s = S.createSim({ seed, startCamp: true }); S.applyPlan(s, "dawn", {}); return s; };
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
  run(s, 10 * HOUR);
  assert(!d.cleared && d.progress > 0.5, `three choppers in one day: ${Math.round(d.progress * 100)}% — a trunk should take more than a day of three people`);
  for (let i = 0; i < 30 * HOUR; i++) { if (s.pending) S.applyPlan(s, s.pending, s.pending === "dawn" ? { m0: "chop", m1: "chop", m2: "chop" } : {}); S.tick(s, {}); }
  assert(d.cleared, `still standing after a second day: ${Math.round(d.progress * 100)}%`);
  assert(!s.world.deadfalls[1].cleared, "the next, thicker deadfall fell the same days as well");
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
  assert(s.pending === "home" && s.home.pylons === C.TEAM, `pending ${s.pending}, pylons ${s.home && s.home.pylons}`);
  S.lightHome(s, "m1");
  assert(s.home.pylons === C.TEAM - 1 && s.home.tried.length === 1 && s.home.saved.length === 0, "the fake was sent home");
  S.lightHome(s, "m0");
  assert(s.home.saved.length === 1 && s.home.pylons === C.TEAM - 2, "a real one did not go home");
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

T.check("tend: a firekeeper on watch makes each wood last longer", () => {
  const feed = (tend) => {
    const s = fresh(21);
    setClock(s, 3, 22 * 60); s.dawnDone = s.duskDone = 99;
    const m = s.mates[0]; m.skills.tend = tend;
    s.camp.pile = 1; s.camp.fire = 1;
    m.x = s.camp.x + 1; m.y = s.camp.y;
    S.applyPlan(s, "dusk", { [m.id]: "watch" });
    s.mates.slice(1).forEach((x) => { x.task.kind = "sleep"; });
    for (let i = 0; i < HOUR && s.camp.pile > 0; i++) S.tick(s, {});
    return s.camp.fire;
  };
  const plain = feed(0), keeper = feed(4);
  assert(keeper > plain + 0.5, `tend 4 fire ${keeper.toFixed(2)}h vs tend 0 ${plain.toFixed(2)}h`);
});

T.check("build: builders alongside put camp up faster", () => {
  const time = (build) => {
    const s = fresh(22);
    S.campAction(s); finish(s);                // take it down first
    s.mates.forEach((m, i) => { m.skills.build = build; m.x = s.lead.x + 0.5 + i * 0.1; m.y = s.lead.y; m.task = { kind: "camp", chunk: 0, carry: 0 }; });
    const r = S.campAction(s);
    assert(r.ok, "could not make camp");
    return s.lead.busy.total;
  };
  const plain = time(0), skilled = time(4);
  assert(skilled < plain - 5, `build 4 took ${skilled} min vs build 0 ${plain} min`);
});

T.check("track: a tracker with you spots the lost from further off", () => {
  const s = fresh(23);
  s.missing = { id: "m4", name: "X", slot: 4, skills: {}, points: 0, practice: {}, lucidity: 90, x: s.lead.x + C.FIND_REACH + 1.5, y: s.lead.y, area: 0, lastDay: 1, nights: 1, found: false };
  const base = S.findReach(s);
  s.mates[0].skills.track = 4; s.mates[0].x = s.lead.x; s.mates[0].y = s.lead.y + 0.5;
  const tracked = S.findReach(s);
  assert(base === C.FIND_REACH && tracked >= C.FIND_REACH + 2, `reach ${base} → ${tracked}`);
});

T.check("move camp: a companion takes camp down, carries it past the cut trunk, and puts it up", () => {
  const s = fresh(24);
  clearDeadfall(s.world, s.world.deadfalls[0]);
  const m = s.mates[0], oldPile = s.camp.pile, old = { x: s.camp.x, y: s.camp.y };
  S.applyPlan(s, "dawn", { [m.id]: "move", m1: "move" });
  run(s, 6 * HOUR);
  assert(s.camp.built && S.areaOf(s.camp) === 1, `camp is ${s.camp.built ? "up" : "down"} in area ${S.areaOf(s.camp) + 1}`);
  assert(s.piles.some((p) => p.wood === oldPile && Math.abs(p.x - old.x) < 1e-9), "the woodpile did not stay at the old camp");
  assert(s.chronicle[1].events.some((e) => e.kind === "camp_made" && e.who.includes(m.id)), "the chronicle does not say who made camp");
});

T.check("move camp waits when the trunk is not cut, and when the day is too short", () => {
  const s = fresh(25);
  S.applyPlan(s, "dawn", { m0: "move" });
  run(s, 2 * HOUR);
  assert(s.camp.built && S.areaOf(s.camp) === 0, "moved camp with the way north still blocked");
  const t = fresh(25);
  clearDeadfall(t.world, t.world.deadfalls[0]);
  setClock(t, 1, 16 * 60);
  S.applyPlan(t, "dawn", { m0: "move" });
  run(t, HOUR);
  assert(t.camp.built && S.areaOf(t.camp) === 0, "started moving camp two hours before dark");
});

T.check("a fire dying in the night wakes the lead sleeping by it", () => {
  const s = fresh(26);
  setClock(s, 3, 22 * 60); s.dawnDone = s.duskDone = 99;
  s.lead.x = s.camp.x; s.lead.y = s.camp.y + 1;
  s.camp.fire = 0.5; s.camp.pile = 0;
  S.rest(s);
  assert(s.lead.asleep, "did not fall asleep");
  run(s, HOUR);
  assert(!s.lead.asleep && !s.lead.busy && s.msgs.at(-1).text.includes("fire is out"), `still asleep: ${s.lead.asleep}, last: ${s.msgs.at(-1).text}`);
  const t = fresh(26);
  setClock(t, 3, 22 * 60); t.dawnDone = t.duskDone = 99;
  t.lead.x = t.camp.x; t.lead.y = t.camp.y + 1; t.camp.fire = 10;
  S.rest(t); run(t, HOUR);
  assert(t.lead.asleep, "woke with the fire still burning");
});

T.check("a run starts with no camp; making one is a choice", () => {
  const s = S.createSim({ seed: 27 });
  assert(!s.camp.built, "the run began with camp already up");
  for (let i = 0; i < 50; i++) S.tick(s, {});
  assert(s.pending !== "dawn", "a dawn plan opened with no camp");
  S.campAction(s); finish(s);
  assert(s.camp.built && s.camp.pile === 0, "Q did not make camp here");
});

T.check("wood stacks on the pile to 12, then the surplus stack to 30; the fire takes the pile first", () => {
  const s = fresh(28);
  s.camp.pile = 0; s.camp.surplus = 0;
  s.lead.carry = 50; s.lead.x = s.camp.x; s.lead.y = s.camp.y + 1;
  run(s, 1);
  assert(s.camp.pile === C.PILE_CAP && s.camp.surplus === C.SURPLUS_CAP && s.lead.carry === 50 - C.PILE_CAP - C.SURPLUS_CAP, `pile ${s.camp.pile} surplus ${s.camp.surplus} carry ${s.lead.carry}`);
  s.camp.pile = 1; s.lead.carry = 0;
  S.fireAction(s); finish(s);
  assert(s.camp.pile === 0 && s.camp.surplus === C.SURPLUS_CAP - 1 && s.camp.fire > 0, `lit from pile ${s.camp.pile} / surplus ${s.camp.surplus}`);
  S.campAction(s); finish(s);
  assert(s.piles.length === 1 && s.piles[0].surplus && s.piles[0].wood === C.SURPLUS_CAP - 1, `old piles ${JSON.stringify(s.piles)}`);
});

void chopSpot;
T.done();
