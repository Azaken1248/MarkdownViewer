/* Drawing a flowchart, given somewhere to put every box.
 *
 * Mermaid draws a diagram by deciding where everything goes. This draws one
 * that has already been decided — the layout comments in the fence say where
 * each box is and how big it is, and what is left is arithmetic: a shape per
 * box, a route per arrow, and text in the middle of both.
 *
 * Which means a diagram that carries its own layout never downloads the 3.5MB
 * engine at all. It also means the drawing is made of ordinary elements with
 * ordinary classes on them, so the theme colours it the way it colours
 * everything else, and a box can be dragged without anything being re-rendered
 * around it — the editor moves one <g> and re-routes the arrows that touch it.
 *
 * Nothing here reads the document. Given a model and a layout it returns a
 * string, which is what makes the same picture reachable from the editor, from
 * the page, and from a test.
 */
(function (global) {

  "use strict";

  const {
    Model, STANDOFF, CLEARANCE, LINE_HEIGHT, LEADING, GRID_STEP, leadFor, escapeText, round
  } = global.DdBase;
  const { paintOf, sizeOf, cellSize, COLOUR_RE, TEXT_SIZE } = global.DdPaint;
  const { shapeMarkup, cellBoxes, cellAt, nodeBody, nodeMarkup } = global.DdShapes;
  const { END_KINDS, endsOf } = global.DdEnds;
  const {
    anchorOn, autoSides, midpoint, pathCurved, pathData, pinnedSides,
    routeEdge, shapeOf, sideTowards, wayPoints
  } = global.DdRoute;
  const { lanes, markerDefs, edgeMarkup } = global.DdEdges;
  const {
    GRIPS, frameMarkup, guidesMarkup, marqueeMarkup, marksMarkup, edgeMarks
  } = global.DdMarks;
  const {
    GROUP_HEAD, GROUP_PAD, groupBoxes, groupDepths, groupName, nestingDepths,
    surrounds, viewOf, groupMarkup
  } = global.DdGroups;

  // A `let`, so it stays with the only thing that moves it. A module that
  // destructured it would get the number it held at load and keep it forever.
  let drawCounter = 0;
  function render(model, options = {}) {
    const layout = options.layout || Model.ensureLayout(model);
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    const groups = Array.isArray(model?.groups) ? model.groups : [];
    const frames = groupBoxes(model, layout);
    /* A frame reaches further than the boxes it holds, so the paper has to be
     * measured with the frames in it — otherwise a group on the edge of a
     * diagram is cut off by exactly its own padding. Ids cannot collide: the
     * parser refuses a group named after a box. */
    const bounds = Model.layoutBounds({ ...layout, ...frames });
    drawCounter += 1;
    // One name per end style per drawing: two diagrams on a page must not share
    // a marker id, and one diagram must not define the same marker twice.
    const arrowId = (name) => `dd-end-${name}-${drawCounter}`;

    const pad = Number(options.pad) || 0;
    const width = bounds.w + pad;
    const height = bounds.h + pad;
    // Where the drawing starts, which is the origin unless something has been
    // put to the left of it or above it.
    const from = { x: bounds.x, y: bounds.y };
    const gridId = `dd-grid-${drawCounter}`;

    // A viewport is a window onto a diagram with no edges, so nothing in it is
    // measured against how big the diagram happens to be.
    const view = options.viewport ? viewOf(options.view) : null;
    const moved = view ? `translate(${round(view.x)},${round(view.y)}) scale(${view.scale})` : "";

    const defs = `<defs>${markerDefs(edges, arrowId)}`
      + (options.grid
        ? `<pattern id="${gridId}" width="${GRID_STEP}" height="${GRID_STEP}"`
          + ` patternUnits="userSpaceOnUse"${view ? ` patternTransform="${moved}"` : ""}>`
          // The paper's own colour goes inside the pattern rather than on the
          // rect. A `fill` in the stylesheet beats a `fill` attribute on the
          // element — presentation attributes lose to every author rule — so
          // painting the rect in CSS painted straight over the grid, and the
          // grid has never once been seen.
          + `<rect class="dd-grid-back" width="${GRID_STEP}" height="${GRID_STEP}"/>`
          + `<path class="dd-grid-line" d="M${GRID_STEP},0 L0,0 L0,${GRID_STEP}"/></pattern>`
        : "")
      + `</defs>`;

    /* The paper. Also what a click lands on when it lands on nothing, which is
     * how a box is put down.
     *
     * In a viewport it is the whole window and it never moves — the pattern
     * inside it is what pans and zooms, which is how the grid can be endless
     * without anything having to decide how endless.
     */
    let paper = "";
    if (options.grid) {
      paper = view
        ? `<rect class="dd-paper" x="0" y="0" width="100%" height="100%" fill="url(#${gridId})"/>`
        : `<rect class="dd-paper" x="${round(from.x)}" y="${round(from.y)}"`
          + ` width="${round(width)}" height="${round(height)}" fill="url(#${gridId})"/>`;
    }

    const spread = lanes(edges);
    const parts = [];
    const editing = Boolean(view || options.natural);

    /* Drawn from the outside in.
     *
     * A box that holds another is background to it, so it is painted first;
     * everything inside it, and every arrow reaching inside it, is painted
     * after. A diagram with nothing inside anything is one layer of arrows and
     * one of boxes, which is what it always was.
     */
    /* The groups, outermost first, before anything they hold.
     *
     * A frame is background: it says what belongs together, and everything it
     * says that about is drawn on top of it. Nesting order matters for the
     * same reason it does between boxes — an inner frame painted first would
     * be painted over by the outer one that surrounds it.
     */
    const nesting = groupDepths(groups);
    const outward = groups
      .filter((group) => frames[group.id])
      .sort((one, two) => (nesting.get(one.id) || 0) - (nesting.get(two.id) || 0));

    if (outward.length > 0) {
      parts.push(`<g class="dd-groups">${outward
        .map((group) => groupMarkup(group, frames[group.id])).join("")}</g>`);
    }

    const depths = nestingDepths(nodes, layout);
    const depthOf = (id) => depths.get(id) || 0;
    const deepest = Math.max(0, ...depths.values());

    for (let level = 0; level <= deepest; level += 1) {
      const lines = edges
        .map((edge, index) => [edge, index])
        .filter(([edge]) => Math.max(depthOf(edge.from), depthOf(edge.to)) === level);

      // The outermost layer is always written, empty or not, because a drawing
      // with no arrows in it still has a place arrows go.
      if (level === 0 || lines.length > 0) {
        parts.push(`<g class="dd-edges">${lines
          .map(([edge, index]) =>
            edgeMarkup(edge, index, layout, arrowId, spread[index], editing))
          .join("")}</g>`);
      }

      const layer = nodes.filter((node) => layout[node.id] && depthOf(node.id) === level);

      if (level === 0 || layer.length > 0) {
        parts.push(`<g class="dd-nodes">${layer
          .map((node) => nodeMarkup(node, layout[node.id], model?.classes)).join("")}</g>`);
      }
    }

    /* What is selected: one id, or a list of them. One box gets the ring and
     * the handles it has always had; several get a ring each and one frame.
     */
    const chosen = (Array.isArray(options.selected) ? options.selected : [options.selected])
      .filter((id) => id && layout[id])
      .map((id) => layout[id]);

    if (chosen.length === 1) {
      parts.push(marksMarkup(chosen[0]));
      parts.push(edgeMarks(edges, layout,
        (Array.isArray(options.selected) ? options.selected : [options.selected])
          .find((one) => one && layout[one]),
        spread));
    } else if (chosen.length > 1) {
      parts.push(frameMarkup(chosen));
    }

    // Everything that belongs to the diagram rather than to the window goes in
    // one group, so panning and zooming is one attribute written once.
    const body = view
      ? `<g class="dd-view" transform="${moved}">${parts.join("")}</g>`
      : parts.join("");

    /* Three ways to be sized. In a viewport, the window it was given, with no
     * viewBox at all so that one unit is one pixel and the transform above is
     * the only scale there is. On a page, width in percent with a max-width in
     * pixels, which is what every other diagram there does. In the old
     * in-document editor, its own size exactly.
     */
    if (view) {
      return `<svg class="dd dd-editing dd-viewport" xmlns="http://www.w3.org/2000/svg"`
        + ` width="100%" height="100%" role="application"`
        + ` aria-label="${escapeText(options.label || "Diagram")}">${defs}${paper}${body}</svg>`;
    }

    const size = options.natural
      ? ` width="${round(width)}" height="${round(height)}"`
      : ` width="100%" style="max-width: ${round(width)}px"`;

    return `<svg class="dd${options.natural ? " dd-editing" : ""}" xmlns="http://www.w3.org/2000/svg"`
      + ` viewBox="${round(from.x)} ${round(from.y)} ${round(width)} ${round(height)}"${size} role="img"`
      + ` aria-label="${escapeText(options.label || "Diagram")}">${defs}${paper}${body}</svg>`;
  }

  /* --- Saving a picture of it ----------------------------------------------
   *
   * A drawing that can be opened somewhere this app is not.
   *
   * On the page a diagram is drawn by markup this file writes, painted by rules
   * in app.css, in the colours of whichever theme is on. Only the first of
   * those three is inside the SVG, so an SVG saved as it stands opens elsewhere
   * as a heap of black shapes on white.
   *
   * So an export carries the other two with it: the rules written for `.dd`,
   * lifted out of the app's own stylesheet rather than written out again here,
   * and the value of every variable those rules fall back to, read from the
   * page as it is now. What is saved is what was on the screen, in the theme it
   * was on the screen in.
   */

  /* Every rule in the stylesheet that is about the drawing, and only the ones
   * at the top of it.
   *
   * Scanned rather than matched with a pattern: a stylesheet is nested, and a
   * regular expression that walks one is a regular expression that quietly
   * takes every other rule. What is inside a @media is about the screen it is
   * being read on, and a saved file has no screen.
   */
  function exportRules(css) {
    const text = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
    const out = [];

    let depth = 0;
    let from = 0;
    let opened = 0;
    let selector = "";

    for (let at = 0; at < text.length; at += 1) {
      if (text[at] === "{") {
        if (depth === 0) {
          selector = text.slice(from, at).trim();
          opened = at;
        }

        depth += 1;
      } else if (text[at] === "}") {
        depth -= 1;

        if (depth === 0) {
          if (!selector.startsWith("@") && selector.includes(".dd")) {
            const body = text.slice(opened + 1, at).trim().replace(/\s+/g, " ");
            out.push(`${selector.replace(/\s+/g, " ")}{${body}}`);
          }

          from = at + 1;
        }
      }
    }

    return out.join("\n");
  }

  /* The theme, as far as those rules reach into it.
   *
   * Gathered from the rules rather than listed here, so a rule that starts
   * falling back to one more variable takes it with it and nobody has to
   * remember. `--dd-*` are the box's own, set on the group as it is drawn, and
   * pinning them at the root would paint every box the same colour.
   */
  const EXPORT_VAR_RE = /var\((--[a-z0-9-]+)/gi;

  function exportPalette(rules, read) {
    const names = new Set();
    for (const [, name] of String(rules || "").matchAll(EXPORT_VAR_RE)) {
      if (!name.startsWith("--dd-")) {
        names.add(name);
      }
    }

    let out = "";
    for (const name of [...names].sort()) {
      const value = String(read(name) || "").trim();
      if (value) {
        out += `${name}:${value};`;
      }
    }

    return out;
  }

  /* The whole of it: the drawing, the rules it needs, and the colours those
   * rules ask for, in one file that stands on its own.
   *
   * A background is painted rather than left transparent. A diagram saved out
   * of a dark theme is pale lines, and pale lines on whatever the reader's
   * document happens to be is a picture of nothing.
   */
  function exportSvg(model, options = {}) {
    const layout = options.layout || Model.ensureLayout(model);
    const bounds = Model.layoutBounds(layout);
    const rules = exportRules(options.css);
    const palette = exportPalette(rules, options.read || (() => ""));

    const drawn = render(model, { natural: true, layout, label: options.label });
    const opens = drawn.indexOf(">");

    const back = COLOUR_RE.test(String(options.background || "").trim())
      ? `<rect x="${round(bounds.x)}" y="${round(bounds.y)}"`
        + ` width="${round(bounds.w)}" height="${round(bounds.h)}"`
        + ` fill="${escapeText(String(options.background).trim())}"/>`
      : "";

    return `${drawn.slice(0, opens)}${palette ? ` style="${escapeText(palette)}"` : ""}>`
      + `<style>${rules}</style>${back}${drawn.slice(opens + 1)}`;
  }

  // How big the saved picture is, which is how big the diagram is.
  function exportSize(model, layout) {
    const bounds = Model.layoutBounds(layout || Model.ensureLayout(model));
    return { w: Math.max(1, Math.round(bounds.w)), h: Math.max(1, Math.round(bounds.h)) };
  }

  /* What this can draw.
   *
   * The parser understands more than the drawing does, deliberately: reading a
   * group has to come before drawing one, and a diagram whose groups this would
   * silently leave out is a diagram better handed to Mermaid, which draws them.
   * The alternative — drawing it anyway — loses the boxes around things without
   * saying so.
   */
  // Source in, drawing out, or null for anything this cannot honestly draw —
  // which is the same narrowness the builder has, for the same reason.
  function renderSource(source, options = {}) {
    if (!Model || !Model.hasLayout(source)) {
      return null;
    }

    const model = Model.parseFlowchart(source);
    if (!model.ok) {
      return null;
    }

    return render(model, { ...options, layout: Model.ensureLayout(model) });
  }

  global.DiagramDraw = {
    viewOf,
    render,
    renderSource,
    nodeBody,
    paintOf,
    endsOf,
    shapeOf,
    edgeMarks,
    surrounds,
    sideTowards,
    pathCurved,
    wayPoints,
    pinnedSides,
    anchorOn,
    autoSides,
    nestingDepths,
    groupDepths,
    groupBoxes,
    groupName,
    GROUP_PAD,
    GROUP_HEAD,
    END_KINDS,
    marksMarkup,
    frameMarkup,
    marqueeMarkup,
    guidesMarkup,
    routeEdge,
    lanes,
    pathData,
    midpoint,
    shapeMarkup,
    cellBoxes,
    cellAt,
    sizeOf,
    cellSize,
    exportRules,
    exportPalette,
    exportSvg,
    exportSize,
    STANDOFF,
    CLEARANCE,
    LINE_HEIGHT,
    LEADING,
    leadFor,
    GRIPS,
    TEXT_SIZE
  };
})(typeof window === "undefined" ? globalThis : window);
