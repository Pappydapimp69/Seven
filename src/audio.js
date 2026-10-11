// audio.js — the sound of the woods, synthesised live: no sample files.
//
// One AudioContext, opened by the player's first press on the splash screen
// (browsers only start sound after a gesture). Everything routes through
// buses so effects and music can be turned off separately:
//
//   ambience (wind, birds, crickets, fire, pylon hum) ─┐
//   music (a slow generative pad and a few notes)      ├─► master ─► analyser ─► out
//   effects (strikes, voices, whistles, steps, UI)     ─┘      ▲
//                                    reverb (shared tail) ─────┘
//
// What the always-on layers do comes from soundscape.js, which only knows
// public facts (the woods you are in, night, fire, pylons) — never lucidity.

import { mixFor, scaleFor, placeSound, placeAngle, dirAngle, stepFor, uiSound } from "./soundscape.js?v=seven-1.17.0";

export const stats = { steps: 0, plays: 0, ui: 0 };
let muffle = null;
let ctx = null, master = null, analyser = null, sfx = null, music = null, amb = null, verb = null;
const wet = { sfx: null, amb: null, music: null };   // each bus's own send to the shared reverb, switched with it
let noiseBuf = null;
const settings = { music: true, sfx: true };
const live = { wind: null, windLfo: null, fireGain: null, firePan: null, hum: null, humGain: null, humPan: null, birdsGain: null, cricketsGain: null, musicGain: null };
let sched = null, nextNote = 0, nextChord = 0, chordRoot = 0, lastStep = 0, nextBird = 0, nextCricket = 0, nextCrackle = 0, nextOwl = 0;
let lastState = null, last = { x: 0, y: 0, t: 0 }, lastEase = 0;

/** Call from inside a user gesture. Safe to call again. */
export function unlock() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { ctx = new AC(); build(); setSettings({}); }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
export const state = () => (ctx ? ctx.state : "none");
export const context = () => ctx;

export function setSettings(s) {
  if (s.music != null) settings.music = !!s.music;
  if (s.sfx != null) settings.sfx = !!s.sfx;
  if (!ctx) return;
  const t = ctx.currentTime;
  sfx.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.05);
  amb.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.05);
  music.gain.setTargetAtTime(settings.music ? 1 : 0, t, 0.3);
  wet.sfx.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.05);
  wet.amb.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.05);
  wet.music.gain.setTargetAtTime(settings.music ? 1 : 0, t, 0.3);
}
export const getSettings = () => ({ ...settings });

/** RMS of what is going to the speakers right now, 0..1. For tests and for honesty. */
export function level() {
  if (!analyser) return 0;
  const d = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(d);
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / d.length);
}

// ---- the graph ----------------------------------------------------------------
function build() {
  master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
  muffle = ctx.createBiquadFilter(); muffle.type = "lowpass"; muffle.frequency.value = 20000; muffle.Q.value = 0.5;
  master.connect(muffle); muffle.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);
  sfx = ctx.createGain(); music = ctx.createGain(); amb = ctx.createGain();
  sfx.connect(master); music.connect(master); amb.connect(master);
  // One shared tail: generated noise that fades, so everything can sit in air.
  verb = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.6), imp = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
  verb.buffer = imp;
  const vg = ctx.createGain(); vg.gain.value = 0.55;
  verb.connect(vg); vg.connect(master);
  for (const k of Object.keys(wet)) { wet[k] = ctx.createGain(); wet[k].connect(verb); }
  // Noise to make wind, breath, strikes and crackle from.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0); let b0 = 0;
  for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; nd[i] = (w * 0.5 + b0 * 6) * 0.5; }
  startLayers();
}

const noiseSrc = (loop = true) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = loop; return s; };
function out(node, bus, { pan = 0, send = 0 } = {}) {
  const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(p); p.connect(bus || sfx);
  if (send > 0) { const g = ctx.createGain(); g.gain.value = send; p.connect(g); g.connect(bus === amb ? wet.amb : bus === music ? wet.music : wet.sfx); }
  return p;
}

