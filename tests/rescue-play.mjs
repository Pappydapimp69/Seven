// rescue-play.mjs — in a real browser: someone goes missing in the night, is out
// there at a hidden spot, is found by walking to them, and comes home as one of
// two at the fire. Run: node tests/rescue-play.mjs
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http"; import { readFile } from "fs/promises"; import path from "path";
const ROOT=path.dirname(path.dirname(new URL(import.meta.url).pathname)); const T={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css"};
const s=createServer(async(q,r)=>{const u=(q.url||"/").split("?")[0];try{const b=await readFile(path.join(ROOT,u==="/"?"index.html":u));r.writeHead(200,{"Content-Type":T[path.extname(u)]||"application/octet-stream"});r.end(b)}catch{r.writeHead(404);r.end()}});
await new Promise(r=>s.listen(0,r)); const P=s.address().port;
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"]});
const pg=await b.newPage({viewport:{width:640,height:360}}); const errs=[]; pg.on("pageerror",e=>errs.push(String(e).slice(0,300)));
await pg.goto(`http://127.0.0.1:${P}/index.html`); await pg.waitForFunction(()=>!!window.__seven,null,{timeout:20000});
await pg.evaluate(()=>window.__seven.startSeven({seed:777}));
const r=await pg.evaluate(()=>{const M=window.__seven,s=M.sim,e=s.expedition;const log=[];
  const closePlan=()=>{const g=document.getElementById("planGo");if(!document.getElementById("planLayer").classList.contains("hidden"))g.click();};
  closePlan(); s.player.x=s.camp.x; s.player.z=s.camp.z;
  e.replacementChance=1; // the test needs a night that takes someone
  for(let night=0;night<2;night++){ e.sleeping=true; for(let i=0;i<3000&&e.sleeping;i++) M.advance(1/30); closePlan(); s.player.x=s.camp.x; s.player.z=s.camp.z; }
  const m=e.missing[0]; const lines=[...document.querySelectorAll(".subtitles .line, #subtitles div, .sub")].map(x=>x.textContent).slice(-8);
  if(!m) return {day:e.day, missing:0};
  s.player.x=m.x; s.player.z=m.z; M.advance(0.2);
  const found=!!s.found;
  s.player.x=s.camp.x; s.player.z=s.camp.z; if(s.found){s.found.x=s.camp.x+1; s.found.z=s.camp.z+1;} M.advance(0.2);
  const twinOpen=!document.getElementById("twinLayer").classList.contains("hidden");
  const L=[...document.querySelectorAll("#twinLeft li")].map(x=>x.textContent), R=[...document.querySelectorAll("#twinRight li")].map(x=>x.textContent);
  document.getElementById("twinKeepLeft").click();
  return {day:e.day, missing:e.missing.length, placed:m.x!=null, found, twinOpen, L, R, after:{recovered:m.recovered,abandoned:m.abandoned}, twinClosed:document.getElementById("twinLayer").classList.contains("hidden"), kind:document.body.dataset.runKind};});
const fails=[]; const A=(c,m)=>{if(!c)fails.push(m)};
A(r.missing===1 && r.placed, `nobody went missing with a position by day 3: ${JSON.stringify(r)}`);
A(r.found, "walking to the missing one did not find them");
A(r.twinOpen, "bringing them to camp did not open the choice at the fire");
A(r.L && r.R && r.L.length===r.R.length && r.L.filter((x,i)=>x!==r.R[i]).length>=1, `the two accounts do not differ: ${JSON.stringify([r.L,r.R])}`);
A(r.after && (r.after.recovered!==r.after.abandoned), `the choice did not resolve the missing one: ${JSON.stringify(r.after)}`);
A(r.twinClosed && r.kind==="seven", "the choice did not return to Seven's HUD");
A(errs.length===0, "page errors: "+errs.join("|"));
await b.close(); s.close();
if(fails.length){console.log("RESCUE PLAY FAILED:\n  ✗ "+fails.join("\n  ✗ ")); process.exit(1);}
console.log("rescue play: OK — missing, found, two at the fire, one kept"); process.exit(0);
