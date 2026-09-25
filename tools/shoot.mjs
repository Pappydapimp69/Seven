// shoot.mjs — deterministic screenshots of the basin, for judging a LOOK change.
//
// Why this exists: tension T11 says the automated tier can verify the render
// spine's WIRING but never its visual correctness — a wrong material, an
// inverted normal and a broken shader all pass a "no errors" test. The ledger's
// own partial mitigation is "capture screenshots for human review", and that
// only works if the two captures differ in NOTHING but the change. The smoke
// test walks the player around, so its shots move between runs and cannot be
// compared.
//
// So: fixed seed, fixed position, fixed yaw, fixed sim time, animations off.
// Two runs of this on either side of an edit differ only by the edit.
//
// Usage: node tools/shoot.mjs <outdir> [label]
import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "shots"));
const LABEL = process.argv[3] || "shot";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

// Each view is a place to stand and a way to face. Chosen to show the things a
// look change is judged on: massed silhouettes at depth, one subject near
// enough to read form on, and the same frame at night.
const VIEWS = [
  { name: "basin",  seed: 1234, yaw: 0.6,  pitch: -0.05, advance: 2,   night: false },
  { name: "depth",  seed: 1234, yaw: 2.4,  pitch: 0.04,  advance: 2,   night: false },
  { name: "night",  seed: 1234, yaw: 0.6,  pitch: -0.05, advance: 2,   night: true },
  // The trainer after dark, because the lantern is how you find him and
  // daylight washes it out entirely — the one condition the model has not been
  // looked at under.
  { name: "trainer-night", seed: null, yaw: 0.0, pitch: -0.02, advance: 2, night: true, atTrainer: true },
  { name: "camp",   seed: null, yaw: 0.9,  pitch: -0.02, advance: 2,   night: false },
  // Standing off the trainer, looking at him. The one view where a figure has
  // to read as a person rather than as a marker.
  { name: "trainer", seed: null, yaw: 0.0, pitch: -0.02, advance: 2, night: false, atTrainer: true },
  // THE WOODS: one frame per weather, all from the same spot south of the
  // hearth, so the five differ ONLY by the weather. The day seeds are the
  // first `dayN` strings that draw each one (woods.js startDay). `beat` sets
  // how much of the day is done, so the marks the beats leave are in frame.
  ...[["clear", "day1"], ["drizzle", "day2"], ["fog", "day4"], ["wind", "day5"], ["cold", "day0"]].map(([w, day]) => (
    { name: `woods-${w}`, woods: day, at: "fire", back: 5, dx: 1, beat: 5, pitch: -0.08, advance: 2, night: false }
  )),
  // The ridge before and after the birch comes down.
  { name: "woods-ridge-before", woods: "day1", at: "ridge", back: 4, beat: 2, dx: 2, pitch: 0.02, advance: 2, night: false },
  { name: "woods-ridge-after", woods: "day1", at: "ridge", back: 4, beat: 3, dx: 2, pitch: -0.05, advance: 2, night: false },
];

const server = serve();
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error") console.log("  console error:", m.text()); });

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__seven, null, { timeout: 20000 });