function startLayers() {
  // Wind: filtered noise, its level slowly breathing.
  const w = noiseSrc(); const wf = ctx.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 420; wf.Q.value = 0.6;
  live.wind = ctx.createGain(); live.wind.gain.value = 0;
  w.connect(wf); wf.connect(live.wind); out(live.wind, amb, { send: 0.1 }); w.start();
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 140;
  lfo.connect(lg); lg.connect(wf.frequency); lfo.start();
  // Fire: a warm roar of band-passed noise (the crackle is scheduled in update()).
  const f = noiseSrc(); const ff = ctx.createBiquadFilter(); ff.type = "bandpass"; ff.frequency.value = 650; ff.Q.value = 0.5;
  live.fireGain = ctx.createGain(); live.fireGain.gain.value = 0;
  f.connect(ff); ff.connect(live.fireGain); live.firePan = out(live.fireGain, amb, { send: 0.12 }); f.start();
  // Pylon hum: two close sines, beating.
  live.hum = [ctx.createOscillator(), ctx.createOscillator()];
  live.humGain = ctx.createGain(); live.humGain.gain.value = 0;
  live.hum.forEach((o, i) => { o.type = "sine"; o.frequency.value = 140 * (i ? 1.006 : 1); o.connect(live.humGain); o.start(); });
  live.humPan = out(live.humGain, amb, { send: 0.2 });
  // Birds and crickets are scheduled one chirp at a time; these are their buses.
  live.birdsGain = ctx.createGain(); live.birdsGain.gain.value = 0; out(live.birdsGain, amb, { send: 0.25 });
  live.cricketsGain = ctx.createGain(); live.cricketsGain.gain.value = 0; out(live.cricketsGain, amb, { send: 0.05 });
  // Music: a drone pad under the notes.
  live.musicGain = ctx.createGain(); live.musicGain.gain.value = 0;
  live.musicGain.connect(music);
  const mv = ctx.createGain(); mv.gain.value = 0.6; live.musicGain.connect(mv); mv.connect(wet.music);
  live.pad = [0, 0, 0].map(() => { const o = ctx.createOscillator(); o.type = "sine"; const g = ctx.createGain(); g.gain.value = 0.33; o.connect(g); g.connect(live.musicGain); o.start(); return o; });
  nextNote = ctx.currentTime + 1; nextChord = 0;
  sched = setInterval(schedule, 250);
}

// ---- always-on layers: scheduled pieces ---------------------------------------
function schedule() {
  if (!ctx || ctx.state !== "running" || !lastState) return;
  const t = ctx.currentTime, st = lastState, mix = mixFor(st), sc = scaleFor(st.area, st.night);
  // Pad: a root and its fifth and ninth, re-voiced every sixteen seconds.
  if (t >= nextChord) {
    nextChord = t + 16;
    chordRoot = sc.intervals[Math.floor(Math.random() * sc.intervals.length)];
    const base = sc.root * 2 ** (chordRoot / 12);
    [base * 0.5, base * 0.75, base * (st.area >= 6 ? 1.414 : 1.5)].forEach((f, i) => live.pad[i].frequency.setTargetAtTime(f, t, 2.5));
  }
  // Notes: a few, far apart, long in the air.
  while (nextNote < t + 0.6) {
    const gap = (60 / sc.tempo) * (2 + Math.random() * 4);
    if (Math.random() < sc.density && settings.music) {
      const deg = sc.intervals[Math.floor(Math.random() * sc.intervals.length)];
      const f = sc.root * 2 ** ((deg + (Math.random() < 0.3 ? 12 : 0)) / 12) * (st.area >= 6 && Math.random() < 0.2 ? 1.0594 : 1);
      note(f, Math.max(nextNote, t), 3.2, 0.5);
    }
    nextNote += gap;
  }
  // Birds by day, crickets and the odd owl by night.
  if (t >= nextBird && mix.birds > 0.05) { chirp(t + Math.random() * 0.3); nextBird = t + 1.5 + Math.random() * (5 + 8 * (1 - mix.birds)); }
  if (t >= nextCricket && mix.crickets > 0.05) { cricket(t); nextCricket = t + 0.9 + Math.random() * 1.6; }
  if (t >= nextOwl && st.night && st.area <= 4) { owl(t + Math.random()); nextOwl = t + 18 + Math.random() * 30; }
  // Fire crackle: sharp little pops when a fire is near.
  if (t >= nextCrackle && mix.fire > 0.05) { crackle(t, mix.fire); nextCrackle = t + 0.05 + Math.random() * 0.35; }
}

