// diag.js — Tab on a PC: what the game is being told about movement, the
// screen, and zoom. Input and display facts only; it reads nothing from sim
// beyond where the lead stands, so it can never show the hidden meter.
//
// Why it exists: "forward goes forward and 18 degrees right" cannot be told from
// here. The sim and the camera agree to the degree in every test, so the lean is
// in what arrives (raw stick/key, display scaling, browser zoom) — and this
// prints each of those side by side.

const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const deg = (r) => ((r * 180) / Math.PI).toFixed(1);

export function createDiag(canvas) {
  const el = document.createElement("pre");
  el.id = "diag";
  el.className = "hidden";
  el.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:50;margin:0;padding:10px 12px;" +
    "font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#d8f0ff;" +
    "background:rgba(8,12,20,.82);border:1px solid #3a5a78;border-radius:6px;" +
    "pointer-events:none;white-space:pre;";
  document.body.appendChild(el);

  let on = false;
  let last = null; // { x, z, t } — displacement sample for the walked angle
  let walked = null;
  let nextDraw = 0;

  function toggle() {
    on = !on;
    el.classList.toggle("hidden", !on);
    last = null;
    walked = null;
    return on;
  }

  function pads() {
    const out = [];
    for (const p of (navigator.getGamepads ? navigator.getGamepads() : [])) {
      if (p) out.push(`pad ${p.index} ${p.mapping || "no-mapping"} axes ${[...p.axes].slice(0, 4).map((a) => a.toFixed(2)).join(" ")}`);
    }
    return out.length ? out.join("\n  ") : "none";
  }

  /** Call every frame with the lead's intent and the world move derived from it. */
  function update(d) {
    if (!on) return;
    const now = performance.now();
    // Direction actually WALKED, against the way the camera points. If this is
    // not ~0 while the input is straight forward, the lean is real and downstream
    // of the input; if it is ~0, the lean is in the input or on the display.
    if (!last) last = { x: d.x, z: d.z, t: now };
    else if (now - last.t > 250) {
      const dx = d.x - last.x, dz = d.z - last.z;
      if (Math.hypot(dx, dz) > 0.05) walked = wrap(Math.atan2(-dx, -dz) - d.yaw);
      last = { x: d.x, z: d.z, t: now };
    }
    if (now < nextDraw) return;
    nextDraw = now + 120;

    const rc = canvas.getBoundingClientRect();
    const vv = window.visualViewport;
    const dpr = window.devicePixelRatio || 1;
    const lean = Math.atan2(d.input.x, -d.input.z); // angle of the raw input off straight forward
    el.textContent = [
      "DIAG  (Tab to hide)",
      "",
      "MOVEMENT",
      `  input    x ${d.input.x.toFixed(2)}  z ${d.input.z.toFixed(2)}  (up = z -1)`,
      d.input.x || d.input.z ? `  input lean   ${deg(lean)} deg off forward` : "  input lean   -",
      `  yaw          ${deg(d.yaw)} deg`,
      `  world move   x ${d.move.x.toFixed(2)}  z ${d.move.z.toFixed(2)}`,
      `  walked vs view   ${walked === null ? "-" : deg(walked) + " deg  (0 = straight ahead)"}`,
      `  pads  ${pads()}`,
      "",
      "RESOLUTION",
      `  canvas css   ${rc.width.toFixed(0)} x ${rc.height.toFixed(0)}`,
      `  canvas buf   ${canvas.width} x ${canvas.height}   (${(canvas.width / rc.width).toFixed(3)} x ${(canvas.height / rc.height).toFixed(3)} per css px)`,
      `  aspect       css ${(rc.width / rc.height).toFixed(3)}   buf ${(canvas.width / canvas.height).toFixed(3)}   camera ${d.camera.aspect.toFixed(3)}`,
      `  screen       ${screen.width} x ${screen.height}`,
      "",
      "ZOOM",
      `  devicePixelRatio  ${dpr.toFixed(3)}   (render cap 2)`,
      `  window  inner ${innerWidth} x ${innerHeight}   outer ${outerWidth} x ${outerHeight}`,
      `  screen x ratio    ${(screen.width * dpr).toFixed(0)} x ${(screen.height * dpr).toFixed(0)}   (should equal your real resolution; larger = browser zoom is on)`,
      `  pinch scale ${vv ? vv.scale.toFixed(2) : "?"}`,
      `  fov   horizontal ${d.hfov}   vertical ${d.camera.fov.toFixed(1)}`,
    ].join("\n");
  }

  return { toggle, update, get on() { return on; } };
}
