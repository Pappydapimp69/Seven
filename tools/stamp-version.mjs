// stamp-version.mjs — put ONE version string on every cache-bustable URL.
//
// Why this exists: index.html loaded `src/main.js?v=<version>`, which busts
// main.js and nothing else. ES module imports are resolved against the module's
// PATH — a query string is NOT inherited by `import "./percept.js"` — so every
// other module (state, percept, hud, render, party, world, input, audio, rng)
// kept being served from cache no matter how many times the version was bumped.
// Shipped fixes to those files simply never reached a returning player, which
// is indistinguishable from "the fix didn't work" and burned several rounds.
//
// So: stamp the version onto index.html's <link>/<script> AND onto every
// relative import inside src/*.js. One command, no build step, still a plain
// static site.
//
// Usage: node tools/stamp-version.mjs 0.7.4

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = process.argv[2];
if (!raw) {
  console.error("usage: node tools/stamp-version.mjs <version>   (e.g. 0.7.4)");
  process.exit(1);
}
const version = raw.startsWith("seven-") ? raw : `seven-${raw}`;

// A relative import/export specifier, with or without an existing ?v= stamp.
const SPECIFIER = /(from\s+")(\.\/[A-Za-z0-9_\-.]+\.js)(?:\?v=[^"]*)?(")/g;

let touched = 0;
for (const file of fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".js"))) {
  const p = path.join(ROOT, "src", file);
  const before = fs.readFileSync(p, "utf8");
  const after = before.replace(SPECIFIER, `$1$2?v=${version}$3`);
  if (after !== before) {
    fs.writeFileSync(p, after);
    touched++;
  }
}

// Each page's own references, plus the BUILD constant main.js reports. Every
// page that loads a module has to be stamped, not just index.html: woods.html
// is a second entry point, and an unstamped entry pins its whole import tree
// to whatever the browser cached — which is the exact failure this tool was
// written for, one page over.
const ENTRIES = [{ file: "index.html", script: "src/main.js" }];
for (const entry of ENTRIES) {
  const htmlPath = path.join(ROOT, entry.file);
  if (!fs.existsSync(htmlPath)) continue;
  const scriptRe = new RegExp(`(src="${entry.script.replace(/[/.]/g, "\\$&")})(?:\\?v=[^"]*)?(")`, "g");
  const html = fs
    .readFileSync(htmlPath, "utf8")
    .replace(/(href="css\/style\.css)(?:\?v=[^"]*)?(")/g, `$1?v=${version}$2`)
    .replace(scriptRe, `$1?v=${version}$2`);
  fs.writeFileSync(htmlPath, html);
}

const mainPath = path.join(ROOT, "src", "main.js");
fs.writeFileSync(
  mainPath,
  fs.readFileSync(mainPath, "utf8").replace(/const BUILD = "[^"]*";/, `const BUILD = "${version}";`),
);

console.log(`stamped ${version} — ${touched} module file(s) + ${ENTRIES.length} page(s)`);