function note(f, at, len, gain) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine"; o2.type = "sine"; o.frequency.value = f; o2.frequency.value = f * 2.003;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.22 * gain, at + 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g); o2.connect(g); g.connect(live.musicGain);
  o.start(at); o2.start(at); o.stop(at + len + 0.1); o2.stop(at + len + 0.1);
}

function chirp(at) {
  const n = 2 + Math.floor(Math.random() * 3), base = 2400 + Math.random() * 1800;
  for (let i = 0; i < n; i++) {
    const t = at + i * 0.11, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(base * (1 + i * 0.05), t); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.07);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(live.birdsGain); o.start(t); o.stop(t + 0.1);
  }
}
function cricket(at) {
  const o = ctx.createOscillator(), g = ctx.createGain(), am = ctx.createOscillator(), ag = ctx.createGain();
  o.type = "sine"; o.frequency.value = 4200 + Math.random() * 500;
  am.frequency.value = 28; ag.gain.value = 0.5; g.gain.value = 0.5; am.connect(ag); ag.connect(g.gain);
  const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(0.2, at + 0.05); env.gain.setValueAtTime(0.2, at + 0.35); env.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
  o.connect(g); g.connect(env); env.connect(live.cricketsGain);
  o.start(at); am.start(at); o.stop(at + 0.55); am.stop(at + 0.55);
}
function owl(at) {
  [[390, 0], [330, 0.55]].forEach(([f, dt]) => {
    const t = at + dt, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.93, t + 0.4);
    lp.type = "lowpass"; lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(lp); lp.connect(g); out(g, amb, { pan: Math.random() * 1.6 - 0.8, send: 0.7 }); o.start(t); o.stop(t + 0.55);
  });
}
function crackle(at, level) {
  const s = noiseSrc(false), g = ctx.createGain(), hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 1800 + Math.random() * 2500;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.55 * level * (0.4 + Math.random() * 0.8), at + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.04);
  s.connect(hp); hp.connect(g); g.connect(live.firePan);
  s.start(at, Math.random() * 1.5, 0.1);
}

// ---- the per-frame update ------------------------------------------------------
/**
 * st: { area, night, daylight, lead:{x,y,yaw}, fire:{x,y,fuel}|null, lit:[{x,y,age}], ground, busy, panelOpen }
 * dt: real seconds since the last frame.
 */
export function update(st, dt) {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime, L = st.lead;
  const fire = st.fire ? placeSound(L, L.yaw, st.fire) : null;
  let lit = null, litAge = 0;
  for (const p of st.lit) { const d = Math.hypot(p.x - L.x, p.y - L.y); if (!lit || d < lit.dist) { lit = { ...placeSound(L, L.yaw, p), dist: d }; litAge = p.age; } }
  lastState = { ...st, fireDist: fire ? fire.dist : null, fireFuel: st.fire ? st.fire.fuel : 0, litDist: lit ? lit.dist : null, litAge };
  // The layers' levels move slowly, so they are set ten times a second, not
  // every frame: each setTargetAtTime adds an event to the audio timeline.
  const nowS = performance.now() / 1000;
  const m = mixFor(lastState);
  const ease = (param, v, k = 0.35) => param.setTargetAtTime(v, t, k);
  if (nowS - lastEase >= 0.1) { lastEase = nowS; layers(m, t, ease, fire, lit); }
  footsteps(st, L);
}

function layers(m, t, ease, fire, lit) {
  ease(live.wind.gain, m.wind, 1.2);
  ease(live.birdsGain.gain, m.birds, 1);
  ease(live.cricketsGain.gain, m.crickets, 1);
  ease(live.fireGain.gain, m.fire * 0.5);
  if (fire) live.firePan.pan.setTargetAtTime(fire.pan * Math.min(1, 0.4 + fire.dist / 10), t, 0.1);
  ease(live.humGain.gain, m.hum * 0.12);
  if (lit) live.humPan.pan.setTargetAtTime(lit.pan, t, 0.1);
  live.hum.forEach((o, i) => o.frequency.setTargetAtTime(m.humPitch * (i ? 1.006 : 1), t, 0.5));
  ease(live.musicGain.gain, m.music, 2);
  muffle.frequency.setTargetAtTime(m.muffle, t, 0.6);
}

