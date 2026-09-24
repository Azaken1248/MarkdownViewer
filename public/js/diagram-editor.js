/* A diagram canvas, mounted anywhere.
 *
 * The first version of this put two lists beside the picture and let you type
 * into them. The second drew the diagram from those lists and let you tap a box
 * to select it. Both were working around the same thing: Mermaid has no
 * coordinates in it, so there was nothing to drag.
 *
 * There is now. The file carries its own layout in comments Mermaid throws
 * away, we draw the diagram ourselves from those numbers, and a box that is
 * dragged is a box that stays where it was put — here, and in the document, and
 * anywhere else this app draws it. Elsewhere the same file still renders,
 * arranged by whatever engine is reading it.
 *
 * So: drag a box to move it, drag its corner to resize it, drag the circle on
 * its edge to draw an arrow to another box, or let go of that circle on empty
 * paper — a click, really — to grow a new box already joined. Drag a shape off
 * the palette to put one anywhere. Everything snaps to the grid it is drawn on.
 *
 * The full lists are still underneath, folded away. They are the way to reach
 * an arrow nobody can find on a crowded diagram, and the way to work without a
 * pointing device.
 *
 * Nothing in here knows what it is editing: it is handed a string and hands
 * back a string. That is what lets one canvas serve a fence inside a document
 * and a .mmd file on its own.
 */
