// woods.js — the investigation alpha, on its own page.
//
// Not wired into the 3D game on purpose. The alpha exists to answer one
// question — can a player catch a fake by asking about a day they both lived
// through — and the renderer, the party AI and the lucidity meter have nothing
// to say about it. Building it as a layer beside the bones rather than through
// them means a failed organ cannot break a working skeleton.
//
// Two rules this screen keeps, both inherited:
//   - Nothing is announced. The morning after the swap looks exactly like the
//     morning before it. Same names, same order, no marker, no colour.
//   - Nothing highlights the difference. A found tell is the player's, or it is
//     nothing. `tell` exists on every account and is not read until the debrief.

import { buildDay, asLived } from "./day.js?v=seven-0.12.0";
import { accountOf, accuse } from "./chronicle.js?v=seven-0.12.0";
import { askAbout, spendAsk, searchForMissing, canAsk, canSearch,
         MORNING_HOURS, SEARCH_COST } from "./state.js?v=seven-0.12.0";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let run = null;

function newDay(seed) {
  const { sim, taken } = buildDay({ seed });
  run = { sim, taken, seed, asked: new Set(), accounts: new Map(), over: false };
  $("seed").textContent = `seed ${seed}`;
  drawYesterday();
  show("yesterday");
}

function show(phase) {
  for (const id of ["yesterday", "morning", "verdict"]) $(id).hidden = id !== phase;
}

function drawYesterday() {
  const list = $("lived");
  list.replaceChildren();
  for (const s of asLived(run.sim, accountOf).statements) list.append(el("li", null, s.text));
}

function drawMorning() {
  const memory = $("memory");
  memory.replaceChildren();
  for (const s of asLived(run.sim, accountOf).statements) memory.append(el("li", null, s.text));

  const who = $("who");
  who.replaceChildren();
  for (const c of run.sim.companions) {
    const card = el("div", "person");
    card.append(el("h3", null, c.name));

    const acct = run.accounts.get(c.id);
    if (acct) {
      const ul = el("ul", "account");
      for (const s of acct.statements) ul.append(el("li", null, s.text));
      card.append(ul);
    } else {
      const ask = el("button", "ask", "Ask about yesterday  (1 hour)");
      ask.disabled = !canAsk(run.sim);
      ask.onclick = () => {
        const got = spendAsk(run.sim, c.id);
        if (got) run.accounts.set(c.id, got);
        drawMorning();
      };
      card.append(ask);
    }

    const name = el("button", "name", `It's ${c.name}`);
    name.onclick = () => finish(c.id);
    card.append(name);
    who.append(card);
  }
  const h = run.sim.morning.hours;
  $("hours").textContent = `${h} of ${MORNING_HOURS} hours of daylight left`;
  $("asked").textContent = `${run.accounts.size} of ${run.sim.companions.length} asked`;

  // The other thing the morning can be spent on. No cost is a cost until
  // something else wants the same hours.
  const go = $("search");
  go.disabled = !canSearch(run.sim);
  go.textContent = run.sim.morning.searched
    ? "You went out and came back alone."
    : `Go looking for whoever wandered off  (${SEARCH_COST} hours)`;
  go.onclick = () => {
    const r = searchForMissing(run.sim);
    if (r && r.found) return finish(null, "rescue");
    drawMorning();
  };
  $("search-note").textContent = run.sim.morning.searched
    ? "Nothing out there but the trees."
    : "Every question you ask first is an hour they are further away.";
}

function finish(id, how = "accusation") {
  const verdict = accuse(run.sim.companions, id);
  const taken = run.sim.companions.find((c) => c.id === verdict.actual);
  if (how === "rescue") {
    // You never identified anyone. You brought the real one home, which the
    // design counts as the win it is: the score is who you saved, not what you
    // worked out.
    $("call").textContent = "You found them.";
    $("call").className = "right";
    $("reveal").textContent =
      `${taken.name} walked back in with you. Whatever had been sitting at the ` +
      `fire wearing that name was gone by the time you got there.`;
  } else {
    $("call").textContent = verdict.correct ? "You were right." : "You were wrong.";
    $("call").className = verdict.correct ? "right" : "wrong";
    $("reveal").textContent = verdict.correct
      ? `${taken.name} never walked back into camp.`
      : `You named ${run.sim.companions.find((c) => c.id === id).name}. It was ${taken.name}.`;
  }

  // The debrief, and only here. `tell` is the mirror of checkIn's `truth`: it
  // exists for this screen and the tests, and reaching it mid-run would be the
  // same mistake as printing the hidden meter.
  const acct = askAbout(run.sim, taken.id);
  const truth = asLived(run.sim, accountOf).statements;
  const lines = $("what");
  lines.replaceChildren();
  if (run.accounts.has(taken.id)) {
    const wrong = acct.statements.filter((s, i) => truth[i] && s.text !== truth[i].text);
    lines.append(el("p", null, `They got the ${acct.tell.type} wrong:`));
    for (const s of wrong) lines.append(el("li", "said", `“${s.text}”`));
  } else {
    lines.append(el("p", null, `You never asked ${taken.name}.`));
  }
  show("verdict");
}

$("sleep").onclick = () => { drawMorning(); show("morning"); };
$("again").onclick = () => newDay((run.seed % 9999) + 1);

// The seed comes from the URL, or it is 1. NEVER from the clock: the whole
// codebase rests on a run being a pure function of its seed, and a
// time-seeded day cannot be reproduced, compared or reported in a bug. Seeding
// from device state was considered and rejected once already.
const fromUrl = Number.parseInt(new URLSearchParams(location.search).get("seed"), 10);
newDay(Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : 1);
