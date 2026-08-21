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
    const model = {
      direction: opened.direction,
      nodes: opened.nodes,
      edges: opened.edges,
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

    const write = () => {
      onChange(DiagramModel.serializeFlowchart(model).replace(/\n$/, ""));
    };

    const commit = () => {
      write();
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

    const snap = (value) => Math.max(0, DiagramModel.snap(value));

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
    function moveSelectionTo(group, dx, dy) {
      for (const [id, from] of Object.entries(group || {})) {
        moveTo(id, from.x + dx, from.y + dy);
      }
    }

    function resizeTo(id, w, h) {
      const at = boxOf(id);
      if (!at) {
        return;
      }

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
        moveSelectionTo(gesture.group, point.x - gesture.origin.x, point.y - gesture.origin.y);
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
    let spaceHeld = false;

    canvas.addEventListener("pointerdown", (event) => {
      const svg = drawing();
      if (!svg) {
        return;
      }

      // The middle button is a pan and nothing else, on every diagram tool
      // anyone has used, and it is the one gesture that never means select.
      if (viewport && (event.button === 1 || spaceHeld)) {
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
        panning = null;
        frame = 0;
        canvas.classList.remove("is-panning");

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
        moveSelectionTo(held.group, point.x - held.origin.x, point.y - held.origin.y);
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

    /* --- Getting about ------------------------------------------------------
     *
     * The wheel zooms about the pointer, because the thing under it is the thing
     * being looked at and it is the one point that must not move. Shift makes it
     * a sideways pan, which is what a wheel means on a trackpad held sideways.
     * Two fingers pinch. Space held turns any drag into a pan.
     */
    if (viewport) {
      canvas.addEventListener("wheel", (event) => {
        event.preventDefault();

        if (event.shiftKey) {
          view.x -= event.deltaY;
          applyView();
          return;
        }

        // The sign and a fixed ratio, not the distance: what a notch reports
        // varies by an order of magnitude between a mouse and a trackpad.
        const notches = event.deltaY > 0 ? -1 : 1;
        zoomAbout(event.clientX, event.clientY, ZOOM_PER_NOTCH ** notches);
      }, { passive: false });

      canvas.addEventListener("keyup", (event) => {
        if (event.key === " " || event.code === "Space") {
          spaceHeld = false;
          canvas.classList.remove("is-panning-armed");
        }
      });

      // A canvas that keeps thinking the space bar is down after the window has
      // gone away is a canvas where nothing can be selected any more.
      window.addEventListener("blur", () => {
        spaceHeld = false;
        canvas.classList.remove("is-panning-armed");
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

    canvas.addEventListener("keydown", (event) => {
      if (viewport && (event.key === " " || event.code === "Space")) {
        // Not while typing into something on the canvas, where a space is a
        // space.
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "")) {
          event.preventDefault();
          spaceHeld = true;
          canvas.classList.add("is-panning-armed");
        }

        return;
      }

      // The one keystroke that does not need anything selected already.
      if ((event.ctrlKey || event.metaKey) && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        choose(model.nodes.map((item) => item.id));
        return;
      }

      if (event.key === "Escape") {
        select(null);
        return;
      }

      if (selection.length === 0) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
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
      event.preventDefault();
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

      write();
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

    const arrowRow = (edge) => {
      const row = document.createElement("div");
      row.className = "ve-diagram-row ve-diagram-arrow";

      const from = stepSelect(edge.from, "Arrow from", "ve-diagram-pick");
      const kind = document.createElement("select");
      kind.className = "ve-diagram-kind";
      kind.setAttribute("aria-label", "Arrow style");

      for (const option of DiagramModel.EDGE_KINDS) {
        const choice = document.createElement("option");
        choice.value = option.name;
        choice.textContent = option.label;
        kind.appendChild(choice);
      }

      kind.value = edge.kind;

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

      kind.addEventListener("change", () => {
        edge.kind = kind.value;
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

      row.append(from, kind, label, to, drop);
      return row;
    };

    function paintInspector(options = {}) {
      inspector.replaceChildren();
      const item = selectedNode();

      if (!item) {
        say(model.nodes.length === 0
          ? "Drag a shape onto the paper to start."
          : "Tap a box to work on it, or drag one to move it.");
        return;
      }

      say(armedFrom ? "Now tap the step this one should point at." : "");

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
      inspector.append(line, actions);

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

      zoom.append(
        stepButton("Zoom out", "ph-minus", () => zoomToCentre(1 / ZOOM_PER_NOTCH ** 2)),
        zoomField,
        stepButton("Zoom in", "ph-plus", () => zoomToCentre(ZOOM_PER_NOTCH ** 2)),
        stepButton("Fit the whole diagram", "ph-corners-out", () => fitView())
      );

      head.append(zoom);
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
