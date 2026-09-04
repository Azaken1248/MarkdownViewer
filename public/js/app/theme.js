/* Theme.
 *
 * Every colour in the stylesheet is a custom property, so switching themes is
 * a single attribute on <html>. Two things do not follow automatically and are
 * handled here: the browser-chrome theme-color meta, and Mermaid, which bakes
 * hex into the SVG it emits and has to redraw.
 *
 * theme-boot.js has already applied the stored preference before first paint;
 * this only takes over once the user touches the toggle.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { notify } = global.AppNotify;

  /* The cycle, the icons and the writing-down all live in theme-boot.js, which
   * runs on every page that has a theme — including the diagram page, which does
   * not load this file. What is here is what only this page has to do about it:
   * say so out loud, and redraw the Mermaid on the screen.
   */
  const THEME_META = ThemeSwitch.META;

  const themePreference = () => ThemeSwitch.preference();
  const activeThemeName = () => ThemeSwitch.active();

  function syncThemeToggleUI() {
    ThemeSwitch.dress(elements.themeToggleBtn);
  }

  async function applyThemePreference(preference, { announce = false } = {}) {
    const resolvedBefore = activeThemeName();
    const next = ThemeSwitch.CYCLE.includes(preference) ? preference : "dark";
    const resolved = ThemeSwitch.apply(next);

    syncThemeToggleUI();

    if (announce) {
      notify(THEME_META[next].label + " enabled.", "info");
    }

    if (resolved !== resolvedBefore) {
      await repaintDiagramsForTheme();
    }
  }

  // Mermaid renders to a static SVG with the palette inlined, so the only way to
  // recolour a diagram is to draw it again from its source.
  async function repaintDiagramsForTheme() {
    const roots = [elements.docContent, elements.editorPreview].filter(Boolean);
    const blocks = roots.flatMap((root) => [...root.querySelectorAll(".mermaid-block")]);
    if (blocks.length === 0) {
      // Nothing on screen to redraw, but the next render must not reuse the old
      // palette.
      MarkdownCore.resetMermaidForThemeChange();
      return;
    }

    // Their SVGs are about to be replaced; leaving the instances bound would leak
    // handlers onto detached nodes.
    MarkdownCore.destroyPanZoomInstances();

    for (const block of blocks) {
      const source = block.dataset.mermaidSource;
      if (!source) {
        continue;
      }

      block.removeAttribute("data-processed");
      // Sizing is derived from the rendered viewBox and has to be measured again.
      block.style.aspectRatio = "";
      block.style.maxWidth = "";
      block.textContent = source;
      block.classList.add("mermaid");
    }

    MarkdownCore.resetMermaidForThemeChange();

    for (const root of roots) {
      await MarkdownCore.renderMermaidBlocks(root);
    }
  }

  function bindThemeToggle() {
    syncThemeToggleUI();

    elements.themeToggleBtn?.addEventListener("click", () => {
      void applyThemePreference(THEME_META[themePreference()].next, { announce: true });
    });

    // Only meaningful while the preference is "auto", but the listener is cheap
    // and the guard keeps an explicit choice from being overridden.
    window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
      if (themePreference() === "auto") {
        void applyThemePreference("auto");
      }
    });
  }

  global.AppTheme = {
    THEME_META,
    themePreference,
    activeThemeName,
    syncThemeToggleUI,
    applyThemePreference,
    bindThemeToggle
  };
})(typeof window === "undefined" ? globalThis : window);
