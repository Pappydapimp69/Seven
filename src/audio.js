// audio.js — one AudioContext, opened by the player's first press on the
// splash screen. Browsers only let a page start sound after a user gesture;
// opening the context there means every later sound can play at once.

let ctx = null;

/** Call from inside a user gesture. Safe to call again. */
export function unlock() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
export const state = () => (ctx ? ctx.state : "none");
export const context = () => ctx;

/** A low, soft note — the studio's sting, and proof that sound is allowed. */
export function sting() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.18, t + 0.08);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  out.connect(ctx.destination);
  for (const [f, d] of [[110, 0], [164.8, 0.004], [220, -0.003]]) {
    const o = ctx.createOscillator();
    o.type = "sine"; o.frequency.setValueAtTime(f * (1 + d), t);
    o.connect(out); o.start(t); o.stop(t + 2.3);
  }
}
