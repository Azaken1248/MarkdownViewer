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
  const LABEL_CHAR = 6.2;
  // Twice the snapping step, so every other line is drawn and the paper does
  // not turn into a grey wash.
  const GRID_STEP = 20;
  const TABLE_TITLE = 26;
  const TABLE_PAD = 10;

  let drawCounter = 0;

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

  function shapeMarkup(shape, w, h) {
    const slant = Math.min(SLANT, w / 3);

    switch (shape) {
      case "round":
        return rect(w, h, ROUND_RADIUS);
      case "stadium":
        return rect(w, h, h / 2);
      case "subroutine":
        return `${rect(w, h, RADIUS)}`
          + `<line class="dd-rule" x1="8" y1="0" x2="8" y2="${round(h)}"/>`
          + `<line class="dd-rule" x1="${round(w - 8)}" y1="0" x2="${round(w - 8)}" y2="${round(h)}"/>`;
      case "cylinder": {
        const lip = Math.min(12, h / 4);
        return `<path class="dd-shape" d="M0,${round(lip)} A ${round(w / 2)},${round(lip)} 0 0 1 ${round(w)},${round(lip)}`
          + ` L${round(w)},${round(h - lip)} A ${round(w / 2)},${round(lip)} 0 0 1 0,${round(h - lip)} Z"/>`
          + `<path class="dd-rule" fill="none" d="M0,${round(lip)} A ${round(w / 2)},${round(lip)} 0 0 0 ${round(w)},${round(lip)}"/>`;
      }
      case "circle":
        return `<ellipse class="dd-shape" cx="${round(w / 2)}" cy="${round(h / 2)}" rx="${round(w / 2)}" ry="${round(h / 2)}"/>`;
      case "double-circle":
        return `<ellipse class="dd-shape" cx="${round(w / 2)}" cy="${round(h / 2)}" rx="${round(w / 2)}" ry="${round(h / 2)}"/>`
          + `<ellipse class="dd-rule" fill="none" cx="${round(w / 2)}" cy="${round(h / 2)}" rx="${round((w / 2) - 5)}" ry="${round((h / 2) - 5)}"/>`;
      case "diamond":
        return polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
      case "hexagon":
        return polygon([[slant, 0], [w - slant, 0], [w, h / 2], [w - slant, h], [slant, h], [0, h / 2]]);
      case "lean-right":
        return polygon([[slant, 0], [w, 0], [w - slant, h], [0, h]]);
      case "lean-left":
        return polygon([[0, 0], [w - slant, 0], [w, h], [slant, h]]);
      case "trapezoid":
        return polygon([[slant, 0], [w - slant, 0], [w, h], [0, h]]);
      case "trapezoid-alt":
        return polygon([[0, 0], [w, 0], [w - slant, h], [slant, h]]);
      case "asymmetric":
        return polygon([[0, 0], [w, 0], [w, h], [0, h], [slant, h / 2]]);
      default:
        return rect(w, h, RADIUS);
    }
  }

  /* --- Text --------------------------------------------------------------
   *
   * Centred in the box, one tspan per line, sitting on the middle rather than
   * on a baseline — a box is resized around its text often enough that the text
   * has to stay in the middle of it without being measured again.
   */
  function centredText(rows, w, h) {
    if (rows.length === 0) {
      return "";
    }

    const top = (h / 2) - (((rows.length - 1) * LINE_HEIGHT) / 2);
    const spans = rows.map((row, index) => {
      const y = top + (index * LINE_HEIGHT);
      return `<tspan x="${round(w / 2)}" y="${round(y)}">${escapeText(row)}</tspan>`;
    });

    return `<text class="dd-text" text-anchor="middle" dominant-baseline="middle">${spans.join("")}</text>`;
  }

  // A class box: a title over a rule, then one row per line, left aligned the
  // way a list of fields is read.
  function tableMarkup(rows, w, h) {
    const title = rows[0] || "";
    const rest = rows.slice(1);
    const lines = rest.map((row, index) => {
      const y = TABLE_TITLE + TABLE_PAD + (index * LINE_HEIGHT) + (LINE_HEIGHT / 2);
      return `<tspan x="${TABLE_PAD}" y="${round(y)}">${escapeText(row)}</tspan>`;
    });

    return `${rect(w, h, RADIUS)}`
      + `<line class="dd-rule" x1="0" y1="${TABLE_TITLE}" x2="${round(w)}" y2="${TABLE_TITLE}"/>`
      + `<text class="dd-text dd-title" text-anchor="middle" dominant-baseline="middle">`
      + `<tspan x="${round(w / 2)}" y="${round(TABLE_TITLE / 2)}">${escapeText(title)}</tspan></text>`
      + (lines.length > 0
        ? `<text class="dd-text dd-row" text-anchor="start" dominant-baseline="middle">${lines.join("")}</text>`
        : "");
  }

  // The inside of a box, in its own coordinates. Separate from the group around
  // it because resizing one redraws exactly this and nothing else.
  function nodeBody(node, at) {
    const rows = Model.textRows(node.text || node.id);

    return at.kind === "table"
      ? tableMarkup(rows, at.w, at.h)
      : shapeMarkup(node.shape, at.w, at.h) + centredText(rows, at.w, at.h);
  }

  function nodeMarkup(node, at) {
    return `<g class="dd-node${at.kind === "table" ? " dd-node-table" : ""}"`
      + ` data-id="${escapeText(node.id)}"`
      + ` transform="translate(${round(at.x)},${round(at.y)})">${nodeBody(node, at)}</g>`;
  }

  /* What is drawn on the box being worked on.
   *
   * A ring around it, a square in the corner to resize it by, and a circle on
   * its edge that is both handles an arrow needs: dragged, it draws one to
   * wherever it is let go; clicked, it grows a new box already joined to this
   * one. Drawn in the diagram's own coordinates, inside the same SVG, because
   * the alternative is a second layer that has to be kept in step with the
   * first every time anything moves.
   */
  const RING_PAD = 5;
  const HANDLE = 9;

  function marksMarkup(at) {
    const cx = at.x + at.w + HANDLE + 2;
    const cy = at.y + (at.h / 2);

    return `<g class="dd-marks">`
      + `<rect class="dd-ring" x="${round(at.x - RING_PAD)}" y="${round(at.y - RING_PAD)}"`
      + ` width="${round(at.w + (RING_PAD * 2))}" height="${round(at.h + (RING_PAD * 2))}" rx="9"/>`
      + `<circle class="dd-handle dd-connect" data-role="connect"`
      + ` cx="${round(cx)}" cy="${round(cy)}" r="${HANDLE}"/>`
      + `<path class="dd-handle-mark" d="M${round(cx - 4)},${round(cy)} h8 M${round(cx)},${round(cy - 4)} v8"/>`
      + `<rect class="dd-handle dd-resize" data-role="resize"`
      + ` x="${round(at.x + at.w - 6)}" y="${round(at.y + at.h - 6)}" width="12" height="12" rx="3"/>`
      + `</g>`;
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

  const hits = (segment, box) => {
    const [[x1, y1], [x2, y2]] = segment;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    return right > box.x - CLEARANCE
      && left < box.x + box.w + CLEARANCE
      && bottom > box.y - CLEARANCE
      && top < box.y + box.h + CLEARANCE;
  };

  function clear(points, obstacles) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const segment = [points[index], points[index + 1]];

      for (const box of obstacles) {
        if (hits(segment, box)) {
          return false;
        }
      }
    }

    return true;
  }

  // Two points on the same line and a point between them is not a corner.
  function tidy(points) {
    const out = [];

    for (const point of points) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - point[0]) < 0.5 && Math.abs(last[1] - point[1]) < 0.5) {
        continue;
      }
      out.push(point);
    }

    for (let index = 1; index < out.length - 1;) {
      const [ax, ay] = out[index - 1];
      const [bx, by] = out[index];
      const [cx, cy] = out[index + 1];
      const straight = (Math.abs(ax - bx) < 0.5 && Math.abs(bx - cx) < 0.5)
        || (Math.abs(ay - by) < 0.5 && Math.abs(by - cy) < 0.5);

      if (straight) {
        out.splice(index, 1);
      } else {
        index += 1;
      }
    }

    return out;
  }

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function selfLoop(box) {
    const right = box.x + box.w;
    const top = box.y;
    const out = right + STANDOFF + 12;
    const up = top - STANDOFF - 12;

    return [
      [right, box.y + (box.h / 3)],
      [out, box.y + (box.h / 3)],
      [out, up],
      [box.x + (box.w / 2), up],
      [box.x + (box.w / 2), top]
    ];
  }

  function routeBetween(a, b, obstacles, spread) {
    if (a === b) {
      return selfLoop(a);
    }

    // Two boxes joined twice — there and back again, which is most of what a
    // loop in a flowchart is — would otherwise be one arrow drawn on top of
    // another. Each one leaves and arrives a little to the side of the middle
    // instead, near enough to still read as joining those two boxes.
    const lane = (box, size) => clamp(spread || 0, -(size / 2) + 10, (size / 2) - 10);
    const acx = a.x + (a.w / 2) + lane(a, a.w);
    const acy = a.y + (a.h / 2) + lane(a, a.h);
    const bcx = b.x + (b.w / 2) + lane(b, b.w);
    const bcy = b.y + (b.h / 2) + lane(b, b.h);
    const dx = (b.x + (b.w / 2)) - (a.x + (a.w / 2));
    const dy = (b.y + (b.h / 2)) - (a.y + (a.h / 2));

    // The gap between the two boxes on each axis. Whichever they are actually
    // separated on is the one an arrow can leave and arrive at squarely.
    const across = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const down = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    const horizontal = across >= down;

    const candidates = [];

    if (horizontal) {
      const start = dx >= 0 ? a.x + a.w : a.x;
      const end = dx >= 0 ? b.x : b.x + b.w;
      const mid = (start + end) / 2;

      candidates.push([[start, acy], [mid, acy], [mid, bcy], [end, bcy]]);
      candidates.push([[start, acy], [start + (dx >= 0 ? STANDOFF : -STANDOFF), acy],
        [start + (dx >= 0 ? STANDOFF : -STANDOFF), bcy], [end, bcy]]);
      candidates.push([[start, acy], [end - (dx >= 0 ? STANDOFF : -STANDOFF), acy],
        [end - (dx >= 0 ? STANDOFF : -STANDOFF), bcy], [end, bcy]]);

      const over = Math.min(a.y, b.y) - STANDOFF - CLEARANCE;
      const under = Math.max(a.y + a.h, b.y + b.h) + STANDOFF + CLEARANCE;
      const outward = start + (dx >= 0 ? STANDOFF : -STANDOFF);
      const inward = end - (dx >= 0 ? STANDOFF : -STANDOFF);

      for (const lane of [over, under]) {
        candidates.push([[start, acy], [outward, acy], [outward, lane],
          [inward, lane], [inward, bcy], [end, bcy]]);
      }
    } else {
      const start = dy >= 0 ? a.y + a.h : a.y;
      const end = dy >= 0 ? b.y : b.y + b.h;
      const mid = (start + end) / 2;

      candidates.push([[acx, start], [acx, mid], [bcx, mid], [bcx, end]]);
      candidates.push([[acx, start], [acx, start + (dy >= 0 ? STANDOFF : -STANDOFF)],
        [bcx, start + (dy >= 0 ? STANDOFF : -STANDOFF)], [bcx, end]]);
      candidates.push([[acx, start], [acx, end - (dy >= 0 ? STANDOFF : -STANDOFF)],
        [bcx, end - (dy >= 0 ? STANDOFF : -STANDOFF)], [bcx, end]]);

      const left = Math.min(a.x, b.x) - STANDOFF - CLEARANCE;
      const right = Math.max(a.x + a.w, b.x + b.w) + STANDOFF + CLEARANCE;
      const outward = start + (dy >= 0 ? STANDOFF : -STANDOFF);
      const inward = end - (dy >= 0 ? STANDOFF : -STANDOFF);

      for (const lane of [left, right]) {
        candidates.push([[acx, start], [acx, outward], [lane, outward],
          [lane, inward], [bcx, inward], [bcx, end]]);
      }
    }

    for (const candidate of candidates) {
      const points = tidy(candidate);
      if (clear(points, obstacles)) {
        return points;
      }
    }

    return tidy(candidates[0]);
  }

  // The obstacles for one arrow: every box except the two it joins, which it is
  // allowed to touch because that is where it starts and stops.
  function obstaclesFor(layout, fromId, toId) {
    const out = [];

    for (const [id, at] of Object.entries(layout)) {
      if (id !== fromId && id !== toId) {
        out.push(at);
      }
    }

    return out;
  }

  const pathData = (points) => points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)},${round(y)}`)
    .join(" ");

  // Halfway along, measured rather than guessed, so a label on a route that
  // goes the long way round is on the part of it that goes the long way round.
  function midpoint(points) {
    const lengths = [];
    let total = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
      const length = Math.hypot(points[index + 1][0] - points[index][0],
        points[index + 1][1] - points[index][1]);
      lengths.push(length);
      total += length;
    }

    let walked = 0;

    for (let index = 0; index < lengths.length; index += 1) {
      if (walked + lengths[index] >= total / 2) {
        const into = lengths[index] === 0 ? 0 : ((total / 2) - walked) / lengths[index];
        return {
          x: points[index][0] + ((points[index + 1][0] - points[index][0]) * into),
          y: points[index][1] + ((points[index + 1][1] - points[index][1]) * into)
        };
      }

      walked += lengths[index];
    }

    return { x: points[0][0], y: points[0][1] };
  }

  /* One arrow's geometry, on its own, so that dragging a box can re-route the
   * arrows that touch it without redrawing anything else.
   */
  function routeEdge(layout, edge, spread) {
    const from = layout[edge.from];
    const to = layout[edge.to];

    if (!from || !to) {
      return null;
    }

    const points = routeBetween(from, to, obstaclesFor(layout, edge.from, edge.to), spread);
    return { points, d: pathData(points), mid: midpoint(points) };
  }

  /* How far off the middle each arrow leaves its box.
   *
   * Worked out for the whole list at once, because the answer for one arrow
   * depends on how many others join the same two boxes. Keyed on the pair
   * without regard to which way round it is: an arrow back is still the same
   * pair of boxes and still needs its own lane.
   */
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

  function edgeMarkup(edge, index, layout, arrowId, spread) {
    const route = routeEdge(layout, edge, spread);
    if (!route) {
      return "";
    }

    // "open" and "dotted-open" and "thick-open" are the lines that end in
    // nothing; everything else ends in an arrowhead.
    const head = /open$/.test(edge.kind) ? "" : ` marker-end="url(#${arrowId})"`;
    const label = String(edge.label || "").trim();
    const width = (label.length * LABEL_CHAR) + 10;
    const badge = label
      ? `<g class="dd-label" transform="translate(${round(route.mid.x)},${round(route.mid.y)})">`
        + `<rect class="dd-label-back" x="${round(-width / 2)}" y="-10" width="${round(width)}" height="20" rx="4"/>`
        + `<text class="dd-label-text" text-anchor="middle" dominant-baseline="middle" x="0" y="0">${escapeText(label)}</text></g>`
      : "";

    return `<g class="dd-edge dd-edge-${escapeText(edge.kind)}" data-edge="${index}"`
      + ` data-from="${escapeText(edge.from)}" data-to="${escapeText(edge.to)}">`
      + `<path class="dd-line" fill="none" d="${route.d}"${head}/>${badge}</g>`;
  }

  /* --- The whole drawing -------------------------------------------------- */

  function render(model, options = {}) {
    const layout = options.layout || Model.ensureLayout(model);
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    const bounds = Model.layoutBounds(layout);
    drawCounter += 1;
    const arrowId = `dd-arrow-${drawCounter}`;

    const pad = Number(options.pad) || 0;
    const width = bounds.w + pad;
    const height = bounds.h + pad;
    const gridId = `dd-grid-${drawCounter}`;
    const parts = [];

    parts.push(`<defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5"`
      + ` markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
      + `<path class="dd-head" d="M0,0 L10,5 L0,10 z"/></marker>`
      + (options.grid
        ? `<pattern id="${gridId}" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse">`
          + `<path class="dd-grid-line" d="M${GRID_STEP},0 L0,0 L0,${GRID_STEP}"/></pattern>`
        : "")
      + `</defs>`);

    // The paper. Also what a click lands on when it lands on nothing, which is
    // how a box is put down.
    if (options.grid) {
      parts.push(`<rect class="dd-paper" x="0" y="0" width="${round(width)}"`
        + ` height="${round(height)}" fill="url(#${gridId})"/>`);
    }

    const spread = lanes(edges);
    parts.push(`<g class="dd-edges">${edges
      .map((edge, index) => edgeMarkup(edge, index, layout, arrowId, spread[index])).join("")}</g>`);

    parts.push(`<g class="dd-nodes">${nodes
      .filter((node) => layout[node.id])
      .map((node) => nodeMarkup(node, layout[node.id])).join("")}</g>`);

    const selected = options.selected && layout[options.selected];
    if (selected) {
      parts.push(marksMarkup(selected));
    }

    // Two ways to be sized. On a page, width in percent with a max-width in
    // pixels, which is what every other diagram there does — so a drawn one
    // sits in the flow the same way and the pan-zoom sizing already knows how
    // to measure it. In the editor, its own size exactly, so that a pixel
    // dragged is a pixel moved and there is no scale to undo.
    const size = options.natural
      ? ` width="${round(width)}" height="${round(height)}"`
      : ` width="100%" style="max-width: ${round(width)}px"`;

    return `<svg class="dd${options.natural ? " dd-editing" : ""}" xmlns="http://www.w3.org/2000/svg"`
      + ` viewBox="0 0 ${round(width)} ${round(height)}"${size} role="img"`
      + ` aria-label="${escapeText(options.label || "Diagram")}">${parts.join("")}</svg>`;
  }

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
    render,
    renderSource,
    nodeBody,
    marksMarkup,
    routeEdge,
    lanes,
    pathData,
    midpoint,
    shapeMarkup,
    STANDOFF,
    CLEARANCE,
    TABLE_TITLE,
    LINE_HEIGHT
  };
})(typeof window === "undefined" ? globalThis : window);
