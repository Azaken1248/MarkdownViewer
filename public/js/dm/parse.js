/* Mermaid in, model out — or a refusal saying which line it could not read.
 *
 * Narrow on purpose: node declarations, links, subgraphs, classDef and class,
 * and nothing else. Anything outside that is refused rather than dropped, so a
 * diagram this cannot open is still exactly the diagram it was.
 */
(function (global) {
  "use strict";

  const { EDGE_BY_NAME, EDGE_ORDER, EDGE_TEXT_FORMS, OPENERS } = global.DmShapes;
  const {
    CLASSDEF_RE, CLASS_RE, EDGE_LINE_RE, END_RE, GROUP_LINE_RE, HEADER_RE, ID_RE,
    LAYER_LINE_RE, LAYOUT_HEAD_RE, LAYOUT_LINE_RE, STYLE_RE, SUBGRAPH_HEAD_RE, SUBGRAPH_RE,
    ANON_GROUP, readAttributes, refuse, unquoteAttribute, unquoteText
  } = global.DmGrammar;
  const { readDeclarations, nameAnonymousGroups, attachLayout, orderClasses, orderNodes } = global.DmDeclarations;

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
    const groupLines = new Map();
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

        const groupLine = line.match(GROUP_LINE_RE);
        if (groupLine) {
          groupLines.set(groupLine[1], readAttributes(groupLine[2]));
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
    attachLayout(model, placed, edgeLines, groupLines);
    orderClasses(model);
    return orderNodes(model);
  }

  // `fill:#f00,stroke:#333` — the value half of a classDef or a style, which
  // are the same list written after different words.

  global.DmParse = {
    matchNode, matchLink, parseChain, parseFlowchart
  };
})(typeof window === "undefined" ? globalThis : window);
