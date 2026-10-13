// Part of the ANNOTATE suite. See annotate.test.js, which loads this.
//
// The layer the ink is actually drawn on, which no suite had ever opened.
//
// geometry.js is the maths and has been checked since it was written; this is
// the part that turns those numbers into SVG and answers a pointer. It is not
// a browser's job — a stroke is a node, erasing is removing one, undo is
// putting it back — so almost all of it can be driven in a document that was
// never painted. What cannot is anything that depends on layout, and the few
// places this reaches for a measurement are given one rather than asking for
// it, the same way export.test.js does.
//
// Two things in here are the reason the feature was rewritten twice: the two
// erasers, which are for different jobs and were once one, and the laser,
// which has to age its own trail or it leaves a comet hanging in the air.
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");

module.exports = (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  /* runScripts: "outside-only" is what gives this window an eval of its own,
   * which is how a plain script's top-level `var` becomes a property of it —
   * the same way sanitizer.test.js loads md/lazy.js. pretendToBeVisual gives
   * it requestAnimationFrame, which the laser's own clock asks for.
   */
  const dom = new JSDOM("<body><div id='surface'><div id='content'></div></div></body>",
    { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;

  loadScript(window, path.join(ROOT, "annotate", "geometry.js"));
  loadScript(window, path.join(ROOT, "annotate", "surface.js"));

  const S = window.AnnotateSurface;
  const { document } = window;
  const surface = document.getElementById("surface");
  const content = document.getElementById("content");

  /* A view, which is what every function in here is handed.
   *
   * The real one is assembled by annotate.js out of the page; this is the same
   * shape with nothing in it that is not used.
   */
  const viewFor = (over = {}) => {
    const svg = S.makeLayer(surface);
    return {
      surface,
      content,
      svg,
      strokes: [],
      tool: "pen",
      colour: "#ff3b30",
      width: 3,
      eraserMode: "stroke",
      inkToShape: false,
      drawing: null,
      liveNode: null,
      ringNode: null,
      laserNode: null,
      laser: null,
      laserFrame: 0,
      ...over
    };
  };

  const line = (from, to, count) => Array.from({ length: count }, (_, index) => {
    const along = index / (count - 1);
    return [from[0] + ((to[0] - from[0]) * along), from[1] + ((to[1] - from[1]) * along)];
  });

  console.log("=== the layer is the size of the page, not of the window ===");
  {
    const view = viewFor();
    check("it is made as an SVG over the surface", view.svg.tagName.toLowerCase(), "svg");
    check("...inside it", view.svg.parentNode, surface);
    check("...out of the way of the pointer until a tool is picked",
      view.svg.style.pointerEvents, "none");
    check("...and hidden from a screen reader, which cannot read ink",
      view.svg.getAttribute("aria-hidden"), "true");

    /* The surface is measured with the layer collapsed.
     *
     * The layer is absolutely positioned inside the thing it is being sized
     * to, so its own size counts towards that thing's scrollHeight. Measuring
     * without collapsing it first means the surface can grow and never
     * shrink — which is how zooming out appeared to leave the ink untouched
     * while the text moved under it.
     */
    let measuredWith = null;
    Object.defineProperty(surface, "scrollHeight", {
      configurable: true,
      get() {
        measuredWith = view.svg.style.height;
        return 900;
      }
    });
    Object.defineProperty(surface, "clientWidth", { configurable: true, get: () => 700 });
    Object.defineProperty(surface, "scrollWidth", { configurable: true, get: () => 700 });
    Object.defineProperty(content, "scrollHeight", { configurable: true, get: () => 640 });

    const size = S.resize(view);
    check("the layer takes the surface's size", size, { width: 700, height: 900 });
    check("...and says so in the viewBox, so ink scales with it",
      view.svg.getAttribute("viewBox"), "0 0 700 900");
    // Whatever the engine normalises "0" to — jsdom says "0px" — what matters
    // is that the layer had no height of its own at the moment it was asked.
    check("...having collapsed itself first, so it cannot measure its own height",
      parseFloat(measuredWith), 0);

    view.svg.remove();
  }

  console.log("=== a stroke is a node, which is the whole reason for SVG ===");
  {
    const view = viewFor();
    const pen = { tool: "pen", colour: "#ff3b30", width: 3, points: line([10, 10], [90, 10], 6) };
    const drawn = S.drawStroke(pen);

    check("a pen stroke is a path", drawn.tagName.toLowerCase(), "path");
    check("...with something in it", drawn.getAttribute("d").length > 0, true);

    /* A pen is drawn as a filled nib rather than as a line of constant width,
     * which is what lets it taper and answer pressure. A highlighter is a
     * stroked line, because a highlighter that rounds off looks like a fat pen.
     */
    check("the pen is filled, so it can taper", drawn.getAttribute("fill"), "#ff3b30");

    const marker = S.drawStroke({ ...pen, tool: "highlighter" });
    check("a highlighter is stroked instead", marker.getAttribute("stroke"), "#ff3b30");
    check("...flat-capped, because a highlighter does not round off",
      marker.getAttribute("stroke-linecap"), "butt");
    check("...and drawn wider than it is stored",
      Number(marker.getAttribute("stroke-width")) > 3, true);

    // The eraser reaches for what a stroke looks like, not what it is stored
    // as, or it would pass through the middle of a band it was aimed at.
    check("the pen's drawn width is the width it was given", S.drawnWidth({ tool: "pen", width: 3 }), 3);
    check("...and a highlighter's is more than that",
      S.drawnWidth({ tool: "highlighter", width: 3 }) > 3, true);

    const arrow = S.drawStroke({
      tool: "arrow", colour: "#000", width: 2, points: [[0, 0], [60, 0]]
    });
    check("an arrow is drawn with its head", arrow.tagName.toLowerCase(), "path");
    check("...which is more than the line it sits on",
      arrow.getAttribute("d").split("M").length > 2, true);

    view.svg.remove();
  }

  console.log("=== drawing one, from the pointer going down to it being kept ===");
  {
    const view = viewFor();
    S.beginStroke(view, [10, 10]);
    check("the live stroke is on the page while it is being drawn",
      view.svg.contains(view.liveNode), true);
    check("...and remembers where the drag began", view.drawing.from, [10, 10]);

    S.extendStroke(view, [40, 12]);
    S.extendStroke(view, [80, 14]);
    check("each move extends it", view.drawing.points.length, 3);
    check("...replacing the node rather than adding another",
      view.svg.querySelectorAll("path").length, 1);

    const kept = S.settleStroke(view);
    check("lifting the pen hands back the stroke", kept.tool, "pen");
    // Freehand is resampled and smoothed on the way out; a shape tool is not.
    check("...smoothed, so it is not the three samples it was drawn from",
      kept.points.length > 3, true);

    view.svg.remove();
  }

  console.log("=== a shape rebuilds itself from the corner the drag began at ===");
  {
    const view = viewFor({ tool: "rectangle" });
    S.beginStroke(view, [100, 100]);
    S.extendStroke(view, [150, 120]);
    S.extendStroke(view, [200, 160]);

    /* Anchored to `from` rather than to points[0].
     *
     * A shape replaces its whole point list on every move, so after the first
     * one points[0] is the first point of the generated shape — anchoring to
     * it made an ellipse collapse towards its own left edge as it was dragged
     * and come out a few pixels across whatever box was asked for.
     */
    const corners = view.drawing.points;
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    check("the shape still starts where the drag did",
      [Math.min(...xs), Math.min(...ys)], [100, 100]);
    check("...and reaches where the pointer is now",
      [Math.max(...xs), Math.max(...ys)], [200, 160]);

    const kept = S.settleStroke(view);
    check("a shape is kept as it was drawn, not smoothed",
      kept.points.length, corners.length);

    view.svg.remove();
  }

  console.log("=== the two erasers, which are for different jobs ===");
  {
    /* Whole strokes is the one to reach for: predictable, trivial to undo,
     * never leaves half a letter. It is useless for taking the tail off a
     * long underline, which is what the point eraser is for — and a stroke
     * eraser that swallows a paragraph because it clipped the end is
     * infuriating, which is why there are two.
     */
    const long = { tool: "pen", colour: "#000", width: 2, points: line([0, 50], [400, 50], 60) };
    const away = { tool: "pen", colour: "#000", width: 2, points: line([0, 300], [400, 300], 60) };

    const whole = viewFor({ strokes: [{ ...long }, { ...away }], eraserMode: "stroke", width: 4 });
    check("the stroke eraser takes the one it touched", S.eraseAt(whole, [200, 50]), true);
    check("...all of it", whole.strokes.length, 1);
    check("...and nothing else", whole.strokes[0].points[0], [0, 300]);
    check("...and says so when it touched nothing", S.eraseAt(whole, [200, 150]), false);
    whole.svg.remove();

    const points = viewFor({ strokes: [{ ...long }, { ...away }], eraserMode: "point", width: 4 });
    check("the point eraser opens a gap instead", S.eraseAt(points, [200, 50]), true);
    check("...leaving the two halves either side, and the stroke it missed",
      points.strokes.length, 3);

    /* And the one it missed comes back untouched rather than re-simplified.
     * Everything in the document goes through this on every rub, and running
     * a stroke the eraser never reached through densify and simplify would
     * move the ink somebody did not touch.
     */
    check("...which is the stroke it was, not a tidied copy of it",
      points.strokes[2].points, away.points);
    points.strokes = points.strokes.slice(0, 2);

    const ends = points.strokes.map((one) => [one.points[0][0], one.points.at(-1)[0]]);
    check("...one before the gap and one after",
      [ends[0][1] < 200, ends[1][0] > 200], [true, true]);

    /* Tidied back down afterwards.
     *
     * It erases against the line rather than against the samples, which means
     * dividing the stroke finely enough that the eraser cannot pass between
     * two of them. Without the tidy, rubbing a corner off a straight line
     * left a hundred samples where there had been two.
     */
    check("...without leaving a hundred samples where there were two",
      points.strokes.every((one) => one.points.length < 40), true);
    points.svg.remove();
  }

  console.log("=== the runs an eraser leaves behind ===");
  {
    const straight = line([0, 0], [100, 0], 101);
    const runs = S.splitAround(straight, [50, 0], 10);
    check("a rub through the middle leaves two runs", runs.length, 2);
    check("...neither of which reaches the point rubbed",
      [runs[0].at(-1)[0] < 45, runs[1][0][0] > 55], [true, true]);

    check("a rub at one end leaves one", S.splitAround(straight, [0, 0], 10).length, 1);
    check("a rub over the whole of it leaves none",
      S.splitAround(straight, [50, 0], 200).length, 0);
    // A run of one point is not a stroke, and leaving it is leaving a speck
    // nobody can see or erase.
    check("a single surviving point is not a run",
      S.splitAround([[0, 0], [50, 0], [100, 0]], [50, 0], 60).length, 0);
  }

  console.log("=== the eraser's ring says how far it reaches ===");
  {
    const view = viewFor({ width: 6 });
    S.showReach(view, [120, 80]);
    const ring = view.svg.querySelector(".ink-eraser-ring");
    check("there is a ring", Boolean(ring), true);
    check("...where the pointer is",
      [ring.getAttribute("cx"), ring.getAttribute("cy")], ["120", "80"]);
    // The ring is the size the eraser actually reaches, or it says something
    // untrue about what is about to happen.
    check("...the size the eraser reaches", Number(ring.getAttribute("r")), 12);

    S.showReach(view, [130, 80]);
    check("moving it moves the one ring rather than adding another",
      view.svg.querySelectorAll(".ink-eraser-ring").length, 1);

    S.hideReach(view);
    check("and it goes when the eraser does",
      view.svg.querySelector(".ink-eraser-ring"), null);
    view.svg.remove();
  }

  console.log("=== redrawing keeps the pointer's own furniture on top ===");
  {
    const view = viewFor({
      strokes: [{ tool: "pen", colour: "#000", width: 2, points: line([0, 0], [50, 0], 4) }]
    });

    S.showReach(view, [10, 10]);
    S.redraw(view);

    /* The ring and the laser live on the ink layer but are not strokes and are
     * not in the list, so rebuilding the list takes them off the page.
     * Erasing redraws on every step, which is exactly when the ring is being
     * looked at.
     */
    check("the ring survives a redraw",
      Boolean(view.svg.querySelector(".ink-eraser-ring")), true);
    check("...and is drawn last, over the ink",
      view.svg.lastChild.getAttribute("class"), "ink-eraser-ring");
    view.svg.remove();
  }

  console.log("=== the laser, which has to age its own trail ===");
  {
    const view = viewFor({ colour: "#2f80ed", width: 4 });

    S.laserTo(view, [40, 40]);
    S.laserTo(view, [60, 44]);
    S.laserTo(view, [90, 50]);

    const group = view.svg.querySelector(".ink-laser");
    check("there is a laser on the page", Boolean(group), true);
    check("...in the colour that is selected", group.getAttribute("color"), "#2f80ed");
    check("...with a tail behind it", Boolean(group.querySelector(".ink-laser-tail")), true);

    S.laserTo(view, [95, 52]);
    check("moving it does not stack a second one",
      view.svg.querySelectorAll(".ink-laser").length, 1);

    /* The trail is aged rather than capped.
     *
     * The first version kept the last twenty-six samples however old they
     * were and then took the whole thing away at once, which is what a laser
     * does not do: holding still left a comet hanging in the air.
     */
    view.laser.trail = view.laser.trail.map((mark) => ({ ...mark, time: Date.now() - 2000 }));
    S.laserTo(view, [96, 53]);
    check("samples older than the trail's life are dropped", view.laser.trail.length, 1);

    S.releaseLaser(view);
    check("letting go starts it fading rather than blinking out", view.laser.gone > 0, true);

    S.clearLaser(view);
    check("and clearing takes it off the page", view.svg.querySelector(".ink-laser"), null);
    check("...and forgets it", view.laser, null);
    view.svg.remove();
  }

  console.log("=== where a pointer event happened, in the page's own coordinates ===");
  {
    const view = viewFor();
    // Ink is stored against the document, not the viewport, so a stroke stays
    // on the paragraph it was drawn over while the page scrolls.
    surface.getBoundingClientRect = () => /** @type {any} */ ({ left: 24, top: 60 });
    check("the event is translated out of the viewport",
      S.pointIn(view, { clientX: 124, clientY: 160 }), [100, 100]);
    view.svg.remove();
  }

  console.log("=== and a pointer that goes down where nothing is being drawn ===");
  {
    /* Every one of these can arrive with no stroke under way: a move whose
     * pointerdown was eaten by something else, an up after the tool was put
     * down mid-drag, a layer the document was re-rendered out from under.
     * None of them is an error and none of them may throw, because a throw in
     * a pointer handler leaves the layer holding the pointer with nothing
     * listening.
     */
    const view = viewFor({ drawing: null });
    S.extendStroke(view, [10, 10]);
    check("extending nothing draws nothing", view.svg.querySelectorAll("path").length, 0);
    check("...and settling nothing is nothing", S.settleStroke(view), null);

    /* And the layer put back after the document was re-rendered: the share
     * page calls this every time, and the position on the surface is what
     * makes an absolutely positioned layer land on the document rather than
     * on the page.
     */
    view.svg.remove();
    surface.style.position = "";
    check("a layer taken off the page is put back on it",
      S.ensureLayer(view).parentNode, surface);
    check("...and the surface is made something to position against",
      surface.style.position, "relative");

    // A surface that already says how it is positioned keeps what it said.
    view.svg.remove();
    surface.style.position = "absolute";
    S.ensureLayer(view);
    check("...unless it already said", surface.style.position, "absolute");
    surface.style.position = "";
    view.svg.remove();
  }
};
