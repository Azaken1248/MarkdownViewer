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
  const STORAGE_KEY = "mdviewer.theme";
  let stored = null;

  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    // Private mode can throw on access. Fall through to the default.
    stored = null;
  }

  if (stored !== "light" && stored !== "dark" && stored !== "auto") {
    stored = "dark";
  }

  let resolved = stored;
  if (stored === "auto") {
    resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  document.documentElement.dataset.theme = resolved;
  // The preference itself is kept separately so the toggle can show "Auto"
  // rather than whatever auto happened to resolve to.
  document.documentElement.dataset.themePreference = stored;

  /* --- What every page needs to switch it ---------------------------------
   *
   * The cycle, the icons and the writing-down were in app.js, which the diagram
   * page does not load — so that page had no way to change the theme at all,
   * and adding one there would have meant a second copy of the cycle for the
   * two to disagree about. This file already runs on every page that has a
   * theme, so it is where the answer lives.
   */
  const CYCLE = ["dark", "light", "auto"];
  const META = {
    dark: { icon: "ph-moon", label: "Dark theme", next: "light" },
    light: { icon: "ph-sun", label: "Light theme", next: "auto" },
    auto: { icon: "ph-circle-half", label: "Theme follows your system", next: "dark" }
  };
  const COLORS = { dark: "#06090a", light: "#f4f8f7" };

  const preference = () => {
    const held = document.documentElement.dataset.themePreference;
    return CYCLE.includes(held) ? held : "dark";
  };

  // The concrete theme in force, with "auto" already resolved.
  const active = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

  const resolve = (want) => {
    if (want !== "auto") {
      return want;
    }

    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  };

  // Writes the choice down and puts it on the page. Returns what it resolved
  // to, because a caller that has to redraw something wants to know whether the
  // colours actually moved.
  function apply(want) {
    const next = CYCLE.includes(want) ? want : "dark";
    const settled = resolve(next);

    document.documentElement.dataset.themePreference = next;
    document.documentElement.dataset.theme = settled;

    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      // Private mode. The choice still holds for this page session.
    }

    const tag = document.querySelector('meta[name="theme-color"]');
    if (tag) {
      tag.setAttribute("content", COLORS[settled]);
    }

    return settled;
  }

  /* A button that shows the theme and cycles it.
   *
   * Says what it is now and what the click will do, because an icon on its own
   * cannot: a moon could mean "it is dark" or "make it dark", and which of
   * those it means is the whole of knowing what pressing it does.
   */
  function dress(button) {
    if (!button) {
      return;
    }

    const meta = META[preference()];
    const icon = button.querySelector("i");
    if (icon) {
      icon.className = `ph ${meta.icon}`;
    }

    const label = `${meta.label}. Switch to ${META[meta.next].label.toLowerCase()}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    delete button.dataset.tip;
  }

  window.ThemeSwitch = {
    STORAGE_KEY,
    CYCLE,
    META,
    COLORS,
    preference,
    active,
    resolve,
    apply,
    dress
  };
})();
