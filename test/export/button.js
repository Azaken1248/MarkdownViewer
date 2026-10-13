/* Part of the EXPORT suite. See export.test.js, which loads this.
 *
 * The one button, its four formats, and what it says while it works. The same
 * module serves the workspace and a share page, and they differ in one thing
 * only: the workspace has toasts and a share page has nothing of the sort, so
 * the menu's own status line says it instead. Either way the export does not
 * finish silently, and that is most of what is checked here.
 *
 * What each format actually produces is three files away and covered to the
 * line; `ExportSnapshot` and `ExportFormats` are stood in for so that the
 * question here is what the button asks of them and what it does with the
 * answer.
 */
const { JSDOM } = require("jsdom");
const path = require("path");
const { loadScript } = require("../app-source.js");

module.exports = async (check) => {
  const ROOT = path.join(__dirname, "..", "..", "public", "js");

  const dom = new JSDOM('<body><div class="bar"><button id="save">Save a copy</button></div></body>',
    { runScripts: "outside-only" });
  const { window } = dom;
  const { document } = window;

  loadScript(window, path.join(ROOT, "export.js"));
  const Exporter = window.Exporter;

  /* --- what the button is given to work with ------------------------------ */

  const built = [];
  const delivered = [];
  let canDraw = true;
  let snapshotFails = "";
  let missing = [];
  let drawnHere = false;
  let onPage = null;
  let pages = ["one", "two", "three"];

  window.ExportSnapshot = /** @type {any} */ ({
    build: async (request) => {
      built.push(request);
      if (snapshotFails) {
        throw new Error(snapshotFails);
      }

      return {
        html: "<html>the page</html>",
        missing: missing.slice(),
        sheets: pages.slice(),
        styles: "", size: {}, paper: {}
      };
    }
  });

  window.ExportFormats = /** @type {any} */ ({
    serverCanDraw: async () => canDraw,
    toHtml: (snapshot, name) => delivered.push(["html", name]),
    toDocx: (snapshot, name) => delivered.push(["docx", name]),
    toMarkdown: (source, name) => delivered.push(["md", name, source]),
    toPdf: async (snapshot, name, progress, share) => {
      delivered.push(["pdf", name, share]);
      onPage = progress;
      progress(2, 3);
      return { bytes: 2048, drawnHere };
    }
  });

  const button = /** @type {HTMLButtonElement} */ (document.getElementById("save"));
  const article = document.createElement("article");
  const surface = document.createElement("div");
  const ink = document.createElement("svg");

  const notified = [];
  const parts = {
    button,
    name: () => "Notes",
    title: () => "Notes — AzaDocs",
    source: () => "# Notes",
    article: () => article,
    surface: () => surface,
    ink: () => ink,
    share: () => "share-id",
    notify: (message, tone) => notified.push([message, tone])
  };

  // Each attach puts its own menu directly after its own button, so a second
  // one gets a button of its own rather than being found by position.
  const another = () => {
    const made = document.createElement("button");
    document.body.appendChild(made);
    return made;
  };

  const menuAfter = (which) => /** @type {HTMLElement} */ (which.nextElementSibling);

  const handle = Exporter.attach(parts);
  const menu = menuAfter(button);
  const itemFor = (format) => /** @type {HTMLButtonElement} */
    (menu.querySelector(`.export-item[data-format="${format}"]`));
  const noteFor = (format) => itemFor(format).querySelector(".export-item-note").textContent;

  // Settled, so the answer about what the PDF will be has arrived.
  await Promise.resolve();

  console.log("=== the menu the button opens ===");
  {
    check("the menu is put next to the button it belongs to", menu.previousElementSibling, button);
    check("...closed", menu.hidden, true);
    check("...as a group with a name, for anybody not looking at it",
      [menu.getAttribute("role"), menu.getAttribute("aria-label")], ["group", "Export as"]);
    check("...and the button says it opens one",
      [button.getAttribute("aria-haspopup"), button.getAttribute("aria-expanded")],
      ["true", "false"]);

    check("every format is offered",
      [...menu.querySelectorAll(".export-item")].map((item) => item.getAttribute("data-format")),
      Exporter.FORMATS.map((format) => format.id));
    check("...each with its name and what it will be",
      [itemFor("docx").querySelector(".export-item-label").textContent, noteFor("md")],
      ["Word", "The source text, without the rendering or the ink."]);
    // The icon is decoration beside a label that already says it.
    check("...and an icon nothing has to read",
      itemFor("pdf").querySelector("i").getAttribute("aria-hidden"), "true");
  }

  console.log("=== opening it, and every way of closing it again ===");
  {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("the button opens the menu",
      [menu.hidden, button.getAttribute("aria-expanded")], [false, "true"]);

    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    check("...and closes it again", menu.hidden, true);

    // And whatever else is on the page can close it: a share page shuts it
    // when the viewer starts dragging the document about.
    handle.open();
    handle.close();
    check("...and whatever else is on the page can shut it", menu.hidden, true);

    handle.open();
    menu.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    check("a press inside the menu leaves it open", menu.hidden, false);

    document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    check("...and a press anywhere else closes it", menu.hidden, true);

    handle.open();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a" }));
    check("another key does nothing to it", menu.hidden, false);

    const focused = [];
    button.focus = () => focused.push(true);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    check("Escape closes it", menu.hidden, true);
    // Closed with the keyboard, so the keyboard is left somewhere it can
    // carry on from.
    check("...and gives the keyboard back to the button it came from", focused, [true]);

    // Nothing to close, so nothing is taken from whatever is focused now.
    focused.splice(0);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    check("...while Escape with the menu already shut takes nothing", focused, []);
  }

  console.log("=== the one format that does not need the page ===");
  {
    /* Markdown is the source, which the caller already has — so no snapshot
     * is collected for it and nothing is fetched.
     */
    built.splice(0);
    delivered.splice(0);
    notified.splice(0);
    handle.open();
    itemFor("md").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    check("choosing a format closes the menu", menu.hidden, true);
    check("the source is saved as it was written", delivered, [["md", "Notes", "# Notes"]]);
    check("...without collecting the page at all", built, []);
    /* Said rather than left to be discovered: somebody who exports Markdown
     * expecting their diagrams has a surprise waiting in the file.
     */
    check("...and the reader is told what it does not hold",
      notified[0][0].includes("not the rendering"), true);
    check("...as something that worked", notified[0][1], "success");
  }

  console.log("=== and the three that are the page ===");
  {
    for (const [format, forWord, paged] of /** @type {[string, boolean, boolean][]} */ ([
      ["html", false, false],
      ["docx", true, false],
      ["pdf", false, true]
    ])) {
      built.splice(0);
      await handle.run(format);
      check(`the page is collected for ${format}`, built.length, 1);
      /* Word is given pictures where the others are given vectors: its HTML
       * importer does not know what an inline SVG is and drops it. And only
       * the PDF is cut into pages here — a web page scrolls, and Word lays
       * the document out again on its own paper.
       */
      check(`...as ${format} needs it`, [built[0].forWord, built[0].paged], [forWord, paged]);
    }

    check("the document, what it is called, and what was drawn over it all go along",
      [built[0].article, built[0].surface, built[0].ink, built[0].title],
      [article, surface, ink, "Notes — AzaDocs"]);

    // A workspace document has no ink and no surface, and the parts a page
    // does not have are simply not asked for.
    const bare = Exporter.attach({
      ...parts, button: another(), surface: undefined, ink: undefined, share: undefined
    });
    built.splice(0);
    delivered.splice(0);
    await bare.run("pdf");
    check("a page with no ink on it says so rather than failing to ask",
      [built[0].surface, built[0].ink], [null, null]);
    check("...and a document that is not shared sends no share with it",
      delivered[0][2], null);
  }

  console.log("=== what it says while it is doing it ===");
  {
    notified.splice(0);
    missing = [];
    drawnHere = false;
    await handle.run("pdf");

    /* A long document takes a second or two and the pages are drawn one at a
     * time; a button that has simply stopped responding is a button somebody
     * presses again.
     */
    check("the pages are counted off as they are drawn", typeof onPage, "function");
    check("the file is described by what is in it",
      notified[notified.length - 1][0], "Saved as a PDF of 3 pages, 2KB.");

    // A document that is one page is one page, not "1 pages".
    pages = ["only"];
    notified.splice(0);
    await handle.run("pdf");
    check("...and a document of one page is described as one",
      notified[0][0], "Saved as a PDF of 1 page, 2KB.");
    pages = ["one", "two", "three"];

    /* Said when it matters: a file written here is a picture of each page
     * rather than the page, and somebody wondering why it will not search
     * deserves the answer.
     */
    drawnHere = true;
    notified.splice(0);
    await handle.run("pdf");
    check("a PDF the page drew itself says so", notified[0][0].includes("Drawn in this browser"), true);
    check("...as something short of right", notified[0][1], "warning");
    drawnHere = false;

    // A picture that could not be fetched is a hole in the copy, and saying
    // nothing about it is handing somebody a file with a hole in it.
    missing = ["one.png", "two.png"];
    notified.splice(0);
    await handle.run("html");
    check("a copy with something missing from it says how much",
      notified[0][0], "Saved as a web page. 2 files could not be included.");
    check("...and is not reported as a success", notified[0][1], "warning");

    missing = ["one.png"];
    notified.splice(0);
    await handle.run("docx");
    check("...counting one file as one file",
      notified[0][0], "Saved for Word. 1 file could not be included.");
    missing = [];
  }

  console.log("=== one at a time, and what happens when it goes wrong ===");
  {
    /* Collecting a long document takes a second or two, and two collections
     * at once would be two copies of every stylesheet and every picture being
     * fetched to make two files nobody asked for.
     */
    built.splice(0);
    const first = handle.run("html");
    check("the button shows it is working", button.classList.contains("is-busy"), true);
    await handle.run("html");
    check("...and a second ask while it is working is ignored", built.length, 1);
    await first;
    check("...with the button back to itself afterwards",
      button.classList.contains("is-busy"), false);

    snapshotFails = "the canvas ran out of memory";
    notified.splice(0);
    await handle.run("html");
    check("an export that falls over says what happened",
      notified[0], ["That export did not finish: the canvas ran out of memory", "error"]);
    // And the button is given back, because the alternative is a page that
    // has to be reloaded to try again.
    check("...and the button is usable again", button.classList.contains("is-busy"), false);
    snapshotFails = "";
  }

  console.log("=== and on a page with nowhere to put a message ===");
  {
    /* A share page has no toasts. The menu's own status line says it instead,
     * and then stops — a status that stays on screen is read as the state of
     * the next thing somebody does.
     */
    const timers = [];
    window.setTimeout = /** @type {any} */ ((run, ms) => {
      timers.push({ run, ms });
      return timers.length;
    });
    window.clearTimeout = /** @type {any} */ (() => {});

    const sharedButton = another();
    const shared = Exporter.attach({ ...parts, button: sharedButton, notify: undefined });
    const sharedMenu = menuAfter(sharedButton);
    const sharedStatus = () => sharedMenu.querySelector(".export-status").textContent;

    await shared.run("md");
    check("the menu says it where there is no toast to say it in",
      sharedStatus().includes("Markdown saved"), true);
    check("...and takes it back a moment later", timers.map((one) => one.ms), [6000]);
    timers[0].run();
    check("...leaving nothing behind", sharedStatus(), "");

    // While it works, the status is what it is doing rather than what it did.
    const working = shared.run("pdf");
    check("a collection in progress says so", sharedStatus().includes("Collecting the page"), true);
    await working;
    check("...and a page being drawn says which one",
      sharedMenu.querySelector(".export-status").textContent.includes("Saved as a PDF"), true);
  }

  console.log("=== what the menu promises about the PDF ===");
  {
    check("a deployment that can draw one says the server will",
      noteFor("pdf"), "Pages chosen here, drawn by the server.");

    /* A deployment with no browser is not a deployment with no PDF — it is
     * one where the page writes a picture of each page instead, which is
     * worth saying beforehand rather than afterwards.
     */
    canDraw = false;
    const plainButton = another();
    Exporter.attach({ ...parts, button: plainButton });
    // Asked once when the bar is built, and answered a tick later.
    await Promise.resolve();
    await Promise.resolve();
    check("...and one that cannot says the browser will",
      menuAfter(plainButton)
        .querySelector('.export-item[data-format="pdf"] .export-item-note').textContent,
      "Drawn in this browser: a picture of each page.");
  }
};
