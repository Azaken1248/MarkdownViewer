// The address bar.
//
// A document's address is its path: /Notes/day-one.md. It used to be a
// fragment, /#Notes/day-one.md, which no server ever sees — so the URL was
// really just a note the client left itself, and the page it named only
// appeared because the client read it back.
//
// Navigation is still entirely in-page. pushState changes the address without
// fetching anything; the server route of the same name exists only for when
// that address is typed, refreshed or opened from a link somewhere else.

(function (global) {
  const { docUrl, UPLOADABLE_EXTENSIONS } = global.AppText;

  function documentPath(file) {
    return `/${docUrl(file)}`;
  }

  /* The saved links are a place, so they have an address.
   *
   * Without one they were a mode you could only be put into by pressing a
   * button: not linkable, not bookmarkable, gone on a refresh, and invisible to
   * the back button — so leaving them was the one navigation in this app the
   * browser could not undo.
   */
  const LINKS_PATH = "/links";

  function viewFromLocation() {
    return window.location.pathname.replace(/\/+$/, "").toLowerCase() === LINKS_PATH ? "links" : "docs";
  }

  function showLinksInUrl({ replace = false } = {}) {
    if (window.location.pathname === LINKS_PATH && !window.location.hash) {
      return;
    }

    window.history[replace ? "replaceState" : "pushState"]({ view: "links" }, "", LINKS_PATH);
  }

  // The document a URL names, or null for the app's own root.
  function fileFromLocation() {
    const fromPath = decodePathFile(window.location.pathname);
    if (fromPath) {
      return fromPath;
    }

    // Links from before this existed, and anything that still points at one.
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) {
      return null;
    }

    try {
      return decodeURIComponent(hash) || null;
    } catch {
      return null;
    }
  }

  function decodePathFile(pathname) {
    const raw = String(pathname || "").replace(/^\/+/, "");
    if (!raw) {
      return null;
    }

    try {
      const file = raw.split("/").map(decodeURIComponent).join("/");
      // A path is only a document if it could name one. Anything else is the
      // app's own root by another name.
      const lower = file.toLowerCase();
      return UPLOADABLE_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? file : null;
    } catch {
      return null;
    }
  }

  // Called when the open document changes, not when the URL does.
  function showDocumentInUrl(file, { replace = false } = {}) {
    const next = file ? documentPath(file) : "/";
    if (next === window.location.pathname && !window.location.hash) {
      return;
    }

    // The hash goes with it: an address cannot be half in each place.
    window.history[replace ? "replaceState" : "pushState"]({ file: file || null }, "", next);
  }

  global.AppLocation = {
    documentPath,
    viewFromLocation,
    showLinksInUrl,
    fileFromLocation,
    showDocumentInUrl
  };
})(typeof window === "undefined" ? globalThis : window);
