// What a code block does once it is on the page: hand itself over, and stay
// coloured while it is being typed.
//
// Both of these are behaviour, not markup, so most of this suite runs the real
// markdown-core.js inside jsdom against a stub highlighter that genuinely
// rewrites the DOM — wrapping keywords in spans the way highlight.js does. A
// stub that returned the source untouched would pass every caret check without
// ever moving the thing the caret is standing in, which is the entire problem
// live highlighting had to solve.

const fs = require("fs");
const path = require("path");
const { appSource } = require("./app-source.js");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "public");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "css", "app.css"), "utf8");
const app = appSource(ROOT);
const core = fs.readFileSync(path.join(ROOT, "js", "markdown-core.js"), "utf8");

/* --- the engine, in a browser that is not one -------------------------------

   Only what markdown-core reaches for at load time is stubbed. The highlighter
   below counts its own calls, which is how the "never guesses twice" and
   "does nothing when nothing changed" claims are checked at all: both are
   invisible in the resulting markup and only show up as work not done.
   -------------------------------------------------------------------------- */

const KNOWN_LANGUAGES = new Set(["javascript", "python", "bash"]);
const hljsCalls = { highlight: 0, auto: 0 };

function tokenize(source) {
  return source.replace(/\b(const|function|return|def)\b/g, '<span class="hljs-keyword">$1</span>');
}

const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
const window = dom.window;
const document = window.document;

window.marked = { setOptions() {}, parse: (md) => String(md) };
window.DOMPurify = { sanitize: (value) => value };
window.hljs = {
  getLanguage: (name) => (KNOWN_LANGUAGES.has(name) ? { name } : null),
  highlight(source, options) {
    hljsCalls.highlight += 1;
    return { value: tokenize(source), language: options.language };
  },
  highlightAuto(source) {
    hljsCalls.auto += 1;
    // Confident about JavaScript, and deliberately unconvinced about anything
    // else, so the low-relevance refusal has something to refuse.
    return /function|const|=>/.test(source)
      ? { value: tokenize(source), language: "javascript", relevance: 9 }
      : { value: source, language: "python", relevance: 1 };
  }
};

window.eval(fs.readFileSync(path.join(ROOT, "js", "markdown-core.js"), "utf8"));
const Core = window.MarkdownCore;

// Counted from before the first pass, so the delegation check below can say
// what the total is rather than only that it stopped growing.
const pageListeners = [];
const realAddEventListener = document.addEventListener.bind(document);
document.addEventListener = (type, ...rest) => {
  pageListeners.push(type);
  return realAddEventListener(type, ...rest);
};

function fixture(markup) {
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.appendChild(root);
  return root;
}

// Read the caret back the long way round, independently of the implementation.
function caretAt(element) {
  const selection = document.getSelection();
  if (selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const leading = range.cloneRange();
  leading.selectNodeContents(element);
  leading.setEnd(range.startContainer, range.startOffset);
  return { start: leading.toString().length, length: range.toString().length };
}

function findOffset(element, offset) {
  const walker = document.createTreeWalker(element, 4);
  let seen = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue.length;
    if (seen + length >= offset) {
      return [node, offset - seen];
    }
    seen += length;
  }

  return null;
}

