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

  /* How far up the page a heading may be and still be worth ending on.
   *
   * Too small and headings near the bottom are missed; too large and a page
   * ends a third of the way down because there happened to be a heading
   * there. A quarter is about where a reader stops reading a short page as a
   * mistake and starts reading it as the end of a section.
   */
  const HEADING_REACH = 0.25;

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
   * `blocks` is the document as a list of boxes, in order, each with the top
   * and bottom it occupies and whether it is a heading. The answer is the
   * index of the first block on each page.
   */
  function pageStarts(blocks, pageHeight, reach = HEADING_REACH) {
    if (blocks.length === 0 || pageHeight <= 0) {
      return [0];
    }

    const starts = [0];
    let first = 0;

    while (first < blocks.length) {
      const next = nextStart(blocks, first, pageHeight, reach);
      if (next === null) {
        break;
      }

      starts.push(next);
      first = next;
    }

    return starts;
  }

  function nextStart(blocks, first, pageHeight, reach) {
    const top = blocks[first].top;
    const bottom = top + pageHeight;

    // The first block that does not fit. If everything left fits, this is the
    // last page and there is nothing more to decide.
    let overflow = -1;
    for (let i = first; i < blocks.length; i += 1) {
      if (blocks[i].bottom > bottom) {
        overflow = i;
        break;
      }
    }

    if (overflow === -1) {
      return null;
    }

    // Always make progress: a block taller than the page gets a page of its
    // own and is shrunk to fit it.
    const cut = Math.max(overflow, first + 1);
    const wanted = headingNear(blocks, { first, cut, earliest: top + (pageHeight * (1 - reach)) });
    return withoutTrailingHeading(blocks, first, wanted);
  }

  /* A heading is never the last thing on a page.
   *
   * It is a label for what comes after it, and a label at the foot of a page
   * labels a blank space — the reader turns over and finds the section
   * starting again with no title. The reach above is a preference; this is
   * not. Several headings in a row move together, which is what happens when
   * a section title is followed immediately by a subsection title.
   */
  function withoutTrailingHeading(blocks, first, cut) {
    let at = cut;

    while (at > first + 1 && blocks[at - 1].heading) {
      at -= 1;
    }

    return at;
  }

  /* A heading in the last quarter of the page is where the page should end.
   *
   * Searching back from the cut rather than forward from the top, so the
   * answer is the last such heading and the page is as full as it can be
   * while still ending somewhere a reader would have ended it.
   */
  function headingNear(blocks, { first, cut, earliest }) {
    for (let i = cut; i > first + 1; i -= 1) {
      if (blocks[i].heading && blocks[i].top >= earliest) {
        return i;
      }
    }

    return cut;
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

  /* A block too tall for any page is shrunk until it fits one.
   *
   * It is the only thing that can be done with a diagram taller than a sheet
   * of paper, and it is what a person would do: make it smaller rather than
   * cut it in half.
   */
  function fitOversized(box, height) {
    const tall = box.bottom - box.top;
    if (tall <= height) {
      return;
    }

    const holder = document.createElement("div");
    holder.className = "export-shrunk";
    holder.style.zoom = String(Math.max(0.3, Math.floor((height / tall) * 100) / 100));
    box.el.replaceWith(holder);
    holder.appendChild(box.el);
    box.el = holder;
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
      fitOversized(box, size.contentHeight);
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
    HEADING_REACH,
    ATOMIC
  };
})();
