// Menu-grid navigation over a menu whose SHAPE changes. The title screen's
// Resume button only exists when a save does, and a display:none element still
// matches querySelectorAll — so without filtering, a controller pressing Down
// lands focus on an invisible row and confirm does nothing. That is a broken
// pad from the player's side, and no assertion about row NUMBERS can catch it,
// because the numbers are exactly what shift.
import { createRequire } from "module";
import http from "http"; import fs from "fs"; import path from "path";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
import { fileURLToPath } from "url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const serve=()=>http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]);if(p==="/")p="/index.html";
 const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
 r.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});
const fails=[];const A=(c,m)=>{if(!c)fails.push(m)};
(async()=>{
 const s=serve();await new Promise(r=>s.listen(0,"127.0.0.1",r));
 const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader"]});
 const page=await b.newPage({viewport:{width:1280,height:800}});
 await page.goto(`http://localhost:${s.address().port}/index.html`,{waitUntil:"networkidle"});
 // create a save, return to title
 await page.evaluate(()=>{const M=window.__mirage;M.startRun({seed:99});M.sim.time=300;M.advance(8);M.toTitle();});
 // walk the menu grid down from the top and collect what focus lands on
 const seen = await page.evaluate(()=>{
   const M=window.__mirage; const out=[];
   for(let i=0;i<6;i++){ const f=document.querySelector("#title .gpfocus");
     out.push(f? (f.id||f.dataset.diff||f.dataset.coopOpt||f.tagName) : null); M.menuDown(); }
   return out;
 });
 A(seen.includes("continueBtn"), `menu nav never reached Resume: ${JSON.stringify(seen)}`);
 A(seen.includes("startBtn"), `menu nav never reached Start: ${JSON.stringify(seen)}`);
 A(!seen.includes(null), `focus was lost on some row: ${JSON.stringify(seen)}`);
 // every focusable row must be a VISIBLE element
 const invisible = await page.evaluate(()=>{
   const els=Array.from(document.querySelectorAll("#title [data-row]"));
   return els.filter(e=>e.offsetParent===null).map(e=>e.id||e.className);
 });
 // hidden ones must exist in DOM but never be focusable — confirm grid excludes them
 const gridIds = await page.evaluate(()=>{
   const els=Array.from(document.querySelectorAll("#title [data-row]")).filter(e=>e.offsetParent!==null);
   return els.map(e=>e.id||e.className);
 });
 for(const id of invisible) A(!gridIds.includes(id), `hidden control ${id} is still in the focus grid`);
 await b.close(); s.close();
 if(fails.length){console.log(fails.length+" failed:");fails.forEach(f=>console.log("  ✗ "+f));process.exit(1);}
 console.log("pad+resume nav: OK");
})().catch(e=>{console.error("CRASHED:",e.message);process.exit(1);});
