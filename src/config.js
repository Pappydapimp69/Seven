// config.js — every tuning number in one place. Pure data.
//
// Units: positions are in grid cells (a cell is ~2.5 m); time is in GAME
// MINUTES. One sim tick advances the clock TICK_MIN game minutes; the loop runs
// TICKS_PER_SEC ticks a real second at normal speed, faster while the lead is
// busy or asleep. Movement is per tick, so fast-forward moves everyone faster
// on screen and identically in the sim.

export const TICKS_PER_SEC = 30;
export const TICK_MIN = 0.2;                 // 1 game hour = 300 ticks = 10 real seconds
export const SPEED_BUSY = 20;                // the lead's hands are on a job
export const SPEED_SLEEP = 60;               // the lead is asleep

export const DAWN = 6 * 60;                  // minute of day
export const DUSK = 18 * 60;

// ---- the map ----------------------------------------------------------------
export const MAP_W = 48;
export const AREA_H = 22;
export const AREAS = 7;
export const MAP_H = AREA_H * AREAS;         // 154 rows; row 0 is the far (north) edge
export const TRAIL_HALF = 1;                 // trail is 3 cells wide
export const EXIT_ROWS = 5;                  // the far side: rows 1..EXIT_ROWS

// ---- people -----------------------------------------------------------------
export const TEAM = 5;                       // companions. With the lead that is six; the HUD still says seven.
export const CANDIDATES = 8;                 // the player picks TEAM of these
export const LEAD_SPEED = 0.13;              // cells per tick
export const MATE_SPEED = 0.12;
export const BODY_R = 0.3;
export const REACH = 1.6;                    // E reaches this far
export const CALL_RANGE = 14;
export const CALL_MIN_LUCIDITY = 25;
export const SKILLS = Object.freeze(["cut", "carry", "keen", "tend", "build", "track"]);
export const SKILL_INFO = Object.freeze({
  cut: "chops the deadfall faster", carry: "fells and hauls more", keen: "holds up longer in the deep woods",
  tend: "makes the wood last on the fire", build: "puts camp up and takes it down faster", track: "spots the lost from further off",
});
export const NO_SKILLS = Object.freeze({ cut: 0, carry: 0, keen: 0, tend: 0, build: 0, track: 0 });
export const TEND_SKILL = 0.15;              // +15% fire hours per wood fed, per level
export const BUILD_SKILL = 0.15;             // +15% camp speed per helper's level
export const TRACK_REACH = 0.6;              // cells of extra find reach per level, from whoever is with you
export const SKILL_MAX = 8;
// Each candidate comes with a trade, and the skills that go with it.
export const ROLES = Object.freeze([
  { role: "Logger", skills: { cut: 2 } },
  { role: "Hauler", skills: { carry: 2 } },
  { role: "Scout", skills: { keen: 2 } },
  { role: "Firekeeper", skills: { tend: 2 } },
  { role: "Builder", skills: { build: 2 } },
  { role: "Tracker", skills: { track: 2 } },
  { role: "Woodcutter", skills: { cut: 1, carry: 1 } },
  { role: "Forester", skills: { cut: 1, keen: 1 } },
  { role: "Pathfinder", skills: { track: 1, keen: 1 } },
]);
export const BASE_POINTS = 6;                // spent on top of what each role brings
export const PRACTICE_CHUNKS = 6;            // finished chunks of a kind per level
export const FAKE_LEARNS = 2;                // a fake learns this many times faster

// ---- work (game minutes) ----------------------------------------------------
export const CHOP_MIN = 30;
export const CHOP_PROGRESS = 1 / 32;         // per unskilled chop
export const CHOP_SKILL = 0.15;              // +15% per cut level
export const DEADFALL_THICKER = 0.25;        // each area deeper, a trunk takes 25% more
export const FELL_MIN = 60;
export const FELL_YIELD = [3, 5];
export const HAUL_LOAD = 6;
export const MAKE_CAMP_MIN = 120;
export const DISMANTLE_MIN = 60;
export const FIRE_MIN = 15;
export const ASK_MIN = 30;
export const LIGHT_MIN = 30;
export const REST_MIN = 60;                  // resting by day passes an hour

// ---- camp and fire ----------------------------------------------------------
export const CAMP_RADIUS = 3.5;              // the fire's shield: the campsite only
export const FIRE_LIGHT = 7.5;               // its light reaches further. Light is not safety.
export const FIRE_LIGHT_WOOD = 2;
export const FIRE_LIGHT_HOURS = 3;
export const FIRE_FEED_HOURS = 1.5;
export const FIRE_MAX_HOURS = 14;
export const WATCH_FEED_BELOW = 4;           // a watcher feeds under this many hours
export const PILE_REACH = 1.2;

// ---- the hidden meter -------------------------------------------------------
export const DRAIN = 0.9;                    // lucidity per game hour at depth 1, by day
export const DEPTH = Object.freeze([1, 1.3, 1.6, 2.0, 2.4, 2.8, 3.2]);
export const NIGHT_MULT = 2.2;               // outside a lit camp after dark
export const SLEEP_MULT = 0.5;
export const REST_GAIN = 1.0;                // per hour asleep in a lit camp at night
export const KEEN_SKILL = 0.07;
export const LIE_BELOW = 40;                 // the lead's percept starts lying
export const FIRE_LIE_BELOW = 25;

// ---- pylons -----------------------------------------------------------------
export const PYLON_BURN = 36 * 60;
export const PYLON_PAIR_REACH = 2.5;

// ---- the night --------------------------------------------------------------
export const NIGHT_DRAWS = 6;                // FIXED: every dawn draws exactly this many
export const TAKE_BASE = 0.16;               // × mean exposure × depth × fakes held
export const HELD_FAKE_BONUS = 0.4;
export const EXPOSURE = Object.freeze({ base: 1, awake: 2, away: 3, cold: 1.5 });
export const CALL_FLOOR = 0.5;
export const CALL_FADE = 0.15;
export const FALSE_CALL = 0.3;
export const FIND_REACH = 2.5;

// ---- the ending -------------------------------------------------------------
export const RETURN_FRACTION = 0.5;          // of a saved member's points, to the pool
export const WEATHER = Object.freeze(["clear", "grey", "wet", "windy", "misty"]);
export const DIRS8 = Object.freeze(["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]);
