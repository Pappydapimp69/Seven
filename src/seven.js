import { moveWithCollision, cellToWorld } from "./world.js?v=seven-0.37.0";
import { areaOfRow } from "./trail.js?v=seven-0.37.0";
// seven.js — Seven-specific campaign rules that do not need DOM or Three.

export const TEAM_LOADOUTS = Object.freeze({
  trail: {
    id: "trail",
    label: "Trail",
    brief: "Scouts and cutters. Faster progress through rough ground.",
    skills: {
      c1: { scout: 3, cut: 0, mend: 0, signal: 1, carry: 0 },
      c2: { scout: 0, cut: 0, mend: 2, signal: 0, carry: 1 },
      c3: { scout: 0, cut: 3, mend: 0, signal: 0, carry: 1 },
      c4: { scout: 1, cut: 0, mend: 0, signal: 2, carry: 0 },
      c5: { scout: 2, cut: 0, mend: 0, signal: 0, carry: 1 },
    },
  },
  recovery: {
    id: "recovery",
    label: "Recovery",
    brief: "Medics and signalers. Better odds when somebody disappears.",
    skills: {
      c1: { scout: 1, cut: 0, mend: 0, signal: 1, carry: 0 },
      c2: { scout: 0, cut: 0, mend: 3, signal: 1, carry: 1 },
      c3: { scout: 0, cut: 2, mend: 0, signal: 0, carry: 1 },
      c4: { scout: 1, cut: 0, mend: 1, signal: 3, carry: 0 },
      c5: { scout: 1, cut: 0, mend: 0, signal: 0, carry: 2 },
    },
  },
  haul: {
    id: "haul",
    label: "Haul",
    brief: "Carriers and builders. Supplies cost less daylight.",
    skills: {
      c1: { scout: 1, cut: 0, mend: 0, signal: 1, carry: 1 },
      c2: { scout: 0, cut: 0, mend: 2, signal: 0, carry: 2 },
      c3: { scout: 0, cut: 2, mend: 0, signal: 0, carry: 2 },
      c4: { scout: 1, cut: 0, mend: 0, signal: 2, carry: 1 },
      c5: { scout: 0, cut: 0, mend: 0, signal: 0, carry: 4 },
    },
  },
});

export const DEFAULT_TEAM = "trail";

export function teamLoadout(id = DEFAULT_TEAM) {
  return TEAM_LOADOUTS[id] || TEAM_LOADOUTS[DEFAULT_TEAM];
}

export function applyTeamLoadout(sim, id = DEFAULT_TEAM, { overwrite = false } = {}) {
  const loadout = teamLoadout(id);
  if (!sim) return loadout;
  sim.sevenTeam = loadout.id;
  for (const c of sim.companions || []) {
    if (overwrite || !c.skills) c.skills = { ...(loadout.skills[c.id] || {}) };
  }
  return loadout;
}

export function teamSkill(sim, key) {
  return (sim?.companions || []).reduce((sum, c) => sum + (c.skills?.[key] || 0), 0);
}

export function expeditionSummary(expedition) {
  const missing = expedition?.missing || [];
  return {
    missing: missing.length,
    recovered: missing.filter((m) => m.recovered).length,
    abandoned: missing.filter((m) => m.abandoned).length,
    unresolved: missing.filter((m) => !m.recovered && !m.abandoned).length,
  };
}

export function finalCount(expedition, bodies = 6) {
  const summary = expeditionSummary(expedition);
  const notRealHere = summary.unresolved + summary.abandoned;
  const real = Math.max(1, bodies - notRealHere);
  return {
    bodies,
    real,
    falseOrLost: Math.max(0, bodies - real),
    pylons: real + 1,
  };
}

export function finalDecision(sim, choice) {
  const summary = expeditionSummary(sim?.expedition);
  if (!sim || !sim.expedition) return null;
  const count = finalCount(sim.expedition, sim.party?.length || 6);
  const unresolved = summary.unresolved;
  const abandoned = summary.abandoned;
  if (choice === "return") {
    sim.status = "lost";
    sim.ending = unresolved || abandoned ? "turnedBack" : "vanishedBack";
  } else if (choice === "seal") {
    sim.status = "won";
    sim.ending = unresolved || abandoned ? "sealedWoods" : "sealedClean";
  } else {
    sim.status = "won";
    sim.ending = unresolved || abandoned ? "leftSomeone" : "throughWoods";
  }
  sim.finalDecision = { choice, ...summary, finalCount: count };
  return sim.finalDecision;
}

/**
 * WHO WAS THERE. The history a fake has to lie about is made of true facts about
 * who did what and who was standing near, so these read real positions (never
 * what anyone believes) and return ids: "you" for the lead, c1.. for the rest.
 */
