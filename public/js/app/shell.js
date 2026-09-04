// The sidebar's own furniture: whether it is open, whether the page behind it
// scrolls, and the line under the search box that says what the query found.
//
// The lock is computed from everything that can be over the page rather than
// set and unset by each of them, because two overlapping things that each
// turned it off on the way out would leave the page scrolling under the one
// still open.

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;

  // The width at which the sidebar stops being a column beside the page and
  // becomes a drawer over it. Matches the breakpoint the stylesheet uses.
  const MOBILE_BREAKPOINT = 920;

  function setNavOpen(isOpen) {
    elements.appShell.classList.toggle("nav-open", isOpen);
    elements.toggleSidebar.setAttribute("aria-expanded", String(isOpen));
    syncBodyLock();
  }

  function syncBodyLock() {
    const shouldLock = elements.appShell.classList.contains("nav-open") || state.editorOpen || state.confirmOpen || state.folderModalOpen
      || state.loginOpen || state.passwordOpen || state.usersOpen || state.shareOpen || state.linkModalOpen;
    document.body.classList.toggle("lock-scroll", shouldLock);
  }

  function setMeta(message) {
    elements.searchMeta.textContent = message;
    syncFilterChip();
  }

  // The results panel and the file tree are two views of one query. This chip is
  // what ties them together in the tree, and the way out of the filter without
  // hunting for the search box.
  function syncFilterChip() {
    if (!elements.clearFilterBtn) {
      return;
    }

    elements.clearFilterBtn.hidden = String(elements.searchInput.value || "").trim().length === 0;
  }

  // Anything that opens a document from the drawer closes it on the way, or the
  // reader is left looking at the list they just chose from.
  function closeSidebarOnMobile() {
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      setNavOpen(false);
    }
  }

  global.AppShell = {
    MOBILE_BREAKPOINT,
    setNavOpen,
    closeSidebarOnMobile,
    syncBodyLock,
    setMeta,
    syncFilterChip
  };
})(typeof window === "undefined" ? globalThis : window);
