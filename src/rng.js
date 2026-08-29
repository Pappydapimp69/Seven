// rng.js — seeded deterministic randomness. Pure; no DOM, no Three.
//
// Every random draw in SEVEN goes through one of these so a run is
// reproducible from its seed: world generation, drain-rate jitter, which
// hallucination a character gets, what a fraying companion claims to see. Tests
// pin the seed and get the same run twice.

// mulberry32 — small, fast, good enough spread for level gen and behaviour.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.float = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)); // inclusive
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  next.shuffled = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  // Save/load of the generator's RAW STATE WORD, not a count of draws to
  // replay. mulberry32's whole state is the single 32-bit `a`, so restoring a
  // mid-run stream is O(1) and exact — replaying N draws to catch up would be
  // O(N) and would drift the moment any code path's draw count changed
  // (Brain: the-game-prologue#E1, test#E2).
  //
  // restore() deliberately does NOT apply makeRng's `|| 1` seed guard: 0 is a
  // legitimate mid-stream value of `a` (it steps by a fixed odd addend through
  // the whole 32-bit space), and silently rewriting it to 1 would fork the
  // stream on exactly one save in four billion — the kind of bug that only
  // ever shows up as an unreproducible "my save loaded wrong".
  next.snapshot = () => a >>> 0;
  next.restore = (word) => { a = word >>> 0; };
  return next;
}

// Turn an arbitrary string into a usable 32-bit seed (for shareable run codes).
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