export function nearbyIds(sim, actorId, radius) {
  const at = actorId === "you" || !actorId ? sim.player : sim.companions.find((c) => c.id === actorId);
  if (!at) return [];
  const out = [];
  for (const c of sim.companions) {
    if (c.id !== actorId && Math.hypot(c.x - at.x, c.z - at.z) <= radius) out.push(c.id);
  }
  if (actorId !== "you" && actorId && Math.hypot(sim.player.x - at.x, sim.player.z - at.z) <= radius) out.push("you");
  return out;
}

/** Companions standing at camp: the ones who stayed. */
export function campIds(sim, radius) {
  const camp = sim.camp ? (sim.camp.built ? sim.camp : null) : sim.world.camp;
  if (!camp) return [];
  return sim.companions.filter((c) => Math.hypot(c.x - camp.x, c.z - camp.z) <= radius).map((c) => c.id);
}

/**
 * DAYLIGHT FOR CAMP WORK. The day is 12 hours and the currency that prices the
 * route (a deadfall is 2.5, a pylon 0.25, a question 1). A fire is camp work:
 * lighting one is dearer than keeping one. Feeding is charged whether or not
 * there is a real fire to feed, for the same reason it spends wood either way —
 * a charge that only landed on a real fire would be a readout.
 */
export const FIRE_DAYLIGHT = Object.freeze({ build: 0.75, feed: 0.25 });

/**
 * Can the lead choose to end the day here? Camp is the only safe place to
 * sleep, and "at camp" is a fact of position — the same answer for a lucid
 * mind and a hallucinating one — so a refusal tells nobody anything.
 */
export function restCheck(sim, campRadius) {
  const e = sim.expedition;
  if (!e || e.phase !== "day" || sim.status !== "playing") return { ok: false, reason: "no-day" };
  if (e.sleeping) return { ok: false, reason: "asleep" };
  // Sleep anywhere (blueprint 0.35): away from camp there is no fire's shield,
  // and the night costs what the night costs. `atCamp` is for the caller.
  const camp = sim.camp || sim.world.camp;
  const atCamp = Math.hypot(sim.player.x - camp.x, sim.player.z - camp.z) <= campRadius;
  return { ok: true, atCamp };
}

/**
 * TRAINING. Points are spent on one person's skill at a time, up to SKILL_MAX.
 * A replacement keeps the same skill surface as the person they replaced (they
 * are the same object with the same skills), so spending points can never make
 * a fake detectable by a stopwatch.
 */
export const SKILLS = Object.freeze(["scout", "cut", "carry", "mend", "signal"]);
export const SKILL_MAX = 5;

export function raiseSkill(sim, companionId, skill) {
  const e = sim?.expedition;
  if (!e) return { ok: false, reason: "no-expedition" };
  if (!SKILLS.includes(skill)) return { ok: false, reason: "no-skill" };
  const c = (sim.companions || []).find((x) => x.id === companionId);
  if (!c) return { ok: false, reason: "no-person" };
  if (!(e.skillPoints > 0)) return { ok: false, reason: "no-points" };
  const level = c.skills?.[skill] || 0;
  if (level >= SKILL_MAX) return { ok: false, reason: "maxed" };
  c.skills = { ...(c.skills || {}), [skill]: level + 1 };
  e.skillPoints -= 1;
  return { ok: true, level: level + 1, left: e.skillPoints };
}

/**
 * THE CAMP (blueprint 0.35). One at a time. It must be taken down before it can
 * be made again somewhere else; between the two there is no fire, no pile and
 * no shield. Taking it down puts the fire out and the pile on your backs.
 */
export function createCamp(at) {
  return { x: at.x, z: at.z, pile: 0, built: true };
}
/** Carried wood goes onto the pile when the lead walks into a built camp. Returns how much. */
export function depositWood(sim, radius) {
  const c = sim.camp;
  if (!c || !c.built || !(sim.wood > 0)) return 0;
  if (Math.hypot(sim.player.x - c.x, sim.player.z - c.z) > radius) return 0;
  const n = sim.wood;
  c.pile = (c.pile || 0) + n;
  sim.wood = 0;
  return n;
}
export function dismantleCamp(sim, radius) {
  const c = sim.camp;
  if (!c || !c.built) return { ok: false, reason: "no-camp" };
  if (Math.hypot(sim.player.x - c.x, sim.player.z - c.z) > radius) return { ok: false, reason: "away" };
  sim.wood = (sim.wood || 0) + (c.pile || 0);
  c.pile = 0;
  c.built = false;
  sim.fire = null;
  return { ok: true };
}
export function makeCamp(sim) {
  const c = sim.camp;
  if (c && c.built) return { ok: false, reason: "already" };
  sim.camp = createCamp(sim.player);
  return { ok: true };
}

