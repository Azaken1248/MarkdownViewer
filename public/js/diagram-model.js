/* A flowchart as a list of steps and a list of arrows, so one can be built
 * without typing Mermaid.
 *
 * Mermaid has no coordinates in it. A flowchart says what connects to what and
 * the layout engine decides where everything goes, so a canvas you drag boxes
 * around on is a canvas whose positions have nowhere to be written down.
 *
 * Except that every Mermaid parser throws comments away, which is a place to
 * write them down:
 *
 *     flowchart TD
 *         %% layout v1
 *         %% @ A 40,40 160x56
 *         %% @ B 40,180 160x56
 *         A[Start]
 *         B[End]
 *         A --> B
 *
 * That is still a flowchart. GitHub renders it, auto-arranged, exactly as it
 * always did. Here it is drawn where it was put — we draw it ourselves, from
 * these numbers, rather than asking a layout engine that has no way to be told.
 * A diagram with no layout line in it has never been arranged, and is laid out
 * on the way in so there is something to drag.
 *
 * The parser is deliberately narrow. It accepts a flowchart made of node
 * declarations and links and nothing else: no subgraphs, no classDef, no
 * styles, no click handlers, no comments. Everything it does not model, it
 * refuses outright rather than dropping — a builder that quietly deletes the
 * styling off someone's diagram is worse than a builder that declines to open
 * it. A refused diagram is still editable as source, which is where it came
 * from.
 *
 * Within that, the identity that matters is not source to source — a diagram is
 * rewritten properly when it is edited, the same way a table is — but model to
 * model:
 *
 *     parse(serialize(model)) deep-equals model
 *
 * which is what makes a round trip through the builder lossless for everything
 * the builder can see.
 */
