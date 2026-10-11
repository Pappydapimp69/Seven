// mates.js — what each companion does, one state machine, one file. Pure.
//
// A companion's task is set at camp at dawn and at dusk (blueprint 0.35) and
// nowhere else. In the field the lead can only CALL: someone in earshot who
// hears finishes the chunk in their hands, then follows. Work comes in chunks
// (one chop, one tree); a day chunk is only started if it ends before dusk.

import { K, bfs, kindAt, areaOfRow, fellTree, clearDeadfall } from "./world.js?v=seven-1.13.0";
import { dist, cellOf, walkTo, nearestWalkable } from "./body.js?v=seven-1.13.0";
import { record } from "./chronicle.js?v=seven-1.13.0";
import { makeCampAt, takeCampDown, stackWood, takeWood, campWood } from "./camp.js?v=seven-1.13.0";
import { pathTo, areaOfRow as rowArea, nearestLandmark, LANDMARK_NAME } from "./world.js?v=seven-1.13.0";
import {
  MATE_SPEED, TICK_MIN, DUSK, CHOP_MIN, CHOP_PROGRESS, CHOP_SKILL, FELL_MIN, FELL_YIELD, HAUL_LOAD,
  CAMP_RADIUS, WATCH_FEED_BELOW, DEADFALL_THICKER, TEAM, TEND_SKILL, MAKE_CAMP_MIN, DISMANTLE_MIN, BUILD_SKILL,
  SCOUT_SPOT, TRACK_REACH, FIRE_LIGHT_WOOD, FIRE_LIGHT_HOURS, DIRS8, FIRE_FEED_HOURS, FIRE_MAX_HOURS, PRACTICE_CHUNKS, FAKE_LEARNS, SKILL_MAX,
} from "./config.js?v=seven-1.13.0";
import { hash01 } from "./rng.js?v=seven-1.13.0";
import { whistleOf } from "./whistle.js?v=seven-1.13.0";

export const DAY_TASKS = Object.freeze(["free", "chop", "gather", "tend", "move", "scout", "camp"]);
export const NIGHT_TASKS = Object.freeze(["sleep", "watch", "work", "free"]);
export const TASK_LABEL = Object.freeze({
  free: "With you", chop: "Chop the deadfall", gather: "Gather wood", camp: "Stay at camp", move: "Move camp forward",
  tend: "Tend the fire", scout: "Scout ahead",
});
/** Which skill each job leans on (keen is not a job: it helps everywhere). */
export const TASK_SKILL = Object.freeze({
  chop: "cut", gather: "carry", tend: "tend", move: "build", scout: "track", watch: "tend", work: null,
  sleep: "Sleep", watch: "Keep watch", work: "Keep working",
});

export function setTask(m, kind, work = null) {
  if (moving(m)) return;                  // a camp half-carried is finished first
  m.task = { kind, work, chunk: 0, carry: m.task ? m.task.carry : 0, tree: null, stage: null };
  m.following = false; m.callPending = false; m.asleep = false;
}

/** A finished chunk of work. Returns the new level on a level-up, else 0. */
export function practice(m, skill) {
  const level = (m.skills && m.skills[skill]) || 0;
  if (level >= SKILL_MAX) return 0;
  m.practice[skill] = (m.practice[skill] || 0) + 1;
  const need = (PRACTICE_CHUNKS * (0.7 + 0.6 * hash01(`${m.id}:${skill}:${level}`))) / (m.fake ? FAKE_LEARNS : 1);
  if (m.practice[skill] < need) return 0;
  m.practice[skill] = 0;
  m.skills[skill] = level + 1;
  return level + 1;
}

const minuteOfDay = (sim) => (sim.ticks * TICK_MIN + 360) % 1440;
const isNight = (sim) => { const m = minuteOfDay(sim); return m < 360 || m >= DUSK; };
const fits = (sim, minutes) => !isNight(sim) && minuteOfDay(sim) + minutes <= DUSK;

/** Where this companion stands at camp: a slot round the fire. */
export function campSpot(sim, m) {
  const a = (m.slot / TEAM) * Math.PI * 2;
  return nearestWalkable(sim.world, sim.camp.x + Math.cos(a) * 2, sim.camp.y + Math.sin(a) * 2);
}

/** The deadfall being worked: the lowest one still standing. */
export function frontDeadfall(sim) {
  return sim.world.deadfalls.find((d) => !d.cleared) || null;
}

export function chopAt(sim, d, who, cut) {
  if (d.cleared) return;
  // Deeper trunks are thicker.
  d.progress = Math.min(1, d.progress + (CHOP_PROGRESS * (1 + CHOP_SKILL * cut) * (sim.tutorial ? 5 : 1)) / (1 + DEADFALL_THICKER * d.area));
  record(sim, "chop", [who]);
  if (d.progress >= 1 - 1e-9) {
    clearDeadfall(sim.world, d);
    record(sim, "cleared", [who]);
    sim.say(`The deadfall gives way. The trail north is open.`);
    if (sim.sfx) sim.sfx("crack", { x: d.x, y: d.y });
  }
}

