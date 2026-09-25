// keys.mjs — every instruction names a real button, and the right one.
//
// From a real playtest on a pad: "Pick IREN out on the roster" named no key,
// and the legend's "LB/RB select" did not say select WHAT. keys.js now names
// the buttons per scheme and every brief carries {tokens}. This holds:
//
//   1. every token in every brief resolves on every scheme (no "{select}" on
//      screen, no scheme silently falling back to keyboard names);
//   2. the NAMES in keys.js match the BINDINGS in input.js, so a rebinding
//      cannot leave a brief telling the player to press the old button;
//   3. the brief that started this names both keys it needs.
//
// Negative controls are in the file (see tests/readability.mjs for why).
//
// Run: node tests/keys.mjs

import { KEYS, keyed } from "../src/keys.js";
import { OBJECTIVES } from "../src/tutorial.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let passed = 0;
const failures = [];
const check = (n, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${n}: ${e.message}`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8");
const SCHEMES = ["keyboard", "gamepad", "touch"];

/** Every piece of player-facing text that may carry tokens. */
function texts(mainSrc) {
  const out = [];
  for (const o of OBJECTIVES) {
    out.push([`${o.id} brief`, o.brief]);
    for (const b of o.beats || []) if (b.say) out.push([`${o.id} beat`, b.say]);
  }
  const m = mainSrc.match(/"The morning",\s*([\s\S]*?)\);\n\}/);
  if (m) out.push(["woods morning", m[1]]);
  return out;
}

const G = {
  resolves({ keys, mainSrc }) {
    const out = [];
    const all = texts(mainSrc);
    if (!all.some(([n]) => n === "woods morning")) out.push("could not find the woods morning text in main.js");
    for (const scheme of SCHEMES) {
      if (!keys[scheme]) { out.push(`no key names for ${scheme}`); continue; }
      for (const [name, text] of all) {
        const k = keys[scheme];
        // `${...}` is a template-literal hole in main.js's source, not a key.
        const shown = String(text).replace(/\$\{[^}]*\}/g, "").replace(/\{(\w+)\}/g, (m, t) => (t in k ? k[t] : m));
        const left = shown.match(/\{\w+\}/g);
        if (left) out.push(`${scheme}: "${name}" shows ${left.join(", ")}`);
      }
      for (const t of Object.keys(keys.keyboard)) {
        const v = keys[scheme][t];
        if (typeof v !== "string" || !v.trim()) out.push(`${scheme} has no name for "${t}" — it would print "${v}"`);
      }
    }
    return out;
  },

  /** The names agree with input.js. Keyboard by KeyX case, pad by button index. */
  bound({ keys, inputSrc }) {
    const out = [];
    const kb = { act: ["SURVEY"], select: ["PREV_TARGET", "NEXT_TARGET"], give: ["OFFER_ITEM"], craft: ["CRAFT"], call: ["CALL"], name: ["OFFER_ITEM"] };
    for (const [t, actions] of Object.entries(kb)) {
      const letters = keys.keyboard[t].split("/");
      if (letters.length !== actions.length) { out.push(`keyboard "${t}" is "${keys.keyboard[t]}" — expected ${actions.length} key(s)`); continue; }
      letters.forEach((L, i) => {
        if (!new RegExp(`case "Key${L}": push\\(ACTIONS\\.${actions[i]}\\)`).test(inputSrc)) out.push(`keyboard "${t}" says ${L}, but ${L} is not bound to ${actions[i]}`);
      });
    }
    // The in-run pad handler: `if (edges[N]) push(ACTIONS.X); // NAME`.
    const pad = {};
    for (const m of inputSrc.matchAll(/if \(edges\[(\d+)\]\) push\(ACTIONS\.(\w+)\); \/\/ ([^\n—]+)/g)) pad[m[2] + ":" + m[3].trim()] = true;
    const padNames = { A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", "D-pad Right": "D-pad Right", "D-pad Up": "D-pad Up", "D-pad Left": "D-pad Left" };
    const want = { act: ["SURVEY"], select: ["PREV_TARGET", "NEXT_TARGET"], give: ["OFFER_ITEM"], craft: ["CRAFT"], call: ["CALL"], name: ["OFFER_ITEM"] };
    for (const [t, actions] of Object.entries(want)) {
      const names = keys.gamepad[t].split("/");
      names.forEach((n, i) => {
        const label = padNames[n];
        if (!label || !Object.keys(pad).some((k) => k.startsWith(actions[i] + ":") && k.slice(actions[i].length + 1).startsWith(label))) {
          out.push(`gamepad "${t}" says ${n}, but ${n} is not bound to ${actions[i]}`);
        }
      });
    }
    if (!/push\(ACTIONS\.CHECK_IN\); \/\/ X/.test(inputSrc) || !/X/.test(keys.gamepad.checkin)) out.push("the pad check-in instruction does not match X");
    return out;
  },

  /** The brief from the playtest names BOTH keys, on every scheme, and says where the roster is. */
  hands({ keys, handsBrief: b }) {
    const out = [];
    for (const s of SCHEMES) {
      const shown = keyed(b, s).replace(/\{(\w+)\}/g, (m, t) => keys[s]?.[t] ?? m);
      if (!shown.includes(keys[s].select)) out.push(`${s}: the hand-off brief does not say how to pick someone`);
      if (!shown.includes(keys[s].give)) out.push(`${s}: the hand-off brief does not say how to give`);
    }
    if (!/roster/.test(b) || !/top left|left/.test(b)) out.push("the hand-off brief does not say where the roster is");
    return out;
  },
};

