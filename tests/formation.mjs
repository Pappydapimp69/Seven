// formation.mjs — is the party actually a party?
//
// The player's report was "the team doesn't feel like a team, they just scatter
// and do their own thing". That is a claim about PERCEPTION, and perception of a
// companion has exactly two prerequisites in a first-person game: they have to be
// inside the frustum, and they have to be close enough to read. Everything else
// the party sim does — remarks, errands, breaking off for a pylon — is invisible
// if those two never hold.
//
// So this measures the only thing that can falsify the complaint: what fraction
// of walking seconds each companion spends ON SCREEN, and how far each one drifts
// from the formation bearing they were assigned. Not "did updateCompanions run".
//
// Run: node tests/formation.mjs [seeds]

import { createRun, tick } from "../src/state.js";
import { isBlockedAt } from "../src/world.js";

const SEEDS = Number(process.argv[2] || 8);
const DT = 1 / 20;
const SECONDS = 90;

// Must match render.js: horizontal FOV is fixed at 90 and vertical is derived.
const HFOV = 90;
const HALF = (HFOV / 2) * (Math.PI / 180);
// Beyond this a body is a smudge in the fog — on screen, but not legible as a
// companion. See render.js's fog far plane.
const LEGIBLE = 26;

const FORMATION_BEARINGS = [-0.30, 0.55, -0.55, 0.30, 2.75];
const FORMATION_R = [7.0, 5.6, 5.6, 7.0, 4.6];

/** Mirror of party.js formationSlot, so we can measure the gap to the station. */
function slotOf(sim, c) {
  const i = (c.index - 1) % 5;
  const a = (sim.player.heading ?? sim.player.yaw ?? 0) + FORMATION_BEARINGS[i];
  return { x: sim.player.x - Math.sin(a) * FORMATION_R[i], z: sim.player.z - Math.cos(a) * FORMATION_R[i] };
}

/** Signed bearing of `c` relative to the lead's facing; 0 is dead ahead. */
function bearingOf(player, c) {
  // forward = (-sin yaw, -cos yaw); right = (-cos yaw, +sin yaw).
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx = -Math.cos(player.yaw), rz = Math.sin(player.yaw);
  const dx = c.x - player.x, dz = c.z - player.z;
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function runOne(seed) {
  const sim = createRun({ seed, difficulty: "standard" });
  const stats = sim.companions.map((c) => ({
    name: c.name,
    index: c.index,
    onScreen: 0,
    samples: 0,
    distSum: 0,
    bearingErrSum: 0,
    gapSum: 0,
    blocked: 0,
    goals: new Map(),
  }));
  let anyOnScreen = 0, allSamples = 0;

  // A lead who walks: forward most of the time, with slow turns, which is the
  // condition the complaint was made under. A stationary lead would let everyone
  // settle perfectly and measure nothing.
  let t = 0;
  while (t < SECONDS) {
    const turn = Math.sin(t * 0.17) * 0.35;
    sim.player.yaw += turn * DT;
    const fx = -Math.sin(sim.player.yaw), fz = -Math.cos(sim.player.yaw);
    tick(sim, DT, { move: { x: fx, z: fz }, yaw: sim.player.yaw });
    t += DT;
    if (t < 3) continue; // let the spawn fan resolve

    let seen = 0;
    sim.companions.forEach((c, i) => {
      const s = stats[i];
      const d = Math.hypot(c.x - sim.player.x, c.z - sim.player.z);
      const b = bearingOf(sim.player, c);
      const visible = Math.abs(b) <= HALF && d <= LEGIBLE;
      s.samples++;
      s.distSum += d;
      if (visible) { s.onScreen++; seen++; }
      if (c.goalKind === "follow") {
        s.bearingErrSum += Math.abs(wrap(b - (sim.player.heading - sim.player.yaw) - FORMATION_BEARINGS[(c.index - 1) % 5]));
        const sl = slotOf(sim, c);
        s.gapSum += Math.hypot(c.x - sl.x, c.z - sl.z);
        if (isBlockedAt(sim.world, sl.x, sl.z)) s.blocked++;
      }
      s.goals.set(c.goalKind, (s.goals.get(c.goalKind) || 0) + 1);
    });
    allSamples++;
    if (seen > 0) anyOnScreen++;
  }
  return { stats, anyOnScreen, allSamples };
}

const totals = new Map();
let anySum = 0, sampleSum = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const { stats, anyOnScreen, allSamples } = runOne(seed);
  anySum += anyOnScreen;
  sampleSum += allSamples;
  for (const s of stats) {
    const key = `${s.index} ${s.name}`;
    const acc = totals.get(key) || { onScreen: 0, samples: 0, distSum: 0, errSum: 0, errN: 0, gapSum: 0, blocked: 0, goals: new Map() };
    acc.onScreen += s.onScreen;
    acc.samples += s.samples;
    acc.distSum += s.distSum;
    acc.errSum += s.bearingErrSum;
    acc.gapSum += s.gapSum;
    acc.blocked += s.blocked;
    acc.errN += s.goals.get("follow") || 0;
    for (const [g, n] of s.goals) acc.goals.set(g, (acc.goals.get(g) || 0) + n);
    totals.set(key, acc);
  }
}

