// sim.js — the truth of a run. Pure: no DOM, no clock, no Math.random.
//
// The sim only advances through tick(). It never opens a panel itself; it sets
// `sim.pending` and stops ticking until the UI answers through one of the
// exported actions. Messages for the player go through sim.say(); they never
// mention the hidden meter.

import { createRng } from "./rng.js?v=seven-1.12.0";
import { composeRoster } from "./names.js?v=seven-1.12.0";
import { createWorld, areaOfRow, K, kindAt, walkable, lostSpots, fellTree } from "./world.js?v=seven-1.12.0";
import { dist, cellOf, moveBody, nearestWalkable, walkTo } from "./body.js?v=seven-1.12.0";
import { openDay, record, recordPlan, account } from "./chronicle.js?v=seven-1.12.0";
import { makeCampAt, takeCampDown as campDown, campWood, stackWood, takeWood } from "./camp.js?v=seven-1.12.0";
import { updateMate, setTask, chopAt, frontDeadfall, practice, moving, DAY_TASKS, NIGHT_TASKS } from "./mates.js?v=seven-1.12.0";
import * as C from "./config.js?v=seven-1.12.0";

// ---- the clock ---------------------------------------------------------------
export const minutes = (sim) => sim.ticks * C.TICK_MIN;
export const minuteOfDay = (sim) => (minutes(sim) + C.DAWN) % 1440;
export const isNight = (sim) => { const m = minuteOfDay(sim); return m < C.DAWN || m >= C.DUSK; };
export function clockText(sim) {
  const m = Math.floor(minuteOfDay(sim));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** Minutes of daylight left today (0 at night). */
export const lightLeft = (sim) => (isNight(sim) ? 0 : C.DUSK - minuteOfDay(sim));

// ---- creating a run ------------------------------------------------------------
/**
 * opts.seed — the one seed. opts.team — optional [{name, skills}] from recruiting;
 * otherwise names are composed from the seed with no points spent.
 */
export function createSim(opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const rng = createRng(seed);
  const world = createWorld(seed);
  const names = opts.team ? opts.team.map((t) => t.name) : composeRoster(rng, C.TEAM);
  const sim = {
    v: 1, seed, rng, world, ticks: 0, day: 1, status: "playing", ending: null,
    lead: { x: world.start.x, y: world.start.y + 1, facing: -Math.PI / 2, yaw: -Math.PI / 2, lucidity: 100, carry: 0, busy: null, asleep: false },
    mates: [], roster: [],
    // No camp to begin with: making one is the first thing you choose to do.
    camp: { x: world.start.x, y: world.start.y, built: !!opts.startCamp, pile: opts.startCamp ? 4 : 0, surplus: 0, fire: 0 },
    piles: [], pileSeq: 0,
    missing: null, lost: [],
    chronicle: {},
    dawnDone: 0, duskDone: 0, duskSeen: 0,
    exposure: {}, nightHours: 0,
    pending: null, twin: null, home: null, exitLeft: true,
    msgs: [], saveDue: false,
  };
  for (let i = 0; i < C.TEAM; i++) {
    const a = (i / C.TEAM) * Math.PI * 2;
    const spot = nearestWalkable(world, sim.camp.x + Math.cos(a) * 2, sim.camp.y + Math.sin(a) * 2);
    const skills = { ...C.NO_SKILLS, ...(opts.team && opts.team[i] ? opts.team[i].skills : {}) };
    const id = `m${i}`;
    const role = opts.team && opts.team[i] ? opts.team[i].role || null : null;
    sim.roster.push({ id, name: names[i] });
    sim.mates.push({
      id, name: names[i], role, slot: i, x: spot.cx + 0.5, y: spot.cy + 0.5, facing: 0, lucidity: 100,
      skills, points: C.SKILLS.reduce((a, k) => a + (skills[k] || 0), 0), practice: {},
      task: { kind: "free", chunk: 0, carry: 0 }, following: false, callPending: false, asleep: false,
      fake: false, since: null, away: [], path: null, goal: null, repath: 0,
    });
  }
  attach(sim);
  openDay(sim, 1, C.WEATHER[rng.int(0, C.WEATHER.length - 1)]);
  sim.say("Seven of you set out to walk the trail through the woods, and come out the other side.");
  return sim;
}

/** Non-serialised helpers hung on a sim (also after a load). */
export function attach(sim) {
  // Sounds the sim announces for the player's ears: transient, never saved, no rng.
  sim.sounds = [];
  sim.sfx = (name, data = {}) => { sim.sounds.push({ name, ...data }); if (sim.sounds.length > 64) sim.sounds.shift(); };
  sim.say = (text) => { sim.msgs.push({ text, at: sim.ticks }); if (sim.msgs.length > 30) sim.msgs.shift(); };
}

// ---- queries -------------------------------------------------------------------
export const areaOf = (p) => areaOfRow(Math.floor(p.y));
export const pylonLit = (sim, a) => sim.world.pylons.some((p) => p.area === a && p.state === "lit");
export const atCamp = (sim, p) => sim.camp.built && dist(p, sim.camp) <= C.CAMP_RADIUS;
export const warm = (sim, p) => atCamp(sim, p) && sim.camp.fire > 0;
export const found = (sim) => (sim.missing && sim.missing.found ? sim.missing : null);
export const realCount = (sim) => sim.mates.filter((m) => !m.fake).length + (found(sim) ? 1 : 0);
export const busy = (sim) => !!sim.lead.busy;

function nearPeople(sim, p, r) {
  const out = sim.mates.filter((m) => !m.hidden && dist(m, p) <= r);
  const f = found(sim);
  if (f && dist(f, p) <= r) out.push(f);
  return out.sort((a, b) => dist(a, p) - dist(b, p));
}

/** In first person, E acts on what you face: within FACE_ARC of the view, or right at your feet. */
const FACE_ARC = (75 * Math.PI) / 180;
export function facing(sim, p) {
  const L = sim.lead;
  if (L.yaw == null) return true;
  const d = Math.hypot(p.x - L.x, p.y - L.y);
  if (d < 0.8) return true;
  let a = Math.atan2(p.y - L.y, p.x - L.x) - L.yaw;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= FACE_ARC;
}

function nearDeadfall(sim) {
  const L = sim.lead;
  for (const d of sim.world.deadfalls) {
    if (d.cleared) continue;
    const px = Math.max(d.x0, Math.min(d.x1 + 1, L.x)), py = d.row + 0.5;
    if (Math.hypot(L.x - px, L.y - py) <= C.REACH && facing(sim, { x: px, y: py })) return d;
  }
  return null;
}
function nearTree(sim) {
  const L = sim.lead, c = cellOf(L);
  let best = null, bd = 9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (kindAt(sim.world, c.cx + dx, c.cy + dy) !== K.TREE) continue;
    const d = Math.hypot(c.cx + dx + 0.5 - L.x, c.cy + dy + 0.5 - L.y);
    if (d < bd && d <= C.REACH && facing(sim, { x: c.cx + dx + 0.5, y: c.cy + dy + 0.5 })) { bd = d; best = sim.world.trees.find((t) => t.cx === c.cx + dx && t.cy === c.cy + dy); }
  }
  return best;
}
const nearPylon = (sim) => sim.world.pylons.find((p) => dist(p, sim.lead) <= C.REACH && facing(sim, p)) || null;

