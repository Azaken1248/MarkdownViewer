/* The layout jsdom will not do, for the two EXPORT suites that need one.
 *
 * The paginator measures a document and the snapshot measures the box it is
 * in, and jsdom works out neither: every rect it hands back is zeros. So an
 * element's height is whatever the test gave it and its top is everything
 * stacked above it inside its parent, which is the only layout rule either of
 * them leans on.
 *
 * Computed rather than stored, because blocks move between sheets — and that
 * is what makes `settle`, which asks each sheet whether what it holds still
 * fits, a question with an answer rather than a formality.
 */

// `install(window)` replaces that window's rects and hands back the helpers
// for building things that have a size.
function install(window) {
  const { document } = window;

  const px = (el, which) => parseFloat(window.getComputedStyle(el)[which]) || 0;

  /* As tall as the test said, or as tall as what is in it. A zoom shrinks the
   * result, because that is the point of the zoom the paginator puts on an
   * oversized block — and it measures again afterwards expecting it to have
   * worked.
   *
   * Written on the element as an attribute rather than held in a map beside
   * it, because the snapshot clones the whole document before it lays it out
   * and a clone has to be the same height as what it was cloned from.
   */
  const heightOf = (el) => {
    const given = parseFloat(el.dataset?.tall ?? el.style.height);
    const own = Number.isFinite(given)
      ? given
      : [...el.children].reduce((sum, child) => sum + outerOf(child), 0);

    return own * (parseFloat(el.style.zoom) || 1);
  };

  const outerOf = (el) => heightOf(el) + px(el, "marginTop") + px(el, "marginBottom");

  const topOf = (el) => {
    const parent = el.parentElement;
    if (!parent) {
      return 0;
    }

    let top = topOf(parent) + px(parent, "paddingTop");
    for (const sibling of parent.children) {
      if (sibling === el) {
        break;
      }
      top += outerOf(sibling);
    }

    return top + px(el, "marginTop");
  };

  window.Element.prototype.getBoundingClientRect = function rect() {
    const el = /** @type {HTMLElement} */ (/** @type {any} */ (this));
    const top = topOf(el);
    const height = heightOf(el);
    const width = parseFloat(el.style.width) || 0;
    return /** @type {any} */ ({
      top, bottom: top + height, height, left: 0, right: width, width
    });
  };

  const sized = (el, height) => {
    el.dataset.tall = String(height);
    return el;
  };

  // `block("p", 100)` is a paragraph a hundred pixels tall.
  const block = (tag, height, html = "") => {
    const el = document.createElement(tag);
    el.innerHTML = html;
    return sized(el, height);
  };

  /* Every zoom between an element and the page, multiplied. A zoom scales the
   * lengths inside it, so a block in a wrapper at two thirds has half again as
   * much room to lay itself out in as the wrapper is wide — which is why the
   * paginator shrinks, measures again, and almost always stops there.
   */
  const zoomAbove = (el) => {
    let scale = 1;
    for (let at = el.parentElement; at; at = at.parentElement) {
      scale *= parseFloat(at.style.zoom) || 1;
    }
    return scale;
  };

  // What a scrollbar hides on screen and paper cannot: the room the block has,
  // and the width the thing inside it actually wants.
  const across = (el, client, scroll) => {
    Object.defineProperty(el, "clientWidth", { get: () => Math.round(client / zoomAbove(el)), configurable: true });
    Object.defineProperty(el, "scrollWidth", { value: scroll, configurable: true });
    return el;
  };

  // And a block that does not reflow: an image, a diagram with a width on it,
  // a line of code with no space to break at. Zooming out shrinks what is
  // drawn but not the box it is measured in.
  const rigid = (el, client, scroll) => {
    Object.defineProperty(el, "clientWidth", { value: client, configurable: true });
    Object.defineProperty(el, "scrollWidth", { value: scroll, configurable: true });
    return el;
  };

  return { block, across, rigid, sized, heightOf, topOf };
}

// A4 with the margins inside the sheet, which is what snapshot.js hands over.
const A4 = {
  sheetWidth: 794, sheetHeight: 1123, marginX: 60, marginY: 60,
  contentWidth: 674, contentHeight: 1003, docWidth: 674, docInset: 0, scale: 1
};

module.exports = { install, A4 };
