/* Taking a copy away: the parts of it that are not a browser.
 *
 * Every format starts from one self-contained HTML file, and most of what can
 * go wrong with that happens before any of it is on screen — a print rule
 * that inverts the page it was supposed to copy, a font that is carried when
 * it should not be, a zip whose central directory says the wrong thing and
 * which Word therefore declines to open.
 *
 * What a copy looks like next to the page it came from is checked in a real
 * browser, because that is the only place the question can be asked.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const { createChecker } = require("./helpers/check.js");
const { CSP_DIRECTIVES } = require("../lib/http/headers");

const { check, finish } = createChecker("EXPORT");
const ROOT = path.join(__dirname, "..", "public", "js");

// Plain scripts whose top-level `var` is the namespace, run the way a page
// runs them. Neither touches the document until it is called.
global.window = /** @type {any} */ (globalThis);
for (const file of ["export/snapshot.js", "export/formats.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
}

const Snapshot = globalThis.ExportSnapshot;
const Formats = globalThis.ExportFormats;

console.log("=== the app's print rules are not part of a copy ===");

/* They exist to make a document readable on paper: they invert the dark
 * palette and drop the backgrounds. That is right for File > Print and wrong
 * for an export, whose whole job is to look like the screen.
 */
const sheet = [
  "a{color:red}",
  "@media print{body{background:#fff !important}}",
  "@media (prefers-reduced-motion: reduce){.y{transition:none}}",
  "b{color:blue}"
].join("");

check("a print block is taken out", Snapshot.withoutPrintRules(sheet).includes("@media print"), false);
check("...and everything either side of it is kept",
  Snapshot.withoutPrintRules(sheet), "a{color:red}@media (prefers-reduced-motion: reduce){.y{transition:none}}b{color:blue}");
check("another media query is not a print rule",
  Snapshot.withoutPrintRules("@media (max-width: 40em){.a{color:red}}").includes("color:red"), true);
check("a nested block inside a print rule goes with it",
  Snapshot.withoutPrintRules("@media print{@supports (x:y){.a{color:red}}}.b{color:blue}"), ".b{color:blue}");

// `content: "}"` is legal CSS, and a scanner that counts braces without
// stepping over strings ends the block there and eats the rest of the sheet.
check("a brace inside a string does not end the block early",
  Snapshot.withoutPrintRules('@media print{.x{content:"}"}}.after{color:red}'), ".after{color:red}");
check("...nor does an escaped quote",
  Snapshot.withoutPrintRules('@media print{.x{content:"\\"}"}}.after{color:red}'), ".after{color:red}");
check("a stylesheet with no print rules is returned as it was",
  Snapshot.withoutPrintRules("a{color:red}"), "a{color:red}");

console.log("=== a stylesheet that has moved takes its references with it ===");

check("a relative url becomes absolute",
  Snapshot.absoluteUrls('a{background:url(x/y.png)}', "https://cdn.example/css/app.css"),
  'a{background:url("https://cdn.example/css/x/y.png")}');
check("...and so does one that climbs out of its folder",
  Snapshot.absoluteUrls('a{background:url("../img/y.png")}', "https://cdn.example/css/app.css"),
  'a{background:url("https://cdn.example/img/y.png")}');
check("a data uri is left exactly alone",
  Snapshot.absoluteUrls("a{background:url(data:image/png;base64,AAA)}", "https://cdn.example/css/app.css"),
  "a{background:url(data:image/png;base64,AAA)}");
check("an absolute url is left alone too",
  Snapshot.absoluteUrls('a{background:url("https://other.example/y.png")}', "https://cdn.example/css/app.css"),
  'a{background:url("https://other.example/y.png")}');

console.log("=== which fonts are worth carrying ===");

/* A webfont arrives as dozens of subsets. Embedding all of them made a four
 * megabyte export of a document containing no Greek, no Cyrillic and no
 * Vietnamese — and ran the tab out of memory building the string.
 */
const face = (extra) => `@font-face{font-family:'Inter';src:url(a.woff2) format('woff2');${extra}}`;

check("the Latin subset is carried",
  Snapshot.worthEmbedding(face("unicode-range:U+0000-00FF,U+0131,U+0152-0153;")), true);
check("the Cyrillic one is not",
  Snapshot.worthEmbedding(face("unicode-range:U+0301,U+0400-045F,U+0490-0491;")), false);
check("the Vietnamese one is not",
  Snapshot.worthEmbedding(face("unicode-range:U+0102-0103,U+1EA0-1EF9,U+20AB;")), false);
check("a face that does not say is carried, since it may be the only one",
  Snapshot.worthEmbedding(face("")), true);
check("an icon font is not: the document has no icons in it",
  Snapshot.worthEmbedding("@font-face{font-family:Phosphor;src:url(p.woff2) format('woff2')}"), false);

console.log("=== the page the copy is laid out on ===");

const box = { width: 1200, height: 3000, inset: 166, bodyWidth: 868 };
const styles = Snapshot.pageStyles(box, "dark");

// A sheet the width of the page on screen, because anything else reflows the
// text — and ink drawn over a paragraph is drawn at a position, not at a word.
check("the sheet is as wide as the page was", styles.includes("size: 1200px"), true);
check("...and in A4's proportions", styles.includes("1697px"), true);
check("the document sits where it sat", styles.includes("margin-left: 166px"), true);
check("...at the width it had", styles.includes("width: 868px"), true);
check("the ink is laid over the whole page", styles.includes("height: 3000px"), true);
check("colours are printed rather than dropped", styles.includes("print-color-adjust: exact"), true);
check("the theme goes with it", Snapshot.pageStyles(box, "light").includes("color-scheme: light"), true);

console.log("=== what a document is called when it lands in a folder ===");

check("the extension is replaced, not appended", Formats.fileStem("notes.md"), "notes");
check("a path becomes one name", Formats.fileStem("Linear Algebra/Vectors.md"), "Linear Algebra-Vectors");
check("a name with nothing usable in it still has a name", Formats.fileStem("///"), "document");
check("nothing at all is still a name", Formats.fileStem(""), "document");
check("the characters a filesystem refuses are taken out",
  Formats.fileStem('a:b*c?d"e<f>g|h.md'), "a-b-c-d-e-f-g-h");
check("a dot inside the name is not an extension", Formats.fileStem("v1.2 notes.md"), "v1.2 notes");

console.log("=== the zip a .docx is ===");

// The check value every CRC-32 implementation is measured against.
check("crc32 agrees with the rest of the world",
  Formats.crc32(new TextEncoder().encode("123456789")).toString(16), "cbf43926");

const zip = Formats.zipOf([
  ["[Content_Types].xml", "<Types/>"],
  ["word/document.xml", "<w:document/>"],
  ["word/page.html", "<p>hello</p>"]
]);

const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
const u16 = (at) => view.getUint16(at, true);
const u32 = (at) => view.getUint32(at, true);

check("it begins with a local file header", u32(0), 0x04034B50);

/* The end record is what a reader opens first: it says how many entries there
 * are and where the directory listing them starts. Get either wrong and the
 * file is not a zip at all, which is the whole of "Word cannot open this".
 */
const end = zip.length - 22;
check("it ends with the end-of-central-directory record", u32(end), 0x06054B50);
check("...counting every entry", u16(end + 10), 3);
check("...and the directory is where it says it is", u32(u32(end + 16)), 0x02014B50);
check("...and as long as it says it is",
  u32(end + 16) + u32(end + 12), end);

// Names are UTF-8, which a zip has to say out loud: without the flag a reader
// is entitled to decode them in whatever code page it is running under.
check("the name is marked UTF-8", (u16(6) & 0x0800) !== 0, true);
check("nothing is compressed, which is a thing a zip may choose", u16(8), 0);

const decoder = new TextDecoder();
const firstName = decoder.decode(zip.subarray(30, 30 + u16(26)));
check("the first entry is the one Word looks for", firstName, "[Content_Types].xml");
check("...and its bytes are there, uncompressed",
  decoder.decode(zip.subarray(30 + u16(26), 30 + u16(26) + u32(18))), "<Types/>");
check("...under a checksum that matches them",
  u32(14), Formats.crc32(new TextEncoder().encode("<Types/>")));

check("an empty zip is still a zip", Formats.zipOf([]).length, 22);

console.log("=== an export may fetch what the pages already load ===");

/* The quiet failure this catches.
 *
 * A copy is built by reading this page's own stylesheets and carrying them
 * into one file. Fetching them is an XHR, so it is connect-src that decides —
 * and connect-src did not name the font CDN that style-src and font-src both
 * did. The export was refused the font stylesheet, said nothing, and produced
 * documents set in whatever the machine that opened them happened to have.
 *
 * So: every origin a page loads a stylesheet from has to be an origin the
 * export is allowed to fetch from. Add a CDN to a page and forget this, and
 * this check is what says so.
 */
const publicDir = path.join(__dirname, "..", "public");
const connectSrc = CSP_DIRECTIVES.match(/connect-src([^;]*)/)[1];

const styleOrigins = new Set();
for (const page of ["index.html", "share.html", "error.html", "diagram.html"]) {
  const html = fs.readFileSync(path.join(publicDir, page), "utf8");
  for (const [, href] of html.matchAll(/<link[^>]*\shref="(https:\/\/[^"]+)"/g)) {
    styleOrigins.add(new URL(href).origin);
  }
}

