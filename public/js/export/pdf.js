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

      const contentBody = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
      const contentId = out.object(`<< /Length ${contentBody.length} >>`,
        new TextEncoder().encode(contentBody));

      pageIds.push(out.object([
        `<< /Type /Page /Parent ${pagesId} 0 R`,
        `/MediaBox [0 0 ${width} ${height}]`,
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >>`,
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

  /* Every sheet, in order, as the bytes of a PDF.
   *
   * `onPage` is called as each one is drawn, because a long document takes
   * long enough that a button which has simply stopped responding is a button
   * somebody presses again.
   */
  async function render({ sheets, css, size, paper, title, onPage = null }) {
    const perRun = Math.max(1, Math.floor(MAX_CANVAS / Math.round(size.height * SCALE)));
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
            pixelWidth: canvas.width,
            pixelHeight: canvas.height,
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

  return { write, render, drawRun, svgFor, asXml, bodyRule, INHERITED, PT_PER_PX, SCALE, QUALITY, MAX_CANVAS };
})();
