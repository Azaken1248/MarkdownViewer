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
const { JSDOM } = require("jsdom");
const { createChecker } = require("./helpers/check.js");
const { runAsScript } = require("./app-source.js");
const { CSP_DIRECTIVES } = require("../lib/http/headers");

const { check, finish } = createChecker("EXPORT");
const ROOT = path.join(__dirname, "..", "public", "js");

// Plain scripts whose top-level `var` is the namespace, run the way a page
// runs them. Neither touches the document until it is called.
global.window = /** @type {any} */ (globalThis);
for (const file of ["export/paginate.js", "export/snapshot.js", "export/pdf.js", "export/formats.js"]) {
  runAsScript(path.join(ROOT, file));
}

const Snapshot = globalThis.ExportSnapshot;
const Paginate = globalThis.ExportPaginate;
const Pdf = globalThis.ExportPdf;
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

// Nothing frames anything any more: the PDF is written here rather than
// printed through a dialogue, so the allowance that needed went back.
check("nothing may be framed", /frame-src/.test(CSP_DIRECTIVES), false);

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

console.log("=== a diagram that does not fit the page ===");

/* Mermaid draws without a viewBox, so the SVG's box is a window onto the
 * drawing rather than a frame around it: making the box smaller crops the
 * picture instead of shrinking it, which is why big diagrams arrived with
 * their bottoms cut off. Giving it the viewBox it never had turns the one
 * into the other.
 */
const svgDom = new JSDOM("<body><svg id='d'></svg></body>");
// jsdom lays nothing out, so the two measurements a diagram is taken by are
// the ones under test rather than ones it made.
const drawing = /** @type {any} */ (svgDom.window.document.getElementById("d"));

drawing.getBBox = () => ({ x: 10, y: 20, width: 300, height: 450 });
check("a diagram is measured by what it draws", Snapshot.boundsOfDrawing(drawing).viewBox, "10 20 300 450");
check("...rather than by the window it is shown through",
  [Snapshot.boundsOfDrawing(drawing).width, Snapshot.boundsOfDrawing(drawing).height], [300, 450]);

// An SVG that is not laid out has no bounds to give, and the box it sits in
// is the next best answer.
drawing.getBBox = () => {
  throw new Error("not laid out");
};
drawing.getBoundingClientRect = () => ({ width: 120, height: 80 });
check("...and the box will do when there is nothing to measure",
  Snapshot.boundsOfDrawing(drawing), { width: 120, height: 80, viewBox: null });

drawing.getBoundingClientRect = () => ({ width: 0, height: 0 });
check("a diagram with no size at all is left alone", Snapshot.boundsOfDrawing(drawing), null);

console.log("=== what is wider than the page it is printed on ===");

/* On a screen a wide formula or a wide table is given a scrollbar. Paper has
 * no scrollbar: whatever is past the edge is simply not there, and the reader
 * gets half an equation and a grey line where the rest was. A document set to
 * the width of a page rather than the width of a window has plenty of these.
 */
const wideDom = new JSDOM(`<body><div id="block">
  <div class="math-block"><span>a very long formula</span></div>
</div></body>`);

const block = wideDom.window.document.getElementById("block");
const inner = block.querySelector(".math-block");
const widths = (el, client, scroll) => {
  Object.defineProperty(el, "clientWidth", { value: client, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: scroll, configurable: true });
};

widths(block, 700, 700);
widths(inner, 700, 700);
check("a block that fits is left alone", Paginate.fitsWidth(block), 1);

widths(inner, 700, 875);
check("...and one whose formula runs off the edge says by how much",
  Math.round(Paginate.fitsWidth(block) * 100) / 100, 0.8);

// The block itself can be the thing that overflows, not only something in it.
widths(block, 700, 1400);
widths(inner, 700, 700);
check("the block's own overflow counts too", Paginate.fitsWidth(block), 0.5);
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

/* How much of a page may be left empty to end it at a heading. The cost of a
 * page is the fraction left empty, squared, and a break that is not at a
 * heading pays this on top — so a heading break is taken whenever it wastes
 * less than the square root of it.
 */
