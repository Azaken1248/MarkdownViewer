/* The ink itself: an SVG over the document, and the pointer that draws on it.
 *
 * SVG rather than a canvas, because every part of this is easier when a stroke
 * is a node. Erasing is removing one, undo is putting it back, saving is the
 * list of points it already holds, and it stays crisp when the page is zoomed.
 * A canvas would need a full redraw for each of those and hit-testing written
 * by hand.
 *
 * The layer is the size of the document rather than the size of the window,
 * and sits inside the scroller, so ink stays on the paragraph it was drawn
 * over instead of floating in front of the viewport.
 *
 * What it does not do: a stroke is anchored at an absolute position in the
 * document, so resizing the window reflows the text underneath it and the ink
 * stays where it was. Keeping ink attached to a paragraph through a reflow
 * means anchoring to the paragraph, which is a different and much larger
 * feature; this one is honest about being a transparency laid over the page.
 */

/* exported AnnotateSurface */
var AnnotateSurface = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const G = AnnotateGeometry;

  // A laser is a pointer, not a mark: it shows where you are looking and then
  // stops existing. Nothing about it is saved.
  const LASER_FADE_MS = 900;

  function node(name, attributes) {
    const made = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      made.setAttribute(key, String(value));
    }

    return made;
  }

  /* One stroke, as a path.
   *
   * The highlighter is drawn under the text rather than over it (the layer's
   * blend mode does that) and is deliberately flat-capped: a highlighter that
   * rounds off looks like a fat pen.
   */
  // The tools drawn as a filled nib rather than as a line of constant width.
  // A shape is a shape and wants an even edge; a pen wants to look like a pen.
  const INKED = new Set(["pen"]);

  /* The shapes whose corners are the point of them.
   *
   * Everything else is smoothed through the middles of its segments, which is
   * right for ink and for an ellipse and quite wrong for a box: a rectangle
   * smoothed that way has no corners left.
   */
  const CORNERED = new Set(["line", "arrow", "rectangle", "triangle"]);

  // A stroke the pen drew and ink-to-shape then tidied. It keeps the tool it
  // was drawn with — it is still the pen's colour and width and it erases and
  // saves like any other stroke — but it is drawn as the shape it became.
  const kindOf = (stroke) => stroke.shape || stroke.tool;
  const nibbed = (stroke) => INKED.has(stroke.tool) && !stroke.shape;

  // How much fatter a highlighter is than the pen at the same setting.
  const HIGHLIGHTER_NIB = 4;

  function pathFor(stroke) {
    if (nibbed(stroke)) {
      const path = node("path", {
        d: G.inkOutline(stroke.points, stroke.width, stroke.points.map((point) => point[2] || 0)),
        fill: stroke.colour,
        stroke: "none"
      });

      path.dataset.tool = stroke.tool;
      return path;
    }

    const highlighter = stroke.tool === "highlighter";

    const path = node("path", {
      d: CORNERED.has(kindOf(stroke)) ? G.cornerPath(stroke.points) : G.toPath(stroke.points),
      fill: "none",
      stroke: stroke.colour,
      // A highlighter is a chisel tip, not a pen: the same width setting gives
      // a band wide enough to cover a line of text rather than underline it.
      "stroke-width": highlighter ? stroke.width * HIGHLIGHTER_NIB : stroke.width,
      "stroke-linecap": highlighter ? "butt" : "round",
      "stroke-linejoin": "round"
    });

    if (highlighter) {
      path.setAttribute("stroke-opacity", "0.42");
    }

    path.dataset.tool = stroke.tool;
    return path;
  }

  // An arrow is a line plus two short strokes at the end, drawn as one path so
  // it erases and undoes as one thing.
  function arrowPath(stroke) {
    const [from, to] = [stroke.points[0], stroke.points[stroke.points.length - 1]];
    const head = G.arrowHead(from, to, Math.max(10, stroke.width * 4));
    const d = [G.toPath(stroke.points)]
      .concat(head.map(([a, b]) => G.toPath([a, b])))
      .join(" ");

    const path = pathFor(stroke);
    path.setAttribute("d", d);
    return path;
  }

  const drawStroke = (stroke) => (stroke.tool === "arrow" ? arrowPath(stroke) : pathFor(stroke));

  /* --- The layer ---------------------------------------------------------- */

  /* The layer goes over the whole page, not over the column of text.
   *
   * It used to live inside the content element, which meant ink could only be
   * put where the words were — and a reader marking up a document wants the
   * margins most of all, for the note that does not fit beside the line it is
   * about. So the layer is a child of the surface instead: the full width of
   * the page, margins and all, with the text column sitting inside it.
   *
   * That also stops it being wiped every time a document renders, since
   * rendering is `content.innerHTML = ...` and the content is no longer its
   * parent.
   */
  function makeLayer(surface) {
    const svg = node("svg", { class: "ink-layer", "aria-hidden": "true" });
    svg.style.position = "absolute";
    svg.style.left = "0";
    svg.style.top = "0";
    // Off until a tool is chosen, so reading and selecting text is unaffected.
    svg.style.pointerEvents = "none";
    surface.style.position = surface.style.position || "relative";
    surface.appendChild(svg);
    return svg;
  }

  function ensureLayer(view) {
    if (view.svg.parentNode !== view.surface) {
      view.surface.style.position = view.surface.style.position || "relative";
      view.surface.appendChild(view.svg);
    }

    return view.svg;
  }

  /* The layer is exactly the size of the surface, and answers what that size
   * is, because a stroke has to remember the page it was drawn on to survive
   * that page changing shape.
   */
  function resize(view) {
    /* The layer is measured out of the way of itself.
     *
     * It is absolutely positioned inside the element it is being sized to, so
     * its own width and height count towards that element's scrollWidth and
     * scrollHeight. Measuring without collapsing it first means the surface
     * can grow and never shrink: the layer reports last time's size as this
     * time's minimum, and a reflow that makes the document shorter is
     * invisible. Which is exactly how zooming appeared to leave everything
     * untouched while the text moved underneath.
     */
    view.svg.style.width = "0";
    view.svg.style.height = "0";

    const width = Math.max(view.surface.clientWidth, view.surface.scrollWidth);
    const height = Math.max(view.surface.scrollHeight, view.content.scrollHeight);

    view.svg.setAttribute("width", String(width));
    view.svg.setAttribute("height", String(height));
    view.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    view.svg.style.width = `${width}px`;
    view.svg.style.height = `${height}px`;

    return { width, height };
  }

  // Where on the page a pointer event happened, which is what gets stored.
  function pointIn(view, event) {
    const box = view.surface.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  /* --- Drawing ------------------------------------------------------------ */

  function redraw(view) {
    view.svg.replaceChildren();
    for (const stroke of view.strokes) {
      view.svg.appendChild(drawStroke(stroke));
    }
  }

  function beginStroke(view, at) {
    view.drawing = {
      tool: view.tool,
      colour: view.colour,
      width: view.width,
      points: [at]
    };

    /* Where the drag started, kept apart from the points.
     *
     * A shape tool rebuilds its whole point list on every move, so after the
     * first one `points[0]` is the first point of the generated shape rather
     * than the corner the drag began at. Anchoring to it meant an ellipse
     * collapsed towards its own left edge as it was dragged and came out a few
     * pixels across whatever box was asked for.
     */
    view.drawing.from = at;


    view.liveNode = drawStroke(view.drawing);
    view.svg.appendChild(view.liveNode);
  }

  // A shape tool draws from where the drag began to where it is now, so the
  // whole shape is replaced on each move rather than extended.
  function extendStroke(view, at) {
    const live = view.drawing;
    if (!live) {
      return;
    }

    if (SHAPE_TOOLS.has(live.tool)) {
      live.points = G.shapeFromDrag(live.tool, live.from, at);
    } else {
      live.points.push(at);
    }

    const replacement = drawStroke(live);
    view.svg.replaceChild(replacement, view.liveNode);
    view.liveNode = replacement;
  }

  const SHAPE_TOOLS = new Set(["line", "arrow", "rectangle", "ellipse"]);

  /* What to keep, once the pen is lifted.
   *
   * Freehand is smoothed, and then offered to the shape recogniser — which is
   * the "ink to shape" of it. The recogniser says no far more often than yes,
   * which is the intended bias: a wonky circle left as a wonky circle is a
   * much smaller annoyance than a sentence turned into a rectangle.
   */
  function settleStroke(view) {
    const live = view.drawing;
    if (!live) {
      return null;
    }

    if (SHAPE_TOOLS.has(live.tool) || live.tool === "highlighter") {
      return live;
    }

    live.points = G.enhance(live.points);

    if (view.inkToShape) {
      const shape = G.recognise(live.points);
      if (shape) {
        live.points = G.shapePoints(shape);
        // What it became, so it is drawn as that shape rather than as the
        // pen stroke it started life as.
        live.shape = shape.kind;
      }
    }

    return live;
  }

  /* --- Erasing ------------------------------------------------------------ */

  // Against what the stroke looks like, not what it is stored as: a
  // highlighter is drawn four times wider than its width says, and an eraser
  // that reached for the stored number would pass through the middle of a band
  // it was clearly aimed at.
  const drawnWidth = (stroke) =>
    (stroke.tool === "highlighter" ? stroke.width * HIGHLIGHTER_NIB : stroke.width);

  const eraserReach = (view) => Math.max(8, view.width * 2);

  // Half a pixel: enough to drop the samples the eraser added back in and
  // nothing a reader could see the loss of.
  const TIDY = 0.5;

  const countPoints = (total, run) => total + run.length;

  /* Two erasers, because they are for different jobs.
   *
   * Whole strokes is the one to reach for: predictable, trivial to undo, and
   * it never leaves half a letter behind. But it is useless for taking the
   * tail off a long underline or opening a gap in a box, which is what a
   * point eraser is for — and a stroke eraser that swallows an entire
   * paragraph's worth of ink because it clipped the end is infuriating.
   */
  function eraseWholeStrokes(view, at) {
    const radius = eraserReach(view);
    const kept = view.strokes.filter((stroke) =>
      !G.nearPoint(stroke.points, at, radius + (drawnWidth(stroke) / 2)));

    if (kept.length === view.strokes.length) {
      return false;
    }

    view.strokes = kept;
    return true;
  }

  /* The point eraser takes out the samples it touches and keeps what is left
   * either side, so a stroke rubbed through the middle becomes two strokes.
   * A run too short to be worth drawing is dropped rather than left as a
   * speck nobody can see or erase.
   */
  function eraseAtPoints(view, at) {
    const radius = eraserReach(view);
    const out = [];
    let changed = false;

    for (const stroke of view.strokes) {
      const reach = radius + (drawnWidth(stroke) / 2);

      if (!G.nearPoint(stroke.points, at, reach)) {
        out.push(stroke);
        continue;
      }

      /* Against the line rather than against its samples: the stroke is
       * divided finely enough that the eraser cannot pass between two of
       * them, then each surviving run is tidied back down, so rubbing a
       * corner off a long straight line does not leave a hundred samples
       * where there were two.
       */
      const dense = G.densify(stroke.points, reach / 2);
      const runs = splitAround(dense, at, reach);

      if (runs.reduce(countPoints, 0) === dense.length) {
        out.push(stroke);
        continue;
      }

      changed = true;
      for (const run of runs) {
        out.push({ ...stroke, points: G.simplify(run, TIDY) });
      }
    }

    if (!changed) {
      return false;
    }

    view.strokes = out;
    return true;
  }

  // The runs of a stroke that the eraser did not touch.
  function splitAround(points, at, radius) {
    const runs = [];
    let run = [];

    for (const point of points) {
      if (G.distance(point, at) <= radius) {
        if (run.length > 1) {
          runs.push(run);
        }

        run = [];
        continue;
      }

      run.push(point);
    }

    if (run.length > 1) {
      runs.push(run);
    }

    return runs;
  }

  function eraseAt(view, at) {
    const erased = view.eraserMode === "point"
      ? eraseAtPoints(view, at)
      : eraseWholeStrokes(view, at);

    if (erased) {
      redraw(view);
    }

    return erased;
  }

  /* --- The laser ---------------------------------------------------------- */

  /* A laser is a bright dot with a trail behind it, not a red line.
   *
   * The first version drew the whole tail at one width with a glow round it,
   * which reads as a fat red worm rather than as a pointer. A real one is a
   * small intense point, and what the eye takes for a trail is the tail
   * thinning and fading behind it — so it is drawn as three pieces: a tapered
   * tail, a soft halo at the tip, and the dot itself.
   */
  function laserTo(view, at) {
    if (!view.laser) {
      view.laser = { points: [] };
    }

    view.laser.points.push(at);
    // Only the last stretch. A laser that keeps its whole path is a pen.
    view.laser.points = view.laser.points.slice(-26);

    // `color` is a presentation attribute, which is what lets the stylesheet
    // hang a glow of the right colour off currentcolor.
    const group = node("g", { class: "ink-laser", color: view.laserColour });
    const tail = view.laser.points;

    if (tail.length > 1) {
      group.appendChild(node("path", {
        d: G.inkOutline(tail, Math.max(3, view.width), null),
        fill: view.laserColour,
        "fill-opacity": "0.55",
        class: "ink-laser-tail"
      }));
    }

    const [x, y] = at;
    const dot = Math.max(3.5, view.width * 0.9);
    group.appendChild(node("circle", {
      cx: x, cy: y, r: dot * 2.2, fill: view.laserColour,
      "fill-opacity": "0.18", class: "ink-laser-halo"
    }));
    group.appendChild(node("circle", {
      cx: x, cy: y, r: dot, fill: view.laserColour, class: "ink-laser-dot"
    }));

    if (view.laserNode) {
      view.svg.replaceChild(group, view.laserNode);
    } else {
      view.svg.appendChild(group);
    }

    view.laserNode = group;
    window.clearTimeout(view.laserTimer);
    view.laserTimer = window.setTimeout(() => clearLaser(view), LASER_FADE_MS);
  }

  function clearLaser(view) {
    window.clearTimeout(view.laserTimer);
    view.laserNode?.remove();
    view.laserNode = null;
    view.laser = null;
  }

  return {
    SVG_NS, SHAPE_TOOLS, LASER_FADE_MS,
    node, pathFor, arrowPath, drawStroke,
    makeLayer, ensureLayer, resize, pointIn,
    redraw, beginStroke, extendStroke, settleStroke,
    eraseAt, eraseWholeStrokes, eraseAtPoints, splitAround, drawnWidth,
    laserTo, clearLaser
  };
})();