/** What someone's hands are doing right now, for the eye: "chop" | "fell" | "build" | null. */
export function working(m) {
  const t = m.task;
  if (!t || m.asleep || m.following) return null;
  if (handsFull(m)) return (t.kind === "work" ? t.work : t.kind) === "chop" ? "chop" : "fell";
  if (t.kind === "move" && (t.stage === "down" || t.stage === "up") && t.chunk > 0) return "build";
  return null;
}

/** Hands on a chunk of real work (a chop, a tree) — finished before answering a whistle. */
export function handsFull(m) {
  const t = m.task, k = t && (t.kind === "work" ? t.work : t.kind);
  return !!(t && t.chunk > 0 && (k === "chop" || k === "gather"));
}

// ---- Move camp: take it down, carry it past the cleared trunk, put it up ----
/** A move under way runs on through dusk: a camp half-carried is no camp at all. */
export const moving = (m) => !!(m.task && m.task.kind === "move" && (m.task.stage === "carry" || m.task.stage === "up"));
const moveCrew = (sim) => sim.mates.filter((x) => x.task && x.task.kind === "move" && !x.following);
/** Where camp goes next: three rows past the trunk of the area camp stands in, once it is cut. */
export function nextCampSite(sim) {
  const a = rowArea(Math.floor(sim.camp.y));
  const d = sim.world.deadfalls.find((x) => x.area === a);
  if (!d || !d.cleared) return null;
  const row = d.row - 3;
  return { cx: sim.world.trailX[row], cy: row };
}
function campWorkSpeed(sim, lead) {
  const crew = moveCrew(sim).filter((x) => x === lead || dist(x, lead) <= 4).slice(0, 3);
  return crew.reduce((s, x, i) => s + (i === 0 ? 1 : 0.5) * (1 + BUILD_SKILL * (x.skills.build || 0)), 0);
}
function updateMove(sim, m) {
  const w = sim.world, t = m.task, crew = moveCrew(sim), boss = crew[0];
  if (m !== boss) {                       // the rest of the crew go where the boss goes
    if (dist(m, boss) > 2) { const c = cellOf(boss); walkTo(w, m, c.cx, c.cy, MATE_SPEED); }
    return true;
  }
  const speed = campWorkSpeed(sim, m);
  const ids = crew.filter((x) => dist(x, m) <= 4).map((x) => x.id);
  if (!t.stage || t.stage === "done") {
    if (t.stage === "done" || !sim.camp.built) return false;
    const site = nextCampSite(sim);
    if (!site) return false;
    const here = cellOf(m), path = pathTo(w, here.cx, here.cy, site.cx, site.cy);
    if (!path) return false;
    const mins = (DISMANTLE_MIN + MAKE_CAMP_MIN) / speed + (path.length / MATE_SPEED) * TICK_MIN * 1.5 + 30;
    if (!fits(sim, mins)) return false;   // not today: it would leave everyone campless at dark
    t.stage = "down"; t.dest = site; t.chunk = 0;
  }
  if (t.stage === "down") {
    if (!sim.camp.built) { t.stage = "carry"; t.chunk = 0; return true; }
    const s = campSpot(sim, m);
    if (t.chunk === 0 && walkTo(w, m, s.cx, s.cy, MATE_SPEED) !== "arrived") return true;
    t.chunk += TICK_MIN;
    t.need = DISMANTLE_MIN / speed;
    if (t.chunk >= DISMANTLE_MIN / speed) { t.chunk = 0; takeCampDown(sim, ids); for (const x of crew) practice(x, "build"); t.stage = "carry"; }
    return true;
  }
  if (t.stage === "carry") {
    if (walkTo(w, m, t.dest.cx, t.dest.cy, MATE_SPEED) === "arrived") { t.stage = "up"; t.chunk = 0; }
    return true;
  }
  if (t.stage === "up") {
    if (sim.camp.built) { t.stage = "done"; return false; }   // someone else put one up
    t.chunk += TICK_MIN;
    t.need = MAKE_CAMP_MIN / speed;
    if (t.chunk >= MAKE_CAMP_MIN / speed) {
      t.chunk = 0; t.stage = "done";
      makeCampAt(sim, t.dest.cx + 0.5, t.dest.cy + 0.5, ids);
      for (const x of crew) practice(x, "build");
    }
    return true;
  }
  return false;
}

