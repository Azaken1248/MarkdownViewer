/* Part of the DIAGRAM suite. See diagrams.test.js, which loads this.
 *
 * The rendering path, run rather than read. Everything above this in the suite
 * reads the stylesheet and the engine's source — the stylesheet because a rule
 * is a rule, and the palettes because the contrast arithmetic is over the
 * numbers in the table. What the source could not answer is behaviour, and
 * what the source said about it was a set of regexes over the lines that do it.
 *
 * Four libraries are stood in for, and all four are the ones the page fetches
 * from a CDN when a document turns out to need them: Mermaid, svg-pan-zoom,
 * KaTeX and highlight.js. Each one answers the smallest thing the app asks of
 * it and writes down what it was asked, which is the half that matters — what
 * Mermaid draws is Mermaid's business, and whether the block it drew into has a
 * height of its own is ours.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript, modelScriptPaths, drawScriptPaths } = require("../app-source.js");

module.exports = async (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  const dom = new JSDOM("<body></body>", {
    url: "https://docs.example/", runScripts: "outside-only", pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;

  window.marked = /** @type {any} */ ({ setOptions() {}, parse: (text) => String(text) });
  window.DOMPurify = /** @type {any} */ ({ sanitize: (text) => String(text) });
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;

  // The order index.html loads them in, because each one's top-level `var` is
  // what the next one reads.
  for (const file of [
    "dom-html.js", "doc-kinds.js", "md/lazy.js", "md/text.js", "md/math.js",
    "md/diagram-theme.js", "md/code.js", "md/mermaid.js", "md/panzoom.js",
    "diagram-icons.js"
  ]) {
    loadScript(window, path.join(ROOT, file));
  }

  /* The layout reader and the drawer, which a laid-out diagram is drawn by
   * here rather than by the engine. Both are assembled out of several files,
   * and the lists of them live in app-source.js so a new one is picked up.
   */
  const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
  for (const file of [...modelScriptPaths(PUBLIC_DIR), ...drawScriptPaths(PUBLIC_DIR)]) {
    loadScript(window, file);
  }

  const Mermaid = window.MdMermaid;
  const PanZoom = window.MdPanZoom;
  const Math_ = window.MdMath;
  const Theme = window.MdDiagramTheme;

  const warnings = [];
  window.MdLazy.configure({ onWarning: (message) => warnings.push(message) });

  /* --- and the CDN they come from ----------------------------------------
   *
   * jsdom fetches nothing, so a <script> it appends never fires either event
   * and the loader's promise would never settle. `delivers` is what the
   * network hands over; anything else fails to load, which is the case the
   * app has to keep working through.
   */
  const delivers = new Map();

  window.document.head.appendChild = /** @type {any} */ ((node) => {
    const where = String(node.src || node.href || "");
    const found = [...delivers].find(([part]) => where.includes(part));

    Promise.resolve().then(() => {
      // A stylesheet arrives without putting anything in the window, which is
      // why what it delivers may be nothing.
      if (found && found[1]) {
        Object.assign(window, { [found[1][0]]: found[1][1] });
      }

      node.dispatchEvent(new window.Event(found ? "load" : "error"));
    });

    return node;
  });

  /* --- the four libraries ------------------------------------------------- */

  // Mermaid. `refuses` is a list of sources it will not parse, which is how
  // the ER simplifier's second attempt is reached.
  const rendered = [];
  let refuses = [];
  let initialized = [];

  window.mermaid = /** @type {any} */ ({
    initialize: (options) => initialized.push(options),
    render: async (id, source) => {
      rendered.push({ id, source });
      if (refuses.some((part) => source.includes(part))) {
        throw Object.assign(new Error("Parse error"), { str: `refused: ${source.split("\n")[0]}` });
      }

      return {
        svg: `<svg id="${id}" viewBox="0 0 400 300"><g/></svg>`,
        bindFunctions: (node) => node.setAttribute("data-bound", "1")
      };
    }
  });

  // svg-pan-zoom. Every instance writes down what was done to it, because what
  // is worth checking is that they are taken apart again.
  const instances = [];
  let refusesInit = false;

  window.svgPanZoom = /** @type {any} */ ((selector, options) => {
    if (refusesInit) {
      throw new Error("svg-pan-zoom could not attach");
    }

    const instance = {
      selector, options, alive: true, wheel: false, did: [],
      destroy() {
        this.alive = false;
        this.did.push("destroy");
      },
      resize() {
        this.did.push("resize");
      },
      fit() {
        this.did.push("fit");
      },
      center() {
        this.did.push("center");
      },
      enableMouseWheelZoom() {
        this.wheel = true;
      },
      disableMouseWheelZoom() {
        this.wheel = false;
      }
    };

    instances.push(instance);
    return instance;
  });

  // KaTeX, which the app uses two ways: the attribute markers it typesets
  // itself, and the auto-renderer for everything written in the prose.
  const typeset = [];
  let katexThrows = false;
  const sweeps = [];

  window.katex = /** @type {any} */ ({
    render: (tex, node, options) => {
      if (katexThrows) {
        throw new Error("KaTeX gave up");
      }

      typeset.push({ tex, display: options.displayMode });
      node.textContent = `[${tex}]`;
    }
  });

  window.renderMathInElement = /** @type {any} */ ((root, options) => {
    sweeps.push(options);
  });

  window.hljs = /** @type {any} */ ({
    highlight: (code, options) => ({ value: `<i>${code}</i>`, language: options.language }),
    highlightElement: (node) => node.classList.add("hljs"),
    getLanguage: () => true,
    highlightAuto: (code) => ({ value: `<i>${code}</i>`, language: "python" })
  });

  /* --- and the layout, which jsdom does not do ---------------------------
   *
   * An SVG's `viewBox` is an SVGAnimatedRect in a browser and nothing at all
   * in jsdom, and reading it is the first thing the sizing does — so every
   * diagram put on the page here is given the one its attribute says.
   */
  const measurable = (root) => {
    for (const svg of root.querySelectorAll("svg")) {
      const [x, y, width, height] = String(svg.getAttribute("viewBox") || "")
        .split(/[\s,]+/).map(Number);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        Object.defineProperty(svg, "viewBox", {
          configurable: true, value: { baseVal: { x, y, width, height } }
        });
      }
    }

    return root;
  };

  const panel = (markup) => {
    const root = document.createElement("div");
    root.className = "markdown-body";
    root.innerHTML = markup;
    document.body.replaceChildren(root);
    return measurable(root);
  };

  // What the modules say when something they lean on refuses. Captured rather
  // than left in the log, and then checked.
  const logged = [];
  window.console.error = (...parts) => logged.push(parts.map(String).join(" "));

  const fenced = (source) => `<pre><code class="language-mermaid">${source}</code></pre>`;

  /* A diagram that says where its own boxes go has already been arranged, by
   * hand, in the file — so it is drawn here rather than by the engine, and a
   * page whose diagrams are all like this never asks the CDN for the 3.5MB
   * engine at all.
   */
  const laidOut = "flowchart TD\n    %% layout v1\n    %% @ A 10,10 160x56"
    + "\n    %% @ B 10,150 160x56\n    A[One]\n    B[Two]\n    A --> B";
  const frames = () => new Promise((done) => window.setTimeout(done, 40));

  console.log("=== the source a diagram is drawn from ===");
  {
    const odd = Mermaid.normalizeMermaidSource(
      "\uFEFFgraph TD\u200b\r\n  A[\u201cstart\u201d] --\u00a0> B[\u2018end\u2019]  ");
    check("a byte order mark and the zero-width characters an editor leaves go",
      /[\uFEFF\u200B-\u200D]/.test(odd), false);
    // Curly quotes are what a word processor makes of a diagram pasted through
    // it, and Mermaid's parser refuses them.
    check("...curly quotes become the quotes the parser takes",
      odd.includes('"start"') && odd.includes("'end'"), true);
    check("...a non-breaking space becomes a space", odd.includes("\u00a0"), false);
    check("...and the whole of it is trimmed", odd.startsWith("graph TD"), true);
    check("nothing at all normalizes to nothing", Mermaid.normalizeMermaidSource(null), "");

    /* Reading the node back is only right the first time: after a render it
     * holds an <svg>, and an <svg> carries its own <style>. So the source is
     * recorded the first time the node is seen.
     */
    const node = document.createElement("div");
    node.textContent = "graph TD\n A-->B";
    check("the source is taken off the node once", Mermaid.mermaidSourceOf(node), "graph TD\n A-->B");
    node.textContent = "<svg><style>.a{}</style></svg>";
    check("...and read from where it was put thereafter",
      Mermaid.mermaidSourceOf(node), "graph TD\n A-->B");
  }

  console.log("=== an ER diagram written the way most people write one ===");
  {
    const simplify = Mermaid.simplifyErDiagramSource;

    /* The common failure. Mermaid's ER parser refuses a type it does not know,
     * refuses a label with a space in it, and refuses the whole diagram for
     * one line it cannot read — so a stack trace appeared where a picture
     * should have been.
     */
    const written = [
      "erDiagram",
      "  USER {",
      "    timestamp created_at",
      "    text bio",
      "    enum role",
      "    uuid id PK",
      "    -- a comment the parser cannot read --",
      "  }",
      '  USER ||--o{ POST : "writes many of"'
    ].join("\n");

    const out = simplify(written).split("\n");
    check("a type the parser does not know becomes one it does",
      out.filter((line) => line.includes("created_at")), ["    datetime created_at"]);
    check("...for each of them",
      [out.some((line) => line === "    string bio"), out.some((line) => line === "    string role")],
      [true, true]);
    check("...a type it does know is left alone",
      out.some((line) => line === "    uuid id PK"), true);
    // Inside an entity block Mermaid refuses the whole diagram for one line it
    // does not understand, so a line this cannot read is left out rather than
    // passed through.
    check("...and a line it cannot read at all is left out",
      out.some((line) => line.includes("a comment")), false);
    // The label has to be a single word Mermaid will take.
    check("a relationship's label becomes one word",
      out.some((line) => line.endsWith(": writes_many_of")), true);
    check("...and a label of nothing but punctuation becomes the one word "
      + "that is always true of a relationship",
      simplify('erDiagram\n  A ||--o{ B : "!!!"').includes(": relates_to"), true);

    check("anything that is not an ER diagram is not simplified",
      simplify("graph TD\n  A-->B"), "graph TD\n  A-->B");
    check("...and a relationship it does not recognise is passed through",
      simplify("erDiagram\n  A -- B").includes("A -- B"), true);
    check("an empty line inside one stays an empty line",
      simplify("erDiagram\n\n  A {\n  }").split("\n").filter((line) => line === "").length, 1);
  }

  console.log("=== drawing one, and drawing it again when it will not ===");
  {
    rendered.splice(0);
    const node = document.createElement("div");
    node.className = "mermaid mermaid-block";
    node.textContent = "graph TD\n A-->B";
    panel("").appendChild(node);

    check("a diagram is drawn", await Mermaid.renderSingleMermaidNode(node), true);
    check("...into the block it was written in", Boolean(node.querySelector("svg")), true);
    // Mermaid hands back the handlers for its own click directives.
    check("...with whatever it wants bound to it", node.getAttribute("data-bound"), "1");

    /* Already on screen. Two passes over one root is not exotic — the
     * flowchart builder redraws its preview as it is typed into while an
     * earlier render is still waiting on the 3.5MB engine — and without this
     * the second pass would feed the parser the first one's stylesheet and
     * leave a wall of CSS where the diagram was.
     */
    const asked = rendered.length;
    check("a diagram already on screen is not drawn again",
      [await Mermaid.renderSingleMermaidNode(node), rendered.length], [true, asked]);

    /* The retry: the first attempt is what was written, and the second is what
     * the simplifier could make of it. One picture beats one stack trace.
     */
    refuses = ["timestamp"];
    rendered.splice(0);
    const er = document.createElement("div");
    er.className = "mermaid mermaid-block";
    er.textContent = "erDiagram\n  A {\n    timestamp at\n  }";
    panel("").appendChild(er);

    check("a diagram the parser refuses is simplified and tried again",
      await Mermaid.renderSingleMermaidNode(er), true);
    check("...which is two attempts, the second of them simplified",
      [rendered.length, rendered[1].source.includes("datetime")], [2, true]);

    // And when neither will parse, the source and the reason rather than a
    // blank space.
    refuses = ["graph"];
    const broken = document.createElement("div");
    broken.className = "mermaid mermaid-block";
    broken.textContent = "graph ???";
    panel("").appendChild(broken);

    check("a diagram nothing can parse is not drawn", await Mermaid.renderSingleMermaidNode(broken), false);
    check("...and shows its own source instead of a blank space",
      broken.querySelector(".mermaid-fallback-code").textContent, "graph ???");
    check("...with what the parser said about it",
      broken.querySelector(".mermaid-fallback-error").textContent.includes("refused: graph ???"), true);
    refuses = [];

    /* Mermaid's own parse errors carry a `str`; anything else that goes wrong
     * in there is an ordinary Error, and a reader who is shown neither has no
     * idea why the picture is missing.
     */
    const render = window.mermaid.render;
    Object.assign(window.mermaid, {
      render: () => {
        throw new Error("the engine fell over");
      }
    });
    const fell = document.createElement("div");
    fell.className = "mermaid mermaid-block";
    fell.textContent = "graph TD\n A-->B";
    panel("").appendChild(fell);
    await Mermaid.renderSingleMermaidNode(fell);
    check("an error of any other kind is shown as what it said",
      fell.querySelector(".mermaid-fallback-error").textContent.includes("the engine fell over"),
      true);

    Object.assign(window.mermaid, { render: () => { throw {}; } });
    const silent = document.createElement("div");
    silent.className = "mermaid mermaid-block";
    silent.textContent = "graph TD\n A-->B";
    panel("").appendChild(silent);
    await Mermaid.renderSingleMermaidNode(silent);
    check("...and one that said nothing at all is still explained",
      silent.querySelector(".mermaid-fallback-error").textContent.includes("Unknown parser error"),
      true);
    Object.assign(window.mermaid, { render });
  }

  console.log("=== the box a diagram is given before it is drawn ===");
  {
    /* svg-pan-zoom sets the SVG to width:100% and height:100%, so the block
     * has to have a height of its own or the whole thing collapses to nothing
     * — which is what a plain `height: auto` container did, and what made
     * diagrams invisible.
     */
    const blockFor = (svgMarkup) => {
      const root = panel(`<div class="mermaid-block">${svgMarkup}</div>`);
      return /** @type {HTMLElement} */ (root.firstElementChild);
    };

    const wide = blockFor('<svg viewBox="0 0 900 220"></svg>');
    PanZoom.sizeDiagramContainer(wide.querySelector("svg"));
    check("the shape comes from the diagram's own viewBox", wide.style.aspectRatio, "900 / 220");
    /* Capping the width at the diagram's natural size is what keeps a small
     * diagram small: without it, width:100% stretches a 160px flowchart across
     * the whole pane and the aspect ratio then makes it enormously tall.
     */
    check("...and the width it is capped at is its own, plus the block's frame",
      wide.style.maxWidth, "926px");

    // Small diagrams are still scaled up to a floor, or a three-node flowchart
    // renders postage-stamp sized on a wide monitor.
    const tiny = blockFor('<svg viewBox="0 0 160 90"></svg>');
    PanZoom.sizeDiagramContainer(tiny.querySelector("svg"));
    check("a tiny diagram is given a floor to be scaled up to",
      [tiny.style.aspectRatio, tiny.style.maxWidth], ["160 / 90", "386px"]);

    /* Some diagram types draw without a viewBox, so what was drawn is measured
     * instead — and getBBox throws on an SVG that is not laid out, which is a
     * fall-through rather than a failure.
     */
    const measured = blockFor("<svg></svg>");
    const svg = measured.querySelector("svg");
    /** @type {any} */ (svg).getBBox = () => ({ width: 640, height: 480 });
    PanZoom.sizeDiagramContainer(svg);
    check("a diagram with no viewBox is measured instead",
      measured.style.aspectRatio, "640 / 480");

    const awkward = blockFor("<svg></svg>");
    /** @type {any} */ (awkward.querySelector("svg")).getBBox = () => {
      throw new Error("not rendered");
    };
    PanZoom.sizeDiagramContainer(awkward.querySelector("svg"));
    // Nothing can resolve to zero height: a diagram with no usable size still
    // gets a ratio, and a width so it is not pane-wide.
    check("...and one that will not say how big it is still gets a box",
      [awkward.style.aspectRatio, awkward.style.maxWidth], ["16 / 9", "720px"]);

    const zero = blockFor('<svg viewBox="0 0 0 0"></svg>');
    PanZoom.sizeDiagramContainer(zero.querySelector("svg"));
    check("...as does one that measures as nothing", zero.style.aspectRatio, "16 / 9");

    // An SVG that is not in a diagram block is not a diagram.
    const loose = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    panel("").appendChild(loose);
    check("an SVG that is not in a diagram block is left alone",
      (PanZoom.sizeDiagramContainer(loose), loose.getAttribute("style")), null);
  }

  console.log("=== and then it can be dragged and zoomed ===");
  {
    instances.splice(0);
    const root = panel('<div class="mermaid-block"><svg viewBox="0 0 400 300"></svg></div>');
    await PanZoom.applyPanZoom(root);
    await frames();

    check("a drawn diagram gets pan and zoom", instances.length, 1);
    check("...sized before svg-pan-zoom takes its dimensions over",
      /** @type {HTMLElement} */ (root.firstElementChild).style.aspectRatio, "400 / 300");
    check("...given an id to be attached by",
      instances[0].selector, `#${root.querySelector("svg").id}`);
    /* Off by default so scrolling the page past a diagram scrolls the page.
     * Wheel-over-diagram used to zoom instead, which turned every diagram into
     * a scroll trap.
     */
    check("...with the wheel left alone", instances[0].options.mouseWheelZoomEnabled, false);
    // Refitted a frame later, once the browser has laid the SVG out.
    check("...and refitted once the page has laid it out",
      instances[0].did, ["resize", "fit", "center"]);

    /* A second pass over the same root takes the instance apart and builds
      * another one. That is what the refit a frame later guards against: it
      * checks the instance it was scheduled for is still the live one, because
      * svg-pan-zoom nulls its internals on destroy and a refit of the old one
      * threw rather than saying so.
      *
      * No frame between the two passes, which is the case that found it — the
      * flowchart builder redraws its preview while an earlier render of the
      * block around it is still in flight.
      */
    instances.splice(0);
    const twice = panel('<div class="mermaid-block"><svg viewBox="0 0 400 300"></svg></div>');
    await PanZoom.applyPanZoom(twice);
    await PanZoom.applyPanZoom(twice);
    check("a second pass takes the old instance apart and builds another",
      [instances.length, instances[0].alive, instances[1].alive], [2, false, true]);
    await frames();
    check("...and only the live one is refitted",
      [instances[0].did, instances[1].did], [["destroy"], ["resize", "fit", "center"]]);

    // A refit that goes wrong is one diagram that opens at the wrong zoom, not
    // a render that stops.
    instances.splice(0);
    logged.splice(0);
    const awkward = panel('<div class="mermaid-block"><svg viewBox="0 0 40 30"></svg></div>');
    await PanZoom.applyPanZoom(awkward);
    instances[0].resize = () => {
      throw new Error("nothing to resize");
    };
    await frames();
    check("a refit that goes wrong says so and leaves the diagram there",
      [logged.some((line) => line.includes("Pan/zoom refit failed")),
        Boolean(awkward.querySelector("svg"))], [true, true]);

    /* A diagram that is itself a control — the flowchart builder's preview,
     * where a box is tapped to select it — cannot also be a pan-zoom surface:
     * svg-pan-zoom takes the pointer events and puts its own controls on top.
     */
    instances.splice(0);
    const preview = panel('<div data-pan-zoom="off"><div class="mermaid-block">'
      + '<svg viewBox="0 0 10 10"></svg></div></div>');
    await PanZoom.applyPanZoom(preview);
    check("a diagram that is itself a control is left to handle its own clicks",
      instances.length, 0);

    // Nothing to pan, so nothing is fetched: a document with no diagram in it
    // never downloads the library at all.
    check("a panel with no diagram in it asks for nothing",
      (await PanZoom.applyPanZoom(panel("<p>words</p>")), instances.length), 0);
    check("...and neither does nothing at all",
      (await PanZoom.applyPanZoom(null), instances.length), 0);

    // And with no library either, which is the ordinary first visit: still
    // nothing fetched, because there is nothing to drag.
    const waiting = window.svgPanZoom;
    delete /** @type {any} */ (window).svgPanZoom;
    delivers.clear();
    check("...nor does a panel with no diagram and no library yet",
      (await PanZoom.applyPanZoom(panel("<p>words</p>")), instances.length), 0);
    Object.assign(window, { svgPanZoom: waiting });

    /* And a diagram drawn before the library has arrived, which is the
     * ordinary case: the engine is 3.5MB and this one is fetched after it.
     */
    const dragging = window.svgPanZoom;
    delete /** @type {any} */ (window).svgPanZoom;
    instances.splice(0);
    delivers.set("svg-pan-zoom", ["svgPanZoom", dragging]);
    await PanZoom.applyPanZoom(panel('<div class="mermaid-block"><svg viewBox="0 0 8 6"></svg></div>'));
    check("a diagram drawn before the library arrives waits for it",
      instances.length, 1);

    // And one where it never arrives: the diagram is drawn and simply cannot
    // be dragged.
    delete /** @type {any} */ (window).svgPanZoom;
    delivers.clear();
    instances.splice(0);
    const stuck = panel('<div class="mermaid-block"><svg viewBox="0 0 8 6"></svg></div>');
    await PanZoom.applyPanZoom(stuck);
    check("...and one where it never arrives leaves the diagram drawn",
      [instances.length, Boolean(stuck.querySelector("svg"))], [0, true]);
    Object.assign(window, { svgPanZoom: dragging });

    // svg-pan-zoom refusing to attach is one diagram that cannot be dragged,
    // not a document that fails to render.
    refusesInit = true;
    instances.splice(0);
    logged.splice(0);
    await PanZoom.applyPanZoom(panel('<div class="mermaid-block"><svg viewBox="0 0 4 3"></svg></div>'));
    check("a library that will not attach leaves the diagram drawn", instances.length, 0);
    check("...and says so rather than silently",
      logged.some((line) => line.includes("Pan/zoom init failed")), true);
    refusesInit = false;
  }

  console.log("=== the wheel, for as long as the key is held ===");
  {
    instances.splice(0);
    const root = panel('<div class="mermaid-block"><svg viewBox="0 0 400 300"></svg></div>');
    await PanZoom.applyPanZoom(root);
    await frames();

    PanZoom.bindWheelZoomModifier();
    const key = (type, name) => window.dispatchEvent(
      new window.KeyboardEvent(type, { key: name }));

    key("keydown", "Control");
    check("holding the modifier turns the wheel on", instances[0].wheel, true);
    key("keyup", "Control");
    check("...and letting go turns it off again", instances[0].wheel, false);
    key("keydown", "Meta");
    check("...on the other platform's key as well", instances[0].wheel, true);

    /* A keyup that happens while the window is unfocused never arrives, so the
     * modifier would stay stuck on.
     */
    window.dispatchEvent(new window.Event("blur"));
    check("...and leaving the window does not leave it stuck on", instances[0].wheel, false);

    key("keydown", "a");
    check("another key is not the modifier", instances[0].wheel, false);

    // An instance that refuses the toggle is one diagram whose wheel does not
    // change, not a page that stops answering the keyboard.
    const refusing = instances[0];
    refusing.enableMouseWheelZoom = () => {
      throw new Error("not attached any more");
    };
    logged.splice(0);
    key("keydown", "Control");
    check("one that refuses the toggle is noted and the rest are still told",
      logged.some((line) => line.includes("Pan/zoom wheel toggle failed")), true);
    key("keyup", "Control");

    // Already in that state, so there is nothing to tell the instances about.
    PanZoom.setWheelZoomArmed(false);
    check("setting it to what it already is does nothing", instances[0].wheel, false);

    // A diagram drawn while the modifier was already down comes up with the
    // wheel on, rather than needing the key pressed again.
    PanZoom.setWheelZoomArmed(true);
    instances.splice(0);
    await PanZoom.applyPanZoom(panel('<div class="mermaid-block"><svg viewBox="0 0 4 3"></svg></div>'));
    check("a diagram drawn while it is held comes up with the wheel on",
      instances[0].wheel, true);
    PanZoom.setWheelZoomArmed(false);
  }

  console.log("=== and let go of again ===");
  {
    /* svg-pan-zoom binds window resize and wheel handlers per instance. They
     * were never released, so every re-render and every document switch leaked
     * another set that kept firing against detached SVGs for the life of the
     * page.
     */
    instances.splice(0);
    const left = panel('<div class="mermaid-block"><svg viewBox="0 0 4 3"></svg></div>');
    await PanZoom.applyPanZoom(left);
    const first = instances[0];

    const right = panel('<div class="mermaid-block"><svg viewBox="0 0 4 3"></svg></div>');
    await PanZoom.applyPanZoom(right);
    const second = instances[1];

    /* A diagram that is still on the page but not under the panel being
     * replaced keeps its instance: switching documents replaces one panel, and
     * the editor's preview beside it is still being dragged.
     */
    const elsewhere = document.createElement("div");
    elsewhere.innerHTML = '<div class="mermaid-block"><svg viewBox="0 0 8 6"></svg></div>';
    document.body.appendChild(measurable(elsewhere));
    await PanZoom.applyPanZoom(elsewhere);
    const beside = instances[instances.length - 1];

    PanZoom.destroyPanZoomInstances(right);
    check("a diagram still on the page but not in that panel keeps its instance",
      beside.alive, true);
    check("the instances under one panel are released", second.alive, false);
    // The first panel's SVG is detached by now — document.body was replaced —
    // so it goes with it rather than being left bound to a node nobody can see.
    check("...along with anything already off the page", first.alive, false);

    instances.splice(0);
    const kept = panel('<div class="mermaid-block"><svg viewBox="0 0 4 3"></svg></div>');
    await PanZoom.applyPanZoom(kept);
    PanZoom.destroyPanZoomInstances();
    check("and all of them, when nothing is named", instances[0].alive, false);
    check("...so the diagram can be set up again afterwards",
      (await PanZoom.applyPanZoom(kept), instances.length), 2);

    // An instance that throws on the way out is still gone as far as this is
    // concerned, and the rest are still released.
    instances.splice(0);
    const noisy = panel('<div class="mermaid-block"><svg viewBox="0 0 4 3"></svg></div>');
    await PanZoom.applyPanZoom(noisy);
    instances[0].destroy = () => {
      throw new Error("already gone");
    };
    logged.splice(0);
    PanZoom.destroyPanZoomInstances();
    check("one that will not let go is let go of anyway",
      noisy.querySelector("svg").dataset.panzoomInit, undefined);
    check("...and the trouble is written down", logged.length, 1);
  }

  console.log("=== the maths left behind by the markdown pass ===");
  {
    const tex = (value) => Buffer.from(value, "utf8").toString("base64");

    const root = panel(
      `<p><span class="math-inline" data-math-tex="${tex("\\alpha")}"></span></p>`
      + `<div class="math-block" data-math-tex="${tex("x = 1")}"></div>`);

    typeset.splice(0);
    sweeps.splice(0);
    await Math_.renderMathBlocks(root);

    /* Drawn from the attribute nobody could have altered: the TeX went in
     * before markdown ran and comes out here, so what KaTeX is handed is
     * exactly what the document said.
     */
    check("both kinds of marker are typeset", typeset.map((one) => one.tex), ["x = 1", "\\alpha"]);
    check("...the block one as display and the inline one not",
      typeset.map((one) => one.display), [true, false]);
    // And then the auto-renderer over everything written in the prose.
    check("...and the prose is swept for the rest",
      sweeps[0].delimiters.map((one) => one.left), ["$$", "\\[", "\\(", "$"]);
    check("...leaving code and diagrams out of it",
      sweeps[0].ignoredTags.includes("code") && sweeps[0].ignoredTags.includes("svg"), true);

    // A formula KaTeX cannot draw is shown as the TeX it was, which is at
    // least readable, rather than as an empty space.
    katexThrows = true;
    logged.splice(0);
    const failing = panel(`<span class="math-inline" data-math-tex="${tex("\\bad{")}"></span>`);
    await Math_.renderMathBlocks(failing);
    check("a formula that cannot be drawn is shown as what it says",
      failing.firstElementChild.textContent, "\\bad{");
    check("...and the trouble is written down", logged.length, 1);
    katexThrows = false;

    // Nothing to typeset, so nothing is asked of the library.
    sweeps.splice(0);
    check("a panel with nothing in it is not swept",
      (await Math_.renderMathBlocks(null), sweeps.length), 0);

    /* And nothing is fetched for a document with no maths in it, which is the
     * reason the question is asked before the library is asked for.
     */
    const drawing = window.katex;
    const sweeping = window.renderMathInElement;
    delete /** @type {any} */ (window).katex;
    delete /** @type {any} */ (window).renderMathInElement;
    delivers.clear();
    check("a document with no maths in it fetches nothing",
      await Math_.renderMathBlocks(panel("<p>five dollars</p>")), undefined);
    Object.assign(window, { katex: drawing, renderMathInElement: sweeping });

    /* And the question asked before the library is fetched, because nothing
     * downloads KaTeX unless a document actually has maths in it.
     */
    check("a document with a marker in it wants maths",
      Math_.hasMathContent(panel('<span class="math-inline" data-math-tex="eA=="></span>')), true);
    check("...as does one with a formula written in the prose",
      Math_.hasMathContent(panel("<p>and $x = 1$ follows</p>")), true);
    check("...and one with neither does not",
      Math_.hasMathContent(panel("<p>five dollars</p>")), false);

    /* And the whole of it on a page where KaTeX has not arrived yet, which is
     * every page until a document turns out to have maths in it.
     */
    const katex = window.katex;
    const sweep = window.renderMathInElement;
    delete /** @type {any} */ (window).katex;
    delete /** @type {any} */ (window).renderMathInElement;
    delivers.set("katex.min.css", null);
    delivers.set("katex.min.js", ["katex", katex]);
    delivers.set("auto-render", ["renderMathInElement", sweep]);

    typeset.splice(0);
    const late = panel(`<div class="math-block" data-math-tex="${tex("y = 2")}"></div>`);
    await Math_.renderMathBlocks(late);
    check("a document with maths in it fetches the library and then typesets",
      typeset.map((one) => one.tex), ["y = 2"]);

    /* Half of it arriving is a real state: KaTeX is two scripts, and the
     * markers can be typeset by the first while the prose sweep needs the
     * second.
     */
    delete /** @type {any} */ (window).renderMathInElement;
    sweeps.splice(0);
    typeset.splice(0);
    await Math_.renderMathBlocks(panel(`<div class="math-block" data-math-tex="${tex("z = 3")}"></div>`));
    check("...and with only half of it, the markers are still drawn",
      [typeset.length, sweeps.length], [1, 0]);
    Object.assign(window, { renderMathInElement: sweep });

    // The sweep itself refusing is one document with unformatted maths in it,
    // not a document that stops rendering.
    const broken = () => {
      throw new Error("the sweep gave up");
    };
    Object.assign(window, { renderMathInElement: broken });
    logged.splice(0);
    await Math_.renderMathBlocks(panel("<p>and $x$ follows</p>"));
    check("a prose sweep that gives up says so and leaves the page standing",
      logged.some((line) => line.includes("Math rendering failed")), true);
    Object.assign(window, { renderMathInElement: sweep });
    delivers.clear();
  }

  console.log("=== every diagram in a document, from one call ===");
  {
    instances.splice(0);
    rendered.splice(0);
    warnings.splice(0);

    const root = panel(`<p>words</p>${fenced("graph TD\n A-->B")}`
      + '<pre><code class="language-python">x = 1</code></pre>');
    await PanZoom.renderMermaidBlocks(root);
    await frames();

    /* Promoting turns a fenced block into a bare <div>, so the engine is asked
     * for before anything is promoted: doing it the other way round and then
     * finding the engine unavailable would leave the diagram's source as loose
     * body text.
     */
    check("a fenced diagram becomes a drawn one",
      [root.querySelectorAll(".mermaid-block").length,
        Boolean(root.querySelector(".mermaid-block svg"))], [1, true]);
    check("...and is given pan and zoom", instances.length, 1);
    check("the code block beside it is highlighted",
      root.querySelector("code.language-python").classList.contains("hljs"), true);
    check("...and the diagram's own source is not", root.querySelectorAll(".hljs").length, 1);

    // A document with no diagram in it never downloads one at all.
    rendered.splice(0);
    await PanZoom.renderMermaidBlocks(panel("<p>words</p>"));
    check("a document with no diagram draws none", rendered.length, 0);

    // A diagram that will not parse is said out loud, once, however many
    // blocks could not be drawn.
    refuses = ["graph"];
    warnings.splice(0);
    await PanZoom.renderMermaidBlocks(panel(fenced("graph ???") + fenced("graph !!!")));
    check("a document with diagrams that will not parse says so once", warnings.length, 1);
    check("...and says which part of the page that is",
      warnings[0].includes("could not be parsed"), true);
    refuses = [];

    /* And a page where the engine never arrives: the code and the maths are
     * still drawn, which is the difference between a document that is missing
     * its diagrams and a document that is missing everything after them.
     */
    const engine = window.mermaid;
    delete /** @type {any} */ (window).mermaid;
    delivers.clear();
    const without = panel(`${fenced("graph TD\n A-->B")}`
      + '<pre><code class="language-python">x = 1</code></pre>'
      + '<span class="math-inline" data-math-tex="eA=="></span>');
    sweeps.splice(0);
    await PanZoom.renderMermaidBlocks(without);
    check("a page with no diagram engine still draws everything else",
      [without.querySelector("code.language-python").classList.contains("hljs"),
        sweeps.length > 0], [true, true]);
    // And the source is left as the fenced block it was, not promoted to a
    // bare div with loose text in it.
    check("...leaving the diagram as the code block it was",
      Boolean(without.querySelector("pre > code.language-mermaid")), true);

    /* And a diagram that says where its own boxes go, on that same page: it is
     * drawn here without the engine, and it still gets pan and zoom — which
     * is the whole point of drawing it ourselves rather than waiting for
     * 3.5MB that this page will never need.
     */
    instances.splice(0);
    const own = panel(fenced(laidOut));
    await PanZoom.renderMermaidBlocks(own);
    await frames();
    check("a diagram carrying its own layout is drawn without the engine",
      Boolean(own.querySelector(".mermaid-block svg.dd")), true);
    check("...and can still be dragged", instances.length, 1);
    Object.assign(window, { mermaid: engine });
  }

  console.log("=== and drawn again when the theme moves ===");
  {
    /* Mermaid renders to a static SVG with the palette written into it, so the
     * only way to recolour a diagram is to render it from its source again.
     * Four steps that have to happen in this order — forget the old palette,
     * unbind the pan-zoom instances before their SVGs are replaced, put each
     * block back to its source, render — and getting the order wrong leaks
     * handlers onto detached nodes or redraws in the colours it just left.
     */
    /* Re-initialized when the theme has moved on rather than only when
     * nothing has been initialized yet, or a stale palette survives a theme
     * change — so the page is put on the light theme first and the engine is
     * asked for its palette again on the way in.
     */
    Object.assign(document.documentElement.dataset, { theme: "light" });
    instances.splice(0);
    initialized = [];
    const root = panel(fenced("graph TD\n A-->B"));
    await PanZoom.renderMermaidBlocks(root);
    await frames();

    const was = instances[0];
    const drawnAs = root.querySelector(".mermaid-block svg").id;
    check("the palette a diagram is drawn with is the page's own",
      [initialized.length, initialized[0].darkMode], [1, false]);
    check("...at the security level that runs the sanitizer over the labels",
      initialized[0].securityLevel, "antiscript");
    // Mermaid bakes its colours into the SVG, so the palette has to go in as
    // theme variables rather than as blanket overrides.
    check("...handed over as the engine's own theme variables",
      typeof initialized[0].themeVariables.mainBkg, "string");

    // And asked for again on the next render without a theme change, which is
    // most renders.
    initialized = [];
    await PanZoom.renderMermaidBlocks(panel(fenced("graph TD\n C-->D")));
    check("...and not asked for again while the theme has not moved",
      initialized.length, 0);

    delete document.documentElement.dataset.theme;
    initialized = [];
    await PanZoom.repaintMermaidForTheme([root, null]);
    await frames();

    check("the diagram is drawn again in the new palette",
      [initialized.length, initialized[0].darkMode], [1, true]);
    /* From the source it was drawn from the first time — which has to have
     * been kept, because by now the block holds an <svg> and an <svg> carries
     * its own <style>.
     */
    check("...from the source it was drawn from the first time",
      [Boolean(root.querySelector(".mermaid-block svg")),
        root.querySelector(".mermaid-block svg").id === drawnAs], [true, false]);
    // Their SVGs were about to be replaced; leaving the instances bound would
    // leak handlers onto detached nodes.
    check("...with the old pan-zoom instances unbound first", was.alive, false);
    check("...and the sizing measured again rather than kept", instances.length > 1, true);

    /* Nothing on screen to redraw, but the next render must not reuse the old
     * palette either — which is the case on a page whose document has not
     * loaded yet when the theme is switched.
     */
    initialized = [];
    await PanZoom.repaintMermaidForTheme([panel("<p>words</p>")]);
    check("a page with nothing to redraw redraws nothing", initialized.length, 0);
    await PanZoom.renderMermaidBlocks(panel(fenced("graph TD\n A-->B")));
    check("...but the next diagram is drawn with the palette asked for",
      initialized.length, 1);

    // A block with no source recorded cannot be redrawn from one, and is left
    // as it is rather than emptied.
    const orphan = panel('<div class="mermaid-block"><svg id="kept"></svg></div>');
    await PanZoom.repaintMermaidForTheme([orphan]);
    check("a block with no source to redraw from is left alone",
      Boolean(orphan.querySelector("#kept")), true);

    /* And the sizing is measured again rather than kept, which is only visible
     * when the redraw does not produce a diagram: the block would otherwise
     * squash the parse error into the shape of the picture that used to be
     * there.
     */
    const sized = panel(fenced("graph TD\n A-->B"));
    await PanZoom.renderMermaidBlocks(sized);
    check("a drawn diagram has a shape",
      Boolean(/** @type {HTMLElement} */ (sized.firstElementChild).style.aspectRatio), true);

    refuses = ["graph"];
    Object.assign(document.documentElement.dataset, { theme: "light" });
    await PanZoom.repaintMermaidForTheme([sized]);
    check("...and a redraw that fails does not keep the old one",
      [/** @type {HTMLElement} */ (sized.firstElementChild).style.aspectRatio,
        Boolean(sized.querySelector(".mermaid-fallback-code"))], ["", true]);
    refuses = [];
    delete document.documentElement.dataset.theme;
  }

  console.log("=== a page missing the scripts these lean on ===");
  {
    /* Both of these are same-origin scripts that are always there, so what is
     * checked is the guard rather than a situation: a build that drops one of
     * them draws no diagrams rather than throwing on the first document.
     */
    check("with no diagram engine on the page, nothing is initialized",
      (delete /** @type {any} */ (window).mermaid, Theme.ensureMermaidInitialized(),
        window.mermaid), undefined);

    const drawing = window.DiagramDraw;
    window.DiagramDraw = /** @type {any} */ (null);
    check("and with no layout drawer, no laid-out diagram is drawn",
      Theme.drawLaidOutDiagrams(panel(fenced("graph TD\n A-->B"))), 0);
    window.DiagramDraw = drawing;
    check("...nor is there anything to draw in nothing",
      Theme.drawLaidOutDiagrams(null), 0);
  }
};