check("the pages do load stylesheets from somewhere else", styleOrigins.size > 0, true);
check("...and the export is allowed to fetch every one of them",
  [...styleOrigins].filter((origin) => !connectSrc.includes(origin)), []);
console.log(`  (${[...styleOrigins].join(", ")})`);

// And the frame the PDF is printed in, which default-src would otherwise
// refuse: a page's only way to make a PDF is to print one.
check("a blob may be framed, which is how the PDF is printed",
  /frame-src [^;]*blob:/.test(CSP_DIRECTIVES), true);

console.log("=== what Word is given instead of an SVG ===");

/* Word's HTML importer does not know what an inline <svg> is: it drops it,
 * and a document full of diagrams arrives full of holes. These are the two
 * measurements that decide what gets drawn to a canvas instead.
 */
const dom = new JSDOM(`<body><article>
  <p>before</p>
  <span class="katex"><span class="katex-mathml">x squared</span><span class="katex-html">x<sup>2</sup></span></span>
  <svg id="big" width="200" height="120"></svg>
  <svg id="rule" width="16" height="0.016"></svg>
</article></body>`);

const { document: page } = dom.window;
const article = page.querySelector("article");

// jsdom lays nothing out, so the boxes are the ones under test rather than
// ones it measured: a big diagram, and KaTeX's fraction bar.
const boxes = { big: { width: 200, height: 120 }, rule: { width: 16, height: 0.256 } };
for (const svg of article.querySelectorAll("svg")) {
  svg.getBoundingClientRect = () => boxes[svg.id];
}

