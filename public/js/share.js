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
    themeToggle: document.getElementById("shareThemeToggle")
  };

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

    let payload = null;
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