function footsteps(st, L) {
  // Footsteps: from how far the lead has really moved, not from any button.
  const now = performance.now() / 1000;
  const moved = Math.hypot(L.x - last.x, L.y - last.y), gone = now - last.t;
  last = { x: L.x, y: L.y, t: now };
  if (gone > 0 && gone < 0.5 && moved / gone > 0.9 && !st.busy && settings.sfx) {
    const s = stepFor(st.ground);
    if (now - lastStep >= s.gap) { lastStep = now; step(s); }
  }
}

function step(s) {
  stats.steps++;
  const t = ctx.currentTime, src = noiseSrc(false), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = "bandpass"; f.frequency.value = s.freq * (0.85 + Math.random() * 0.3); f.Q.value = 0.9;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28 * s.gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  src.connect(f); f.connect(g); out(g, sfx, { pan: (Math.random() - 0.5) * 0.15 });
  src.start(t, Math.random() * 1.5, 0.14);
}

// ---- sounds the sim announces ---------------------------------------------------
/** Play what the sim announced this frame. `lead` is {x, y, yaw}. */
export function play(ev, lead) {
  if (!ctx || ctx.state !== "running" || !settings.sfx) return;
  stats.plays++;
  const t = ctx.currentTime;
  const at = (ev.x != null ? placeSound(lead, lead.yaw, ev) : ev.dir ? placeAngle(dirAngle(ev.dir), lead.yaw) : { pan: 0, front: 1, dist: 0 });
  switch (ev.name) {
    case "whistle": whistle(t, 0, 1, ev.sig); break;
    case "answer": whistle(t, at.pan, 0.35 + 0.25 * at.front, ev.sig, true); break;
    case "hear": whistle(t, ev.pan || 0, 0.7, ev.sig, true); break;
    case "voice": voice(t, at); break;
    case "treefall": treefall(t, at); break;
    case "crack": crack(t, at); break;
    case "fire": whoosh(t); break;
    case "camp": mallets(t, 3); break;
    case "pylon": shimmer(t, true); break;
    case "pylon_dead": shimmer(t, false); break;
    case "found": chime(t, [523, 659], 0.16); break;
    case "twin": tension(t); break;
    case "dawn": dawn(t); break;
    case "dusk": chime(t, [196, 147], 0.2, 2.4); break;
    case "home": chime(t, [392, 494, 587, 784], 0.15, 2.8); break;
    case "dark": chime(t, [196, 185, 147], 0.17, 2.4); break;
    default: break;
  }
}

const DEFAULT_SIG = { reg: 1, jump: 1.5, pace: 1, shape: "rise" };

/**
 * A whistle, in the whistler's own way (whistle.js): a pure tone whose register,
 * leap and pace are theirs, in one of four contours — rise, leap, trill, call —
 * with a breath of noise and air round it so it carries and echoes back.
 */
