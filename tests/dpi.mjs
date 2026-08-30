// dpi.mjs — the game must look and steer the same at 100%, 125% and 150%.
//
// Reported as "the viewport zoom is wrong and the directional controls feel
// off", and originally blamed on aspect ratio. Aspect was innocent. The cause
// was Windows display scaling, which resizes the view OUTSIDE the game: at 125%
// the CSS viewport shrinks from 1920x1080 to 1536x864 while the physical screen
// does not move, so
//
//   * every fixed-px HUD element becomes 25% physically larger and eats 25%
//     more of a smaller viewport — the 3D projection is untouched, but the
//     furniture around it grows, which reads exactly like being zoomed in;
//   * pointer-lock `movementX` arrives in CSS pixels, so the same physical
//     mouse sweep reports 20% fewer units and the camera turns 20% slower;
//   * `renderer.setPixelRatio`, set once at construction, goes stale.
//
// Playwright's `deviceScaleFactor` is exactly this knob, so each case below is
// the same physical screen at a different OS scaling level. Everything is
// asserted as a FRACTION of the screen, because that is the thing a player
// actually sees — CSS pixels are the unit that lied.
//
// Run: node tests/dpi.mjs

import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png" };

const server = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("no"); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const failures = [];
const notes = [];
const assert = (c, m) => { if (!c) failures.push(m); };

// The SAME physical screen each time. 1536x864 at 1.25 and 1280x720 at 1.5 are
// what Windows reports to the browser for a 1920x1080 monitor at those scaling
// levels — the CSS viewport shrinks, the glass does not.
const CASES = [
  { label: "100%", width: 1920, height: 1080, deviceScaleFactor: 1 },
  { label: "125%", width: 1536, height: 864, deviceScaleFactor: 1.25 },
  { label: "150%", width: 1280, height: 720, deviceScaleFactor: 1.5 },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

const results = [];
for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.deviceScaleFactor });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__seven, null, { timeout: 20000 });
  await page.evaluate(() => window.__seven.startRun({ difficulty: "standard", seed: 4242 }));
  await page.waitForFunction(() => !!window.__seven.sim, null, { timeout: 15000 });
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => {
    const M = window.__seven;
    const cam = M.renderer.camera;
    const canvas = document.querySelector("canvas");
    const probe = document.getElementById("subtitles") || document.body;
    const box = probe.getBoundingClientRect();
    const cs = getComputedStyle(probe);
    // Everything normalised to a FRACTION of the viewport, which is the only
    // frame in which "the same screen" is a meaningful claim.
    return {
      dpr: window.devicePixelRatio,
      cssW: window.innerWidth,
      cssH: window.innerHeight,
      hfovDeg: 2 * Math.atan(Math.tan((cam.fov * Math.PI) / 180 / 2) * cam.aspect) * (180 / Math.PI),
      aspect: cam.aspect,
      // Backing store must match the CSS box times the CURRENT ratio.
      bufferRatio: canvas.width / (canvas.clientWidth || 1),
      fontFractionOfHeight: parseFloat(cs.fontSize) / window.innerHeight,
      probeWidthFraction: box.width / window.innerWidth,
    };
  });

  // Mouse look: the same PHYSICAL sweep at every scaling level. A physical
  // sweep of N device pixels arrives as N/dpr CSS pixels, which is what a real
  // mouse would report, so that is what the synthetic event carries.
  const PHYSICAL_DEVICE_PX = 400;
  const yaw = await page.evaluate((devicePx) => {
    const M = window.__seven;
    const cssPx = devicePx / window.devicePixelRatio;
    return M.debugMouseLook(cssPx, 0);
  }, PHYSICAL_DEVICE_PX);
  r.yawPerPhysicalSweep = yaw;

  results.push({ ...c, ...r });
  notes.push(`${c.label}: dpr ${r.dpr} · css ${r.cssW}x${r.cssH} · hfov ${r.hfovDeg.toFixed(1)}deg · buffer/css ${r.bufferRatio.toFixed(2)} · font ${(r.fontFractionOfHeight * 100).toFixed(3)}% of height · yaw ${yaw.toFixed(4)}`);
  await ctx.close();
}
await browser.close();
server.close();

const base = results[0];
for (const r of results.slice(1)) {
  assert(Math.abs(r.hfovDeg - base.hfovDeg) < 0.5, `${r.label}: horizontal FOV moved (${base.hfovDeg.toFixed(1)} -> ${r.hfovDeg.toFixed(1)})`);
  // The buffer must track the CURRENT devicePixelRatio, not the one that
  // happened to be live when the renderer was constructed.
  assert(Math.abs(r.bufferRatio - Math.min(r.dpr, 2)) < 0.05, `${r.label}: drawing buffer is ${r.bufferRatio.toFixed(2)}x the CSS box, expected ${Math.min(r.dpr, 2)}`);
  // The HUD has to be the same fraction of the screen, which is the whole
  // reason the stylesheet moved off fixed px.
  const fontDrift = Math.abs(r.fontFractionOfHeight - base.fontFractionOfHeight) / base.fontFractionOfHeight;
  assert(fontDrift < 0.12, `${r.label}: HUD text is ${(fontDrift * 100).toFixed(0)}% off its share of the screen`);
  const widthDrift = Math.abs(r.probeWidthFraction - base.probeWidthFraction) / (base.probeWidthFraction || 1);
  assert(widthDrift < 0.12, `${r.label}: a HUD panel is ${(widthDrift * 100).toFixed(0)}% off its share of the screen`);
  // And the same physical mouse sweep must turn the camera the same amount.
  assert(Math.abs(base.yawPerPhysicalSweep) > 1e-6, "the mouse-look probe produced no rotation — this assertion would be vacuous");
  {
    const yawDrift = Math.abs(r.yawPerPhysicalSweep - base.yawPerPhysicalSweep) / Math.abs(base.yawPerPhysicalSweep);
    assert(yawDrift < 0.05, `${r.label}: the same physical mouse sweep turned ${(yawDrift * 100).toFixed(0)}% differently`);
  }
}

for (const n of notes) console.log("  · " + n);
if (failures.length) {
  console.log("\nDPI FAILED:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("display scaling: OK — same view, same HUD share, same look speed at 100/125/150%");