// A lead who stands still and turns all the way round must, at some point, be
// looking at every single member of their party. The rear guard is DESIGNED to
// be behind you — that is what makes this a formation you are inside rather than
// a queue you are at the head of — but "behind you" has to mean "one turn away",
// not "gone". Nothing else in the walking numbers can distinguish those two.
function sweepVisibility(seed) {
  const sim = createRun({ seed, difficulty: "standard" });
  for (let t = 0; t < 12; t += DT) {
    const fx = -Math.sin(sim.player.yaw), fz = -Math.cos(sim.player.yaw);
    tick(sim, DT, { move: { x: fx, z: fz }, yaw: sim.player.yaw }); // settle on station
  }
  const seen = new Set();
  for (let t = 0; t < Math.PI * 2; t += 0.05) {
    sim.player.yaw += 0.05;
    tick(sim, DT, { move: { x: 0, z: 0 }, yaw: sim.player.yaw });
    for (const c of sim.companions) {
      const d = Math.hypot(c.x - sim.player.x, c.z - sim.player.z);
      if (Math.abs(bearingOf(sim.player, c)) <= HALF && d <= LEGIBLE) seen.add(c.name);
    }
  }
  return { seen, all: sim.companions.map((c) => c.name) };
}

const failures = [];
for (let seed = 1; seed <= Math.min(SEEDS, 4); seed++) {
  const { seen, all } = sweepVisibility(seed);
  const missing = all.filter((n) => !seen.has(n));
  if (missing.length) failures.push(`seed ${seed}: never visible during a full turn — ${missing.join(", ")}`);
}

console.log(`seeds ${SEEDS} · ${SECONDS}s of walking each`);
console.log(`AT LEAST ONE companion on screen: ${((anySum / sampleSum) * 100).toFixed(1)}% of the time`);
for (const [key, a] of [...totals.entries()].sort()) {
  const pct = ((a.onScreen / a.samples) * 100).toFixed(1).padStart(5);
  const dist = (a.distSum / a.samples).toFixed(1);
  const err = a.errN ? ((a.errSum / a.errN) * 180 / Math.PI).toFixed(0) : "--";
  const gap = a.errN ? (a.gapSum / a.errN).toFixed(1) : "--";
  const blk = a.errN ? ((a.blocked / a.errN) * 100).toFixed(0) : "--";
  const goals = [...a.goals.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([g, n]) => `${g} ${((n / a.samples) * 100).toFixed(0)}%`)
    .join(" ");
  console.log(`  ${key.padEnd(12)} on-screen ${pct}%  dist ${dist}  gap ${gap}  slot-in-rock ${blk}%  bearing-err ${err}deg`);

  // The four forward stations exist to be seen. A floor rather than a target:
  // errands, pylon breaks and hallucination episodes legitimately take people
  // out of frame, and should. What must never come back is the old regime,
  // where a station was assigned and then structurally unreachable.
  const idx = Number(key.split(" ")[0]);
  if (idx !== 5 && a.onScreen / a.samples < 0.5) {
    failures.push(`${key} on screen only ${pct}% while walking (forward stations must clear 50%)`);
  }
  if (a.errN && a.gapSum / a.errN > 3.5) {
    failures.push(`${key} averages ${gap} units off station (must hold within 3.5)`);
  }
}

const anyPct = (anySum / sampleSum) * 100;
if (anyPct < 70) failures.push(`someone on screen only ${anyPct.toFixed(1)}% of walking seconds (floor is 70%)`);

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`formation: ${failures.length} failed`);
  process.exit(1);
}
console.log("mirage formation: OK");
