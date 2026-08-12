// What the first paint costs, and what it says while it waits.
//
// The critical path is the part of this app that is easiest to ruin by
// accident: a <script defer> blocks every later <script defer>, so one library
// added to the head sits in front of app.js — the file that draws the entire
// interface — for every visit, whether or not any document needs it. Mermaid
// alone is 3.5MB, and for a while it was loaded that way.
//
// So this suite is mostly a budget. It asserts what may appear in the head, not
// what may not: a list of forbidden libraries only catches the four that were
// once there, while an allow-list catches the fifth that someone adds next
// year.
const fs = require("fs");
const path = require("path");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const index = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
const share = fs.readFileSync(path.join(PUBLIC_DIR, "share.html"), "utf8");
const core = fs.readFileSync(path.join(PUBLIC_DIR, "js", "markdown-core.js"), "utf8");
const css = fs.readFileSync(path.join(PUBLIC_DIR, "css", "app.css"), "utf8");
const app = fs.readFileSync(path.join(PUBLIC_DIR, "js", "app.js"), "utf8");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// Comments in these files name the very libraries being checked for, so tags
// have to be read as tags rather than by searching for the string.
function remoteTags(html) {
  return [...html.matchAll(/<(script|link)\b[^>]*>/gi)]
    .map((match) => {
      const tag = match[0];
      const url = tag.match(/(?:src|href)="(https?:\/\/[^"]+)"/i);
      return url ? { tag: match[1].toLowerCase(), url: url[1] } : null;
    })
    .filter(Boolean);
}

// Everything the browser is allowed to fetch from a third party before the app
// can run. Fonts and the icon font are here because the interface is made of
// icons and would otherwise paint as a column of empty boxes; marked and
// DOMPurify because nothing renders at all without them. Adding to this list is
// a decision about how long a first visit takes.
const CRITICAL_PATH_ALLOWED = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "@phosphor-icons/web",
  "marked@",
  "dompurify@"
];

console.log("=== the critical path is only what cannot be deferred ===");
for (const [name, html] of [["index.html", index], ["share.html", share]]) {
  const remote = remoteTags(html);
  const unexpected = remote
    .map((entry) => entry.url)
    .filter((url) => !CRITICAL_PATH_ALLOWED.some((allowed) => url.includes(allowed)));
  check(`${name} fetches nothing else up front`, unexpected, []);
}

// The four that were moved out, by name, so that putting one back is a failure
// and not merely a slowdown nobody measures.
const DEFERRED = ["mermaid", "katex", "highlight.js/", "svg-pan-zoom"];
for (const [name, html] of [["index.html", index], ["share.html", share]]) {
  for (const library of DEFERRED) {
    const eager = remoteTags(html).some((entry) => entry.url.includes(library));
    if (eager) failures++;
    console.log(`  ${eager ? "FAIL" : "PASS"}  ${name} does not load ${library} in the head`);
  }
}

