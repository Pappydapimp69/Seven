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
  const camp = sim.world.camp;
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
  const camp = sim.world.camp;
  if (Math.hypot(sim.player.x - camp.x, sim.player.z - camp.z) > campRadius) return { ok: false, reason: "away" };
  return { ok: true, forfeits: e.daylight };
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
