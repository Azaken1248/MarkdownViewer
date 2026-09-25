/* The sanitizer, run for real.
 *
 * Every rendered document goes through DOMPurify, and until this file nothing
 * ran it: all six suites that touch rendering stub it with
 * `{ sanitize: (html) => html }`, which is right for what they are testing and
 * means the app's whole defence against a document that carries a script was
 * never once exercised. The configuration was three lines nobody had proved
 * anything about.
 *
 * DOMPurify is a devDependency here purely so this can run. The browser loads
 * it from a CDN, pinned and SRI-checked, and the two versions have to be the
 * same version or this is testing something the app does not use — which is
 * the first check below.
 *
 * The options themselves are read out of md/lazy.js rather than written again
 * here, for the same reason: a copy of a sanitizer configuration is a copy
 * that can be right while the real one is wrong.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const { cdnPins } = require("../tools/cdn-pins.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("SANITIZER");
const ROOT = path.join(__dirname, "..");

console.log("=== the version under test is the version the browser loads ===");

const pinned = cdnPins().find((one) => one.name === "dompurify");
const installed = JSON.parse(
  fs.readFileSync(path.join(ROOT, "node_modules", "dompurify", "package.json"), "utf8")).version;

check("the pages pin exactly one DOMPurify", pinned.versions.length, 1);
check("...and the devDependency is that one", installed, pinned.versions[0]);

/* The app's own options, taken from the file that holds them.
 *
 * md/lazy.js is a browser script: it declares `var MdLazy` and reads `window`,
 * so it is evaluated in a window rather than required.
 */
// outside-only, so window.eval runs the script in the window's scope: the
// file declares `var MdLazy` and reads globals, exactly as a page loads it.
const { window } = new JSDOM("", { url: "https://example.test/", runScripts: "outside-only" });
// lazy.js configures marked as it loads. What is wanted out of it is the
// sanitizer options, so marked only has to be there.
window.marked = { setOptions() {}, parse: (text) => String(text) };
window.eval(fs.readFileSync(path.join(ROOT, "public", "js", "md", "lazy.js"), "utf8"));
const OPTIONS = window.MdLazy.MARKDOWN_SANITIZE_OPTIONS;

check("the options came from the app, not from here",
  Object.keys(OPTIONS).sort(), ["ADD_DATA_URI_TAGS", "ALLOWED_URI_REGEXP"]);

const purify = createDOMPurify(window);
// String(), because the typings say sanitize may hand back a TrustedHTML.
// It does that only under RETURN_TRUSTED_TYPE, which these options do not set.
const clean = (markup) => String(purify.sanitize(markup, OPTIONS));

console.log("=== a document cannot bring its own code ===");

// Each of these is a way somebody has actually delivered script through
// markdown that reached a renderer. What is asserted is that nothing
// executable survives, not the exact shape of what is left.
const REFUSED = [
  ["a script tag", "<script>alert(1)</script>"],
  ["...even split across an attribute", '<img src=x onerror="alert(1)">'],
  ["an inline handler on a normal tag", '<p onclick="steal()">t</p>'],
  ["a javascript: link", '<a href="javascript:alert(1)">x</a>'],
  ["...spelled with a newline in it", '<a href="java\nscript:alert(1)">x</a>'],
  ["an iframe", '<iframe src="https://evil.test"></iframe>'],
  ["an object", '<object data="https://evil.test"></object>'],
  ["an embed", '<embed src="https://evil.test">'],
  ["a style tag", "<style>body{display:none}</style>"],
  ["an svg with a script in it", "<svg><script>alert(1)</script></svg>"],
  ["an animated attribute", '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>'],
  ["a data: document dressed as an image", '<img src="data:text/html,<script>alert(1)</script>">'],
  ["a base tag that moves every relative link", '<base href="https://evil.test/">']
];

for (const [label, markup] of REFUSED) {
  const out = clean(markup);
  const dangerous = /<script|<iframe|<object|<embed|<form|<base|<style|\son[a-z]+\s*=|javascript:/i.test(out);
  check(label, dangerous, false);
}

console.log("=== and the markdown this app renders comes through ===");

// The other half: a sanitizer that removes everything is also wrong. These are
// the constructs the renderer and the stylesheet depend on.
const KEPT = [
  ["text and emphasis", "<p>hello <em>there</em> and <strong>you</strong></p>", "<em>"],
  ["headings with their ids", '<h2 id="a-heading">A heading</h2>', 'id="a-heading"'],
  ["links that go somewhere real", '<a href="https://example.com">ok</a>', 'href="https://example.com"'],
  ["relative links to other documents", '<a href="/docs/other.md">ok</a>', 'href="/docs/other.md"'],
  ["mailto links", '<a href="mailto:a@b.test">mail</a>', "mailto:"],
  ["images served by this app", '<img src="/api/assets/deadbeef.png" alt="a">', "/api/assets/"],
  ["inline images a paste produced", '<img src="data:image/png;base64,AAAA">', "data:image/png"],
  ["tables", "<table><tr><td>cell</td></tr></table>", "<td>"],
  ["code blocks, with the language the highlighter reads",
    '<pre><code class="language-js">let a = 1;</code></pre>', 'class="language-js"'],
  ["task list checkboxes", '<input type="checkbox" checked disabled>', 'type="checkbox"'],
  ["the class a mermaid block is found by", '<div class="mermaid-block">graph TD</div>', "mermaid-block"],
  ["blockquotes and lists", "<blockquote><ul><li>one</li></ul></blockquote>", "<li>"]
];

for (const [label, markup, wanted] of KEPT) {
  check(label, clean(markup).includes(wanted), true);
}

console.log("=== what the sanitizer lets through, and what stops it instead ===");

/* Three things survive that look at first like they should not. Each is
 * written down here because the answer is "something else stops it", and a
 * reader who works that out for themselves has to work it out again next time.
 */

// A form. DOMPurify allows form, input and button by default, so a shared
// document can render something that looks like a sign-in box. What stops it
// going anywhere is the CSP, two layers down.
const csp = fs.readFileSync(path.join(ROOT, "lib", "http", "headers.js"), "utf8");
check("a form survives the sanitizer", clean('<form action="https://evil.test"><input name="a"></form>')
  .includes("<form"), true);
check("...and form-action 'self' is what stops it posting anywhere",
  csp.includes(`"form-action 'self'"`), true);

/* A data: URI. ADD_DATA_URI_TAGS: ["img"] is what makes a pasted image work,
 * and it allows any data: type on an <img> — the careful image-type list in
 * ALLOWED_URI_REGEXP does not gate that tag. It is not a way in: a browser
 * will not run HTML or script it was handed as an image. And on an <a>, a
 * data: image is allowed by the pattern, where a top-level navigation to
 * data: is refused by every current browser.
 *
 * Both are worth knowing rather than worth changing here: tightening the
 * sanitizer is a security decision, not a test's to make.
 */
check("a data: image is allowed on an img",
  clean('<img src="data:image/webp;base64,AA">').includes("data:image/webp"), true);
check("...and so is a data: type that is not an image, which an img cannot run",
  clean('<img src="data:text/plain,hello">').includes("data:text/plain"), true);
check("a data: image is allowed on a link, where the browser refuses the navigation",
  clean('<a href="data:image/png;base64,AA">x</a>').includes("data:image/png"), true);
check("...but a script: scheme is not, anywhere",
  clean('<a href="data:text/html,<b>x</b>">x</a>').includes("data:text/html"), false);

process.exit(finish());