function putCaret(element, start, end = start) {
  const range = document.createRange();
  range.selectNodeContents(element);

  const from = findOffset(element, start);
  const to = findOffset(element, end);
  if (from) {
    range.setStart(from[0], from[1]);
  }
  if (to) {
    range.setEnd(to[0], to[1]);
  }

  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/* --- copy buttons --------------------------------------------------------- */

console.log("=== every code block can be taken away ===");
{
  const root = fixture(`
    <pre><code class="language-js">const a = 1;</code></pre>
    <pre class="notebook-output-text">Traceback</pre>
    <div class="mermaid-block"><pre><code>flowchart TD</code></pre></div>
    <div class="ve-code"><pre><code contenteditable="plaintext-only">const b = 2;</code></pre></div>
  `);

  Core.addCopyButtons(root);

  check("a rendered code block gets a button", root.querySelectorAll(".code-copy").length, 1);
  check("...wrapped around the block rather than inside it",
    root.querySelector(".code-copy").parentElement.className, "code-block");
  check("...and the <pre> is still in there with it",
    Boolean(root.querySelector(".code-block > pre > code")), true);
  check("output panes are not code and get nothing",
    Boolean(root.querySelector(".notebook-output-text")?.closest(".code-block")), false);
  check("a diagram's source is not offered as code",
    Boolean(root.querySelector(".mermaid-block .code-copy")), false);
  check("code being typed into is not given one",
    Boolean(root.querySelector(".ve-code .code-copy")), false);

  const button = root.querySelector(".code-copy");
  check("it is a real button", button.tagName, "BUTTON");
  check("...that will not submit anything", button.getAttribute("type"), "button");
  check("...and says what it does", button.getAttribute("aria-label"), "Copy this code");

  // The editor preview re-renders on every keystroke, so this runs constantly.
  Core.addCopyButtons(root);
  Core.addCopyButtons(root);
  check("running again adds no second button", root.querySelectorAll(".code-copy").length, 1);
  check("...and no second wrapper", root.querySelectorAll(".code-block").length, 1);

  root.remove();
}

console.log("=== one listener, not one per block ===");
{
  // The editor preview rebuilds its markup on every keystroke, so a listener
  // attached per button would be attached again on every keystroke too.
  const root = fixture("<pre><code>one</code></pre><pre><code>two</code></pre>");
  Core.addCopyButtons(root);
  Core.addCopyButtons(root);
  const second = fixture("<pre><code>three</code></pre>");
  Core.addCopyButtons(second);

  document.addEventListener = realAddEventListener;

  check("every block over every pass shares one page listener",
    pageListeners.filter((type) => type === "click").length, 1);

  root.remove();
  second.remove();
}

console.log("=== clicking one puts the code on the clipboard ===");
(async () => {
  const written = [];
  window.isSecureContext = true;
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text) => { written.push(text); return Promise.resolve(); } }
  });

  const root = fixture('<pre><code class="language-js">const a = 1;\nreturn a;</code></pre>');
  Core.addCopyButtons(root);

  const button = root.querySelector(".code-copy");
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  check("the code goes to the clipboard", written, ["const a = 1;\nreturn a;"]);
  check("...and the button says so", button.classList.contains("is-copied"), true);
  check("...to a screen reader too", button.getAttribute("aria-label"), "Copied");
  check("...with a tick", button.querySelector("i").className, "ph ph-check");

  // A browser is allowed to refuse, and the execCommand fallback is not
  // implemented in jsdom either, so both paths fail here.
  window.navigator.clipboard.writeText = () => Promise.reject(new Error("refused"));
  const other = fixture("<pre><code>nope</code></pre>");
  Core.addCopyButtons(other);
  const failing = other.querySelector(".code-copy");
  failing.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  check("a refusal is shown rather than swallowed", failing.classList.contains("is-failed"), true);
  check("...and named", failing.getAttribute("aria-label"), "Could not copy");

  root.remove();
  other.remove();

  runLiveHighlightChecks();
  runSourceChecks();

  console.log(failures === 0 ? "\nALL CODE CHECKS PASSED" : `\n${failures} CODE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

/* --- live highlighting ----------------------------------------------------- */

function runLiveHighlightChecks() {
  console.log("\n=== the caret survives being recoloured ===");
  {
    const root = fixture("<pre><code></code></pre>");
    const code = root.querySelector("code");
    const source = "const answer = 42;\nfunction go() { return answer; }";
    code.textContent = source;

    putCaret(code, 10);
    const painted = Core.liveHighlightCode(code, "js");

    check("the block is coloured", painted, true);
    check("...by actually rewriting the markup", code.querySelectorAll("span.hljs-keyword").length > 0, true);
    check("...without changing a character of the code", code.textContent, source);
    check("...and the caret has not moved", caretAt(code), { start: 10, length: 0 });

    // A selection has two ends and both of them matter. The text is changed
    // first and the selection made after, the way typing does it — assigning
    // textContent throws the caret away by itself, which would be a test
    // measuring jsdom rather than the code.
    code.textContent = `${source}\nconst other = 1;`;
    putCaret(code, 6, 12);
    check("a selection survives too", Core.liveHighlightCode(code, "js") && caretAt(code), { start: 6, length: 6 });

    root.remove();
  }

  console.log("=== work that is not needed is not done ===");
  {
    const root = fixture("<pre><code></code></pre>");
    const code = root.querySelector("code");
    code.textContent = "const a = 1;";

    hljsCalls.highlight = 0;
    Core.liveHighlightCode(code, "js");
    check("the first pass colours it", hljsCalls.highlight, 1);

    // Arrow keys, clicks, a language field being retyped to the same thing.
    Core.liveHighlightCode(code, "js");
    Core.liveHighlightCode(code, "js");
    check("passes over unchanged text cost nothing", hljsCalls.highlight, 1);
    check("...and still report the block as coloured", Core.liveHighlightCode(code, "js"), true);

    code.textContent = "const a = 2;";
    Core.liveHighlightCode(code, "js");
    check("a real edit is coloured", hljsCalls.highlight, 2);

    root.remove();
  }

  console.log("=== the language is settled once, never re-guessed ===");
  {
    const root = fixture("<pre><code></code></pre>");
    const code = root.querySelector("code");

    hljsCalls.auto = 0;
    code.textContent = "const alpha = 1; function beta() { return alpha; }";
    check("an untagged block is worked out", Core.liveHighlightCode(code, ""), true);
    check("...by asking the detector once", hljsCalls.auto, 1);

    for (let i = 0; i < 20; i += 1) {
      code.textContent += `\nconst extra${i} = ${i};`;
      Core.liveHighlightCode(code, "");
    }

    check("...and never asking again as it is typed", hljsCalls.auto, 1);
    check("the settled language is on the element", code.classList.contains("language-javascript"), true);

    // Naming the fence overrules whatever was worked out, and the old class
    // goes with it rather than piling up.
    Core.liveHighlightCode(code, "python");
    const languageClasses = [...code.classList].filter((name) => name.startsWith("language-"));
    check("renaming the fence swaps the language", languageClasses, ["language-python"]);

    root.remove();
  }

  console.log("=== a guess it is not sure of is refused ===");
  {
    const root = fixture("<pre><code></code></pre>");
    const code = root.querySelector("code");

    hljsCalls.auto = 0;
    code.textContent = "a block of ordinary prose with no code in it at all";
    check("a low-relevance guess leaves the block alone", Core.liveHighlightCode(code, ""), false);
    check("...having asked once", hljsCalls.auto, 1);

    // The expensive call must not run again on the very next keystroke.
    code.textContent += " and";
    Core.liveHighlightCode(code, "");
    code.textContent += " more";
    Core.liveHighlightCode(code, "");
    check("...and not again on the next keystrokes", hljsCalls.auto, 1);

    code.textContent += ` ${"x".repeat(70)}`;
    Core.liveHighlightCode(code, "");
    check("...but again once the block has really grown", hljsCalls.auto, 2);

    root.remove();
  }

  console.log("=== a block too big to paint keeps the old behaviour ===");
  {
    const root = fixture("<pre><code></code></pre>");
    const code = root.querySelector("code");

    hljsCalls.highlight = 0;
    code.textContent = `const a = 1;\n${"x".repeat(20001)}`;
    check("an enormous block is left to the on-blur pass", Core.liveHighlightCode(code, "js"), false);
    check("...without paying for a pass first", hljsCalls.highlight, 0);

    code.textContent = "   \n  ";
    check("an empty block has nothing to colour", Core.liveHighlightCode(code, "js"), false);

    root.remove();
  }
}

/* --- the wiring ------------------------------------------------------------ */

function runSourceChecks() {
  console.log("\n=== the whole document can be taken away too ===");
  check("the toolbar has a copy button", html.includes('id="copyDocBtn"'), true);
  check("...that says it copies markdown",
    /id="copyDocBtn"[\s\S]{0,200}Copy this document as markdown/.test(html), true);
  check("...and is off until a document is open",
    /elements\.copyDocBtn\.disabled = !fileName;/.test(app), true);
  check("it copies the source, not the rendering",
    /MarkdownCore\.copyText\(markdown\)/.test(app), true);
  check("...read from the cache the page was rendered from",
    /state\.contentCache\.get\(file\)\?\.content/.test(app), true);
  check("a document deleted from the library can still be copied",
    /state\.isRecycleBinMode[\s\S]{0,80}loadDeletedDocContent\(file\)/.test(app), true);

  console.log("=== the clipboard is asked for in both ways ===");
  // navigator.clipboard does not exist off a secure origin, and this app is
  // usually reached at http://<lan-address>:4321.
  check("the modern path is tried first", /isSecureContext && global\.navigator\?\.clipboard\?\.writeText/.test(core), true);
  check("...and the older one catches a refusal", /\.catch\(\(\) => \{\s*\n[\s\S]{0,200}copyByExecCommand\(value\)/.test(core), true);
  check("...and stands alone on an insecure origin",
    core.indexOf("if (copyByExecCommand(value)) {") > core.indexOf("isSecureContext"), true);
  check("the reader's own selection is put back afterwards",
    /selection\.addRange\(previous\);/.test(core), true);
  check("the share link uses the same two paths",
    /MarkdownCore\.copyText\(elements\.shareUrlInput\.value\)/.test(app), true);

  console.log("=== the copy button rides the render, not the download ===");
  const decorate = core.slice(core.indexOf("function decorateCodeBlocks"));
  check("colouring and copying happen in one pass after a render",
    /addCopyButtons\(root\);\s*\n\s*return highlightCodeBlocks\(root\);/.test(decorate), true);
  check("...with the button attached before the highlighter is even asked for",
    decorate.indexOf("addCopyButtons(root)") < decorate.indexOf("highlightCodeBlocks(root)"), true);
  check("the app's render path goes through it",
    /function highlightCodeBlocks\(root\) \{\s*\n\s*return MarkdownCore\.decorateCodeBlocks\(root\);/.test(app), true);

  console.log("=== typing decides when, not whether ===");
  const codeBlock = app.slice(app.indexOf("function renderCodeBlock"), app.indexOf("function renderEmbedBlock"));
  check("a pause, not a keystroke", /const LIVE_HIGHLIGHT_DELAY = \d+;/.test(app), true);
  check("...applied to every edit", /code\.addEventListener\("input", \(\) => \{[\s\S]{0,120}schedulePaint\(\);/.test(codeBlock), true);
  check("...and to naming the language", /fenceState\.info = language\.value\.trim\(\);[\s\S]{0,200}schedulePaint\(\);/.test(codeBlock), true);
  check("a pending pass is dropped before a new one is queued",
    /const schedulePaint = \(\) => \{\s*\n\s*window\.clearTimeout\(paintTimer\);/.test(codeBlock), true);

  // Replacing the markup under a composition cancels the word being composed.
  check("nothing is repainted mid-composition", /if \(composing \|\| !code\.isConnected\)/.test(codeBlock), true);
  check("...and composing suspends a queued pass",
    /compositionstart[\s\S]{0,140}window\.clearTimeout\(paintTimer\)/.test(codeBlock), true);
  check("...and finishing one resumes it",
    /compositionend[\s\S]{0,120}schedulePaint\(\)/.test(codeBlock), true);
  // A block from a document that has since been re-rendered.
  check("a pass on a discarded block is not paid for", /!code\.isConnected/.test(codeBlock), true);

  check("the 60KB highlighter is fetched when the caret arrives, not before",
    /code\.addEventListener\("focus", \(\) => \{\s*\n\s*void MarkdownCore\.loadHighlighter\(\);/.test(codeBlock), true);
  check("leaving the block only rebuilds it when the live pass would not have",
    /if \(paintNow\(\)\) \{\s*\n\s*return;\s*\n\s*\}/.test(codeBlock), true);

  console.log("=== the button stays put and stays visible ===");
  const wrapper = css.slice(css.indexOf(".code-block {"));
  check("the wrapper is what the button is positioned against",
    /\.code-block \{\s*\n\s*position: relative;/.test(wrapper), true);
  check("...so a block that scrolls sideways does not carry it off",
    /\.code-copy \{[\s\S]*?position: absolute;/.test(wrapper), true);
  check("the wrapper adds no margin of its own",
    /\.code-block \{[^}]*margin/.test(wrapper), false);
  check("it appears on hover", /\.code-block:hover \.code-copy/.test(css), true);
  check("...and to the keyboard", /\.code-copy:focus-visible/.test(css), true);
  check("...and always, where nothing hovers",
    /@media \(hover: none\) \{\s*\n\s*\.code-copy \{\s*\n\s*opacity: 1;/.test(css), true);
  check("a copied button is not hidden again by the pointer leaving",
    /\.code-copy\.is-copied,\s*\n\s*\.code-copy\.is-failed \{\s*\n\s*opacity: 1;/.test(css), true);
  check("success and failure do not look the same",
    /\.code-copy\.is-copied \{[\s\S]*?var\(--success\)/.test(css) && /\.code-copy\.is-failed \{[\s\S]*?var\(--danger\)/.test(css), true);

  const print = css.slice(css.indexOf("@media print"));
  check("it is not printed", print.split("display: none")[0].includes(".code-copy"), true);
}
