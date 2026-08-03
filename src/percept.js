// percept.js — the only module in MIRAGE that is allowed to lie.
//
// state.js keeps an honest record of the basin. This file answers a different
// question: what does the LEAD believe is in front of them right now? While the
// player is lucid the two agree exactly. Once the player's meter hits zero, the
// perceived world diverges from the real one — and because the renderer and HUD
// draw from HERE and never from the sim directly, the screen itself becomes an
// unreliable narrator.
//
// Keeping the deceit in one pure module is what makes it testable: a test can
// assert "a hallucinating lead is shown a marker the sim does not contain"
// without booting a browser.

import { HALLUCINATION, BAND, bandOf, ITEM_INFO } from "./state.js";
import { ITEM_KINDS } from "./world.js";

const PHANTOM_NAMES = ["the Sixth Stone", "the Watching Slab", "the Other Cairn", "the Hollow Tooth"];
const PHANTOM_COMPANIONS = ["ODEN", "MARIS", "THE SEVENTH"];

/**
 * `eye` is the character this perception belongs to — the mind whose senses
 * these are. It defaults to null and is resolved to `sim.player` lazily by
 * eyeOf() below, so every existing single-player caller keeps working
 * unchanged. Couch co-op passes a real character: a second human is a
 * possessed companion with their OWN lucidity meter, so they hallucinate
 * independently, and the whole point of the mode is that two players are
 * shown different worlds and have to talk about it.
 */
export function createPercept(eye = null) {
  return {
    eye,
    active: false, // is this percept's OWN mind hallucinating
    kind: null,
    since: 0,
    intensity: 0, // 0..1, ramps in and out so the shift is felt, not flicked
    phantomMonoliths: [],
    phantomCompanions: [],
    phantomPylons: [],
    deadPylonsLookLive: new Set(),
    compassOffset: 0,
    swayPhase: 0,
    whisper: null,
    // World-item misidentification, keyed by the item's own id so it stays
    // stable for as long as this hallucination episode lasts (cleared on
    // recovery, same lifetime as the other phantom* fields).
    itemLabels: new Map(),
    // Camera-turn tracking for shiftOneUnseenPhantom: the eye's own yaw last
    // tick (null until the first tick has run) and radians turned since the
    // last drift check.
    lastYaw: null,
    turnAccum: 0,
    // Which real companion (if any) is currently showing as a monster, and
    // when that flicker ends. See updateMonsterFlicker.
    monsterId: null,
    monsterUntil: 0,
  };
}

/**
 * The mind a percept belongs to. Falls back to `sim.player` when no eye was
 * given, which is what keeps every single-player call site (and the whole
 * existing test suite) working without passing an eye through.
 */
function eyeOf(percept, sim) {
  return percept.eye || sim.player;
}

/**
 * Should the world currently be shown straight, regardless of the underlying
 * hallucinating flag? A Lens buys a temporary truth window WITHOUT curing
 * anything — the meter and `hallucinating` stay exactly as they are, only the
 * SCREEN stops lying for a while. Kept separate from `percept.active` itself so
 * the onset/offset edge-detection in updatePercept still tracks the real
 * mechanical state, not the temporary reprieve.
 */
export function isClear(percept, sim) {
  return sim.time < (eyeOf(percept, sim).lensUntil || 0);
}

