/* Model out, Mermaid back.
 *
 * The layout comment is written first, so a diagram opened in anything else is
 * still a flowchart with a note at the top rather than a file full of
 * coordinates. What follows is ordinary Mermaid, in a stable order, so that
 * parse(serialize(model)) gives the model back.
 */
(function (global) {
  "use strict";

  const {
    DIRECTIONS, DRAWN_BY_NAME, ROUTE_DEFAULT, SHAPE_BY_NAME, EDGE_BY_NAME
  } = global.DmShapes;
  const {
    TABLE_GAP, TABLE_PAD, LAYOUT_MARK, quoteText, writeAttributes, writePoints, pad
  } = global.DmGrammar;
  const { parentIn, unreached } = global.DmDeclarations;
  const { textCells, writeCellStyles } = global.DmCells;

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

    const hasGroupExtras = (group) => Boolean(group.lock)
      || Object.keys(group.extra || {}).length > 0;

    if (layout || layers.length > 0 || edges.some(hasEdgeExtras)
      || groups.some(hasGroupExtras)) {
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
          /* Written only when it is not the standard. The file says what was
           * chosen rather than what everything happens to be, and there is one
           * place that decides so rather than two that have to agree.
           */
          frame: node.frame === "none" ? "none" : "",
          shape: DRAWN_BY_NAME.has(node.shape) ? node.shape : "",
          pad: Number.isFinite(node.pad) && node.pad !== TABLE_PAD.standard
            ? String(node.pad) : "",
          gap: Number.isFinite(node.gap) && node.gap !== TABLE_GAP.standard
            ? String(node.gap) : "",
          cells: writeCellStyles(node.cells,
            textCells(node.text ?? node.id ?? "")),
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
        sides: pinnedAnywhere(edge) ? edge.sides.join(",") : "",
        via: edge.waypoints ? writePoints(edge.waypoints) : "",
        ends: edge.ends ? edge.ends.join(",") : "",
        route: edge.route && edge.route !== ROUTE_DEFAULT ? edge.route : "",
        class: edge.class || "",
        ...(edge.extra || {})
      });

      lines.push(`    %% edge ${index} ${attributes}`);
    }

    for (const group of groups) {
      if (!hasGroupExtras(group)) {
        continue;
      }

      lines.push(`    %% group ${group.id} ${writeAttributes({
        lock: group.lock ? "1" : "",
        ...(group.extra || {})
      })}`);
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
      // One of ours is written as the nearest real shape; the layout comment
      // beside it says which of ours it actually is.
      const ours = DRAWN_BY_NAME.get(node.shape);
      const shape = SHAPE_BY_NAME.get(ours ? ours.nearest : node.shape)
        || SHAPE_BY_NAME.get("rect");
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

  const pinnedAnywhere = (edge) =>
    Array.isArray(edge.sides) && edge.sides.some((side) => side && side !== "a");

  function hasEdgeExtras(edge) {
    return Boolean(pinnedAnywhere(edge) || edge.waypoints?.length || edge.ends
      || edge.class || edge.extra || (edge.route && edge.route !== ROUTE_DEFAULT));
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


  global.DmSerialize = {
    serializeFlowchart
  };
})(typeof window === "undefined" ? globalThis : window);
