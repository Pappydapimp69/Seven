// save.js — a run to JSON and back. The world is NOT saved: it is regenerated
// from the seed and the changes replayed onto it (trees felled, deadfalls cut,
// pylons). The rng resumes from its state word. Restored values are checked
// (Brain mirage#E8: a round trip agreeing with itself is not proof); a body
// standing in a wall is moved to the nearest open cell.

import { createRng } from "./rng.js?v=seven-1.11.0";
import { createWorld, clearDeadfall, fellTree, walkable } from "./world.js?v=seven-1.11.0";
import { nearestWalkable } from "./body.js?v=seven-1.11.0";
import { attach } from "./sim.js?v=seven-1.11.0";

export const SAVE_VERSION = 1;
export const SAVE_KEY = "seven:run";

const STRIP = new Set([]);   // a walker's path is save state: it decides where they step next
const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (STRIP.has(k) ? undefined : v === Infinity ? "Infinity" : v)));

export function serialize(sim) {
  const w = sim.world;
  return {
    version: SAVE_VERSION, seed: sim.seed, rng: sim.rng.state, ticks: sim.ticks, day: sim.day,
    status: sim.status, ending: sim.ending,
    lead: clean(sim.lead), mates: clean(sim.mates), roster: clean(sim.roster),
    camp: clean(sim.camp), piles: clean(sim.piles), pileSeq: sim.pileSeq,
    missing: sim.missing ? clean(sim.missing) : null, lost: clean(sim.lost),
    chronicle: clean(sim.chronicle),
    dawnDone: sim.dawnDone, duskDone: sim.duskDone, duskSeen: sim.duskSeen,
    exposure: clean(sim.exposure), nightHours: sim.nightHours,
    pending: sim.pending, twin: sim.twin, home: sim.home ? clean(sim.home) : null, exitLeft: sim.exitLeft,
    keystone: sim.keystone ? clean(sim.keystone) : null,   // gates the keystone draws: save state
    world: {
      deadfalls: w.deadfalls.map((d) => ({ progress: d.progress, cleared: d.cleared })),
      felled: w.trees.filter((t) => t.felled).map((t) => t.id),
      pylons: w.pylons.map((p) => ({ state: p.state, litAt: p.litAt })),
    },
  };
}

export function deserialize(data) {
  if (!data || data.version !== SAVE_VERSION || !Number.isFinite(data.seed)) return null;
  const world = createWorld(data.seed);
  data.world.deadfalls.forEach((s, i) => { const d = world.deadfalls[i]; if (!d) return; d.progress = s.progress; if (s.cleared) clearDeadfall(world, d); });
  for (const id of data.world.felled) { const t = world.trees.find((x) => x.id === id); if (t) fellTree(world, t); }
  data.world.pylons.forEach((s, i) => { const p = world.pylons[i]; if (p) { p.state = s.state; p.litAt = s.litAt; } });
  const rng = createRng(data.seed); rng.state = data.rng;
  const unInf = (o) => JSON.parse(JSON.stringify(o), (k, v) => (v === "Infinity" ? Infinity : v));
  const sim = {
    v: 1, seed: data.seed, rng, world, ticks: data.ticks, day: data.day, status: data.status, ending: data.ending,
    lead: unInf(data.lead), mates: data.mates, roster: data.roster, camp: data.camp, piles: data.piles, pileSeq: data.pileSeq,
    missing: data.missing, lost: data.lost, chronicle: data.chronicle,
    dawnDone: data.dawnDone, duskDone: data.duskDone, duskSeen: data.duskSeen,
    exposure: data.exposure || {}, nightHours: data.nightHours || 0,
    pending: data.pending, twin: data.twin, home: data.home, exitLeft: data.exitLeft, keystone: data.keystone || null,
    msgs: [], saveDue: false,
  };
  // A path is cells {cx, cy}; one that does not resolve to open ground is dropped (re-planned).
  const okCell = (c) => c && Number.isInteger(c.cx) && Number.isInteger(c.cy) && walkable(world, c.cx, c.cy);
  for (const b of [...sim.mates, ...(sim.missing ? [sim.missing] : [])]) {
    if (b.path !== undefined && b.path !== null && !(Array.isArray(b.path) && b.path.every(okCell))) { b.path = null; b.goal = null; }
    if (b.goal && !(Number.isInteger(b.goal.cx) && Number.isInteger(b.goal.cy))) b.goal = null;
  }
  // Check what came back: every body on open ground, every number finite.
  const bodies = [sim.lead, ...sim.mates, ...(sim.missing ? [sim.missing] : [])];
  for (const b of bodies) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.lucidity)) return null;
    if (!walkable(world, Math.floor(b.x), Math.floor(b.y))) { const c = nearestWalkable(world, b.x, b.y); b.x = c.cx + 0.5; b.y = c.cy + 0.5; }
  }
  attach(sim);
  return sim;
}

export function saveTo(storage, sim) {
  try { storage.setItem(SAVE_KEY, JSON.stringify(serialize(sim))); return true; } catch { return false; }
}
export function loadFrom(storage) {
  try { const raw = storage.getItem(SAVE_KEY); return raw ? deserialize(JSON.parse(raw)) : null; } catch { return null; }
}
export function clearSave(storage) { try { storage.removeItem(SAVE_KEY); } catch { /* private mode */ } }