const REAL = {
  keys: KEYS, mainSrc: read("src/main.js"), inputSrc: read("src/input.js"),
  handsBrief: OBJECTIVES.find((o) => o.id === "hands").brief,
};

for (const k of Object.keys(G)) {
  check(k, () => { const p = G[k](REAL); assert(!p.length, p.join("; ")); });
}

check("the legend says what LB/RB and Q/R pick", () => {
  const hud = read("src/hud.js");
  assert(/\[LB\]\/\[RB\] pick a teammate on the roster/.test(hud), "the pad legend does not say what LB/RB select");
  assert(/Q\/R pick a teammate on the roster/.test(hud), "the keyboard legend does not say what Q/R select");
  assert(!/\[RB\] select ·|Q\/R select ·/.test(hud), "a bare \"select\" is back in the legend");
});

check("the action prompt shows the scheme's key, not a hard-coded [E]", () => {
  assert(/attr\(data-key\)/.test(read("css/style.css")), "the prompt suffix is not driven by data-key");
  assert(/prompt\.dataset\.key = KEYS\[scheme\]/.test(read("src/hud.js")), "setHints does not set the prompt's key");
});

// ---- negative controls ----------------------------------------------------
const broken = (k, patch, why) => check(`negative control — ${k}: ${why}`, () => {
  assert(G[k]({ ...REAL, ...patch }).length > 0, `the ${k} guard passed on a broken game — it is inert`);
});
broken("resolves", { keys: { ...KEYS, gamepad: { ...KEYS.gamepad, select: undefined } } }, "the pad has no name for select");
broken("resolves", { keys: (() => { const k = { ...KEYS, touch: { ...KEYS.touch } }; delete k.touch.give; return k; })() }, "touch is missing a token");
broken("resolves", { mainSrc: REAL.mainSrc.replace("press {name} to name", "press {accuse} to name") }, "the morning uses a token nobody defines");
broken("bound", { keys: { ...KEYS, keyboard: { ...KEYS.keyboard, give: "C" } } }, "the keyboard brief says give is C");
broken("bound", { keys: { ...KEYS, gamepad: { ...KEYS.gamepad, give: "D-pad Up" } } }, "the pad brief says give is D-pad Up");
broken("bound", { inputSrc: REAL.inputSrc.replace('case "KeyQ": push(ACTIONS.PREV_TARGET)', 'case "KeyQ": push(ACTIONS.CALL)') }, "Q is rebound and the brief still says Q");
broken("hands", { handsBrief: "Pick IREN out on the roster, then hand it to her." }, "the brief as it shipped: no keys at all");

if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(1);
}
console.log(`\n${passed} passed, 0 failed`);
console.log("keys: OK — every instruction names the button in the player's hand");
