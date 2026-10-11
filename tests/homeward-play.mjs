// homeward-play.mjs — in a real browser: reach the far edge, light pylons with
// teammates, and the run ends home. Run: node tests/homeward-play.mjs
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "http"; import { readFile } from "fs/promises"; import path from "path";
const ROOT=path.dirname(path.dirname(new URL(import.meta.url).pathname)); const T={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css"};
const s=createServer(async(q,r)=>{const u=(q.url||"/").split("?")[0];try{const b=await readFile(path.join(ROOT,u==="/"?"index.html":u));r.writeHead(200,{"Content-Type":T[path.extname(u)]||"application/octet-stream"});r.end(b)}catch{r.writeHead(404);r.end()}});
await new Promise(r=>s.listen(0,r)); const P=s.address().port;
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"]});
const pg=await b.newPage({viewport:{width:640,height:360}}); const errs=[]; pg.on("pageerror",e=>errs.push(String(e).slice(0,300)));
await pg.goto(`http://127.0.0.1:${P}/index.html`); await pg.waitForFunction(()=>!!window.__seven,null,{timeout:20000});
await pg.evaluate(()=>window.__seven.startSeven({seed:777}));
const r=await pg.evaluate(()=>{const M=window.__seven,s=M.sim;
  document.getElementById("planGo").click();
  s.companions[1].replacedDay=2;                       // one fake in the camp
  const tr=s.world.trail; const ex=tr.exitCz; const c={x:(tr.trailX[ex]-s.world.grid/2+1)*s.world.cell, z:(ex-s.world.grid/2+0.5)*s.world.cell};
  s.player.x=c.x; s.player.z=-(s.world.grid/2-2)*s.world.cell-0.5; M.advance(0.2);
  const L=document.getElementById("finalLayer"); const open=!L.classList.contains("hidden");
  const body=document.getElementById("finalBody").textContent;
  const btns=()=>[...document.querySelectorAll("#finalPylons button")];
  const n0=btns().length;
  btns()[1].click();                                     // the fake
  const said=document.getElementById("finalState").textContent; const n1=btns().length;
  while(btns().length && s.status==="decision") btns()[0].click();
  return {open,body,n0,said,n1,status:s.status,ending:s.ending,fd:s.finalDecision};});
const fails=[]; const A=(c,m)=>{if(!c)fails.push(m)};
A(r.open && /^5 pylons/.test(r.body), `the edge did not open with 4 real + 1 pylons: ${JSON.stringify(r)}`);
A(r.n0===5 && r.n1===4, `buttons ${r.n0} then ${r.n1}`);
A(/not there any more/.test(r.said), `trying the fake said: ${r.said}`);
A(r.status==="won" && r.ending==="home" && r.fd && r.fd.saved===4 && r.fd.leftBehind===0, `ending ${JSON.stringify(r)}`);
A(errs.length===0, "page errors: "+errs.join("|"));
await b.close(); s.close();
if(fails.length){console.log("HOMEWARD PLAY FAILED:\n  ✗ "+fails.join("\n  ✗ ")); process.exit(1);}
console.log("homeward play: OK — the edge, one fake tried, four real home"); process.exit(0);
