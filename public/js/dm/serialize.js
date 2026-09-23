/* Model out, Mermaid back.
 *
 * The layout comment is written first, so a diagram opened in anything else is
 * still a flowchart with a note at the top rather than a file full of
 * coordinates. What follows is ordinary Mermaid, in a stable order, so that
 * parse(serialize(model)) gives the model back.
 */
/* exported DmSerialize */
var DmSerialize = (function () {
  "use strict";

  const {
    DIRECTIONS, DRAWN_BY_NAME, ROUTE_DEFAULT, SHAPE_BY_NAME, EDGE_BY_NAME
  } = DmShapes;
  const {
    TABLE_GAP, TABLE_PAD, LAYOUT_MARK, quoteText, writeAttributes, writePoints, pad
  } = DmGrammar;
  const { parentIn, unreached } = DmDeclarations;
  const { textCells, writeCellStyles } = DmCells;

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
  // A number that was chosen, as a string — and "" for one that was not, or
  // for one that is the standard, because the file says what somebody picked
  // rather than what everything happens to be. One place decides that, rather
  // than two that have to agree.
  const chosen = (value, standard = null) =>
    (Number.isFinite(value) && value !== standard ? String(value) : "");

  // Everything about a box that Mermaid has nowhere to put: what kind of thing
  // it is, the icon on it, the layer it is on, the styling of a table's cells.
  function nodeAttributes(node) {
    return {
      kind: node.kind && node.kind !== "box" ? node.kind : "",
      icon: node.icon || "",
      image: node.image || "",
      layer: chosen(node.layer),
      z: chosen(node.z),
      frame: node.frame === "none" ? "none" : "",
      shape: DRAWN_BY_NAME.has(node.shape) ? node.shape : "",
      pad: chosen(node.pad, TABLE_PAD.standard),
      gap: chosen(node.gap, TABLE_GAP.standard),
      cells: writeCellStyles(node.cells, textCells(node.text ?? node.id ?? "")),
      ...(node.extra || {})
    };
  }

  // A box that has been put somewhere, with that line's attributes beside it.
  function nodeLayoutLines(nodes, layout) {
    const lines = [];
    if (!layout) {
      return lines;
    }

    for (const node of nodes) {
      const at = layout[node.id];
      if (!at) {
        continue;
      }

      const attributes = writeAttributes(nodeAttributes(node));

      // Whole numbers, because the format has no room for anything else and
      // because half a pixel is not a position anyone chose.
      const size = `${Math.max(1, Math.round(at.w))}x${Math.max(1, Math.round(at.h))}`;
      const where = `${Math.round(at.x)},${Math.round(at.y)} ${size}`;
      lines.push(`    %% @ ${node.id} ${where}${attributes ? ` ${attributes}` : ""}`);
    }

    return lines;
  }

  // Which sides an arrow leaves from, the corners it goes round, the markers
  // on its ends — none of which a Mermaid link has room for.
  function edgeLayoutLines(edges) {
    const lines = [];

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

    return lines;
  }

  function groupLayoutLines(groups) {
    const lines = [];

  for (const group of groups) {
    if (!hasGroupExtras(group)) {
      continue;
    }

    lines.push(`    %% group ${group.id} ${writeAttributes({
      lock: group.lock ? "1" : "",
      ...(group.extra || {})
    })}`);
  }

    return lines;
  }

  function layerLines(layers) {
    const lines = [];

  for (const layer of layers) {
    // Always quoted, even when the name has no space in it: a layer's name is
    // a name rather than a value, and the line is read back by a shape that
    // expects the quotes to be there.
    const name = String(layer.name).replace(/[\\"]/g, "\\$&");
    const flags = `${layer.locked ? " locked" : ""}${layer.hidden ? " hidden" : ""}`;
    lines.push(`    %% layer ${layer.id} "${name}"${flags}`);
  }

    return lines;
  }

  /* What Mermaid cannot say: the arrangement, written in comments it throws
   * away. One comment per box that has a position, then the edges, the groups
   * and the layers that carry anything of their own.
   */
  function layoutLines(parts) {
    return [
      ...nodeLayoutLines(parts.nodes, parts.layout),
      ...edgeLayoutLines(parts.edges),
      ...groupLayoutLines(parts.groups),
      ...layerLines(parts.layers)
    ];
  }

  /* The flowchart itself: the declarations, the subgraphs they sit in, and the
   * arrows between them. This is the part any other Mermaid renderer reads.
   */
  function diagramLines(parts) {
    const { nodes, edges, groups } = parts;
    const lines = [];

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

    return lines;
  }

  /* The colours, which are real Mermaid — classDef, style, and the class line
   * that says which boxes wear which.
   */
  function colourLines(parts, model) {
    const { nodes, classes } = parts;
    const lines = [];

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

    return lines;
  }

  /* The model as this file needs it: every list a list, every map a map, and
   * `layout` either a map of positions or null. A model built by hand is as
   * welcome here as one that came from the parser, so nothing below has to ask
   * whether a field is there.
   */
  const listOf = (value) => (Array.isArray(value) ? value : []);
  const mapOf = (value) => (value && typeof value === "object" ? value : null);

  function normalized(model) {
    return {
      direction: DIRECTIONS.includes(model?.direction) ? model.direction : "TD",
      nodes: listOf(model?.nodes),
      edges: listOf(model?.edges),
      groups: listOf(model?.groups),
      layers: listOf(model?.layers),
      classes: mapOf(model?.classes) || {},
      layout: mapOf(model?.layout)
    };
  }

  const hasGroupExtras = (group) => Boolean(group.lock)
    || Object.keys(group.extra || {}).length > 0;

  /** @param {FlowchartModel} model @returns {string} */
  /** @param {FlowchartModel} model @returns {string} */
  function serializeFlowchart(model) {
    const parts = normalized(model);
    const { edges, groups, layers, layout } = parts;

    // The marker that says this file carries an arrangement. Written only when
    // there is one to carry, so a diagram nobody has arranged stays a diagram
    // anybody's Mermaid can read without a comment block in front of it.
    const carries = layout || layers.length > 0 || edges.some(hasEdgeExtras)
      || groups.some(hasGroupExtras);

    const lines = [
      `flowchart ${parts.direction}`,
      ...(carries ? [`    %% ${LAYOUT_MARK}`] : []),
      ...layoutLines(parts),
      ...diagramLines(parts),
      ...colourLines(parts, model)
    ];

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


  return {
    serializeFlowchart
  };
})();
