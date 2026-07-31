// party.js — the five companions: how they walk, what they want, what they say.
// Pure logic; no DOM, no Three. (This module and state.js import each other, but
// only ever dereference each other's bindings inside function bodies, which ESM
// resolves fine — nothing here runs at module-evaluation time.)
//
// The companions ARE the UI. Their meters are invisible, so everything you can
// know about them arrives through behaviour: who breaks formation for a pylon,
// who lags, who starts narrating things that aren't there. Each rule below exists
// to make an internal number legible from the outside without printing it.

import { findPath, worldToCell, cellToWorld, moveWithCollision, isBlockedAt, CELL, GRID } from "./world.js";
import {
  BAND,
  bandOf,
  PYLON_RADIUS,
  emit,
  ITEM_PICKUP_RADIUS,
  ITEM_CAP,
  CRAFT_RECIPES,
  recipeKey,
  companionPickup,
  handoffToPlayer,
} from "./state.js";

// Higher band = worse. Lets a per-companion trait move the pylon-seeking
// trigger EARLIER than the uniform BRITTLE tell everyone else gets, without
// needing its own separate band scale.
// Keyed by literal band strings, not `BAND.*` — see the note on `LINES`
// below: a top-level dereference of BAND here hits the circular-import
// temporal dead zone and throws before the game starts.
const BAND_SEVERITY = { steady: 0, unsettled: 1, fraying: 2, brittle: 3, gone: 4 };

/**
 * How early THIS companion breaks off for a known pylon. Everyone still only
 * acts on a band they've actually crossed — selfCare doesn't invent urgency,
 * it just lowers how much urgency they need before they act on it. A low-
 * selfCare companion is not careless; they're only as proactive as the loud,
 * uniform tell every companion already has (BRITTLE).
 */
function seekThresholdBand(c) {
  if (c.selfCare >= 0.66) return BAND.UNSETTLED;
  if (c.selfCare >= 0.33) return BAND.FRAYING;
  return BAND.BRITTLE;
}

const FOLLOW_RADIUS = 4.4; // formation stand-off from the lead
const FOLLOW_SLACK = 2.0; // don't jitter inside this band
const WALK_SPEED = 4.6; // a touch faster than the player's walk, so they can catch up
const LOST_SPEED = 3.1; // a hallucinating companion moves with unhurried certainty
const KNOWN_PYLON_DIST = 24; // how close they must have been to remember a pylon
const SEEK_PYLON_DIST = 70; // and how far they will then travel back to one
const REPATH_INTERVAL = 0.9; // seconds between path recomputes
const SEEK_ITEM_DIST = 55; // how far an idle companion will travel on a fetch errand

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function ensureMemory(c) {
  if (!c.known) c.known = { pylons: new Set(), monoliths: new Set() };
  if (typeof c.remarkCooldown !== "number") c.remarkCooldown = 4 + c.index * 1.7;
  if (typeof c.repathTimer !== "number") c.repathTimer = 0;
}

/** Walk a character toward a world point, pathfinding around spires when needed. */
function stepToward(sim, c, target, speed, dt) {
  const straight = dist(c, target) < 9 && !blockedBetween(sim, c, target);
  if (straight) {
    c.path = null;
  } else {
    c.repathTimer -= dt;
    // `null` means "no path computed yet"; an EMPTY array means "computed, and
    // there was nothing to walk" (already in the goal cell, or no route). Those
    // must not be conflated: treating empty as uncomputed re-ran a full BFS for
    // every companion on every tick, which dominated the whole simulation cost.
    if (c.path === null || c.repathTimer <= 0) {
      const from = worldToCell(c.x, c.z);
      const to = worldToCell(target.x, target.z);
      c.path = findPath(sim.world, from, to) || [];
      c.repathTimer = REPATH_INTERVAL;
    }
  }

  let aim = target;
  if (c.path && c.path.length) {
    const node = c.path[0];
    aim = cellToWorld(node.cx, node.cz);
    if (dist(c, aim) < CELL * 0.6) c.path.shift();
  }

  const dx = aim.x - c.x;
  const dz = aim.z - c.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const move = Math.min(speed * dt, len);
  const next = moveWithCollision(sim.world, c, (dx / len) * move, (dz / len) * move);
  // Stuck against geometry with a stale path: re-derive soon, but NOT this frame.
  // Zeroing the timer here meant a companion wedged against a spire ran a full
  // grid BFS on every single tick, which was ~8× the cost of the entire rest of
  // the simulation. A fifth of a second of patience is invisible in play.
  if (Math.abs(next.x - c.x) < 1e-4 && Math.abs(next.z - c.z) < 1e-4) {
    c.repathTimer = Math.min(c.repathTimer, 0.2);
  }
  c.x = next.x;
  c.z = next.z;
  c.facing = Math.atan2(dx, dz);
}

