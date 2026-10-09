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
export const MYSTERY_ASKS_ALLOWED = 3;

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
    mysteries: [],
    keystone: { happened: false, active: false, day: null, order: [], returned: [], nextAt: 0 },
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
    expedition.mysteries = expedition.mysteries || [];
    expedition.mysteries.push(createMystery(expedition, disappearance));
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

export function activeMystery(expedition) {
  return (expedition?.mysteries || []).find((m) => !m.closed && !m.recovered && !m.abandoned) || null;
}

export function askMystery(expedition, id, nameOf = (x) => x) {
  const m = activeMystery(expedition);
  if (!m || !id) return null;
  if (m.answers?.[id]) return { who: id, name: nameOf(id), repeat: true, ...m.answers[id] };
  if (m.asksLeft <= 0 || m.accused) return null;
  const lying = id === m.suspect;
  const acc = accountForMystery(m, nameOf, lying);
  m.asked.push(id);
  m.answers[id] = acc;
  m.asksLeft -= 1;
  return { who: id, name: nameOf(id), repeat: false, ...acc };
}

export function accuseMystery(expedition, id, nameOf = (x) => x) {
  const m = activeMystery(expedition);
  if (!m || !id || m.accused) return null;
  m.accused = id;
  m.proofPending = true;
  return {
    mysteryId: m.id,
    accused: nameOf(id),
    proofPending: true,
  };
}

export function proveMystery(expedition, nameOf = (x) => x) {
  const m = activeMystery(expedition);
  if (!m || !m.accused || !m.proofPending) return null;
  m.correct = m.accused === m.suspect;
  m.proofPending = false;
  m.closed = !m.correct;
  m.searchReady = !!m.correct;
  return {
    mysteryId: m.id,
    correct: m.correct,
    accused: nameOf(m.accused),
    taken: nameOf(m.suspect),
    tell: tellMystery(m, nameOf),
    searchReady: m.searchReady,
  };
}

export function startKeystoneMorning(expedition, rng, partyIds, now = 0) {
  if (!expedition || expedition.day < 3) return null;
  const k = expedition.keystone || (expedition.keystone = { happened: false, active: false, day: null, order: [], returned: [], nextAt: 0 });
  if (k.happened || k.active) return null;
  const ids = (partyIds || []).slice();
  if (!ids.length) return null;
  const order = rng?.shuffled ? rng.shuffled(ids) : ids.slice().reverse();
  expedition.keystone = {
    happened: true,
    active: true,
    day: expedition.day,
    order,
    returned: [],
    nextAt: now + 2,
  };
  return expedition.keystone;
}

export function advanceKeystoneMorning(expedition, now = 0, stepSeconds = 3) {
  const k = expedition?.keystone;
  if (!k?.active) return [];
  const out = [];
  while (k.active && now >= k.nextAt && k.returned.length < k.order.length) {
    const id = k.order[k.returned.length];
    k.returned.push(id);
    out.push(id);
    k.nextAt += stepSeconds;
    if (k.returned.length >= k.order.length) k.active = false;
  }
  return out;
}

export function recoverMissing(expedition, id) {
  const m = (expedition?.missing || []).find((entry) => entry.id === id && !entry.recovered && !entry.abandoned);
  if (!m) return false;
  m.recovered = true;
  m.recoveredDay = expedition.day;
  m.recoveredArea = expedition.area;
  const mystery = (expedition?.mysteries || []).find((entry) => entry.suspect === id && !entry.recovered);
  if (mystery) {
    mystery.recovered = true;
    mystery.closed = true;
    mystery.searchReady = false;
  }
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
      const mystery = (expedition.mysteries || []).find((entry) => entry.suspect === m.id && !entry.recovered);
      if (mystery) {
        mystery.abandoned = true;
        mystery.closed = true;
        mystery.searchReady = false;
      }
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
    mysteries: (expedition.mysteries || []).map(packMystery),
    keystone: packKeystone(expedition.keystone),
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
    mysteries: (data.mysteries || []).map(unpackMystery),
    keystone: packKeystone(data.keystone || { happened: false, active: false, day: null, order: [], returned: [], nextAt: 0 }),
    night: data.night ? packNight(data.night) : null,
    lastSpend: data.lastSpend ? { ...data.lastSpend } : null,
  };
}

