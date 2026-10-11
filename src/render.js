// render.js — the woods from above, on a 2D canvas. Draws from the PERCEPT,
// never the sim (the only sim reads are the grid, which never lies, and the
// clock, which is daylight you can see).
//
// The map is painted once into an offscreen canvas at MAP_PX per cell and
// repainted cell by cell when the grid changes (a tree felled, a deadfall cut).
// Each frame blits the visible part, then draws people and things, then the
// dark. Sized from devicePixelRatio re-read on every resize (Brain mirage#E10).

import { K } from "./world.js?v=seven-1.1.0";
import { hash01 } from "./rng.js?v=seven-1.1.0";
import { CAMP_RADIUS, FIRE_LIGHT, DAWN, DUSK, FIRE_MAX_HOURS } from "./config.js?v=seven-1.1.0";

const MAP_PX = 20;
export const SLOT_COLORS = ["#e0b354", "#5fb3c9", "#d9745a", "#9fc46a", "#b98fd6", "#e88fb0"];
const COLORS = {
  floor: "#17221a", trail: "#6a5538", trail2: "#5e4b31", clear: "#3b4f30", clear2: "#34472b",
  exit: "#8e9b78", stump: "#4a3a26", log: "#5a4128", log2: "#3e2c1b",
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, tile = 32;
  let mapCanvas = null, mapCtx = null, mapGrid = null, mapSeed = null;
  const cam = { x: 0, y: 0, ready: false };
  const dark = document.createElement("canvas");
  const dctx = dark.getContext("2d");

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    dark.width = canvas.width; dark.height = canvas.height;
    tile = Math.max(22, Math.min(48, Math.min(W, H) / 15));
  }
  resize();
  window.addEventListener("resize", resize);
  // DPR changes without a resize when a window moves between monitors.
  (function watchDpr() {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const on = () => { resize(); mq.removeEventListener("change", on); watchDpr(); };
    mq.addEventListener("change", on);
  })();

  function paintCell(world, cx, cy) {
    const k = world.grid[cy * world.W + cx], x = cx * MAP_PX, y = cy * MAP_PX, P = MAP_PX;
    const h = hash01(`${cx},${cy}`);
    const g = mapCtx;
    const base = k === K.TRAIL || k === K.DEADFALL ? (h < 0.5 ? COLORS.trail : COLORS.trail2)
      : k === K.CLEAR || k === K.STUMP ? (h < 0.5 ? COLORS.clear : COLORS.clear2)
      : k === K.EXIT ? COLORS.exit : COLORS.floor;
    g.fillStyle = base; g.fillRect(x, y, P, P);
    if (k === K.FOREST || k === K.TREE) {
      const greens = k === K.TREE ? ["#2f5a2c", "#3a6a33"] : ["#1f3a22", "#264728", "#1b331d"];
      for (let i = 0; i < 3; i++) {
        const hx = hash01(`${cx},${cy},${i}x`), hy = hash01(`${cx},${cy},${i}y`);
        g.fillStyle = greens[i % greens.length];
        g.beginPath(); g.arc(x + P * (0.2 + 0.6 * hx), y + P * (0.2 + 0.6 * hy), P * (0.38 + 0.2 * h), 0, Math.PI * 2); g.fill();
      }
      if (k === K.TREE) {   // a pale notch: this one can be felled
        g.fillStyle = "#c9b48a"; g.fillRect(x + P * 0.42, y + P * 0.62, P * 0.16, P * 0.22);
      }
    } else if (k === K.STUMP) {
      g.fillStyle = COLORS.stump; g.beginPath(); g.arc(x + P / 2, y + P / 2, P * 0.28, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#7a6444"; g.lineWidth = 1; g.beginPath(); g.arc(x + P / 2, y + P / 2, P * 0.16, 0, Math.PI * 2); g.stroke();
    } else if (k === K.DEADFALL) {
      for (let i = 0; i < 2; i++) {
        g.fillStyle = i ? COLORS.log2 : COLORS.log;
        g.fillRect(x - 1, y + P * (0.18 + i * 0.36), P + 2, P * 0.3);
      }
    }
  }

  function ensureMap(world) {
    if (!mapCanvas || mapSeed !== world.seed) {
      mapCanvas = document.createElement("canvas");
      mapCanvas.width = world.W * MAP_PX; mapCanvas.height = world.H * MAP_PX;
      mapCtx = mapCanvas.getContext("2d");
      mapGrid = new Uint8Array(world.grid.length).fill(255);
      mapSeed = world.seed;
      cam.ready = false;
    }
    for (let i = 0; i < world.grid.length; i++) {
      if (mapGrid[i] !== world.grid[i]) { mapGrid[i] = world.grid[i]; paintCell(world, i % world.W, Math.floor(i / world.W)); }
    }
  }

  function darkness(mod) {
    // 0 by day, 0.85 at night, ramps an hour either side of dusk and dawn.
    const ramp = (a, b, m) => Math.max(0, Math.min(1, (m - a) / (b - a)));
    if (mod >= DAWN + 60 && mod < DUSK - 60) return 0;
    if (mod >= DUSK - 60 && mod < DUSK + 60) return 0.85 * ramp(DUSK - 60, DUSK + 60, mod);
    if (mod >= DAWN - 60 && mod < DAWN + 60) return 0.85 * (1 - ramp(DAWN - 60, DAWN + 60, mod));
    return 0.85;
  }

  function draw(world, view, clock, dt) {
    ensureMap(world);
    const L = view.lead;
    if (!cam.ready) { cam.x = L.x; cam.y = L.y; cam.ready = true; }
    const k = 1 - Math.exp(-dt * 8);
    cam.x += (L.x - cam.x) * k; cam.y += (L.y - cam.y) * k;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.floor; ctx.fillRect(0, 0, W, H);
    // Keep the view on the map: never show the void past its edges.
    const clampCam = (c, view, size) => (size * tile <= view ? size / 2 : Math.max(view / 2 / tile, Math.min(size - view / 2 / tile, c)));
    const vx = clampCam(cam.x, W, world.W), vy = clampCam(cam.y, H, world.H);
    const ox = W / 2 - vx * tile, oy = H / 2 - vy * tile;
    const sx = (x) => ox + x * tile, sy = (y) => oy + y * tile;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapCanvas, 0, 0, mapCanvas.width, mapCanvas.height, ox, oy, world.W * tile, world.H * tile);

    const t = clock.real;
    // Old woodpiles, and the camp.
    for (const p of view.piles) drawPile(sx(p.x), sy(p.y));
    if (view.camp) {
      const c = view.camp;
      ctx.strokeStyle = "rgba(230,200,140,0.18)"; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx(c.x), sy(c.y), CAMP_RADIUS * tile, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      drawTent(sx(c.x - 1.6), sy(c.y - 1.4));
      if (c.pile > 0) drawPile(sx(c.x + 1.6), sy(c.y + 1.1), Math.min(3, Math.ceil(c.pile / 4)));
      drawFire(sx(c.x), sy(c.y), c.fire, t);
    }
    for (const p of view.pylons) drawPylon(sx(p.x), sy(p.y), p, t);

    // People, south-most last so overlaps read right.
    const bodies = view.people.slice().sort((a, b) => a.y - b.y);
    for (const p of bodies) drawPerson(sx(p.x), sy(p.y), SLOT_COLORS[p.slot % 6], p, false);
    // Names on top, nearest first, and never two labels on one spot.
    const placed = [];
    for (const p of view.people.slice().sort((a, b) => Math.hypot(a.x - L.x, a.y - L.y) - Math.hypot(b.x - L.x, b.y - L.y))) {
      if (Math.hypot(p.x - L.x, p.y - L.y) > 7) break;
      const x = sx(p.x), y = sy(p.y) - tile * (p.asleep ? 0.35 : 0.55);
      if (placed.some((q) => Math.abs(q.x - x) < tile * 1.6 && Math.abs(q.y - y) < tile * 0.45)) continue;
      placed.push({ x, y });
      ctx.font = `600 ${Math.max(11, Math.round(tile * 0.34))}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillText(p.name, x + 1, y + 1);
      ctx.fillStyle = "#f4ead6"; ctx.fillText(p.name, x, y); ctx.textAlign = "start";
    }
    drawPerson(sx(L.x), sy(L.y), "#f2efe6", { asleep: L.asleep, carrying: L.carry > 0 }, false, true);
    if (L.busy && clock.busyFrac != null && !L.asleep) {
      ctx.strokeStyle = "rgba(255,240,200,0.9)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx(L.x), sy(L.y) - tile * 0.9, tile * 0.22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clock.busyFrac); ctx.stroke();
    }

    // The dark, with holes where there is light.
    const a = darkness(clock.mod);
    if (a > 0) {
      dctx.setTransform(1, 0, 0, 1, 0, 0);
      dctx.globalCompositeOperation = "source-over";
      dctx.clearRect(0, 0, dark.width, dark.height);
      dctx.fillStyle = `rgba(4,7,18,${a})`; dctx.fillRect(0, 0, dark.width, dark.height);
      dctx.globalCompositeOperation = "destination-out";
      const hole = (x, y, r, s) => {
        const X = x * dpr, Y = y * dpr, R = r * dpr;
        const g = dctx.createRadialGradient(X, Y, 0, X, Y, R);
        g.addColorStop(0, `rgba(0,0,0,${s})`); g.addColorStop(0.6, `rgba(0,0,0,${s * 0.6})`); g.addColorStop(1, "rgba(0,0,0,0)");
        dctx.fillStyle = g; dctx.beginPath(); dctx.arc(X, Y, R, 0, Math.PI * 2); dctx.fill();
      };
      hole(sx(L.x), sy(L.y), 3.4 * tile, 0.75);
      if (view.camp && view.camp.fire > 0) {
        const s = 0.55 + 0.45 * Math.min(1, view.camp.fire / 4);
        hole(sx(view.camp.x), sy(view.camp.y), FIRE_LIGHT * tile * (0.7 + 0.3 * Math.min(1, view.camp.fire / FIRE_MAX_HOURS * 2)) * (1 + 0.03 * Math.sin(t * 9)), s);
      }
      for (const p of view.pylons) if (p.state === "lit") hole(sx(p.x), sy(p.y), 2.6 * tile, 0.6);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(dark, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawPile(x, y, n = 2) {
      ctx.fillStyle = "#7b5a36";
      for (let i = 0; i < n + 1; i++) {
        ctx.fillRect(x - tile * 0.35, y - tile * 0.1 - i * tile * 0.13, tile * 0.7, tile * 0.11);
      }
      ctx.fillStyle = "#c9a26b";
      ctx.beginPath(); ctx.arc(x + tile * 0.35, y - tile * 0.05, tile * 0.05, 0, Math.PI * 2); ctx.fill();
    }
    function drawTent(x, y) {
      ctx.fillStyle = "#8a7a55";
      ctx.beginPath(); ctx.moveTo(x, y - tile * 0.55); ctx.lineTo(x + tile * 0.6, y + tile * 0.35); ctx.lineTo(x - tile * 0.6, y + tile * 0.35); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#3a3122";
      ctx.beginPath(); ctx.moveTo(x, y - tile * 0.1); ctx.lineTo(x + tile * 0.16, y + tile * 0.35); ctx.lineTo(x - tile * 0.16, y + tile * 0.35); ctx.closePath(); ctx.fill();
    }
    function drawFire(x, y, fuel, time) {
      ctx.fillStyle = "#555048";
      for (let i = 0; i < 7; i++) { const an = (i / 7) * Math.PI * 2; ctx.beginPath(); ctx.arc(x + Math.cos(an) * tile * 0.3, y + Math.sin(an) * tile * 0.3, tile * 0.08, 0, Math.PI * 2); ctx.fill(); }
      if (fuel <= 0) { ctx.fillStyle = "#2b2622"; ctx.beginPath(); ctx.arc(x, y, tile * 0.18, 0, Math.PI * 2); ctx.fill(); return; }
      const s = 0.45 + 0.55 * Math.min(1, fuel / 5);
      const f = 1 + 0.12 * Math.sin(time * 11) + 0.08 * Math.sin(time * 17);
      ctx.fillStyle = "#e8742c"; ctx.beginPath(); ctx.ellipse(x, y - tile * 0.12 * s, tile * 0.22 * s, tile * 0.34 * s * f, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd36b"; ctx.beginPath(); ctx.ellipse(x, y - tile * 0.06 * s, tile * 0.11 * s, tile * 0.2 * s * f, 0, 0, Math.PI * 2); ctx.fill();
    }
    function drawPylon(x, y, p, time) {
      ctx.fillStyle = "#6d7270"; ctx.fillRect(x - tile * 0.16, y - tile * 0.7, tile * 0.32, tile * 0.85);
      ctx.fillStyle = "#4c504e"; ctx.fillRect(x - tile * 0.24, y + tile * 0.1, tile * 0.48, tile * 0.14);
      let col = "#2a2e2d";
      if (p.state === "lit") {
        const a2 = Math.min(1, p.age);
        const r = Math.round(80 + 170 * a2), g = Math.round(170 - 110 * a2), b = Math.round(255 - 200 * a2);
        col = `rgb(${r},${g},${b})`;
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 3);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - tile * 0.5, tile * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.state === "spent") col = "#3a2422";
      ctx.fillStyle = col; ctx.fillRect(x - tile * 0.09, y - tile * 0.62, tile * 0.18, tile * 0.24);
    }
    function drawPerson(x, y, color, p, label, isLead = false) {
      if (p.asleep) {
        ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, tile * 0.36, tile * 0.18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = `${Math.round(tile * 0.35)}px sans-serif`; ctx.fillText("z", x + tile * 0.3, y - tile * 0.25);
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(x, y + tile * 0.22, tile * 0.28, tile * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, tile * 0.26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e9d2b5"; ctx.beginPath(); ctx.arc(x, y - tile * 0.3, tile * 0.15, 0, Math.PI * 2); ctx.fill();
        if (p.carrying) { ctx.fillStyle = "#7b5a36"; ctx.fillRect(x - tile * 0.3, y - tile * 0.05, tile * 0.6, tile * 0.1); }
      }
      if (isLead) { ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, tile * 0.34, 0, Math.PI * 2); ctx.stroke(); }
    }
  }

  return { draw, resize, get tile() { return tile; }, get size() { return { W, H, dpr }; } };
}
