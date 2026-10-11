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

/** An axe or mallet strike: a short knock of filtered noise over a low thud. */
export function thunk(tool = "axe") {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.12);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = tool === "axe" ? 1400 : 600; f.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t);
  src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(tool === "axe" ? 140 : 90, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(og); og.connect(ctx.destination); o.start(t); o.stop(t + 0.18);
}
