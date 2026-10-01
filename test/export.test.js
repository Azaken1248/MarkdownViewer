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
for (const file of ["export/paginate.js", "export/snapshot.js", "export/formats.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
}

const Snapshot = globalThis.ExportSnapshot;
const Paginate = globalThis.ExportPaginate;
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

const inked = {
  width: 868, height: 3000, inset: 0, bodyWidth: 868, hasInk: true,
  inkLeft: -266, inkTop: 0, surfaceWidth: 1400, surfaceHeight: 3000
};
const styles = Snapshot.pageStyles(inked, "dark");

/* On paper it is A4, because a sheet the width of somebody's browser window
 * is paper nobody has — and a print dialogue asked to fit an unusual page box
 * onto real paper will cut the sides off it.
 */
check("the sheet is A4", styles.includes("size: A4"), true);
check("...with margins, rather than text running into the edge",
  /margin: 14mm 12mm/.test(styles), true);

/* With ink on it the document is scaled, not reflowed: a stroke is at a
 * position, so the moment a line breaks differently the ink is over the wrong
 * word. 868px into 186mm of printable width is 0.81.
 */
check("a page with ink on it is scaled to fit", styles.includes("zoom: 0.81"), true);
check("...and is not reflowed", styles.includes("width: auto;\n  }"), false);
check("the document sits where it sat", styles.includes("margin-left: 0px"), true);
check("the ink keeps the coordinates it was drawn in",
  styles.includes("left: -266px") && styles.includes("width: 1400px"), true);

/* Without ink there is nothing positioned over the words, so the words may
 * move — and should: scaling a reading pane the width of a monitor came out
 * at seven point, which is a picture of a document rather than a document.
 */
const flowed = { ...inked, width: 1220, bodyWidth: 1220, hasInk: false, inkLeft: 0 };
const flowedStyles = Snapshot.pageStyles(flowed, "dark");
check("a page with no ink is set to the paper instead", flowedStyles.includes("width: auto;"), true);
check("...rather than shrunk", /zoom:/.test(flowedStyles), false);

check("a narrow document is never magnified to fill the page", Snapshot.fitToPage(400), 1);
check("...and a wide one is scaled by exactly what it takes",
  Snapshot.fitToPage(1406), 0.5);

check("colours are printed rather than dropped", styles.includes("print-color-adjust: exact"), true);
check("the theme goes with it", Snapshot.pageStyles(inked, "light").includes("color-scheme: light"), true);

// The breaks that make a printed document look like it was printed by
// accident: a heading at the foot of a page, one line of a paragraph on its
// own, a table row split down the middle.
for (const rule of ["break-after: avoid", "orphans: 3", "widows: 3", "table-header-group"]) {
  check(`the print rules say ${rule}`, styles.includes(rule), true);
}
check("a line that introduces a block stays with it",
  styles.includes("p:has(+ .katex-display)"), true);

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

console.log("=== where the pages end ===");

/* The browser paginates by one rule: fill the box, then cut. It does not know
 * that a heading belongs with what follows it, so it cuts in the middle of
 * sections, tables and worked examples. These are the rules that replace it,
 * as arithmetic over a list of boxes — which is where they can be argued with
 * without a browser in the room.
 */
const PAGE = 1000;

// A document as a list of blocks: each `[height, isHeading]`, stacked.
function stack(blocks) {
  let at = 0;
  return blocks.map(([height, heading = false]) => {
    const box = { top: at, bottom: at + height, heading, atomic: false };
    at += height;
    return box;
  });
}

check("a document that fits is one page",
  Paginate.pageStarts(stack([[200], [300], [400]]), PAGE), [0]);
check("nothing at all is still one page", Paginate.pageStarts([], PAGE), [0]);

// With no heading to aim at, the cut goes between two blocks — never inside
// one, which is the whole difference from letting the browser do it.
check("without a heading it breaks before the block that does not fit",
  Paginate.pageStarts(stack([[400], [400], [400], [400]]), PAGE), [0, 2]);

/* A heading in the last quarter of the page is where a reader expects the
 * page to end, so the page ends there even though more would have fitted.
 */
const atTheFoot = stack([[300], [300], [200], [100, true], [400]]);
check("a heading near the foot of the page ends it", Paginate.pageStarts(atTheFoot, PAGE), [0, 3]);
check("...and it is the heading that starts the next page, not what came before it",
  atTheFoot[3].heading, true);

// A heading higher up the page is not worth losing a third of a sheet for.
check("a heading early in the page is left where it is",
  Paginate.pageStarts(stack([[200], [100, true], [400], [400], [400]]), PAGE), [0, 3]);

/* A block taller than any page cannot be cut and cannot be fitted: it gets a
 * page of its own, and the layout shrinks it to fit. What must not happen is
 * the loop failing to move on.
 */
const huge = Paginate.pageStarts(stack([[300], [2400], [300]]), PAGE);
check("a block taller than a page gets a page of its own", huge, [0, 1, 2]);
check("...and the pagination still ends", huge.length < 10, true);

/* The reach is a preference. This is not: a heading at the foot of a page is
 * a title for a blank space, and the reader turns over to find the section
 * starting again with no name on it.
 */
const stranded = stack([[300], [300], [150, true], [400], [400]]);
check("a heading is never the last thing on a page",
  Paginate.pageStarts(stranded, PAGE).every((start, i, all) => {
    const last = (i + 1 < all.length ? all[i + 1] : stranded.length) - 1;
    return !stranded[last].heading;
  }), true);
check("...even when it falls just outside the reach", Paginate.pageStarts(stranded, PAGE), [0, 2]);

const twoTitles = stack([[600], [100, true], [100, true], [400]]);
check("two headings in a row move to the next page together",
  Paginate.pageStarts(twoTitles, PAGE), [0, 1]);

check("every page starts after the one before it",
  Paginate.pageStarts(stack([[400], [400], [400], [400], [400], [400]]), PAGE)
    .every((start, i, all) => i === 0 || start > all[i - 1]), true);

/* How far up the page a heading may be and still be worth ending on. Too
 * narrow and a section starts three lines from the foot of a page; too wide
 * and a page ends a third of the way down.
 */
const nearly = stack([[300], [400], [100, true], [150], [400]]);
check("a wide reach ends the page at a heading two thirds down",
  Paginate.pageStarts(nearly, PAGE, 0.4), [0, 2]);
check("...and a narrow one fills the page instead",
  Paginate.pageStarts(nearly, PAGE, 0.05), [0, 4]);

process.exit(finish());
