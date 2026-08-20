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
    { name: "thick-open", token: "===", head: /^={3,}/, label: "Thick line" }
  ];

  // Tried in this order against the text after a node.
  const EDGE_ORDER = ["dotted", "dotted-open", "arrow", "open", "thick", "thick-open"];

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

  /* The layout comments.
   *
   * One header line so a reader knows what the rest of them are, then one line
   * per box: where it is, how big it is, and whether it is a plain box or a
   * table. Anything else beginning with %% is still refused — a directive, a
   * note somebody left, an init block — because keeping a comment we do not
   * understand means writing it back somewhere, and there is no somewhere.
   */
  const LAYOUT_MARK = "layout v1";
  const LAYOUT_HEAD_RE = /^%%\s*layout\s+v1$/i;
  const LAYOUT_RE = /^%%\s*@\s*([A-Za-z_][A-Za-z0-9_-]*)\s+(-?\d+),(-?\d+)\s+(\d+)x(\d+)(?:\s+(table))?$/i;
  const HAS_LAYOUT_RE = /^[ \t]*%%[ \t]*layout[ \t]+v1[ \t]*$/im;

  // A box with rows in it is an ordinary Mermaid node whose label has line
  // breaks in it, so a class box still renders as a class box everywhere else —
  // the layout line only says to draw the divider under the first line.
  const NODE_KINDS = ["box", "table"];
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

  // Past this a rebuild on every keystroke stops being free, and a list of a
  // hundred rows stops being a nicer way to work than the source. Both numbers
  // are about the person, not the machine: nobody hand-builds a diagram this
  // size in a form.
  const MAX_NODES = 60;
  const MAX_EDGES = 120;

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

        return {
          id,
          shape: quoted.name,
          text: unquoteText(rest.slice(from, quote + 1)),
          next: at + quote + 1 + quoted.close.length
        };
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

      return {
        id,
        shape: nearest.shape.name,
        text: unquoteText(rest.slice(from, nearest.end)),
        next: at + nearest.end + nearest.shape.close.length
      };
    }

    return { id, shape: null, text: null, next: at };
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

    skipSpace();
    const first = matchNode(line, pos);
    if (!first) {
      return null;
    }

    const nodes = [first];
    const links = [];
    pos = first.next;

    for (;;) {
      skipSpace();
      if (pos >= line.length) {
        return { nodes, links };
      }

      const link = matchLink(line, pos);
      if (!link) {
        return null;
      }

      pos = link.next;
      skipSpace();

      const node = matchNode(line, pos);
      if (!node) {
        return null;
      }

      pos = node.next;
      nodes.push(node);
      links.push(link);
    }
  }

  /* Mermaid source in, a model out — or a refusal with a reason worth showing
   * someone, since the reason is why the builder button is not there.
   */
  function parseFlowchart(source) {
    const text = String(source == null ? "" : source);
    const nodes = new Map();
    const edges = [];
    let direction = "TD";
    let header = false;
    // Null until a layout header is seen, so a diagram that was never arranged
    // comes back with no layout at all rather than with an empty one — the two
    // mean different things to everything downstream.
    let placed = null;

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

        const at = placed && line.match(LAYOUT_RE);
        if (at) {
          placed.push({
            id: at[1],
            x: Number(at[2]),
            y: Number(at[3]),
            w: Number(at[4]),
            h: Number(at[5]),
            kind: at[6] ? "table" : "box"
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

      const chain = parseChain(line);
      if (!chain) {
        return refuse("this diagram uses Mermaid the builder does not model");
      }

      for (const node of chain.nodes) {
        const known = nodes.get(node.id);

        // A box with nothing written in it is drawn by Mermaid with its id in
        // it, so that is what it says here too. Doing this on the way in as
        // well as on the way out is what keeps parse(serialize(model)) equal to
        // model for every diagram this parser accepts.
        const named = (text) => (String(text ?? "").trim() === "" ? node.id : text);

        if (!known) {
          nodes.set(node.id, { id: node.id, shape: node.shape || "rect", text: named(node.text) });
          continue;
        }

        // A bare mention of a node already declared says nothing new about it.
        if (node.shape) {
          known.shape = node.shape;
          known.text = named(node.text);
        }
      }

      for (const [index, link] of chain.links.entries()) {
        edges.push({
          from: chain.nodes[index].id,
          to: chain.nodes[index + 1].id,
          kind: link.kind,
          label: link.label
        });
      }
    }

    if (!header) {
      return refuse("this is not a flowchart");
    }

    if (nodes.size > MAX_NODES || edges.length > MAX_EDGES) {
      return refuse("this diagram is too big to build by hand");
    }

    const model = { ok: true, direction, nodes: [...nodes.values()], edges };

    if (placed) {
      // A position for a box that is not in the diagram is a position for
      // nothing. Dropping it is the only reading that keeps what comes back out
      // the same as what went in.
      const layout = {};
      for (const at of placed) {
        if (nodes.has(at.id)) {
          layout[at.id] = { x: at.x, y: at.y, w: at.w, h: at.h, kind: at.kind };
        }
      }

      model.layout = layout;
    }

    return model;
  }

  /* The model back to Mermaid: the header, one declaration per node in the
   * order they were first seen, then the arrows. Every node is declared even
   * when the source it came from left one implied, so that what comes out says
   * everything the model knows rather than depending on where a node happened
   * to be mentioned first.
   */
  function serializeFlowchart(model) {
    const direction = DIRECTIONS.includes(model?.direction) ? model.direction : "TD";
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    const lines = [`flowchart ${direction}`];
    const layout = model?.layout && typeof model.layout === "object" ? model.layout : null;

    if (layout) {
      lines.push(`    %% ${LAYOUT_MARK}`);

      for (const node of nodes) {
        const at = layout[node.id];
        if (!at) {
          continue;
        }

        // Whole numbers, because the format has no room for anything else and
        // because half a pixel is not a position anyone chose.
        const kind = at.kind === "table" ? " table" : "";
        const size = `${Math.max(1, Math.round(at.w))}x${Math.max(1, Math.round(at.h))}`;
        lines.push(`    %% @ ${node.id} ${Math.round(at.x)},${Math.round(at.y)} ${size}${kind}`);
      }
    }

    for (const node of nodes) {
      const shape = SHAPE_BY_NAME.get(node.shape) || SHAPE_BY_NAME.get("rect");
      // An unnamed box would serialize to nothing between the brackets, which
      // Mermaid reads as a parse error rather than as an empty box.
      const text = String(node.text ?? "").trim() || node.id;
      lines.push(`    ${node.id}${shape.open}${quoteText(text)}${shape.close}`);
    }

    for (const edge of edges) {
      const kind = EDGE_BY_NAME.get(edge.kind) || EDGE_BY_NAME.get("arrow");
      const label = String(edge.label ?? "").trim();
      const middle = label ? `|${quoteText(label)}|` : "";
      lines.push(`    ${edge.from} ${kind.token}${middle} ${edge.to}`);
    }

    return `${lines.join("\n")}\n`;
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
  function measureNode(node, kind) {
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
    const sizes = new Map(nodes.map((node) => [node.id, measureNode(node, "box")]));
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
        h: at.h,
        kind: "box"
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
          w: Number.isFinite(at.w) && at.w > 0 ? at.w : measureNode(node, at.kind).w,
          h: Number.isFinite(at.h) && at.h > 0 ? at.h : measureNode(node, at.kind).h,
          kind: NODE_KINDS.includes(at.kind) ? at.kind : "box"
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
        const size = measureNode(node, "box");
        layout[node.id] = { x, y, w: size.w, h: size.h, kind: "box" };
        x = snap(x + size.w + SIBLING_GAP);
      }
    }

    return layout;
  }

  // How much paper the arrangement takes up, which is the drawing's own size
  // before anything on a page has a say in it.
  function layoutBounds(layout) {
    const boxes = Object.values(layout || {});

    if (boxes.length === 0) {
      return { w: MARGIN * 2, h: MARGIN * 2 };
    }

    return {
      w: Math.max(...boxes.map((at) => at.x + at.w)) + MARGIN,
      h: Math.max(...boxes.map((at) => at.y + at.h)) + MARGIN
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
    NODE_KINDS,
    MAX_NODES,
    MAX_EDGES,
    GRID,
    MARGIN,
    LAYOUT_MARK,
    autoLayout,
    ensureLayout,
    layoutBounds,
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
