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

  // --- yesterday
  const lived = await page.$$eval("#lived li", (ns) => ns.map((n) => n.textContent));
  A(lived.length === 7, `yesterday should list 7 things, got ${lived.length}`);
  A(await page.isVisible("#sleep"), "no way to sleep");

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

  // --- the morning has a budget, and something else wants it
  A((await page.textContent("#hours")).includes("5 of 5"), "the morning did not start full");
  A(await page.isEnabled("#search"), "cannot go looking at the start of the morning");

  // --- ask everyone: five people, five hours, and the walk is then unaffordable
  const asks = await page.$$("#who button.ask");
  A(asks.length === 5, `expected 5 people to ask, got ${asks.length}`);
  for (let i = 0; i < 5; i++) await (await page.$$("#who button.ask"))[0].click();
  A((await page.$$("#who button.ask")).length === 0, "someone could not be asked");
  A((await page.textContent("#hours")).includes("0 of 5"), "the hours were not spent");
  A(!(await page.isEnabled("#search")), "went looking on an empty morning");
  const accounts = await page.$$eval("#who .account", (ns) => ns.map((n) => n.children.length));
  A(accounts.length === 5, "not every account is on screen");
  A(accounts.every((n) => n === 7), `an account is not 7 lines: ${accounts.join(",")}`);

  // Exactly one account must differ from what the player remembers — and the
  // page must not be the thing pointing it out.
  const memory = await page.$$eval("#memory li", (ns) => ns.map((n) => n.textContent));
  const said = await page.$$eval("#who .account", (ns) =>
    ns.map((n) => [...n.children].map((li) => li.textContent)));
  const odd = said.filter((a) => a.some((line, i) => line !== memory[i]));
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

  // --- the other road: going out first, and winning without an accusation
  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });
  await page.click("#sleep");
  await page.click("#search");
  A(await page.isVisible("#verdict"), "going out first did not end the run");
  A((await page.textContent("#call")).includes("found them"),
    `going out before asking should always find them: ${await page.textContent("#call")}`);
  A(!(await page.textContent("#reveal")).includes("undefined"), "the rescue text is broken");

  // --- and going out LAST is a different, worse bet
  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });
  await page.click("#sleep");
  await (await page.$$("#who button.ask"))[0].click();
  await (await page.$$("#who button.ask"))[0].click();
  A((await page.textContent("#hours")).includes("3 of 5"), "two questions did not cost two hours");
  A(await page.isEnabled("#search"), "three hours should still buy the walk");

  // --- a different day is a different day
  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });
  await page.click("#sleep");
  await page.click("#who .person:nth-child(1) button.name");
  await page.click("#again");
  const next = await page.$$eval("#lived li", (ns) => ns.map((n) => n.textContent));
  A(next.join("|") !== lived.join("|"), "the next day is the same day");

  // --- and a seed replays exactly
  await page.goto(`${base}?seed=3`, { waitUntil: "networkidle" });
  const again = await page.$$eval("#lived li", (ns) => ns.map((n) => n.textContent));
  A(again.join("|") === lived.join("|"), "seed 3 did not replay identically");

  A(errors.length === 0, `console/page errors: ${errors.slice(0, 3).join(" | ")}`);

  await b.close(); s.close();
  if (fails.length) {
    console.log(`\x1b[31mseven woods: ${fails.length} FAILED\x1b[0m`);
    for (const f of fails) console.log("  ✗ " + f);
    process.exit(1);
  }
  console.log("\x1b[32mseven woods: OK — read the day, asked everyone, made the call\x1b[0m");
})();
