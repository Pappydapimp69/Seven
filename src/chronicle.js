// chronicle.js — the record of each day, and the account a person gives of it.
//
// SEVEN's own rule: tells are DERIVED, never authored. A real account is the
// day's facts told straight. A fake's is the same facts with exactly ONE bent —
// a wrong name, a wrong task, the wrong weather, the wrong direction — chosen
// by hash from the seed, day and teller, so no rng is drawn and nothing comes
// from a hand-written list of tells. Exactly one sentence differs.

import { hash01 } from "./rng.js?v=seven-1.15.0";
import { nameOff } from "./names.js?v=seven-1.15.0";
import { WEATHER, DIRS8 } from "./config.js?v=seven-1.15.0";
import { LANDMARKS, LANDMARK_NAME } from "./world.js?v=seven-1.15.0";

export function openDay(sim, day, weather) {
  sim.chronicle[day] = { weather, plan: null, events: [] };
}

/** Record something that happened. `who` are ids ("lead" for the player). */
export function record(sim, kind, who = [], extra = {}) {
  const day = sim.chronicle[sim.day];
  if (!day) return;
  day.events.push({ kind, who: who.slice(), ...extra });
}

export function recordPlan(sim, choices) {
  const day = sim.chronicle[sim.day];
  if (day) day.plan = { ...choices };
}

const TASK_PHRASE = { chop: "on the deadfall", gather: "on wood", camp: "at camp", free: "to their own business" };
const PRIORITY = ["keystone", "found", "cleared", "camp_made", "camp_down", "pylon", "scout", "fire", "call", "fell", "chop", "area"];

/** The facts of a day, in a fixed order, as plain objects. */
export function facts(sim, day) {
  const d = sim.chronicle[day];
  if (!d) return [];
  const out = [{ type: "weather", v: d.weather }];
  if (d.plan) {
    const pairs = Object.entries(d.plan).filter(([, t]) => TASK_PHRASE[t] && t !== "free").map(([id, t]) => [id, t]);
    if (pairs.length) out.push({ type: "plan", pairs });
  }
  // One fact per kind, people merged, in priority order; at most four.
  const merged = new Map();
  for (const e of d.events) {
    const m = merged.get(e.kind) || { type: "ev", kind: e.kind, who: [], n: 0, dir: e.dir, area: e.area, place: e.place };
    for (const w of e.who) if (!m.who.includes(w)) m.who.push(w);
    m.n++;
    if (e.dir) m.dir = e.dir;
    if (e.place) m.place = e.place;
    if (e.area != null) m.area = e.area;
    merged.set(e.kind, m);
  }
  const evs = PRIORITY.filter((k) => merged.has(k)).map((k) => merged.get(k)).slice(0, 4);
  return out.concat(evs);
}

