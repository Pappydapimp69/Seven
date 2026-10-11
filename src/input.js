// input.js — keyboard, touch and gamepad, into one movement vector and named
// actions. Up on the screen is north, always: no camera, no rotation.
//
// Actions: act, fire, call, camp, rest, pause. In a panel the same devices
// move focus (up/down), press (act) and go back (back).

const KEYMAP = {
  KeyE: "act", Space: "act", Enter: "act", KeyF: "fire", KeyC: "call", KeyQ: "camp", KeyR: "rest",
  Escape: "pause", KeyP: "pause",
};

export function createInput({ onAction, stickEl, stickKnob }) {
  const keys = new Set();
  const vec = { mx: 0, my: 0 };
  const stick = { id: null, ox: 0, oy: 0, mx: 0, my: 0 };
  let pad = { buttons: [], up: false, down: false };
  let usedTouch = false;

  window.addEventListener("keydown", (e) => {
    if (e.repeat) { if (e.code.startsWith("Arrow")) e.preventDefault(); return; }
    keys.add(e.code);
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    if (e.code === "ArrowUp" || e.code === "KeyW") onAction("up", e);
    if (e.code === "ArrowDown" || e.code === "KeyS") onAction("down", e);
    if (e.code === "Escape" || e.code === "Backspace") onAction("back", e);
    const a = KEYMAP[e.code];
    if (a) onAction(a, e);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  // Touch: a floating stick anywhere on the left half of the screen.
  const zone = document.getElementById("game");
  zone.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || stick.id !== null || e.clientX > window.innerWidth * 0.55) return;
    usedTouch = true; document.body.classList.add("touch");
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.mx = stick.my = 0;
    stickEl.style.left = e.clientX + "px"; stickEl.style.top = e.clientY + "px"; stickEl.classList.add("on");
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stick.id) return;
    const R = 50;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    stick.mx = dx / R; stick.my = dy / R;
    stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const end = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.id = null; stick.mx = stick.my = 0; stickEl.classList.remove("on"); stickKnob.style.transform = "";
  };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);
  window.addEventListener("touchstart", () => { usedTouch = true; document.body.classList.add("touch"); }, { once: true, passive: true });

  for (const b of document.querySelectorAll("[data-act]")) {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); onAction(b.dataset.act, e); });
  }

  function poll() {
    let mx = 0, my = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
    if (stick.id !== null) { mx += stick.mx; my += stick.my; }
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.2) { mx += ax; my += ay; }
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      if (b(14)) mx -= 1; if (b(15)) mx += 1; if (b(12)) my -= 1; if (b(13)) my += 1;
      const map = { 0: "act", 2: "fire", 3: "call", 4: "camp", 5: "camp", 1: "rest", 9: "pause", 8: "pause" };
      gp.buttons.forEach((btn, i) => {
        const was = pad.buttons[i];
        if (btn.pressed && !was) {
          if (i === 1) onAction("back");
          if (map[i]) onAction(map[i]);
        }
      });
      pad.buttons = gp.buttons.map((x) => x.pressed);
      const up = ay < -0.6 || b(12), down = ay > 0.6 || b(13);
      if (up && !pad.up) onAction("up"); if (down && !pad.down) onAction("down");
      pad.up = up; pad.down = down;
    }
    const len = Math.hypot(mx, my);
    vec.mx = len > 1 ? mx / len : mx; vec.my = len > 1 ? my / len : my;
    return vec;
  }

  return { poll, get touch() { return usedTouch; }, clear() { keys.clear(); } };
}
