/* The controls around the file tree.
 *
 * New folder, the tree's own mouse and keyboard events, the right-click menu,
 * collapse-all, the folder dialog's buttons and the refresh button. None of
 * them do their own work — each one calls into the module that owns the job —
 * but every one of them is attached here, in the order the sidebar reads.
 */
(function (global) {

const { elements } = global.AppDom;
const { state } = global.AppState;
const { can } = global.AppApi;
const { setSelection, clearSelection } = global.AppSelection;
const { setNavOpen } = global.AppShell;
const { setStatus } = global.AppNotify;
const { refreshLinks } = global.AppLinks;
const { persistCollapsedFolders } = global.AppFolderCollapse;
const { openFolderModal, closeFolderModal } = global.AppFolderModal;
const { startNewDocument } = global.AppSourceEditor;
const { pasteIntoFolder } = global.AppClipboard;
const { closeContextMenu, openContextMenu } = global.AppContextMenu;
const { renderDocList, handleTreeKeydown } = global.AppTree;
const { refreshDeletedDocs } = global.AppOpening;
const { refreshDocs } = global.AppRefresh;
const { uploadMarkdown } = global.AppUploads;
const { moveDocumentToFolder, handleFolderModalAction } = global.AppFolderOps;

function bindSidebar() {
  elements.createFolderBtn.addEventListener("click", () => {
    openFolderModal({ mode: "create" });
  });

  // Delegated so they survive every rebuild of the tree.
  elements.docList.addEventListener("keydown", handleTreeKeydown);

  // Clicking the empty space below the rows clears the selection, as it does in
  // Explorer. Clicks that landed on a row are handled by the row itself.
  elements.docList.addEventListener("mousedown", (event) => {
    if (event.target === elements.docList) {
      clearSelection();
    }
  });

  // Right-clicking the empty area offers the paste target for the top level.
  elements.docList.addEventListener("contextmenu", (event) => {
    if (event.target !== elements.docList) {
      return;
    }

    event.preventDefault();

    // Creating is a write, so a viewer is left with the one entry that is not.
    const items = [];

    if (can("doc:write")) {
      items.push(
        {
          label: "New file",
          icon: "ph-file-plus",
          action: () => startNewDocument(null)
        },
        {
          label: "New folder",
          icon: "ph-folder-plus",
          action: () => openFolderModal({ mode: "create" })
        },
        {
          label: state.clipboard.files.length
            ? `Paste ${state.clipboard.files.length} file(s) into Ungrouped`
            : "Paste",
          icon: "ph-clipboard-text",
          disabled: state.clipboard.files.length === 0,
          action: () => void pasteIntoFolder(null)
        },
        { separator: true }
      );
    }

    items.push({
      label: "Select all",
      icon: "ph-check-square",
      action: () => setSelection(state.visibleFileOrder)
    });

    openContextMenu(event.clientX, event.clientY, items);
  });

  // A context menu must not survive the next interaction anywhere on the page.
  window.addEventListener("mousedown", (event) => {
    if (elements.contextMenu && !elements.contextMenu.contains(event.target)) {
      closeContextMenu();
    }
  });

  window.addEventListener("blur", closeContextMenu);
  window.addEventListener("resize", closeContextMenu);
  document.addEventListener("scroll", closeContextMenu, true);

  // The mobile drawer covers the header, so it needs its own way out.
  elements.closeSidebarBtn?.addEventListener("click", () => {
    setNavOpen(false);
  });

  elements.collapseAllBtn?.addEventListener("click", () => {
    const groups = [...elements.docList.querySelectorAll(".tree-group")];
    const anyExpanded = groups.some((group) => !group.classList.contains("is-collapsed"));

    if (anyExpanded) {
      for (const group of groups) {
        state.collapsedFolderIds.add(group.dataset.folderKey);
      }
    } else {
      state.collapsedFolderIds.clear();
    }

    persistCollapsedFolders();
    elements.collapseAllBtn.setAttribute("aria-label", anyExpanded ? "Expand all folders" : "Collapse all folders");
    elements.collapseAllBtn.title = anyExpanded ? "Expand all folders" : "Collapse all folders";
    renderDocList();
  });

  elements.createFolderConfirmBtn.addEventListener("click", async () => {
    await handleFolderModalAction();
  });

  elements.closeFolderModalBtn.addEventListener("click", () => {
    closeFolderModal();
  });

  elements.folderBackdrop.addEventListener("click", () => {
    closeFolderModal();
  });

  elements.moveToRootBtn.addEventListener("click", async () => {
    if (state.folderModalMode === "upload") {
      const pending = state.pendingUploadFile;
      closeFolderModal();
      await uploadMarkdown(pending, null);
      return;
    }

    if (!state.folderModalTargetFile) {
      return;
    }

    try {
      await moveDocumentToFolder(state.folderModalTargetFile, null);
      closeFolderModal();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.folderNameInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    await handleFolderModalAction();
  });

  elements.refreshDocs.addEventListener("click", async () => {
    try {
      if (state.viewMode === "links") {
        await refreshLinks();
        setStatus("Saved links refreshed.", "success");
      } else if (state.isRecycleBinMode) {
        await refreshDeletedDocs({ preserveSearch: true });
        setStatus(state.viewMode === "archive" ? "Archive refreshed." : "Recycle bin refreshed.", "success");
      } else {
        await refreshDocs({ preserveSearch: true });
        setStatus("Document list refreshed.", "success");
      }
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

global.AppSidebar = { bindSidebar };

})(typeof window === "undefined" ? globalThis : window);
