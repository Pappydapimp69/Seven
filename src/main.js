// main.js — the loop, the panels, and the wiring. The sim never sees the DOM;
// this file reads sim.pending and opens the matching panel, and the panel
// answers through the sim's exported actions.

import * as S from "./sim.js?v=seven-1.5.0";
import { perceive } from "./percept.js?v=seven-1.5.0";
import { createRenderer, SLOT_COLORS } from "./render.js?v=seven-1.5.0";
import { createInput } from "./input.js?v=seven-1.5.0";
import * as UI from "./ui.js?v=seven-1.5.0";
import { saveTo, loadFrom, clearSave } from "./save.js?v=seven-1.5.0";
import { createRng } from "./rng.js?v=seven-1.5.0";
import { composeRoster } from "./names.js?v=seven-1.5.0";
import { DAY_TASKS, NIGHT_TASKS, TASK_LABEL, frontDeadfall } from "./mates.js?v=seven-1.5.0";
import { areaOfRow } from "./world.js?v=seven-1.5.0";
import { TICKS_PER_SEC, SPEED_BUSY, SPEED_SLEEP, BASE_POINTS, SKILLS, SKILL_INFO, NO_SKILLS, SKILL_MAX, TEAM, CANDIDATES, ROLES, RETURN_FRACTION } from "./config.js?v=seven-1.5.0";

