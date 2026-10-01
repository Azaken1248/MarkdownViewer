/* Where the pages end.
 *
 * The browser will paginate anything you give it, but it decides by one rule:
 * fill the box, then cut. It does not know that a heading belongs with what
 * follows it, that a worked example is one thought, or that the figure under
 * "Example:" is the example. So it cuts in the middle of all of them, and the
 * result reads like a document that was sliced rather than one that was set.
 *
 * This measures the document and chooses the cuts itself:
 *
 *   - a page ends at a heading wherever a heading is anywhere near the end,
 *     because that is where a reader expects a page to end;
 *   - failing that, it ends between two blocks, never inside one;
 *   - a table, a diagram, a code block or a formula is never cut at all —
 *     if one is taller than a page it is shrunk until it fits, which is what
 *     anybody would do with it by hand;
 *   - a heading is never the last thing on a page.
 *
 * The output is a list of sheets, each an element of a fixed size with the
 * document's own background and the page's margins inside it rather than
 * outside — so the colour runs to the edge of the paper instead of stopping
 * at a frame the browser paints in its own grey.
 *
 * The measuring and the cutting are separate on purpose: `pageStarts` is
 * arithmetic over a list of boxes and is where the rules live, so the rules
 * can be argued with without a browser in the room.
 */

/* exported ExportPaginate */
var ExportPaginate = (function () {
  "use strict";

  /* What a break is worth.
   *
   * `HEADING_WORTH` is the only number here with a feel to it: it is how much
   * of a page may be left empty to end it at a heading. The cost of a page is
   * the fraction left empty, squared, and a break that is not at a heading
   * pays this on top — so a heading break is taken whenever it wastes less
   * than its square root, about a third of a page, and refused when it would
   * waste more.
   *
   * Squared rather than linear because two pages a quarter empty are better
   * than one full page and one half empty, and squaring is what says so.
   */
  const HEADING_WORTH = 0.1;

  // A heading with a single block under it at the foot of a page is a section
  // that starts and then stops. Cheaper than a bad gap, dearer than a good one.
  const LONELY_HEADING = 0.05;

  /* A heading left at the foot of a page is a title for a blank space, and
   * costs more than any page could cost by being empty — the worst of those
   * is one. But it is a price and not a refusal: a heading whose first
   * paragraph will not fit on a page with it has nowhere else to go, and a
   * rule that forbids it outright makes every arrangement impossible and the
   * document one long page.
   */
  const STRANDED_HEADING = 2;

  const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

  /* The blocks that are one thing and cannot be cut.
   *
   * Everything else — a paragraph, a list, a section of prose — may be split
   * between pages if it has to be, because the alternative is a page with one
   * paragraph on it.
   */
  const ATOMIC = "pre, table, figure, img, .katex-display, .mermaid-block, .notebook-cell, blockquote";

  const isHeading = (el) => HEADINGS.has(el.tagName);
  const isAtomic = (el) => el.matches?.(ATOMIC) || Boolean(el.querySelector?.(".mermaid-block, table"));

  /* --- Where to cut --------------------------------------------------------
   *
   * Every break is chosen at once rather than one at a time.
   *
   * Taking the best-looking break each time a page fills up is a greedy walk,
   * and a greedy walk cannot see that ending this page at a heading leaves
   * the next one two thirds empty. So each possible page is costed and the
   * set of pages with the lowest total is the one used — the same shape of
   * problem as breaking a paragraph into lines, and the same answer: look at
   * the whole of it before deciding any of it.
   *
   * `blocks` is the document as a list of boxes, in order, each with the top
   * and bottom it occupies and whether it is a heading. The answer is the
   * index of the first block on each page.
   */
  function pageStarts(blocks, pageHeight, worth = HEADING_WORTH) {
    const count = blocks.length;
    if (count === 0 || pageHeight <= 0) {
      return [0];
    }

    // cost[i] is the best total for the document from block i onwards, and
    // after[i] is the first block of the page that follows.
    const cost = new Array(count + 1).fill(Infinity);
    const after = new Array(count + 1).fill(count);
    cost[count] = 0;

    for (let first = count - 1; first >= 0; first -= 1) {
      for (const last of pagesFrom(blocks, first, pageHeight)) {
        const here = pageCost(blocks, { first, last, pageHeight, worth });
        if (here + cost[last] < cost[first]) {
          cost[first] = here + cost[last];
          after[first] = last;
        }
      }
    }

    const starts = [];
    for (let at = 0; at < count; at = after[at]) {
      starts.push(at);
    }

    return starts;
  }

  /* Every page that could start at `first`: one block, two, as many as fit.
   *
   * The first is always allowed even when it does not fit, because a block
   * taller than a page still has to go somewhere — it gets a page of its own
   * and the layout shrinks it.
   */
  function pagesFrom(blocks, first, pageHeight) {
    const ends = [first + 1];

    for (let last = first + 2; last <= blocks.length; last += 1) {
      if (blocks[last - 1].bottom - blocks[first].top > pageHeight) {
        break;
      }

      ends.push(last);
    }

    return ends;
  }

  /* What it costs to put blocks[first..last-1] on one page.
   *
   * The last page of a document is free however short it is: a document does
   * not owe the bottom of its final sheet anything.
   */
  function pageCost(blocks, { first, last, pageHeight, worth }) {
    if (last >= blocks.length) {
      return 0;
    }

    const used = blocks[last - 1].bottom - blocks[first].top;
    const empty = Math.max(0, pageHeight - used) / pageHeight;

    // The reader turns over and the section starts again with no name on it.
    const stranded = blocks[last - 1].heading ? STRANDED_HEADING : 0;
    const lonely = last - first > 1 && blocks[last - 2].heading ? LONELY_HEADING : 0;

    return (empty * empty) + (blocks[last].heading ? 0 : worth) + stranded + lonely;
  }

  /* --- Measuring -----------------------------------------------------------
   *
   * Laid out off-screen at exactly the width it will be printed at, because a
   * height is only true at one width. `visibility: hidden` rather than
   * `display: none`: a box that is not displayed has no size to read.
   */
  function measuringFrame(width) {
    const frame = document.createElement("div");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = [
      "position: absolute",
      "left: -20000px",
      "top: 0",
      `width: ${width}px`,
      "visibility: hidden",
      "pointer-events: none"
    ].join(";");

    return frame;
  }

  // Margins are part of what a block occupies, and they are the thing
  // getBoundingClientRect leaves out.
  function boxesOf(parent) {
    const origin = parent.getBoundingClientRect().top;

    return [...parent.children].map((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const above = parseFloat(style.marginTop) || 0;
      const below = parseFloat(style.marginBottom) || 0;

      return {
        el,
        top: (rect.top - origin) - above,
        bottom: (rect.bottom - origin) + below,
        heading: isHeading(el),
        atomic: isAtomic(el)
      };
    });
  }

  /* --- Making the sheets --------------------------------------------------- */

  /* The sheet carries its own size.
   *
   * Inline rather than left to the stylesheet, because a sheet has to be
   * measurable here — the correction pass below asks each one whether what it
   * was given actually fits, and a box whose rules live in a document that
   * does not exist yet has no size to ask about.
   */
  function sheetFor(doc, size) {
    const sheet = document.createElement("div");
    sheet.className = "export-sheet";
    sheet.style.cssText = [
      "position: relative",
      "box-sizing: border-box",
      `width: ${size.sheetWidth}px`,
      `height: ${size.sheetHeight}px`,
      `padding: ${size.marginY}px ${size.marginX}px`,
      "overflow: hidden"
    ].join(";");

    const body = document.createElement("div");
    // The same element the document was in, so every rule that reaches the
    // content through its container still reaches it.
    body.className = doc.className;
    body.classList.add("export-sheet-body");
    body.style.cssText = `margin-left: ${size.docInset}px;width: ${size.docWidth}px`;

    sheet.appendChild(body);
    return { sheet, body };
  }

  /* What was measured in one box, checked in the one it ended up in.
   *
   * A height taken in the measuring frame is almost always the height the
   * block has on the sheet; once in a while it is a few pixels more, and a
   * few pixels is a clipped descender at the foot of a page. Each sheet is
   * asked whether what it was given fits, and anything hanging over is handed
   * to the next one — walking forwards, so a block pushed onto a full sheet
   * is pushed on again from there.
   */
  function settle(sheets, size) {
    for (let i = 0; i < sheets.length; i += 1) {
      while (hangsOver(sheets[i]) && sheets[i].firstChild.children.length > 1) {
        if (i + 1 === sheets.length) {
          const { sheet } = sheetFor(sheets[i].firstChild, size);
          sheets[i].parentNode.appendChild(sheet);
          sheets.push(sheet);
        }

        const body = sheets[i].firstChild;
        sheets[i + 1].firstChild.prepend(body.lastElementChild);
      }
    }

    return sheets;
  }

  function hangsOver(sheet) {
    const body = sheet.firstChild;
    if (body.children.length === 0) {
      return false;
    }

    const box = sheet.getBoundingClientRect();
    const style = window.getComputedStyle(sheet);
    const floor = box.bottom - parseFloat(style.paddingBottom);
    const last = body.lastElementChild.getBoundingClientRect();

    // A pixel of slack: a rect is a float and a floor is a float.
    return last.bottom > floor + 1;
  }

  /* The things inside a block that scroll sideways rather than wrap.
   *
   * On a screen a wide formula or a wide table is given a scrollbar. Paper
   * has no scrollbar: whatever is past the edge is simply not there, and the
   * reader gets half an equation and a grey line where the rest was.
   */
  const SCROLLERS = ".katex-display, .math-block, pre, table, .mermaid-block, .notebook-cell";

  // How much a block has to shrink for everything in it to fit its own box.
  // One is "it already does".
  function fitsWidth(el) {
    let fit = 1;

    for (const inner of [el, ...el.querySelectorAll(SCROLLERS)]) {
      if (inner.clientWidth > 0 && inner.scrollWidth > inner.clientWidth + 1) {
        fit = Math.min(fit, inner.clientWidth / inner.scrollWidth);
      }
    }

    return fit;
  }

  /* A block too big for a page is shrunk until it fits one.
   *
   * Too tall and it would be cut in half; too wide and the right of it would
   * be cut off — and a document printed at the width of a page rather than
   * the width of a window has plenty that is suddenly too wide. Making it
   * smaller is what anybody would do with it by hand, and the only thing that
   * can be done with a diagram taller than a sheet of paper.
   */
  const SMALLEST = 0.3;

  /* Tried rather than calculated, for the width.
   *
   * Shrinking a block shrinks its padding with it, so the room its contents
   * gain is not the whole of what it gave up — one pass of arithmetic left a
   * formula two per cent over the edge and still cut off. Measuring again
   * after shrinking asks the only question that matters, which is whether it
   * fits now.
   */
  const TRIES = 4;

  function fitOversized(box, size) {
    const tall = box.bottom - box.top;
    let zoom = tall > size.contentHeight ? size.contentHeight / tall : 1;
    let holder = null;

    for (let tries = 0; tries < TRIES; tries += 1) {
      const fit = fitsWidth(holder || box.el);
      if (zoom >= 1 && fit >= 1) {
        return;
      }

      zoom = Math.max(SMALLEST, Math.floor(zoom * fit * 100) / 100);

      if (!holder) {
        holder = document.createElement("div");
        holder.className = "export-shrunk";
        box.el.replaceWith(holder);
        holder.appendChild(box.el);
        box.el = holder;
      }

      holder.style.zoom = String(zoom);
      if (fit >= 1 || zoom <= SMALLEST) {
        return;
      }
    }
  }

  /* The document, as a list of sheets.
   *
   * `doc` is the rendered article, which is moved into the sheets rather than
   * copied: it has already been cloned by the caller, and copying it again
   * would mean measuring one tree and printing another.
   */
  function intoPages(doc, size) {
    const frame = measuringFrame(size.sheetWidth);
    const holder = /** @type {HTMLElement} */ (doc.cloneNode(false));
    // Measured at the width it will be laid out at, because a height is only
    // true at one width.
    holder.style.width = `${size.docWidth}px`;
    frame.appendChild(holder);
    document.body.appendChild(frame);

    while (doc.firstChild) {
      holder.appendChild(doc.firstChild);
    }

    const boxes = boxesOf(holder);
    for (const box of boxes) {
      fitOversized(box, size);
    }

    // Measured again: shrinking a block changed what comes after it.
    const settled = boxesOf(holder);
    const starts = pageStarts(settled, size.contentHeight);
    const sheets = [];

    starts.forEach((from, index) => {
      const to = index + 1 < starts.length ? starts[index + 1] : settled.length;
      const { sheet, body } = sheetFor(doc, size);

      for (let at = from; at < to; at += 1) {
        body.appendChild(settled[at].el);
      }

      // Where this sheet starts in the document, which is what the ink has to
      // be moved by to stay over the words it was drawn on.
      sheet.dataset.docTop = String(Math.round(settled[from] ? settled[from].top : 0));
      frame.appendChild(sheet);
      sheets.push(sheet);
    });

    holder.remove();
    settle(sheets, size);

    for (const sheet of sheets) {
      sheet.remove();
    }

    frame.remove();
    return sheets;
  }

  return {
    intoPages,
    settle,
    hangsOver,
    pageStarts,
    boxesOf,
    isAtomic,
    isHeading,
    fitsWidth,
    SCROLLERS,
    HEADING_WORTH,
    LONELY_HEADING,
    STRANDED_HEADING,
    ATOMIC
  };
})();
