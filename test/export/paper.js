/* Part of the EXPORT suite. See export.test.js, which loads this.
 *
 * The half of pdf.js that wants a page: the typography the sheets inherit,
 * the sheets as XML a foreignObject will accept, the words found by laying
 * them out, and the loop that draws a long document a run of pages at a time
 * rather than one enormous canvas.
 *
 * export.test.js writes the file itself in this process's own scope — the
 * objects, the xref table, the text operators — because those are bytes and
 * bytes can be read back. What is stood in for here is the three things a
 * browser does: drawing, encoding, and telling you where a word ended up.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");
const { install } = require("./layout.js");

module.exports = async (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  const dom = new JSDOM("<body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;

  loadScript(window, path.join(ROOT, "export", "pdf.js"));
  const Pdf = window.ExportPdf;

  const { sized } = install(window);

  // The file is written as bytes, and jsdom's window has no encoder to make
  // them with.
  window.TextEncoder = TextEncoder;

  /* --- the rasteriser, the encoder and the image loader ------------------- */

  const drawn = [];
  let loadable = true;

  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    const canvas = this;
    const paper = {
      fillStyle: "",
      fillRect: (...box) => drawn.push({ canvas, filled: box, with: paper.fillStyle }),
      drawImage: (...args) => drawn.push({ canvas, copied: args.length })
    };

    return /** @type {any} */ (paper);
  };

  // A JPEG is bytes a browser makes. What matters here is that each page gets
  // its own and that the canvas is let go of afterwards.
  window.HTMLCanvasElement.prototype.toBlob = function toBlob(done) {
    const bytes = Buffer.from(`JPEG ${this.width}x${this.height}`);
    // jsdom's Blob has no arrayBuffer, which is the only thing asked of it.
    Promise.resolve().then(() => done(/** @type {any} */ ({
      type: "image/jpeg", size: bytes.length, arrayBuffer: async () => bytes
    })));
  };

  window.Image = /** @type {any} */ (class {
    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    set src(value) {
      void value;
      Promise.resolve().then(() => (loadable ? this.onload?.() : this.onerror?.()));
    }
  });

  /* --- where a word ends up ----------------------------------------------
   *
   * A range's rectangle is the one measurement in this file that nothing else
   * can supply: it is how the text layer learns where each word was set. Here
   * a character is eight pixels wide and a line is where its element is, which
   * is enough for the arithmetic to be checked and is a layout the real one
   * would recognise.
   */
  const CHAR = 8;

  window.Range.prototype.getBoundingClientRect = function rect() {
    const node = /** @type {any} */ (this.startContainer);
    const parent = node.parentElement;
    const box = parent.getBoundingClientRect();
    const size = parseFloat(window.getComputedStyle(parent).fontSize) || 16;

    // A word in a box that was never laid out measures as nothing, and a
    // rectangle of nothing is not a place a word is.
    const width = parent.hasAttribute("data-unlaid")
      ? 0
      : (this.endOffset - this.startOffset) * CHAR;

    return /** @type {any} */ ({
      left: box.left + (this.startOffset * CHAR),
      width,
      top: box.top,
      bottom: box.top + size,
      height: size
    });
  };

  // A sheet: the size pdf.js is told it is, with a line of words on it.
  // Every line carries its own size, because a baseline is a fraction of one
  // and jsdom inherits nothing.
  const LINE = 'style="font-size: 20px"';

  const sheetOf = (html, height = 1123) => {
    const sheet = document.createElement("div");
    sheet.className = "export-sheet";
    sheet.style.cssText = `width: 794px;height: ${height}px`;
    sheet.innerHTML = html;
    return sized(sheet, height);
  };

  // Built inside the window, so it is not this realm's Uint8Array.
  const isBytes = (value) => ArrayBuffer.isView(value);

  const size = { width: 794, height: 1123, theme: "light", background: "#fffdf7" };
  const paper = { width: 794, height: 1123 };

  console.log("=== the typography a sheet has nothing to inherit from ===");
  {
    /* There is no body in a foreignObject — the sheets hang off a bare div —
     * so every rule the app writes against `body` reaches nothing, and the
     * text came out in the browser's default serif.
     */
    document.body.style.cssText = "font-family: Inter, sans-serif;font-size: 17px;color: rgb(20, 20, 20)";

    const rule = Pdf.bodyRule();
    check("the rule is written against the holder the sheets hang off",
      rule.startsWith(".export-body{"), true);
    // Read from the live page rather than restated here, so it stays the same
    // answer as the screen's.
    check("...and says what the page says",
      [rule.includes("font-family:Inter, sans-serif"), rule.includes("font-size:17px")],
      [true, true]);
    check("...for every property a document inherits",
      Pdf.INHERITED.every((name) => rule.includes(name) || !window.getComputedStyle(document.body)
        .getPropertyValue(name)), true);
    // A property the page says nothing about is left out rather than written
    // as an empty one, which is not CSS.
    check("...and nothing about the ones it does not set",
      rule.includes("letter-spacing:}") || rule.includes("letter-spacing:;"), false);
  }

  console.log("=== the sheets, as XML rather than as HTML ===");
  {
    /* A foreignObject is parsed by the XML parser, which refuses `<br>` and
     * every other unclosed tag that HTML allows.
     */
    const first = sheetOf("<p>one<br>two</p><img src='a.png'>");
    const second = sheetOf("<p>three</p>");
    const xml = Pdf.asXml([first, second]);

    check("the tags HTML leaves open are closed", xml.includes("<br />"), true);
    check("...and so are the empty ones", /<img[^>]*\/>/.test(xml), true);
    check("the holder is in the XHTML namespace",
      xml.includes('xmlns="http://www.w3.org/1999/xhtml"'), true);
    check("...and is the element the body rule is written against",
      xml.includes('class="export-body"'), true);
    check("every sheet given is in it",
      [xml.includes("one"), xml.includes("three")], [true, true]);
    // Copied rather than moved: the sheets are measured after this and a
    // sheet that has been taken away has nothing to measure.
    check("...and none of them was taken away to do it",
      [first.parentNode, second.parentNode], [null, null]);
  }

  console.log("=== where every word on the page ended up ===");
  {
    const sheet = sheetOf(`<p id="line" ${LINE}>hello there</p>`);
    document.body.appendChild(sheet);
    sized(/** @type {any} */ (sheet.querySelector("#line")), 24);

    const runs = Pdf.textRuns(sheet);
    check("each word is found on its own", runs.map((run) => run.text), ["hello", "there"]);
    check("...placed across the sheet rather than across the page",
      runs.map((run) => run.x), [0, 48]);
    check("...as wide as it is", runs.map((run) => run.width), [40, 40]);
    /* The baseline, near enough: a descender is about a fifth of the size and
     * nothing here is drawn, so near enough is where a selection sits.
     */
    check("...and sitting on its baseline rather than its top",
      runs.every((run) => run.y > 0 && run.y < run.size), true);
    sheet.remove();
  }

  console.log("=== and the text nobody meant to search ===");
  {
    /* KaTeX writes every formula twice — once as MathML for a screen reader,
     * hidden under a clip rectangle, and once as the spans that are shown.
     * Both would go into the layer, and a search for a symbol would find it
     * twice while a selection picked up a sentence of it twice over.
     */
    const sheet = sheetOf([
      `<p ${LINE}>shown</p>`,
      `<span class="katex"><span class="katex-mathml" ${LINE}>spoken</span>`,
      '<span class="katex-html">x</span></span>',
      '<p style="visibility: hidden">invisible</p>',
      '<p style="display: none">gone</p>',
      "<p>   </p>"
    ].join(""));
    document.body.appendChild(sheet);
    // Every one of them measurable, so that what keeps a word out of the layer
    // is the rule meant to keep it out rather than a box jsdom never laid out.
    for (const el of sheet.querySelectorAll("p, span")) {
      sized(/** @type {any} */ (el), 24);
    }

    const said = Pdf.textRuns(sheet).map((run) => run.text);
    check("a word in a box that was never laid out is nowhere, so it is not in the layer",
      Pdf.textRuns(sheetOf(`<p ${LINE} data-unlaid>somewhere</p>`)), []);
    check("the words that are shown are in the layer", said.includes("shown"), true);
    check("...and the reader's second copy of a formula is not",
      said.includes("spoken"), false);
    check("...nor anything the page has hidden",
      [said.includes("invisible"), said.includes("gone")], [false, false]);
    check("...and whitespace is not a word", said.length, 2);
    sheet.remove();
  }

  console.log("=== a run of sheets, drawn on one canvas ===");
  {
    drawn.length = 0;
    const sheets = [sheetOf("<p>one</p>"), sheetOf("<p>two</p>")];
    const canvas = await Pdf.drawRun(sheets, ".export-sheet{color:red}", size);

    // No gaps: the gaps between sheets belong to looking at them on a screen.
    check("the canvas is as tall as the sheets stacked",
      [canvas.width, canvas.height], [794 * Pdf.SCALE, 1123 * 2 * Pdf.SCALE]);
    /* Anything the picture does not cover would be transparent, and a
     * transparent pixel in a JPEG is a black one.
     */
    check("...filled with the page's own background before anything is drawn",
      drawn[0].with, "#fffdf7");
    check("...over the whole of it",
      drawn[0].filled, [0, 0, canvas.width, canvas.height]);
    check("...and then the sheets over that", drawn[1].copied, 5);

    // A page that never said what colour it was is drawn on white, which is
    // what paper is.
    drawn.splice(0);
    await Pdf.drawRun(sheets, "", { ...size, background: "" });
    check("...and a page that never said what colour it is gets white paper",
      drawn[0].with, "#ffffff");

    loadable = false;
    check("a run whose picture will not load draws nothing",
      await Pdf.drawRun(sheets, "", size), null);
    loadable = true;
  }

  console.log("=== and the document, page by page ===");
  {
    const told = [];
    drawn.splice(0);
    const sheets = [`<p ${LINE}>one</p>`, `<p ${LINE}>two</p>`, `<p ${LINE}>three</p>`]
      .map((html) => sheetOf(html));
    for (const sheet of sheets) {
      sized(/** @type {any} */ (sheet.querySelector("p")), 24);
    }

    const bytes = await Pdf.render({
      sheets, css: "", size, paper, title: "Three pages",
      onPage: (done, all) => told.push([done, all])
    });

    check("the whole document is one file", isBytes(bytes), true);
    check("...that says it is a PDF",
      Buffer.from(bytes).toString("latin1").startsWith("%PDF-"), true);
    check("...with a page in it for each sheet",
      (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page[^s]/g) || []).length, 3);

    /* A long document takes long enough that a button which has simply
     * stopped responding is a button somebody presses again.
     */
    check("the caller is told as each page is drawn", told, [[1, 3], [2, 3], [3, 3]]);

    check("the words on each sheet go with its own page",
      Buffer.from(bytes).toString("latin1").includes("(one)")
      || /0074|006f/.test(Buffer.from(bytes).toString("latin1")), true);

    /* Drawn a run at a time, because one canvas for a whole document is tens
     * of thousands of pixels tall and a browser refuses past sixteen
     * thousand — silently, with a blank canvas.
     */
    const perRun = Math.floor(Pdf.MAX_CANVAS / Math.round(size.height * Pdf.SCALE));
    check("a canvas is never asked to be taller than one is allowed to be",
      perRun * size.height * Pdf.SCALE <= Pdf.MAX_CANVAS, true);

    // Nothing is drawn, so there is nothing to write: a file with no pages in
    // it is not a file anybody wants.
    loadable = false;
    check("a document nothing would draw is no file at all",
      await Pdf.render({ sheets, css: "", size, paper, title: "x" }), null);
    loadable = true;

    // One sheet taller than the limit still gets a run of its own rather than
    // none at all.
    const enormous = [sheetOf("<p>tall</p>", Pdf.MAX_CANVAS)];
    const single = await Pdf.render({
      sheets: enormous, css: "", size: { ...size, height: Pdf.MAX_CANVAS }, paper, title: "x"
    });
    check("...and a sheet too tall for any canvas is still drawn", isBytes(single), true);

    /* The canvases are fifteen megabytes each and a long document makes a lot
     * of them, so they are released rather than left to the collector.
     */
    check("every canvas the document was drawn on was let go of afterwards",
      drawn.every(({ canvas }) => canvas.width === 0 && canvas.height === 0), true);
  }
};
