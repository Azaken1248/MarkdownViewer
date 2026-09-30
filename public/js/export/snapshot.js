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

  function svgAsPng(svg, width, height) {
    const drawable = /** @type {SVGElement} */ (svg.cloneNode(true));
    drawable.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    drawable.setAttribute("width", String(width));
    drawable.setAttribute("height", String(height));

    const source = new XMLSerializer().serializeToString(drawable);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

    return new Promise((resolve) => {
      const picture = new Image();

      picture.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width * PIXEL_RATIO;
          canvas.height = height * PIXEL_RATIO;
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
  function geometryOf(article, surface) {
    const page = (surface || article).getBoundingClientRect();
    const body = article.getBoundingClientRect();

    return {
      width: Math.round(page.width),
      height: Math.round(Math.max(page.height, body.height)),
      inset: Math.round(body.left - page.left),
      bodyWidth: Math.round(body.width)
    };
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

/* Laid over the document at the size it was drawn at, and not interactive:
   it is a picture of some ink now. */
.export-ink {
  position: absolute;
  left: 0;
  top: 0;
  width: ${box.width}px;
  height: ${box.height}px;
  pointer-events: none;
}

@media print {
  /* A sheet the width of the page, so nothing reflows and the ink stays on
     the words it was drawn over. The height is that width in A4's
     proportions, which is what makes the result look like a document rather
     than like a screenshot of one. */
  @page {
    size: ${box.width}px ${Math.round(box.width * 1.414)}px;
    margin: 0;
  }

  .export-page {
    min-height: 0;
  }

  /* The things that are unreadable when a page break lands in the middle of
     them. Ink cannot be kept off a break — it is one picture over the whole
     document — but everything under it can. */
  .markdown-body pre,
  .markdown-body blockquote,
  .markdown-body tr,
  .markdown-body img,
  .markdown-body .katex-display,
  .markdown-body .mermaid-block {
    break-inside: avoid;
  }

  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3,
  .markdown-body h4 {
    break-after: avoid;
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

  /* One HTML file that is the page.
   *
   * `article` is the rendered document, `surface` the box the ink was drawn
   * over (the whole page, margins included) and `ink` the layer itself. A
   * workspace document has no ink and no surface, and is simply the article
   * at the width it is being read at.
   */
  async function build({ title, article, surface = null, ink = null, forWord = false }) {
    failed.length = 0;
    const budget = { left: MAX_EMBEDDED_BYTES };
    const theme = document.documentElement.getAttribute("data-theme") || "dark";
    const box = geometryOf(article, surface);

    const copy = /** @type {HTMLElement} */ (article.cloneNode(true));
    recordSvgSizes(article, copy);
    stripLiveParts(copy);
    await embedImages(copy, budget);

    if (forWord) {
      dropHiddenMath(copy);
      await flattenSvg(copy, budget);
    }

    forgetSvgSizes(copy);

    let drawn = "";
    if (ink && ink.querySelector("path, circle, g")) {
      const inkCopy = /** @type {SVGElement} */ (ink.cloneNode(true));
      inkCopy.setAttribute("class", "export-ink");
      inkCopy.removeAttribute("style");
      inkCopy.setAttribute("width", String(box.width));
      inkCopy.setAttribute("height", String(box.height));
      inkCopy.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      await embedImages(inkCopy, budget);

      if (forWord) {
        // The ink is an SVG like any other, and Word would drop it with the
        // rest — which would be the whole point of the export missing.
        inkCopy.dataset.exportW = String(box.width);
        inkCopy.dataset.exportH = String(box.height);
        const holder = document.createElement("div");
        holder.appendChild(inkCopy);
        await flattenSvg(holder, budget);
        const picture = holder.firstElementChild;
        picture.setAttribute("class", "export-ink");
        drawn = picture.outerHTML;
      } else {
        drawn = inkCopy.outerHTML;
      }
    }

    const styles = await collectStyles(budget);

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
</head>
<body>
<div class="export-page">
<div class="export-doc">
${copy.outerHTML}
</div>
${drawn}
</div>
</body>
</html>
`,
      // What could not be carried, so the caller can say so rather than
      // handing somebody a file with holes in it and no explanation.
      missing: failed.slice(),
      box
    };
  }

  return {
    build,
    absoluteUrls,
    worthEmbedding,
    embedFonts,
    geometryOf,
    pageStyles,
    dropHiddenMath,
    recordSvgSizes,
    forgetSvgSizes,
    withoutPrintRules,
    MAX_EMBEDDED_BYTES
  };
})();
