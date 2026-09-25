// keys.js — what the buttons are CALLED, per control scheme. Pure; no DOM.
//
// Every instruction that tells the player to press something has to name the
// thing they are holding. "Pick IREN out on the roster" with no key, and a
// legend that says "LB/RB select" without saying select WHAT, were both
// reported from a real playtest on a pad — the player had the verb and no way
// to find it. So instructions carry {tokens}, and the scheme fills them in at
// the moment they are shown.
//
// The bindings themselves live in input.js. This is only their NAMES, and
// tests/keys.mjs holds the two together so a rebinding cannot leave a brief
// telling the player to press the old button.

export const KEYS = Object.freeze({
  keyboard: Object.freeze({
    move: "WASD",
    act: "E",
    select: "Q/R",
    give: "B",
    craft: "C",
    call: "T",
    checkin: "press the number beside their name (1–5)",
    name: "B",
  }),
  gamepad: Object.freeze({
    move: "the left stick",
    act: "A",
    select: "LB/RB",
    give: "D-pad Right",
    craft: "D-pad Up",
    call: "D-pad Left",
    checkin: "pick them with LB/RB, then press X",
    name: "D-pad Right",
  }),
  touch: Object.freeze({
    move: "the left half of the screen",
    act: "Survey",
    select: "Next",
    give: "Give",
    craft: "Craft",
    // There is no call button on touch yet (see the touch-buttons in
    // index.html). Saying "Call" would send the player hunting for it.
    call: "T on a keyboard — touch has no call button yet",
    checkin: "pick them with Next, then tap Check in",
    name: "Give",
  }),
});

/** Fill `{token}`s for a scheme. An unknown token is left visible rather than blanked. */
export function keyed(text, scheme = "keyboard") {
  const k = KEYS[scheme] || KEYS.keyboard;
  return String(text || "").replace(/\{(\w+)\}/g, (m, t) => (t in k ? k[t] : m));
}
