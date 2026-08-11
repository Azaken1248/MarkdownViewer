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

  const THEME_STORAGE_KEY = "mdviewer.theme";
  const THEME_CYCLE = ["dark", "light", "auto"];
  const THEME_META = {
    dark: { icon: "ph-moon", label: "Dark theme", next: "light" },
    light: { icon: "ph-sun", label: "Light theme", next: "auto" },
    auto: { icon: "ph-circle-half", label: "Theme follows your system", next: "dark" }
  };

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

  // -- theme ----------------------------------------------------------------

  function themePreference() {
    const stored = document.documentElement.dataset.themePreference;
    return THEME_CYCLE.includes(stored) ? stored : "dark";
  }

  function resolveTheme(preference) {
    if (preference !== "auto") {
      return preference;
    }

    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function syncThemeToggle() {
    const preference = themePreference();
    const meta = THEME_META[preference];
    const icon = elements.themeToggle.querySelector("i");
    if (icon) {
      icon.className = `ph ${meta.icon}`;
    }

    const label = `${meta.label}. Switch to ${THEME_META[meta.next].label.toLowerCase()}`;
    elements.themeToggle.setAttribute("aria-label", label);
    elements.themeToggle.title = label;
  }

  async function applyTheme(preference) {
    const before = document.documentElement.dataset.theme;
    const resolved = resolveTheme(preference);

    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = resolved;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Private mode; the choice still holds for this page.
    }

    syncThemeToggle();

    if (resolved !== before) {
      // Mermaid inlines its palette, so a theme change means redrawing.
      MarkdownCore.resetMermaidForThemeChange();
      MarkdownCore.destroyPanZoomInstances();

      for (const block of elements.content.querySelectorAll(".mermaid-block")) {
        const source = block.dataset.mermaidSource;
        if (!source) {
          continue;
        }

        block.removeAttribute("data-processed");
        block.style.aspectRatio = "";
        block.style.maxWidth = "";
        block.textContent = source;
        block.classList.add("mermaid");
      }

      await MarkdownCore.renderMermaidBlocks(elements.content);
    }
  }

  elements.themeToggle.addEventListener("click", () => {
    void applyTheme(THEME_META[themePreference()].next);
  });

  syncThemeToggle();
  MarkdownCore.bindWheelZoomModifier();
  void loadSharedDocument();
})();
