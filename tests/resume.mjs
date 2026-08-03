// Browser test for save/resume. Boots the real page, plays, leaves, resumes,
// and asserts the run came back — plus the two rules that make a save slot
// safe rather than a trap: "New run" cannot discard a save in one press, and
// an ENDED run never leaves a save behind (Brain: wrong-sky#E2).
//
// Everything here drives the sim's own clock via __mirage.advance(); no
// assertion is phrased in wall-clock seconds.
import { createRequire } from "module";
import http from "http"; import fs from "fs"; import path from "path";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css" };
const serve = () => http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split("?")[0]); if(p==="/")p="/index.html";
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream"}); fs.createReadStream(f).pipe(res); });
const fails=[]; const A=(c,m)=>{ if(!c) fails.push(m); };
(async()=>{
  const server=serve(); await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const PORT=server.address().port;
  const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader"]});
  const page=await b.newPage({viewport:{width:1280,height:800}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/index.html`,{waitUntil:"networkidle"});

  // 1. No save -> Resume hidden, primary button says "Walk in"
  let s = await page.evaluate(()=>({
    resumeShown: document.getElementById("continueBtn").classList.contains("show"),
    startText: document.getElementById("startBtn").textContent.trim(),
  }));
  A(!s.resumeShown, `Resume should be hidden with no save (was shown)`);
  A(s.startText==="Walk in", `start button should read "Walk in", got "${s.startText}"`);

  // 2. Play a bit, make distinctive progress, let autosave fire
  const played = await page.evaluate(()=>{
    const M=window.__mirage; M.startRun({seed:4321});
    M.sim.time = 300;              // past grace
    M.advance(12);                 // > AUTOSAVE_EVERY
    M.sim.wood = 7; M.sim.doses = 1;
    M.sim.monoliths[0].discovered = true; M.sim.monoliths[0].logged = true;
    M.advance(6);                  // force another autosave with those values
    return { wood:M.sim.wood, doses:M.sim.doses, time:M.sim.time, seed:M.sim.seed,
             saved: !!localStorage.getItem("mirage:run") };
  });
  A(played.saved, "autosave never wrote to localStorage during play");

  // 3. Back to title -> Resume visible and labelled
  await page.evaluate(()=>window.__mirage.toTitle());
  s = await page.evaluate(()=>({
    shown: document.getElementById("continueBtn").classList.contains("show"),
    detail: document.getElementById("continueDetail").textContent,
    startText: document.getElementById("startBtn").textContent.trim(),
  }));
  A(s.shown, "Resume should be visible after a save exists");
  A(/basin 1 of 3/.test(s.detail), `Resume detail should name the basin, got "${s.detail}"`);
  A(/seed 4321/.test(s.detail), `Resume detail should name the seed, got "${s.detail}"`);
  A(s.startText==="New run", `start should become "New run" when a save exists, got "${s.startText}"`);
  A(!/lucidity|\b\d{1,3}\s*\/\s*100\b/i.test(s.detail), `Resume detail leaked a meter: "${s.detail}"`);

  // 4. Resume -> same run restored
  const resumed = await page.evaluate(()=>{
    document.getElementById("continueBtn").click();
    const M=window.__mirage;
    return { wood:M.sim.wood, doses:M.sim.doses, time:M.sim.time, seed:M.sim.seed,
             logged:M.sim.monoliths[0].logged, onHud:!document.getElementById("hudLayer").classList.contains("hidden") };
  });
  A(resumed.onHud, "Resume did not switch to the HUD");
  A(resumed.seed===played.seed, `seed changed across resume: ${resumed.seed} vs ${played.seed}`);
  A(resumed.wood===7, `wood lost across resume: ${resumed.wood}`);
  A(resumed.doses===1, `doses lost across resume: ${resumed.doses}`);
  A(resumed.logged===true, "logged marker lost across resume");
  A(Math.abs(resumed.time-played.time)<6, `resumed clock too far off: ${resumed.time} vs ${played.time}`);

  // 5. "New run" needs two presses while a save exists
  await page.evaluate(()=>window.__mirage.toTitle());
  const arm = await page.evaluate(()=>{
    const btn=document.getElementById("startBtn"); btn.click();
    return { text:btn.textContent.trim(), stillTitle:!document.getElementById("title").classList.contains("hidden"),
             saveStill: !!localStorage.getItem("mirage:run") };
  });
  A(arm.stillTitle, "first press of New run should NOT start a run while a save exists");
  A(arm.saveStill, "first press of New run must not delete the save");
  A(/press again/i.test(arm.text), `New run should ask for confirmation, got "${arm.text}"`);
  const confirmed = await page.evaluate(()=>{
    document.getElementById("startBtn").click();
    return { onHud:!document.getElementById("hudLayer").classList.contains("hidden"),
             wood:window.__mirage.sim.wood };
  });
  A(confirmed.onHud, "second press of New run should start a run");
  A(confirmed.wood===0, `New run should be a fresh basin, wood was ${confirmed.wood}`);

  // 6. An ended run clears the slot
  const ended = await page.evaluate(()=>{
    const M=window.__mirage; M.sim.time=300; M.advance(6);
    const before = !!localStorage.getItem("mirage:run");
    // A REAL loss, driven through tick()/checkEndings rather than by forcing
    // sim.status: step() early-returns on a non-playing status, so a forced
    // status would skip finish() in a way ordinary play never does.
    M.sim.time = 895; M.advance(10); // past TIME_LIMIT -> darkness
    return { before, status: M.sim.status, after: !!localStorage.getItem("mirage:run") };
  });
  A(ended.before, "test setup: expected a save before ending the run");
  A(ended.status!=="playing", `test setup: expected the run to end, status was ${ended.status}`);
  A(!ended.after, "a lost run left a save behind — Resume would hand back a lost frame");

  A(errors.length===0, `page errors: ${JSON.stringify(errors.slice(0,3))}`);
  await b.close(); server.close();
  if(fails.length){ console.log(`\n${fails.length} failed:`); fails.forEach(f=>console.log("  ✗ "+f)); process.exit(1); }
  console.log("mirage resume (browser): OK");
})().catch(e=>{ console.error("CRASHED:",e); process.exit(1); });
