// Does the alpha actually PLAY? — drives woods.html in a real browser.
//
// The unit tests prove the fake always says exactly one wrong thing. They
// cannot prove the page ever puts it in front of a player. This one walks the
// whole loop: read yesterday, sleep, ask everyone, name someone, get a verdict.
//
// It also guards the two rules that are easiest to break by accident on a
// screen: nothing announces the swap, and nothing marks the difference. A
// highlighted tell would score green on every other test in the repo.
//
// Run: node tests/woods-play.mjs

import { createRequire } from "module";
import http from "http"; import fs from "fs"; import path from "path";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const serve = () => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
});

const fails = [];
const A = (c, m) => { if (!c) fails.push(m); };

(async () => {
  const s = serve(); await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const base = `http://localhost:${s.address().port}/woods.html`;
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await b.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // A missing favicon is the browser asking, not the page failing — every
  // other page in this repo 404s it too.
  page.on("requestfailed", (r) => { if (!r.url().includes("favicon")) errors.push(`request failed: ${r.url()}`); });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("favicon")) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => {
    const from = m.location()?.url || "";
    if (m.type() === "error" && !from.includes("favicon")) errors.push(`${m.text()} <- ${from}`);
  });

  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });

  // --- yesterday is LIVED, one thing at a time
  A((await page.$$("#lived li")).length === 0, "the day was handed over before it happened");
  A(!(await page.isVisible("#sleep")), "could sleep before the day had happened");
  const lived = [];
  for (let i = 0; i < 7; i++) {
    await page.click("#next");
    const now = await page.$$eval("#lived li", (ns) => ns.map((n) => n.textContent));
    A(now.length === i + 1, `after ${i + 1} presses the day should be ${i + 1} long, is ${now.length}`);
    lived.push(now[i]);
  }
  A(!(await page.isVisible("#next")), "the day never ended");
  A(await page.isVisible("#sleep"), "no way to sleep once the day is done");

  await page.click("#sleep");
  A(await page.isVisible("#morning"), "morning never came");
  A(!(await page.isVisible("#yesterday")), "yesterday is still on screen");

  // The roster must be untouched by the night.
  const names = await page.$$eval("#who .person h3", (ns) => ns.map((n) => n.textContent));
  A(names.length === 5, `expected 5 at camp, got ${names.length}`);
  A(new Set(names).size === 5, "two people share a name");

  // Nothing may announce who was taken. The page must not carry the word
  // anywhere in its markup before the call is made.
  const markup = await page.content();
  for (const word of ["swapped", "tell", "fake", "replaced"]) {
    A(!markup.toLowerCase().includes(`"${word}"`), `the page leaks "${word}" before the call`);
  }

  // --- ask everyone
  const asks = await page.$$("#who button.ask");
  A(asks.length === 5, `expected 5 people to ask, got ${asks.length}`);
  for (let i = 0; i < 5; i++) await (await page.$$("#who button.ask"))[0].click();
  A((await page.$$("#who button.ask")).length === 0, "someone could not be asked");
  const accounts = await page.$$eval("#who .account", (ns) => ns.map((n) => n.children.length));
  A(accounts.length === 5, "not every account is on screen");
  A(accounts.every((n) => n === 7), `an account is not 7 lines: ${accounts.join(",")}`);

  // THE MORNING HOLDS NO TRANSCRIPT. The player is the recording; a day left on
  // screen makes their memory unnecessary and the game a diff.
  A((await page.$$("#memory li")).length === 0,
    "the day is still on screen in the morning — the page is the evidence, not the player");
  A(!(await page.content()).includes("What you remember"),
    "the morning still hands the player their own memory back");

  // Exactly one account must differ from the day that actually happened — and
  // the page must not be the thing pointing it out.
  const said = await page.$$eval("#who .account", (ns) =>
    ns.map((n) => [...n.children].map((li) => li.textContent)));
  const odd = said.filter((a) => a.some((line, i) => line !== lived[i]));
  A(odd.length === 1, `exactly one account should diverge, ${odd.length} did`);

  const marked = await page.$$eval("#who .account li",
    (ns) => ns.filter((n) => n.className || n.querySelector("b,mark,strong,em,span")).length);
  A(marked === 0, `${marked} account line(s) are marked up — the page is doing the finding`);

  // --- the call
  await page.click("#who .person:nth-child(1) button.name");
  A(await page.isVisible("#verdict"), "no verdict");
  const call = (await page.textContent("#call")).trim();
  A(/^You were (right|wrong)\.$/.test(call), `unexpected verdict text: ${call}`);
  const reveal = (await page.textContent("#reveal")).trim();
  A(reveal.length > 0, "the verdict never says who it was");
  A(names.some((n) => reveal.includes(n)), "the reveal names nobody");

  // --- a different day is a different day
  await page.click("#again");
  for (let i = 0; i < 7; i++) await page.click("#next");
  const next = await page.$$eval("#lived li", (ns) => ns.map((n) => n.textContent));
  A(next.join("|") !== lived.join("|"), "the next day is the same day");

  // --- and a seed replays exactly
  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });
  for (let i = 0; i < 7; i++) await page.click("#next");
  const again = await page.$$eval("#lived li", (ns) => ns.map((n) => n.textContent));
  A(again.join("|") === lived.join("|"), "seed 3 did not replay identically");

  // --- NEGATIVE CONTROLS for the two guards above.
  //
  // Both are DOM assertions, and a DOM assertion written from the same mental
  // model as the page it checks passes on the correct build and the broken one
  // alike. This codebase has shipped four tests that asserted a bug instead of
  // catching it, so: put the old shape back into the live page and watch the
  // guards go red. Same document, same selectors, real fidelity — a synthetic
  // control that does not match the real markup gives the same false verdict as
  // a broken predicate (Brain: august-10#E20 / draft positive-control fidelity).
  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });
  for (let i = 0; i < 7; i++) await page.click("#next");
  await page.click("#sleep");
  await page.evaluate((day) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = "<h3>What you remember</h3><ul id=\"memory\"></ul>";
    document.getElementById("morning").prepend(wrap);
    for (const line of day) {
      const li = document.createElement("li");
      li.textContent = line;
      document.getElementById("memory").append(li);
    }
  }, lived);
  A((await page.$$("#memory li")).length !== 0,
    "NEGATIVE CONTROL FAILED: the transcript guard passes with a transcript on screen");
  A((await page.content()).includes("What you remember"),
    "NEGATIVE CONTROL FAILED: the wording guard passes with the wording present");

  // And the lived-day guard: a page that renders the whole day up front.
  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });
  await page.evaluate((day) => {
    for (const line of day) {
      const li = document.createElement("li");
      li.textContent = line;
      document.getElementById("lived").append(li);
    }
  }, lived);
  A((await page.$$("#lived li")).length !== 0,
    "NEGATIVE CONTROL FAILED: the lived-day guard passes on a day handed over whole");

  A(errors.length === 0, `console/page errors: ${errors.slice(0, 3).join(" | ")}`);

  await b.close(); s.close();
  if (fails.length) {
    console.log(`\x1b[31mseven woods: ${fails.length} FAILED\x1b[0m`);
    for (const f of fails) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log("\x1b[32mseven woods: OK — lived the day from nothing, asked everyone, made the call\x1b[0m");
})();