/** What E does here, right now. {kind, label, ...} or null. */
export function contextAction(sim) {
  if (sim.status !== "playing" || busy(sim)) return null;
  const d = nearDeadfall(sim);
  if (d) return { kind: "chop", label: "Chop the deadfall", d };
  const p = nearPylon(sim);
  if (p) {
    if (p.state !== "dark") return { kind: "none", label: p.state === "lit" ? "The pylon is burning" : "The pylon is dead" };
    const partner = nearPeople(sim, sim.lead, C.PYLON_PAIR_REACH)[0];
    if (!partner) return { kind: "none", label: "A pylon takes two pairs of hands" };
    return { kind: "light", label: `Light the pylon with ${partner.name}`, p, partner };
  }
  const m = nearPeople(sim, sim.lead, C.REACH).filter((x) => facing(sim, x))[0];
  if (m && !m.asleep) return { kind: "ask", label: `Talk to ${m.name}`, m };
  const t = nearTree(sim);
  if (t) return { kind: "fell", label: "Fell the tree", t };
  return null;
}

// ---- the lead's actions -----------------------------------------------------------
function startBusy(sim, kind, mins, data = {}) {
  sim.lead.busy = { kind, left: mins, total: mins, ...data };
}

/** E. Returns what happened, for the UI ("ask" opens the ask panel). */
export function act(sim) {
  const a = contextAction(sim);
  if (!a || a.kind === "none") return a;
  if (a.kind === "chop") startBusy(sim, "chop", C.CHOP_MIN, { d: a.d.id });
  else if (a.kind === "fell") startBusy(sim, "fell", C.FELL_MIN, { tree: a.t.id });
  else if (a.kind === "light") startBusy(sim, "light", C.LIGHT_MIN, { p: a.p.id, partner: a.partner.id, isFound: a.partner === found(sim) });
  return a;
}

