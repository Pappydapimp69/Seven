// tutorial.mjs — the training camp teaches by doing, in order, and says nothing
// about what the woods will do.

import { harness, assert, S, walk, finish, chopSpot } from "./lib.mjs";
import { STEPS, TRAINEES, tutorialStep, startTutorial } from "../src/tutorial.js";
import { pathTo, kindAt, K } from "../src/world.js";

const T = harness("tutorial");
const HOUR = 60 / 0.2;
const fresh = () => S.createSim({ seed: 0, tutorial: true, team: TRAINEES.map((t) => ({ ...t, skills: { ...t.skills } })) });

T.check("it starts at the first step with two trainees, in a fine morning that holds", () => {
  const s = fresh();
  assert(tutorialStep(s).id === "walk" && s.mates.length === 2 && s.mates.map((m) => m.name).join() === "Orla,Benet", "wrong start");
  for (let i = 0; i < 40 * HOUR; i++) S.tick(s, {});
  assert(s.day === 1 && !s.missing && s.mates.every((m) => !m.fake) && s.lead.lucidity === 100 && !S.isNight(s), `the training camp moved on: day ${s.day}, ${S.clockText(s)}`);
});

T.check("the wood step waits for the wood to be ON THE PILE, not just cut", () => {
  const s = fresh();
  s.camp.built = true; s.lead.x += 6; s.stats.felled = 1; s.lead.carry = 4;
  tutorialStep(s); s.tut.step = 2;
  assert(tutorialStep(s).id === "wood", "advanced with the wood still in your arms");
  s.camp.pile = 4;
  assert(tutorialStep(s).id === "fire", "did not advance once the wood was on the pile");
});

T.check("walking past a verb teaches nothing: doing a later thing first does not skip a step", () => {
  const s = fresh();
  s.world.deadfalls[0].cleared = true; s.world.deadfalls[0].progress = 1;
  s.world.pylons[0].state = "lit"; s.stats.asked = 3; s.stats.whistled = 3;
  assert(tutorialStep(s).id === "walk", `jumped to ${tutorialStep(s).id} with the first step undone`);
});

T.check("a real playthrough, step by step, reaches the end — and each step waits for its own thing", () => {
  const s = fresh();
  const at = () => tutorialStep(s).id;
  const cells = (x, y) => ({ cx: Math.floor(x), cy: Math.floor(y) });
  // 1 walk
  assert(at() === "walk", at());
  const row = Math.floor(s.lead.y) - 7;
  assert(walk(s, s.world.trailX[row] + 0.5, row + 0.5), "could not walk up the trail");
  assert(at() === "camp", `after walking: ${at()}`);
  // 2 camp
  s.lead.yaw = -Math.PI / 2; S.campAction(s); finish(s);
  assert(s.camp.built && at() === "wood", `after camp: ${at()}`);
  // 3 wood: the nearest tree, from a cell beside it
  const near = s.world.trees.filter((t) => !t.felled).sort((a, b) => Math.hypot(a.cx - s.lead.x, a.cy - s.lead.y) - Math.hypot(b.cx - s.lead.x, b.cy - s.lead.y));
  let done = false;
  for (const t of near.slice(0, 12)) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const sx = t.cx + dx, sy = t.cy + dy;
      if (kindAt(s.world, sx, sy) === K.TRAIL || kindAt(s.world, sx, sy) === K.CLEAR) {
        const c = cells(s.lead.x, s.lead.y);
        if (!pathTo(s.world, c.cx, c.cy, sx, sy)) continue;
        if (!walk(s, sx + 0.5, sy + 0.5)) continue;
        s.lead.yaw = Math.atan2(t.cy + 0.5 - s.lead.y, t.cx + 0.5 - s.lead.x);
        if (S.contextAction(s)?.kind === "fell") { S.act(s); finish(s); done = true; break; }
      }
    }
    if (done) break;
  }
  assert(done && s.stats.felled === 1, "never got a tree down");
  // (A tree that stood inside the camp goes straight onto the pile; one further out has to be carried in.)
  assert(walk(s, s.camp.x, s.camp.y + 1), "could not walk back to camp");
  S.tick(s, {});
  assert(at() === "fire", `after the wood is on the pile: ${at()}`);
  // 4 fire
  assert(S.fireAction(s).ok, "could not light the fire"); finish(s);
  assert(at() === "ask", `after the fire: ${at()}`);
  // 5 ask  6 whistle
  assert(S.askableDays(s).join() === "1", "cannot ask about today in training");
  S.askAbout(s, "m0", 1); finish(s);
  assert(at() === "whistle", `after asking: ${at()}`);
  S.callOut(s);
  assert(at() === "chop", `after whistling: ${at()}`);
  // 7 chop (the trunk is thinner in training: a few chops, not dozens)
  const d = S.frontDeadfall(s), sp = chopSpot(s, d);
  assert(walk(s, sp.x, sp.y), "could not walk to the trunk");
  s.lead.yaw = -Math.PI / 2;
  let chops = 0;
  while (!d.cleared && chops++ < 40) { S.act(s); finish(s); }
  assert(d.cleared && chops <= 15, `the trunk took ${chops} chops in training`);
  assert(at() === "pylon", `after the trunk: ${at()}`);
  // 8 pylon, with a trainee beside you
  const pyl = s.world.pylons[0];
  assert(walk(s, pyl.x - 0.9, pyl.y), "could not walk to the pylon");
  s.mates[0].x = pyl.x + 0.9; s.mates[0].y = pyl.y; s.mates[0].following = false; s.mates[0].task = { kind: "camp", chunk: 0, carry: 0 };
  s.lead.yaw = 0;
  assert(S.contextAction(s)?.kind === "light", `no pylon to light: ${S.contextAction(s)?.kind}`);
  S.act(s); finish(s);
  assert(pyl.state === "lit" && at() === "strike", `after the pylon: ${at()}`);
  // 9 strike camp
  assert(walk(s, s.camp.x, s.camp.y + 0.5), "could not walk back to take camp down");
  S.campAction(s); finish(s);
  assert(!s.camp.built && at() === "end", `after taking camp down: ${at()}`);
});

T.check("the text names controls by token only, and never says what the woods will do", () => {
  const known = new Set(["move", "look", "act", "camp", "fire", "rest", "call"]);
  for (const st of STEPS) {
    for (const m of st.text.matchAll(/\{(\w+)\}/g)) assert(known.has(m[1]), `${st.id}: unknown token {${m[1]}}`);
    assert(!/press (E|F|Q|R|C|A|B|X|Y)\b/i.test(st.text), `${st.id}: names a bare key`);
    assert(!/who they were|will not be|taken|replaced|fake|vanish|go under|hallucinat|not real|lose your mind|insane|sanity|lucid/i.test(st.text), `${st.id}: gives the woods away: ${st.text}`);
  }
});

void startTutorial;
T.done();
