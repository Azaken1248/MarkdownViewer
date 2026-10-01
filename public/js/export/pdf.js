/* A PDF, written here.
 *
 * The browser can make one, but only through the print dialogue, and the
 * dialogue is not ours: it adds its own margins around the margins the pages
 * already carry, scales the sheet down to fit inside them, and leaves a white
 * border round a document whose background is not white. There is no CSS that
 * overrules it, because the setting is the person's rather than the page's.
 *
 * So the file is assembled here instead. Each sheet the paginator produced is
 * drawn to a canvas and becomes one page of a PDF written byte by byte — a
 * header, a handful of objects, a cross-reference table and a trailer, which
 * is all a PDF of pictures is.
 *
 * What that costs is selectable text: a page of this file is an image of a
 * page, so it cannot be searched or read aloud, and the HTML export is the
 * one to keep for that. What it buys is a file that looks exactly like the
 * screen it came from, at the size it is supposed to be, with no dialogue in
 * the way and nothing between the document and the edge of the paper.
 */

/* exported ExportPdf */
var ExportPdf = (function () {
  "use strict";

  // A PDF measures in points: 72 to the inch, where CSS has 96.
  const PT_PER_PX = 72 / 96;

  /* Twice the size the page is laid out at.
   *
   * The pages are pictures, so this is the whole of their resolution. Two is
   * 150dpi against A4, which is sharp on a screen at any zoom somebody reads
   * at and is still a file that can be sent to somebody.
   */
  const SCALE = 2;

  // High enough that the ringing around text is not visible against a flat
  // background, low enough that a long document is not tens of megabytes.
  const QUALITY = 0.92;

  /* --- Writing the file ----------------------------------------------------
   *
   * Objects are numbered from one and written in order, each remembering
   * where it started, because the cross-reference table at the end is a list
   * of those offsets and a reader uses it to find anything at all.
   */
  function writer() {
    const chunks = [];
    const offsets = [0];
    let at = 0;

    const push = (bytes) => {
      chunks.push(bytes);
      at += bytes.length;
    };

    return {
      get length() {
        return at;
      },
      offsets,
      text(string) {
        push(new TextEncoder().encode(string));
      },
      bytes(data) {
        push(data);
      },
      // Returns the object's number, which is how everything refers to it.
      object(body, stream = null) {
        const id = offsets.length;
        offsets.push(at);
        this.text(`${id} 0 obj\n${body}\n`);

        if (stream) {
          this.text("stream\n");
          push(stream);
          this.text("\nendstream\n");
        }

        this.text("endobj\n");
        return id;
      },
      join() {
        const out = new Uint8Array(at);
        let where = 0;
        for (const chunk of chunks) {
          out.set(chunk, where);
          where += chunk.length;
        }

        return out;
      }
    };
  }

  const escapeText = (value) => String(value)
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  /* --- The text over the picture -------------------------------------------
   *
   * A page of this file is a picture of a page, which is exact and cannot be
   * searched, selected, or read aloud. So the words go on it as well, in the
   * one way a PDF has of saying "this text is here but do not draw it": text
   * render mode 3, which is what every scanner puts under an OCR'd page.
   *
   * The glyphs are never drawn, so the font they would be drawn in does not
   * matter and none is embedded. What matters is two things: where each word
   * sits, so that selecting a line selects that line, and what each byte
   * means, which is the ToUnicode map's job and is what a search reads.
   *
   * Identity-H and two bytes a character, because the alternative is a
   * single-byte encoding with 256 places in it and this is a document with
   * Greek, arrows and set theory in it.
   */
  function fontObjects(out) {
    // Every code means the character of the same number: a map of the whole
    // of the basic plane in four lines, rather than an entry per character.
    const cmap = [
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
      "/CMapName /A-UCS2 def /CMapType 2 def",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "1 begincodespacerange <0000> <FFFF> endcodespacerange",
      "1 beginbfrange <0000> <FFFF> <0000> endbfrange",
      "endcmap CMapName currentdict /CMap defineresource pop end end"
    ].join("\n");

    const bytes = new TextEncoder().encode(cmap);
    const toUnicodeId = out.object(`<< /Length ${bytes.length} >>`, bytes);

    // No FontFile: nothing is drawn, so there is nothing to draw it with.
    // The descriptor is here because a strict reader asks for one.
    const descriptorId = out.object([
      "<< /Type /FontDescriptor /FontName /Helvetica /Flags 32",
      "/FontBBox [-166 -225 1000 931] /ItalicAngle 0",
      "/Ascent 718 /Descent -207 /CapHeight 718 /StemV 88 >>"
    ].join(" "));

    const cidId = out.object([
      "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>",
      `/FontDescriptor ${descriptorId} 0 R /DW 1000`,
      "/CIDToGIDMap /Identity >>"
    ].join(" "));

    return out.object([
      "<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H",
      `/DescendantFonts [${cidId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`
    ].join(" "));
  }

  // UTF-16 code units, as the hex a PDF string takes. Characters outside the
  // basic plane arrive as their two surrogates, which is what a reader
  // recombines on the way back out.
  function hexOf(text) {
    let out = "";

    for (const unit of text) {
      for (let at = 0; at < unit.length; at += 1) {
        out += unit.charCodeAt(at).toString(16).padStart(4, "0");
      }
    }

    return out;
  }

  /* One word, placed where the picture shows it.
   *
   * Every glyph of the unembedded font is one em wide, so a word of n
   * characters set at the size it is on the page comes out n ems long and
   * almost never the width of the word underneath. Tz — horizontal scaling —
   * stretches it to exactly that width, which is what makes a selection
   * follow the line rather than run off the end of it.
   */
  function wordAt(run, k, pageHeight) {
    const size = Math.max(1, run.size * k);
    const natural = run.text.length * size;
    const stretch = natural > 0 ? Math.round((run.width * k / natural) * 10000) / 100 : 100;

    return [
      `/F1 ${Math.round(size * 100) / 100} Tf`,
      `${Math.min(1000, Math.max(1, stretch))} Tz`,
      `1 0 0 1 ${Math.round(run.x * k * 100) / 100} `
        + `${Math.round((pageHeight - (run.y * k)) * 100) / 100} Tm`,
      `<${hexOf(run.text)}> Tj`
    ].join(" ");
  }

  function textLayer(runs, k, pageHeight) {
    if (!runs || runs.length === 0) {
      return "";
    }

    // 3 Tr: fill no pixels. The words are there to be found, not seen.
    return `\nBT 3 Tr\n${runs.map((run) => wordAt(run, k, pageHeight)).join("\n")}\nET`;
  }

  /* One page per picture.
   *
   * Each page holds a content stream of four operators: save the graphics
   * state, scale the unit square up to the size of the page, draw the image
   * into it, restore. That is the whole of a page that is one picture.
   */
  function write({ pages, title = "" }) {
    const out = writer();
    out.text("%PDF-1.7\n");
    // A comment of high bytes, which is how a reader is told the file is
    // binary and must not be mangled by anything that thinks it is text.
    out.bytes(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    const catalogId = 1;
    const pagesId = 2;
    out.offsets.push(0, 0);

    const fontId = fontObjects(out);
    const pageIds = [];

    for (const page of pages) {
      const width = Math.round(page.width * PT_PER_PX * 100) / 100;
      const height = Math.round(page.height * PT_PER_PX * 100) / 100;

      const imageId = out.object([
        "<< /Type /XObject /Subtype /Image",
        `/Width ${page.pixelWidth} /Height ${page.pixelHeight}`,
        "/ColorSpace /DeviceRGB /BitsPerComponent 8",
        `/Filter /DCTDecode /Length ${page.bytes.length} >>`
      ].join(" "), page.bytes);

      // The drawing is in the sheet's pixels and the page is in points, so
      // this is what takes one to the other — and the text layer has to be
      // placed with the same number or it will not sit on the words.
      const k = (page.width / (page.drawnWidth || page.width)) * PT_PER_PX;
      const body = new TextEncoder().encode(
        `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q${textLayer(page.runs, k, height)}`);
      const contentId = out.object(`<< /Length ${body.length} >>`, body);

      pageIds.push(out.object([
        `<< /Type /Page /Parent ${pagesId} 0 R`,
        `/MediaBox [0 0 ${width} ${height}]`,
        `/Resources << /XObject << /Im0 ${imageId} 0 R >>`,
        `/Font << /F1 ${fontId} 0 R >> >>`,
        `/Contents ${contentId} 0 R >>`
      ].join(" ")));
    }

    // The catalogue and the page tree were reserved first because every page
    // names the tree as its parent, and are written now that the pages exist.
    out.offsets[catalogId] = out.length;
    out.text(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`);

    out.offsets[pagesId] = out.length;
    out.text(`${pagesId} 0 obj\n<< /Type /Pages /Count ${pageIds.length} `
      + `/Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`);

    const infoId = out.object(`<< /Title (${escapeText(title)}) /Producer (AzaDocs) >>`);

    const startxref = out.length;
    const count = out.offsets.length;
    out.text(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let id = 1; id < count; id += 1) {
      out.text(`${String(out.offsets[id]).padStart(10, "0")} 00000 n \n`);
    }

    out.text(`trailer\n<< /Size ${count} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`);
    out.text(`startxref\n${startxref}\n%%EOF\n`);

    return out.join();
  }

  /* --- Drawing the sheets -------------------------------------------------
   *
   * An SVG holding the sheets in a foreignObject, loaded as an image and
   * drawn to a canvas. The SVG renders on its own — no stylesheet of the page
   * reaches inside it and no URL is fetched from it — which is why the
   * snapshot inlines every rule, every font and every picture before any of
   * this is asked for.
   *
   * Several sheets at a time, because that stylesheet is a couple of megabytes
   * of embedded fonts and the browser parses it once per image: one at a time
   * meant parsing the fonts once per page of the document.
   */
  const MAX_CANVAS = 16384;

  function svgFor(markup, css, size) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" `,
      // The theme goes on the root of this document too. The app's palette is
      // written under `:root[data-theme=...]`, and the root here is the <svg>
      // — without it a page read in the light theme would come out in the
      // dark one, because that is what the fallback is.
      `data-theme="${size.theme || "dark"}" `,
      `viewBox="0 0 ${size.width} ${size.height}">`,
      // Commented as well as wrapped: the XML parser needs the CDATA so that
      // a `>` in a selector is not markup, and the CSS parser needs the
      // comment so that the CDATA is not a rule.
      "<style>/*<![CDATA[*/", css, "/*]]>*/</style>",
      `<foreignObject x="0" y="0" width="${size.width}" height="${size.height}">`,
      markup,
      "</foreignObject></svg>"
    ];
  }

  /* Serialised as XML rather than as HTML.
   *
   * A foreignObject is parsed by the XML parser, which refuses `<br>` and
   * every other unclosed tag that HTML allows. The serialiser closes them.
   */
  /* The typography a document inherits from <body>.
   *
   * There is no body in a foreignObject — the sheets hang off a bare div — so
   * every rule the app writes against `body` reaches nothing, and the text
   * came out in the browser's default serif. Read from the live page rather
   * than restated here, so it stays the same answer as the screen's.
   */
  const INHERITED = [
    "font-family", "font-size", "font-weight", "line-height",
    "color", "letter-spacing", "-webkit-font-smoothing"
  ];

  function bodyRule() {
    const style = window.getComputedStyle(document.body);
    const said = INHERITED
      .map((name) => `${name}:${style.getPropertyValue(name)}`)
      .filter((pair) => !pair.endsWith(":"))
      .join(";");

    return `.export-body{${said}}`;
  }

  function asXml(elements) {
    const holder = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    holder.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    holder.setAttribute("class", "export-body");
    for (const element of elements) {
      holder.appendChild(element.cloneNode(true));
    }

    return new XMLSerializer().serializeToString(holder);
  }

  /* A data URI rather than a blob.
   *
   * A blob URL is same-origin and an image loaded from one is not, as far as
   * a canvas is concerned: drawing an SVG that came from a blob makes the
   * canvas tainted and it will not be read back — "Tainted canvases may not
   * be exported", which is the entire export failing for a reason that has
   * nothing to do with anything. A data URI is treated as part of the
   * document and is clean.
   */
  function pictureOf(parts) {
    const text = parts.join("");
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;

    return new Promise((resolve) => {
      const picture = new Image();
      picture.onload = () => resolve(picture);
      picture.onerror = () => resolve(null);
      picture.src = url;
    });
  }

  // One tall canvas holding a run of sheets, stacked exactly as they are: no
  // gaps, because the gaps belong to looking at them on a screen.
  async function drawRun(sheets, css, size) {
    const tall = {
      width: size.width,
      height: size.height * sheets.length,
      theme: size.theme
    };
    const picture = await pictureOf(svgFor(asXml(sheets), `${css}\n${bodyRule()}`, tall));
    if (!picture) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(tall.width * SCALE);
    canvas.height = Math.round(tall.height * SCALE);

    const paper = canvas.getContext("2d");
    // Anything the picture does not cover would be transparent, and a
    // transparent pixel in a JPEG is a black one.
    paper.fillStyle = size.background || "#ffffff";
    paper.fillRect(0, 0, canvas.width, canvas.height);
    paper.drawImage(picture, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // One page, cut out of the run it was drawn in.
  function pageOut(run, index, size) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(size.width * SCALE);
    canvas.height = Math.round(size.height * SCALE);

    canvas.getContext("2d").drawImage(
      run,
      0, index * canvas.height, canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );

    return canvas;
  }

  const jpegOf = (canvas) => new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", QUALITY);
  });

  /* --- Finding the words ---------------------------------------------------
   *
   * Measured in the live document, because a rectangle needs a layout and a
   * sheet that has been taken off the page has none. The sheets carry their
   * size on themselves and the stylesheet they were built against is this
   * page's own, so laying them out here puts every word exactly where the
   * drawing will show it.
   */
  function measuringFrame() {
    const frame = document.createElement("div");
    frame.setAttribute("aria-hidden", "true");
    /* Off the side of the page rather than hidden.
     *
     * `visibility: hidden` inherits, and the walk below skips hidden text on
     * purpose — so a frame that hid its contents hid every word in the
     * document from the thing looking for them, and the layer came out
     * empty.
     */
    frame.style.cssText = "position:absolute;left:-20000px;top:0;pointer-events:none";
    return frame;
  }

  /* Text nobody can see is text nobody meant to search.
   *
   * KaTeX writes every formula twice — once as MathML for a screen reader,
   * hidden under a clip rectangle, and once as the spans that are shown. Both
   * would go into the layer, and a search for a symbol would find it twice
   * while a selection picked up a sentence of it twice over.
   */
  const hiddenInside = (node) => Boolean(node.parentElement?.closest(".katex-mathml"));

  const WORDS = /\S+/g;

  function wordsIn(node, sheetBox, runs) {
    const style = window.getComputedStyle(node.parentElement);
    if (style.visibility === "hidden" || style.display === "none") {
      return;
    }

    const size = parseFloat(style.fontSize) || 0;
    const range = document.createRange();

    for (const found of node.nodeValue.matchAll(WORDS)) {
      range.setStart(node, found.index);
      range.setEnd(node, found.index + found[0].length);

      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      runs.push({
        text: found[0],
        x: rect.left - sheetBox.left,
        // The baseline, near enough: a descender is about a fifth of the size
        // and nothing here is drawn, so near enough is where selection sits.
        y: rect.bottom - sheetBox.top - (size * 0.2),
        width: rect.width,
        size
      });
    }
  }

  function textRuns(sheet) {
    const sheetBox = sheet.getBoundingClientRect();
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    const runs = [];

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.trim() && !hiddenInside(node)) {
        wordsIn(node, sheetBox, runs);
      }
    }

    return runs;
  }

  // Every sheet's words, in one layout pass rather than one each.
  function wordsOnSheets(sheets) {
    const frame = measuringFrame();
    document.body.appendChild(frame);
    for (const sheet of sheets) {
      frame.appendChild(sheet);
    }

    const found = sheets.map(textRuns);

    for (const sheet of sheets) {
      sheet.remove();
    }

    frame.remove();
    return found;
  }

  /* Every sheet, in order, as the bytes of a PDF.
   *
   * `onPage` is called as each one is drawn, because a long document takes
   * long enough that a button which has simply stopped responding is a button
   * somebody presses again.
   */
  async function render({ sheets, css, size, paper, title, onPage = null }) {
    const perRun = Math.max(1, Math.floor(MAX_CANVAS / Math.round(size.height * SCALE)));
    const words = wordsOnSheets(sheets);
    const pages = [];

    for (let from = 0; from < sheets.length; from += perRun) {
      const run = sheets.slice(from, from + perRun);
      const drawn = await drawRun(run, css, size);
      if (!drawn) {
        continue;
      }

      for (let at = 0; at < run.length; at += 1) {
        const canvas = pageOut(drawn, at, size);
        const blob = await jpegOf(canvas);

        if (blob) {
          pages.push({
            width: paper.width,
            height: paper.height,
            // What the words were measured against, which is not the paper:
            // a sheet with ink on it is laid out at the width the ink was
            // drawn at and then stretched onto A4.
            drawnWidth: size.width,
            pixelWidth: canvas.width,
            pixelHeight: canvas.height,
            runs: words[from + at],
            bytes: new Uint8Array(await blob.arrayBuffer())
          });
        }

        // Released rather than left to the collector: these are fifteen
        // megabytes each and a long document makes a lot of them.
        canvas.width = 0;
        canvas.height = 0;
        onPage?.(pages.length, sheets.length);
      }

      drawn.width = 0;
      drawn.height = 0;
    }

    return pages.length > 0 ? write({ pages, title }) : null;
  }

  return { write, render, drawRun, svgFor, asXml, bodyRule, hexOf, textRuns, INHERITED, PT_PER_PX, SCALE, QUALITY, MAX_CANVAS };
})();