// Build the specific lie once, at onset, so it is stable while it lasts. A
// hallucination that re-randomises every frame reads as a graphics bug; one that
// holds still reads as a place.
function seedHallucination(percept, sim) {
  const rng = sim.rng;
  const self = eyeOf(percept, sim); // phantoms are placed around THIS mind, not always the lead
  percept.phantomMonoliths = [];
  percept.phantomCompanions = [];
  percept.phantomPylons = [];
  percept.deadPylonsLookLive = new Set();
  percept.compassOffset = 0;

  switch (percept.kind) {
    case HALLUCINATION.PHANTOM_MARKER: {
      // One or two monoliths that do not exist, placed just off the lead's path
      // so they are found the way a real one would be.
      const n = rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(14, 30);
        percept.phantomMonoliths.push({
          id: `ph-m${i}`,
          name: rng.pick(PHANTOM_NAMES),
          x: self.x + Math.cos(a) * r,
          z: self.z + Math.sin(a) * r,
          phantom: true,
        });
      }
      break;
    }
    case HALLUCINATION.DOUBLED_PARTY: {
      // A companion you do not have, walking the formation slot nobody filled.
      percept.phantomCompanions.push({
        id: "ph-c0",
        name: rng.pick(PHANTOM_COMPANIONS),
        role: "—",
        x: self.x - 3,
        z: self.z - 3,
        phantom: true,
        slot: rng.float(0, Math.PI * 2),
      });
      break;
    }
    case HALLUCINATION.FALSE_ANCHOR: {
      // A pylon that isn't, and every spent pylon reading as full. This one is
      // cruel: relief is exactly what you are looking for by the time it lands.
      const a = rng.float(0, Math.PI * 2);
      percept.phantomPylons.push({
        id: "ph-p0",
        x: self.x + Math.cos(a) * rng.float(12, 24),
        z: self.z + Math.sin(a) * rng.float(12, 24),
        phantom: true,
        charge: 100,
      });
      for (const p of sim.pylons) if (p.charge <= 0) percept.deadPylonsLookLive.add(p.id);
      break;
    }
    case HALLUCINATION.WRONG_WAY:
      percept.compassOffset = rng.pick([-1, 1]) * rng.float(1.1, 2.4); // radians
      break;
    case HALLUCINATION.CHORUS:
      percept.whisper = "agreement";
      break;
    default:
      break;
  }
}

/**
 * Signed angle from `b` to `a`, wrapped to (-π, π]. The building block for
 * "is this bearing currently on screen."
 */
