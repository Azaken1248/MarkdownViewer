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
(function (global) {
  "use strict";

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
    const settings = options || {};
    const opened = canOpen(settings.source);
    if (!opened) {
      return null;
    }

    const onChange = typeof settings.onChange === "function" ? settings.onChange : () => {};

    /* All of it, not the parts this editor happens to have controls for.
     *
     * A diagram can say more than the canvas can yet change — what colour a
     * class is, what layers there are, keys written by a later version of this
     * editor than the one open. Copying out only the boxes and arrows meant
     * that saving a coloured diagram wrote back the classes each box wears and
     * not the definitions of them, so the colours went and left the names
     * behind. Everything comes in, and everything nothing touched goes back
     * out unchanged.
     */
    const carried = { ...opened };
    // `ok` is the parser saying it managed, not part of the diagram.
    delete carried.ok;

    const model = {
      ...carried,
      // A diagram that has never been arranged is arranged on the way in, so
      // there is something to drag. Nothing is written to the file until
      // something is actually changed.
      layout: DiagramModel.ensureLayout(opened)
    };

    const node = host;
    node.innerHTML = "";

    // Which box is being worked on, and — when an arrow is being drawn by tapping
    // rather than dragging — which box it is being drawn from. Both are ids
    // rather than elements, because the elements are redrawn constantly.
    /* What is being worked on.
     *
     * A list rather than an id, because a diagram is edited in handfuls as
     * often as one box at a time — and because everything that acts on a
     * selection then has one shape to act on whether it holds one box or nine.
     * `selectedId` is the one box the options panel is about, which is only a
     * box at all when exactly one is chosen.
     */
    let selection = [];
    let selectedId = null;
    let armedFrom = null;

    const isSelected = (id) => selection.includes(id);

    /* --- Where we are looking ---------------------------------------------
     *
     * A diagram in a viewport has no edges and no size: it is a place, and this
     * says which part of it is on screen. A point p in the diagram is drawn at
     * p * scale + (x, y), so panning and zooming are one transform written to
     * one group, whether there are six boxes in it or six hundred.
     *
     * The in-document editor has no viewport — it draws the diagram at its own
     * size and lets the strip scroll — so all of this is inert there.
     */
    const viewport = Boolean(settings.viewport);
    const view = { x: 0, y: 0, scale: 1 };
    let fitted = false;

    /* --- The paper -------------------------------------------------------- */

    const stage = document.createElement("div");
    stage.className = "ve-diagram-stage";

    const canvas = document.createElement("div");
    canvas.className = "ve-diagram-canvas";
    // So the diagram can be worked without a pointing device: arrows nudge, and
    // Delete removes.
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-label", "Diagram canvas");

    stage.append(canvas);

    const drawing = () => canvas.querySelector("svg");
    const boxOf = (id) => model.layout[id] || null;
    const nodeById = (id) => model.nodes.find((item) => item.id === id) || null;
    const stepLabel = (item) => DiagramModel.textRows(item.text || item.id)[0] || item.id;

    let drawTimer = 0;

    const draw = () => {
      drawTimer = 0;

      // A pending redraw of a builder that has since been closed is a diagram
      // nobody will ever see, drawn into an element nobody holds.
      if (!canvas.isConnected) {
        return;
      }

      // The field typed into is laid over the drawing rather than part of it,
      // so a redraw takes the drawing out and leaves the field where it is.
      const typing = editing?.field || null;
      typing?.remove();

      canvas.innerHTML = DiagramDraw.render(model, {
        layout: model.layout,
        // A window onto the diagram, or — in a document — the diagram at its own
        // size on grid paper with the strip scrolling it.
        viewport,
        view,
        natural: !viewport,
        grid: true,
        pad: DIAGRAM_PAPER_PAD,
        selected: selection,
        label: "Diagram being edited"
      });

      if (typing) {
        canvas.append(typing);
        placeEditor();
      }

      // The bar is not in the drawing, but it stands over a box that has just
      // been drawn somewhere else.
      placeHud();
    };

    /* Moving the view without drawing the diagram again.
     *
     * Two attributes: the group everything is in, and the grid pattern behind
     * it. That is the whole cost of a pan or a zoom, which is why it stays the
     * whole cost at any size.
     */
    function applyView() {
      const svg = drawing();
      if (!svg) {
        return;
      }

      const moved = `translate(${round(view.x)},${round(view.y)}) scale(${view.scale})`;
      svg.querySelector(".dd-view")?.setAttribute("transform", moved);
      svg.querySelector("pattern")?.setAttribute("patternTransform", moved);
      placeEditor();
      placeHud();
      // A menu opened at a point on the diagram is about that point, and the
      // point has just moved out from under it.
      closeMenu();
      showZoom();
    }

    const round = (value) => Math.round(value * 100) / 100;
    const clampScale = (value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

    // Zooming about a point on the screen: that point is the one thing that must
    // not move, which is what makes a wheel zoom feel like it is aimed rather
    // than merely applied.
    function zoomAbout(clientX, clientY, factor) {
      const next = clampScale(view.scale * factor);
      if (next === view.scale) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;

      view.x = sx - ((sx - view.x) * next / view.scale);
      view.y = sy - ((sy - view.y) * next / view.scale);
      view.scale = next;
      applyView();
    }

    function zoomToCentre(factor) {
      const rect = canvas.getBoundingClientRect();
      zoomAbout(rect.left + (rect.width / 2), rect.top + (rect.height / 2), factor);
    }

    // The whole diagram, as large as it will go without touching the edges.
    function fitView() {
      const rect = canvas.getBoundingClientRect();
      // Where the diagram is, not how large a picture of it would be: on an
      // endless canvas a box can be at -400, and fitting to a rectangle that
      // starts at the origin would leave it off the top of the window.
      const bounds = DiagramModel.layoutExtent(model.layout);
      const room = { w: rect.width - (FIT_MARGIN * 2), h: rect.height - (FIT_MARGIN * 2) };

      // Before the canvas has been laid out there is nothing to fit into, and
      // fitting to zero would put the diagram at the smallest zoom there is.
      if (room.w <= 0 || room.h <= 0 || bounds.w <= 0 || bounds.h <= 0) {
        return false;
      }

      // Never magnified to fit: a diagram of one box would fill the window with
      // one box, which is not what anyone means by fit.
      view.scale = clampScale(Math.min(room.w / bounds.w, room.h / bounds.h, 1));
      view.x = ((rect.width - (bounds.w * view.scale)) / 2) - (bounds.x * view.scale);
      view.y = ((rect.height - (bounds.h * view.scale)) / 2) - (bounds.y * view.scale);
      applyView();
      return true;
    }

    // Typing redraws on a pause. Everything else redraws at once: the thing you
    // just did has to be on screen before it can be worked on.
    const drawSoon = () => {
      window.clearTimeout(drawTimer);
      drawTimer = window.setTimeout(draw, DIAGRAM_PREVIEW_DELAY);
    };

    const drawAtOnce = () => {
      window.clearTimeout(drawTimer);
      draw();
    };

    const sourceNow = () => DiagramModel.serializeFlowchart(model).replace(/\n$/, "");

    /* --- Going back ---------------------------------------------------------
     *
     * A step is the file as it was, because the file is exactly what a diagram
     * is: cheap to keep, impossible to get subtly wrong, and it restores the
     * colours and the layers and the keys this editor has no controls for
     * along with everything it does.
     *
     * One step per gesture. A drag is one step however many frames it took, and
     * a burst of typing is one step however many keystrokes — which is what
     * makes undo mean "that thing I just did" rather than "one frame of it".
     */
    const history = { past: [], future: [], present: "" };
    let historyTimer = 0;

    function rememberNow() {
      window.clearTimeout(historyTimer);
      historyTimer = 0;

      const now = sourceNow();
      if (now === history.present) {
        return;
      }

      history.past.push(history.present);
      if (history.past.length > HISTORY_DEPTH) {
        history.past.shift();
      }

      history.present = now;
      // Doing something new is what makes the way forward stop existing.
      history.future.length = 0;
      showSteps();
    }

    function rememberSoon() {
      window.clearTimeout(historyTimer);
      historyTimer = window.setTimeout(rememberNow, HISTORY_IDLE);
    }

    /* A step, put back.
     *
     * The model is filled in rather than replaced, because everything on this
     * canvas holds a reference to it — and a selection that named a box which
     * is no longer there is a selection of nothing.
     */
    function restore(source) {
      const back = DiagramModel.parseFlowchart(source);
      if (!back.ok) {
        return;
      }

      for (const key of Object.keys(model)) {
        delete model[key];
      }

      Object.assign(model, back, { layout: DiagramModel.ensureLayout(back) });
      delete model.ok;

      onChange(source);
      paintLists();
      choose(selection);
      showSteps();
    }

    function undo() {
      // Whatever is still being typed is a step of its own, and undoing has to
      // take that back first rather than skipping over it.
      rememberNow();

      if (history.past.length === 0) {
        return false;
      }

      history.future.push(history.present);
      history.present = history.past.pop();
      restore(history.present);
      return true;
    }

    function redo() {
      window.clearTimeout(historyTimer);
      historyTimer = 0;

      if (history.future.length === 0) {
        return false;
      }

      history.past.push(history.present);
      history.present = history.future.pop();
      restore(history.present);
      return true;
    }

    const write = ({ atOnce = true } = {}) => {
      onChange(sourceNow());
      if (atOnce) {
        rememberNow();
      } else {
        rememberSoon();
      }
    };

    // Typing is the one edit that arrives a character at a time, so it is the
    // one whose steps are gathered up rather than taken as they come.
    const commit = () => {
      write({ atOnce: false });
      drawSoon();
    };

    /* --- Pointer arithmetic ------------------------------------------------
     *
     * The drawing is rendered at its own size, so a pixel on the screen is a unit
     * in the diagram — until a narrow screen scales it down, which the ratio
     * between the box it is drawn in and the box it says it is takes care of.
     */
    function pointIn(clientX, clientY) {
      const svg = drawing();
      if (!svg) {
        return { x: 0, y: 0 };
      }

      // In a viewport one unit is one pixel and the view transform is the only
      // scale there is, so undoing it is the whole conversion.
      if (viewport) {
        const box = canvas.getBoundingClientRect();
        return {
          x: (clientX - box.left - view.x) / view.scale,
          y: (clientY - box.top - view.y) / view.scale
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

    // Which box is under a point, asked of the model rather than of the document.
    // Nothing here depends on hit testing an SVG, which is the one part of a
    // drawing a browser is allowed to disagree about.
    function boxAt(point) {
      for (let index = model.nodes.length - 1; index >= 0; index -= 1) {
        const item = model.nodes[index];
        const at = boxOf(item.id);

        if (at && point.x >= at.x && point.x <= at.x + at.w
          && point.y >= at.y && point.y <= at.y + at.h) {
          return item.id;
        }
      }

      return null;
    }

    /* The grid, with nothing forbidden.
     *
     * This used to clamp at zero, from when the canvas was a fixed sheet of
     * paper and a negative coordinate meant off the page. A viewport has no
     * edges — which is the whole point of it — so the clamp only meant that a
     * diagram panned to show the space on its left could not be dragged into
     * that space. The file format has always written a minus sign.
     */
    const snap = (value) => DiagramModel.snap(value);

    /* --- Moving what is already there -------------------------------------- */

    // The arrows that touch one box, re-routed where they are without redrawing
    // anything else. This is what makes dragging a box cost a handful of
    // attribute writes instead of a whole render.
    function reroute(id) {
      const svg = drawing();
      if (!svg) {
        return;
      }

      const spread = DiagramDraw.lanes(model.edges);
      const touching = svg.querySelectorAll(`.dd-edge[data-from="${id}"], .dd-edge[data-to="${id}"]`);

      for (const group of touching) {
        const index = Number(group.getAttribute("data-edge"));
        const edge = model.edges[index];
        if (!edge) {
          continue;
        }

        const route = DiagramDraw.routeEdge(model.layout, edge, spread[index]);
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

    /* --- Bending an arrow ---------------------------------------------------
     *
     * An arrow has always gone where the router put it. These are the two ways
     * of saying otherwise: a corner dropped on the line, and an end pinned to a
     * side of its box. Both live in the layout comment, both are read back, and
     * an arrow nobody has touched still has neither.
     */

    // One arrow re-drawn where it is, the same as reroute does for a box, so a
    // corner being dragged costs a couple of attribute writes a frame.
    function redrawEdge(index) {
      const svg = drawing();
      const group = svg?.querySelector(`.dd-edge[data-edge="${index}"]`);
      const edge = model.edges[index];
      if (!svg || !group || !edge) {
        return;
      }

      const route = DiagramDraw.routeEdge(model.layout, edge,
        DiagramDraw.lanes(model.edges)[index]);
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
        dot?.setAttribute("cx", String(round(x)));
        dot?.setAttribute("cy", String(round(y)));
      }
    }

    /* How far along a route a point is, measured rather than guessed.
     *
     * Used to work out where in the list a new corner belongs: the corners are
     * in the order the line passes through them, so a corner dropped between
     * the second and the third has to go between them in the list too, or the
     * line doubles back on itself to collect it.
     */
    function alongRoute(points, at) {
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

    function addCorner(index, at) {
      const edge = model.edges[index];
      const route = DiagramDraw.routeEdge(model.layout, edge,
        DiagramDraw.lanes(model.edges)[index]);
      if (!edge || !route) {
        return -1;
      }

      // A loop back to the same box has a shape of its own and no route to put
      // a corner into. Refusing is better than taking one and ignoring it.
      if (edge.from === edge.to) {
        return -1;
      }

      const dropped = { x: snap(at.x), y: snap(at.y) };
      const via = [...(edge.waypoints || [])];
      const mark = alongRoute(route.points, dropped);
      const before = via.findIndex((one) => alongRoute(route.points, one) > mark);
      const put = before < 0 ? via.length : before;

      via.splice(put, 0, dropped);
      edge.waypoints = via;
      return put;
    }

    function dropCorner(index, at) {
      const edge = model.edges[index];
      if (!edge?.waypoints) {
        return;
      }

      // Left as an empty list rather than taken off: whether a line with no
      // corners left says so in the file is the file's question, and the writer
      // already answers it. One place decides, not two that have to agree.
      edge.waypoints = edge.waypoints.filter((one, which) => which !== at);

      write();
      drawAtOnce();
    }

    /* Which side of a box a point is asking for.
     *
     * Well inside means none of them: the middle of a box is not a side, and
     * dragging an end back into the middle is how an end that was pinned goes
     * back to being the router's business.
     */
    function sideFor(box, at) {
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

    function pinEnd(index, end, at) {
      const edge = model.edges[index];
      const box = boxOf(end === 0 ? edge?.from : edge?.to);
      if (!edge || !box) {
        return;
      }

      // Both ends left to the router is said plainly, and the writer is what
      // decides that saying it is the same as saying nothing.
      const sides = Array.isArray(edge.sides) ? [...edge.sides] : ["a", "a"];
      sides[end] = sideFor(box, at);
      edge.sides = sides;

      redrawEdge(index);
    }

    const moveTo = (id, x, y) => placeAt(id, snap(x), snap(y));

    /* Where a box is, exactly.
     *
     * moveTo snaps, because a box dragged by hand should line up with the ones
     * already there. This one does not, because the reason anyone reaches for
     * an arrow key is that snapping has put something two pixels from where
     * they want it.
     */
    function placeAt(id, x, y) {
      const at = boxOf(id);
      if (!at) {
        return;
      }

      at.x = Math.round(x);
      at.y = Math.round(y);

      const svg = drawing();
      const group = svg?.querySelector(`.dd-node[data-id="${id}"]`);
      if (group) {
        group.setAttribute("transform", `translate(${at.x},${at.y})`);
      }

      // The ring and its handles are drawn in the diagram's own coordinates, so
      // one transform on the group carries all of them along — measured from
      // where they were drawn, which is recorded when a drag begins. A move with
      // no drag behind it (an arrow key) has no such record and no need of one:
      // the redraw that follows puts them where they belong.
      const marks = svg?.querySelector(".dd-marks");
      const drawnAt = marks ? Number(marks.dataset.x) : NaN;
      if (marks && id === marks.dataset.id && Number.isFinite(drawnAt)) {
        marks.setAttribute("transform", `translate(${at.x - drawnAt},${at.y - Number(marks.dataset.y)})`);
      }

      reroute(id);
    }

    /* Moving everything that is selected, by the same amount.
     *
     * Each box is put where it was when the drag began plus how far the drag
     * has gone, rather than nudged by the difference since the last frame:
     * nudging accumulates rounding, and a selection dragged across the canvas
     * would come apart on the way.
     */
    /* Moving everything that is carried, by an amount already decided.
     *
     * Placed rather than snapped: whoever worked out the offset has already
     * settled what to line up with, and rounding it to the grid here would take
     * a box back off the line it was just put on.
     */
    function moveSelectionTo(group, dx, dy) {
      for (const [id, from] of Object.entries(group || {})) {
        placeAt(id, from.x + dx, from.y + dy);
      }
    }

    /* Where a drag should actually put things.
     *
     * The grid first, because a box put down by hand should line up with the
     * ones already there. Then the boxes themselves, which win when they are
     * close enough: lining up with something real beats lining up with a
     * measurement, and a diagram where nothing quite touches is a diagram that
     * looks nearly arranged.
     */
    function guidedMove(group, dx, dy) {
      const ids = Object.keys(group || {});
      if (ids.length === 0) {
        return { dx, dy, guides: [] };
      }

      const carried = new Set(ids);
      const boxes = ids.map((id) => ({ ...group[id], w: boxOf(id).w, h: boxOf(id).h }));
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
      const others = model.nodes
        .filter((item) => !carried.has(item.id))
        .map((item) => boxOf(item.id))
        .filter(Boolean);

      const lined = DiagramModel.alignGuides(moving, others, GUIDE_WITHIN / view.scale);

      // A line on a real box beats a line on the grid, and only where there is
      // one: an axis with nothing to line up against falls back to the grid,
      // which is what keeps a diagram tidy where nothing else is near.
      const held = { x: false, y: false };
      for (const one of lined.guides) {
        held[one.axis] = true;
      }

      const put = {
        x: held.x ? lined.x : snap(moving.x),
        y: held.y ? lined.y : snap(moving.y)
      };

      return { dx: put.x - corner.x, dy: put.y - corner.y, guides: lined.guides };
    }

    function drawGuides(guides) {
      const svg = drawing();
      if (!svg) {
        return;
      }

      let holder = svg.querySelector(".dd-guides");
      if (!holder) {
        holder = document.createElementNS(SVG_NS, "g");
        holder.setAttribute("class", "dd-guides");
        (svg.querySelector(".dd-view") || svg).appendChild(holder);
      }

      holder.innerHTML = DiagramDraw.guidesMarkup(guides);
    }

    // Which edges a grip drags: -1 the left or the top, 1 the right or the
    // bottom, 0 an axis it leaves alone. Read off the drawing's own list, so
    // there is one place that says what a grip means.
    const GRIP_EDGES = new Map(DiagramDraw.GRIPS.map(([name, gx, gy]) => [name, [gx, gy]]));

    /* Resizing, lined up with what is already there.
     *
     * The same six lines a move is snapped to — a box's left, centre and right,
     * its top, middle and bottom — but only the edges being dragged may be put
     * on one of them. Snapping an edge that is not moving would move it, which
     * is a resize that also drags the box sideways.
     *
     * The moving edges are handed over as a box of no size, so that its left,
     * centre and right are all the one line there is to line up. Everything
     * else about lining up is the same arithmetic a move uses, and is not
     * written twice.
     */
    function guidedResize(id, from, grip, dx, dy) {
      const [gx, gy] = GRIP_EDGES.get(grip) || [1, 1];

      let left = from.x;
      let right = from.x + from.w;
      let top = from.y;
      let bottom = from.y + from.h;

      if (gx > 0) {
        right += dx;
      } else if (gx < 0) {
        left += dx;
      }

      if (gy > 0) {
        bottom += dy;
      } else if (gy < 0) {
        top += dy;
      }

      // A box cannot line up with itself: every edge of it is within nothing of
      // where it already is, so one that could would snap back the moment it
      // was nudged, and a small resize would be impossible.
      const others = model.nodes
        .filter((item) => item.id !== id)
        .map((item) => boxOf(item.id))
        .filter(Boolean);

      const edge = { x: gx > 0 ? right : left, y: gy > 0 ? bottom : top, w: 0, h: 0 };
      const lined = DiagramModel.alignGuides(edge, others, GUIDE_WITHIN / view.scale);

      const held = { x: false, y: false };
      for (const one of lined.guides) {
        held[one.axis] = true;
      }

      /* A line on a real box beats a line on the grid, the same way it does for
       * a move. An axis this grip does not drag needs no answer at all — the
       * edge it would be about is not being written back below.
       */
      const put = {
        x: held.x ? lined.x : snap(edge.x),
        y: held.y ? lined.y : snap(edge.y)
      };

      if (gx > 0) {
        right = put.x;
      } else if (gx < 0) {
        left = put.x;
      }

      if (gy > 0) {
        bottom = put.y;
      } else if (gy < 0) {
        top = put.y;
      }

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

    function resizeTo(id, box) {
      const at = boxOf(id);
      if (!at) {
        return;
      }

      Object.assign(at, box);
      // A shape has to be drawn again to be a different size, and the handles
      // move with its edges, so this one is a redraw.
      drawAtOnce();
    }

    /* --- One gesture at a time ---------------------------------------------
     *
     * Press, move, let go — the same three events whether what is being done is a
     * move, a resize, a new arrow, or a shape being dragged off the palette. What
     * kind it is, is decided by what was under the finger when it went down.
     */
    let gesture = null;
    let frame = 0;
    let latest = null;

    const later = (run) => (typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 16));

    function beginGesture(kind, id, point, event) {
      const at = boxOf(id);

      // Where everything being carried was when the drag began. One box or
      // nine, the arithmetic afterwards is the same.
      const group = {};
      if (kind === "move") {
        for (const one of (isSelected(id) ? selection : [id])) {
          const where = boxOf(one);
          if (where) {
            group[one] = { x: where.x, y: where.y };
          }
        }
      }

      gesture = {
        kind,
        id,
        origin: point,
        from: at ? { x: at.x, y: at.y, w: at.w, h: at.h } : null,
        group,
        moved: false
      };

      const marks = drawing()?.querySelector(".dd-marks");
      if (marks && at) {
        // Where the marks were drawn, so moving them is a difference rather than
        // a re-render. Only worth doing for one box: a frame round several is
        // redrawn when the drag ends, which is soon enough for something that is
        // already the same shape as what it surrounds.
        marks.dataset.x = String(at.x);
        marks.dataset.y = String(at.y);
        marks.dataset.id = id;
      }

      hold(event);
    }

    /* What is being carried is drawn in front of what it is carried over — but
     * not in front of what it is carrying.
     *
     * A box dragged into a bigger one has to be visible on the way in, or it
     * looks like it was dropped and lost. A box with something inside it is the
     * other way round: lifted over its own contents it hides them for the whole
     * drag, which is worse than the problem being solved. So a container stays
     * in its layer and everything else comes forward.
     */
    function carryToFront(ids) {
      const layers = drawing()?.querySelectorAll(".dd-nodes");
      const top = layers?.[layers.length - 1];
      if (!top) {
        return;
      }

      const depths = DiagramDraw.nestingDepths(model.nodes, model.layout);
      const holds = (id) => model.nodes.some((one) =>
        one.id !== id && depths.get(one.id) > (depths.get(id) || 0)
        && DiagramDraw.surrounds(model.layout[id], model.layout[one.id]));

      for (const one of ids) {
        const box = drawing()?.querySelector(`.dd-node[data-id="${one}"]`);
        if (box && !holds(one)) {
          top.append(box);
        }
      }
    }

    // Keeping the pointer for the length of a drag. A browser without capture
    // still gets the move and up events while the pointer is over the canvas,
    // which is most of a drag.
    function hold(event) {
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Nothing was captured.
      }
    }

    /* The rubber band.
     *
     * Like panning, not an edit and not a gesture: nothing in the model changes
     * while it is being pulled, and what it leaves behind is a selection rather
     * than a change. It is drawn straight into the SVG and taken out again.
     */
    let marquee = null;

    function beginMarquee(point, event) {
      marquee = { from: point, to: point, adding: Boolean(event.shiftKey), was: [...selection] };

      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Without capture the band ends when the pointer leaves the canvas.
      }
    }

    const marqueeBox = () => ({
      x: Math.min(marquee.from.x, marquee.to.x),
      y: Math.min(marquee.from.y, marquee.to.y),
      w: Math.abs(marquee.to.x - marquee.from.x),
      h: Math.abs(marquee.to.y - marquee.from.y)
    });

    // Touched, not enclosed: a band that only takes what it swallows whole is a
    // band you have to be careful with, and being careful is the thing a rubber
    // band is for avoiding.
    const boxesIn = (band) => model.nodes
      .filter((item) => {
        const at = boxOf(item.id);
        return at && at.x < band.x + band.w && at.x + at.w > band.x
          && at.y < band.y + band.h && at.y + at.h > band.y;
      })
      .map((item) => item.id);

    function drawMarquee() {
      const svg = drawing();
      if (!svg) {
        return;
      }

      const band = marqueeBox();
      let shape = svg.querySelector(".dd-marquee");
      if (!shape) {
        shape = document.createElementNS(SVG_NS, "rect");
        shape.setAttribute("class", "dd-marquee");
        (svg.querySelector(".dd-view") || svg).appendChild(shape);
      }

      shape.setAttribute("x", String(round(band.x)));
      shape.setAttribute("y", String(round(band.y)));
      shape.setAttribute("width", String(round(band.w)));
      shape.setAttribute("height", String(round(band.h)));
    }

    /* Panning is not an edit, so it is not a gesture in the sense the others
     * are: nothing in the model changes, nothing is committed, and there is
     * nothing to undo. It is its own small state for that reason.
     */
    let panning = null;

    function beginPan(event) {
      panning = {
        x: event.clientX,
        y: event.clientY,
        from: { x: view.x, y: view.y }
      };

      canvas.classList.add("is-panning");

      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Without capture the pan ends when the pointer leaves the canvas,
        // which is a smaller loss than not panning at all.
      }
    }

    function applyGesture(point) {
      if (!gesture) {
        return;
      }

      if (gesture.kind === "move" && gesture.from) {
        const lined = guidedMove(gesture.group, point.x - gesture.origin.x, point.y - gesture.origin.y);
        moveSelectionTo(gesture.group, lined.dx, lined.dy);
        drawGuides(lined.guides);
        return;
      }

      if (gesture.kind === "resize" && gesture.from) {
        const sized = guidedResize(gesture.id, gesture.from, gesture.grip,
          point.x - gesture.origin.x, point.y - gesture.origin.y);
        resizeTo(gesture.id, sized.at);
        drawGuides(sized.guides);
        return;
      }

      if (gesture.kind === "connect") {
        drawDraft(point);
        return;
      }

      if (gesture.kind === "via") {
        const edge = model.edges[gesture.index];
        const corner = edge?.waypoints?.[gesture.at];
        if (corner) {
          corner.x = snap(point.x);
          corner.y = snap(point.y);
          redrawEdge(gesture.index);
        }

        return;
      }

      if (gesture.kind === "pin") {
        pinEnd(gesture.index, gesture.end, point);
      }
    }

    /* The arrow being drawn, which is not an arrow yet and so is not in the model
     * yet either. It is one element, made once and moved.
     *
     * Drawn inside the view, with the guides and the band, because both of its
     * ends are places in the diagram: the box it starts at is where the model
     * says, and the point it ends at is a pointer already converted back
     * through the view. Hung off the svg instead, the line was drawn in screen
     * pixels from a diagram-coordinate start — so it began somewhere the box
     * was not, and swung about that spot as the pointer moved.
     */
    function drawDraft(point) {
      const svg = drawing();
      const at = boxOf(gesture.id);
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

      const over = boxAt(point);
      for (const group of svg.querySelectorAll(".dd-node")) {
        const id = group.getAttribute("data-id");
        group.classList.toggle("is-target", Boolean(over) && over !== gesture.id && id === over);
      }
    }

    // Held down, the space bar turns a drag into a pan wherever it starts, which
    // is how every canvas has worked since before any of them had a canvas.
    // The hand is the same thing left switched on, for the hands that would
    // rather press a button than hold a key down while dragging.
    let spaceHeld = false;
    let handTool = false;
    // Built with the rest of the zoom bar, further down, and only when there is
    // a viewport for it to be about.
    let handButton = null;

    const showGrab = () => {
      canvas.classList.toggle("is-panning-armed", spaceHeld || handTool);
      if (handButton) {
        handButton.setAttribute("aria-pressed", handTool ? "true" : "false");
        handButton.classList.toggle("is-on", handTool);
      }
    };

    function useHand(on) {
      handTool = Boolean(on);
      // A band cannot be pulled by a hand, and a hand that arrives mid-band
      // would leave one drawn on the paper with nothing to finish it.
      if (handTool && marquee) {
        marquee = null;
        drawing()?.querySelector(".dd-marquee")?.remove();
      }

      // Two modes at once is one mode too many, and the hand is the one that
      // takes the whole canvas.
      if (handTool) {
        useArrowTool(false);
        usePlaceTool(null);
      }

      showGrab();
    }

    /* The arrow tool.
     *
     * Drawing an arrow meant selecting the box it comes from and then finding
     * the circle on its edge, which is one arrow's worth of work per arrow. Ten
     * arrows is ten selections. Switched on, this makes a drag from any box to
     * any box an arrow, over and over, without selecting anything — which is
     * what every diagram tool that has a toolbox does, and what StarUML does.
     *
     * It stays on until it is switched off, because the reason to reach for it
     * is that there is more than one arrow to draw.
     */
    let arrowTool = false;
    let arrowButton = null;

    const showArrowTool = () => {
      canvas.classList.toggle("is-joining", arrowTool);
      if (arrowButton) {
        arrowButton.setAttribute("aria-pressed", arrowTool ? "true" : "false");
        arrowButton.classList.toggle("is-on", arrowTool);
      }
    };

    function useArrowTool(on) {
      arrowTool = Boolean(on);

      if (arrowTool) {
        // Arming it is saying what the next drag is for, so the half-finished
        // ways of saying the same thing go away.
        armedFrom = null;
        handTool = false;
        usePlaceTool(null);
        showGrab();
        paintInspector();
      }

      showArrowTool();
    }

    /* The place tool.
     *
     * Tapping a shape on the rail used to drop it wherever there happened to be
     * room — under the lowest box, or nudged sideways until it was clear of
     * everything. Which is an answer to "where does this go" that nobody asked
     * for: the shape then had to be dragged from wherever it landed to wherever
     * it was wanted, so every box cost a tap and a drag.
     *
     * So a tap on the rail no longer puts anything down. It says what the next
     * tap on the paper is for, and the tap on the paper says where. Dragging a
     * shape straight onto the paper still works and is still the quickest way
     * to place one — this is the same gesture for a hand that would rather not
     * drag, and the only one that works when the rail and the paper are not on
     * screen together.
     *
     * One shape at a time, and it is put down after one placement: a rail that
     * stays armed is an editor that quietly adds a box every time you click
     * anywhere, which is a worse surprise than tapping the shape again.
     */
    let placing = null;
    const placeButtons = new Map();

    const showPlacing = () => {
      canvas.classList.toggle("is-placing", Boolean(placing));

      for (const [choice, button] of placeButtons) {
        const on = placing === choice;
        button.setAttribute("aria-pressed", on ? "true" : "false");
        button.classList.toggle("is-on", on);
      }
    };

    function usePlaceTool(choice) {
      const was = placing;
      placing = choice || null;

      if (placing) {
        // Two modes at once is one mode too many, here as everywhere else.
        armedFrom = null;
        handTool = false;
        arrowTool = false;
        showGrab();
        showArrowTool();
        say(`Tap the paper to put a ${placing.label.toLowerCase()} there.`);
      } else if (was) {
        say("");
      }

      showPlacing();
    }

    canvas.addEventListener("pointerdown", (event) => {
      /* Keys only reach a canvas that has focus, and clicking one inside a
       * document leaves focus on the document — so Ctrl+Z went to the page
       * editor rather than to the diagram. Pressing the diagram is saying the
       * diagram is what you are working in. Not while typing into the box laid
       * over it, which lives in here and would lose the caret.
       */
      if (!canvas.contains(document.activeElement)) {
        canvas.focus({ preventScroll: true });
      }

      const svg = drawing();
      if (!svg) {
        return;
      }

      // The middle button is a pan and nothing else, on every diagram tool
      // anyone has used, and it is the one gesture that never means select.
      if (viewport && (event.button === 1 || spaceHeld || handTool)) {
        event.preventDefault?.();
        beginPan(event);
        return;
      }

      if (typeof event.button === "number" && event.button > 0) {
        return;
      }

      const point = pointIn(event.clientX, event.clientY);

      /* Armed with a shape, a press on the paper is where that shape goes.
       *
       * Asked before anything that selects or moves, because the whole reason
       * to arm the tool is to say where the next thing goes — a press that
       * first picked up whatever was already under it would drop the new one
       * on top of the old one and start dragging both.
       */
      if (placing) {
        event.preventDefault?.();
        // Putting something else down settles the words being typed, the same
        // as pressing anywhere else on the paper does.
        stopEditing(true);
        const choice = placing;
        usePlaceTool(null);
        placeChoice(choice, point);
        return;
      }

      /* Armed, a drag from a box is an arrow out of it and nothing else.
       *
       * Asked before the handles and before the line, because both of those are
       * ways of doing something to a box that has already been chosen — and the
       * whole point of the tool is the boxes that have not. Selecting the one
       * being dragged from would put its own arrows under the next drag, so
       * drawing the second arrow bent the first.
       */
      if (arrowTool) {
        const from = event.target.closest?.(".dd-node")?.getAttribute("data-id")
          || boxAt(point);

        if (from) {
          beginGesture("connect", from, point, event);
          gesture.tool = true;
          return;
        }
      }

      /* Two taps on a thing, noted before anything that would move it.
       *
       * The second press does not open anything yet — it is a tap only if the
       * hand stays still until it lets go, and until then it may still be the
       * beginning of a drag. So a box is picked up as usual and judged on the
       * way up, and a corner and a line are left alone: pressing a line puts a
       * corner in it, and opening its label should not also bend it.
       */
      tapping = markPress(event, point);

      if (tapping.again) {
        event.preventDefault?.();

        if (tapping.what.kind === "node") {
          /* Inside, one level. A box you are already down to is a box whose
           * words the second press opens, which is what it has always done —
           * so the descent runs out exactly where the typing begins.
           */
          const reach = reachFor(tapping.what.id);

          if (reach && reach.kind === "group") {
            inside = reach.id;
            choose(reachedBy(tapping.what.id));
            tapping.drilled = true;
          } else if (!isSelected(tapping.what.id)) {
            select(tapping.what.id);
          }

          beginGesture("move", tapping.what.id, point, event);
        }

        return;
      }

      const handle = event.target.closest?.("[data-role]");

      if (handle && selectedId) {
        const role = handle.getAttribute("data-role");

        if (role === "via" || role === "pin") {
          gesture = {
            kind: role,
            index: Number(handle.getAttribute("data-edge")),
            at: Number(handle.getAttribute("data-at")),
            end: Number(handle.getAttribute("data-end")),
            origin: point,
            moved: false
          };

          hold(event);
          return;
        }

        beginGesture(role === "resize" ? "resize" : "connect", selectedId, point, event);
        if (gesture) {
          gesture.grip = handle.getAttribute("data-grip") || "se";
        }

        return;
      }

      /* Pressing the line itself bends it: a new corner where the finger went
       * down, dragged from there. Which is how it works everywhere that has
       * ever let anyone bend an arrow, and needs nothing explaining.
       */
      const bendable = event.target.closest?.(".dd-edge");
      const bending = bendable
        && (bendable.getAttribute("data-from") === selectedId
          || bendable.getAttribute("data-to") === selectedId);

      if (bending) {
        const index = Number(bendable.getAttribute("data-edge"));
        const at = addCorner(index, point);

        if (at >= 0) {
          drawAtOnce();
          gesture = { kind: "via", index, at, origin: point, moved: false };
          hold(event);
          return;
        }
      }

      const id = event.target.closest?.(".dd-node")?.getAttribute("data-id") || boxAt(point);

      const adding = Boolean(event.shiftKey);

      if (!id) {
        /* A group is taken hold of by its name.
         *
         * The frame itself is background — a press anywhere inside one lands on
         * the paper — so a rubber band can still be pulled across the boxes in
         * a group, and a box in a group is still just a box to press. Taking
         * hold of the name takes hold of everything inside, which is what makes
         * dragging a group move its contents: there is nothing else to move.
         */
        const onName = groupNameAt(point);

        if (onName) {
          const members = groupMembers(onName);
          // Held from outside, so pressing it again goes into it, the same as
          // pressing one of the boxes it holds.
          inside = groupById(onName)?.parent || null;
          choose(adding ? [...new Set([...selection, ...members])] : members);

          if (members.length > 0) {
            beginGesture("move", members[0], point, event);
          }

          return;
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
          inside = null;
          select(null);
        }

        if (viewport && event.pointerType === "touch") {
          beginPan(event);
        } else if (viewport) {
          beginMarquee(point, event);
        }

        return;
      }

      if (armedFrom && armedFrom !== id) {
        join(armedFrom, id);
        return;
      }

      if (adding) {
        toggleInSelection(id);
        return;
      }

      /* A box in a group is the group, until we have gone inside it.
       *
       * Which is what makes a group one thing rather than a heap of boxes that
       * happen to move together — the frame's name is a way in, not the only
       * way in.
       */
      // A box already in a selection of several is not a new selection — it is
      // the handle you drag the whole lot by. Narrowing to it on the way down
      // would make a multiple selection impossible to move.
      if (!isSelected(id)) {
        choose(reachedBy(id));
      }

      beginGesture("move", id, point, event);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (panning) {
        event.preventDefault?.();
        latest = { x: event.clientX, y: event.clientY };

        if (!frame) {
          frame = later(() => {
            frame = 0;
            if (!panning) {
              return;
            }

            view.x = panning.from.x + (latest.x - panning.x);
            view.y = panning.from.y + (latest.y - panning.y);
            applyView();
          });
        }

        return;
      }

      if (marquee) {
        event.preventDefault?.();
        marquee.to = pointIn(event.clientX, event.clientY);

        if (!frame) {
          frame = later(() => {
            frame = 0;
            if (marquee) {
              drawMarquee();
            }
          });
        }

        return;
      }

      if (!gesture) {
        return;
      }

      const point = pointIn(event.clientX, event.clientY);

      if (!gesture.moved) {
        const far = Math.hypot(point.x - gesture.origin.x, point.y - gesture.origin.y);
        if (far < DIAGRAM_DRAG_SLOP) {
          return;
        }

        gesture.moved = true;

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
        if (gesture.kind === "move") {
          carryToFront(Object.keys(gesture.group));
        }
      }

      // A drag on a touch screen would otherwise scroll the canvas as well as
      // move the box.
      event.preventDefault?.();

      // Coalesced to one update per frame. The last position wins, and the
      // position that is committed comes from the release rather than from here,
      // so nothing depends on how many of these arrived.
      latest = point;
      if (frame) {
        return;
      }

      frame = later(() => {
        frame = 0;
        applyGesture(latest);
      });
    });

    const endGesture = (event) => {
      if (marquee) {
        const band = marqueeBox();
        const held = marquee;
        marquee = null;
        frame = 0;
        drawing()?.querySelector(".dd-marquee")?.remove();

        try {
          canvas.releasePointerCapture?.(event.pointerId);
        } catch {
          // Nothing was captured.
        }

        // A band smaller than a press wobbles is a click on the paper, not a
        // band: a hand that moves two pixels while letting go should not come
        // away holding whatever those two pixels happened to touch. The same
        // slop every other gesture here uses, for the same reason.
        if (band.w > DIAGRAM_DRAG_SLOP || band.h > DIAGRAM_DRAG_SLOP) {
          const caught = boxesIn(band);
          choose(held.adding ? [...new Set([...held.was, ...caught])] : caught);
        }

        return;
      }

      if (panning) {
        /* A pan that ended before its frame arrived is still a pan. The moves
         * are coalesced to one update per frame, and letting go used to throw
         * away whatever had not been drawn yet — so a quick flick was a pan
         * that never happened.
         */
        if (typeof event.clientX === "number") {
          view.x = panning.from.x + (event.clientX - panning.x);
          view.y = panning.from.y + (event.clientY - panning.y);
        }

        panning = null;
        frame = 0;
        canvas.classList.remove("is-panning");
        applyView();

        try {
          canvas.releasePointerCapture?.(event.pointerId);
        } catch {
          // Nothing was captured.
        }

        return;
      }

      if (!gesture) {
        return;
      }

      const held = gesture;
      const point = pointIn(event.clientX, event.clientY);
      gesture = null;
      frame = 0;

      const svg = drawing();
      svg?.querySelector(".dd-draft")?.remove();
      for (const group of svg?.querySelectorAll(".dd-node.is-target") || []) {
        group.classList.remove("is-target");
      }

      try {
        canvas.releasePointerCapture?.(event.pointerId);
      } catch {
        // Nothing was captured.
      }

      if (held.kind === "connect") {
        const over = held.moved ? boxAt(point) : null;

        if (over && over !== held.id) {
          join(held.id, over);
          return;
        }

        /* The circle on a box grows a new box out of it: clicked, beside it;
         * dragged to empty paper, where it was let go.
         *
         * The tool does neither. It is armed to draw an arrow between two boxes
         * that are already there, so a drag that reached neither has drawn
         * nothing — and growing a box out of a tap would be answering a
         * question nobody asked, over and over, for as long as it is on.
         */
        if (held.tool) {
          return;
        }

        if (!held.moved) {
          addBox({ joinFrom: held.id });
          return;
        }

        addBox({ joinFrom: held.id, x: point.x, y: point.y });
        return;
      }

      /* A corner and a pin settle where the pointer was let go, the same way a
       * move does — the drags are coalesced to one a frame, and a quick one can
       * be over before its frame arrives.
       *
       * Before the "did it move at all" test rather than after it, because a
       * press on the line that put a corner in it changed the diagram whether
       * the hand went anywhere afterwards or not.
       */
      if (held.kind === "via") {
        const corner = model.edges[held.index]?.waypoints?.[held.at];
        if (corner) {
          corner.x = snap(point.x);
          corner.y = snap(point.y);
        }

        write();
        drawAtOnce();
        return;
      }

      if (held.kind === "pin") {
        pinEnd(held.index, held.end, point);
        write();
        drawAtOnce();
        return;
      }

      if (!held.moved) {
        return;
      }

      if (held.kind === "move" && held.from) {
        const lined = guidedMove(held.group, point.x - held.origin.x, point.y - held.origin.y);
        moveSelectionTo(held.group, lined.dx, lined.dy);
      }

      if (held.kind === "resize" && held.from) {
        resizeTo(held.id, guidedResize(held.id, held.from, held.grip,
          point.x - held.origin.x, point.y - held.origin.y).at);
      }

      write();
      drawAtOnce();
    };

    /* A picture dropped on the paper is a picture on the paper, where it was
     * dropped. Which is the gesture everybody tries first, and the one that
     * makes the button in the panel a second way rather than the only way.
     *
     * Nothing here is a pointer gesture: a file drag is the browser's own, and
     * it arrives as its own two events whatever the pointer handlers are doing.
     */
    const dropped = (event) =>
      [...(event.dataTransfer?.files || [])].filter((file) =>
        String(file.type || "").startsWith("image/"));

    canvas.addEventListener("dragover", (event) => {
      if (!canUpload || dropped(event).length === 0) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      canvas.classList.add("is-dropping");
    });

    canvas.addEventListener("dragleave", () => canvas.classList.remove("is-dropping"));

    canvas.addEventListener("drop", (event) => {
      canvas.classList.remove("is-dropping");

      const files = dropped(event);
      if (!canUpload || files.length === 0) {
        return;
      }

      event.preventDefault();
      const point = pointIn(event.clientX, event.clientY);
      void putPicture(files[0], { x: point.x, y: point.y });
    });

    canvas.addEventListener("pointerup", endGesture);
    // After the gesture, so a corner is written where it was left before being
    // asked whether it should be there at all.
    canvas.addEventListener("pointerup", liftPress);
    canvas.addEventListener("pointercancel", (event) => {
      if (gesture) {
        gesture = null;
        frame = 0;
        drawing()?.querySelector(".dd-draft")?.remove();
        drawAtOnce();
      }

      try {
        canvas.releasePointerCapture?.(event.pointerId);
      } catch {
        // Nothing was captured.
      }
    });

    /* --- Everything you can do to what is under the pointer ------------------
     *
     * One list, built for whatever was clicked: a box, an arrow, or the paper.
     * Right-click on a pointer, a long press on a finger — a phone has no
     * second button, and hiding half the operations behind one would put them
     * out of reach of half the people using this.
     */
    let menu = null;

    function closeMenu() {
      menu?.remove();
      menu = null;
    }

    function openMenu(clientX, clientY, items) {
      closeMenu();

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
      menu = document.createElement("div");
      menu.className = "context-menu ve-diagram-menu";
      menu.setAttribute("role", "menu");

      for (const item of shown) {
        if (item === "-") {
          const rule = document.createElement("hr");
          rule.className = "context-sep";
          menu.append(rule);
          continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = item.danger ? "context-item danger" : "context-item";
        button.setAttribute("role", "menuitem");
        button.innerHTML = `<i class="ph ${item.icon || "ph-dot"}" aria-hidden="true"></i><span></span>`;
        button.querySelector("span").textContent = item.label;

        if (item.keys) {
          const keys = document.createElement("kbd");
          keys.textContent = item.keys;
          button.append(keys);
        }

        button.addEventListener("click", () => {
          closeMenu();
          item.run();
        });

        menu.append(button);
      }

      const box = canvas.getBoundingClientRect();
      menu.style.left = `${clientX - box.left}px`;
      menu.style.top = `${clientY - box.top}px`;
      canvas.append(menu);

      // Off the right or bottom edge is a menu half of which cannot be read, so
      // it flips back over the point it was opened at rather than being clipped.
      const shape = menu.getBoundingClientRect();
      if (shape.right > box.right) {
        menu.style.left = `${Math.max(0, clientX - box.left - shape.width)}px`;
      }

      if (shape.bottom > box.bottom) {
        menu.style.top = `${Math.max(0, clientY - box.top - shape.height)}px`;
      }
    }

    // Whatever this diagram would say if it were only what is selected. The
    // menu offers it so a box can be taken somewhere that is not this app.
    function selectionSource() {
      if (selection.length === 0) {
        return sourceNow();
      }

      const taken = new Set(selection);
      return DiagramModel.serializeFlowchart({
        direction: model.direction,
        nodes: model.nodes.filter((item) => taken.has(item.id)),
        edges: model.edges.filter((edge) => taken.has(edge.from) && taken.has(edge.to)),
        layout: Object.fromEntries(selection.filter((id) => boxOf(id)).map((id) => [id, boxOf(id)]))
      }).replace(/\n$/, "");
    }

    function copyOutside(text) {
      // Not every browser and not every page will allow it, and a menu item
      // that throws is worse than one that quietly does nothing here.
      try {
        void window.navigator?.clipboard?.writeText?.(text)?.catch?.(() => {});
      } catch {
        // No clipboard to write to.
      }
    }

    /* Which box is drawn over which.
     *
     * The order they are declared in is the order they are drawn in, so moving
     * one along the list is the whole of bringing it forward — and it survives
     * into the file without needing anywhere of its own to be written down.
     */
    function restack(ids, forward) {
      const moving = new Set(ids);
      const staying = model.nodes.filter((item) => !moving.has(item.id));
      const carried = model.nodes.filter((item) => moving.has(item.id));

      model.nodes = forward ? [...staying, ...carried] : [...carried, ...staying];
      write();
      paintLists();
      drawAtOnce();
    }

    /* The bar over the box, put away and brought back.
     *
     * The same item in two menus, written once: it is hidden from the box it is
     * standing over, and it is asked back from the paper, which is where you
     * are when there is no bar to right-click.
     */
    const barItem = () => (viewport
      ? {
        label: panels.barShut ? "Show the bar over the box" : "Hide the bar over the box",
        icon: panels.barShut ? "ph-eye" : "ph-eye-slash",
        run: () => {
          panels.barShut = !panels.barShut;
          rememberPanels();
          paintHud();
        }
      }
      : null);

    function menuFor(target, point) {
      const many = selection.length > 1;
      const holding = selection.length > 0;
      const held = groupHeld();

      if (target.kind === "edge") {
        const edge = model.edges[target.index];
        return [
          { label: "Rename arrow", icon: "ph-text-t", keys: "F2",
            run: () => editEdge(target.index) },
          { label: "Reverse arrow", icon: "ph-arrows-left-right", run: () => {
            const was = edge.from;
            edge.from = edge.to;
            edge.to = was;
            write();
            paintLists();
            drawAtOnce();
          } },
          { label: "Straighten arrow", icon: "ph-line-segment", run: () => {
            delete edge.waypoints;
            delete edge.sides;
            write();
            drawAtOnce();
          } },
          "-",
          { label: "Delete arrow", icon: "ph-trash", keys: "Del", danger: true, run: () => {
            model.edges = model.edges.filter((other) => other !== edge);
            write();
            paintLists();
            paintInspector();
            drawAtOnce();
          } }
        ];
      }

      /* One naming rule, so a menu read twice reads the same way both times:
       * the verb, then what it is being done to, and the same word for the same
       * thing everywhere. "Copy as Mermaid" and "Copy the diagram as Mermaid"
       * were the same item written two ways in two menus.
       */
      if (target.kind === "node") {
        const them = many ? `${selection.length} boxes` : "box";

        return [
          many ? null : {
            label: nodeById(target.id)?.kind === "table" ? "Type in this cell" : "Rename box",
            icon: "ph-text-t",
            keys: "F2",
            run: () => openText(target.id, point)
          },
          many ? null : { label: "Draw arrow from here", icon: "ph-arrow-up-right", run: () => {
            armedFrom = target.id;
            say("Tap another box to join it.");
          } },
          "-",
          { label: `Duplicate ${them}`, icon: "ph-copy", keys: "Ctrl+D", run: duplicateSelection },
          { label: `Cut ${them}`, icon: "ph-scissors", keys: "Ctrl+X", run: cutSelection },
          { label: `Copy ${them}`, icon: "ph-clipboard", keys: "Ctrl+C", run: copySelection },
          { label: `Copy ${them} as Mermaid`, icon: "ph-code",
            run: () => copyOutside(selectionSource()) },
          "-",
          held
            ? { label: "Rename group", icon: "ph-textbox",
              run: () => paintInspector({ focusName: true }) }
            : null,
          held
            ? { label: `Ungroup ${them}`, icon: "ph-selection-slash",
              keys: "Ctrl+Shift+G", run: ungroupSelection }
            : null,
          many && !held
            ? { label: `Group ${them}`, icon: "ph-selection-plus",
              keys: "Ctrl+G", run: groupSelection }
            : null,
          "-",
          barItem(),
          "-",
          { label: "Bring to front", icon: "ph-stack-simple",
            run: () => restack(selection, true) },
          { label: "Send to back", icon: "ph-stack-simple",
            run: () => restack(selection, false) },
          "-",
          { label: `Delete ${them}`, icon: "ph-trash", keys: "Del", danger: true,
            run: () => removeSteps(selection) }
        ];
      }

      return [
        { label: "Add box here", icon: "ph-plus-square",
          run: () => addBox({ x: point.x, y: point.y }) },
        { label: "Paste", icon: "ph-clipboard", keys: "Ctrl+V", run: pasteClipboard },
        "-",
        { label: arrowTool ? "Stop drawing arrows" : "Draw arrows",
          icon: "ph-arrow-up-right",
          keys: arrowTool ? "V" : "A",
          run: () => useArrowTool(!arrowTool) },
        viewport
          ? {
            label: handTool ? "Stop moving about" : "Drag to move about",
            icon: "ph-hand",
            keys: handTool ? "V" : "H",
            run: () => useHand(!handTool)
          }
          : null,
        "-",
        { label: "Select all boxes", icon: "ph-selection-all", keys: "Ctrl+A",
          run: () => choose(model.nodes.map((item) => item.id)) },
        holding
          ? { label: "Select none", icon: "ph-selection-slash", keys: "Esc",
            run: () => select(null) }
          : null,
        viewport
          ? { label: "Fit diagram to the window", icon: "ph-corners-out", run: () => fitView() }
          : null,
        barItem(),
        "-",
        { label: "Copy diagram as Mermaid", icon: "ph-code",
          run: () => copyOutside(sourceNow()) }
      ];
    }

    // What is under a point, asked the same way for both ways of asking.
    function targetAt(event, point) {
      const group = event.target.closest?.(".dd-node");
      const id = group?.getAttribute("data-id") || boxAt(point);
      if (id) {
        return { kind: "node", id };
      }

      const line = event.target.closest?.(".dd-edge");
      if (line) {
        return { kind: "edge", index: Number(line.getAttribute("data-edge")) };
      }

      const onName = groupNameAt(point);
      if (onName) {
        return { kind: "group", id: onName };
      }

      return { kind: "paper" };
    }

    function showMenuFrom(event) {
      const point = pointIn(event.clientX, event.clientY);
      const target = targetAt(event, point);

      // Right-clicking a box that is not in the selection is about that box —
      // or about the group it is in, the same as pressing it. Right-clicking
      // one that is already held is about the whole handful.
      if (target.kind === "node" && !isSelected(target.id)) {
        choose(reachedBy(target.id));
      }

      // And right-clicking a group's name is about the group, so it is held
      // first — the menu is then the menu for what is held.
      let about = target;

      if (target.kind === "group") {
        const members = groupMembers(target.id);
        choose(members);
        // The menu for a group's name is the menu for what is in it, which is
        // where grouping and ungrouping already live.
        about = members.length > 0 ? { kind: "node", id: members[0] } : { kind: "paper" };
      }

      openMenu(event.clientX, event.clientY, menuFor(about, point));
    }

    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showMenuFrom(event);
    });

    /* A finger has no second button, so it holds still instead.
     *
     * Cancelled by moving, because a press that turns into a drag was a drag
     * all along, and by letting go, because that was a tap.
     */
    let pressTimer = 0;
    const forgetPress = () => {
      window.clearTimeout(pressTimer);
      pressTimer = 0;
    };

    canvas.addEventListener("pointerdown", (event) => {
      closeMenu();

      if (event.pointerType !== "touch") {
        return;
      }

      const held = { clientX: event.clientX, clientY: event.clientY, target: event.target };
      forgetPress();
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
        // Whatever the finger had started is abandoned: it turned out to be a
        // request for the menu, not the beginning of a drag.
        gesture = null;
        panning = null;
        canvas.classList.remove("is-panning");
        showMenuFrom(held);
      }, LONG_PRESS);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (pressTimer && event.pointerType === "touch") {
        forgetPress();
      }
    });

    canvas.addEventListener("pointerup", forgetPress);
    canvas.addEventListener("pointercancel", forgetPress);

    /* --- Carrying boxes about -----------------------------------------------
     *
     * What is copied is the boxes and the arrows that run wholly between them:
     * an arrow with one end outside the selection has nowhere to arrive when it
     * is pasted, and inventing an end for it would be inventing a diagram.
     */
    function copySelection() {
      if (selection.length === 0) {
        return null;
      }

      const taken = new Set(selection);
      const cut = {
        nodes: model.nodes.filter((item) => taken.has(item.id)).map((item) => ({ ...item })),
        edges: model.edges
          .filter((edge) => taken.has(edge.from) && taken.has(edge.to))
          .map((edge) => ({ ...edge })),
        layout: {}
      };

      for (const id of taken) {
        const at = boxOf(id);
        if (at) {
          cut.layout[id] = { ...at };
        }
      }

      clipboard = cut;
      return cut;
    }

    /* Putting them back, as new things.
     *
     * Every box gets a name nothing is using, and the arrows are rewritten to
     * the new names — otherwise pasting a copy would be declaring the same box
     * twice, and the file would come back with one of them.
     */
    function pasteClipboard() {
      if (!clipboard || clipboard.nodes.length === 0) {
        return;
      }

      const renamed = new Map();
      const fresh = [];

      for (const item of clipboard.nodes) {
        // Asked of the model as it grows, so two boxes pasted at once cannot
        // both be given the same new name.
        const id = DiagramModel.nextNodeId({ nodes: [...model.nodes, ...fresh] });
        renamed.set(item.id, id);
        fresh.push({ ...item, id });
      }

      model.nodes.push(...fresh);

      for (const item of clipboard.nodes) {
        const at = clipboard.layout[item.id];
        if (at) {
          model.layout[renamed.get(item.id)] = {
            ...at,
            x: at.x + PASTE_OFFSET,
            y: at.y + PASTE_OFFSET
          };
        }
      }

      for (const edge of clipboard.edges) {
        model.edges.push({ ...edge, from: renamed.get(edge.from), to: renamed.get(edge.to) });
      }

      write();
      paintLists();
      // What was just pasted is what you want to move, so it is what is held.
      choose([...renamed.values()]);
    }

    function cutSelection() {
      if (!copySelection()) {
        return;
      }

      removeSteps(selection);
    }

    // The same as copy then paste, and worth its own keystroke because it is
    // the commonest thing anyone does with either of them.
    function duplicateSelection() {
      const held = clipboard;
      if (copySelection()) {
        pasteClipboard();
      }

      // Duplicating is not copying: whatever was on the clipboard before is
      // still what a paste should put down.
      clipboard = held || clipboard;
    }

    /* --- Typing into the diagram itself -------------------------------------
     *
     * The options panel edits the same words, and both stay: a panel is how you
     * find a setting you have never used, and typing into the thing itself is
     * how you rename a box you are looking at. The spec asks for both, and they
     * edit the same model.
     *
     * The box is a real textarea laid over the shape, sized and positioned in
     * screen coordinates from where the shape is in the diagram — so it stays
     * over its box while the view is panned or zoomed under it.
     */
    let editing = null;

    function placeEditor() {
      if (!editing) {
        return;
      }

      const at = editing.box();
      if (!at) {
        stopEditing(false);
        return;
      }

      const style = editing.field.style;
      style.left = `${(at.x * view.scale) + view.x}px`;
      style.top = `${(at.y * view.scale) + view.y}px`;
      style.width = `${at.w * view.scale}px`;
      style.height = `${at.h * view.scale}px`;
      /* Scaled with the diagram and set in the type the words are drawn in, so
       * what is typed is the size it will be. A field that is always 13px is a
       * word that changes size the moment you stop typing.
       */
      style.fontSize = `${(editing.size || DiagramModel.TEXT_SIZE) * view.scale}px`;
    }

    function startEditing(what) {
      stopEditing(true);

      const field = document.createElement("textarea");
      /* A cell is drawn against its left wall and a label in the middle of its
       * box. A field that does not agree is a word that jumps the moment you
       * stop typing.
       */
      field.className = `ve-diagram-inline${what.left ? " ve-diagram-inline-left" : ""}`;
      field.value = what.read();
      field.setAttribute("aria-label", what.label);
      field.spellcheck = false;

      editing = { ...what, field, was: what.read() };
      canvas.append(field);
      placeEditor();
      field.focus();
      field.select();

      field.addEventListener("keydown", (event) => {
        // Escape belongs to whatever is being typed into, not to the canvas
        // underneath it, which would take it as "let go of this box".
        event.stopPropagation();

        if (event.key === "Escape") {
          event.preventDefault();
          stopEditing(false);
          canvas.focus();
          return;
        }

        // Enter commits and shift-enter is a line break, the way it is in every
        // box anyone has typed a label into.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          stopEditing(true);
          canvas.focus();
          return;
        }

        /* Tab walks the grid, the way it does in every table anybody has ever
         * typed into. Without it a table is filled in by double-clicking it
         * once per cell, which is the panel's job done worse.
         */
        if (what.cell && event.key === "Tab") {
          event.preventDefault();
          stopEditing(true);

          const next = cellAlong(what.id, what.cell, event.shiftKey ? -1 : 1);
          if (next) {
            editCell(what.id, next.row, next.column);
          } else {
            canvas.focus();
          }
        }
      });

      // Clicking away is agreeing with what you typed, not throwing it away.
      field.addEventListener("blur", () => stopEditing(true));
    }

    function stopEditing(keep) {
      if (!editing) {
        return;
      }

      const held = editing;
      editing = null;
      const typed = held.field.value;
      held.field.remove();

      if (keep && typed !== held.was) {
        held.write(typed);
        write();
        paintLists();
        paintInspector();
      }

      drawAtOnce();
    }

    // The cells of a table in the order Tab walks them, which is the order the
    // drawing lays them out in — the same run, asked for once.
    function cellRun(item, at) {
      return DiagramDraw.cellBoxes(DiagramModel.textCells(item.text || ""),
        at.w, at.h, DiagramModel.tableMetrics(item));
    }

    function cellAlong(id, from, step) {
      const item = nodeById(id);
      const at = item && boxOf(id);
      if (!at) {
        return null;
      }

      const cells = cellRun(item, at);
      const now = cells.findIndex((one) =>
        one.row === from.row && one.column === from.column);

      return now < 0 ? null : cells[now + step] || null;
    }

    /* One cell of a table, typed into where it is drawn.
     *
     * A table opened as a single field of pipes is a table you edit by counting
     * walls: which of these words is in the second column is a question you
     * answer by looking very carefully. The drawing already knows where every
     * cell is, so the field goes exactly where the words are — the same
     * arithmetic, asked of the same place.
     */
    function editCell(id, row, column) {
      const item = nodeById(id);
      if (item?.kind !== "table") {
        return;
      }

      const where = () => {
        const at = boxOf(id);
        const found = at && cellRun(item, at)
          .find((one) => one.row === row && one.column === column);

        return found
          ? { x: at.x + found.x, y: at.y + found.y, w: found.w, h: found.h }
          : null;
      };

      select(id);
      startEditing({
        label: row === 0 ? "Table title" : `Row ${row}, column ${column + 1}`,
        size: DiagramDraw.cellSize(
          (item.cells || {})[DiagramModel.cellKey(row, column)] || "",
          DiagramDraw.sizeOf(item, model.classes)),
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
          grow(item);
        }
      });
    }

    function editNode(id) {
      const item = nodeById(id);
      if (!item) {
        return;
      }

      // A table's words belong to its cells, so they are typed into one of
      // those rather than into one field of everything with pipes in it.
      if (item.kind === "table") {
        editCell(id, 0, 0);
        return;
      }

      select(id);
      startEditing({
        label: "Box text",
        size: DiagramDraw.sizeOf(item, model.classes),
        box: () => boxOf(id),
        read: () => DiagramModel.textRows(item.text || "").join("\n"),
        write: (value) => {
          item.text = DiagramModel.joinRows(value.split("\n"));
        }
      });
    }

    function editEdge(index) {
      const edge = model.edges[index];
      if (!edge) {
        return;
      }

      // An arrow has no box to type in, so one is borrowed: a small field where
      // its label is drawn, which is where anyone would expect to type.
      const where = () => {
        const from = boxOf(edge.from);
        const to = boxOf(edge.to);
        if (!from || !to) {
          return null;
        }

        const x = ((from.x + (from.w / 2)) + (to.x + (to.w / 2))) / 2;
        const y = ((from.y + (from.h / 2)) + (to.y + (to.h / 2))) / 2;
        return { x: x - 50, y: y - 12, w: 100, h: 24 };
      };

      startEditing({
        label: "Arrow label",
        box: where,
        read: () => String(edge.label || ""),
        write: (value) => {
          edge.label = value.replace(/\n/g, " ").trim();
        }
      });
    }

    /* The words under the pointer, whatever they belong to: a box's label, or
     * the one cell of a table that was actually double-clicked. Asked without a
     * point — from a key, or from a box that has only just been made — it opens
     * the first thing anybody would want to type, which for a table is its
     * title.
     */
    function openText(id, point) {
      const item = nodeById(id);
      const at = boxOf(id);

      if (item?.kind === "table" && at && point) {
        const found = DiagramDraw.cellAt(DiagramModel.textCells(item.text || ""),
          at.w, at.h, DiagramModel.tableMetrics(item), point.x - at.x, point.y - at.y);

        editCell(id, found ? found.row : 0, found ? found.column : 0);
        return;
      }

      editNode(id);
    }

    /* --- Two taps on the same thing -----------------------------------------
     *
     * Counted here rather than left to the browser's own `dblclick`, which
     * never arrived on a box and so left the words editable only from the
     * panel.
     *
     * The first press selects what was pressed, and selecting is
     * `canvas.innerHTML = …` — so by the time the second press lands, the
     * element the browser was counting clicks against has been thrown away and
     * replaced by a new one drawing the same box. A click count only survives
     * on one element, so it started again from one; and the canvas takes the
     * pointer for the length of a drag besides, which moves the compatibility
     * events off the shape as well.
     *
     * So the count is kept against what was pressed — this box, this corner,
     * this arrow — which is a name that outlives any number of redraws. It is
     * also what a finger does, so a double tap opens a box on a phone without
     * a second mechanism for it.
     */
    const TAP_AGAIN = 400;
    const TAP_NEAR = 6;
    let lastTap = null;
    let tapping = null;

    // What a press is about, said in a way that does not name the element
    // drawing it. The order is the order a press is read in: a corner sits on
    // top of the line it bends, and a box on top of the paper.
    function pressedOn(event, point) {
      const corner = event.target.closest?.(".dd-via");
      if (corner) {
        return {
          kind: "via",
          edge: Number(corner.getAttribute("data-edge")),
          at: Number(corner.getAttribute("data-at"))
        };
      }

      const id = event.target.closest?.(".dd-node")?.getAttribute("data-id") || boxAt(point);
      if (id) {
        return { kind: "node", id };
      }

      const line = event.target.closest?.(".dd-edge");
      return line ? { kind: "edge", edge: Number(line.getAttribute("data-edge")) } : null;
    }

    const samePress = (one, two) => Boolean(one) && Boolean(two)
      && one.kind === two.kind && one.id === two.id
      && one.edge === two.edge && one.at === two.at;

    const nearly = (event, spot) => Math.abs(event.clientX - spot.x) <= TAP_NEAR
      && Math.abs(event.clientY - spot.y) <= TAP_NEAR;

    // What is being pressed, and whether it is the same thing the last tap was
    // on — soon enough after it, and near enough to it, to be the second of a
    // pair rather than one more press.
    function markPress(event, point) {
      const what = pressedOn(event, point);
      const again = Boolean(what) && samePress(what, lastTap)
        && Date.now() - lastTap.when <= TAP_AGAIN && nearly(event, lastTap);

      return { what, point, x: event.clientX, y: event.clientY, again };
    }

    /* Letting go is what settles it. A press that went somewhere was a drag,
     * and a drag is not a tap however quickly it followed the last one —
     * clicking a box and then dragging it is two things a person does in a row,
     * not a double click.
     */
    function liftPress(event) {
      const held = tapping;
      tapping = null;

      if (!held?.what || !nearly(event, held)) {
        // A drag also breaks the pair it might have started.
        lastTap = null;
        return;
      }

      if (held.again) {
        // Three taps are a pair and then a tap, not three pairs.
        lastTap = null;

        // A press that went one level into a group has already done what the
        // pair was for.
        if (!held.drilled) {
          openTapped(held.what, held.point);
        }

        return;
      }

      lastTap = { ...held.what, when: Date.now(), x: held.x, y: held.y };
    }

    function openTapped(what, point) {
      if (what.kind === "via") {
        // A corner put in by hand is taken out the same way a box is opened.
        dropCorner(what.edge, what.at);
        return;
      }

      if (what.kind === "node") {
        openText(what.id, point);
        return;
      }

      editEdge(what.edge);
    }

    /* --- Getting about ------------------------------------------------------
     *
     * A wheel means "move about" and Ctrl means "zoom", which is what they mean
     * in Figma, in Canva and in every map anybody has ever scrolled. A
     * trackpad's two-finger scroll arrives here as a wheel carrying both deltas
     * and its pinch arrives as a wheel with ctrlKey set, so the browser has
     * already spelled both of them correctly.
     *
     * A bare wheel used to zoom, and that left a diagram which had been zoomed
     * away to one side with no way back: the only thing the wheel could do was
     * zoom it further. Two fingers pinch. Space held, the middle button, or the
     * hand turn a drag into a pan.
     */
    if (viewport) {
      canvas.addEventListener("wheel", (event) => {
        event.preventDefault();

        if (event.ctrlKey || event.metaKey) {
          // The sign and a fixed ratio, not the distance: what a notch reports
          // varies by an order of magnitude between a mouse and a trackpad.
          const notches = event.deltaY > 0 ? -1 : 1;
          zoomAbout(event.clientX, event.clientY, ZOOM_PER_NOTCH ** notches);
          return;
        }

        /* Shift is sideways on a mouse with only one wheel. Some browsers do
         * that translation themselves and send it as deltaX; the ones that do
         * not send deltaY with shiftKey set — so both spellings have to be read
         * or half the mice in the world scroll nothing at all.
         */
        const sideways = event.shiftKey && event.deltaX === 0;
        view.x -= sideways ? event.deltaY : event.deltaX;
        view.y -= sideways ? 0 : event.deltaY;
        applyView();
      }, { passive: false });

      // A canvas that keeps thinking the space bar is down after the window has
      // gone away is a canvas where nothing can be selected any more.
      window.addEventListener("blur", () => {
        spaceHeld = false;
        showGrab();
      });
    }

    /* Two fingers: pinch to zoom, and the midpoint between them to pan.
     *
     * Tracked here rather than as a gesture because it starts halfway through
     * whatever the first finger was already doing — and that gesture has to be
     * abandoned rather than finished, or a pinch leaves a box wherever the first
     * finger happened to be when the second arrived.
     */
    const touches = new Map();
    let pinch = null;

    const spanOf = () => {
      const [a, b] = [...touches.values()];
      return {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
      };
    };

    if (viewport) {
      canvas.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch") {
          return;
        }

        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size !== 2) {
          return;
        }

        // Whatever one finger had started is abandoned: two fingers are a
        // different intention, and finishing the first would move a box.
        gesture = null;
        panning = null;
        canvas.classList.remove("is-panning");
        drawing()?.querySelector(".dd-draft")?.remove();

        const span = spanOf();
        pinch = { span, from: { x: view.x, y: view.y }, scale: view.scale };
      });

      canvas.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "touch" || !touches.has(event.pointerId)) {
          return;
        }

        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (!pinch || touches.size !== 2) {
          return;
        }

        event.preventDefault();
        const span = spanOf();
        if (pinch.span.distance <= 0) {
          return;
        }

        const next = clampScale(pinch.scale * (span.distance / pinch.span.distance));
        const rect = canvas.getBoundingClientRect();
        const sx = pinch.span.x - rect.left;
        const sy = pinch.span.y - rect.top;

        // The point between the fingers stays under them, and the fingers
        // themselves are allowed to travel — so a pinch pans as well as zooms,
        // which is what makes it feel like moving a piece of paper.
        view.scale = next;
        view.x = (sx - ((sx - pinch.from.x) * next / pinch.scale)) + (span.x - pinch.span.x);
        view.y = (sy - ((sy - pinch.from.y) * next / pinch.scale)) + (span.y - pinch.span.y);
        applyView();
      }, { passive: false });

      const liftFinger = (event) => {
        if (event.pointerType !== "touch") {
          return;
        }

        touches.delete(event.pointerId);
        if (touches.size < 2) {
          pinch = null;
        }
      };

      canvas.addEventListener("pointerup", liftFinger);
      canvas.addEventListener("pointercancel", liftFinger);
    }

    /* A key the canvas has answered is not also the document's key.
     *
     * The builder can be mounted inside the page editor, which listens for
     * Ctrl+Z, Ctrl+S and Escape of its own. Without this, undoing a box also
     * undid the whole document — and the document coming back re-rendered the
     * block, taking the builder with it.
     */
    const answered = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    /* Not while typing. A space is a space, an h is an h, and Backspace takes a
     * letter off rather than taking the box away.
     */
    const typingIn = (target) => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "")
      || target?.isContentEditable === true;

    /* A control that uses the key itself keeps it. Enter and Space on a button
     * are how a button is pressed, and a shortcut that swallowed them would be
     * a panel nobody could work from the keyboard.
     */
    const ACTIVATED_BY_KEY = /^(?:BUTTON|A|SUMMARY)$/;

    // Letting the space bar go, wherever the focus had wandered to while it was
    // down. A canvas that still thinks the bar is held is a canvas where nothing
    // can be selected any more.
    function onKeyUp(event) {
      if (viewport && (event.key === " " || event.code === "Space")) {
        spaceHeld = false;
        showGrab();
      }
    }

    function onKey(event) {
      /* Something nearer the keystroke has already answered it: the field being
       * typed into, or the grip being widened with the arrow keys.
       */
      if (event.defaultPrevented || typingIn(event.target)) {
        return;
      }

      if (ACTIVATED_BY_KEY.test(event.target?.tagName || "")
        && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
        return;
      }

      if (viewport && (event.key === " " || event.code === "Space")) {
        answered(event);
        spaceHeld = true;
        canvas.classList.add("is-panning-armed");
        return;
      }

      /* The hand and the pointer, on the keys they have in every editor that
       * offers both.
       */
      if (viewport && !(event.ctrlKey || event.metaKey || event.altKey)
        && /^[hv]$/i.test(event.key)) {
        answered(event);
        useHand(event.key.toLowerCase() === "h");

        // V is the pointer, and the pointer is neither of the modes.
        if (event.key.toLowerCase() === "v") {
          useArrowTool(false);
        }

        return;
      }

      /* A for arrow. V puts it away with the hand, because V is the pointer in
       * every editor with a toolbox and putting one mode away while leaving
       * another on would be a V that half worked.
       *
       * Not Ctrl+A, which is select-all and is answered further down.
       */
      if (!(event.ctrlKey || event.metaKey || event.altKey)
        && /^[av]$/i.test(event.key)) {
        answered(event);
        useArrowTool(event.key.toLowerCase() === "a");
        return;
      }

      /* Back and forward. Both spellings of redo, because half the world
       * learned Ctrl+Y and the other half Ctrl+Shift+Z, and neither half is
       * going to be talked out of it.
       */
      if (event.ctrlKey || event.metaKey) {
        const key = String(event.key).toLowerCase();

        if (key === "c" && selection.length > 0) {
          answered(event);
          copySelection();
          return;
        }

        if (key === "x" && selection.length > 0) {
          answered(event);
          cutSelection();
          return;
        }

        if (key === "v") {
          answered(event);
          pasteClipboard();
          return;
        }

        if (key === "d" && selection.length > 0) {
          answered(event);
          duplicateSelection();
          return;
        }

        /* Grouping and ungrouping, on the keys every canvas uses for them.
         * Ungrouping is asked for first because Ctrl+Shift+G is also Ctrl+G,
         * and the shift is the whole difference between the two.
         */
        if (key === "g" && event.shiftKey) {
          answered(event);
          ungroupSelection();
          return;
        }

        if (key === "g" && selection.length > 1) {
          answered(event);
          groupSelection();
          return;
        }

        if (key === "z" && !event.shiftKey) {
          answered(event);
          undo();
          return;
        }

        if ((key === "z" && event.shiftKey) || key === "y") {
          answered(event);
          redo();
          return;
        }
      }

      // The one keystroke that does not need anything selected already.
      if ((event.ctrlKey || event.metaKey) && (event.key === "a" || event.key === "A")) {
        answered(event);
        choose(model.nodes.map((item) => item.id));
        return;
      }

      /* Escape dismisses one thing at a time. The list first, then the
       * selection — and only then is it allowed out to whatever is around the
       * builder, so a press with nothing to dismiss can still leave. */
      if (event.key === "Escape") {
        if (menu) {
          event.stopPropagation();
          closeMenu();
          return;
        }

        // A mode is a mode, and a mode wants a way out that does not involve
        // finding the button that turned it on.
        if (placing) {
          event.stopPropagation();
          usePlaceTool(null);
          return;
        }

        if (arrowTool) {
          event.stopPropagation();
          useArrowTool(false);
          return;
        }

        if (handTool) {
          event.stopPropagation();
          useHand(false);
          return;
        }

        // Up one level first, to the group we went into. Only when we are back
        // at the top of the diagram does Escape mean "nothing".
        if (stepOutside()) {
          event.stopPropagation();
          return;
        }

        if (selection.length > 0) {
          event.stopPropagation();
          select(null);
        }

        return;
      }

      if (selection.length === 0) {
        return;
      }

      /* The way into a box that does not need a pointing device, and the one
       * every other editor already has. F2 as well as Enter, because that is
       * the key in a file manager and in StarUML, and one of the two is what
       * anybody's hands reach for first. A handful has no one label to type
       * into, so it answers the key and does nothing with it.
       */
      if (event.key === "Enter" || event.key === "F2") {
        answered(event);
        if (selection.length === 1) {
          openText(selection[0]);
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        answered(event);
        removeSteps(selection);
        return;
      }

      const nudge = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }[event.key];

      if (!nudge) {
        return;
      }

      /* Two different things, and they were the same thing until now.
       *
       * Dragging snaps, because a box put down by hand should line up with the
       * ones already there. An arrow key does not, because the reason to reach
       * for one is that the grid has put something two pixels from where you
       * want it. Shift is the coarse one: a whole grid step, landing on the
       * grid rather than a step away from wherever the box happens to be.
       */
      answered(event);
      for (const id of selection) {
        const at = boxOf(id);
        if (!at) {
          continue;
        }

        if (event.shiftKey) {
          moveTo(id, snap(at.x) + (nudge[0] * DiagramModel.GRID),
            snap(at.y) + (nudge[1] * DiagramModel.GRID));
        } else {
          placeAt(id, at.x + nudge[0], at.y + nudge[1]);
        }
      }

      write({ atOnce: false });
      drawSoon();
    }

    /* --- Making things ------------------------------------------------------ */

    function addBox(options = {}) {
      if (model.nodes.length >= DiagramModel.MAX_NODES) {
        say("That is as many steps as this can hold.");
        return;
      }

      // What the thing is, as the rail offered it, and a box for anything the
      // rail did not name — one list, so a new kind is one entry rather than
      // another branch here.
      const kind = DiagramModel.NODE_KINDS.includes(options.kind)
        ? options.kind
        : "box";
      const id = DiagramModel.nextNodeId(model);
      const item = {
        id,
        shape: options.shape || "rect",
        // A table arrives as a table: a heading and a grid of empty cells, so
        // that what lands on the paper is the thing that was dragged off the
        // rail rather than a box with one word in it and a rule underneath.
        text: options.text ?? (kind === "table"
          ? DiagramModel.joinCells([["Table"], ["", ""], ["", ""]])
          : `Step ${model.nodes.length + 1}`)
      };

      // What a box is belongs to the box. Where it is belongs to the layout.
      if (kind !== "box") {
        item.kind = kind;
      }

      // A picture and an icon are not shapes, so they do not decide what the box
      // is — they are more things the box is carrying, like its colour. Nor is
      // the frame, which is only whether the shape is drawn at all.
      if (options.image) {
        item.image = options.image;
      }

      if (options.icon) {
        item.icon = options.icon;
      }

      if (options.frame === "none") {
        item.frame = "none";
      }

      model.nodes.push(item);

      /* How big it starts. A picture wants room to be a picture in — measuring
       * one by the words under it would drop it into a box the size of its
       * caption.
       */
      const size = options.size || DiagramModel.measureNode(item);
      const where = placeFor(options, size);
      model.layout[id] = { x: where.x, y: where.y, w: size.w, h: size.h };

      // A step with nothing pointing at it is not in the flowchart at all — it is
      // drawn off to one side on its own. Joining it to the box it was grown from
      // is the whole meaning of growing it from there.
      if (options.joinFrom && model.edges.length < DiagramModel.MAX_EDGES) {
        model.edges.push({ from: options.joinFrom, to: id, kind: "arrow", label: "" });
      }

      write();
      paintLists();

      /* A box just put down is a box about to be named, and the place to name
       * it is the box itself. The caret used to go to a field in a panel on the
       * other side of the screen, which is a long way to look for the word you
       * were already typing.
       */
      if (viewport && !options.image && !options.icon) {
        select(id);
        openText(id);
      } else {
        // A picture is not named by being dropped, and a caret blinking over a
        // photograph is a question nobody asked.
        select(id, { focusName: true });
      }
    }

    // Where a new box goes: where it was dropped, or clear of the one it was
    // grown from, or clear of everything.
    function placeFor(options, size) {
      if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
        return { x: snap(options.x - (size.w / 2)), y: snap(options.y - (size.h / 2)) };
      }

      const from = options.joinFrom ? boxOf(options.joinFrom) : null;
      if (from) {
        const below = { x: snap(from.x + ((from.w - size.w) / 2)), y: snap(from.y + from.h + 90) };
        return free(below, size);
      }

      const bottom = Object.values(model.layout)
        .reduce((most, at) => Math.max(most, at.y + at.h), 0);

      return { x: DiagramModel.MARGIN, y: snap(bottom === 0 ? DiagramModel.MARGIN : bottom + 60) };
    }

    // Nudged sideways until it is not on top of anything. Twelve tries, because a
    // box that cannot find a gap is better placed overlapping than placed a
    // screen away from the diagram it belongs to.
    function free(where, size) {
      const clashes = (at) => Object.values(model.layout).some((other) => at.x < other.x + other.w
        && at.x + size.w > other.x
        && at.y < other.y + other.h
        && at.y + size.h > other.y);

      let spot = { ...where };

      for (let tries = 0; tries < 12 && clashes(spot); tries += 1) {
        spot = { x: snap(spot.x + size.w + 40), y: spot.y };
      }

      return spot;
    }

    function join(from, to) {
      if (model.edges.length >= DiagramModel.MAX_EDGES) {
        say("That is as many arrows as this can hold.");
        return;
      }

      model.edges.push({ from, to, kind: "arrow", label: "" });
      write();
      paintLists();
      select(from);
    }

    function removeStep(id) {
      removeSteps([id]);
    }

    // All of them in one go rather than one at a time: removing nine boxes in
    // nine steps writes the file nine times and redraws it nine times, and an
    // arrow between two of them would be removed twice.
    function removeSteps(ids) {
      const going = new Set(ids);
      model.nodes = model.nodes.filter((item) => !going.has(item.id));
      // An arrow to a step that is no longer there would declare it again by
      // naming it, and the step would come back as an empty box.
      model.edges = model.edges.filter((edge) => !going.has(edge.from) && !going.has(edge.to));
      for (const id of going) {
        delete model.layout[id];
      }

      // Before the file is written, not after: a group emptied by a delete is
      // gone from the drawing at once, and a file that still had it would put
      // it back on the next read.
      tidyGroups();
      write();
      paintLists();
      select(null);
    }

    /* --- Groups -------------------------------------------------------------
     *
     * A group is a name over a handful of boxes, and nothing else. It has no
     * rectangle of its own — the drawing works one out from what is inside it,
     * every time — so grouping is writing a parent on each member and
     * ungrouping is taking it off again. There is no geometry here to keep in
     * step with the boxes, which is why dragging a grouped box needs no code
     * in this section at all: the frame follows because it is made of them.
     */

    const groupsNow = () => (Array.isArray(model.groups) ? model.groups : []);
    const groupById = (id) => groupsNow().find((group) => group.id === id) || null;

    /* Which group we have gone inside, or null for the top of the diagram.
     *
     * A group is one thing to press, so pressing a box in one takes hold of the
     * group. That would leave no way to reach the box, which is why every
     * editor shaped like this has a way in: pressing again goes one level down,
     * and Escape comes back up. This is where we are in that descent, and it is
     * the only state here that is about looking rather than about the diagram —
     * it is never written to the file and never survives the group it names.
     */
    let inside = null;

    // Whether the tree has been built yet. Selecting something before it has is
    // a mark with nothing to put it on.
    let listed = false;

    // Every group above a thing, nearest first.
    function groupsAbove(parent) {
      const chain = [];
      const seen = new Set();

      for (let at = groupById(parent); at && !seen.has(at.id); at = groupById(at.parent)) {
        seen.add(at.id);
        chain.push(at.id);
      }

      return chain;
    }

    /* What one press on a box takes hold of.
     *
     * The outermost group it is in that we have not gone inside — so at the top
     * of the diagram a box in a group is the whole group, and having gone into
     * that group it is whatever is directly in it, which may be another group.
     * A box in no group we are outside of is itself.
     */
    function reachFor(id) {
      const node = nodeById(id);
      if (!node) {
        return null;
      }

      const chain = groupsAbove(node.parent);
      const depth = inside ? chain.indexOf(inside) : chain.length;

      // Somewhere else entirely: the press has left the group we were in, so
      // it is read from the top again.
      const from = depth < 0 ? chain.length : depth;
      return from > 0 ? { kind: "group", id: chain[from - 1] } : { kind: "node", id };
    }

    // What a press takes hold of, as a list of boxes to select.
    const reachedBy = (id) => {
      const reach = reachFor(id);
      return reach && reach.kind === "group" ? groupMembers(reach.id) : [id];
    };

    // Coming back out, to the group we were in the middle of.
    function stepOutside() {
      const was = inside;
      if (!was) {
        return false;
      }

      inside = groupById(was)?.parent || null;
      choose(groupMembers(was));
      return true;
    }

    // Everything in a group, and everything in the groups inside it, however
    // deep. A box belongs to one group directly and to every group above it.
    function groupMembers(id) {
      const inside = new Set([id]);

      for (let again = true; again;) {
        again = false;

        for (const group of groupsNow()) {
          if (!inside.has(group.id) && inside.has(group.parent)) {
            inside.add(group.id);
            again = true;
          }
        }
      }

      return model.nodes.filter((node) => inside.has(node.parent)).map((node) => node.id);
    }

    /* The group that is selected, worked out rather than remembered.
     *
     * A group is selected exactly when what is held is everything in it and
     * nothing else. Keeping a separate "the group you clicked" would be a
     * second fact about the selection that could disagree with the first, and
     * the two would have to be put back in step after every edit.
     *
     * Innermost wins: a group whose only member is another group holds exactly
     * the same boxes, and the one you meant is the closer of the two.
     */
    function groupHeld() {
      if (selection.length === 0) {
        return null;
      }

      const chosen = [...selection].sort().join("\u0000");
      const depths = DiagramDraw.groupDepths(groupsNow());
      const matches = groupsNow().filter((group) => {
        const members = groupMembers(group.id);
        return members.length === selection.length
          && members.sort().join("\u0000") === chosen;
      });

      return matches.sort((one, two) =>
        (depths.get(two.id) || 0) - (depths.get(one.id) || 0))[0] || null;
    }

    // Where every group's name is written, which is the only part of a frame
    // that can be taken hold of. The frame itself is background: a press inside
    // one lands on the paper, so a rubber band can still be pulled across a
    // group.
    const framesNow = () => DiagramDraw.groupBoxes(model, model.layout);

    function groupNameAt(point) {
      const frames = framesNow();

      /* No order to decide here. A group inside a group starts a full padding
       * below the outer name, so two names can never be over the same point,
       * and the first frame whose band holds it is the only one that does.
       */
      for (const group of groupsNow()) {
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

    // A group with nothing in it encloses nothing and is drawn as nothing, so
    // it is not a group any more. One that holds another group is still holding
    // something, whatever became of its boxes.
    function tidyGroups() {
      if (groupsNow().length === 0) {
        return;
      }

      for (let again = true; again;) {
        again = false;

        const empty = groupsNow().find((group) =>
          !model.nodes.some((node) => node.parent === group.id)
          && !groupsNow().some((other) => other.parent === group.id));

        if (empty) {
          liftOut(empty);
          again = true;
        }
      }

      if (model.groups.length === 0) {
        delete model.groups;
      }

      // Standing inside a group that is no longer there would leave every press
      // being read from a place in the diagram that does not exist.
      if (inside && !groupById(inside)) {
        inside = null;
      }
    }

    /* Taking one group out of the tree, with whatever it held handed up.
     *
     * A box at the top level carries no parent at all — that is what the parser
     * writes and what the file says — so the field goes rather than being set
     * to nothing. A group at the top level carries a parent of null, for the
     * same reason.
     */
    function liftOut(group) {
      for (const node of model.nodes) {
        if (node.parent === group.id) {
          if (group.parent) {
            node.parent = group.parent;
          } else {
            delete node.parent;
          }
        }
      }

      for (const other of groupsNow()) {
        if (other.parent === group.id) {
          other.parent = group.parent || null;
        }
      }

      model.groups = groupsNow().filter((other) => other !== group);
    }

    function nextGroupNumber() {
      const taken = new Set([...groupsNow().map((group) => group.id),
        ...model.nodes.map((node) => node.id)]);

      let n = 1;
      while (taken.has(`group${n}`)) {
        n += 1;
      }

      return n;
    }

    /* Putting a name round what is held.
     *
     * A handful taken out of one group stays inside it, so grouping part of a
     * group nests rather than escaping it. A handful gathered from two places
     * has no group in common, so the new one goes to the top.
     */
    function groupSelection() {
      if (selection.length === 0) {
        return;
      }

      const members = model.nodes.filter((node) => selection.includes(node.id));
      const above = new Set(members.map((node) => node.parent || null));
      const parent = above.size === 1 ? [...above][0] : null;
      const n = nextGroupNumber();
      const id = `group${n}`;

      model.groups = [...groupsNow(), { id, label: `Group ${n}`, parent }];

      for (const node of members) {
        node.parent = id;
      }

      tidyGroups();
      write();
      paintLists();
      // The same boxes are still held; what changed is that they are now a
      // group, which is what the panel has to say next.
      choose(selection);
    }

    function ungroupSelection() {
      const group = groupHeld();
      if (!group) {
        return;
      }

      liftOut(group);
      tidyGroups();
      write();
      paintLists();
      choose(selection);
    }

    function renameGroup(group, name) {
      group.label = name;
      write();
      drawAtOnce();
    }

    /* --- The palette --------------------------------------------------------
     *
     * Tap one to drop a shape into the diagram, or drag one onto the paper to put
     * it exactly where you want it. The ghost that follows the finger is a plain
     * element rather than anything in the drawing, because until it is let go it
     * is not part of the diagram.
     */
    /* What a shape on the rail puts on the paper. Everything the entry carries
     * except the parts that are about the button rather than about the box.
     */
    /* What is dropped on the paper is what was picked up.
     *
     * Whatever the entry says about itself and nothing more: an entry that
     * carries its own words or its own size says so, and everything else takes
     * the ordinary ones. An icon has no words because the picture is the whole
     * of it.
     */
    const fromPalette = (choice) => ({
      shape: choice.shape,
      kind: choice.kind,
      frame: choice.frame,
      icon: choice.icon,
      text: choice.text ?? (choice.icon ? "" : undefined),
      size: choice.size || (choice.icon ? { w: 80, h: 80 } : undefined)
    });

    /* Putting one down, wherever "there" turns out to be.
     *
     * A picture has nothing to put down until a file has been chosen, so the
     * place it was asked for is carried through the file dialogue and the box
     * lands there when the picture arrives. Everything else lands at once.
     */
    function placeChoice(choice, point) {
      const at = point ? { x: point.x, y: point.y } : {};

      if (choice.picture) {
        askForPicture({ frame: "none", ...at });
        return;
      }

      addBox({ ...fromPalette(choice), ...at });
    }

    const palette = document.createElement("div");
    palette.className = "ve-diagram-palette";

    for (const choice of DIAGRAM_PALETTE) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ve-diagram-tool";
      button.dataset.shape = choice.shape;
      button.dataset.kind = choice.kind;
      button.innerHTML = `${shapeGlyph(choice.glyph)}<span></span>`;
      button.querySelector("span").textContent = choice.label;
      button.title = `Add a ${choice.label.toLowerCase()}`
        + " — drag it onto the diagram, or tap and then tap where it goes";
      button.setAttribute("aria-pressed", "false");
      placeButtons.set(choice, button);

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
          usePlaceTool(placing === choice ? null : choice);
          return;
        }

        dragging = false;
        const paper = canvas.getBoundingClientRect();
        const inside = event.clientX >= paper.left && event.clientX <= paper.right
          && event.clientY >= paper.top && event.clientY <= paper.bottom;

        if (!inside) {
          return;
        }

        placeChoice(choice, pointIn(event.clientX, event.clientY));
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

      palette.appendChild(button);
    }

    /* Tidy is not a shape, so it is not on the rail of shapes. It is a thing
     * done to the whole diagram, which is what the bar along the top is for.
     */
    const tidy = document.createElement("button");
    tidy.type = "button";
    tidy.className = "ve-diagram-tidy";
    tidy.innerHTML = '<i class="ph ph-tree-structure" aria-hidden="true"></i><span>Tidy</span>';
    tidy.title = "Arrange every box again, following the flow direction";
    tidy.addEventListener("click", () => {
      model.layout = DiagramModel.autoLayout(model);
      write();
      paintLists();
      drawAtOnce();
    });

    /* --- Saving a picture of it ---------------------------------------------
     *
     * The file is the diagram; a picture of it is what you paste into
     * something that cannot open one. Both are done to the whole diagram, so
     * both live on the bar.
     */
    const EXPORT_SCALE = 2;

    /* The app's own stylesheet, as the page actually loaded it.
     *
     * Asked for by the href on the page rather than by a path written here, so
     * it is the cached copy of the version this page is running and not a
     * second request for whatever is newest. Fetched at the moment of saving
     * rather than held: a picture is saved rarely, and a copy kept from
     * start-up is a copy that is wrong after a deploy.
     */
    let sheetAsked = null;

    function stylesheetText() {
      /* The promise is kept rather than the text. Two saves in quick
       * succession would otherwise each find nothing kept and each go and ask,
       * and the second would overwrite what the first had already worked out.
       */
      if (!sheetAsked) {
        const link = document.querySelector('link[rel="stylesheet"][href*="app.css"]');
        sheetAsked = fetch(link ? link.href : "/css/app.css")
          .then((answer) => (answer.ok ? answer.text() : ""))
          // A picture with no styling is still a picture of the right shape,
          // and a better answer than a button that does nothing.
          .catch(() => "");
      }

      return sheetAsked;
    }

    const themeValue = (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name);

    async function pictureOfIt() {
      return DiagramDraw.exportSvg(model, {
        layout: model.layout,
        css: await stylesheetText(),
        read: themeValue,
        background: themeValue("--canvas").trim(),
        label: settings.title || "Diagram"
      });
    }

    // A name a file manager can hold, taken from what the diagram is called.
    const savedAs = (extension) => {
      const said = String(settings.title || "diagram")
        .replace(/\.[^.]*$/, "")
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "");

      return `${said || "diagram"}.${extension}`;
    };

    const handOver = (blob, name) => {
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

    async function saveSvg() {
      handOver(new Blob([await pictureOfIt()], { type: "image/svg+xml" }),
        savedAs("svg"));
    }

    /* A raster of the same picture.
     *
     * Drawn at twice the size, because a diagram pasted into a document is
     * usually looked at on a screen with more pixels than units, and a picture
     * saved at one to one is a blurred one there.
     */
    async function savePng() {
      const text = await pictureOfIt();
      const size = DiagramDraw.exportSize(model, model.layout);
      const picture = document.createElement("img");

      const drawn = new Promise((done, fail) => {
        picture.onload = () => done();
        picture.onerror = () => fail(new Error("the drawing could not be rasterised"));
      });

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
        handOver(blob, savedAs("png"));
      }
    }

    /* --- Selecting ---------------------------------------------------------- */

    const hint = document.createElement("p");
    hint.className = "ve-diagram-hint";

    const say = (words) => {
      hint.textContent = words;
      hint.hidden = words === "";
    };

    const inspector = document.createElement("div");
    inspector.className = "ve-diagram-inspector";

    const selectedNode = () => nodeById(selectedId);

    /* Choosing what to work on.
     *
     * Everything goes through here — a tap, a shift-tap, a rubber band, select
     * all, escape — so there is one place that decides what "selected" means
     * and one place that redraws because of it.
     */
    function choose(ids, options = {}) {
      selection = ids.filter((id) => nodeById(id));
      selectedId = selection.length === 1 ? selection[0] : null;
      armedFrom = null;
      paintInspector(options);
      markTree();
      // The ring and its handles are part of the drawing, so selecting something
      // is a redraw — of a picture that is a few kilobytes of string.
      drawAtOnce();
    }

    function select(id, options = {}) {
      choose(id ? [id] : [], options);
    }

    // Shift, on every canvas anyone has used: add what was not there, take away
    // what was. What it adds is what a plain press would have taken — the group
    // a box is in, until we have gone inside that group — so shift does not
    // quietly reach past a group that an ordinary press cannot.
    function toggleInSelection(id) {
      const reach = reachedBy(id);
      const already = reach.every(isSelected);

      choose(already
        ? selection.filter((one) => !reach.includes(one))
        : [...new Set([...selection, ...reach])]);
    }

    /* --- What you can do to what is selected ------------------------------- */

    const stepSelect = (value, label, className) => {
      const picker = document.createElement("select");
      picker.className = className;
      named(picker, label);

      for (const item of model.nodes) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = stepLabel(item);
        picker.appendChild(option);
      }

      picker.value = value;
      return picker;
    };

    const dropButton = (label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ve-diagram-drop";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
      return button;
    };

    /* Whether the box is drawn at all.
     *
     * On the end of the shape menu rather than beside it, because "no shape" is
     * an answer to "what shape is this" — and a box whose picture is the whole
     * of it is what most of a technical diagram is made of.
     */
    const NO_FRAME = "none";

    // The shape menu, with the table on the end of it. A table is a kind rather
    // than a shape, but from here it is one more thing a box can be.
    const shapeSelect = (item) => {
      const shape = document.createElement("select");
      shape.className = "ve-diagram-shape";
      named(shape, "Step shape");

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

          commit();
          paintInspector();
          paintLists();
          return;
        }

        delete item.frame;

        if (shape.value === "table") {
          item.kind = "table";
        } else {
          delete item.kind;
          item.shape = shape.value;
        }

        grow(item);
        commit();
        paintInspector();
      });

      return shape;
    };

    // A box never shrinks on its own — a size somebody dragged to is a size they
    // chose — but it does grow to hold what has been written in it.
    function grow(item) {
      const at = boxOf(item.id);
      if (!at) {
        return;
      }

      const size = DiagramModel.measureNode(item, { font: fontSizeOf(item) });
      at.w = Math.max(at.w, size.w);
      at.h = Math.max(at.h, size.h);
    }

    /* The label, as lines. One line for most boxes; a title and its rows for a
     * table. Newlines here are the <br/> Mermaid understands.
     *
     * It grows with what is typed into it, up to a point. A box can hold a
     * paragraph and a table can hold a dozen rows, and a field that shows two
     * of them and scrolls the rest is a field you cannot read your own diagram
     * in. The cap is there because the panel has more in it than this.
     */
    const LABEL_ROWS_MAX = 10;

    const labelField = (item) => {
      const rows = item.kind === "table" ? 3 : 1;
      const field = document.createElement("textarea");
      field.className = `ve-diagram-text${item.kind === "table" ? " ve-diagram-rowsy" : ""}`;
      field.value = DiagramModel.textRows(item.text).join("\n");
      // A line is a row and a pipe is the wall between two cells, which is a
      // thing a placeholder can say and a caption cannot.
      field.placeholder = item.kind === "table"
        ? "Title\nName | Type\nid | int"
        : item.id;
      named(field, item.kind === "table" ? "Table rows" : "Step label");

      const fit = () => {
        field.rows = Math.min(LABEL_ROWS_MAX,
          Math.max(rows, field.value.split("\n").length));
      };

      fit();

      field.addEventListener("input", () => {
        item.text = DiagramModel.joinRows(field.value.split("\n"));
        fit();
        grow(item);
        renameEverywhere(item.id, stepLabel(item));
        commit();
      });

      return field;
    };

    /* Every field the editor makes gets a name.
     *
     * A form control with neither an id nor a name is one the browser will not
     * autofill and cannot report on, and this panel is nothing but generated
     * fields — so the name is made from what the control is already called for
     * a screen reader, and there is one place that does it rather than a dozen
     * that must remember to.
     */
    const named = (control, label) => {
      control.setAttribute("aria-label", label);
      control.name = `dd-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
        .replace(/-+$/, "");
      return control;
    };

    /* A control with its name written over it.
     *
     * Every control in this panel used to sit in a row with two others and no
     * words at all, which left a menu of six shapes and a menu of three border
     * weights looking like the same unlabelled menu twice. A label wrapping the
     * control is also the label the control answers to, so tapping the word
     * puts the caret in the field — which is why a single control gets a
     * <label> and a group of buttons, which no label can point at, gets a plain
     * box and keeps the group's own aria-label.
     */
    const FIELD_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

    const captioned = (name, control) => {
      const holder = document.createElement(
        FIELD_TAGS.has(control.tagName) ? "label" : "div");
      holder.className = "ve-diagram-field";

      const caption = document.createElement("span");
      caption.className = "ve-diagram-field-name";
      caption.textContent = name;

      holder.append(caption, control);
      return holder;
    };

    /* One field per cell.
     *
     * A grid typed into a single box as lines of pipes is a grid you have to
     * hold in your head to edit: which of these words is in the second column
     * is a question you answer by counting. The panel lays the cells out the
     * way the table is drawn, so the field you type into is in the place on
     * the screen that the words will appear in.
     *
     * The title spans the whole of it, the same way it is drawn.
     */
    /* Which cell the type controls below the grid are aimed at: the one whose
     * field has the caret.
     *
     * A strip of buttons over a grid of cells has to be about one of them, and
     * the one you are typing into is the one you mean. With none entered the
     * strip would have to guess, so it says so and switches itself off instead.
     */
    let cellFocus = null;
    let showCellFont = () => {};

    const cellField = (item, row, column, label) => {
      const field = document.createElement("input");
      field.type = "text";
      field.className = "ve-diagram-cell";
      named(field, label);
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
        grow(item);
        renameEverywhere(item.id, stepLabel(item));
        commit();
      });

      field.addEventListener("focus", () => {
        cellFocus = { row, column };
        showCellFont();
      });

      return field;
    };

    function cellGrid(item) {
      const grid = DiagramModel.textCells(item.text || item.id);
      const columns = DiagramModel.columnsOf(grid);

      const box = document.createElement("div");
      box.className = "ve-diagram-cells";
      box.style.setProperty("--dd-columns", String(columns));

      const title = cellField(item, 0, 0, "Table title");
      title.className = "ve-diagram-cell ve-diagram-cell-title";
      title.placeholder = "Title";
      box.append(title);

      for (let row = 1; row < grid.length; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          box.append(cellField(item, row, column,
            `Row ${row}, column ${column + 1}`));
        }
      }

      return box;
    }

    /* A count with a way up and a way down.
     *
     * Rows and columns are the two things about a table you change by one at a
     * time, and typing a number to say "one more row" is a strange way to ask
     * for one more row. The count reads as well as sets, so the table's shape
     * is something the panel says rather than something you work out by
     * counting the pipes in the field above.
     */
    const stepper = (name, value, least, most, set, by = 1) => {
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
        button.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
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

    /* A table is so many rows by so many columns, and nothing else about it is
     * a number. Twenty-four and eight because a box on a diagram holding more
     * than that is a spreadsheet somebody has drawn by hand.
     */
    const TABLE_MAX_ROWS = 24;
    const TABLE_MAX_COLUMNS = 8;

    function resizeTable(item, rows, columns) {
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
      grow(item);
      renameEverywhere(item.id, stepLabel(item));
      write();
      paintLists();
      paintInspector();
      drawAtOnce();
    }

    /* How the table is spaced out: how far the words sit from the walls of a
     * cell, and how much room a row gets.
     *
     * The box moves by exactly the amount the change made — not to what the
     * table now needs, and not merely enough to hold it. Snapping to what it
     * needs would take a table somebody had dragged roomy and shrink it to the
     * minimum the moment they touched a stepper; only growing would mean
     * asking for shorter rows and getting the same table back, which is asking
     * for nothing. Moving by the difference keeps the room they left and gives
     * them what they asked for.
     */
    function respace(item, patch) {
      const at = boxOf(item.id);
      const was = DiagramModel.measureNode(item);

      Object.assign(item, patch);

      const now = DiagramModel.measureNode(item);
      if (at) {
        at.w = Math.max(now.w, at.w + (now.w - was.w));
        at.h = Math.max(now.h, at.h + (now.h - was.h));
      }

      write();
      paintInspector();
      drawAtOnce();
    }

    function tableSpacing(item) {
      const spacing = DiagramModel.tableMetrics(item);

      const row = document.createElement("div");
      row.className = "ve-diagram-row ve-diagram-grid-size";
      row.append(
        captioned("Padding", stepper("Padding", spacing.pad,
          DiagramModel.TABLE_PAD.least, DiagramModel.TABLE_PAD.most,
          (to) => respace(item, { pad: to }), 2)),
        captioned("Spacing", stepper("Spacing", spacing.gap,
          DiagramModel.TABLE_GAP.least, DiagramModel.TABLE_GAP.most,
          (to) => respace(item, { gap: to }), 5))
      );

      return row;
    }

    // The two of them, side by side: they are one answer to one question about
    // the table, and a panel that asks it twice down the page reads as two.
    function tableSize(item) {
      const grid = DiagramModel.textCells(item.text || item.id);
      const rows = grid.length;
      const columns = DiagramModel.columnsOf(grid);

      const row = document.createElement("div");
      row.className = "ve-diagram-row ve-diagram-grid-size";
      row.append(
        captioned("Rows", stepper("Rows", rows, 1, TABLE_MAX_ROWS,
          (to) => resizeTable(item, to, columns))),
        captioned("Columns", stepper("Columns", columns, 1, TABLE_MAX_COLUMNS,
          (to) => resizeTable(item, rows, to)))
      );

      return row;
    }

    /* What has been picked, and the one thing you can do to it that is not a
     * property of it. A panel that opens with a heading is a panel you can tell
     * at a glance is about something.
     */
    /* What a group is called, typed where everything else about a selection is
     * typed. A group has one thing to say about itself and this is it — the
     * rest of the panel is about the boxes, which are what a group is made of.
     */
    const groupNameField = (group) => {
      const field = document.createElement("input");
      field.type = "text";
      field.className = "ve-diagram-text ve-diagram-group-name";
      field.value = DiagramDraw.groupName(group);
      field.placeholder = group.id;
      named(field, "Group name");

      field.addEventListener("input", () => {
        renameGroup(group, field.value);
      });

      return field;
    };

    const heading = (words, extra) => {
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

    // A select with a fixed list of choices, which the arrow row wants three of.
    const chooser = (className, aria, choices, value) => {
      const select = document.createElement("select");
      select.className = className;
      named(select, aria);

      for (const [name, text] of choices) {
        const choice = document.createElement("option");
        choice.value = name;
        choice.textContent = text;
        select.appendChild(choice);
      }

      select.value = value;
      return select;
    };

    /* A link is a line style and two ends, and the file has to say so in
     * Mermaid's own words.
     *
     * So the kind written down is the nearest real link — an "is a" triangle is
     * still `-->` and reads as an arrow on GitHub — and `ends` is the
     * refinement kept beside it. It is written only when the kind alone does
     * not already say the same thing, so an ordinary arrow never grows a
     * layout comment it has no use for.
     */
    const setLink = (edge, style, ends) => {
      edge.kind = DiagramModel.linkFor(style, ends);

      const implied = DiagramDraw.endsOf({ kind: edge.kind });
      if (implied[0] === ends[0] && implied[1] === ends[1]) {
        delete edge.ends;
      } else {
        edge.ends = ends;
      }
    };

    const arrowRow = (edge) => {
      const row = document.createElement("div");
      row.className = "ve-diagram-row ve-diagram-arrow";

      const from = stepSelect(edge.from, "Arrow from", "ve-diagram-pick");

      const ends = DiagramDraw.endsOf(edge);
      const endChoices = DiagramDraw.END_KINDS.map((one) => [one.name, one.label]);

      /* Four, reading left to right the way the line does: what is at its back,
       * how it is drawn, what shape it is drawn in, what is at its point.
       *
       * The middle two are both "how it is drawn" and sit together for that
       * reason — one is what the line is made of and the other is the path it
       * takes to get there.
       */
      const back = chooser("ve-diagram-kind", "Arrow start", endChoices, ends[0]);
      const style = chooser("ve-diagram-kind", "Line style",
        DiagramModel.LINE_STYLES, DiagramModel.lineStyleOf(edge.kind));
      const shape = chooser("ve-diagram-kind", "Line shape",
        DiagramModel.ROUTE_SHAPES, DiagramDraw.shapeOf(edge));
      const forward = chooser("ve-diagram-kind", "Arrow end", endChoices, ends[1]);

      const line = document.createElement("div");
      line.className = "ve-diagram-ends";
      line.append(back, style, shape, forward);

      const label = document.createElement("input");
      label.type = "text";
      label.className = "ve-diagram-text";
      label.value = edge.label;
      label.placeholder = "label";
      named(label, "Arrow label");

      const to = stepSelect(edge.to, "Arrow to", "ve-diagram-pick");
      const drop = dropButton("Remove this arrow");

      from.addEventListener("change", () => {
        edge.from = from.value;
        commit();
      });

      to.addEventListener("change", () => {
        edge.to = to.value;
        commit();
      });

      for (const control of [back, style, forward]) {
        control.addEventListener("change", () => {
          setLink(edge, style.value, [back.value, forward.value]);
          commit();
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
        commit();
      });

      label.addEventListener("input", () => {
        edge.label = label.value;
        commit();
      });

      drop.addEventListener("click", () => {
        model.edges = model.edges.filter((other) => other !== edge);
        write();
        paintLists();
        paintInspector();
        drawAtOnce();
      });

      row.append(from, line, label, to, drop);
      return row;
    };

    /* --- Colour ---------------------------------------------------------------
     *
     * A colour is a classDef, which is real Mermaid: the file renders in the
     * same colours on GitHub, in a README preview, anywhere. That is the whole
     * reason for spending the effort here rather than writing a `%%` comment
     * nobody else reads.
     *
     * One classDef per colour, shared by every box wearing it. Twenty blue
     * boxes are one definition and one `class` line, which is smaller than
     * twenty inline styles and is also how a person would have written it.
     */
    const sameColour = (a, b) => {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].every((key) => a[key] === b[key]);
    };

    // The name of a class holding exactly this colour, making one if there is
    // none. Reused rather than added to, so choosing blue twice does not leave
    // two definitions of blue behind.
    function classFor(colour) {
      model.classes = model.classes || {};

      for (const [name, declarations] of Object.entries(model.classes)) {
        if (sameColour(declarations, colour)) {
          return name;
        }
      }

      for (let n = 1; ; n += 1) {
        const name = `${DIAGRAM_CLASS_PREFIX}${n}`;
        if (!model.classes[name]) {
          model.classes[name] = { ...colour };
          return name;
        }
      }
    }

    /* A definition this editor made and nobody wears any more is litter, and a
     * file that grows a dead classDef every time somebody changes their mind is
     * a file that gets worse the more it is edited. One written by hand stays
     * whether it is worn or not — it is part of somebody's diagram, and an
     * editor with no control for a thing is not a reason to throw the thing
     * away.
     */
    function forgetUnworn() {
      if (!model.classes) {
        return;
      }

      const worn = new Set(model.nodes.flatMap((item) => item.classes || []));

      for (const name of Object.keys(model.classes)) {
        if (DIAGRAM_CLASS_RE.test(name) && !worn.has(name)) {
          delete model.classes[name];
        }
      }
    }

    // The declarations on the class this editor put on a box, if it put one
    // there. A hand-written class alongside is left alone: only ours is read,
    // and only ours is ever exchanged.
    function styleOf(item) {
      const classes = model.classes || {};

      for (const name of item?.classes || []) {
        if (DIAGRAM_CLASS_RE.test(name) && classes[name]) {
          return { ...classes[name] };
        }
      }

      return {};
    }

    /* What size a box is set in, as the file says it: its class first and then
     * whatever it says about itself, which is the order the drawing reads them
     * in. Read back out rather than kept anywhere, so the field showing it and
     * the box drawing it cannot come apart.
     */
    function fontSizeOf(item) {
      return { ...styleOf(item), ...(item?.style || {}) }["font-size"] || "";
    }

    // Which of an offered set a box is wearing, judged on that set's own keys
    // alone: a red box with a dashed border is still red, and still dashed.
    function wearing(declarations, offered, keys) {
      const found = offered.find(([, part]) =>
        keys.every((key) => (declarations[key] || "") === (part[key] || "")));

      return found ? found[0] : offered[0][0];
    }

    function colourOf(item) {
      const declarations = styleOf(item);
      const found = DIAGRAM_COLOURS.find(([, colour]) =>
        DIAGRAM_COLOUR_KEYS.every((key) => declarations[key] === colour[key]));

      return found ? found[0] : null;
    }

    /* Changing part of how a handful of boxes are drawn.
     *
     * A patch, not a replacement: making four boxes red leaves whatever dashes
     * they had, because "make these red" is one thing being asked for and not
     * three. A key set to null is taken off, which is how a colour is cleared
     * without also clearing the border it had.
     *
     * The class is swapped rather than added, or a box changed from red to blue
     * would be wearing both and the file would say so.
     */
    function restyle(ids, patch, options = {}) {
      const ours = new Set(Object.keys(model.classes || {}).filter((name) =>
        DIAGRAM_CLASS_RE.test(name)));

      for (const id of ids) {
        const item = nodeById(id);
        if (!item) {
          continue;
        }

        const declarations = { ...styleOf(item), ...patch };
        for (const [key, value] of Object.entries(declarations)) {
          if (value === null || value === "") {
            delete declarations[key];
          }
        }

        const wanted = Object.keys(declarations).length > 0
          ? classFor(declarations)
          : null;
        const kept = (item.classes || []).filter((name) => !ours.has(name));
        item.classes = wanted ? [...kept, wanted] : kept;

        if (item.classes.length === 0) {
          delete item.classes;
        }
      }

      forgetUnworn();

      /* Type twice the size needs twice the room. A box that keeps the size it
       * was measured at while its type is enlarged is a box its own words no
       * longer fit in. It only ever grows: a box somebody sized by hand is a
       * box somebody meant, and the type coming back down does not un-mean it.
       */
      if (options.fit) {
        for (const id of ids) {
          const item = nodeById(id);
          if (item) {
            grow(item);
          }
        }
      }

      write();
      drawAtOnce();

      /* A repaint takes away the field the caret is in, and a spinner you can
       * only press once is not a spinner — so the control that asked to keep
       * the panel keeps it, and every size field on the screen is brought into
       * step instead.
       */
      if (!options.keepPanel) {
        paintInspector();
      }

      showSizes();
    }

    // Clearing a colour is taking its three declarations off, and nothing else:
    // the box keeps the dashed border it also had.
    const NO_COLOUR = Object.fromEntries(DIAGRAM_COLOUR_KEYS.map((key) => [key, null]));

    /* The swatches. Shown for one box or for a handful, because "make these
     * four red" is the reason anybody colours a diagram in the first place.
     */
    function colourRow(ids) {
      const row = document.createElement("div");
      row.className = "ve-diagram-colours";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Colour");

      const held = ids.length === 1 ? colourOf(nodeById(ids[0])) : null;

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

        button.addEventListener("click", () => restyle(ids, colour || NO_COLOUR));
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
      named(custom, "Any colour");
      custom.value = "#8ed9cf";
      custom.addEventListener("change", () => {
        restyle(ids, {
          fill: custom.value,
          stroke: darken(custom.value, 0.45),
          color: darken(custom.value, 0.8)
        });
      });
      row.append(custom);

      return row;
    }

    /* The two colours everything on the paper has: the words, and what is
     * behind them.
     *
     * The swatches say all three of fill, stroke and text at once, which is the
     * right offer for "make this one red" and the wrong one for "these words
     * are grey on white". So this is the other half of the same question, asked
     * outright: a well for each, and a way to put each one back on its own — a
     * diagram that has to match somebody's brand can then say so, rather than
     * choosing whichever preset is nearest.
     *
     * Both are ordinary classDef declarations, like everything else on this
     * panel, so words set grey here are grey on GitHub too.
     */
    const DIAGRAM_INKS = [
      ["Words", "color", "#1b2430"],
      ["Behind", "fill", "#e8eaed"]
    ];

    const HEX_RE = /^#[0-9a-fA-F]{6}$/;

    function inkRow(ids) {
      const row = document.createElement("div");
      row.className = "ve-diagram-row ve-diagram-inks";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Its own colours");

      const declarations = ids.length === 1 ? styleOf(nodeById(ids[0])) : {};

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
        named(input, `${label} colour`);
        input.addEventListener("change", () => restyle(ids, { [key]: input.value }));

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
        named(clear, `Default ${label.toLowerCase()} colour`);
        clear.disabled = held === "";
        clear.addEventListener("click", () => restyle(ids, { [key]: null }));

        well.append(caption, input, clear);
        row.append(well);
      }

      return row;
    }

    /* The border: a dash and a weight, two selects side by side.
     *
     * Selects rather than swatches because neither is a thing you recognise at
     * eight pixels square, and because the two together are six choices that
     * would otherwise be six more buttons in a panel that already has ten.
     */
    function borderRow(ids) {
      const row = document.createElement("div");
      row.className = "ve-diagram-row ve-diagram-border";

      const declarations = ids.length === 1 ? styleOf(nodeById(ids[0])) : {};
      const dash = wearing(declarations, DIAGRAM_BORDERS, ["stroke-dasharray"]);
      const weight = wearing(declarations, DIAGRAM_WEIGHTS, ["stroke-width"]);

      const named = (offered) => offered.map(([name]) => [name, name]);

      const border = chooser("ve-diagram-kind", "Border", named(DIAGRAM_BORDERS), dash);
      const thickness = chooser("ve-diagram-kind", "Border weight",
        named(DIAGRAM_WEIGHTS), weight);

      // A patch that always names its own key, so choosing "Plain" takes the
      // dash off rather than leaving the old one behind unmentioned.
      const patchFrom = (offered, name, keys) => {
        const found = offered.find(([one]) => one === name);
        const part = found ? found[1] : {};
        return Object.fromEntries(keys.map((key) => [key, part[key] ?? null]));
      };

      border.addEventListener("change", () =>
        restyle(ids, patchFrom(DIAGRAM_BORDERS, border.value, ["stroke-dasharray"])));
      thickness.addEventListener("change", () =>
        restyle(ids, patchFrom(DIAGRAM_WEIGHTS, thickness.value, ["stroke-width"])));

      row.append(border, thickness);
      return row;
    }

    /* A picture in a box.
     *
     * The uploading is the host's: the editor is handed a source string and
     * some callbacks and knows nothing about where the diagram came from or
     * what server is behind it, which is what makes a fence in a document and a
     * .mmd file the same diagram to it. A host that cannot store a picture
     * offers no way to add one, rather than a button that fails.
     */
    const canUpload = typeof settings.upload === "function";

    const DIAGRAM_IMAGE_BOX = { w: 180, h: 140 };

    // The file's name without its extension, which is what a screenshot tool
    // gives you and better than nothing under a picture nobody can see.
    const pictureName = (file) =>
      String(file?.name || "Picture").replace(/\.[^.]+$/, "").trim() || "Picture";

    async function putPicture(file, where) {
      if (!canUpload || !file) {
        return;
      }

      say("Adding the picture…");

      try {
        const url = await settings.upload(file);
        if (!url) {
          throw new Error("no address");
        }

        if (where && where.id) {
          const item = nodeById(where.id);
          if (!item) {
            return;
          }

          item.image = url;
          write();
          paintLists();
          drawAtOnce();
          paintInspector();
          return;
        }

        addBox({
          shape: "rect",
          text: pictureName(file),
          image: url,
          frame: where?.frame,
          x: where?.x,
          y: where?.y,
          size: DIAGRAM_IMAGE_BOX
        });
      } catch {
        say("That picture could not be added.");
      }
    }

    // One file picker, made once and pointed at whatever asked for it.
    let picker = null;
    function askForPicture(where) {
      if (!picker) {
        picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*";
        picker.className = "ve-diagram-picker";
        picker.addEventListener("change", () => {
          const file = picker.files?.[0];
          picker.value = "";

          if (picker.dataset.id) {
            void putPicture(file, { id: picker.dataset.id });
            return;
          }

          /* Where it was asked for, carried across the file dialogue. A place
           * chosen before the dialogue opened is still the place it was chosen,
           * however long somebody spends looking for the file — and a picture
           * that lands somewhere else is a picture that has to be dragged.
           */
          const spot = picker.dataset.at
            ? picker.dataset.at.split(",").map(Number)
            : [];

          void putPicture(file, {
            frame: picker.dataset.frame,
            x: spot.length === 2 && spot.every(Number.isFinite) ? spot[0] : undefined,
            y: spot.length === 2 && spot.every(Number.isFinite) ? spot[1] : undefined
          });
        });

        node.append(picker);
      }

      picker.dataset.id = where?.id || "";
      picker.dataset.frame = where?.frame || "";
      picker.dataset.at = Number.isFinite(where?.x) && Number.isFinite(where?.y)
        ? `${where.x},${where.y}`
        : "";
      picker.click();
    }

    function pictureRow(item) {
      const row = document.createElement("div");
      row.className = "ve-diagram-actions";

      const add = document.createElement("button");
      add.type = "button";
      add.className = "ve-diagram-add";
      add.innerHTML = `<i class="ph ph-image" aria-hidden="true"></i><span>${
        item.image ? "Replace the picture" : "Add a picture"}</span>`;
      add.addEventListener("click", () => askForPicture({ id: item.id }));
      row.append(add);

      if (item.image) {
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "ve-diagram-add";
        drop.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i><span>Take it off</span>';
        drop.addEventListener("click", () => {
          delete item.image;
          write();
          drawAtOnce();
          paintInspector();
        });

        row.append(drop);
      }

      return row;
    }

    /* The icons, and the search over them.
     *
     * Named by set and by name — `lucide:database` — because there will be a
     * second set one day and a name on its own would then mean two things.
     * Searched by name too: Lucide's names say what the picture is, which is
     * why a list of keywords beside them would be a second thing to keep in
     * step with the first.
     */
    const ICON_SET = "lucide";
    let iconSearch = "";

    const iconName = (item) =>
      String(item?.icon || "").replace(new RegExp(`^${ICON_SET}:`), "");

    function setIcon(item, name) {
      if (name) {
        item.icon = `${ICON_SET}:${name}`;
      } else {
        delete item.icon;
      }

      write();
      paintLists();
      drawAtOnce();
      paintInspector();
    }

    function iconRow(item) {
      const holder = document.createElement("div");
      holder.className = "ve-diagram-icons";

      const worn = iconName(item);

      const find = document.createElement("input");
      find.type = "search";
      find.className = "ve-diagram-find";
      find.placeholder = "Search icons";
      find.value = iconSearch;
      named(find, "Search icons");

      const grid = document.createElement("div");
      grid.className = "ve-diagram-icon-grid";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", "Icons");

      const none = document.createElement("div");
      none.className = "ve-diagram-hint";

      const paintIcons = () => {
        grid.replaceChildren();
        const looking = iconSearch.trim().toLowerCase();
        let shown = 0;

        for (const [title, names] of DiagramIcons.GROUPS) {
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
            button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"`
              + ` fill="none" stroke="currentColor" stroke-width="2"`
              + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
              + `${DiagramIcons.bodyOf(name)}</svg>`;
            // Wearing it already, pressing it takes it off — which is the only
            // way a grid of switches can also be a way to say "none of these".
            button.addEventListener("click", () =>
              setIcon(item, name === worn ? "" : name));
            grid.append(button);
            shown += 1;
          }
        }

        none.textContent = shown === 0 ? `No icon is called "${iconSearch.trim()}".` : "";
        none.hidden = shown > 0;
      };

      find.addEventListener("input", () => {
        iconSearch = find.value;
        paintIcons();
      });

      paintIcons();
      holder.append(find, grid, none);
      return holder;
    }

    /* The type a box is set in: a family, a size, and the two switches.
     *
     * All of it goes the same way a colour and a border go — into a classDef,
     * which every Mermaid renderer reads. There is no control here for anything
     * Mermaid cannot say, because a size the file cannot keep is a size that
     * goes away the next time the diagram is opened somewhere else.
     */
    /* Every text-size field on the screen at once.
     *
     * There are two of them — one in the panel, one on the bar over the box —
     * and a size changed in either is a size the other is now showing wrongly.
     * The usual answer, repainting the panel, cannot be used: it takes away the
     * field the caret is in. So the fields are brought into step where they
     * stand, and the one being typed into is left alone, because a field that
     * rewrites itself under the caret is a field you cannot type a two-digit
     * number into.
     */
    const sizeFields = new Map();

    function showSizes() {
      for (const [field, read] of [...sizeFields]) {
        // A field belonging to a panel that has since been repainted away.
        if (!field.isConnected) {
          sizeFields.delete(field);
          continue;
        }

        if (document.activeElement !== field) {
          field.value = read();
        }
      }
    }

    /* The size of the type, as a number.
     *
     * Four named steps were four sizes, and a diagram that wanted a heading at
     * 28 had to take 20 or nothing. `font-size` is a real classDef declaration
     * at any value, so the control that writes one is a number field: what is
     * typed is what the file says and what every other Mermaid renderer draws.
     *
     * Blank is not the same as the standard size. A box that says nothing about
     * its type follows the theme wherever the theme goes; one that says 13 is
     * 13 for ever.
     */
    function sizeField(offered) {
      const bounds = offered.bounds;
      const field = document.createElement("input");
      field.type = "number";
      field.className = "ve-diagram-size";
      field.min = String(bounds.least);
      field.max = String(bounds.most);
      field.step = "1";
      field.placeholder = String(DiagramModel.TEXT_SIZE);
      field.title = offered.label;
      named(field, offered.label);
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

      sizeFields.set(field, offered.read);
      return field;
    }

    // The size a handful of boxes are set in: the one they agree on, or nothing
    // at all, because a field showing one box's size over four is a field that
    // will set the other three to it the moment it is touched.
    function sizeShown(ids) {
      const sizes = new Set(ids.map((id) => fontSizeOf(nodeById(id))));
      const found = sizes.size === 1 ? /^([0-9.]+)px$/.exec([...sizes][0]) : null;
      return found ? String(parseFloat(found[1])) : "";
    }

    function nodeSizeField(ids) {
      return sizeField({
        label: "Text size",
        bounds: DiagramModel.FONT_SIZE,
        read: () => sizeShown(ids),
        onSize: (size) => restyle(ids, { "font-size": size === null ? null : `${size}px` },
          { keepPanel: true, fit: true })
      });
    }

    // Bold and italic, for the panel and for the bar over the box. One set of
    // buttons defined once: two that could disagree about what bold means is
    // two places to change it and one of them forgotten.
    function markButtons(ids, declarations, label) {
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
        button.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
        button.addEventListener("click", () => restyle(ids, { [key]: on ? null : value }));
        marks.append(button);
      }

      return marks;
    }

    function fontRow(ids) {
      const holder = document.createElement("div");
      holder.className = "ve-diagram-font";

      const declarations = ids.length === 1 ? styleOf(nodeById(ids[0])) : {};
      const listed = (offered) => offered.map(([name]) => [name, name]);

      const family = chooser("ve-diagram-kind", "Font",
        listed(DIAGRAM_FAMILIES), wearing(declarations, DIAGRAM_FAMILIES, ["font-family"]));

      // A patch that always names its own key, so choosing "Default" takes the
      // family off rather than leaving the old one behind unmentioned.
      const patchFrom = (offered, name, keys) => {
        const found = offered.find(([one]) => one === name);
        const part = found ? found[1] : {};
        return Object.fromEntries(keys.map((key) => [key, part[key] ?? null]));
      };

      family.addEventListener("change", () =>
        restyle(ids, patchFrom(DIAGRAM_FAMILIES, family.value, ["font-family"])));

      const menus = document.createElement("div");
      menus.className = "ve-diagram-row ve-diagram-border";
      menus.append(family, nodeSizeField(ids));

      holder.append(menus, markButtons(ids, declarations));
      return holder;
    }

    /* The type one cell of a table is set in.
     *
     * Everything else on this panel dresses a whole node, because a classDef
     * dresses a whole node and that is the only thing Mermaid can be told. A
     * table is the one place where that is not the grain of the thing: the
     * header row wants to be bold and the id column wants to be mono, and
     * neither is a statement about the table.
     *
     * So it is the same four choices as the box's own font row, aimed at one
     * cell — and read as an override on top of the table's own rather than
     * instead of it, which is what setting the same custom properties one
     * level further in gets for free.
     */
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

    const CELL_LETTERS = (token) => String(token || "").replace(/\d/g, "");
    const CELL_DIGITS = (token) => String(token || "").replace(/\D/g, "");

    function cellFontRow(item) {
      const holder = document.createElement("div");
      holder.className = "ve-diagram-font";

      const where = document.createElement("p");
      where.className = "ve-diagram-aimed";

      const listed = (offered) => offered.map(([name]) => [name, name]);
      const family = chooser("ve-diagram-kind", "Cell font", listed(CELL_FAMILIES),
        CELL_FAMILIES[0][0]);

      const marks = document.createElement("div");
      marks.className = "ve-diagram-marks";
      marks.setAttribute("role", "group");
      marks.setAttribute("aria-label", "Cell text style");

      const keyNow = () => cellFocus
        ? DiagramModel.cellKey(cellFocus.row, cellFocus.column) : "";
      const tokenNow = () => (item.cells || {})[keyNow()] || "";

      /* One way in, so a cell with nothing on it has no entry rather than an
       * empty one, and a table with nothing on any cell has no `cells` at all.
       * The file then says what was chosen and stays silent about the rest.
       */
      const change = (make) => {
        if (!cellFocus) {
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

        write();
        drawAtOnce();
        show();
      };

      /* The same number field the box's own type uses, held to what one cell of
       * a table is allowed to say: a size lives in the file as two digits on
       * the end of the cell's token, so 48 is as large as a cell can be set.
       */
      const size = sizeField({
        label: "Cell text size",
        bounds: DiagramModel.CELL_SIZE,
        read: () => CELL_DIGITS(tokenNow()),
        disabled: !cellFocus,
        onSize: (chosen) => change((token) => DiagramModel.cellToken(
          CELL_LETTERS(token).split(""), chosen === null ? "" : String(chosen)))
      });

      const menus = document.createElement("div");
      menus.className = "ve-diagram-row ve-diagram-border";
      menus.append(family, size);

      // A cell is set in one family, so choosing one takes the other two off.
      family.addEventListener("change", () => change((token) => {
        const chosen = (CELL_FAMILIES.find(([name]) => name === family.value) || [])[1] || "";
        const kept = CELL_LETTERS(token).split("")
          .filter((one) => !CELL_FAMILIES.some(([, letter]) => letter === one));

        return DiagramModel.cellToken([...kept, chosen], CELL_DIGITS(token));
      }));

      const buttons = CELL_MARK_BUTTONS.map(([label, letter, icon]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ve-diagram-mark";
        button.title = label;
        button.setAttribute("aria-label", `${label} cell`);
        button.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;

        button.addEventListener("click", () => change((token) => {
          const letters = CELL_LETTERS(token).split("");
          const kept = letters.filter((one) => one !== letter);

          return DiagramModel.cellToken(
            letters.includes(letter) ? kept : [...kept, letter],
            CELL_DIGITS(token));
        }));

        marks.append(button);
        return [button, letter];
      });

      const show = () => {
        const token = tokenNow();
        const letters = CELL_LETTERS(token);
        const aimed = Boolean(cellFocus);

        where.textContent = aimed
          ? (cellFocus.row === 0 ? "The title."
            : `Row ${cellFocus.row}, column ${cellFocus.column + 1}.`)
          : "Click into a cell above to set how it is written.";

        family.disabled = !aimed;
        size.disabled = !aimed;
        family.value = (CELL_FAMILIES.find(([, letter]) =>
          letter && letters.includes(letter)) || CELL_FAMILIES[0])[0];
        size.value = CELL_DIGITS(token);
        // What the cell is if it says nothing: whatever the table around it is
        // set in, which is the standard unless the table said otherwise.
        size.placeholder = String(parseFloat(fontSizeOf(item)) || DiagramModel.TEXT_SIZE);

        for (const [button, letter] of buttons) {
          const on = aimed && letters.includes(letter);
          button.disabled = !aimed;
          button.classList.toggle("is-on", on);
          button.setAttribute("aria-pressed", on ? "true" : "false");
        }
      };

      showCellFont = show;
      show();

      holder.append(menus, marks, where);
      return holder;
    }

    /* A darker version of a colour, for the stroke and the text.
     *
     * Mixed towards black rather than scaled, so a pale fill gives a stroke that
     * is still recognisably the same colour instead of one that is nearly black
     * the moment the fill is light.
     */
    function darken(hex, amount) {
      const found = /^#([0-9a-f]{6})$/i.exec(String(hex));
      if (!found) {
        return hex;
      }

      const whole = parseInt(found[1], 16);
      const parts = [(whole >> 16) & 255, (whole >> 8) & 255, whole & 255]
        .map((one) => Math.round(one * (1 - amount)));

      return `#${parts.map((one) => one.toString(16).padStart(2, "0")).join("")}`;
    }

    /* --- The bar over the box ----------------------------------------------
     *
     * Everything a box wears could be changed from the panel at the side and
     * nowhere else — which is a long way to go when the box is the thing you are
     * looking at, and further still on a phone where the panel is shut.
     *
     * So the controls reached for while drawing sit over the selection too: the
     * shape, the colour, the size of the type, bold, italic, and the way out.
     * They are the same controls, not copies of them — one definition each,
     * shown in two places — because two sets of swatches that have to agree
     * about what red is are one set too many.
     */
    const HUD_GAP = 12;
    let hud = null;

    function hudFor(ids) {
      const bar = document.createElement("div");
      bar.className = "ve-diagram-hud";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "How this box is drawn");

      const item = ids.length === 1 ? nodeById(ids[0]) : null;

      // A shape menu over four boxes would have to say what four shapes are, so
      // it is offered for one box and the rest of the bar for any number. Words
      // on the paper have no shape to offer, and a menu of nine of them over a
      // thing whose whole point is not being any of them is a menu that lies.
      if (item && item.kind !== "text") {
        bar.append(shapeSelect(item));
      }

      bar.append(colourRow(ids), nodeSizeField(ids),
        markButtons(ids, item ? styleOf(item) : {}));

      const drop = dropButton(item
        ? `Remove ${stepLabel(item)}`
        : `Remove these ${ids.length} boxes`);
      drop.addEventListener("click", () => removeSteps(ids));
      bar.append(drop);

      return bar;
    }

    function paintHud() {
      hud?.remove();
      hud = null;

      /* Only where there is a window to float it over — in a document the
       * diagram is drawn at its own size inside the page, and a bar laid over
       * that would be laid over the words around it too — and only if it has
       * not been put away.
       */
      if (!viewport || panels.barShut || selection.length === 0) {
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
      hud = hudFor([...selection]);
      stage.append(hud);
      placeHud();
    }

    function placeHud() {
      if (!hud) {
        return;
      }

      /* Whether there is a bar at all is paintHud's to say; this only says
       * where it goes. Two places deciding one thing is one place too many, and
       * the second of them was never reached: a box that stops existing takes
       * the selection with it, and that is a repaint.
       */
      const boxes = selection.map(boxOf).filter(Boolean);
      if (boxes.length === 0) {
        return;
      }

      const left = Math.min(...boxes.map((at) => at.x));
      const right = Math.max(...boxes.map((at) => at.x + at.w));
      const top = Math.min(...boxes.map((at) => at.y));
      const under = Math.max(...boxes.map((at) => at.y + at.h));

      const middle = (((left + right) / 2) * view.scale) + view.x;
      const over = ((top * view.scale) + view.y) - HUD_GAP;
      const below = ((under * view.scale) + view.y) + HUD_GAP;

      /* Above the box, and underneath it when the box is against the top of the
       * window: a bar drawn off the top of the paper is a bar nobody can reach.
       * Held inside the window sideways for the same reason.
       */
      const wide = hud.offsetWidth;
      const tall = hud.offsetHeight;
      const y = over - tall >= 0 ? over - tall : below;
      const x = Math.max(0, Math.min(Math.max(0, canvas.clientWidth - wide),
        middle - (wide / 2)));

      hud.style.left = `${Math.round(x)}px`;
      hud.style.top = `${Math.round(y)}px`;
    }

    function paintInspector(options = {}) {
      paintHud();
      inspector.replaceChildren();
      // The cell fields the type controls aimed at are about to be thrown away,
      // so the aim goes with them rather than outliving them.
      cellFocus = null;
      showCellFont = () => {};
      const item = selectedNode();

      if (!item) {
        /* A handful has no one name or shape to show, but it has a colour: the
         * reason to hold four boxes at once is usually to do one thing to all
         * four of them, and this is that thing.
         */
        if (selection.length > 1) {
          const held = groupHeld();
          const groupField = held ? groupNameField(held) : null;

          say(held
            ? `${DiagramDraw.groupName(held)} held. Drag its name to move it about.`
            : `${selection.length} boxes held. Colour them, or drag them about.`);
          inspector.append(heading(held ? "Group" : `${selection.length} boxes`));

          if (groupField) {
            inspector.append(captioned("Name", groupField));
          }

          inspector.append(
            captioned("Fill", colourRow([...selection])),
            captioned("Colours", inkRow([...selection])),
            captioned("Border", borderRow([...selection])),
            captioned("Font", fontRow([...selection]))
          );

          if (options.focusName && groupField) {
            groupField.focus();
            groupField.select();
          }

          return;
        }

        say(model.nodes.length === 0
          ? "Drag a shape onto the paper to start."
          : "Tap a box to work on it, or drag one to move it.");
        return;
      }

      // An editor whose way into a box is a gesture nobody mentions is an editor
      // where boxes cannot be renamed, whatever the code does.
      say(armedFrom
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
      const cells = table ? cellGrid(item) : null;
      const name = table
        ? cells.querySelector(".ve-diagram-cell-title")
        : labelField(item);

      const drop = dropButton(`Remove ${stepLabel(item)}`);
      drop.addEventListener("click", () => removeStep(item.id));

      const actions = document.createElement("div");
      actions.className = "ve-diagram-actions";

      const step = document.createElement("button");
      step.type = "button";
      step.className = "ve-diagram-add";
      step.innerHTML = '<i class="ph ph-plus" aria-hidden="true"></i><span>Step after this</span>';
      step.disabled = model.nodes.length >= DiagramModel.MAX_NODES;
      step.addEventListener("click", () => addBox({ joinFrom: item.id }));

      const connect = document.createElement("button");
      connect.type = "button";
      connect.className = `ve-diagram-add ve-diagram-connect${armedFrom ? " is-armed" : ""}`;
      connect.innerHTML = '<i class="ph ph-arrow-right" aria-hidden="true"></i><span>Arrow to…</span>';
      connect.disabled = model.nodes.length < 2 || model.edges.length >= DiagramModel.MAX_EDGES;
      connect.addEventListener("click", () => {
        armedFrom = armedFrom ? null : item.id;
        paintInspector();
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
          grow(item);
          commit();
          paintInspector();
          paintLists();
        });

        actions.append(framed);
      }

      const out = model.edges.filter((edge) => edge.from === item.id);

      /* One thing per line, each with its name over it. Three controls crammed
       * across a column narrower than any of them wanted is what made this
       * panel look assembled rather than designed.
       */
      inspector.append(
        heading(words ? "Text" : table ? "Table" : "Box", drop),
        captioned(table ? "Cells" : words ? "Words" : "Label", table ? cells : name)
      );

      if (table) {
        inspector.append(tableSize(item), tableSpacing(item),
          captioned("Cell text", cellFontRow(item)));
      }

      if (words) {
        inspector.append(
          captioned("Font", fontRow([item.id])),
          captioned("Colours", inkRow([item.id])),
          actions
        );
      } else {
        inspector.append(
          captioned("Shape", shapeSelect(item)),
          captioned("Fill", colourRow([item.id])),
          captioned("Colours", inkRow([item.id])),
          captioned("Border", borderRow([item.id])),
          captioned("Font", fontRow([item.id]))
        );

        if (canUpload) {
          inspector.append(captioned("Picture", pictureRow(item)));
        }

        inspector.append(captioned("Icon", iconRow(item)), actions);
      }

      if (out.length > 0) {
        const legend = document.createElement("div");
        legend.className = "ve-diagram-legend";
        legend.textContent = out.length === 1 ? "Its arrow" : "Its arrows";

        const rows = document.createElement("div");
        rows.className = "ve-diagram-rows";
        rows.append(...out.map(arrowRow));
        inspector.append(legend, rows);
      }

      /* A group of one is not something this editor makes — grouping needs two
       * boxes to be a group of — but it is something a file can say, and a name
       * you cannot change is a name you cannot correct.
       */
      const alone = groupHeld();
      if (alone) {
        inspector.append(captioned("Group name", groupNameField(alone)));
      }

      if (options.focusName) {
        name.focus();
        name.select?.();
      }
    }

    /* --- The flow direction -------------------------------------------------
     *
     * It no longer decides where anything is drawn here — the layout does — but
     * it is still what every other reader of this file lays it out by, and it is
     * what Tidy arranges along.
     */
    const flowControl = () => {
      const flow = document.createElement("select");
      flow.className = "ve-diagram-kind ve-diagram-direction";
      named(flow, "Diagram direction");

      // TB and TD mean the same thing to Mermaid and only one of them is on the
      // menu, so a diagram written with the other keeps it rather than being
      // silently rewritten by the act of opening this.
      const flows = DIAGRAM_FLOWS.some(([value]) => value === model.direction)
        ? DIAGRAM_FLOWS
        : [[model.direction, model.direction], ...DIAGRAM_FLOWS];

      for (const [value, name] of flows) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = name;
        flow.appendChild(option);
      }

      flow.value = model.direction;
      flow.addEventListener("change", () => {
        model.direction = flow.value;
        commit();
      });

      return flow;
    };

    /* --- Everything at once, for when tapping is not enough ---------------- */

    const all = document.createElement("details");
    all.className = "ve-diagram-all";

    const allSummary = document.createElement("summary");
    allSummary.textContent = "Everything on the paper";

    const nodeRows = document.createElement("div");
    nodeRows.className = "ve-diagram-rows";

    const edgeRows = document.createElement("div");
    edgeRows.className = "ve-diagram-rows";

    // Renaming a step renames it everywhere it is named — in every arrow menu
    // that points at it — without rebuilding a single row, so the caret stays
    // where it is being typed.
    const renameEverywhere = (id, label) => {
      for (const option of node.querySelectorAll("option")) {
        if (option.value === id) {
          option.textContent = label;
        }
      }
    };

    function nodeRow(item, depth = 0) {
      const row = document.createElement("div");
      row.className = "ve-diagram-row";
      row.dataset.nodeId = item.id;
      row.style.setProperty("--dd-depth", String(depth));

      const text = labelField(item);

      // Reaching a step from the list is the other half of reaching it from the
      // diagram, and it has to leave the same thing selected either way.
      text.addEventListener("focus", () => {
        if (selectedId !== item.id) {
          // The tree names the box itself, so it holds the box itself — which
          // means standing inside whatever group it is in, or a press on the
          // paper afterwards would jump straight back out to the group.
          inside = parentOnPaper(item);
          select(item.id);
        }
      });

      const drop = dropButton(`Remove ${stepLabel(item)}`);
      drop.addEventListener("click", () => removeStep(item.id));

      /* Words on the paper keep the column the shape menu is in, but say what
       * they are in it rather than offering nine shapes none of which they
       * are. The column stays because the list is a grid, and a row that
       * skipped it would put its own remove button under everyone else's
       * shape.
       */
      if (item.kind === "text") {
        const said = document.createElement("span");
        said.className = "ve-diagram-row-kind";
        said.textContent = "Text";
        row.append(text, said, drop);
        return row;
      }

      row.append(text, shapeSelect(item), drop);
      return row;
    }

    /* --- The tree ------------------------------------------------------------
     *
     * Everything on the paper, in the shape it is actually in.
     *
     * A flat list cannot show a group at all, and a group is now a thing you
     * take hold of, name, and put other things inside. So the list is the
     * tree: what is at the top level, then each group with its contents under
     * it and indented, exactly the order the file is written in. Which means
     * there is one answer to "what is in what" and both the file and this read
     * it the same way.
     */
    const shutGroups = new Set();

    // The same rule the file is written by: a thing whose group is not there is
    // at the top level rather than nowhere. Losing which group a box was in is
    // a small loss; losing the box is not.
    const parentOnPaper = (item) => {
      const known = groupsNow().some((group) => group.id === item.parent);
      return known ? item.parent : null;
    };

    function groupRow(group, depth) {
      const row = document.createElement("div");
      row.className = "ve-diagram-row ve-diagram-row-group";
      row.dataset.groupId = group.id;
      row.style.setProperty("--dd-depth", String(depth));

      const name = DiagramDraw.groupName(group) || group.id;
      const folded = shutGroups.has(group.id);

      const twist = document.createElement("button");
      twist.type = "button";
      twist.className = "ve-diagram-twist";
      twist.setAttribute("aria-expanded", String(!folded));
      named(twist, `${folded ? "Show" : "Hide"} what is in ${name}`);
      twist.innerHTML = `<i class="ph ${folded ? "ph-caret-right" : "ph-caret-down"}"`
        + ` aria-hidden="true"></i>`;
      twist.addEventListener("click", () => {
        if (folded) {
          shutGroups.delete(group.id);
        } else {
          shutGroups.add(group.id);
        }

        paintLists();
      });

      const field = groupNameField(group);
      field.addEventListener("focus", () => holdGroup(group.id));

      // Removing a group is not removing what is in it. The boxes stay and the
      // name comes off, which is the only reading that is not a trap.
      const drop = dropButton(`Ungroup ${name}`);
      drop.addEventListener("click", () => {
        holdGroup(group.id);
        ungroupSelection();
      });

      row.append(twist, field, drop);
      return row;
    }

    // Taking hold of a group from the tree leaves us outside it, the same as
    // pressing its name on the paper does.
    function holdGroup(id) {
      inside = groupById(id)?.parent || null;
      choose(groupMembers(id));
    }

    function treeRows() {
      const rows = [];
      const placed = new Set();
      const walked = new Set();

      /* A folded group is still walked, so that what is in it counts as reached
       * — it is out of sight, not lost. Only what the walk never gets to at all
       * is left over.
       */
      const walk = (parent, depth, show) => {
        for (const item of model.nodes) {
          if (parentOnPaper(item) === parent) {
            placed.add(item.id);

            if (show) {
              rows.push(nodeRow(item, depth));
            }
          }
        }

        for (const group of groupsNow()) {
          // A group that is its own ancestor has no place in the tree. It is
          // still in the file, and the walk simply stops rather than running
          // round the ring forever.
          if (parentOnPaper(group) !== parent || walked.has(group.id)) {
            continue;
          }

          walked.add(group.id);

          if (show) {
            rows.push(groupRow(group, depth));
          }

          walk(group.id, depth + 1, show && !shutGroups.has(group.id));
        }
      };

      walk(null, 0, true);

      // Anything the walk could not reach is still on the paper, so it is still
      // in the list — at the top, where it can be got at and put right.
      for (const item of model.nodes) {
        if (!placed.has(item.id)) {
          rows.push(nodeRow(item, 0));
        }
      }

      return rows;
    }

    /* Which rows are held, without rebuilding any of them.
     *
     * The tree carries the fields somebody may be typing into, and a list
     * rebuilt on every selection is a list that takes the caret with it.
     */
    function markTree() {
      if (!listed) {
        return;
      }

      const held = groupHeld();

      for (const row of nodeRows.querySelectorAll(".ve-diagram-row")) {
        row.classList.toggle("is-picked", row.dataset.groupId
          ? row.dataset.groupId === held?.id
          : isSelected(row.dataset.nodeId));
      }
    }

    function paintLists() {
      nodeRows.replaceChildren(...treeRows());
      edgeRows.replaceChildren(...model.edges.map(arrowRow));
      addArrow.disabled = model.nodes.length < 2 || model.edges.length >= DiagramModel.MAX_EDGES;
      listed = true;
      markTree();
    }

    const addArrow = document.createElement("button");
    addArrow.type = "button";
    addArrow.className = "ve-diagram-add";
    addArrow.innerHTML = '<i class="ph ph-arrow-right" aria-hidden="true"></i><span>Add arrow</span>';
    addArrow.addEventListener("click", () => {
      if (model.nodes.length < 2) {
        return;
      }

      join(model.nodes[0].id, model.nodes[1].id);
    });

    const stepsLegend = document.createElement("div");
    stepsLegend.className = "ve-diagram-legend";
    stepsLegend.textContent = "Steps and groups";

    const arrowsLegend = document.createElement("div");
    arrowsLegend.className = "ve-diagram-legend";
    arrowsLegend.textContent = "Arrows";

    // The inspector and the list are two views of the same arrows, and only the
    // one being looked at is worth keeping in step on every keystroke. Opening
    // the list is the moment the other one starts being looked at.
    all.addEventListener("toggle", () => {
      if (all.open) {
        paintLists();
      }

      // Whether the tree is open is about this screen and these hands, so it
      // is kept where the panel widths are kept rather than in the diagram.
      panels.listShut = !all.open;
      rememberPanels();
    });

    all.append(allSummary, stepsLegend, nodeRows, arrowsLegend, edgeRows, addArrow);

    /* --- Putting it together ------------------------------------------------
     *
     * A bar across the top, a rail of shapes down one side, a panel of
     * properties down the other, and the paper filling everything left over.
     * Which is the shape every drawing tool has: what you can do to the whole
     * diagram along the top, what you can put into it on one side, and what is
     * true of the thing you have picked on the other.
     *
     * On a phone the same three things are stacked instead — the rail becomes a
     * strip under the bar and the panel becomes a tray along the bottom — so
     * nothing moves anywhere unfamiliar, it is only folded differently.
     */

    const bar = document.createElement("div");
    bar.className = "ve-diagram-bar";

    const flowLabel = document.createElement("label");
    flowLabel.className = "ve-diagram-flow";

    const flowText = document.createElement("span");
    flowText.textContent = "Flow";
    flowLabel.append(flowText, flowControl());

    // A group is a run of buttons that belong together, with a hairline between
    // one group and the next. The host's own bar names the diagram, so naming it
    // again here would be the same words twice on one screen; an editor with no
    // host to name it says so itself.
    const group = (...items) => {
      const holder = document.createElement("div");
      holder.className = "ve-diagram-group";
      holder.append(...items);
      return holder;
    };

    if (!viewport) {
      const title = document.createElement("span");
      title.className = "ve-diagram-name";
      title.textContent = settings.title || "diagram";
      bar.append(title);
    }

    /* The zoom, which is a readout as much as a control.
     *
     * Typeable, because "make this 100%" and "make this fit on a slide" are
     * things people want exactly rather than approximately, and a pair of
     * buttons can only ever get near.
     */
    let zoomField = null;
    let steps = null;
    // Replaced with the real thing when there are buttons to keep in step.
    let showSteps = () => {};

    function showZoom() {
      if (zoomField && document.activeElement !== zoomField) {
        zoomField.value = `${Math.round(view.scale * 100)}%`;
      }
    }

    if (viewport) {
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
        button.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
        button.addEventListener("click", run);
        return button;
      };

      zoomField = document.createElement("input");
      zoomField.type = "text";
      zoomField.className = "ve-diagram-zoom-value";
      named(zoomField, "Zoom");
      zoomField.value = "100%";

      const readTyped = () => {
        const asked = parseFloat(String(zoomField.value).replace(/[^\d.]/g, ""));
        if (Number.isFinite(asked) && asked > 0) {
          const rect = canvas.getBoundingClientRect();
          zoomAbout(rect.left + (rect.width / 2), rect.top + (rect.height / 2),
            clampScale(asked / 100) / view.scale);
        }

        showZoom();
      };

      zoomField.addEventListener("change", readTyped);
      zoomField.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          readTyped();
          canvas.focus();
        }
      });

      /* The hand. Dragging empty paper pulls a band round what it touches,
       * which is what a drag means in every editor that has a band — so the
       * other thing a drag can mean needs somewhere to be said. Held: the space
       * bar. Switched on: this.
       */
      handButton = iconButton("Hand — drag to move about (H)", "ph-hand",
        () => useHand(!handTool));
      handButton.setAttribute("aria-pressed", "false");

      /* The arrow tool. Switched on, a drag from any box to any box is an
       * arrow — over and over, without selecting anything first, which is the
       * whole of why it is a mode rather than a button that does it once.
       */
      arrowButton = iconButton("Arrow — drag between boxes to join them (A)",
        "ph-arrow-up-right", () => useArrowTool(!arrowTool));
      arrowButton.setAttribute("aria-pressed", "false");

      /* The zoom sits on the paper, at the corner furthest from everything
       * else. It is about the view rather than about the diagram, so it
       * belongs to the window it changes rather than to the bar of things that
       * change the drawing.
       */
      zoom.append(
        iconButton("Zoom out", "ph-minus", () => zoomToCentre(1 / ZOOM_PER_NOTCH ** 2)),
        zoomField,
        iconButton("Zoom in", "ph-plus", () => zoomToCentre(ZOOM_PER_NOTCH ** 2)),
        iconButton("Fit the whole diagram", "ph-corners-out", () => fitView())
      );
      stage.append(zoom);

      // The keystroke is the one people use, but a canvas that only offers undo
      // to those who know the keystroke is a canvas that has hidden it.
      steps = document.createElement("div");
      steps.className = "ve-diagram-group ve-diagram-steps";

      const back = iconButton("Undo", "ph-arrow-counter-clockwise", () => {
        undo();
        showSteps();
      });
      const forward = iconButton("Redo", "ph-arrow-clockwise", () => {
        redo();
        showSteps();
      });

      showSteps = () => {
        back.disabled = !(history.past.length > 0 || sourceNow() !== history.present);
        forward.disabled = history.future.length === 0;
      };

      steps.append(back, forward);
      bar.append(group(handButton, arrowButton));
    }

    /* A picture of the diagram, for pasting somewhere that cannot open the
     * file. Two, because one of them keeps its shape at any size and the other
     * one goes anywhere.
     */
    const saveAs = (label, run) => {
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

    const pictures = group(saveAs("SVG", saveSvg), saveAs("PNG", savePng));
    pictures.setAttribute("aria-label", "Save a picture");

    bar.append(group(tidy), pictures, flowLabel);

    // Undo and redo go last and sit at the far end, away from everything that
    // makes a change — the two buttons that take one back are not two more of
    // the buttons that make one.
    if (steps) {
      bar.append(steps);
    }

    const rail = document.createElement("aside");
    rail.className = "ve-diagram-rail";
    rail.append(palette);

    const side = document.createElement("aside");
    side.className = "ve-diagram-side";
    side.append(hint, inspector, all);

    const body = document.createElement("div");
    body.className = "ve-diagram-body";

    /* How wide the two sides are, and whether they are there at all.
     *
     * Kept in the browser rather than in the diagram: how much room somebody
     * wants for the shapes is about their screen and their hands, not about the
     * drawing — a diagram that carried it would hand one person's window to
     * everyone who opened the file. Storage can refuse (a private window, site
     * data switched off), and a panel that will not open because of that is
     * worse than one that forgot how wide it was, so every read and write of it
     * is allowed to fail.
     */
    const PANEL_STORE = "azadocs:diagram:panels";
    const PANELS = {
      rail: { least: 56, most: 260, standard: 132 },
      side: { least: 200, most: 520, standard: 300 }
    };

    const panels = {
      rail: PANELS.rail.standard,
      side: PANELS.side.standard,
      railShut: false,
      sideShut: false,
      // The bar over the box is a fourth region, and it is put away the same
      // way the other three are: by asking, and it stays away.
      barShut: false,
      // The tree is worth seeing without being asked for — it is where a group
      // that has been folded away is found again — so it starts open.
      listShut: false
    };

    const inBounds = (which, value) => Math.min(PANELS[which].most,
      Math.max(PANELS[which].least, Math.round(Number(value) || 0)));

    function showPanels() {
      body.style.setProperty("--dd-rail", `${panels.rail}px`);
      body.style.setProperty("--dd-side", `${panels.side}px`);
      body.classList.toggle("is-rail-shut", panels.railShut);
      body.classList.toggle("is-side-shut", panels.sideShut);
      // A rail too narrow for the words is a rail of pictures, which is what
      // the phone already does with it — one rule, reached two ways.
      body.classList.toggle("is-rail-tight", panels.rail < 108);
      all.open = !panels.listShut;
    }

    function rememberPanels() {
      try {
        window.localStorage?.setItem(PANEL_STORE, JSON.stringify(panels));
      } catch {
        // Somewhere that will not keep it. The panels still work.
      }
    }

    try {
      const kept = JSON.parse(window.localStorage?.getItem(PANEL_STORE) || "null");
      if (kept && typeof kept === "object") {
        panels.rail = inBounds("rail", kept.rail ?? panels.rail);
        panels.side = inBounds("side", kept.side ?? panels.side);
        panels.railShut = Boolean(kept.railShut);
        panels.sideShut = Boolean(kept.sideShut);
        panels.barShut = Boolean(kept.barShut);
        panels.listShut = Boolean(kept.listShut);
      }
    } catch {
      // Nothing kept, or nothing readable. The standard widths, then.
    }

    /* The bar between two regions: drag it to move the edge, press the chevron
     * to take the region away and bring it back.
     *
     * A separator rather than a decoration, so it can be tabbed to and moved
     * with the arrow keys — an edge that can only be dragged is an edge that
     * belongs to whoever has a mouse.
     */
    function panelGrip(which, side) {
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
        const shut = panels[shutKey];
        grip.setAttribute("aria-valuenow", String(panels[which]));
        grip.setAttribute("aria-label", `How much room ${what} has`);
        button.setAttribute("aria-expanded", shut ? "false" : "true");
        button.title = shut ? `Show ${what}` : `Hide ${what}`;
        button.setAttribute("aria-label", button.title);
        // The chevron points the way pressing it moves the edge.
        const away = which === "rail" ? shut : !shut;
        button.firstChild.className = `ph ph-caret-${away ? "right" : "left"}`;
      };

      button.addEventListener("click", () => {
        panels[shutKey] = !panels[shutKey];
        showPanels();
        showGrip();
        rememberPanels();
      });

      const widen = (to) => {
        panels[which] = inBounds(which, to);
        panels[shutKey] = false;
        showPanels();
        showGrip();
      };

      let dragging = null;
      grip.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".ve-diagram-grip-shut")) {
          return;
        }

        dragging = { x: event.clientX, from: panels[which] };
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
        rememberPanels();
      };

      grip.addEventListener("pointerup", letGo);
      grip.addEventListener("pointercancel", letGo);

      grip.addEventListener("keydown", (event) => {
        const step = { ArrowLeft: -20, ArrowRight: 20 }[event.key];
        if (step === undefined) {
          return;
        }

        event.preventDefault();
        widen(panels[which] + (step * side));
        rememberPanels();
      });

      grip.append(button);
      showGrip();
      return grip;
    }

    body.append(rail, panelGrip("rail", 1), stage, panelGrip("side", -1), side);
    showPanels();

    const shell = document.createElement("div");
    shell.className = "ve-diagram-shell";
    shell.append(bar, body);

    /* The keys belong to the whole builder rather than to the paper.
     *
     * They were the canvas's, and the canvas had to have the focus — so pressing
     * Delete after choosing a colour did nothing at all, because the button in
     * the panel had the focus and the canvas was what was listening. Anything
     * inside the builder is near enough the diagram to mean the diagram.
     */
    shell.addEventListener("keydown", onKey);
    shell.addEventListener("keyup", onKeyUp);

    const parts = [shell];

    // A host with somewhere to go back to gets a way back. The page has nowhere
    // to close to — the editor is the whole of it — so it gets no button.
    if (typeof settings.onDone === "function") {
      const done = document.createElement("button");
      done.type = "button";
      done.className = "ve-embed-done";
      done.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i><span>Done</span>';
      done.addEventListener("click", () => {
        window.clearTimeout(drawTimer);
        settings.onDone();
      });
      parts.push(done);
    }

    paintLists();
    paintInspector();
    node.append(...parts);
    draw();

    // The diagram as it was opened is the state everything else is a change
    // from, and the one an undo run all the way back arrives at.
    history.present = sourceNow();
    showSteps();

    /* The first sight of a diagram is the whole of it.
     *
     * Which cannot be arranged until the canvas has been laid out, and appending
     * it is not the same moment as measuring it — so it is tried now, and again
     * on the next frame if now was too early, and again when the window changes
     * size until it has worked once.
     */
    let watching = null;
    if (viewport) {
      fitted = fitView();

      if (!fitted) {
        later(() => {
          fitted = fitView();
        });
      }

      if (typeof window.ResizeObserver === "function") {
        watching = new window.ResizeObserver(() => {
          if (!fitted) {
            fitted = fitView();
          }
        });
        watching.observe(canvas);
      }
    }

    return {
      // Where the diagram is being looked at from, which is not part of it and
      // is not written anywhere — but is worth being able to ask about.
      view: () => ({ ...view }),
      fit: fitView,
      undo,
      redo,
      copy: copySelection,
      cut: cutSelection,
      paste: pasteClipboard,
      duplicate: duplicateSelection,
      // Whether there is anywhere to go, so a host can grey out a button.
      canUndo: () => history.past.length > 0 || sourceNow() !== history.present,
      canRedo: () => history.future.length > 0,
      // What the file would say if it were written now. The host asks for this
      // when it saves rather than keeping its own copy in step.
      source: () => DiagramModel.serializeFlowchart(model).replace(/\n$/, ""),
      // A pending redraw of an editor nobody is holding any more is a diagram
      // drawn into an element nobody will see.
      destroy: () => {
        window.clearTimeout(drawTimer);
        watching?.disconnect();
        node.innerHTML = "";
      }
    };
  }

  global.DiagramEditor = {
    PALETTE: DIAGRAM_PALETTE,
    FLOWS: DIAGRAM_FLOWS,
    PAPER_PAD: DIAGRAM_PAPER_PAD,
    DRAG_SLOP: DIAGRAM_DRAG_SLOP,
    MIN_BOX: DIAGRAM_MIN_BOX,
    canOpen,
    mount
  };
})(typeof window === "undefined" ? globalThis : window);