const BUILD = "seven-1.5.0";
const esc = UI.esc;
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const readJSON = (k, d) => { try { const v = store && store.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const writeJSON = (k, v) => { try { store && store.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const canvas = document.getElementById("game");
const renderer = createRenderer(canvas);
let sim = null, view = null, headless = false, endShown = false, moved = false, lastSave = 0, acc = 0;

const input = createInput({
  onAction, stickEl: document.getElementById("stick"), stickKnob: document.getElementById("knob"),
});

// ---- play actions ---------------------------------------------------------------
function onAction(a, e) {
  if (UI.isOpen()) { UI.navigate(a, e); return; }
  if (!sim || sim.status !== "playing" || sim.pending) return;
  if (a === "pause") return pausePanel();
  if (S.busy(sim)) return;
  if (a === "act") {
    const r = S.act(sim);
    if (r && r.kind === "ask") askPanel(r.m);
    else if (r && r.kind === "none") sim.say(r.label + ".");
  } else if (a === "fire") { const r = S.fireAction(sim); if (!r.ok && r.why) sim.say(r.why); }
  else if (a === "camp") { const r = S.campAction(sim); if (!r.ok && r.why) sim.say(r.why); }
  else if (a === "rest") S.rest(sim);
  else if (a === "call") S.callOut(sim);
}

// ---- runs, points, the record ---------------------------------------------------------
const bank = () => readJSON("seven:pool", 0);
const runs = () => readJSON("seven:runs", []);

function startRun(opts) {
  sim = S.createSim(opts);
  endShown = false; moved = false; acc = 0;
  UI.close(); UI.setPlaying(true);
  save();
}
function save() { if (sim && store && sim.status === "playing") saveTo(store, sim); lastSave = performance.now(); }

// ---- panels ---------------------------------------------------------------------
function titlePanel() {
  UI.setPlaying(false);
  const saved = store ? loadFrom(store) : null;
  const r = runs();
  const home = r.reduce((s, x) => s + (x.saved || 0), 0);
  UI.open(`
    <h1>SEVEN</h1>
    <p class="lede">Seven of you set out to walk the trail through the woods, and come out the other side.</p>
    ${saved && saved.status === "playing" ? `<button data-do="cont" autofocus>Continue — day ${saved.day}</button>` : ""}
    <button data-do="new">New run</button>
    <button data-do="how">How to play</button>
    ${r.length ? `<p class="small">${r.length} run${r.length > 1 ? "s" : ""} walked · ${home} brought home${bank() ? ` · ${bank()} points banked` : ""}</p>` : ""}
    <p class="small dim">${BUILD}</p>`);
  UI.bind({
    cont: () => { sim = saved; endShown = false; acc = 0; UI.close(); UI.setPlaying(true); },
    new: () => recruitPanel(Date.now() % 1e9),
    how: () => howPanel(titlePanel),
  });
}

function howPanel(back) {
  UI.open(`
    <h2>How to play</h2>
    <ul class="how">
      <li><b>${label("move")}</b> — walk. North is up.</li>
      <li><b>${label("act")}</b> — chop the deadfall, fell a marked tree, talk to someone, light a pylon with someone beside you.</li>
      <li><b>${label("fire")}</b> — at camp, light or feed the fire from the woodpile.</li>
      <li><b>${label("camp")}</b> — make camp here, or take it down. The woodpile stays where it is.</li>
      <li><b>${label("rest")}</b> — sleep after dark (or from the dusk panel); by day, rest an hour.</li>
      <li><b>${label("call")}</b> — call out. Whoever hears comes, once their hands are free.</li>
      <li><b>${label("pause")}</b> — pause.</li>
      <li>At camp, at <b>dawn</b> and <b>dusk</b>, you set everyone's work. Nowhere else.</li>
      <li>The fire keeps the camp safe at night — the camp only — and dies in the night unless it is stocked or someone keeps watch. Its light reaches further than its warmth.</li>
      <li>A pylon takes two pairs of hands, and keeps the deep woods off this stretch for a day and a half.</li>
    </ul>
    <button data-do="back" autofocus>Back</button>`, { onBack: back, wide: true });
  UI.bind({ back });
}

// Step 1: choose five of eight. Each comes with a trade and its skills.
function candidates(seed) {
  const rng = createRng(seed);
  const names = composeRoster(rng, CANDIDATES);
  const off = rng.int(0, ROLES.length - 1);
  return names.map((name, i) => {
    const r = ROLES[(i + off) % ROLES.length];
    return { name, role: r.role, base: { ...NO_SKILLS, ...r.skills }, skills: { ...NO_SKILLS, ...r.skills } };
  });
}
const skillText = (sk) => SKILLS.filter((k) => sk[k]).map((k) => `${k} ${sk[k]}`).join(" · ") || "—";

function recruitPanel(seed, picked = new Set()) {
  const pool = candidates(seed);
  const render = (focus) => {
    const n = picked.size;
    UI.open(`
      <h2>Choose your team</h2>
      <p class="small">Pick ${TEAM}. Each one brings a trade and the skills that go with it. ${n} of ${TEAM} chosen.</p>
      <div class="plan">${pool.map((c, i) => `
        <button data-do="pick" data-arg="${i}" class="row${picked.has(i) ? " on" : ""}" ${!picked.has(i) && n >= TEAM ? "disabled" : ""}>
          <span class="tick">${picked.has(i) ? "✓" : ""}</span><span class="nm">${esc(c.name)} <span class="small">${c.role}</span></span><span class="task">${skillText(c.base)}</span></button>`).join("")}
      </div>
      <button data-do="next" ${n === TEAM ? "" : "disabled"}>Next: spend points</button>
      <button data-do="names">Different people</button>
      <button data-do="back">Back</button>`, { onBack: titlePanel, wide: true });
    UI.refocus(focus, n === TEAM ? '[data-do="next"]' : null);
    UI.bind({
      pick: (i) => { i = +i; if (picked.has(i)) picked.delete(i); else if (picked.size < TEAM) picked.add(i); render(`[data-do="pick"][data-arg="${i}"]`); },
      next: () => spendPanel(seed, [...picked].sort((x, y) => x - y).map((i) => pool[i])),
      names: () => recruitPanel((seed * 7919 + 13) % 1e9),
      back: titlePanel,
    });
  };
  render(null);
}

// Step 2: spend points on top of what each role brings.
function spendPanel(seed, team) {
  const budget = BASE_POINTS + bank();
  const spent = () => team.reduce((s, t) => s + SKILLS.reduce((a, k) => a + t.skills[k] - t.base[k], 0), 0);
  const render = (focus) => {
    const left = budget - spent();
    UI.open(`
      <h2>Your team</h2>
      <p class="small">Spend ${budget} more points.</p>
      <ul class="skills small">${SKILLS.map((k) => `<li><b>${k}</b> ${SKILL_INFO[k]}</li>`).join("")}</ul>
      <div class="cards">${team.map((t, i) => `
        <div class="card"><div class="who"><span class="dot" style="background:${SLOT_COLORS[i]}"></span>${esc(t.name)} <span class="small">${t.role}</span></div>
          <div class="grid">${SKILLS.map((k) => `
            <div class="sk"><span class="lbl">${k}</span><button class="mini" data-do="dec" data-arg="${i}:${k}" ${t.skills[k] > t.base[k] ? "" : "disabled"}>−</button><span class="n">${t.skills[k]}</span><button class="mini" data-do="inc" data-arg="${i}:${k}" ${left && t.skills[k] < SKILL_MAX ? "" : "disabled"}>+</button></div>`).join("")}
          </div></div>`).join("")}
      </div>
      <p class="small">${left} left</p>
      <button data-do="go">Set out</button>
      <button data-do="even">Spread the points evenly</button>
      <button data-do="back">Back</button>`, { onBack: () => recruitPanel(seed), wide: true });
    // Stay on the button just pressed; drop to "Set out" only once the points are gone.
    UI.refocus(focus, left === 0 ? '[data-do="go"]' : null);
    UI.bind({
      inc: (arg) => { const [i, k] = arg.split(":"); if (budget - spent() > 0) team[+i].skills[k]++; render(`[data-do="inc"][data-arg="${arg}"]`); },
      dec: (arg) => { const [i, k] = arg.split(":"); if (team[+i].skills[k] > team[+i].base[k]) team[+i].skills[k]--; render(`[data-do="dec"][data-arg="${arg}"]`); },
      even: () => { team.forEach((t) => (t.skills = { ...t.base })); let n = 0; while (spent() < budget && n < 999) { const t = team[n % TEAM]; const k = SKILLS[Math.floor(n / TEAM) % SKILLS.length]; if (t.skills[k] < SKILL_MAX) t.skills[k]++; n++; } render('[data-do="even"]'); },
      go: () => { writeJSON("seven:pool", 0); startRun({ seed, team: team.map((t) => ({ name: t.name, role: t.role, skills: { ...t.skills } })) }); },
      back: () => recruitPanel(seed),
    });
  };
  render(null);
}

function planPanel(kind) {
  const tasks = kind === "dawn" ? DAY_TASKS : NIGHT_TASKS;
  const choice = {};
  let prevPlan = null;
  for (let d = sim.day - 1; d >= 1 && !prevPlan; d--) prevPlan = sim.chronicle[d] && sim.chronicle[d].plan;
  for (const m of sim.mates) {
    const cur = kind === "dawn" && prevPlan ? prevPlan[m.id] : m.task ? m.task.kind : null;
    choice[m.id] = tasks.includes(cur) && cur !== "free" ? cur : kind === "dawn" ? "free" : "sleep";
  }
  const d = frontDeadfall(sim);
  const render = () => {
    UI.open(`
      <h2>${kind === "dawn" ? `Dawn, day ${sim.day}` : "Dusk"}</h2>
      <p class="small">${kind === "dawn"
        ? `Set the day's work. It holds until dusk. ${d ? `The deadfall ahead is ${Math.round(d.progress * 100)}% cut.` : "The way north is open."}`
        : `Who sleeps, who keeps the fire, who works on in the dark. Unfed, the fire dies in the night. You sleep with ${label("rest")}.`} Wood stacked: ${S.campWood(sim.camp)}.</p>
      <div class="plan">${sim.mates.map((m) => `
        <button data-do="cycle" data-arg="${m.id}" class="row"><span class="dot" style="background:${SLOT_COLORS[m.slot]}"></span>
          <span class="nm">${esc(m.name)}<span class="sub">${m.role ? esc(m.role) + " · " : ""}${skillText(m.skills)}</span></span><span class="task">${esc(TASK_LABEL[choice[m.id]])}</span></button>`).join("")}
      </div>
      <button data-do="done" autofocus>${kind === "dawn" ? "Start the day" : "Set the night"}</button>
      ${kind === "dusk" ? '<button data-do="sleep">Set the night and sleep</button>' : ""}`, { onBack: null });
    UI.bind({
      cycle: (id, btn) => {
        choice[id] = tasks[(tasks.indexOf(choice[id]) + 1) % tasks.length];
        btn.querySelector(".task").textContent = TASK_LABEL[choice[id]];
      },
      done: () => { S.applyPlan(sim, kind, choice); UI.close(); },
      sleep: () => { S.applyPlan(sim, kind, choice); UI.close(); S.rest(sim); },
    });
  };
  render();
}

function askPanel(m) {
  const days = S.askableDays(sim);
  if (!days.length) { sim.say(`${m.name}: "Ask me tomorrow. There's nothing behind us yet."`); return; }
  UI.open(`
    <h2>${esc(m.name)}</h2>
    <p class="small">Ask about a day you both lived through. It takes half an hour.</p>
    ${days.map((d) => `<button data-do="ask" data-arg="${d}">${d === sim.day - 1 ? "Yesterday" : `Day ${d}`}</button>`).join("")}
    <button data-do="close">Never mind</button>`, { onBack: UI.close });
  UI.bind({
    ask: (d) => {
      const lines = S.askAbout(sim, m.id, +d);
      UI.open(`<h2>${esc(m.name)}, about ${+d === sim.day - 1 ? "yesterday" : `day ${d}`}</h2>
        <div class="account">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
        <button data-do="close" autofocus>Done</button>`, { onBack: UI.close });
      UI.bind({ close: UI.close });
    },
    close: UI.close,
  });
}

function twinPanel() {
  const t = S.twinAccounts(sim);
  UI.open(`
    <h2>Two at the fire</h2>
    <p>Both of them are ${esc(t.name)}. Both say they never left.</p>
    <p class="small">You ask them both about day ${t.day}.</p>
    <div class="twins">
      <div class="account"><h3>On the left</h3>${t.left.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
      <div class="account"><h3>On the right</h3>${t.right.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
    </div>
    <p class="small">Only one can stay.</p>
    <button data-do="keep" data-arg="L" autofocus>Keep the one on the left</button>
    <button data-do="keep" data-arg="R">Keep the one on the right</button>`, { wide: true });
  UI.bind({ keep: (side) => { S.keepTwin(sim, side === "L"); UI.close(); } });
}

function homePanel() {
  const h = sim.home, cands = S.homeCandidates(sim);
  UI.open(`
    <h2>The far side</h2>
    <p>${h.pylons} pylon${h.pylons === 1 ? "" : "s"} stand here, dark. One of them can send someone home, if two pairs of hands light it.</p>
    <p class="small">Every attempt spends a pylon.${h.saved.length ? ` Gone home: ${h.saved.map((s) => esc(s.name)).join(", ")}.` : ""}</p>
    ${cands.map((c) => `<button data-do="light" data-arg="${c.id}">Light one with ${esc(c.name)}</button>`).join("")}
    ${cands.length ? "" : "<p>Nobody is with you.</p>"}
    <button data-do="out">${h.saved.length ? "Walk out" : "Walk out alone"}</button>
    <button data-do="back">Not yet. Turn back</button>`, { onBack: () => { S.turnBack(sim); UI.close(); } });
  UI.bind({
    light: (id) => { S.lightHome(sim, id); if (sim.status === "playing") homePanel(); else UI.close(); },
    out: () => { S.finishRun(sim); UI.close(); },
    back: () => { S.turnBack(sim); UI.close(); },
  });
}

function pausePanel() {
  UI.open(`
    <h2>Paused</h2>
    <button data-do="resume" autofocus>Resume</button>
    <button data-do="how">How to play</button>
    <button data-do="quit">Save and leave</button>`, { onBack: UI.close });
  UI.bind({ resume: UI.close, how: () => howPanel(pausePanel), quit: () => { save(); sim = null; titlePanel(); } });
}

function endPanel() {
  endShown = true;
  const e = sim.ending;
  const back = e.saved.reduce((s, x) => s + Math.ceil((x.points || 0) * RETURN_FRACTION), 0);
  writeJSON("seven:pool", back);
  writeJSON("seven:runs", runs().concat([{ at: Date.now(), ending: e.kind, saved: e.saved.length, day: e.day }]).slice(-50));
  if (store) clearSave(store);
  const head = { home: "Home", alone: "Alone", lost: "Into the trees" }[e.kind];
  const body = {
    home: `You came out the other side on day ${e.day}, and you did not come alone.`,
    alone: `You came out the other side on day ${e.day}. The last pylon stayed dark.`,
    lost: `On day ${e.day} you walked off the trail, and did not come back to it.`,
  }[e.kind];
  UI.open(`
    <h2>${head}</h2>
    <p>${body}</p>
    ${e.saved.length ? `<p>Brought home: ${e.saved.map((s) => esc(s.name)).join(", ")}.</p>` : ""}
    ${e.tried.length ? `<p class="small">The pylon would not take ${e.tried.map(esc).join(", ")}. Whoever that was, it was not them.</p>` : ""}
    ${e.lost.length ? `<p class="small">Left in the woods: ${e.lost.map((l) => esc(l.name)).join(", ")}.</p>` : ""}
    ${back ? `<p class="small">${back} points go to the next team.</p>` : ""}
    <button data-do="again" autofocus>Again</button>`);
  UI.bind({ again: () => { sim = null; titlePanel(); } });
}

// ---- what each control is called on the device in the player's hands ----------------
const LABELS = {
  key: { act: "E", fire: "F", camp: "Q", rest: "R", call: "C", pause: "Esc", move: "WASD or arrows" },
  pad: { act: "A", fire: "X", camp: "LB", rest: "B", call: "Y", pause: "Start", move: "The left stick" },
  touch: { act: "Act", fire: "Fire", camp: "Camp", rest: "Rest", call: "Call", pause: "☰", move: "Drag on the left" },
};
const label = (name) => (LABELS[input.device] || LABELS.key)[name] || name;

// ---- hints: the walk-in teaches itself -------------------------------------------------
function hintText() {
  const k = (key, btn) => label(key === "WASD or arrows" ? "move" : { E: "act", F: "fire", Q: "camp", R: "rest", C: "call" }[key] || key, key, btn);
  const L = sim.lead, c = sim.camp, d = frontDeadfall(sim);
  if (!moved) return `${k("WASD or arrows", "Drag on the left")} to walk. North is up.`;
  if (L.busy && L.busy.kind === "sleep") return "";
  if (!c.built && !sim.chronicle[1].events.some((e) => e.kind === "camp_made") && sim.day === 1)
    return `No camp yet. ${k("Q", "Camp")} makes one where you stand — nothing is safe at night without it.`;
  if (L.carry > 0 && c.built && !S.atCamp(sim, L)) return "Carry the wood back to camp. It counts once it is on the pile.";
  if (S.isNight(sim)) {
    if (c.built && S.atCamp(sim, L) && c.fire <= 0 && S.campWood(c) >= 2) return `${k("F", "Fire")} lights the fire. It keeps the camp safe tonight — the camp only.`;
    if (c.built && S.atCamp(sim, L) && c.fire > 0) return `${k("R", "Rest")} to sleep. ${k("F", "Fire")} first to stock the fire — it has to last till dawn, or someone has to keep watch.`;
    if (c.built && S.atCamp(sim, L)) return `${k("R", "Rest")} to sleep. With no fire, the camp is not safe tonight.`;
    if (c.built && !S.atCamp(sim, L)) return "It is dark. Get back to the fire.";
    if (!c.built) return `No camp. ${k("Q", "Camp")} makes one here, or sleep in the open (${k("R", "Rest")}).`;
    return "";
  }
  const left = S.lightLeft(sim);
  if (left < 180 && c.built && S.campWood(c) < 6) return `Dusk is coming. Get wood on the pile: ${k("E", "Act")} beside a marked tree fells it.`;
  if (sim.day === 1 && d && d.area === 0 && d.progress < 0.05) return `A trunk blocks the trail north. Walk up to it and ${k("E", "Act")} to chop. Your team can chop too.`;
  if (sim.day >= 2 && d && d.area > areaOfRow(Math.floor(c.y)) && c.built) return `The way is open. Take camp down (${k("Q", "Camp")}) and make it further on. The woodpile stays.`;
  if (!c.built) return `${k("Q", "Camp")} makes camp here.${sim.piles.length ? " The old woodpile stays where you left it." : ""}`;
  return "";
}

// ---- the loop --------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (!headless) {
    const v = input.poll();
    if (sim && sim.status === "playing" && !UI.isOpen() && !sim.pending) {
      if (Math.hypot(v.mx, v.my) > 0.1) moved = true;
      const speed = sim.lead.busy ? (sim.lead.asleep ? SPEED_SLEEP : SPEED_BUSY) : 1;
      acc += dt * speed;
      const step = 1 / TICKS_PER_SEC;
      let n = 0;
      while (acc >= step && n < 4000 && !sim.pending && sim.status === "playing") { S.tick(sim, sim.lead.busy ? {} : v); acc -= step; n++; }
      if (sim.pending || sim.status !== "playing") acc = 0;
    }
    if (sim) afterTicks();
    if (sim) draw(dt);
  }
  requestAnimationFrame(frame);
}

function afterTicks() {
  if (sim.status === "ended" && !endShown) { UI.close(); endPanel(); return; }
  if (sim.pending && !UI.isOpen()) {
    if (sim.pending === "dawn" || sim.pending === "dusk") planPanel(sim.pending);
    else if (sim.pending === "twin") twinPanel();
    else if (sim.pending === "home") homePanel();
  }
  if (sim.saveDue || performance.now() - lastSave > 30000) { sim.saveDue = false; save(); }
}

function draw(dt) {
  view = perceive(sim);
  const L = sim.lead;
  const a = S.contextAction(sim);
  renderer.draw(sim.world, view, {
    mod: S.minuteOfDay(sim), real: performance.now() / 1000,
    busyFrac: L.busy && Number.isFinite(L.busy.total) ? 1 - L.busy.left / L.busy.total : null,
  }, dt);
  const k = label("act") + " · ";
  UI.hud({
    count: view.count, day: sim.day, clock: S.clockText(sim), night: S.isNight(sim),
    area: areaOfRow(Math.floor(L.y)) + 1, carry: L.carry,
    pile: sim.camp.built && S.atCamp(sim, L) ? sim.camp : null,
    prompt: L.busy ? busyLabel(L.busy.kind) : a ? (a.kind === "none" ? a.label : k + a.label) : "",
    hint: sim.status === "playing" ? hintText() : "",
  });
  UI.messages(sim.msgs, dt);
}
const busyLabel = (k) => ({ chop: "Chopping…", fell: "Felling…", ask: "Talking…", fire_light: "Lighting the fire…", fire_feed: "Feeding the fire…",
  camp_make: "Making camp…", camp_down: "Taking camp down…", light: "Lighting the pylon…", sleep: "Sleeping…", rest: "Resting…" }[k] || "");

document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
window.addEventListener("pagehide", save);

// Test hooks. The browser tests drive the real loop's functions through these.
window.__seven = {
  build: BUILD,
  get sim() { return sim; },
  get panel() { return UI.isOpen() ? document.querySelector("#modal .panel h2, #modal .panel h1")?.textContent : null; },
  set headless(v) { headless = !!v; },
  S, UI,
  newRun(opts) { startRun(opts); },
  run(ticks, inp = {}) { for (let i = 0; i < ticks && !sim.pending && sim.status === "playing"; i++) S.tick(sim, inp); afterTicks(); },
  action: onAction,
  click(label) {
    const b = [...document.querySelectorAll("#modal button")].find((x) => x.textContent.trim().startsWith(label));
    if (!b) return false; b.click(); return true;
  },
};

titlePanel();
requestAnimationFrame(frame);