/** Days someone can be asked about: the last three finished days. */
export function askableDays(sim) {
  const out = [];
  for (let d = sim.day - 1; d >= 1 && out.length < 3; d--) out.push(d);
  return out;
}
/** Ask someone about a day. Costs half an hour. Returns their account. */
export function askAbout(sim, id, day) {
  const f = found(sim);
  const who = f && f.id === id && !sim.mates.some((m) => m.id === id) ? f : sim.mates.find((m) => m.id === id) || f;
  if (!who) return [];
  startBusy(sim, "ask", C.ASK_MIN);
  return account(sim, who, day);
}

/** F at camp: light the fire, or feed it. */
export function fireAction(sim) {
  const c = sim.camp;
  if (busy(sim) || !atCamp(sim, sim.lead)) return { ok: false, why: c.built ? "Not at the fire." : "There is no camp." };
  if (c.fire <= 0) {
    if (campWood(c) < C.FIRE_LIGHT_WOOD) return { ok: false, why: "Not enough wood stacked to light a fire." };
    startBusy(sim, "fire_light", C.FIRE_MIN);
    return { ok: true };
  }
  if (campWood(c) < 1) return { ok: false, why: "There is no wood stacked." };
  if (c.fire > C.FIRE_MAX_HOURS - 1) return { ok: false, why: "The fire is as high as it goes." };
  startBusy(sim, "fire_feed", C.FIRE_MIN);
  return { ok: true };
}

function helpers(sim) {
  return sim.mates.filter((m) => !m.hidden && dist(m, sim.lead) <= 4 && !m.asleep && !(m.task && m.task.chunk > 0));
}
/** Camp work speed: more hands, and builders' hands count for more. */
export function campSpeed(sim) {
  const hs = helpers(sim).slice(0, 2);
  return 1 + hs.reduce((s, m) => s + 0.5 * (1 + C.BUILD_SKILL * (m.skills.build || 0)), 0);
}

/** Make camp here, or take it down. */
export function campAction(sim) {
  if (busy(sim)) return { ok: false };
  const L = sim.lead, speed = campSpeed(sim), crew = helpers(sim).slice(0, 2).map((m) => m.id);
  if (sim.camp.built) {
    if (!atCamp(sim, L)) return { ok: false, why: "Walk back to camp to take it down." };
    startBusy(sim, "camp_down", Math.round(C.DISMANTLE_MIN / speed), { crew });
    return { ok: true };
  }
  const k = kindAt(sim.world, Math.floor(L.x), Math.floor(L.y));
  if (k !== K.TRAIL && k !== K.CLEAR) return { ok: false, why: "No room for a camp here." };
  // Camp goes up a step in front of you, where you can watch it rise.
  const yaw = L.yaw ?? -Math.PI / 2, ax = L.x + Math.cos(yaw) * 1.6, ay = L.y + Math.sin(yaw) * 1.6;
  const ka = kindAt(sim.world, Math.floor(ax), Math.floor(ay));
  const at = ka === K.TRAIL || ka === K.CLEAR ? { x: ax, y: ay } : { x: L.x, y: L.y };
  startBusy(sim, "camp_make", Math.round(C.MAKE_CAMP_MIN / speed), { crew, at });
  return { ok: true };
}

/** R: sleep through to dawn after dark, or rest an hour by day. */
export function rest(sim) {
  if (busy(sim)) return { ok: false };
  if (isNight(sim) || minuteOfDay(sim) >= C.DUSK - 60) {
    startBusy(sim, "sleep", Infinity);
    sim.lead.asleep = true;
    return { ok: true, sleep: true };
  }
  startBusy(sim, "rest", C.REST_MIN);
  return { ok: true, sleep: false };
}

/**
 * C: whistle. It sounds the same whether or not anyone hears. Whoever does
 * comes back to you EVENTUALLY: the further off, the longer before they start,
 * and they finish the chunk in their hands first.
 */
export function callOut(sim) {
  sim.say("You whistle.");
  sim.sfx("whistle");
  for (const m of sim.mates) {
    if (m.asleep || m.hidden || dist(m, sim.lead) > C.CALL_RANGE) continue;
    if (!m.fake && m.lucidity < C.CALL_MIN_LUCIDITY) continue;
    m.heard = { wait: Math.round(dist(m, sim.lead) * C.WHISTLE_DELAY) };
  }
}
export const whistle = callOut;