function angularDelta(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Is a point at world-space offset (dx, dz) within `halfAngle` of dead-centre
 * for a head facing `yaw`? Three's camera looks down -Z, so after a yaw
 * rotation θ the forward basis is (-sinθ, -cosθ) (same derivation main.js's
 * own movement-rotation comment uses) — inverted here to recover the bearing
 * a target sits at, then compared against facing.
 */
function inView(yaw, dx, dz, halfAngle) {
  if (dx === 0 && dz === 0) return true;
  const bearing = Math.atan2(-dx, -dz);
  return Math.abs(angularDelta(bearing, yaw)) <= halfAngle;
}

// A camera turn of this many radians (~63°) between checks is what lets one
// unseen phantom drift — see the comment at the call site below for why this
// is gated on TURNING rather than on elapsed time.
const TURN_SHIFT_ANGLE = 1.1;
// Generous vs. the renderer's actual 72° FOV (half = 0.63 rad): near-peripheral
// counts as "seen" too, so nothing visibly pops right at the screen edge.
const VIEW_HALF_ANGLE = 0.85;

/**
 * Nudge ONE currently-unwatched phantom monolith/pylon to a new nearby spot.
 * Never touches anything on screen right now, and never touches sim truth —
 * only percept's own phantom lists. A hallucination that holds still reads as
 * a place (seedHallucination's own rule); this is the exception that proves
 * it: a place can still be wrong about what's behind you.
 */
function shiftOneUnseenPhantom(percept, sim, p) {
  const candidates = [];
  for (const m of percept.phantomMonoliths) if (!inView(p.yaw, m.x - p.x, m.z - p.z, VIEW_HALF_ANGLE)) candidates.push(m);
  for (const ph of percept.phantomPylons) if (!inView(p.yaw, ph.x - p.x, ph.z - p.z, VIEW_HALF_ANGLE)) candidates.push(ph);
  if (!candidates.length) return;
  const rng = sim.rng;
  const target = rng.pick(candidates);
  const a = rng.float(0, Math.PI * 2);
  const r = rng.float(12, 28);
  target.x = p.x + Math.cos(a) * r;
  target.z = p.z + Math.sin(a) * r;
}

// A monster-flicker attempt is rolled at most this often per second of
// hallucinating — rare enough to be "at times," not a constant flicker.
const MONSTER_CHANCE_PER_SEC = 0.07;
const MONSTER_SIGHT = 20; // only a companion actually nearby can wear it
const MONSTER_MIN_DUR = 0.35;
const MONSTER_MAX_DUR = 0.85;

/**
 * Briefly make ONE nearby real companion read as a monster instead of
 * themselves — the same kind of lie perceivedWorldItems already tells about a
 * carried item's kind, aimed at a person instead: the position and behaviour
 * underneath are entirely real, only the shown identity is wrong for a beat.
 */
function updateMonsterFlicker(percept, sim, p, dt, lying) {
  if (!lying) { percept.monsterId = null; return; }
  if (percept.monsterId !== null && sim.time < percept.monsterUntil) return; // mid-flicker, hold
  percept.monsterId = null; // any prior flicker has ended
  if (!sim.rng.chance(MONSTER_CHANCE_PER_SEC * dt)) return;
  const near = sim.companions.filter((c) => Math.hypot(c.x - p.x, c.z - p.z) <= MONSTER_SIGHT);
  if (!near.length) return;
  percept.monsterId = sim.rng.pick(near).id;
  percept.monsterUntil = sim.time + sim.rng.float(MONSTER_MIN_DUR, MONSTER_MAX_DUR);
}

/** Advance the perceived world. Call once per tick, after state.tick. */
export function updatePercept(percept, sim, dt) {
  const p = eyeOf(percept, sim);
  // Set only on the tick a hallucination begins — the same beat
  // seedHallucination gets to place its phantoms before anything else reacts
  // to them. The monster flicker gets one tick's grace too: it must not fire
  // on the very frame the screen starts lying.
  let justOnset = false;
  if (p.hallucinating && !percept.active) {
    percept.active = true;
    justOnset = true;
    percept.kind = p.hallucination;
    percept.since = sim.time;
    seedHallucination(percept, sim);
  } else if (!p.hallucinating && percept.active) {
    percept.active = false;
    percept.kind = null;
    percept.whisper = null;
    percept.itemLabels.clear();
    percept.monsterId = null;
  }
  // Computed AFTER the transition above, not before: on the exact tick
  // recovery happens, `percept.active` just flipped false, and the turn/
  // monster logic below must see that immediately rather than re-arming
  // off a stale "was still hallucinating a moment ago" read.
  const lying = percept.active && !isClear(percept, sim);

  const target = percept.active ? 1 : 0;
  // Ramp in over ~2.5s, out over ~1.2s.
  const rate = target > percept.intensity ? 0.4 : 0.85;
  percept.intensity += Math.sign(target - percept.intensity) * Math.min(Math.abs(target - percept.intensity), rate * dt);
  percept.swayPhase += dt * (0.6 + percept.intensity * 1.8);

  // Turning the camera is what takes a phantom OUT of view in the first
  // place, so gating drift on ACCUMULATED TURN — not elapsed time — ties the
  // environment changing directly to the player's own action: sweep your
  // view around and the half of the world you just left may not be where you
  // left it. Whatever is on screen right now never moves.
  if (percept.lastYaw !== null && lying) percept.turnAccum += Math.abs(angularDelta(p.yaw, percept.lastYaw));
  percept.lastYaw = p.yaw;
  if (!lying) percept.turnAccum = 0;
  while (lying && percept.turnAccum >= TURN_SHIFT_ANGLE) {
    percept.turnAccum -= TURN_SHIFT_ANGLE;
    shiftOneUnseenPhantom(percept, sim, p);
  }

  updateMonsterFlicker(percept, sim, p, dt, lying && !justOnset);

  // A doubled companion keeps station like a real one, which is why it works.
  for (const ph of percept.phantomCompanions) {
    ph.slot += dt * 0.15;
    const tx = p.x + Math.sin(ph.slot) * 5.2;
    const tz = p.z + Math.cos(ph.slot) * 5.2;
    ph.x += (tx - ph.x) * Math.min(1, dt * 1.4);
    ph.z += (tz - ph.z) * Math.min(1, dt * 1.4);
  }
  return percept;
}

/**
 * How badly the presentation should be distorted, 0..1. Drives fog colour, camera
 * sway, and the audio bed. Below zero-lucidity there is a small pre-echo so the
 * lead gets *some* warning about themselves — the player's own tells. A Lens
 * window overrides all of this back to zero: the screen goes honest, full stop.
 */
export function distortion(percept, sim) {
  if (isClear(percept, sim)) return 0;
  const l = eyeOf(percept, sim).lucidity;
  const pre = l <= 0 ? 0 : l < 14 ? 0.3 : l < 36 ? 0.15 : l < 62 ? 0.05 : 0;
  return Math.max(pre, percept.intensity);
}

/** Markers as the lead sees them: the real ones, plus any that aren't. */
export function perceivedMonoliths(percept, sim) {
  const real = sim.monoliths.map((m) => ({ ...m, phantom: false }));
  const lying = percept.active && !isClear(percept, sim);
  return lying ? [...real, ...percept.phantomMonoliths] : real;
}

/** Pylons as the lead sees them — including spent ones reading as charged. */
export function perceivedPylons(percept, sim) {
  const lying = percept.active && !isClear(percept, sim);
  const real = sim.pylons.map((p) => ({
    ...p,
    phantom: false,
    looksLive: p.charge > 0 || (lying && percept.deadPylonsLookLive.has(p.id)),
  }));
  return lying ? [...real, ...percept.phantomPylons.map((p) => ({ ...p, looksLive: true }))] : real;
}

/** Companions as the lead sees them, phantoms included. */
export function perceivedCompanions(percept, sim) {
  const lying = percept.active && !isClear(percept, sim);
  const real = sim.companions.map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    x: c.x,
    z: c.z,
    hallucinating: c.hallucinating,
    goalKind: c.goalKind,
    phantom: false,
    // A brief lie about WHO this is, never about where they are or what
    // they're doing — see updateMonsterFlicker. Only ever true for a real
    // companion; a phantom is already fully fake and gains nothing from it.
    monstrous: lying && c.id === percept.monsterId,
  }));
  return lying ? [...real, ...percept.phantomCompanions] : real;
}