(function (global) {
  "use strict";

  const {
    ACTOR_BAND, ACTOR_LEAST, DIRECTIONS, DRAWN_SHAPES, EDGE_KINDS, LINE_STYLES,
    ROUTE_DEFAULT, ROUTE_SHAPES, SHAPES, SHAPE_CHOICES, lineStyleOf, linkFor
  } = global.DmShapes;
  const {
    GRID, HAS_LAYOUT_RE, LAYOUT_MARK, MARGIN, MAX_EDGES, MAX_NODES, NODE_KINDS,
    TABLE_GAP, TABLE_PAD, quoteText, snap, tableMetrics, unquoteText, wordsOnly
  } = global.DmGrammar;
  const {
    CELL_MARKS, CELL_SIZE, FONT_SIZE, TEXT_SIZE, cellDeclarations, cellKey, cellToken,
    columnsOf, fontScale, joinCells, joinRows, readCellStyles, resizeGrid, textCells,
    textRows, writeCellStyles
  } = global.DmCells;
  const { parseFlowchart } = global.DmParse;
  const { serializeFlowchart } = global.DmSerialize;
  const { autoLayout, ensureLayout, layoutBounds, measureNode } = global.DmLayout;

  const GUIDE_KINDS = [
    ["x", "left", (at) => at.x],
    ["x", "centre", (at) => at.x + (at.w / 2)],
    ["x", "right", (at) => at.x + at.w],
    ["y", "top", (at) => at.y],
    ["y", "middle", (at) => at.y + (at.h / 2)],
    ["y", "bottom", (at) => at.y + at.h]
  ];

  function alignGuides(moving, others, within = 6) {
    const found = { x: null, y: null };

    for (const [axis, , edgeOf] of GUIDE_KINDS) {
      const mine = edgeOf(moving);

      for (const other of others) {
        for (const [otherAxis, , otherEdge] of GUIDE_KINDS) {
          if (otherAxis !== axis) {
            continue;
          }

          const theirs = otherEdge(other);
          const gap = theirs - mine;

          // The nearest one wins, and a tie goes to the one found first, which
          // is the leftmost or topmost edge — so a box between two others does
          // not flicker between them as the hand shakes.
          if (Math.abs(gap) <= within && (!found[axis] || Math.abs(gap) < Math.abs(found[axis].gap))) {
            found[axis] = { gap, at: theirs, other };
          }
        }
      }
    }

    const put = {
      x: moving.x + (found.x ? found.x.gap : 0),
      y: moving.y + (found.y ? found.y.gap : 0)
    };

    // A line long enough to reach both the box that snapped and the box it
    // snapped to, so it is obvious which two are being lined up.
    const guides = [];
    for (const axis of ["x", "y"]) {
      const hit = found[axis];
      if (!hit) {
        continue;
      }

      const box = { ...moving, ...put };
      const across = axis === "x" ? "y" : "x";
      const size = across === "y" ? "h" : "w";
      const from = Math.min(box[across], hit.other[across]);
      const to = Math.max(box[across] + box[size], hit.other[across] + hit.other[size]);
      guides.push({ axis, at: hit.at, from, to });
    }

    return { x: put.x, y: put.y, guides };
  }

  /* Where the diagram actually is, rather than how big it is from the origin.
   *
   * layoutBounds answers "how large a picture is this", which is what sizing a
   * drawing on a page needs and which assumes the diagram starts at the corner.
   * On an endless canvas it does not: a box can be dragged to -400, and fitting
   * the view to a rectangle that starts at zero would put half the diagram off
   * the top of the window.
   */
  function layoutExtent(layout) {
    const boxes = Object.values(layout || {});

    if (boxes.length === 0) {
      return { x: 0, y: 0, w: MARGIN * 2, h: MARGIN * 2 };
    }

    const left = Math.min(...boxes.map((at) => at.x));
    const top = Math.min(...boxes.map((at) => at.y));

    return {
      x: left,
      y: top,
      w: Math.max(...boxes.map((at) => at.x + at.w)) - left,
      h: Math.max(...boxes.map((at) => at.y + at.h)) - top
    };
  }

  // Cheap enough to ask of every fenced block on a page, which is where it is
  // asked: a diagram that carries its own layout is one we draw ourselves, and
  // one that does not is one the engine has to be downloaded for.
  function hasLayout(source) {
    return HAS_LAYOUT_RE.test(String(source == null ? "" : source));
  }

  // An id nothing in the model is using. Named for the machine, not the
  // person — what a box is called is its text, which is edited directly.
  function nextNodeId(model) {
    const used = new Set((model?.nodes || []).map((node) => node.id));

    for (let n = 1; ; n += 1) {
      const id = `n${n}`;
      if (!used.has(id)) {
        return id;
      }
    }
  }

  function isFlowchart(source) {
    return parseFlowchart(source).ok;
  }

  global.DiagramModel = {
    DIRECTIONS,
    SHAPES,
    DRAWN_SHAPES,
    ACTOR_BAND,
    ACTOR_LEAST,
    SHAPE_CHOICES,
    EDGE_KINDS,
    ROUTE_SHAPES,
    ROUTE_DEFAULT,
    LINE_STYLES,
    lineStyleOf,
    linkFor,
    NODE_KINDS,
    wordsOnly,
    MAX_NODES,
    MAX_EDGES,
    GRID,
    MARGIN,
    LAYOUT_MARK,
    autoLayout,
    ensureLayout,
    layoutBounds,
    layoutExtent,
    alignGuides,
    measureNode,
    hasLayout,
    textRows,
    joinRows,
    textCells,
    joinCells,
    columnsOf,
    resizeGrid,
    CELL_MARKS,
    CELL_SIZE,
    TEXT_SIZE,
    FONT_SIZE,
    fontScale,
    cellKey,
    readCellStyles,
    writeCellStyles,
    cellDeclarations,
    cellToken,
    tableMetrics,
    TABLE_PAD,
    TABLE_GAP,
    snap,
    parseFlowchart,
    serializeFlowchart,
    nextNodeId,
    isFlowchart,
    quoteText,
    unquoteText
  };
})(typeof window === "undefined" ? globalThis : window);
