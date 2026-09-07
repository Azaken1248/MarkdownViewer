/* The lines that are about a diagram rather than in it.
 *
 * classDef and class lines, the %% layout block, and the ordering that puts
 * them back in a stable order on the way out. Read after the flowchart itself
 * is parsed, and attached to the nodes they name.
 */
(function (global) {
  "use strict";

  const { DRAWN_BY_NAME, ROUTE_NAMES } = global.DmShapes;
  const {
    ANON_GROUP, DECL_RE, NODE_KINDS, wordsOnly, readPoints, restAttributes, NODE_ATTRS,
    GROUP_ATTRS, EDGE_ATTRS
  } = global.DmGrammar;
  const { readCellStyles } = global.DmCells;

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
  function attachLayout(model, placed, edgeLines, groupLines) {
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

        /* A box drawn without its box.
         *
         * Mermaid has no way to say "no shape" — every labelled node is written
         * with brackets of some kind — so this is written as the rectangle it
         * nearly is and the missing frame is said beside it. Which is the same
         * bargain the arrow ends already make: the nearest real syntax in the
         * diagram, and what was actually meant in the comment.
         */
        if (at.attributes.frame === "none") {
          node.frame = "none";
        }

        /* Words on the paper, from before there was a kind for them.
         *
         * The Text tool used to put down an ordinary box with its frame turned
         * off, and nothing else ever did: an icon and a picture turn their
         * frames off too, but each of those carries the thing it is showing and
         * this carries neither. So a frameless box with nothing in it but words
         * is words on the paper, and saying so here is what stops one opening a
         * panel of questions about a shape it has not got.
         */
        if (!node.kind && wordsOnly(node)) {
          node.kind = "text";
        }

        /* A shape Mermaid has no brackets for. The brackets on the line said
         * the nearest one it does have — which is what every other renderer
         * will draw — and this says what was actually meant.
         */
        if (DRAWN_BY_NAME.has(at.attributes.shape)) {
          node.shape = at.attributes.shape;
        }

        const cells = readCellStyles(at.attributes.cells);
        if (Object.keys(cells).length > 0) {
          node.cells = cells;
        }

        for (const key of ["layer", "z", "pad", "gap"]) {
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

    for (const [id, attributes] of groupLines) {
      const group = (model.groups || []).find((one) => one.id === id);
      if (!group) {
        continue;
      }

      if (attributes.lock === "1") {
        group.lock = true;
      }

      const rest = restAttributes(attributes, GROUP_ATTRS);
      if (Object.keys(rest).length > 0) {
        group.extra = rest;
      }
    }

    for (const [index, attributes] of edgeLines) {
      const edge = model.edges[index];
      if (!edge) {
        continue;
      }

      /* Which side of its box each end of the line leaves from. `a` is auto —
       * one end pinned and the other left to the router is an ordinary thing to
       * want, and there has to be a way to write it down.
       */
      if (attributes.sides && /^[ltrba],[ltrba]$/.test(attributes.sides)) {
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

  global.DmDeclarations = {
    readDeclarations, nameAnonymousGroups, attachLayout, orderClasses, orderNodes,
    parentIn, unreached
  };
})(typeof window === "undefined" ? globalThis : window);
