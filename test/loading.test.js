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
const { appSource, coreSource, styleSource } = require("./app-source.js");
const { createChecker } = require("./helpers/check.js");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const index = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
const share = fs.readFileSync(path.join(PUBLIC_DIR, "share.html"), "utf8");
const core = coreSource(PUBLIC_DIR);
const css = styleSource(PUBLIC_DIR);
const app = appSource(PUBLIC_DIR);

const { check, fail, finish } = createChecker("LOADING");

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

/* Every page begins with a doctype, and nothing at all comes before it.
 *
 * share.html and error.html had none. A page with no doctype is rendered in
 * quirks mode, and KaTeX refuses to run in quirks mode at all — so every
 * formula in every shared document silently failed to render, all 955 of them
 * in the notes this was found with, while the same document in the app was
 * fine. Quirks mode also changes box-sizing, so the layout of both pages was
 * subtly wrong on top of it.
 *
 * A comment first is enough to cause it, which is how it happened: both files
 * open with a note explaining what they are.
 */
console.log("=== every page is in standards mode ===");
{
  const publicDir = path.join(__dirname, "..", "public");

  const pages = fs.readdirSync(publicDir).filter((name) => name.endsWith(".html"));
  check("(there are pages to check)", pages.length >= 4, true);

  const wrong = pages.filter((name) =>
    !fs.readFileSync(path.join(publicDir, name), "utf8").startsWith("<!DOCTYPE html>"));
  check("no page has anything before its doctype", wrong, []);
}


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
    if (eager) fail();
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
  if (!declared) fail();
  console.log(`  ${declared ? "PASS" : "FAIL"}  ${library} is declared as a lazy asset`);
}

// The whole point of moving them was speed, and the cheapest way to lose the
// security that came free with a <script> tag in the head is to forget that a
// dynamically created one checks nothing unless told to.
check("every lazy asset carries an integrity hash", lazyAssets.every((asset) => asset.integrity.startsWith("sha384-")), true);
check("the KaTeX stylesheet comes with the KaTeX script",
  lazyAssets.some((asset) => asset.url.includes("katex") && asset.url.endsWith(".css")), true);
// What the loader does with those hashes is checked by running it, at the
// bottom of this file, rather than by reading the line that sets them.

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
  /if \(window\.hljs\) \{\s*highlightLoadedCodeBlocks\(root\);/.test(core), true);
