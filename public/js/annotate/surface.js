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

  // How much fatter a highlighter is than the pen at the same setting.
  const HIGHLIGHTER_NIB = 4;

  function pathFor(stroke) {
    if (INKED.has(stroke.tool)) {
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
      d: G.toPath(stroke.points),
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
      live.points = G.shapeFromDrag(live.tool, live.points[0], at);
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
      }
    }

    return live;
  }

  /* --- Erasing ------------------------------------------------------------ */

  // Whole strokes, not parts of them. Predictable to use, trivial to undo, and
  // it never leaves a stroke split into pieces that were one thing a moment
  // ago.
  function eraseAt(view, at) {
    const radius = Math.max(8, view.width * 2);
    const kept = [];
    const removed = [];

    for (const stroke of view.strokes) {
      // Against what the stroke looks like, not what it is stored as: a
      // highlighter is drawn four times wider than its width says, and an
      // eraser that reached for the stored number would pass straight through
      // the middle of a band it was clearly aimed at.
      const drawn = stroke.tool === "highlighter" ? stroke.width * HIGHLIGHTER_NIB : stroke.width;

      if (G.nearPoint(stroke.points, at, radius + (drawn / 2))) {
        removed.push(stroke);
      } else {
        kept.push(stroke);
      }
    }

    if (removed.length === 0) {
      return false;
    }

    view.strokes = kept;
    redraw(view);
    return true;
  }

  /* --- The laser ---------------------------------------------------------- */

  function laserTo(view, at) {
    if (!view.laser) {
      view.laser = { points: [] };
    }

    view.laser.points.push(at);
    // Only the last stretch: a laser that keeps its whole path is a pen.
    view.laser.points = view.laser.points.slice(-60);

    const path = pathFor({
      tool: "laser", colour: view.laserColour, width: view.width * 1.4,
      points: view.laser.points
    });
    path.setAttribute("class", "ink-laser");

    if (view.laserNode) {
      view.svg.replaceChild(path, view.laserNode);
    } else {
      view.svg.appendChild(path);
    }

    view.laserNode = path;
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
    eraseAt, laserTo, clearLaser
  };
})();