function finishBusy(sim) {
  const b = sim.lead.busy, L = sim.lead, w = sim.world;
  sim.lead.busy = null;
  switch (b.kind) {
    case "chop": {
      const d = w.deadfalls.find((x) => x.id === b.d);
      if (d && !d.cleared) chopAt(sim, d, "lead", 1);
      break;
    }
    case "fell": {
      const t = w.trees.find((x) => x.id === b.tree);
      const n = sim.rng.int(C.FELL_YIELD[0], C.FELL_YIELD[1]);
      if (t && !t.felled) {
        fellTree(w, t);
        L.carry += n;
        record(sim, "fell", ["lead"]);
        sim.say(`The tree comes down. You carry ${n} wood.`);
        sim.sfx("treefall", { x: t.cx + 0.5, y: t.cy + 0.5 });
      }
      break;
    }
    case "fire_light":
      if (campWood(sim.camp) >= C.FIRE_LIGHT_WOOD) {
        takeWood(sim.camp, C.FIRE_LIGHT_WOOD); sim.camp.fire = C.FIRE_LIGHT_HOURS;
        record(sim, "fire", ["lead"]);
        sim.say("The fire catches.");
        sim.sfx("fire");
      }
      break;
    case "fire_feed":
      if (takeWood(sim.camp, 1)) { sim.camp.fire = Math.min(C.FIRE_MAX_HOURS, sim.camp.fire + C.FIRE_FEED_HOURS); }
      break;
    case "camp_make": if (!sim.camp.built) { makeCampHere(sim, b.at); practiseCrew(sim, b.crew); sim.sfx("camp"); } break;
    case "camp_down": if (sim.camp.built) { campDown(sim, ["lead"]); practiseCrew(sim, b.crew); } break;
    case "light": lightPylon(sim, b); break;
    default: break;
  }
}

function practiseCrew(sim, crew = []) {
  for (const id of crew) { const m = sim.mates.find((x) => x.id === id); if (m) practice(m, "build"); }
}
/** How close the lead must come to someone lost: further with a tracker alongside. */
export function findReach(sim) {
  const best = Math.max(0, ...sim.mates.filter((m) => dist(m, sim.lead) <= 4 && !m.asleep).map((m) => m.skills.track || 0));
  return C.FIND_REACH + C.TRACK_REACH * best;
}

function makeCampHere(sim, at) {
  const L = sim.lead, p = at || { x: L.x, y: L.y };
  makeCampAt(sim, p.x, p.y, ["lead", ...sim.mates.filter((m) => dist(m, L) <= 4).map((m) => m.id)]);
}

function lightPylon(sim, b) {
  const p = sim.world.pylons.find((x) => x.id === b.p);
  const f = found(sim);
  const partner = b.isFound ? f : sim.mates.find((m) => m.id === b.partner);
  if (!p || p.state !== "dark" || !partner) return;
  if (partner.fake) {
    // A hallucination does not survive it. The pylon is spent either way.
    p.state = "spent";
    sim.mates = sim.mates.filter((m) => m !== partner);
    sim.say(`The light goes through ${partner.name}, and there is nobody there.`);
    sim.sfx("pylon_dead");
    return;
  }
  p.state = "lit"; p.litAt = minutes(sim);
  record(sim, "pylon", ["lead", partner.id]);
  sim.say("The pylon burns blue.");
  sim.sfx("pylon");
}

// ---- plans --------------------------------------------------------------------
export function applyPlan(sim, kind, choices) {
  const allowed = kind === "dawn" ? DAY_TASKS : NIGHT_TASKS;
  for (const m of sim.mates) {
    const k = allowed.includes(choices[m.id]) ? choices[m.id] : kind === "dawn" ? "free" : "sleep";
    const prior = m.task ? (m.task.kind === "work" ? m.task.work : m.task.kind) : null;
    setTask(m, k, k === "work" ? (DAY_TASKS.includes(prior) ? prior : "free") : null);
  }
  if (kind === "dawn") { sim.dawnDone = sim.day; recordPlan(sim, choices); }
  else sim.duskDone = sim.day;
  if (sim.pending === kind) sim.pending = null;
}

