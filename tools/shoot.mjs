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
  { name: "camp",   seed: null, yaw: 0.9,  pitch: -0.02, advance: 2,   night: false },
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

for (const v of VIEWS) {
  // Enter through the API, never the DOM. The title screen's own markup is not
  // what this harness is looking at, and a click that lands on an overlay fails
  // in a way that looks nothing like the renderer being wrong.
  const entered = await page.evaluate((seed) => {
    try {
      window.__seven.toTitle();
      if (seed === null) window.__seven.startStage(0);
      else window.__seven.startRun({ seed, difficulty: "standard" });
      return true;
    } catch (e) { return String(e && e.message || e); }
  }, v.seed);
  if (entered !== true) { console.log(`  ${v.name}: skipped — ${entered}`); continue; }
  await page.waitForFunction(() => !!window.__seven.sim, null, { timeout: 15000 });

  await page.evaluate(({ yaw, pitch, advance, night }) => {
    const M = window.__seven; const sim = M.sim;
    // Stand at spawn, facing a fixed bearing. Not the camera's own drift — a
    // captured frame has to be reproducible from the sim, not from timing.
    // The camp has a `spawn`; a basin does not — it starts the party at the
    // camp feature. Reading the wrong one threw, which is the honest version of
    // "a harness that assumes a field the world may not have".
    const home = sim.world.spawn || sim.world.camp;
    sim.player.x = home.x;
    sim.player.z = home.z;
    sim.player.yaw = yaw;
    sim.player.pitch = pitch;
    if (night) sim.time = 400;      // past the day's grace, into the dark
    M.advance(advance);
  }, v);

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
