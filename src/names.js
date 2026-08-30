// names.js — party names, composed rather than chosen. Pure; no DOM, no Three.
//
// THE WOODS needs a party whose names the player has never seen before, every
// run. A picked-from-a-list name is a name the player recognises by run ten,
// and recognition is the enemy here: the whole investigation rests on the
// player holding five unfamiliar names in their head for one night, so the
// names have to be unfamiliar and they have to be DIFFERENT unfamiliar every
// time.
//
// They are composed from fragments — onset, nucleus, coda — under adjacency
// rules, so the space is large and every point in it is pronounceable. That
// second property is not decoration: an unpronounceable name is not held in
// memory, it is held as a shape, and a player comparing shapes is doing OCR
// rather than recall.
//
// Every draw goes through the caller's rng. Nothing here reads the clock, the
// device, or module-level state — a run's roster is a pure function of its
// seed, which is what lets a save be resumed and a test be written.

// Onsets. Split by what may follow a coda: the CLUSTERS are the ones that need
// a vowel or a soft coda in front of them to stay sayable.
const ONSET_SIMPLE = ["b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "y", "z"];
const ONSET_CLUSTER = ["br", "dr", "fl", "gr", "kr", "pl", "sk", "sl", "st", "th", "tr", "vr"];

// Nuclei. The long ones carry a syllable on their own and read as stressed,
// which is what keeps a three-syllable name from turning to mush.
const NUCLEUS_SHORT = ["a", "e", "i", "o", "u"];
const NUCLEUS_LONG = ["ae", "ai", "au", "ea", "ei", "ia", "ie", "oa", "oi", "ou", "ua"];

// Codas. SOFT ones may be followed by any onset; HARD ones may only be
// followed by a simple onset, and never by one that repeats them.
const CODA_NONE = "";
const CODA_SOFT = ["l", "m", "n", "r", "s"];
const CODA_HARD = ["ct", "ft", "k", "ld", "lm", "nd", "nt", "rk", "rn", "sk", "st", "t", "th"];

const ALL_ONSETS = ONSET_SIMPLE.concat(ONSET_CLUSTER);

/** May `coda` be followed by `onset`? The rules that keep it sayable. */
export function mayFollow(coda, onset) {
  if (coda === CODA_NONE) return true;
  // A hard coda plus a cluster onset is four consonants in a row.
  if (ONSET_CLUSTER.includes(onset) && CODA_HARD.includes(coda)) return false;
  // No consonant repeated across the seam ("st"+"st", "n"+"n") — it either
  // collapses in speech or reads as a typo, and a name that reads as a typo is
  // poison in a game where a one-letter change is a clue.
  if (coda[coda.length - 1] === onset[0]) return false;
  return true;
}

/**
 * One name. `syllables` defaults to a 2-or-3 draw.
 *
 * CONSTANT ROLL COUNT: this always consumes exactly 13 draws from `rng`,
 * whatever it returns. The syllable count, and every fragment for a possible
 * third syllable, is drawn UNCONDITIONALLY and used conditionally — a name
 * generator that drew fewer numbers for a shorter name would fork every
 * resumed run whose roster happened to come out short.
 */
export function makeName(rng) {
  const three = rng() < 0.34;
  const parts = [];
  let coda = CODA_NONE;
  for (let s = 0; s < 3; s++) {
    // Four draws per syllable, always taken.
    const rOnset = rng();
    const rNucleus = rng();
    const rLong = rng();
    const rCoda = rng();
    if (s === 2 && !three) continue; // drawn, not used

    const allowed = ALL_ONSETS.filter((o) => mayFollow(coda, o));
    const onset = allowed[Math.floor(rOnset * allowed.length)];
    // At most ONE long nucleus per name, and never in a three-syllable one.
    // Two diphthongs in a row is where a composed name stops being a word and
    // starts being a licence plate.
    const long = rLong < 0.3 && !three && s === 0;
    const pool = long ? NUCLEUS_LONG : NUCLEUS_SHORT;
    const nucleus = pool[Math.floor(rNucleus * pool.length)];
    // The last syllable is the only one that may end hard; an interior hard
    // coda plus the next onset is where names stop being sayable.
    const last = s === (three ? 2 : 1);
    const codaPool = last
      ? [CODA_NONE].concat(CODA_SOFT, CODA_HARD)
      : [CODA_NONE, CODA_NONE, CODA_NONE, CODA_NONE].concat(CODA_SOFT);
    coda = codaPool[Math.floor(rCoda * codaPool.length)];
    parts.push(onset + nucleus + coda);
  }
  return parts.join("").toUpperCase();
}

/**
 * `count` distinct names. Distinctness is checked on more than equality: two
 * names one letter apart are a REAL TELL in this game (a fake's account can
 * name someone almost right), so the roster itself must never contain a pair
 * that close, or the tell is unreadable.
 *
 * CONSTANT ROLL COUNT: `attempts` names are always generated and the rejects
 * are discarded, so the draw count is fixed at `attempts * 13` however many
 * collisions occur. Rejecting-and-redrawing would make the count depend on the
 * seed, which is the same fork this file is written to avoid.
 */
export const NAME_MIN = 4;
export const NAME_MAX = 8;

export function makeRoster(rng, count, attempts = count * 12, gen = makeName) {
  // `gen` is a seam for tests, not a feature. The distinctness rule below can
  // only be exercised by a stream that actually collides, and 500 natural
  // seeds have never produced one — so without a way to inject a colliding
  // stream, the rule is a guard that has never been observed to fail.
  const out = [];
  for (let i = 0; i < attempts; i++) {
    const n = gen(rng);
    if (out.length >= count) continue; // still drawn, just not kept
    // Length is a memory rule, not a taste one. The player has to carry five
    // of these overnight; a twelve-letter name is carried as a silhouette,
    // and silhouettes cannot be compared one letter at a time.
    if (n.length < NAME_MIN || n.length > NAME_MAX) continue;
    if (out.some((o) => editDistance(o, n) <= 1)) continue;
    out.push(n);
  }
  // Astronomically unlikely, but a roster that comes up short would be a
  // silent party-size change rather than a crash, so make it loud.
  if (out.length < count) throw new Error(`roster came up short: ${out.length}/${count}`);
  return out;
}

/**
 * Optimal string alignment — Levenshtein PLUS adjacent transposition, small
 * strings only.
 *
 * The transposition is not a refinement, it is the point. A swapped pair of
 * letters is the most natural misspelling there is and it is one of the tells
 * this game generates ("PONVRIK" told as "PNOVRIK"). Plain Levenshtein scores
 * that as TWO edits, which means a plain-Levenshtein distinctness rule would
 * happily put two transposition-apart names in the same roster while a
 * plain-Levenshtein near-miss check would reject the tell it just produced.
 * Both halves have to count a swap the way a reader does, or they disagree.
 */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * A name ALMOST right — the "name slightly off" tell from the design note.
 *
 * Derived from the name itself, never from a list of misspellings: swap two
 * adjacent letters, or substitute one vowel for another, or one consonant for
 * its near neighbour. The result must be exactly one edit away and must not
 * collide with any name in `avoid`, so the perturbed name is wrong about a
 * person rather than right about a different one.
 *
 * Returns null when no legal near-miss exists, which callers must handle by
 * choosing a different tell rather than by shipping the name unchanged.
 */
const VOWELS = "AEIOU";
const NEIGHBOUR = { B: "P", P: "B", D: "T", T: "D", K: "G", G: "K", F: "V", V: "F", S: "Z", Z: "S", M: "N", N: "M", L: "R", R: "L", H: "K", Y: "I" };

export function nearMiss(rng, name, avoid = []) {
  const cands = [];
  for (let i = 0; i + 1 < name.length; i++) {
    if (name[i] === name[i + 1]) continue;
    cands.push(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2));
  }
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (VOWELS.includes(c)) {
      for (const v of VOWELS) if (v !== c) cands.push(name.slice(0, i) + v + name.slice(i + 1));
    } else if (NEIGHBOUR[c]) {
      cands.push(name.slice(0, i) + NEIGHBOUR[c] + name.slice(i + 1));
    }
  }
  const legal = cands.filter((c) => c !== name && !avoid.includes(c));
  // One draw, always taken, so the caller's roll count does not depend on
  // whether a near-miss happened to exist.
  const r = rng();
  if (!legal.length) return null;
  return legal[Math.floor(r * legal.length)];
}

export const FRAGMENTS = Object.freeze({
  ONSET_SIMPLE, ONSET_CLUSTER, NUCLEUS_SHORT, NUCLEUS_LONG, CODA_SOFT, CODA_HARD,
});