// ---- the twin: two at the fire with one name ------------------------------------
export function twinAccounts(sim) {
  const ms = sim.missing, fake = sim.mates.find((m) => m.id === ms.id);
  const day = ms.lastDay;
  const realLines = account(sim, { ...ms, fake: false, away: [] }, day);
  const fakeLines = account(sim, fake, day);
  const realLeft = ((sim.seed + day * 7 + ms.id.charCodeAt(1)) % 2) === 0;
  return { name: ms.name, day, realLeft, left: realLeft ? realLines : fakeLines, right: realLeft ? fakeLines : realLines };
}
/** Keep one. The other walks into the trees. The message is the same either way. */
export function keepTwin(sim, keepLeft) {
  const ms = sim.missing, slot = sim.mates.findIndex((m) => m.id === ms.id);
  const { realLeft } = twinAccounts(sim);
  if (keepLeft === realLeft) restoreReal(sim, slot);
  else { sim.lost.push({ name: ms.name, how: "turned away" }); sim.missing = null; }
  sim.twin = null;
  if (sim.pending === "twin") sim.pending = null;
  sim.say("One of them walks off into the trees.");
  sim.sfx("found");
}

function restoreReal(sim, slot) {
  const ms = sim.missing;
  const away = [];
  for (let d = ms.lastDay + 1; d <= sim.day; d++) away.push(d);
  const m = {
    id: ms.id, name: ms.name, role: ms.role || null, slot: ms.slot, x: ms.x, y: ms.y, facing: 0, lucidity: ms.lucidity,
    skills: { ...ms.skills }, points: ms.points, practice: { ...ms.practice },
    task: { kind: "free", chunk: 0, carry: 0 }, following: true, callPending: false, asleep: false,
    fake: false, since: null, away, path: null, goal: null, repath: 0,
  };
  if (slot >= 0) sim.mates[slot] = m; else sim.mates.splice(Math.min(ms.slot, sim.mates.length), 0, m);
  sim.missing = null;
}

// ---- the night ------------------------------------------------------------------
function exposureTick(sim) {
  const h = C.TICK_MIN / 60;
  sim.nightHours += h;
  for (const m of sim.mates) {
    let w = C.EXPOSURE.base;
    if (!m.asleep) w *= C.EXPOSURE.awake;
    if (!atCamp(sim, m)) w *= C.EXPOSURE.away;
    else if (sim.camp.fire <= 0) w *= C.EXPOSURE.cold;
    sim.exposure[m.id] = (sim.exposure[m.id] || 0) + w * h;
  }
}

function bearing(from, to) {
  const ang = Math.atan2(to.x - from.x, -(to.y - from.y));      // 0 = north, clockwise
  const i = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return C.DIRS8[i];
}