/* exported DiagramEditor */
var DiagramEditor = (function () {
  "use strict";
  const { html, trusted } = DomHtml;

  const DIAGRAM_PREVIEW_DELAY = 250;

  const DIAGRAM_FLOWS = [
    ["TD", "Top down"],
    ["LR", "Left to right"],
    ["BT", "Bottom up"],
    ["RL", "Right to left"]
  ];

  /* The colours a box can be.
   *
   * Literal, not the theme's variables, because a classDef goes into the file
   * and the file is read by Mermaid everywhere else — a diagram whose colours
   * only existed inside this app would render grey on GitHub. Each is a pale
   * fill with a stronger stroke of the same hue and near-black text, which is
   * the one combination that stays readable whether the page behind it is light
   * or dark. Named for what they are rather than what they mean: a red box
   * means whatever the diagram says it means.
   */
  const DIAGRAM_COLOURS = [
    ["Slate", { fill: "#e8eaed", stroke: "#5f6b7a", color: "#1b2430" }],
    ["Red", { fill: "#fbdedc", stroke: "#c0453c", color: "#4a1512" }],
    ["Amber", { fill: "#fbeecd", stroke: "#b07d1a", color: "#452f05" }],
    ["Green", { fill: "#d8f0dd", stroke: "#3f8b57", color: "#123420" }],
    ["Teal", { fill: "#d3ecea", stroke: "#2f8079", color: "#0d302d" }],
    ["Blue", { fill: "#d9e6fb", stroke: "#3b6db8", color: "#132743" }],
    ["Purple", { fill: "#e6dff8", stroke: "#6f52ae", color: "#241844" }],
    ["Pink", { fill: "#fbdcec", stroke: "#b6467f", color: "#43122c" }]
  ];

  // A classDef this editor wrote, as opposed to one somebody wrote by hand. The
  // difference matters when a colour is cleared: ours is litter once nobody
  // wears it, and theirs is part of their diagram whether it is worn or not.
  /* A border is a dash and a weight, and both are ordinary classDef
   * declarations — the same place the colours go, read by every other renderer
   * the same way. "Plain" and "Thin" are the absence of a declaration rather
   * than a declaration of the default, so a box nobody has styled carries
   * nothing at all and still follows the theme.
   */
  const DIAGRAM_BORDERS = [
    ["Plain", {}],
    ["Dashed", { "stroke-dasharray": "6 4" }],
    ["Dotted", { "stroke-dasharray": "2 4" }]
  ];

  const DIAGRAM_WEIGHTS = [
    ["Thin", {}],
    ["Medium", { "stroke-width": "2.5px" }],
    ["Thick", { "stroke-width": "4px" }]
  ];

  /* The type. Every one of these is a classDef declaration, which is real
   * Mermaid — so a diagram set in bold serif is set in bold serif on GitHub
   * too, rather than only here. Which is why there is no font control that is
   * not one of these: a size Mermaid cannot say is a size the file cannot keep.
   *
   * The three generic families and nothing else. A font name out of a file is a
   * string on its way into a style attribute, and the three every renderer has
   * are also the three anyone means.
   */
  const DIAGRAM_FAMILIES = [
    ["Default", {}],
    ["Sans", { "font-family": "sans-serif" }],
    ["Serif", { "font-family": "serif" }],
    ["Mono", { "font-family": "monospace" }]
  ];

  // Two switches rather than two menus of two: bold and italic are the things
  // people reach for a keystroke to do, and a menu is not what that reaches.
  const DIAGRAM_MARKS = [
    ["Bold", "font-weight", "700", "ph-text-b"],
    ["Italic", "font-style", "italic", "ph-text-italic"]
  ];

  const DIAGRAM_COLOUR_KEYS = ["fill", "stroke", "color"];
  const DIAGRAM_CLASS_PREFIX = "ddC";
  const DIAGRAM_CLASS_RE = /^ddC\d+$/;

  /* The diagram this editor is able to open, or null.
   *
   * Everything the parser reads is now drawn, so what the parser accepts is
   * exactly what opens. A diagram it will not read stays as source, because an
   * editor that quietly drops the part it did not understand is an editor that
   * writes back a diagram nobody recognises.
   */
  function canOpen(source) {
    const model = DiagramModel.parseFlowchart(String(source ?? ""));
    return model.ok ? model : null;
  }

  function diagramShapeLabel(name) {
    const found = DiagramModel.SHAPES.find((shape) => shape.name === name)
      || DiagramModel.DRAWN_SHAPES.find((shape) => shape.name === name);

    return (found || {}).label || name;
  }

  // The shapes in the menu, plus whichever one this step already has. A trapezoid
  // nobody can pick from a list is still a trapezoid, and changing it to a box
  // because it was not on the menu would be an edit nobody made.
  function diagramShapeChoices(current) {
    const choices = DiagramModel.SHAPE_CHOICES.slice();
    return choices.includes(current) ? choices : [current, ...choices];
  }

  /* Building on the diagram itself.
   *
   * The first version of this put two lists beside the picture and let you type
   * into them. The second drew the diagram from those lists and let you tap a box
   * to select it. Both were working around the same thing: Mermaid has no
   * coordinates in it, so there was nothing to drag.
   *
   * There is now. The fence carries its own layout in comments Mermaid throws
   * away, we draw the diagram ourselves from those numbers, and a box that is
   * dragged is a box that stays where it was put — here, and in the document, and
   * anywhere else this app draws it. Elsewhere the same file still renders,
   * arranged by whatever engine is reading it.
   *
   * So: drag a box to move it, drag its corner to resize it, drag the circle on
   * its edge to draw an arrow to another box, or let go of that circle on empty
   * paper — a click, really — to grow a new box already joined. Drag a shape off
   * the palette to put one anywhere. Everything snaps to the grid it is drawn on.
   *
   * The full lists are still underneath, folded away. They are the way to reach
   * an arrow nobody can find on a crowded diagram, and the way to work without a
   * pointing device.
   */

  // Room to drag into. Without it the paper ends exactly where the diagram does
  // and nothing could ever be moved outwards.
  const DIAGRAM_PAPER_PAD = 200;
  // How far a press has to travel before it is a drag rather than a tap. Below
  // this, a finger that moves slightly while selecting a box does not move it.
  const DIAGRAM_DRAG_SLOP = 4;
  const DIAGRAM_MIN_BOX = 50;
  const SVG_NS = "http://www.w3.org/2000/svg";

  // How far in and out a diagram can be looked at. Free between the two — a
  // zoom that clicks through fixed steps is a zoom that will not stop where the
  // thing you are working on happens to fit.
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 8;
  // Wheel notches vary wildly between devices, so what is used is the sign and
  // a fixed ratio per notch rather than the distance reported.
  const ZOOM_PER_NOTCH = 1.12;
  // Room left around a diagram when the view is fitted to it.
  const FIT_MARGIN = 60;
  // How close to a line on another box counts as being on it. On the screen
  // rather than in the diagram: at half zoom, six pixels of file is three
  // pixels of hand, and the hand is what is doing the aiming.
  const GUIDE_WITHIN = 6;
  // A burst of typing is one step, not one per keystroke. Long enough that a
  // word is a step, short enough that a pause between words is a boundary.
  const HISTORY_IDLE = 500;
  // Far enough back to cover a session's worth of mistakes without holding a
  // diagram's whole life in memory.
  const HISTORY_DEPTH = 200;
  // How far a pasted copy lands from what it was copied from, so it can be seen
  // to be a second thing rather than looking like nothing happened.
  const PASTE_OFFSET = 20;
  // How long a finger has to stay put before it means "show me the options".
  // Long enough not to fire while starting a drag, short enough not to feel
  // like nothing is happening.
  const LONG_PRESS = 500;

  /* What was last copied, kept for as long as the page is open rather than for
   * as long as one diagram is. Copying a box out of one diagram and pasting it
   * into another is the obvious thing to want and costs nothing to allow.
   */
  let clipboard = null;

  // What the palette offers. A table is not a Mermaid shape — it is an ordinary
  // box whose label has rows in it and whose layout line says to rule a line
  // under the first one — so it travels with the shapes but is spelled as a kind.
  /* The shapes, each with a picture of itself.
   *
   * Drawn here rather than named from an icon set: this row is about shape and
   * nothing else, so the one thing a button on it has to show is the outline it
   * will put on the paper. An icon font's nearest square is not that.
   */
  const DIAGRAM_PALETTE = [
    { shape: "rect", kind: "box", label: "Box", glyph: '<rect x="1" y="2" width="16" height="10"/>' },
    { shape: "round", kind: "box", label: "Rounded",
      glyph: '<rect x="1" y="2" width="16" height="10" rx="3"/>' },
    { shape: "diamond", kind: "box", label: "Decision",
      glyph: '<path d="M9,1 L17,7 L9,13 L1,7 z"/>' },
    { shape: "stadium", kind: "box", label: "Stadium",
      glyph: '<rect x="1" y="2" width="16" height="10" rx="5"/>' },
    { shape: "circle", kind: "box", label: "Circle", glyph: '<circle cx="9" cy="7" r="5.5"/>' },
    { shape: "rect", kind: "table", label: "Table",
      glyph: '<rect x="1" y="2" width="16" height="10"/><path d="M1,5.5 H17"/>' },
    /* An icon and a picture standing on the paper on their own, which is what
     * most of a technical diagram is. Both are boxes underneath — they can be
     * joined, moved and labelled like everything else — but a box drawn without
     * its box, so what is on the paper is the thing rather than the thing in a
     * rectangle.
     */
    { shape: "rect", kind: "box", label: "Icon", frame: "none", icon: "lucide:database",
      glyph: '<path d="M9,2 A6,2 0 1 0 9,6 A6,2 0 1 0 9,2"/><path d="M3,4 V10 A6,2 0 0 0 15,10 V4"/>' },
    { shape: "rect", kind: "box", label: "Picture", frame: "none", picture: true,
      glyph: '<rect x="1" y="2" width="16" height="10"/><path d="M1,10 L6,6 L11,10"/>'
        + '<circle cx="12.5" cy="5.5" r="1.2"/>' },
    /* Words on the paper with nothing round them. A heading over a group of
     * boxes, or a note about one, is not itself a step — and drawing a box
     * round it says it is.
     */
    { shape: "rect", kind: "text", label: "Text", frame: "none", text: "Text",
      size: { w: 90, h: 32 },
      glyph: '<path d="M2,3 H16 M9,3 V11 M6,11 H12"/>' },
    /* The shapes Mermaid has no brackets for. Each is written as the nearest
     * real one so the file still reads elsewhere, with the exact shape said
     * beside it.
     */
    { shape: "note", kind: "box", label: "Note",
      glyph: '<path d="M1,2 H13 L17,6 V12 H1 Z"/><path d="M13,2 V6 H17"/>' },
    { shape: "cloud", kind: "box", label: "Cloud",
      glyph: '<path d="M4,12 A3,3 0 0 1 3.4,6.6 A3.5,3.5 0 0 1 9,4.4'
        + ' A3,3 0 0 1 14.6,6.4 A2.8,2.8 0 0 1 14,12 Z"/>' },
    { shape: "actor", kind: "box", label: "Actor",
      glyph: '<circle cx="9" cy="3.5" r="2"/><path d="M9,5.5 V9 M5.5,7 H12.5'
        + ' M9,9 L6.5,13 M9,9 L11.5,13"/>' },
    { shape: "queue", kind: "box", label: "Queue",
      glyph: '<path d="M4,2 H14 A2.5,5 0 0 1 14,12 H4 A2.5,5 0 0 0 4,2 Z"/>'
        + '<path d="M4,2 A2.5,5 0 0 1 4,12"/>' }
  ];

  // One picture of a shape, at the size a label sits beside.
  const shapeGlyph = (glyph) =>
    '<svg class="ve-diagram-glyph" viewBox="0 0 18 14" width="18" height="14"'
    + ' fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'
    + `${glyph}</svg>`;

  /* How this file is arranged.
   *
   * One editor is one `ed`: an object holding the diagram, the selection, the
   * view and the elements it is drawn into. Every function below takes it as
   * its first argument, so each of them can be read on its own and the state
   * they share is a thing with a name rather than a scope nobody can see the
   * edges of. `mount` below builds one and hands back what a page may do to
   * it; everything between here and there is a step in that, or a thing the
   * editor does once it is running.
   */

  /* --- The editor's own constants ---------------------------------------- */

  const GRIP_EDGES = new Map(DiagramDraw.GRIPS.map(([name, gx, gy]) => [name, [gx, gy]]));

  const TAP_AGAIN = 400;

  const TAP_NEAR = 6;

  const ACTIVATED_BY_KEY = /^(?:BUTTON|A|SUMMARY)$/;

  const NUDGES = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  };

  const EXPORT_SCALE = 2;

  const NO_FRAME = "none";

  const LABEL_ROWS_MAX = 10;

  const FIELD_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

  const TABLE_MAX_ROWS = 24;

  const TABLE_MAX_COLUMNS = 8;

  const NO_COLOUR = Object.fromEntries(DIAGRAM_COLOUR_KEYS.map((key) => [key, null]));

  const DIAGRAM_INKS = [
    ["Words", "color", "#1b2430"],
    ["Behind", "fill", "#e8eaed"]
  ];

  const HEX_RE = /^#[0-9a-fA-F]{6}$/;

  const DIAGRAM_IMAGE_BOX = { w: 180, h: 140 };

  const ICON_SET = "lucide";

  const CELL_FAMILIES = [
    ["Default", ""],
    ["Sans", "n"],
    ["Serif", "s"],
    ["Mono", "m"]
  ];

  const CELL_MARK_BUTTONS = [
    ["Bold", "b", "ph-text-b"],
    ["Italic", "i", "ph-text-italic"]
  ];

  const HUD_GAP = 12;

  const PANEL_STORE = "azadocs:diagram:panels";

  /* --- Everything the editor does, over the state it is handed ----------- */

  const isSelected = (ed, id) => ed.selection.includes(id);

  const drawing = (ed) => ed.canvas.querySelector("svg");

  const boxOf = (ed, id) => ed.model.layout[id] || null;

  const nodeById = (ed, id) => ed.model.nodes.find((item) => item.id === id) || null;

  const stepLabel = (ed, item) => DiagramModel.textRows(item.text || item.id)[0] || item.id;

  const draw = (ed) => {
    ed.drawTimer = 0;

    // A pending redraw of a builder that has since been closed is a diagram
    // nobody will ever see, drawn into an element nobody holds.
    if (!ed.canvas.isConnected) {
      return;
    }

    // The field typed into is laid over the drawing rather than part of it,
    // so a redraw takes the drawing out and leaves the field where it is.
    const typing = ed.editing?.field || null;
    typing?.remove();

    // An SVG this app drew: DiagramDraw builds it from the model and every
    // label goes through escapeText (dd/base.js) on the way out.
    // eslint-disable-next-line no-unsanitized/property
    ed.canvas.innerHTML = DiagramDraw.render(ed.model, {
      layout: ed.model.layout,
      // A window onto the diagram, or — in a document — the diagram at its own
      // size on grid paper with the strip scrolling it.
      viewport: ed.viewport,
      view: ed.view,
      natural: !ed.viewport,
      grid: true,
      pad: DIAGRAM_PAPER_PAD,
      selected: ed.selection,
      label: "Diagram being edited"
    });

    if (typing) {
      ed.canvas.append(typing);
      placeEditor(ed);
    }

    // The bar is not in the drawing, but it stands over a box that has just
    // been drawn somewhere else.
    placeHud(ed);
  };

  function applyView(ed) {
    const svg = drawing(ed);
    if (!svg) {
      return;
    }

    const moved = `translate(${round(ed, ed.view.x)},${round(ed, ed.view.y)}) scale(${ed.view.scale})`;
    svg.querySelector(".dd-view")?.setAttribute("transform", moved);
    svg.querySelector("pattern")?.setAttribute("patternTransform", moved);
    placeEditor(ed);
    placeHud(ed);
    // A menu opened at a point on the diagram is about that point, and the
    // point has just moved out from under it.
    closeMenu(ed);
    showZoom(ed);
  }

  const round = (ed, value) => Math.round(value * 100) / 100;

  const clampScale = (ed, value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  function zoomAbout(ed, clientX, clientY, factor) {
    const next = clampScale(ed, ed.view.scale * factor);
    if (next === ed.view.scale) {
      return;
    }

    const rect = ed.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    ed.view.x = sx - ((sx - ed.view.x) * next / ed.view.scale);
    ed.view.y = sy - ((sy - ed.view.y) * next / ed.view.scale);
    ed.view.scale = next;
    applyView(ed);
  }

  function zoomToCentre(ed, factor) {
    const rect = ed.canvas.getBoundingClientRect();
    zoomAbout(ed, rect.left + (rect.width / 2), rect.top + (rect.height / 2), factor);
  }

  function fitView(ed) {
    const rect = ed.canvas.getBoundingClientRect();
    // Where the diagram is, not how large a picture of it would be: on an
    // endless canvas a box can be at -400, and fitting to a rectangle that
    // starts at the origin would leave it off the top of the window.
    const bounds = DiagramModel.layoutExtent(ed.model.layout);
    const room = { w: rect.width - (FIT_MARGIN * 2), h: rect.height - (FIT_MARGIN * 2) };

    // Before the canvas has been laid out there is nothing to fit into, and
    // fitting to zero would put the diagram at the smallest zoom there is.
    if (room.w <= 0 || room.h <= 0 || bounds.w <= 0 || bounds.h <= 0) {
      return false;
    }

    // Never magnified to fit: a diagram of one box would fill the window with
    // one box, which is not what anyone means by fit.
    ed.view.scale = clampScale(ed, Math.min(room.w / bounds.w, room.h / bounds.h, 1));
    ed.view.x = ((rect.width - (bounds.w * ed.view.scale)) / 2) - (bounds.x * ed.view.scale);
    ed.view.y = ((rect.height - (bounds.h * ed.view.scale)) / 2) - (bounds.y * ed.view.scale);
    applyView(ed);
    return true;
  }

  const drawSoon = (ed) => {
    window.clearTimeout(ed.drawTimer);
    ed.drawTimer = window.setTimeout(() => draw(ed), DIAGRAM_PREVIEW_DELAY);
  };

  const drawAtOnce = (ed) => {
    window.clearTimeout(ed.drawTimer);
    draw(ed);
  };

  const sourceNow = (ed) => DiagramModel.serializeFlowchart(ed.model).replace(/\n$/, "");

  function rememberNow(ed) {
    window.clearTimeout(ed.historyTimer);
    ed.historyTimer = 0;

    const now = sourceNow(ed);
    if (now === ed.history.present) {
      return;
    }

    ed.history.past.push(ed.history.present);
    if (ed.history.past.length > HISTORY_DEPTH) {
      ed.history.past.shift();
    }

    ed.history.present = now;
    // Doing something new is what makes the way forward stop existing.
    ed.history.future.length = 0;
    ed.showSteps();
  }

  function rememberSoon(ed) {
    window.clearTimeout(ed.historyTimer);
    ed.historyTimer = window.setTimeout(() => rememberNow(ed), HISTORY_IDLE);
  }

  function restore(ed, source) {
    const back = DiagramModel.parseFlowchart(source);
    if (!back.ok) {
      return;
    }

    for (const key of Object.keys(ed.model)) {
      delete ed.model[key];
    }

    Object.assign(ed.model, back, { layout: DiagramModel.ensureLayout(back) });
    delete ed.model.ok;

    ed.onChange(source);
    paintLists(ed);
    choose(ed, ed.selection);
    ed.showSteps();
  }

  function undo(ed) {
  // Whatever is still being typed is a step of its own, and undoing has to
  // take that back first rather than skipping over it.
    rememberNow(ed);

    if (ed.history.past.length === 0) {
      return false;
    }

    ed.history.future.push(ed.history.present);
    ed.history.present = ed.history.past.pop();
    restore(ed, ed.history.present);
    return true;
  }

  function redo(ed) {
    window.clearTimeout(ed.historyTimer);
    ed.historyTimer = 0;

    if (ed.history.future.length === 0) {
      return false;
    }

    ed.history.past.push(ed.history.present);
    ed.history.present = ed.history.future.pop();
    restore(ed, ed.history.present);
    return true;
  }

  const write = (ed, { atOnce = true } = {}) => {
    ed.onChange(sourceNow(ed));
    if (atOnce) {
      rememberNow(ed);
    } else {
      rememberSoon(ed);
    }
  };

  const commit = (ed) => {
    write(ed, { atOnce: false });
    drawSoon(ed);
  };

  function pointIn(ed, clientX, clientY) {
    const svg = drawing(ed);
    if (!svg) {
      return { x: 0, y: 0 };
    }

    // In a viewport one unit is one pixel and the view transform is the only
    // scale there is, so undoing it is the whole conversion.
    if (ed.viewport) {
      const box = ed.canvas.getBoundingClientRect();
      return {
        x: (clientX - box.left - ed.view.x) / ed.view.scale,
        y: (clientY - box.top - ed.view.y) / ed.view.scale
      };
    }

    const rect = svg.getBoundingClientRect();
    const wide = svg.viewBox?.baseVal?.width || rect.width || 1;
    const scale = rect.width > 0 ? wide / rect.width : 1;

    return {
      x: (clientX - rect.left) * scale,
      y: (clientY - rect.top) * scale
    };
  }

  function boxAt(ed, point) {
    for (let index = ed.model.nodes.length - 1; index >= 0; index -= 1) {
      const item = ed.model.nodes[index];
      const at = boxOf(ed, item.id);

      if (at && point.x >= at.x && point.x <= at.x + at.w
      && point.y >= at.y && point.y <= at.y + at.h && !lockedAway(ed, item.id)) {
        return item.id;
      }
    }

    return null;
  }

  const snap = (ed, value) => DiagramModel.snap(value);

  function reroute(ed, id) {
    const svg = drawing(ed);
    if (!svg) {
      return;
    }

    const spread = DiagramDraw.lanes(ed.model.edges);
    const touching = svg.querySelectorAll(`.dd-edge[data-from="${id}"], .dd-edge[data-to="${id}"]`);

    for (const group of touching) {
      const index = Number(group.getAttribute("data-edge"));
      const edge = ed.model.edges[index];
      if (!edge) {
        continue;
      }

      const route = DiagramDraw.routeEdge(ed.model.layout, edge, spread[index]);
      if (!route) {
        continue;
      }

      for (const path of group.querySelectorAll("path")) {
        path.setAttribute("d", route.d);
      }

      const label = group.querySelector(".dd-label");
      if (label) {
        label.setAttribute("transform", `translate(${route.mid.x},${route.mid.y})`);
      }
    }
  }

  function redrawEdge(ed, index) {
    const svg = drawing(ed);
    const group = svg?.querySelector(`.dd-edge[data-edge="${index}"]`);
    const edge = ed.model.edges[index];
    if (!svg || !group || !edge) {
      return;
    }

    const route = DiagramDraw.routeEdge(ed.model.layout, edge,
      DiagramDraw.lanes(ed.model.edges)[index]);
    if (!route) {
      return;
    }

    for (const path of group.querySelectorAll("path")) {
      path.setAttribute("d", route.d);
    }

    group.querySelector(".dd-label")
      ?.setAttribute("transform", `translate(${route.mid.x},${route.mid.y})`);

    for (const [at, [x, y]] of DiagramDraw.wayPoints(edge).entries()) {
      const dot = svg.querySelector(`.dd-via[data-edge="${index}"][data-at="${at}"]`);
      dot?.setAttribute("cx", String(round(ed, x)));
      dot?.setAttribute("cy", String(round(ed, y)));
    }
  }

  function alongRoute(ed, points, at) {
    let walked = 0;
    let best = { away: Infinity, at: 0 };

    for (let index = 0; index < points.length - 1; index += 1) {
      const [ax, ay] = points[index];
      const [bx, by] = points[index + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const square = (dx * dx) + (dy * dy);
      const into = square
        ? Math.max(0, Math.min(1, (((at.x - ax) * dx) + ((at.y - ay) * dy)) / square))
        : 0;
      const away = Math.hypot(at.x - (ax + (dx * into)), at.y - (ay + (dy * into)));
      const length = Math.hypot(dx, dy);

      if (away < best.away) {
        best = { away, at: walked + (length * into) };
      }

      walked += length;
    }

    return best.at;
  }

  function addCorner(ed, index, at) {
    const edge = ed.model.edges[index];
    const route = DiagramDraw.routeEdge(ed.model.layout, edge,
      DiagramDraw.lanes(ed.model.edges)[index]);
    if (!edge || !route) {
      return -1;
    }

    // A loop back to the same box has a shape of its own and no route to put
    // a corner into. Refusing is better than taking one and ignoring it.
    if (edge.from === edge.to) {
      return -1;
    }

    const dropped = { x: snap(ed, at.x), y: snap(ed, at.y) };
    const via = [...(edge.waypoints || [])];
    const mark = alongRoute(ed, route.points, dropped);
    const before = via.findIndex((one) => alongRoute(ed, route.points, one) > mark);
    const put = before < 0 ? via.length : before;

    via.splice(put, 0, dropped);
    edge.waypoints = via;
    return put;
  }

  function dropCorner(ed, index, at) {
    const edge = ed.model.edges[index];
    if (!edge?.waypoints) {
      return;
    }

    // Left as an empty list rather than taken off: whether a line with no
    // corners left says so in the file is the file's question, and the writer
    // already answers it. One place decides, not two that have to agree.
    edge.waypoints = edge.waypoints.filter((one, which) => which !== at);

    write(ed);
    drawAtOnce(ed);
  }

  function sideFor(ed, box, at) {
    const left = at.x - box.x;
    const right = (box.x + box.w) - at.x;
    const top = at.y - box.y;
    const bottom = (box.y + box.h) - at.y;

    if (left > box.w / 3 && right > box.w / 3
    && top > box.h / 3 && bottom > box.h / 3) {
      return "a";
    }

    const nearest = Math.min(left, right, top, bottom);
    if (nearest === left) {
      return "l";
    }
    if (nearest === right) {
      return "r";
    }

    return nearest === top ? "t" : "b";
  }

  function pinEnd(ed, index, end, at) {
    const edge = ed.model.edges[index];
    const box = boxOf(ed, end === 0 ? edge?.from : edge?.to);
    if (!edge || !box) {
      return;
    }

    // Both ends left to the router is said plainly, and the writer is what
    // decides that saying it is the same as saying nothing.
    const sides = Array.isArray(edge.sides) ? [...edge.sides] : ["a", "a"];
    sides[end] = sideFor(ed, box, at);
    edge.sides = sides;

    redrawEdge(ed, index);
  }

  const moveTo = (ed, id, x, y) => placeAt(ed, id, snap(ed, x), snap(ed, y));

  function placeAt(ed, id, x, y) {
    const at = boxOf(ed, id);
    if (!at) {
      return;
    }

    at.x = Math.round(x);
    at.y = Math.round(y);

    const svg = drawing(ed);
    const group = svg?.querySelector(`.dd-node[data-id="${id}"]`);
    if (group) {
      group.setAttribute("transform", `translate(${at.x},${at.y})`);
    }

    // The ring and its handles are drawn in the diagram's own coordinates, so
    // one transform on the group carries all of them along — measured from
    // where they were drawn, which is recorded when a drag begins. A move with
    // no drag behind it (an arrow key) has no such record and no need of one:
    // the redraw that follows puts them where they belong.
    const marks = /** @type {SVGElement} */ (svg?.querySelector(".dd-marks"));
    const drawnAt = marks ? Number(marks.dataset.x) : NaN;
    if (marks && id === marks.dataset.id && Number.isFinite(drawnAt)) {
      marks.setAttribute("transform", `translate(${at.x - drawnAt},${at.y - Number(marks.dataset.y)})`);
    }

    reroute(ed, id);
  }

  function moveSelectionTo(ed, group, dx, dy) {
    for (const [id, from] of Object.entries(group || {})) {
      placeAt(ed, id, from.x + dx, from.y + dy);
    }
  }

  function guidedMove(ed, group, dx, dy) {
    const ids = Object.keys(group || {});
    if (ids.length === 0) {
      return { dx, dy, guides: [] };
    }

    const carried = new Set(ids);
    const boxes = ids.map((id) => ({ ...group[id], w: boxOf(ed, id).w, h: boxOf(ed, id).h }));
    const corner = {
      x: Math.min(...boxes.map((at) => at.x)),
      y: Math.min(...boxes.map((at) => at.y))
    };

    // Where the hand actually is, before anything has been rounded. The grid
    // is not applied first: snapping to it can carry a box past a line it was
    // about to meet, and then the two never meet at all.
    const moving = {
      x: corner.x + dx,
      y: corner.y + dy,
      w: Math.max(...boxes.map((at) => at.x + at.w)) - corner.x,
      h: Math.max(...boxes.map((at) => at.y + at.h)) - corner.y
    };

    // Everything that is not being carried. A box cannot line up with itself,
    // and a selection being dragged cannot line up with its own members.
    const others = ed.model.nodes
      .filter((item) => !carried.has(item.id))
      .map((item) => boxOf(ed, item.id))
      .filter(Boolean);

    const lined = DiagramModel.alignGuides(moving, others, GUIDE_WITHIN / ed.view.scale);

    // A line on a real box beats a line on the grid, and only where there is
    // one: an axis with nothing to line up against falls back to the grid,
    // which is what keeps a diagram tidy where nothing else is near.
    const held = { x: false, y: false };
    for (const one of lined.guides) {
      held[one.axis] = true;
    }

    const put = {
      x: held.x ? lined.x : snap(ed, moving.x),
      y: held.y ? lined.y : snap(ed, moving.y)
    };

    return { dx: put.x - corner.x, dy: put.y - corner.y, guides: lined.guides };
  }

  function drawGuides(ed, guides) {
    const svg = drawing(ed);
    if (!svg) {
      return;
    }

    let holder = svg.querySelector(".dd-guides");
    if (!holder) {
      holder = document.createElementNS(SVG_NS, "g");
      holder.setAttribute("class", "dd-guides");
      (svg.querySelector(".dd-view") || svg).appendChild(holder);
    }

    // Lines at coordinates this file computed; no text in it at all.
    // eslint-disable-next-line no-unsanitized/property
    holder.innerHTML = DiagramDraw.guidesMarkup(guides);
  }

  function movedEdges(from, gx, gy, dx, dy) {
    return {
      left: gx < 0 ? from.x + dx : from.x,
      right: gx > 0 ? from.x + from.w + dx : from.x + from.w,
      top: gy < 0 ? from.y + dy : from.y,
      bottom: gy > 0 ? from.y + from.h + dy : from.y + from.h
    };
  }

  function guidedResize(ed, gesture, dx, dy) {
    const { id, from, grip } = gesture;
    const [gx, gy] = GRIP_EDGES.get(grip) || [1, 1];
    const edges = movedEdges(from, gx, gy, dx, dy);

    // A box cannot line up with itself: every edge of it is within nothing of
    // where it already is, so one that could would snap back the moment it
    // was nudged, and a small resize would be impossible.
    const others = ed.model.nodes
      .filter((item) => item.id !== id)
      .map((item) => boxOf(ed, item.id))
      .filter(Boolean);

    const edge = {
      x: gx > 0 ? edges.right : edges.left,
      y: gy > 0 ? edges.bottom : edges.top,
      w: 0,
      h: 0
    };
    const lined = DiagramModel.alignGuides(edge, others, GUIDE_WITHIN / ed.view.scale);

    const held = { x: false, y: false };
    for (const one of lined.guides) {
      held[one.axis] = true;
    }

    /* A line on a real box beats a line on the grid, the same way it does for
     * a move. An axis this grip does not drag needs no answer at all — the
     * edge it would be about is not being written back below.
     */
    const put = {
      x: held.x ? lined.x : snap(ed, edge.x),
      y: held.y ? lined.y : snap(ed, edge.y)
    };

    // The dragged edge lands where the guide put it; the others stay.
    const left = gx < 0 ? put.x : edges.left;
    const right = gx > 0 ? put.x : edges.right;
    const top = gy < 0 ? put.y : edges.top;
    const bottom = gy > 0 ? put.y : edges.bottom;

    /* A box that has hit its smallest must not walk. The edge being dragged is
     * the one that gives way, so the edge that is not being dragged stays
     * exactly where it was.
     */
    const w = Math.max(DIAGRAM_MIN_BOX, right - left);
    const h = Math.max(DIAGRAM_MIN_BOX / 2, bottom - top);

    return {
      at: {
        x: gx < 0 ? right - w : left,
        y: gy < 0 ? bottom - h : top,
        w,
        h
      },
      // Only lines about an edge that moved. A grip that drags one edge and
      // draws a guide about the other is explaining something that is not
      // happening.
      guides: lined.guides.filter((one) => (one.axis === "x" ? gx : gy) !== 0)
    };
  }

  function resizeTo(ed, id, box) {
    const at = boxOf(ed, id);
    if (!at) {
      return;
    }

    Object.assign(at, box);
    // A shape has to be drawn again to be a different size, and the handles
    // move with its edges, so this one is a redraw.
    drawAtOnce(ed);
  }

  const later = (ed, run) => (typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(run)
    : window.setTimeout(run, 16));

  function beginGesture(ed, kind, id, point, event) {
    const at = boxOf(ed, id);

    // Where everything being carried was when the drag began. One box or
    // nine, the arithmetic afterwards is the same.
    const group = {};
    if (kind === "move") {
      for (const one of (isSelected(ed, id) ? ed.selection : [id])) {
        const where = boxOf(ed, one);
        if (where) {
          group[one] = { x: where.x, y: where.y };
        }
      }
    }

    ed.gesture = {
      kind,
      id,
      origin: point,
      from: at ? { x: at.x, y: at.y, w: at.w, h: at.h } : null,
      group,
      moved: false
    };

    const marks = /** @type {SVGElement} */ (drawing(ed)?.querySelector(".dd-marks"));
    if (marks && at) {
    // Where the marks were drawn, so moving them is a difference rather than
    // a re-render. Only worth doing for one box: a frame round several is
    // redrawn when the drag ends, which is soon enough for something that is
    // already the same shape as what it surrounds.
      marks.dataset.x = String(at.x);
      marks.dataset.y = String(at.y);
      marks.dataset.id = id;
    }

    hold(ed, event);
  }

  function carryToFront(ed, ids) {
    const layers = drawing(ed)?.querySelectorAll(".dd-nodes");
    const top = layers?.[layers.length - 1];
    if (!top) {
      return;
    }

    const depths = DiagramDraw.nestingDepths(ed.model.nodes, ed.model.layout);
    const holds = (id) => ed.model.nodes.some((one) =>
      one.id !== id && depths.get(one.id) > (depths.get(id) || 0)
    && DiagramDraw.surrounds(ed.model.layout[id], ed.model.layout[one.id]));

    for (const one of ids) {
      const box = drawing(ed)?.querySelector(`.dd-node[data-id="${one}"]`);
      if (box && !holds(one)) {
        top.append(box);
      }
    }
  }

  function hold(ed, event) {
    try {
      ed.canvas.setPointerCapture?.(event.pointerId);
    } catch {
    // Nothing was captured.
    }
  }

  function beginMarquee(ed, point, event) {
    ed.marquee = { from: point, to: point, adding: Boolean(event.shiftKey), was: [...ed.selection] };

    try {
      ed.canvas.setPointerCapture?.(event.pointerId);
    } catch {
    // Without capture the band ends when the pointer leaves the canvas.
    }
  }

  const marqueeBox = (ed) => ({
    x: Math.min(ed.marquee.from.x, ed.marquee.to.x),
    y: Math.min(ed.marquee.from.y, ed.marquee.to.y),
    w: Math.abs(ed.marquee.to.x - ed.marquee.from.x),
    h: Math.abs(ed.marquee.to.y - ed.marquee.from.y)
  });

  const boxesIn = (ed, band) => ed.model.nodes
    .filter((item) => {
      const at = boxOf(ed, item.id);
      return at && at.x < band.x + band.w && at.x + at.w > band.x
      && at.y < band.y + band.h && at.y + at.h > band.y;
    })
    .map((item) => item.id);

  function drawMarquee(ed) {
    const svg = drawing(ed);
    if (!svg) {
      return;
    }

    const band = marqueeBox(ed);
    let shape = svg.querySelector(".dd-marquee");
    if (!shape) {
      shape = document.createElementNS(SVG_NS, "rect");
      shape.setAttribute("class", "dd-marquee");
      (svg.querySelector(".dd-view") || svg).appendChild(shape);
    }

    shape.setAttribute("x", String(round(ed, band.x)));
    shape.setAttribute("y", String(round(ed, band.y)));
    shape.setAttribute("width", String(round(ed, band.w)));
    shape.setAttribute("height", String(round(ed, band.h)));
  }

  function beginPan(ed, event) {
    ed.panning = {
      x: event.clientX,
      y: event.clientY,
      from: { x: ed.view.x, y: ed.view.y }
    };

    ed.canvas.classList.add("is-panning");

    try {
      ed.canvas.setPointerCapture?.(event.pointerId);
    } catch {
    // Without capture the pan ends when the pointer leaves the canvas,
    // which is a smaller loss than not panning at all.
    }
  }

  function applyGesture(ed, point) {
    if (!ed.gesture) {
      return;
    }

    if (ed.gesture.kind === "move" && ed.gesture.from) {
      const lined = guidedMove(ed, ed.gesture.group, point.x - ed.gesture.origin.x, point.y - ed.gesture.origin.y);
      moveSelectionTo(ed, ed.gesture.group, lined.dx, lined.dy);
      drawGuides(ed, lined.guides);
      return;
    }

    if (ed.gesture.kind === "resize" && ed.gesture.from) {
      const sized = guidedResize(ed, ed.gesture,
        point.x - ed.gesture.origin.x, point.y - ed.gesture.origin.y);
      resizeTo(ed, ed.gesture.id, sized.at);
      drawGuides(ed, sized.guides);
      return;
    }

    if (ed.gesture.kind === "connect") {
      drawDraft(ed, point);
      return;
    }

    if (ed.gesture.kind === "via") {
      const edge = ed.model.edges[ed.gesture.index];
      const corner = edge?.waypoints?.[ed.gesture.at];
      if (corner) {
        corner.x = snap(ed, point.x);
        corner.y = snap(ed, point.y);
        redrawEdge(ed, ed.gesture.index);
      }

      return;
    }

    if (ed.gesture.kind === "pin") {
      pinEnd(ed, ed.gesture.index, ed.gesture.end, point);
    }
  }

  function drawDraft(ed, point) {
    const svg = drawing(ed);
    const at = boxOf(ed, ed.gesture.id);
    if (!svg || !at) {
      return;
    }

    let draft = svg.querySelector(".dd-draft");
    if (!draft) {
      draft = document.createElementNS(SVG_NS, "path");
      draft.setAttribute("class", "dd-draft");
      draft.setAttribute("fill", "none");
      (svg.querySelector(".dd-view") || svg).appendChild(draft);
    }

    draft.setAttribute("d", `M${at.x + (at.w / 2)},${at.y + (at.h / 2)} L${point.x},${point.y}`);

    const over = boxAt(ed, point);
    for (const group of svg.querySelectorAll(".dd-node")) {
      const id = group.getAttribute("data-id");
      group.classList.toggle("is-target", Boolean(over) && over !== ed.gesture.id && id === over);
    }
  }

  const showGrab = (ed) => {
    ed.canvas.classList.toggle("is-panning-armed", ed.spaceHeld || ed.handTool);
    if (ed.handButton) {
      ed.handButton.setAttribute("aria-pressed", ed.handTool ? "true" : "false");
      ed.handButton.classList.toggle("is-on", ed.handTool);
    }
  };

  function useHand(ed, on) {
    ed.handTool = Boolean(on);
    // A band cannot be pulled by a hand, and a hand that arrives mid-band
    // would leave one drawn on the paper with nothing to finish it.
    if (ed.handTool && ed.marquee) {
      ed.marquee = null;
      drawing(ed)?.querySelector(".dd-marquee")?.remove();
    }

    // Two modes at once is one mode too many, and the hand is the one that
    // takes the whole canvas.
    if (ed.handTool) {
      useArrowTool(ed, false);
      usePlaceTool(ed, null);
    }

    showGrab(ed);
  }

  const showArrowTool = (ed) => {
    ed.canvas.classList.toggle("is-joining", ed.arrowTool);
    if (ed.arrowButton) {
      ed.arrowButton.setAttribute("aria-pressed", ed.arrowTool ? "true" : "false");
      ed.arrowButton.classList.toggle("is-on", ed.arrowTool);
    }
  };

  function useArrowTool(ed, on) {
    ed.arrowTool = Boolean(on);

    if (ed.arrowTool) {
    // Arming it is saying what the next drag is for, so the half-finished
    // ways of saying the same thing go away.
      ed.armedFrom = null;
      ed.handTool = false;
      usePlaceTool(ed, null);
      showGrab(ed);
      paintInspector(ed);
    }

    showArrowTool(ed);
  }

  const showPlacing = (ed) => {
    ed.canvas.classList.toggle("is-placing", Boolean(ed.placing));

    for (const [choice, button] of ed.placeButtons) {
      const on = ed.placing === choice;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.classList.toggle("is-on", on);
    }
  };

  function usePlaceTool(ed, choice) {
    const was = ed.placing;
    ed.placing = choice || null;

    if (ed.placing) {
    // Two modes at once is one mode too many, here as everywhere else.
      ed.armedFrom = null;
      ed.handTool = false;
      ed.arrowTool = false;
      showGrab(ed);
      showArrowTool(ed);
      say(ed, `Tap the paper to put a ${ed.placing.label.toLowerCase()} there.`);
    } else if (was) {
      say(ed, "");
    }

    showPlacing(ed);
  }

  function pressedWithTool(ed, event, point) {
  // The middle button is a pan and nothing else, on every diagram tool
  // anyone has used, and it is the one gesture that never means select.
    if (ed.viewport && (event.button === 1 || ed.spaceHeld || ed.handTool)) {
      event.preventDefault?.();
      beginPan(ed, event);
      return true;
    }

    if (typeof event.button === "number" && event.button > 0) {
      return true;
    }

    /* Armed with a shape, a press on the paper is where that shape goes.
     *
     * Asked before anything that selects or moves, because the whole reason
     * to arm the tool is to say where the next thing goes — a press that
     * first picked up whatever was already under it would drop the new one
     * on top of the old one and start dragging both.
     */
    if (ed.placing) {
      event.preventDefault?.();
      // Putting something else down settles the words being typed, the same
      // as pressing anywhere else on the paper does.
      stopEditing(ed, true);
      const choice = ed.placing;
      usePlaceTool(ed, null);
      placeChoice(ed, choice, point);
      return true;
    }

    /* Armed, a drag from a box is an arrow out of it and nothing else.
     *
     * Asked before the handles and before the line, because both of those are
     * ways of doing something to a box that has already been chosen — and the
     * whole point of the tool is the boxes that have not. Selecting the one
     * being dragged from would put its own arrows under the next drag, so
     * drawing the second arrow bent the first.
     */
    if (ed.arrowTool) {
      const from = pickable(ed, /** @type {Element} */ (event.target).closest?.(".dd-node")?.getAttribute("data-id"))
    || boxAt(ed, point);

      if (from) {
        beginGesture(ed, "connect", from, point, event);
        ed.gesture.tool = true;
        return true;
      }
    }

    return false;
  }

  function pressedOnHandle(ed, event, point) {
    const handle = /** @type {Element} */ (event.target).closest?.("[data-role]");

    if (handle && ed.selectedId) {
      const role = handle.getAttribute("data-role");

      if (role === "via" || role === "pin") {
        ed.gesture = {
          kind: role,
          index: Number(handle.getAttribute("data-edge")),
          at: Number(handle.getAttribute("data-at")),
          end: Number(handle.getAttribute("data-end")),
          origin: point,
          moved: false
        };

        hold(ed, event);
        return true;
      }

      beginGesture(ed, role === "resize" ? "resize" : "connect", ed.selectedId, point, event);
      if (ed.gesture) {
        ed.gesture.grip = handle.getAttribute("data-grip") || "se";
      }

      return true;
    }

    /* Pressing the line itself bends it: a new corner where the finger went
     * down, dragged from there. Which is how it works everywhere that has
     * ever let anyone bend an arrow, and needs nothing explaining.
     */
    const bendable = /** @type {Element} */ (event.target).closest?.(".dd-edge");
    const bending = bendable
  && (bendable.getAttribute("data-from") === ed.selectedId
    || bendable.getAttribute("data-to") === ed.selectedId);

    if (bending) {
      const index = Number(bendable.getAttribute("data-edge"));
      const at = addCorner(ed, index, point);

      if (at >= 0) {
        drawAtOnce(ed);
        ed.gesture = { kind: "via", index, at, origin: point, moved: false };
        hold(ed, event);
        return true;
      }
    }

    return false;
  }

  function pressedOnPaper(ed, event, point, adding) {

    /* A group is taken hold of by its name.
     *
     * The frame itself is background — a press anywhere inside one lands on
     * the paper — so a rubber band can still be pulled across the boxes in
     * a group, and a box in a group is still just a box to press. Taking
     * hold of the name takes hold of everything inside, which is what makes
     * dragging a group move its contents: there is nothing else to move.
     */
    const onName = groupNameAt(ed, point);

    if (onName) {
      const members = groupMembers(ed, onName);
      // Held from outside, so pressing it again goes into it, the same as
      // pressing one of the boxes it holds.
      ed.inside = groupById(ed, onName)?.parent || null;
      choose(ed, adding ? [...new Set([...ed.selection, ...members])] : members);

      if (members.length > 0) {
        beginGesture(ed, "move", members[0], point, event);
      }

      return true;
    }

    /* Empty paper. With a finger it is how you go somewhere else, because a
     * finger has no space bar and no middle button to pan with. With a
     * pointer it is how you draw a rubber band round several boxes, which
     * is what dragging empty space means everywhere else.
     */
    if (!adding) {
    // Out of whatever group we were in, too: pressing the paper is how
    // you say "none of this", and standing inside a group you can no
    // longer see anything selected in is not none of it.
      ed.inside = null;
      select(ed, null);
    }

    if (ed.viewport && event.pointerType === "touch") {
      beginPan(ed, event);
    } else if (ed.viewport) {
      beginMarquee(ed, point, event);
    }

    return true;
  }

  function pressedOnBox(ed, event, point, id, adding) {
    if (ed.armedFrom && ed.armedFrom !== id) {
      join(ed, ed.armedFrom, id);
      return true;
    }

    if (adding) {
      toggleInSelection(ed, id);
      return true;
    }

    /* A box in a group is the group, until we have gone inside it.
     *
     * Which is what makes a group one thing rather than a heap of boxes that
     * happen to move together — the frame's name is a way in, not the only
     * way in.
     *
     * A box already in a selection of several is not a new selection — it is
     * the handle you drag the whole lot by. Narrowing to it on the way down
     * would make a multiple selection impossible to move.
     */
    if (!isSelected(ed, id)) {
      choose(ed, reachedBy(ed, id));
    }

    beginGesture(ed, "move", id, point, event);
    return true;
  }

  function releasePointer(ed, event) {
    try {
      ed.canvas.releasePointerCapture?.(event.pointerId);
    } catch {
    // Nothing was captured.
    }
  }

  function endMarquee(ed, event) {
    const band = marqueeBox(ed);
    const held = ed.marquee;
    ed.marquee = null;
    ed.frame = 0;
    drawing(ed)?.querySelector(".dd-marquee")?.remove();
    releasePointer(ed, event);

    if (band.w > DIAGRAM_DRAG_SLOP || band.h > DIAGRAM_DRAG_SLOP) {
      const caught = boxesIn(ed, band).filter((id) => !lockedAway(ed, id));
      choose(ed, held.adding ? [...new Set([...held.was, ...caught])] : caught);
    }
  }

  function endPan(ed, event) {
    if (typeof event.clientX === "number") {
      ed.view.x = ed.panning.from.x + (event.clientX - ed.panning.x);
      ed.view.y = ed.panning.from.y + (event.clientY - ed.panning.y);
    }

    ed.panning = null;
    ed.frame = 0;
    ed.canvas.classList.remove("is-panning");
    applyView(ed);
    releasePointer(ed, event);
  }

  function endConnect(ed, held, point) {
    const over = held.moved ? boxAt(ed, point) : null;

    if (over && over !== held.id) {
      join(ed, held.id, over);
      return;
    }

    if (held.tool) {
      return;
    }

    if (held.moved) {
      addBox(ed, { joinFrom: held.id, x: point.x, y: point.y });
    } else {
      addBox(ed, { joinFrom: held.id });
    }
  }

  function endBend(ed, held, point) {
    if (held.kind === "via") {
      const corner = ed.model.edges[held.index]?.waypoints?.[held.at];
      if (corner) {
        corner.x = snap(ed, point.x);
        corner.y = snap(ed, point.y);
      }
    } else {
      pinEnd(ed, held.index, held.end, point);
    }

    write(ed);
    drawAtOnce(ed);
  }

  const endGesture = (ed, event) => {
    if (ed.marquee) {
      endMarquee(ed, event);
      return;
    }

    if (ed.panning) {
      endPan(ed, event);
      return;
    }

    if (!ed.gesture) {
      return;
    }

    const held = ed.gesture;
    const point = pointIn(ed, event.clientX, event.clientY);
    ed.gesture = null;
    ed.frame = 0;

    const svg = drawing(ed);
    svg?.querySelector(".dd-draft")?.remove();
    for (const group of svg?.querySelectorAll(".dd-node.is-target") || []) {
      group.classList.remove("is-target");
    }

    releasePointer(ed, event);

    if (held.kind === "connect") {
      endConnect(ed, held, point);
      return;
    }

    if (held.kind === "via" || held.kind === "pin") {
      endBend(ed, held, point);
      return;
    }

    // Everything below changed the diagram only if the hand actually went
    // somewhere.
    if (held.moved) {
      endMoveOrResize(ed, held, point);
    }
  };

  function endMoveOrResize(ed, held, point) {
    if (!held.from) {
      write(ed);
      drawAtOnce(ed);
      return;
    }

    const dx = point.x - held.origin.x;
    const dy = point.y - held.origin.y;

    if (held.kind === "move") {
      const lined = guidedMove(ed, held.group, dx, dy);
      moveSelectionTo(ed, held.group, lined.dx, lined.dy);
    } else if (held.kind === "resize") {
      resizeTo(ed, held.id, guidedResize(ed, held, dx, dy).at);
    }

    write(ed);
    drawAtOnce(ed);
  }

  const dropped = (ed, event) =>
    [...(event.dataTransfer?.files || [])].filter((file) =>
      String(file.type || "").startsWith("image/"));

  function closeMenu(ed) {
    ed.menu?.remove();
    ed.menu = null;
  }

  function openMenu(ed, clientX, clientY, items) {
    closeMenu(ed);

    /* A rule between two groups, never two of them together and never one at
     * either end. An item that does not apply here is dropped, and the rule
     * that was beside it would otherwise be left standing on its own.
     */
    const kept = items.filter(Boolean);
    const shown = kept.filter((item, at) => item !== "-"
    || (at > 0 && kept[at - 1] !== "-" && kept.slice(at + 1).some((one) => one !== "-")));

    if (shown.length === 0) {
      return;
    }

    /* The library's own menu, not one that looks nearly like it.
     *
     * This was a hand-rolled copy: same idea, different radius, different
     * shadow, a different hover colour, no icons, and the keystroke in a
     * plain span rather than a kbd. Two menus in one app that are almost the
     * same is worse than either of them, so this is the same markup the file
     * tree opens and the same stylesheet rules dress it.
     */
    ed.menu = document.createElement("div");
    ed.menu.className = "context-menu ve-diagram-menu";
    ed.menu.setAttribute("role", "menu");

    for (const item of shown) {
      if (item === "-") {
        const rule = document.createElement("hr");
        rule.className = "context-sep";
        ed.menu.append(rule);
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = item.danger ? "context-item danger" : "context-item";
      button.setAttribute("role", "menuitem");
      button.innerHTML = html`<i class="ph ${item.icon || "ph-dot"}" aria-hidden="true"></i><span></span>`;
      button.querySelector("span").textContent = item.label;

      if (item.keys) {
        const keys = document.createElement("kbd");
        keys.textContent = item.keys;
        button.append(keys);
      }

      button.addEventListener("click", () => {
        closeMenu(ed);
        item.run();
      });

      ed.menu.append(button);
    }

    const box = ed.canvas.getBoundingClientRect();
    ed.menu.style.left = `${clientX - box.left}px`;
    ed.menu.style.top = `${clientY - box.top}px`;
    ed.canvas.append(ed.menu);

    // Off the right or bottom edge is a menu half of which cannot be read, so
    // it flips back over the point it was opened at rather than being clipped.
    const shape = ed.menu.getBoundingClientRect();
    if (shape.right > box.right) {
      ed.menu.style.left = `${Math.max(0, clientX - box.left - shape.width)}px`;
    }

    if (shape.bottom > box.bottom) {
      ed.menu.style.top = `${Math.max(0, clientY - box.top - shape.height)}px`;
    }
  }

  function selectionSource(ed) {
    if (ed.selection.length === 0) {
      return sourceNow(ed);
    }

    const taken = new Set(ed.selection);
    return DiagramModel.serializeFlowchart({
      direction: ed.model.direction,
      nodes: ed.model.nodes.filter((item) => taken.has(item.id)),
      edges: ed.model.edges.filter((edge) => taken.has(edge.from) && taken.has(edge.to)),
      layout: Object.fromEntries(ed.selection.filter((id) => boxOf(ed, id)).map((id) => [id, boxOf(ed, id)]))
    }).replace(/\n$/, "");
  }

  function copyOutside(ed, text) {
  // Not every browser and not every page will allow it, and a menu item
  // that throws is worse than one that quietly does nothing here.
    try {
      void window.navigator?.clipboard?.writeText?.(text)?.catch?.(() => {});
    } catch {
    // No clipboard to write to.
    }
  }

  function restack(ed, ids, forward) {
    const moving = new Set(ids);
    const staying = ed.model.nodes.filter((item) => !moving.has(item.id));
    const carried = ed.model.nodes.filter((item) => moving.has(item.id));

    ed.model.nodes = forward ? [...staying, ...carried] : [...carried, ...staying];
    write(ed);
    paintLists(ed);
    drawAtOnce(ed);
  }

  const barItem = (ed) => (ed.viewport
    ? {
      label: ed.panels.barShut ? "Show the bar over the box" : "Hide the bar over the box",
      icon: ed.panels.barShut ? "ph-eye" : "ph-eye-slash",
      run: () => {
        ed.panels.barShut = !ed.panels.barShut;
        rememberPanels(ed);
        paintHud(ed);
      }
    }
    : null);

  function edgeMenu(ed, index) {
    const edge = ed.model.edges[index];

    return [
      { label: "Rename arrow", icon: "ph-text-t", keys: "F2",
        run: () => editEdge(ed, index) },
      { label: "Reverse arrow", icon: "ph-arrows-left-right", run: () => {
        const was = edge.from;
        edge.from = edge.to;
        edge.to = was;
        write(ed);
        paintLists(ed);
        drawAtOnce(ed);
      } },
      { label: "Straighten arrow", icon: "ph-line-segment", run: () => {
        delete edge.waypoints;
        delete edge.sides;
        write(ed);
        drawAtOnce(ed);
      } },
      "-",
      { label: "Delete arrow", icon: "ph-trash", keys: "Del", danger: true, run: () => {
        ed.model.edges = ed.model.edges.filter((other) => other !== edge);
        write(ed);
        paintLists(ed);
        paintInspector(ed);
        drawAtOnce(ed);
      } }
    ];
  }

  function nodeMenu(ed, target, point) {
    const many = ed.selection.length > 1;
    const held = groupHeld(ed);
    const them = many ? `${ed.selection.length} boxes` : "box";

    return [
      many ? null : {
        label: nodeById(ed, target.id)?.kind === "table" ? "Type in this cell" : "Rename box",
        icon: "ph-text-t",
        keys: "F2",
        run: () => openText(ed, target.id, point)
      },
      many ? null : { label: "Draw arrow from here", icon: "ph-arrow-up-right", run: () => {
        ed.armedFrom = target.id;
        say(ed, "Tap another box to join it.");
      } },
      "-",
      { label: `Duplicate ${them}`, icon: "ph-copy", keys: "Ctrl+D", run: () => duplicateSelection(ed) },
      { label: `Cut ${them}`, icon: "ph-scissors", keys: "Ctrl+X", run: () => cutSelection(ed) },
      { label: `Copy ${them}`, icon: "ph-clipboard", keys: "Ctrl+C", run: () => copySelection(ed) },
      { label: `Copy ${them} as Mermaid`, icon: "ph-code",
        run: () => copyOutside(ed, selectionSource(ed)) },
      "-",
      held
        ? { label: "Rename group", icon: "ph-textbox",
          run: () => paintInspector(ed, { focusName: true }) }
        : null,
      held
        ? { label: `Ungroup ${them}`, icon: "ph-selection-slash",
          keys: "Ctrl+Shift+G", run: () => ungroupSelection(ed) }
        : null,
      many && !held
        ? { label: `Group ${them}`, icon: "ph-selection-plus",
          keys: "Ctrl+G", run: () => groupSelection(ed) }
        : null,
      "-",
      barItem(ed),
      "-",
      { label: "Bring to front", icon: "ph-stack-simple",
        run: () => restack(ed, ed.selection, true) },
      { label: "Send to back", icon: "ph-stack-simple",
        run: () => restack(ed, ed.selection, false) },
      "-",
      { label: `Delete ${them}`, icon: "ph-trash", keys: "Del", danger: true,
        run: () => removeSteps(ed, ed.selection) }
    ];
  }

  function paperMenu(ed, point) {
    const holding = ed.selection.length > 0;
    return [
      { label: "Add box here", icon: "ph-plus-square",
        run: () => addBox(ed, { x: point.x, y: point.y }) },
      { label: "Paste", icon: "ph-clipboard", keys: "Ctrl+V", run: () => pasteClipboard(ed) },
      "-",
      { label: ed.arrowTool ? "Stop drawing arrows" : "Draw arrows",
        icon: "ph-arrow-up-right",
        keys: ed.arrowTool ? "V" : "A",
        run: () => useArrowTool(ed, !ed.arrowTool) },
      ed.viewport
        ? {
          label: ed.handTool ? "Stop moving about" : "Drag to move about",
          icon: "ph-hand",
          keys: ed.handTool ? "V" : "H",
          run: () => useHand(ed, !ed.handTool)
        }
        : null,
      "-",
      { label: "Select all boxes", icon: "ph-selection-all", keys: "Ctrl+A",
        run: () => choose(ed, ed.model.nodes.map((item) => item.id)) },
      holding
        ? { label: "Select none", icon: "ph-selection-slash", keys: "Esc",
          run: () => select(ed, null) }
        : null,
      ed.viewport
        ? { label: "Fit diagram to the window", icon: "ph-corners-out", run: () => fitView(ed) }
        : null,
      barItem(ed),
      "-",
      { label: "Copy diagram as Mermaid", icon: "ph-code",
        run: () => copyOutside(ed, sourceNow(ed)) }
    ];
  }

  function menuFor(ed, target, point) {
    if (target.kind === "edge") {
      return edgeMenu(ed, target.index);
    }

    return target.kind === "node" ? nodeMenu(ed, target, point) : paperMenu(ed, point);
  }

  function targetAt(ed, event, point) {
    const group = event.target.closest?.(".dd-node");
    const id = pickable(ed, group?.getAttribute("data-id")) || boxAt(ed, point);
    if (id) {
      return { kind: "node", id };
    }

    const line = event.target.closest?.(".dd-edge");
    if (line) {
      return { kind: "edge", index: Number(line.getAttribute("data-edge")) };
    }

    const onName = groupNameAt(ed, point);
    if (onName) {
      return { kind: "group", id: onName };
    }

    return { kind: "paper" };
  }

  function showMenuFrom(ed, event) {
    const point = pointIn(ed, event.clientX, event.clientY);
    const target = targetAt(ed, event, point);

    // Right-clicking a box that is not in the selection is about that box —
    // or about the group it is in, the same as pressing it. Right-clicking
    // one that is already held is about the whole handful.
    if (target.kind === "node" && !isSelected(ed, target.id)) {
      choose(ed, reachedBy(ed, target.id));
    }

    // And right-clicking a group's name is about the group, so it is held
    // first — the menu is then the menu for what is held.
    let about = target;

    if (target.kind === "group") {
      const members = groupMembers(ed, target.id);
      choose(ed, members);
      // The menu for a group's name is the menu for what is in it, which is
      // where grouping and ungrouping already live.
      about = members.length > 0 ? { kind: "node", id: members[0] } : { kind: "paper" };
    }

    openMenu(ed, event.clientX, event.clientY, menuFor(ed, about, point));
  }

  const forgetPress = (ed) => {
    window.clearTimeout(ed.pressTimer);
    ed.pressTimer = 0;
  };

  function copySelection(ed) {
    if (ed.selection.length === 0) {
      return null;
    }

    const taken = new Set(ed.selection);
    const cut = {
      nodes: ed.model.nodes.filter((item) => taken.has(item.id)).map((item) => ({ ...item })),
      edges: ed.model.edges
        .filter((edge) => taken.has(edge.from) && taken.has(edge.to))
        .map((edge) => ({ ...edge })),
      layout: {}
    };

    for (const id of taken) {
      const at = boxOf(ed, id);
      if (at) {
        cut.layout[id] = { ...at };
      }
    }

    clipboard = cut;
    return cut;
  }

  function pasteClipboard(ed) {
    if (!clipboard || clipboard.nodes.length === 0) {
      return;
    }

    const renamed = new Map();
    const fresh = [];

    for (const item of clipboard.nodes) {
    // Asked of the model as it grows, so two boxes pasted at once cannot
    // both be given the same new name.
      const id = DiagramModel.nextNodeId({ nodes: [...ed.model.nodes, ...fresh] });
      renamed.set(item.id, id);
      fresh.push({ ...item, id });
    }

    ed.model.nodes.push(...fresh);

    for (const item of clipboard.nodes) {
      const at = clipboard.layout[item.id];
      if (at) {
        ed.model.layout[renamed.get(item.id)] = {
          ...at,
          x: at.x + PASTE_OFFSET,
          y: at.y + PASTE_OFFSET
        };
      }
    }

    for (const edge of clipboard.edges) {
      ed.model.edges.push({ ...edge, from: renamed.get(edge.from), to: renamed.get(edge.to) });
    }

    write(ed);
    paintLists(ed);
    // What was just pasted is what you want to move, so it is what is held.
    choose(ed, [...renamed.values()]);
  }

  function cutSelection(ed) {
    if (!copySelection(ed)) {
      return;
    }

    removeSteps(ed, ed.selection);
  }

  function duplicateSelection(ed) {
    const held = clipboard;
    if (copySelection(ed)) {
      pasteClipboard(ed);
    }

    // Duplicating is not copying: whatever was on the clipboard before is
    // still what a paste should put down.
    clipboard = held || clipboard;
  }

  function placeEditor(ed) {
    if (!ed.editing) {
      return;
    }

    const at = ed.editing.box();
    if (!at) {
      stopEditing(ed, false);
      return;
    }

    const style = ed.editing.field.style;
    style.left = `${(at.x * ed.view.scale) + ed.view.x}px`;
    style.top = `${(at.y * ed.view.scale) + ed.view.y}px`;
    style.width = `${at.w * ed.view.scale}px`;
    style.height = `${at.h * ed.view.scale}px`;
    /* Scaled with the diagram and set in the type the words are drawn in, so
     * what is typed is the size it will be. A field that is always 13px is a
     * word that changes size the moment you stop typing.
     */
    style.fontSize = `${(ed.editing.size || DiagramModel.TEXT_SIZE) * ed.view.scale}px`;
  }

  function startEditing(ed, what) {
    stopEditing(ed, true);

    const field = document.createElement("textarea");
    /* A cell is drawn against its left wall and a label in the middle of its
     * box. A field that does not agree is a word that jumps the moment you
     * stop typing.
     */
    field.className = `ve-diagram-inline${what.left ? " ve-diagram-inline-left" : ""}`;
    field.value = what.read();
    field.setAttribute("aria-label", what.label);
    field.spellcheck = false;

    ed.editing = { ...what, field, was: what.read() };
    ed.canvas.append(field);
    placeEditor(ed);
    field.focus();
    field.select();

    field.addEventListener("keydown", (event) => {
    // Escape belongs to whatever is being typed into, not to the canvas
    // underneath it, which would take it as "let go of this box".
      event.stopPropagation();

      if (event.key === "Escape") {
        event.preventDefault();
        stopEditing(ed, false);
        ed.canvas.focus();
        return;
      }

      // Enter commits and shift-enter is a line break, the way it is in every
      // box anyone has typed a label into.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        stopEditing(ed, true);
        ed.canvas.focus();
        return;
      }

      /* Tab walks the grid, the way it does in every table anybody has ever
       * typed into. Without it a table is filled in by double-clicking it
       * once per cell, which is the panel's job done worse.
       */
      if (what.cell && event.key === "Tab") {
        event.preventDefault();
        stopEditing(ed, true);

        const next = cellAlong(ed, what.id, what.cell, event.shiftKey ? -1 : 1);
        if (next) {
          editCell(ed, what.id, next.row, next.column);
        } else {
          ed.canvas.focus();
        }
      }
    });

    // Clicking away is agreeing with what you typed, not throwing it away.
    field.addEventListener("blur", () => stopEditing(ed, true));
  }

  function stopEditing(ed, keep) {
    if (!ed.editing) {
      return;
    }

    const held = ed.editing;
    ed.editing = null;
    const typed = held.field.value;
    held.field.remove();

    if (keep && typed !== held.was) {
      held.write(typed);
      write(ed);
      paintLists(ed);
      paintInspector(ed);
    }

    drawAtOnce(ed);
  }

  function cellRun(ed, item, at) {
    return DiagramDraw.cellBoxes(DiagramModel.textCells(item.text || ""),
      at.w, at.h, DiagramModel.tableMetrics(item));
  }

  function cellAlong(ed, id, from, step) {
    const item = nodeById(ed, id);
    const at = item && boxOf(ed, id);
    if (!at) {
      return null;
    }

    const cells = cellRun(ed, item, at);
    const now = cells.findIndex((one) =>
      one.row === from.row && one.column === from.column);

    return now < 0 ? null : cells[now + step] || null;
  }

  function editCell(ed, id, row, column) {
    const item = nodeById(ed, id);
    if (item?.kind !== "table") {
      return;
    }

    const where = () => {
      const at = boxOf(ed, id);
      const found = at && cellRun(ed, item, at)
        .find((one) => one.row === row && one.column === column);

      return found
        ? { x: at.x + found.x, y: at.y + found.y, w: found.w, h: found.h }
        : null;
    };

    select(ed, id);
    startEditing(ed, {
      label: row === 0 ? "Table title" : `Row ${row}, column ${column + 1}`,
      size: DiagramDraw.cellSize(
        (item.cells || {})[DiagramModel.cellKey(row, column)] || "",
        DiagramDraw.sizeOf(item, ed.model.classes)),
      id,
      cell: { row, column },
      left: row > 0,
      box: where,
      read: () => (DiagramModel.textCells(item.text || "")[row] || [])[column] || "",
      write: (value) => {
        const grid = DiagramModel.textCells(item.text || "");
        while (grid.length <= row) {
          grid.push([]);
        }

        /* A pipe is the wall between two cells and a line break is the wall
         * between two rows, so neither can be inside one. A wall taken out
         * leaves a gap where it stood, so the spaces are closed up rather
         * than left standing in a row.
         *
         * The panel's own fields do this a character at a time, as they are
         * typed into, and only have the pipe to worry about. This is asked
         * once, when the typing is finished, so it can tidy afterwards
         * without the caret being anywhere near it.
         */
        grid[row][column] = value.replace(/[|\n]+/g, " ").replace(/\s+/g, " ").trim();
        item.text = DiagramModel.joinCells(grid);
        grow(ed, item);
      }
    });
  }

  function editNode(ed, id) {
    const item = nodeById(ed, id);
    if (!item) {
      return;
    }

    // A table's words belong to its cells, so they are typed into one of
    // those rather than into one field of everything with pipes in it.
    if (item.kind === "table") {
      editCell(ed, id, 0, 0);
      return;
    }

    select(ed, id);
    startEditing(ed, {
      label: "Box text",
      size: DiagramDraw.sizeOf(item, ed.model.classes),
      box: () => boxOf(ed, id),
      read: () => DiagramModel.textRows(item.text || "").join("\n"),
      write: (value) => {
        item.text = DiagramModel.joinRows(value.split("\n"));
      }
    });
  }

  function editEdge(ed, index) {
    const edge = ed.model.edges[index];
    if (!edge) {
      return;
    }

    // An arrow has no box to type in, so one is borrowed: a small field where
    // its label is drawn, which is where anyone would expect to type.
    const where = () => {
      const from = boxOf(ed, edge.from);
      const to = boxOf(ed, edge.to);
      if (!from || !to) {
        return null;
      }

      const x = ((from.x + (from.w / 2)) + (to.x + (to.w / 2))) / 2;
      const y = ((from.y + (from.h / 2)) + (to.y + (to.h / 2))) / 2;
      return { x: x - 50, y: y - 12, w: 100, h: 24 };
    };

    startEditing(ed, {
      label: "Arrow label",
      box: where,
      read: () => String(edge.label || ""),
      write: (value) => {
        edge.label = value.replace(/\n/g, " ").trim();
      }
    });
  }

  function openText(ed, id, point) {
    const item = nodeById(ed, id);
    const at = boxOf(ed, id);

    if (item?.kind === "table" && at && point) {
      const found = DiagramDraw.cellAt(DiagramModel.textCells(item.text || ""), {
        w: at.w,
        h: at.h,
        spacing: DiagramModel.tableMetrics(item),
        x: point.x - at.x,
        y: point.y - at.y
      });

      editCell(ed, id, found ? found.row : 0, found ? found.column : 0);
      return;
    }

    editNode(ed, id);
  }

  function pressedOn(ed, event, point) {
    const corner = event.target.closest?.(".dd-via");
    if (corner) {
      return {
        kind: "via",
        edge: Number(corner.getAttribute("data-edge")),
        at: Number(corner.getAttribute("data-at"))
      };
    }

    const id = pickable(ed, event.target.closest?.(".dd-node")?.getAttribute("data-id"))
    || boxAt(ed, point);
    if (id) {
      return { kind: "node", id };
    }

    const line = event.target.closest?.(".dd-edge");
    return line ? { kind: "edge", edge: Number(line.getAttribute("data-edge")) } : null;
  }

  const samePress = (ed, one, two) => Boolean(one) && Boolean(two)
  && one.kind === two.kind && one.id === two.id
  && one.edge === two.edge && one.at === two.at;

  const nearly = (ed, event, spot) => Math.abs(event.clientX - spot.x) <= TAP_NEAR
  && Math.abs(event.clientY - spot.y) <= TAP_NEAR;

  function markPress(ed, event, point) {
    const what = pressedOn(ed, event, point);
    const again = Boolean(what) && samePress(ed, what, ed.lastTap)
    && Date.now() - ed.lastTap.when <= TAP_AGAIN && nearly(ed, event, ed.lastTap);

    return { what, point, x: event.clientX, y: event.clientY, again };
  }

  function liftPress(ed, event) {
    const held = ed.tapping;
    ed.tapping = null;

    if (!held?.what || !nearly(ed, event, held)) {
    // A drag also breaks the pair it might have started.
      ed.lastTap = null;
      return;
    }

    if (held.again) {
    // Three taps are a pair and then a tap, not three pairs.
      ed.lastTap = null;

      // A press that went one level into a group has already done what the
      // pair was for.
      if (!held.drilled) {
        openTapped(ed, held.what, held.point);
      }

      return;
    }

    ed.lastTap = { ...held.what, when: Date.now(), x: held.x, y: held.y };
  }

  function openTapped(ed, what, point) {
    if (what.kind === "via") {
    // A corner put in by hand is taken out the same way a box is opened.
      dropCorner(ed, what.edge, what.at);
      return;
    }

    if (what.kind === "node") {
      openText(ed, what.id, point);
      return;
    }

    editEdge(ed, what.edge);
  }

  const spanOf = (ed) => {
    const [a, b] = [...ed.touches.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  };

  const answered = (ed, event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const typingIn = (ed, target) => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")
  || target?.isContentEditable === true;

  function onKeyUp(ed, event) {
    if (ed.viewport && (event.key === " " || event.code === "Space")) {
      ed.spaceHeld = false;
      showGrab(ed);
    }
  }

  function answeredByTools(ed, event) {
    if (ed.viewport && (event.key === " " || event.code === "Space")) {
      answered(ed, event);
      ed.spaceHeld = true;
      ed.canvas.classList.add("is-panning-armed");
      return true;
    }

    /* The hand and the pointer, on the keys they have in every editor that
     * offers both.
     */
    if (ed.viewport && !(event.ctrlKey || event.metaKey || event.altKey)
    && /^[hv]$/i.test(event.key)) {
      answered(ed, event);
      useHand(ed, event.key.toLowerCase() === "h");

      // V is the pointer, and the pointer is neither of the modes.
      if (event.key.toLowerCase() === "v") {
        useArrowTool(ed, false);
      }

      return true;
    }

    /* A for arrow. V puts it away with the hand, because V is the pointer in
     * every editor with a toolbox and putting one mode away while leaving
     * another on would be a V that half worked.
     *
     * Not Ctrl+A, which is select-all and is answered further down.
     */
    if (!(event.ctrlKey || event.metaKey || event.altKey)
    && /^[av]$/i.test(event.key)) {
      answered(ed, event);
      useArrowTool(ed, event.key.toLowerCase() === "a");
      return true;
    }

    return false;
  }

  function answeredByCommands(ed, event) {
    if (!(event.ctrlKey || event.metaKey)) {
      return false;
    }

    const key = String(event.key).toLowerCase();
    const command = ed.COMMAND_KEYS.find(([letter, when]) => letter === key && when(event));
    if (!command) {
      return false;
    }

    answered(ed, event);
    command[2]();
    return true;
  }

  function answeredByEscape(ed, event) {
  /** @type {[() => boolean, () => void][]} */
    const ladder = [
      [() => Boolean(ed.menu), () => closeMenu(ed)],
      // A mode is a mode, and a mode wants a way out that does not involve
      // finding the button that turned it on.
      [() => Boolean(ed.placing), () => usePlaceTool(ed, null)],
      [() => Boolean(ed.arrowTool), () => useArrowTool(ed, false)],
      [() => Boolean(ed.handTool), () => useHand(ed, false)],
      // Up one level first, to the group we went into. Only when we are back
      // at the top of the diagram does Escape mean "nothing".
      [() => stepOutside(ed), () => {}],
      [() => ed.selection.length > 0, () => select(ed, null)]
    ];

    for (const [when, dismiss] of ladder) {
      if (when()) {
        event.stopPropagation();
        dismiss();
        return true;
      }
    }

    return true;
  }

  function answeredBySelection(ed, event) {
  /* The way into a box that does not need a pointing device, and the one
   * every other editor already has. F2 as well as Enter, because that is
   * the key in a file manager and in StarUML, and one of the two is what
   * anybody's hands reach for first. A handful has no one label to type
   * into, so it answers the key and does nothing with it.
   */
    if (event.key === "Enter" || event.key === "F2") {
      answered(ed, event);
      if (ed.selection.length === 1) {
        openText(ed, ed.selection[0]);
      }
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      answered(ed, event);
      removeSteps(ed, ed.selection);
      return;
    }

    const nudge = NUDGES[event.key];
    if (!nudge) {
      return;
    }

    answered(ed, event);
    for (const id of ed.selection) {
      const at = boxOf(ed, id);
      if (!at || lockedAway(ed, id)) {
        continue;
      }

      if (event.shiftKey) {
        moveTo(ed, id, snap(ed, at.x) + (nudge[0] * DiagramModel.GRID),
          snap(ed, at.y) + (nudge[1] * DiagramModel.GRID));
      } else {
        placeAt(ed, id, at.x + nudge[0], at.y + nudge[1]);
      }
    }

    write(ed, { atOnce: false });
    drawSoon(ed);
  }

  function onKey(ed, event) {
  /* Something nearer the keystroke has already answered it: the field being
   * typed into, or the grip being widened with the arrow keys.
   */
    if (event.defaultPrevented || typingIn(ed, event.target)) {
      return;
    }

    if (ACTIVATED_BY_KEY.test(event.target?.tagName || "")
    && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
      return;
    }

    if (answeredByTools(ed, event) || answeredByCommands(ed, event)) {
      return;
    }

    if (event.key === "Escape") {
      answeredByEscape(ed, event);
      return;
    }

    if (ed.selection.length === 0) {
      return;
    }

    answeredBySelection(ed, event);
  }

  function newBox(ed, id, options) {
    const kind = DiagramModel.NODE_KINDS.includes(options.kind) ? options.kind : "box";

    return /** @type {ModelNode} */ ({
      id,
      shape: options.shape || "rect",
      // A table arrives as a table: a heading and a grid of empty cells, so
      // that what lands on the paper is the thing that was dragged off the
      // rail rather than a box with one word in it and a rule underneath.
      text: options.text ?? (kind === "table"
        ? DiagramModel.joinCells([["Table"], ["", ""], ["", ""]])
        : `Step ${ed.model.nodes.length + 1}`),
      ...(kind === "box" ? {} : { kind }),
      ...(options.image ? { image: options.image } : {}),
      ...(options.icon ? { icon: options.icon } : {}),
      ...(options.frame === "none" ? { frame: "none" } : {})
    });
  }

  function addBox(ed, options = {}) {
    if (ed.model.nodes.length >= DiagramModel.MAX_NODES) {
      say(ed, "That is as many steps as this can hold.");
      return;
    }

    const id = DiagramModel.nextNodeId(ed.model);
    const item = newBox(ed, id, options);
    ed.model.nodes.push(item);

    /* How big it starts. A picture wants room to be a picture in — measuring
     * one by the words under it would drop it into a box the size of its
     * caption.
     */
    const size = options.size || DiagramModel.measureNode(item);
    const where = placeFor(ed, options, size);
    ed.model.layout[id] = { x: where.x, y: where.y, w: size.w, h: size.h };

    // A step with nothing pointing at it is not in the flowchart at all — it is
    // drawn off to one side on its own. Joining it to the box it was grown from
    // is the whole meaning of growing it from there.
    if (options.joinFrom && ed.model.edges.length < DiagramModel.MAX_EDGES) {
      ed.model.edges.push({ from: options.joinFrom, to: id, kind: "arrow", label: "" });
    }

    write(ed);
    paintLists(ed);

    /* A box just put down is a box about to be named, and the place to name
     * it is the box itself. The caret used to go to a field in a panel on the
     * other side of the screen, which is a long way to look for the word you
     * were already typing.
     */
    if (ed.viewport && !options.image && !options.icon) {
      select(ed, id);
      openText(ed, id);
    } else {
    // A picture is not named by being dropped, and a caret blinking over a
    // photograph is a question nobody asked.
      select(ed, id, { focusName: true });
    }
  }

  function placeFor(ed, options, size) {
    if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
      return { x: snap(ed, options.x - (size.w / 2)), y: snap(ed, options.y - (size.h / 2)) };
    }

    const from = options.joinFrom ? boxOf(ed, options.joinFrom) : null;
    if (from) {
      const below = { x: snap(ed, from.x + ((from.w - size.w) / 2)), y: snap(ed, from.y + from.h + 90) };
      return free(ed, below, size);
    }

    const bottom = Object.values(ed.model.layout)
      .reduce((most, at) => Math.max(most, at.y + at.h), 0);

    return { x: DiagramModel.MARGIN, y: snap(ed, bottom === 0 ? DiagramModel.MARGIN : bottom + 60) };
  }

  function free(ed, where, size) {
    const clashes = (at) => Object.values(ed.model.layout).some((other) => at.x < other.x + other.w
    && at.x + size.w > other.x
    && at.y < other.y + other.h
    && at.y + size.h > other.y);

    let spot = { ...where };

    for (let tries = 0; tries < 12 && clashes(spot); tries += 1) {
      spot = { x: snap(ed, spot.x + size.w + 40), y: spot.y };
    }

    return spot;
  }

  function join(ed, from, to) {
    if (ed.model.edges.length >= DiagramModel.MAX_EDGES) {
      say(ed, "That is as many arrows as this can hold.");
      return;
    }

    ed.model.edges.push({ from, to, kind: "arrow", label: "" });
    write(ed);
    paintLists(ed);
    select(ed, from);
  }

  function removeStep(ed, id) {
    removeSteps(ed, [id]);
  }

  function removeSteps(ed, ids) {
  // A locked group is locked against this too, which is most of the reason
  // anybody locks one.
    const going = new Set(ids.filter((id) => !lockedAway(ed, id)));
    ed.model.nodes = ed.model.nodes.filter((item) => !going.has(item.id));
    // An arrow to a step that is no longer there would declare it again by
    // naming it, and the step would come back as an empty box.
    ed.model.edges = ed.model.edges.filter((edge) => !going.has(edge.from) && !going.has(edge.to));
    for (const id of going) {
      delete ed.model.layout[id];
    }

    // Before the file is written, not after: a group emptied by a delete is
    // gone from the drawing at once, and a file that still had it would put
    // it back on the next read.
    tidyGroups(ed);
    write(ed);
    paintLists(ed);
    select(ed, null);
  }

  const groupsNow = (ed) => (Array.isArray(ed.model.groups) ? ed.model.groups : []);

  const groupById = (ed, id) => groupsNow(ed).find((group) => group.id === id) || null;

  function groupsAbove(ed, parent) {
    const chain = [];
    const seen = new Set();

    for (let at = groupById(ed, parent); at && !seen.has(at.id); at = groupById(ed, at.parent)) {
      seen.add(at.id);
      chain.push(at.id);
    }

    return chain;
  }

  function reachFor(ed, id) {
    const node = nodeById(ed, id);
    if (!node) {
      return null;
    }

    const chain = groupsAbove(ed, node.parent);
    const depth = ed.inside ? chain.indexOf(ed.inside) : chain.length;

    // Somewhere else entirely: the press has left the group we were in, so
    // it is read from the top again.
    const from = depth < 0 ? chain.length : depth;
    return from > 0 ? { kind: "group", id: chain[from - 1] } : { kind: "node", id };
  }

  function lockedAway(ed, id) {
    const node = nodeById(ed, id);
    return Boolean(node) && groupsAbove(ed, node.parent).some((one) => groupById(ed, one)?.lock);
  }

  const pickable = (ed, id) => (id && !lockedAway(ed, id) ? id : null);

  const reachedBy = (ed, id) => {
    const reach = reachFor(ed, id);
    return reach && reach.kind === "group" ? groupMembers(ed, reach.id) : [id];
  };

  function stepOutside(ed) {
    const was = ed.inside;
    if (!was) {
      return false;
    }

    ed.inside = groupById(ed, was)?.parent || null;
    choose(ed, groupMembers(ed, was));
    return true;
  }

  function groupMembers(ed, id) {
    const inside = new Set([id]);

    for (let again = true; again;) {
      again = false;

      for (const group of groupsNow(ed)) {
        if (!inside.has(group.id) && inside.has(group.parent)) {
          inside.add(group.id);
          again = true;
        }
      }
    }

    return ed.model.nodes.filter((node) => inside.has(node.parent)).map((node) => node.id);
  }

  function groupHeld(ed) {
    if (ed.selection.length === 0) {
      return null;
    }

    const chosen = [...ed.selection].sort().join("\u0000");
    const depths = DiagramDraw.groupDepths(groupsNow(ed));
    const matches = groupsNow(ed).filter((group) => {
      const members = groupMembers(ed, group.id);
      return members.length === ed.selection.length
      && members.sort().join("\u0000") === chosen;
    });

    return matches.sort((one, two) =>
      (depths.get(two.id) || 0) - (depths.get(one.id) || 0))[0] || null;
  }

  const framesNow = (ed) => DiagramDraw.groupBoxes(ed.model, ed.model.layout);

  function groupNameAt(ed, point) {
    const frames = framesNow(ed);

    /* No order to decide here. A group inside a group starts a full padding
     * below the outer name, so two names can never be over the same point,
     * and the first frame whose band holds it is the only one that does.
     */
    for (const group of groupsNow(ed)) {
      const at = frames[group.id];

      if (!at) {
        continue;
      }

      if (point.x >= at.x && point.x <= at.x + at.w
      && point.y >= at.y && point.y <= at.y + DiagramDraw.GROUP_HEAD) {
        return group.id;
      }
    }

    return null;
  }

  function tidyGroups(ed) {
    if (groupsNow(ed).length === 0) {
      return;
    }

    for (let again = true; again;) {
      again = false;

      const empty = groupsNow(ed).find((group) =>
        !ed.model.nodes.some((node) => node.parent === group.id)
      && !groupsNow(ed).some((other) => other.parent === group.id));

      if (empty) {
        liftOut(ed, empty);
        again = true;
      }
    }

    if (ed.model.groups.length === 0) {
      delete ed.model.groups;
    }

    // Standing inside a group that is no longer there would leave every press
    // being read from a place in the diagram that does not exist.
    if (ed.inside && !groupById(ed, ed.inside)) {
      ed.inside = null;
    }
  }

  function liftOut(ed, group) {
    for (const node of ed.model.nodes) {
      if (node.parent === group.id) {
        if (group.parent) {
          node.parent = group.parent;
        } else {
          delete node.parent;
        }
      }
    }

    for (const other of groupsNow(ed)) {
      if (other.parent === group.id) {
        other.parent = group.parent || null;
      }
    }

    ed.model.groups = groupsNow(ed).filter((other) => other !== group);
  }

  function nextGroupNumber(ed) {
    const taken = new Set([...groupsNow(ed).map((group) => group.id),
      ...ed.model.nodes.map((node) => node.id)]);

    let n = 1;
    while (taken.has(`group${n}`)) {
      n += 1;
    }

    return n;
  }

  function groupSelection(ed) {
    if (ed.selection.length === 0) {
      return;
    }

    const members = ed.model.nodes.filter((node) => ed.selection.includes(node.id));
    const above = new Set(members.map((node) => node.parent || null));
    const parent = above.size === 1 ? [...above][0] : null;
    const n = nextGroupNumber(ed);
    const id = `group${n}`;

    ed.model.groups = [...groupsNow(ed), { id, label: `Group ${n}`, parent }];

    for (const node of members) {
      node.parent = id;
    }

    tidyGroups(ed);
    write(ed);
    paintLists(ed);
    // The same boxes are still held; what changed is that they are now a
    // group, which is what the panel has to say next.
    choose(ed, ed.selection);
  }

  function ungroupSelection(ed) {
    const group = groupHeld(ed);
    if (!group) {
      return;
    }

    liftOut(ed, group);
    tidyGroups(ed);
    write(ed);
    paintLists(ed);
    choose(ed, ed.selection);
  }

  function renameGroup(ed, group, name) {
    group.label = name;
    write(ed);
    drawAtOnce(ed);
  }

  const fromPalette = (ed, choice) => ({
    shape: choice.shape,
    kind: choice.kind,
    frame: choice.frame,
    icon: choice.icon,
    text: choice.text ?? (choice.icon ? "" : undefined),
    size: choice.size || (choice.icon ? { w: 80, h: 80 } : undefined)
  });

  function placeChoice(ed, choice, point) {
    const at = point ? { x: point.x, y: point.y } : {};

    if (choice.picture) {
      askForPicture(ed, { frame: "none", ...at });
      return;
    }

    addBox(ed, { ...fromPalette(ed, choice), ...at });
  }

  function stylesheetText(ed) {
  /* The promise is kept rather than the text. Two saves in quick
   * succession would otherwise each find nothing kept and each go and ask,
   * and the second would overwrite what the first had already worked out.
   */
    if (!ed.sheetAsked) {
    /* All of the page's own stylesheets, in the order it links them. The
     * rules a diagram is painted by are spread across several files now,
     * and asking for one of them by name would save a picture with most of
     * its colours missing.
     */
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .map((link) => link.getAttribute("href") || "")
        .filter((href) => href.startsWith("/css/"));
      const wanted = links.length > 0 ? links : ["/css/app/diagram.css"];
      ed.sheetAsked = Promise.all(wanted.map((href) => fetch(href)
        .then((answer) => (answer.ok ? answer.text() : ""))
      // A picture with no styling is still a picture of the right shape,
      // and a better answer than a button that does nothing.
        .catch(() => "")))
        .then((sheets) => sheets.join("\n"));
    }

    return ed.sheetAsked;
  }

  const themeValue = (ed, name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name);

  async function pictureOfIt(ed) {
    return DiagramDraw.exportSvg(ed.model, {
      layout: ed.model.layout,
      css: await stylesheetText(ed),
      read: (name) => themeValue(ed, name),
      background: themeValue(ed, "--canvas").trim(),
      label: ed.settings.title || "Diagram"
    });
  }

  const savedAs = (ed, extension) => {
    const said = String(ed.settings.title || "diagram")
      .replace(/\.[^.]*$/, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "");

    return `${said || "diagram"}.${extension}`;
  };

  const handOver = (ed, blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next turn: revoking it in this one has, in some
    // browsers, cancelled the download it was for.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  async function saveSvg(ed) {
    handOver(ed, new Blob([await pictureOfIt(ed)], { type: "image/svg+xml" }),
      savedAs(ed, "svg"));
  }

  async function savePng(ed) {
    const text = await pictureOfIt(ed);
    const size = DiagramDraw.exportSize(ed.model, ed.model.layout);
    const picture = document.createElement("img");

    const drawn = /** @type {Promise<void>} */ (new Promise((done, fail) => {
      picture.onload = () => done();
      picture.onerror = () => fail(new Error("the drawing could not be rasterised"));
    }));

    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    await drawn;

    const paper = document.createElement("canvas");
    paper.width = size.w * EXPORT_SCALE;
    paper.height = size.h * EXPORT_SCALE;

    const brush = paper.getContext("2d");
    brush.scale(EXPORT_SCALE, EXPORT_SCALE);
    brush.drawImage(picture, 0, 0, size.w, size.h);

    const blob = await new Promise((done) => paper.toBlob(done, "image/png"));
    if (blob) {
      handOver(ed, blob, savedAs(ed, "png"));
    }
  }

  const say = (ed, words) => {
    ed.hint.textContent = words;
    ed.hint.hidden = words === "";
  };

  const selectedNode = (ed) => nodeById(ed, ed.selectedId);

  function choose(ed, ids, options = {}) {
    ed.selection = ids.filter((id) => nodeById(ed, id));
    ed.selectedId = ed.selection.length === 1 ? ed.selection[0] : null;
    ed.armedFrom = null;
    paintInspector(ed, options);
    markTree(ed);
    // The ring and its handles are part of the drawing, so selecting something
    // is a redraw — of a picture that is a few kilobytes of string.
    drawAtOnce(ed);
  }

  function select(ed, id, options = {}) {
    choose(ed, id ? [id] : [], options);
  }

  function toggleInSelection(ed, id) {
    const reach = reachedBy(ed, id);
    const already = reach.every((id) => isSelected(ed, id));

    choose(ed, already
      ? ed.selection.filter((one) => !reach.includes(one))
      : [...new Set([...ed.selection, ...reach])]);
  }

  const stepSelect = (ed, value, label, className) => {
    const picker = document.createElement("select");
    picker.className = className;
    named(ed, picker, label);

    for (const item of ed.model.nodes) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = stepLabel(ed, item);
      picker.appendChild(option);
    }

    picker.value = value;
    return picker;
  };

  const dropButton = (ed, label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ve-diagram-drop";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
    return button;
  };

  const shapeSelect = (ed, item) => {
    const shape = document.createElement("select");
    shape.className = "ve-diagram-shape";
    named(ed, shape, "Step shape");

    for (const name of diagramShapeChoices(item.shape)) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = diagramShapeLabel(name);
      shape.appendChild(option);
    }

    const table = document.createElement("option");
    table.value = "table";
    table.textContent = "Table";
    shape.appendChild(table);

    const bare = document.createElement("option");
    bare.value = NO_FRAME;
    bare.textContent = "No frame";
    shape.appendChild(bare);

    shape.value = item.frame === NO_FRAME
      ? NO_FRAME
      : (item.kind === "table" ? "table" : item.shape);

    shape.addEventListener("change", () => {
    // The frame is not a shape, so choosing one puts the frame back and
    // choosing "no frame" leaves the shape it had underneath it.
      if (shape.value === NO_FRAME) {
        item.frame = NO_FRAME;
        delete item.kind;

        /* Turning the frame off a box that is not carrying a picture or an
         * icon leaves words on the paper, which is a kind. The parser says
         * the same of the same box when the file is opened again, and it
         * says it by asking the same question — so the box does not change
         * kind by being saved, which is the seam this closes.
         */
        if (DiagramModel.wordsOnly(item)) {
          item.kind = "text";
        }

        commit(ed);
        paintInspector(ed);
        paintLists(ed);
        return;
      }

      delete item.frame;

      if (shape.value === "table") {
        item.kind = "table";
      } else {
        delete item.kind;
        item.shape = shape.value;
      }

      grow(ed, item);
      commit(ed);
      paintInspector(ed);
    });

    return shape;
  };

  function grow(ed, item) {
    const at = boxOf(ed, item.id);
    if (!at) {
      return;
    }

    const size = DiagramModel.measureNode(item, { font: fontSizeOf(ed, item) });
    at.w = Math.max(at.w, size.w);
    at.h = Math.max(at.h, size.h);
  }

  const labelField = (ed, item) => {
    const rows = item.kind === "table" ? 3 : 1;
    const field = document.createElement("textarea");
    field.className = `ve-diagram-text${item.kind === "table" ? " ve-diagram-rowsy" : ""}`;
    field.value = DiagramModel.textRows(item.text).join("\n");
    // A line is a row and a pipe is the wall between two cells, which is a
    // thing a placeholder can say and a caption cannot.
    field.placeholder = item.kind === "table"
      ? "Title\nName | Type\nid | int"
      : item.id;
    named(ed, field, item.kind === "table" ? "Table rows" : "Step label");

    const fit = () => {
      field.rows = Math.min(LABEL_ROWS_MAX,
        Math.max(rows, field.value.split("\n").length));
    };

    fit();

    field.addEventListener("input", () => {
      item.text = DiagramModel.joinRows(field.value.split("\n"));
      fit();
      grow(ed, item);
      renameEverywhere(ed, item.id, stepLabel(ed, item));
      commit(ed);
    });

    return field;
  };

  const named = (ed, control, label) => {
    control.setAttribute("aria-label", label);
    control.name = `dd-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
      .replace(/-+$/, "");
    return control;
  };

  const captioned = (ed, name, control) => {
    const holder = document.createElement(
      FIELD_TAGS.has(control.tagName) ? "label" : "div");
    holder.className = "ve-diagram-field";

    const caption = document.createElement("span");
    caption.className = "ve-diagram-field-name";
    caption.textContent = name;

    holder.append(caption, control);
    return holder;
  };

  const cellField = (ed, item, row, column, label) => {
    const field = document.createElement("input");
    field.type = "text";
    field.className = "ve-diagram-cell";
    named(ed, field, label);
    field.value = (DiagramModel.textCells(item.text || item.id)[row] || [])[column] || "";

    field.addEventListener("input", () => {
    /* A pipe is the wall between two cells, so it cannot be inside one.
     * Taken out of the field rather than only out of what is stored: a
     * field showing a character the diagram does not have is a field that
     * has quietly stopped being what it says it is.
     */
      if (field.value.includes("|")) {
        const at = Math.max(0, (field.selectionStart || 1) - 1);
        field.value = field.value.replace(/\|/g, "");
        field.setSelectionRange(at, at);
      }

      const grid = DiagramModel.textCells(item.text || item.id);
      while (grid.length <= row) {
        grid.push([]);
      }

      grid[row][column] = field.value;
      item.text = DiagramModel.joinCells(grid);
      grow(ed, item);
      renameEverywhere(ed, item.id, stepLabel(ed, item));
      commit(ed);
    });

    field.addEventListener("focus", () => {
      ed.cellFocus = { row, column };
      ed.showCellFont();
    });

    return field;
  };

  function cellGrid(ed, item) {
    const grid = DiagramModel.textCells(item.text || item.id);
    const columns = DiagramModel.columnsOf(grid);

    const box = document.createElement("div");
    box.className = "ve-diagram-cells";
    box.style.setProperty("--dd-columns", String(columns));

    const title = cellField(ed, item, 0, 0, "Table title");
    title.className = "ve-diagram-cell ve-diagram-cell-title";
    title.placeholder = "Title";
    box.append(title);

    for (let row = 1; row < grid.length; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        box.append(cellField(ed, item, row, column,
          `Row ${row}, column ${column + 1}`));
      }
    }

    return box;
  }

  const stepper = (ed, name, value, { least, most, set, by = 1 }) => {
    const box = document.createElement("div");
    box.className = "ve-diagram-stepper";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", name);

    const step = (label, icon, to) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ve-diagram-step";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = html`<i class="ph ${icon}" aria-hidden="true"></i>`;
      button.disabled = to < least || to > most;
      button.addEventListener("click", () => set(to));
      return button;
    };

    const count = document.createElement("span");
    count.className = "ve-diagram-count";
    count.textContent = String(value);

    // Fewer of a thing you count, less of an amount you set — which is the
    // whole difference between the two kinds of stepper here.
    const what = name.toLowerCase();
    box.append(step(`${by === 1 ? "Fewer" : "Less"} ${what}`, "ph-minus", value - by),
      count, step(`More ${what}`, "ph-plus", value + by));

    return box;
  };

  function resizeTable(ed, item, rows, columns) {
    const grid = DiagramModel.textCells(item.text || item.id);
    item.text = DiagramModel.joinCells(
      DiagramModel.resizeGrid(grid, rows, columns));

    /* A row taken off takes its cells' type with it, here as well as in the
     * file — or adding the row back later would bring an old bold with it
     * out of nowhere. Written and read back rather than filtered by hand, so
     * one place decides which cells a table has.
     */
    const kept = DiagramModel.readCellStyles(DiagramModel.writeCellStyles(
      item.cells, DiagramModel.textCells(item.text)));
    if (Object.keys(kept).length > 0) {
      item.cells = kept;
    } else {
      delete item.cells;
    }

    /* The box grows to hold what is in it, and never shrinks.
     *
     * A size somebody dragged is a size somebody chose, and taking a row off
     * a table was not a request to undo that. Nothing is lost by leaving it:
     * the body is shared out evenly, so a table with one row fewer is a table
     * with taller rows rather than one with a blank strip along the bottom.
     */
    grow(ed, item);
    renameEverywhere(ed, item.id, stepLabel(ed, item));
    write(ed);
    paintLists(ed);
    paintInspector(ed);
    drawAtOnce(ed);
  }

  function respace(ed, item, patch) {
    const at = boxOf(ed, item.id);
    const was = DiagramModel.measureNode(item);

    Object.assign(item, patch);

    const now = DiagramModel.measureNode(item);
    if (at) {
      at.w = Math.max(now.w, at.w + (now.w - was.w));
      at.h = Math.max(now.h, at.h + (now.h - was.h));
    }

    write(ed);
    paintInspector(ed);
    drawAtOnce(ed);
  }

  function tableSpacing(ed, item) {
    const spacing = DiagramModel.tableMetrics(item);

    const row = document.createElement("div");
    row.className = "ve-diagram-row ve-diagram-grid-size";
    row.append(
      captioned(ed, "Padding", stepper(ed, "Padding", spacing.pad, {
        least: DiagramModel.TABLE_PAD.least,
        most: DiagramModel.TABLE_PAD.most,
        set: (to) => respace(ed, item, { pad: to }),
        by: 2
      })),
      captioned(ed, "Spacing", stepper(ed, "Spacing", spacing.gap, {
        least: DiagramModel.TABLE_GAP.least,
        most: DiagramModel.TABLE_GAP.most,
        set: (to) => respace(ed, item, { gap: to }),
        by: 5
      }))
    );

    return row;
  }

  function tableSize(ed, item) {
    const grid = DiagramModel.textCells(item.text || item.id);
    const rows = grid.length;
    const columns = DiagramModel.columnsOf(grid);

    const row = document.createElement("div");
    row.className = "ve-diagram-row ve-diagram-grid-size";
    row.append(
      captioned(ed, "Rows", stepper(ed, "Rows", rows, {
        least: 1, most: TABLE_MAX_ROWS, set: (to) => resizeTable(ed, item, to, columns)
      })),
      captioned(ed, "Columns", stepper(ed, "Columns", columns, {
        least: 1, most: TABLE_MAX_COLUMNS, set: (to) => resizeTable(ed, item, rows, to)
      }))
    );

    return row;
  }

  const groupNameField = (ed, group) => {
    const field = document.createElement("input");
    field.type = "text";
    field.className = "ve-diagram-text ve-diagram-group-name";
    field.value = DiagramDraw.groupName(group);
    field.placeholder = group.id;
    named(ed, field, "Group name");

    field.addEventListener("input", () => {
      renameGroup(ed, group, field.value);
    });

    return field;
  };

  const heading = (ed, words, extra) => {
    const row = document.createElement("div");
    row.className = "ve-diagram-picked";

    const name = document.createElement("span");
    name.className = "ve-diagram-legend";
    name.textContent = words;

    row.append(name);

    if (extra) {
      row.append(extra);
    }

    return row;
  };

  const chooser = (ed, className, aria, choices, value) => {
    const select = document.createElement("select");
    select.className = className;
    named(ed, select, aria);

    for (const [name, text] of choices) {
      const choice = document.createElement("option");
      choice.value = name;
      choice.textContent = text;
      select.appendChild(choice);
    }

    select.value = value;
    return select;
  };

  const setLink = (ed, edge, style, ends) => {
    edge.kind = DiagramModel.linkFor(style, ends);

    const implied = DiagramDraw.endsOf({ kind: edge.kind });
    if (implied[0] === ends[0] && implied[1] === ends[1]) {
      delete edge.ends;
    } else {
      edge.ends = ends;
    }
  };

  const arrowRow = (ed, edge) => {
    const row = document.createElement("div");
    row.className = "ve-diagram-row ve-diagram-arrow";

    const from = stepSelect(ed, edge.from, "Arrow from", "ve-diagram-pick");

    const ends = DiagramDraw.endsOf(edge);
    const endChoices = DiagramDraw.END_KINDS.map((one) => [one.name, one.label]);

    /* Four, reading left to right the way the line does: what is at its back,
     * how it is drawn, what shape it is drawn in, what is at its point.
     *
     * The middle two are both "how it is drawn" and sit together for that
     * reason — one is what the line is made of and the other is the path it
     * takes to get there.
     */
    const back = chooser(ed, "ve-diagram-kind", "Arrow start", endChoices, ends[0]);
    const style = chooser(ed, "ve-diagram-kind", "Line style",
      DiagramModel.LINE_STYLES, DiagramModel.lineStyleOf(edge.kind));
    const shape = chooser(ed, "ve-diagram-kind", "Line shape",
      DiagramModel.ROUTE_SHAPES, DiagramDraw.shapeOf(edge));
    const forward = chooser(ed, "ve-diagram-kind", "Arrow end", endChoices, ends[1]);

    const line = document.createElement("div");
    line.className = "ve-diagram-ends";
    line.append(back, style, shape, forward);

    const label = document.createElement("input");
    label.type = "text";
    label.className = "ve-diagram-text";
    label.value = edge.label;
    label.placeholder = "label";
    named(ed, label, "Arrow label");

    const to = stepSelect(ed, edge.to, "Arrow to", "ve-diagram-pick");
    const drop = dropButton(ed, "Remove this arrow");

    from.addEventListener("change", () => {
      edge.from = from.value;
      commit(ed);
    });

    to.addEventListener("change", () => {
      edge.to = to.value;
      commit(ed);
    });

    for (const control of [back, style, forward]) {
      control.addEventListener("change", () => {
        setLink(ed, edge, style.value, [back.value, forward.value]);
        commit(ed);
      });
    }

    /* The shape is nobody else's business — Mermaid draws a link however its
     * own renderer feels like — so it goes in the layout comment.
     *
     * Said plainly, default and all. Whether the default is worth writing
     * down is the file's question and the file answers it: the writer leaves
     * it off, and there is one place that decides so rather than two that
     * have to agree.
     */
    shape.addEventListener("change", () => {
      edge.route = shape.value;
      commit(ed);
    });

    label.addEventListener("input", () => {
      edge.label = label.value;
      commit(ed);
    });

    drop.addEventListener("click", () => {
      ed.model.edges = ed.model.edges.filter((other) => other !== edge);
      write(ed);
      paintLists(ed);
      paintInspector(ed);
      drawAtOnce(ed);
    });

    row.append(from, line, label, to, drop);
    return row;
  };

  const sameColour = (ed, a, b) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => a[key] === b[key]);
  };

  function classFor(ed, colour) {
    ed.model.classes = ed.model.classes || {};

    for (const [name, declarations] of Object.entries(ed.model.classes)) {
      if (sameColour(ed, declarations, colour)) {
        return name;
      }
    }

    for (let n = 1; ; n += 1) {
      const name = `${DIAGRAM_CLASS_PREFIX}${n}`;
      if (!ed.model.classes[name]) {
        ed.model.classes[name] = { ...colour };
        return name;
      }
    }
  }

  function forgetUnworn(ed) {
    if (!ed.model.classes) {
      return;
    }

    const worn = new Set(ed.model.nodes.flatMap((item) => item.classes || []));

    for (const name of Object.keys(ed.model.classes)) {
      if (DIAGRAM_CLASS_RE.test(name) && !worn.has(name)) {
        delete ed.model.classes[name];
      }
    }
  }

  function styleOf(ed, item) {
    const classes = ed.model.classes || {};

    for (const name of item?.classes || []) {
      if (DIAGRAM_CLASS_RE.test(name) && classes[name]) {
        return { ...classes[name] };
      }
    }

    return {};
  }

  function fontSizeOf(ed, item) {
    return { ...styleOf(ed, item), ...(item?.style || {}) }["font-size"] || "";
  }

  function wearing(ed, declarations, offered, keys) {
    const found = offered.find(([, part]) =>
      keys.every((key) => (declarations[key] || "") === (part[key] || "")));

    return found ? found[0] : offered[0][0];
  }

  function colourOf(ed, item) {
    const declarations = styleOf(ed, item);
    const found = DIAGRAM_COLOURS.find(([, colour]) =>
      DIAGRAM_COLOUR_KEYS.every((key) => declarations[key] === colour[key]));

    return found ? found[0] : null;
  }

  function restyleOne(ed, item, patch, ours) {
    const declarations = { ...styleOf(ed, item), ...patch };
    for (const [key, value] of Object.entries(declarations)) {
      if (value === null || value === "") {
        delete declarations[key];
      }
    }

    const wanted = Object.keys(declarations).length > 0 ? classFor(ed, declarations) : null;
    const kept = (item.classes || []).filter((name) => !ours.has(name));
    item.classes = wanted ? [...kept, wanted] : kept;

    if (item.classes.length === 0) {
      delete item.classes;
    }
  }

  function restyle(ed, ids, patch, options = {}) {
    const ours = new Set(Object.keys(ed.model.classes || {}).filter((name) =>
      DIAGRAM_CLASS_RE.test(name)));

    for (const id of ids) {
      const item = nodeById(ed, id);
      if (item) {
        restyleOne(ed, item, patch, ours);
      }
    }

    forgetUnworn(ed);

    /* Type twice the size needs twice the room. A box that keeps the size it
     * was measured at while its type is enlarged is a box its own words no
     * longer fit in. It only ever grows: a box somebody sized by hand is a
     * box somebody meant, and the type coming back down does not un-mean it.
     */
    if (options.fit) {
      for (const id of ids) {
        const item = nodeById(ed, id);
        if (item) {
          grow(ed, item);
        }
      }
    }

    write(ed);
    drawAtOnce(ed);

    /* A repaint takes away the field the caret is in, and a spinner you can
     * only press once is not a spinner — so the control that asked to keep
     * the panel keeps it, and every size field on the screen is brought into
     * step instead.
     */
    if (!options.keepPanel) {
      paintInspector(ed);
    }

    showSizes(ed);
  }

  function colourRow(ed, ids) {
    const row = document.createElement("div");
    row.className = "ve-diagram-colours";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Colour");

    const held = ids.length === 1 ? colourOf(ed, nodeById(ed, ids[0])) : null;

    const swatch = (label, colour) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ve-diagram-swatch";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", held === label ? "true" : "false");
      button.classList.toggle("is-on", held === label);

      if (colour) {
        button.style.background = colour.fill;
        button.style.borderColor = colour.stroke;
      }

      button.addEventListener("click", () => restyle(ed, ids, colour || NO_COLOUR));
      return button;
    };

    const none = swatch("No colour", null);
    none.classList.add("ve-diagram-swatch-none");
    none.setAttribute("aria-pressed", held === null ? "true" : "false");
    none.classList.toggle("is-on", held === null);
    row.append(none);

    for (const [label, colour] of DIAGRAM_COLOURS) {
      row.append(swatch(label, colour));
    }

    /* Anything at all, for the diagram whose colours are somebody's brand
     * rather than somebody's taste. The stroke and the text are worked out
     * from the fill, because asking for three colours to get one box coloured
     * is three times the work for the same answer nearly every time.
     */
    const custom = document.createElement("input");
    custom.type = "color";
    custom.className = "ve-diagram-swatch ve-diagram-swatch-custom";
    custom.title = "Any colour";
    named(ed, custom, "Any colour");
    custom.value = "#8ed9cf";
    custom.addEventListener("change", () => {
      restyle(ed, ids, {
        fill: custom.value,
        stroke: darken(ed, custom.value, 0.45),
        color: darken(ed, custom.value, 0.8)
      });
    });
    row.append(custom);

    return row;
  }

  function inkRow(ed, ids) {
    const row = document.createElement("div");
    row.className = "ve-diagram-row ve-diagram-inks";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Its own colours");

    const declarations = ids.length === 1 ? styleOf(ed, nodeById(ed, ids[0])) : {};

    for (const [label, key, fallback] of DIAGRAM_INKS) {
      const held = String(declarations[key] || "");

      const well = document.createElement("div");
      well.className = "ve-diagram-ink";

      const caption = document.createElement("span");
      caption.className = "ve-diagram-ink-name";
      caption.textContent = label;

      const input = document.createElement("input");
      input.type = "color";
      input.className = "ve-diagram-swatch ve-diagram-swatch-custom";
      input.dataset.ink = key;
      input.value = HEX_RE.test(held) ? held.toLowerCase() : fallback;
      named(ed, input, `${label} colour`);
      input.addEventListener("change", () => restyle(ed, ids, { [key]: input.value }));

      /* Off, rather than back to the colour the well was showing. The theme's
       * own colour is not a hex this panel knows — it changes with the theme,
       * which is the whole point of not declaring one — so the way back is to
       * say nothing, and a well that can only be set is a well that traps the
       * first colour anybody tries in it.
       */
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "ve-diagram-unink";
      clear.dataset.unink = key;
      clear.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
      clear.title = `Default ${label.toLowerCase()} colour`;
      named(ed, clear, `Default ${label.toLowerCase()} colour`);
      clear.disabled = held === "";
      clear.addEventListener("click", () => restyle(ed, ids, { [key]: null }));

      well.append(caption, input, clear);
      row.append(well);
    }

    return row;
  }

  function borderRow(ed, ids) {
    const row = document.createElement("div");
    row.className = "ve-diagram-row ve-diagram-border";

    const declarations = ids.length === 1 ? styleOf(ed, nodeById(ed, ids[0])) : {};
    const dash = wearing(ed, declarations, DIAGRAM_BORDERS, ["stroke-dasharray"]);
    const weight = wearing(ed, declarations, DIAGRAM_WEIGHTS, ["stroke-width"]);

    const named = (offered) => offered.map(([name]) => [name, name]);

    const border = chooser(ed, "ve-diagram-kind", "Border", named(DIAGRAM_BORDERS), dash);
    const thickness = chooser(ed, "ve-diagram-kind", "Border weight",
      named(DIAGRAM_WEIGHTS), weight);

    // A patch that always names its own key, so choosing "Plain" takes the
    // dash off rather than leaving the old one behind unmentioned.
    const patchFrom = (offered, name, keys) => {
      const found = offered.find(([one]) => one === name);
      const part = found ? found[1] : {};
      return Object.fromEntries(keys.map((key) => [key, part[key] ?? null]));
    };

    border.addEventListener("change", () =>
      restyle(ed, ids, patchFrom(DIAGRAM_BORDERS, border.value, ["stroke-dasharray"])));
    thickness.addEventListener("change", () =>
      restyle(ed, ids, patchFrom(DIAGRAM_WEIGHTS, thickness.value, ["stroke-width"])));

    row.append(border, thickness);
    return row;
  }

  const pictureName = (ed, file) =>
    String(file?.name || "Picture").replace(/\.[^.]+$/, "").trim() || "Picture";

  async function putPicture(ed, file, where) {
    if (!ed.canUpload || !file) {
      return;
    }

    say(ed, "Adding the picture…");

    try {
      const url = await ed.settings.upload(file);
      if (!url) {
        throw new Error("no address");
      }

      if (where && where.id) {
        const item = nodeById(ed, where.id);
        if (!item) {
          return;
        }

        item.image = url;
        write(ed);
        paintLists(ed);
        drawAtOnce(ed);
        paintInspector(ed);
        return;
      }

      addBox(ed, {
        shape: "rect",
        text: pictureName(ed, file),
        image: url,
        frame: where?.frame,
        x: where?.x,
        y: where?.y,
        size: DIAGRAM_IMAGE_BOX
      });
    } catch {
      say(ed, "That picture could not be added.");
    }
  }

  function askForPicture(ed, where) {
    if (!ed.picker) {
      ed.picker = document.createElement("input");
      ed.picker.type = "file";
      ed.picker.accept = "image/*";
      ed.picker.className = "ve-diagram-picker";
      ed.picker.addEventListener("change", () => {
        const file = ed.picker.files?.[0];
        ed.picker.value = "";

        if (ed.picker.dataset.id) {
          void putPicture(ed, file, { id: ed.picker.dataset.id });
          return;
        }

        /* Where it was asked for, carried across the file dialogue. A place
         * chosen before the dialogue opened is still the place it was chosen,
         * however long somebody spends looking for the file — and a picture
         * that lands somewhere else is a picture that has to be dragged.
         */
        const spot = ed.picker.dataset.at
          ? ed.picker.dataset.at.split(",").map(Number)
          : [];

        void putPicture(ed, file, {
          frame: ed.picker.dataset.frame,
          x: spot.length === 2 && spot.every(Number.isFinite) ? spot[0] : undefined,
          y: spot.length === 2 && spot.every(Number.isFinite) ? spot[1] : undefined
        });
      });

      ed.node.append(ed.picker);
    }

    ed.picker.dataset.id = where?.id || "";
    ed.picker.dataset.frame = where?.frame || "";
    ed.picker.dataset.at = Number.isFinite(where?.x) && Number.isFinite(where?.y)
      ? `${where.x},${where.y}`
      : "";
    ed.picker.click();
  }

  function pictureRow(ed, item) {
    const row = document.createElement("div");
    row.className = "ve-diagram-actions";

    const add = document.createElement("button");
    add.type = "button";
    add.className = "ve-diagram-add";
    add.innerHTML = html`<i class="ph ph-image" aria-hidden="true"></i><span>${
      item.image ? "Replace the picture" : "Add a picture"}</span>`;
    add.addEventListener("click", () => askForPicture(ed, { id: item.id }));
    row.append(add);

    if (item.image) {
      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "ve-diagram-add";
      drop.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i><span>Take it off</span>';
      drop.addEventListener("click", () => {
        delete item.image;
        write(ed);
        drawAtOnce(ed);
        paintInspector(ed);
      });

      row.append(drop);
    }

    return row;
  }

  const iconName = (ed, item) =>
    String(item?.icon || "").replace(new RegExp(`^${ICON_SET}:`), "");

  function setIcon(ed, item, name) {
    if (name) {
      item.icon = `${ICON_SET}:${name}`;
    } else {
      delete item.icon;
    }

    write(ed);
    paintLists(ed);
    drawAtOnce(ed);
    paintInspector(ed);
  }

  function iconRow(ed, item) {
    const holder = document.createElement("div");
    holder.className = "ve-diagram-icons";

    const worn = iconName(ed, item);

    const find = document.createElement("input");
    find.type = "search";
    find.className = "ve-diagram-find";
    find.placeholder = "Search icons";
    find.value = ed.iconSearch;
    named(ed, find, "Search icons");

    const grid = document.createElement("div");
    grid.className = "ve-diagram-icon-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Icons");

    const none = document.createElement("div");
    none.className = "ve-diagram-hint";

    const paintIcons = () => {
      grid.replaceChildren();
      const looking = ed.iconSearch.trim().toLowerCase();
      let shown = 0;

      for (const [title, names] of /** @type {[string, string[]][]} */ (DiagramIcons.GROUPS)) {
        const found = looking
          ? names.filter((name) => name.includes(looking))
          : names;

        if (found.length === 0) {
          continue;
        }

        // The groups are kept while nothing is being searched for, so the
        // storage ones are together rather than scattered through an
        // alphabet. Searching is already a grouping, so it takes over.
        if (!looking) {
          const legend = document.createElement("div");
          legend.className = "ve-diagram-legend ve-diagram-icon-legend";
          legend.textContent = title;
          grid.append(legend);
        }

        for (const name of found) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `ve-diagram-icon-one${name === worn ? " is-on" : ""}`;
          button.title = name.replace(/-/g, " ");
          button.setAttribute("aria-label", button.title);
          button.setAttribute("aria-pressed", name === worn ? "true" : "false");
          // bodyOf is a lookup in the icon table in js/diagram-icons.js:
          // markup this app ships, and "" for a name that is not in it.
          button.innerHTML = html`<svg viewBox="0 0 24 24" width="18" height="18"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true">${trusted(DiagramIcons.bodyOf(name))}</svg>`;
          // Wearing it already, pressing it takes it off — which is the only
          // way a grid of switches can also be a way to say "none of these".
          button.addEventListener("click", () =>
            setIcon(ed, item, name === worn ? "" : name));
          grid.append(button);
          shown += 1;
        }
      }

      none.textContent = shown === 0 ? `No icon is called "${ed.iconSearch.trim()}".` : "";
      none.hidden = shown > 0;
    };

    find.addEventListener("input", () => {
      ed.iconSearch = find.value;
      paintIcons();
    });

    paintIcons();
    holder.append(find, grid, none);
    return holder;
  }

  function showSizes(ed) {
    for (const [field, read] of [...ed.sizeFields]) {
    // A field belonging to a panel that has since been repainted away.
      if (!field.isConnected) {
        ed.sizeFields.delete(field);
        continue;
      }

      if (document.activeElement !== field) {
        field.value = read();
      }
    }
  }

  function sizeField(ed, offered) {
    const bounds = offered.bounds;
    const field = document.createElement("input");
    field.type = "number";
    field.className = "ve-diagram-size";
    field.min = String(bounds.least);
    field.max = String(bounds.most);
    field.step = "1";
    field.placeholder = String(DiagramModel.TEXT_SIZE);
    field.title = offered.label;
    named(ed, field, offered.label);
    field.value = offered.read();
    field.disabled = Boolean(offered.disabled);

    /* Held to the bounds and written back, so the field shows the size the
     * diagram actually has rather than the one that was typed at it. A field
     * left saying 400 over a box drawn at 96 is a field that is lying.
     */
    field.addEventListener("change", () => {
      const typed = field.value.trim();
      const size = Math.round(Number(typed));

      if (typed === "" || !Number.isFinite(size)) {
        field.value = "";
        offered.onSize(null);
        return;
      }

      const held = Math.min(bounds.most, Math.max(bounds.least, size));
      field.value = String(held);
      offered.onSize(held);
    });

    ed.sizeFields.set(field, offered.read);
    return field;
  }

  function sizeShown(ed, ids) {
    const sizes = new Set(ids.map((id) => fontSizeOf(ed, nodeById(ed, id))));
    const found = sizes.size === 1 ? /^([0-9.]+)px$/.exec([...sizes][0]) : null;
    return found ? String(parseFloat(found[1])) : "";
  }

  function nodeSizeField(ed, ids) {
    return sizeField(ed, {
      label: "Text size",
      bounds: DiagramModel.FONT_SIZE,
      read: () => sizeShown(ed, ids),
      onSize: (size) => restyle(ed, ids, { "font-size": size === null ? null : `${size}px` },
        { keepPanel: true, fit: true })
    });
  }

  function markButtons(ed, ids, declarations, label) {
    const marks = document.createElement("div");
    marks.className = "ve-diagram-marks";
    marks.setAttribute("role", "group");
    marks.setAttribute("aria-label", label || "Text style");

    for (const [name, key, value, icon] of DIAGRAM_MARKS) {
      const on = declarations[key] === value;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ve-diagram-mark${on ? " is-on" : ""}`;
      button.title = name;
      button.setAttribute("aria-label", name);
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.innerHTML = html`<i class="ph ${icon}" aria-hidden="true"></i>`;
      button.addEventListener("click", () => restyle(ed, ids, { [key]: on ? null : value }));
      marks.append(button);
    }

    return marks;
  }

  function fontRow(ed, ids) {
    const holder = document.createElement("div");
    holder.className = "ve-diagram-font";

    const declarations = ids.length === 1 ? styleOf(ed, nodeById(ed, ids[0])) : {};
    const listed = (offered) => offered.map(([name]) => [name, name]);

    const family = chooser(ed, "ve-diagram-kind", "Font",
      listed(DIAGRAM_FAMILIES), wearing(ed, declarations, DIAGRAM_FAMILIES, ["font-family"]));

    // A patch that always names its own key, so choosing "Default" takes the
    // family off rather than leaving the old one behind unmentioned.
    const patchFrom = (offered, name, keys) => {
      const found = offered.find(([one]) => one === name);
      const part = found ? found[1] : {};
      return Object.fromEntries(keys.map((key) => [key, part[key] ?? null]));
    };

    family.addEventListener("change", () =>
      restyle(ed, ids, patchFrom(DIAGRAM_FAMILIES, family.value, ["font-family"])));

    const menus = document.createElement("div");
    menus.className = "ve-diagram-row ve-diagram-border";
    menus.append(family, nodeSizeField(ed, ids));

    holder.append(menus, markButtons(ed, ids, declarations));
    return holder;
  }

  const CELL_LETTERS = (ed, token) => String(token || "").replace(/\d/g, "");

  const CELL_DIGITS = (ed, token) => String(token || "").replace(/\D/g, "");

  function cellFontRow(ed, item) {
    const holder = document.createElement("div");
    holder.className = "ve-diagram-font";

    const where = document.createElement("p");
    where.className = "ve-diagram-aimed";

    const listed = (offered) => offered.map(([name]) => [name, name]);
    const family = chooser(ed, "ve-diagram-kind", "Cell font", listed(CELL_FAMILIES),
      CELL_FAMILIES[0][0]);

    const marks = document.createElement("div");
    marks.className = "ve-diagram-marks";
    marks.setAttribute("role", "group");
    marks.setAttribute("aria-label", "Cell text style");

    const keyNow = () => ed.cellFocus
      ? DiagramModel.cellKey(ed.cellFocus.row, ed.cellFocus.column) : "";
    const tokenNow = () => (item.cells || {})[keyNow()] || "";

    /* One way in, so a cell with nothing on it has no entry rather than an
     * empty one, and a table with nothing on any cell has no `cells` at all.
     * The file then says what was chosen and stays silent about the rest.
     */
    const change = (make) => {
      if (!ed.cellFocus) {
        return;
      }

      const token = make(tokenNow());
      const cells = { ...(item.cells || {}) };
      if (token) {
        cells[keyNow()] = token;
      } else {
        delete cells[keyNow()];
      }

      if (Object.keys(cells).length > 0) {
        item.cells = cells;
      } else {
        delete item.cells;
      }

      write(ed);
      drawAtOnce(ed);
      show();
    };

    /* The same number field the box's own type uses, held to what one cell of
     * a table is allowed to say: a size lives in the file as two digits on
     * the end of the cell's token, so 48 is as large as a cell can be set.
     */
    const size = sizeField(ed, {
      label: "Cell text size",
      bounds: DiagramModel.CELL_SIZE,
      read: () => CELL_DIGITS(ed, tokenNow()),
      disabled: !ed.cellFocus,
      onSize: (chosen) => change((token) => DiagramModel.cellToken(
        CELL_LETTERS(ed, token).split(""), chosen === null ? "" : String(chosen)))
    });

    const menus = document.createElement("div");
    menus.className = "ve-diagram-row ve-diagram-border";
    menus.append(family, size);

    // A cell is set in one family, so choosing one takes the other two off.
    family.addEventListener("change", () => change((token) => {
      const chosen = (CELL_FAMILIES.find(([name]) => name === family.value) || [])[1] || "";
      const kept = CELL_LETTERS(ed, token).split("")
        .filter((one) => !CELL_FAMILIES.some(([, letter]) => letter === one));

      return DiagramModel.cellToken([...kept, chosen], CELL_DIGITS(ed, token));
    }));

    const buttons = CELL_MARK_BUTTONS.map(([label, letter, icon]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ve-diagram-mark";
      button.title = label;
      button.setAttribute("aria-label", `${label} cell`);
      button.innerHTML = html`<i class="ph ${icon}" aria-hidden="true"></i>`;

      button.addEventListener("click", () => change((token) => {
        const letters = CELL_LETTERS(ed, token).split("");
        const kept = letters.filter((one) => one !== letter);

        return DiagramModel.cellToken(
          letters.includes(letter) ? kept : [...kept, letter],
          CELL_DIGITS(ed, token));
      }));

      marks.append(button);
      return /** @type {[HTMLButtonElement, string]} */ ([button, letter]);
    });

    const show = () => {
      const token = tokenNow();
      const letters = CELL_LETTERS(ed, token);
      const aimed = Boolean(ed.cellFocus);

      where.textContent = aimed
        ? (ed.cellFocus.row === 0 ? "The title."
          : `Row ${ed.cellFocus.row}, column ${ed.cellFocus.column + 1}.`)
        : "Click into a cell above to set how it is written.";

      family.disabled = !aimed;
      size.disabled = !aimed;
      family.value = (CELL_FAMILIES.find(([, letter]) =>
        letter && letters.includes(letter)) || CELL_FAMILIES[0])[0];
      size.value = CELL_DIGITS(ed, token);
      // What the cell is if it says nothing: whatever the table around it is
      // set in, which is the standard unless the table said otherwise.
      size.placeholder = String(parseFloat(fontSizeOf(ed, item)) || DiagramModel.TEXT_SIZE);

      for (const [button, letter] of buttons) {
        const on = aimed && letters.includes(letter);
        button.disabled = !aimed;
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-pressed", on ? "true" : "false");
      }
    };

    ed.showCellFont = show;
    show();

    holder.append(menus, marks, where);
    return holder;
  }

  function darken(ed, hex, amount) {
    const found = /^#([0-9a-f]{6})$/i.exec(String(hex));
    if (!found) {
      return hex;
    }

    const whole = parseInt(found[1], 16);
    const parts = [(whole >> 16) & 255, (whole >> 8) & 255, whole & 255]
      .map((one) => Math.round(one * (1 - amount)));

    return `#${parts.map((one) => one.toString(16).padStart(2, "0")).join("")}`;
  }

  function hudFor(ed, ids) {
    const bar = document.createElement("div");
    bar.className = "ve-diagram-hud";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "How this box is drawn");

    const item = ids.length === 1 ? nodeById(ed, ids[0]) : null;

    // A shape menu over four boxes would have to say what four shapes are, so
    // it is offered for one box and the rest of the bar for any number. Words
    // on the paper have no shape to offer, and a menu of nine of them over a
    // thing whose whole point is not being any of them is a menu that lies.
    if (item && item.kind !== "text") {
      bar.append(shapeSelect(ed, item));
    }

    bar.append(colourRow(ed, ids), nodeSizeField(ed, ids),
      markButtons(ed, ids, item ? styleOf(ed, item) : {}));

    const drop = dropButton(ed, item
      ? `Remove ${stepLabel(ed, item)}`
      : `Remove these ${ids.length} boxes`);
    drop.addEventListener("click", () => removeSteps(ed, ids));
    bar.append(drop);

    return bar;
  }

  function paintHud(ed) {
    ed.hud?.remove();
    ed.hud = null;

    /* Only where there is a window to float it over — in a document the
     * diagram is drawn at its own size inside the page, and a bar laid over
     * that would be laid over the words around it too — and only if it has
     * not been put away.
     */
    if (!ed.viewport || ed.panels.barShut || ed.selection.length === 0) {
      return;
    }

    /* Beside the paper rather than on it.
     *
     * A redraw is `canvas.innerHTML = …`, which throws away everything inside
     * it — so a bar living in there has to be taken out and put back on every
     * redraw, and an element taken out of the page loses the caret. A size
     * being typed into would be blurred by the very change it was making.
     * The stage holds the paper and nothing else moves it, so the bar sits
     * there and the two coordinate systems still line up.
     *
     * It is also why a press on the bar is not a press on the paper: they are
     * no longer the same tree.
     */
    ed.hud = hudFor(ed, [...ed.selection]);
    ed.stage.append(ed.hud);
    placeHud(ed);
  }

  function placeHud(ed) {
    if (!ed.hud) {
      return;
    }

    /* Whether there is a bar at all is paintHud's to say; this only says
     * where it goes. Two places deciding one thing is one place too many, and
     * the second of them was never reached: a box that stops existing takes
     * the selection with it, and that is a repaint.
     */
    const boxes = ed.selection.map((id) => boxOf(ed, id)).filter(Boolean);
    if (boxes.length === 0) {
      return;
    }

    const left = Math.min(...boxes.map((at) => at.x));
    const right = Math.max(...boxes.map((at) => at.x + at.w));
    const top = Math.min(...boxes.map((at) => at.y));
    const under = Math.max(...boxes.map((at) => at.y + at.h));

    const middle = (((left + right) / 2) * ed.view.scale) + ed.view.x;
    const over = ((top * ed.view.scale) + ed.view.y) - HUD_GAP;
    const below = ((under * ed.view.scale) + ed.view.y) + HUD_GAP;

    /* Above the box, and underneath it when the box is against the top of the
     * window: a bar drawn off the top of the paper is a bar nobody can reach.
     * Held inside the window sideways for the same reason.
     */
    const wide = ed.hud.offsetWidth;
    const tall = ed.hud.offsetHeight;
    const y = over - tall >= 0 ? over - tall : below;
    const x = Math.max(0, Math.min(Math.max(0, ed.canvas.clientWidth - wide),
      middle - (wide / 2)));

    ed.hud.style.left = `${Math.round(x)}px`;
    ed.hud.style.top = `${Math.round(y)}px`;
  }

  function paintForSelection(ed, options) {
    /* A handful has no one name or shape to show, but it has a colour: the
     * reason to hold four boxes at once is usually to do one thing to all
     * four of them, and this is that thing.
     */
    if (ed.selection.length > 1) {
      const held = groupHeld(ed);
      const groupField = held ? groupNameField(ed, held) : null;

      say(ed, held
        ? `${DiagramDraw.groupName(held)} held. Drag its name to move it about.`
        : `${ed.selection.length} boxes held. Colour them, or drag them about.`);
      ed.inspector.append(heading(ed, held ? "Group" : `${ed.selection.length} boxes`));

      if (groupField) {
        ed.inspector.append(captioned(ed, "Name", groupField));
      }

      ed.inspector.append(
        captioned(ed, "Fill", colourRow(ed, [...ed.selection])),
        captioned(ed, "Colours", inkRow(ed, [...ed.selection])),
        captioned(ed, "Border", borderRow(ed, [...ed.selection])),
        captioned(ed, "Font", fontRow(ed, [...ed.selection]))
      );

      if (options.focusName && groupField) {
        groupField.focus();
        groupField.select();
      }

      return;
    }

    say(ed, ed.model.nodes.length === 0
      ? "Drag a shape onto the paper to start."
      : "Tap a box to work on it, or drag one to move it.");
    return;
  }

  function inspectorActions(ed, item, words) {
    const drop = dropButton(ed, `Remove ${stepLabel(ed, item)}`);
    drop.addEventListener("click", () => removeStep(ed, item.id));

    const actions = document.createElement("div");
    actions.className = "ve-diagram-actions";

    const step = document.createElement("button");
    step.type = "button";
    step.className = "ve-diagram-add";
    step.innerHTML = '<i class="ph ph-plus" aria-hidden="true"></i><span>Step after this</span>';
    step.disabled = ed.model.nodes.length >= DiagramModel.MAX_NODES;
    step.addEventListener("click", () => addBox(ed, { joinFrom: item.id }));

    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = `ve-diagram-add ve-diagram-connect${ed.armedFrom ? " is-armed" : ""}`;
    connect.innerHTML = '<i class="ph ph-arrow-right" aria-hidden="true"></i><span>Arrow to…</span>';
    connect.disabled = ed.model.nodes.length < 2 || ed.model.edges.length >= DiagramModel.MAX_EDGES;
    connect.addEventListener("click", () => {
      ed.armedFrom = ed.armedFrom ? null : item.id;
      paintInspector(ed);
    });

    actions.append(step, connect);

    /* The way back out of being words.
     *
     * Turning a box's frame off is a choice on its shape menu, and words have
     * no shape menu — so without this the choice only goes one way, and a box
     * turned into words by accident is words for good. It is one button
     * rather than a menu because there is only one thing on the other side of
     * it: whatever shape it had before, drawn again.
     */
    if (words) {
      const framed = document.createElement("button");
      framed.type = "button";
      framed.className = "ve-diagram-add";
      framed.innerHTML = '<i class="ph ph-square" aria-hidden="true"></i>'
      + "<span>Put a box round it</span>";
      framed.addEventListener("click", () => {
        delete item.kind;
        delete item.frame;
        grow(ed, item);
        commit(ed);
        paintInspector(ed);
        paintLists(ed);
      });

      actions.append(framed);
    }
    return { drop, actions };
  }

  function appendLooks(ed, item, words, actions) {
    if (words) {
      ed.inspector.append(
        captioned(ed, "Font", fontRow(ed, [item.id])),
        captioned(ed, "Colours", inkRow(ed, [item.id])),
        actions
      );
      return;
    }

    ed.inspector.append(
      captioned(ed, "Shape", shapeSelect(ed, item)),
      captioned(ed, "Fill", colourRow(ed, [item.id])),
      captioned(ed, "Colours", inkRow(ed, [item.id])),
      captioned(ed, "Border", borderRow(ed, [item.id])),
      captioned(ed, "Font", fontRow(ed, [item.id]))
    );

    if (ed.canUpload) {
      ed.inspector.append(captioned(ed, "Picture", pictureRow(ed, item)));
    }

    ed.inspector.append(captioned(ed, "Icon", iconRow(ed, item)), actions);
  }

  function appendArrows(ed, out) {
    if (out.length === 0) {
      return;
    }

    const legend = document.createElement("div");
    legend.className = "ve-diagram-legend";
    legend.textContent = out.length === 1 ? "Its arrow" : "Its arrows";

    const rows = document.createElement("div");
    rows.className = "ve-diagram-rows";
    rows.append(...out.map((edge) => arrowRow(ed, edge)));
    ed.inspector.append(legend, rows);
  }

  function paintInspector(ed, options = {}) {
    paintHud(ed);
    ed.inspector.replaceChildren();
    // The cell fields the type controls aimed at are about to be thrown away,
    // so the aim goes with them rather than outliving them.
    ed.cellFocus = null;
    ed.showCellFont = () => {};
    const item = selectedNode(ed);

    if (!item) {
      paintForSelection(ed, options);
      return;
    }

    // An editor whose way into a box is a gesture nobody mentions is an editor
    // where boxes cannot be renamed, whatever the code does.
    say(ed, ed.armedFrom
      ? "Now tap the step this one should point at."
      : "Double-click a box, or press Enter, to type into it.");

    /* A box is a label, and a table is a grid of cells. Both are the words
     * the thing on the paper says, so both go in the same place under the
     * same caption — it is only that one of them has a shape.
     */
    const table = item.kind === "table";
    /* And words on the paper are only the words. A text element is not a box
     * with its box turned off any more — it is its own thing — so the panel
     * for one is not the panel for a box with the shape menu greyed out. It
     * is the questions that have an answer for words: what they say, what
     * type they are set in, and their two colours. A shape, a border, a
     * picture and an icon are all questions about a box, and asking them of
     * something that has not got one is what made this panel confusing.
     */
    const words = item.kind === "text";
    const cells = table ? cellGrid(ed, item) : null;
    const name = /** @type {HTMLInputElement} */ (table
      ? cells.querySelector(".ve-diagram-cell-title")
      : labelField(ed, item));

    const { drop, actions } = inspectorActions(ed, item, words);

    /* One thing per line, each with its name over it. Three controls crammed
     * across a column narrower than any of them wanted is what made this
     * panel look assembled rather than designed.
     */
    const what = words ? "Text" : (table ? "Table" : "Box");
    ed.inspector.append(
      heading(ed, what, drop),
      captioned(ed, table ? "Cells" : (words ? "Words" : "Label"), table ? cells : name)
    );

    if (table) {
      ed.inspector.append(tableSize(ed, item), tableSpacing(ed, item),
        captioned(ed, "Cell text", cellFontRow(ed, item)));
    }

    appendLooks(ed, item, words, actions);
    appendArrows(ed, ed.model.edges.filter((edge) => edge.from === item.id));

    /* A group of one is not something this editor makes — grouping needs two
     * boxes to be a group of — but it is something a file can say, and a name
     * you cannot change is a name you cannot correct.
     */
    const alone = groupHeld(ed);
    if (alone) {
      ed.inspector.append(captioned(ed, "Group name", groupNameField(ed, alone)));
    }

    if (options.focusName) {
      name.focus();
      name.select?.();
    }
  }

  const flowControl = (ed) => {
    const flow = document.createElement("select");
    flow.className = "ve-diagram-kind ve-diagram-direction";
    named(ed, flow, "Diagram direction");

    // TB and TD mean the same thing to Mermaid and only one of them is on the
    // menu, so a diagram written with the other keeps it rather than being
    // silently rewritten by the act of opening this.
    const flows = DIAGRAM_FLOWS.some(([value]) => value === ed.model.direction)
      ? DIAGRAM_FLOWS
      : [[ed.model.direction, ed.model.direction], ...DIAGRAM_FLOWS];

    for (const [value, name] of flows) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = name;
      flow.appendChild(option);
    }

    flow.value = ed.model.direction;
    flow.addEventListener("change", () => {
      ed.model.direction = flow.value;
      commit(ed);
    });

    return flow;
  };

  const renameEverywhere = (ed, id, label) => {
    for (const option of ed.node.querySelectorAll("option")) {
      if (option.value === id) {
        option.textContent = label;
      }
    }
  };

  const parentOnPaper = (ed, item) => {
    const known = groupsNow(ed).some((group) => group.id === item.parent);
    return known ? item.parent : null;
  };

  function glyphFor(ed, item) {
    const wanted = (choice) => {
      if (item.image) {
        return Boolean(choice.picture);
      }

      if (item.icon) {
        return Boolean(choice.icon);
      }

      return !choice.icon && !choice.picture
      && choice.kind === (item.kind || "box") && choice.shape === item.shape;
    };

    return (DIAGRAM_PALETTE.find(wanted) || DIAGRAM_PALETTE[0]).glyph;
  }

  const leafName = (ed, words) => {
    const name = document.createElement("span");
    name.className = "ve-diagram-leaf-name";
    name.textContent = words;
    return name;
  };

  function leafRow(ed, item, depth) {
    const row = document.createElement("div");
    row.className = "ve-diagram-leaf";
    row.dataset.nodeId = item.id;
    row.style.setProperty("--dd-depth", String(depth));

    const glyph = document.createElement("span");
    glyph.className = "ve-diagram-leaf-glyph";
    // As above: one of this file's own SVG paths, wrapped.
    // eslint-disable-next-line no-unsanitized/property
    glyph.innerHTML = shapeGlyph(glyphFor(ed, item));

    row.append(glyph, leafName(ed, stepLabel(ed, item)));

    /* The tree names the box itself, so it holds the box itself — no descent
     * needed, because the row already said which one it meant. Standing
     * inside whatever group it is in, or the next press on the paper would
     * jump straight back out to the group.
     */
    row.addEventListener("click", () => {
      ed.inside = parentOnPaper(ed, item);
      select(ed, item.id);
    });

    // And the second press does here what it does on the paper.
    row.addEventListener("dblclick", () => openText(ed, item.id));
    return row;
  }

  function renameHere(ed, group, name) {
    const was = DiagramDraw.groupName(group);
    const field = document.createElement("input");
    field.type = "text";
    field.className = "ve-diagram-leaf-field";
    field.value = was;
    named(ed, field, "Group name");

    let done = false;
    const finish = (keep) => {
      if (done) {
        return;
      }

      done = true;
      renameGroup(ed, group, keep ? field.value : was);
      paintLists(ed);
    };

    field.addEventListener("blur", () => finish(true));
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }

      if (event.key === "Escape") {
        event.stopPropagation();
        finish(false);
      }
    });

    name.replaceWith(field);
    field.focus();
    field.select();
  }

  function branchRow(ed, group, depth) {
    const name = DiagramDraw.groupName(group) || group.id;
    const folded = ed.shutGroups.has(group.id);

    const row = document.createElement("div");
    row.className = "ve-diagram-leaf ve-diagram-branch";
    row.dataset.groupId = group.id;
    row.style.setProperty("--dd-depth", String(depth));
    row.classList.toggle("is-locked", Boolean(group.lock));

    const twist = document.createElement("button");
    twist.type = "button";
    twist.className = "ve-diagram-twist";
    twist.setAttribute("aria-expanded", String(!folded));
    named(ed, twist, `${folded ? "Show" : "Hide"} what is in ${name}`);
    twist.innerHTML = html`<i class="ph ${folded ? "ph-caret-right" : "ph-caret-down"}"
    aria-hidden="true"></i>`;
    twist.addEventListener("click", () => {
      if (folded) {
        ed.shutGroups.delete(group.id);
      } else {
        ed.shutGroups.add(group.id);
      }

      paintLists(ed);
    });

    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "ve-diagram-lock";
    lock.setAttribute("aria-pressed", String(Boolean(group.lock)));
    named(ed, lock, group.lock ? `Unlock ${name}` : `Lock ${name}`);
    lock.innerHTML = html`<i class="ph ${group.lock ? "ph-lock-simple" : "ph-lock-simple-open"}"
    aria-hidden="true"></i>`;
    lock.addEventListener("click", () => {
      if (group.lock) {
        delete group.lock;
      } else {
        group.lock = true;
      }

      write(ed);
      paintLists(ed);
    });

    const words = leafName(ed, name);
    words.addEventListener("dblclick", () => renameHere(ed, group, words));

    row.append(twist, words, lock);
    row.addEventListener("click", (event) => {
      if (!/** @type {Element} */ (event.target).closest("button, input")) {
        holdGroup(ed, group.id);
      }
    });

    return row;
  }

  function holdGroup(ed, id) {
    ed.inside = groupById(ed, id)?.parent || null;
    choose(ed, groupMembers(ed, id));
  }

  function treeRows(ed) {
    const rows = [];
    const placed = new Set();
    const walked = new Set();

    /* A folded group is still walked, so that what is in it counts as reached
     * — it is out of sight, not lost. Only what the walk never gets to at all
     * is left over.
     */
    const walk = (parent, depth, show) => {
      for (const item of ed.model.nodes) {
        if (parentOnPaper(ed, item) === parent) {
          placed.add(item.id);

          if (show) {
            rows.push(leafRow(ed, item, depth));
          }
        }
      }

      for (const group of groupsNow(ed)) {
      // A group that is its own ancestor has no place in the tree. It is
      // still in the file, and the walk simply stops rather than running
      // round the ring forever.
        if (parentOnPaper(ed, group) !== parent || walked.has(group.id)) {
          continue;
        }

        walked.add(group.id);

        if (show) {
          rows.push(branchRow(ed, group, depth));
        }

        walk(group.id, depth + 1, show && !ed.shutGroups.has(group.id));
      }
    };

    walk(null, 0, true);

    // Anything the walk could not reach is still on the paper, so it is still
    // in the list — at the top, where it can be got at and put right.
    for (const item of ed.model.nodes) {
      if (!placed.has(item.id)) {
        rows.push(leafRow(ed, item, 0));
      }
    }

    return rows;
  }

  function markTree(ed) {
    if (!ed.listed) {
      return;
    }

    const held = groupHeld(ed);

    for (const row of /** @type {NodeListOf<HTMLElement>} */ (ed.treeBody.querySelectorAll(".ve-diagram-leaf"))) {
      row.classList.toggle("is-picked", row.dataset.groupId
        ? row.dataset.groupId === held?.id
        : isSelected(ed, row.dataset.nodeId));
    }
  }

  function paintLists(ed) {
    ed.treeBody.replaceChildren(...treeRows(ed));
    ed.edgeRows.replaceChildren(...ed.model.edges.map((edge) => arrowRow(ed, edge)));
    ed.addArrow.disabled = ed.model.nodes.length < 2 || ed.model.edges.length >= DiagramModel.MAX_EDGES;
    ed.listed = true;
    markTree(ed);
  }

  const group = (ed, ...items) => {
    const holder = document.createElement("div");
    holder.className = "ve-diagram-group";
    holder.append(...items);
    return holder;
  };

  function showZoom(ed) {
    if (ed.zoomField && document.activeElement !== ed.zoomField) {
      ed.zoomField.value = `${Math.round(ed.view.scale * 100)}%`;
    }
  }

  const saveAs = (ed, label, run) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ve-diagram-export";
    button.textContent = label;
    button.title = `Save a ${label} picture of this diagram`;
    button.setAttribute("aria-label", `Save as ${label}`);
    button.addEventListener("click", () => {
      button.disabled = true;
      Promise.resolve(run()).catch(() => {}).then(() => {
        button.disabled = false;
      });
    });

    return button;
  };

  const inBounds = (ed, which, value) => Math.min(ed.PANELS[which].most,
    Math.max(ed.PANELS[which].least, Math.round(Number(value) || 0)));

  function showPanels(ed) {
    ed.body.style.setProperty("--dd-rail", `${ed.panels.rail}px`);
    ed.body.style.setProperty("--dd-side", `${ed.panels.side}px`);
    ed.body.classList.toggle("is-rail-shut", ed.panels.railShut);
    ed.body.classList.toggle("is-side-shut", ed.panels.sideShut);
    // A rail too narrow for the words is a rail of pictures, which is what
    // the phone already does with it — one rule, reached two ways.
    ed.body.classList.toggle("is-rail-tight", ed.panels.rail < 108);
  }

  function rememberPanels(ed) {
    try {
      window.localStorage?.setItem(PANEL_STORE, JSON.stringify(ed.panels));
    } catch {
    // Somewhere that will not keep it. The panels still work.
    }
  }

  function panelGrip(ed, which, side) {
    const grip = document.createElement("div");
    grip.className = `ve-diagram-grip ve-diagram-grip-${which}`;
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-orientation", "vertical");
    grip.tabIndex = 0;

    const shutKey = `${which}Shut`;
    const what = which === "rail" ? "the shapes" : "the panel";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ve-diagram-grip-shut";
    button.innerHTML = '<i class="ph ph-caret-left" aria-hidden="true"></i>';

    const showGrip = () => {
      const shut = ed.panels[shutKey];
      grip.setAttribute("aria-valuenow", String(ed.panels[which]));
      grip.setAttribute("aria-label", `How much room ${what} has`);
      button.setAttribute("aria-expanded", shut ? "false" : "true");
      button.title = shut ? `Show ${what}` : `Hide ${what}`;
      button.setAttribute("aria-label", button.title);
      // The chevron points the way pressing it moves the edge.
      const away = which === "rail" ? shut : !shut;
      /** @type {HTMLElement} */ (button.firstChild).className = `ph ph-caret-${away ? "right" : "left"}`;
    };

    button.addEventListener("click", () => {
      ed.panels[shutKey] = !ed.panels[shutKey];
      showPanels(ed);
      showGrip();
      rememberPanels(ed);
    });

    const widen = (to) => {
      ed.panels[which] = inBounds(ed, which, to);
      ed.panels[shutKey] = false;
      showPanels(ed);
      showGrip();
    };

    let dragging = null;
    grip.addEventListener("pointerdown", (event) => {
      if (/** @type {Element} */ (event.target).closest(".ve-diagram-grip-shut")) {
        return;
      }

      dragging = { x: event.clientX, from: ed.panels[which] };
      grip.setPointerCapture?.(event.pointerId);
      grip.classList.add("is-dragging");
      event.preventDefault();
    });

    grip.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }

      // The rail's edge is on its right and the panel's on its left, so the
      // same drag widens one and narrows the other.
      widen(dragging.from + ((event.clientX - dragging.x) * side));
    });

    const letGo = (event) => {
      if (!dragging) {
        return;
      }

      dragging = null;
      grip.classList.remove("is-dragging");
      grip.releasePointerCapture?.(event.pointerId);
      rememberPanels(ed);
    };

    grip.addEventListener("pointerup", letGo);
    grip.addEventListener("pointercancel", letGo);

    grip.addEventListener("keydown", (event) => {
      const step = { ArrowLeft: -20, ArrowRight: 20 }[event.key];
      if (step === undefined) {
        return;
      }

      event.preventDefault();
      widen(ed.panels[which] + (step * side));
      rememberPanels(ed);
    });

    grip.append(button);
    showGrip();
    return grip;
  }

  /* One editor's state, made.
   *
   * This is `ed` before anything has been drawn or bound: the diagram as it
   * was read, an empty selection, a view at 1:1, and the two elements the
   * diagram is drawn into. Nothing here is on the page yet, and a source that
   * will not open is the one thing that stops a mount before it starts.
   */
  function startEditor(host, options) {
    const ed = {};
    ed.settings = options || {};
    ed.opened = canOpen(ed.settings.source);

    if (!ed.opened) {
      return null;
    }

    ed.onChange = typeof ed.settings.onChange === "function" ? ed.settings.onChange : () => {};
    ed.carried = { ...ed.opened };
    delete ed.carried.ok;

    ed.model = {
      ...ed.carried,
      // A diagram that has never been arranged is arranged on the way in, so
      // there is something to drag. Nothing is written to the file until
      // something is actually changed.
      layout: DiagramModel.ensureLayout(ed.opened)
    };

    ed.node = host;
    ed.node.innerHTML = "";
    ed.selection = [];
    ed.selectedId = null;
    ed.armedFrom = null;
    ed.viewport = Boolean(ed.settings.viewport);
    ed.view = { x: 0, y: 0, scale: 1 };
    ed.fitted = false;
    ed.stage = document.createElement("div");
    ed.stage.className = "ve-diagram-stage";
    ed.canvas = document.createElement("div");
    ed.canvas.className = "ve-diagram-canvas";
    ed.canvas.tabIndex = 0;
    ed.canvas.setAttribute("role", "application");
    ed.canvas.setAttribute("aria-label", "Diagram canvas");
    ed.stage.append(ed.canvas);
    ed.drawTimer = 0;
    ed.history = { past: [], future: [], present: "" };
    ed.historyTimer = 0;
    ed.gesture = null;
    ed.frame = 0;
    ed.latest = null;
    ed.marquee = null;
    ed.panning = null;
    ed.spaceHeld = false;
    ed.handTool = false;
    ed.handButton = null;
    ed.arrowTool = false;
    ed.arrowButton = null;
    ed.placing = null;
    ed.placeButtons = new Map();

    return ed;
  }

  /* What the canvas listens to: the pointer, the wheel, two fingers, and the
   * keys that do something when the canvas has focus.
   */
  function bindCanvas(ed) {
    ed.canvas.addEventListener("pointerdown", (event) => onCanvasPress(ed, event));

    ed.canvas.addEventListener("pointermove", (event) => onCanvasMove(ed, event));

    ed.canvas.addEventListener("dragover", (event) => onCanvasDragOver(ed, event));

    ed.canvas.addEventListener("dragleave", () => ed.canvas.classList.remove("is-dropping"));

    ed.canvas.addEventListener("drop", (event) => onCanvasDrop(ed, event));

    ed.canvas.addEventListener("pointerup", (event) => endGesture(ed, event));
    ed.canvas.addEventListener("pointerup", (event) => liftPress(ed, event));

    ed.canvas.addEventListener("pointercancel", (event) => onCanvasCancel(ed, event));

    ed.menu = null;

    ed.canvas.addEventListener("contextmenu", (event) => onCanvasMenu(ed, event));

    ed.pressTimer = 0;

    ed.canvas.addEventListener("pointerdown", (event) => onPressStart(ed, event));

    ed.canvas.addEventListener("pointermove", (event) => onPressMove(ed, event));

    ed.canvas.addEventListener("pointerup", () => forgetPress(ed));
    ed.canvas.addEventListener("pointercancel", () => forgetPress(ed));
    ed.editing = null;
    ed.lastTap = null;
    ed.tapping = null;

    bindWheel(ed);

    ed.touches = new Map();
    ed.pinch = null;

    bindTouch(ed);

    ed.COMMAND_KEYS = [
      ["c", (event) => ed.selection.length > 0 && !event.shiftKey, () => copySelection(ed)],
      ["x", (event) => ed.selection.length > 0 && !event.shiftKey, () => cutSelection(ed)],
      ["v", () => true, () => pasteClipboard(ed)],
      ["d", () => ed.selection.length > 0, () => duplicateSelection(ed)],
      ["g", (event) => event.shiftKey, () => ungroupSelection(ed)],
      ["g", () => ed.selection.length > 1, () => groupSelection(ed)],
      ["z", (event) => !event.shiftKey, () => undo(ed)],
      ["z", (event) => event.shiftKey, () => redo(ed)],
      ["y", () => true, () => redo(ed)],
      // The one keystroke that does not need anything selected already.
      ["a", () => true, () => choose(ed, ed.model.nodes.map((item) => item.id))]
    ];
  }

  /* The rail down the left and the panel down the right: the shapes to drag
   * on, the tidy button, the tree of what is on the paper, and the list of
   * every arrow. Built here, filled in later by paintLists and
   * paintInspector.
   */
  function buildRail(ed) {
    ed.inside = null;
    ed.listed = false;
    ed.palette = document.createElement("div");
    ed.palette.className = "ve-diagram-palette";

    buildPalette(ed);

    ed.tidy = document.createElement("button");
    ed.tidy.type = "button";
    ed.tidy.className = "ve-diagram-tidy";
    ed.tidy.innerHTML = '<i class="ph ph-tree-structure" aria-hidden="true"></i><span>Tidy</span>';
    ed.tidy.title = "Arrange every box again, following the flow direction";

    ed.tidy.addEventListener("click", () => {
      ed.model.layout = DiagramModel.autoLayout(ed.model);
      write(ed);
      paintLists(ed);
      drawAtOnce(ed);
    });

    ed.sheetAsked = null;
    ed.hint = document.createElement("p");
    ed.hint.className = "ve-diagram-hint";
    ed.inspector = document.createElement("div");
    ed.inspector.className = "ve-diagram-inspector";
    ed.cellFocus = null;
    ed.showCellFont = () => {};
    ed.canUpload = typeof ed.settings.upload === "function";
    ed.picker = null;
    ed.iconSearch = "";
    ed.sizeFields = new Map();
    ed.hud = null;
    ed.tree = document.createElement("div");
    ed.tree.className = "ve-diagram-tree";
    ed.treeLegend = document.createElement("div");
    ed.treeLegend.className = "ve-diagram-legend";
    ed.treeLegend.textContent = "On the paper";
    ed.treeBody = document.createElement("div");
    ed.treeBody.className = "ve-diagram-branches";
    ed.tree.append(ed.treeLegend, ed.treeBody);
    ed.all = document.createElement("details");
    ed.all.className = "ve-diagram-all";
    ed.allSummary = document.createElement("summary");
    ed.allSummary.textContent = "All arrows";
    ed.edgeRows = document.createElement("div");
    ed.edgeRows.className = "ve-diagram-rows";
    ed.shutGroups = new Set();
    ed.addArrow = document.createElement("button");
    ed.addArrow.type = "button";
    ed.addArrow.className = "ve-diagram-add";
    ed.addArrow.innerHTML = '<i class="ph ph-arrow-right" aria-hidden="true"></i><span>Add arrow</span>';

    ed.addArrow.addEventListener("click", () => {
      if (ed.model.nodes.length < 2) {
        return;
      }

      join(ed, ed.model.nodes[0].id, ed.model.nodes[1].id);
    });

    ed.all.addEventListener("toggle", () => {
      if (ed.all.open) {
        paintLists(ed);
      }
    });

    ed.all.append(ed.allSummary, ed.edgeRows, ed.addArrow);
  }

  /* The bar across the top: tidy, the two ways to save a picture, the flow
   * direction, and — on a page of its own rather than inside a document —
   * the zoom controls and the step-through.
   */
  function buildBar(ed) {
    ed.bar = document.createElement("div");
    ed.bar.className = "ve-diagram-bar";
    ed.flowLabel = document.createElement("label");
    ed.flowLabel.className = "ve-diagram-flow";
    ed.flowText = document.createElement("span");
    ed.flowText.textContent = "Flow";
    ed.flowLabel.append(ed.flowText, flowControl(ed));

    if (!ed.viewport) {
      const title = document.createElement("span");
      title.className = "ve-diagram-name";
      title.textContent = ed.settings.title || "diagram";
      ed.bar.append(title);
    }

    ed.zoomField = null;
    ed.steps = null;
    ed.showSteps = () => {};

    buildZoom(ed);

    ed.pictures = group(ed, saveAs(ed, "SVG", () => saveSvg(ed)), saveAs(ed, "PNG", () => savePng(ed)));
    ed.pictures.setAttribute("aria-label", "Save a picture");
    ed.bar.append(group(ed, ed.tidy), ed.pictures, ed.flowLabel);

    if (ed.steps) {
      ed.bar.append(ed.steps);
    }
  }

  /* Everything built so far, put together and put on the page.
   *
   * The panels remember how wide they were, which is the try/catch: a browser
   * that refuses localStorage gets the widths this file ships with rather
   * than an editor that will not open.
   */
  function assemble(ed) {
    ed.rail = document.createElement("aside");
    ed.rail.className = "ve-diagram-rail";
    ed.rail.append(ed.palette, ed.tree);
    ed.side = document.createElement("aside");
    ed.side.className = "ve-diagram-side";
    ed.side.append(ed.hint, ed.inspector, ed.all);
    ed.body = document.createElement("div");
    ed.body.className = "ve-diagram-body";

    ed.PANELS = {
      rail: { least: 56, most: 320, standard: 196 },
      side: { least: 200, most: 520, standard: 300 }
    };

    ed.panels = {
      rail: ed.PANELS.rail.standard,
      side: ed.PANELS.side.standard,
      railShut: false,
      sideShut: false,
      // The bar over the box is a fourth region, and it is put away the same
      // way the other three are: by asking, and it stays away.
      barShut: false
    };

    try {
      const kept = JSON.parse(window.localStorage?.getItem(PANEL_STORE) || "null");
      if (kept && typeof kept === "object") {
        ed.panels.rail = inBounds(ed, "rail", kept.rail ?? ed.panels.rail);
        ed.panels.side = inBounds(ed, "side", kept.side ?? ed.panels.side);
        ed.panels.railShut = Boolean(kept.railShut);
        ed.panels.sideShut = Boolean(kept.sideShut);
        ed.panels.barShut = Boolean(kept.barShut);
      }
    } catch {
    // Nothing kept, or nothing readable. The standard widths, then.
    }

    ed.body.append(ed.rail, panelGrip(ed, "rail", 1), ed.stage, panelGrip(ed, "side", -1), ed.side);
    showPanels(ed);
    ed.shell = document.createElement("div");
    ed.shell.className = "ve-diagram-shell";
    ed.shell.append(ed.bar, ed.body);
    ed.shell.addEventListener("keydown", (event) => onKey(ed, event));
    ed.shell.addEventListener("keyup", (event) => onKeyUp(ed, event));
    ed.parts = [ed.shell];

    if (typeof ed.settings.onDone === "function") {
      const done = document.createElement("button");
      done.type = "button";
      done.className = "ve-embed-done";
      done.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i><span>Done</span>';
      done.addEventListener("click", () => {
        window.clearTimeout(ed.drawTimer);
        ed.settings.onDone();
      });
      ed.parts.push(done);
    }

    paintLists(ed);
    paintInspector(ed);
    ed.node.append(...ed.parts);
    draw(ed);
    ed.history.present = sourceNow(ed);
    ed.showSteps();
    ed.watching = null;

    if (ed.viewport) {
      ed.fitted = fitView(ed);

      if (!ed.fitted) {
        later(ed, () => {
          ed.fitted = fitView(ed);
        });
      }

      if (typeof window.ResizeObserver === "function") {
        ed.watching = new window.ResizeObserver(() => {
          if (!ed.fitted) {
            ed.fitted = fitView(ed);
          }
        });
        ed.watching.observe(ed.canvas);
      }
    }
  }

  /* What the page holding an editor may do to it. */
  function editorApi(ed) {
    return {
    // Where the diagram is being looked at from, which is not part of it and
    // is not written anywhere — but is worth being able to ask about.
      view: () => ({ ...ed.view }),
      fit: () => fitView(ed),
      undo: () => undo(ed),
      redo: () => redo(ed),
      copy: () => copySelection(ed),
      cut: () => cutSelection(ed),
      paste: () => pasteClipboard(ed),
      duplicate: () => duplicateSelection(ed),
      // Whether there is anywhere to go, so a host can grey out a button.
      canUndo: () => ed.history.past.length > 0 || sourceNow(ed) !== ed.history.present,
      canRedo: () => ed.history.future.length > 0,
      // What the file would say if it were written now. The host asks for this
      // when it saves rather than keeping its own copy in step.
      source: () => DiagramModel.serializeFlowchart(ed.model).replace(/\n$/, ""),
      // A pending redraw of an editor nobody is holding any more is a diagram
      // drawn into an element nobody will see.
      destroy: () => {
        window.clearTimeout(ed.drawTimer);
        ed.watching?.disconnect();
        ed.node.innerHTML = "";
      }
    };
  }

  function buildPalette(ed) {
    for (const choice of DIAGRAM_PALETTE) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ve-diagram-tool";
      button.dataset.shape = choice.shape;
      button.dataset.kind = choice.kind;
      // shapeGlyph wraps one of the SVG paths in the table above — markup
      // this file wrote, not anything that came from a document.
      button.innerHTML = html`${trusted(shapeGlyph(choice.glyph))}<span></span>`;
      button.querySelector("span").textContent = choice.label;
      button.title = `Add a ${choice.label.toLowerCase()}`
      + " — drag it onto the diagram, or tap and then tap where it goes";
      button.setAttribute("aria-pressed", "false");
      ed.placeButtons.set(choice, button);

      let ghost = null;
      let dragging = false;

      const finish = (event) => {
        if (ghost) {
          ghost.remove();
          ghost = null;
        }

        try {
          button.releasePointerCapture?.(event.pointerId);
        } catch {
        // Nothing was captured.
        }

        /* A tap says what, and the next tap on the paper says where. Tapping
         * the one that is already armed puts it down again, so the button is
         * its own way out of the mode it turned on.
         */
        if (!dragging) {
          usePlaceTool(ed, ed.placing === choice ? null : choice);
          return;
        }

        dragging = false;
        const paper = ed.canvas.getBoundingClientRect();
        const inside = event.clientX >= paper.left && event.clientX <= paper.right
        && event.clientY >= paper.top && event.clientY <= paper.bottom;

        if (!inside) {
          return;
        }

        placeChoice(ed, choice, pointIn(ed, event.clientX, event.clientY));
      };

      button.addEventListener("pointerdown", (event) => {
        if (typeof event.button === "number" && event.button > 0) {
          return;
        }

        dragging = false;

        try {
          button.setPointerCapture?.(event.pointerId);
        } catch {
        // Without capture the drag still works as a click.
        }
      });

      button.addEventListener("pointermove", (event) => {
        if (!button.hasPointerCapture?.(event.pointerId)) {
          return;
        }

        dragging = true;
        event.preventDefault?.();

        if (!ghost) {
          ghost = document.createElement("div");
          ghost.className = "ve-diagram-ghost";
          ghost.textContent = choice.label;
          document.body.appendChild(ghost);
        }

        ghost.style.left = `${event.clientX}px`;
        ghost.style.top = `${event.clientY}px`;
      });

      button.addEventListener("pointerup", finish);
      button.addEventListener("pointercancel", (event) => {
        dragging = false;
        if (ghost) {
          ghost.remove();
          ghost = null;
        }

        try {
          button.releasePointerCapture?.(event.pointerId);
        } catch {
        // Nothing was captured.
        }
      });

      ed.palette.appendChild(button);
    }
  }

  function buildZoom(ed) {
    if (ed.viewport) {
      const zoom = document.createElement("div");
      zoom.className = "ve-diagram-zoom";

      // One button, wherever it appears: the bar, the zoom cluster, either. A
      // second kind that looks nearly the same as the first is the thing that
      // makes a panel look assembled rather than designed.
      const iconButton = (label, icon, run) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ve-diagram-icon";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.innerHTML = html`<i class="ph ${icon}" aria-hidden="true"></i>`;
        button.addEventListener("click", run);
        return button;
      };

      ed.zoomField = document.createElement("input");
      ed.zoomField.type = "text";
      ed.zoomField.className = "ve-diagram-zoom-value";
      named(ed, ed.zoomField, "Zoom");
      ed.zoomField.value = "100%";

      const readTyped = () => {
        const asked = parseFloat(String(ed.zoomField.value).replace(/[^\d.]/g, ""));
        if (Number.isFinite(asked) && asked > 0) {
          const rect = ed.canvas.getBoundingClientRect();
          zoomAbout(ed, rect.left + (rect.width / 2), rect.top + (rect.height / 2),
            clampScale(ed, asked / 100) / ed.view.scale);
        }

        showZoom(ed);
      };

      ed.zoomField.addEventListener("change", readTyped);
      ed.zoomField.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          readTyped();
          ed.canvas.focus();
        }
      });

      /* The hand. Dragging empty paper pulls a band round what it touches,
       * which is what a drag means in every editor that has a band — so the
       * other thing a drag can mean needs somewhere to be said. Held: the space
       * bar. Switched on: this.
       */
      ed.handButton = iconButton("Hand — drag to move about (H)", "ph-hand",
        () => useHand(ed, !ed.handTool));
      ed.handButton.setAttribute("aria-pressed", "false");

      /* The arrow tool. Switched on, a drag from any box to any box is an
       * arrow — over and over, without selecting anything first, which is the
       * whole of why it is a mode rather than a button that does it once.
       */
      ed.arrowButton = iconButton("Arrow — drag between boxes to join them (A)",
        "ph-arrow-up-right", () => useArrowTool(ed, !ed.arrowTool));
      ed.arrowButton.setAttribute("aria-pressed", "false");

      /* The zoom sits on the paper, at the corner furthest from everything
       * else. It is about the view rather than about the diagram, so it
       * belongs to the window it changes rather than to the bar of things that
       * change the drawing.
       */
      zoom.append(
        iconButton("Zoom out", "ph-minus", () => zoomToCentre(ed, 1 / ZOOM_PER_NOTCH ** 2)),
        ed.zoomField,
        iconButton("Zoom in", "ph-plus", () => zoomToCentre(ed, ZOOM_PER_NOTCH ** 2)),
        iconButton("Fit the whole diagram", "ph-corners-out", () => fitView(ed))
      );
      ed.stage.append(zoom);

      // The keystroke is the one people use, but a canvas that only offers undo
      // to those who know the keystroke is a canvas that has hidden it.
      ed.steps = document.createElement("div");
      ed.steps.className = "ve-diagram-group ve-diagram-steps";

      const back = iconButton("Undo", "ph-arrow-counter-clockwise", () => {
        undo(ed);
        ed.showSteps();
      });
      const forward = iconButton("Redo", "ph-arrow-clockwise", () => {
        redo(ed);
        ed.showSteps();
      });

      ed.showSteps = () => {
        back.disabled = !(ed.history.past.length > 0 || sourceNow(ed) !== ed.history.present);
        forward.disabled = ed.history.future.length === 0;
      };

      ed.steps.append(back, forward);
      ed.bar.append(group(ed, ed.handButton, ed.arrowButton));
    }
  }

  function onCanvasPress(ed, event) {
  /* Keys only reach a canvas that has focus, and clicking one inside a
   * document leaves focus on the document — so Ctrl+Z went to the page
   * editor rather than to the diagram. Pressing the diagram is saying the
   * diagram is what you are working in. Not while typing into the box laid
   * over it, which lives in here and would lose the caret.
   */
    if (!ed.canvas.contains(document.activeElement)) {
      ed.canvas.focus({ preventScroll: true });
    }

    const svg = drawing(ed);
    if (!svg) {
      return;
    }

    if (pressedWithTool(ed, event, pointIn(ed, event.clientX, event.clientY))) {
      return;
    }

    const point = pointIn(ed, event.clientX, event.clientY);

    /* Two taps on a thing, noted before anything that would move it.
     *
     * The second press does not open anything yet — it is a tap only if the
     * hand stays still until it lets go, and until then it may still be the
     * beginning of a drag. So a box is picked up as usual and judged on the
     * way up, and a corner and a line are left alone: pressing a line puts a
     * corner in it, and opening its label should not also bend it.
     */
    ed.tapping = markPress(ed, event, point);

    if (ed.tapping.again) {
      event.preventDefault?.();

      if (ed.tapping.what.kind === "node") {
      /* Inside, one level. A box you are already down to is a box whose
       * words the second press opens, which is what it has always done —
       * so the descent runs out exactly where the typing begins.
       */
        const reach = reachFor(ed, ed.tapping.what.id);

        if (reach && reach.kind === "group") {
          ed.inside = reach.id;
          choose(ed, reachedBy(ed, ed.tapping.what.id));
          ed.tapping.drilled = true;
        } else if (!isSelected(ed, ed.tapping.what.id)) {
          select(ed, ed.tapping.what.id);
        }

        beginGesture(ed, "move", ed.tapping.what.id, point, event);
      }

      return;
    }

    if (pressedOnHandle(ed, event, point)) {
      return;
    }

    const id = pickable(ed, /** @type {Element} */ (event.target).closest?.(".dd-node")?.getAttribute("data-id"))
    || boxAt(ed, point);

    const adding = Boolean(event.shiftKey);

    if (!id) {
      pressedOnPaper(ed, event, point, adding);
      return;
    }

    pressedOnBox(ed, event, point, id, adding);
  }

  function onCanvasMove(ed, event) {
    if (ed.panning) {
      event.preventDefault?.();
      ed.latest = { x: event.clientX, y: event.clientY };

      if (!ed.frame) {
        ed.frame = later(ed, () => {
          ed.frame = 0;
          if (!ed.panning) {
            return;
          }

          ed.view.x = ed.panning.from.x + (ed.latest.x - ed.panning.x);
          ed.view.y = ed.panning.from.y + (ed.latest.y - ed.panning.y);
          applyView(ed);
        });
      }

      return;
    }

    if (ed.marquee) {
      event.preventDefault?.();
      ed.marquee.to = pointIn(ed, event.clientX, event.clientY);

      if (!ed.frame) {
        ed.frame = later(ed, () => {
          ed.frame = 0;
          if (ed.marquee) {
            drawMarquee(ed);
          }
        });
      }

      return;
    }

    if (!ed.gesture) {
      return;
    }

    const point = pointIn(ed, event.clientX, event.clientY);

    if (!ed.gesture.moved) {
      const far = Math.hypot(point.x - ed.gesture.origin.x, point.y - ed.gesture.origin.y);
      if (far < DIAGRAM_DRAG_SLOP) {
        return;
      }

      ed.gesture.moved = true;

      /* What is being carried is drawn on top of everything for as long as it
       * is being carried.
       *
       * The drawing is layered from the outside in, so a box dragged into a
       * bigger one belongs a layer deeper than it is — and until the redraw
       * that follows the drag says so, it would be under the box it was just
       * dropped into. Which reads as having dropped it and lost it.
       *
       * On the first real movement rather than on the press. A press that
       * never goes anywhere never redraws either, so raising it then left a
       * box that had merely been selected sitting on top of everything it is
       * inside, with nothing to put it back.
       */
      if (ed.gesture.kind === "move") {
        carryToFront(ed, Object.keys(ed.gesture.group));
      }
    }

    // A drag on a touch screen would otherwise scroll the canvas as well as
    // move the box.
    event.preventDefault?.();

    // Coalesced to one update per frame. The last position wins, and the
    // position that is committed comes from the release rather than from here,
    // so nothing depends on how many of these arrived.
    ed.latest = point;
    if (ed.frame) {
      return;
    }

    ed.frame = later(ed, () => {
      ed.frame = 0;
      applyGesture(ed, ed.latest);
    });
  }

  function onCanvasDragOver(ed, event) {
    if (!ed.canUpload || dropped(ed, event).length === 0) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    ed.canvas.classList.add("is-dropping");
  }

  function onCanvasDrop(ed, event) {
    ed.canvas.classList.remove("is-dropping");

    const files = dropped(ed, event);
    if (!ed.canUpload || files.length === 0) {
      return;
    }

    event.preventDefault();
    const point = pointIn(ed, event.clientX, event.clientY);
    void putPicture(ed, files[0], { x: point.x, y: point.y });
  }

  function onCanvasCancel(ed, event) {
    if (ed.gesture) {
      ed.gesture = null;
      ed.frame = 0;
      drawing(ed)?.querySelector(".dd-draft")?.remove();
      drawAtOnce(ed);
    }

    try {
      ed.canvas.releasePointerCapture?.(event.pointerId);
    } catch {
    // Nothing was captured.
    }
  }

  function onCanvasMenu(ed, event) {
    event.preventDefault();
    showMenuFrom(ed, event);
  }

  function onPressStart(ed, event) {
    closeMenu(ed);

    if (event.pointerType !== "touch") {
      return;
    }

    const held = { clientX: event.clientX, clientY: event.clientY, target: event.target };
    forgetPress(ed);
    ed.pressTimer = window.setTimeout(() => {
      ed.pressTimer = 0;
      // Whatever the finger had started is abandoned: it turned out to be a
      // request for the menu, not the beginning of a drag.
      ed.gesture = null;
      ed.panning = null;
      ed.canvas.classList.remove("is-panning");
      showMenuFrom(ed, held);
    }, LONG_PRESS);
  }

  function onPressMove(ed, event) {
    if (ed.pressTimer && event.pointerType === "touch") {
      forgetPress(ed);
    }
  }

  function bindWheel(ed) {
    if (!ed.viewport) {
      return;
    }

    ed.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();

      if (event.ctrlKey || event.metaKey) {
      // The sign and a fixed ratio, not the distance: what a notch reports
      // varies by an order of magnitude between a mouse and a trackpad.
        const notches = event.deltaY > 0 ? -1 : 1;
        zoomAbout(ed, event.clientX, event.clientY, ZOOM_PER_NOTCH ** notches);
        return;
      }

      /* Shift is sideways on a mouse with only one wheel. Some browsers do
       * that translation themselves and send it as deltaX; the ones that do
       * not send deltaY with shiftKey set — so both spellings have to be read
       * or half the mice in the world scroll nothing at all.
       */
      const sideways = event.shiftKey && event.deltaX === 0;
      ed.view.x -= sideways ? event.deltaY : event.deltaX;
      ed.view.y -= sideways ? 0 : event.deltaY;
      applyView(ed);
    }, { passive: false });

    // A canvas that keeps thinking the space bar is down after the window has
    // gone away is a canvas where nothing can be selected any more.
    window.addEventListener("blur", () => {
      ed.spaceHeld = false;
      showGrab(ed);
    });
  }

  function bindTouch(ed) {
    if (!ed.viewport) {
      return;
    }

    ed.canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") {
        return;
      }

      ed.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (ed.touches.size !== 2) {
        return;
      }

      // Whatever one finger had started is abandoned: two fingers are a
      // different intention, and finishing the first would move a box.
      ed.gesture = null;
      ed.panning = null;
      ed.canvas.classList.remove("is-panning");
      drawing(ed)?.querySelector(".dd-draft")?.remove();

      const span = spanOf(ed);
      ed.pinch = { span, from: { x: ed.view.x, y: ed.view.y }, scale: ed.view.scale };
    });

    ed.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" || !ed.touches.has(event.pointerId)) {
        return;
      }

      ed.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!ed.pinch || ed.touches.size !== 2) {
        return;
      }

      event.preventDefault();
      const span = spanOf(ed);
      if (ed.pinch.span.distance <= 0) {
        return;
      }

      const next = clampScale(ed, ed.pinch.scale * (span.distance / ed.pinch.span.distance));
      const rect = ed.canvas.getBoundingClientRect();
      const sx = ed.pinch.span.x - rect.left;
      const sy = ed.pinch.span.y - rect.top;

      // The point between the fingers stays under them, and the fingers
      // themselves are allowed to travel — so a pinch pans as well as zooms,
      // which is what makes it feel like moving a piece of paper.
      ed.view.scale = next;
      ed.view.x = (sx - ((sx - ed.pinch.from.x) * next / ed.pinch.scale)) + (span.x - ed.pinch.span.x);
      ed.view.y = (sy - ((sy - ed.pinch.from.y) * next / ed.pinch.scale)) + (span.y - ed.pinch.span.y);
      applyView(ed);
    }, { passive: false });

    const liftFinger = (event) => {
      if (event.pointerType !== "touch") {
        return;
      }

      ed.touches.delete(event.pointerId);
      if (ed.touches.size < 2) {
        ed.pinch = null;
      }
    };

    ed.canvas.addEventListener("pointerup", liftFinger);
    ed.canvas.addEventListener("pointercancel", liftFinger);
  }


  /* Put a diagram canvas inside an element.
   *
   * The editor is handed a source string and two callbacks and knows nothing
   * about where the diagram came from: a fence inside a document and a .mmd file
   * on its own are the same diagram to it, which is what makes both routes into
   * it one build rather than two.
   *
   *   source   the flowchart, as it is written in the file
   *   onChange called with the flowchart as it is now, after every edit
   *   onDone   if given, a Done button that calls it — the in-document host
   *            closes the editor with it, the page has nothing to close
   *   title    what the strip along the top calls this
   *
   * Returns a handle, or null for a diagram it cannot open.
   */
  function mount(host, options) {
    const ed = startEditor(host, options);

    if (!ed) {
      return null;
    }

    bindCanvas(ed);
    buildRail(ed);
    buildBar(ed);
    assemble(ed);
    return editorApi(ed);
  }

  return {
    PALETTE: DIAGRAM_PALETTE,
    FLOWS: DIAGRAM_FLOWS,
    PAPER_PAD: DIAGRAM_PAPER_PAD,
    DRAG_SLOP: DIAGRAM_DRAG_SLOP,
    MIN_BOX: DIAGRAM_MIN_BOX,
    canOpen,
    mount
  };
})();