check("loaded maths still runs on the spot",
  /if \(window\.katex \|\| window\.renderMathInElement\) \{\s*renderLoadedMathBlocks\(root\);/.test(core), true);

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
for (const [label, pattern] of /** @type {[string, RegExp][]} */ ([
  ["the sign-in wall", /showEmptyState\("This library is private"/],
  ["the forced password change", /showEmptyState\("Set a new password"/],
  ["an empty library", /showEmptyState\("No markdowns yet"/],
  ["a document that is not there", /showEmptyState\("Document not found"/],
  ["a failure to load at all", /showEmptyState\("Document loading failed"/]
])) {
  check(`${label} settles the panel`, pattern.test(app), true);
}

console.log("=== the app's own assets go out compressed ===");
{
  /* 106 files and 1.1MB of raw text was the largest saving this app had left,
   * and it needed no build step to take: node has had brotli since 10. The
   * checks are on the module rather than on a live server, because what can go
   * wrong here is the negotiation and the bookkeeping, not the compressing.
   */
  const zlib = require("zlib");
  const { createStaticAssets, pickEncoding, MIN_COMPRESS_BYTES } =
    require("../lib/http/static-assets.js");

  check("brotli is preferred when offered", pickEncoding("gzip, deflate, br"), "br");
  check("...gzip when it is not", pickEncoding("gzip, deflate"), "gzip");
  check("...and nothing is assumed of a client that says nothing",
    pickEncoding(undefined), "identity");
  check("a header naming neither gets the file itself", pickEncoding("deflate"), "identity");

  // The middleware, driven the way express would drive it.
  const { createAssetVersions } = require("../lib/http/asset-versions.js");
  const serve = createStaticAssets({
    publicDir: PUBLIC_DIR,
    assetVersions: createAssetVersions({ publicDir: PUBLIC_DIR })
  });

  function ask(urlPath, acceptEncoding, query = {}) {
    const answer = { headers: {}, status: 200, body: null, passed: false };
    const res = {
      set(name, value) { answer.headers[name] = value; return res; },
      status(code) { answer.status = code; return res; },
      send(body) { answer.body = body; return res; },
      end() { return res; }
    };
    serve(
      { method: "GET", path: urlPath, query, headers: { "accept-encoding": acceptEncoding }, fresh: false },
      res,
      () => { answer.passed = true; }
    );
    return answer;
  }

  const raw = fs.readFileSync(path.join(PUBLIC_DIR, "js", "app.js"));

  const brotli = ask("/js/app.js", "br");
  check("a script is answered brotli", brotli.headers["Content-Encoding"], "br");
  check("...and it is the file, decompressed",
    zlib.brotliDecompressSync(brotli.body).equals(raw), true);
  check("...and it is smaller than the file", brotli.body.length < raw.length, true);
  check("...typed as javascript", brotli.headers["Content-Type"], "text/javascript; charset=utf-8");
  check("...and marked as varying by what was accepted",
    brotli.headers.Vary, "Accept-Encoding");

  const gzipped = ask("/js/app.js", "gzip");
  check("a client that only has gzip gets gzip", gzipped.headers["Content-Encoding"], "gzip");
  check("...and that is the file too", zlib.gunzipSync(gzipped.body).equals(raw), true);

  const plain = ask("/js/app.js", "");
  check("a client that accepts no encoding gets the file", plain.headers["Content-Encoding"], undefined);
  check("...unencoded and unchanged", plain.body.equals(raw), true);

  // Two bodies, so two tags. One tag for both is how a 304 delivers bytes the
  // client cannot read.
  check("each encoding carries its own ETag",
    brotli.headers.ETag === plain.headers.ETag, false);

  check("a stylesheet is served as one too",
    ask("/css/app/markdown.css", "br").headers["Content-Type"], "text/css; charset=utf-8");

  // Everything it is not responsible for has to fall through, or express.static
  // behind it never gets the chance to answer.
  check("an image is left to the static handler", ask("/favicon.svg", "br").passed, true);
  check("a missing script is left to it as well", ask("/js/nope.js", "br").passed, true);
  check("and a traversal is not answered here",
    ask("/js/../../package.json", "br").passed, true);

  // The immutable pairing from the version work next door still applies.
  const versioned = createAssetVersions({ publicDir: PUBLIC_DIR });
  const current = versioned.versionOf("/js/app.js");
  check("a request carrying the current version may be kept",
    ask("/js/app.js", "br", { v: current }).headers["Cache-Control"],
    "public, max-age=31536000, immutable");
  check("...and one carrying a stale version may not",
    ask("/js/app.js", "br", { v: "deadbeef" }).headers["Cache-Control"],
    "public, max-age=0");

  check("the threshold below which compressing is not worth the framing",
    MIN_COMPRESS_BYTES, 512);
}

/* And the loader itself, run.
 *
 * Everything above reads these files as text, because a budget is about what
 * is in them. This last part evaluates md/lazy.js in a window and hands it a
 * head that answers: jsdom fetches nothing, so whether an asset arrives is
 * this suite's to decide, which is what makes the failure path checkable at
 * all.
 */
(async () => {
  const { JSDOM } = require("jsdom");
  const { loadScript } = require("./app-source.js");

  console.log("=== the loader, with a network that answers ===");

  const { window } = new JSDOM("", { url: "https://example.test/", runScripts: "outside-only" });
  // lazy.js configures marked as it loads, so marked has to be there.
  window.marked = /** @type {any} */ ({ setOptions() {}, parse: (text) => String(text) });
  loadScript(window, path.join(PUBLIC_DIR, "js", "md", "lazy.js"));
  const Lazy = window.MdLazy;

  // Which global each library puts itself in, which is what `loaded()` looks
  // for and therefore what arriving means.
  const PUTS_ITSELF_IN = [
    ["mermaid", "mermaid"], ["svg-pan-zoom", "svgPanZoom"], ["highlight", "hljs"],
    // KaTeX is two scripts and the second of them is what the renderer calls,
    // so a page with only the first is a page where no formula is typeset.
    ["katex.min.js", "katex"], ["auto-render", "renderMathInElement"]
  ];

  const asked = [];
  let arrives = true;

  const realAppend = window.document.head.appendChild.bind(window.document.head);
  window.document.head.appendChild = /** @type {any} */ ((node) => {
    asked.push(node);
    realAppend(node);

    Promise.resolve().then(() => {
      if (arrives) {
        const where = node.src || node.href || "";
        const found = PUTS_ITSELF_IN.find(([part]) => where.includes(part));
        if (found) {
          window[found[1]] = /** @type {any} */ ({});
        }
      }

      node.dispatchEvent(new window.Event(arrives ? "load" : "error"));
    });

    return node;
  });

  /* What it says when it cannot, before anybody has told it where to say it.
   * The default goes to the console, which is the right answer on a page that
   * has not wired a toast up yet — the share page spends its first moments in
   * exactly that state.
   */
  const logged = [];
  window.console.warn = (message) => logged.push(message);
  arrives = false;
  await Lazy.ensureLibrary("highlight");
  check("a page that has not said where to put a warning gets it in the console",
    logged, ["Syntax highlighting could not be loaded, "
      + "so part of this document is shown unformatted."]);
  arrives = true;
  asked.length = 0;

  const warnings = [];
  Lazy.configure({ onWarning: (message) => warnings.push(message) });

  // A library nothing knows about is not a library, and asking for one is not
  // an error — it is a renderer asking for something this build dropped.
  check("a library that is not in the table is simply not available",
    [await Lazy.ensureLibrary("nothing-like-this"), asked.length], [false, 0]);

  check("asking for the diagram engine loads it", await Lazy.ensureLibrary("mermaid"), true);
  check("...from the one place it is pinned",
    asked[asked.length - 1].src, lazyAssets.find((asset) => asset.url.includes("mermaid")).url);

  /* The whole point of moving these out of the head was speed, and the
   * cheapest way to lose the security that came free with a <script> tag
   * there is to forget that a dynamically created one checks nothing unless
   * it is told to.
   */
  check("...with the hash it is pinned to, and the crossorigin that lets it be checked",
    [String(asked[0].integrity).startsWith("sha384-"), asked[0].crossOrigin,
      asked[0].referrerPolicy], [true, "anonymous", "no-referrer"]);

  // Already on the page, so a later render does not fetch it again.
  check("...and asking again once it is there loads nothing",
    [await Lazy.ensureLibrary("mermaid"), asked.length], [true, 1]);

  /* One load per page, shared by every render that asks while it is still in
   * flight — which is the normal case on a document with a diagram, a formula
   * and a code block in it, all three of which ask at once.
   */
  asked.length = 0;
  const together = await Promise.all([
    Lazy.ensureLibrary("highlight"), Lazy.ensureLibrary("highlight"),
    Lazy.ensureLibrary("highlight")
  ]);
  check("three renders asking at once share one load", [together, asked.length],
    [[true, true, true], 1]);

  /* KaTeX is two assets and they are not the same kind of tag: a stylesheet
   * loaded as a script is a stylesheet that does nothing, silently.
   */
  asked.length = 0;
  check("maths brings its stylesheet as well as its script",
    await Lazy.ensureLibrary("math"), true);
  check("...as a stylesheet rather than as a script",
    asked.map((node) => [node.tagName, node.rel || ""])
      .filter(([tag]) => tag === "LINK").map(([, rel]) => rel), ["stylesheet"]);
  check("...and every one of them hashed",
    [asked.length, asked.every((node) => String(node.integrity).startsWith("sha384-"))],
    [3, true]);
  asked.length = 0;

  // Already there, so nothing is fetched — which is the case on every render
  // after the first.
  asked.length = 0;
  check("a library already on the page is not loaded again",
    [await Lazy.ensureLibrary("math"), asked.length], [true, 0]);

  console.log("=== and with one that does not ===");

  /* A failure degrades the document rather than failing it: the render carries
   * on exactly as it did when the library was simply absent, and the reader is
   * told which part of the page is not what it should be.
   */
  arrives = false;
  asked.length = 0;
  warnings.length = 0;
  check("a library that will not load is not available", await Lazy.ensureLibrary("panZoom"), false);
  check("...and the reader is told which part of the document that costs",
    warnings, ["Diagram pan and zoom could not be loaded, "
      + "so part of this document is shown unformatted."]);

  /* Not cached, which is the difference between a tab that recovers and a tab
   * that has to be reloaded: a document opened after the network comes back
   * tries again.
   */
  arrives = true;
  check("...and the failure is not remembered", await Lazy.ensureLibrary("panZoom"), true);

  process.exit(finish());
})();
