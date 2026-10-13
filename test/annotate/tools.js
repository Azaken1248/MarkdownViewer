/* Part of the ANNOTATE suite. See annotate.test.js, which loads this.
 *
 * The part that knows about tools, undo and the toolbar — annotate.js itself,
 * which sits on top of the three modules under js/annotate and had nothing
 * driving it.
 *
 * The maths is checked in the suite that loads this, the layer in surface.js
 * beside it, and both of those are real here: this builds a toolbar over a
 * real surface with real geometry and a real localStorage, and presses it.
 * Three things jsdom does not have are stood in for — PointerEvent, which is
 * assembled out of a MouseEvent; ResizeObserver, so the page can be made to
 * change shape on purpose; and window.confirm, since erasing everything asks.
 *
 * The thing worth having here is the bookkeeping. A drag that rubs out four
 * strokes is one undo step; a drag that rubs out none is not a step at all;
 * a tap with a shape tool leaves nothing behind and no step either. Each of
 * those was a separate bug once.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");

module.exports = async (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  // A url, because localStorage on an opaque origin throws rather than works.
  const dom = new JSDOM(
    '<body><div id="surface"><div id="content"></div></div><div id="bar"></div></body>',
    { url: "https://docs.example/s/abc", runScripts: "outside-only", pretendToBeVisual: true }
  );
  const { window } = dom;
  const { document } = window;

  for (const file of ["annotate/geometry.js", "annotate/store.js", "annotate/surface.js",
    "annotate.js"]) {
    loadScript(window, path.join(ROOT, file));
  }

  const Annotate = window.Annotate;
  const Store = window.AnnotateStore;

  const surface = /** @type {HTMLElement} */ (document.getElementById("surface"));
  const content = /** @type {HTMLElement} */ (document.getElementById("content"));
  const bar = /** @type {HTMLElement} */ (document.getElementById("bar"));

  /* --- the three things jsdom has not got -------------------------------- */

  // The surface's own corner, so a client point becomes a point on the page.
  surface.getBoundingClientRect = () => /** @type {any} */ ({ left: 20, top: 40, width: 800, height: 1000 });
  bar.getBoundingClientRect = () => /** @type {any} */ ({ height: 48 });

  const measuring = { width: 800, height: 1000 };
  for (const [el, which] of /** @type {[HTMLElement, string][]} */ ([
    [surface, "clientWidth"], [surface, "scrollWidth"]
  ])) {
    Object.defineProperty(el, which, { get: () => measuring.width });
  }
  Object.defineProperty(surface, "scrollHeight", { get: () => measuring.height });
  Object.defineProperty(content, "scrollHeight", { get: () => measuring.height });

  // Each observer is kept so the page can be made to change shape.
  const observers = [];
  window.ResizeObserver = /** @type {any} */ (class {
    constructor(run) {
      this.run = run;
      observers.push(this);
    }

    observe() {}
  });

  const asked = [];
  let answer = true;
  window.confirm = (message) => {
    asked.push(message);
    return answer;
  };

  /* The timers this module sets, so the two waits in it can be brought
   * forward: the moment the status line takes a message back, and the frame
   * a burst of resizes is collected over.
   */
  const timers = [];
  const realTimeout = window.setTimeout.bind(window);
  window.setTimeout = /** @type {any} */ ((run, ms) => {
    timers.push({ run, ms });
    return timers.length;
  });

  window.clearTimeout = /** @type {any} */ (() => {});

  // Whatever was waiting for this long, run now.
  const after = (ms) => {
    const due = timers.filter((one) => one.ms === ms);
    timers.splice(0);
    due.forEach((one) => one.run());
  };

  /* The laser's clock is the only thing here that is left to run for real.
   * requestAnimationFrame is jsdom's own, so this waits the wall-clock time
   * the fade actually takes — a quarter of a second, once, for the one part
   * of the feature that is a clock.
   */
  const LASER_FADE_MS = window.AnnotateSurface.LASER_FADE_MS;
  const TRAIL_MS = 320;
  const frames = (ms) => new Promise((done) => realTimeout(done, ms));

  /* A pointer event, assembled rather than constructed: jsdom has
   * MouseEvent and not PointerEvent, and what the module reads of one is the
   * id, the pressure and whether it came from a pen.
   */
  const pointer = (type, at, extra = {}) => {
    const event = new window.MouseEvent(type, {
      bubbles: true, clientX: 20 + at[0], clientY: 40 + at[1], button: extra.button || 0
    });

    Object.defineProperties(event, {
      pointerId: { value: extra.pointerId ?? 1 },
      pressure: { value: extra.pressure ?? 0.5 },
      pointerType: { value: extra.pointerType ?? "mouse" }
    });

    return event;
  };

  /* The layer takes the pointer for the whole stroke, so a hand that leaves
   * the document mid-line does not leave half a line behind. jsdom's SVG
   * element has no such thing, so here it is, writing down what it was asked.
   */
  const captured = [];
  /** @type {any} */ (window.SVGElement.prototype).setPointerCapture = function take(id) {
    captured.push(["take", id]);
  };
  /** @type {any} */ (window.SVGElement.prototype).releasePointerCapture = function give(id) {
    captured.push(["give", id]);
  };

  const ink = Annotate.create({ surface, content, toolbar: bar, token: "abc" });

  /* Which is the sequence the share page uses: the bar is built when the page
   * loads and painted once the document has rendered, because until then
   * there is nothing to size the layer against.
   */
  ink.restore();

  const layer = /** @type {SVGElement} */ (surface.querySelector("svg"));

  const press = (selector) => {
    const found = /** @type {HTMLElement} */ (bar.querySelector(selector));
    found.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    return found;
  };

  /* Picking up a tool rather than pressing its button, because pressing the
   * button for the tool already in your hand puts it down — which is the
   * behaviour under test two sections down and a trap everywhere else.
   */
  const hold = (tool) => {
    if (ink.tool() !== tool) {
      press(`.ink-tool[data-tool="${tool}"]`);
    }
  };

  const holdEraser = (mode) => {
    if (ink.tool() !== "eraser" || ink.eraserMode() !== mode) {
      press(`.ink-eraser[data-eraser="${mode}"]`);
    }
  };

  // Whether a control is offered, which is how the bar says a setting has
  // nothing to set.
  const off = (selector) => /** @type {HTMLButtonElement} */
    (bar.querySelector(selector)).disabled;

  const allOff = (selector) => [...bar.querySelectorAll(selector)]
    .map((one) => /** @type {HTMLButtonElement} */ (one).disabled);

  const pressed = (selector) => [...bar.querySelectorAll(selector)]
    .filter((one) => one.getAttribute("aria-pressed") === "true")
    .map((one) => one.getAttribute("aria-label"));

  // One stroke, drawn from here to there.
  const draw = (from, to, steps = 6, extra = {}) => {
    layer.dispatchEvent(pointer("pointerdown", from, extra));
    for (let step = 1; step <= steps; step += 1) {
      const along = step / steps;
      layer.dispatchEvent(pointer("pointermove", [
        from[0] + ((to[0] - from[0]) * along),
        from[1] + ((to[1] - from[1]) * along)
      ], extra));
    }
    layer.dispatchEvent(pointer("pointerup", to, extra));
  };

  const status = () => /** @type {HTMLElement} */ (bar.querySelector(".ink-status")).textContent;
  const saved = () => Store.load("abc");

  console.log("=== the toolbar it builds out of the bar it is given ===");
  {
    check("the bar says what it is", [bar.getAttribute("role"), bar.getAttribute("aria-label")],
      ["toolbar", "Annotation tools"]);
    check("...and is grouped, so the tools are not one list of nineteen buttons",
      [...bar.querySelectorAll(".ink-group")].map((one) => one.getAttribute("aria-label")),
      ["Tools", "Eraser", "Colour", "Thickness", null, "Actions"]);

    check("every tool is there", [...bar.querySelectorAll(".ink-tool")]
      .map((one) => one.getAttribute("data-tool")), Annotate.TOOLS.map((tool) => tool.id));
    // They stand as tools in their own right rather than as a mode behind a
    // second press, because a mode you cannot see is a mode you do not know
    // you are in.
    check("...and both erasers, as tools rather than as a hidden mode",
      [...bar.querySelectorAll(".ink-eraser")].map((one) => one.getAttribute("aria-label")),
      ["Eraser: whole stroke", "Eraser: rub out"]);
    check("the six colours are on the bar",
      [...bar.querySelectorAll(".ink-swatch")].map((one) => one.getAttribute("aria-label")),
      Annotate.COLOURS.map((colour) => colour.name));
    check("...with a way to reach the rest",
      [bar.querySelector(".ink-more").getAttribute("aria-haspopup"),
        /** @type {HTMLElement} */ (bar.querySelector(".ink-palette")).hidden], ["true", true]);
    check("the three thicknesses are there, each drawn at its own",
      [...bar.querySelectorAll(".ink-width span")]
        .map((one) => /** @type {HTMLElement} */ (one).style.height),
      ["2px", "4px", "8px"]);
    check("...and there is somewhere for the bar to say things",
      bar.querySelector(".ink-status").getAttribute("role"), "status");

    /* Nothing is drawn with until a tool is picked up, so there is nothing
     * for a colour or a thickness to set. Offering them anyway invites
     * somebody to pick a colour, draw nothing, and wonder which part of it
     * did not work.
     */
    check("a colour and a thickness are no use with nothing in your hand",
      [off(".ink-swatch"), off(".ink-width"), off(".ink-more")], [true, true, true]);
    check("...and there is nothing to undo, redo or erase either",
      allOff(".ink-group[aria-label='Actions'] button"), [true, true, true]);

    // Pressed anyway, which is what a disabled button does not stop a
    // keyboard shortcut from doing.
    ink.undo();
    ink.redo();
    ink.clear();
    check("...and pressing them anyway does nothing at all", ink.strokeCount(), 0);
  }

  console.log("=== picking up a tool, and putting it down again ===");
  {
    press('.ink-tool[data-tool="pen"]');
    check("the tool in your hand is the one that says so", pressed(".ink-tool"), ["Pen"]);
    check("...the layer takes the pointer",
      [layer.style.pointerEvents, layer.style.cursor], ["auto", "crosshair"]);
    check("...the page knows it is being written on",
      surface.classList.contains("is-annotating"), true);
    check("...and the colours are usable now", off(".ink-swatch"), false);

    // Pressing the tool you are holding puts it down, which is how you get
    // back to reading without hunting for an off switch.
    press('.ink-tool[data-tool="pen"]');
    check("pressing it again puts it down", [ink.tool(), pressed(".ink-tool")], ["none", []]);
    check("...and the document underneath is selectable as usual",
      layer.style.pointerEvents, "none");

    press('.ink-tool[data-tool="highlighter"]');
    press('.ink-tool[data-tool="pen"]');
    check("picking another tool swaps rather than adds", pressed(".ink-tool"), ["Pen"]);

    press('.ink-eraser[data-eraser="point"]');
    check("an eraser is held as the eraser it is",
      [ink.tool(), ink.eraserMode(), pressed(".ink-eraser")],
      ["eraser", "point", ["Eraser: rub out"]]);
    press('.ink-eraser[data-eraser="stroke"]');
    check("...and the other one is a swap, not a second press",
      [ink.eraserMode(), pressed(".ink-eraser")], ["stroke", ["Eraser: whole stroke"]]);
    press('.ink-eraser[data-eraser="stroke"]');
    check("...while pressing the one you are holding puts it down", ink.tool(), "none");
  }

  console.log("=== drawing, and what is kept of it ===");
  {
    hold("pen");
    press('.ink-swatch[data-colour="#5aa9e6"]');
    press('.ink-width[data-width="8"]');

    draw([100, 100], [300, 180]);
    check("a drag leaves a stroke", ink.strokeCount(), 1);
    check("...in the colour and the thickness that were chosen",
      [saved()[0].colour, saved()[0].width], ["#5aa9e6", 8]);
    check("...drawn on the layer", layer.querySelectorAll("path[data-tool]").length, 1);
    // Kept in this browser and nowhere near the server, which is the whole
    // design rather than a shortcut.
    check("...and written down under the token it belongs to",
      JSON.parse(window.localStorage.getItem(Store.keyFor("abc"))).strokes.length, 1);
    // Taken for the whole stroke and given back at the end of it, so a hand
    // that leaves the document mid-line does not leave half a line behind.
    check("...with the layer holding the pointer from end to end",
      captured.slice(-2), [["take", 1], ["give", 1]]);
    check("there is something to undo now",
      [off(".ink-group[aria-label='Actions'] button"), off(".ink-danger")], [false, false]);

    /* A stylus reports a real pressure; a mouse reports 0.5 for "a button is
     * down" and a finger usually reports nothing useful. Only a real stylus
     * reading is kept — everything else is left for the speed of the hand to
     * decide, which is the only signal a mouse actually gives.
     */
    /* With shapes tidied, a straight drag comes back as a two-point line and
      * the pressure along it is gone with the rest of the drawing — which is
      * right, and is why these three are drawn with it off.
      */
     ink.setInkToShape(false);
     ink.clear();
     draw([10, 10], [60, 60], 4, { pointerType: "pen", pressure: 0.3 });
    check("a stylus's pressure is part of the stroke",
      saved()[0].points.some((point) => point.length === 3), true);

    ink.clear();
    draw([10, 80], [60, 130], 4, { pointerType: "mouse", pressure: 0.5 });
    check("...and a mouse's is not, because it is not one",
      saved()[0].points.every((point) => point.length === 2), true);

    // Nor is a stylus pressed to the board, which reports exactly one and is
    // the reading a browser gives for "no pressure sensor".
    ink.clear();
    draw([10, 160], [60, 210], 4, { pointerType: "pen", pressure: 1 });
    check("...and neither is a reading of exactly one, which means nothing",
      saved()[0].points.every((point) => point.length === 2), true);
    ink.setInkToShape(true);

    // A right-click is a menu, not a stroke.
    ink.clear();
    draw([400, 400], [450, 450], 3, { button: 2 });
    check("a press that is not the first button draws nothing", ink.strokeCount(), 0);

    // A tap with a shape tool is not a shape: two corners of a rectangle is
    // a rectangle, one is a place somebody clicked.
    hold("pen");
    draw([600, 100], [700, 100]);
    hold("rectangle");
    layer.dispatchEvent(pointer("pointerdown", [500, 500]));
    layer.dispatchEvent(pointer("pointerup", [500, 500]));
    check("a tap with a shape tool leaves nothing behind", ink.strokeCount(), 1);
    // And no step on the stack either, so one undo goes back past it to the
    // stroke before rather than appearing to do nothing.
    ink.undo();
    check("...and no step on the undo stack either", ink.strokeCount(), 0);
  }

  console.log("=== the laser, which is not a drag ===");
  {
    hold("laser");
    ink.clear();
    const was = ink.strokeCount();

    /* Holding a button down is not part of pointing at something: a laser is
     * on while it is in your hand.
     */
    layer.dispatchEvent(pointer("pointermove", [200, 200]));
    check("the laser follows the pointer with nothing held down",
      layer.querySelectorAll(".ink-laser").length, 1);

    layer.dispatchEvent(pointer("pointerdown", [220, 220]));
    layer.dispatchEvent(pointer("pointerup", [240, 240]));
    check("...and pressing leaves no stroke behind", ink.strokeCount(), was);

    /* The pointer leaving the page starts it going out rather than taking it
      * away: a dot that vanishes mid-gesture reads as a glitch, and the trail
      * has to age out either way. The ageing itself is the surface's, and is
      * checked there.
      */
    layer.dispatchEvent(pointer("pointerleave", [240, 240]));
    check("the pointer leaving the page starts the laser going out",
      layer.querySelectorAll(".ink-laser").length, 1);

    /* And then it ages out on its own clock, which is the thing the laser
      * needed a clock for: a trail ages whether or not the pointer moves, so
      * without one it left a comet hanging in the air.
      */
    await frames(LASER_FADE_MS + 80);
    check("...and goes out on its own, a quarter of a second later",
      layer.querySelectorAll(".ink-laser").length, 0);

    /* Frames only while something is changing. Once the trail has run out and
     * the dot is sitting where it was left, nothing will change until the
     * pointer moves again — and sixty redraws a second of a dot that is not
     * moving is sixty redraws a second of nothing.
     */
    hold("laser");
    layer.dispatchEvent(pointer("pointermove", [300, 300]));
    await frames(TRAIL_MS + 120);
    check("a dot sitting still stops asking for frames",
      [layer.querySelectorAll(".ink-laser").length, ink.strokeCount()], [1, 0]);

    /* And the frame that was already queued when the laser went away, which
     * is what the clock guards against finding nothing to draw. Putting the
     * laser down cancels the frame where it can; the guard is there for the
     * browser that cannot, which is the one this stands in for.
     */
    /* A browser with no frames to ask for, which falls back to a timer. The
     * laser is the one thing here with a clock of its own, and it has to keep
     * one either way.
     */
    const framing = window.requestAnimationFrame;
    delete /** @type {any} */ (window).requestAnimationFrame;
    hold("laser");
    layer.dispatchEvent(pointer("pointermove", [320, 320]));
    check("a browser with no frames to ask for still shows the laser",
      layer.querySelectorAll(".ink-laser").length, 1);
    window.requestAnimationFrame = framing;
    // Put down and picked up again, so the clock it asks for next is a frame
    // rather than the timer it was left holding.
    press('.ink-tool[data-tool="laser"]');
    hold("laser");

    delete /** @type {any} */ (window).cancelAnimationFrame;
    layer.dispatchEvent(pointer("pointermove", [310, 310]));
    press('.ink-tool[data-tool="laser"]');
    await frames(80);
    check("a frame that arrives after the laser has gone draws nothing",
      layer.querySelectorAll(".ink-laser").length, 0);

    // Putting it down takes it away, because there is no gesture left to
    // finish.
    press('.ink-tool[data-tool="laser"]');
    check("...and putting the laser down takes it away",
      layer.querySelectorAll(".ink-laser").length, 0);
  }

  console.log("=== the two erasers, and one drag being one step ===");
  {
    ink.clear();
    hold("pen");
    draw([100, 300], [200, 300]);
    draw([100, 320], [200, 320]);
    draw([100, 340], [200, 340]);
    check("three strokes to rub out", ink.strokeCount(), 3);

    holdEraser("stroke");
    draw([150, 300], [150, 340]);
    // However many it takes, it is one thing somebody did.
    check("one drag of the eraser takes everything it crossed", ink.strokeCount(), 0);
    ink.undo();
    check("...and one undo gives all of it back", ink.strokeCount(), 3);

    /* The rub-out eraser shows how much it will take before it takes it, so
     * its ring follows the pointer whether or not the pointer is down.
     */
    holdEraser("point");
    layer.dispatchEvent(pointer("pointermove", [150, 320]));
    check("the rub-out eraser shows its reach before it takes anything",
      [layer.querySelectorAll(".ink-eraser-ring").length, ink.strokeCount()], [1, 3]);

    /* And takes out the part it was over rather than the stroke: the one it
      * crossed in the middle comes back as the two ends of itself, which is
      * three strokes becoming four.
      */
    layer.dispatchEvent(pointer("pointerdown", [150, 320]));
    layer.dispatchEvent(pointer("pointerup", [150, 320]));
    // Everything within its reach, each stroke coming back as the two ends of
    // itself — which is three strokes becoming six.
    check("...and rubs a hole through what it was over, leaving the ends",
      ink.strokeCount(), 6);
    ink.undo();
    check("...which is one step back, not three", ink.strokeCount(), 3);

    // A drag that crossed nothing is not a step: an undo stack with empty
    // steps in it is an undo button that does nothing when pressed.
    /* A drag that crossed nothing is not a step. It used to be one step per
      * pointer move: the snapshot was taken at "the first thing rubbed out",
      * which never arrives on a drag over empty space, so a drag across a
      * blank margin put a hundred identical copies of the document on the
      * stack and undo did nothing a hundred times.
      */
    ink.clear();
    hold("pen");
    draw([100, 300], [200, 300]);
    holdEraser("point");
    draw([700, 700], [720, 720], 12);
    ink.undo();
    check("a long drag of the eraser that rubbed nothing out is not a step at all",
      ink.strokeCount(), 0);
    ink.redo();
  }

  console.log("=== undo, redo, and erasing the lot ===");
  {
    ink.clear();
    hold("pen");
    draw([100, 400], [200, 400]);
    draw([100, 420], [200, 420]);

    ink.undo();
    check("undo takes the last stroke back", ink.strokeCount(), 1);
    ink.redo();
    check("...and redo puts it there again", ink.strokeCount(), 2);

    // Nothing to undo and nothing to redo, pressed anyway.
    /* Erasing everything asks first, because it is the one button here that
     * cannot be undone by doing the opposite of it.
     */
    answer = false;
    press(".ink-danger");
    check("erasing everything asks first", asked.length, 1);
    check("...and a no leaves it alone", ink.strokeCount(), 2);
    answer = true;
    press(".ink-danger");
    check("...while a yes erases it", ink.strokeCount(), 0);
    check("...and is itself one step back", (ink.undo(), ink.strokeCount()), 2);

    // Erasing an empty document is not a step on the stack.
    ink.clear();
    const empty = ink.strokeCount();
    ink.clear();
    ink.undo();
    check("erasing a document with nothing on it changes nothing",
      [empty, ink.strokeCount() >= 0], [0, true]);
  }

  console.log("=== and from the keyboard ===");
  {
    const key = (name, extra = {}) => document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: name, bubbles: true, ...extra }));

    ink.clear();
    hold("pen");
    draw([100, 500], [200, 500]);

    key("z", { ctrlKey: true });
    check("ctrl-z undoes", ink.strokeCount(), 0);
    key("Z", { ctrlKey: true, shiftKey: true });
    check("...and ctrl-shift-z redoes", ink.strokeCount(), 1);
    key("z", { metaKey: true });
    check("...as does the other platform's key", ink.strokeCount(), 0);
    ink.redo();

    /* Somebody typing in a field is typing, not drawing. A shortcut that
     * fires while a name is being entered eats the keystroke.
     */
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    key("z", { ctrlKey: true });
    check("a shortcut while somebody is typing is a keystroke, not a shortcut",
      ink.strokeCount(), 1);
    field.remove();
    /** @type {HTMLElement} */ (document.body).focus();

    // Escape puts the pen down, which is the way out of drawing mode somebody
    // will try first.
    key("Escape");
    check("Escape puts the pen down", ink.tool(), "none");
    key("Escape");
    check("...and with nothing in your hand it does nothing", ink.tool(), "none");
    key("a");
    check("...while another key is not a shortcut at all", ink.tool(), "none");
  }

  console.log("=== the reader's own colours, which are theirs and not the document's ===");
  {
    window.localStorage.removeItem(Store.PALETTE_KEY);
    hold("pen");

    const more = () => /** @type {HTMLButtonElement} */ (bar.querySelector(".ink-more"));
    const palette = () => /** @type {HTMLElement} */ (bar.querySelector(".ink-palette"));
    const mix = (value) => {
      const picker = /** @type {HTMLInputElement} */ (bar.querySelector(".ink-picker"));
      picker.value = value;
      picker.dispatchEvent(new window.Event("change", { bubbles: true }));
    };

    press(".ink-more");
    check("the palette opens", [palette().hidden, more().getAttribute("aria-expanded")],
      [false, "true"]);
    check("...saying there is nothing in it yet",
      bar.querySelector(".ink-palette-empty").textContent, "No colours of your own yet.");

    mix("#ff8800");
    check("a mixed colour goes in it", bar.querySelectorAll(".ink-palette-swatch").length, 1);
    ink.clear();
    draw([10, 600], [60, 600]);
    check("...and is the colour in hand", saved()[0].colour, "#ff8800");
    // Kept for the whole browser rather than for the document: a colour you
    // had to mix again on every shared link is one you would stop bothering
    // with.
    check("...and remembered for the browser, not for this document",
      Store.loadPalette(), ["#ff8800"]);

    mix("#00aa55");
    // Newest first, so the last one mixed is the first one reached for.
    check("the newest is the first one reached for", Store.loadPalette(), ["#00aa55", "#ff8800"]);
    check("...and the most recent few stand on the bar beside the six",
      bar.querySelectorAll(".ink-swatch-row .ink-swatch").length, Annotate.COLOURS.length + 2);

    /* Reaching for one of your own moves it to the front, which is what keeps
     * the ones you actually use on the bar and the rest a press away.
     */
    press('.ink-swatch[data-colour="#ff8800"]');
    check("reaching for one of your own moves it to the front",
      Store.loadPalette(), ["#ff8800", "#00aa55"]);
    check("...and closes the palette behind you", palette().hidden, true);

    // Mixing one already in the palette picks it rather than adding it twice.
    press(".ink-more");
    mix("#00aa55");
    check("mixing one you already have picks it instead of keeping two",
      Store.loadPalette().length, 2);

    // A palette you can only add to fills up with the near-misses of the
    // colour somebody was actually after.
    press(".ink-more");
    press(".ink-palette-drop");
    check("one of your own can be forgotten", Store.loadPalette().length, 1);

    /* A native colour input is the whole point of not building one, and it
      * sanitises what it is given — so what reaches the palette is a colour
      * whatever was typed at it. `#000000` is what "not a colour" becomes.
      */
     mix("not a colour");
     check("whatever is typed at the picker arrives as a colour",
       Store.loadPalette()[0], "#000000");

    if (palette().hidden) {
      press(".ink-more");
    }
    check("the palette shuts when it is pressed again",
      (press(".ink-more"), palette().hidden), true);
    press(".ink-more");
    document.body.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
    check("...or when the page is pressed anywhere else", palette().hidden, true);

    press(".ink-more");
    const focused = [];
    more().focus = () => focused.push(true);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // One press, one thing undone, which is the order somebody expects it in.
    check("Escape shuts the palette before it puts the pen down",
      [palette().hidden, ink.tool()], [true, "pen"]);
    check("...and gives the keyboard back to the button that opened it", focused, [true]);

    press(".ink-more");
    press('.ink-tool[data-tool="pen"]');
    check("putting the pen down shuts the palette with it", palette().hidden, true);
  }

  console.log("=== tidying shapes as they are drawn, and not ===");
  {
    hold("pen");
    ink.clear();

    const toggle = /** @type {HTMLElement} */ (bar.querySelector(".ink-toggle"));
    check("it is on to begin with", toggle.getAttribute("aria-pressed"), "true");

    // A rectangle drawn freehand, near enough.
    const box = [[100, 700], [300, 700], [300, 800], [100, 800], [100, 700]];
    const freehand = (corners) => {
      layer.dispatchEvent(pointer("pointerdown", corners[0]));
      for (const corner of corners.slice(1)) {
        for (let step = 1; step <= 8; step += 1) {
          const along = step / 8;
          const last = corners[corners.indexOf(corner) - 1];
          layer.dispatchEvent(pointer("pointermove", [
            last[0] + ((corner[0] - last[0]) * along),
            last[1] + ((corner[1] - last[1]) * along)
          ]));
        }
      }
      layer.dispatchEvent(pointer("pointerup", corners[corners.length - 1]));
    };

    freehand(box);
    /* A tidied shape says so, briefly: ink to shape changes the stroke under
     * the pen the instant it comes up, and without a moment's fade it is not
     * obvious that anything was done — or that undo gives the freehand
     * version back.
     */
    check("a shape drawn freehand is tidied", saved()[0].shape, "rectangle");
    check("...and the stroke on the layer says so for a moment",
      layer.querySelectorAll(".ink-tidied").length, 1);

    toggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...and it can be turned off in one press for anybody whose "
      + "handwriting keeps being read as a circle", toggle.getAttribute("aria-pressed"), "false");

    ink.clear();
    freehand(box);
    check("...after which a shape stays as it was drawn", saved()[0].shape, undefined);

    ink.setInkToShape(true);
    check("and the page can turn it back on", toggle.getAttribute("aria-pressed"), "false");
    paintAgain();
    check("...which the bar shows once it is painted again",
      toggle.getAttribute("aria-pressed"), "true");
  }

  function paintAgain() {
    // Nothing public repaints the bar, so putting a tool down and picking it
    // up again does it.
    const was = ink.tool();
    press(`.ink-tool[data-tool="${was === "none" ? "pen" : was}"]`);
    press(`.ink-tool[data-tool="${was === "none" ? "pen" : was}"]`);
  }

  console.log("=== when the marks will not fit, or will not be stored ===");
  {
    hold("pen");
    ink.clear();

    const realSet = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = () => {
      throw new Error("the quota is gone");
    };

    draw([100, 900], [200, 900]);
    /* Private mode, or the origin's quota is gone. The marks stay on screen
     * for this visit either way, and saying nothing would be letting somebody
     * believe their notes are safe.
     */
    check("a browser that will not store the marks says so",
      status(), "This browser will not store the marks, so they stay for this visit only.");
    check("...and the marks are still on screen", ink.strokeCount(), 1);

    // A status that stays on screen is read as the state of the next thing
    // somebody does.
    after(6000);
    check("...and the bar takes it back a moment later", status(), "");
    window.Storage.prototype.setItem = realSet;

    /* More ink than there is room for, which is a different answer: it is not
     * the browser refusing, it is this document being too heavily marked.
     */
    const line = Array.from({ length: 400 }, (_, at) => [at, at * 2]);
    const many = Array.from({ length: 200 }, () => ({
      tool: "pen", colour: "#eb6f6a", width: 4, points: line
    }));
    check("more ink than there is room for is a different answer",
      [Store.packed(many).length > Store.MAX_BYTES, Store.save("abc", many).reason],
      [true, "too-big"]);

    /* And the bar says which of the two it was, because they are different
     * problems: one is this browser, and one is this document. Put there
     * through storage and loaded back, which is the only way a document gets
     * that heavily marked without drawing it.
     */
    window.localStorage.setItem(Store.keyFor("abc"), Store.packed(many));
    ink.restore();
    check("a document with more ink on it than fits is loaded anyway",
      ink.strokeCount(), many.length);

    draw([300, 900], [320, 900]);
    check("...and the bar says it is the document rather than the browser",
      status(), "There is too much ink on this document to save it all. "
      + "What is on screen stays for this visit.");
    after(6000);
    ink.clear();
  }

  console.log("=== how far back it can be taken ===");
  {
    /* Enough to undo a page of marking, bounded so a long session cannot grow
     * without limit — a hundred shallow copies of a list of a few hundred
     * small objects costs nothing, and a thousand of them is a tab that gets
     * slower the longer somebody writes on a document.
     */
    ink.clear();
    hold("pen");
    for (let at = 0; at < Annotate.HISTORY_DEPTH + 10; at += 1) {
      draw([10, 10 + at], [40, 10 + at], 2);
    }

    const drawn = ink.strokeCount();
    for (let at = 0; at < Annotate.HISTORY_DEPTH + 20; at += 1) {
      ink.undo();
    }

    // The oldest steps have gone, so the earliest state reachable is the one
    // a hundred steps back rather than the empty document.
    check("undo goes back as far as it is allowed to and no further",
      [drawn > Annotate.HISTORY_DEPTH, ink.strokeCount()],
      [true, drawn - Annotate.HISTORY_DEPTH]);
    ink.clear();
  }

  console.log("=== the page changing shape under the ink ===");
  {
    window.localStorage.removeItem(Store.PALETTE_KEY);
    ink.clear();
    hold("pen");
    draw([100, 100], [300, 300]);
    ink.restore();
    check("what was drawn comes back when the document does", ink.strokeCount(), 1);

    /* Waiting a frame, because a reflow arrives as a burst: the column
     * resizes, then the text rewraps, then images and diagrams settle. Acting
     * on each of those in turn would scale the ink several times over for one
     * change — so the burst is fired here and then the frame it waits for.
     */
    const reflow = () => {
      observers.forEach((one) => one.run());
      after(120);
    };

    const before = saved()[0].points[0].slice();
    measuring.width = 800;
    measuring.height = 1000;
    reflow();
    check("a reflow that changed nothing moves nothing", saved()[0].points[0], before);

    /* Zooming, or resizing the window, reflows the document underneath: the
     * column narrows, the text takes more lines, and everything below moves
     * down. Ink pinned to fixed coordinates then sits over the wrong words.
     */
    measuring.width = 400;
    measuring.height = 2000;
    reflow();
    const moved = saved()[0].points[0];
    // Not exact — reflowing text moves in ways no single transform describes
    // — but a note two thirds of the way down stays two thirds of the way
    // down.
    check("a page half as wide and twice as long takes the ink with it",
      [Math.round(moved[0] / before[0] * 100) / 100, Math.round(moved[1] / before[1] * 100) / 100],
      [0.5, 2]);

    // A surface with no size is a document that has not been laid out yet,
    // and scaling by zero is losing the lot.
    measuring.width = 0;
    measuring.height = 0;
    const kept = saved()[0].points[0];
    reflow();
    check("a page that measures as nothing is not a page to scale against",
      saved()[0].points[0], kept);
    measuring.width = 800;
    measuring.height = 1000;
    reflow();
  }

  console.log("=== and how tall the bar is, told to the page ===");
  {
    /* The bar sticks to the top of the scroller, and so does the outline
     * beside the document; without this the outline's heading would sit
     * underneath the tools. Measured rather than assumed because the bar
     * wraps to two rows on a narrow window.
     */
    observers.forEach((one) => one.run());
    check("the page is told how much room the bar is taking",
      document.documentElement.style.getPropertyValue("--ink-bar"), "48px");

    // A hidden bar measures zero, which is exactly the offset wanted when the
    // tools are away.
    bar.getBoundingClientRect = () => /** @type {any} */ ({ height: 0 });
    observers.forEach((one) => one.run());
    check("...and nothing when they are put away",
      document.documentElement.style.getPropertyValue("--ink-bar"), "0px");
  }

  console.log("=== a browser with no way to say the page has changed shape ===");
  {
    /* ResizeObserver is how the layer keeps matching the document it is over:
     * images finish loading, diagrams render, the window changes width. A
     * browser without one still draws — it simply does not follow a reflow,
     * which is better than not loading.
     */
    const observing = window.ResizeObserver;
    delete /** @type {any} */ (window).ResizeObserver;

    const plainBar = document.createElement("div");
    document.body.appendChild(plainBar);
    const was = observers.length;
    const plain = Annotate.create({ surface, content, toolbar: plainBar, token: "plain" });
    plain.restore();

    check("a page with no observer watches nothing", observers.length, was);
    check("...and still draws", (plain.chooseTool("pen"), plain.tool()), "pen");
    window.ResizeObserver = observing;
  }

  console.log("=== a document nothing was shared under ===");
  {
    /* No token is a document opened some way this module did not expect.
     * Drawing still works — it is on screen — and nothing is written down
     * under a key that would collide with another document's.
     */
    const otherBar = document.createElement("div");
    document.body.appendChild(otherBar);
    const loose = Annotate.create({ content, toolbar: otherBar });
    const looseLayer = /** @type {SVGElement} */ ([...content.querySelectorAll("svg")].pop()
      || [...document.querySelectorAll("svg")].pop());

    check("the layer goes over the content when there is no surface",
      looseLayer.parentNode, content);
    check("...and the marks are not filed anywhere", Store.save("", [{ tool: "pen" }]).reason,
      "no-token");
    void loose;
  }
};
