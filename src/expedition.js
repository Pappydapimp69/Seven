// expedition.js — the multi-day woods layer.
//
// Pure state, no DOM, no Three. This is the bridge between THE WOODS alpha and
// the old traversal run: one persistent map, days as the unit of cost, a record
// of what really happened, and a night where somebody may disappear. What
// returns to the fire keeps their name and skill surface; the missing person
// remains out there until the route leaves their recovery window behind.

export const EXPEDITION_PHASE = Object.freeze({
  DAY: "day",
  NIGHT: "night",
});

export const DEFAULT_DAYLIGHT = 12;
export const REPLACEMENT_START_DAY = 2;
export const RECOVERY_WINDOW_AREAS = 1;

export function createExpedition({
  day = 1,
  daylight = DEFAULT_DAYLIGHT,
  replacementStartDay = REPLACEMENT_START_DAY,
  recoveryWindowAreas = RECOVERY_WINDOW_AREAS,
  replacementChance = 1,
  area = 0,
} = {}) {
  return {
    day,
    phase: EXPEDITION_PHASE.DAY,
    area,
    daylight,
    dayLength: daylight,
    replacementStartDay,
    recoveryWindowAreas,
    replacementChance,
    current: { day, facts: [] },
    days: [],
    missing: [],
    replacements: [],
    night: null,
  };
}

export function spendDaylight(expedition, amount, reason = null) {
  if (!expedition || expedition.phase !== EXPEDITION_PHASE.DAY) return false;
  if (!(amount > 0)) return false;
  if (expedition.daylight < amount) return false;
  expedition.daylight = Math.max(0, expedition.daylight - amount);
  if (reason) {
    expedition.lastSpend = { day: expedition.day, amount, reason };
  }
  return true;
}

export function recordFact(expedition, fact) {
  if (!expedition || expedition.phase !== EXPEDITION_PHASE.DAY) return null;
  if (!fact || !fact.kind) throw new Error("expedition: fact.kind is required");
  const current = expedition.current || (expedition.current = { day: expedition.day, facts: [] });
  const out = {
    ...fact,
    day: expedition.day,
    i: current.facts.length,
    t: fact.t ?? null,
    withWhom: (fact.withWhom || []).slice(),
  };
  current.facts.push(out);
  return out;
}

export function sleep(expedition) {
  if (!expedition || expedition.phase !== EXPEDITION_PHASE.DAY) return null;
  const day = closeCurrentDay(expedition);
  expedition.phase = EXPEDITION_PHASE.NIGHT;
  expedition.night = { day: expedition.day, disappearance: null };
  return day;
}

export function resolveNight(expedition, rng, partyIds) {
  if (!expedition || expedition.phase !== EXPEDITION_PHASE.NIGHT) return null;
  if (!rng) throw new Error("expedition: resolveNight requires rng");
  const ids = (partyIds || []).slice();
  const disappearance = chooseDisappearance(expedition, rng, ids);
  if (disappearance) {
    expedition.missing.push(disappearance.missing);
    expedition.replacements.push(disappearance.replacement);
    expedition.night.disappearance = disappearance;
  }
  expedition.day += 1;
  expedition.phase = EXPEDITION_PHASE.DAY;
  expedition.daylight = expedition.dayLength;
  expedition.current = { day: expedition.day, facts: [] };
  expedition.night = null;
  return disappearance;
}

