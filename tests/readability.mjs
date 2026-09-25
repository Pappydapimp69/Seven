// readability.mjs — did the TRUE value reach the player through the world?
//
// chronicle.js bends one of six kinds of fact for a fake's account. A bent
// fact is only evidence if the player EXPERIENCED the true one — through the
// scene, the HUD or the day's own event lines, never through the account text
// they are comparing against. Otherwise the ask is a coin flip on that axis,
// however correct the chronicle is.
//
// This is the guard whose absence let `place` ship as four identical cairns
// for the alpha's whole life, and let `weather` ship as nothing at all, with
// every other test green (Brain dog#E93, #E95). One guard per kind.
//
// NEGATIVE CONTROLS ARE PART OF THE FILE, not a thing done once by hand. Each
// guard takes the thing it watches as an argument; the second half of this
// file feeds every guard a copy broken the way that axis was actually broken
// (or plausibly would be) and requires it to fail. A guard that cannot fail is
// unmeasured (mirage#E16).
//
// Source-text checks on render.js / hud.js are here because this tier has no
// DOM. They say the carrier EXISTS and is bound to the live value. Whether it
// is SEEN is tests/woods-play.mjs's job, which reads it back off real pixels.
//
// Run: node tests/readability.mjs

import {
  BEATS, SITES, PHASE, WEATHER_LOOK, MARK_AT, dawnLine, dayMarks,
  attachSites, startDay, beatAt, workBeat,
} from "../src/woods.js";
import { WEATHERS, PERTURBATION_KINDS, candidates, account } from "../src/chronicle.js";
import { buildCamp } from "../src/camp.js";
import { createRun } from "../src/state.js";
import { gridOf } from "../src/world.js";
import { makeRng } from "../src/rng.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let passed = 0;
const failures = [];
const check = (n, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8");
const PARTY = ["c1", "c2", "c3", "c4", "c5"];

/** The body of `const NAME = { ... };` in a source file, by brace matching. */
function block(src, head) {
  const at = src.indexOf(head);
  if (at < 0) return null;
  // A head that ends in "{" opens the block itself; otherwise the first brace
  // after it does. (A signature with a default `= {}` needs the former.)
  let i = head.endsWith("{") ? at + head.length - 1 : src.indexOf("{", at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}
/** Top-level `name() {` members of an object-literal block. */
const members = (body) => [...(body || "").matchAll(/^ {4}(\w+)\(\) \{/gm)].map((m) => m[1]);

/** A whole day, played purely, with every emitted event kept. */
function playDay(seed, work = workBeat) {
  const world = attachSites(buildCamp());
  const sim = createRun({ seed: -1, world });
  const woods = startDay(sim, makeRng(seed), PARTY);
  const events = [];
  const emit = (_s, kind, text, opts = {}) => events.push({ kind, text, ...opts });
  for (let i = 0; i < BEATS.length + 5 && woods.phase === PHASE.DAY; i++) {
    const b = beatAt(woods);
    const site = sim.world.sites.find((s) => s.id === b.site);
    sim.player.x = site.x; sim.player.z = site.z;
    const who = sim.companions.find((c) => c.id === woods.assign[b.id]);
    for (const c of sim.companions) { c.x = site.x + 400; c.z = site.z + 400; }
    who.x = site.x + 1; who.z = site.z + 1;
    work(sim, woods, emit);
  }
  return { sim, woods, events };
}

// ---------------------------------------------------------------------------
// The guards. Each returns a list of problems; empty means readable.
// ---------------------------------------------------------------------------

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => v / 255);
const cdist = (a, b) => Math.hypot(...hex(a).map((v, i) => v - hex(b)[i]));

/**
 * How different two weathers LOOK, as the largest single difference across
 * everything the renderer draws from them. Each channel is scaled so 1.0 is
 * "obvious across a day": a colour shift of ~0.25 in RGB, a doubling of the
 * fog, a light at two thirds the strength, or a whole effect on vs off.
 */
function lookDistance(a, b) {
  return Math.max(
    cdist(a.fog, b.fog) / 0.25,
    cdist(a.sky[0], b.sky[0]) / 0.25,
    cdist(a.sky[1], b.sky[1]) / 0.25,
    Math.abs(Math.log2(a.fogDensity / b.fogDensity)),
    Math.abs(Math.log(a.sunI / b.sunI)) / Math.log(1.5),
    Math.abs(a.rain - b.rain), Math.abs(a.sway - b.sway), Math.abs(a.leaves - b.leaves), Math.abs(a.frost - b.frost),
  );
}

const G = {
  /** weather: every weather has a look, the looks are far apart, the day says it, and render binds it live. */
  weather({ looks, dawn, renderSrc }) {
    const out = [];
    for (const w of WEATHERS) if (!looks[w]) out.push(`"${w}" has no WEATHER_LOOK — it will draw as the default camp`);
    for (let i = 0; i < WEATHERS.length; i++) {
      for (let j = i + 1; j < WEATHERS.length; j++) {
        const a = looks[WEATHERS[i]], b = looks[WEATHERS[j]];
        if (!a || !b) continue;
        const d = lookDistance(a, b);
        if (d < 1) out.push(`${WEATHERS[i]} vs ${WEATHERS[j]} differ by only ${d.toFixed(2)} — a player cannot tell them apart`);
      }
    }
    const lines = WEATHERS.map((w) => dawn(w));
    if (new Set(lines).size !== WEATHERS.length) out.push("two weathers open the day with the same line");
    // Not the account's own sentence: the morning should be a remembered DAY
    // against a spoken sentence, not two sentences diffed.
    for (const w of WEATHERS) {
      const spoken = account({ weather: w, facts: [] }, String).weather;
      if (dawn(w).includes(spoken)) out.push(`the dawn line for ${w} quotes the account verbatim`);
    }
    // Bound to the live value, per frame. A copy taken at build drifts.
    const upd = block(renderSrc, "function update(percept, dt, view, opts = {}) {");
    if (!/WEATHER_LOOK\[sim\.woods\.weather\]/.test(renderSrc)) out.push("render.js does not read WEATHER_LOOK off sim.woods.weather");
    if (!upd || !/weatherLook\(\)/.test(upd)) out.push("render.js update() does not consult the weather every frame");
    return out;
  },

  /** object: every object an account can name leaves a mark, absent before its beat and present after. */
  object({ marks, beats, renderSrc, markAt, camp }) {
    const out = [];
    const bodies = new Set(members(block(renderSrc, "const MARK_BODIES = {")));
    // Everything object-kind can swap in or out — read off the day's own
    // candidates, so a new beat with a new object is covered without edits.
    const { woods } = playDay(3);
    const swappable = new Set(candidates(woods.chronicle).filter((c) => c.kind === "object").flatMap((c) => [c.to, woods.chronicle.facts[c.at].object]));
    for (const b of beats) if (b.object) swappable.add(b.object);
    for (const object of swappable) {
      const i = beats.findIndex((b) => b.object === object);
      const before = marks({ beat: i, phase: PHASE.DAY }).find((m) => m.object === object);
      const after = marks({ beat: i + 1, phase: PHASE.DAY }).find((m) => m.object === object);
      if (!after || !after.done) { out.push(`"${object}" leaves nothing in the world when its beat resolves`); continue; }
      if (before && before.done) out.push(`"${object}" is already there before its beat — it proves nothing about the day`);
      if (!bodies.has(after.id)) out.push(`mark "${after.id}" has no body in render.js MARK_BODIES`);
      const at = markAt[after.id];
      if (!at) { out.push(`mark "${after.id}" has nowhere to stand`); continue; }
      const site = SITES.find((s) => s.id === at.site);
      const cx = site.cx + at.dcx, cz = site.cz + at.dcz;
      if (camp.blocked[cz * gridOf(camp) + cx]) out.push(`mark "${after.id}" stands in a blocked cell (${cx},${cz})`);
    }
    // And it survives the night: the morning is when the player needs it.
    const morning = marks({ beat: beats.length, phase: PHASE.MORNING });
    for (const object of swappable) if (!morning.some((m) => m.object === object && m.done)) out.push(`"${object}" is gone by morning`);
    return out;
  },

  /** place: every site has its own body, and no two bodies are the same shape. */
  place({ renderSrc }) {
    const out = [];
    const body = block(renderSrc, "const SITE_BODIES = {");
    const forms = members(body);
    for (const s of SITES) if (!forms.includes(s.id)) out.push(`site "${s.id}" has no body — it falls back to the generic cairn`);
    const shapes = forms.map((f) => block(body, `${f}() {`).replace(/\/\/.*$/gm, "").replace(/\s+/g, ""));
    if (new Set(shapes).size !== shapes.length) out.push("two sites share an identical body");
    return out;
  },

  /** actor: the moment a beat resolves names who did it, and the five figures are built differently. */
  actor({ work, renderSrc }) {
    const out = [];
    const { sim, woods, events } = playDay(7, work);
    const beatsSeen = events.filter((e) => e.kind === "beat");
    woods.chronicle.facts.forEach((f, i) => {
      const e = beatsSeen[i];
      const name = sim.companions.find((c) => c.id === f.actor)?.name;
      if (!e || !name || !e.text.includes(name)) out.push(`beat ${i + 1} resolved without naming ${name}`);
    });
    const from = renderSrc.indexOf("const BUILDS = [");
    const builds = from < 0 ? "" : renderSrc.slice(from, renderSrc.indexOf("];", from));
    const rows = [...builds.matchAll(/\{ r: [^}]+\}/g)].map((m) => m[0].replace(/\s+/g, ""));
    if (new Set(rows).size < PARTY.length) out.push(`only ${new Set(rows).size} distinct figure builds for ${PARTY.length} people`);
    return out;
  },

  /** name: the roster is five different names, and the party panel draws them. */
  name({ hudSrc, mainSrc }) {
    const out = [];
    for (const seed of [1, 2, 3, 99]) {
      const { woods } = playDay(seed);
      const names = Object.values(woods.nameById);
      if (new Set(names).size !== PARTY.length) out.push(`seed ${seed}: the roster repeats a name`);
    }
    if (!/r-name">\$\{c\.name\}/.test(hudSrc)) out.push("the party panel does not draw each member's name");
    if (!/c\.name = sim\.woods\.nameById\[c\.id\]/.test(mainSrc)) out.push("the day's names are never given to the party");
    return out;
  },

  /** order: one line per beat, as it happens, in the order the record keeps. */
  order({ work }) {
    const out = [];
    for (const seed of [5, 50]) {
      const { woods, events } = playDay(seed, work);
      const seen = events.filter((e) => e.kind === "beat").map((e) => e.id);
      const kept = woods.chronicle.facts.map((_, i) => BEATS[i].id);
      if (seen.join() !== kept.join()) out.push(`seed ${seed}: the day showed [${seen}] but recorded [${kept}]`);
    }
    return out;
  },
};

const REAL = {
  looks: WEATHER_LOOK, dawn: dawnLine, marks: dayMarks, beats: BEATS, markAt: MARK_AT,
  camp: buildCamp(), work: workBeat,
  renderSrc: read("src/render.js"), hudSrc: read("src/hud.js"), mainSrc: read("src/main.js"),
};

// ---------------------------------------------------------------------------
// 1. Every kind has a guard, and every guard passes on the real game.
// ---------------------------------------------------------------------------

check("every perturbation kind has a readability guard", () => {
  for (const k of PERTURBATION_KINDS) assert(typeof G[k] === "function", `no guard for "${k}"`);
});

for (const k of PERTURBATION_KINDS) {
  check(`${k}: the true value reaches the player`, () => {
    const problems = G[k](REAL);
    assert(!problems.length, problems.join("; "));
  });
}

check("the camp's weather is never read from a copy", () => {
  // `sim.woods.weather` is the one variable; the chronicle holds the same value
  // and the scene has to agree with it for every seed.
  for (let s = 1; s <= 60; s++) {
    const { woods } = playDay(s);
    assert(woods.chronicle.weather === woods.weather, `seed ${s}: chronicle says ${woods.chronicle.weather}, day says ${woods.weather}`);
    assert(WEATHER_LOOK[woods.weather], `seed ${s}: drew "${woods.weather}", which has no look`);
  }
});

// ---------------------------------------------------------------------------
// 2. Negative controls. Break each axis the way it was (or would be) broken;
//    its guard must fail.
// ---------------------------------------------------------------------------

const broken = (k, patch, why) => check(`negative control — ${k}: ${why}`, () => {
  const problems = G[k]({ ...REAL, ...patch });
  assert(problems.length > 0, `the ${k} guard passed on a broken game — it is inert`);
});

// weather — the alpha as it shipped: drawn, never depicted.
broken("weather", { renderSrc: REAL.renderSrc.replace(/WEATHER_LOOK\[sim\.woods\.weather\]/g, "null").replace(/weatherLook\(\)/g, "null") }, "render never reads the weather");
broken("weather", { looks: { ...WEATHER_LOOK, drizzle: WEATHER_LOOK.clear } }, "drizzle looks exactly like clear");
broken("weather", { looks: { ...WEATHER_LOOK, fog: { ...WEATHER_LOOK.fog, fogDensity: WEATHER_LOOK.drizzle.fogDensity * 1.2, fog: WEATHER_LOOK.drizzle.fog, sky: WEATHER_LOOK.drizzle.sky, sunI: WEATHER_LOOK.drizzle.sunI, rain: 1 } } }, "fog is drizzle with a touch more haze");
broken("weather", { looks: (() => { const l = { ...WEATHER_LOOK }; delete l.cold; return l; })() }, "a weather with no look");
broken("weather", { dawn: (w) => `First light. ${account({ weather: w, facts: [] }, String).weather}` }, "the day opens by quoting the account");

// object — the alpha as it shipped: a subtitle and nothing else.
broken("object", { marks: () => [] }, "beats leave nothing behind");
broken("object", { marks: (w) => dayMarks({ ...w, beat: 0 }).map((m) => ({ ...m, done: true })) }, "every mark is there from dawn");
broken("object", { marks: (w) => dayMarks(w).filter((m) => m.id !== "tent") }, "the tent is never pitched");
broken("object", { renderSrc: REAL.renderSrc.replace("    tent() {", "    tarp() {") }, "the tent has no body");
broken("object", { markAt: { ...MARK_AT, tent: { site: "fire", dcx: -6, dcz: -5 } } }, "the tent stands inside a cabin");
broken("object", { marks: (w) => dayMarks(w).map((m) => ({ ...m, done: m.done && !m.spent })) }, "the marks vanish overnight");

// place — the alpha as it shipped: four identical cairns.
broken("place", { renderSrc: REAL.renderSrc.replace("const SITE_BODIES = {", "const SITE_BODIES_OLD = {") }, "no site bodies at all");
broken("place", { renderSrc: REAL.renderSrc.replace("    ridge() {", "    ridgeline() {") }, "the ridge has no body");

// actor — a beat that resolves anonymously, and a party of clones.
broken("actor", { work: (sim, woods, emit) => workBeat(sim, woods, (s, k, t, o) => emit(s, k, "The job gets done.", o)) }, "the beat line does not say who");
broken("actor", { renderSrc: REAL.renderSrc.replace(/\{ r: 0\.\d+, h: [^}]+\}/g, "{ r: 0.3, h: 1, head: 0.24, tint: 0x888888, pack: false, hood: false }") }, "five identical figures");

// name — the panel without names.
broken("name", { hudSrc: REAL.hudSrc.replace('r-name">${c.name}', 'r-name">${c.role}') }, "the panel shows roles, not names");
broken("name", { mainSrc: REAL.mainSrc.replace("c.name = sim.woods.nameById[c.id]", "c.name = c.name") }, "the roster is never applied");

// order — lines that do not come when the beat does.
broken("order", { work: (sim, woods, emit) => workBeat(sim, woods, (s, k, t, o) => (woods.beat % 2 ? emit(s, k, t, o) : null)) }, "half the beats resolve silently");

// ---------------------------------------------------------------------------

if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(1);
}
console.log(`\n${passed} passed, 0 failed`);
console.log("readability: OK — every kind of lie has something true to be caught against");