export function updateMate(sim, m) {
  const w = sim.world, camp = sim.camp;
  const t = m.task || (m.task = { kind: "free", chunk: 0, carry: 0 });
  // A whistle heard a while ago: once the wait is over, come back (after this chunk).
  if (m.heard) {
    m.heard.wait -= TICK_MIN;
    if (m.heard.wait <= 0) {
      m.heard = null;
      if (handsFull(m)) m.callPending = true; else m.following = true;
      if (sim.sfx) sim.sfx("answer", { x: m.x, y: m.y, slot: m.slot, sig: whistleOf(sim, m) });   // you hear them whistle back, the same for real and false
    }
  }
  if (t.kind === "move" && !m.following && updateMove(sim, m)) return;
  let kind = t.kind === "work" ? (t.work || "free") : t.kind;
  if (kind === "move") kind = "camp";     // nothing to move (or done): keep camp
  if (m.following || !camp.built) kind = "follow";
  if (kind === "free") kind = "follow";
  const night = isNight(sim);

  // Work that has no business at night goes home (unless it is night WORK).
  if (night && t.kind !== "work" && (kind === "chop" || kind === "gather" || kind === "scout")) kind = "camp";

  // Tend the fire (tend): keep camp by day, and as the light goes, light the
  // fire and keep it fed so it is burning when dark comes.
  if (kind === "tend") {
    const s = campSpot(sim, m);
    if (walkTo(w, m, s.cx, s.cy, MATE_SPEED) !== "arrived" && dist(m, camp) > CAMP_RADIUS - 0.5) return;
    m.asleep = false;
    t.chunk += TICK_MIN;
    if (t.chunk < 20) return;
    t.chunk = 0;
    const mod = minuteOfDay(sim);
    if (mod < DUSK - 90 && !night) return;
    if (camp.fire <= 0 && campWood(camp) >= FIRE_LIGHT_WOOD) {
      takeWood(camp, FIRE_LIGHT_WOOD); camp.fire = FIRE_LIGHT_HOURS;
      record(sim, "fire", [m.id]);
      practice(m, "tend");
    } else if (camp.fire > 0 && camp.fire < WATCH_FEED_BELOW + 2 && campWood(camp) > 0) {
      takeWood(camp, 1); camp.fire = Math.min(FIRE_MAX_HOURS, camp.fire + FIRE_FEED_HOURS * (1 + TEND_SKILL * (m.skills.tend || 0)));
      practice(m, "tend");
    }
    return;
  }

  // Scout ahead (track): walk the clearings of this stretch and the next, and
  // come back with what was heard. Nobody is brought back: only the lead can do that.
  if (kind === "scout") return updateScout(sim, m, t);

  if (kind === "follow") {
    m.asleep = false;
    const lead = sim.lead;
    if (dist(m, lead) > 2.2) {
      const c = cellOf(lead);
      walkTo(w, m, c.cx, c.cy, MATE_SPEED);
    }
    return;
  }

  if (kind === "sleep" || kind === "camp" || kind === "watch") {
    const s = campSpot(sim, m);
    const st = walkTo(w, m, s.cx, s.cy, MATE_SPEED);
    if (st !== "arrived" && dist(m, camp) > CAMP_RADIUS - 0.5) { m.asleep = false; return; }
    if (kind === "sleep") { m.asleep = true; return; }
    m.asleep = false;
    t.chunk += TICK_MIN;
    if (t.chunk >= 30) {
      t.chunk = 0;
      if (camp.fire > 0 && camp.fire < WATCH_FEED_BELOW && campWood(camp) > 0) {
        takeWood(camp, 1); camp.fire = Math.min(FIRE_MAX_HOURS, camp.fire + FIRE_FEED_HOURS * (1 + TEND_SKILL * (m.skills.tend || 0)));
        practice(m, "tend");
      }
    }
    return;
  }

  m.asleep = false;
  if (kind === "chop") {
    const d = frontDeadfall(sim);
    const campArea = areaOfRow(Math.floor(camp.y));
    if (t.df && (!d || d.id !== t.df)) { t.chunk = 0; t.df = null; }
    if (!d || d.area > campArea + 1) return goCamp(sim, m);
    if (t.chunk === 0 && !(t.kind === "work" || fits(sim, CHOP_MIN))) return goCamp(sim, m);
    const sx = w.trailX[d.row + 1] + ((m.slot % 3) - 1), sy = d.row + 1;
    if (t.chunk === 0 && walkTo(w, m, sx, sy, MATE_SPEED) !== "arrived") return;
    t.chunk += TICK_MIN; t.df = d.id;
    if (t.chunk >= CHOP_MIN) {
      t.chunk = 0; t.df = null;
      chopAt(sim, d, m.id, m.skills.cut || 0);
      practice(m, "cut");
      afterChunk(m);
    }
    return;
  }

  if (kind === "gather") {
    if (t.carry > 0) {
      if (dist(m, camp) <= CAMP_RADIUS - 0.5) { t.carry = stackWood(camp, t.carry); if (t.carry === 0) afterChunk(m); else { m.following = false; } return; }
      return goCamp(sim, m);
    }
    if (t.chunk === 0 && !(t.kind === "work" || fits(sim, FELL_MIN))) return goCamp(sim, m);
    // An old woodpile left where a camp came down is hauled in first: it is wood already cut.
    const pile = sim.piles.filter((p) => p.wood > 0).sort((a, b) => dist(a, m) - dist(b, m))[0];
    if (pile) {
      const pc = nearestWalkable(w, pile.x, pile.y);
      if (walkTo(w, m, pc.cx, pc.cy, MATE_SPEED) !== "arrived") return;
      const n = Math.min(HAUL_LOAD, pile.wood);
      pile.wood -= n; t.carry += n;
      if (pile.wood <= 0) sim.piles = sim.piles.filter((p) => p !== pile);
      return;
    }
    // A tree: find the nearest one we can stand beside, once, then walk to it.
    let tree = t.tree ? w.trees.find((x) => x.id === t.tree) : null;
    if (!tree || tree.felled) {
      tree = null; t.tree = null; t.chunk = 0;
      if (t.noTree > 0) { t.noTree--; return goCamp(sim, m); }
      const c = cellOf(m), campArea = areaOfRow(Math.floor(camp.y));
      let found = null;
      const path = bfs(w, c.cx, c.cy, (x, y) => {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (kindAt(w, x + dx, y + dy) === K.TREE && Math.abs(areaOfRow(y) - campArea) <= 1) { found = { x: x + dx, y: y + dy, sx: x, sy: y }; return true; }
        }
        return false;
      }, 4000);
      tree = path && found ? w.trees.find((x) => x.cx === found.x && x.cy === found.y) : null;
      if (!tree) { t.noTree = 150; return goCamp(sim, m); }
      t.tree = tree.id; t.stand = { cx: found.sx, cy: found.sy };
    }
    if (t.chunk === 0 && walkTo(w, m, t.stand.cx, t.stand.cy, MATE_SPEED) !== "arrived") return;
    t.chunk += TICK_MIN;
    if (t.chunk >= FELL_MIN / (1 + 0.12 * (m.skills.carry || 0))) {
      t.chunk = 0;
      fellTree(w, tree);
      t.tree = null;
      t.carry += sim.rng.int(FELL_YIELD[0], FELL_YIELD[1]) + Math.floor((m.skills.carry || 0) / 2);
      record(sim, "fell", [m.id]);
      practice(m, "carry");
      if (m.callPending) { m.callPending = false; m.following = true; }
    }
    return;
  }
  goCamp(sim, m);
}

