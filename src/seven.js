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
