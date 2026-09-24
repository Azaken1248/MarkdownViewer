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

/* exported AppDocs */
var AppDocs = (function () {
  const { html } = DomHtml;
  const { elements } = AppDom;
  const { state } = AppState;
  const { requestJson, can } = AppApi;
  const { docUrl, filenameToTitle, inferIcon } = AppText;
  const { getDocByFile, getDocCacheVersion, getFolderOrder } = AppLibrary;
  const { showDocumentInUrl } = AppLocation;
  const { updateActiveDocUI } = AppViewerHeader;
  const { pruneSelection } = AppSelection;
  const { refreshShares } = AppShare;
  const { applyInitialFolderCollapse } = AppFolderCollapse;
  const { setSuperSearchOpen } = AppSearchPanel;

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
      rememberWhatTheServerSaid(doc, payload, version);
    }

    return content;
  }

  // The answer carries fresher facts about the document than the list does —
  // it was read from disk just now — so the list takes them.
  function rememberWhatTheServerSaid(doc, payload, version) {
    doc.updatedAt = payload.updatedAt || doc.updatedAt || version;
    doc.folderId = payload.folderId || doc.folderId || null;
    doc.folderName = payload.folderName || doc.folderName || null;
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

  /* What each of the three bins is called, and what the button that leads out
   * of it says while you are in it.
   */
  const PLACES = {
    links: { title: "Links", search: "Filter saved links" },
    archive: { title: "Archive", search: "Search files and contents" },
    recycle: { title: "Recycle bin", search: "Search files and contents" },
    docs: { title: "Files", search: "Search files and contents" }
  };

  // The two bin buttons, which are toggles: pressed while you are inside, and
  // labelled with the way out.
  function syncBinButton(button, inside, { name, out, back }) {
    button.classList.toggle("active", inside);
    button.setAttribute("aria-pressed", String(inside));
    button.setAttribute("aria-label", inside ? out : back);
    button.title = inside ? out : name;
  }

  /* The archive button keeps its slot in all three modes and means something
   * different in each: archive from the viewer, archive from the recycle bin,
   * erase from the archive.
   */
  const HARD_DELETE_WORDS = {
    archive: { icon: "ph ph-trash", label: "Permanently delete archived markdown", title: "Delete forever" },
    recycle: { icon: "ph ph-archive-box", label: "Move recycle bin markdown to archive", title: "Archive" },
    docs: { icon: "ph ph-archive-box", label: "Archive current markdown", title: "Archive" }
  };

  function syncHardDeleteButton(mode) {
    const words = HARD_DELETE_WORDS[mode] || HARD_DELETE_WORDS.docs;
    const icon = elements.hardDeleteDocBtn.querySelector("i");

    if (icon) {
      icon.className = words.icon;
    }

    elements.hardDeleteDocBtn.setAttribute("aria-label", words.label);
    elements.hardDeleteDocBtn.title = words.title;
  }

  // The switcher says which half of the library you are in. The archive and
  // the recycle bin are still documents, so Files stays lit in both of them.
  function syncPlaceSwitcher(inLinks) {
    if (!elements.placeDocsBtn || !elements.placeLinksBtn) {
      return;
    }

    const here = inLinks ? elements.placeLinksBtn : elements.placeDocsBtn;
    const there = inLinks ? elements.placeDocsBtn : elements.placeLinksBtn;
    here.setAttribute("aria-current", "page");
    there.removeAttribute("aria-current");
  }

  function syncModeUI() {
    const inRecycleBin = state.viewMode === "recycle";
    const inArchive = state.viewMode === "archive";
    const inLinks = state.viewMode === "links";
    const inTrashView = inRecycleBin || inArchive;
    const place = PLACES[state.viewMode] || PLACES.docs;

    elements.sidebarTitle.textContent = place.title;
    syncPlaceSwitcher(inLinks);

    // The one search box is about whatever is on screen. Saying so in the
    // placeholder is the difference between a filter and a search that seems to
    // have stopped finding anything.
    elements.searchInput.placeholder = place.search;

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

    syncBinButton(elements.toggleRecycleBinBtn, inRecycleBin,
      { name: "Recycle bin", out: "Exit recycle bin", back: "Show recycle bin" });
    syncBinButton(elements.toggleArchiveBtn, inArchive,
      { name: "Archive", out: "Exit archive", back: "Show archive" });

    elements.softDeleteDocBtn.hidden = inTrashView;
    elements.hardDeleteDocBtn.hidden = false;
    elements.restoreDocBtn.hidden = !inTrashView;
    elements.createFolderBtn.hidden = inTrashView || !docTools;

    if (elements.collapseAllBtn) {
      elements.collapseAllBtn.hidden = inTrashView || inLinks;
    }

    syncHardDeleteButton(state.viewMode);
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
    elements.emptyState.innerHTML = html`
      <i class="ph ${icon}"></i>
      <h3>${title}</h3>
      <p>${message}</p>
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

  return {
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
})();
