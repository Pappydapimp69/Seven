// Preferences survive a real page reload. Uses an actual browser reload rather
// than calling loadSettings() directly, because the thing that breaks in
// practice is the WIRING — a value stored correctly but never applied to the
// controls, or applied to the controls but not to the run that starts.
import { createRequire } from "module";
import http from "http"; import fs from "fs"; import path from "path";
const require=createRequire(import.meta.url);
const {chromium}=require("/opt/node22/lib/node_modules/playwright");
import { fileURLToPath } from "url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const serve=()=>http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]);if(p==="/")p="/index.html";
 const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
 r.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
const fails=[];const A=(c,m)=>{if(!c)fails.push(m)};
(async()=>{
 const s=serve();await new Promise(r=>s.listen(0,"127.0.0.1",r));
 const url=`http://localhost:${s.address().port}/index.html`;
 const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader"]});
 const page=await b.newPage({viewport:{width:1280,height:800}});
 const errs=[];page.on("pageerror",e=>errs.push(e.message));
 await page.goto(url,{waitUntil:"networkidle"});
 // change pressure + party on the title, and volume in the pause menu
 await page.click('[data-diff="bleak"]');
 await page.click('[data-coop-opt="couch"]');
 await page.evaluate(()=>{ document.querySelector('[data-vol="0.35"]').click(); });
 const stored = await page.evaluate(()=>JSON.parse(localStorage.getItem("seven:settings")||"null"));
 A(stored && stored.difficulty==="bleak", `pressure not stored: ${JSON.stringify(stored)}`);
 A(stored && stored.coop==="couch", `party not stored: ${JSON.stringify(stored)}`);
 A(stored && stored.volume===0.35, `volume not stored: ${JSON.stringify(stored)}`);
 // RELOAD — a fresh session must come back with them applied
 await page.reload({waitUntil:"networkidle"});
 const after = await page.evaluate(()=>({
   diffSel: document.querySelector('[data-diff].sel')?.dataset.diff,
   coopSel: document.querySelector('[data-coop-opt].sel')?.dataset.coopOpt,
   volSel: document.querySelector('[data-vol].sel')?.dataset.vol,
   coopArmed: window.__seven.coopAllowed,
 }));
 A(after.diffSel==="bleak", `pressure not restored on reload: ${after.diffSel}`);
 A(after.coopSel==="couch", `party not restored on reload: ${after.coopSel}`);
 A(after.volSel==="0.35", `volume button not restored on reload: ${after.volSel}`);
 A(after.coopArmed===true, "restored party preference did not arm the join poll");
 // the run it starts must honour the restored pressure
 const started = await page.evaluate(()=>{ document.getElementById("startBtn").click(); return window.__seven.sim.difficulty; });
 A(started==="bleak", `the run ignored the restored pressure: ${started}`);
 A(errs.length===0,`page errors: ${JSON.stringify(errs.slice(0,2))}`);
 await b.close(); s.close();
 if(fails.length){console.log(fails.length+" failed:");fails.forEach(f=>console.log("  ✗ "+f));process.exit(1);}
 console.log("preferences persist across sessions: OK");
})().catch(e=>{console.error("CRASHED:",e.message);process.exit(1);});