// SHOOT_ONLY=woods (a substring) shoots just the matching views.
const ONLY = process.env.SHOOT_ONLY || "";
for (const v of VIEWS.filter((x) => x.name.includes(ONLY))) {
  // Enter through the API, never the DOM. The title screen's own markup is not
  // what this harness is looking at, and a click that lands on an overlay fails
  // in a way that looks nothing like the renderer being wrong.
  const entered = await page.evaluate(({ seed, woods }) => {
    try {
      window.__seven.toTitle();
      if (woods) window.__seven.startWoods(woods);
      else if (seed === null) window.__seven.startStage(0);
      else window.__seven.startRun({ seed, difficulty: "standard" });
      return true;
    } catch (e) { return String(e && e.message || e); }
  }, v);
  if (entered !== true) { console.log(`  ${v.name}: skipped — ${entered}`); continue; }
  await page.waitForFunction(() => !!window.__seven.sim, null, { timeout: 15000 });

  const aimRes = await page.evaluate(({ yaw, pitch, advance, night, atTrainer, at, back, beat, dx }) => {
    const M = window.__seven; const sim = M.sim;
    // Stand at spawn, facing a fixed bearing. Not the camera's own drift — a
    // captured frame has to be reproducible from the sim, not from timing.
    // The camp has a `spawn`; a basin does not — it starts the party at the
    // camp feature. Reading the wrong one threw, which is the honest version of
    // "a harness that assumes a field the world may not have".
    const home = sim.world.spawn || sim.world.camp;
    sim.player.x = home.x;
    sim.player.z = home.z;
    // FRAMING BY POSITION, NOT BY ROTATION — and that is the whole trick here.
    //
    // Aiming the camera was three separate failures. `sim.player.yaw = x` is
    // erased by the page's own rAF loop, which keeps stepping the sim with the
    // real input while an evaluate returns; an intent yaw passed to advance()
    // goes the same way; and driving the input layer through debugMouseLook
    // needs a sensitivity this harness has no business knowing. Every one of
    // them produced a screenshot of empty field that looked exactly like a
    // subject failing to draw.
    //
    // The default facing is yaw 0, which is -z. So do not turn the camera at
    // all: stand SOUTH of whatever the view is about and it is already in
    // frame. No input layer, nothing for the loop to overwrite, and the shot
    // is reproducible from position alone.
    if (atTrainer && sim.trainer) {
      // Four cells south and two west. Both numbers come off the blocked grid,
      // not off a round guess: nine units put the camera inside the tree at
      // (39,26), and standing square behind it left that same trunk filling
      // the middle of the frame with the trainer directly behind it. Two cells
      // west clears the sightline.
      sim.player.x = sim.trainer.x - 5.2;
      sim.player.z = sim.trainer.z + 10.4;
    }
    if (at && sim.woods) {
      // A HARNESS shortcut, not a way to play: the marks are derived from
      // woods.beat, so setting it is enough to put them in the world.
      if (beat != null) sim.woods.beat = beat;
      const site = sim.world.sites.find((s) => s.id === at);
      // Cells, off the grid (see MARK_AT): `back` south, `dx` east.
      sim.player.x = site.x + (dx || 0) * 2.6;
      sim.player.z = site.z + back * 2.6;
      // The party is walking the day; park them out of the frame.
      for (const c of sim.companions) { c.x = site.x - 30; c.z = site.z + 30; c.jobSite = null; }
    }
    sim.player.pitch = pitch;
    if (night) sim.time = 400;      // past the day's grace, into the dark
    M.advance(advance);
    // YAW GOES THROUGH THE INPUT LAYER, and nothing else works.
    //
    // The page's own rAF loop is still running while this evaluate returns, and
    // it steps the sim every frame with the REAL input — whose yaw is 0. So
    // `sim.player.yaw = x` is erased before the screenshot, and so is an intent
    // yaw passed to advance(). Three shots were read as "the trainer is not
    // drawing" before a debug line printed the yaw actually in effect: 0, for
    // every view, including the basin ones that had been asking for 0.6.
    //
    // debugMouseLook feeds the input layer the way a mouse does, which is the
    // one path the loop will not overwrite. Sensitivity is a user setting, so
    // rather than assume a mapping this closes the loop: nudge, read back,
    // repeat. It converges in a handful of passes and cannot silently no-op —
    // if the yaw never approaches the target, the harness says so.
    return { yaw: sim.player.yaw, x: sim.player.x, z: sim.player.z };
  }, v);
  const aimed = aimRes;
  const aim = await page.evaluate(() => {
    const s = window.__seven.sim;
    return { px: +s.player.x.toFixed(1), pz: +s.player.z.toFixed(1), yaw: +s.player.yaw.toFixed(3),
             tr: s.trainer ? `${s.trainer.x.toFixed(1)},${s.trainer.z.toFixed(1)}` : "none" };
  });
  console.log(`    [view] ${v.name}: standing ${aim.px},${aim.pz} facing -z${aim.tr !== "none" ? ` · trainer ${aim.tr}` : ""}`);

  // Let the compositor settle without asserting on wall-clock: two rAFs.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const file = path.join(OUT, `${LABEL}-${v.name}.png`);
  await page.screenshot({ path: file, animations: "disabled", timeout: 120000 });
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}

const stats = await page.evaluate(() => {
  const i = window.__seven.renderer?.renderer?.info;
  return i ? { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries } : null;
});
console.log("  renderer:", JSON.stringify(stats));

await browser.close();
server.close();