/** Dawn. Draws EXACTLY NIGHT_DRAWS values whatever happens (constant roll count). */
export function resolveNight(sim) {
  const r = [];
  for (let i = 0; i < C.NIGHT_DRAWS; i++) r.push(sim.rng.next());
  const night = sim.day;
  const here = sim.camp.built ? sim.camp : sim.lead;
  const lines = ["Night passes."];

  if (sim.missing && !sim.missing.found) sim.missing.nights++;

  const eligible = sim.mates.filter((m) => !m.fake);
  const held = sim.mates.filter((m) => m.fake).length;
  const hours = Math.max(1e-6, sim.nightHours);
  const mean = eligible.length ? eligible.reduce((s, m) => s + (sim.exposure[m.id] || 0) / hours, 0) / eligible.length : 0;
  const depth = Math.sqrt(C.DEPTH[areaOf(here)]);
  const chance = night <= 1 ? 0 : Math.min(0.85, C.TAKE_BASE * mean * depth * (1 + C.HELD_FAKE_BONUS * held));
  if (!sim.missing && eligible.length && r[0] < chance) {
    const weights = eligible.map((m) => Math.max(1e-6, ((sim.exposure[m.id] || 0) / hours) * (1 + (100 - m.lucidity) / 100)));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = r[1] * total, k = 0;
    while (k < weights.length - 1 && pick >= weights[k]) { pick -= weights[k]; k++; }
    const m = eligible[k];
    const area = Math.min(C.AREAS - 1, areaOf(here) + (r[2] < 0.5 ? 0 : 1));
    const spots = lostSpots(sim.world, area);
    const s = spots.length ? spots[Math.floor(r[3] * spots.length)] : nearestWalkable(sim.world, here.x, here.y - 6);
    sim.missing = {
      id: m.id, name: m.name, role: m.role || null, slot: m.slot, skills: { ...m.skills }, points: m.points, practice: { ...m.practice },
      lucidity: m.lucidity, x: s.cx + 0.5, y: s.cy + 0.5, area, lastDay: night, nights: 1, found: false,
    };
    // Something takes the empty slot: same name, same skills. Nobody finds it strange.
    m.fake = true; m.since = night + 1; m.practice = {};
  }

  sim.day = night + 1;
  openDay(sim, sim.day, C.WEATHER[Math.floor(r[4] * C.WEATHER.length)]);
  const emptyCamp = keystone(sim, here, night);
  if (emptyCamp) lines[0] = "You wake. The camp is empty.";

  // The call at first light: a direction, never a name. False calls too, so a
  // call alone never says that someone is missing; a bearing that holds does.
  const ms = sim.missing;
  if (ms && !ms.found) {
    const p = Math.max(C.CALL_FLOOR, 1 - C.CALL_FADE * (ms.nights - 1));
    if (r[5] < p) { const dir = bearing(here, ms); record(sim, "call", [], { dir }); lines.push(`At first light, a voice calls from the ${dir}.`); sim.sfx("voice", { dir }); }
  } else if (r[5] < C.FALSE_CALL) {
    const dir = C.DIRS8[Math.floor(r[1] * 8)];
    record(sim, "call", [], { dir });
    lines.push(`At first light, a voice calls from the ${dir}.`);
    sim.sfx("voice", { dir });
  }
  sim.sfx("dawn");

  sim.exposure = {}; sim.nightHours = 0;
  if (sim.lead.busy && sim.lead.busy.kind === "sleep") sim.lead.busy = null;
  sim.lead.asleep = false;
  for (const m of sim.mates) { m.asleep = false; m.following = false; m.callPending = false; if (m.task && !moving(m)) { m.task.kind = "free"; m.task.chunk = 0; m.task.stage = null; } }
  for (const l of lines) sim.say(l);
  sim.saveDue = true;
}

/**
 * The keystone morning. Everyone has gone into the trees; each comes back as
 * the lead walks near where they stand, in no particular order. If nobody is
 * out there already, one who comes back is not who they were — the real one
 * is lost like any other night. Draws KEYSTONE_DRAWS values on that dawn,
 * always. Returns true if it happened.
 */
function keystone(sim, here, night) {
  if (sim.day !== C.KEYSTONE_DAY || sim.keystone) return false;
  const k = [];
  for (let i = 0; i < C.KEYSTONE_DRAWS; i++) k.push(sim.rng.next());
  const area = areaOf(here);
  let spots = lostSpots(sim.world, area);
  if (spots.length < sim.mates.length) {
    spots = spots.concat(lostSpots(sim.world, Math.max(0, area - 1)));
  }
  if (!spots.length) return false;
  if (!sim.missing) {
    const eligible = sim.mates.filter((m) => !m.fake);
    if (eligible.length) {
      const m = eligible[Math.floor(k[0] * eligible.length)];
      const far = lostSpots(sim.world, Math.min(C.AREAS - 1, area + (k[1] < 0.5 ? 0 : 1)));
      const s = far.length ? far[Math.floor(k[1] * 2 % 1 * far.length)] : spots[0];
      sim.missing = {
        id: m.id, name: m.name, role: m.role || null, slot: m.slot, skills: { ...m.skills }, points: m.points, practice: { ...m.practice },
        lucidity: m.lucidity, x: s.cx + 0.5, y: s.cy + 0.5, area: areaOfRow(s.cy), lastDay: night, nights: 1, found: false,
      };
      m.fake = true; m.since = night + 1; m.practice = {};
    }
  }
  const used = new Set();
  sim.mates.forEach((m, i) => {
    let j = Math.floor(k[2 + (i % 6)] * spots.length);
    for (let n = 0; n < spots.length && used.has(j); n++) j = (j + 1) % spots.length;
    used.add(j);
    const s = spots[j];
    m.x = s.cx + 0.5; m.y = s.cy + 0.5; m.hidden = true; m.path = null; m.goal = null;
  });
  sim.keystone = { day: sim.day, back: [] };
  sim.dawnDone = sim.day;                     // no plan this morning: there is nobody to give it to
  record(sim, "keystone", []);
  return true;
}

/** Someone come back from the keystone morning: there, between the trees. */
function keystoneTick(sim) {
  for (const m of sim.mates) {
    if (!m.hidden) continue;
    const back = dist(m, sim.lead) <= C.KEYSTONE_SEEN || isNight(sim);
    if (!back) continue;
    m.hidden = false; m.following = true;
    if (sim.keystone) sim.keystone.back.push(m.id);
    sim.say(`${m.name} is there, between the trees.`);
  }
}

