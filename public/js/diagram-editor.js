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

  const DIAGRAM_COLOUR_KEYS = ["fill", "stroke", "color"];
  const DIAGRAM_CLASS_PREFIX = "ddC";
  const DIAGRAM_CLASS_RE = /^ddC\d+$/;

  /* The diagram this editor is able to open, or null.
   *
   * The parser reads more than the canvas can draw — a group, for one — and an
   * editor that quietly hides part of a diagram is an editor that writes back a
   * diagram nobody recognises. Those stay as source until the canvas can draw
   * them, which is the one honest answer while it cannot.
   */
  function canOpen(source) {
    const model = DiagramModel.parseFlowchart(String(source ?? ""));
    return model.ok && DiagramDraw.canDraw(model) ? model : null;
  }

  function diagramShapeLabel(name) {
    return (DiagramModel.SHAPES.find((shape) => shape.name === name) || {}).label || name;
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
  const DIAGRAM_PALETTE = [
    { shape: "rect", kind: "box", label: "Box" },
    { shape: "round", kind: "box", label: "Rounded" },
    { shape: "diamond", kind: "box", label: "Decision" },
    { shape: "stadium", kind: "box", label: "Stadium" },
    { shape: "circle", kind: "box", label: "Circle" },
    { shape: "rect", kind: "table", label: "Table" }
  ];

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

    function resizeTo(id, w, h) {
      const at = boxOf(id);
      if (!at) {
        return;
      }

      // A position may be negative; a size may not.
      at.w = Math.max(DIAGRAM_MIN_BOX, snap(w));
      at.h = Math.max(DIAGRAM_MIN_BOX / 2, snap(h));
      // A shape has to be drawn again to be a different size, and the handles
      // move with its corner, so this one is a redraw.
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

        /* What is being carried is drawn on top of everything for as long as it
         * is being carried.
         *
         * The drawing is layered from the outside in, so a box dragged into a
         * bigger one belongs a layer deeper than it is — and until the redraw
         * that follows the drag says so, it would be under the box it was just
         * dropped into. Which reads as having dropped it and lost it.
         */
        const layers = drawing()?.querySelectorAll(".dd-nodes");
        const top = layers?.[layers.length - 1];

        for (const one of Object.keys(group)) {
          const box = drawing()?.querySelector(`.dd-node[data-id="${one}"]`);
          if (top && box) {
            top.append(box);
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

      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // A browser without pointer capture still gets the move and up events
        // while the pointer is over the canvas, which is most of a drag.
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
        resizeTo(gesture.id, gesture.from.w + (point.x - gesture.origin.x),
          gesture.from.h + (point.y - gesture.origin.y));
        return;
      }

      if (gesture.kind === "connect") {
        drawDraft(point);
      }
    }

    // The arrow being drawn, which is not an arrow yet and so is not in the model
    // yet either. It is one element, made once and moved.
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
        svg.appendChild(draft);
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

      showGrab();
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
      const handle = event.target.closest?.("[data-role]");

      if (handle && selectedId) {
        beginGesture(handle.getAttribute("data-role") === "resize" ? "resize" : "connect",
          selectedId, point, event);
        return;
      }

      const id = event.target.closest?.(".dd-node")?.getAttribute("data-id") || boxAt(point);

      const adding = Boolean(event.shiftKey);

      if (!id) {
        /* Empty paper. With a finger it is how you go somewhere else, because a
         * finger has no space bar and no middle button to pan with. With a
         * pointer it is how you draw a rubber band round several boxes, which
         * is what dragging empty space means everywhere else.
         */
        if (!adding) {
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

      // A box already in a selection of several is not a new selection — it is
      // the handle you drag the whole lot by. Narrowing to it on the way down
      // would make a multiple selection impossible to move.
      if (!isSelected(id)) {
        select(id);
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

        if (!held.moved) {
          // The circle, clicked rather than dragged: grow a new box out of this
          // one, already joined, ready to be named.
          addBox({ joinFrom: held.id });
          return;
        }

        // Dragged to empty paper: the same thing, put down where it was let go.
        addBox({ joinFrom: held.id, x: point.x, y: point.y });
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
        resizeTo(held.id, held.from.w + (point.x - held.origin.x),
          held.from.h + (point.y - held.origin.y));
      }

      write();
      drawAtOnce();
    };

    canvas.addEventListener("pointerup", endGesture);
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

      const shown = items.filter(Boolean);
      if (shown.length === 0) {
        return;
      }

      menu = document.createElement("div");
      menu.className = "ve-diagram-menu";
      menu.setAttribute("role", "menu");

      for (const item of shown) {
        if (item === "-") {
          const rule = document.createElement("div");
          rule.className = "ve-diagram-menu-rule";
          menu.append(rule);
          continue;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "ve-diagram-menu-item";
        button.setAttribute("role", "menuitem");
        button.textContent = item.label;
        if (item.keys) {
          const keys = document.createElement("span");
          keys.className = "ve-diagram-menu-keys";
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

    function menuFor(target, point) {
      const many = selection.length > 1;
      const holding = selection.length > 0;

      if (target.kind === "edge") {
        const edge = model.edges[target.index];
        return [
          { label: "Edit label", run: () => editEdge(target.index) },
          { label: "Turn it round", run: () => {
            const was = edge.from;
            edge.from = edge.to;
            edge.to = was;
            write();
            paintLists();
            drawAtOnce();
          } },
          "-",
          { label: "Delete arrow", keys: "Del", run: () => {
            model.edges = model.edges.filter((other) => other !== edge);
            write();
            paintLists();
            paintInspector();
            drawAtOnce();
          } }
        ];
      }

      if (target.kind === "node") {
        return [
          many ? null : { label: "Edit text", run: () => editNode(target.id) },
          many ? null : { label: "Draw an arrow from here", run: () => {
            armedFrom = target.id;
            say("Tap another box to join it.");
          } },
          "-",
          { label: many ? "Duplicate them" : "Duplicate", keys: "Ctrl+D", run: duplicateSelection },
          { label: "Cut", keys: "Ctrl+X", run: cutSelection },
          { label: "Copy", keys: "Ctrl+C", run: copySelection },
          { label: "Copy as Mermaid", run: () => copyOutside(selectionSource()) },
          "-",
          { label: "Bring to front", run: () => restack(selection, true) },
          { label: "Send to back", run: () => restack(selection, false) },
          "-",
          { label: many ? "Delete them" : "Delete", keys: "Del", run: () => removeSteps(selection) }
        ];
      }

      return [
        { label: "Paste", keys: "Ctrl+V", run: pasteClipboard },
        { label: "Add a box here", run: () => addBox({ x: point.x, y: point.y }) },
        "-",
        { label: "Select all", keys: "Ctrl+A", run: () => choose(model.nodes.map((item) => item.id)) },
        holding ? { label: "Select none", keys: "Esc", run: () => select(null) } : null,
        "-",
        viewport ? { label: "Fit the whole diagram", run: () => fitView() } : null,
        viewport
          ? {
            label: handTool ? "Stop moving about" : "Drag to move about",
            keys: handTool ? "V" : "H",
            run: () => useHand(!handTool)
          }
          : null,
        { label: "Copy the diagram as Mermaid", run: () => copyOutside(sourceNow()) }
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

      return { kind: "paper" };
    }

    function showMenuFrom(event) {
      const point = pointIn(event.clientX, event.clientY);
      const target = targetAt(event, point);

      // Right-clicking a box that is not in the selection is about that box.
      // Right-clicking one that is, is about the whole handful.
      if (target.kind === "node" && !isSelected(target.id)) {
        select(target.id);
      }

      openMenu(event.clientX, event.clientY, menuFor(target, point));
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
      // Scaled with the diagram, so what is typed is the size it will be.
      style.fontSize = `${13 * view.scale}px`;
    }

    function startEditing(what) {
      stopEditing(true);

      const field = document.createElement("textarea");
      field.className = "ve-diagram-inline";
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

    function editNode(id) {
      const item = nodeById(id);
      if (!item) {
        return;
      }

      select(id);
      startEditing({
        label: "Box text",
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

    canvas.addEventListener("dblclick", (event) => {
      const group = event.target.closest?.(".dd-node");
      if (group) {
        editNode(group.getAttribute("data-id"));
        return;
      }

      const line = event.target.closest?.(".dd-edge");
      if (line) {
        editEdge(Number(line.getAttribute("data-edge")));
      }
    });

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

      canvas.addEventListener("keyup", (event) => {
        if (event.key === " " || event.code === "Space") {
          spaceHeld = false;
          showGrab();
        }
      });

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

    canvas.addEventListener("keydown", (event) => {
      if (viewport && (event.key === " " || event.code === "Space")) {
        // Not while typing into something on the canvas, where a space is a
        // space.
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "")) {
          answered(event);
          spaceHeld = true;
          canvas.classList.add("is-panning-armed");
        }

        return;
      }

      /* The hand and the pointer, on the keys they have in every editor that
       * offers both. Not while typing into something on the canvas, where an h
       * is an h and a v is a v.
       */
      if (viewport && !(event.ctrlKey || event.metaKey || event.altKey)
        && /^[hv]$/i.test(event.key)
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "")) {
        answered(event);
        useHand(event.key.toLowerCase() === "h");
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

        // A hand switched on is a mode, and a mode wants a way out that does
        // not involve finding the button that turned it on.
        if (handTool) {
          event.stopPropagation();
          useHand(false);
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
          editNode(selection[0]);
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
    });

    /* --- Making things ------------------------------------------------------ */

    function addBox(options = {}) {
      if (model.nodes.length >= DiagramModel.MAX_NODES) {
        say("That is as many steps as this can hold.");
        return;
      }

      const kind = options.kind === "table" ? "table" : "box";
      const id = DiagramModel.nextNodeId(model);
      const item = {
        id,
        shape: options.shape || "rect",
        text: kind === "table" ? "Thing<br/>field: type" : `Step ${model.nodes.length + 1}`
      };

      // What a box is belongs to the box. Where it is belongs to the layout.
      if (kind !== "box") {
        item.kind = kind;
      }

      model.nodes.push(item);

      const size = DiagramModel.measureNode(item);
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
      select(id, { focusName: true });
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

      write();
      paintLists();
      select(null);
    }

    /* --- The palette --------------------------------------------------------
     *
     * Tap one to drop a shape into the diagram, or drag one onto the paper to put
     * it exactly where you want it. The ghost that follows the finger is a plain
     * element rather than anything in the drawing, because until it is let go it
     * is not part of the diagram.
     */
    const palette = document.createElement("div");
    palette.className = "ve-diagram-palette";

    for (const choice of DIAGRAM_PALETTE) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ve-diagram-tool";
      button.dataset.shape = choice.shape;
      button.dataset.kind = choice.kind;
      button.textContent = choice.label;
      button.title = `Add a ${choice.label.toLowerCase()} — drag it onto the diagram`;

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

        if (!dragging) {
          addBox({ shape: choice.shape, kind: choice.kind });
          return;
        }

        dragging = false;
        const paper = canvas.getBoundingClientRect();
        const inside = event.clientX >= paper.left && event.clientX <= paper.right
          && event.clientY >= paper.top && event.clientY <= paper.bottom;

        if (!inside) {
          return;
        }

        const point = pointIn(event.clientX, event.clientY);
        addBox({ shape: choice.shape, kind: choice.kind, x: point.x, y: point.y });
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

    const tidy = document.createElement("button");
    tidy.type = "button";
    tidy.className = "ve-diagram-tool ve-diagram-tidy";
    tidy.textContent = "Tidy";
    tidy.title = "Arrange every box again, following the flow direction";
    tidy.addEventListener("click", () => {
      model.layout = DiagramModel.autoLayout(model);
      write();
      paintLists();
      drawAtOnce();
    });

    palette.appendChild(tidy);

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
      // The ring and its handles are part of the drawing, so selecting something
      // is a redraw — of a picture that is a few kilobytes of string.
      drawAtOnce();
    }

    function select(id, options = {}) {
      choose(id ? [id] : [], options);
    }

    // Shift, on every canvas anyone has used: add what was not there, take away
    // what was.
    function toggleInSelection(id) {
      choose(isSelected(id) ? selection.filter((one) => one !== id) : [...selection, id]);
    }

    /* --- What you can do to what is selected ------------------------------- */

    const stepSelect = (value, label, className) => {
      const picker = document.createElement("select");
      picker.className = className;
      picker.setAttribute("aria-label", label);

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

    // The shape menu, with the table on the end of it. A table is a kind rather
    // than a shape, but from here it is one more thing a box can be.
    const shapeSelect = (item) => {
      const shape = document.createElement("select");
      shape.className = "ve-diagram-shape";
      shape.setAttribute("aria-label", "Step shape");

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

      shape.value = item.kind === "table" ? "table" : item.shape;
      shape.addEventListener("change", () => {
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

      const size = DiagramModel.measureNode(item);
      at.w = Math.max(at.w, size.w);
      at.h = Math.max(at.h, size.h);
    }

    // The label, as lines. One line for most boxes; a title and its rows for a
    // table. Newlines here are the <br/> Mermaid understands.
    const labelField = (item) => {
      const field = document.createElement("textarea");
      field.className = "ve-diagram-text";
      field.rows = item.kind === "table" ? 3 : 1;
      field.value = DiagramModel.textRows(item.text).join("\n");
      field.placeholder = item.id;
      field.setAttribute("aria-label", item.kind === "table" ? "Table rows" : "Step label");

      field.addEventListener("input", () => {
        item.text = DiagramModel.joinRows(field.value.split("\n"));
        grow(item);
        renameEverywhere(item.id, stepLabel(item));
        commit();
      });

      return field;
    };

    // A select with a fixed list of choices, which the arrow row wants three of.
    const chooser = (className, aria, choices, value) => {
      const select = document.createElement("select");
      select.className = className;
      select.setAttribute("aria-label", aria);

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

      // The three read left to right the way the line does: what is at its
      // back, how it is drawn, what is at its point.
      const back = chooser("ve-diagram-kind", "Arrow start", endChoices, ends[0]);
      const style = chooser("ve-diagram-kind", "Line style",
        DiagramModel.LINE_STYLES, DiagramModel.lineStyleOf(edge.kind));
      const forward = chooser("ve-diagram-kind", "Arrow end", endChoices, ends[1]);

      const line = document.createElement("div");
      line.className = "ve-diagram-ends";
      line.append(back, style, forward);

      const label = document.createElement("input");
      label.type = "text";
      label.className = "ve-diagram-text";
      label.value = edge.label;
      label.placeholder = "label";
      label.setAttribute("aria-label", "Arrow label");

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
    function restyle(ids, patch) {
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
      write();
      drawAtOnce();
      paintInspector();
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
      custom.setAttribute("aria-label", "Any colour");
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

    function paintInspector(options = {}) {
      inspector.replaceChildren();
      const item = selectedNode();

      if (!item) {
        /* A handful has no one name or shape to show, but it has a colour: the
         * reason to hold four boxes at once is usually to do one thing to all
         * four of them, and this is that thing.
         */
        if (selection.length > 1) {
          say(`${selection.length} boxes held. Colour them, or drag them about.`);
          inspector.append(colourRow([...selection]), borderRow([...selection]));
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

      const line = document.createElement("div");
      line.className = "ve-diagram-row ve-diagram-selected";

      const name = labelField(item);
      const drop = dropButton(`Remove ${stepLabel(item)}`);
      drop.addEventListener("click", () => removeStep(item.id));

      line.append(name, shapeSelect(item), drop);

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

      const out = model.edges.filter((edge) => edge.from === item.id);
      inspector.append(line, colourRow([item.id]), borderRow([item.id]), actions);

      if (out.length > 0) {
        const legend = document.createElement("div");
        legend.className = "ve-diagram-legend";
        legend.textContent = out.length === 1 ? "Its arrow" : "Its arrows";

        const rows = document.createElement("div");
        rows.className = "ve-diagram-rows";
        rows.append(...out.map(arrowRow));
        inspector.append(legend, rows);
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
      flow.setAttribute("aria-label", "Diagram direction");

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
    allSummary.textContent = "All steps and arrows";

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

    function nodeRow(item) {
      const row = document.createElement("div");
      row.className = "ve-diagram-row";
      row.dataset.nodeId = item.id;

      const text = labelField(item);

      // Reaching a step from the list is the other half of reaching it from the
      // diagram, and it has to leave the same thing selected either way.
      text.addEventListener("focus", () => {
        if (selectedId !== item.id) {
          select(item.id);
        }
      });

      const drop = dropButton(`Remove ${stepLabel(item)}`);
      drop.addEventListener("click", () => removeStep(item.id));

      row.append(text, shapeSelect(item), drop);
      return row;
    }

    function paintLists() {
      nodeRows.replaceChildren(...model.nodes.map(nodeRow));
      edgeRows.replaceChildren(...model.edges.map(arrowRow));
      addArrow.disabled = model.nodes.length < 2 || model.edges.length >= DiagramModel.MAX_EDGES;
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
    stepsLegend.textContent = "Steps";

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
    });

    all.append(allSummary, stepsLegend, nodeRows, arrowsLegend, edgeRows, addArrow);

    /* --- Putting it together ---------------------------------------------- */

    const head = document.createElement("div");
    head.className = "ve-embed-head ve-diagram-head";

    const title = document.createElement("span");
    title.textContent = settings.title || "diagram";

    const flowLabel = document.createElement("label");
    flowLabel.className = "ve-diagram-flow";

    const flowText = document.createElement("span");
    flowText.textContent = "Flow";
    flowLabel.append(flowText, flowControl());

    head.append(title, flowLabel);

    /* The zoom, which is a readout as much as a control.
     *
     * Typeable, because "make this 100%" and "make this fit on a slide" are
     * things people want exactly rather than approximately, and a pair of
     * buttons can only ever get near.
     */
    let zoomField = null;
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

      const stepButton = (label, icon, run) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ve-diagram-zoom-step";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
        button.addEventListener("click", run);
        return button;
      };

      zoomField = document.createElement("input");
      zoomField.type = "text";
      zoomField.className = "ve-diagram-zoom-value";
      zoomField.setAttribute("aria-label", "Zoom");
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
      handButton = stepButton("Hand — drag to move about (H)", "ph-hand",
        () => useHand(!handTool));
      handButton.setAttribute("aria-pressed", "false");

      zoom.append(
        handButton,
        stepButton("Zoom out", "ph-minus", () => zoomToCentre(1 / ZOOM_PER_NOTCH ** 2)),
        zoomField,
        stepButton("Zoom in", "ph-plus", () => zoomToCentre(ZOOM_PER_NOTCH ** 2)),
        stepButton("Fit the whole diagram", "ph-corners-out", () => fitView())
      );

      // The keystroke is the one people use, but a canvas that only offers undo
      // to those who know the keystroke is a canvas that has hidden it.
      const steps = document.createElement("div");
      steps.className = "ve-diagram-zoom ve-diagram-steps";

      const back = stepButton("Undo", "ph-arrow-counter-clockwise", () => {
        undo();
        showSteps();
      });
      const forward = stepButton("Redo", "ph-arrow-clockwise", () => {
        redo();
        showSteps();
      });

      showSteps = () => {
        back.disabled = !(history.past.length > 0 || sourceNow() !== history.present);
        forward.disabled = history.future.length === 0;
      };

      steps.append(back, forward);
      head.append(steps, zoom);
    }

    const parts = [head, palette, stage, hint, inspector, all];

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