/** Bend exactly one fact. Pure: decided by hash, never by the rng. */
export function bend(sim, list, day, teller) {
  const key = `${sim.seed}:${day}:${teller.id}`;
  const options = [];
  list.forEach((f, i) => {
    if (f.type === "weather") options.push(i);
    if (f.type === "plan" && f.pairs.length) options.push(i);
    if (f.type === "ev" && (f.who.some((w) => w !== "lead") || f.dir || f.place)) options.push(i);
  });
  const i = options[Math.floor(hash01(key) * options.length)];
  const out = list.map((f) => ({ ...f, who: f.who ? f.who.slice() : f.who, pairs: f.pairs ? f.pairs.map((p) => p.slice()) : f.pairs }));
  const f = out[i];
  const h = hash01(key + ":v");
  const roster = sim.roster;
  if (f.type === "weather") {
    const others = WEATHER.filter((w) => w !== f.v);
    f.v = others[Math.floor(h * others.length)];
  } else if (f.type === "plan") {
    const a = Math.floor(h * f.pairs.length);
    const b = f.pairs.findIndex((p, k) => k !== a && p[1] !== f.pairs[a][1]);
    if (b >= 0) { const t = f.pairs[a][1]; f.pairs[a][1] = f.pairs[b][1]; f.pairs[b][1] = t; }
    else f.pairs[a] = ["~" + f.pairs[a][0], f.pairs[a][1]];   // a name a letter off
  } else {
    // Whichever of place, direction and person this fact has, one of them is bent.
    const canWho = f.who.some((w) => w !== "lead");
    const picks = [f.place && "place", f.dir && "dir", canWho && "who"].filter(Boolean);
    const pick = picks[Math.floor(h * picks.length)];
    if (pick === "place") {
      // A wrong place is a REAL place in the same woods: one you could have been to.
      const same = sim.world.pockets.filter((p) => p.area === f.area && p.kind !== f.place).map((p) => p.kind);
      const pool = same.length ? same : LANDMARKS.filter((k) => k !== f.place);
      f.place = pool[Math.floor(hash01(key + ":p") * pool.length)];
    } else if (pick === "dir") f.dir = DIRS8[(DIRS8.indexOf(f.dir) + 2) % 8];
    else {
      const k = f.who.findIndex((w) => w !== "lead");
      const swap = roster.filter((r) => !f.who.includes(r.id) && r.id !== teller.id);
      if (swap.length && h < 0.7) f.who[k] = swap[Math.floor(hash01(key + ":w") * swap.length)].id;
      else f.who[k] = "~" + f.who[k];
    }
  }
  return out;
}

/** Sentences for a list of facts, told by `teller`. */
export function tell(sim, list, teller) {
  const nm = (id) => {
    if (id === "lead") return "you";
    const off = id.startsWith("~");
    const r = sim.roster.find((x) => x.id === (off ? id.slice(1) : id));
    const base = r ? r.name : id;
    if (!off && teller && id === teller.id) return "I";
    return off ? nameOff(base) : base;
  };
  const join = (ids) => {
    const n = ids.map(nm);
    const s = n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
    return s[0].toUpperCase() + s.slice(1);
  };
  return list.map((f) => {
    if (f.type === "weather") return `It was ${f.v} that day.`;
    if (f.type === "plan") {
      const by = {};
      for (const [id, t] of f.pairs) (by[t] = by[t] || []).push(id);
      const parts = Object.entries(by).map(([t, ids]) => `${join(ids).replace(/^You$/, "you")} ${TASK_PHRASE[t]}`);
      return `At dawn you put ${parts.join("; ")}.`;
    }
    const who = f.who.length ? join(f.who) : "We";
    switch (f.kind) {
      case "cleared": return `${who} cut through the deadfall.`;
      case "chop": return `${who} chopped at the trunk.`;
      case "fell": return `${who} brought down ${f.n > 1 ? "trees" : "a tree"}.`;
      case "fire": return `${who} lit the fire.`;
      case "camp_made": return `${who} made camp.`;
      case "camp_down": return `${who} took the camp down.`;
      case "pylon": return f.place ? `${who} lit the pylon at ${LANDMARK_NAME[f.place]}.` : `${who} lit a pylon.`;
      case "found": return `${who} was found ${f.place ? `by ${LANDMARK_NAME[f.place]}` : "out in the trees"}.`;
      case "call": return `A voice called from the ${f.dir} at first light.`;
      case "scout": return `${who} came back from scouting and said there was someone ${f.dir} of camp${f.place ? `, by ${LANDMARK_NAME[f.place]}` : ""}.`;
      case "area": return `We walked on into deeper woods.`;
      case "keystone": return `That was the morning you woke and went off into the trees.`;
      default: return `${who} kept busy.`;
    }
  });
}

/** What `teller` says about `day`. A fake bends one fact of any day it was not there for. */
export function account(sim, teller, day) {
  if ((teller.away || []).includes(day)) return ["I wasn't with you that day. I was out there, in the trees.", "I don't know what happened at camp."];
  const list = facts(sim, day);
  if (!list.length) return ["I don't remember that day."];
  const bent = teller.fake && day < teller.since;
  return tell(sim, bent ? bend(sim, list, day, teller) : list, teller);
}