/** "Was everyone there?" — everyone says yes. Nobody finds it strange. */
export function everyoneThere(sim, id, day) {
  const f = found(sim);
  const who = sim.mates.find((m) => m.id === id) || (f && f.id === id ? f : null);
  if (!who) return [];
  startBusy(sim, "ask", C.ASK_MIN);
  if ((who.away || []).includes(day)) return ["I wasn't with you that day. I don't know."];
  if (sim.keystone && sim.keystone.day === day) return ["We were all here. You were the one who went off into the trees."];
  return ["Everyone was there. All seven of us."];
}

// ---- the far side ---------------------------------------------------------------
export function homeCandidates(sim) {
  return nearPeople(sim, sim.lead, 10);
}
/** Light a home pylon with someone. Every attempt spends one. */
export function lightHome(sim, id) {
  const h = sim.home;
  if (!h || h.pylons <= 0) return;
  const f = found(sim);
  const who = sim.mates.find((m) => m.id === id) || (f && f.id === id ? f : null);
  if (!who) return;
  h.pylons--;
  if (who.fake) {
    h.tried.push(who.name);
    sim.mates = sim.mates.filter((m) => m !== who);
    sim.say(`The pylon stays dark. ${who.name} is not there.`);
    sim.sfx("dark");
  } else {
    h.saved.push({ name: who.name, points: who.points });
    if (who === f) sim.missing = null;
    else sim.mates = sim.mates.filter((m) => m !== who);
    sim.say(`The pylon takes. ${who.name} is gone home.`);
    sim.sfx("home");
  }
  if (h.pylons <= 0 || homeCandidates(sim).length === 0) finishRun(sim);
}
export function finishRun(sim) {
  const h = sim.home || { saved: [], tried: [] };
  sim.status = "ended";
  sim.ending = { kind: h.saved.length ? "home" : "alone", saved: h.saved, tried: h.tried, lost: sim.lost.slice(), day: sim.day };
  sim.pending = null;
}
export function turnBack(sim) {
  if (sim.pending === "home") sim.pending = null;
  sim.exitLeft = false;
}

