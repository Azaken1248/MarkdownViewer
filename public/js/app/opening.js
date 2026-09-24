/* Opening a document.
 *
 * One path for the library and one for the recycle bin, because a deleted
 * document is read from a different place and offers different buttons, but
 * both end the same way: content on the screen, the row highlighted, the
 * address bar saying where you are.
 *
 * Every open is stamped with a request id. A slow document that arrives after
 * you have moved on must not paint itself over the one you are reading.
 */

/* exported AppOpening */
var AppOpening = (function () {
  const { elements } = AppDom;
  const { state } = AppState;
  const { docName, isNotebookFile } = AppText;
  const { renderDocumentContent, renderMermaidBlocks, waitForNextFrame, destroyPanZoomInstances } = AppRender;
  const { loadDocContent, loadDeletedDocContent, fetchDeletedDocs, showEmptyState, hydrateDeletedSearchContent } = AppDocs;
  const { updateActiveDocUI } = AppViewerHeader;
  const { updateActiveRowHighlight } = AppTree;
  const { jumpToSearchMatch, resetJumpNavigation } = AppJump;
  const { showDocumentInUrl } = AppLocation;
  const { setMeta } = AppShell;
  const { bindTaskCheckboxes } = AppTaskLists;
  const { setStatus } = AppNotify;
  const { applySearch } = AppSearching;

  const NO_MATCH = { found: false, index: -1, total: 0 };

  // What the caller asked to find in the document it is opening, if anything.
  function jumpAsked(options) {
    const jumpQuery = String(options.jumpQuery || "");

    return {
      jumpQuery,
      jumpTerms: Array.isArray(options.jumpTerms) ? options.jumpTerms : [],
      jumpIndex: Number.isFinite(Number(options.jumpIndex)) ? Number(options.jumpIndex) : 0,
      scrollBehavior: String(options.scrollBehavior || "auto"),
      hasJumpQuery: jumpQuery.trim().length > 0
    };
  }

  // Mark it, or take the last search's marks off. Both leave the navigation in
  // step with what is on screen, which is the point of doing either.
  function lookForTheMatch(file, asked) {
    if (!asked.hasJumpQuery) {
      resetJumpNavigation();
      return NO_MATCH;
    }

    return jumpToSearchMatch(asked.jumpQuery, asked.jumpTerms, asked.jumpIndex, {
      sourceFile: file,
      scrollBehavior: asked.scrollBehavior
    });
  }

  // The line at the bottom: what is open, and — when something was being
  // looked for — whether it was found.
  function sayWhatIsOpen(doc, jumpQuery, jumpResult) {
    if (!jumpResult) {
      setStatus(`Viewing ${docName(doc.file)}`, "neutral");
      return;
    }

    setStatus(jumpResult.found
      ? `Viewing ${docName(doc.file)}. Match ${jumpResult.index + 1} of ${jumpResult.total} for "${jumpQuery.trim()}".`
      : `Viewing ${docName(doc.file)}. Could not find "${jumpQuery.trim()}" in rendered content.`,
    jumpResult.found ? "success" : "neutral");
  }

  /* The document itself, on the screen.
   *
   * The app claims the document the moment its content is up. Waiting until
   * after Mermaid finished left a multi-second window on diagram-heavy files
   * where the Edit and Delete buttons still pointed at the last one open.
   */
  function putDocumentOnScreen(file, doc, rawContent, pushHash) {
    const safeHtml = renderDocumentContent(file, rawContent, doc.title || file);

    elements.docContent.classList.toggle("notebook-viewer", isNotebookFile(file));
    destroyPanZoomInstances(elements.docContent);

    // renderDocumentContent runs marked and then DOMPurify (md/text.js); what
    // comes back has been through the sanitizer with this app's allowlist,
    // which is the whole reason it is called safeHtml.
    // eslint-disable-next-line no-unsanitized/property
    elements.docContent.innerHTML = safeHtml;
    elements.docContent.classList.add("visible");
    elements.emptyState.style.display = "none";
    bindTaskCheckboxes(file, rawContent);

    state.activeFile = file;
    // Selection-only change: repaint the highlight, don't rebuild the list.
    updateActiveRowHighlight();
    updateActiveDocUI(file);
    document.title = `${doc.title} | AzaDocs`;
    showDocumentInUrl(file, { replace: !pushHash });
  }

  /* The document is already up: this is only the search and the address.
   *
   * The address is pushed when somebody asked for this document and replaced
   * when the app simply landed on it, so it always names what is on screen
   * without inventing history entries nobody navigated to.
   */
  function searchWhatIsAlreadyOpen(file, doc, pushHash, requestId, asked) {
    const jumpResult = lookForTheMatch(file, asked);

    if (requestId !== state.openDocumentRequestId) {
      return;
    }

    document.title = `${doc.title} | AzaDocs`;
    showDocumentInUrl(file, { replace: !pushHash });
    sayWhatIsOpen(doc, asked.jumpQuery, asked.hasJumpQuery ? jumpResult : null);
  }

  /* Fetch it, put it up, then look for the match and draw the diagrams.
   *
   * Checked against the request id at every await: opening two documents
   * quickly must leave the second one on screen, and the first one's answer
   * arriving late must not overwrite it.
   */
  async function fetchAndShow(file, doc, { pushHash, forceReload, asked, requestId }) {
    const stale = () => requestId !== state.openDocumentRequestId;

    const rawContent = await loadDocContent(file, { forceReload });
    if (stale()) {
      return;
    }

    putDocumentOnScreen(file, doc, rawContent, pushHash);

    await waitForNextFrame();
    if (stale()) {
      return;
    }

    const jumpResult = lookForTheMatch(file, asked);

    await renderMermaidBlocks(elements.docContent);
    if (stale()) {
      return;
    }

    sayWhatIsOpen(doc, asked.jumpQuery, asked.hasJumpQuery ? jumpResult : null);
  }

  async function openDocument(file, pushHash, options = {}) {
    // Opening something else while the page is being edited would replace the
    // edits with another document and say nothing about it.
    if (App.pageEditActive() && file !== state.pageEdit.file) {
      const left = await App.cancelPageEdit({ restore: false });
      if (!left) {
        return;
      }
    }

    const requestId = ++state.openDocumentRequestId;

    try {
      const doc = state.docs.find((candidate) => candidate.file === file);
      if (!doc) {
        return;
      }

      const asked = jumpAsked(options);
      const forceReload = Boolean(options.forceReload);

      // Already on screen: nothing to fetch and nothing to render, so this is
      // only the search and the address.
      const alreadyOpen = file === state.activeFile
        && elements.docContent.classList.contains("visible")
        && !forceReload;

      if (alreadyOpen) {
        searchWhatIsAlreadyOpen(file, doc, pushHash, requestId, asked);
        return;
      }

      await fetchAndShow(file, doc, { pushHash, forceReload, asked, requestId });
    } catch (error) {
      if (requestId !== state.openDocumentRequestId) {
        return;
      }

      showEmptyState(isNotebookFile(file) ? "Could not load this notebook" : "Could not load this markdown", error.message, "ph-warning");
      setStatus(error.message, "error");
    }
  }

  async function openRecycleBinDocument(file, options = {}) {
    try {
      const doc = state.deletedDocs.find((candidate) => candidate.file === file);
      if (!doc) {
        return;
      }

      const rawContent = await loadDeletedDocContent(file, { forceReload: Boolean(options.forceReload) });
      const originalFile = doc.originalFile || doc.file;
      const safeHtml = renderDocumentContent(originalFile, rawContent, doc.title || originalFile);

      elements.docContent.classList.toggle("notebook-viewer", isNotebookFile(originalFile));

      destroyPanZoomInstances(elements.docContent);
      // renderDocumentContent runs marked and then DOMPurify (md/text.js);
      // what comes back has been through the sanitizer with this app's
      // allowlist, which is the whole reason it is called safeHtml.
      // eslint-disable-next-line no-unsanitized/property
      elements.docContent.innerHTML = safeHtml;
      elements.docContent.classList.add("visible");
      elements.emptyState.style.display = "none";

      // Same reason as openDocument: claim it before the async Mermaid pass.
      // Assigning after the earlier await is deliberate, not a race.
      // eslint-disable-next-line require-atomic-updates
      state.activeFile = file;
      // Selection-only change: repaint the highlight, don't rebuild the list.
      updateActiveRowHighlight();
      updateActiveDocUI(file);

      await waitForNextFrame();
      await renderMermaidBlocks(elements.docContent);

      document.title = state.viewMode === "archive"
        ? `${doc.title} | Archive | AzaDocs`
        : `${doc.title} | Recycle Bin | AzaDocs`;
      setStatus(state.viewMode === "archive"
        ? `Viewing archived doc ${doc.originalFile || doc.file}`
        : `Viewing deleted doc ${doc.originalFile || doc.file}`, "neutral");
    } catch (error) {
      showEmptyState("Could not load deleted document", error.message, "ph-warning");
      setStatus(error.message, "error");
    }
  }

  async function refreshDeletedDocs({ openFile = null, preserveSearch = true } = {}) {
    const inArchive = state.viewMode === "archive";
    setMeta(inArchive ? "Loading archive..." : "Loading recycle bin...");

    await fetchDeletedDocs();
    void hydrateDeletedSearchContent();

    const query = preserveSearch ? elements.searchInput.value : "";
    if (!preserveSearch) {
      elements.searchInput.value = "";
    }

    await applySearch(query);

    if (state.deletedDocs.length === 0) {
      state.activeFile = null;
      updateActiveDocUI(null);
      if (inArchive) {
        showEmptyState("Archive is empty", "Archived markdowns will appear here.", "ph-archive-box");
        setStatus("Archive is empty.", "neutral");
      } else {
        showEmptyState("Recycle bin is empty", "Soft-deleted markdowns will appear here.", "ph-trash");
        setStatus("Recycle bin is empty.", "neutral");
      }
      return;
    }

    const target = state.deletedDocs.find((doc) => doc.file === openFile)?.file
      || state.deletedDocs.find((doc) => doc.file === state.activeFile)?.file
      || null;

    if (!target) {
      state.activeFile = null;
      showDocumentInUrl(null, { replace: true });
      updateActiveDocUI(null);
      // No toast here: the empty state on screen already says this, and a toast
      // that fires on every refresh is what teaches people to ignore toasts.
      showEmptyState("No file selected", "Choose a deleted file from the explorer to read it.", "ph-trash");
      return;
    }

    await openRecycleBinDocument(target, { forceReload: true });
  }

  return {
    openDocument,
    openRecycleBinDocument,
    refreshDeletedDocs
  };
})();
