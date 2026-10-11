// whistle.js — everyone whistles their own way. Pure; no audio, no rng.
//
// A signature is four plain numbers and a shape, DERIVED from (seed, who) by a
// hash, so it is the same every time and costs no draw from the run's stream.
// A fake whistles the one it replaced with exactly ONE thing slightly off — a
// semitone, a narrower leap, a different pace. Derived the same way (from the
// seed, the person, and the day they were replaced), never from a list.
//
// What an announced sound carries is the final numbers only. Nothing in it says
// whose is real: the tell is only that it is not quite how they used to sound,
// and only your memory has the way they used to sound.

import { hash01 } from "./rng.js?v=seven-1.15.0";

export const SHAPES = Object.freeze(["rise", "leap", "trill", "call"]);
export const SEMITONE = 2 ** (1 / 12);

/** How `who` whistles when they are who they are. who: "lead" or a companion id. */
export function signature(seed, who) {
  const h = (k) => hash01(`${seed}:${who}:whistle:${k}`);
  return {
    reg: +(0.8 + 0.55 * h("reg")).toFixed(4),        // register: 0.8..1.35 × 1750 Hz
    jump: +(1.25 + 0.4 * h("jump")).toFixed(4),      // how far the tone leaps
    pace: +(0.75 + 0.6 * h("pace")).toFixed(4),      // 0.75 quick .. 1.35 slow
    shape: SHAPES[Math.floor(h("shape") * SHAPES.length)],
  };
}

export const BENDS = Object.freeze(["reg", "jump", "pace"]);

/** The same whistle with exactly one thing slightly off. `since` is the day they were replaced. */
export function bend(sig, seed, who, since) {
  const which = BENDS[Math.floor(hash01(`${seed}:${who}:bend:${since}`) * BENDS.length)];
  const sign = hash01(`${seed}:${who}:bendsign:${since}`) < 0.5 ? -1 : 1;
  const out = { ...sig };
  if (which === "reg") out.reg = +(sig.reg * SEMITONE ** sign).toFixed(4);        // a semitone up or down
  if (which === "jump") out.jump = +(sig.jump - (sig.jump - 1) * 0.28).toFixed(4); // a narrower leap
  if (which === "pace") out.pace = +(sig.pace * (1 + 0.2 * sign)).toFixed(4);      // a fifth faster or slower
  return { sig: out, which };
}

/** What `m` actually sounds like now (real, or the fake's bent copy). */
export function whistleOf(sim, m) {
  const real = signature(sim.seed, m.id);
  return m.fake ? bend(real, sim.seed, m.id, m.since).sig : real;
}

/** The keys on which two whistles differ. */
export const differs = (a, b) => ["reg", "jump", "pace", "shape"].filter((k) => a[k] !== b[k]);
