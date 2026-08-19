/* A flowchart as a list of steps and a list of arrows, so one can be built
 * without typing Mermaid.
 *
 * Mermaid has no coordinates in it. A flowchart says what connects to what and
 * the layout engine decides where everything goes, which rules out the obvious
 * design: a canvas you drag boxes around on would be a canvas whose positions
 * are thrown away the moment the file is saved. So the thing being edited here
 * is the thing the file actually holds — the steps, their shapes, and the
 * arrows between them — and the diagram is drawn from it as you go.
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

    for (const raw of text.split("\n")) {
      // A trailing semicolon is Mermaid's optional statement terminator and
      // means nothing to the model.
      const line = raw.replace(/;\s*$/, "").trim();
      if (line === "") {
        continue;
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

    return { ok: true, direction, nodes: [...nodes.values()], edges };
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
    MAX_NODES,
    MAX_EDGES,
    parseFlowchart,
    serializeFlowchart,
    nextNodeId,
    isFlowchart,
    quoteText,
    unquoteText
  };
})(typeof window === "undefined" ? globalThis : window);