const copy = /** @type {any} */ (article.cloneNode(true));
Snapshot.recordSvgSizes(article, copy);

const sizeOf = (id) => {
  const svg = copy.querySelector(`#${id}`);
  return [svg.dataset.exportW, svg.dataset.exportH];
};

check("a diagram is recorded at the size it is shown at", sizeOf("big"), ["200", "120"]);
// KaTeX draws a fraction bar as an SVG a sixtieth of an em tall. Rounded, it
// is nothing, and something measured as nothing is skipped — which took the
// bar out of every fraction in the document.
check("a hairline rule is recorded as a pixel rather than as nothing", sizeOf("rule"), ["16", "1"]);

/* KaTeX writes every formula twice: MathML for a screen reader, and the spans
 * that are actually shown, with the first hidden by a clip rectangle. Word
 * ignores the clip and renders both.
 */
check("the hidden MathML is there to start with", copy.querySelectorAll(".katex-mathml").length, 1);
Snapshot.dropHiddenMath(copy);
check("...and is dropped, so Word does not show every formula twice",
  copy.querySelectorAll(".katex-mathml").length, 0);
check("...while the formula that is shown stays",
  copy.querySelector(".katex-html").textContent, "x2");

Snapshot.forgetSvgSizes(copy);
check("the measurements do not travel with the copy",
  copy.querySelectorAll("[data-export-w]").length, 0);

process.exit(finish());
