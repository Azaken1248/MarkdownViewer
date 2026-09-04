/* Running a search.
 *
 * One query, answered in two places at once: the panel of documents that
 * match, and the tree, which is filtered down to the same set so that the
 * sidebar and the results never disagree about what was found.
 *
 * The content behind the query is fetched lazily and cached, so a search that
 * has to read documents says so while it does.
 */

(function (global) {
  const { state } = global.AppState;
  const { normalize, filenameToTitle, inferIcon } = global.AppText;
  const { requestJson } = global.AppApi;
  const { getCurrentDocsCollection, getFolderOrder } = global.AppLibrary;
  const { buildSuperSearchMatches, buildJumpSearchTerms } = global.AppSearch;
  const { renderSuperSearchPanel, setSuperSearchOpen } = global.AppSearchPanel;
  const { setMeta } = global.AppShell;
  const { resetJumpNavigation } = global.AppJump;
  const { renderDocList } = global.AppTree;
  const { renderLinks } = global.AppLinks;
  const { setStatus } = global.AppNotify;

  async function applySearch(query) {
    const rawQuery = String(query || "");

    // In the links pane the search box filters links, and everything below here
    // is about documents — the tree, the results panel, the jump navigation.
    // None of it has anything to say about a list of URLs.
    if (state.viewMode === "links") {
      state.linkFilter = rawQuery;
      setSuperSearchOpen(false);
      renderLinks();
      return;
    }

    const q = normalize(rawQuery).trim();
    const currentDocs = getCurrentDocsCollection();

    if (q !== normalize(state.jumpQuery)) {
      resetJumpNavigation();
    }

    if (!q) {
      state.searchRequestId += 1;
      state.groupRevealCounts.clear();
      state.filteredDocs = [...currentDocs];
      setMeta(state.viewMode === "archive"
        ? `${state.filteredDocs.length} archived document(s)`
        : state.viewMode === "recycle"
          ? `${state.filteredDocs.length} deleted document(s)`
          : `${state.filteredDocs.length} document(s)`);
      renderSuperSearchPanel(rawQuery, [], []);
      renderDocList();
      return;
    }

    const requestId = ++state.searchRequestId;
    const searchScope = state.viewMode === "archive"
      ? "archive"
      : state.viewMode === "recycle"
        ? "recycle-bin"
        : "docs";
    const contextLabel = searchScope === "archive"
      ? "archive"
      : searchScope === "recycle-bin"
        ? "recycle bin"
        : "documents";
    setMeta(`Searching ${contextLabel}...`);

    try {
      const payload = await requestJson(`/api/docs/search?scope=${encodeURIComponent(searchScope)}&q=${encodeURIComponent(rawQuery)}`, { cache: "no-store" });
      if (requestId !== state.searchRequestId) {
        return;
      }

      const matches = (payload.matches || []).map((match) => ({
        file: match.file,
        originalFile: match.originalFile || "",
        title: match.title || filenameToTitle(match.originalFile || match.file),
        size: Number(match.size || 0),
        updatedAt: match.updatedAt || match.deletedAt || "",
        deletedAt: match.deletedAt || match.updatedAt || "",
        folderId: match.folderId || null,
        folderName: match.folderName || null,
        folderOrder: Number.isFinite(Number(match.folderOrder)) ? Number(match.folderOrder) : getFolderOrder(match.folderId),
        icon: inferIcon(match.originalFile || match.file),
        snippet: match.snippet || "No preview available."
      }));

      const searchTerms = buildJumpSearchTerms(rawQuery, payload.searchTerms || []);
      state.groupRevealCounts.clear();
      state.filteredDocs = matches;
      renderSuperSearchPanel(rawQuery, matches, searchTerms);
      setMeta(`${matches.length} result(s) in ${contextLabel} for "${rawQuery.trim()}"`);
      renderDocList();
    } catch (error) {
      if (requestId !== state.searchRequestId) {
        return;
      }

      console.error(error);
      const fallback = buildSuperSearchMatches(rawQuery, currentDocs);
      const matches = fallback.matches.map((match) => ({
        file: match.file,
        originalFile: match.originalFile || "",
        title: match.title || filenameToTitle(match.originalFile || match.file),
        size: Number(match.size || 0),
        updatedAt: match.updatedAt || match.deletedAt || "",
        deletedAt: match.deletedAt || match.updatedAt || "",
        folderId: match.folderId || null,
        folderName: match.folderName || null,
        folderOrder: Number.isFinite(Number(match.folderOrder)) ? Number(match.folderOrder) : getFolderOrder(match.folderId),
        icon: inferIcon(match.originalFile || match.file),
        snippet: match.snippet || "No preview available."
      }));

      state.groupRevealCounts.clear();
      state.filteredDocs = matches;
      renderSuperSearchPanel(rawQuery, matches, fallback.searchTerms);
      setMeta(`${matches.length} result(s) in ${contextLabel} for "${rawQuery.trim()}"`);
      renderDocList();
      setStatus("Search fell back to local metadata results.", "neutral");
    }
  }

  global.AppSearching = {
    applySearch
  };
})(typeof window === "undefined" ? globalThis : window);