// ---- one tick ---------------------------------------------------------------------
/** input: {mx, my} in [-1,1]. Does nothing while a panel is pending. */
export function tick(sim, input = {}) {
  if (sim.status !== "playing" || sim.pending) return;
  const L = sim.lead, w = sim.world, h = C.TICK_MIN / 60;
  const wasNight = isNight(sim);
  let walked = false;
  sim.ticks++;

  // The lead.
  if (L.busy) {
    L.busy.left -= C.TICK_MIN;
    if (L.busy.left <= 0) finishBusy(sim);
  } else {
    let mx = input.mx || 0, my = input.my || 0;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    if (len > 0.05) walked = moveBody(w, L, mx * C.LEAD_SPEED, my * C.LEAD_SPEED);
  }

  // Wood: carried wood counts once it is on the pile; old piles are picked up.
  if (L.carry > 0 && atCamp(sim, L)) {
    const left = stackWood(sim.camp, L.carry), put = L.carry - left;
    if (put > 0) sim.say(left ? `You stack ${put} wood. Both stacks are full; you keep ${left}.` : `You stack ${put} wood.`);
    L.carry = left;
  }
  // An old pile is taken by walking onto it — never by standing where it was left.
  for (const p of sim.piles) {
    if (walked && p.wood > 0 && dist(p, L) <= C.PILE_REACH) { L.carry += p.wood; sim.say(`You take ${p.wood} wood from the old pile.`); p.wood = 0; }
  }
  sim.piles = sim.piles.filter((p) => p.wood > 0);

  // The companions.
  keystoneTick(sim);
  for (const m of sim.mates) if (!m.hidden) updateMate(sim, m);
  separate(sim);

  // Someone found follows you home; at camp, two stand at the fire.
  const ms = sim.missing;
  if (ms && !ms.found && dist(ms, L) <= findReach(sim)) {
    const t = sim.mates.filter((m) => dist(m, L) <= 4 && !m.asleep).sort((a, b) => (b.skills.track || 0) - (a.skills.track || 0))[0];
    if (t) practice(t, "track");
    ms.found = true; ms.path = null; sim.say(`${ms.name} is here, in the trees. They follow you.`); sim.sfx("found"); }
  if (ms && ms.found) {
    if (dist(ms, L) > 2.2) { const c = cellOf(L); walkTo(w, ms, c.cx, c.cy, C.MATE_SPEED); }
    const twin = sim.mates.find((m) => m.id === ms.id);
    if (sim.camp.built && atCamp(sim, ms)) {
      if (twin) { sim.twin = { id: ms.id }; sim.pending = "twin"; sim.sfx("twin"); }
      else { restoreReal(sim, -1); sim.say("They sit down by the fire as if they never left."); sim.sfx("found"); }
    }
  }

  // Fire and pylons burn.
  if (sim.camp.built && sim.camp.fire > 0) {
    sim.camp.fire = Math.max(0, sim.camp.fire - h);
    // A fire dying in the night wakes the lead sleeping beside it: cold, dark, and time to choose.
    const mod = minuteOfDay(sim);
    if (sim.camp.fire === 0 && L.asleep && atCamp(sim, L) && (mod >= C.DUSK || mod < C.DAWN - 60)) {
      L.busy = null; L.asleep = false;
      sim.say("The fire is out. You wake in the cold and the dark.");
    }
  }
  for (const p of w.pylons) if (p.state === "lit" && minutes(sim) - p.litAt >= C.PYLON_BURN) p.state = "spent";

  // The hidden meter. Day one is deliberately quiet.
  const night = isNight(sim);
  if (sim.day > 1) {
    drain(sim, L, 0, night, h);
    for (const m of sim.mates) if (!m.fake) drain(sim, m, m.skills.keen || 0, night, h);
  }
  if (night) exposureTick(sim);

  // Dusk and dawn.
  if (!wasNight && night && sim.duskSeen < sim.day) {
    sim.duskSeen = sim.day;
    for (const m of sim.mates) if (!m.following && m.task && DAY_TASKS.includes(m.task.kind) && !moving(m)) setTask(m, "sleep");
    sim.say("The light is going.");
    sim.sfx("dusk");
  }
  if (Math.floor(minutes(sim) / 1440) + 1 > sim.day) resolveNight(sim);
  if (sim.camp.built && atCamp(sim, L) && !L.busy) {
    const mod = minuteOfDay(sim);
    if (sim.dawnDone < sim.day && mod >= C.DAWN && mod < 12 * 60) sim.pending = "dawn";
    else if (sim.duskSeen === sim.day && sim.duskDone < sim.day && night && mod >= C.DUSK) sim.pending = "dusk";
  }

  // The far side.
  if (Math.floor(L.y) <= C.EXIT_ROWS) {
    if (!sim.home) sim.home = { pylons: realCount(sim) + 1, saved: [], tried: [] };
    if (sim.exitLeft) { sim.pending = "home"; sim.exitLeft = false; }
  } else sim.exitLeft = true;

  if (L.lucidity <= 0) {
    sim.status = "ended";
    sim.ending = { kind: "lost", saved: [], tried: [], lost: sim.lost.slice(), day: sim.day };
  }
}

/** Bodies do not stand inside each other: overlapping companions step apart. */
function separate(sim) {
  const bodies = sim.mates.filter((m) => !m.asleep && !m.hidden);
  const f = found(sim);
  if (f) bodies.push(f);
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (const b of [...bodies.slice(i + 1), sim.lead]) {
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
      if (d >= 0.7) continue;
      const push = (0.7 - d) * 0.25, ux = d > 1e-6 ? dx / d : Math.cos(a.slot || i), uy = d > 1e-6 ? dy / d : Math.sin(a.slot || i);
      moveBody(sim.world, a, ux * push, uy * push);
      if (b !== sim.lead) moveBody(sim.world, b, -ux * push, -uy * push);
    }
  }
}

function drain(sim, p, keen, night, h) {
  const area = areaOf(p);
  const depth = pylonLit(sim, area) ? 1 : C.DEPTH[area];
  const isWarm = warm(sim, p);
  const asleep = p === sim.lead ? sim.lead.asleep : p.asleep;
  if (asleep && night && isWarm) { p.lucidity = Math.min(100, p.lucidity + C.REST_GAIN * h); return; }
  const rate = C.DRAIN * depth * (night && !isWarm ? C.NIGHT_MULT : 1) * (asleep ? C.SLEEP_MULT : 1) * (1 - C.KEEN_SKILL * keen);
  p.lucidity = Math.max(0, p.lucidity - rate * h);
}

export { frontDeadfall, walkable };
export { campWood };
