/* The two places the app can be — Documents and Links — and the two trash
 * views behind them.
 *
 * Moving between them is not a page load, so every part of the screen that
 * belongs to the place being left has to be taken down and every part of the
 * one being entered put up, in the right order and with the address bar kept
 * honest. When a move fails halfway the rollback below puts it all back.
 */
(function (global) {

const { elements } = global.AppDom;
const { state } = global.AppState;
const { showLinksInUrl, showDocumentInUrl } = global.AppLocation;
const { setMeta } = global.AppShell;
const { setStatus } = global.AppNotify;
const { renderLinks, refreshLinks, showLinksLoading } = global.AppLinks;
const { resetJumpNavigation } = global.AppJump;
const { syncSearchInputState } = global.AppSearchPanel;
const { updateActiveDocUI } = global.AppViewerHeader;
const { syncModeUI, showLoadingState, showNoDocumentOpen } = global.AppDocs;
const { renderDocList } = global.AppTree;
const { openDocument, refreshDeletedDocs } = global.AppOpening;
const { refreshDocs } = global.AppRefresh;
const { pageEditActive } = global.AppPageBlocks;
const { cancelPageEdit } = global.AppPageEdit;

/* A switch that has to wait says so.
 *
 * Only ever set around a real round trip: a move that is already in memory
 * finishes in the same frame, and a spinner that appears and vanishes inside
 * one frame is a flicker rather than an answer.
 */
function setPlaceBusy(place, busy) {
  const button = place === "links" ? elements.placeLinksBtn : elements.placeDocsBtn;
  if (!button) {
    return;
  }

  const icon = button.querySelector("i");
  if (icon) {
    icon.className = busy
      ? "ph ph-circle-notch"
      : place === "links" ? "ph ph-link-simple" : "ph ph-files";
  }

  button.classList.toggle("is-busy", busy);
  if (busy) {
    button.setAttribute("aria-busy", "true");
  } else {
    button.removeAttribute("aria-busy");
  }
}

/* The one search box goes with you, and each place keeps its own query.
 *
 * Called on the way through, while both the place being left and the place
 * being entered are still known — the box is read for one and written for the
 * other in the same breath, so neither query can be lost to a half-done swap.
 */
function stashSearchQuery(from, to) {
  const slot = (mode) => (mode === "links" ? "links" : "docs");

  state.searchQueries[slot(from)] = elements.searchInput.value;
  state.searchMetas[slot(from)] = elements.searchMeta.textContent;

  elements.searchInput.value = state.searchQueries[slot(to)] || "";
  syncSearchInputState(elements.searchInput.value);
}

/* The sidebar tree, redrawn from the list already in memory.
 *
 * No search runs: state.filteredDocs is exactly what it was before the links
 * pane went over it, and the line under the title was put down together with
 * the query it belongs to.
 */
function restoreDocumentList() {
  renderDocList();
  setMeta(state.searchMetas.docs || `${state.filteredDocs.length} document(s)`);
}

/* Put the document view back exactly as the links pane found it.
 *
 * Nothing was torn down to show the links: syncModeUI only takes the "visible"
 * class off the article, so the rendered markdown, its diagrams and its
 * pan-zoom instances are all still in the DOM. Coming back is that class going
 * back on, the tree redrawn, and the scroll put back — no request, and nothing
 * rendered twice.
 *
 * It used to refetch the library, re-read every document to warm the search
 * cache, and force-reload and re-render the open one, which is a long way to
 * go to arrive where you already were.
 */
function restoreDocumentView() {
  restoreDocumentList();

  if (!state.activeFile || !elements.docContent.innerHTML) {
    showNoDocumentOpen();
    return;
  }

  elements.docContent.classList.add("visible");
  elements.emptyState.style.display = "none";
  updateActiveDocUI(state.activeFile);

  if (elements.viewer) {
    elements.viewer.scrollTop = state.viewerScrollTop;
  }
}

/* Undo a move that could not be made.
 *
 * Its own function because everything it restores was read before the await
 * that failed. A rollback that read the state it is undoing would be putting
 * back whatever the failed move had already written.
 */
function rollbackPlace(mode, query, message) {
  state.viewMode = mode;
  elements.searchInput.value = query;
  syncSearchInputState(query);
  syncModeUI();
  setStatus(message, "error");
}

/* Move to one of the two halves of the library.
 *
 * Not a toggle. Pressing Links while already among the links does nothing,
 * which is the only thing a control that also says where you are can mean. The
 * recycle bin and the archive keep their toggles below: those are a detour
 * from the documents, not a place you live.
 *
 * `push` is false when the browser did the navigating, so going back does not
 * push the entry it just came from.
 */
async function goToPlace(place, { push = true, openFile = null } = {}) {
  const target = place === "links" ? "links" : "docs";

  if (state.viewMode === target) {
    return true;
  }

  // Leaving takes the document being edited off the screen, so it has to ask
  // the same question closing the editor would — and before anything else, so
  // nothing is written back based on a view that moved while the question was
  // on screen.
  if (pageEditActive()) {
    const left = await cancelPageEdit({ restore: false });
    if (!left) {
      return false;
    }
  }

  const previousMode = state.viewMode;
  const previousQuery = elements.searchInput.value;

  // Read before syncModeUI hides the article: once it is display:none the
  // browser has forgotten where it was scrolled to.
  if (previousMode !== "links" && elements.viewer) {
    state.viewerScrollTop = elements.viewer.scrollTop;
  }

  try {
    state.viewMode = target;
    stashSearchQuery(previousMode, target);
    syncModeUI();
    resetJumpNavigation();

    if (target === "links") {
      if (push) {
        showLinksInUrl();
      }

      state.linkFilter = elements.searchInput.value;

      // Already in memory: render and be done. Only a first visit waits, and
      // only a first visit says it is waiting.
      if (state.linksLoaded) {
        renderLinks();
        return true;
      }

      setPlaceBusy("links", true);
      showLinksLoading();

      try {
        await refreshLinks();
      } finally {
        setPlaceBusy("links", false);
      }

      return true;
    }

    if (push) {
      // Back where the document was. The address and the screen agree from
      // the first frame rather than after a round trip.
      showDocumentInUrl(state.activeFile);
    }

    // The library is already loaded and the document is still rendered under
    // the links pane, so there is nothing to fetch and nothing to draw twice.
    //
    // Only from the links. The recycle bin and the archive replaced the tree
    // and the filtered list with deleted entries, so coming back from one of
    // those is a real reload however much is in memory.
    const wanted = openFile || state.activeFile;
    if (previousMode === "links" && state.docs.length > 0) {
      // Unless Back landed on a different document than the one that was open,
      // which is one request at most and usually none — its content is already
      // in the cache.
      if (wanted && wanted !== state.activeFile && state.docs.some((doc) => doc.file === wanted)) {
        restoreDocumentList();
        await openDocument(wanted, false);
        return true;
      }

      restoreDocumentView();
      return true;
    }

    // Nothing loaded: this tab booted straight into /links, or came back to a
    // document by name. That is a real wait, so it looks like one.
    setPlaceBusy("docs", true);
    setMeta("Loading documents...");
    showLoadingState("Opening the library", "Fetching your documents.");

    try {
      await refreshDocs({ openFile, preserveSearch: true });
    } finally {
      setPlaceBusy("docs", false);
    }

    return true;
  } catch (error) {
    rollbackPlace(previousMode, previousQuery, error.message);
    return false;
  }
}

// Both trash-view toggles flip between their own mode and "docs", so they share one handler.
async function switchViewMode(targetMode) {
  // Leaving the documents view takes the document being edited off the screen,
  // so it has to ask the same question closing the editor would. Asked before
  // the modes are read, so what is written back cannot be based on a view that
  // moved on while the question was on screen.
  if (pageEditActive()) {
    const left = await cancelPageEdit({ restore: false });
    if (!left) {
      return;
    }
  }

  const previousMode = state.viewMode;
  const nextMode = previousMode === targetMode ? "docs" : targetMode;

  try {
    state.viewMode = nextMode;

    // The recycle bin and the archive can be opened from the links pane, which
    // means this is also a way out of it: the search box goes back to being
    // about documents, and the address stops claiming to be /links.
    if (previousMode === "links") {
      stashSearchQuery("links", "docs");
      showDocumentInUrl(state.activeFile);
    }

    syncModeUI();
    resetJumpNavigation();

    if (nextMode === "docs") {
      await refreshDocs({ preserveSearch: false });
      setStatus("Returned to markdowns.", "neutral");
      return;
    }

    await refreshDeletedDocs({ preserveSearch: false });
    setStatus(nextMode === "archive" ? "Archive opened." : "Recycle bin opened.", "success");
  } catch (error) {
    // Rollback to a value captured before the await.
    // eslint-disable-next-line require-atomic-updates
    state.viewMode = previousMode;
    syncModeUI();
    setStatus(error.message, "error");
  }
}

// The buttons that move between the four of them.
function bindPlaceSwitcher() {
  elements.toggleRecycleBinBtn.addEventListener("click", () => {
    void switchViewMode("recycle");
  });

  elements.toggleArchiveBtn.addEventListener("click", () => {
    void switchViewMode("archive");
  });

  /* The switcher's two halves are real links, so they can be copied, opened in a
   * new tab and dropped in a bookmark. An ordinary click is handled in-page
   * instead: nothing here needs a reload, and a reload would throw away the
   * library that is already loaded. */
  function bindPlaceButton(button, place) {
    button.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
        || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      void goToPlace(place);
    });
  }

  bindPlaceButton(elements.placeDocsBtn, "docs");
  bindPlaceButton(elements.placeLinksBtn, "links");
}

global.AppPlaces = {
  setPlaceBusy, stashSearchQuery, restoreDocumentList, restoreDocumentView,
  rollbackPlace, goToPlace, switchViewMode, bindPlaceSwitcher
};

})(typeof window === "undefined" ? globalThis : window);
