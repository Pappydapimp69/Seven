// party.js — the five companions: how they walk, what they want, what they say.
// Pure logic; no DOM, no Three. (This module and state.js import each other, but
// only ever dereference each other's bindings inside function bodies, which ESM
// resolves fine — nothing here runs at module-evaluation time.)
//
// The companions ARE the UI. Their meters are invisible, so everything you can
// know about them arrives through behaviour: who breaks formation for a pylon,
// who lags, who starts narrating things that aren't there. Each rule below exists
// to make an internal number legible from the outside without printing it.

import { findPath, worldToCell, cellToWorld, moveWithCollision, isBlockedAt, CELL, GRID } from "./world.js?v=mirage-0.8.0";
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
} from "./state.js?v=mirage-0.8.0";

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

// --- what "gone" looks like from the outside ---------------------------------
// A companion's hallucination is only a tell if the lead can SEE it. The
// original phantom errand sent them at a uniformly-random cell anywhere in the
// basin the instant their meter hit zero, and recorded runs showed the cost:
// the MEDIAN distance from the lead while a companion was hallucinating was
// ~48 units, and only ~10% of all gone-seconds had them both inside legible
// range and on screen. The player's report — "nobody else seemed to
// hallucinate" — was literally true as a perceptual claim: it was happening
// off-screen, over the ridge, every time.
//
// Nothing below makes them easier to recover or less lost. It only puts the
// first part of the episode where it can be witnessed.
const LOST_DWELL = 7; // seconds of standing/turning before they commit to an errand
const LOST_DWELL_DRIFT = 2.6; // how far they'll shuffle during that dwell
const LOST_STALL_MIN = 2.5; // pause on arriving somewhere, before inventing the next place
const LOST_STALL_MAX = 6.0;
const LOST_GOAL_NEAR = 16; // phantom errands stay in the neighbourhood...
const LOST_GOAL_FAR = 42; // ...instead of crossing the whole basin in one leg

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

/**
 * Where a hallucinating companion has decided to go. Confident, and wrong.
 *
 * Three flavours, each one a different way of being wrong in front of you:
 * a real marker for an unreal reason, a spot near the LEAD (they are certain
 * they are the one guiding the party — see GONE_LINES' "I'm not lost. You're
 * lost. Follow me."), or nothing in particular, which is the worst to watch.
 *
 * Every destination is now drawn from the NEIGHBOURHOOD rather than from the
 * whole grid. That is the difference between a mind coming apart where you can
 * see it and one that simply leaves: the old uniform-over-the-basin draw meant
 * the very first leg of every episode was a straight line out of sight.
 */
