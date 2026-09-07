/* One box, drawn.
 *
 * A shape for its kind, the words fitted inside it, and — for the kinds that
 * are not a shape at all — a note's folded corner, a cloud's outline, a
 * table's grid, an actor, a picture, an icon. Every one of them returns a
 * string, so a box can be redrawn without anything around it moving.
 */
(function (global) {
  "use strict";

  const {
    Model, ELLIPSIS, LINE_HEIGHT, RADIUS, ROUND_RADIUS, SLANT, escapeText, leadFor, polygon,
    rect, round
  } = global.DdBase;
  const { cellChar, cellPaint, sizeOf, wornBy, paintOf } = global.DdPaint;

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
      case "note":
        return noteMarkup(w, h);
      case "cloud":
        return cloudMarkup(w, h);
      case "queue":
        return queueMarkup(w, h);
      case "actor":
        return actorMarkup(w, h);
      default:
        return rect(w, h, RADIUS);
    }
  }

  /* --- The shapes Mermaid has no brackets for ------------------------------
   *
   * A note, a cloud, an actor and a queue: ordinary vocabulary in a technical
   * diagram, and past the end of Mermaid's shape list. The file writes each as
   * the nearest real shape and says the exact one beside it, so what is drawn
   * here is the whole of the difference.
   */

  // A page with its top right corner turned down. The fold is drawn as well as
  // cut out, because a corner that is merely missing reads as a mistake.
  function noteMarkup(w, h) {
    const fold = Math.min(16, w / 4, h / 4);

    return `<path class="dd-shape" d="M0,0 H${round(w - fold)} L${round(w)},${round(fold)}`
      + ` V${round(h)} H0 Z"/>`
      + `<path class="dd-rule" fill="none" d="M${round(w - fold)},0 V${round(fold)}`
      + ` H${round(w)}"/>`;
  }

  /* A cloud, as one closed path of cubic curves.
   *
   * Written on the unit square and multiplied out, rather than as arcs: a
   * cubic scales by each axis independently and an arc does not, so this is
   * the same cloud in a box of any shape instead of one that goes lopsided the
   * wider it is dragged.
   */
  const CLOUD_PATH = [
    [0.15, 1.00],
    [0.02, 1.00, 0.00, 0.62, 0.10, 0.55],
    [0.06, 0.36, 0.18, 0.22, 0.32, 0.30],
    [0.36, 0.05, 0.60, 0.02, 0.62, 0.18],
    [0.80, 0.14, 0.98, 0.22, 0.88, 0.45],
    [1.02, 0.55, 0.98, 0.92, 0.85, 1.00]
  ];

  function cloudMarkup(w, h) {
    const [start, ...curves] = CLOUD_PATH;
    const at = (x, y) => `${round(x * w)},${round(y * h)}`;

    const d = `M${at(start[0], start[1])}`
      + curves.map(([ax, ay, bx, by, x, y]) =>
        ` C${at(ax, ay)} ${at(bx, by)} ${at(x, y)}`).join("")
      + " Z";

    return `<path class="dd-shape" d="${d}"/>`;
  }

  /* A cylinder lying down, open at the left: a queue is a pipe things wait in,
   * and the seam says which end they go in at.
   */
  function queueMarkup(w, h) {
    const cap = Math.min(16, w / 5);
    const ry = h / 2;

    return `<path class="dd-shape" d="M${round(cap)},0 H${round(w - cap)}`
      + ` A ${round(cap)},${round(ry)} 0 0 1 ${round(w - cap)},${round(h)}`
      + ` H${round(cap)} A ${round(cap)},${round(ry)} 0 0 0 ${round(cap)},0 Z"/>`
      + `<path class="dd-rule" fill="none" d="M${round(cap)},0`
      + ` A ${round(cap)},${round(ry)} 0 0 1 ${round(cap)},${round(h)}"/>`;
  }

  /* A stick figure, in the part of the box its name does not take.
   *
   * The share it leaves is Model.ACTOR_BAND, which is also where the label is
   * put — one number, read twice, because a figure drawn to one share and a
   * name placed by another is a name written across somebody's chest.
   */
  function actorMarkup(w, h) {
    const top = h * (1 - Model.ACTOR_BAND);
    const cx = w / 2;
    const head = top * 0.16;
    const neck = top * 0.34;
    const hip = top * 0.68;
    const reach = Math.min(top * 0.28, w / 2);

    return `<circle class="dd-shape" cx="${round(cx)}" cy="${round(top * 0.17)}"`
      + ` r="${round(head)}"/>`
      + `<path class="dd-actor" fill="none" d="M${round(cx)},${round(neck)} V${round(hip)}`
      + ` M${round(cx - reach)},${round(top * 0.48)} H${round(cx + reach)}`
      + ` M${round(cx)},${round(hip)} L${round(cx - reach)},${round(top)}`
      + ` M${round(cx)},${round(hip)} L${round(cx + reach)},${round(top)}"/>`;
  }

  /* --- Text --------------------------------------------------------------
   *
   * Centred in the box, one tspan per line, sitting on the middle rather than
   * on a baseline — a box is resized around its text often enough that the text
   * has to stay in the middle of it without being measured again.
   */
  // `from` is where the band the words are centred in begins. Nought for a
  // label in a box, and the top of the strip under a picture for one there.
  function centredText(rows, w, h, from = 0, lead = LINE_HEIGHT) {
    if (rows.length === 0) {
      return "";
    }

    const top = (from + (h / 2)) - (((rows.length - 1) * lead) / 2);
    const spans = rows.map((row, index) => {
      const y = top + (index * lead);
      return `<tspan x="${round(w / 2)}" y="${round(y)}">${escapeText(row)}</tspan>`;
    });

    return `<text class="dd-text" text-anchor="middle" dominant-baseline="middle">${spans.join("")}</text>`;
  }

  /* What fits, and what was there before it was cut.
   *
   * A word wider than the cell it is in is a word written over the wall into
   * the next one, which is worse than not being able to read all of it — so it
   * is cut to what fits and marked with an ellipsis. What it said in full is
   * kept, and hung off the text as a <title> so that resting on it says the
   * rest.
   */
  function clip(words, room, char) {
    const text = String(words);
    if (text.length * char <= room) {
      return { text, full: "" };
    }

    // Room for the ellipsis and nothing else, or not even that.
    const fits = Math.floor(room / char) - 1;
    if (fits <= 0) {
      return { text: room >= char ? ELLIPSIS : "", full: text };
    }

    return { text: text.slice(0, fits) + ELLIPSIS, full: text };
  }

  // One cell, written where it goes. Its own <text> rather than a tspan in a
  // shared one, because a <title> belongs to the element it describes.
  function cellText(kind, x, y, anchor, cut, paint) {
    return `<text class="dd-text ${kind}" x="${round(x)}" y="${round(y)}"`
      + ` text-anchor="${anchor}" dominant-baseline="middle"`
      + (paint ? ` style="${escapeText(paint)}"` : "")
      + `>${cut.full ? `<title>${escapeText(cut.full)}</title>` : ""}`
      + `${escapeText(cut.text)}</text>`;
  }

  /* A table: a title across the top, over a rule, and a grid under it.
   *
   * The body is shared out evenly rather than stacked from the top, so a table
   * dragged taller is a table with taller rows rather than one with a blank
   * half underneath its text — which is what makes the rules between the rows
   * land where the rows actually are at any size.
   *
   * Every row and every column it has is drawn. A table whose structure you
   * have to infer from where the words happen to sit is a box with a list in
   * it, and the lines are the whole difference between the two.
   */
  /* Where each cell of a table is, in the box's own coordinates.
   *
   * Written down once and read twice: the drawing puts its words in these
   * places, and the editor puts a field over a cell in the same ones. Two
   * copies of this arithmetic is a table where you type into one place and the
   * words come out in another.
   *
   * The title is the first of them and spans the whole width, the way it is
   * drawn. The body starts at row one, so a body row's number in the grid is
   * one more than its number in the run.
   */
  function cellBoxes(grid, w, h, spacing) {
    const body = grid.slice(1);
    const columns = Model.columnsOf(grid);
    const wide = w / columns;
    const tall = body.length > 0 ? (h - spacing.title) / body.length : 0;

    return [
      { row: 0, column: 0, x: 0, y: 0, w, h: spacing.title },
      ...body.flatMap((ignored, line) =>
        Array.from({ length: columns }, (also, cell) => ({
          row: line + 1,
          column: cell,
          x: cell * wide,
          y: spacing.title + (line * tall),
          w: wide,
          h: tall
        })))
    ];
  }

  // Which cell of a table a point is in, in the box's own coordinates. Nothing
  // at all for a point past the last row, which is a table dragged taller than
  // its rows.
  function cellAt(grid, w, h, spacing, x, y) {
    return cellBoxes(grid, w, h, spacing).find((at) =>
      x >= at.x && x < at.x + at.w && y >= at.y && y < at.y + at.h) || null;
  }

  function tableMarkup(grid, w, h, spacing, size, styles) {
    const boxes = cellBoxes(grid, w, h, spacing);
    const title = (grid[0] || [])[0] || "";
    const titleToken = (styles || {})[Model.cellKey(0, 0)] || "";
    const body = grid.slice(1);
    const columns = Model.columnsOf(grid);
    const wide = w / columns;
    const tall = body.length > 0 ? (h - spacing.title) / body.length : 0;

    const cells = boxes.slice(1).map((at) => {
      const words = (grid[at.row] || [])[at.column] || "";
      if (words === "") {
        return "";
      }

      const token = (styles || {})[Model.cellKey(at.row, at.column)] || "";
      // What a cell has to write in, once the padding either side is taken off.
      return cellText("dd-row", at.x + spacing.pad, at.y + (at.h / 2), "start",
        clip(words, at.w - (spacing.pad * 2), cellChar(token, size)), cellPaint(token));
    });

    /* The rules of the grid: down between the columns, across between the rows.
     * Never round the outside — the box's own border is already there, and the
     * rule under the title is drawn separately because it is a heading rather
     * than one more row.
     */
    const down = Array.from({ length: columns - 1 }, (ignored, cell) =>
      `<line class="dd-rule dd-cell-rule" x1="${round((cell + 1) * wide)}"`
      + ` y1="${spacing.title}" x2="${round((cell + 1) * wide)}" y2="${round(h)}"/>`).join("");

    const across = body.slice(1).map((ignored, line) =>
      `<line class="dd-rule dd-cell-rule" x1="0" y1="${round(spacing.title + ((line + 1) * tall))}"`
      + ` x2="${round(w)}" y2="${round(spacing.title + ((line + 1) * tall))}"/>`).join("");

    return `${rect(w, h, RADIUS)}`
      + `<line class="dd-rule" x1="0" y1="${spacing.title}" x2="${round(w)}" y2="${spacing.title}"/>`
      + down + across
      + cellText("dd-title", boxes[0].w / 2, boxes[0].h / 2, "middle",
        clip(title, w - (spacing.pad * 2), cellChar(titleToken, size)),
        cellPaint(titleToken))
      + cells.join("");
  }

  /* The words on a box: inside it, or under what it draws.
   *
   * A stick figure with its name written across its chest is not a labelled
   * actor, it is a scribble. Shapes that are a drawing rather than a container
   * keep a band along the bottom for the name, and the share they keep is the
   * same number the drawing sets itself out by.
   */
  function labelMarkup(node, at, rows, lead) {
    if (node.shape !== "actor" || node.frame === "none") {
      return centredText(rows, at.w, at.h, 0, lead);
    }

    const said = rows.filter((row) => row !== "");
    return said.length > 0
      ? centredText(said, at.w, at.h * Model.ACTOR_BAND, at.h * (1 - Model.ACTOR_BAND), lead)
      : "";
  }

  // The inside of a box, in its own coordinates. Separate from the group around
  // it because resizing one redraws exactly this and nothing else.
  /* A picture in a box.
   *
   * The address is checked rather than trusted. It comes out of a file, and it
   * is about to become the href of an <image> — a string that is not plainly
   * one of this app's own stored assets is a request to somewhere else, made by
   * anyone who opens the diagram. Content-hash names are the only shape the
   * store ever hands out, so they are the only shape allowed back in.
   */
  const IMAGE_RE = /^\/api\/assets\/[0-9a-f]{64}\.(?:png|jpg|gif|webp|avif)$/;
  const IMAGE_PAD = 6;

  const imageOf = (node) => (IMAGE_RE.test(String(node?.image || "")) ? node.image : "");

  /* An icon, if it is one this build has.
   *
   * Named by set and by name, `lucide:database`, because there will be a second
   * set and a name on its own would then mean two things. A name this has never
   * heard of draws nothing at all — which is what a file written by a later
   * version of this app says, and a box with its words in it is a better answer
   * to that than a gap where a picture should be.
   */
  const ICON_RE = /^lucide:([a-z0-9-]+)$/;
  const ICON_SIZE = 24;

  function iconBody(node) {
    const found = ICON_RE.exec(String(node?.icon || ""));
    return found ? (global.DiagramIcons?.bodyOf(found[1]) || "") : "";
  }

  /* The icon, drawn as big as the box will let it be and no bigger.
   *
   * Lucide's grid is 24 across, so the whole of it is scaled to whatever room
   * is left over — one transform, rather than 180 icons each drawn to a size
   * somebody chose. It keeps its own proportions because the scale is the same
   * both ways, and it is stroked in the box's own text colour because that is
   * what currentColor means.
   */
  function iconMarkup(node, at, lead = LINE_HEIGHT) {
    const body = iconBody(node);
    if (!body) {
      return "";
    }

    const words = Model.textRows(node.text || "").filter((row) => row !== "");
    const band = words.length > 0 ? (words.length * lead) + 2 : 0;
    const room = Math.min(at.w - (IMAGE_PAD * 2), at.h - (IMAGE_PAD * 2) - band);

    if (room <= 0) {
      return "";
    }

    const scale = room / ICON_SIZE;
    const x = (at.w - room) / 2;
    const y = (at.h - band - room) / 2;

    return `<g class="dd-icon" transform="translate(${round(x)},${round(y)})`
      + ` scale(${round(scale)})">${body}</g>`
      + (words.length > 0 ? centredText(words, at.w, band, at.h - band, lead) : "");
  }

  /* The picture, and the words under it.
   *
   * Fitted rather than filled: a picture stretched to the shape of the box it
   * was dropped in is a picture nobody recognises, so it keeps its own shape
   * and the box has whatever is left over. The label takes a band along the
   * bottom, and a box with nothing written in it gives the whole of itself to
   * the picture.
   */
  function pictureMarkup(node, at, lead = LINE_HEIGHT) {
    const words = Model.textRows(node.text || "").filter((row) => row !== "");
    const band = words.length > 0 ? (words.length * lead) + 2 : 0;
    const room = {
      w: Math.max(0, at.w - (IMAGE_PAD * 2)),
      h: Math.max(0, at.h - (IMAGE_PAD * 2) - band)
    };

    const picture = room.w > 0 && room.h > 0
      ? `<image class="dd-picture" x="${IMAGE_PAD}" y="${IMAGE_PAD}"`
        + ` width="${round(room.w)}" height="${round(room.h)}"`
        + ` preserveAspectRatio="xMidYMid meet"`
        + ` href="${escapeText(imageOf(node))}"/>`
      : "";

    const label = words.length > 0
      ? centredText(words, at.w, band, at.h - band, lead)
      : "";

    return picture + label;
  }

  function nodeBody(node, at, classes) {
    const words = node.text || node.id;

    if (node.kind === "table") {
      return tableMarkup(Model.textCells(words), at.w, at.h, Model.tableMetrics(node),
        sizeOf(node, classes), node.cells);
    }

    /* What is in the box: a picture, an icon, or its words. A picture beats an
     * icon because it is the more particular of the two — nobody drops a
     * photograph on a box meaning to keep the little drawing under it.
     */
    const lead = leadFor(sizeOf(node, classes));
    const inside = imageOf(node)
      ? pictureMarkup(node, at, lead)
      : iconMarkup(node, at, lead) || labelMarkup(node, at, Model.textRows(words), lead);

    return backing(node, at, classes) + inside;
  }

  /* What is drawn behind what a box holds.
   *
   * For most boxes that is the shape. For a frameless one it is nothing — an
   * icon or a picture standing on the paper on its own, which is what most of a
   * technical diagram is: the shape is the frame, and without one there is
   * nothing to draw but what is inside.
   *
   * Words on the paper are the third case. They have no shape either, but a
   * colour behind them has to be painted on something, so they get a plain
   * rectangle the size of the words and no border — a highlight rather than a
   * box. Which is the only honest way to offer a background on a thing whose
   * whole point is not having one.
   */
  function backing(node, at, classes) {
    if (node.kind === "text") {
      return wornBy(node, classes).fill
        ? `<rect class="dd-shape dd-back" x="0" y="0" width="${round(at.w)}"`
          + ` height="${round(at.h)}" rx="${round(RADIUS)}"/>`
        : "";
    }

    return node.frame === "none" ? "" : shapeMarkup(node.shape, at.w, at.h);
  }

  /* --- Colour ---------------------------------------------------------------
   *
   * A colour lives in the file as a classDef, which is real Mermaid: it renders
   * on GitHub and in every other Mermaid renderer exactly as it does here. What
   * arrives is therefore whatever somebody wrote, and it is about to be put in
   * a style attribute — so it is checked rather than trusted. A value that is
   * not plainly a colour is dropped, and the box is drawn in the theme's own
   * colours as if nothing had been said.
   *
   * The declarations become custom properties on the group rather than
   * attributes on the shape, which is what keeps the theme working: a box with
   * no colour of its own reads the fallback and recolours with everything else,
   * and one shape or nine inside a group all follow without being told.
   */
  function nodeMarkup(node, at, classes) {
    const paint = paintOf(node, classes);

    return `<g class="dd-node${node.kind === "table" ? " dd-node-table" : ""}"`
      + ` data-id="${escapeText(node.id)}"`
      + (paint ? ` style="${escapeText(paint)}"` : "")
      + ` transform="translate(${round(at.x)},${round(at.y)})">${nodeBody(node, at, classes)}</g>`;
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

  global.DdShapes = {
    shapeMarkup, cellBoxes, cellAt, labelMarkup, nodeBody, nodeMarkup
  };
})(typeof window === "undefined" ? globalThis : window);
