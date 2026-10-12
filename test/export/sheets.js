// Part of the EXPORT suite. See export.test.js, which loads this.
//
// The half of snapshot.js that wants a document: where the copy's box is, how
// big a sheet is, and which sheets the ink is carried onto.
//
// export.test.js drives the pure half in this process's own scope — the print
// rules, the fonts worth embedding, a diagram's bounds. These functions build
// elements, so they get a window of their own. jsdom lays nothing out, which
// is fine here: every measurement these take is one the test supplies, and
// supplying it is what makes the arithmetic checkable at all.
//
// The one worth having is the last. Carrying the whole ink layer onto every
// sheet of a long document turned a three megabyte export into a hundred and
// six, and the fix — give a sheet the ink only if the ink reaches it — had
// nothing holding it.
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");

module.exports = (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  const dom = new JSDOM("<body></body>", { runScripts: "outside-only" });
  const { window } = dom;

  // intoSheets asks the paginator for the pages before it does anything with
  // them, so both go into the same window.
  loadScript(window, path.join(ROOT, "export", "paginate.js"));
  loadScript(window, path.join(ROOT, "export", "snapshot.js"));

  const Snapshot = window.ExportSnapshot;
  const { document } = window;

  // What jsdom will not measure, handed over instead.
  const boxed = (element, rect) => {
    element.getBoundingClientRect = () => /** @type {any} */ (rect);
    return element;
  };

  const rect = (left, top, width, height) => ({ left, top, width, height });

  console.log("=== where the copy's box is, and what the ink does to it ===");
  {
    const surface = boxed(document.createElement("div"), rect(0, 0, 800, 2000));
    const article = boxed(document.createElement("article"), rect(100, 50, 600, 1200));

    const plain = Snapshot.geometryOf(article, surface, null);
    check("with no ink the box is the document's own",
      [plain.width, plain.height], [600, 1200]);
    // The box starts at the document, so the document is not inset within it.
    check("...with nothing to the side of it", plain.inset, 0);
    check("...and says there is none", plain.hasInk, false);

    /* Ink is drawn over the whole surface, not only over the words, so the
     * box has to grow to hold whatever was drawn in the margins — otherwise a
     * note written beside a paragraph is cropped out of the copy.
     */
    const ink = document.createElement("svg");
    ink.innerHTML = "<path d='M0 0'/>";
    /** @type {any} */ (ink).getBBox = () => ({ x: 40, y: 20, width: 700, height: 1300 });

    const inked = Snapshot.geometryOf(article, surface, ink);
    check("ink outside the document widens the box", inked.width > plain.width, true);
    check("...and says there is some", inked.hasInk, true);
    check("...with the document's own width still known", inked.bodyWidth, 600);
    // Drawn from x=40 where the document starts at x=100, so the document now
    // sits inside a box that begins to the left of it.
    check("...and the document now sits inside that box", inked.inset > 0, true);

    /* Where the ink starts and stops *down the document*, which is the whole
     * reason the box is measured rather than assumed: this is what decides
     * which sheets get a copy of the layer, and carrying it onto all of them
     * turned a three megabyte export into a hundred and six.
     *
     * The ink is drawn from y=20 and the document's top is at y=50, so it
     * begins thirty pixels above the first line and runs 1270 down.
     */
    check("it knows where the ink begins and ends down the document",
      [inked.inkFrom, inked.inkTo], [-30, 1270]);

    // The layer is the size of the page whether or not anything is on it, so
    // an empty one is no ink at all rather than a box the size of the page.
    const empty = document.createElement("svg");
    check("an ink layer with nothing drawn on it is no ink",
      Snapshot.geometryOf(article, surface, empty).hasInk, false);

    // getBBox throws in some engines when the element is not rendered; that
    // is not a reason to refuse to export.
    const awkward = document.createElement("svg");
    awkward.innerHTML = "<path d='M0 0'/>";
    /** @type {any} */ (awkward).getBBox = () => {
      throw new Error("not rendered");
    };
    check("...and so is a layer that will not say how big it is",
      Snapshot.geometryOf(article, surface, awkward).hasInk, false);
  }

  console.log("=== a sheet is a sheet, and the document is fitted to it ===");
  {
    /* A4 with margins, rather than whatever width the page happened to be on
     * screen. The first version used the latter and produced a PDF on paper
     * nobody has, with text running into the edge.
     */
    const plain = Snapshot.sheetGeometry({ hasInk: false, width: 600, bodyWidth: 600, inset: 0 });
    check("without ink the document is simply set to the page",
      plain.docWidth, plain.contentWidth);
    check("...at no scale of its own", plain.scale, 1);
    check("...with the margins inside the sheet",
      [plain.sheetWidth > plain.contentWidth, plain.marginX > 0], [true, true]);

    /* With ink the document keeps the width it had on screen, because that is
     * what the ink was drawn over — and the sheet is scaled around it instead.
     */
    const wide = Snapshot.sheetGeometry({ hasInk: true, width: 1400, bodyWidth: 1400, inset: 60 });
    check("with ink the document keeps the width it was drawn at", wide.docWidth, 1400);
    check("...and where it sat", wide.docInset, 60);
    check("...the sheet shrinking to hold it", wide.scale < 1, true);

    // Never magnified: a narrow document blown up to fill A4 is a large-print
    // edition of itself, which is not what it looked like.
    const narrow = Snapshot.sheetGeometry({ hasInk: true, width: 200, bodyWidth: 200, inset: 0 });
    check("a narrow document is not blown up to fill the page", narrow.scale, 1);

    const css = Snapshot.sheetStyles(plain);
    check("the sheet's stylesheet names the sheet", css.includes(".export-sheet"), true);
    check("...and the stack it sits in", css.includes(".export-pages"), true);
    // The space above a heading belongs between it and what came before, not
    // at the top of a page.
    check("...and takes the gap off the top of each one",
      /\.export-sheet-body > :first-child\s*\{[^}]*margin-top:\s*0/.test(css), true);
  }

  /* intoSheets, which is where that decision is actually made, is not
   * exported — it is reachable only through build(), which wants a canvas, a
   * fetch and a layout. Exporting it to reach it would be changing the code
   * to suit the test, so what is checked here is the number the decision is
   * made on rather than the decision. The rest of it is the browser suite's
   * to answer, or nobody's.
   */
};
