/* The search box, and walking the matches inside an open document.
 *
 * Two jobs that are really one: typing in the box filters the list, and once a
 * document is open the same words become a set of highlights that Enter, the
 * prev/next buttons and the little floating bar step through. Leaving search
 * mode has to undo both at once, which is why they live together.
 */
(function (global) {

const { normalize } = global.AppText;
const { elements } = global.AppDom;
const { state } = global.AppState;
const { buildJumpSearchTerms } = global.AppSearch;
const { closeSidebarOnMobile } = global.AppShell;
const { setStatus } = global.AppNotify;
const { moveToAdjacentJumpMatch } = global.AppJump;
const { setSuperSearchOpen } = global.AppSearchPanel;
const { applySearch } = global.AppSearching;
const { openDocument, openRecycleBinDocument } = global.AppOpening;

function mountMatchNavToViewportLayer() {
  if (!elements.matchNav) {
    return;
  }

  // Keep controls pinned to viewport even when shell has visual effects.
  if (elements.matchNav.parentElement !== document.body) {
    document.body.appendChild(elements.matchNav);
  }
}

function handleSearchEvent(event) {
  const query = event.target.value;
  if (state.searchInputTimer) {
    window.clearTimeout(state.searchInputTimer);
  }

  state.searchInputTimer = window.setTimeout(() => {
    state.searchInputTimer = null;
    void applySearch(query);
  }, 160);
}

function exitSearchMode() {
  const hadQuery = Boolean(state.jumpQuery.trim() || elements.searchInput.value.trim());
  if (state.searchInputTimer) {
    window.clearTimeout(state.searchInputTimer);
    state.searchInputTimer = null;
  }

  elements.searchInput.value = "";
  void applySearch("");
  setSuperSearchOpen(false);

  if (hadQuery) {
    setStatus("Search mode closed.", "neutral");
  }
}

async function navigateMatches(direction, queryLabel = state.jumpQuery) {
  const result = await moveToAdjacentJumpMatch(direction);
  if (!result.found) {
    setStatus("No searchable matches for the current query.", "neutral");
    return result;
  }

  if (result.docChanged && result.file) {
    setStatus(`Moved to ${result.file}. Match ${result.index + 1} of ${result.total} for "${queryLabel}".`, "success");
    return result;
  }

  setStatus(`Match ${result.index + 1} of ${result.total} for "${queryLabel}".`, "success");
  return result;
}

// Everything above, wired to the box and the buttons.
function bindSearchInput() {
  // "input" already covers typing, pasting, and the clear button on a search field.
  // "search" and "change" only re-fired the same debounced query, and the focus
  // handler ran an undebounced full search every time the field was clicked.
  elements.searchInput.addEventListener("input", handleSearchEvent);

  elements.searchInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    const query = elements.searchInput.value.trim();
    if (!query) {
      return;
    }

    // Everything below opens a document. In the links pane the filtering has
    // already happened as the words were typed, so Enter has nothing left to do.
    if (state.viewMode === "links") {
      return;
    }

    const canTraverseMatches = !state.isRecycleBinMode
      && state.activeFile
      && state.jumpQuery.trim().length > 0
      && normalize(query) === normalize(state.jumpQuery);

    if (canTraverseMatches) {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      await navigateMatches(direction, query);
      return;
    }

    if (state.searchResults.length > 0 && normalize(query) === normalize(state.searchResultsQuery)) {
      event.preventDefault();
      if (state.isRecycleBinMode) {
        await openRecycleBinDocument(state.searchResults[0].file);
      } else {
        await openDocument(state.searchResults[0].file, true, {
          jumpQuery: query,
          jumpTerms: buildJumpSearchTerms(query)
        });
      }

      closeSidebarOnMobile();
      setSuperSearchOpen(false);
    }
  });

  elements.clearFilterBtn?.addEventListener("click", () => {
    exitSearchMode();
    elements.searchInput.focus();
  });

  elements.matchPrevBtn.addEventListener("click", async () => {
    await navigateMatches(-1, state.jumpQuery);
  });

  elements.matchNextBtn.addEventListener("click", async () => {
    await navigateMatches(1, state.jumpQuery);
  });

  elements.matchCloseBtn.addEventListener("click", () => {
    exitSearchMode();
  });
}

global.AppMatchNav = {
  mountMatchNavToViewportLayer, handleSearchEvent, exitSearchMode, navigateMatches,
  bindSearchInput
};

})(typeof window === "undefined" ? globalThis : window);
