// sandbox-oracle-vs-deception
//
// CLAIM under test: in a system whose difficulty IS an information gap, a
// policy that reads ground truth is INVARIANT to the strength of the deception,
// so its success rate cannot price that mechanic — and a difficulty constant
// tuned against it lands somewhere lethal for a policy that is actually lied to.
//
// Fully deterministic: fixed layout from an integer hash, no RNG, no wall clock,
// every parameter passed in. Two policies over the same world, one reading
// truth, one reading a derived VIEW.

const GRID = 40;
const REAL_MARKERS = 6;

// Deterministic scatter — a hash, not a generator, so runs are reproducible and
// order-independent.
function place(i, salt) {
  const h = (i * 2654435761 + salt * 40503) >>> 0;
  return { x: (h % GRID), y: ((h >>> 8) % GRID) };
}

function makeWorld(seed) {
  const real = [];
  for (let i = 0; i < REAL_MARKERS; i++) real.push({ ...place(i, seed), real: true, id: `r${i}` });
  return { real };
}

/**
 * What a mind is SHOWN. `lieRate` is the deception strength: the expected number
 * of phantom markers per real one. Phantoms are indistinguishable at the point
 * of deciding where to walk — that is the whole mechanic — and evaporate when
 * you arrive.
 */
function viewOf(world, seed, lieRate) {
  const shown = world.real.map((m) => ({ ...m }));
  const phantoms = Math.round(REAL_MARKERS * lieRate);
  for (let i = 0; i < phantoms; i++) {
    shown.push({ ...place(i + 100, seed), real: false, id: `p${i}` });
  }
  return shown;
}

const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * Walk a nearest-first route over whatever this policy can see, spending one
 * step per unit of distance. Arriving at a phantom yields nothing; the travel is
 * still spent. Returns steps used, or Infinity if the budget ran out.
 *
 * `omniscient` is the ONLY difference between the two policies.
 */
function run(world, seed, lieRate, budget, omniscient) {
  const targets = omniscient ? world.real.map((m) => ({ ...m })) : viewOf(world, seed, lieRate);
  let at = { x: 0, y: 0 };
  let steps = 0;
  let logged = 0;
  const left = targets.slice();
  while (logged < REAL_MARKERS && left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (dist(at, left[i]) < dist(at, left[best])) best = i;
    const t = left.splice(best, 1)[0];
    steps += dist(at, t);
    at = { x: t.x, y: t.y };
    if (steps > budget) return { ok: false, steps: Infinity, logged };
    if (t.real) logged++;
  }
  return { ok: logged >= REAL_MARKERS && steps <= budget, steps, logged };
}

const SEEDS = 200;
function rate(lieRate, budget, omniscient) {
  let wins = 0;
  for (let s = 1; s <= SEEDS; s++) if (run(makeWorld(s), s, lieRate, budget, omniscient).ok) wins++;
  return wins / SEEDS;
}

// --- 1. Does deception strength move each policy's success rate? -------------
const BUDGET = 150;
console.log(`A. success rate vs deception strength (budget ${BUDGET}, ${SEEDS} seeds)`);
console.log("  lieRate   omniscient   deceived");
const omni = [], dec = [];
for (const lie of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
  const o = rate(lie, BUDGET, true);
  const d = rate(lie, BUDGET, false);
  omni.push(o); dec.push(d);
  console.log(`  ${String(lie).padEnd(8)}  ${(o * 100).toFixed(1).padStart(8)}%  ${(d * 100).toFixed(1).padStart(9)}%`);
}
const omniSpread = Math.max(...omni) - Math.min(...omni);
const decSpread = Math.max(...dec) - Math.min(...dec);
console.log(`  omniscient spread ${(omniSpread * 100).toFixed(1)}pp · deceived spread ${(decSpread * 100).toFixed(1)}pp`);

// --- 2. Tune the difficulty constant against each, then cross-apply ----------
// The real failure: a budget chosen so the ORACLE is pressured, handed to a
// player who is actually being lied to.
function budgetFor(target, omniscient, lie) {
  for (let b = 10; b <= 600; b += 1) if (rate(lie, b, omniscient) >= target) return b;
  return 600;
}
const LIE = 1;
const tunedOnOracle = budgetFor(0.5, true, LIE);
const tunedOnDeceived = budgetFor(0.5, false, LIE);
console.log(`\nB. budget where each policy first reaches a 50% win rate (lieRate ${LIE})`);
console.log(`  tuned against the oracle:   ${tunedOnOracle}`);
console.log(`  tuned against the deceived: ${tunedOnDeceived}`);
console.log(`  a deceived player handed the ORACLE's budget wins ${(rate(LIE, tunedOnOracle, false) * 100).toFixed(1)}%`);
console.log(`  ...and the oracle handed the DECEIVED budget wins ${(rate(LIE, tunedOnDeceived, true) * 100).toFixed(1)}%`);

// --- verdict ---------------------------------------------------------------
const reproduced =
  omniSpread < 0.02 &&
  decSpread > 0.30 &&
  rate(LIE, tunedOnOracle, false) < 0.10 &&
  tunedOnDeceived > tunedOnOracle;
console.log(`\nCLAIM ${reproduced ? "REPRODUCED" : "NOT reproduced"}`);
process.exit(reproduced ? 0 : 1);
