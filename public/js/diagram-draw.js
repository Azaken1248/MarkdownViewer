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
  const COLOUR_RE = /^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([0-9.,%/\s]+\))$/i;
  const WIDTH_RE = /^[0-9.]+(?:px)?$/i;
  const DASH_RE = /^[0-9.,\s]+$/;

  /* The type. Held to the three generic families and nothing else: a classDef
   * comes out of a file, and a font name out of a file is a string on its way
   * into a style attribute. The three that every renderer has are also the
   * three anyone means — a diagram set in sans, in serif, or in the font code
   * is written in.
   */
  const SIZE_RE = /^[0-9]{1,3}(?:\.[0-9]+)?px$/i;
  const WEIGHT_RE = /^(?:normal|bold|[1-9]00)$/i;
  const FAMILY_RE = /^(?:sans-serif|serif|monospace)$/i;
  const STYLE_RE = /^(?:normal|italic)$/i;

  // The size a label is set in unless it says otherwise. Written here rather
  // than only in the stylesheet because clipping a word to its cell means
  // knowing how wide the word is, and there is a check that holds the two
  // together.
  const TEXT_SIZE = 13;
  // Roughly how wide a character is, as a share of the size it is set in. An
  // approximation, and it only has to be one: it decides where a word is cut
  // off, and a cut half a character early is a cut nobody can see.
  const CHAR_RATIO = 0.48;

  // Which declaration goes where. A classDef speaks CSS, and the two names that
  // do not line up are `color`, which is the text rather than the shape, and
  // `fill`, which SVG has and CSS text does not.
  const PAINTED = [
    ["fill", "--dd-fill", COLOUR_RE],
    ["stroke", "--dd-stroke", COLOUR_RE],
    ["color", "--dd-text", COLOUR_RE],
    ["stroke-width", "--dd-stroke-width", WIDTH_RE],
    ["stroke-dasharray", "--dd-dash", DASH_RE],
    ["font-size", "--dd-font-size", SIZE_RE],
    ["font-weight", "--dd-font-weight", WEIGHT_RE],
    ["font-family", "--dd-font-family", FAMILY_RE],
    ["font-style", "--dd-font-style", STYLE_RE]
  ];

  /* What a box is actually wearing: every class it names, in the order it names
   * them, and then its own inline style — which is what `style A fill:#f00`
   * means in Mermaid, and it wins because it is about that one box.
   */
  function wornBy(node, classes) {
    const worn = {};

    for (const name of node.classes || []) {
      Object.assign(worn, (classes || {})[name] || {});
    }

    Object.assign(worn, node.style || {});
    return worn;
  }

  // How wide a character is on this box, which is what says where a word is too
  // long for the cell it is in. A box set in a bigger font runs out of room
  // sooner, and a box that keeps the same clipping at every size is a box whose
  // words go over the wall the moment anyone enlarges them.
  // What size a box is set in: its own, if it named one this file is willing to
  // write into a style attribute, and the standard otherwise. Both how wide a
  // character is and how far apart the lines sit are worked out from this one
  // number, so a box set larger is spaced as well as clipped for the size it is
  // actually drawn at.
  function sizeOf(node, classes) {
    const said = wornBy(node, classes)["font-size"];
    return SIZE_RE.test(String(said || "").trim()) ? parseFloat(said) : TEXT_SIZE;
  }


  /* What one cell of a table wears, checked exactly the way the box's own is.
   *
   * The four font entries and no others: a cell may be set in another type, and
   * a cell may not repaint the table it is in. Same custom properties as the
   * box sets, so a cell that says nothing about its weight inherits the one the
   * box chose — which is what makes "bold this cell" a thing you can say on top
   * of "this table is bold" rather than instead of it.
   */
  const CELL_PAINTED = PAINTED.filter(([key]) => key.startsWith("font-"));

  function cellPaint(token) {
    const said = Model.cellDeclarations(token);

    let out = "";
    for (const [key, property, allowed] of CELL_PAINTED) {
      const value = said[key];
      if (typeof value === "string" && allowed.test(value.trim())) {
        out += `${property}:${value.trim()};`;
      }
    }

    return out;
  }

  /* How big this cell's type is: its own size if it set one, the box's
   * otherwise. Asked here rather than worked out again wherever it is wanted,
   * because the field typed into a cell has to open at the size the cell is
   * drawn at or the words change size the moment you stop typing.
   */
  function cellSize(token, size) {
    const said = Model.cellDeclarations(token)["font-size"];
    return SIZE_RE.test(String(said || "")) ? parseFloat(said) : size;
  }

  // How wide a character is in this cell. A cell set larger that kept the box's
  // character width would be a cell whose words are cut too late, and so
  // written over the wall.
  function cellChar(token, size) {
    return cellSize(token, size) * CHAR_RATIO;
  }

  function paintOf(node, classes) {
    const worn = wornBy(node, classes);

    let out = "";
    for (const [key, property, allowed] of PAINTED) {
      const value = worn[key];
      if (typeof value === "string" && allowed.test(value.trim())) {
        out += `${property}:${value.trim()};`;
      }
    }

    return out;
  }

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

    // Collinear is not enough: a point on the same line as its neighbours but
    // past one of them is a place the line goes out to and comes back from,
    // which is exactly what a corner somebody dropped there is for.
    const within = (a, b, c) => b >= Math.min(a, c) - 0.5 && b <= Math.max(a, c) + 0.5;

    for (let index = 1; index < out.length - 1;) {
      const [ax, ay] = out[index - 1];
      const [bx, by] = out[index];
      const [cx, cy] = out[index + 1];
      const straight =
        (Math.abs(ax - bx) < 0.5 && Math.abs(bx - cx) < 0.5 && within(ay, by, cy))
        || (Math.abs(ay - by) < 0.5 && Math.abs(by - cy) < 0.5 && within(ax, bx, cx));

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

  /* --- A route somebody chose ----------------------------------------------
   *
   * The auto-router is good at the ordinary case and has no opinions to offer
   * once somebody has said where the line should go. So when an end is pinned
   * to a side, or the line has been dragged through a point, this builds the
   * route asked for instead — squarely, but without trying to dodge anything.
   * Dodging is what the auto-router is for, and a line somebody has placed by
   * hand is already where they want it.
   */
  const SIDES = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

  const sideAxis = (side) => (side === "l" || side === "r" ? "x" : "y");

  const away = ([x, y], side, by) =>
    [x + (SIDES[side][0] * by), y + (SIDES[side][1] * by)];

  // Where on a side a line meets it. Offset along the side by the lane, the
  // same way the auto-router spreads two arrows between the same two boxes.
  function anchorOn(box, side, spread) {
    const along = spread || 0;
    const x = clamp(box.x + (box.w / 2) + along, box.x + 8, box.x + box.w - 8);
    const y = clamp(box.y + (box.h / 2) + along, box.y + 8, box.y + box.h - 8);

    if (side === "l") {
      return [box.x, y];
    }
    if (side === "r") {
      return [box.x + box.w, y];
    }

    return side === "t" ? [x, box.y] : [x, box.y + box.h];
  }

  // Which sides the auto-router would have used, so an edge with one end pinned
  // and one not still leaves the other end somewhere sensible.
  function autoSides(a, b) {
    const dx = (b.x + (b.w / 2)) - (a.x + (a.w / 2));
    const dy = (b.y + (b.h / 2)) - (a.y + (a.h / 2));
    const across = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const down = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));

    if (across >= down) {
      return dx >= 0 ? ["r", "l"] : ["l", "r"];
    }

    return dy >= 0 ? ["b", "t"] : ["t", "b"];
  }

  // The model keeps a waypoint as a point with names; the arithmetic here works
  // in pairs, the same as every other point in this file.
  const wayPoints = (edge) => (Array.isArray(edge?.waypoints) ? edge.waypoints : [])
    .filter((one) => Number.isFinite(one?.x) && Number.isFinite(one?.y))
    .map((one) => [one.x, one.y]);

  /* Which side of a box faces a point.
   *
   * Measured against the box's own half-width and half-height rather than in
   * plain pixels, or a box twice as wide as it is tall would answer left or
   * right to very nearly everything.
   */
  function sideTowards(box, [x, y]) {
    const dx = x - (box.x + (box.w / 2));
    const dy = y - (box.y + (box.h / 2));

    if (Math.abs(dx) / (box.w || 1) >= Math.abs(dy) / (box.h || 1)) {
      return dx >= 0 ? "r" : "l";
    }

    return dy >= 0 ? "b" : "t";
  }

  function pinnedSides(edge) {
    const said = Array.isArray(edge?.sides) ? edge.sides : [];
    const one = (value) => (SIDES[value] ? value : null);
    return [one(said[0]), one(said[1])];
  }

  /* The corner between two points, given which way the line is travelling when
   * it reaches the first of them.
   *
   * It turns onto the other axis first and finishes on the one it was already
   * on, so it never sets off back the way it came: a line that leaves a box
   * downwards and then has to go down further does not go down, up, and down
   * again to collect a corner on the way.
   */
  const turnTo = (from, to, heading) =>
    (heading === "y" ? [to[0], from[1]] : [from[0], to[1]]);

  function guidedRoute(a, b, edge, spread) {
    const auto = autoSides(a, b);
    const pinned = pinnedSides(edge);
    const via = wayPoints(edge);

    /* An end nobody pinned faces whatever the line goes to next, which once
     * there are corners in it is the first corner rather than the other box.
     * Otherwise a line dragged out to the left still leaves on the right and
     * doubles back on itself to get there.
     */
    const out = pinned[0] || (via.length > 0 ? sideTowards(a, via[0]) : auto[0]);
    const into = pinned[1]
      || (via.length > 0 ? sideTowards(b, via[via.length - 1]) : auto[1]);

    const start = anchorOn(a, out, spread);
    const end = anchorOn(b, into, spread);

    // Both ends leave and arrive squarely, standing off the box far enough that
    // the line reads as coming out of that side rather than out of the corner.
    const last = away(end, into, STANDOFF);
    const points = [start, away(start, out, STANDOFF)];
    const heading = sideAxis(out);

    for (const stop of via) {
      points.push(turnTo(points[points.length - 1], stop, heading), stop);
    }

    // The last leg has to run along the side it is arriving at, so the turn
    // before it is on the other one.
    points.push(turnTo(points[points.length - 1], last, sideAxis(into)));
    points.push(last, end);

    return tidy(points);
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

  /* --- What shape the line is drawn in --------------------------------------
   *
   * Three, and the route is the same route in all three: the corners a line
   * turns to get round a box are worked out once, and then drawn square, drawn
   * round, or ignored in favour of the shortest way there. Which means turning
   * a line curved cannot walk it through something, because the curve is the
   * same line with its corners softened.
   *
   * Straight is the one that really is a different route, and it is the one
   * that goes through whatever is in the way. That is what asking for a
   * straight line means.
   */
  const CORNER = 12;

  function pathCurved(points) {
    if (points.length < 3) {
      return pathData(points);
    }

    let d = `M${round(points[0][0])},${round(points[0][1])}`;

    for (let index = 1; index < points.length - 1; index += 1) {
      const [px, py] = points[index - 1];
      const [x, y] = points[index];
      const [nx, ny] = points[index + 1];
      const before = Math.hypot(x - px, y - py);
      const after = Math.hypot(nx - x, ny - y);

      // A corner between two segments one of which has no length is not a
      // corner, and rounding it is a division by nothing.
      if (before === 0 || after === 0) {
        d += ` L${round(x)},${round(y)}`;
        continue;
      }

      // Never more than half of either arm, or two corners close together eat
      // into each other and the line doubles back.
      const radius = Math.min(CORNER, before / 2, after / 2);
      d += ` L${round(x + (((px - x) / before) * radius))},`
        + `${round(y + (((py - y) / before) * radius))}`
        + ` Q${round(x)},${round(y)}`
        + ` ${round(x + (((nx - x) / after) * radius))},`
        + `${round(y + (((ny - y) / after) * radius))}`;
    }

    const last = points[points.length - 1];
    return `${d} L${round(last[0])},${round(last[1])}`;
  }

  const middleOf = (box) => [box.x + (box.w / 2), box.y + (box.h / 2)];

  // Where a ray from a point inside a box leaves it. The point is inside rather
  // than the middle because two straight lines between the same two boxes have
  // to leave from two different places or they are one line.
  function leaves(box, from, towards) {
    const dx = towards[0] - from[0];
    const dy = towards[1] - from[1];

    const reach = Math.min(
      dx === 0 ? Infinity : Math.max((box.x - from[0]) / dx, ((box.x + box.w) - from[0]) / dx),
      dy === 0 ? Infinity : Math.max((box.y - from[1]) / dy, ((box.y + box.h) - from[1]) / dy));

    return Number.isFinite(reach)
      ? [from[0] + (dx * reach), from[1] + (dy * reach)]
      : [from[0], from[1]];
  }

  function straightBetween(a, b, spread) {
    const here = middleOf(a);
    const there = middleOf(b);
    const length = Math.hypot(there[0] - here[0], there[1] - here[1]) || 1;

    // Two boxes joined twice get two lines, side by side, the same way the
    // angled router gives them two lanes.
    const off = spread || 0;
    const across = [(-(there[1] - here[1]) / length) * off,
      ((there[0] - here[0]) / length) * off];
    const from = [here[0] + across[0], here[1] + across[1]];
    const to = [there[0] + across[0], there[1] + across[1]];

    return [leaves(a, from, to), leaves(b, to, from)];
  }

  /* A straight line asked to go through somewhere goes through it, in
   * straight legs. Asked to leave a particular side, it leaves from the middle
   * of that side — a straight line has no corner to put anywhere else.
   */
  function straightThrough(a, b, edge, spread) {
    const via = wayPoints(edge);
    const pinned = pinnedSides(edge);

    if (via.length === 0 && !pinned[0] && !pinned[1]) {
      return straightBetween(a, b, spread);
    }

    const here = pinned[0] ? anchorOn(a, pinned[0], spread) : middleOf(a);
    const there = pinned[1] ? anchorOn(b, pinned[1], spread) : middleOf(b);
    const stops = [here, ...via, there];

    return tidy([
      pinned[0] ? here : leaves(a, here, stops[1]),
      ...via,
      pinned[1] ? there : leaves(b, there, stops[stops.length - 2])
    ]);
  }

  const shapeOf = (edge) => (edge?.route === "curved" || edge?.route === "straight"
    ? edge.route
    : "angled");

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

    const shape = shapeOf(edge);
    const guided = from !== to
      && (pinnedSides(edge).some(Boolean) || wayPoints(edge).length > 0);

    let points;
    if (shape === "straight" && from !== to) {
      points = straightThrough(from, to, edge, spread);
    } else if (guided) {
      points = guidedRoute(from, to, edge, spread);
    } else {
      points = routeBetween(from, to, obstaclesFor(layout, edge.from, edge.to), spread);
    }

    const drawn = stopShort(points, edge);
    return {
      points,
      d: shape === "curved" ? pathCurved(drawn) : pathData(drawn),
      mid: midpoint(points)
    };
  }

  /* How far short of the box a line stops when there is a shape drawn at that
   * end.
   *
   * A box's border is centred on its edge, so half of it is drawn outside the
   * box — over the arrowhead, if the arrowhead is right up against it. And the
   * boxes are drawn after the arrows, so what is drawn over wins. Two pixels
   * clears the ordinary 1.5px border, the 2.5px one a box being pointed at
   * wears, and the 4px one a box can be given.
   *
   * Only where there is something to clear: a plain line still meets the box it
   * joins, or every line in every diagram would hold itself two pixels away for
   * the sake of arrowheads that are not there.
   */
  const END_CLEARANCE = 2;

  function pullBack(points, amount) {
    const last = points.length - 1;
    if (last < 1) {
      return points;
    }

    const [x1, y1] = points[last - 1];
    const [x2, y2] = points[last];
    const length = Math.hypot(x2 - x1, y2 - y1);

    // A segment shorter than the clearance is one where moving the end back
    // would put it behind its own start.
    if (!(length > amount)) {
      return points;
    }

    const left = (length - amount) / length;
    const shorter = points.slice();
    shorter[last] = [x1 + ((x2 - x1) * left), y1 + ((y2 - y1) * left)];
    return shorter;
  }

  function stopShort(points, edge) {
    const [back, forward] = endsOf(edge);
    let drawn = points;

    if (forward !== "none") {
      drawn = pullBack(drawn, END_CLEARANCE);
    }

    if (back !== "none") {
      drawn = pullBack([...drawn].reverse(), END_CLEARANCE).reverse();
    }

    return drawn;
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
  const END_ANCHOR = 10;

  const END_KINDS = [
    { name: "none", label: "Nothing" },
    { name: "arrow", label: "Arrow", fill: true, d: "M0,0 L10,5 L0,10 z" },
    { name: "open-arrow", label: "Open arrow", fill: false, d: "M0,0 L10,5 L0,10" },
    { name: "circle", label: "Circle", fill: true,
      d: "M0,5 A 5,5 0 1 0 10,5 A 5,5 0 1 0 0,5 z" },
    { name: "cross", label: "Cross", fill: false, d: "M1,1 L9,9 M9,1 L1,9" },
    // UML: a hollow triangle is "is a", a hollow diamond is "has a", a filled
    // diamond is "is made of".
    { name: "triangle", label: "Triangle (is a)", fill: false, d: "M0,0 L10,5 L0,10 z" },
    { name: "diamond", label: "Diamond (has a)", fill: false,
      d: "M0,5 L5,0 L10,5 L5,10 z" },
    { name: "diamond-filled", label: "Solid diamond (made of)", fill: true,
      d: "M0,5 L5,0 L10,5 L5,10 z" },
    // ERD: the fork that says "many of these".
    { name: "crow", label: "Crow's foot (many)", fill: false,
      d: "M10,0 L0,5 L10,10 M0,5 L10,5" }
  ];

  const END_BY_NAME = new Map(END_KINDS.map((one) => [one.name, one]));

  /* Which ends a link has when nothing has said otherwise.
   *
   * Read from the kind, because the kind is what the file says in Mermaid's own
   * words and it is the thing every other renderer will act on. `ends` in a
   * layout comment is the refinement on top, for the four this cannot spell.
   */
  function endsOf(edge) {
    const kind = String(edge?.kind || "arrow");
    const asked = Array.isArray(edge?.ends) ? edge.ends : null;

    const back = /^<|both$/.test(kind) ? "arrow" : "none";
    let forward = "arrow";

    if (/open$/.test(kind)) {
      forward = "none";
    } else if (kind === "circle") {
      forward = "circle";
    } else if (kind === "cross") {
      forward = "cross";
    }

    const named = (value, fallback) =>
      (typeof value === "string" && END_BY_NAME.has(value) ? value : fallback);

    return asked
      ? [named(asked[0], back), named(asked[1], forward)]
      : [back, forward];
  }

  // The markers a drawing actually needs, defined once each. Every end style in
  // every edge, and nothing else: a diagram of plain arrows carries one marker.
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
  const areaOf = (at) => at.w * at.h;

  const surrounds = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y
    && (outer.x + outer.w) >= (inner.x + inner.w)
    && (outer.y + outer.h) >= (inner.y + inner.h)
    && areaOf(outer) > areaOf(inner);

  function nestingDepths(nodes, layout) {
    const placed = (nodes || []).filter((node) => layout[node.id]);
    const depths = new Map();

    for (const node of placed) {
      depths.set(node.id, placed.filter((other) =>
        surrounds(layout[other.id], layout[node.id])).length);
    }

    return depths;
  }

  /* --- Groups ------------------------------------------------------------- */

  /* A group has no position of its own.
   *
   * Its frame is worked out from what is inside it, every time it is drawn.
   * That is the whole answer to padding that creeps: there is no stored
   * rectangle to add the padding to a second time, so the frame is the same
   * width after nine edits as after one. Move a box and the frame follows it;
   * take the last box out and there is no frame at all, because a group with
   * nothing in it encloses nothing.
   */
  const GROUP_PAD = 18;
  // Room above the contents for the name, which sits inside the frame rather
  // than on its edge: a name on the edge has to be drawn over the line, and
  // the line is what says where the group ends.
  const GROUP_HEAD = 22;
  const GROUP_NAME_DROP = 7;

  /* How deep in the tree of groups each group sits.
   *
   * A group inside a group inside nothing is 2. Walking up rather than down
   * because a parent is a single field and children are a search, and because
   * a group that is its own ancestor stops the walk instead of running it
   * forever — such a diagram cannot be drawn sensibly, but it must not hang
   * the page that opened it.
   */
  function groupDepths(groups) {
    const byId = new Map(groups.map((group) => [group.id, group]));
    const depths = new Map();

    for (const group of groups) {
      const seen = new Set([group.id]);
      let above = byId.get(group.parent);
      let depth = 0;

      while (above && !seen.has(above.id)) {
        seen.add(above.id);
        depth += 1;
        above = byId.get(above.parent);
      }

      depths.set(group.id, depth);
    }

    return depths;
  }

  /* Every group's frame, worked out from the boxes in it.
   *
   * Innermost first, so a group holding another group fits around the frame
   * the inner one has just been given rather than around the boxes inside it —
   * otherwise the inner name and its own padding would stick out of the outer
   * frame. A group nothing is in gets no entry, and so is never drawn.
   */
  function groupBoxes(model, layout) {
    const groups = Array.isArray(model?.groups) ? model.groups : [];
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const boxes = {};

    if (groups.length === 0) {
      return boxes;
    }

    const depths = groupDepths(groups);
    const inward = [...groups].sort((one, two) =>
      (depths.get(two.id) || 0) - (depths.get(one.id) || 0));

    for (const group of inward) {
      const held = nodes
        .filter((node) => node.parent === group.id)
        .map((node) => layout[node.id])
        .concat(groups
          .filter((other) => other.parent === group.id)
          .map((other) => boxes[other.id]))
        .filter(Boolean);

      if (held.length === 0) {
        continue;
      }

      const left = Math.min(...held.map((at) => at.x));
      const top = Math.min(...held.map((at) => at.y));
      const right = Math.max(...held.map((at) => at.x + at.w));
      const bottom = Math.max(...held.map((at) => at.y + at.h));
      // A name longer than the contents widens the frame rather than hanging
      // out of it.
      const named = (groupName(group).length * LABEL_CHAR) + (GROUP_PAD * 2);

      boxes[group.id] = {
        x: left - GROUP_PAD,
        y: top - GROUP_PAD - GROUP_HEAD,
        w: Math.max(right - left + (GROUP_PAD * 2), named),
        h: bottom - top + (GROUP_PAD * 2) + GROUP_HEAD
      };
    }

    return boxes;
  }

  // A group written without brackets is labelled with its own id by the parser,
  // which is what Mermaid draws too — so by the time a group is drawn it always
  // has a label, and an empty one is a name somebody has rubbed out.
  const groupName = (group) => String(group?.label ?? "");

  function groupMarkup(group, at) {
    const name = groupName(group);

    return `<g class="dd-group" data-group="${escapeText(group.id)}">`
      + `<rect class="dd-group-box" x="${round(at.x)}" y="${round(at.y)}"`
      + ` width="${round(at.w)}" height="${round(at.h)}" rx="8"/>`
      + (name
        ? `<text class="dd-group-name" x="${round(at.x + GROUP_PAD)}"`
          + ` y="${round(at.y + GROUP_HEAD - GROUP_NAME_DROP)}">${escapeText(name)}</text>`
        : "")
      + `</g>`;
  }

  /* --- The whole drawing -------------------------------------------------- */

  /* How much of the diagram is on screen, and where.
   *
   * A diagram is not a picture on a page here, it is a place you are looking
   * at part of. `x`, `y` and `scale` say which part: a point p in the diagram
   * is drawn at p * scale + (x, y). One transform on one group moves the whole
   * drawing, which is what makes panning and zooming cost the same whether
   * there are six boxes or six hundred.
   */
  function viewOf(view) {
    const scale = Number(view?.scale);
    return {
      x: Number(view?.x) || 0,
      y: Number(view?.y) || 0,
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1
    };
  }

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