function phantomGoal(sim, c) {
  const rng = sim.rng;
  const roll = rng.float(0, 1);
  if (roll < 0.34 && sim.monoliths.length) {
    // Nearest markers first, so the leg is short enough to be watched.
    const reachable = sim.monoliths.filter((m) => dist(c, m) <= LOST_GOAL_FAR * 1.6);
    const m = rng.pick(reachable.length ? reachable : sim.monoliths);
    return { x: m.x, z: m.z, label: m.name };
  }
  if (roll < 0.6) {
    // A point beside the lead, snapshotted now — they are walking to where you
    // WERE, with total conviction. Not a follow: they do not re-aim as you move.
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(3, 9);
    return { x: sim.player.x + Math.cos(a) * r, z: sim.player.z + Math.sin(a) * r, label: null };
  }
  const here = worldToCell(c.x, c.z);
  for (let tries = 0; tries < 20; tries++) {
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(LOST_GOAL_NEAR, LOST_GOAL_FAR);
    const cx = Math.round(here.cx + (Math.cos(a) * r) / CELL);
    const cz = Math.round(here.cz + (Math.sin(a) * r) / CELL);
    if (cx < 2 || cz < 2 || cx > GRID - 3 || cz > GRID - 3) continue;
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

    // A companion a human has taken over still SENSES the basin — the memory
    // update above is what lets them keep sighting markers and remembering
    // pylons — but nothing here may steer them. Their movement comes from
    // that player's input in tick(), and notably their hallucination is NOT
    // short-circuited into a phantom errand: a hallucinating human still has
    // the wheel, they are just being lied to about where they are going.
    if (c.humanSlot !== null) continue;

    if (c.hallucinating) {
      // No formation, no orders, no lead. Just the errand they have invented.
      c.goalKind = "hallucinating";
      // The moment they go. state.js sets the flag; this is the first tick of
      // party.js's that sees it, so it is where the episode's own clock starts.
      if (c.lostSince === undefined || c.lostSince === null) {
        c.lostSince = sim.time;
        c.lostStallUntil = 0;
        c.goal = null;
      }

      // The dwell: for the first few seconds they do not go anywhere. They
      // stand roughly where they stopped and turn, which is the whole tell —
      // wrong colour, wrong behaviour, still close enough to be seen. Without
      // it the announcement ("X stops making sense") and the departure land on
      // the same tick and the player is told about something already gone.
      if (sim.time - c.lostSince < LOST_DWELL) {
        c.path = null;
        if (!c.goal) {
          const a = sim.rng.float(0, Math.PI * 2);
          c.goal = { x: c.x + Math.cos(a) * LOST_DWELL_DRIFT, z: c.z + Math.sin(a) * LOST_DWELL_DRIFT, label: null };
        }
        // A drift, not a walk — a quarter pace, so they stay watchable.
        const wasX = c.x, wasZ = c.z;
        stepToward(sim, c, c.goal, LOST_SPEED * 0.25, dt);
        // Once the drift has run out (or they are wedged), they turn on the
        // spot rather than standing frozen: looking at something that isn't
        // there. Applied only when they did NOT move, because stepToward owns
        // `facing` whenever it actually walks them somewhere.
        if (Math.abs(c.x - wasX) < 1e-4 && Math.abs(c.z - wasZ) < 1e-4) {
          c.facing = (c.facing || 0) + dt * (0.55 + c.wander * 0.9);
        }
        continue;
      }

      // Arrived somewhere, and now certain it is the place. They stand at it
      // for a beat before inventing the next one — the pause is what gives the
      // lead a chance to close the distance, and it is what "It's right here.
      // I'm standing at it. Log it." is describing.
      if (c.lostStallUntil > sim.time) {
        c.path = null;
        c.facing = (c.facing || 0) + dt * 0.35;
        continue;
      }
      if (!c.goal || dist(c, c.goal) < 2.2) {
        if (c.goal) {
          c.lostStallUntil = sim.time + sim.rng.float(LOST_STALL_MIN, LOST_STALL_MAX);
          c.goal = null;
          c.path = null;
          continue;
        }
        c.goal = phantomGoal(sim, c);
      }
      stepToward(sim, c, c.goal, LOST_SPEED * (0.7 + c.wander * 0.5), dt);
      continue;
    }
    // Back with us: the episode clock resets so the next one gets its own
    // dwell. Kept here rather than in state.recover() so the whole shape of a
    // gone companion lives in this one module.
    if (c.lostSince !== undefined && c.lostSince !== null) {
      c.lostSince = null;
      c.lostStallUntil = 0;
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

// A gone companion narrates, and that narration is the ONE tell that crosses
// distance and fog — the body colour and the wrong heading both need line of
// sight, this does not. So it is deliberately the loudest channel a
// hallucinating companion has, and it fires on its own cadence below rather
// than through the band formula the lucid pools use.
//
// The pool is sized to that cadence, not to a writing budget: at one line
// every ~5-11s a ~70-second episode spends fourteen-odd lines, so nine of them
// meant the same handful looping inside a single episode. Sixteen plus a
// no-immediate-repeat rule is what the measured rate actually needs.
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
  "Stop shouting. I can hear you fine from here.",
  "Who's that walking with you? No — the other one.",
  "I've done this stretch four times today. Four.",
  "Don't come any closer. You're standing in it.",
  "The light's on the wrong side of the ridge.",
  "I'll wait here. Somebody has to hold the place.",
  "It's easier now. You should try it.",
];

// A gone companion's own line cadence, in seconds. Fast enough that "somebody
// out there is not okay" reaches you across the basin; slow enough to stay
// speech and not a stream.
const GONE_REMARK_MIN = 5;
const GONE_REMARK_MAX = 11;

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
  // Going under cuts straight through whatever silence was left on the clock.
  // Otherwise the announcement that a mind has broken can be followed by up to
  // half a minute of that mind saying nothing, which reads as nothing having
  // happened — and it is the SPOKEN line, not the body, that reaches a lead
  // who is forty metres away in fog. `goneAnnounced` also latches so the
  // shortcut fires once per episode, not once per tick.
  if (c.hallucinating && !c.goneAnnounced) {
    c.goneAnnounced = true;
    c.remarkCooldown = 0;
  } else if (!c.hallucinating) {
    c.goneAnnounced = false;
  }
  c.remarkCooldown -= dt;
  if (c.remarkCooldown > 0) return null;

  const band = bandOf(c.lucidity);
  const chatty = 0.35 + c.chatty * 0.9;
  // Worse state, more talking — except the stoic, who go quiet instead, and that
  // silence is its own signal.
  const urgency = { steady: 0.35, unsettled: 0.7, fraying: 1.1, brittle: 1.5, gone: 1.2 }[band] || 0.5;
  // A gone mind runs on its own clock, not the band formula: temperament stops
  // mattering once you are past the point of choosing what to mention, and the
  // formula's stoic-and-quiet term would otherwise silence exactly the
  // companion the lead most needs to hear.
  c.remarkCooldown = c.hallucinating
    ? sim.rng.float(GONE_REMARK_MIN, GONE_REMARK_MAX)
    : Math.max(3.5, 16 / (chatty * urgency)) * sim.rng.float(0.75, 1.3);

  if (c.hallucinating) {
    // Never the same line twice running. Filtering the pool costs no extra rng
    // draw — `pick` still rolls exactly once, just over a shorter list — which
    // keeps the per-tick draw count stable for seed reproducibility.
    const pool = GONE_LINES.filter((l) => l !== c.lastGoneLine);
    const text = sim.rng.pick(pool);
    c.lastGoneLine = text;
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
