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

import { K } from "./world.js?v=seven-1.8.0";
import { hash01 } from "./rng.js?v=seven-1.8.0";
import { FIRE_LIGHT, DAWN, DUSK, PILE_CAP, SURPLUS_CAP } from "./config.js?v=seven-1.8.0";

export const SLOT_COLORS = ["#e0b354", "#5fb3c9", "#d9745a", "#9fc46a", "#b98fd6", "#e88fb0"];
export const HFOV = (72 * Math.PI) / 180;
const EYE = 0.72, WALL_H = 2.4, MAX_DIST = 26, FOG_DIST = 22;
const FLOOR = {
  [K.TRAIL]: [106, 86, 57], [K.DEADFALL]: [106, 86, 57], [K.CLEAR]: [62, 84, 50], [K.STUMP]: [62, 84, 50],
  [K.EXIT]: [146, 158, 122], [K.FOREST]: [24, 36, 27], [K.TREE]: [24, 36, 27],
};
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function createView(canvas) {
  const ctx = canvas.getContext("2d");
  const off = document.createElement("canvas");
  const o = off.getContext("2d");
  let W = 0, H = 0, dpr = 1, RW = 0, RH = 0, img = null, zbuf = null, focal = 1;
  const sprites = new Map();
  const state = { visible: new Set() };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    RW = Math.max(200, Math.min(480, Math.round(W / 2)));
    RH = Math.max(120, Math.round((RW * H) / W));
    off.width = RW; off.height = RH;
    img = o.createImageData(RW, RH);
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
  const personSprite = (color, asleep, carrying) => sprite(`p:${color}:${asleep}:${carrying}`, asleep ? 64 : 32, asleep ? 20 : 64, (g, w, h) => {
    if (asleep) {
      g.fillStyle = color; g.beginPath(); g.ellipse(w * 0.45, h * 0.6, w * 0.36, h * 0.32, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#e9d2b5"; g.beginPath(); g.arc(w * 0.86, h * 0.55, h * 0.3, 0, Math.PI * 2); g.fill();
      return;
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

  function draw(world, view, clock) {
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
    const light = (x, y) => {
      let l = ambient, warm = 0;
      if (fire) {
        const d = Math.hypot(x - fire.x, y - fire.y), r = FIRE_LIGHT * flick;
        if (d < r) { const k = (1 - d / r) ** 1.4 * fireS; l += k; warm += k; }
      }
      const dl = Math.hypot(x - px, y - py);
      if (dl < 3.6) l += 0.5 * (1 - dl / 3.6) * (1 - day);
      for (const p of lit) { const d = Math.hypot(x - p.x, y - p.y); if (d < 2.8) l += 0.55 * (1 - d / 2.8); }
      return [Math.min(1.3, l), Math.min(1, warm)];
    };
    const fogRgb = [Math.round(18 + 70 * day), Math.round(24 + 86 * day), Math.round(26 + 80 * day)];

    // ---- sky and ground, per pixel ----
    const data = img.data, hz = RH / 2;
    const sky0 = [Math.round(10 + 120 * day), Math.round(13 + 150 * day), Math.round(26 + 160 * day)];
    for (let y = 0; y < RH; y++) {
      const row = y * RW * 4;
      if (y < hz) {
        const k = y / hz;
        const r = sky0[0] * (1 - k) + fogRgb[0] * k, g = sky0[1] * (1 - k) + fogRgb[1] * k, b = sky0[2] * (1 - k) + fogRgb[2] * k;
        for (let x = 0; x < RW; x++) { const i = row + x * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
        continue;
      }
      const rowDist = (EYE * focal) / (y - hz + 0.5);
      const fog = Math.min(1, rowDist / FOG_DIST);
      const lx0 = px + rowDist * (dx - plx), ly0 = py + rowDist * (dy - ply);
      const sx = (rowDist * 2 * plx) / RW, sy = (rowDist * 2 * ply) / RW;
      let wx = lx0, wy = ly0;
      for (let x = 0; x < RW; x++, wx += sx, wy += sy) {
        const cx = Math.floor(wx), cy = Math.floor(wy);
        const k = cx < 0 || cy < 0 || cx >= world.W || cy >= world.H ? K.FOREST : world.grid[cy * world.W + cx];
        const base = FLOOR[k];
        const v = 0.9 + 0.2 * (((cx * 7 + cy * 13) & 7) / 7);
        const [l, warm] = x % 2 === 0 || !lastL ? (lastL = light(wx, wy)) : lastL;
        const i = row + x * 4;
        data[i] = (base[0] * v * l + 60 * warm) * (1 - fog) + fogRgb[0] * day * fog;
        data[i + 1] = (base[1] * v * l + 25 * warm) * (1 - fog) + fogRgb[1] * day * fog;
        data[i + 2] = base[2] * v * l * (1 - fog) + fogRgb[2] * day * fog;
        data[i + 3] = 255;
      }
      lastL = null;
    }
    o.putImageData(img, 0, 0);

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
    if (view.camp) {
      const c = view.camp;
      add(c.x - 1.6, c.y - 1.4, tentSprite(), 1.1, 0.76, { key: "tent" });
      add(c.x, c.y, paintFire(c.fire, clock.real), 0.5, 0.62, { bright: true });
      const pr = c.pile <= 0 ? 0 : Math.min(4, Math.ceil((c.pile / PILE_CAP) * 4));
      add(c.x + 1.4, c.y + 1.2, pileSprite(pr), 0.62, 0.52, { key: `pile:${pr}` });
      const sr = c.surplus <= 0 ? 0 : Math.min(5, Math.ceil((c.surplus / SURPLUS_CAP) * 5));
      add(c.x + 2.6, c.y + 1.2, surplusSprite(sr), 0.62, 0.72, { key: `surplus:${sr}` });
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
      add(p.x, p.y, personSprite(color, p.asleep, p.carrying), p.asleep ? 0.95 : 0.5, p.asleep ? 0.3 : 0.98,
        { key: `p:${color}:${p.asleep}:${p.carrying}`, person: p });
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

    // ---- to the screen ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, RW, RH, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // A small mark at the middle: E acts on what it is over.
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(W / 2 - 1.5, H / 2 - 1.5, 3, 3);
    if (clock.busyFrac != null) {
      ctx.strokeStyle = "rgba(255,240,200,0.9)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clock.busyFrac); ctx.stroke();
    }
  }
  let lastL = null;

  return { draw, resize, get visible() { return state.visible; }, get size() { return { W, H, dpr, RW, RH }; } };
}
