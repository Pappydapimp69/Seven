// Campaign continuity: clearing a basin advances to the next one, and a save
// taken there resumes into the RIGHT basin with carried materials intact.
// advanceLevel() builds a whole new sim under the same run, so this is the one
// path where "the save slot" and "the campaign" can disagree.
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
 const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader"]});
 const page=await b.newPage({viewport:{width:1280,height:800}});
 const errs=[]; page.on("pageerror",e=>errs.push(e.message));
 await page.goto(`http://localhost:${s.address().port}/index.html`,{waitUntil:"networkidle"});
 // Force-complete basin 1 by logging every marker, then let the sim advance.
 const adv = await page.evaluate(()=>{
   const M=window.__seven; M.startRun({seed:2024});
   M.sim.time=300;
   // carry some distinctive state across the boundary
   M.sim.wood=9; M.sim.stone=4; M.sim.doses=2;
   for(const m of M.sim.monoliths){ m.discovered=true; m.logged=true; M.sim.logEntries.push({id:m.id,name:m.name,real:true,at:M.sim.time}); }
   // walk the party to camp so the return condition fires
   const c=M.sim.world.camp; for(const p of M.sim.party){ p.x=c.x; p.z=c.z; }
   M.advance(6);
   return { level:M.sim.level, status:M.sim.status };
 });
 A(adv.level===2, `expected to advance to basin 2, got level ${adv.level} status ${adv.status}`);
 // now autosave and resume
 const res = await page.evaluate(()=>{
   const M=window.__seven; M.sim.time=300; M.advance(8); // trigger autosave on level 2
   const saved=JSON.parse(localStorage.getItem("seven:run")||"null");
   M.toTitle();
   const detail=document.getElementById("continueDetail").textContent;
   document.getElementById("continueBtn").click();
   return { savedLevel: saved && saved.level, detail,
            level:M.sim.level, wood:M.sim.wood, stone:M.sim.stone, doses:M.sim.doses,
            campaignLength:M.sim.campaignLength };
 });
 A(res.savedLevel===2, `save recorded the wrong basin: ${res.savedLevel}`);
 A(/basin 2 of 3/.test(res.detail), `resume label wrong: "${res.detail}"`);
 A(res.level===2, `resumed into the wrong basin: ${res.level}`);
 A(res.wood===9 && res.stone===4, `carried materials lost: wood ${res.wood} stone ${res.stone}`);
 A(res.doses===2, `carried doses lost: ${res.doses}`);
 A(errs.length===0, `page errors: ${JSON.stringify(errs.slice(0,2))}`);
 await b.close(); s.close();
 if(fails.length){console.log(fails.length+" failed:");fails.forEach(f=>console.log("  ✗ "+f));process.exit(1);}
 console.log("campaign save/resume across basins: OK");
})().catch(e=>{console.error("CRASHED:",e.message);process.exit(1);});
