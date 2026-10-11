// ui.js — one modal at a time, and the HUD. Every panel has one way in
// (open) and one way out (close); while one is open the sim does not tick.
// Focus moves with up/down from any device, and "act" presses the focused
// button, so a pad or keyboard can drive every panel a mouse can.

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let current = null;   // { onBack }

export function open(html, { onBack = null, wide = false } = {}) {
  const m = $("modal");
  m.innerHTML = `<div class="panel${wide ? " wide" : ""}">${html}</div>`;
  m.classList.add("on");
  current = { onBack };
  const first = m.querySelector("[autofocus]") || m.querySelector("button:not([disabled])");
  if (first) first.focus({ preventScroll: true });
  return m;
}
export function close() {
  const m = $("modal");
  m.classList.remove("on"); m.innerHTML = "";
  current = null;
}
export const isOpen = () => current !== null;

/**
 * After a panel re-renders, put focus back where it was. `selector` is the
 * button just pressed; if it is now disabled, the next enabled button in the
 * same table row (or list) takes it. `force` wins when given.
 */
export function refocus(selector, force = null) {
  const m = $("modal");
  const pick = (sel) => sel && m.querySelector(sel);
  let el = pick(force);
  if (!el && selector) {
    const was = pick(selector);
    if (was && !was.disabled) el = was;
    else if (was) {
      const row = was.closest("tr, .card, .plan") || m;
      el = [...row.querySelectorAll("button:not([disabled])")][0] || null;
    }
  }
  if (!el) el = m.querySelector("button:not([disabled])");
  if (el) el.focus();
}

/** Bind data-do="name" buttons in the open panel to handlers. */
export function bind(handlers) {
  for (const b of $("modal").querySelectorAll("[data-do]")) {
    b.addEventListener("click", (e) => { e.preventDefault(); const h = handlers[b.dataset.do]; if (h) h(b.dataset.arg, b); });
  }
}

/** Panel navigation from input actions. Returns true if the panel used it. */
export function navigate(action, e) {
  if (!current) return false;
  const m = $("modal");
  const buttons = [...m.querySelectorAll("button:not([disabled])")];
  const i = buttons.indexOf(document.activeElement);
  if (action === "up" || action === "down") {
    if (!buttons.length) return true;
    const n = action === "up" ? (i <= 0 ? buttons.length - 1 : i - 1) : (i + 1) % buttons.length;
    buttons[n].focus({ preventScroll: false });
    if (e && e.preventDefault) e.preventDefault();
    return true;
  }
  if (action === "act") {
    if (e && e.preventDefault) e.preventDefault();
    (buttons[i] || buttons[0])?.click();
    return true;
  }
  if (action === "back" || action === "pause") {
    if (current.onBack) current.onBack();
    return true;
  }
  return true;   // swallow play actions while a panel is open
}

// ---- HUD --------------------------------------------------------------------
export function hud({ count, day, clock, area, carry, pile, prompt, hint, night }) {
  $("hud-count").textContent = count;
  $("hud-day").textContent = `Day ${day}`;
  $("hud-clock").textContent = clock;
  $("hud-clock").classList.toggle("night", night);
  $("hud-area").textContent = `Woods ${area} of 7`;
  $("hud-wood").textContent = carry > 0 ? `Carrying ${carry} wood` : "";
  $("hud-pile").textContent = pile != null ? `Pile ${pile}` : "";
  $("prompt").textContent = prompt || "";
  $("prompt").classList.toggle("on", !!prompt);
  $("hint").textContent = hint || "";
  $("hint").classList.toggle("on", !!hint);
}

let lastRef = null, msgTimer = 0;
export function messages(msgs, dt) {
  const box = $("msgs");
  const ref = msgs.length ? msgs[msgs.length - 1] : null;
  if (ref !== lastRef) {
    lastRef = ref;
    box.innerHTML = msgs.slice(-3).map((m) => `<div>${esc(m.text)}</div>`).join("");
    box.classList.toggle("on", !!ref);
    msgTimer = 7;
  }
  msgTimer -= dt;
  if (msgTimer <= 0) box.classList.remove("on");
}
export function setPlaying(on) { document.body.classList.toggle("playing", on); }
