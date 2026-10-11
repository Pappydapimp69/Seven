// mates.js — what each companion does, one state machine, one file. Pure.
//
// A companion's task is set at camp at dawn and at dusk (blueprint 0.35) and
// nowhere else. In the field the lead can only CALL: someone in earshot who
// hears finishes the chunk in their hands, then follows. Work comes in chunks
// (one chop, one tree); a day chunk is only started if it ends before dusk.

import { K, bfs, kindAt, areaOfRow, fellTree, clearDeadfall } from "./world.js?v=seven-1.1.0";
import { dist, cellOf, walkTo, nearestWalkable } from "./body.js?v=seven-1.1.0";
import { record } from "./chronicle.js?v=seven-1.1.0";
import {
  MATE_SPEED, TICK_MIN, DUSK, CHOP_MIN, CHOP_PROGRESS, CHOP_SKILL, FELL_MIN, FELL_YIELD, HAUL_LOAD,
  CAMP_RADIUS, WATCH_FEED_BELOW, DEADFALL_THICKER, TEAM, FIRE_FEED_HOURS, FIRE_MAX_HOURS, PRACTICE_CHUNKS, FAKE_LEARNS, SKILL_MAX,
} from "./config.js?v=seven-1.1.0";
import { hash01 } from "./rng.js?v=seven-1.1.0";

export const DAY_TASKS = Object.freeze(["free", "chop", "gather", "camp"]);
export const NIGHT_TASKS = Object.freeze(["sleep", "watch", "work", "free"]);
export const TASK_LABEL = Object.freeze({
  free: "With you", chop: "Chop the deadfall", gather: "Gather wood", camp: "Stay at camp",
  sleep: "Sleep", watch: "Keep watch", work: "Keep working",
});

export function setTask(m, kind, work = null) {
  m.task = { kind, work, chunk: 0, carry: m.task ? m.task.carry : 0, tree: null };
  m.following = false; m.callPending = false; m.asleep = false;
}

/** A finished chunk of work. Returns the new level on a level-up, else 0. */
export function practice(m, skill) {
  const level = m.skills[skill] || 0;
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
  d.progress = Math.min(1, d.progress + (CHOP_PROGRESS * (1 + CHOP_SKILL * cut)) / (1 + DEADFALL_THICKER * d.area));
  record(sim, "chop", [who]);
  if (d.progress >= 1 - 1e-9) {
    clearDeadfall(sim.world, d);
    record(sim, "cleared", [who]);
    sim.say(`The deadfall gives way. The trail north is open.`);
  }
}

export function updateMate(sim, m) {
  const w = sim.world, camp = sim.camp;
  const t = m.task || (m.task = { kind: "free", chunk: 0, carry: 0 });
  let kind = t.kind === "work" ? (t.work || "free") : t.kind;
  if (m.following || !camp.built) kind = "follow";
  if (kind === "free") kind = "follow";
  const night = isNight(sim);

  // Work that has no business at night goes home (unless it is night WORK).
  if (night && t.kind !== "work" && (kind === "chop" || kind === "gather")) kind = "camp";

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
      if (camp.fire > 0 && camp.fire < WATCH_FEED_BELOW && camp.pile > 0) {
        camp.pile--; camp.fire = Math.min(FIRE_MAX_HOURS, camp.fire + FIRE_FEED_HOURS);
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
      if (dist(m, camp) <= CAMP_RADIUS - 0.5) { camp.pile += t.carry; t.carry = 0; afterChunk(m); return; }
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

function afterChunk(m) {
  if (m.callPending) { m.callPending = false; m.following = true; }
}

function goCamp(sim, m) {
  const s = campSpot(sim, m);
  walkTo(sim.world, m, s.cx, s.cy, MATE_SPEED);
}