/** The heading the lead thinks they are facing. */
export function perceivedYaw(percept, sim) {
  const lying = percept.active && !isClear(percept, sim);
  return eyeOf(percept, sim).yaw + (lying ? percept.compassOffset : 0);
}

/**
 * World items as the lead sees them. Never a phantom OBJECT — a fake pickup is
 * resolved at pickup time (see state.js pickupItem), not rendered as a fake
 * thing sitting in the world — but a REAL item's displayed kind can still be
 * wrong: assigned once per item id per hallucination episode (lazy, so it
 * settles the moment it's first seen rather than reassigning every frame) and
 * cleared on recovery. Drawn from the full kind list, truth included — a
 * hallucinating lead is lied to about MOST things, not everything; sometimes
 * what you see is exactly what is there, and you have no way to tell which.
 */
export function perceivedWorldItems(percept, sim) {
  const lying = percept.active && !isClear(percept, sim);
  return sim.items
    .filter((it) => it.discovered && !it.taken)
    .map((it) => {
      if (!lying) return { ...it, shownKind: it.itemKind, misidentified: false };
      if (!percept.itemLabels.has(it.id)) percept.itemLabels.set(it.id, sim.rng.pick(ITEM_KINDS));
      const shownKind = percept.itemLabels.get(it.id);
      return { ...it, shownKind, misidentified: shownKind !== it.itemKind };
    });
}

/**
 * Carried items as the lead sees them. A phantom slot's claimed kind is baked
 * in permanently at pickup time (state.js) and always shown as-is — that
 * deception already happened and does not un-happen on recovery. A REAL slot
 * gets the same live per-episode mislabeling as a world item, keyed by the
 * slot's own id, drawn from every displayable kind INCLUDING its own true
 * one — a hallucinating lead usually sees the wrong item, but not always, and
 * has no way to tell which case they're in until they use it (see state.js
 * useItem and main.js's reveal-on-use check).
 */
