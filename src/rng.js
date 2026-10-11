// rng.js — one seeded stream per run. mulberry32: 32 bits of state, so a save
// stores one integer and resumes the stream exactly.

export function createRng(seed) {
  let s = seed >>> 0;
  const rng = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(lo, hi) { return lo + Math.floor(rng.next() * (hi - lo + 1)); },
    pick(list) { return list[Math.floor(rng.next() * list.length)]; },
    get state() { return s; },
    set state(v) { s = v >>> 0; },
  };
  return rng;
}

/** A stable hash of a string to [0,1). For choices that must NOT draw from the stream. */
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
