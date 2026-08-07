/* Runs synchronously in <head>, before the stylesheet paints anything.
 *
 * Its only job is to put a concrete `data-theme` of "light" or "dark" on
 * <html>, so app.css never has to describe the same light palette twice — once
 * for an explicit choice and again inside a prefers-color-scheme query.
 *
 * This cannot be an inline <script>: the CSP pins script-src to 'self' plus the
 * two pinned CDNs, with no 'unsafe-inline'. A same-origin file is the way to
 * get pre-paint execution without weakening that.
 *
 * The stored preference is one of "dark" | "light" | "auto"; only "auto"
 * consults the operating system. Dark is the default, because it is what this
 * app has always looked like.
 */
(function () {
  var STORAGE_KEY = "mdviewer.theme";
  var stored = null;

  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    // Private mode can throw on access. Fall through to the default.
    stored = null;
  }

  if (stored !== "light" && stored !== "dark" && stored !== "auto") {
    stored = "dark";
  }

  var resolved = stored;
  if (stored === "auto") {
    resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  document.documentElement.dataset.theme = resolved;
  // The preference itself is kept separately so the toggle can show "Auto"
  // rather than whatever auto happened to resolve to.
  document.documentElement.dataset.themePreference = stored;
})();