function whistle(t, pan, gain, sig = DEFAULT_SIG, soft = false) {
  const base = 1750 * sig.reg * (soft ? 0.96 : 1), P = sig.pace, J = sig.jump;
  const len = 0.72 * P;
  const o = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
  o.type = "sine";
  const at = (f, when) => o.frequency.exponentialRampToValueAtTime(Math.max(300, f), t + when);
  const set = (f, when) => o.frequency.setValueAtTime(Math.max(300, f), t + when);
  if (sig.shape === "leap") { set(base * 0.8, 0); set(base * 0.8, 0.16 * P); at(base * J * 1.05, 0.2 * P); set(base * J * 1.05, 0.5 * P); at(base * J, len); }
  else if (sig.shape === "trill") { set(base, 0); for (let i = 0; i < 5; i++) { set(base * (i % 2 ? 1 : J * 0.9), (0.04 + i * 0.09) * P); } set(base * J * 0.9, 0.5 * P); at(base * 1.1, len); }
  else if (sig.shape === "call") { set(base * J, 0); set(base * J, 0.26 * P); at(base, 0.3 * P); set(base, len); }
  else { set(base, 0); at(base * J, 0.22 * P); set(base * J, 0.3 * P); at(base * 1.18, len); }
  vib.frequency.value = 6.5; vg.gain.value = 18; vib.connect(vg); vg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32 * gain, t + 0.05);
  g.gain.setValueAtTime(0.32 * gain, t + 0.3 * P); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
  o.connect(g);
  const br = noiseSrc(false), bf = ctx.createBiquadFilter(), bg = ctx.createGain();
  bf.type = "bandpass"; bf.frequency.value = base * 1.3; bf.Q.value = 3;
  bg.gain.setValueAtTime(0.0001, t); bg.gain.exponentialRampToValueAtTime(0.07 * gain, t + 0.05); bg.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
  br.connect(bf); bf.connect(bg);
  const bus = ctx.createGain(); bus.gain.value = 1; g.connect(bus); bg.connect(bus);
  out(bus, sfx, { pan, send: soft ? 0.7 : 0.5 });
  // The echo: it goes out through the trees and comes back, twice, duller each time.
  const d = ctx.createDelay(1.5), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), eg = ctx.createGain();
  d.delayTime.value = soft ? 0.5 : 0.38; fb.gain.value = soft ? 0.25 : 0.42; lp.type = "lowpass"; lp.frequency.value = 2600; eg.gain.value = 0.7;
  bus.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(eg); out(eg, sfx, { pan: -pan * 0.5, send: 0.5 });
  o.start(t); vib.start(t); br.start(t, Math.random(), 0.8); o.stop(t + len + 0.2); vib.stop(t + len + 0.2);
  setTimeout(() => { try { eg.disconnect(); d.disconnect(); fb.disconnect(); } catch { /* gone already */ } }, 3500);
}

/** A voice in the trees: a held vowel that opens and closes, far off, in air. Identical for every caller. */
function voice(t, at) {
  const o = ctx.createOscillator(), g = ctx.createGain(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), vib = ctx.createOscillator(), vg = ctx.createGain();
  o.type = "sawtooth"; o.frequency.setValueAtTime(175, t); o.frequency.linearRampToValueAtTime(215, t + 0.9); o.frequency.linearRampToValueAtTime(160, t + 2.1);
  vib.frequency.value = 5.2; vg.gain.value = 5; vib.connect(vg); vg.connect(o.frequency);
  f1.type = "bandpass"; f1.Q.value = 6; f1.frequency.setValueAtTime(420, t); f1.frequency.linearRampToValueAtTime(760, t + 0.9); f1.frequency.linearRampToValueAtTime(380, t + 2.1);
  f2.type = "bandpass"; f2.Q.value = 8; f2.frequency.setValueAtTime(900, t); f2.frequency.linearRampToValueAtTime(1150, t + 0.9); f2.frequency.linearRampToValueAtTime(820, t + 2.1);
  const far = Math.min(1, (at.dist || 12) / 30), mix = ctx.createGain(); mix.gain.value = 1;
  o.connect(f1); o.connect(f2); f1.connect(mix); f2.connect(mix);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400 - 1200 * (1 - (at.front + 1) / 2);
  mix.connect(lp); lp.connect(g);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * (1 - 0.4 * far), t + 0.4); g.gain.setValueAtTime(0.4 * (1 - 0.4 * far), t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
  out(g, sfx, { pan: at.pan, send: 0.9 });
  o.start(t); vib.start(t); o.stop(t + 2.4); vib.stop(t + 2.4);
}

