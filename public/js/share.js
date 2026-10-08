// The standalone share view.
//
// Everything it renders comes from MarkdownCore, which the main app uses too —
// same sanitizer, same Mermaid security level. This file is only the glue:
// fetch one document by its share token, render it, and provide a theme toggle.
//
// It deliberately knows nothing about sessions, the file tree, or any other
// document. There is no code path here that could reach one.

(function () {
  "use strict";

  const elements = {
    loading: document.getElementById("shareLoading"),
    error: document.getElementById("shareError"),
    errorTitle: document.getElementById("shareErrorTitle"),
    errorMessage: document.getElementById("shareErrorMessage"),
    content: document.getElementById("shareContent"),
    footer: document.getElementById("shareFooter"),
    meta: document.getElementById("shareMeta"),
    themeToggle: document.getElementById("shareThemeToggle"),
    outline: document.getElementById("shareOutline"),
    outlineBody: document.getElementById("shareOutlineBody"),
    outlineToggle: document.getElementById("shareOutlineToggle"),
    outlineClose: document.getElementById("shareOutlineClose"),
    annotateToggle: document.getElementById("shareAnnotateToggle"),
    exportBtn: document.getElementById("shareExportBtn"),
    inkToolbar: document.getElementById("shareInkToolbar")
  };

  /* The outline, on this page's elements.
   *
   * The share page scrolls a container of its own rather than the window, so
   * that is what is handed over — the module does not go looking for it.
   */
  const outline = DocIndex.create({
    content: elements.content,
    panel: elements.outline,
    body: elements.outlineBody,
    toggle: elements.outlineToggle,
    closeBtn: elements.outlineClose,
    scroller: document.querySelector(".share-page")
  });

  /* Writing on it.
   *
   * Filed under the share token, so two shared documents open in the same
   * browser keep their own marks — and nothing here goes to the server.
   */
  const ink = Annotate.create({
    // The ink goes over the whole page rather than over the column of words,
    // so the margins either side can be written in — which is where a note
    // that does not fit beside its line has to go.
    surface: document.querySelector(".share-layout"),
    content: elements.content,
    toolbar: elements.inkToolbar,
    token: shareTokenFromLocation()
  });

  // The tools are out of the way until they are asked for, because most of the
  // time a shared document is a thing somebody is reading.
  function showTools(wanted) {
    elements.inkToolbar.hidden = !wanted;
    elements.annotateToggle.setAttribute("aria-expanded", wanted ? "true" : "false");
    const label = wanted ? "Put the pen down" : "Annotate this document";
    elements.annotateToggle.setAttribute("aria-label", label);
    elements.annotateToggle.title = label;
    document.body.classList.toggle("is-annotating", wanted);

    // Closing the tools puts the pen down: a toolbar that is gone while a drag
    // still draws is a document nobody can select text in any more.
    if (!wanted && ink.tool() !== "none") {
      ink.chooseTool(ink.tool());
    }
  }

  elements.annotateToggle.addEventListener("click", () => {
    showTools(elements.inkToolbar.hidden);
  });

  MarkdownCore.configure({
    onWarning(message) {
      console.warn(message);
    }
  });

  function shareTokenFromLocation() {
    const match = window.location.pathname.match(/^\/s\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function showError(title, message) {
    elements.loading.hidden = true;
    elements.content.classList.remove("visible");
    elements.errorTitle.textContent = title;
    elements.errorMessage.textContent = message;
    elements.error.hidden = false;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "";
    }

    const units = ["B", "KB", "MB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }

    return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  async function loadSharedDocument() {
    const token = shareTokenFromLocation();
    if (!token) {
      showError("This link is not valid", "The address is missing its share token.");
      return;
    }

    let payload;
    try {
      const response = await fetch(`/api/share/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        showError(
          response.status === 404 ? "This link is not valid" : "Could not load the document",
          body.error || "The link may have been revoked, or the document may have been deleted."
        );
        return;
      }

      payload = await response.json();
    } catch {
      showError("Could not load the document", "Check your connection and try again.");
      return;
    }

    document.title = `${payload.title} | AzaDocs`;

    // The one page a stranger is served, so this is the assignment that
    // matters most: renderDocumentContent runs marked and then DOMPurify with
    // this app's allowlist (md/text.js), and nothing else here touches markup.
    // eslint-disable-next-line no-unsanitized/property
    elements.content.innerHTML = MarkdownCore.renderDocumentContent(
      payload.file,
      payload.content,
      payload.title
    );
    // Whoever opened this link has no session, so /api/assets would refuse
    // them. The share-scoped route serves the same image on the strength of
    // the token, but only for images that are actually in this document.
    for (const image of elements.content.querySelectorAll('img[src^="/api/assets/"]')) {
      const name = image.getAttribute("src").slice("/api/assets/".length);
      image.setAttribute("src", `/api/share/${encodeURIComponent(token)}/assets/${name}`);
    }

    elements.content.classList.add("visible");
    elements.loading.hidden = true;

    const parts = [
      payload.file,
      formatBytes(new Blob([payload.content]).size),
      formatDate(payload.updatedAt) ? `Updated ${formatDate(payload.updatedAt)}` : ""
    ].filter(Boolean);

    elements.meta.textContent = parts.join("  ·  ");
    elements.footer.hidden = false;

    // Diagrams, code and math, exactly as the app renders them.
    await MarkdownCore.renderMermaidBlocks(elements.content);

    // The headings exist once the document has rendered, so the outline is
    // built from what is actually on the page rather than from the markdown.
    outline.refresh();

    // ...and so does the document the ink sits on, which has to be its final
    // size before a stroke drawn at the bottom of it lands in the right place.
    ink.restore();

    /* Exporting, if the link was published with it allowed.
     *
     * The server decides and the page asks: a button hidden by the client
     * would be a permission enforced by the client, and there is nothing to
     * enforce here anyway — the copy is made from what is already on screen.
     * What the permission governs is whether the offer is made at all.
     */
    if (payload.allowExport) {
      offerExport(payload);
    }
  }

  function offerExport(payload) {
    elements.exportBtn.hidden = false;
    Exporter.attach({
      button: elements.exportBtn,
      name: () => payload.file,
      title: () => payload.title,
      article: () => elements.content,
      // The ink is drawn over the whole page, margins and all, so the copy
      // has to be of the whole page for it to land on the right words.
      surface: () => document.querySelector(".share-layout"),
      ink: () => document.querySelector(".ink-layer"),
      source: () => payload.content,
      // The server draws the PDF, and this is what says it may: the same
      // link, which the owner published with exporting allowed.
      share: () => shareTokenFromLocation()
    });
  }

  /* -- theme ---------------------------------------------------------------
   *
   * The cycle, the icons, the key it is written under and the resolving of
   * "auto" all live in theme-boot.js, which this page already loads in <head>
   * to get the colours right before first paint. This file used to carry its
   * own copy of all four, and they had already drifted: ThemeSwitch.apply
   * also moves the <meta name="theme-color">, which this page has and which
   * therefore stayed on the old colour every time somebody switched.
   *
   * What is left here is the part only this page knows: which panel holds the
   * diagrams that have to be drawn again.
   */
  async function applyTheme(preference) {
    const before = ThemeSwitch.active();
    const resolved = ThemeSwitch.apply(preference);

    ThemeSwitch.dress(elements.themeToggle);

    if (resolved !== before) {
      await MarkdownCore.repaintMermaidForTheme([elements.content]);
    }
  }

  elements.themeToggle.addEventListener("click", () => {
    void applyTheme(ThemeSwitch.META[ThemeSwitch.preference()].next);
  });

  ThemeSwitch.dress(elements.themeToggle);
  MarkdownCore.bindWheelZoomModifier();
  void loadSharedDocument();
})();
