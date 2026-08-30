// woods.js — THE WOODS: one scripted day at the camp, a swap in the night, and
// a morning spent asking.
//
// This is the alpha from docs/IDEAS.md, and it runs INSIDE the game. Not a page
// beside it: the camp, the renderer, the party, the roster HUD and the check-in
// verb, all of them already built and all of them the point. The player is
// PRESENT for the day because they are standing in it.
//
// That presence is load-bearing and is the thing a text version cannot have.
// The evidence for the whole investigation is the player's own memory of a day
// they lived, so the day has to be lived. A list on a screen makes the page the
// record and the game a diff; being there makes the player the record, which is
// what the design note means by their memory being the only evidence, because
// only they were there.
//
// The chronicle is written as each beat actually HAPPENS in the world, from the
// same positions and at the same moment the player sees it. It is a record OF
// the day, not a script the day is read from — which is why an account derived
// from it can be checked against what the player watched.

import { record, CHRONICLE_KINDS, WEATHER } from "./chronicle.js?v=seven-0.12.0";
import { swapOvernight } from "./state.js?v=seven-0.12.0";

/** How close the player has to be to count as present for a beat. */
export const WITNESS_RADIUS = 26;

/** How long a companion has to stand at the spot before the beat lands. */
export const BEAT_DWELL = 1.4;

/**
 * The day, as landmarks on the camp rather than as sentences.
 *
 * A beat names WHERE, not what is said — the sentence is rendered from the
 * chronicle entry later, by the one renderer, so what the player watches and
 * what a companion recounts are the same fact seen twice.
 */
export const BEAT_COUNT = 7;

/** Named spots on the authored camp, resolved from the world it hands back. */
export function campPlaces(world) {
  const p = world.pylons || [];
  return [
    { key: "the fire", x: world.camp.x, z: world.camp.z },
    { key: "the trainer's post", x: world.trainer.x, z: world.trainer.z },
    { key: "the north pylon", x: p[0]?.x ?? world.camp.x, z: p[0]?.z ?? world.camp.z },
    { key: "the south pylon", x: p[1]?.x ?? world.trainer.x, z: p[1]?.z ?? world.trainer.z },
  ];
}

/**
 * Lay out the day. Five draws a beat, every beat, so the roll count is fixed
 * whatever the day turns out to be — the same rule the rest of the sim lives by.
 *
 * Nothing is recorded here. A beat is an INTENTION until it happens in front of
 * the player; the chronicle is written by `updateWoodsDay` at the moment the
 * thing actually occurs, from where the people actually are.
 */
export function beginWoodsDay(sim, world) {
  const places = campPlaces(world);
  const beats = [];
  let last = null;
  for (let i = 0; i < BEAT_COUNT; i++) {
    let k = Math.floor(sim.rng() * CHRONICLE_KINDS.length);
    const a = Math.floor(sim.rng() * sim.companions.length);
    const bRaw = Math.floor(sim.rng() * sim.companions.length);
    const spot = places[Math.floor(sim.rng() * places.length)];
    const weather = WEATHER[Math.floor(sim.rng() * WEATHER.length)];
    // Nudged off the previous kind rather than re-rolled: a day with three
    // identical beats reads as a generator's output, and the player is being
    // asked to trust this as memory. Arithmetic on a draw already made, so the
    // count stays fixed.
    if (i > 0 && CHRONICLE_KINDS[k] === last) k = (k + 1) % CHRONICLE_KINDS.length;
    last = CHRONICLE_KINDS[k];
    const b = bRaw === a ? (a + 1) % sim.companions.length : bRaw;
    beats.push({
      kind: last, spot, weather,
      subject: sim.companions[a].id,
      second: sim.companions[b].id,
      dwell: 0, done: false, witnessed: false,
    });
  }
  sim.woods = { beats, at: 0, over: false, missed: 0 };
  return sim.woods;
}

const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Drive the current beat and record it when it lands.
 *
 * `scripted` is set on the two companions the beat is about; party.js honours
 * it ahead of its own goal selection so the AI does not steer them off mid-beat.
 * It is cleared the moment the beat closes — a scripted flag left behind is a
 * companion who never goes back to being a companion.
 */
export function updateWoodsDay(sim, dt) {
  const w = sim.woods;
  if (!w || w.over) return null;
  const beat = w.beats[w.at];
  const cast = [beat.subject, beat.second].map((id) => sim.companions.find((c) => c.id === id));
  for (const c of cast) {
    c.scripted = { x: beat.spot.x, z: beat.spot.z };
  }
  const arrived = cast.every((c) => near(c, beat.spot) < 3.5);
  if (!arrived) return null;

  beat.dwell += dt;
  if (beat.dwell < BEAT_DWELL) return null;

  // Was the player there to see it? The camp is small and the design puts
  // everyone at it, so this is nearly always true — but "nearly" is not "by
  // construction", and an account of something the player never saw is not
  // evidence they can weigh. A missed beat is counted, never silently dropped.
  const seen = near(sim.player, beat.spot) < WITNESS_RADIUS;
  beat.witnessed = seen;
  if (seen) {
    const everyone = [sim.player, ...sim.companions].map((c) => c.id);
    record(sim, beat.kind, {
      actors: [beat.subject, beat.second,
               ...everyone.filter((id) => id !== beat.subject && id !== beat.second)],
      place: beat.spot.key,
      weather: beat.weather,
    });
  } else {
    w.missed++;
  }
  beat.done = true;
  for (const c of cast) c.scripted = null;
  w.at++;
  if (w.at >= w.beats.length) w.over = true;
  return { beat, seen, dayOver: w.over };
}

/** The day ends when the player turns in. Someone is taken; nothing is said. */
export function sleepAtCamp(sim) {
  if (!sim.woods || !sim.woods.over) return null;
  for (const c of sim.companions) c.scripted = null;
  sim.woods.slept = true;
  return swapOvernight(sim);
}