// Sample a few points along the segment; good enough for "can I just walk there".
function blockedBetween(sim, a, b) {
  const steps = Math.ceil(dist(a, b) / (CELL * 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isBlockedAt(sim.world, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return true;
  }
  return false;
}

/**
 * A loose fan BEHIND the lead, so six bodies don't pile into one point — and so
 * they are not standing in the camera. With forward = (-sinθ, -cosθ), the
 * behind-the-lead direction is (+sinθ, +cosθ), which is what this uses.
 */
function formationSlot(sim, c) {
  const lead = sim.player;
  const yaw = lead.yaw || 0;
  const i = c.index - 1; // 0..4
  const spread = (i - 2) * 0.55; // fan out
  const a = yaw + spread;
  const r = FOLLOW_RADIUS + (i % 2) * 1.3;
  return { x: lead.x + Math.sin(a) * r, z: lead.z + Math.cos(a) * r };
}

function updateMemory(sim, c) {
  for (const p of sim.pylons) if (dist(c, p) <= KNOWN_PYLON_DIST) c.known.pylons.add(p.id);
  for (const m of sim.monoliths) if (dist(c, m) <= 18) c.known.monoliths.add(m.id);
}

function nearestKnownPylon(sim, c) {
  let best = null, bestD = Infinity;
  for (const p of sim.pylons) {
    if (!c.known.pylons.has(p.id) || p.charge <= 0) continue;
    const d = dist(c, p);
    if (d < bestD) { bestD = d; best = p; }
  }
  return bestD <= SEEK_PYLON_DIST ? best : null;
}

/**
 * The nearest discovered, untaken world item that would complete a recipe
 * with something the lead ALREADY has in hand — the "search the world for
 * ingredient drops" half of the errand. Reactive, not a shopping list: nobody
 * decides what to craft ahead of time, a companion just notices that the lead
 * is one item away from something and goes to close the gap. Excludes items
 * another companion is already en route to, so two couriers never race for
 * the same one.
 */
/**
 * Would this item kind complete a recipe with something real the lead is
 * already holding, and is there room to receive it? Shared by the search
 * (findFetchableItem) and the in-progress check (updateCompanions) so an
 * errand that finds a target and an errand that keeps chasing one never
 * disagree about what still counts as "worth it".
 */
function completesSomething(sim, itemKind) {
  if (sim.inventory.length >= ITEM_CAP) return false;
  return sim.inventory.some((s) => s.real && CRAFT_RECIPES[recipeKey(s.kind, itemKind)]);
}

function findFetchableItem(sim, c) {
  const claimed = new Set(sim.companions.filter((o) => o !== c && o.fetchItemId).map((o) => o.fetchItemId));
  let best = null, bestD = Infinity;
  for (const it of sim.items) {
    if (it.taken || !it.discovered || claimed.has(it.id)) continue;
    if (!completesSomething(sim, it.itemKind)) continue;
    const d = dist(c, it);
    if (d < bestD) { bestD = d; best = it; }
  }
  return bestD <= SEEK_ITEM_DIST ? best : null;
}

/** Where a hallucinating companion has decided to go. Confident, and wrong. */
function phantomGoal(sim, c) {
  const rng = sim.rng;
  // Half the time they head for a real place for an unreal reason; the rest of
  // the time they walk at nothing in particular, which is worse to watch.
  if (rng.chance(0.5) && sim.monoliths.length) {
    const m = rng.pick(sim.monoliths);
    return { x: m.x, z: m.z, label: m.name };
  }
  for (let tries = 0; tries < 20; tries++) {
    const cx = rng.int(2, GRID - 3);
    const cz = rng.int(2, GRID - 3);
    if (sim.world.blocked[cz * GRID + cx]) continue;
    return { ...cellToWorld(cx, cz), label: null };
  }
  return { x: c.x, z: c.z, label: null };
}

/** Advance all five companions by `dt`. Called from state.tick. */
export function updateCompanions(sim, dt) {
  for (const c of sim.companions) {
    ensureMemory(c);
    c.aliveTime += dt;
    updateMemory(sim, c);

    if (c.hallucinating) {
      // No formation, no orders, no lead. Just the errand they have invented.
      if (!c.goal || dist(c, c.goal) < 2.2) {
        c.goal = phantomGoal(sim, c);
        c.goalKind = "hallucinating";
      }
      stepToward(sim, c, c.goal, LOST_SPEED * (0.7 + c.wander * 0.5), dt);
      continue;
    }

    // A hallucinating mind still physically holds whatever it was carrying —
    // it just won't reach out and hand it over until lucid again (see the
    // `continue` above): nothing is lost or duplicated by the gap, delivery
    // just resumes the moment this companion is back and close enough.
    if (c.inventory.length && dist(c, sim.player) <= ITEM_PICKUP_RADIUS) {
      handoffToPlayer(sim, c);
    }

    const band = bandOf(c.lucidity);

    // BRITTLE is the loud, uniform tell: everyone breaks formation for a
    // remembered pylon by then, whether or not you were planning to go
    // there. A companion with a high selfCare trait acts on that same signal
    // earlier — UNSETTLED or FRAYING instead of waiting for BRITTLE — which
    // is itself something you can learn to read about THEM specifically.
    if (BAND_SEVERITY[band] >= BAND_SEVERITY[seekThresholdBand(c)]) {
      const p = nearestKnownPylon(sim, c);
      if (p) {
        if (c.goalKind !== "pylon") {
          c.goalKind = "pylon";
          c.path = null;
          emit(sim, "break", `${c.name} breaks off toward a pylon.`, { who: c.id });
        }
        c.goal = { x: p.x, z: p.z };
        stepToward(sim, c, c.goal, WALK_SPEED, dt);
        continue;
      }
    }

    // A companion standing in a pylon stays put until they are topped up — you
    // will have to wait for them, and waiting costs the others their own margin.
    const standing = sim.pylons.find((p) => p.charge > 0 && dist(p, c) <= PYLON_RADIUS);
    if (standing && c.lucidity < 78) {
      c.goalKind = "resting";
      continue;
    }

    // Errand, part one: already chasing something for the lead. Keyed on
    // `fetchItemId` alone, NOT on `goalKind` still reading "fetch" — a pylon
    // break, a rest-in-pylon, or a hallucination episode all overwrite
    // goalKind on top of this, and the errand must survive underneath and
    // resume once that crisis clears, not get permanently stranded (and the
    // item permanently unclaimable by anyone else — see findFetchableItem's
    // `claimed` set) just because something more urgent briefly took over.
    if (c.fetchItemId) {
      const target = sim.items.find((it) => it.id === c.fetchItemId);
      // Also abandon an errand the lead has already outgrown — used the
      // ingredient, crafted it away, or filled the cap some other way — so a
      // companion doesn't keep walking 50+ units for a delivery that no
      // longer completes anything.
      if (!target || target.taken || !completesSomething(sim, target.itemKind)) {
        c.fetchItemId = null; // gone or pointless — reassessed fresh below
      } else {
        c.goalKind = "fetch";
        if (dist(c, target) <= ITEM_PICKUP_RADIUS) {
          companionPickup(sim, c, target.id);
          c.fetchItemId = null;
        } else {
          stepToward(sim, c, target, WALK_SPEED, dt);
          continue;
        }
      }
    }

    // Errand, part two: already carrying something for the lead. Delivering
    // takes priority over ambient formation-following (a full hand only has
    // one job) but never over this companion's own crisis, above.
    if (c.inventory.length) {
      c.goalKind = "deliver";
      stepToward(sim, c, sim.player, WALK_SPEED, dt);
      continue;
    }

    // Errand, part three: nothing to carry yet — is there something out there
    // that would complete a recipe the lead is already halfway to?
    if (!c.fetchItemId) {
      const found = findFetchableItem(sim, c);
      if (found) {
        c.goalKind = "fetch";
        c.fetchItemId = found.id;
        stepToward(sim, c, found, WALK_SPEED, dt);
        continue;
      }
    }

    c.goalKind = "follow";
    const slot = formationSlot(sim, c);
    const d = dist(c, slot);
    if (d > FOLLOW_SLACK) {
      // Fraying companions lag: the gap between them and the lead is the tell.
      const drag = band === BAND.FRAYING ? 0.72 : band === BAND.UNSETTLED ? 0.9 : 1;
      stepToward(sim, c, slot, WALK_SPEED * drag, dt);
    }
  }
}

// ---------------------------------------------------------------------------
// Unprompted chatter. The second sensor. A companion never states their meter,
// but what they choose to mention correlates with it — and once they are gone,
// they narrate a basin that isn't there with complete conviction.
// ---------------------------------------------------------------------------

// Keyed by the literal BAND values rather than by `BAND.*`. state.js and this
// module import each other, so a top-level dereference of `BAND` here would hit
// the temporal dead zone during module evaluation and throw before the game ever
// starts. Inside functions it is safe; in an object literal at load time it is not.
const LINES = {
  steady: [
    "Ground's good here.",
    "Still with you.",
    "Bearing holds.",
    "Nothing to report. Good, for once.",
    "Pace feels right. Keep it.",
    "Quiet out here. The good kind of quiet.",
  ],
  unsettled: [
    "You hear that? …no. Forget it.",
    "Light's odd. Probably the dust.",
    "How long have we been walking?",
    "Did we pass that rock already?",
    "My ears are doing something. It'll pass.",
    "Just tired. That's all this is.",
  ],
  fraying: [
    "The ridge moved. It moved, I watched it.",
    "Say my name. Just — say it.",
    "I don't like how quiet the stones are.",
    "Are we six? Count us. Count us again.",
    "Something's walking the same line we are. Behind the fog.",
    "I keep losing seconds. Small ones. It's fine.",
    "The basin's got a rhythm. I can hear it now.",
  ],
  brittle: [
    "I need a pylon. I need one NOW.",
    "My hands aren't mine.",
    "Don't let me walk off. Promise me.",
    "If I stop talking, that's when to worry.",
    "Get me to the light. Please.",
  ],
};

const GONE_LINES = [
  "It's right here. I'm standing at it. Log it.",
  "The others went ahead. Hours ago. You saw them go.",
  "This pylon's warm. Feel it. Feel it.",
  "North is behind us. It has been the whole time.",
  "They're all saying it. Can't you hear them agreeing?",
  "I found the seventh marker. There's always been seven.",
  "You already logged this one. Don't you remember?",
  "The camp moved closer. It does that, near the end.",
  "I'm not lost. You're lost. Follow me.",
];

// A role-flavored line, mixed in alongside the general band pool so a
// Surveyor sounds like a surveyor even while frayed, not just a generic
// "someone" reading from the same script as everyone else.
const ROLE_LINES = {
  Surveyor: {
    fraying: ["My own bearings don't agree with each other anymore."],
    brittle: ["I can't trust my own readings. That's — that's the job, gone."],
  },
  Medic: {
    fraying: ["Someone's pulse is wrong. I keep checking whose."],
    brittle: ["I can't tell who needs me and who's asking for someone else."],
  },
  Rigger: {
    fraying: ["That knot wasn't there this morning. I tied it. Didn't I?"],
    brittle: ["My hands know the rope better than my head does right now."],
  },
  Signals: {
    fraying: ["I'm picking up chatter. There's no one to send it."],
    brittle: ["Everything sounds like it's coming through water."],
  },
  Geologist: {
    fraying: ["This rock is younger than it was an hour ago."],
    brittle: ["The ground keeps answering before I ask it anything."],
  },
};

/**
 * Maybe have a companion say something. Rate-limited per character and weighted
 * by temperament, so a chatty medic is a better sensor than a stoic surveyor —
 * which is itself a thing the player learns to account for.
 */
export function companionRemark(sim, c, dt) {
  ensureMemory(c);
  c.remarkCooldown -= dt;
  if (c.remarkCooldown > 0) return null;

  const band = bandOf(c.lucidity);
  const chatty = 0.35 + c.chatty * 0.9;
  // Worse state, more talking — except the stoic, who go quiet instead, and that
  // silence is its own signal.
  const urgency = { steady: 0.35, unsettled: 0.7, fraying: 1.1, brittle: 1.5, gone: 1.2 }[band] || 0.5;
  c.remarkCooldown = Math.max(3.5, 16 / (chatty * urgency)) * sim.rng.float(0.75, 1.3);

  if (c.hallucinating) {
    const text = sim.rng.pick(GONE_LINES);
    emit(sim, "chatter", `${c.name}: ${text}`, { who: c.id, gone: true });
    return text;
  }
  if (band === BAND.STEADY && sim.rng.chance(0.6)) return null; // healthy people don't narrate
  if (c.stoic > 0.7 && (band === BAND.FRAYING || band === BAND.UNSETTLED) && sim.rng.chance(0.55)) return null;

  // A third of the time, reach for a line specific to this companion's role
  // instead of the shared pool — when that band even has one for them.
  const roleLines = ROLE_LINES[c.role]?.[band];
  const pool = roleLines && sim.rng.chance(1 / 3) ? roleLines : LINES[band] || LINES[BAND.STEADY];
  const text = sim.rng.pick(pool);
  emit(sim, "chatter", `${c.name}: ${text}`, { who: c.id });
  return text;
}
