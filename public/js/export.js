/* Taking a copy away.
 *
 * One button, four formats, and one rule: what comes out looks like what is
 * on the screen. The rendering is not done again for the export — the page is
 * photographed as it stands, with the maths already laid out, the diagrams
 * already drawn, the code already coloured, the theme it is being read in and
 * whatever has been drawn over the top of it.
 *
 * The same module serves the workspace and a share page. They differ in one
 * thing only: on a share page the button is there because the person who
 * published the link said it could be, and on the workspace it is there
 * because you are reading a document you already have.
 */

/* exported Exporter */
var Exporter = (function () {
  "use strict";

  const FORMATS = [
    {
      id: "pdf",
      label: "PDF",
      icon: "ph-file-pdf",
      note: "Pages chosen here, drawn by the server."
    },
    {
      id: "html",
      label: "Web page",
      icon: "ph-file-html",
      note: "One file, exactly as it looks here."
    },
    {
      id: "docx",
      label: "Word",
      icon: "ph-file-doc",
      note: "Word lays it out again when you open it."
    },
    {
      id: "md",
      label: "Markdown",
      icon: "ph-file-md",
      note: "The source text, without the rendering or the ink."
    }
  ];

  function menuItem(format) {
    const made = document.createElement("button");
    made.type = "button";
    made.className = "export-item";
    made.dataset.format = format.id;

    const glyph = document.createElement("i");
    glyph.className = `ph ${format.icon}`;
    glyph.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "export-item-label";
    label.textContent = format.label;

    const note = document.createElement("span");
    note.className = "export-item-note";
    note.textContent = format.note;

    const text = document.createElement("span");
    text.className = "export-item-text";
    text.append(label, note);

    made.append(glyph, text);
    return made;
  }

  function buildMenu(view) {
    const menu = document.createElement("div");
    menu.className = "export-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Export as");
    menu.hidden = true;

    for (const format of FORMATS) {
      const item = menuItem(format);
      item.addEventListener("click", () => {
        close(view);
        void run(view, format.id);
      });
      menu.appendChild(item);
    }

    view.status = document.createElement("p");
    view.status.className = "export-status";
    view.status.setAttribute("role", "status");
    menu.appendChild(view.status);

    return menu;
  }

  function open(view) {
    view.menu.hidden = false;
    view.button.setAttribute("aria-expanded", "true");
  }

  function close(view) {
    view.menu.hidden = true;
    view.button.setAttribute("aria-expanded", "false");
  }

  const say = (view, message) => {
    view.status.textContent = message || "";
  };

  /* What happened, said wherever this page says things.
   *
   * The workspace has toasts; a share page has nothing of the sort and does
   * not need one for this, so the menu's own status line says it and then
   * stops. Either way the export does not finish silently.
   */
  function tell(view, message, tone) {
    if (view.parts.notify) {
      view.parts.notify(message, tone);
      say(view, "");
      return;
    }

    say(view, message);
    window.clearTimeout(view.sayTimer);
    view.sayTimer = window.setTimeout(() => say(view, ""), 6000);
  }

  /* --- Doing it ------------------------------------------------------------
   *
   * Markdown is the one format that does not need the page: it is the source,
   * which the caller already has. Everything else is built from the snapshot,
   * which takes a moment on a long document because every stylesheet, font
   * and picture is being fetched and carried along.
   */
  /* One at a time.
   *
   * Collecting a long document takes a second or two, and two collections at
   * once would be two copies of every stylesheet and every picture being
   * fetched to make two files nobody asked for.
   */
  function setBusy(view, busy) {
    view.busy = busy;
    view.button.classList.toggle("is-busy", busy);
  }

  async function run(view, format) {
    if (view.busy) {
      return;
    }

    const name = view.parts.name();

    if (format === "md") {
      ExportFormats.toMarkdown(view.parts.source(), name);
      tell(view, "Markdown saved. It holds the source text, not the rendering.", "success");
      return;
    }

    setBusy(view, true);
    say(view, {
      docx: "Drawing the diagrams for Word…",
      pdf: "Collecting the page and working out where it breaks…"
    }[format] || "Collecting the page…");

    try {
      const snapshot = await ExportSnapshot.build({
        title: view.parts.title(),
        article: view.parts.article(),
        surface: view.parts.surface?.() || null,
        ink: view.parts.ink?.() || null,
        // Word is given pictures where the others are given vectors: its HTML
        // importer does not know what an inline SVG is and drops it.
        forWord: format === "docx",
        // Only the PDF is cut into pages here. A web page scrolls, and Word
        // lays the document out again on its own paper.
        paged: format === "pdf"
      });

      await deliver(view, format, snapshot, name);
    } catch (error) {
      tell(view, `That export did not finish: ${error.message}`, "error");
    } finally {
      setBusy(view, false);
    }
  }

  async function deliver(view, format, snapshot, name) {
    // Said plainly rather than left as a surprise in the file: a picture that
    // could not be fetched is a hole in the copy.
    const short = snapshot.missing.length > 0
      ? ` ${snapshot.missing.length} file${snapshot.missing.length === 1 ? "" : "s"} could not be included.`
      : "";

    if (format === "html") {
      ExportFormats.toHtml(snapshot, name);
      tell(view, `Saved as a web page.${short}`, short ? "warning" : "success");
      return;
    }

    if (format === "docx") {
      ExportFormats.toDocx(snapshot, name);
      tell(view, `Saved for Word.${short}`, short ? "warning" : "success");
      return;
    }

    say(view, "Drawing the pages…");
    const made = await ExportFormats.toPdf(snapshot, name, (done, all) => {
      say(view, `Drawing page ${done} of ${all}…`);
    }, view.parts.share?.() || null);

    const pages = `${snapshot.sheets.length} page${snapshot.sheets.length === 1 ? "" : "s"}`;
    // Said when it matters: a file written here is a picture of each page
    // rather than the page, and somebody wondering why it is eight megabytes
    // and will not search deserves the answer.
    const how = made.drawnHere ? " Drawn in this browser: the text is searchable but not selectable." : "";

    tell(view, `Saved as a PDF of ${pages}, ${Math.round(made.bytes / 1024)}KB.${short}${how}`,
      short || made.drawnHere ? "warning" : "success");
  }

  /* --- Wiring -------------------------------------------------------------- */

  /* `parts` is how the two pages differ: each says where its document is,
   * what it is called, and — on a share page — which layer has the ink on it.
   */
  function attach(parts) {
    const view = { parts, button: parts.button, busy: false, sayTimer: 0 };

    /* What the PDF will be, asked once when the bar is built.
     *
     * A deployment with a browser draws a real one — fonts embedded, text as
     * text. One without has the page write a picture of each page instead,
     * which works and is worth saying so beforehand rather than afterwards.
     */
    void ExportFormats.serverCanDraw().then((can) => {
      if (!can) {
        const item = view.menu.querySelector('.export-item[data-format="pdf"] .export-item-note');
        if (item) {
          item.textContent = "Drawn in this browser: a picture of each page.";
        }
      }
    });

    view.menu = buildMenu(view);
    view.button.setAttribute("aria-haspopup", "true");
    view.button.setAttribute("aria-expanded", "false");
    view.button.after(view.menu);

    view.button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (view.menu.hidden) {
        open(view);
      } else {
        close(view);
      }
    });

    document.addEventListener("pointerdown", (event) => {
      const target = /** @type {Node} */ (event.target);
      if (!view.menu.contains(target) && !view.button.contains(target)) {
        close(view);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !view.menu.hidden) {
        close(view);
        view.button.focus();
      }
    });

    return { open: () => open(view), close: () => close(view), run: (format) => run(view, format) };
  }

  return { attach, FORMATS };
})();
