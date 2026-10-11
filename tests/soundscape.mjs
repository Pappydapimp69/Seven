// soundscape.mjs — the rules of what the woods sound like, and what the sim
// announces to the ear. Pure node.

import fs from "fs";
import { harness, assert, S } from "./lib.mjs";
import { createRng } from "../src/rng.js";
import { serialize } from "../src/save.js";
import { dirAngle, placeSound, placeAngle, scaleFor, mixFor, stepFor } from "../src/soundscape.js";
import { clearDeadfall } from "../src/world.js";
import * as C from "../src/config.js";

const T = harness("soundscape");
const HOUR = 60 / C.TICK_MIN;
const fresh = (seed = 51) => { const s = S.createSim({ seed, startCamp: true }); S.applyPlan(s, "dawn", {}); s.lead.yaw = null; return s; };
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

T.check("a sound to your right is on your right, behind is behind — whichever way you face", () => {
  for (const yaw of [-Math.PI / 2, 0, 1.2, Math.PI]) {
    const lead = { x: 10, y: 10 }, right = { x: 10 + Math.cos(yaw + Math.PI / 2) * 5, y: 10 + Math.sin(yaw + Math.PI / 2) * 5 };
    const back = { x: 10 - Math.cos(yaw) * 5, y: 10 - Math.sin(yaw) * 5 };
    assert(placeSound(lead, yaw, right).pan > 0.99, `yaw ${yaw}: a sound to the right is not panned right`);
    assert(placeSound(lead, yaw, back).front < -0.99 && Math.abs(placeSound(lead, yaw, back).pan) < 0.01, `yaw ${yaw}: behind is not behind`);
  }
  assert(Math.abs(dirAngle("north") + Math.PI / 2) < 1e-9 && Math.abs(dirAngle("east")) < 1e-9, "compass words are not world angles");
  assert(placeAngle(dirAngle("east"), -Math.PI / 2).pan > 0.99, "a voice from the east, facing north, is not on the right");
});

T.check("the music follows the PLACE: deeper woods are lower, slower, sparser; night more so", () => {
  for (let a = 0; a < 6; a++) {
    const here = scaleFor(a, false), deeper = scaleFor(a + 1, false);
    assert(deeper.root < here.root && deeper.tempo < here.tempo && deeper.density < here.density, `woods ${a + 1} → ${a + 2} did not get lower, slower and sparser`);
    const dark = scaleFor(a, true);
    assert(dark.root < here.root && dark.density < here.density, `night in woods ${a + 1} is not lower and sparser`);
  }
  assert(JSON.stringify(scaleFor(0, false).intervals) !== JSON.stringify(scaleFor(6, false).intervals), "the first and last woods share a scale");
});

T.check("the layers: birds fade with depth and dusk, crickets come with dark, fire needs fuel and nearness", () => {
  const base = { area: 0, night: false, daylight: 1, fireDist: null, fireFuel: 0, litDist: null, litAge: 0, panelOpen: false };
  assert(mixFor(base).birds > mixFor({ ...base, area: 6 }).birds && mixFor(base).birds > mixFor({ ...base, daylight: 0 }).birds, "birds do not thin with depth and dusk");
  assert(mixFor({ ...base, daylight: 0 }).crickets > mixFor(base).crickets, "no crickets at night");
  assert(mixFor({ ...base, fireDist: 3, fireFuel: 5 }).fire > mixFor({ ...base, fireDist: 12, fireFuel: 5 }).fire, "a near fire is not louder");
  assert(mixFor({ ...base, fireDist: 3, fireFuel: 0 }).fire === 0, "a dead fire still roars");
  assert(mixFor({ ...base, litDist: 2, litAge: 0 }).humPitch > mixFor({ ...base, litDist: 2, litAge: 1 }).humPitch, "a blue pylon does not sing higher than a red one");
  assert(mixFor({ ...base, panelOpen: true }).music < mixFor(base).music, "music does not duck behind a panel");
  assert(stepFor(1).freq !== stepFor(2).freq, "dirt and grass sound the same");
});

