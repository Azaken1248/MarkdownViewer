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
    let selectedId = null;
    let armedFrom = null;

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
        // Its own size, on grid paper, with the handles on whatever is selected.
        natural: true,
        grid: true,
        pad: DIAGRAM_PAPER_PAD,
        selected: selectedId,
        label: "Diagram being edited"
      });
    };

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

    function moveTo(id, x, y) {
      const at = boxOf(id);
      if (!at) {
        return;
      }

      at.x = snap(x);
      at.y = snap(y);

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
      if (marks && id === selectedId && Number.isFinite(drawnAt)) {
        marks.setAttribute("transform", `translate(${at.x - drawnAt},${at.y - Number(marks.dataset.y)})`);
      }

      reroute(id);
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
      gesture = {
        kind,
        id,
        origin: point,
        from: at ? { x: at.x, y: at.y, w: at.w, h: at.h } : null,
        moved: false
      };

      const marks = drawing()?.querySelector(".dd-marks");
      if (marks && at) {
        // Where the marks were drawn, so moving them is a difference rather than
        // a re-render.
        marks.dataset.x = String(at.x);
        marks.dataset.y = String(at.y);
      }

      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // A browser without pointer capture still gets the move and up events
        // while the pointer is over the canvas, which is most of a drag.
      }
    }

    function applyGesture(point) {
      if (!gesture) {
        return;
      }

      if (gesture.kind === "move" && gesture.from) {
        moveTo(gesture.id, gesture.from.x + (point.x - gesture.origin.x),
          gesture.from.y + (point.y - gesture.origin.y));
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

    canvas.addEventListener("pointerdown", (event) => {
      if (typeof event.button === "number" && event.button > 0) {
        return;
      }

      const svg = drawing();
      if (!svg) {
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

      if (!id) {
        // Tapping the paper is how you put something down.
        select(null);
        return;
      }

      if (armedFrom && armedFrom !== id) {
        join(armedFrom, id);
        return;
      }

      if (id !== selectedId) {
        select(id);
      }

      beginGesture("move", id, point, event);
    });

    canvas.addEventListener("pointermove", (event) => {
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
        moveTo(held.id, held.from.x + (point.x - held.origin.x),
          held.from.y + (point.y - held.origin.y));
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

    canvas.addEventListener("keydown", (event) => {
      if (!selectedId) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeStep(selectedId);
        return;
      }

      if (event.key === "Escape") {
        select(null);
        return;
      }

      const step = event.shiftKey ? DiagramModel.GRID * 5 : DiagramModel.GRID;
      const nudge = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }[event.key];

      if (!nudge) {
        return;
      }

      event.preventDefault();
      const at = boxOf(selectedId);
      if (at) {
        moveTo(selectedId, at.x + nudge[0], at.y + nudge[1]);
        write();
        drawSoon();
      }
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
      model.nodes = model.nodes.filter((item) => item.id !== id);
      // An arrow to a step that is no longer there would declare it again by
      // naming it, and the step would come back as an empty box.
      model.edges = model.edges.filter((edge) => edge.from !== id && edge.to !== id);
      delete model.layout[id];
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

    function select(id, options = {}) {
      selectedId = nodeById(id) ? id : null;
      armedFrom = null;
      paintInspector(options);
      // The ring and its handles are part of the drawing, so selecting something
      // is a redraw — of a picture that is a few kilobytes of string.
      drawAtOnce();
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

    return {
      // What the file would say if it were written now. The host asks for this
      // when it saves rather than keeping its own copy in step.
      source: () => DiagramModel.serializeFlowchart(model).replace(/\n$/, ""),
      // A pending redraw of an editor nobody is holding any more is a diagram
      // drawn into an element nobody will see.
      destroy: () => {
        window.clearTimeout(drawTimer);
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
