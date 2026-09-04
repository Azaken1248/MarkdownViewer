// Whether the sidebar is open, and whether the page behind it scrolls.
//
// The lock is computed from everything that can be over the page rather than
// set and unset by each of them, because two overlapping things that each
// turned it off on the way out would leave the page scrolling under the one
// still open.

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;

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

  global.AppShell = {
    setNavOpen,
    syncBodyLock
  };
})(typeof window === "undefined" ? globalThis : window);
