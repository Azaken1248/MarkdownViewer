// Part of the EXPORT suite. See export.test.js, which loads this.
//
// The half of paginate.js that measures: where a block sits, which blocks are
// too big for a sheet of paper, and whether what a sheet was given actually
// fits in it.
//
// export.test.js drives `pageStarts` in this process's own scope, because the
// rules for where to cut live there and are arithmetic over a list of boxes.
// Everything here needs a document, and one thing more than a document: a
// position for each element, which jsdom does not work out. That is layout.js,
// next to this file.
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");
const { install, A4: size } = require("./layout.js");

module.exports = (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  const dom = new JSDOM("<body></body>", { runScripts: "outside-only" });
  const { window } = dom;
  const { document } = window;

  loadScript(window, path.join(ROOT, "export", "paginate.js"));
  const Paginate = window.ExportPaginate;

  const { block, across, rigid } = install(window);

  // The sheet's one child, which is the element the document's blocks go in.
  const bodyOf = (sheet) => /** @type {HTMLElement} */ (sheet.firstElementChild);

  const holding = (...children) => {
    const parent = document.createElement("article");
    parent.className = "doc-body";
    children.forEach((child) => parent.appendChild(child));
    document.body.appendChild(parent);
    return parent;
  };

  console.log("=== where each block is, margins and all ===");
  {
    const first = block("p", 100);
    const heading = block("H2", 40);
    const table = block("table", 200);
    heading.style.marginTop = "30px";
    heading.style.marginBottom = "10px";

    const parent = holding(first, heading, table);
    const boxes = Paginate.boxesOf(parent);

    check("every child is measured", boxes.length, 3);
    check("the first block starts at the top of the document", boxes[0].top, 0);

    /* The margin above a heading is part of what the heading occupies, and it
     * is the thing getBoundingClientRect leaves out. A paginator that cannot
     * see it puts the break above the margin, and the heading lands thirty
     * pixels down the next page.
     */
    check("a block's box holds the margins around it",
      [boxes[1].top, boxes[1].bottom], [100, 180]);
    check("...so the one after it starts where that one's margin ended",
      boxes[2].top, boxes[1].bottom);

    check("a heading is known to be one", [boxes[0].heading, boxes[1].heading], [false, true]);
    check("...and a table is known not to be cuttable",
      [boxes[0].atomic, boxes[2].atomic], [false, true]);
    // A diagram inside a wrapper is as uncuttable as one that is the block.
    check("...as is a block with a diagram somewhere inside it",
      Paginate.isAtomic(block("div", 10, "<div class='mermaid-block'></div>")), true);
    check("a document with no blocks measures as none", Paginate.boxesOf(holding()), []);
  }

  console.log("=== how much a block has to shrink to fit its own box ===");
  {
    /* On a screen a wide table gets a scrollbar. Paper has no scrollbar:
     * whatever is past the edge is simply not there, and the reader gets two
     * thirds of a table and a grey line where the rest was.
     */
    const wide = (client, scroll) => across(block("table", 100), client, scroll);

    check("a block that fits needs no shrinking", Paginate.fitsWidth(wide(600, 600)), 1);
    check("...and one a pixel over is not worth shrinking", Paginate.fitsWidth(wide(600, 601)), 1);
    check("a block half again as wide as its box is shrunk to two thirds",
      Number(Paginate.fitsWidth(wide(600, 900)).toFixed(4)), 0.6667);
    // Nothing is measured off a box with no width: an element that is not
    // displayed reports zero for both, which is not "infinitely too wide".
    check("a block with no width of its own is left alone",
      Paginate.fitsWidth(wide(0, 900)), 1);

    /* The worst of the things inside the block rather than the block itself:
     * the block is a div that wraps, and the formula inside it is what runs
     * off the edge.
     */
    const outer = across(block("div", 100, "<pre></pre><table></table>"), 600, 600);
    const [pre, table] = outer.querySelectorAll("pre, table");
    across(pre, 600, 750);
    across(table, 600, 1200);
    check("the widest thing inside the block is what decides",
      Paginate.fitsWidth(outer), 0.5);
  }

  console.log("=== the document, as a list of sheets ===");
  {
    const doc = holding(
      block("h1", 80), block("p", 300), block("p", 300),
      block("h2", 60), block("p", 400), block("p", 400)
    );

    const sheets = Paginate.intoPages(doc, size);

    check("the document comes back as sheets", sheets.length > 1, true);
    check("...each one the size of the paper",
      sheets.map((sheet) => sheet.style.height), sheets.map(() => "1123px"));
    check("...carrying the document's own classes inside it",
      bodyOf(sheets[0]).className.split(" ").includes("doc-body"), true);
    check("...and marked as a sheet body",
      bodyOf(sheets[0]).className.split(" ").includes("export-sheet-body"), true);
    check("...with the document's width, where the document sat",
      [bodyOf(sheets[0]).style.width, bodyOf(sheets[0]).style.marginLeft],
      ["674px", "0px"]);

    const laid = sheets.flatMap((sheet) => [...bodyOf(sheet).children]);
    check("every block ends up on exactly one sheet", laid.length, 6);
    check("...in the order it was written in",
      laid.map((el) => el.tagName), ["H1", "P", "P", "H2", "P", "P"]);
    check("...and the document it came from is now empty", doc.children.length, 0);
    check("...with none of it hanging over the sheet it is on",
      sheets.map((sheet) => Paginate.hangsOver(sheet)), sheets.map(() => false));

    /* The space above the first block on a sheet is taken off the block
     * itself, here, where the sheets are measured — not only in the
     * stylesheet the drawing uses. The margin above a heading belongs between
     * it and what came before, and the measuring and the drawing have to be
     * looking at the same document.
     */
    check("the gap above the first block on each sheet is taken off",
      sheets.map((sheet) => bodyOf(sheet).firstElementChild?.getAttribute("style")),
      sheets.map(() => "margin-top: 0px;"));

    // Where this sheet starts in the document, which is what the ink has to be
    // moved by to stay over the words it was drawn on.
    check("each sheet says where it starts in the document", sheets[0].dataset.docTop, "0");
    check("...and the one after it starts further down",
      Number(sheets[1].dataset.docTop) > 0, true);

    check("nothing is left in the measuring frame",
      document.querySelectorAll("[aria-hidden='true']").length, 0);
    check("...and no sheet is still attached to the page",
      sheets.filter((sheet) => sheet.parentNode).length, 0);

    // A document with nothing in it is one empty sheet rather than none: an
    // export of an empty page is a blank page.
    check("an empty document is a single sheet",
      Paginate.intoPages(holding(), size).length, 1);
  }

  console.log("=== a block too big for the paper is shrunk rather than cut ===");
  {
    /* Twice the height of a page, and uncuttable — a diagram cut in half is
     * two halves of a diagram. Shrinking it is the only thing that can be
     * done with it, and it is what anybody would do with it by hand.
     */
    const tall = block("div", 2006, "<div class='mermaid-block'></div>");
    const sheets = Paginate.intoPages(holding(tall), size);
    const shrunk = sheets.flatMap((sheet) => [...sheet.querySelectorAll(".export-shrunk")]);

    check("a block twice the height of a page is wrapped and shrunk", shrunk.length, 1);
    check("...with the block itself inside the wrapper", shrunk[0].firstElementChild, tall);
    check("...at about half size", Number(shrunk[0].style.zoom), 0.5);
    /* And measured again afterwards, which is what makes the shrinking worth
     * doing: the block now fits a sheet, so it gets one rather than being cut
     * across two.
     */
    check("...and comes back on one sheet rather than cut across two", sheets.length, 1);

    /* Too wide rather than too tall, which is most of what goes wrong when a
     * document laid out for a window is printed at the width of a page. Tried
     * rather than calculated: shrinking a block shrinks its padding with it,
     * so the room its contents gain is not the whole of what it gave up, and
     * one pass of arithmetic left a formula two per cent over the edge and
     * still cut off.
     */
    const table = across(block("table", 200), 600, 900);
    const widened = Paginate.intoPages(holding(table), size)
      .flatMap((sheet) => [...sheet.querySelectorAll(".export-shrunk")]);
    check("a block wider than the paper is shrunk too", widened.length, 1);
    check("...to the fraction of itself that fits", Number(widened[0].style.zoom), 0.66);

    /* A floor on it. Shrinking a table to a third is already the smallest
     * thing anybody would call reading; past that the sheet simply cuts it
     * off, which is at least honest about what happened.
     */
    /* Four tries and no more. A block whose box does not grow when the zoom
     * comes down is never measured as fitting, however small it is drawn —
     * so there has to be a cap, or the only thing that stops the loop is the
     * floor and every stubborn block ends up at a third of its size.
     */
    const stubborn = rigid(block("table", 200, "<img/>"), 600, 630);
    const capped = Paginate.intoPages(holding(stubborn), size)
      .flatMap((sheet) => [...sheet.querySelectorAll(".export-shrunk")]);
    check("a block that never measures as fitting is tried four times and left",
      Number(capped[0].style.zoom), 0.8);

    const hopeless = across(block("table", 200), 600, 6000);
    const floored = Paginate.intoPages(holding(hopeless), size)
      .flatMap((sheet) => [...sheet.querySelectorAll(".export-shrunk")]);
    check("a block hopelessly too wide stops at the smallest size allowed",
      Number(floored[0].style.zoom), 0.3);
  }

  console.log("=== what a sheet was given, checked in the sheet ===");
  {
    /* The sheets below are built here rather than taken from `intoPages`,
     * which hands back sheets it has already settled. They carry the same
     * inline size for the same reason the real ones do: the correction pass
     * asks each sheet whether what it holds fits, and a box whose rules live
     * in a stylesheet that does not exist yet has no size to ask about.
     */
    const pages = document.createElement("div");
    document.body.appendChild(pages);

    const sheetWith = (...blocks) => {
      const sheet = document.createElement("div");
      sheet.className = "export-sheet";
      sheet.style.cssText = "box-sizing: border-box;"
        + `width: ${size.sheetWidth}px;height: ${size.sheetHeight}px;`
        + `padding: ${size.marginY}px ${size.marginX}px`;
      const body = document.createElement("div");
      body.className = "export-sheet-body";
      blocks.forEach((one) => body.appendChild(one));
      sheet.appendChild(body);
      pages.appendChild(sheet);
      return sheet;
    };

    check("an empty sheet has nothing hanging over it",
      Paginate.hangsOver(sheetWith()), false);
    check("...and a sheet holding less than a page's worth does not either",
      Paginate.hangsOver(sheetWith(block("p", 900))), false);
    check("a sheet holding more than fits says so",
      Paginate.hangsOver(sheetWith(block("p", 1100))), true);
    // A rect is a float and a floor is a float; a sheet is not reflowed over
    // a rounding error.
    check("...but not over a pixel of slack",
      Paginate.hangsOver(sheetWith(block("p", 1004))), false);

    const overfull = sheetWith(block("p", 600), block("p", 600));
    const next = sheetWith();
    Paginate.settle([overfull, next], size);

    check("what hangs over a sheet is handed to the next one",
      [bodyOf(overfull).children.length, bodyOf(next).children.length], [1, 1]);
    check("...and nothing is left hanging over", Paginate.hangsOver(overfull), false);

    /* Walking forwards, so a block pushed onto a sheet that is already full is
     * pushed on again from there — and a sheet appears at the end to take it
     * when there is nowhere left to push.
     */
    const crowded = [sheetWith(block("p", 600), block("p", 600)), sheetWith(block("p", 900))];
    const settled = Paginate.settle(crowded, size);
    check("a full sheet given more passes it on in turn", settled.length, 3);
    check("...and every sheet ends up holding what fits it",
      settled.map((sheet) => Paginate.hangsOver(sheet)), [false, false, false]);

    // One block taller than a sheet has nowhere to go: it stays, and the
    // layout has already shrunk it. A sheet is never emptied to chase a fit.
    const lone = sheetWith(block("div", 4000));
    check("a sheet holding one oversized block is left holding it",
      bodyOf(Paginate.settle([lone], size)[0]).children.length, 1);
  }
};
