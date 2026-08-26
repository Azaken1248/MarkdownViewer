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

  const DIRECTIONS = ["TB", "TD", "BT", "LR", "RL"];

  // Longest opener first, because "((" is a prefix of "(((" and "[" of "[(",
  // and the first shape that matches wins. Where one opener has two possible
  // closers — "[/" ends either "/]" or "\]" — both are listed and whichever
  // closer is actually present decides.
  const SHAPES = [
    { name: "double-circle", open: "(((", close: ")))", label: "Double circle" },
    { name: "circle", open: "((", close: "))", label: "Circle" },
    { name: "stadium", open: "([", close: "])", label: "Stadium" },
    { name: "cylinder", open: "[(", close: ")]", label: "Cylinder" },
    { name: "subroutine", open: "[[", close: "]]", label: "Subroutine" },
    { name: "lean-right", open: "[/", close: "/]", label: "Parallelogram" },
    { name: "trapezoid", open: "[/", close: "\\]", label: "Trapezoid" },
    { name: "lean-left", open: "[\\", close: "\\]", label: "Parallelogram left" },
    { name: "trapezoid-alt", open: "[\\", close: "/]", label: "Trapezoid down" },
    { name: "hexagon", open: "{{", close: "}}", label: "Hexagon" },
    { name: "asymmetric", open: ">", close: "]", label: "Flag" },
    { name: "rect", open: "[", close: "]", label: "Box" },
    { name: "round", open: "(", close: ")", label: "Rounded" },
    { name: "diamond", open: "{", close: "}", label: "Decision" }
  ];

  // The shapes worth offering in a menu. The rest still parse and still come
  // back out unchanged; they are just not something anyone goes looking for.
  const SHAPE_CHOICES = ["rect", "round", "stadium", "diamond", "circle", "hexagon", "cylinder", "subroutine"];

  // Mermaid lets a link be drawn longer by adding dashes — "-->" and "---->"
  // are the same arrow with different rank spacing — so every token here
  // matches its family rather than one exact spelling. Order matters for the
  // same reason as the shapes: "-.->"" would otherwise be read as "---".
  const EDGE_KINDS = [
    { name: "arrow", token: "-->", head: /^-{2,}>/, label: "Arrow" },
    { name: "open", token: "---", head: /^-{3,}/, label: "Line" },
    { name: "dotted", token: "-.->", head: /^-\.-+>/, label: "Dotted arrow" },
    { name: "dotted-open", token: "-.-", head: /^-\.-+(?!>)/, label: "Dotted line" },
    { name: "thick", token: "==>", head: /^={2,}>/, label: "Thick arrow" },
    { name: "thick-open", token: "===", head: /^={3,}/, label: "Thick line" },
    // Mermaid's own circle and cross endings, which are the two endpoint styles
    // it can express and this used to refuse.
    { name: "circle", token: "--o", head: /^-{2,}o/, label: "Circle end" },
    { name: "cross", token: "--x", head: /^-{2,}x/, label: "Cross end" },
    // And the ones that point both ways.
    { name: "both", token: "<-->", head: /^<-{2,}>/, label: "Both ways" },
    { name: "dotted-both", token: "<-.->", head: /^<-\.-+>/, label: "Dotted both ways" },
    { name: "thick-both", token: "<==>", head: /^<={2,}>/, label: "Thick both ways" }
  ];

  // Tried in this order against the text after a node.
  const EDGE_ORDER = [
    "dotted-both", "thick-both", "both",
    "dotted", "dotted-open", "arrow", "circle", "cross", "open", "thick", "thick-open"
  ];

  // The "A-- yes -->B" spelling, where the label sits inside the link instead
  // of in pipes after it. Parsed, then written back the other way; there is one
  // spelling on the way out and it is the one that cannot be misread.
  const EDGE_TEXT_FORMS = [
    { name: "dotted", re: /^-\.\s*([^|]+?)\s*\.-+>/ },
    { name: "dotted-open", re: /^-\.\s*([^|]+?)\s*\.-+(?!>)/ },
    { name: "arrow", re: /^--\s*([^|]+?)\s*-{2,}>/ },
    { name: "open", re: /^--\s*([^|]+?)\s*-{3,}/ },
    { name: "thick", re: /^==\s*([^|]+?)\s*={2,}>/ },
    { name: "thick-open", re: /^==\s*([^|]+?)\s*={3,}/ }
  ];

  /* A link is a line style and two ends, and Mermaid can spell some of the
   * combinations and not others.
   *
   * The rule is that the file always carries a real link token — the nearest
   * one Mermaid has — so a diagram rendered anywhere else reads correctly, and
   * the exact ends go in a layout comment on top for the four styles Mermaid
   * cannot say. A UML "is a" arrow is written `-->` and reads as an arrow
   * elsewhere, which is the truthful approximation; writing nothing at all, or
   * inventing syntax, would not be.
   */
  const LINE_STYLES = [
    ["solid", "Solid"],
    ["dotted", "Dotted"],
    ["thick", "Thick"]
  ];

  // style -> what to write for [nothing at each end, an end forward, ends both ways]
  const LINK_BY_STYLE = {
    solid: { none: "open", forward: "arrow", both: "both", circle: "circle", cross: "cross" },
    dotted: { none: "dotted-open", forward: "dotted", both: "dotted-both" },
    thick: { none: "thick-open", forward: "thick", both: "thick-both" }
  };

  // Which of the three a kind is drawn in, whatever its ends are.
  function lineStyleOf(kind) {
    const name = String(kind || "arrow");
    if (name.startsWith("dotted")) {
      return "dotted";
    }

    return name.startsWith("thick") ? "thick" : "solid";
  }

  /* The nearest real link for a line style and a pair of ends.
   *
   * `circle` and `cross` are Mermaid's own, so they are used exactly when they
   * fit — a solid line ending in a circle is `--o` and needs no comment at all.
   * Everything else lands on an arrow or a plain line, whichever is closer to
   * what was asked for.
   */
  function linkFor(style, ends) {
    const table = LINK_BY_STYLE[style] || LINK_BY_STYLE.solid;
    const [back, forward] = Array.isArray(ends) ? ends : ["none", "arrow"];

    // Anything at all behind the line makes it a both-ways link, which is the
    // nearest real thing however unalike the two ends actually are.
    if (back !== "none") {
      return table.both;
    }

    // Every style can say "nothing"; solid can also say Mermaid's own circle
    // and cross. Everything else is nearer to an arrow than to a plain line.
    return table[forward] || table.forward;
  }

  /* The three shapes a line can be drawn in.
   *
   * Not a Mermaid idea at all — Mermaid draws a link however its renderer feels
   * like — so this lives in the layout comment with the rest of what is ours,
   * and a file that has never been near this editor is angled, which is what it
   * has always been drawn as.
   */
  const ROUTE_SHAPES = [
    ["angled", "Angled"],
    ["curved", "Curved"],
    ["straight", "Straight"]
  ];

  const ROUTE_DEFAULT = "angled";
  const ROUTE_NAMES = new Set(ROUTE_SHAPES.map(([name]) => name));

  const SHAPE_BY_NAME = new Map(SHAPES.map((shape) => [shape.name, shape]));

  /* The same shapes, grouped by opener and longest opener first.
   *
   * Two things have to be true at once. Between openers, longer wins: "((" is a
   * prefix of "(((" and would otherwise read a circle out of the front of a
   * double circle. Within one opener, nearest closer wins: "[/" ends at either
   * "/]" or "\]", and trying them in list order lets "A[/c\] --> B[/d/]" reach
   * past its own end and swallow the next node whole.
   */
  const OPENERS = (() => {
    const grouped = new Map();

    for (const shape of SHAPES) {
      if (!grouped.has(shape.open)) {
        grouped.set(shape.open, []);
      }
      grouped.get(shape.open).push(shape);
    }

    return [...grouped.entries()].sort((a, b) => b[0].length - a[0].length);
  })();
  const EDGE_BY_NAME = new Map(EDGE_KINDS.map((kind) => [kind.name, kind]));

  // Mermaid's own ids are looser than this. Keeping to a conservative subset
  // means an id this parser accepts is an id it can also write back and an id
  // no shape or link token can be mistaken for.
  //
  // The hyphen is the awkward one: it is legal inside an id and it is also the
  // first character of every solid link, so a plain [\w-]* would read "A-->B"
  // as one node called "A--" and "A----D" as one called "A----D". A hyphen is
  // therefore only part of an id when something alphanumeric follows it, which
  // takes "my-node" and leaves every run of dashes to the link parser.
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

  const NODE_ATTRS = ["kind", "icon", "image", "layer", "z"];
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
  function matchNode(line, pos) {
    const matched = line.slice(pos).match(ID_RE);
    if (!matched) {
      return null;
    }

    const id = matched[0];
    const at = pos + id.length;
    const rest = line.slice(at);

    for (const [open, shapes] of OPENERS) {
      if (!rest.startsWith(open)) {
        continue;
      }

      const from = open.length;

      // Quoted text is quoted precisely so that it may contain the bracket that
      // would otherwise close the shape. Scanning for a closer first would stop
      // inside the quotes and leave the rest of the label as gibberish, so the
      // quote is closed first and the shape after it.
      if (rest[from] === "\"") {
        const quote = rest.indexOf("\"", from + 1);
        if (quote === -1) {
          continue;
        }

        const quoted = shapes.find((shape) => rest.startsWith(shape.close, quote + 1));
        if (!quoted) {
          continue;
        }

        return withClass(line, {
          id,
          shape: quoted.name,
          text: unquoteText(rest.slice(from, quote + 1)),
          next: at + quote + 1 + quoted.close.length
        });
      }

      let nearest = null;

      for (const shape of shapes) {
        const end = rest.indexOf(shape.close, from);
        if (end !== -1 && (!nearest || end < nearest.end)) {
          nearest = { shape, end };
        }
      }

      if (!nearest) {
        continue;
      }

      return withClass(line, {
        id,
        shape: nearest.shape.name,
        text: unquoteText(rest.slice(from, nearest.end)),
        next: at + nearest.end + nearest.shape.close.length
      });
    }

    return withClass(line, { id, shape: null, text: null, next: at });
  }

  /* Mermaid's shorthand for putting a class on a box: A[Text]:::blue.
   *
   * Read here and written back as an ordinary `class` statement, because there
   * is one spelling on the way out and it is the one that reads the same
   * whether one box has the class or twenty do.
   */
  function withClass(line, node) {
    const found = line.slice(node.next).match(/^:::([A-Za-z_][\w-]*)/);

    if (found) {
      return { ...node, classes: [found[1]], next: node.next + found[0].length };
    }

    return node;
  }

  /* One link at `pos`, in either of the two spellings Mermaid allows for a
   * labelled one.
   */
  function matchLink(line, pos) {
    const rest = line.slice(pos);

    for (const name of EDGE_ORDER) {
      const kind = EDGE_BY_NAME.get(name);
      const head = rest.match(kind.head);
      if (!head) {
        continue;
      }

      const next = pos + head[0].length;
      const after = line.slice(next);

      if (after.startsWith("|")) {
        // And a quoted link label may contain the pipe that would otherwise end
        // it, for the same reason quoted node text may contain its bracket.
        const quote = after[1] === "\"" ? after.indexOf("\"", 2) : -1;
        const close = after[1] === "\""
          ? (quote === -1 ? -1 : quote + 1)
          : after.indexOf("|", 1);

        if (close !== -1 && after[close] === "|") {
          return { kind: name, label: unquoteText(after.slice(1, close)), next: next + close + 1 };
        }
      }

      return { kind: name, label: "", next };
    }

    for (const form of EDGE_TEXT_FORMS) {
      const found = rest.match(form.re);
      if (found) {
        return { kind: form.name, label: unquoteText(found[1]), next: pos + found[0].length };
      }
    }

    return null;
  }

  /* A whole statement: a node, then any number of link-and-node pairs. Mermaid
   * lets "A --> B --> C" stand for two arrows, so a line is a chain rather than
   * a single edge.
   *
   * Returns null for anything that is not exactly that, which is what refuses
   * a subgraph, a classDef or a stray word without having to know what any of
   * them look like.
   */
  function parseChain(line) {
    let pos = 0;

    const skipSpace = () => {
      while (pos < line.length && /\s/.test(line[pos])) {
        pos += 1;
      }
    };

    /* One slot: a node, or several joined by `&`.
     *
     * "A & B --> C & D" is Mermaid's shorthand for four arrows, every left to
     * every right. It is read here and written back as those four arrows on
     * four lines, which draws identically — the shorthand is a spelling, and
     * there is one spelling on the way out.
     */
    const readSlot = () => {
      const slot = [];

      for (;;) {
        skipSpace();
        const node = matchNode(line, pos);
        if (!node) {
          return null;
        }

        pos = node.next;
        slot.push(node);
        skipSpace();

        if (line[pos] !== "&") {
          return slot;
        }

        pos += 1;
      }
    };

    const slots = [];
    const links = [];
    const first = readSlot();
    if (!first) {
      return null;
    }

    slots.push(first);

    for (;;) {
      skipSpace();
      if (pos >= line.length) {
        return { slots, links };
      }

      const link = matchLink(line, pos);
      if (!link) {
        return null;
      }

      pos = link.next;
      const slot = readSlot();
      if (!slot) {
        return null;
      }

      slots.push(slot);
      links.push(link);
    }
  }

  /* Mermaid source in, a model out — or a refusal with a reason worth showing
   * someone, since the reason is why the builder button is not there.
   *
   * What this reads, it reads completely: a subgraph is a group with things
   * inside it, a classDef is a colour, a class statement says which boxes wear
   * it. What it cannot account for it refuses, and the refusals are the safety
   * property — a diagram opened half-read is a diagram written back half-gone.
   */
  function parseFlowchart(source) {
    const text = String(source == null ? "" : source);
    const nodes = new Map();
    const edges = [];
    const groups = [];
    const classes = {};
    const layers = [];
    const applied = [];
    const styles = [];
    let direction = "TD";
    let header = false;
    // Null until a layout header is seen, so a diagram that was never arranged
    // comes back with no layout at all rather than with an empty one — the two
    // mean different things to everything downstream.
    let placed = null;
    const edgeLines = new Map();
    // The subgraphs currently open. Anything declared while this is not empty
    // belongs to whatever is on top of it, which is exactly Mermaid's own rule.
    const open = [];

    for (const raw of text.split("\n")) {
      // A trailing semicolon is Mermaid's optional statement terminator and
      // means nothing to the model.
      const line = raw.replace(/;\s*$/, "").trim();
      if (line === "") {
        continue;
      }

      // Comments are allowed either side of the header, because Mermaid allows
      // them there. Only ours are allowed at all.
      if (line.startsWith("%%")) {
        if (LAYOUT_HEAD_RE.test(line)) {
          placed = placed || [];
          continue;
        }

        if (!placed) {
          return refuse("this diagram has comments in it the builder cannot keep");
        }

        const at = line.match(LAYOUT_LINE_RE);
        if (at) {
          placed.push({
            id: at[1],
            x: Number(at[2]),
            y: Number(at[3]),
            w: Number(at[4]),
            h: Number(at[5]),
            attributes: readAttributes(at[6]),
            // Kept as written as well as read, because the first version of
            // this format put `table` on the end as a bare word rather than as
            // a key, and those files are out there.
            rest: at[6]
          });
          continue;
        }

        const edgeLine = line.match(EDGE_LINE_RE);
        if (edgeLine) {
          edgeLines.set(Number(edgeLine[1]), readAttributes(edgeLine[2]));
          continue;
        }

        const layer = line.match(LAYER_LINE_RE);
        if (layer) {
          const flags = layer[3].split(/\s+/).filter(Boolean);
          if (flags.some((flag) => flag !== "locked" && flag !== "hidden")) {
            return refuse("this diagram has a layer written in a way the builder cannot keep");
          }

          layers.push({
            id: Number(layer[1]),
            name: unquoteAttribute(`"${layer[2]}"`),
            locked: flags.includes("locked"),
            hidden: flags.includes("hidden")
          });
          continue;
        }

        return refuse("this diagram has comments in it the builder cannot keep");
      }

      if (!header) {
        const declared = line.match(HEADER_RE);
        if (!declared) {
          return refuse("this is not a flowchart");
        }

        direction = (declared[1] || "TD").toUpperCase();
        header = true;
        continue;
      }

      const subgraph = line.match(SUBGRAPH_RE);
      if (subgraph) {
        const head = subgraph[1].trim().match(SUBGRAPH_HEAD_RE);
        // Not `id` or `id [label]`, so the whole of it is a title and the id is
        // ours to invent — which is what Mermaid does with one of these too.
        const id = head ? head[1] : `${ANON_GROUP}${groups.length}`;
        const label = head
          ? (head[2] === undefined ? head[1] : unquoteText(head[2]))
          : unquoteText(subgraph[1].trim());

        if (nodes.has(id) || groups.some((group) => group.id === id)) {
          return refuse("two things in this diagram are called the same name");
        }

        groups.push({
          id,
          // `subgraph Backend` with no brackets uses the id as the label, which
          // is what Mermaid draws.
          label,
          parent: open.length > 0 ? open[open.length - 1] : null
        });
        open.push(id);
        continue;
      }

      if (END_RE.test(line)) {
        if (open.length === 0) {
          return refuse("this diagram closes a subgraph it never opened");
        }

        open.pop();
        continue;
      }

      // A direction inside a subgraph is Mermaid's own, and belongs to the
      // group rather than to the diagram.
      const inner = line.match(/^direction\s+(TB|TD|BT|LR|RL)$/i);
      if (inner && open.length > 0) {
        groups.find((group) => group.id === open[open.length - 1]).direction = inner[1].toUpperCase();
        continue;
      }

      const defined = line.match(CLASSDEF_RE);
      if (defined) {
        const declarations = readDeclarations(defined[2]);
        if (!declarations) {
          return refuse("this diagram has a style the builder cannot read");
        }

        for (const name of defined[1].split(",")) {
          classes[name.trim()] = { ...declarations };
        }

        continue;
      }

      const styled = line.match(STYLE_RE);
      if (styled) {
        const declarations = readDeclarations(styled[2]);
        if (!declarations) {
          return refuse("this diagram has a style the builder cannot read");
        }

        for (const id of styled[1].split(",")) {
          styles.push({ id: id.trim(), declarations });
        }

        continue;
      }

      const wears = line.match(CLASS_RE);
      if (wears) {
        for (const id of wears[1].split(",")) {
          applied.push({ id: id.trim(), name: wears[2] });
        }

        continue;
      }

      const chain = parseChain(line);
      if (!chain) {
        return refuse("this diagram uses Mermaid the builder does not model");
      }

      for (const node of chain.slots.flat()) {
        const known = nodes.get(node.id);

        // A box with nothing written in it is drawn by Mermaid with its id in
        // it, so that is what it says here too. Doing this on the way in as
        // well as on the way out is what keeps parse(serialize(model)) equal to
        // model for every diagram this parser accepts.
        const named = (text) => (String(text ?? "").trim() === "" ? node.id : text);

        if (!known) {
          if (groups.some((group) => group.id === node.id)) {
            return refuse("two things in this diagram are called the same name");
          }

          const made = { id: node.id, shape: node.shape || "rect", text: named(node.text) };
          if (open.length > 0) {
            made.parent = open[open.length - 1];
          }
          if (node.classes) {
            made.classes = [...node.classes];
          }

          nodes.set(node.id, made);
          continue;
        }

        // A bare mention of a node already declared says nothing new about it.
        if (node.shape) {
          known.shape = node.shape;
          known.text = named(node.text);
        }

        if (node.classes) {
          known.classes = [...(known.classes || []), ...node.classes];
        }
      }

      for (const [index, link] of chain.links.entries()) {
        // Every node on the left of the link to every node on its right, which
        // for the ordinary one-to-one case is the one arrow it looks like.
        for (const from of chain.slots[index]) {
          for (const to of chain.slots[index + 1]) {
            edges.push({
              from: from.id,
              to: to.id,
              kind: link.kind,
              label: link.label
            });
          }
        }
      }
    }

    if (!header) {
      return refuse("this is not a flowchart");
    }

    if (open.length > 0) {
      return refuse("this diagram leaves a subgraph open");
    }

    for (const styled of styles) {
      const node = nodes.get(styled.id);
      if (!node) {
        return refuse("this diagram styles a box that is not in it");
      }

      node.style = { ...(node.style || {}), ...styled.declarations };
    }

    for (const wears of applied) {
      const node = nodes.get(wears.id);
      if (!node) {
        // Mermaid ignores a class applied to nothing. Writing it back would
        // mean keeping a name for a box that does not exist, so this is a
        // refusal rather than a quiet drop.
        return refuse("this diagram gives a class to a box that is not in it");
      }

      node.classes = [...(node.classes || []), wears.name];
    }

    const model = {
      ok: true,
      direction,
      nodes: [...nodes.values()],
      edges
    };

    if (groups.length > 0) {
      model.groups = groups;
    }

    if (Object.keys(classes).length > 0) {
      model.classes = classes;
    }

    if (layers.length > 0) {
      model.layers = layers;
    }

    nameAnonymousGroups(model);
    attachLayout(model, placed, edgeLines);
    orderClasses(model);
    return orderNodes(model);
  }

  // `fill:#f00,stroke:#333` — the value half of a classDef or a style, which
  // are the same list written after different words.
  function readDeclarations(text) {
    const declarations = {};

    for (const part of String(text).split(",")) {
      const pair = part.trim().match(DECL_RE);
      if (!pair) {
        return null;
      }

      declarations[pair[1]] = pair[2].trim();
    }

    return declarations;
  }

  /* A name for every group that arrived without one.
   *
   * Done after the whole diagram has been read, because the name has to be one
   * nothing else in it is using and the rest of it is not known until the end.
   * The id then goes into the file, so the group keeps the same name every time
   * afterwards rather than being renamed on each save.
   */
  function nameAnonymousGroups(model) {
    if (!model.groups) {
      return;
    }

    const taken = new Set([
      ...model.nodes.map((node) => node.id),
      ...model.groups.map((group) => group.id)
    ]);

    for (const group of model.groups) {
      if (!group.id.startsWith(ANON_GROUP)) {
        continue;
      }

      let name = "";
      for (let n = 1; ; n += 1) {
        name = `group${n}`;
        if (!taken.has(name)) {
          break;
        }
      }

      taken.add(name);

      for (const node of model.nodes) {
        if (node.parent === group.id) {
          node.parent = name;
        }
      }

      for (const other of model.groups) {
        if (other.parent === group.id) {
          other.parent = name;
        }
      }

      group.id = name;
    }
  }

  /* What the layout comments said, put where it belongs.
   *
   * A position for a box that is not in the diagram is a position for nothing;
   * dropping it is the only reading that keeps what comes back out the same as
   * what went in.
   */
  function attachLayout(model, placed, edgeLines) {
    if (placed) {
      const layout = {};
      const known = new Map(model.nodes.map((node) => [node.id, node]));

      for (const at of placed) {
        const node = known.get(at.id);
        if (!node) {
          continue;
        }

        layout[at.id] = { x: at.x, y: at.y, w: at.w, h: at.h };

        // `table` used to be a bare word on the end of the line rather than a
        // key. Files written that way are still out there and still open.
        const legacy = /(?:^|\s)table(?:\s|$)/.test(at.rest || "") ? "table" : null;
        const kind = at.attributes.kind || legacy;
        if (NODE_KINDS.includes(kind) && kind !== "box") {
          node.kind = kind;
        }

        for (const key of ["icon", "image"]) {
          if (at.attributes[key]) {
            node[key] = at.attributes[key];
          }
        }

        for (const key of ["layer", "z"]) {
          if (at.attributes[key] !== undefined && /^-?\d+$/.test(at.attributes[key])) {
            node[key] = Number(at.attributes[key]);
          }
        }

        const rest = restAttributes(at.attributes, NODE_ATTRS);
        if (Object.keys(rest).length > 0) {
          node.extra = rest;
        }
      }

      model.layout = layout;
    }

    for (const [index, attributes] of edgeLines) {
      const edge = model.edges[index];
      if (!edge) {
        continue;
      }

      if (attributes.sides && /^[ltrb],[ltrb]$/.test(attributes.sides)) {
        edge.sides = attributes.sides.split(",");
      }

      const via = attributes.via ? readPoints(attributes.via) : null;
      if (via) {
        edge.waypoints = via;
      }

      if (attributes.ends && /^[\w-]+,[\w-]+$/.test(attributes.ends)) {
        edge.ends = attributes.ends.split(",");
      }

      // The default is not written down, so a file saying it is a file somebody
      // wrote by hand, and it still means the same thing.
      if (ROUTE_NAMES.has(attributes.route)) {
        edge.route = attributes.route;
      }

      if (attributes.class) {
        edge.class = attributes.class;
      }

      const rest = restAttributes(attributes, EDGE_ATTRS);
      if (Object.keys(rest).length > 0) {
        edge.extra = rest;
      }
    }
  }

  /* The classes a box wears, in the order they are written back.
   *
   * A box wearing two of them has to list them in the same order the file will
   * list them, or reading what this writes gives a different model than the one
   * that was written — which is the one thing this format promises not to do.
   */
  function orderClasses(model) {
    const order = Object.keys(model.classes || {});

    for (const node of model.nodes) {
      for (const name of node.classes || []) {
        if (!order.includes(name)) {
          order.push(name);
        }
      }
    }

    for (const node of model.nodes) {
      if (!node.classes) {
        continue;
      }

      const seen = [...new Set(node.classes)];
      node.classes = seen.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
  }

  /* The boxes, in the order they will be written.
   *
   * A subgraph's members have to be declared inside it, so the file's order is
   * the tree's order: what is at the top level, then each group with its own
   * contents inside it. Mermaid enforces this too, which is why reading a real
   * file and reordering it here almost never changes anything — but a model
   * assembled by hand can be in any order at all, and it still has to come back
   * out the same way twice.
   */
  function orderNodes(model) {
    if (!model.groups) {
      return model;
    }

    const ordered = [];
    const parentOf = parentIn(model.groups);

    const walk = (parent) => {
      for (const node of model.nodes) {
        if (parentOf(node) === parent) {
          ordered.push(node);
        }
      }

      for (const group of model.groups) {
        if (parentOf(group) === parent) {
          walk(group.id);
        }
      }
    };

    walk(null);
    model.nodes = ordered.concat(unreached(ordered, model.nodes));
    return model;
  }

  /* Which group a thing is in, as far as this diagram knows.
   *
   * A model put together by hand — by an editor that has just taken a group
   * apart, say — can leave a box pointing at a group that is no longer there.
   * Both the walk that orders the boxes and the walk that writes them out go
   * group by group, so a box like that is in neither walk and would quietly
   * vanish from the file. Losing which group a box was in is a small loss.
   * Losing the box is not, so it comes back to the top level instead.
   */
  function parentIn(groups) {
    const known = new Set(groups.map((group) => group.id));
    return (item) => (item.parent && known.has(item.parent) ? item.parent : null);
  }

  /* Whatever a walk of the tree could not reach.
   *
   * A group that contains itself has no place in the tree to be walked to, and
   * nor has anything inside it. That is not a diagram anyone can draw, but it
   * is still a diagram somebody may have to open and put right, and they cannot
   * put right boxes that are no longer in the file. So the walk decides the
   * order, and this decides that nothing is left out of it.
   */
  function unreached(reached, all) {
    const seen = new Set(reached);
    return all.filter((item) => !seen.has(item));
  }

  /* The model back to Mermaid.
   *
   * The header, then everything Mermaid cannot say written as comments it
   * discards, then the diagram itself: the groups with their boxes inside them,
   * the arrows, and the colours as classDef and class. Every node is declared
   * even when the source it came from left one implied, so that what comes out
   * says everything the model knows rather than depending on where a node
   * happened to be mentioned first.
   *
   * What comes out of here is a flowchart. Not a flowchart with our things
   * bolted on — a flowchart, which GitHub renders, with its arrangement and its
   * icons written where Mermaid will not look.
   */
  function serializeFlowchart(model) {
    const direction = DIRECTIONS.includes(model?.direction) ? model.direction : "TD";
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    const groups = Array.isArray(model?.groups) ? model.groups : [];
    const layers = Array.isArray(model?.layers) ? model.layers : [];
    const classes = model?.classes && typeof model.classes === "object" ? model.classes : {};
    const layout = model?.layout && typeof model.layout === "object" ? model.layout : null;
    const lines = [`flowchart ${direction}`];

    /* --- What Mermaid cannot say ---------------------------------------- */

    if (layout || layers.length > 0 || edges.some(hasEdgeExtras)) {
      lines.push(`    %% ${LAYOUT_MARK}`);
    }

    if (layout) {
      for (const node of nodes) {
        const at = layout[node.id];
        if (!at) {
          continue;
        }

        const attributes = writeAttributes({
          kind: node.kind && node.kind !== "box" ? node.kind : "",
          icon: node.icon || "",
          image: node.image || "",
          layer: Number.isFinite(node.layer) ? String(node.layer) : "",
          z: Number.isFinite(node.z) ? String(node.z) : "",
          ...(node.extra || {})
        });

        // Whole numbers, because the format has no room for anything else and
        // because half a pixel is not a position anyone chose.
        const size = `${Math.max(1, Math.round(at.w))}x${Math.max(1, Math.round(at.h))}`;
        const where = `${Math.round(at.x)},${Math.round(at.y)} ${size}`;
        lines.push(`    %% @ ${node.id} ${where}${attributes ? ` ${attributes}` : ""}`);
      }
    }

    for (const [index, edge] of edges.entries()) {
      if (!hasEdgeExtras(edge)) {
        continue;
      }

      const attributes = writeAttributes({
        sides: edge.sides ? edge.sides.join(",") : "",
        via: edge.waypoints ? writePoints(edge.waypoints) : "",
        ends: edge.ends ? edge.ends.join(",") : "",
        route: edge.route && edge.route !== ROUTE_DEFAULT ? edge.route : "",
        class: edge.class || "",
        ...(edge.extra || {})
      });

      lines.push(`    %% edge ${index} ${attributes}`);
    }

    for (const layer of layers) {
      // Always quoted, even when the name has no space in it: a layer's name is
      // a name rather than a value, and the line is read back by a shape that
      // expects the quotes to be there.
      const name = String(layer.name).replace(/[\\"]/g, "\\$&");
      const flags = `${layer.locked ? " locked" : ""}${layer.hidden ? " hidden" : ""}`;
      lines.push(`    %% layer ${layer.id} "${name}"${flags}`);
    }

    /* --- The diagram ----------------------------------------------------- */

    const declare = (node, depth) => {
      const shape = SHAPE_BY_NAME.get(node.shape) || SHAPE_BY_NAME.get("rect");
      // An unnamed box would serialize to nothing between the brackets, which
      // Mermaid reads as a parse error rather than as an empty box.
      const text = String(node.text ?? "").trim() || node.id;
      lines.push(`${pad(depth)}${node.id}${shape.open}${quoteText(text)}${shape.close}`);
    };

    // A group's boxes have to be declared inside it, which makes writing this
    // out a walk of the tree rather than a walk of the list.
    const parentOf = parentIn(groups);
    const declared = new Set();

    const walk = (parent, depth) => {
      for (const node of nodes) {
        if (parentOf(node) === parent) {
          declared.add(node);
          declare(node, depth);
        }
      }

      for (const group of groups) {
        if (parentOf(group) !== parent) {
          continue;
        }

        lines.push(`${pad(depth)}subgraph ${group.id} [${quoteText(String(group.label ?? group.id))}]`);
        if (DIRECTIONS.includes(group.direction)) {
          lines.push(`${pad(depth + 1)}direction ${group.direction}`);
        }

        walk(group.id, depth + 1);
        lines.push(`${pad(depth)}end`);
      }
    };

    walk(null, 1);

    // A box the walk never reached is still a box, and a file it is missing
    // from is a file that has lost it.
    for (const node of unreached(declared, nodes)) {
      declare(node, 1);
    }

    for (const edge of edges) {
      const kind = EDGE_BY_NAME.get(edge.kind) || EDGE_BY_NAME.get("arrow");
      const label = String(edge.label ?? "").trim();
      const middle = label ? `|${quoteText(label)}|` : "";
      lines.push(`    ${edge.from} ${kind.token}${middle} ${edge.to}`);
    }

    /* --- The colours, which are real Mermaid ----------------------------- */

    for (const [name, declarations] of Object.entries(classes)) {
      const written = Object.entries(declarations)
        .map(([key, value]) => `${key}:${value}`)
        .join(",");
      lines.push(`    classDef ${name} ${written}`);
    }

    for (const node of nodes) {
      if (!node.style || Object.keys(node.style).length === 0) {
        continue;
      }

      const written = Object.entries(node.style)
        .map(([key, value]) => `${key}:${value}`)
        .join(",");
      lines.push(`    style ${node.id} ${written}`);
    }

    // Grouped by class rather than by box: one line saying which boxes are blue
    // reads better than twenty saying each of them is, and it is the spelling
    // Mermaid's own documentation uses.
    for (const name of classOrder(model)) {
      const wearing = nodes.filter((node) => (node.classes || []).includes(name));
      if (wearing.length > 0) {
        lines.push(`    class ${wearing.map((node) => node.id).join(",")} ${name}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  const pad = (depth) => "    ".repeat(Math.max(1, depth));

  function hasEdgeExtras(edge) {
    return Boolean(edge.sides || edge.waypoints || edge.ends || edge.class || edge.extra
      || (edge.route && edge.route !== ROUTE_DEFAULT));
  }

  // Every class name the diagram uses, defined or not, in the order the file
  // will mention them.
  function classOrder(model) {
    const order = Object.keys(model?.classes || {});

    for (const node of model?.nodes || []) {
      for (const name of node.classes || []) {
        if (!order.includes(name)) {
          order.push(name);
        }
      }
    }

    return order;
  }

  /* --- Where things go ---------------------------------------------------
   *
   * All of this is arithmetic on the model and none of it touches a document,
   * which is what lets the same numbers be produced by the editor, by the page
   * that draws a saved diagram, and by a test with no browser in it.
   */

  function snap(value) {
    return Math.round(Number(value) / GRID) * GRID;
  }

  function snapUp(value) {
    return Math.ceil(Number(value) / GRID) * GRID;
  }

  // The lines inside a box. One for an ordinary box; for a table box the first
  // is its title and the rest are its rows.
  function textRows(text) {
    const rows = String(text ?? "").split(ROW_SPLIT_RE).map((row) => row.trim());
    return rows.length === 0 ? [""] : rows;
  }

  function joinRows(rows) {
    return rows.map((row) => String(row).trim()).join(ROW_BREAK);
  }

  /* How big a box has to be to hold what is written in it.
   *
   * Only ever a starting size. Everything here can be dragged to another one,
   * and once it has been, this is not consulted about that box again.
   */
  function measureNode(node) {
    const kind = node?.kind;
    const rows = textRows(node?.text ?? node?.id ?? "");
    const widest = rows.reduce((most, row) => Math.max(most, row.length), 0);
    let width = Math.max(MIN_WIDTH, (widest * CHAR_WIDTH) + PAD_X);
    let height = Math.max(MIN_HEIGHT, (rows.length * LINE_HEIGHT) + PAD_Y);

    if (kind === "table") {
      // The title sits above a rule, so it is a row's worth of height that the
      // rows themselves do not get.
      height = Math.max(MIN_HEIGHT, (rows.length * LINE_HEIGHT) + PAD_Y + 6);
      width = Math.max(width, 140);
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
    SHAPE_CHOICES,
    EDGE_KINDS,
    ROUTE_SHAPES,
    ROUTE_DEFAULT,
    LINE_STYLES,
    lineStyleOf,
    linkFor,
    NODE_KINDS,
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
    snap,
    parseFlowchart,
    serializeFlowchart,
    nextNodeId,
    isFlowchart,
    quoteText,
    unquoteText
  };
})(typeof window === "undefined" ? globalThis : window);
