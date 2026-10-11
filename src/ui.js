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
  pinHeader(m.querySelector(".panel"));
  current = { onBack };
  const first = m.querySelector("[autofocus]") || m.querySelector("button:not([disabled])");
  if (first) first.focus({ preventScroll: true });
  return m;
}
/**
 * Keep a panel's title (and the short lines right under it) in view while its
 * list scrolls: on a short screen a pad moving focus down the list would
 * otherwise scroll the title away. The pinned height is published as --head
 * so focused buttons scroll clear of it.
 */
function pinHeader(panel) {
  if (!panel) return;
  const kids = [...panel.children];
  const take = [];
  for (const k of kids) {
    if (/^H[12]$/.test(k.tagName) || (take.length && k.tagName === "P")) take.push(k);
    else break;
  }
  if (!take.length) return;
  const head = document.createElement("div");
  head.className = "head";
  panel.insertBefore(head, take[0]);
  for (const k of take) head.appendChild(k);
  panel.style.setProperty("--head", head.offsetHeight + "px");
}

/** Scroll the panel just enough that `el` sits below the pinned title and above the bottom edge. */
function reveal(el) {
  const panel = el.closest(".panel");
  if (!panel) return;
  const head = panel.querySelector(".head");
  const top = head ? head.getBoundingClientRect().bottom : panel.getBoundingClientRect().top;
  const bottom = Math.min(panel.getBoundingClientRect().bottom, window.innerHeight);
  const r = el.getBoundingClientRect();
  if (r.top < top + 6) panel.scrollTop -= top + 6 - r.top;
  else if (r.bottom > bottom - 6) panel.scrollTop += r.bottom - (bottom - 6);
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
  if (el) { el.focus({ preventScroll: true }); reveal(el); }
}

/** Bind data-do="name" buttons in the open panel to handlers. */
export function bind(handlers) {
  for (const b of $("modal").querySelectorAll("[data-do]")) {
    b.addEventListener("click", (e) => { e.preventDefault(); const h = handlers[b.dataset.do]; if (h) h(b.dataset.arg, b); });
  }
}

/**
 * The nearest enabled button in a direction, by where the buttons actually sit
 * on screen — so a grid of − + buttons moves left/right along a row and up/down
 * a column, the way a d-pad means. Nothing that way: up/down wrap to the other
 * end of the list; left/right stay put.
 */
export function spatial(buttons, from, dir) {
  const c = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };
  const a = c(from);
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  let best = null, bestScore = Infinity;
  for (const b of buttons) {
    if (b === from) continue;
    const p = c(b);
    const dx = p.x - a.x, dy = p.y - a.y;
    const along = dx * v[0] + dy * v[1];
    if (along <= 4) continue;
    const across = Math.abs(dx * v[1] - dy * v[0]);
    // Overlapping in the other axis (same row / same column) beats being close diagonally.
    const overlap = v[0] ? (p.r.bottom > a.r.top && p.r.top < a.r.bottom) : (p.r.right > a.r.left && p.r.left < a.r.right);
    const score = along + across * (overlap ? 0.5 : 3);
    if (score < bestScore) { bestScore = score; best = b; }
  }
  if (best) return best;
  if (dir === "down") return buttons[0];
  if (dir === "up") return buttons[buttons.length - 1];
  return null;
}

/** Panel navigation from input actions. Returns true if the panel used it. */
export function navigate(action, e) {
  if (!current) return false;
  const m = $("modal");
  const buttons = [...m.querySelectorAll("button:not([disabled])")];
  const i = buttons.indexOf(document.activeElement);
  if (action === "up" || action === "down" || action === "left" || action === "right") {
    if (!buttons.length) return true;
    const next = i < 0 ? buttons[0] : spatial(buttons, buttons[i], action);
    if (next) { next.focus({ preventScroll: true }); reveal(next); }
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
  $("hud-pile").textContent = pile ? `Pile ${pile.pile}${pile.surplus ? ` · surplus ${pile.surplus}` : ""}` : "";
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
