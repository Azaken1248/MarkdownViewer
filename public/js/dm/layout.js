/* Where the boxes go when nobody has said.
 *
 * A diagram with no layout comment has never been arranged, so it is arranged
 * here — ranked by what points at what, spread along the direction the
 * flowchart declares — and from then on the file remembers its own positions.
 * measureNode is what decides how big a box has to be to hold its words.
 */
(function (global) {
  "use strict";

  const { ACTOR_BAND, ACTOR_LEAST, DIRECTIONS } = global.DmShapes;
  const {
    CHAR_WIDTH, LINE_HEIGHT, MARGIN, MIN_HEIGHT, MIN_WIDTH, PAD_X, PAD_Y, RANK_GAP,
    SIBLING_GAP, TABLE_MIN_TEXT, TABLE_MIN_WIDTH, tableMetrics, snap, snapUp
  } = global.DmGrammar;
  const { columnsOf, fontScale, textCells, textRows } = global.DmCells;

  function measureNode(node, options = {}) {
    const kind = node?.kind;
    const rows = textRows(node?.text ?? node?.id ?? "");
    const widest = rows.reduce((most, row) => Math.max(most, row.length), 0);
    /* Type twice the size needs twice the room, both ways. A box measured at
     * the standard size and then set in 32px is a box its own words no longer
     * fit in — and the measure is the one thing that could have known.
     */
    const type = fontScale(options.font);
    let width = Math.max(MIN_WIDTH, (widest * CHAR_WIDTH * type) + PAD_X);
    let height = Math.max(MIN_HEIGHT, (rows.length * LINE_HEIGHT * type) + PAD_Y);

    if (kind === "table") {
      /* Every column needs room to be read in, whatever is in it — a word, and
       * the padding either side of it — so a table is at least so wide per
       * column. Which is what makes another column widen the table rather than
       * divide the width it already had.
       *
       * Nothing here adds the cells up. The measure above is of the longest
       * line, and a line already contains the " | " between each pair of cells:
       * three characters, which is more than a cell saves by not having them.
       * A sum of the columns is therefore never the larger of the two and was
       * only ever arithmetic nobody read.
       */
      const columns = columnsOf(textCells(node?.text ?? node?.id ?? ""));
      const spacing = tableMetrics(node);

      width = Math.max(width, TABLE_MIN_WIDTH,
        columns * (TABLE_MIN_TEXT + (spacing.pad * 2)));
      /* Exactly what the drawing gives it: a title band, which is a heading
       * rather than a row, and a row's worth of spacing for each row under it.
       */
      height = Math.max(MIN_HEIGHT,
        spacing.title + (Math.max(0, rows.length - 1) * spacing.gap));
    } else if (node?.shape === "diamond") {
      // A diamond only holds text across its middle.
      width *= 1.35;
      height *= 1.5;
    } else if (node?.shape === "circle" || node?.shape === "double-circle") {
      const side = Math.max(width, height * 1.4);
      width = side;
      height = side;
    } else if (node?.shape === "hexagon" || node?.shape === "lean-right"
      || node?.shape === "lean-left" || node?.shape === "trapezoid"
      || node?.shape === "trapezoid-alt") {
      // Slanted sides eat into the width at the top or the bottom.
      width += 34;
    } else if (node?.shape === "note") {
      // The folded corner takes a bite out of the top right.
      width += 16;
    } else if (node?.shape === "cloud") {
      // The words sit in the middle band; the bumps are all margin.
      width *= 1.5;
      height *= 1.8;
    } else if (node?.shape === "queue") {
      // A cylinder lying down: a rounded cap at each end, neither of which is
      // anywhere to write.
      width += 44;
    } else if (node?.shape === "actor") {
      /* A drawing with its name underneath rather than a box with words in it,
       * so the height is what the figure needs and the words are extra. Below
       * a certain size a stick figure stops being one.
       */
      width = Math.max(width, 90);
      height = Math.max(ACTOR_LEAST, height / (1 - ACTOR_BAND));
    }

    return { w: snapUp(width), h: snapUp(height) };
  }

  /* The edges that go forwards.
   *
   * A flowchart with a loop in it — "no, go back and try again" — has no
   * longest path, and ranking one anyway walks the boxes round and round until
   * a cap stops it, leaving the first step somewhere in the middle. So the
   * loops are found first, by depth-first search from the boxes nothing points
   * at, and an edge back to a box already on the stack is left out of the
   * ranking. It is still drawn; it just does not get a say in what is above
   * what.
   */
  function forwardEdges(nodes, edges) {
    const out = new Map(nodes.map((node) => [node.id, []]));

    for (const edge of edges) {
      if (edge.from !== edge.to && out.has(edge.from) && out.has(edge.to)) {
        out.get(edge.from).push(edge);
      }
    }

    const targeted = new Set(edges.map((edge) => edge.to));
    const roots = nodes.filter((node) => !targeted.has(node.id));
    const starts = (roots.length > 0 ? roots : nodes).map((node) => node.id);

    const seen = new Set();
    const stack = new Set();
    const forward = [];
    const dropped = new Set();

    const walk = (id) => {
      // Explicitly a stack rather than recursion: sixty boxes in a line is a
      // sixty-deep call chain for no reason.
      const frames = [{ id, at: 0 }];
      stack.add(id);
      seen.add(id);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        const next = out.get(frame.id)[frame.at];

        if (!next) {
          stack.delete(frame.id);
          frames.pop();
          continue;
        }

        frame.at += 1;

        if (stack.has(next.to)) {
          dropped.add(next);
          continue;
        }

        forward.push(next);

        if (!seen.has(next.to)) {
          seen.add(next.to);
          stack.add(next.to);
          frames.push({ id: next.to, at: 0 });
        }
      }
    };

    for (const id of starts) {
      if (!seen.has(id)) {
        walk(id);
      }
    }

    // Anything unreachable from a root — a ring of boxes with nothing pointing
    // into it — still has to be ranked, so it gets walked too.
    for (const node of nodes) {
      if (!seen.has(node.id)) {
        walk(node.id);
      }
    }

    return forward.filter((edge) => !dropped.has(edge));
  }

  /* An arrangement for a diagram that has never had one.
   *
   * Rank by longest path from the boxes nothing points at, spread each rank
   * across the flow, and let the direction decide which way "along" is. It is
   * not dagre and it is not trying to be: it exists so that the first thing you
   * see when you open a diagram is a diagram, not a pile.
   */
  function autoLayout(model) {
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    const direction = DIRECTIONS.includes(model?.direction) ? model.direction : "TD";
    const layout = {};

    if (nodes.length === 0) {
      return layout;
    }

    const rank = new Map(nodes.map((node) => [node.id, 0]));
    const forward = forwardEdges(nodes, edges);

    // Longest path over the edges that go forwards. With the loops taken out
    // there is nothing left to relax in a circle, so this settles in at most
    // one pass per node and usually in one or two.
    for (let pass = 0; pass < nodes.length; pass += 1) {
      let moved = false;

      for (const edge of forward) {
        const want = rank.get(edge.from) + 1;
        if (want > rank.get(edge.to)) {
          rank.set(edge.to, want);
          moved = true;
        }
      }

      if (!moved) {
        break;
      }
    }

    const ranks = new Map();
    for (const node of nodes) {
      const at = rank.get(node.id);
      if (!ranks.has(at)) {
        ranks.set(at, []);
      }
      ranks.get(at).push(node);
    }

    const down = direction === "TB" || direction === "TD" || direction === "BT";
    const back = direction === "BT" || direction === "RL";
    const sizes = new Map(nodes.map((node) => [node.id, measureNode(node)]));
    const placed = [];
    let along = 0;

    for (const at of [...ranks.keys()].sort((a, b) => a - b)) {
      const group = ranks.get(at);
      const across = group.reduce((total, node) => {
        const size = sizes.get(node.id);
        return total + (down ? size.w : size.h);
      }, 0) + (SIBLING_GAP * (group.length - 1));

      let cross = -across / 2;
      let depth = 0;

      for (const node of group) {
        const size = sizes.get(node.id);
        const long = down ? size.h : size.w;
        const wide = down ? size.w : size.h;

        placed.push({
          id: node.id,
          x: down ? cross : (back ? -along - size.w : along),
          y: down ? (back ? -along - size.h : along) : cross,
          w: size.w,
          h: size.h
        });

        cross += wide + SIBLING_GAP;
        depth = Math.max(depth, long);
      }

      along += depth + RANK_GAP;
    }

    // Everything is placed around zero and around a middle line; shift it so
    // the whole diagram sits in the positive quarter with a margin round it.
    const left = Math.min(...placed.map((at) => at.x));
    const top = Math.min(...placed.map((at) => at.y));

    for (const at of placed) {
      layout[at.id] = {
        x: snap(at.x - left + MARGIN),
        y: snap(at.y - top + MARGIN),
        w: at.w,
        h: at.h
      };
    }

    return layout;
  }

  /* A layout covering every box in the model, whatever it started with.
   *
   * A diagram can gain a box without gaining a position for it — somebody
   * edited the source by hand, or pasted a line in — and a box with no position
   * has to be drawn somewhere. Somewhere is a row underneath the rest, where it
   * is obviously new and obviously not on top of anything.
   */
  function ensureLayout(model) {
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const known = model?.layout && typeof model.layout === "object" ? model.layout : null;

    if (!known) {
      return autoLayout(model);
    }

    const layout = {};
    const missing = [];

    for (const node of nodes) {
      const at = known[node.id];

      if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
        layout[node.id] = {
          x: at.x,
          y: at.y,
          w: Number.isFinite(at.w) && at.w > 0 ? at.w : measureNode(node).w,
          h: Number.isFinite(at.h) && at.h > 0 ? at.h : measureNode(node).h
        };
        continue;
      }

      missing.push(node);
    }

    if (missing.length > 0) {
      const below = Object.values(layout).reduce((most, at) => Math.max(most, at.y + at.h), 0);
      let x = MARGIN;
      const y = snap(below === 0 ? MARGIN : below + RANK_GAP);

      for (const node of missing) {
        const size = measureNode(node);
        layout[node.id] = { x, y, w: size.w, h: size.h };
        x = snap(x + size.w + SIBLING_GAP);
      }
    }

    return layout;
  }

  /* How much paper the arrangement takes up, which is the drawing's own size
   * before anything on a page has a say in it.
   *
   * `x` and `y` are where that paper starts. Normally the origin, because a
   * diagram is normally laid out from it — but the canvas has no edges, so a
   * box can be at -400, and a drawing that always began at 0,0 would cut it
   * off. The origin is kept in view when everything is positive, so a diagram
   * laid out the usual way is sized and padded exactly as it always was.
   */
  function layoutBounds(layout) {
    const boxes = Object.values(layout || {});

    if (boxes.length === 0) {
      return { x: 0, y: 0, w: MARGIN * 2, h: MARGIN * 2 };
    }

    /* No margin on this side, which is the convention the origin already set:
     * a box at x=0 has always been drawn flush against the left edge, and the
     * gap in an ordinary diagram is the leftmost box's own x. */
    const left = Math.min(0, ...boxes.map((at) => at.x));
    const top = Math.min(0, ...boxes.map((at) => at.y));

    return {
      x: left,
      y: top,
      w: Math.max(...boxes.map((at) => at.x + at.w)) + MARGIN - left,
      h: Math.max(...boxes.map((at) => at.y + at.h)) + MARGIN - top
    };
  }

  /* Lining a box up with the ones already there.
   *
   * Six lines matter on any box: its left, centre and right, and its top,
   * middle and bottom. When one of the six on the box being moved comes within
   * a few pixels of one of the six on a box that is not moving, the moving box
   * is put exactly on it and a line is drawn to say why. That is the whole of
   * what makes a hand-arranged diagram look arranged rather than nearly
   * arranged.
   *
   * `moving` is where the box would go if nothing were snapping it. `others`
   * are the boxes to line up against. `within` is how close counts, and is in
   * diagram units — the caller divides by the zoom, so that being close is
   * measured by what the eye sees rather than by what the file says.
   *
   * Comes back with where the box should actually go, and the lines to draw.
   */

  global.DmLayout = {
    measureNode, forwardEdges, autoLayout, ensureLayout, layoutBounds
  };
})(typeof window === "undefined" ? globalThis : window);
