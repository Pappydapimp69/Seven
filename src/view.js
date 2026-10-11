// view.js — the woods in first person: a grid raycaster on a 2D canvas.
// Draws from the PERCEPT (and the grid, which never lies, and the clock's
// daylight). No WebGL, no camera rig.
//
// Forest cells are tree walls. Everything else that stands in the world —
// people, pylons, the fire, the tent, the woodpile and the surplus stack,
// deadfalls, stumps — is a billboard, depth-tested per column. Light is per
// pixel: daylight, the fire (its light reaches FIRE_LIGHT, further than its
// warmth), the lead's lantern, lit pylons.
//
// Brain mirage#E10: the horizontal field of view is FIXED; the screen's shape
// changes only the vertical. The image is rendered at a capped internal width
// and scaled up; the canvas backing is CSS size × devicePixelRatio, re-read on
// every resize and every DPR change.

import { K } from "./world.js?v=seven-1.13.0";
import { hash01 } from "./rng.js?v=seven-1.13.0";
import { FIRE_LIGHT, DAWN, DUSK, PILE_CAP, SURPLUS_CAP } from "./config.js?v=seven-1.13.0";

export const SLOT_COLORS = ["#e0b354", "#5fb3c9", "#d9745a", "#9fc46a", "#b98fd6", "#e88fb0"];
export const HFOV = (72 * Math.PI) / 180;
const EYE = 0.72, WALL_H = 2.4, MAX_DIST = 26, FOG_DIST = 22;
const FLOOR = {
  [K.TRAIL]: [106, 86, 57], [K.DEADFALL]: [106, 86, 57], [K.CLEAR]: [62, 84, 50], [K.STUMP]: [62, 84, 50],
  [K.EXIT]: [146, 158, 122], [K.FOREST]: [24, 36, 27], [K.TREE]: [24, 36, 27],
};
const TINT_RGB = { 1: [46, 94, 124], 2: [36, 33, 31], 3: [112, 110, 104] };   // water, ash, gravel
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function createView(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const off = document.createElement("canvas");
  const o = off.getContext("2d");
  let W = 0, H = 0, dpr = 1, RW = 0, RH = 0, img = null, img32 = null, zbuf = null, focal = 1;
  const sprites = new Map();
  const state = { visible: new Set() };

  // Quality scales the INTERNAL resolution only (the canvas backing stays
  // CSS × devicePixelRatio, crisp text and rings). A machine that cannot keep
  // the frame cheap gets fewer, wider pixels instead of lag; one with room to
  // spare gets them back. See tune() below.
  let quality = 1, avgMs = 4, frames = 0;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    allocate();
  }
  function allocate() {
    RW = Math.max(160, Math.min(480, Math.round((W / 2) * quality)));
    RH = Math.max(100, Math.round((RW * H) / W));
    off.width = RW; off.height = RH;
    img = o.createImageData(RW, RH);
    img32 = new Uint32Array(img.data.buffer);
    zbuf = new Float32Array(RW);
    focal = RW / 2 / Math.tan(HFOV / 2);
  }
  resize();
  window.addEventListener("resize", resize);
  (function watchDpr() {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const on = () => { resize(); mq.removeEventListener("change", on); watchDpr(); };
    mq.addEventListener("change", on);
  })();

  function daylight(mod) {
    const ramp = (a, b, m) => Math.max(0, Math.min(1, (m - a) / (b - a)));
    if (mod >= DAWN + 60 && mod < DUSK - 60) return 1;
    if (mod >= DUSK - 60 && mod < DUSK + 60) return 1 - ramp(DUSK - 60, DUSK + 60, mod);
    if (mod >= DAWN - 60 && mod < DAWN + 60) return ramp(DAWN - 60, DAWN + 60, mod);
    return 0;
  }

  // ---- sprites, drawn once per kind/state and cached ----
  function sprite(key, w, h, paint) {
    let c = sprites.get(key);
    if (!c) { c = document.createElement("canvas"); c.width = w; c.height = h; paint(c.getContext("2d"), w, h); sprites.set(key, c); }
    return c;
  }
  function shaded(key, base, level) {
    const b = Math.max(0, Math.min(7, Math.round(level * 7)));
    const k = `${key}@${b}`;
    let c = sprites.get(k);
    if (!c) {
      c = document.createElement("canvas"); c.width = base.width; c.height = base.height;
      const g = c.getContext("2d"); g.drawImage(base, 0, 0);
      g.globalCompositeOperation = "source-atop"; g.fillStyle = `rgba(4,6,14,${1 - b / 7})`; g.fillRect(0, 0, c.width, c.height);
      sprites.set(k, c);
    }
    return c;
  }
  const personSprite = (color, asleep, carrying, pose = 0) => sprite(`p:${color}:${asleep}:${carrying}:${pose}`, asleep ? 64 : 40, asleep ? 20 : 64, (g, w, h) => {
    if (asleep) {
      g.fillStyle = color; g.beginPath(); g.ellipse(w * 0.45, h * 0.6, w * 0.36, h * 0.32, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#e9d2b5"; g.beginPath(); g.arc(w * 0.86, h * 0.55, h * 0.3, 0, Math.PI * 2); g.fill();
      return;
    }
    // pose 1/2: an axe raised / struck (chopping, felling, building).
    if (pose) {
      g.save(); g.translate(w * 0.62, h * 0.42); g.rotate(pose === 1 ? -2.2 : 0.5);
      g.fillStyle = "#6b4a2a"; g.fillRect(-1.5, -h * 0.34, 3, h * 0.36);
      g.fillStyle = "#9aa0a2"; g.fillRect(-1.5, -h * 0.36, 8, 6);
      g.restore();
    }
    g.fillStyle = "#2b2420"; g.fillRect(w * 0.32, h * 0.72, w * 0.14, h * 0.28); g.fillRect(w * 0.54, h * 0.72, w * 0.14, h * 0.28);
    g.fillStyle = color; g.beginPath(); g.ellipse(w / 2, h * 0.5, w * 0.34, h * 0.26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#e9d2b5"; g.beginPath(); g.arc(w / 2, h * 0.17, w * 0.2, 0, Math.PI * 2); g.fill();
    if (carrying) { g.fillStyle = "#7b5a36"; g.fillRect(w * 0.1, h * 0.42, w * 0.8, h * 0.08); }
  });
  const pylonSprite = (stateKey, rgb) => sprite(`y:${stateKey}:${rgb}`, 32, 80, (g, w, h) => {
    g.fillStyle = "#6d7270"; g.fillRect(w * 0.28, h * 0.08, w * 0.44, h * 0.84);
    g.fillStyle = "#4c504e"; g.fillRect(w * 0.14, h * 0.86, w * 0.72, h * 0.14);
    g.fillStyle = rgb; g.fillRect(w * 0.38, h * 0.16, w * 0.24, h * 0.22);
  });
  const tentSprite = () => sprite("tent", 64, 44, (g, w, h) => {
    g.fillStyle = "#8a7a55"; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
    g.fillStyle = "#3a3122"; g.beginPath(); g.moveTo(w / 2, h * 0.35); g.lineTo(w * 0.62, h); g.lineTo(w * 0.38, h); g.closePath(); g.fill();
  });
  const pileSprite = (rows) => sprite(`pile:${rows}`, 48, 40, (g, w, h) => {
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, h - 4, w, 4);
    if (!rows) { g.strokeStyle = "#8b7350"; g.lineWidth = 2; g.strokeRect(4, h - 9, w - 8, 5); return; }
    for (let r = 0; r < rows; r++) {
      const n = r % 2 ? 3 : 4, rw = w / 4;
      for (let i = 0; i < n; i++) {
        const lx = (w - n * rw) / 2 + rw / 2 + i * rw, ly = h - 8 - r * 8;
        g.fillStyle = "#6e4f2e"; g.beginPath(); g.arc(lx, ly, 5.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#c9a26b"; g.beginPath(); g.arc(lx, ly, 3, 0, Math.PI * 2); g.fill();
      }
    }
  });
  const surplusSprite = (rows) => sprite(`surplus:${rows}`, 48, 56, (g, w, h) => {
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, h - 4, w, 4);
    g.fillStyle = "#4f3a22"; g.fillRect(2, 4, 5, h - 6); g.fillRect(w - 7, 4, 5, h - 6);
    for (let r = 0; r < rows; r++) {
      const ly = h - 10 - r * 9;
      g.fillStyle = r % 2 ? "#8a6a43" : "#7b5a36"; g.fillRect(7, ly - 4, w - 14, 8);
      g.fillStyle = "#c9a26b"; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(11 + i * ((w - 22) / 3), ly, 2.6, 0, Math.PI * 2); g.fill(); }
    }
  });
  const fallSprite = () => sprite("fall", 64, 26, (g, w, h) => {
    g.fillStyle = "#5a4128"; g.fillRect(0, h * 0.5, w, h * 0.42);
    g.fillStyle = "#3e2c1b"; g.fillRect(0, h * 0.1, w, h * 0.42);
    g.fillStyle = "#c9a26b"; g.beginPath(); g.arc(4, h * 0.3, 4, 0, Math.PI * 2); g.fill();
  });
  const stumpSprite = () => sprite("stump", 32, 16, (g, w, h) => {
    g.fillStyle = "#4a3a26"; g.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.7);
    g.fillStyle = "#b39466"; g.beginPath(); g.ellipse(w / 2, h * 0.3, w * 0.3, h * 0.22, 0, 0, Math.PI * 2); g.fill();
  });
  // Landmarks, each drawn as the thing it is named for (three variants of each).
  const decorSprite = (kind, v) => {
    const n = Math.min(2, Math.floor(v * 3));
    return sprite(`decor:${kind}:${n}`, 40, 96, (g, w, h) => {
      const r = (a) => a * (0.9 + 0.1 * n);
      if (kind === "birch") {
        g.fillStyle = "#e8e6dc"; g.fillRect(w * 0.4, h * 0.12, w * 0.2, h * 0.88);
        g.fillStyle = "#2a2724"; for (let i = 0; i < 7; i++) g.fillRect(w * 0.4, h * (0.2 + i * 0.11 + n * 0.01), w * (0.1 + 0.1 * ((i + n) % 2)), 3);
        g.fillStyle = "#b9c76a"; g.beginPath(); g.ellipse(w * 0.5, h * 0.14, w * 0.42, h * 0.14, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#8fa84c"; g.beginPath(); g.ellipse(w * 0.4, h * 0.18, w * 0.25, h * 0.09, 0, 0, Math.PI * 2); g.fill();
      } else if (kind === "reeds") {
        for (let i = 0; i < 7; i++) {
          const x = w * (0.1 + i * 0.12), top = h * (0.55 + 0.12 * ((i * 5 + n) % 3) / 3);
          g.strokeStyle = i % 2 ? "#5d6f3a" : "#4a5c2f"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, h); g.lineTo(x + (i % 3 - 1) * 3, top); g.stroke();
          if (i % 3 === 0) { g.fillStyle = "#5b3b22"; g.fillRect(x - 2 + (i % 3 - 1) * 3, top - 9, 4, 10); }
        }
      } else if (kind === "boulder") {
        g.fillStyle = "#6e7072"; g.beginPath(); g.ellipse(w * 0.5, h * 0.84, w * r(0.48), h * r(0.15), 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#8a8d8f"; g.beginPath(); g.ellipse(w * 0.44, h * 0.8, w * 0.28, h * 0.08, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#4f6a3c"; g.beginPath(); g.ellipse(w * 0.62, h * 0.9, w * 0.14, h * 0.04, 0, 0, Math.PI * 2); g.fill();
      } else if (kind === "snag") {
        g.fillStyle = "#1e1b19"; g.fillRect(w * 0.38, h * (0.22 + 0.06 * n), w * 0.24, h * (0.78 - 0.06 * n));
        g.beginPath(); g.moveTo(w * 0.38, h * (0.22 + 0.06 * n)); g.lineTo(w * 0.5, h * 0.1); g.lineTo(w * 0.62, h * (0.22 + 0.06 * n)); g.fill();
        g.fillStyle = "#3b332d"; g.fillRect(w * 0.44, h * 0.4, w * 0.04, h * 0.5);
      } else {   // stone
        g.fillStyle = "#7a7d7f"; g.beginPath(); g.moveTo(w * 0.22, h); g.lineTo(w * 0.28, h * (0.18 + 0.05 * n)); g.lineTo(w * 0.5, h * (0.1 + 0.05 * n)); g.lineTo(w * 0.74, h * (0.2 + 0.04 * n)); g.lineTo(w * 0.8, h); g.closePath(); g.fill();
        g.fillStyle = "#5e6264"; g.fillRect(w * 0.55, h * 0.25, w * 0.1, h * 0.75);
        g.fillStyle = "#4f6a3c"; g.fillRect(w * 0.24, h * 0.7, w * 0.5, h * 0.12);
      }
    });
  };
  const DECOR_SIZE = { birch: [0.55, 2.5], reeds: [0.7, 0.85], boulder: [1.0, 0.8], snag: [0.5, 1.9], stone: [0.75, 1.9] };
  const fireCanvas = document.createElement("canvas"); fireCanvas.width = 32; fireCanvas.height = 40;
  function paintFire(fuel, t) {
    const g = fireCanvas.getContext("2d"), w = 32, h = 40;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#555048"; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(4 + i * 6, h - 3, 3.2, 0, Math.PI * 2); g.fill(); }
    if (fuel <= 0) { g.fillStyle = "#2b2622"; g.fillRect(8, h - 6, 16, 3); return fireCanvas; }
    const s = 0.45 + 0.55 * Math.min(1, fuel / 5), f = 1 + 0.12 * Math.sin(t * 11) + 0.08 * Math.sin(t * 17);
    g.fillStyle = "#e8742c"; g.beginPath(); g.ellipse(w / 2, h - 6 - 14 * s * f, 9 * s, 15 * s * f, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffd36b"; g.beginPath(); g.ellipse(w / 2, h - 6 - 8 * s * f, 4.5 * s, 9 * s * f, 0, 0, Math.PI * 2); g.fill();
    return fireCanvas;
  }

  function tune(ms) {
    avgMs += (ms - avgMs) * 0.08;
    if (++frames < 45) return;
    frames = 0;
    if (avgMs > 11 && quality > 0.34) { quality = Math.max(0.34, quality * 0.8); allocate(); }
    else if (quality < 1) {
      // Grow only if the bigger image is predicted to stay cheap: cost goes with
      // the pixel count, so a step up costs about the step squared. That keeps
      // it from hovering at the edge of the shrink threshold.
      const next = Math.min(1, quality * 1.15);
      if (avgMs * (next / quality) ** 2 < 8) { quality = next; allocate(); }
    }
  }

  function draw(world, view, clock) {
    const TS = performance.now();
    const L = view.lead, yaw = L.yaw ?? -Math.PI / 2;
    const px = L.x, py = L.y;
    const dx = Math.cos(yaw), dy = Math.sin(yaw);
    const tanH = Math.tan(HFOV / 2);
    const plx = -dy * tanH, ply = dx * tanH;
    const day = daylight(clock.mod), ambient = 0.13 + 0.87 * day;
    const fire = view.camp && view.camp.fire > 0 ? view.camp : null;
    const fireS = fire ? 0.6 + 0.4 * Math.min(1, fire.fire / 4) : 0;
    const flick = 1 + 0.04 * Math.sin(clock.real * 9);
    const lit = view.pylons.filter((p) => p.state === "lit");
    // Light at a world point: [level 0..~1.3, warmth 0..1].
    // Light at a world point, as a SHARED [level, warmth] pair (read it at once —
    // it is overwritten by the next call). No allocation and no Math.hypot: this
    // runs tens of thousands of times a frame.
    const LW = [1, 0], fr2 = fire ? (FIRE_LIGHT * flick) ** 2 : 0, fr = fire ? FIRE_LIGHT * flick : 0;
    const light = (x, y) => {
      let l = ambient, warm = 0;
      if (fire) {
        const ddx = x - fire.x, ddy = y - fire.y, d2 = ddx * ddx + ddy * ddy;
        if (d2 < fr2) { const k = (1 - Math.sqrt(d2) / fr) ** 1.4 * fireS; l += k; warm += k; }
      }
      const ex = x - px, ey = y - py, e2 = ex * ex + ey * ey;
      if (e2 < 12.96 && day < 1) l += 0.5 * (1 - Math.sqrt(e2) / 3.6) * (1 - day);
      for (let i = 0; i < lit.length; i++) { const p = lit[i], qx = x - p.x, qy = y - p.y, q2 = qx * qx + qy * qy; if (q2 < 7.84) l += 0.55 * (1 - Math.sqrt(q2) / 2.8); }
      LW[0] = l > 1.3 ? 1.3 : l; LW[1] = warm > 1 ? 1 : warm;
      return LW;
    };
    const fogRgb = [Math.round(18 + 70 * day), Math.round(24 + 86 * day), Math.round(26 + 80 * day)];

    const T0 = performance.now();
    // ---- sky and ground, per pixel ----
    const data = img.data, hz = RH / 2;
    const sky0 = [Math.round(10 + 120 * day), Math.round(13 + 150 * day), Math.round(26 + 160 * day)];
    for (let y = 0; y < RH; y++) {
      const row = y * RW * 4;
      if (y < hz) {
        const k = y / hz;
        const r = (sky0[0] * (1 - k) + fogRgb[0] * k) | 0, g = (sky0[1] * (1 - k) + fogRgb[1] * k) | 0, b = (sky0[2] * (1 - k) + fogRgb[2] * k) | 0;
        // The sky is one colour along a row: one fill, not RW pixel writes.
        img32.fill((255 << 24) | (b << 16) | (g << 8) | r, y * RW, (y + 1) * RW);
        continue;
      }
      const rowDist = (EYE * focal) / (y - hz + 0.5);
      const fog = Math.min(1, rowDist / FOG_DIST);
      const lx0 = px + rowDist * (dx - plx), ly0 = py + rowDist * (dy - ply);
      const sx = (rowDist * 2 * plx) / RW, sy = (rowDist * 2 * ply) / RW;
      let wx = lx0, wy = ly0, fl = 1, fw = 0;
      for (let x = 0; x < RW; x++, wx += sx, wy += sy) {
        const cx = Math.floor(wx), cy = Math.floor(wy);
        const k = cx < 0 || cy < 0 || cx >= world.W || cy >= world.H ? K.FOREST : world.grid[cy * world.W + cx];
        const tn = world.tint ? world.tint[cy * world.W + cx] : 0;
        const base = tn && k !== K.FOREST ? TINT_RGB[tn] : FLOOR[k];
        const v = 0.9 + 0.2 * (((cx * 7 + cy * 13) & 7) / 7);
        if ((x & 3) === 0) { const lw = light(wx, wy); fl = lw[0]; fw = lw[1]; }
        const l = fl, warm = fw;
        const i = row + x * 4;
        data[i] = (base[0] * v * l + 60 * warm) * (1 - fog) + fogRgb[0] * day * fog;
        data[i + 1] = (base[1] * v * l + 25 * warm) * (1 - fog) + fogRgb[1] * day * fog;
        data[i + 2] = base[2] * v * l * (1 - fog) + fogRgb[2] * day * fog;
        data[i + 3] = 255;
      }
    }
    o.putImageData(img, 0, 0);

    const T1 = performance.now();
    // ---- tree walls, one DDA ray per column ----
    for (let x = 0; x < RW; x++) {
      const cam = (2 * x) / RW - 1;
      const rx = dx + plx * cam, ry = dy + ply * cam;
      let mx = Math.floor(px), my = Math.floor(py);
      const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
      const stepX = rx < 0 ? -1 : 1, stepY = ry < 0 ? -1 : 1;
      let sdx = rx < 0 ? (px - mx) * ddx : (mx + 1 - px) * ddx;
      let sdy = ry < 0 ? (py - my) * ddy : (my + 1 - py) * ddy;
      let side = 0, hit = -1, dist = MAX_DIST;
      for (let n = 0; n < 80; n++) {
        if (sdx < sdy) { sdx += ddx; mx += stepX; side = 0; } else { sdy += ddy; my += stepY; side = 1; }
        const k = mx < 0 || my < 0 || mx >= world.W || my >= world.H ? K.FOREST : world.grid[my * world.W + mx];
        if (k === K.FOREST || k === K.TREE) { hit = k; dist = side === 0 ? sdx - ddx : sdy - ddy; break; }
        if ((side === 0 ? sdx - ddx : sdy - ddy) > MAX_DIST) break;
      }
      zbuf[x] = dist;
      if (hit < 0) continue;
      const hx = px + rx * dist, hy = py + ry * dist;
      const texX = side === 0 ? hy - Math.floor(hy) : hx - Math.floor(hx);
      const top = hz - ((WALL_H - EYE) * focal) / dist, bot = hz + (EYE * focal) / dist;
      const h = hash01(`${mx},${my}`);
      const [l, warm] = light(hx - stepX * 0.01 * (side === 0), hy - stepY * 0.01 * (side === 1));
      const fog = Math.min(1, dist / FOG_DIST), shade = (side ? 0.82 : 1) * l;
      const mix = (r, g, b) => `rgb(${(r * shade + 50 * warm) * (1 - fog) + fogRgb[0] * day * fog | 0},${(g * shade + 20 * warm) * (1 - fog) + fogRgb[1] * day * fog | 0},${b * shade * (1 - fog) + fogRgb[2] * day * fog | 0})`;
      // Crowns: a ragged top edge against the sky, a ragged lower edge over the
      // trunks, and bands of light and shade across the leaves.
      const wave = (f, ph) => 0.5 + 0.5 * Math.sin(texX * Math.PI * 2 * f + ph);
      const span = bot - top;
      const crownTop = top + span * 0.16 * (wave(2, h * 6) * 0.7 + wave(5, h * 11) * 0.3);
      const leafY = top + span * (0.56 + 0.1 * wave(3, h * 4));
      const trunkLine = (texX * 4 + h) % 1 < 0.22;
      const band = 0.82 + 0.18 * wave(7, h * 9);
      o.fillStyle = hit === K.TREE ? mix((52 + 20 * h) * band, (98 + 20 * h) * band, 48 * band) : mix((28 + 14 * h) * band, (58 + 22 * h) * band, (32 + 8 * h) * band);
      o.fillRect(x, crownTop, 1, leafY - crownTop + 1);
      o.fillStyle = trunkLine ? mix(30, 22, 16) : mix(70 + 20 * h, 52 + 12 * h, 34);
      o.fillRect(x, leafY, 1, bot - leafY + 1);
      if (hit === K.TREE && texX > 0.38 && texX < 0.62) {   // the pale notch: this one can be felled
        o.fillStyle = mix(214, 190, 140);
        o.fillRect(x, bot - (bot - top) * 0.22, 1, (bot - top) * 0.1);
      }
    }

    const T2 = performance.now();
    // ---- billboards ----
    const list = [];
    const add = (x, y, base, wWorld, hWorld, opts = {}) => list.push({ x, y, base, wWorld, hWorld, ...opts });
    const R = 14;
    for (let cy = Math.max(0, Math.floor(py) - R); cy <= Math.min(world.H - 1, Math.floor(py) + R); cy++) {
      for (let cx = Math.max(0, Math.floor(px) - R); cx <= Math.min(world.W - 1, Math.floor(px) + R); cx++) {
        const k = world.grid[cy * world.W + cx];
        if (k === K.DEADFALL) add(cx + 0.5, cy + 0.5, fallSprite(), 1.05, 0.45, { key: "fall" });
        else if (k === K.STUMP) add(cx + 0.5, cy + 0.5, stumpSprite(), 0.45, 0.22, { key: "stump" });
      }
    }
    if (view.building) {
      // A camp going up: stakes first, then the tent rises with the work.
      const b = view.building, f = Math.max(0.05, b.frac);
      add(b.x - 1.6, b.y - 1.4, tentSprite(), 1.1 * Math.min(1, 0.4 + f), 0.76 * f, { key: "tent" });
      add(b.x, b.y, paintFire(0, clock.real), 0.5, 0.62, { bright: true });
    }
    if (view.camp) {
      const c = view.camp, down = view.takingDown ?? 1;
      add(c.x - 1.6, c.y - 1.4, tentSprite(), 1.1, 0.76 * Math.max(0.05, down), { key: "tent" });
      add(c.x, c.y, paintFire(c.fire, clock.real), 0.5, 0.62, { bright: true });
      const pr = c.pile <= 0 ? 0 : Math.min(4, Math.ceil((c.pile / PILE_CAP) * 4));
      add(c.x + 1.4, c.y + 1.2, pileSprite(pr), 0.62, 0.52, { key: `pile:${pr}` });
      const sr = c.surplus <= 0 ? 0 : Math.min(5, Math.ceil((c.surplus / SURPLUS_CAP) * 5));
      add(c.x + 2.6, c.y + 1.2, surplusSprite(sr), 0.62, 0.72, { key: `surplus:${sr}` });
    }
    for (const lm of view.landmarks || []) {
      if (Math.abs(lm.x - px) > 24 || Math.abs(lm.y - py) > 24) continue;
      for (const d of lm.decor) { const sz = DECOR_SIZE[d.kind]; add(d.x, d.y, decorSprite(d.kind, d.v), sz[0], sz[1], { key: `decor:${d.kind}:${Math.min(2, Math.floor(d.v * 3))}` }); }
    }
    for (const p of view.piles) {
      if (p.surplus) { const r = Math.min(5, Math.ceil((p.wood / SURPLUS_CAP) * 5)); add(p.x, p.y, surplusSprite(r), 0.62, 0.72, { key: `surplus:${r}` }); }
      else { const r = Math.min(4, Math.ceil((p.wood / PILE_CAP) * 4)); add(p.x, p.y, pileSprite(r), 0.62, 0.52, { key: `pile:${r}` }); }
    }
    for (const p of view.pylons) {
      let rgb = "#2a2e2d";
      if (p.state === "lit") { const a = Math.min(1, p.age); rgb = `rgb(${80 + 170 * a | 0},${170 - 110 * a | 0},${255 - 200 * a | 0})`; }
      else if (p.state === "spent") rgb = "#3a2422";
      add(p.x, p.y, pylonSprite(p.state + rgb, rgb), 0.5, 1.25, { key: `y:${p.state}${rgb}`, bright: p.state === "lit" });
    }
    for (const p of view.people) {
      const color = SLOT_COLORS[p.slot % SLOT_COLORS.length];
      const pose = p.work && !p.asleep ? 1 + (Math.floor(clock.real * 2.4 + p.slot * 0.37) % 2) : 0;
      add(p.x, p.y, personSprite(color, p.asleep, p.carrying, pose), p.asleep ? 0.95 : 0.62, p.asleep ? 0.3 : 0.98,
        { key: `p:${color}:${p.asleep}:${p.carrying}:${pose}`, person: p });
    }

    const invDet = 1 / (plx * dy - dx * ply);
    for (const s of list) {
      const rx = s.x - px, ry = s.y - py;
      s.tx = invDet * (dy * rx - dx * ry);
      s.depth = invDet * (-ply * rx + plx * ry);
    }
    list.sort((a, b) => b.depth - a.depth);
    state.visible = new Set();
    const labels = [];
    for (const s of list) {
      if (s.depth <= 0.15 || s.depth > MAX_DIST) continue;
      const scx = (RW / 2) * (1 + s.tx / s.depth);
      const hPx = (s.hWorld * focal) / s.depth, wPx = (s.wWorld * focal) / s.depth;
      const bottom = hz + (EYE * focal) / s.depth, top = bottom - hPx;
      const x0 = Math.floor(scx - wPx / 2), x1 = Math.ceil(scx + wPx / 2);
      if (x1 < 0 || x0 >= RW) continue;
      const [l] = light(s.x, s.y);
      const fog = Math.min(1, s.depth / FOG_DIST);
      const level = s.bright ? 1 : Math.max(0, l * (1 - 0.8 * fog));
      const src = s.key ? shaded(s.key, s.base, Math.min(1, level)) : s.base;
      let drew = false;
      for (let x = Math.max(0, x0); x < Math.min(RW, x1); x++) {
        if (s.depth >= zbuf[x]) continue;
        const u = Math.floor(((x - x0) / (x1 - x0)) * src.width);
        o.drawImage(src, u, 0, 1, src.height, x, top, 1, hPx);
        drew = true;
      }
      if (drew && s.person) {
        state.visible.add(s.person.id);
        if (s.depth < 7 && level > 0.12) labels.push({ name: s.person.name, x: scx, y: top, d: s.depth });
      }
    }

    const T3 = performance.now();
    // ---- to the screen ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, RW, RH, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T4 = performance.now();
    timing.floor = T1 - T0; timing.walls = T2 - T1; timing.sprites = T3 - T2; timing.blit = T4 - T3;
    const k = W / RW;
    labels.sort((a, b) => a.d - b.d);
    const placed = [];
    ctx.textAlign = "center";
    ctx.font = "600 14px system-ui, sans-serif";
    for (const lb of labels) {
      const x = lb.x * k, y = lb.y * (H / RH) - 6;
      if (placed.some((q) => Math.abs(q.x - x) < 70 && Math.abs(q.y - y) < 18)) continue;
      placed.push({ x, y });
      ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillText(lb.name, x + 1, y + 1);
      ctx.fillStyle = "#f4ead6"; ctx.fillText(lb.name, x, y);
    }
    ctx.textAlign = "start";
    // Your own hands: an axe while chopping or felling, a mallet while making
    // or taking down camp. A strike every 0.7 s, with chips and a thunk.
    const tool = { chop: "axe", fell: "axe", camp_make: "mallet", camp_down: "mallet" }[L.busy];
    if (tool && !L.asleep) {
      const period = 0.7, ph = (clock.real % period) / period;
      const ang = ph < 0.62 ? -1.05 + 0.25 * Math.sin((ph / 0.62) * Math.PI) * 0.3 : -1.05 + ((ph - 0.62) / 0.38) ** 0.5 * 1.45;
      if (ph < lastPhase) {                      // a new swing: the last one struck
        strikes.push({ t: clock.real, seed: Math.random() });
        if (opts.onStrike) opts.onStrike(tool);
      }
      lastPhase = ph;
      const s = Math.min(W, H) / 520;
      ctx.save();
      ctx.translate(W * 0.78, H * 1.02); ctx.rotate(ang); ctx.scale(s, s);
      ctx.fillStyle = "#5a3d22"; ctx.fillRect(-9, -330, 18, 330);
      ctx.fillStyle = "#3d2a17"; ctx.fillRect(-9, -330, 5, 330);
      if (tool === "axe") {
        ctx.fillStyle = "#8f9597"; ctx.beginPath(); ctx.moveTo(-10, -320); ctx.lineTo(-95, -350); ctx.lineTo(-100, -270); ctx.lineTo(-10, -282); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#cfd4d6"; ctx.fillRect(-100, -350, 8, 80);
      } else {
        ctx.fillStyle = "#6b4a2a"; ctx.fillRect(-60, -360, 120, 56);
        ctx.fillStyle = "#4e3520"; ctx.fillRect(-60, -360, 120, 12);
      }
      ctx.restore();
    } else lastPhase = 0;
    // Chips from the last strikes, flying out from the middle of the view.
    for (let i = strikes.length - 1; i >= 0; i--) {
      const st = strikes[i], age = clock.real - st.t;
      if (age > 0.6) { strikes.splice(i, 1); continue; }
      for (let k = 0; k < 7; k++) {
        const a = st.seed * 6.28 + k * 0.9, v = 160 + 90 * ((k * 37) % 5) / 5;
        const x = W / 2 + Math.cos(a) * v * age, y = H * 0.55 + Math.sin(a) * v * age * 0.6 + 380 * age * age;
        ctx.fillStyle = k % 2 ? "#c9a26b" : "#8a6a43"; ctx.globalAlpha = 1 - age / 0.6;
        ctx.fillRect(x, y, 5, 3);
      }
      ctx.globalAlpha = 1;
    }
    // Sleep, as a scene: the light goes, the hour is shown as it passes, the morning comes up.
    if (clock.fade > 0.01) {
      ctx.fillStyle = `rgba(2,3,8,${Math.min(0.98, clock.fade)})`; ctx.fillRect(0, 0, W, H);
      if (clock.sleepText) {
        ctx.textAlign = "center"; ctx.fillStyle = `rgba(214,222,240,${Math.max(0, clock.fade - 0.25)})`;
        ctx.font = `300 ${Math.round(Math.min(W, H) * 0.09)}px Georgia, serif`; ctx.fillText(clock.sleepText, W / 2, H * 0.5);
        ctx.font = `${Math.round(Math.min(W, H) * 0.028)}px system-ui, sans-serif`; ctx.fillStyle = `rgba(160,170,190,${Math.max(0, clock.fade - 0.4)})`;
        ctx.fillText("sleeping", W / 2, H * 0.5 + Math.min(W, H) * 0.07); ctx.textAlign = "start";
      }
    }
    // The whistle, drawn: rings that spread out from you and thin as they go.
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], age = clock.real - p.t;
      if (age > 1.5) { pulses.splice(i, 1); continue; }
      for (let r = 0; r < 3; r++) {
        const a = age - r * 0.22;
        if (a < 0) continue;
        const rad = Math.min(W, H) * (0.06 + 0.5 * (a / 1.2) ** 0.7 * p.size);
        ctx.strokeStyle = `rgba(235,240,255,${Math.max(0, 0.55 * p.size * (1 - a / 1.2))})`;
        ctx.lineWidth = 3 - r * 0.8;
        ctx.beginPath(); ctx.arc(W / 2, H * 0.62, rad, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    }
    // A small mark at the middle: E acts on what it is over.
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(W / 2 - 1.5, H / 2 - 1.5, 3, 3);
    if (clock.busyFrac != null) {
      ctx.strokeStyle = "rgba(255,240,200,0.9)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clock.busyFrac); ctx.stroke();
    }
    tune(performance.now() - TS);
  }
  const timing = { floor: 0, walls: 0, sprites: 0, blit: 0 };
  let lastL = null, lastPhase = 0;
  const strikes = [], pulses = [];
  const ripple = (size = 1) => pulses.push({ t: performance.now() / 1000, size });

  return { draw, resize, ripple, timing, get RW() { return RW; }, get quality() { return quality; }, get avgMs() { return avgMs; }, setQuality(q) { quality = q; allocate(); }, get pulses() { return pulses.length; }, get visible() { return state.visible; }, get size() { return { W, H, dpr, RW, RH }; } };
}
