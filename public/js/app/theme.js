/* Theme.
 *
 * Every colour in the stylesheet is a custom property, so switching themes is
 * a single attribute on <html>, and theme-boot.js owns that attribute, the key
 * it is remembered under, the cycle and the browser-chrome theme-color meta —
 * on every page, including the two this file is not loaded on.
 *
 * So what is left here is what only the app has to do about a theme change:
 * say so out loud, and hand the engine the panels whose diagrams have to be
 * drawn again. theme-boot.js has already applied the stored preference before
 * first paint; this takes over once somebody touches the toggle.
 */

/* exported AppTheme */
var AppTheme = (function () {
  const { elements } = AppDom;
  const { notify } = AppNotify;

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
      // The redraw is the engine's, because the share page needs the same one
      // and the order the four steps happen in is easy to get wrong. What is
      // this page's to know is which panels hold diagrams.
      await MarkdownCore.repaintMermaidForTheme([elements.docContent, elements.editorPreview]);
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

  return {
    THEME_META,
    themePreference,
    activeThemeName,
    syncThemeToggleUI,
    applyThemePreference,
    bindThemeToggle
  };
})();
