/* The library, and the document you are reading.
 *
 * What the app knows about the corpus: the two listings it fetches, the
 * content cache under them, and the three panels shown in place of a document
 * — nothing open, still loading, nothing found.
 *
 * syncModeUI is here because "which of the three places am I in" is the same
 * question as "which listing is state.docs holding": the library, the recycle
 * bin, or the archive.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { requestJson, can } = global.AppApi;
  const { docUrl, escapeHtml, filenameToTitle, inferIcon } = global.AppText;
  const { getDocByFile, getDocCacheVersion, getFolderOrder } = global.AppLibrary;
  const { showDocumentInUrl } = global.AppLocation;
  const { updateActiveDocUI } = global.AppViewerHeader;
  const { pruneSelection } = global.AppSelection;
  const { refreshShares } = global.AppShare;
  const { applyInitialFolderCollapse } = global.AppFolderCollapse;
  const { setSuperSearchOpen } = global.AppSearchPanel;

  async function fetchDocs() {
    const payload = await requestJson("/api/docs", { cache: "no-store" });

    state.rootFolderLabel = payload.rootFolderLabel || "Ungrouped";
    state.folders = (payload.folders || []).map((folder, index) => ({
      id: folder.id,
      name: folder.name || folder.id,
      parentId: folder.parentId || null,
      depth: Number.isFinite(Number(folder.depth)) ? Number(folder.depth) : 0,
      path: folder.path || folder.name || folder.id,
      order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : index,
      createdAt: folder.createdAt || "",
      updatedAt: folder.updatedAt || ""
    }));
    state.foldersById = new Map(state.folders.map((folder) => [folder.id, folder]));
    applyInitialFolderCollapse();
    await refreshShares();

    // Last write wins; this replaces the whole list.
    // eslint-disable-next-line require-atomic-updates
    state.docs = (payload.docs || []).map((doc) => ({
      file: doc.file,
      title: doc.title || filenameToTitle(doc.file),
      size: Number(doc.size || 0),
      updatedAt: doc.updatedAt || "",
      folderId: doc.folderId || null,
      folderName: doc.folderName || null,
      folderPath: doc.folderPath || null,
      folderOrder: Number.isFinite(Number(doc.folderOrder)) ? Number(doc.folderOrder) : getFolderOrder(doc.folderId),
      icon: inferIcon(doc.file)
    }));

    // A stale selection would keep phantom rows highlighted and let a delete fire
    // against a file that no longer exists.
    pruneSelection();
  }

  async function fetchDeletedDocs() {
    const endpoint = state.viewMode === "archive" ? "/api/archive" : "/api/recycle-bin";
    const payload = await requestJson(endpoint, { cache: "no-store" });

    // Last write wins is the intent: this replaces the whole list.
    // eslint-disable-next-line require-atomic-updates
    state.deletedDocs = (payload.docs || []).map((doc) => ({
      file: doc.file,
      originalFile: doc.originalFile || "",
      title: doc.title || filenameToTitle(doc.originalFile || doc.file),
      size: Number(doc.size || 0),
      updatedAt: doc.deletedAt || doc.updatedAt || "",
      deletedAt: doc.deletedAt || doc.updatedAt || "",
      folderId: doc.folderId || null,
      folderName: doc.folderName || null,
      folderOrder: Number.isFinite(Number(doc.folderOrder)) ? Number(doc.folderOrder) : getFolderOrder(doc.folderId),
      icon: "ph-trash"
    }));
  }

  async function loadDocContent(file, { forceReload = false } = {}) {
    const doc = getDocByFile(file);
    const cacheVersion = getDocCacheVersion(doc);
    const cached = state.contentCache.get(file);

    if (!forceReload && cached && cached.version === cacheVersion) {
      return cached.content;
    }

    const payload = await requestJson(`/api/docs/${docUrl(file)}`, { cache: "no-store" });
    const content = String(payload.content || "");
    const version = String(payload.updatedAt || cacheVersion || "");
    state.contentCache.set(file, {
      content,
      version
    });

    if (doc) {
      doc.updatedAt = payload.updatedAt || doc.updatedAt || version;
      doc.folderId = payload.folderId || doc.folderId || null;
      doc.folderName = payload.folderName || doc.folderName || null;
    }

    return content;
  }

  async function loadDeletedDocContent(entryFile, { forceReload = false } = {}) {
    const doc = state.deletedDocs.find((candidate) => candidate.file === entryFile) || null;
    const cacheVersion = getDocCacheVersion(doc);
    const cached = state.contentCache.get(entryFile);

    if (!forceReload && cached && cached.version === cacheVersion) {
      return cached.content;
    }

    const contentBase = state.viewMode === "archive" ? "/api/archive" : "/api/recycle-bin";
    const payload = await requestJson(`${contentBase}/${encodeURIComponent(entryFile)}/content`, { cache: "no-store" });
    const content = String(payload.content || "");
    const version = String(doc?.deletedAt || doc?.updatedAt || "");
    state.contentCache.set(entryFile, {
      content,
      version
    });

    return content;
  }

  function syncModeUI() {
    const inRecycleBin = state.viewMode === "recycle";
    const inArchive = state.viewMode === "archive";
    const inLinks = state.viewMode === "links";
    const inTrashView = inRecycleBin || inArchive;

    elements.sidebarTitle.textContent = inLinks
      ? "Links"
      : inArchive ? "Archive" : inRecycleBin ? "Recycle bin" : "Files";

    // The switcher says which half of the library you are in. The archive and
    // the recycle bin are still documents, so Files stays lit in both of them.
    if (elements.placeDocsBtn && elements.placeLinksBtn) {
      const here = inLinks ? elements.placeLinksBtn : elements.placeDocsBtn;
      const there = inLinks ? elements.placeDocsBtn : elements.placeLinksBtn;
      here.setAttribute("aria-current", "page");
      there.removeAttribute("aria-current");
    }

    // The one search box is about whatever is on screen. Saying so in the
    // placeholder is the difference between a filter and a search that seems to
    // have stopped finding anything.
    elements.searchInput.placeholder = inLinks ? "Filter saved links" : "Search files and contents";

    // The links pane replaces the document viewer rather than sitting beside it:
    // there is no open document in this mode, so the toolbar, the empty state and
    // the article all step aside.
    if (elements.linksPane) {
      elements.linksPane.hidden = !inLinks;
    }

    if (elements.viewerToolbar) {
      elements.viewerToolbar.hidden = inLinks;
    }

    if (inLinks) {
      elements.emptyState.style.display = "none";
      elements.docContent.classList.remove("visible");
      if (elements.kernelBar) {
        elements.kernelBar.hidden = true;
      }

      setSuperSearchOpen(false);
    }

    // Nothing in this pane is a document, so every control that acts on one goes
    // with the viewer. Written in both directions rather than only hidden on the
    // way in, since applyPermissionGating writes the same controls from the same
    // rule and the two must not be able to disagree about which is on top.
    const docTools = can("doc:write") && !inLinks;
    for (const control of [elements.newDocBtn, elements.editDocBtn, elements.uploadWrap,
      elements.dockUpload, elements.dockNew, elements.dockEdit]) {
      if (control) {
        control.hidden = !docTools;
      }
    }

    elements.toggleRecycleBinBtn.classList.toggle("active", inRecycleBin);
    elements.toggleRecycleBinBtn.setAttribute("aria-pressed", String(inRecycleBin));
    elements.toggleRecycleBinBtn.setAttribute("aria-label", inRecycleBin ? "Exit recycle bin" : "Show recycle bin");
    elements.toggleRecycleBinBtn.title = inRecycleBin ? "Exit recycle bin" : "Recycle bin";

    elements.toggleArchiveBtn.classList.toggle("active", inArchive);
    elements.toggleArchiveBtn.setAttribute("aria-pressed", String(inArchive));
    elements.toggleArchiveBtn.setAttribute("aria-label", inArchive ? "Exit archive" : "Show archive");
    elements.toggleArchiveBtn.title = inArchive ? "Exit archive" : "Archive";

    elements.softDeleteDocBtn.hidden = inTrashView;
    elements.hardDeleteDocBtn.hidden = false;
    elements.restoreDocBtn.hidden = !inTrashView;
    elements.createFolderBtn.hidden = inTrashView || !docTools;

    if (elements.collapseAllBtn) {
      elements.collapseAllBtn.hidden = inTrashView || inLinks;
    }

    // The button keeps its slot in all three modes but means something different in each:
    // archive from the viewer, archive from the recycle bin, erase from the archive.
    const hardDeleteIcon = elements.hardDeleteDocBtn.querySelector("i");
    if (inArchive) {
      if (hardDeleteIcon) hardDeleteIcon.className = "ph ph-trash";
      elements.hardDeleteDocBtn.setAttribute("aria-label", "Permanently delete archived markdown");
      elements.hardDeleteDocBtn.title = "Delete forever";
    } else if (inRecycleBin) {
      if (hardDeleteIcon) hardDeleteIcon.className = "ph ph-archive-box";
      elements.hardDeleteDocBtn.setAttribute("aria-label", "Move recycle bin markdown to archive");
      elements.hardDeleteDocBtn.title = "Archive";
    } else {
      if (hardDeleteIcon) hardDeleteIcon.className = "ph ph-archive-box";
      elements.hardDeleteDocBtn.setAttribute("aria-label", "Archive current markdown");
      elements.hardDeleteDocBtn.title = "Archive";
    }
  }

  /* Warm the content cache so the offline search fallback can match on document
   * text rather than only on titles.
   *
   * A few at a time, not all of them. A browser opens six connections to a host;
   * asking for a hundred and ten documents at once fills all six for as long as
   * it takes to move five megabytes, and every request made in the meantime —
   * opening a document, the saved links, a search — waits behind them. This is
   * the least urgent work the app does and it was crowding out all the rest.
   */
  const HYDRATE_CONCURRENCY = 3;

  async function hydrateSearchContent() {
    const queue = state.docs.map((doc) => doc.file);

    const worker = async () => {
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        try {
          await loadDocContent(file);
        } catch (error) {
          console.error(error);
        }
      }
    };

    await Promise.all(Array.from({ length: HYDRATE_CONCURRENCY }, worker));
  }

  async function hydrateDeletedSearchContent() {
    await Promise.all(
      state.deletedDocs.map(async (doc) => {
        try {
          await loadDeletedDocContent(doc.file);
        } catch (error) {
          console.error(error);
        }
      })
    );
  }

  function showEmptyState(title, message, icon = "ph-file-dashed") {
    elements.emptyState.style.display = "grid";
    // Whatever this is, it is a settled answer rather than a wait, so the spinner
    // stops. The markup ships spinning, so forgetting this leaves "No file
    // selected" turning on the spot forever.
    elements.emptyState.classList.remove("is-loading");
    elements.emptyState.removeAttribute("aria-busy");
    elements.docContent.classList.remove("visible");
    elements.docContent.classList.remove("notebook-viewer");
    MarkdownCore.destroyPanZoomInstances(elements.docContent);
    elements.docContent.innerHTML = "";
    elements.emptyState.innerHTML = `
      <i class="ph ${icon}"></i>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    `;
  }

  // The same panel, still spinning. Used while something is genuinely on its way,
  // so the reader is told what is being fetched instead of being shown a prompt
  // to do something they have already done.
  function showLoadingState(title, message) {
    showEmptyState(title, message, "ph-circle-notch");
    elements.emptyState.classList.add("is-loading");
    elements.emptyState.setAttribute("aria-busy", "true");
  }

  // Nothing open: the viewer says so, the explorer highlights nothing and the
  // buttons that need a document go quiet. One place, so the wording cannot
  // drift between the ways of getting here.
  function showNoDocumentOpen() {
    state.activeFile = null;
    // The address goes back to the library too. Leaving it pointing at a
    // document that is no longer on screen is how a refresh ends up somewhere
    // the last click did not.
    showDocumentInUrl(null, { replace: true });
    updateActiveDocUI(null);
    showEmptyState("No file selected", "Pick a file from the explorer, or search across every document.", "ph-file-dashed");
  }

  global.AppDocs = {
    fetchDocs,
    fetchDeletedDocs,
    loadDocContent,
    loadDeletedDocContent,
    syncModeUI,
    hydrateSearchContent,
    hydrateDeletedSearchContent,
    showEmptyState,
    showLoadingState,
    showNoDocumentOpen
  };
})(typeof window === "undefined" ? globalThis : window);
