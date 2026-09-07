/* The pieces every other part of the drawing is made of.
 *
 * The distances an arrow keeps, the height of a line of text, and the four
 * small functions that turn numbers into SVG. Nothing here knows what a
 * flowchart is.
 */
(function (global) {
  "use strict";

  const Model = global.DiagramModel;

  // How far outside a box an arrow turns, and how much room a route keeps
  // between itself and a box it is going around.
  const STANDOFF = 18;
  const CLEARANCE = 8;
  // Slant on the shapes that have one, and the corner radius on the ones that
  // are only slightly round.
  const SLANT = 16;
  const RADIUS = 5;
  const ROUND_RADIUS = 12;
  // Text metrics, matched to the CSS so the box a label was measured for is the
  // box it is drawn in.
  const LINE_HEIGHT = 20;
  /* How much room a line of type needs.
   *
   * Twenty at the standard size, and the size itself once the type is big
   * enough that twenty would run the lines into one another: a box set in 32px
   * with three lines in it is three lines written over each other otherwise.
   * A line height that does not follow the size is a size control that only
   * works on boxes with one word in them.
   */
  const LEADING = 1.45;
  const leadFor = (size) => Math.max(LINE_HEIGHT, size * LEADING);
  const LABEL_CHAR = 6.2;
  // Twice the snapping step, so every other line is drawn and the paper does
  // not turn into a grey wash.
  const GRID_STEP = 20;
  /* Roughly how wide a character is, at the two sizes text is set in here.
   *
   * An approximation, and it only has to be one: it decides where a word is cut
   * off, and a cut half a character early is a cut nobody can see. Measuring it
   * properly means laying the text out, which means a browser, which is not
   * something a function that returns a string is allowed to need.
   */
  const ELLIPSIS = "…";


  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const round = (value) => Math.round(Number(value) * 10) / 10;

  /* --- Shapes ------------------------------------------------------------
   *
   * Every shape is drawn in its own box's coordinates — from 0,0 to w,h — and
   * moved into place by a transform on the group around it. A box that moves
   * therefore only changes one attribute, which is the whole reason dragging
   * one is cheap.
   */

  function polygon(points) {
    return `<polygon class="dd-shape" points="${points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ")}"/>`;
  }

  function rect(w, h, radius) {
    return `<rect class="dd-shape" x="0" y="0" width="${round(w)}" height="${round(h)}" rx="${round(radius)}"/>`;
  }


  global.DdBase = {
    Model, STANDOFF, CLEARANCE, SLANT, RADIUS, ROUND_RADIUS, LINE_HEIGHT, LEADING, leadFor,
    LABEL_CHAR, GRID_STEP, ELLIPSIS, escapeText, round, polygon, rect
  };
})(typeof window === "undefined" ? globalThis : window);