function updateScout(sim, m, t) {
  const w = sim.world, camp = sim.camp;
  const a = areaOfRow(Math.floor(camp.y));
  if (!t.route) {
    const c = cellOf(m);
    t.route = w.pockets.filter((p) => (p.area === a || p.area === a + 1) && pathTo(w, c.cx, c.cy, p.x, p.y)).map((p) => p.id);
    t.leg = 0;
  }
  const ms = sim.missing;
  if (ms && !ms.found && !t.saw && dist(m, ms) <= SCOUT_SPOT + TRACK_REACH * (m.skills.track || 0)) {
    const ang = Math.atan2(ms.x - camp.x, -(ms.y - camp.y));
    t.saw = DIRS8[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  }
  const ms2 = sim.missing;
  const done = t.leg >= t.route.length || !fits(sim, 90);
  if (done) {
    const s = campSpot(sim, m);
    if (walkTo(w, m, s.cx, s.cy, MATE_SPEED) === "arrived" || dist(m, camp) <= CAMP_RADIUS - 0.5) {
      if (t.saw) {
        const lm = ms2 ? nearestLandmark(w, ms2.x, ms2.y, 7) : null;
        sim.say(`${m.name} is back from scouting: there was someone out in the trees, ${t.saw} of camp${lm ? `, by ${LANDMARK_NAME[lm.kind]}` : ""}.`);
        record(sim, "scout", [m.id], lm ? { dir: t.saw, place: lm.kind, area: lm.area } : { dir: t.saw });
        t.saw = null;
      }
    }
    return;
  }
  const p = w.pockets.find((x) => x.id === t.route[t.leg]);
  const st = p ? walkTo(w, m, p.x, p.y, MATE_SPEED) : "stuck";
  if (st === "arrived" || st === "stuck") {
    t.leg++;
    practice(m, "track");
  }
}

function afterChunk(m) {
  if (m.callPending) { m.callPending = false; m.following = true; }
}

function goCamp(sim, m) {
  const s = campSpot(sim, m);
  walkTo(sim.world, m, s.cx, s.cy, MATE_SPEED);
}