function noiseBurst(t, { freq = 900, q = 0.8, len = 0.3, gain = 0.4, type = "bandpass", pan = 0, send = 0.2, attack = 0.01 }) {
  const s = noiseSrc(false), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(f); f.connect(g); out(g, sfx, { pan, send }); s.start(t, Math.random() * 1.2, len + 0.1);
}
function treefall(t, at) {
  noiseBurst(t, { freq: 260, q: 0.5, len: 0.9, gain: 0.5, pan: at.pan });               // the creak and lean
  noiseBurst(t + 0.7, { freq: 160, q: 0.4, len: 0.7, gain: 0.7, type: "lowpass", pan: at.pan, send: 0.5 });   // the fall
  noiseBurst(t + 1.0, { freq: 2200, q: 0.7, len: 0.6, gain: 0.25, pan: at.pan, send: 0.4 });                  // leaves
}
function crack(t, at) {
  noiseBurst(t, { freq: 3000, q: 0.6, len: 0.12, gain: 0.7, pan: at.pan });
  noiseBurst(t + 0.12, { freq: 120, q: 0.4, len: 1.4, gain: 0.8, type: "lowpass", pan: at.pan, send: 0.6 });
}
function whoosh(t) {
  noiseBurst(t, { freq: 500, q: 0.4, len: 1.1, gain: 0.45, attack: 0.25, send: 0.3 });
  for (let i = 0; i < 6; i++) crackleAt(t + 0.3 + i * 0.09);
}
function crackleAt(t) { noiseBurst(t, { freq: 2500 + Math.random() * 2000, q: 0.5, len: 0.04, gain: 0.35, type: "highpass", attack: 0.002 }); }
function mallets(t, n) { for (let i = 0; i < n; i++) noiseBurst(t + i * 0.6, { freq: 600, q: 1.2, len: 0.12, gain: 0.4 }); }
function chime(t, notes, gain = 0.16, len = 2) {
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), at = t + i * 0.18;
    o.type = "sine"; o2.type = "sine"; o.frequency.value = f; o2.frequency.value = f * 2.76;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); const g2 = ctx.createGain(); g2.gain.value = 0.15; o2.connect(g2); g2.connect(g);
    out(g, sfx, { send: 0.6 }); o.start(at); o2.start(at); o.stop(at + len + 0.1); o2.stop(at + len + 0.1);
  });
}
function shimmer(t, good) {
  const notes = good ? [392, 494, 587, 740, 988] : [370, 311, 262, 220, 165];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), at = t + i * 0.09;
    o.type = good ? "sine" : "triangle"; o.frequency.setValueAtTime(f, at); if (!good) o.frequency.exponentialRampToValueAtTime(f * 0.7, at + 1.2);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(good ? 0.14 : 0.1, at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
    o.connect(g); out(g, sfx, { send: 0.7 }); o.start(at); o.stop(at + 1.7);
  });
}
function tension(t) {
  [110, 116.5, 164.8].forEach((f) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    o.connect(lp); lp.connect(g); out(g, sfx, { send: 0.5 }); o.start(t); o.stop(t + 3.5);
  });
}
function dawn(t) {
  chime(t, [262, 330, 392], 0.1, 3);
  for (let i = 0; i < 4; i++) chirp(t + 0.4 + i * 0.5 + Math.random() * 0.3);
}

// ---- interface -----------------------------------------------------------------
export function ui(kind) {
  if (!ctx || ctx.state !== "running" || !settings.sfx) return;
  stats.ui++;
  const t = ctx.currentTime, u = uiSound(kind);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = u.lp; lp.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(u.gain, t + u.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + u.len);
  lp.connect(g);
  for (const f of u.freqs) { const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + u.len + 0.05); }
  out(g, sfx, { send: 0.05 });
}

/** The studio's sting, and proof that sound is allowed. */
export function sting() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createGain();
  o.gain.setValueAtTime(0.0001, t);
  o.gain.exponentialRampToValueAtTime(0.18, t + 0.08);
  o.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  o.connect(master);
  for (const [f, d] of [[110, 0], [164.8, 0.004], [220, -0.003]]) {
    const s = ctx.createOscillator();
    s.type = "sine"; s.frequency.setValueAtTime(f * (1 + d), t);
    s.connect(o); s.start(t); s.stop(t + 2.3);
  }
}

/** An axe or mallet strike: a short knock of filtered noise over a low thud. */
export function thunk(tool = "axe") {
  if (!ctx || ctx.state !== "running" || !settings.sfx) return;
  const t = ctx.currentTime;
  noiseBurst(t, { freq: tool === "axe" ? 1400 : 600, q: 1.2, len: 0.12, gain: 0.35, send: 0.15 });
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(tool === "axe" ? 140 : 90, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(og); out(og, sfx); o.start(t); o.stop(t + 0.18);
}

document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});