console.log("=== ...because markdown-core fetches them on demand ===");
check("a lazy library table exists", /const LAZY_LIBRARIES = \{/.test(core), true);

// Parsed out of the table rather than searched for loosely: a URL mentioned in
// a comment must not be able to satisfy this.
const lazyAssets = [...core.matchAll(/(?:js|css): "(https:\/\/[^"]+)",\s*\n\s*integrity: "(sha384-[^"]+)"/g)]
  .map(([, url, integrity]) => ({ url, integrity }));

for (const library of DEFERRED) {
  const declared = lazyAssets.some((asset) => asset.url.includes(library));
  if (!declared) failures++;
  console.log(`  ${declared ? "PASS" : "FAIL"}  ${library} is declared as a lazy asset`);
}

// The whole point of moving them was speed, and the cheapest way to lose the
// security that came free with a <script> tag in the head is to forget that a
// dynamically created one checks nothing unless told to.
check("every lazy asset carries an integrity hash", lazyAssets.every((asset) => asset.integrity.startsWith("sha384-")), true);
check("...and the loader sets it on the element", /node\.integrity = asset\.integrity/.test(core), true);
check("...with crossorigin, or the hash cannot be checked", /node\.crossOrigin = "anonymous"/.test(core), true);
check("the KaTeX stylesheet comes with the KaTeX script",
  lazyAssets.some((asset) => asset.url.includes("katex") && asset.url.endsWith(".css")), true);

console.log("=== nothing is fetched for a document that does not need it ===");
// Scoped to the render function: "promoteMermaidCodeBlocks(root)" also occurs
// in that function's own declaration, several hundred lines earlier, so an
// ordering check against the whole file would compare against the wrong one.
const renderMermaid = core.slice(core.indexOf("async function renderMermaidBlocks"));
check("the diagram engine waits for a diagram",
  /if \(wantsDiagram\) \{\s*await ensureLibrary\("mermaid"\);/.test(renderMermaid), true);
check("the highlighter waits for a code block", /querySelector\("pre code"\)[\s\S]{0,120}ensureLibrary\("highlight"\)/.test(core), true);
check("maths waits for maths", /hasMathContent\(root\)[\s\S]{0,120}ensureLibrary\("math"\)/.test(core), true);
check("pan and zoom waits for a drawn diagram", /querySelector\("\.mermaid-block svg"\)[\s\S]{0,120}ensureLibrary\("panZoom"\)/.test(core), true);

// Promoting rewrites a fenced block into a bare <div>, so doing it before the
// engine is known to be available would leave the diagram's source as loose
// body text on a page that could not draw it.
check("the engine is settled before any block is promoted",
  renderMermaid.indexOf('ensureLibrary("mermaid")') < renderMermaid.indexOf("promoteMermaidCodeBlocks(root)"), true);

// An already-loaded library must still be used synchronously. The editor
// preview repaints on every keystroke and measures its own scroll height
// immediately afterwards, so a microtask between the two is a visible flicker.
check("loaded highlighting still runs on the spot",
  /if \(global\.hljs\) \{\s*highlightLoadedCodeBlocks\(root\);/.test(core), true);
check("loaded maths still runs on the spot",
  /if \(global\.katex \|\| global\.renderMathInElement\) \{\s*renderLoadedMathBlocks\(root\);/.test(core), true);

// A CDN blip must not cost the rest of the session its syntax colours.
check("a failed load is not cached", /libraryLoads\.delete\(name\)/.test(core), true);

console.log("=== a wait looks like a wait ===");
// The shell is served for every document address, so this markup is what a
// reader sees at /Notes/day-one.md before a line of script has run. Telling
// them to pick a file, while the app is already fetching the one they asked
// for, is the wrong answer to the wrong question.
const emptyState = index.match(/<section id="emptyState"[\s\S]*?<\/section>/);
check("the shell ships a loading state, not a prompt", Boolean(emptyState), true);
check("...that is marked as loading", /class="empty-state is-loading"/.test(emptyState[0]), true);
check("...and does not claim nothing is selected", /No file selected/.test(emptyState[0]), false);
check("...and says so to a screen reader", /aria-busy="true"/.test(emptyState[0]), true);

check("the spinner actually spins", /\.empty-state\.is-loading i \{\s*animation: share-spin/.test(css), true);
check("...unless reduced motion is asked for",
  /prefers-reduced-motion: reduce\)\s*\{\s*\.empty-state\.is-loading i \{\s*animation: none/.test(css), true);

// The markup ships spinning, so every settled state has to stop it. Doing this
// in showEmptyState rather than at each call site is what makes that true of
// the ones written later, too.
check("a settled state stops the spinner",
  /function showEmptyState[\s\S]{0,400}classList\.remove\("is-loading"\)/.test(app), true);
check("...and clears aria-busy with it",
  /function showEmptyState[\s\S]{0,400}removeAttribute\("aria-busy"\)/.test(app), true);

// Naming the document is the point: "Loading" alone does not tell a reader
// whether the link they followed was understood.
check("a pathed boot names the document it is fetching",
  /showLoadingState\(`Opening \$\{wantedAtBoot\}`/.test(app), true);
check("...before the first request goes out",
  app.indexOf("showLoadingState(`Opening") < app.indexOf("await refreshSession()"), true);

// Every way out of initialize() has to replace the spinner, or it turns for
// ever behind whatever is on screen.
for (const [label, pattern] of [
  ["the sign-in wall", /showEmptyState\("This library is private"/],
  ["the forced password change", /showEmptyState\("Set a new password"/],
  ["an empty library", /showEmptyState\("No markdowns yet"/],
  ["a document that is not there", /showEmptyState\("Document not found"/],
  ["a failure to load at all", /showEmptyState\("Document loading failed"/]
]) {
  check(`${label} settles the panel`, pattern.test(app), true);
}

console.log(failures === 0 ? "\nALL LOADING CHECKS PASSED" : `\n${failures} LOADING CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