const nearly = stack([[300], [400], [100, true], [150], [400]]);
check("worth a third of a page, the heading two thirds down is taken",
  Paginate.pageStarts(nearly, PAGE, 0.3), [0, 2]);
check("...and worth almost nothing, the page is filled instead",
  Paginate.pageStarts(nearly, PAGE, 0.001), [0, 4]);

/* Why it is costed over the whole document rather than page by page.
 *
 * Twenty blocks with headings scattered through them, some of them tall
 * enough to be awkward. Whatever arrangement it picks, no page before the
 * last may be left badly empty — which is the thing a greedy walk cannot
 * promise, because it decides each page before it has seen the next.
 */
const mixed = stack([
  [180], [120, true], [240], [300], [160], [90, true], [420], [200],
  [140, true], [380], [260], [110], [130, true], [460], [180], [240],
  [100, true], [320], [280], [150]
]);

const fills = (() => {
  const starts = Paginate.pageStarts(mixed, PAGE);
  return starts.slice(0, -1).map((from, i) => {
    const to = (starts[i + 1] ?? mixed.length) - 1;
    return (mixed[to].bottom - mixed[from].top) / PAGE;
  });
})();

check("no page before the last is left more than a third empty",
  fills.every((fill) => fill >= 0.66), true);
check("...and none of them overflows", fills.every((fill) => fill <= 1), true);
console.log(`  (pages filled ${fills.map((f) => Math.round(f * 100)).join("%, ")}%)`);

/* A heading whose first paragraph will not fit on a page with it has nowhere
 * else to go. The rule against stranding one is a price, not a refusal:
 * priced as a refusal, no arrangement is possible at all and the whole
 * document comes back as a single page.
 */
const nowhere = stack([[900], [100, true], [980], [100]]);
check("a heading that cannot fit with what follows it is still placed",
  Paginate.pageStarts(nowhere, PAGE).length > 1, true);

console.log("=== the PDF, written here rather than printed ===");

/* The browser will only make one through the print dialogue, and the dialogue
 * belongs to the person rather than to the page: it adds its own margins
 * around the ones the sheets carry and leaves a white border round a document
 * whose background is not white. So the file is assembled byte by byte, and
 * these are the bytes a reader needs to find anything in it at all.
 */
const sheetPage = (pixels) => ({
  width: 794, height: 1123, pixelWidth: 1588, pixelHeight: 2246,
  bytes: new Uint8Array(pixels)
});

const file = Pdf.write({ pages: [sheetPage([1, 2, 3]), sheetPage([4, 5])], title: "Vectors (notes)" });
const asText = Buffer.from(file).toString("latin1");

check("it says what it is", asText.startsWith("%PDF-1.7"), true);
// Four high bytes in a comment on the second line: how a reader is told the
// file is binary and must not be helpfully re-encoded on the way somewhere.
check("...and that it is binary", [...file.slice(10, 14)].every((byte) => byte > 127), true);
check("it ends where a PDF ends", asText.trimEnd().endsWith("%%EOF"), true);

check("every page is there", (asText.match(/\/Type \/Page[^s]/g) || []).length, 2);
check("...and the page tree counts them", /\/Type \/Pages \/Count 2/.test(asText), true);

// A4 at 72 points to the inch rather than CSS's 96, which is the one
// conversion in the whole file and the one that decides the paper size.
check("the paper is A4", /\/MediaBox \[0 0 595.5 842.25\]/.test(asText), true);
check("...which is the sheet, in points", Math.round(794 * Pdf.PT_PER_PX * 100) / 100, 595.5);

check("the picture is drawn over the whole of it",
  asText.includes("q 595.5 0 0 842.25 0 0 cm /Im0 Do Q"), true);
check("...as a JPEG, which a PDF can carry without being told how",
  (asText.match(/\/Filter \/DCTDecode/g) || []).length, 2);

/* The cross-reference table is how a reader finds an object: it is a list of
 * byte offsets, and one of them being wrong by a byte is a file that will not
 * open. So each is checked against what is actually at that offset.
 */
const startxref = Number(asText.match(/startxref\s+(\d+)/)[1]);
check("the table is where the trailer says it is",
  asText.slice(startxref, startxref + 4), "xref");