function createMystery(expedition, disappearance) {
  const day = expedition.days.find((d) => d.day === disappearance.day) || { day: disappearance.day, facts: [] };
  const facts = normalizeFacts(day.facts || []);
  return {
    id: `m${disappearance.day}-${disappearance.missing.id}`,
    day: disappearance.day,
    area: disappearance.missing.area,
    suspect: disappearance.missing.id,
    recoverByArea: disappearance.missing.recoverByArea,
    facts,
    perturbation: chooseMysteryPerturbation(facts, disappearance.missing.id),
    asked: [],
    answers: {},
    asksLeft: MYSTERY_ASKS_ALLOWED,
    accused: null,
    correct: null,
    proofPending: false,
    searchReady: false,
    closed: false,
    recovered: false,
    abandoned: false,
  };
}

function normalizeFacts(facts) {
  return (facts || []).map((f, i) => ({
    i,
    kind: f.kind || "work",
    actor: f.actor || "you",
    object: f.object ?? null,
    amount: f.amount ?? null,
    day: f.day ?? null,
  }));
}

function chooseMysteryPerturbation(facts, suspect) {
  const usable = facts.length ? facts : [{ i: 0, kind: "trail", actor: "you", object: "the route" }];
  const actors = [...new Set(usable.map((f) => f.actor).filter((id) => id && id !== suspect))];
  const objects = [...new Set(usable.map((f) => f.object).filter(Boolean))];
  const at = usable.findIndex((f) => actors.some((id) => id !== f.actor));
  if (actors.length && at >= 0) return { kind: "actor", at, to: actors.find((id) => id !== usable[at].actor) };
  if (objects.length > 1) return { kind: "object", at: 0, to: objects[objects.length - 1] };
  if (usable.length > 1) return { kind: "order", at: 0 };
  return { kind: "shadow", at: 0 };
}

function accountForMystery(m, nameOf, lying) {
  const perturb = lying ? m.perturbation : null;
  let facts = (m.facts || []).map((f) => ({ ...f }));
  if (perturb) {
    if (perturb.kind === "actor" && facts[perturb.at]) facts[perturb.at].actor = perturb.to;
    else if (perturb.kind === "object" && facts[perturb.at]) facts[perturb.at].object = perturb.to;
    else if (perturb.kind === "order" && facts[perturb.at + 1]) [facts[perturb.at], facts[perturb.at + 1]] = [facts[perturb.at + 1], facts[perturb.at]];
    else if (perturb.kind === "shadow") facts.push({ i: facts.length, kind: "shadow", actor: m.suspect, object: "a call from the trees" });
  }
  return {
    weather: `Day ${m.day}, area ${m.area}.`,
    lines: facts.length ? facts.map((f) => phraseMysteryFact(f, nameOf)) : ["Nothing certain happened before dark."],
  };
}

function phraseMysteryFact(f, nameOf) {
  const who = f.actor === "you" ? "You" : nameOf(f.actor);
  switch (f.kind) {
    case "deadfall": return `${who} opened the deadfall on the trail`;
    case "gather": return `${who} brought back ${f.object || "supplies"}`;
    case "pylon": return `${who} worked the pylon marked ${f.object || "unknown"}`;
    case "survey": return `${who} logged ${f.object || "a marker"}`;
    case "recovered": return `${who} came back into their own head`;
    case "trail": return `${who} pushed the route forward`;
    case "shadow": return `${who} says there was a call from the trees`;
    default: return `${who} remembers ${f.object || f.kind || "the work"}`;
  }
}

function tellMystery(m, nameOf) {
  const p = m.perturbation || {};
  if (p.kind === "actor") return `They put ${nameOf(p.to)} into a thing somebody else did.`;
  if (p.kind === "object") return `They named the wrong thing from that day.`;
  if (p.kind === "order") return `They told the day in the wrong order.`;
  return "They added a moment nobody else lived through.";
}

function packMystery(m) {
  return {
    ...m,
    facts: (m.facts || []).map((f) => ({ ...f })),
    perturbation: m.perturbation ? { ...m.perturbation } : null,
    asked: (m.asked || []).slice(),
    answers: Object.fromEntries(Object.entries(m.answers || {}).map(([k, v]) => [k, { weather: v.weather, lines: (v.lines || []).slice() }])),
  };
}

function unpackMystery(m) {
  return packMystery(m);
}

function packKeystone(k) {
  return {
    happened: !!k?.happened,
    active: !!k?.active,
    day: k?.day ?? null,
    order: (k?.order || []).slice(),
    returned: (k?.returned || []).slice(),
    nextAt: k?.nextAt ?? 0,
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
