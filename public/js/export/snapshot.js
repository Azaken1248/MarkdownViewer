/* The page, taken whole.
 *
 * Every export is made from one thing: a single HTML file that renders the
 * document exactly as the browser has it on screen — the same stylesheets,
 * the same theme, the same fonts, the same already-rendered maths and
 * diagrams, and the ink drawn over the top of it.
 *
 * It is built from the live DOM rather than from the markdown, because the
 * markdown is not what anybody is looking at. Formulas have been laid out by
 * KaTeX, diagrams are SVG that Mermaid drew, code has been coloured, and
 * none of that can be recovered by parsing the source again — a second
 * rendering would be a second opinion about what the document looks like.
 *
 * Self-contained, because a file that needs the site it came from is not a
 * copy of anything: stylesheets are inlined, fonts are fetched and embedded,
 * and images become data URIs.
 */

/* exported ExportSnapshot */
var ExportSnapshot = (function () {
  "use strict";

  /* The app's own print rules are taken out.
   *
   * They exist to make a document readable on paper: they invert the dark
   * palette, drop the backgrounds and strip the colour out of code. That is
   * the right answer for File > Print and the wrong one here, where the whole
   * ask is that the export looks like the screen — and it is not enough to
   * skip print.css, because on a built page every stylesheet has been
   * concatenated into one. So the rules are found and removed wherever they
   * are, and the export writes its own.
   */
  function withoutPrintRules(css) {
    const finder = /@media[^{]*\bprint\b[^{]*{/gi;
    let out = "";
    let at = 0;
    let found = finder.exec(css);

    while (found) {
      out += css.slice(at, found.index);
      at = endOfBlock(css, found.index + found[0].length);
      finder.lastIndex = at;
      found = finder.exec(css);
    }

    return out + css.slice(at);
  }

  /* Where the block that has just been opened closes.
   *
   * Quoted strings are stepped over rather than scanned, because `content:
   * "}"` is legal and would otherwise end the block early and take the rest
   * of the stylesheet with it.
   */
  function endOfBlock(css, from) {
    let depth = 1;
    let at = from;

    while (at < css.length && depth > 0) {
      const ch = css[at];

      if (ch === "\"" || ch === "'") {
        at = endOfString(css, at);
        continue;
      }

      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
      }

      at += 1;
    }

    return at;
  }

  function endOfString(css, from) {
    const quote = css[from];
    let at = from + 1;

    while (at < css.length) {
      if (css[at] === "\\") {
        at += 2;
        continue;
      }

      if (css[at] === quote) {
        return at + 1;
      }

      at += 1;
    }

    return at;
  }

  // Fonts come in several formats in the same @font-face; only one of them is
  // worth embedding, and woff2 is the one every browser of the last decade
  // reads and the smallest of them by some margin.
  const WOFF2 = /url\((['"]?)([^)'"]+\.woff2[^)'"]*)\1\)[^,;]*/i;

  // Enough for a document's worth of fonts and pictures; past it, an export is
  // a download nobody wants and a tab that stops responding while it is made.
  const MAX_EMBEDDED_BYTES = 12 * 1024 * 1024;

  const failed = [];

  /* --- Fetching ------------------------------------------------------------
   *
   * Everything here is best-effort. An export that refuses to happen because
   * one background image would not load is worse than an export with one
   * background image missing, so each failure is noted and the rest goes on.
   */
  async function textAt(url) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  }

  async function dataUriAt(url, budget) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) {
        return null;
      }

      const blob = await response.blob();
      if (blob.size > budget.left) {
        failed.push(url);
        return null;
      }

      budget.left -= blob.size;
      return await asDataUri(blob);
    } catch {
      failed.push(url);
      return null;
    }
  }

  function asDataUri(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  /* --- Stylesheets --------------------------------------------------------- */

  // A rule's url(...) is relative to the stylesheet it is written in, not to
  // the page — so a sheet that moves has to take its references with it.
  function absoluteUrls(css, base) {
    return css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (whole, quote, href) => {
      if (/^(data:|https?:|#)/i.test(href)) {
        return whole;
      }

      try {
        return `url("${new URL(href, base).href}")`;
      } catch {
        return whole;
      }
    });
  }

  async function sheetText(sheet) {
    if (sheet.href) {
      const css = await textAt(sheet.href);
      return css === null ? null : absoluteUrls(css, sheet.href);
    }

    // A <style> block, which is already same-origin by definition.
    try {
      return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    } catch {
      return null;
    }
  }

  async function collectStyles(budget) {
    const parts = [];

    for (const sheet of document.styleSheets) {
      const href = sheet.href || "";
      const css = await sheetText(sheet);
      if (css === null) {
        failed.push(href || "an inline stylesheet");
        continue;
      }

      parts.push(await embedFonts(withoutPrintRules(css), budget));
    }

    return parts.join("\n\n");
  }

  /* The font files themselves, carried along.
   *
   * A stylesheet that points at fonts.gstatic.com is a document that looks
   * right until it is opened on a train. Each face keeps its woff2 and loses
   * the rest, which is both the smallest and the only one worth having.
   *
   * Not every face, though. A webfont is delivered as dozens of subsets —
   * Greek, Cyrillic, Vietnamese, a dozen slices of Latin Extended — and
   * carrying all of them made a four megabyte export out of a document
   * containing none of those letters, and took the tab down with it while
   * building the string. Only the Latin subsets are embedded; the rest keep
   * the absolute URL they were rewritten to and load from the CDN on the rare
   * document that needs them.
   */
  const LATIN_FACE = /U\+0000-00FF/i;

  // Icons are chrome. The document itself has none in it, and the icon font is
  // the largest single file on the page.
  const ICON_FAMILY = /font-family:[^;}]*phosphor/i;

  function worthEmbedding(face) {
    if (ICON_FAMILY.test(face)) {
      return false;
    }

    const range = face.match(/unicode-range:([^;}]+)/i);
    return !range || LATIN_FACE.test(range[1]);
  }

  /* Rebuilt in one pass rather than replaced face by face.
   *
   * Sixty `String.replace` calls over a stylesheet that is growing by a
   * hundred kilobytes of base64 each time is sixty copies of a megabyte
   * string, and that is what ran the tab out of memory rather than the fonts
   * themselves.
   */
  async function embedFonts(css, budget) {
    const faces = [...css.matchAll(/@font-face\s*{[^}]*}/gi)];
    if (faces.length === 0) {
      return css;
    }

    const embedded = await Promise.all(faces.map(async (found) => {
      const face = found[0];
      const source = face.match(WOFF2);
      if (!source || !worthEmbedding(face)) {
        return face;
      }

      const data = await dataUriAt(source[2], budget);
      return data ? face.replace(source[0], `url("${data}") format("woff2")`) : face;
    }));

    const out = [];
    let at = 0;
    faces.forEach((found, index) => {
      out.push(css.slice(at, found.index), embedded[index]);
      at = found.index + found[0].length;
    });

    out.push(css.slice(at));
    return out.join("");
  }

  /* --- The document itself ------------------------------------------------- */

  /* Pictures, carried rather than pointed at.
   *
   * Everything else in the page is text by the time it gets here — Mermaid
   * draws SVG, KaTeX lays out spans — so images are the only thing left that
   * lives at a URL.
   */
  async function embedImages(root, budget) {
    for (const image of root.querySelectorAll("img")) {
      const src = image.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) {
        continue;
      }

      const data = await dataUriAt(new URL(src, window.location.href).href, budget);
      if (data) {
        image.setAttribute("src", data);
      }
    }

    for (const image of root.querySelectorAll("image")) {
      const href = image.getAttribute("href") || image.getAttribute("xlink:href") || "";
      if (!href || href.startsWith("data:")) {
        continue;
      }

      const data = await dataUriAt(new URL(href, window.location.href).href, budget);
      if (data) {
        image.setAttribute("href", data);
        image.removeAttribute("xlink:href");
      }
    }
  }

  /* --- What Word can be given -------------------------------------------
   *
   * Word's HTML importer does not know what an inline <svg> is. It drops it,
   * which is what turns a document full of diagrams into a document full of
   * holes — so for that one format every SVG is drawn to a canvas first and
   * carried as a picture instead. Every other format keeps the vector, which
   * stays sharp at any zoom and is a tenth of the size.
   *
   * The size has to be taken from the live element: a clone is not in any
   * document, so it has no layout and measures zero. It is recorded on the
   * copy before anything is stripped, while the two trees still match.
   */
  function recordSvgSizes(live, copy) {
    const there = live.querySelectorAll("svg");
    const here = copy.querySelectorAll("svg");

    here.forEach((svg, index) => {
      const box = there[index]?.getBoundingClientRect();
      if (box && box.width > 0 && box.height > 0) {
        // At least a pixel each way. KaTeX draws a fraction bar as an SVG a
        // sixtieth of an em tall, which rounds to nothing and would be
        // dropped as unmeasurable — taking the bar out of the fraction.
        svg.dataset.exportW = String(Math.max(1, Math.round(box.width)));
        svg.dataset.exportH = String(Math.max(1, Math.round(box.height)));
      }
    });
  }

  async function flattenSvg(root, budget) {
    for (const svg of [...root.querySelectorAll("svg")]) {
      const width = Number(svg.dataset.exportW || 0);
      const height = Number(svg.dataset.exportH || 0);
      if (!width || !height) {
        continue;
      }

      const png = await svgAsPng(svg, width, height);
      if (!png || png.length > budget.left) {
        failed.push("a diagram");
        continue;
      }

      budget.left -= png.length;
      const picture = document.createElement("img");
      picture.setAttribute("src", png);
      picture.setAttribute("width", String(width));
      picture.setAttribute("height", String(height));
      picture.setAttribute("alt", svg.getAttribute("aria-label") || "Diagram");
      svg.replaceWith(picture);
    }
  }

  // Twice the size it is shown at, so it is not soft when the page it lands
  // on is printed.
  const PIXEL_RATIO = 2;

  function svgAsPng(svg, width, height, viewBox = null) {
    const drawable = /** @type {SVGElement} */ (svg.cloneNode(true));
    drawable.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    // Drawn from the live diagram, which still has the buttons that pan and
    // zoom it. They are not part of the picture any more than a scrollbar is.
    for (const control of drawable.querySelectorAll(".svg-pan-zoom-control")) {
      control.remove();
    }
    drawable.setAttribute("width", String(Math.round(width)));
    drawable.setAttribute("height", String(Math.round(height)));

    if (viewBox && !svg.getAttribute("viewBox")) {
      drawable.setAttribute("viewBox", viewBox);
      drawable.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }

    const source = new XMLSerializer().serializeToString(drawable);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

    return new Promise((resolve) => {
      const picture = new Image();

      picture.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(width * PIXEL_RATIO);
          canvas.height = Math.round(height * PIXEL_RATIO);
          const paper = canvas.getContext("2d");
          paper.drawImage(picture, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          // An SVG that reached outside this origin taints the canvas, and a
          // tainted canvas will not be read back. One picture missing is
          // better than an export that does not happen.
          resolve(null);
        }
      };

      picture.onerror = () => resolve(null);
      picture.src = url;
    });
  }

  /* The document cut into pages, with the ink laid over each of them.
   *
   * The cutting is ExportPaginate's: it measures the document and ends pages
   * at headings, which is the whole reason this is not left to the browser.
   * What is left here is placing the ink, which is held in the coordinates of
   * the surface it was drawn on — so each sheet shows its own slice of it, by
   * moving the layer up by however far down the document that sheet starts.
   */
  function intoSheets(copy, box, size, layer) {
    const sheets = ExportPaginate.intoPages(copy, size);

    if (layer) {
      for (const sheet of sheets) {
        const from = Number(sheet.dataset.docTop || 0);
        if (box.inkTo < from || box.inkFrom > from + size.contentHeight) {
          continue;
        }

        const holder = document.createElement("div");
        holder.className = "export-sheet-ink";
        // Laid out by the element rather than by the stylesheet, so that a
        // sheet measures the same here as it draws there. Taken out of the
        // flow above all: in the flow it pushes the document down the page
        // by the height of the whole ink layer.
        holder.style.cssText = [
          "position: absolute",
          "pointer-events: none",
          "overflow: visible",
          `left: ${size.marginX + box.inkLeft}px`,
          `top: ${size.marginY + box.inkTop - box.docTop - from}px`,
          `width: ${box.surfaceWidth}px`,
          `height: ${box.surfaceHeight}px`
        ].join(";");
        const slice = /** @type {HTMLElement} */ (layer.cloneNode(true));
        slice.style.cssText = "position:absolute;left:0;top:0";
        holder.appendChild(slice);
        sheet.appendChild(holder);
      }
    }

    const pages = document.createElement("div");
    pages.className = "export-pages";
    for (const sheet of sheets) {
      sheet.removeAttribute("data-doc-top");
      pages.appendChild(sheet);
    }

    return { pages, sheets };
  }

  /* --- Diagrams --------------------------------------------------------
   *
   * On screen a diagram is clamped to a fraction of the window, so that a
   * tall one cannot take over the page being read, and whatever does not fit
   * is reached by dragging it. On paper there is no dragging: what is past
   * the edge of the box is gone, which is what cut the big ones in half.
   *
   * Mermaid draws without a viewBox, so the SVG's box is a window onto the
   * drawing rather than a frame around it — making the box smaller crops the
   * picture instead of shrinking it. Giving it the viewBox it never had is
   * what turns the one into the other.
   *
   * Each diagram then becomes a single picture at its own proportions, as
   * wide as the column and no taller than it needs to be. That also settles
   * the other half of it: an SVG inside a foreignObject inside an SVG is a
   * nesting Chrome does not reliably draw, and a flowchart came out as the
   * empty box it was sitting in.
   */
  async function flattenDiagrams(live, copy) {
    const there = live.querySelectorAll(".mermaid-block");
    const here = copy.querySelectorAll(".mermaid-block");

    for (const [index, block] of [...here].entries()) {
      const drawing = there[index]?.querySelector("svg");
      const inside = block.querySelector("svg");
      if (!drawing || !inside) {
        continue;
      }

      await asOnePicture(/** @type {HTMLElement} */ (block), inside, drawing);
    }
  }

  async function asOnePicture(block, inside, drawing) {
    const drawn = boundsOfDrawing(drawing);
    if (!drawn) {
      return;
    }

    const png = await svgAsPng(drawing, drawn.width, drawn.height, drawn.viewBox);
    if (!png) {
      failed.push("a diagram");
      return;
    }

    const picture = document.createElement("img");
    picture.setAttribute("src", png);
    picture.setAttribute("alt", drawing.getAttribute("aria-roledescription") || "Diagram");
    picture.style.cssText = "display:block;width:100%;height:auto";

    inside.replaceWith(picture);

    /* The box stops deciding the height and the picture starts.
     *
     * The ratio and the clamp are both for a window: one holds the space
     * while a diagram renders, the other stops a tall one filling the
     * screen. Here the picture is already drawn and its own proportions are
     * the right ones.
     */
    block.style.aspectRatio = "auto";
    block.style.maxHeight = "none";
    block.style.minHeight = "0";
    block.style.maxWidth = `${Math.round(drawn.width) + 26}px`;
  }

  // What the diagram actually covers, which is not what its box shows: the
  // box is a window onto it.
  function boundsOfDrawing(drawing) {
    try {
      const box = drawing.getBBox();
      if (box.width > 0 && box.height > 0) {
        return {
          width: box.width,
          height: box.height,
          viewBox: [box.x, box.y, box.width, box.height].map(Math.round).join(" ")
        };
      }
    } catch {
      // An SVG that is not laid out has no bounds to give.
    }

    const box = drawing.getBoundingClientRect();
    return box.width > 0 && box.height > 0
      ? { width: box.width, height: box.height, viewBox: null }
      : null;
  }

  // The measurements were for the rasteriser's benefit and are nobody else's
  // business.
  function forgetSvgSizes(root) {
    for (const svg of root.querySelectorAll("[data-export-w]")) {
      delete (/** @type {HTMLElement} */ (svg)).dataset.exportW;
      delete (/** @type {HTMLElement} */ (svg)).dataset.exportH;
    }
  }

  /* KaTeX writes every formula twice: once as MathML for a screen reader and
   * once as the spans that are actually shown, with the first hidden by a
   * clip rectangle. Word ignores the clip and renders both, so every formula
   * arrives doubled and the second one as unreadable source. The copy that is
   * not shown is the one to drop.
   */
  function dropHiddenMath(root) {
    for (const spoken of root.querySelectorAll(".katex-mathml")) {
      spoken.remove();
    }
  }

  /* Nothing that only makes sense while the page is live.
   *
   * A copy button copies to a clipboard the file does not have, a pan-zoom
   * control pans a diagram nobody can drag, and a lazy image that never
   * loaded is a broken one.
   */
  function stripLiveParts(root) {
    const gone = [
      ".code-copy", ".svg-pan-zoom-control", ".notebook-run-bar",
      "script", "[data-export=\"skip\"]"
    ];

    for (const node of root.querySelectorAll(gone.join(","))) {
      node.remove();
    }

    for (const image of root.querySelectorAll("img[loading]")) {
      image.removeAttribute("loading");
    }
  }

  /* --- Geometry ------------------------------------------------------------
   *
   * The ink is drawn at absolute positions over the surface, so it only sits
   * on the right words if the words are laid out at the width they were
   * annotated at. The export is therefore a fixed-width page: the same width
   * as the surface on screen, with the document in the same place inside it.
   */
  /* The box the copy is of.
   *
   * Not the whole page: the document column, grown to take in anything that
   * was drawn outside it. The first version used the surface — the full width
   * of the browser window — which made a sheet a third empty, and on paper
   * that is a document shrunk to fit a margin nobody wrote in.
   */
  const INK_MARGIN = 24;

  function geometryOf(article, surface, ink) {
    const page = (surface || article).getBoundingClientRect();
    const body = article.getBoundingClientRect();

    // Everything is measured from the surface's top-left, which is the origin
    // the ink's own coordinates are in.
    let left = body.left - page.left;
    let top = body.top - page.top;
    let right = left + body.width;
    let bottom = top + body.height;

    const drawn = inkBounds(ink);
    if (drawn) {
      left = Math.min(left, drawn.x - INK_MARGIN);
      top = Math.min(top, drawn.y - INK_MARGIN);
      right = Math.max(right, drawn.x + drawn.width + INK_MARGIN);
      bottom = Math.max(bottom, drawn.y + drawn.height + INK_MARGIN);
    }

    return {
      width: Math.round(right - left),
      height: Math.round(bottom - top),
      // Where the document sits inside that box, and where the ink layer has
      // to be moved to so its coordinates still land on the same words.
      inset: Math.round((body.left - page.left) - left),
      bodyWidth: Math.round(body.width),
      hasInk: Boolean(drawn),
      // Where the ink starts and stops down the document, so a sheet it does
      // not reach is not given a copy of it. Carrying the whole layer onto
      // all twenty-five pages of a long document made a hundred megabytes of
      // a three megabyte file.
      inkFrom: drawn ? Math.round(drawn.y - (body.top - page.top)) : 0,
      inkTo: drawn ? Math.round((drawn.y + drawn.height) - (body.top - page.top)) : 0,
      // Where the document's own top edge is inside the cropped box: the ink
      // may start above it, and every sheet's ink is offset from here.
      docTop: Math.round((body.top - page.top) - top),
      inkLeft: Math.round(-left),
      inkTop: Math.round(-top),
      surfaceWidth: Math.round(page.width),
      surfaceHeight: Math.round(Math.max(page.height, body.height))
    };
  }

  // What was actually drawn, rather than the layer it was drawn on — which is
  // the size of the whole page whether or not anything is on it.
  function inkBounds(ink) {
    if (!ink || !ink.querySelector("path, circle, g")) {
      return null;
    }

    try {
      const box = ink.getBBox();
      return box.width > 0 && box.height > 0 ? box : null;
    } catch {
      return null;
    }
  }

  /* --- The sheet ----------------------------------------------------------
   *
   * A4, with margins, and the document scaled to fit across it.
   *
   * The first version made the sheet whatever width the page happened to be
   * on screen and gave it no margins at all. That produced a PDF on paper
   * nobody has, with text running into the edge, pages ending wherever the
   * boundary fell, and — because a print dialogue will fit an unusual page
   * box onto real paper however it likes — content cut off at the side.
   *
   * So the page is a page. What keeps the copy faithful is `zoom`: unlike a
   * transform it takes part in layout, so the whole box shrinks together —
   * every line breaks where it broke on screen, every diagram keeps its
   * proportions, and the ink stays over the words it was drawn over. It is
   * only the paper that is a different size.
   */
  const A4_WIDTH_MM = 210;
  const SIDE_MARGIN_MM = 12;
  const TOP_MARGIN_MM = 14;
  const PX_PER_MM = 96 / 25.4;
  const PRINTABLE_PX = (A4_WIDTH_MM - (SIDE_MARGIN_MM * 2)) * PX_PER_MM;

  // Never magnified: a narrow document blown up to fill A4 is a large-print
  // edition of itself, which is not what it looked like.
  const fitToPage = (width) => Math.min(1, Math.round((PRINTABLE_PX / width) * 1000) / 1000);

  /* With ink on it, the page is scaled rather than reflowed.
   *
   * A stroke is at a position, not next to a word, so the moment a line
   * breaks differently the ink is over the wrong thing. `zoom` takes part in
   * layout, so the whole box shrinks together and every line breaks where it
   * broke on screen — it is only the paper that is a different size.
   */
  const inkedPage = (box) => `zoom: ${fitToPage(box.width)};`;

  /* Without ink, it is simply a document, and a document should be set to the
   * page it is printed on.
   *
   * Scaling one of those too made a reading pane the width of somebody's
   * monitor come out at seven point, which is a picture of a document rather
   * than a document. Nothing is positioned over the words, so the words may
   * move.
   */
  const flowedPage = () => "width: auto;";

  const A4_HEIGHT_MM = 297;

  /* The sheet, in the document's own pixels.
   *
   * Everything is sized so that one scale takes the whole sheet to A4: the
   * margins are inside it rather than outside, which is what lets the page's
   * own background run to the edge of the paper instead of stopping at a
   * frame the browser paints in its own grey.
   */
  function sheetGeometry(box) {
    const scale = box.hasInk ? fitToPage(box.width) : 1;
    const px = (mm) => Math.round(((mm * PX_PER_MM) / scale) * 10) / 10;

    return {
      scale,
      sheetWidth: px(A4_WIDTH_MM),
      sheetHeight: px(A4_HEIGHT_MM),
      marginX: px(SIDE_MARGIN_MM),
      marginY: px(TOP_MARGIN_MM),
      contentWidth: px(A4_WIDTH_MM - (SIDE_MARGIN_MM * 2)),
      contentHeight: px(A4_HEIGHT_MM - (TOP_MARGIN_MM * 2)),
      // With ink on it the document keeps the width and the place it had on
      // screen, because that is what the ink was drawn over. Without, it is
      // simply set to the page.
      docWidth: box.hasInk ? box.bodyWidth : px(A4_WIDTH_MM - (SIDE_MARGIN_MM * 2)),
      docInset: box.hasInk ? box.inset : 0
    };
  }

  function sheetStyles(size) {
    return `
/* --- Sheets --------------------------------------------------------------
 *
 * One element per page, at the size of the page, with the margins inside it.
 * The breaks were chosen by measuring the document rather than by letting the
 * browser cut wherever the box filled up, so there is nothing left for it to
 * decide: each sheet is exactly one sheet.
 */
.export-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 24px 0;
}

/* The sheet's size, its padding and its overflow are set on the element
   itself by the paginator, which has to be able to measure one. What is left
   here is what it looks like. */
.export-sheet {
  background: var(--canvas);
}

/* The space above a heading belongs between it and what came before, not at
   the top of a page. */
.export-sheet-body > :first-child {
  margin-top: 0 !important;
}

/* A block too tall for any page, shrunk until it fits one. */
.export-shrunk {
  display: block;
}

/* Each sheet carries its own slice of the ink. The layer inside is placed by
   the holder and does nothing of its own. */
.export-sheet-ink {
  position: absolute;
  pointer-events: none;
  overflow: visible;
}

.export-sheet-ink > * {
  position: absolute;
  left: 0;
  top: 0;
}

@media print {
  @page {
    size: A4;
    margin: 0;
  }

  .export-pages {
    display: block;
    gap: 0;
    padding: 0;
  }

  /* The sheet is A4 the moment it is scaled, and it is the whole page: no
     browser margin, so the background reaches the edge of the paper. */
  .export-sheet {
    zoom: ${size.scale};
    margin: 0;
    break-after: page;
    break-inside: avoid;
  }

  .export-sheet:last-child {
    break-after: auto;
  }
}
`;
  }

  function pageStyles(box, theme) {
    return `
/* --- The export's own layout ------------------------------------------- */

html, body {
  margin: 0;
  padding: 0;
  height: auto;
  overflow: visible;
  background: var(--canvas);
}

/* Every colour as the screen has it, including the ones a printer would
   rather not: the whole point of this file is that it looks like the page it
   came from. */
*, *::before, *::after {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.export-page {
  position: relative;
  width: ${box.width}px;
  min-height: ${box.height}px;
  margin: 0 auto;
  background: var(--canvas);
}

.export-doc {
  margin-left: ${box.inset}px;
  width: ${box.bodyWidth}px;
}


/* The layer is still the size of the surface it was drawn on; it is moved so
   that the part of it over this document is the part that shows.

   Scoped to the continuous layout: on a sheet it is the sheet that places the
   ink, and a layer that moved itself as well would be moved twice. */
.export-page > .export-ink {
  position: absolute;
  left: ${box.inkLeft}px;
  top: ${box.inkTop}px;
  width: ${box.surfaceWidth}px;
  height: ${box.surfaceHeight}px;
  pointer-events: none;
}

@media print {
  ${box.hasInk ? "" : ".export-doc { margin-left: 0; width: auto; }"}

  @page {
    size: A4;
    margin: ${TOP_MARGIN_MM}mm ${SIDE_MARGIN_MM}mm;
  }

  .export-page {
    min-height: 0;
    margin: 0;
    ${box.hasInk ? inkedPage(box) : flowedPage()}
  }

  /* The things that are unreadable when a page break lands in the middle of
     them. */
  .markdown-body pre,
  .markdown-body blockquote,
  .markdown-body tr,
  .markdown-body img,
  .markdown-body figure,
  .markdown-body .katex-display,
  .markdown-body .mermaid-block,
  .markdown-body .notebook-cell {
    break-inside: avoid;
  }

  /* A heading at the foot of a page is a heading for nothing. */
  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3,
  .markdown-body h4,
  .markdown-body h5,
  .markdown-body h6 {
    break-after: avoid;
    break-inside: avoid;
  }

  /* One line of a paragraph stranded on its own is the thing that makes a
     printed document look like it was printed by accident. */
  .markdown-body p,
  .markdown-body li,
  .markdown-body blockquote {
    orphans: 3;
    widows: 3;
  }

  /* A table that runs over says what its columns are on each page. */
  .markdown-body thead {
    display: table-header-group;
  }

  /* A line that introduces something — "Example:", "where" — belongs on the
     same page as the thing it introduces. */
  .markdown-body p:has(+ .katex-display),
  .markdown-body p:has(+ pre),
  .markdown-body p:has(+ table),
  .markdown-body p:has(+ blockquote),
  .markdown-body p:has(+ .mermaid-block) {
    break-after: avoid;
  }

  /* Ink is one picture over the whole document and cannot be kept off a
     break; what it must not do is stop the pages after the first. */
  .export-ink {
    break-inside: auto;
  }
}

/* The theme is not negotiable in a copy: it is whichever one was on screen. */
:root {
  color-scheme: ${theme === "light" ? "light" : "dark"};
}
`;
  }

  /* --- Putting it together ------------------------------------------------- */

  const escapeText = (value) => String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* The document, ready to be laid out.
   *
   * Word and the PDF both end up as pictures, and an inline SVG survives
   * neither: Word's importer does not know what one is, and a page of the
   * PDF is drawn by rendering the sheet inside a foreignObject — an SVG
   * inside a foreignObject inside an SVG is a nesting Chrome does not
   * reliably draw, and a flowchart came out as the empty box it sat in.
   *
   * Only Word needs every last one of them turned into a picture, though.
   * Its importer drops the hairline rules KaTeX draws a fraction bar with
   * too, and there are a hundred of those in a page of maths; the PDF draws
   * those perfectly well where they are, and doing them one at a time took
   * an export of these notes from eight seconds to fifty.
   */
  async function copyOf(article, budget, { forWord, paged }) {
    const copy = /** @type {HTMLElement} */ (article.cloneNode(true));
    recordSvgSizes(article, copy);
    stripLiveParts(copy);
    await embedImages(copy, budget);

    if (forWord || paged) {
      await flattenDiagrams(article, copy);
    }

    if (forWord) {
      dropHiddenMath(copy);
      await flattenSvg(copy, budget);
    }

    forgetSvgSizes(copy);
    return copy;
  }

  /* The ink, carried across as it was drawn.
   *
   * The layer keeps the size of the surface it was drawn on and is moved
   * rather than redrawn, because a stroke's coordinates mean what they meant.
   * For the formats that are pictures it becomes one: an SVG like any other,
   * and it would go the same way as the diagrams, which would be the whole
   * point of the export missing.
   */
  async function carriedInk(ink, box, budget, asPicture) {
    if (!ink || !ink.querySelector("path, circle, g")) {
      return null;
    }

    const layer = /** @type {SVGElement} */ (ink.cloneNode(true));
    layer.setAttribute("class", "export-ink");
    layer.removeAttribute("style");
    layer.setAttribute("width", String(box.surfaceWidth));
    layer.setAttribute("height", String(box.surfaceHeight));
    layer.setAttribute("viewBox", `0 0 ${box.surfaceWidth} ${box.surfaceHeight}`);
    await embedImages(layer, budget);

    if (!asPicture) {
      return layer;
    }

    layer.dataset.exportW = String(box.surfaceWidth);
    layer.dataset.exportH = String(box.surfaceHeight);

    const holder = document.createElement("div");
    holder.appendChild(layer);
    await flattenSvg(holder, budget);

    const picture = holder.firstElementChild;
    picture.setAttribute("class", "export-ink");
    return picture;
  }

  /* One HTML file that is the page.
   *
   * `article` is the rendered document, `surface` the box the ink was drawn
   * over (the whole page, margins included) and `ink` the layer itself. A
   * workspace document has no ink and no surface, and is simply the article
   * at the width it is being read at.
   */
  async function build({ title, article, surface = null, ink = null, forWord = false, paged = false }) {
    failed.length = 0;
    const budget = { left: MAX_EMBEDDED_BYTES };
    const theme = document.documentElement.getAttribute("data-theme") || "dark";
    const box = geometryOf(article, surface, ink);

    const copy = await copyOf(article, budget, { forWord, paged });

    const inkLayer = await carriedInk(ink, box, budget, forWord);
    const drawn = inkLayer ? inkLayer.outerHTML : "";
    const styles = await collectStyles(budget);
    const size = sheetGeometry(box);
    const cut = paged ? intoSheets(copy, box, size, inkLayer) : null;
    const laidOut = cut
      ? cut.pages.outerHTML
      : `<div class="export-page">
<div class="export-doc">
${copy.outerHTML}
</div>
${drawn}
</div>`;

    return {
      html: `<!DOCTYPE html>
<html lang="en" data-theme="${escapeText(theme)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeText(title)}</title>
<style>
${styles}
</style>
<style>
${pageStyles(box, theme)}
</style>
${paged ? `<style>\n${sheetStyles(size)}\n</style>` : ""}
</head>
<body>
${laidOut}
</body>
</html>
`,
      // What could not be carried, so the caller can say so rather than
      // handing somebody a file with holes in it and no explanation.
      missing: failed.slice(),
      box,
      /* The pages as elements, and everything needed to draw one.
       *
       * The PDF is written here rather than printed, so it needs the sheets
       * themselves — not their markup inside a document it would have to
       * load — and the stylesheet that makes them look like anything.
       */
      sheets: cut ? cut.sheets : null,
      styles: `${styles}\n${pageStyles(box, theme)}\n${paged ? sheetStyles(size) : ""}`,
      size: {
        width: size.sheetWidth,
        height: size.sheetHeight,
        theme,
        background: window.getComputedStyle(document.documentElement).backgroundColor
      },
      /* The paper, which is not the same as the drawing.
       *
       * A sheet with ink on it is laid out at the width the ink was drawn at
       * and may be any number of pixels across; the paper it ends up on is
       * always A4. The picture is simply stretched into it, which is the one
       * place the scale that used to be a `zoom` now lives.
       */
      paper: {
        width: A4_WIDTH_MM * PX_PER_MM,
        height: A4_HEIGHT_MM * PX_PER_MM
      }
    };
  }

  return {
    build,
    absoluteUrls,
    worthEmbedding,
    embedFonts,
    geometryOf,
    pageStyles,
    sheetGeometry,
    sheetStyles,
    fitToPage,
    dropHiddenMath,
    flattenDiagrams,
    boundsOfDrawing,
    recordSvgSizes,
    forgetSvgSizes,
    withoutPrintRules,
    MAX_EMBEDDED_BYTES
  };
})();
