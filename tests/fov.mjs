// Field of view. The shipped lens was 72 VERTICAL, which is 105 degrees
// HORIZONTAL on 16:9 and 119 on ultrawide — deep fisheye, and the first real
// playtester reported it as "the world feels distorted and misshapen, straight
// isn't straight, it's curved", and blamed the MOVEMENT (which is exact: a
// constant input walks a line with 0.0000 lateral deviation).
//
// So the invariant worth holding is aspect-independence: the horizontal angle
// must stay put as the window changes shape. A vertical-fov camera silently
// fails that, and no behavioural test notices.
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
 const page=await b.newPage({viewport:{width:960,height:540}});
 const errs=[];page.on("pageerror",e=>errs.push(e.message));
 await page.goto(url,{waitUntil:"networkidle"});
 const def=await page.evaluate(()=>{ const M=window.__mirage; M.startRun({seed:1234}); M.advance(0.3);
   const c=M.renderer.camera; return {h:+(2*Math.atan(Math.tan(c.fov*Math.PI/360)*c.aspect)*180/Math.PI).toFixed(0), hfov:M.renderer.hfov}; });
 A(def.h===90,`default should be 90 horizontal, got ${def.h}`);
 // change it in the pause menu
 const wide=await page.evaluate(()=>{ document.querySelector('[data-fov="100"]').click();
   const M=window.__mirage; M.advance(0.3); const c=M.renderer.camera;
   return {h:+(2*Math.atan(Math.tan(c.fov*Math.PI/360)*c.aspect)*180/Math.PI).toFixed(0),
           stored:JSON.parse(localStorage.getItem("mirage:settings")||"{}").fov}; });
 A(wide.h===100,`Wide should give 100 horizontal, got ${wide.h}`);
 A(wide.stored===100,`Wide should persist, stored ${wide.stored}`);
 // survive a reload AND apply to the new run's renderer
 await page.reload({waitUntil:"networkidle"});
 const after=await page.evaluate(()=>{ const M=window.__mirage; M.startRun({seed:1234}); M.advance(0.3);
   const c=M.renderer.camera;
   return {h:+(2*Math.atan(Math.tan(c.fov*Math.PI/360)*c.aspect)*180/Math.PI).toFixed(0),
           sel:document.querySelector('[data-fov].sel')?.dataset.fov}; });
 A(after.h===100,`the stored FOV should apply to a fresh run, got ${after.h}`);
 A(after.sel==="100",`the Wide button should be pre-selected, got ${after.sel}`);
 // aspect independence: a different window must keep 100 horizontal, not warp
 await page.setViewportSize({width:1200,height:400}); // ultrawide-ish 3:1
 const ultra=await page.evaluate(()=>{ const M=window.__mirage; M.renderer.resize(); M.advance(0.3);
   const c=M.renderer.camera; return {a:+c.aspect.toFixed(2),
     h:+(2*Math.atan(Math.tan(c.fov*Math.PI/360)*c.aspect)*180/Math.PI).toFixed(0)}; });
 A(Math.abs(ultra.h-100)<=1,`horizontal FOV must hold across aspect ${ultra.a}, got ${ultra.h}`);
 // pause-menu grid: every row reachable, no two controls on the same row+col
 const grid=await page.evaluate(()=>{ const M=window.__mirage; M.act(M.ACTIONS.PAUSE);
   const els=[...document.querySelectorAll("#pauseLayer [data-row]")].filter(e=>e.offsetParent!==null);
   const seen={},dupes=[];
   els.forEach(e=>{const k=e.dataset.row+","+e.dataset.col; if(seen[k])dupes.push(k+" "+(e.id||e.textContent.trim())); seen[k]=1;});
   return {rows:[...new Set(els.map(e=>e.dataset.row))].sort(), dupes}; });
 A(grid.dupes.length===0,`pause menu has colliding grid cells: ${JSON.stringify(grid.dupes)}`);
 A(grid.rows.join()==="0,1,2,3",`pause rows should be 0-3, got ${grid.rows.join()}`);
 A(errs.length===0,`page errors: ${JSON.stringify(errs.slice(0,2))}`);
 await b.close(); s.close();
 if(fails.length){console.log(fails.length+" failed:");fails.forEach(f=>console.log("  ✗ "+f));process.exit(1);}
 console.log("field of view: OK — 90 default, adjustable, persists, aspect-independent, grid clean");
})().catch(e=>{console.error("CRASH:",e.message);process.exit(1);});
