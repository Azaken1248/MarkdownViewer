/* The render pipeline, with the real marked and the real DOMPurify.
 *
 * Every other suite stands marked in with the two functions it needs, which is
 * right for what those suites are about and means none of them has ever run
 * the library the pages actually load. Two things here need the real one.
 *
 * Heading anchors. `headerIds: true` sat in the options for as long as they
 * have existed and did nothing — marked removed the option, so it was accepted
 * and ignored, and every document this app rendered had no id on any heading.
 * No deep link to a section, and nothing for the outline to point at. The
 * renderer writes the anchor itself now, and a stub cannot check that.
 *
 * And the maths markers, which have to survive being passed through marked as
 * inline HTML. That is the assumption the whole fix rests on.
 *
 * marked is a devDependency pinned to the version the pages load, the same
 * arrangement the sanitizer suite has with DOMPurify, and the first check is
 * that the two versions agree — testing a different marked than ships is
 * testing something else.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");
const { marked } = require("marked");
const { cdnPins } = require("../tools/cdn-pins.js");
const { loadScript } = require("./app-source.js");
const { createChecker } = require("./helpers/check.js");

const { check, finish } = createChecker("MARKDOWN");
const ROOT = path.join(__dirname, "..");

console.log("=== the library under test is the library the pages load ===");

const pinned = cdnPins().find((one) => one.name === "marked");
const installed = JSON.parse(
  fs.readFileSync(path.join(ROOT, "node_modules", "marked", "package.json"), "utf8")).version;

check("the pages pin exactly one marked", pinned.versions.length, 1);
check("...and the devDependency is that one", installed, pinned.versions[0]);

/* The engine, in a window, with the real libraries in it. */
const { window } = new JSDOM("", { url: "https://example.test/", runScripts: "outside-only" });
window.marked = marked;
window.DOMPurify = createDOMPurify(window);
// jsdom does not put these in the window; the engine base64s its maths with
// them, the same way the DOM suites hand them over.
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;

// Evaluated in the window, the way a page loads them, so each module's
// top-level `var` becomes the namespace the next one reads.
for (const file of ["dom-html.js", "doc-kinds.js", "md/lazy.js", "md/text.js"]) {
  loadScript(window, path.join(ROOT, "public", "js", file));
}

const render = (markdown) => window.MdText.renderMarkdown(markdown);
const idsIn = (html) => {
  const box = window.document.createElement("div");
  box.innerHTML = html;
  return [...box.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((node) => node.id);
};

console.log("=== every heading gets an anchor ===");

check("one per heading", idsIn(render("# One\n\n## Two\n\n### Three\n")), ["one", "two", "three"]);
check("...surviving the sanitizer, which is the half that is not obvious",
  /<h1 id="one"/.test(render("# One\n")), true);

check("punctuation is dropped rather than encoded",
  idsIn(render("## A. Groups & Fields\n")), ["a-groups-fields"]);
check("spaces become one dash, however many there were",
  idsIn(render("## Lots    of     space\n")), ["lots-of-space"]);
check("a heading of nothing but punctuation still has somewhere to point",
  idsIn(render("## ???\n")), ["section"]);
check("letters that are not English keep their anchor",
  idsIn(render("## Ελληνικά\n")), ["ελληνικά"]);

/* Two headings with the same words are the common case in a document of
 * worked examples, and a link that goes to the first of three "Examples" is a
 * link that is wrong twice.
 */
check("repeated headings get different anchors",
  idsIn(render("## Example\n\n## Example\n\n## Example\n")),
  ["example", "example-1", "example-2"]);

// The count starts again with each document, or the second document opened
// would number its headings from wherever the first one stopped.
render("## Example\n\n## Example\n");
check("...and the numbering starts again for the next document",
  idsIn(render("## Example\n")), ["example"]);

check("inline formatting in a heading is rendered, not put in the anchor",
  render("## A **bold** word\n").includes("<strong>bold</strong>"), true);

console.log("=== and the maths markers pass through untouched ===");

const withMath = render("A vector $\\alpha$ and a matrix.\n");
check("an inline marker survives marked", /class="math-inline"/.test(withMath), true);
check("...with its TeX still base64 in the attribute",
  /data-math-tex="[A-Za-z0-9+/=]+"/.test(withMath), true);

const display = render("$$\nx = 1\n$$\n");
check("a display marker survives too", /class="math-block"/.test(display), true);

/* The whole fix rests on this: markdown never sees the TeX, so it cannot
 * apply its own escaping to it. `\\` and `\{` are what it used to eat.
 */
const hard = render("Set $W = \\left\\{ \\begin{bmatrix} 0 & 0 \\\\ y & 0 \\end{bmatrix} \\right\\}$.\n");
const box = window.document.createElement("div");
box.innerHTML = hard;
const tex = Buffer.from(
  box.querySelector(".math-inline").getAttribute("data-math-tex"), "base64").toString("utf8");
check("the TeX marked would have eaten arrives intact",
  tex, "W = \\left\\{ \\begin{bmatrix} 0 & 0 \\\\ y & 0 \\end{bmatrix} \\right\\}");

check("and a dollar in a code span is still code",
  render("Code `$x$` here.\n").includes("<code>$x$</code>"), true);

process.exit(finish());
