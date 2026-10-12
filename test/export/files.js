/* Part of the EXPORT suite. See export.test.js, which loads this.
 *
 * The four things a snapshot can become, and the step that hands each of them
 * to the person who asked: a blob, an anchor, a click, and the object URL
 * given back once the browser has taken the data.
 *
 * export.test.js writes the zip a .docx is in this process's own scope, byte
 * for byte, because that is the part a word processor is strict about. What is
 * here is everything around it — which format gets what type, what the server
 * is asked and what happens when it says no, and the fallback that draws the
 * PDF in the page when there is no browser on the server to do it properly.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");

module.exports = async (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  const dom = new JSDOM("<body></body>", {
    url: "https://docs.example/notes/a",
    runScripts: "outside-only"
  });
  const { window } = dom;

  // The zip is written as bytes, and jsdom's window has no encoder to make
  // them with.
  window.TextEncoder = TextEncoder;

  loadScript(window, path.join(ROOT, "export", "formats.js"));
  const Formats = window.ExportFormats;

  /* --- what a blob was made of -------------------------------------------
   *
   * jsdom's Blob will not give its contents back, and the contents are the
   * whole question: which bytes went into which file. So the parts are kept
   * as they are handed over.
   */
  const made = [];

  window.Blob = /** @type {any} */ (class {
    constructor(parts, options = {}) {
      this.parts = parts;
      this.type = options.type || "";
      this.size = parts.reduce((sum, part) => sum + (part.length ?? part.byteLength ?? 0), 0);
      made.push(this);
    }
  });

  // The anchor, the click and the URL. A download is the only thing in the app
  // that happens by making an element and pressing it.
  const saved = [];
  const released = [];
  let nextUrl = 0;

  window.URL.createObjectURL = (blob) => {
    const url = `blob:fake/${nextUrl += 1}`;
    saved.push({ url, blob });
    return url;
  };

  window.URL.revokeObjectURL = (url) => released.push(url);

  const clicked = [];
  window.HTMLAnchorElement.prototype.click = function click() {
    clicked.push({
      href: this.getAttribute("href"),
      name: this.getAttribute("download"),
      attached: Boolean(this.parentNode)
    });
  };

  // When the URL is given back, which is after the browser has taken the data
  // and not before.
  const later = [];
  window.setTimeout = /** @type {any} */ ((run, ms) => {
    later.push({ run, ms });
    return later.length;
  });

  /* --- the server ---------------------------------------------------------- */

  let answer = null;
  const asked = [];

  window.fetch = async (url, options = {}) => {
    asked.push({ url: String(url), options });

    if (answer === "offline") {
      throw new Error("the network went away");
    }

    return /** @type {any} */ ({
      ok: answer.ok !== false,
      headers: { get: (name) => (name === "content-type" ? answer.type : null) },
      json: async () => answer.body,
      blob: async () => ({ size: answer.size || 1234 })
    });
  };

  const last = () => clicked[clicked.length - 1];
  const lastBlob = () => saved[saved.length - 1].blob;

  const snapshot = {
    html: "<!DOCTYPE html><html><body>the document</body></html>",
    sheets: ["a sheet"], styles: ".x{}", size: { width: 1, height: 2 }, paper: { width: 3, height: 4 }
  };

  console.log("=== a file is handed over by making a link and pressing it ===");
  {
    Formats.toHtml(snapshot, "Notes.md");

    check("the file is the snapshot itself", lastBlob().parts, [snapshot.html]);
    check("...served as a page, in the encoding it was written in",
      lastBlob().type, "text/html;charset=utf-8");
    check("...named after the document rather than after its source",
      last().name, "Notes.html");
    check("...and the link was in the page when it was pressed", last().attached, true);
    check("the link is not left behind afterwards",
      window.document.querySelectorAll("a").length, 0);

    /* Given back once the browser has taken the data, not before: revoking a
     * URL the download has not started from cancels the download.
     */
    check("the URL is not given back straight away", released, []);
    check("...but it is given back", later[later.length - 1].ms > 0, true);
    later[later.length - 1].run();
    check("...and then it is", released, [last().href]);
  }

  console.log("=== and each format carries what it can ===");
  {
    /* Markdown has no way to say "there is a diagram here, and somebody has
     * drawn a circle round it" — so the Markdown export is the source, not a
     * rendering of it.
     */
    Formats.toMarkdown("# Notes\n\nthe source", "Notes.md");
    check("the Markdown export is the source as it was written",
      lastBlob().parts, ["# Notes\n\nthe source"]);
    check("...as Markdown", lastBlob().type, "text/markdown;charset=utf-8");
    check("...named for the document", last().name, "Notes.md");
    // A document with no source yet is an empty file rather than the word
    // "undefined".
    check("a document with nothing in it is an empty file",
      (Formats.toMarkdown(null, "Empty"), lastBlob().parts), [""]);

    /* A .docx is a zip of XML parts whose entire body says "here is some
     * HTML, convert it when you open this". Word does the conversion with its
     * own importer, which keeps the headings, tables, colours and pictures.
     */
    Formats.toDocx(snapshot, "Notes");
    const zip = Buffer.from(lastBlob().parts[0]).toString("latin1");
    check("the .docx is a zip", zip.startsWith("PK\u0003\u0004"), true);
    check("...holding the parts Word opens a document by",
      ["[Content_Types].xml", "_rels/.rels", "word/document.xml",
        "word/_rels/document.xml.rels", "word/page.html"].every((part) => zip.includes(part)), true);
    check("...with the page itself as the part that gets converted",
      zip.includes("the document"), true);
    check("...and the type Word is registered for",
      lastBlob().type,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  console.log("=== the PDF is drawn by the engine that knows how ===");
  {
    /* Chromium's PDF backend embeds a subset of each font, writes the text as
     * text and the diagrams as vectors, and is reachable only from outside a
     * page. So the laid-out document goes to the server and comes back drawn:
     * a tenth the size, with the words in it rather than over it.
     */
    answer = { type: "application/pdf", size: 54321 };
    const drawn = await Formats.toPdf(snapshot, "Notes", null);

    check("the laid-out document is posted whole",
      [asked[asked.length - 1].url, asked[asked.length - 1].options.method],
      ["/api/export/pdf", "POST"]);
    // It carries its own fonts and pictures, and it has to: the server has
    // none of them and the ink exists only in this browser.
    check("...with the page in the body", JSON.parse(asked[asked.length - 1].options.body).html,
      snapshot.html);
    check("what comes back is the file", last().name, "Notes.pdf");
    check("...and the caller is told it was not drawn here",
      [drawn.drawnHere, drawn.bytes], [false, 54321]);

    // A share page has no session and sends none; its credential is the token
    // in the body.
    check("a session's token goes with it where there is one",
      asked[asked.length - 1].options.headers["X-CSRF-Token"], undefined);
    window.AppState = /** @type {any} */ ({ state: { csrfToken: "a-token" } });
    await Formats.toPdf(snapshot, "Notes", null, "a-share-id");
    check("...and is sent once the page has one",
      asked[asked.length - 1].options.headers["X-CSRF-Token"], "a-token");
    check("...while a share says which share it is",
      JSON.parse(asked[asked.length - 1].options.body).share, "a-share-id");
  }

  console.log("=== and in the page itself when there is no engine ===");
  {
    /* The fallback and not the plan: a picture of each sheet with the words
     * laid invisibly over it. Eight times the size, and the text only sits
     * where it was measured to sit.
     */
    const asks = [];
    window.ExportPdf = /** @type {any} */ ({
      render: async (request) => {
        asks.push(request);
        return request.sheets.length > 0 ? new Uint8Array([37, 80, 68, 70]) : null;
      }
    });

    for (const [why, served] of [
      ["the server refuses", { ok: false }],
      ["the server answers with something else", { ok: true, type: "text/html" }],
      ["the server cannot be reached", "offline"]
    ]) {
      answer = /** @type {any} */ (served);
      const here = await Formats.toPdf(snapshot, "Notes", null);
      check(`a refusal falls back rather than fails: ${why}`, here.drawnHere, true);
    }

    check("the page is given the sheets it laid out, and the stylesheet for them",
      [asks[0].sheets, asks[0].css, asks[0].title], [snapshot.sheets, snapshot.styles, "Notes"]);
    check("...and the file it writes is a PDF",
      [last().name, lastBlob().type], ["Notes.pdf", "application/pdf"]);

    /* A long document takes long enough that a button which has simply
     * stopped responding is a button somebody presses again, so the caller is
     * handed the way to say so.
     */
    const told = () => {};
    await Formats.toPdf(snapshot, "Notes", told);
    check("whoever asked can follow it page by page", asks[asks.length - 1].onPage, told);

    // Nothing drawn is nothing to save, and a download of an empty file is
    // worse than being told it did not work.
    let refused = "";
    try {
      await Formats.toPdf({ ...snapshot, sheets: [] }, "Notes", null);
    } catch (error) {
      refused = error.message;
    }
    check("a document none of whose pages would draw says so rather than saving nothing",
      refused.includes("drawn"), true);
  }

  console.log("=== whether to offer the good one at all ===");
  {
    // A deployment with no browser is not a deployment with no PDF, so the
    // menu asks before it says what the PDF will be.
    for (const [expected, served] of /** @type {[boolean, any][]} */ ([
      [true, { ok: true, body: { pdf: true } }],
      [false, { ok: true, body: { pdf: false } }],
      [false, { ok: false }],
      [false, "offline"]
    ])) {
      answer = served;
      check(`the server is asked whether it can draw one (${JSON.stringify(served)})`,
        await Formats.serverCanDraw(), expected);
    }

    check("...at the address that answers that and nothing else",
      asked[asked.length - 1].url, "/api/export/able");
  }
};
