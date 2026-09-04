/* The results panel.
 *
 * The list of documents a query found, and the two lines of furniture around
 * it: the state of the search box itself, and the hint that says what Enter
 * will do — which depends on whether the document you are reading is one of
 * the matches, and was signposted nowhere.
 *
 * Choosing a result opens a document, which is the app's job, not the panel's:
 * those two calls name their module at the call site.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { escapeHtml, normalize } = global.AppText;
  const { SUPERSEARCH_LIMIT, SUPERSEARCH_PAGE_SIZE, highlightMatches } = global.AppSearch;
  const { closeSidebarOnMobile } = global.AppShell;

  function setSuperSearchOpen(isOpen) {
    state.searchPanelOpen = Boolean(isOpen);
    elements.superSearchPanel.hidden = !state.searchPanelOpen;
  }

  function syncSearchInputState(query) {
    const hasQuery = String(query || "").trim().length > 0;
    elements.searchWrap.classList.toggle("has-value", hasQuery);
  }

  // Enter does two different things depending on whether you are reading a
  // document that already matches the query, and neither was signposted
  // anywhere in the app.
  function renderSearchShortcutHint(query) {
    if (!elements.superSearchHint) {
      return;
    }

    const traversing = !state.isRecycleBinMode
      && state.activeFile
      && state.jumpQuery.trim().length > 0
      && normalize(query) === normalize(state.jumpQuery);

    elements.superSearchHint.innerHTML = traversing
      ? '<kbd>Enter</kbd> next match <span>·</span> <kbd>Shift</kbd>+<kbd>Enter</kbd> previous <span>·</span> <kbd>Esc</kbd> exit search'
      : '<kbd>Enter</kbd> open top result <span>·</span> <kbd>Esc</kbd> exit search';
  }

  function renderSuperSearchPanel(query, matches, searchTerms) {
    const trimmedQuery = String(query || "").trim();
    syncSearchInputState(query);
    renderSearchShortcutHint(trimmedQuery);

    if (!trimmedQuery) {
      state.searchResults = [];
      state.searchResultsQuery = "";
      state.searchRevealCount = SUPERSEARCH_LIMIT;
      elements.superSearchList.innerHTML = "";
      elements.superSearchCount.textContent = "0 results";
      setSuperSearchOpen(false);
      return;
    }

    // A new query starts the reveal over; re-rendering the same query (a "Show
    // more" click, a background refresh) keeps whatever the reader had unfolded.
    if (trimmedQuery !== state.searchResultsQuery) {
      state.searchRevealCount = SUPERSEARCH_LIMIT;
    }

    const revealCount = Math.min(
      Math.max(state.searchRevealCount, SUPERSEARCH_LIMIT),
      matches.length
    );
    const topResults = matches.slice(0, revealCount);
    const remaining = matches.length - topResults.length;
    state.searchResults = topResults;
    state.searchResultsQuery = trimmedQuery;
    state.searchRevealCount = revealCount;
    elements.superSearchCount.textContent = remaining > 0
      ? `Showing ${topResults.length} of ${matches.length}`
      : `${matches.length} result${matches.length === 1 ? "" : "s"}`;

    if (topResults.length === 0) {
      elements.superSearchList.innerHTML = "<li class=\"supersearch-empty\">No matches. Try fewer keywords or part of the filename.</li>";
      setSuperSearchOpen(true);
      return;
    }

    elements.superSearchList.innerHTML = topResults.map((doc) => `
      <li>
        <button class="supersearch-item" type="button" data-file="${escapeHtml(doc.file)}">
          <span class="supersearch-item-title"><i class="ph ${escapeHtml(doc.icon)}"></i>${highlightMatches(doc.title, searchTerms)}</span>
          <span class="supersearch-item-file">${highlightMatches(doc.originalFile || doc.file, searchTerms)}</span>
          <span class="supersearch-item-snippet">${highlightMatches(doc.snippet, searchTerms)}</span>
        </button>
      </li>
    `).join("");

    if (remaining > 0) {
      const more = document.createElement("li");
      more.innerHTML = `
        <button class="supersearch-more" type="button">
          <i class="ph ph-caret-down" aria-hidden="true"></i>
          <span>Show ${remaining} more</span>
        </button>
      `;
      more.querySelector(".supersearch-more").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.searchRevealCount = revealCount + SUPERSEARCH_PAGE_SIZE;
        renderSuperSearchPanel(query, matches, searchTerms);
        // Land the reader on the first newly-revealed row, not back at the top.
        const rows = elements.superSearchList.querySelectorAll(".supersearch-item");
        rows[revealCount]?.focus();
      });
      elements.superSearchList.appendChild(more);
    }

    elements.superSearchList.querySelectorAll(".supersearch-item").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const file = button.getAttribute("data-file");
        if (!file) {
          return;
        }

        if (state.isRecycleBinMode) {
          await App.openRecycleBinDocument(file);
        } else {
          await App.openDocument(file, true, {
            jumpQuery: trimmedQuery,
            jumpTerms: searchTerms
          });
        }

        closeSidebarOnMobile();
        setSuperSearchOpen(false);
      });
    });

    setSuperSearchOpen(true);
  }

  global.AppSearchPanel = {
    setSuperSearchOpen,
    syncSearchInputState,
    renderSearchShortcutHint,
    renderSuperSearchPanel
  };
})(typeof window === "undefined" ? globalThis : window);
