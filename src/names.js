// names.js — names composed from syllables, never picked from a list, so a
// player cannot recognise them by run ten. Every draw goes through the run's
// rng: a roster is a pure function of the seed. Short and sayable on purpose:
// a name that cannot be said is held as a shape, not remembered.

const ONSETS = ["b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z", "br", "dr", "gr", "st", "th", "tr"];
const VOWELS = ["a", "a", "e", "e", "i", "o", "o", "u", "ai", "ea", "ou"];
const MIDS = ["", "", "", "l", "n", "r"];
const ENDS = ["", "", "l", "m", "n", "r", "s", "k", "th"];

export function composeName(rng) {
  const three = rng.next() < 0.2;
  let s = rng.pick(ONSETS) + rng.pick(VOWELS) + rng.pick(MIDS);
  s += rng.pick(ONSETS.slice(0, 15)) + rng.pick(VOWELS);
  if (three) s += rng.pick(ONSETS.slice(0, 15)) + rng.pick(VOWELS.slice(0, 8));
  s += rng.pick(ENDS);
  s = s.replace(/(.)\1\1/g, "$1$1");
  if (s.length > 8) s = s.slice(0, 8).replace(/[^aeiou]+$/, "");
  return s[0].toUpperCase() + s.slice(1);
}

/** `count` distinct names that do not share a first letter (easier to hold). */
export function composeRoster(rng, count) {
  const out = [];
  for (let guard = 0; out.length < count && guard < 500; guard++) {
    const n = composeName(rng);
    if (out.some((o) => o[0] === n[0])) continue;
    out.push(n);
  }
  while (out.length < count) out.push(composeName(rng) + out.length);
  return out;
}

/** A name a letter off: two inner letters swapped, for a bent account. */
export function nameOff(name) {
  const a = name.split("");
  for (let i = Math.floor(a.length / 2); i < a.length - 1; i++) {
    if (a[i] !== a[i + 1]) { [a[i], a[i + 1]] = [a[i + 1], a[i]]; return a.join(""); }
  }
  return name + (name.endsWith("a") ? "e" : "a");
}
