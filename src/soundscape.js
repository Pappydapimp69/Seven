// soundscape.js — what the woods should sound like, as PURE functions. No audio
// nodes, no DOM, so every rule here is testable in node.
//
// THE RULE: sound is built from the PERCEPT and from public facts only — which
// woods you are in, whether it is night, where the fire and the pylons are.
// Never from lucidity. The hidden meter does not reach the screen, and a music
// that frowns as your mind goes would be that meter in your ears. Depth is a
// PLACE (IDEAS: "the hidden meter becomes a PLACE"), so the music follows the
// place: deeper woods sound lower, sparser and stranger — for everyone, whether
// or not they are well.

import { DIRS8 } from "./config.js?v=seven-1.12.1";

/** World angle of a compass word. y grows south, so north is -y. */
export function dirAngle(dir) {
  const i = DIRS8.indexOf(dir);
  return i < 0 ? 0 : -Math.PI / 2 + (i * Math.PI) / 4;
}

/**
 * Where a sound seems to come from, to a listener at `lead` facing `yaw`:
 * pan -1 (left) .. 1 (right), front 1 (ahead) .. -1 (behind), dist in cells.
 * Right of the way you face is yaw + 90° on this grid.
 */
export function placeSound(lead, yaw, src) {
  const dx = src.x - lead.x, dy = src.y - lead.y;
  const a = Math.atan2(dy, dx) - yaw;
  return { pan: Math.sin(a), front: Math.cos(a), dist: Math.hypot(dx, dy) };
}
export function placeAngle(angle, yaw) {
  const a = angle - yaw;
  return { pan: Math.sin(a), front: Math.cos(a), dist: 99 };
}

/** The scale, root and pace of the music for a stretch of woods (0..6) by day or night. */
export function scaleFor(area, night) {
  const SCALES = [
    [0, 2, 4, 7, 9],          // 0-1: major pentatonic — open
    [0, 2, 4, 7, 9],
    [0, 3, 5, 7, 10],         // 2-3: minor pentatonic
    [0, 3, 5, 7, 10],
    [0, 1, 5, 7, 8],          // 4-5: a Phrygian cluster
    [0, 1, 5, 7, 8],
    [0, 1, 6, 7, 11],         // 6: the tritone and the leading tone, unresolved
  ];
  const a = Math.max(0, Math.min(6, area | 0));
  const root = 196 * 2 ** (-a / 12) * (night ? 0.5 : 1);     // G3, a semitone lower each woods
  return { root, intervals: SCALES[a], tempo: 60 - a * 4 - (night ? 8 : 0), density: (night ? 0.25 : 0.5) * (1 - a * 0.08) };
}

/**
 * Target levels (0..1) for the always-on layers. Everything here comes from
 * public facts; see THE RULE above.
 * s: { area, night, daylight (0..1), fireDist, fireFuel, litDist, litAge, panelOpen, moving }
 */
export function mixFor(s) {
  const depth = Math.max(0, Math.min(6, s.area | 0)) / 6;
  const near = (d, r) => (d == null || !Number.isFinite(d) ? 0 : Math.max(0, 1 - d / r));
  return {
    wind: 0.08 + 0.12 * depth + 0.05 * (1 - s.daylight),
    birds: Math.max(0, s.daylight - 0.35) * (1 - depth * 0.85),
    crickets: Math.max(0, 0.7 - s.daylight) * 0.8 * (1 - depth * 0.7),
    fire: near(s.fireDist, 14) * Math.min(1, (s.fireFuel || 0) / 3) * 0.9,
    hum: near(s.litDist, 9) * 0.5,
    humPitch: 140 - 55 * Math.min(1, s.litAge || 0),      // blue sings higher than red
    music: (0.16 + 0.1 * (1 - s.daylight)) * (s.panelOpen ? 0.55 : 1),
  };
}

/**
 * The menu sounds: a soft, low tap, not a blip. Sine only, no pitch sweep, a
 * gentle attack, and a low-pass over the top so nothing is ever sharp. A press
 * is a little fuller (two partials a fifth apart); a step between buttons is
 * the quietest; going back is lower.
 */
export function uiSound(kind) {
  const spec = {
    move: { freqs: [330], gain: 0.03, attack: 0.012, len: 0.09, lp: 1100 },
    select: { freqs: [262, 392], gain: 0.045, attack: 0.014, len: 0.17, lp: 1200 },
    back: { freqs: [196], gain: 0.04, attack: 0.014, len: 0.14, lp: 900 },
  };
  return spec[kind] || spec.move;
}

/** How long between footsteps, and how they sound, by the ground under you. */
export function stepFor(kind) {
  // K.TRAIL = 1 dirt, K.CLEAR = 2 grass; anything else is leaf litter.
  if (kind === 1) return { gap: 0.44, freq: 900, gain: 0.5 };
  if (kind === 2) return { gap: 0.46, freq: 520, gain: 0.35 };
  return { gap: 0.5, freq: 700, gain: 0.4 };
}
