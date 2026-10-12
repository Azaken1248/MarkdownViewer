/* Part of the EXPORT suite. See export.test.js, which loads this.
 *
 * One HTML file that is the page: the stylesheets fetched and rewritten, the
 * fonts and pictures carried inside it, the diagrams drawn, the ink laid over
 * the sheets, and all of it best-effort — an export that refuses to happen
 * because one background image would not load is worse than an export with
 * one background image missing.
 *
 * Four things are stood in for here, and they are the four a browser does and
 * Node does not: the network, the rasteriser, the image loader and the layout.
 * Each one is a table the test fills in, which is what makes the arithmetic
 * checkable at all — what a copy *looks* like next to the page it came from is
 * the browser suite's question, because that is the only place it can be asked.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");
const { install } = require("./layout.js");

module.exports = async (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");
  const SVG_NS = "http://www.w3.org/2000/svg";

  const dom = new JSDOM("<body></body>", {
    url: "https://docs.example/notes/a",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;

  loadScript(window, path.join(ROOT, "export", "paginate.js"));
  loadScript(window, path.join(ROOT, "export", "snapshot.js"));
  const Snapshot = window.ExportSnapshot;

  const { block, sized } = install(window);

  /* --- the network --------------------------------------------------------
   *
   * A table of what each URL answers with. Anything not in it is a 404, which
   * is the case that matters most: it is what a stylesheet moving looks like.
   */
  const answers = new Map();
  const asked = [];

  const serves = (url, body) => answers.set(url, body);

  window.fetch = async (url) => {
    const href = String(url);
    asked.push(href);
    const answer = answers.get(href);

    if (!answer) {
      return /** @type {any} */ ({ ok: false, status: 404 });
    }

    if (answer.offline) {
      throw new Error("the network went away");
    }

    return /** @type {any} */ ({
      ok: true,
      text: async () => answer.text || "",
      blob: async () => new window.Blob([Buffer.from(answer.bytes || "PNG")],
        { type: answer.type || "image/png" })
    });
  };

  /* --- the rasteriser -----------------------------------------------------
   *
   * What a canvas does with an SVG is the browser's business. What this suite
   * asks is what happens to the picture afterwards, so the canvas answers the
   * same thing every time — and, when `tainted` is set, refuses the way a real
   * one refuses after drawing something from another origin.
   */
  let tainted = false;

  window.HTMLCanvasElement.prototype.getContext = () => /** @type {any} */ ({
    drawImage: () => {}
  });

  window.HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
    if (tainted) {
      throw new Error("the canvas has been tainted by cross-origin data");
    }
    return `data:image/png;base64,${"P".repeat(this.width)}`;
  };

  /* --- the image loader ---------------------------------------------------
   *
   * jsdom loads nothing, so an Image's onload never fires and every promise
   * in svgAsPng would be waited on forever. This one answers on the next
   * tick, and fails for a source the test marked unloadable.
   */
  let unloadable = "";

  window.Image = /** @type {any} */ (class {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.width = 0;
    }

    set src(value) {
      const broken = unloadable && String(value).includes(unloadable);
      Promise.resolve().then(() => (broken ? this.onerror?.() : this.onload?.()));
    }
  });

  /* --- and the reader that turns a blob into a data URI -------------------
   *
   * jsdom's does the real work, which is worth having. What it will not do is
   * fail, and a FileReader that fails is the one case the export has to
   * survive — so a blob of one type is refused and the rest go through.
   */
  const realRead = window.FileReader.prototype.readAsDataURL;

  window.FileReader.prototype.readAsDataURL = function readAsDataURL(blob) {
    if (blob.type === "font/unreadable") {
      Promise.resolve().then(() => /** @type {any} */ (this.onerror)?.());
      return;
    }

    realRead.call(this, blob);
  };

  /* --- the layout --------------------------------------------------------- */

  // Each SVG is asked for its bounds twice over: getBBox for what was drawn,
  // and the rect for the box it was drawn in.
  const drawnAt = (svg, bounds) => {
    /** @type {any} */ (svg).getBBox = () => (bounds || (() => {
      throw new Error("not rendered");
    })());
    return svg;
  };

  const svgIn = (parent, bounds, height = 200, width = 600) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.appendChild(document.createElementNS(SVG_NS, "path"));
    svg.setAttribute("style", `width: ${width}px`);
    parent.appendChild(svg);
    sized(/** @type {any} */ (svg), height);
    return drawnAt(svg, bounds);
  };

  const inkLayer = (bounds) => {
    const ink = document.createElementNS(SVG_NS, "svg");
    const stroke = document.createElementNS(SVG_NS, "path");
    stroke.setAttribute("d", "M0 0 L10 10");
    ink.appendChild(stroke);
    return drawnAt(ink, bounds);
  };

  // A page: the surface the ink was drawn over, with the document column
  // inside it.
  const pageWith = (...blocks) => {
    const surface = document.createElement("div");
    surface.style.width = "1200px";
    const article = document.createElement("article");
    article.className = "doc-body";
    article.style.width = "800px";
    blocks.forEach((one) => article.appendChild(one));
    surface.appendChild(article);
    document.body.replaceChildren(surface);
    return { surface, article };
  };

  console.log("=== the stylesheets, fetched and brought along ===");
  {
    const linked = { href: "https://docs.example/css/app.css" };
    const foreign = {
      href: "https://fonts.example/sheet.css",
      get cssRules() {
        throw new Error("cannot access rules of a cross-origin stylesheet");
      }
    };
    const missingSheet = { href: "https://docs.example/css/gone.css" };

    const inline = document.createElement("style");
    inline.textContent = ".a{color:red}@media print{.a{color:black}}";
    document.head.appendChild(inline);

    // A <style> block is same-origin by definition, so one whose rules cannot
    // be read is a browser refusing for a reason of its own — and it has no
    // address to name in the list of what is missing.
    const unreadable = {
      href: "",
      get cssRules() {
        throw new Error("rules unavailable");
      }
    };

    const offline = { href: "https://docs.example/css/offline.css" };

    Object.defineProperty(document, "styleSheets", {
      configurable: true,
      value: [linked, inline.sheet, foreign, missingSheet, unreadable, offline]
    });

    serves(linked.href, { text: ".b{background:url(pic.png)}@media print{.b{color:#000}}" });
    serves(offline.href, { offline: true });

    const { article } = pageWith(block("p", 100));
    const built = await Snapshot.build({ title: "Notes", article });

    /* A rule's url(...) is relative to the stylesheet it is written in, not
     * to the page — so a sheet that moves has to take its references with it.
     */
    check("a linked sheet's relative url is made absolute against the sheet",
      built.styles.includes('url("https://docs.example/css/pic.png")'), true);
    check("...and an inline sheet is read where it is", built.styles.includes(".a"), true);

    /* The app's print rules exist to make a document readable on paper: they
     * invert the dark palette and drop the backgrounds. That is right for
     * File > Print and wrong for an export, whose whole job is to look like
     * the screen.
     */
    /* The export has print rules of its own, for the paper. What must not
      * survive is the app's: `.a{color:black}` and `.b{color:#000}` were both
      * inside one.
      */
     check("neither one brings the app's print rules",
       [built.styles.includes("color:black"), built.styles.includes("color:#000")], [false, false]);

    // Best-effort, and said out loud: a file with holes in it and no
    // explanation is worse than a short list of what is not in it.
    check("a sheet that cannot be fetched is reported rather than fatal",
      built.missing.includes(missingSheet.href), true);
    check("...as is one whose rules this origin may not read",
      built.missing.includes(foreign.href), true);
    check("...and one the network dropped halfway",
      built.missing.includes(offline.href), true);
    // Nothing to name but what it is.
    check("...while a style block with no address is named for what it is",
      built.missing.includes("an inline stylesheet"), true);
    check("...and the rest of the export is built anyway",
      built.html.startsWith("<!DOCTYPE html>"), true);
  }

  console.log("=== the fonts, and the ones not worth carrying ===");
  {
    const face = (family, url, range) => `@font-face{font-family:${family};`
      + `src:url(${url}) format("woff2");`
      + (range ? `unicode-range:${range};` : "") + "}";

    const latin = "https://fonts.example/inter-latin.woff2";
    const cyrillic = "https://fonts.example/inter-cyrillic.woff2";
    const icons = "https://fonts.example/phosphor.woff2";
    const huge = "https://fonts.example/fat.woff2";

    serves(latin, { bytes: "LATIN", type: "font/woff2" });
    serves(cyrillic, { bytes: "CYRIL", type: "font/woff2" });
    serves(icons, { bytes: "ICONS", type: "font/woff2" });
    serves(huge, { bytes: "F".repeat(64), type: "font/woff2" });

    const sheet = [
      face("Inter", latin, "U+0000-00FF"),
      face("Inter", cyrillic, "U+0400-045F"),
      face("Phosphor", icons),
      "@font-face{font-family:Old;src:url(old.eot)}"
    ].join("");

    const budget = { left: 1024 };
    const embedded = await Snapshot.embedFonts(sheet, budget);

    /* A stylesheet that points at fonts.gstatic.com is a document that looks
     * right until it is opened on a train.
     */
    check("a latin face is carried inside the file",
      embedded.includes('url("data:font/woff2;base64,TEFUSU4=") format("woff2")'), true);

    /* A webfont is delivered as dozens of subsets — Greek, Cyrillic, a dozen
     * slices of Latin Extended — and carrying all of them made a four
     * megabyte export out of a document containing none of those letters.
     */
    check("...and a subset the document has no letters from keeps its URL",
      embedded.includes(`url(${cyrillic})`), true);
    // Icons are chrome. The document has none in it and it is the largest
    // single file on the page.
    check("...the icon font is left behind", embedded.includes(`url(${icons})`), true);
    check("...and a face with no woff2 is left exactly as it was",
      embedded.includes("url(old.eot)"), true);
    check("everything between the faces is kept", embedded.includes("font-family:Old"), true);
    check("a stylesheet with no faces in it comes back untouched",
      await Snapshot.embedFonts(".a{color:red}", budget), ".a{color:red}");

    check("the budget is spent as the faces are carried", budget.left, 1024 - 5);

    /* Past the budget an export is a download nobody wants and a tab that
     * stops responding while it is made, so the file keeps its URL and the
     * caller is told.
     */
    const tight = { left: 10 };
    const over = await Snapshot.embedFonts(face("Fat", huge, "U+0000-00FF"), tight);
    check("a font that would not fit the budget keeps its URL",
      over.includes(`url(${huge})`), true);
    check("...and nothing is taken off the budget for it", tight.left, 10);

    serves(latin, { offline: true });
    const lost = await Snapshot.embedFonts(face("Inter", latin, "U+0000-00FF"), { left: 1024 });
    check("a font the network would not give up keeps its URL too",
      lost.includes(`url(${latin})`), true);

    const gone = "https://fonts.example/moved.woff2";
    const moved = await Snapshot.embedFonts(face("Inter", gone, "U+0000-00FF"), { left: 1024 });
    check("...as does one that is simply not there any more",
      moved.includes(`url(${gone})`), true);
    /* And that one is not reported. A font that 404s is a stylesheet out of
     * date with its CDN, which the reader of the export can do nothing about
     * and which costs them nothing — the text is set in the fallback.
     */
    check("...without troubling the reader about it",
      (await Snapshot.build({ title: "x", article: pageWith(block("p", 10)).article }))
        .missing.includes(gone), false);
    serves(latin, { bytes: "LATIN", type: "font/woff2" });

    // And a file that arrived but could not be read back out. One font
    // missing is a document in the fallback face, which is a document.
    const unreadableFont = "https://fonts.example/unreadable.woff2";
    serves(unreadableFont, { bytes: "WHAT", type: "font/unreadable" });
    const refused = await Snapshot.embedFonts(
      face("Inter", unreadableFont, "U+0000-00FF"), { left: 1024 });
    check("a font that arrives but will not be read keeps its URL",
      refused.includes(`url(${unreadableFont})`), true);
  }

  console.log("=== the pictures, carried rather than pointed at ===");
  {
    const here = "https://docs.example/notes/cat.png";
    serves(here, { bytes: "CAT" });

    const body = block("div", 200,
      '<img src="cat.png"><img src="data:image/gif;base64,R0lG"><img src="">'
      + '<svg><image href="cat.png"/><image xlink:href="cat.png"/>'
      + '<image href="data:image/gif;base64,R0lG"/><image/></svg>');

    const { article } = pageWith(body);
    const built = await Snapshot.build({ title: "Pictures", article });

    const copied = built.html.match(/<img[^>]*>/g) || [];
    check("a relative src is resolved against the page and carried",
      copied.some((tag) => tag.includes("data:image/png;base64,Q0FU")), true);
    check("...a src that is already data stays as it was",
      copied.some((tag) => tag.includes("data:image/gif;base64,R0lG")), true);
    check("...and one with no src is left alone",
      copied.some((tag) => tag.includes('src=""')), true);

    /* An <image> inside an SVG is the same problem in a different spelling,
     * and it has two of them: href, and the xlink:href that older renderers
     * wrote.
     */
    const inside = built.html.match(/<image[^>]*>/g) || [];
    check("an SVG's image is carried as well",
      inside.filter((tag) => tag.includes("base64,Q0FU")).length, 2);
    check("...and the old spelling is dropped once the new one is right",
      built.html.includes("xlink:href"), false);

    // The page the document was read at, not the document's own URL — a
    // relative src means the same thing in a copy as it did on the page.
    check("the picture was asked for where the page would have asked for it",
      asked.includes(here), true);
  }

  console.log("=== what is no business of a copy ===");
  {
    const live = document.createElement("article");
    live.innerHTML = [
      '<pre><button class="code-copy">Copy</button>code</pre>',
      '<div class="mermaid-block"><button class="svg-pan-zoom-control"></button></div>',
      '<div class="notebook-run-bar"></div>',
      '<script>alert(1)</script>',
      '<div data-export="skip">a sidebar</div>',
      '<img src="data:image/gif;base64,R0lG" loading="lazy">',
      '<span class="katex"><span class="katex-mathml">x squared</span><span class="katex-html">x²</span></span>'
    ].join("");

    const { article } = pageWith(sized(live, 300));
    const built = await Snapshot.build({ title: "Live parts", article });

    /* A copy button copies to a clipboard the file does not have, a pan-zoom
     * control pans a diagram nobody can drag, and a lazy image that never
     * loaded is a broken one.
     */
    check("the copy button is not in the copy", built.html.includes("code-copy"), false);
    check("...nor the pan-zoom controls", built.html.includes("svg-pan-zoom-control"), false);
    check("...nor the notebook's run bar", built.html.includes("notebook-run-bar"), false);
    check("...nor a script", built.html.includes("alert(1)"), false);
    check("...nor anything marked as not for export", built.html.includes("a sidebar"), false);
    check("...and an image is not asked to load lazily in a file",
      built.html.includes("loading="), false);
    check("the code itself is still there", built.html.includes(">code<"), true);

    /* KaTeX writes every formula twice: once as MathML for a screen reader
     * and once as the spans that are shown, with the first hidden by a clip
     * rectangle. Only Word ignores the clip and renders both, so only Word's
     * copy loses the one that is not shown.
     */
    check("a reader's copy of a formula is kept for a normal export",
      built.html.includes("x squared"), true);
    const forWord = await Snapshot.build({ title: "Live parts", article, forWord: true });
    check("...and dropped for the one Word reads", forWord.html.includes("x squared"), false);
    check("...while the formula that is shown stays", forWord.html.includes("x²"), true);
  }

  console.log("=== a diagram becomes a picture of itself ===");
  {
    /* Mermaid draws without a viewBox, so the SVG's box is a window onto the
     * drawing rather than a frame around it — making the box smaller crops
     * the picture instead of shrinking it. Giving it the viewBox it never had
     * is what turns the one into the other.
     */
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-block";
    wrapper.style.aspectRatio = "4 / 3";
    const drawing = svgIn(wrapper, { x: 5, y: 7, width: 640, height: 480 });
    drawing.setAttribute("aria-roledescription", "flowchart");
    const control = document.createElementNS(SVG_NS, "g");
    control.setAttribute("class", "svg-pan-zoom-control");
    drawing.appendChild(control);

    const { article } = pageWith(sized(wrapper, 480));
    const built = await Snapshot.build({ title: "A diagram", article, paged: true });

    check("the drawing is replaced by one picture of it",
      built.html.includes("<img") && !built.html.includes("<svg"), true);
    check("...described the way the diagram described itself",
      built.html.includes('alt="flowchart"'), true);
    check("...drawn at twice the size it is shown at, so paper is not soft",
      built.html.includes(`base64,${"P".repeat(1280)}`), true);
    check("...and the controls that pan it are not in the picture",
      built.html.includes("svg-pan-zoom-control"), false);

    /* The box stops deciding the height and the picture starts: the ratio and
     * the clamp are both for a window, and here the picture is already drawn
     * and its own proportions are the right ones.
     */
    check("the box stops deciding the diagram's shape",
      /aspect-ratio:\s*auto/.test(built.html) && /max-height:\s*none/.test(built.html), true);
    check("...and is no wider than the drawing plus its frame",
      built.html.includes("max-width: 666px"), true);

    // An SVG that is not laid out has no bounds to give, and the box it sits
    // in is the fallback.
    const unmeasured = document.createElement("div");
    unmeasured.className = "mermaid-block";
    const flat = svgIn(unmeasured, null, 300);
    flat.style.width = "500px";
    const fallback = pageWith(sized(unmeasured, 300));
    const second = await Snapshot.build({ title: "Unmeasured", article: fallback.article, paged: true });
    check("a drawing that will not say what it covers is measured by its box",
      second.html.includes("<img"), true);

    /* A canvas that has drawn something from another origin will not be read
     * back. The diagram stays as the drawing it is and the caller is told, so
     * that somebody is not handed a file with a hole in it and no
     * explanation.
     */
    tainted = true;
    const refused = await Snapshot.build({ title: "A diagram", article, paged: true });
    check("a diagram the canvas will not give back stays a drawing",
      refused.html.includes("<svg"), true);
    check("...and is named as missing", refused.missing.includes("a diagram"), true);
    tainted = false;

    // And one with neither is left as it is rather than replaced by nothing.
    const nowhere = document.createElement("div");
    nowhere.className = "mermaid-block";
    svgIn(nowhere, null, 0);
    const third = pageWith(sized(nowhere, 0));
    const left = await Snapshot.build({ title: "Nowhere", article: third.article, paged: true });
    check("...and one with no size at all is left as the drawing it is",
      left.html.includes("<svg"), true);
  }

  console.log("=== and a formula does not, unless Word is reading ===");
  {
    const maths = document.createElement("div");
    maths.className = "katex-display";
    const bar = svgIn(maths, { x: 0, y: 0, width: 60, height: 0.4 }, 0.4, 60);
    bar.setAttribute("aria-label", "fraction bar");

    const { article } = pageWith(sized(maths, 40));

    const plain = await Snapshot.build({ title: "Maths", article });
    check("a formula's own hairlines are left where they are",
      plain.html.includes("<svg"), true);

    const forWord = await Snapshot.build({ title: "Maths", article, forWord: true });
    check("...and drawn as pictures for the importer that drops them",
      forWord.html.includes("<img") && !forWord.html.includes("<svg"), true);
    check("...labelled as the diagram said", forWord.html.includes('alt="fraction bar"'), true);

    /* At least a pixel each way. KaTeX draws a fraction bar as an SVG a
     * sixtieth of an em tall, which rounds to nothing and would be dropped as
     * unmeasurable — taking the bar out of the fraction.
     */
    check("...and a hairline too thin to measure is still a pixel tall",
      forWord.html.includes('height="1"'), true);

    /* An SVG with no box on screen is given no size to draw at, and is left
     * as it is rather than drawn at nothing: a formula inside a collapsed
     * details element is still a formula when the reader opens it.
     */
    const hidden = document.createElement("div");
    hidden.className = "katex-display";
    svgIn(hidden, { x: 0, y: 0, width: 60, height: 10 }, 0, 0);
    const unseen = pageWith(sized(hidden, 0));
    check("a drawing with no box on screen is not drawn at nothing",
      (await Snapshot.build({ title: "Hidden", article: unseen.article, forWord: true }))
        .html.includes("<svg"), true);

    // The measurements were for the rasteriser's benefit and are nobody
    // else's business.
    check("the sizes the rasteriser was given are not left in the file",
      plain.html.includes("data-export-w"), false);

    /* A tainted canvas will not be read back, and one picture missing is
     * better than an export that does not happen.
     */
    tainted = true;
    const refused = await Snapshot.build({ title: "Maths", article, forWord: true });
    check("a canvas that will not be read back leaves the drawing alone",
      refused.html.includes("<svg"), true);
    check("...and says a diagram is missing", refused.missing.includes("a diagram"), true);
    tainted = false;

    // And an image that will not load at all is the same answer by a
    // different route.
    unloadable = "svg+xml";
    const broken = await Snapshot.build({ title: "Maths", article, forWord: true });
    check("a picture that will not load leaves the drawing alone too",
      broken.html.includes("<svg"), true);
    unloadable = "";
  }

  console.log("=== the ink, carried as it was drawn ===");
  {
    const ink = inkLayer({ x: 40, y: 60, width: 900, height: 2400 });
    const { surface, article } = pageWith(
      block("h1", 80), block("p", 400), block("p", 400), block("h2", 60), block("p", 900)
    );

    const built = await Snapshot.build({ title: "Annotated", article, surface, ink, paged: true });

    check("the ink layer comes across", built.html.includes('class="export-ink"'), true);
    check("...sized to the surface it was drawn on rather than to the words",
      built.html.includes(`viewBox="0 0 1200 ${built.box.surfaceHeight}"`), true);

    /* Each sheet shows its own slice of the layer, by moving it up by however
     * far down the document that sheet starts. A sheet the ink does not reach
     * is given no copy of it: carrying the whole layer onto all twenty-five
     * pages of a long document made a hundred megabytes of a three megabyte
     * file.
     */
    const slices = (built.html.match(/class="export-sheet-ink"/g) || []).length;
    check("every sheet the ink reaches gets a slice of it", slices > 0, true);
    check("...and not one sheet more", slices <= built.sheets.length, true);

    /* A layer whose strokes measure as nothing is carried — a stroke is a
      * stroke — but the box says there is no ink on the document, so the
      * sheets are not given slices of it and nothing is laid over the words.
      */
    const unmarked = await Snapshot.build({
      title: "Annotated", article, surface, ink: inkLayer({ x: 0, y: 0, width: 0, height: 0 }), paged: true
    });
    check("a layer whose strokes measure as nothing marks no ink on the page",
      unmarked.box.hasInk, false);
    // So it reaches only the sheet at the top of the document, and the
    // sheets it does not reach are not given a copy of it.
    check("...so only the first sheet is given a slice of it",
      [(unmarked.html.match(/class="export-sheet-ink"/g) || []).length,
        unmarked.sheets.length > 1], [1, true]);

    const blank = document.createElementNS(SVG_NS, "svg");
    const nothing = await Snapshot.build({ title: "Annotated", article, surface, ink: blank, paged: true });
    check("a layer with no strokes in it is no ink at all",
      nothing.html.includes('class="export-ink"'), false);

    /* For the formats that are pictures the layer becomes one: an SVG like
     * any other, and it would go the same way as the diagrams, which would be
     * the whole point of the export missing.
     */
    const forWord = await Snapshot.build({ title: "Annotated", article, surface, ink, forWord: true });
    check("the ink is a picture for the format that cannot read an SVG",
      [forWord.html.includes('class="export-ink"'), forWord.html.includes("<svg")], [true, false]);

    check("the sheets come back as elements, for whoever draws the PDF",
      built.sheets.length, (built.html.match(/class="export-sheet"/g) || []).length);
    // The offset each sheet was built from was the ink's business and is not
    // left in the file.
    check("...with the offset they were cut at left behind",
      built.html.includes("data-doc-top"), false);
  }

  console.log("=== and the file it all goes into ===");
  {
    document.documentElement.setAttribute("data-theme", "light");
    const { surface, article } = pageWith(block("p", 300));
    const built = await Snapshot.build({ title: 'Notes & "things" <b>', article, surface });

    check("the file is a document", built.html.startsWith("<!DOCTYPE html>\n<html lang=\"en\""), true);
    check("...in the theme it was read in", built.html.includes('data-theme="light"'), true);
    check("...with the title escaped rather than inserted",
      built.html.includes("<title>Notes &amp; \"things\" &lt;b&gt;</title>"), true);
    check("...and one page in it, not a stack of sheets",
      [built.html.includes("export-page"), built.html.includes("export-sheet")], [true, false]);
    check("an unpaged export has no sheets to hand back", built.sheets, null);

    // A4 in pixels, which is the paper whatever width the document was read
    // at — the picture is simply stretched into it.
    check("the paper is A4 however wide the document was",
      [Math.round(built.paper.width), Math.round(built.paper.height)], [794, 1123]);
    check("...and the sheet is sized for that paper too",
      [Math.round(built.size.width), Math.round(built.size.height)], [794, 1123]);
    check("...carrying the page's own background, for the paper's edges",
      typeof built.size.background, "string");
    check("the box it was all measured in comes back with it", built.box.bodyWidth, 800);
    document.documentElement.removeAttribute("data-theme");
    check("a page with no theme on it is taken as the dark one",
      (await Snapshot.build({ title: "x", article })).html.includes('data-theme="dark"'), true);
  }
};