const offsets = [...asText.slice(startxref).matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
check("there is one offset per object", offsets.length, Number(asText.match(/\/Size (\d+)/)[1]) - 1);
check("...and every one of them lands on its object",
  offsets.every((at, index) => asText.slice(at).startsWith(`${index + 1} 0 obj`)), true);

check("the catalogue points at the page tree", /\/Type \/Catalog \/Pages 2 0 R/.test(asText), true);
check("the title is carried, with its brackets escaped",
  Pdf.write({ pages: [sheetPage([1])], title: "a (b) c" }) && asText.includes("/Title (Vectors \\(notes\\))"), true);

check("a document of one page is a document", (() => {
  const one = Buffer.from(Pdf.write({ pages: [sheetPage([9])], title: "x" })).toString("latin1");
  return (one.match(/\/Type \/Page[^s]/g) || []).length;
})(), 1);

console.log("=== the words over the picture ===");

/* A page of this file is a picture of a page, which is exact and cannot be
 * searched. So the words go on it as well, in the one way a PDF has of saying
 * "this text is here but do not draw it": render mode 3, which is what every
 * scanner puts under an OCR'd page.
 */
const spoken = Buffer.from(Pdf.write({
  title: "x",
  pages: [{
    ...sheetPage([1]),
    drawnWidth: 794,
    runs: [
      { text: "Gram–Schmidt", x: 100, y: 200, width: 90, size: 16 },
      { text: "α", x: 10, y: 400, width: 8, size: 16 }
    ]
  }]
})).toString("latin1");

check("the words are drawn in the mode that draws nothing", spoken.includes("BT 3 Tr"), true);
check("...and each one is placed where the picture shows it",
  /1 0 0 1 75 [\d.]+ Tm/.test(spoken), true);
// PDF counts up the page and a browser counts down it, so the one has to be
// turned into the other or every line lands at the wrong end of the page.
check("...with the page the right way up",
  spoken.includes(`1 0 0 1 75 ${Math.round((842.25 - 150) * 100) / 100} Tm`), true);

/* Nothing is drawn, so no font is embedded — but something has to say what
 * each code means, because that is what a search reads. Two bytes a
 * character, because a single-byte encoding has 256 places in it and this is
 * a document with Greek, arrows and set theory in it.
 */
check("the font is there to be read, not to be drawn", spoken.includes("/Subtype /Type0"), true);
check("...two bytes a character", spoken.includes("/Encoding /Identity-H"), true);
check("...with a map from those bytes back to the characters",
  spoken.includes("/ToUnicode") && spoken.includes("beginbfrange <0000> <FFFF> <0000>"), true);
check("...and no font file, since none is drawn", spoken.includes("/FontFile"), false);
check("the page can reach the font", /\/Font << \/F1 \d+ 0 R >>/.test(spoken), true);

check("a word is UTF-16, as a PDF string takes it", Pdf.hexOf("Aα"), "004103b1");
check("...and an en dash survives it", Pdf.hexOf("–"), "2013");
// Outside the basic plane, a character arrives as its two surrogates, which
// is what a reader recombines on the way back out.
check("...as does something past the basic plane", Pdf.hexOf("\u{1D400}"), "d835dc00");

check("a page with no words still writes",
  Buffer.from(Pdf.write({ pages: [sheetPage([1])], title: "x" })).toString("latin1").includes("BT"), false);

// An SVG wrapping the sheet is what the canvas draws, and it is parsed by the
// XML parser: a stylesheet full of `>` and `&` has to be out of its way.
const svg = Pdf.svgFor("<div/>", "a > b { content: \"&\"; }", { width: 10, height: 20 }).join("");
/* The CDATA is commented out as well as opened: the XML parser needs the
 * CDATA so a `>` in a selector is not markup, and the CSS parser needs the
 * comment so the CDATA is not a rule. Both are satisfied at once. */
check("the stylesheet rides inside CDATA, inside a comment",
  svg.includes("/*<![CDATA[*/a > b") && svg.includes("/*]]>*/"), true);
check("...and the sheet is sized in the viewBox", svg.includes('viewBox="0 0 10 20"'), true);

process.exit(finish());
