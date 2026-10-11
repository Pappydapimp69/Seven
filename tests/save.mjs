// save.mjs — a saved run resumes as the same run: play on from a save and from
// the live run, and the two must agree exactly.

import { harness, assert, S } from "./lib.mjs";
import { serialize, deserialize } from "../src/save.js";
import { walkable } from "../src/world.js";

const T = harness("save");
const plan = (s) => {
  if (s.pending === "dawn") S.applyPlan(s, "dawn", { m0: "chop", m1: "chop", m2: "gather", m3: "gather", m4: "camp" });
  else if (s.pending === "dusk") S.applyPlan(s, "dusk", { m0: "watch" });
  else if (s.pending === "twin") S.keepTwin(s, true);
};
function play(s, ticks) {
  for (let i = 0; i < ticks && s.status === "playing"; i++) {
    if (s.pending) { plan(s); continue; }
    const k = s.ticks;
    S.tick(s, { mx: Math.sin(k / 300) * 0.6, my: Math.cos(k / 470) * 0.6 });
    if (k % 2000 === 0 && !s.lead.busy) S.act(s);
    if (k % 4500 === 0 && !s.lead.busy) S.rest(s);
  }
}
const strip = (s) => { const d = serialize(s); delete d.msgs; return JSON.stringify(d); };

T.check("resume from a save = keep playing, over three days, on four seeds", () => {
  for (const seed of [2, 19, 404, 9001]) {
    const live = S.createSim({ seed });
    play(live, 9000);
    const resumed = deserialize(JSON.parse(JSON.stringify(serialize(live))));
    assert(resumed, `seed ${seed}: save did not load`);
    play(live, 30000); play(resumed, 30000);
    assert(strip(live) === strip(resumed), `seed ${seed}: the resumed run went a different way (day ${live.day} vs ${resumed.day})`);
  }
});

T.check("restored bodies stand on open ground; a corrupt save is refused", () => {
  const s = S.createSim({ seed: 5 });
  const data = serialize(s);
  data.mates[0].x = 0.5; data.mates[0].y = 0.5;          // inside the border forest
  const back = deserialize(JSON.parse(JSON.stringify(data)));
  assert(walkable(back.world, Math.floor(back.mates[0].x), Math.floor(back.mates[0].y)), "a body was restored inside a wall");
  data.lead.x = null;
  assert(deserialize(JSON.parse(JSON.stringify(data))) === null, "a save with no position for the lead loaded");
});

T.check("a sleeping lead survives the save (Infinity is not JSON)", () => {
  const s = S.createSim({ seed: 8 });
  s.ticks = Math.round((13 * 60) / 0.2);
  S.rest(s);
  const back = deserialize(JSON.parse(JSON.stringify(serialize(s))));
  assert(back.lead.busy && back.lead.busy.left === Infinity, `busy after load: ${JSON.stringify(back.lead.busy)}`);
});
T.done();
