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

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { docName, isNotebookFile } = global.AppText;
  const { renderDocumentContent, renderMermaidBlocks, waitForNextFrame, destroyPanZoomInstances } = global.AppRender;
  const { loadDocContent, loadDeletedDocContent, fetchDeletedDocs, showEmptyState, hydrateDeletedSearchContent } = global.AppDocs;
  const { updateActiveDocUI } = global.AppViewerHeader;
  const { updateActiveRowHighlight } = global.AppTree;
  const { jumpToSearchMatch, resetJumpNavigation } = global.AppJump;
  const { showDocumentInUrl } = global.AppLocation;
  const { setMeta } = global.AppShell;
  const { bindTaskCheckboxes } = global.AppTaskLists;
  const { setStatus } = global.AppNotify;
  const { applySearch } = global.AppSearching;

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

      const jumpQuery = String(options.jumpQuery || "");
      const jumpTerms = Array.isArray(options.jumpTerms) ? options.jumpTerms : [];
      const jumpIndex = Number.isFinite(Number(options.jumpIndex)) ? Number(options.jumpIndex) : 0;
      const scrollBehavior = String(options.scrollBehavior || "auto");
      const hasJumpQuery = jumpQuery.trim().length > 0;
      const forceReload = Boolean(options.forceReload);

      if (file === state.activeFile && elements.docContent.classList.contains("visible") && !forceReload) {
        let jumpResult = {
          found: false,
          index: -1,
          total: 0
        };

        if (hasJumpQuery) {
          jumpResult = jumpToSearchMatch(jumpQuery, jumpTerms, jumpIndex, {
            sourceFile: file,
            scrollBehavior
          });
        } else {
          resetJumpNavigation();
        }

        if (requestId !== state.openDocumentRequestId) {
          return;
        }

        document.title = `${doc.title} | AzaDocs`;
        // Push when someone asked for this document, replace when the app
        // simply landed on it, so the address always names what is on screen
        // without inventing history entries nobody navigated to.
        showDocumentInUrl(file, { replace: !pushHash });

        if (hasJumpQuery) {
          if (jumpResult.found) {
            setStatus(`Viewing ${docName(doc.file)}. Match ${jumpResult.index + 1} of ${jumpResult.total} for "${jumpQuery.trim()}".`, "success");
          } else {
            setStatus(`Viewing ${docName(doc.file)}. Could not find "${jumpQuery.trim()}" in rendered content.`, "neutral");
          }
          return;
        }

        setStatus(`Viewing ${docName(doc.file)}`, "neutral");
        return;
      }

      const rawContent = await loadDocContent(file, { forceReload });
      if (requestId !== state.openDocumentRequestId) {
        return;
      }

      const safeHtml = renderDocumentContent(file, rawContent, doc.title || file);

      elements.docContent.classList.toggle("notebook-viewer", isNotebookFile(file));

      destroyPanZoomInstances(elements.docContent);
      elements.docContent.innerHTML = safeHtml;
      elements.docContent.classList.add("visible");
      elements.emptyState.style.display = "none";
      bindTaskCheckboxes(file, rawContent);

      // Claim the document the moment its content is on screen. Waiting until after
      // Mermaid finishes left a multi-second window on diagram-heavy files where the
      // Edit and Delete buttons still pointed at the previously open document.
      state.activeFile = file;
      // Selection-only change: repaint the highlight, don't rebuild the list.
      updateActiveRowHighlight();
      updateActiveDocUI(file);
      document.title = `${doc.title} | AzaDocs`;
      showDocumentInUrl(file, { replace: !pushHash });

      await waitForNextFrame();

      if (requestId !== state.openDocumentRequestId) {
        return;
      }

      let jumpResult = {
        found: false,
        index: -1,
        total: 0
      };

      if (hasJumpQuery) {
        jumpResult = jumpToSearchMatch(jumpQuery, jumpTerms, jumpIndex, {
          sourceFile: file,
          scrollBehavior
        });
      } else {
        resetJumpNavigation();
      }

      await renderMermaidBlocks(elements.docContent);
      if (requestId !== state.openDocumentRequestId) {
        return;
      }

      if (hasJumpQuery) {
        if (jumpResult.found) {
          setStatus(`Viewing ${docName(doc.file)}. Match ${jumpResult.index + 1} of ${jumpResult.total} for "${jumpQuery.trim()}".`, "success");
        } else {
          setStatus(`Viewing ${docName(doc.file)}. Could not find "${jumpQuery.trim()}" in rendered content.`, "neutral");
        }
        return;
      }

      setStatus(`Viewing ${docName(doc.file)}`, "neutral");
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

  global.AppOpening = {
    openDocument,
    openRecycleBinDocument,
    refreshDeletedDocs
  };
})(typeof window === "undefined" ? globalThis : window);
