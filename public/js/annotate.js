/* Writing on a shared document.
 *
 * A shared link is somebody else's document, and this is a transparency laid
 * over it: pens, a highlighter, shapes, an eraser and a laser pointer. The
 * marks are kept in this browser and go nowhere near the server — the person
 * who shared the document cannot see them, and neither can anybody else who
 * opens the same link. That is the whole design rather than a shortcut.
 *
 * Three modules under js/annotate do the work. `geometry` is the maths, and is
 * pure so it can be tested without a browser; `surface` is the SVG and the
 * pointer; `store` is localStorage. This is the part that knows about tools,
 * undo and the toolbar.
 */

/* exported Annotate */
var Annotate = (function () {
  "use strict";

  const Surface = AnnotateSurface;

  /* The pens, in the order they appear.
   *
   * Tuned for both themes rather than picked: each is a pastel that carries on
   * near-black and darkens enough to read on white, which is the same bargain
   * the app's own palette makes.
   */
  const COLOURS = [
    { name: "Red", value: "#eb6f6a" },
    { name: "Amber", value: "#e0a94a" },
    { name: "Green", value: "#6ec288" },
    { name: "Blue", value: "#5aa9e6" },
    { name: "Violet", value: "#b08ae0" },
    { name: "Ink", value: "#8ed9cf" }
  ];

  const WIDTHS = [
    { name: "Fine", value: 2 },
    { name: "Medium", value: 4 },
    { name: "Broad", value: 8 }
  ];

  const TOOLS = [
    { id: "pen", label: "Pen", icon: "ph-pencil-simple" },
    { id: "highlighter", label: "Highlighter", icon: "ph-highlighter" },
    { id: "line", label: "Line", icon: "ph-line-segment" },
    { id: "arrow", label: "Arrow", icon: "ph-arrow-up-right" },
    { id: "rectangle", label: "Rectangle", icon: "ph-rectangle" },
    { id: "ellipse", label: "Ellipse", icon: "ph-circle" },
    { id: "laser", label: "Laser pointer", icon: "ph-cursor" }
  ];

  // How many steps back. Enough to undo a page of marking, bounded so a long
  // session cannot grow without limit.
  const HISTORY_DEPTH = 100;

  /* --- History ------------------------------------------------------------
   *
   * Snapshots of the stroke list rather than a log of operations. A stroke is
   * a small object and there are at most a few hundred; a hundred shallow
   * copies of that list costs nothing, and it makes undo exact for every
   * operation — including erasing several strokes with one drag — without a
   * separate inverse for each.
   */
  function remember(view) {
    view.past.push(view.strokes.slice());
    if (view.past.length > HISTORY_DEPTH) {
      view.past.shift();
    }

    view.future.length = 0;
  }

  function undo(view) {
    if (view.past.length === 0) {
      return;
    }

    view.future.push(view.strokes.slice());
    view.strokes = view.past.pop();
    Surface.redraw(view);
    persist(view);
    paintToolbar(view);
  }

  function redo(view) {
    if (view.future.length === 0) {
      return;
    }

    view.past.push(view.strokes.slice());
    view.strokes = view.future.pop();
    Surface.redraw(view);
    persist(view);
    paintToolbar(view);
  }

  function clearAll(view) {
    if (view.strokes.length === 0) {
      return;
    }

    remember(view);
    view.strokes = [];
    Surface.redraw(view);
    persist(view);
    paintToolbar(view);
  }

  /* --- Keeping it ---------------------------------------------------------- */

  function persist(view) {
    const result = AnnotateStore.save(view.token, view.strokes);
    view.lastSave = result;

    if (!result.saved && result.reason === "too-big") {
      say(view, "There is too much ink on this document to save it all. "
        + "What is on screen stays for this visit.");
      return;
    }

    if (!result.saved && result.reason === "refused") {
      say(view, "This browser will not store the marks, so they stay for this visit only.");
    }
  }

  function say(view, message) {
    if (!view.status) {
      return;
    }

    view.status.textContent = message;
    window.clearTimeout(view.statusTimer);
    view.statusTimer = window.setTimeout(() => {
      view.status.textContent = "";
    }, 6000);
  }

  /* --- The pointer --------------------------------------------------------- */

  /* A point, and how hard the pen was pressed at it.
   *
   * A stylus reports 0..1; a mouse reports 0.5 for "a button is down" and a
   * finger usually reports nothing useful. Only a real stylus reading is kept
   * — everything else is left for the speed of the hand to decide, which is
   * the only signal a mouse actually gives.
   */
  function withPressure(view, event) {
    const at = Surface.pointIn(view, event);
    const real = event.pointerType === "pen" && event.pressure > 0 && event.pressure < 1;
    return real ? [at[0], at[1], event.pressure] : at;
  }

  function onDown(view, event) {
    if (view.tool === "none" || event.button > 0) {
      return;
    }

    // The layer takes the pointer for the whole stroke, so a hand that leaves
    // the document mid-line does not leave half a line behind.
    view.svg.setPointerCapture?.(event.pointerId);
    event.preventDefault();

    const at = withPressure(view, event);
    view.pointerDown = true;

    if (view.tool === "laser") {
      Surface.laserTo(view, at);
      return;
    }

    if (view.tool === "eraser") {
      view.erasedThisDrag = false;
      rubOut(view, at);
      return;
    }

    remember(view);
    Surface.beginStroke(view, at);
  }

  function onMove(view, event) {
    if (!view.pointerDown) {
      return;
    }

    const at = withPressure(view, event);

    if (view.tool === "laser") {
      Surface.laserTo(view, at);
      return;
    }

    if (view.tool === "eraser") {
      rubOut(view, at);
      return;
    }

    Surface.extendStroke(view, at);
  }

  // One drag is one undo step, however many strokes it rubs out.
  function rubOut(view, at) {
    if (!view.erasedThisDrag) {
      remember(view);
    }

    if (Surface.eraseAt(view, at)) {
      view.erasedThisDrag = true;
      paintToolbar(view);
    }
  }

  function onUp(view, event) {
    if (!view.pointerDown) {
      return;
    }

    view.pointerDown = false;
    view.svg.releasePointerCapture?.(event.pointerId);

    if (view.tool === "laser") {
      return;
    }

    if (view.tool === "eraser") {
      if (view.erasedThisDrag) {
        persist(view);
      } else {
        // Nothing was rubbed out, so the step put on the stack was not a step.
        view.past.pop();
      }

      return;
    }

    const stroke = Surface.settleStroke(view);
    view.liveNode?.remove();
    view.liveNode = null;
    view.drawing = null;

    // A tap with a shape tool is not a shape.
    if (!stroke || (Surface.SHAPE_TOOLS.has(stroke.tool) && stroke.points.length < 2)) {
      view.past.pop();
      return;
    }

    view.strokes.push(stroke);
    Surface.redraw(view);
    persist(view);
    paintToolbar(view);
  }

  /* --- The toolbar --------------------------------------------------------- */

  // Built rather than written as markup: an icon name interpolated into
  // innerHTML is the thing eslint-plugin-no-unsanitized exists to refuse, and
  // two createElement calls are cheaper than arguing with it.
  function button(className, title, icon) {
    const made = document.createElement("button");
    made.type = "button";
    made.className = className;
    made.title = title;
    made.setAttribute("aria-label", title);

    const glyph = document.createElement("i");
    glyph.className = `ph ${icon}`;
    glyph.setAttribute("aria-hidden", "true");
    made.appendChild(glyph);
    return made;
  }

  function toolButtons(view) {
    const group = document.createElement("div");
    group.className = "ink-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Tools");

    for (const tool of TOOLS) {
      const made = button("ink-btn ink-tool", tool.label, tool.icon);
      made.dataset.tool = tool.id;
      made.setAttribute("aria-pressed", "false");
      made.addEventListener("click", () => chooseTool(view, tool.id));
      group.appendChild(made);
    }

    return group;
  }

  function colourButtons(view) {
    const group = document.createElement("div");
    group.className = "ink-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Colour");

    for (const colour of COLOURS) {
      const made = document.createElement("button");
      made.type = "button";
      made.className = "ink-swatch";
      made.dataset.colour = colour.value;
      made.title = colour.name;
      made.setAttribute("aria-label", colour.name);
      made.setAttribute("aria-pressed", "false");
      made.style.setProperty("--swatch", colour.value);
      made.addEventListener("click", () => {
        view.colour = colour.value;
        paintToolbar(view);
      });
      group.appendChild(made);
    }

    return group;
  }

  function widthButtons(view) {
    const group = document.createElement("div");
    group.className = "ink-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Thickness");

    for (const width of WIDTHS) {
      const made = document.createElement("button");
      made.type = "button";
      made.className = "ink-width";
      made.dataset.width = String(width.value);
      made.title = width.name;
      made.setAttribute("aria-label", width.name);
      made.setAttribute("aria-pressed", "false");

      const rule = document.createElement("span");
      rule.style.height = `${width.value}px`;
      made.appendChild(rule);

      made.addEventListener("click", () => {
        view.width = width.value;
        paintToolbar(view);
      });
      group.appendChild(made);
    }

    return group;
  }

  /* The two erasers.
   *
   * They stand in the toolbar as tools in their own right rather than as a
   * mode hidden behind a second press on one eraser button, because a mode
   * you cannot see is a mode you do not know you are in. Picking either one
   * picks up the eraser; pressing the one you are holding puts it down.
   */
  const ERASERS = [
    { id: "stroke", label: "Eraser: whole stroke", icon: "ph-eraser" },
    { id: "point", label: "Eraser: rub out", icon: "ph-dot-outline" }
  ];

  function eraserButtons(view) {
    const group = document.createElement("div");
    group.className = "ink-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Eraser");

    for (const mode of ERASERS) {
      const made = button("ink-btn ink-eraser", mode.label, mode.icon);
      made.dataset.eraser = mode.id;
      made.setAttribute("aria-pressed", "false");
      made.addEventListener("click", () => {
        const held = view.tool === "eraser" && view.eraserMode === mode.id;
        view.eraserMode = mode.id;
        holdTool(view, held ? "none" : "eraser");
      });
      group.appendChild(made);
    }

    return group;
  }

  /* Ink to shape, which is a mode rather than a tool: it changes what the pen
   * leaves behind, not what a drag does. On by default, and off in one press
   * for anyone whose handwriting keeps being read as a circle.
   */
  function shapeToggle(view) {
    const group = document.createElement("div");
    group.className = "ink-group";

    const made = button("ink-btn ink-toggle", "Tidy shapes as they are drawn", "ph-shapes");
    made.setAttribute("aria-pressed", String(view.inkToShape));
    made.addEventListener("click", () => {
      view.inkToShape = !view.inkToShape;
      paintToolbar(view);
    });

    view.shapeBtn = made;
    group.appendChild(made);
    return group;
  }

  function actionButtons(view) {
    const group = document.createElement("div");
    group.className = "ink-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Actions");

    view.undoBtn = button("ink-btn", "Undo", "ph-arrow-counter-clockwise");
    view.undoBtn.addEventListener("click", () => undo(view));

    view.redoBtn = button("ink-btn", "Redo", "ph-arrow-clockwise");
    view.redoBtn.addEventListener("click", () => redo(view));

    view.clearBtn = button("ink-btn ink-danger", "Erase everything", "ph-trash");
    view.clearBtn.addEventListener("click", () => {
      if (window.confirm("Erase every mark on this document?")) {
        clearAll(view);
      }
    });

    group.append(view.undoBtn, view.redoBtn, view.clearBtn);
    return group;
  }

  function buildToolbar(view) {
    const bar = view.toolbar;
    bar.className = "ink-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Annotation tools");
    bar.append(
      toolButtons(view), eraserButtons(view), colourButtons(view),
      widthButtons(view), shapeToggle(view), actionButtons(view)
    );

    view.status = document.createElement("p");
    view.status.className = "ink-status";
    view.status.setAttribute("role", "status");
    bar.appendChild(view.status);
  }

  // Which tool, which colour, which width, and whether there is anything to
  // undo — said with aria-pressed as well as shown, since these are the
  // controls a reader is choosing between.
  function paintToolbar(view) {
    for (const made of view.toolbar.querySelectorAll(".ink-tool")) {
      made.setAttribute("aria-pressed", String(made.dataset.tool === view.tool));
    }

    for (const made of view.toolbar.querySelectorAll(".ink-eraser")) {
      const on = view.tool === "eraser" && made.dataset.eraser === view.eraserMode;
      made.setAttribute("aria-pressed", String(on));
    }

    for (const made of view.toolbar.querySelectorAll(".ink-swatch")) {
      made.setAttribute("aria-pressed", String(made.dataset.colour === view.colour));
    }

    for (const made of view.toolbar.querySelectorAll(".ink-width")) {
      made.setAttribute("aria-pressed", String(Number(made.dataset.width) === view.width));
    }

    view.shapeBtn.setAttribute("aria-pressed", String(view.inkToShape));
    view.undoBtn.disabled = view.past.length === 0;
    view.redoBtn.disabled = view.future.length === 0;
    view.clearBtn.disabled = view.strokes.length === 0;
  }

  // Pressing the tool you are holding puts it down, which is how you get back
  // to reading without hunting for an off switch.
  function chooseTool(view, tool) {
    holdTool(view, view.tool === tool ? "none" : tool);
  }

  function holdTool(view, tool) {
    view.tool = tool;
    Surface.clearLaser(view);

    // The layer only takes the pointer when there is something to draw with;
    // otherwise the document underneath is selectable as usual.
    const drawing = view.tool !== "none";
    view.svg.style.pointerEvents = drawing ? "auto" : "none";
    view.svg.style.cursor = drawing ? "crosshair" : "";
    view.surface.classList.toggle("is-annotating", drawing);
    paintToolbar(view);
  }

  /* --- Wiring -------------------------------------------------------------- */

  function bindPointer(view) {
    view.svg.addEventListener("pointerdown", (event) => onDown(view, event));
    view.svg.addEventListener("pointermove", (event) => onMove(view, event));
    view.svg.addEventListener("pointerup", (event) => onUp(view, event));
    view.svg.addEventListener("pointercancel", (event) => onUp(view, event));
    // A pen leaving the page mid-stroke should finish the stroke, not strand
    // it — pointer capture means this only fires when capture was refused.
    view.svg.addEventListener("pointerleave", (event) => onUp(view, event));
  }

  function bindKeys(view) {
    document.addEventListener("keydown", (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (typing) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo(view);
        } else {
          undo(view);
        }

        return;
      }

      // Escape puts the pen down, which is the way out of drawing mode that
      // somebody will try first.
      if (event.key === "Escape" && view.tool !== "none") {
        chooseTool(view, view.tool);
      }
    });
  }

  /* The layer has to keep matching the document it is over: images finish
   * loading, diagrams render, the window changes width. Observing the content
   * catches all three without any of them having to say so.
   */
  /* The page changed shape, so the ink has to move with it.
   *
   * Zooming, or resizing the window, reflows the document underneath: the
   * column narrows, the text takes more lines, and everything below moves
   * down. Ink pinned to fixed coordinates then sits over the wrong words,
   * which is what "zooming breaks the annotations" was.
   *
   * It cannot be exact — reflowing text moves in ways no single transform
   * describes — but a stroke can keep its place in the document instead of
   * its place on a page that no longer exists. Each stroke is scaled by how
   * much the surface has changed since it was drawn, so a note two thirds of
   * the way down stays two thirds of the way down.
   */
  function reflow(view) {
    const size = Surface.resize(view);
    const was = view.surfaceSize;

    if (!was || size.width === 0 || size.height === 0) {
      view.surfaceSize = size;
      return;
    }

    const factorX = size.width / was.width;
    const factorY = size.height / was.height;
    view.surfaceSize = size;

    if (factorX === 1 && factorY === 1) {
      return;
    }

    view.strokes = view.strokes.map((stroke) => ({
      ...stroke,
      points: AnnotateGeometry.scalePoints(stroke.points, factorX, factorY)
    }));

    Surface.redraw(view);
    persist(view);
  }

  function watchSize(view) {
    if (!window.ResizeObserver) {
      return;
    }

    /* Waiting a frame, because a reflow arrives as a burst: the column
     * resizes, then the text rewraps, then images and diagrams settle. Acting
     * on each of those in turn would scale the ink several times over for one
     * change.
     */
    view.sizeWatcher = new window.ResizeObserver(() => {
      window.clearTimeout(view.reflowTimer);
      view.reflowTimer = window.setTimeout(() => reflow(view), 120);
    });

    view.sizeWatcher.observe(view.content);
    view.sizeWatcher.observe(view.surface);
  }

  /* How tall the bar is, published to the page.
   *
   * The bar sticks to the top of the scroller, and so does the outline beside
   * the document; without this the outline's heading would sit underneath the
   * tools. The height is measured rather than assumed because the bar wraps to
   * two rows on a narrow window. A hidden bar measures zero, which is exactly
   * the offset wanted when the tools are away.
   */
  function watchToolbar(view) {
    if (!window.ResizeObserver) {
      return;
    }

    view.barWatcher = new window.ResizeObserver(() => {
      const height = view.toolbar.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--ink-bar", `${Math.round(height)}px`);
    });

    view.barWatcher.observe(view.toolbar);
  }

  /* Annotation over one document.
   *
   * `token` is what the marks are filed under, so two shared documents open in
   * the same browser keep their own.
   */
  function create(options) {
    const view = {
      // Where the ink goes — the whole page, margins included — and what it
      // is laid over, which is watched for reflow.
      surface: options.surface || options.content,
      content: options.content,
      surfaceSize: null,
      reflowTimer: 0,
      toolbar: options.toolbar,
      token: options.token || "",
      tool: "none",
      eraserMode: "stroke",
      colour: COLOURS[0].value,
      laserColour: "#ff4d4d",
      width: WIDTHS[1].value,
      inkToShape: options.inkToShape !== false,
      strokes: [],
      past: [],
      future: [],
      drawing: null,
      liveNode: null,
      laser: null,
      laserNode: null,
      laserTimer: 0,
      pointerDown: false,
      erasedThisDrag: false,
      statusTimer: 0
    };

    view.svg = Surface.makeLayer(view.surface);
    buildToolbar(view);
    bindPointer(view);
    bindKeys(view);
    watchSize(view);
    watchToolbar(view);

    return {
      /* Called once the document has rendered: the layer is sized to it and
       * whatever was drawn on it last time is put back.
       */
      restore() {
        Surface.ensureLayer(view);
        // The size the marks below were last saved against, so the first
        // reflow after this compares like with like.
        view.surfaceSize = Surface.resize(view);
        view.strokes = AnnotateStore.load(view.token);
        Surface.redraw(view);
        paintToolbar(view);
      },
      setInkToShape(wanted) {
        view.inkToShape = Boolean(wanted);
      },
      strokeCount: () => view.strokes.length,
      tool: () => view.tool,
      eraserMode: () => view.eraserMode,
      chooseTool: (tool) => chooseTool(view, tool),
      undo: () => undo(view),
      redo: () => redo(view),
      clear: () => clearAll(view)
    };
  }

  return { create, COLOURS, WIDTHS, TOOLS, HISTORY_DEPTH };
})();