// ---- the missing, out in the woods (blueprint 0.35, Brain disappearance) ---
export const DIRS8 = Object.freeze(["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]);
/** Eight directions — what can actually be heard (Brain: size the tell to the ear). North is -z. */
export function bearingWord(from, to) {
  const a = Math.atan2(to.x - from.x, -(to.z - from.z));
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return DIRS8[i];
}
/** The call fades with every night out, but never to nothing (Brain: unfloored, it is silent by night 6). */
export const CALL_FLOOR = 0.25;
export const callLoudness = (nights) => Math.max(CALL_FLOOR, 0.9 * Math.pow(0.6, nights));
export const loudWord = (l) => (l > 0.7 ? "clear" : l > 0.45 ? "faint" : "barely there");
/** False calls depend on nobody (Brain: a call that only comes when someone is missing announces it). */
export const FALSE_CALL_RATE = 0.3;

/**
 * The calls heard at first light. Real ones come from where the missing stand;
 * a false one can come any morning from day two. The tell is a bearing that
 * holds from dawn to dawn. `rFalse`/`rBear` are drawn every dawn by the caller.
 */
export function dawnCalls(expedition, from, rFalse, rBear) {
  const out = [];
  for (const m of expedition.missing || []) {
    if (m.recovered || m.abandoned || m.x == null) continue;
    out.push({ real: true, bearing: bearingWord(from, m), loud: callLoudness(m.nights || 0) });
  }
  if (expedition.day >= 2 && rFalse < FALSE_CALL_RATE) {
    out.push({ real: false, bearing: DIRS8[Math.floor(rBear * 8) % 8], loud: 0.4 + rBear * 0.4 });
  }
  // Order says nothing: a false call is not always the second one.
  if (out.length > 1 && rBear < 0.5) out.reverse();
  return out;
}

/** An open spot in an area, at least `minDist` from camp. Deterministic given `r`. */
export function missingSpot(world, area, from, r, minDist = 15) {
  const G = world.grid, spots = [];
  for (let cz = 1; cz < G - 1; cz++) {
    if (areaOfRow(cz) !== area) continue;
    for (let cx = 1; cx < G - 1; cx++) {
      if (world.blocked[cz * G + cx]) continue;
      const p = cellToWorld(cx, cz, G);
      if (Math.hypot(p.x - from.x, p.z - from.z) >= minDist) spots.push(p);
    }
  }
  if (!spots.length) return null;
  return spots[Math.min(spots.length - 1, Math.floor(r * spots.length))];
}

/** Has the lead walked up to someone missing? */
export const FIND_RADIUS = 5;
export function checkFound(sim) {
  const e = sim.expedition;
  if (!e || sim.found) return null;
  return (e.missing || []).find((m) => !m.recovered && !m.abandoned && m.x != null &&
    Math.hypot(sim.player.x - m.x, sim.player.z - m.z) <= FIND_RADIUS) || null;
}
/** The one you found walks home with you. */
export function stepFound(sim, dt) {
  const f = sim.found;
  if (!f) return;
  const d = Math.hypot(sim.player.x - f.x, sim.player.z - f.z);
  if (d <= 2.5) return;
  const sp = Math.min(4.6, 2 + d * 0.3) * dt;
  const next = moveWithCollision(sim.world, f, ((sim.player.x - f.x) / d) * sp, ((sim.player.z - f.z) / d) * sp);
  f.facing = Math.atan2(next.x - f.x, next.z - f.z);
  f.x = next.x; f.z = next.z;
}

// ---- the edge of the woods: going home (IDEAS "The ending", owner 2026-10-11)
// The pylons home number the REAL members plus one. Each takes two pairs of
// hands, the lead's and one of theirs, and what is not real cannot light one:
// trying it with a fake spends the pylon and the fake is gone. So there is
// exactly one mistake to make. The lead goes home with the last real member;
// with none left, the lead stands at the edge alone.
export const realCompanions = (sim) => sim.companions.filter((c) => c.replacedDay == null);
export function startHomeward(sim) {
  sim.homeward = { pylons: realCompanions(sim).length + 1, saved: [], gone: [], tried: [] };
  return sim.homeward;
}
export function lightHomePylon(sim, id) {
  const h = sim.homeward;
  if (!h || h.pylons <= 0 || h.tried.includes(id)) return null;
  const c = sim.companions.find((x) => x.id === id);
  if (!c) return null;
  h.pylons -= 1;
  h.tried.push(id);
  const real = c.replacedDay == null;
  (real ? h.saved : h.gone).push(id);
  return { real, pylonsLeft: h.pylons };
}
export const homewardOver = (sim) => !sim.homeward || sim.homeward.pylons <= 0 || sim.homeward.tried.length >= sim.companions.length;
export function finishHomeward(sim) {
  const h = sim.homeward;
  const home = h.saved.length > 0;
  sim.status = home ? "won" : "lost";
  sim.ending = home ? "home" : "alone";
  const leftBehind = realCompanions(sim).filter((c) => !h.saved.includes(c.id)).length;
  sim.finalDecision = { choice: "home", saved: h.saved.length, gone: h.gone.length, leftBehind, pylonsLeft: h.pylons };
  return sim.finalDecision;
}