T.check("THE RULE: sound never reads the hidden meter — checked in the source, not by trust", () => {
  for (const f of ["src/soundscape.js", "src/audio.js"]) {
    const code = strip(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
    assert(!/lucid/i.test(code), `${f} mentions lucidity in code`);
  }
  const main = strip(fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8"));
  const block = main.slice(main.indexOf("Audio.update({"), main.indexOf("}, dt);", main.indexOf("Audio.update({")));
  assert(block.length > 50 && !/lucid/i.test(block), "main.js feeds lucidity to the sound");
  // And the mix cannot depend on it: extra fields are ignored.
  const s = { area: 3, night: true, daylight: 0, fireDist: 4, fireFuel: 4, litDist: 5, litAge: 0.3, panelOpen: false };
  assert(JSON.stringify(mixFor({ ...s, lucidity: 100 })) === JSON.stringify(mixFor({ ...s, lucidity: 3 })), "the mix changed with lucidity");
});

T.check("the sim announces sounds: whistle, answers, the dawn voice, the camp-down voice, the crack of a trunk", () => {
  const s = fresh();
  S.callOut(s);
  assert(s.sounds.some((e) => e.name === "whistle"), "no whistle sound");
  const near = s.mates[0]; s.sounds.length = 0; s.mates.forEach((m) => { m.heard = null; });
  near.task = { kind: "camp", chunk: 0, carry: 0 }; near.x = s.lead.x + 2; near.y = s.lead.y; near.following = false;
  s.mates.forEach((m) => { if (m !== near) { m.x = s.lead.x + 40; m.y = s.lead.y; } });   // out of earshot
  S.callOut(s);
  for (let i = 0; i < 4 * HOUR && !s.sounds.some((e) => e.name === "answer"); i++) S.tick(s, {});
  const ans = s.sounds.find((e) => e.name === "answer");
  assert(ans && Number.isFinite(ans.x) && ans.slot === near.slot && s.sounds.filter((e) => e.name === "answer").length === 1, `no answer from the near one: ${JSON.stringify(s.sounds.map((e) => e.name))}`);
  const t = fresh(52); t.day = 2; t.sounds.length = 0;
  for (let seed = 0; seed < 40 && !t.sounds.some((e) => e.name === "voice"); seed++) { t.day = 2; S.resolveNight(t); }
  assert(t.sounds.some((e) => e.name === "voice" && e.dir) && t.sounds.some((e) => e.name === "dawn"), "dawn did not announce a voice with a bearing");
  const u = fresh(53); u.lead.x = u.camp.x; u.lead.y = u.camp.y + 1;
  u.missing = { id: "m4", name: "X", slot: 4, skills: {}, points: 0, practice: {}, lucidity: 90, x: u.camp.x - 8, y: u.camp.y, area: 0, lastDay: 1, nights: 1, found: false };
  u.sounds.length = 0; S.campAction(u); while (u.lead.busy) S.tick(u, {});
  assert(u.sounds.some((e) => e.name === "voice" && e.dir === "west"), "the camp-down voice did not come from the west");
  const v = fresh(54); const d = v.world.deadfalls[0]; v.sounds.length = 0;
  const { chopAt } = MATESMOD; d.progress = 0.999; chopAt(v, d, "lead", 0);
  assert(v.sounds.some((e) => e.name === "crack"), "no crack when the trunk gives way");
});

T.check("a real answer and a false one sound the same; sounds are not saved and cost no random draws", () => {
  const s = fresh(55);
  s.mates[1].fake = true; s.mates[1].since = 2;
  const shape = (m) => { s.sounds.length = 0; m.task = { kind: "camp", chunk: 0, carry: 0 }; m.following = false; m.x = s.lead.x + 3; m.y = s.lead.y; m.heard = { wait: 0.1 }; S.tick(s, {}); const e = s.sounds.find((x) => x.name === "answer"); return e && Object.keys(e).sort().join(); };
  const real = shape(s.mates[0]), fake = shape(s.mates[1]);
  assert(real && real === fake && real === "name,slot,x,y".split(",").sort().join(), `an answer carries more than where and whose slot: ${real} vs ${fake}`);
  const before = s.rng.state; s.sfx("whistle"); s.sfx("voice", { dir: "north" });
  assert(s.rng.state === before, "announcing a sound drew a random number");
  assert(!JSON.stringify(serialize(s)).includes("sounds"), "sounds were saved");
  for (let i = 0; i < 200; i++) s.sfx("whistle");
  assert(s.sounds.length <= 64, "the sound queue grows without bound");
});

import * as MATESMOD from "../src/mates.js";
void createRng; void clearDeadfall;
T.done();
