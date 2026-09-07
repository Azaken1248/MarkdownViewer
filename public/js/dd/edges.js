/* The arrow itself: its lane, its markers, and its label.
 *
 * Several arrows between the same two boxes are spread into lanes rather than
 * drawn on top of each other, and the marker definitions are emitted once per
 * drawing rather than once per arrow.
 */
(function (global) {
  "use strict";

  const { LABEL_CHAR, escapeText, round } = global.DdBase;
  const { END_ANCHOR, END_BY_NAME, endsOf } = global.DdEnds;
  const { routeEdge } = global.DdRoute;

  const LANE_GAP = 16;

  function lanes(edges) {
    const groups = new Map();

    for (const [index, edge] of (edges || []).entries()) {
      const key = [edge.from, edge.to].sort().join("\u0000");
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(index);
    }

    const spread = new Array((edges || []).length).fill(0);

    for (const group of groups.values()) {
      if (group.length < 2) {
        continue;
      }

      for (const [at, index] of group.entries()) {
        spread[index] = (at - ((group.length - 1) / 2)) * LANE_GAP;
      }
    }

    return spread;
  }

  /* --- What an arrow ends in ------------------------------------------------
   *
   * Mermaid can say four of these in its own syntax — an arrowhead, nothing, a
   * circle and a cross — and a diagram that needs the other four says so in a
   * layout comment while still writing the nearest real link, so the file reads
   * correctly wherever else it is rendered.
   *
   * Each is drawn in a 10x10 marker box pointing along the line, and all of them
   * are anchored at x=10 — their far edge — so the whole shape sits behind the
   * point the line stops at rather than reaching past it. Boxes are drawn after
   * arrows, so anything reaching past that point is painted over by the box it
   * points at, which is how an arrow ends up with its tip cut off.
   */
  function markerDefs(edges, id) {
    const wanted = new Set();

    for (const edge of edges || []) {
      for (const end of endsOf(edge)) {
        wanted.add(end);
      }
    }

    return [...wanted]
      .map((name) => END_BY_NAME.get(name))
      .filter((one) => one && one.d)
      .map((one) => `<marker id="${id(one.name)}" viewBox="0 0 10 10"`
        + ` refX="${END_ANCHOR}" refY="5" markerWidth="7" markerHeight="7"`
        + ` orient="auto-start-reverse">`
        + `<path class="dd-head${one.fill ? "" : " dd-head-hollow"}" d="${one.d}"/></marker>`)
      .join("");
  }

  function edgeMarkup(edge, index, layout, arrowId, spread, editing) {
    const route = routeEdge(layout, edge, spread);
    if (!route) {
      return "";
    }

    /* Both ends, each named. A line with an arrow on it is the ordinary case
     * and it costs one marker; a line that is a UML generalisation or an ERD
     * "many" costs the same, which is the point of doing it this way rather
     * than drawing the shapes into the path.
     */
    const [back, forward] = endsOf(edge);
    const head = (back === "none" ? "" : ` marker-start="url(#${arrowId(back)})"`)
      + (forward === "none" ? "" : ` marker-end="url(#${arrowId(forward)})"`);

    const label = String(edge.label || "").trim();
    const width = (label.length * LABEL_CHAR) + 10;
    const badge = label
      ? `<g class="dd-label" transform="translate(${round(route.mid.x)},${round(route.mid.y)})">`
        + `<rect class="dd-label-back" x="${round(-width / 2)}" y="-10" width="${round(width)}" height="20" rx="4"/>`
        + `<text class="dd-label-text" text-anchor="middle" dominant-baseline="middle" x="0" y="0">${escapeText(label)}</text></g>`
      : "";

    return `<g class="dd-edge dd-edge-${escapeText(edge.kind)}" data-edge="${index}"`
      + ` data-from="${escapeText(edge.from)}" data-to="${escapeText(edge.to)}">`
      /* A line drawn 1.6px wide is 1.6px wide to a finger as well, and bending
       * an arrow means catching hold of it first. So while it is being edited
       * each one carries a second copy of itself, invisible and fat, which is
       * the thing that actually gets pressed.
       */
      + (editing
        ? `<path class="dd-hit" fill="none" stroke="transparent" d="${route.d}"/>`
        : "")
      + `<path class="dd-line" fill="none" d="${route.d}"${head}/>${badge}</g>`;
  }

  /* --- What is inside what -------------------------------------------------
   *
   * Read off where the boxes are rather than off what the file calls a group:
   * a box dragged inside a bigger one is inside it, whatever the diagram says,
   * and it is the dragging that makes anyone notice this at all. Without it the
   * inner box is painted over by the outer one the next time the drawing is
   * made — and so is the arrow that points at it.
   *
   * Strictly bigger, which is also the whole of what stops a box counting
   * itself, and what stops two boxes the same size and place each counting as
   * inside the other and both ending up a layer deeper than everything else.
   */

  global.DdEdges = {
    LANE_GAP, lanes, markerDefs, edgeMarkup
  };
})(typeof window === "undefined" ? globalThis : window);