export function chooseDisappearance(expedition, rng, partyIds) {
  const ids = (partyIds || []).slice();
  if (!expedition || expedition.day < expedition.replacementStartDay || ids.length === 0) return null;

  const rChance = rng();
  const rWho = rng();
  if (rChance >= expedition.replacementChance) return null;

  const already = new Set([
    ...(expedition.replacements || []).map((r) => r.id),
    ...(expedition.missing || []).filter((m) => !m.recovered && !m.abandoned).map((m) => m.id),
  ]);
  const available = ids.filter((id) => !already.has(id));
  if (!available.length) return null;

  const day = expedition.days.find((d) => d.day === expedition.day) || expedition.current;
  const witnessed = new Set();
  for (const f of day?.facts || []) {
    if (f.actor) witnessed.add(f.actor);
    for (const id of f.withWhom || []) witnessed.add(id);
  }
  const pool = available.filter((id) => witnessed.has(id));
  const candidates = pool.length ? pool : available;
  const id = candidates[Math.floor(rWho * candidates.length)];
  const missing = {
    id,
    day: expedition.day,
    area: expedition.area,
    recoverByArea: expedition.area + expedition.recoveryWindowAreas,
    recovered: false,
    abandoned: false,
  };
  return {
    day: expedition.day,
    missing,
    replacement: {
      id,
      day: expedition.day,
      area: expedition.area,
      silent: true,
      sameName: true,
      sameSkills: true,
    },
  };
}

export const chooseReplacement = chooseDisappearance;

export function recoverMissing(expedition, id) {
  const m = (expedition?.missing || []).find((entry) => entry.id === id && !entry.recovered && !entry.abandoned);
  if (!m) return false;
  m.recovered = true;
  m.recoveredDay = expedition.day;
  m.recoveredArea = expedition.area;
  return true;
}

export function advanceArea(expedition, areas = 1) {
  if (!expedition || !(areas > 0)) return [];
  expedition.area += areas;
  const newlyAbandoned = [];
  for (const m of expedition.missing || []) {
    if (m.recovered || m.abandoned) continue;
    if (expedition.area > m.recoverByArea) {
      m.abandoned = true;
      m.abandonedDay = expedition.day;
      m.abandonedArea = expedition.area;
      newlyAbandoned.push(m);
    }
  }
  return newlyAbandoned;
}

export function serializeExpedition(expedition) {
  if (!expedition) return null;
  return {
    day: expedition.day,
    phase: expedition.phase,
    area: expedition.area,
    daylight: expedition.daylight,
    dayLength: expedition.dayLength,
    replacementStartDay: expedition.replacementStartDay,
    recoveryWindowAreas: expedition.recoveryWindowAreas,
    replacementChance: expedition.replacementChance,
    current: packDay(expedition.current),
    days: (expedition.days || []).map(packDay),
    missing: (expedition.missing || []).map((m) => ({ ...m })),
    replacements: (expedition.replacements || []).map((r) => ({ ...r })),
    night: expedition.night ? packNight(expedition.night) : null,
    lastSpend: expedition.lastSpend ? { ...expedition.lastSpend } : null,
  };
}

export function deserializeExpedition(data) {
  if (!data) return null;
  return {
    day: data.day,
    phase: data.phase,
    area: data.area ?? 0,
    daylight: data.daylight,
    dayLength: data.dayLength,
    replacementStartDay: data.replacementStartDay,
    recoveryWindowAreas: data.recoveryWindowAreas ?? RECOVERY_WINDOW_AREAS,
    replacementChance: data.replacementChance,
    current: unpackDay(data.current),
    days: (data.days || []).map(unpackDay),
    missing: (data.missing || []).map((m) => ({ ...m })),
    replacements: (data.replacements || []).map((r) => ({ ...r })),
    night: data.night ? packNight(data.night) : null,
    lastSpend: data.lastSpend ? { ...data.lastSpend } : null,
  };
}

function closeCurrentDay(expedition) {
  const day = packDay(expedition.current || { day: expedition.day, facts: [] });
  const existing = expedition.days.findIndex((d) => d.day === day.day);
  if (existing >= 0) expedition.days[existing] = day;
  else expedition.days.push(day);
  return day;
}

function packDay(day) {
  return {
    day: day.day,
    facts: (day.facts || []).map((f) => ({ ...f, withWhom: (f.withWhom || []).slice() })),
  };
}

function unpackDay(day) {
  if (!day) return null;
  return packDay(day);
}

function packNight(night) {
  return {
    ...night,
    disappearance: night.disappearance
      ? {
          day: night.disappearance.day,
          missing: { ...night.disappearance.missing },
          replacement: { ...night.disappearance.replacement },
        }
      : null,
  };
}