export function perceivedInventory(percept, sim) {
  const lying = percept.active && !isClear(percept, sim);
  return sim.inventory.map((slot, index) => {
    if (!slot.real) {
      return { index, real: false, shownKind: slot.claimedKind, label: ITEM_INFO[slot.claimedKind].label, misidentified: false };
    }
    if (!lying) return { index, real: true, shownKind: slot.kind, label: ITEM_INFO[slot.kind].label, misidentified: false };
    if (!percept.itemLabels.has(slot.id)) {
      // Crafted kinds included — a hallucinating lead can believe they're
      // holding an Ember they never crafted. World items stay restricted to
      // ITEM_KINDS (see perceivedWorldItems): a crafted item has no ground
      // mesh to mistake it for, so that lie only makes sense once something
      // is already in hand.
      percept.itemLabels.set(slot.id, sim.rng.pick(Object.keys(ITEM_INFO)));
    }
    const shownKind = percept.itemLabels.get(slot.id);
    return { index, real: true, shownKind, label: ITEM_INFO[shownKind].label, misidentified: shownKind !== slot.kind };
  });
}

/**
 * Filter a check-in through the LISTENER's state. The speaker already shaded it
 * in state.checkIn; this is the second filter, and the reason a report is never
 * evidence on its own.
 */
export function filterReport(percept, sim, report) {
  if (!report) return null;
  if (!percept.active) return report;
  const rng = sim.rng;
  if (percept.kind === HALLUCINATION.CHORUS) {
    // Everyone agrees with you. Everyone is fine. Nothing needs doing.
    return { ...report, claim: BAND.STEADY, text: "…fine. We're all fine. Keep going.", filtered: true };
  }
  if (rng.chance(0.6)) {
    const bands = [BAND.STEADY, BAND.UNSETTLED, BAND.FRAYING, BAND.BRITTLE];
    return { ...report, claim: rng.pick(bands), text: garble(report.text, rng), filtered: true };
  }
  return { ...report, filtered: true };
}

function garble(text, rng) {
  const words = text.split(" ");
  if (words.length < 3) return text;
  const i = rng.int(0, words.length - 2);
  return words.slice(0, i).concat(["—"], words.slice(i + 1)).join(" ");
}

/**
 * What the roster should show for a companion. Deliberately NOT a number: a
 * qualitative read the lead has formed from behaviour, degraded by the lead's
 * own state. The literal `lucidity` value never reaches the HUD.
 */
export function rosterRead(percept, sim, companion) {
  // "unknown" rather than a literal "?" so it is a usable CSS class and a
  // greppable value; the player-facing text is the note.
  if (percept.active) return { tag: "unknown", note: "you can't tell", uncertain: true };
  const band = bandOf(companion.lucidity);
  const self = eyeOf(percept, sim);
  const lagging = Math.hypot(companion.x - self.x, companion.z - self.z) > 9;
  if (companion.hallucinating) return { tag: "gone", note: "not with us", uncertain: false };
  if (companion.goalKind === "pylon") return { tag: "breaking off", note: "heading for a pylon", uncertain: false };
  if (band === BAND.BRITTLE) return { tag: "bad", note: "shaking", uncertain: false };
  if (lagging) return { tag: "lagging", note: "falling behind", uncertain: false };
  // Below BRITTLE and lagging deliberately: an errand is a benign read and
  // must never bury the one tell that means "this mind is about to go" — a
  // brittle companion who happens to be mid-fetch (no known pylon to break
  // for) still needs to show as brittle, not as "off running an errand".
  if (companion.goalKind === "fetch") return { tag: "fetching", note: "gone to fetch something", uncertain: false };
  if (companion.goalKind === "deliver") return { tag: "fetching", note: "bringing something back", uncertain: false };
  // A Tether's effect is otherwise invisible math (a reduced drain rate) — this
  // is the one place it becomes something the lead can actually see, and only
  // when nothing more urgent (brittle, lagging) is already competing for the
  // same line.
  if (companion.steadyUntil > sim.time) return { tag: "steadied", note: "steadier, for now", uncertain: false };
  if (band === BAND.FRAYING) return { tag: "off", note: "talking to the ridge", uncertain: false };
  if (band === BAND.UNSETTLED) return { tag: "quiet", note: "quieter than usual", uncertain: false };
  return { tag: "ok", note: "steady", uncertain: false };
}
