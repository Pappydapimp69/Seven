// seven-play.mjs — camp work costs daylight, and resting is a choice made at camp.
//
// The pure suite (tests/seven.mjs) holds the rules; the charging itself lives in
// the action handler in main.js, so only a browser can show that building a
// fire, feeding it and resting really move the day. Run: node tests/seven-play.mjs
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http"; import { readFile } from "fs/promises"; import path from "path";
const ROOT=path.dirname(path.dirname(new URL(import.meta.url).pathname)); const T={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css"};
const s=createServer(async(q,r)=>{const u=(q.url||"/").split("?")[0];try{const b=await readFile(path.join(ROOT,u==="/"?"index.html":u));r.writeHead(200,{"Content-Type":T[path.extname(u)]||"application/octet-stream"});r.end(b)}catch{r.writeHead(404);r.end()}});
await new Promise(r=>s.listen(0,r)); const P=s.address().port;
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"]});
const pg=await b.newPage({viewport:{width:1280,height:720}}); const errs=[]; pg.on("pageerror",e=>errs.push(String(e)));
await pg.goto(`http://127.0.0.1:${P}/index.html`); await pg.waitForFunction(()=>!!window.__seven);
await pg.evaluate(()=>window.__seven.startSeven({seed:777})); await pg.waitForTimeout(500);
const r=await pg.evaluate(async()=>{const M=window.__seven,s=M.sim,e=s.expedition;
  const d0=e.daylight; s.wood=10; s.player.x=s.world.camp.x+1; s.player.z=s.world.camp.z+1; M.advance(0.1);
  M.act("survey"); M.advance(0.2); const afterBuild=e.daylight;
  M.act("survey"); M.advance(0.2); const afterFeed=e.daylight;
  const facts=e.current.facts.map(f=>f.kind);
  return {d0,afterBuild,afterFeed,facts,fuel:s.fire?.fuel};});
const fails=[]; const A=(c,m)=>{if(!c)fails.push(m)};
A(r.d0-r.afterBuild===0.75, `building a fire cost ${r.d0-r.afterBuild}h, expected 0.75`);
A(Math.abs(r.afterBuild-r.afterFeed-0.25)<1e-9, `feeding cost ${r.afterBuild-r.afterFeed}h, expected 0.25`);
A(r.facts.includes("fire")&&r.facts.includes("feed"), `fire facts missing: ${r.facts}`);
// away from camp: rest refused. At camp: day ends.
await pg.evaluate(()=>{const s=window.__seven.sim;s.player.x=s.world.camp.x+60;});
await pg.keyboard.press("Escape"); await pg.waitForTimeout(300);
const vis=await pg.evaluate(()=>!document.getElementById("restBtn").classList.contains("hidden"));
await pg.evaluate(()=>document.getElementById("restBtn").click()); await pg.waitForTimeout(200);
const away=await pg.evaluate(()=>({day:window.__seven.sim.expedition.day,phase:window.__seven.sim.expedition.phase,rows:[...document.querySelectorAll("#pauseLayer [data-row]")].map(b=>b.dataset.row).join(",")}));
await pg.evaluate(()=>{const s=window.__seven.sim;s.player.x=s.world.camp.x;s.player.z=s.world.camp.z;});
await pg.evaluate(()=>document.getElementById("restBtn").click()); await pg.waitForTimeout(400);
const home=await pg.evaluate(()=>({day:window.__seven.sim.expedition.day,phase:window.__seven.sim.expedition.phase,paused:window.__seven.paused}));
A(vis, "Rest until morning is not offered in an expedition");
A(away.day===1&&away.phase==="day", "rest worked away from camp");
A(home.day===2&&!home.paused, "resting at camp did not end the day and return to play");
A(errs.length===0, "page errors: "+errs.join("|"));
if(fails.length){console.log("SEVEN PLAY FAILED:\n  ✗ "+fails.join("\n  ✗ ")); await b.close(); s.close(); process.exit(1);}
console.log("seven play: OK — fire and rest cost the day, rest only at camp");
