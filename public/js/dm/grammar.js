/* The shapes of the text itself: what a line has to look like to be read.
 *
 * The patterns, the sizes a box is measured against, the attribute list a
 * layout comment carries, and the two functions that get text into and out of
 * a label safely. `refuse` is here too — the parser declines a diagram it
 * cannot model rather than dropping the part it does not understand.
 */
(function (global) {
  "use strict";

  const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/;
  const HEADER_RE = /^(?:flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?$/i;

  /* The header the layout comments announce themselves with. Anything else
   * beginning with %% that this does not recognise is refused rather than
   * dropped, because keeping a comment we do not understand means writing it
   * back somewhere, and there is no somewhere.
   */
  const LAYOUT_MARK = "layout v1";
  const LAYOUT_HEAD_RE = /^%%\s*layout\s+v1$/i;
  const HAS_LAYOUT_RE = /^[ \t]*%%[ \t]*layout[ \t]+v1[ \t]*$/im;

  // A box with rows in it is an ordinary Mermaid node whose label has line
  // breaks in it, so a class box still renders as a class box everywhere else —
  // the kind only says to draw the divider under the first line.
  const ROW_BREAK = "<br/>";
  const ROW_SPLIT_RE = /<br\s*\/?>/i;

  /* Sizes, in the same units the drawing uses.
   *
   * Text is measured by counting characters rather than by asking the browser,
   * because this runs where there is no browser and because a box whose size
   * depends on the font that happened to load is a box that moves when the font
   * changes. It is an estimate; the box can be resized by hand, which is the
   * real answer to an estimate being wrong.
   */
  const GRID = 10;
  const CHAR_WIDTH = 7.6;
  const LINE_HEIGHT = 20;
  const PAD_X = 26;
  const PAD_Y = 18;
  const MIN_WIDTH = 90;
  const MIN_HEIGHT = 44;
  // A table is never narrower than this, and every column needs room for a word
  // plus whatever padding is set either side of it.
  const TABLE_MIN_WIDTH = 140;
  const TABLE_MIN_TEXT = 50;

  /* How a table is spaced out, and the two numbers anyone would want to change
   * about it: how far the words sit from the walls of a cell, and how much room
   * a row gets. Both live on the node, both are written in the layout comment,
   * and both have a standard the file only mentions when it is departed from.
   *
   * The title band is not one of them. It is the same height whatever else is
   * set, because it is a heading rather than a row — and a heading that changes
   * size with the rows under it stops reading as one.
   */
  const TABLE_TITLE = 26;
  const TABLE_PAD = { least: 2, most: 24, standard: 10 };
  const TABLE_GAP = { least: 10, most: 50, standard: 20 };

  const withinBounds = (value, bounds) => (Number.isFinite(Number(value))
    ? Math.min(bounds.most, Math.max(bounds.least, Math.round(Number(value))))
    : bounds.standard);

  // Everything a table is laid out by, asked once so that the drawing and the
  // measurement can never disagree about it.
  function tableMetrics(node) {
    return {
      title: TABLE_TITLE,
      pad: withinBounds(node?.pad, TABLE_PAD),
      gap: withinBounds(node?.gap, TABLE_GAP)
    };
  }
  const RANK_GAP = 90;
  const SIBLING_GAP = 40;
  const MARGIN = 30;

  /* The statements this reads besides nodes and links.
   *
   * Everything here is real Mermaid, and that is the point of reading it: a
   * colour written as a classDef is a colour every other Mermaid renderer can
   * see, and a group written as a subgraph is a group GitHub draws. What cannot
   * be said in Mermaid at all — where a box is, what icon is on it — goes in
   * the layout comments, and nowhere else.
   */
  const SUBGRAPH_RE = /^subgraph\s+(.+)$/i;
  const SUBGRAPH_HEAD_RE = /^([A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*)(?:\s*\[(.*)\])?$/;
  // A subgraph is allowed to be nothing but a title — `subgraph "Query phase"`
  // or `subgraph Query phase` — in which case Mermaid invents an id for it and
  // so does this. The placeholder holds a character no Mermaid file can
  // contain, so it cannot collide with a real name before it is replaced.
  const ANON_GROUP = "\u0000group";
  const END_RE = /^end$/i;
  const CLASSDEF_RE = /^classDef\s+([A-Za-z_][\w,-]*)\s+(.+)$/i;
  const CLASS_RE = /^class\s+([A-Za-z_][\w,-]*)\s+([A-Za-z_][\w-]*)$/i;
  // A colour on one box rather than on a named set of them. Real Mermaid, and
  // the natural thing to write when a box is a one-off.
  const STYLE_RE = /^style\s+([A-Za-z_][\w,-]*)\s+(.+)$/i;
  const DECL_RE = /^([a-zA-Z-]+)\s*:\s*(.*)$/;

  // What a box can be, beyond its Mermaid shape. All of these are ordinary
  // Mermaid nodes in the file; the kind only says how this app draws one.
  const NODE_KINDS = ["box", "table", "container", "text"];

  /* Words on the paper: a frameless box that is not carrying anything to show.
   *
   * One place answers it, because two would have to agree — the parser reading
   * a file written before there was a kind for words, and the editor turning a
   * box's frame off. If they disagreed, a box would change kind by being saved,
   * which is the one thing a file format must never do to a diagram.
   */
  const wordsOnly = (node) =>
    node.frame === "none" && !node.icon && !node.image;

  /* The layout comments, which is where everything Mermaid cannot say lives.
   *
   *     %% layout v1
   *     %% @ A 40,40 160x56 kind=table icon=lucide:database layer=1 z=2
   *     %% edge 0 sides=r,l via=210,68;210,120 ends=none,crow
   *     %% layer 1 "Backend" locked
   *
   * Anything after the size is a key=value list rather than a position, so a
   * later version can add one without the lines written by this one becoming
   * unreadable — an unknown key is kept and written back untouched, which is
   * what stops a newer editor's diagram from being damaged by an older one.
   */
  const LAYOUT_LINE_RE = /^%%\s*@\s*([A-Za-z_][A-Za-z0-9_-]*)\s+(-?\d+),(-?\d+)\s+(\d+)x(\d+)\s*(.*)$/;
  const EDGE_LINE_RE = /^%%\s*edge\s+(\d+)\s*(.*)$/i;
  const LAYER_LINE_RE = /^%%\s*layer\s+(\d+)\s+"((?:[^"\\]|\\.)*)"\s*(.*)$/i;
  /* What is true of a group and cannot be said in a subgraph.
   *
   * Not much, and deliberately: a group's frame is worked out from what is in
   * it, so there is no position and no size to write down. Only whether it is
   * locked, which is about editing it rather than about drawing it, and which
   * every other renderer is right to ignore.
   */
  const GROUP_LINE_RE = /^%%\s*group\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(.*)$/i;
  const ATTR_RE = /([A-Za-z][\w-]*)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
  const POINT_RE = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

  // What the in-block builder will open, which is not what the format can hold.
  // Kept as advice for a caller rather than as a refusal: a diagram of any size
  // has to parse, because the page editor draws one of any size and so does the
  // document.
  const MAX_NODES = 60;
  const MAX_EDGES = 120;

  /* The key=value list at the end of a layout comment.
   *
   * Read into a plain object and written back out in the order the keys were
   * first seen, so a line this wrote is a line this reproduces. Keys it does
   * not know are kept exactly as they were found rather than dropped: a diagram
   * written by a newer editor and opened by an older one has to come back
   * whole, and the only way to promise that is never to throw anything away.
   */
  function readAttributes(rest) {
    const attributes = {};
    const text = String(rest || "");
    ATTR_RE.lastIndex = 0;

    for (;;) {
      const found = ATTR_RE.exec(text);
      if (!found) {
        break;
      }

      attributes[found[1]] = unquoteAttribute(found[2]);
    }

    return attributes;
  }

  function unquoteAttribute(value) {
    const text = String(value);

    if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
      return text.slice(1, -1).replace(/\\(.)/g, "$1");
    }

    return text;
  }

  function writeAttribute(value) {
    const text = String(value);
    return /^[^\s"]+$/.test(text) && text !== ""
      ? text
      : `"${text.replace(/[\\"]/g, "\\$&")}"`;
  }

  function writeAttributes(attributes) {
    const out = [];

    for (const [key, value] of Object.entries(attributes || {})) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      out.push(`${key}=${writeAttribute(value)}`);
    }

    return out.join(" ");
  }

  // Everything the parser understood about a layout line and put somewhere of
  // its own, so what is left over is what has to be written back verbatim.
  function restAttributes(attributes, known) {
    const rest = {};

    for (const [key, value] of Object.entries(attributes || {})) {
      if (!known.includes(key)) {
        rest[key] = value;
      }
    }

    return rest;
  }

  /* Everything a node line can say that this understands. Anything else is
   * carried in `extra` and written back untouched, which is what lets a file
   * written by a later version of this survive being opened by an earlier one.
   *
   * A key missing from here is worse than unknown: it is read into the node AND
   * kept in `extra`, and `extra` is spread last when the line is written — so
   * the value that was read wins over the value that was changed, and the edit
   * is thrown away on save. Every key read below has to appear here.
   */
  const NODE_ATTRS = ["kind", "icon", "image", "layer", "z", "pad", "gap", "frame",
    "cells", "shape"];
  const GROUP_ATTRS = ["lock"];
  const EDGE_ATTRS = ["sides", "via", "ends", "route", "class"];

  function readPoints(value) {
    const points = [];

    for (const part of String(value || "").split(";")) {
      const found = part.trim().match(POINT_RE);
      if (!found) {
        return null;
      }

      points.push({ x: Number(found[1]), y: Number(found[2]) });
    }

    return points.length > 0 ? points : null;
  }

  function writePoints(points) {
    return points.map((point) => `${round(point.x)},${round(point.y)}`).join(";");
  }

  const round = (value) => Math.round(Number(value) * 10) / 10;

  function refuse(reason) {
    return { ok: false, reason };
  }

  /* Node and link text, in and out.
   *
   * Mermaid reads the text between a shape's brackets as literal unless it
   * contains something that would close the shape early, in which case it has
   * to be quoted — and inside quotes a quote itself is the entity #quot;.
   * Quoting everything would be safe and would also turn every hand-written
   * diagram into a wall of quotation marks the first time anyone renamed a box,
   * so text is quoted only when leaving it bare would change how it parses.
   */
  const UNSAFE_CHARS_RE = /[[\]{}()<>|"`#;\\\n]/;

  function isBareSafe(text) {
    const value = String(text);
    return value !== ""
      && value === value.trim()
      && !UNSAFE_CHARS_RE.test(value)
      // The link tokens. A box labelled "a -- b" written bare would be read as
      // two boxes with a line between them.
      && !/--|==|-\./.test(value);
  }

  function quoteText(text) {
    const value = String(text);
    return isBareSafe(value) ? value : `"${value.replace(/"/g, "#quot;")}"`;
  }

  function unquoteText(raw) {
    const value = String(raw).trim();

    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
      return value.slice(1, -1).replace(/#quot;/g, "\"");
    }

    return value;
  }

  /* One node at `pos`: an id, optionally followed by a shape with text in it.
   * A bare id is a node too — "A --> B" declares both — and is reported with a
   * null shape so a real declaration elsewhere in the diagram still wins.
   */

  const pad = (depth) => "    ".repeat(Math.max(1, depth));

  function snap(value) {
    return Math.round(Number(value) / GRID) * GRID;
  }

  function snapUp(value) {
    return Math.ceil(Number(value) / GRID) * GRID;
  }

  // The lines inside a box. One for an ordinary box; for a table box the first
  // is its title and the rest are its rows.

  global.DmGrammar = {
    GRID, CHAR_WIDTH, LINE_HEIGHT, PAD_X, PAD_Y, MIN_WIDTH, MIN_HEIGHT, TABLE_MIN_WIDTH,
    TABLE_MIN_TEXT, TABLE_TITLE, TABLE_PAD, TABLE_GAP, withinBounds, tableMetrics, RANK_GAP,
    SIBLING_GAP, MARGIN, ID_RE, HEADER_RE, LAYOUT_MARK, LAYOUT_HEAD_RE, HAS_LAYOUT_RE,
    ROW_BREAK, ROW_SPLIT_RE, SUBGRAPH_RE, SUBGRAPH_HEAD_RE, ANON_GROUP, END_RE, CLASSDEF_RE,
    CLASS_RE, STYLE_RE, DECL_RE, NODE_KINDS, wordsOnly, LAYOUT_LINE_RE, EDGE_LINE_RE,
    LAYER_LINE_RE, GROUP_LINE_RE, ATTR_RE, POINT_RE, MAX_NODES, MAX_EDGES, readAttributes,
    unquoteAttribute, writeAttribute, writeAttributes, restAttributes, NODE_ATTRS,
    GROUP_ATTRS, EDGE_ATTRS, readPoints, writePoints, round, refuse, isBareSafe, quoteText,
    unquoteText, pad, snap, snapUp
  };
})(typeof window === "undefined" ? globalThis : window);
