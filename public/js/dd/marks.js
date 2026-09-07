/* What the editor draws on top: selection frames, handles, guides, marquee.
 *
 * None of it is part of the diagram — it is the editor showing what it is
 * about to do — so it is drawn in its own layer and thrown away freely.
 */
(function (global) {
  "use strict";

  const { round } = global.DdBase;
  const { routeEdge, wayPoints } = global.DdRoute;

  const RING_PAD = 5;
  const HANDLE = 9;
  // Outside the rings, so the frame reads as around them rather than on them.
  const FRAME_PAD = 12;

  /* What is drawn around several boxes at once.
   *
   * A ring on each, so you can see exactly what you have, and one frame around
   * the lot, so you can see that it is one thing now. No handles: connecting
   * and resizing are things you do to a box, and offering them on a selection
   * of nine would be offering something that has no meaning yet.
   */
  function frameMarkup(boxes) {
    const left = Math.min(...boxes.map((at) => at.x));
    const top = Math.min(...boxes.map((at) => at.y));
    const right = Math.max(...boxes.map((at) => at.x + at.w));
    const bottom = Math.max(...boxes.map((at) => at.y + at.h));
    const rings = boxes.map((at) =>
      `<rect class="dd-ring dd-ring-one" x="${round(at.x - RING_PAD)}" y="${round(at.y - RING_PAD)}"`
      + ` width="${round(at.w + (RING_PAD * 2))}" height="${round(at.h + (RING_PAD * 2))}" rx="9"/>`).join("");

    return `<g class="dd-marks dd-marks-many">${rings}`
      + `<rect class="dd-frame" x="${round(left - FRAME_PAD)}" y="${round(top - FRAME_PAD)}"`
      + ` width="${round(right - left + (FRAME_PAD * 2))}"`
      + ` height="${round(bottom - top + (FRAME_PAD * 2))}" rx="4"/></g>`;
  }

  // The lines that say why a box stopped where it did. Drawn while a drag is
  // happening and taken out again when it ends: they are an explanation, not
  // part of the diagram.
  function guidesMarkup(guides) {
    return guides.map((guide) => (guide.axis === "x"
      ? `<line class="dd-guide" x1="${round(guide.at)}" y1="${round(guide.from)}"`
        + ` x2="${round(guide.at)}" y2="${round(guide.to)}"/>`
      : `<line class="dd-guide" x1="${round(guide.from)}" y1="${round(guide.at)}"`
        + ` x2="${round(guide.to)}" y2="${round(guide.at)}"/>`)).join("");
  }

  // The rubber band, while it is being pulled. Not part of the diagram and not
  // in the model — it is drawn straight into the SVG and taken out again.
  function marqueeMarkup(box) {
    return `<rect class="dd-marquee" x="${round(box.x)}" y="${round(box.y)}"`
      + ` width="${round(box.w)}" height="${round(box.h)}"/>`;
  }

  /* The eight grips, and which edges each one drags.
   *
   * -1 is the left or the top edge, 1 the right or the bottom, 0 an axis this
   * grip leaves alone. Which is the whole of what tells a corner from a side:
   * a corner moves two edges and a side moves one.
   */
  const GRIPS = [
    ["nw", -1, -1], ["n", 0, -1], ["ne", 1, -1],
    ["w", -1, 0], ["e", 1, 0],
    ["sw", -1, 1], ["s", 0, 1], ["se", 1, 1]
  ];

  const RESIZE_R = 5;

  function marksMarkup(at) {
    const cx = at.x + at.w + HANDLE + 2;
    const cy = at.y + (at.h / 2);

    /* A grip sits on the edge it drags, and a corner grip on the corner. Circles
     * rather than squares, because a handle grown for a finger has to grow about
     * its own middle — a square given a bigger width grows down and to the
     * right, off the corner it was marking.
     */
    const grips = GRIPS.map(([name, gx, gy]) =>
      `<circle class="dd-handle dd-resize" data-role="resize" data-grip="${name}"`
      + ` cx="${round(at.x + ((gx + 1) / 2 * at.w))}"`
      + ` cy="${round(at.y + ((gy + 1) / 2 * at.h))}" r="${RESIZE_R}"/>`).join("");

    return `<g class="dd-marks">`
      + `<rect class="dd-ring" x="${round(at.x - RING_PAD)}" y="${round(at.y - RING_PAD)}"`
      + ` width="${round(at.w + (RING_PAD * 2))}" height="${round(at.h + (RING_PAD * 2))}" rx="9"/>`
      + `<circle class="dd-handle dd-connect" data-role="connect"`
      + ` cx="${round(cx)}" cy="${round(cy)}" r="${HANDLE}"/>`
      + `<path class="dd-handle-mark" d="M${round(cx - 4)},${round(cy)} h8 M${round(cx)},${round(cy - 4)} v8"/>`
      + grips
      + `</g>`;
  }

  /* The handles on the arrows of the box being worked on.
   *
   * Only that box's arrows. Every waypoint of every arrow in a diagram of two
   * hundred would be two hundred handles nobody asked for, and the arrow you
   * want to bend is on the thing you are looking at.
   *
   * Two kinds: a round one at each corner somebody put there, dragged to move
   * it, and a square one at each end of the line, dragged round the box to say
   * which side the line should leave from.
   */
  const VIA_R = 6;
  const PIN_R = 5;

  function edgeMarks(edges, layout, id, spread) {
    const out = [];

    for (const [index, edge] of (edges || []).entries()) {
      if (edge.from !== id && edge.to !== id) {
        continue;
      }

      const route = routeEdge(layout, edge, spread[index]);
      if (!route) {
        continue;
      }

      for (const [at, [x, y]] of wayPoints(edge).entries()) {
        out.push(`<circle class="dd-handle dd-via" data-role="via" data-edge="${index}"`
          + ` data-at="${at}" cx="${round(x)}" cy="${round(y)}" r="${VIA_R}"/>`);
      }

      const ends = [route.points[0], route.points[route.points.length - 1]];
      for (const [end, [x, y]] of ends.entries()) {
        out.push(`<rect class="dd-handle dd-pin" data-role="pin" data-edge="${index}"`
          + ` data-end="${end}" x="${round(x - PIN_R)}" y="${round(y - PIN_R)}"`
          + ` width="${PIN_R * 2}" height="${PIN_R * 2}" rx="2"/>`);
      }
    }

    return out.length > 0 ? `<g class="dd-edge-marks">${out.join("")}</g>` : "";
  }

  /* --- Routing -----------------------------------------------------------
   *
   * An arrow leaves a box at right angles, turns at most twice, and does not
   * pass through anything on the way. Candidates are generated cheapest first —
   * straight, then one bend, then around the top or the bottom — and the first
   * one that misses every other box wins. If they all hit something, the
   * simplest one is used anyway: an arrow that crosses a box is worse than an
   * arrow that does not, and much better than no arrow.
   */


  global.DdMarks = {
    RING_PAD, HANDLE, FRAME_PAD, frameMarkup, guidesMarkup, marqueeMarkup, GRIPS, RESIZE_R,
    marksMarkup, edgeMarks
  };
})(typeof window === "undefined" ? globalThis : window);
