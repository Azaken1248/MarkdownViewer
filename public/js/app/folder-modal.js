/* The folder dialog.
 *
 * One dialog for three jobs — make a folder, rename one, move something into
 * one — because they ask for the same thing: a name, or a place in the tree.
 * Which of the three it is at any moment is in state, and syncFolderModalUI is
 * what dresses it accordingly.
 *
 * Folders and documents are listed alphabetically, so there is no manual
 * ordering to move a folder within. The "move up" / "move down" row actions
 * and the reorder request they sent are gone with it — a control that cannot
 * change what you see is worse than no control.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { escapeHtml, compareNames } = global.AppText;
  const { getDocByFile, getFolderRecord } = global.AppLibrary;
  const { enterModalLayer, exitModalLayer } = global.AppModal;
  const { syncBodyLock } = global.AppShell;
  const { setStatus } = global.AppNotify;

  function syncFolderModalUI() {
    if (!elements.folderModal) {
      return;
    }

    const mode = state.folderModalMode;
    const targetFile = state.folderModalTargetFile ? getDocByFile(state.folderModalTargetFile, true) : null;
    const targetFolder = state.folderModalTargetFolderId ? getFolderRecord(state.folderModalTargetFolderId) : null;

    if (mode === "upload") {
      const pendingName = state.pendingUploadFile?.name || "this file";
      elements.folderTitle.textContent = `Upload ${pendingName}`;
      elements.folderDescription.textContent = "Pick the folder it should land in, or create a new one.";
      elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-folder-plus"></i> Create And Upload';
      elements.moveToRootBtn.innerHTML = '<i class="ph ph-stack"></i> Upload To Ungrouped';
      elements.moveToRootBtn.hidden = false;
      elements.folderPicker.hidden = false;
    } else if (mode === "move") {
      elements.folderTitle.textContent = targetFile
        ? `Move ${targetFile.title || targetFile.file} to a folder`
        : "Move document to a folder";
      elements.folderDescription.textContent = targetFile
        ? `Choose an existing folder or create a new one for ${targetFile.file}.`
        : "Choose an existing folder or create a new one.";
      elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-folder-plus"></i> Create And Move';
      elements.moveToRootBtn.innerHTML = '<i class="ph ph-stack"></i> Move To Ungrouped';
      elements.moveToRootBtn.hidden = false;
      elements.folderPicker.hidden = false;
    } else if (mode === "rename") {
      elements.folderTitle.textContent = targetFolder ? `Rename ${targetFolder.name}` : "Rename folder";
      elements.folderDescription.textContent = targetFolder
        ? "Update the logical folder name without moving any files."
        : "Update the logical folder name without moving any files.";
      elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-pencil-simple"></i> Rename Folder';
      elements.moveToRootBtn.hidden = true;
      elements.folderPicker.hidden = true;
    } else {
      const parent = state.folderModalParentId ? getFolderRecord(state.folderModalParentId) : null;
      elements.folderTitle.textContent = parent ? `New folder in ${parent.name}` : "Create folder";
      elements.folderDescription.textContent = parent
        ? `The new folder will be nested inside ${parent.path}. Files on disk are not moved.`
        : "Create a logical folder to group documents without changing the physical layout.";
      elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-folder-plus"></i> Create Folder';
      elements.moveToRootBtn.hidden = true;
      elements.folderPicker.hidden = true;
    }

    elements.folderNameInput.value = targetFolder ? targetFolder.name : "";
    elements.folderNameInput.placeholder = mode === "rename" ? "Rename folder" : "Project Alpha";
  }

  function renderFolderPickerList() {
    if (!elements.folderPickerList) {
      return;
    }

    const moveMode = state.folderModalMode === "move" || state.folderModalMode === "upload";
    const docsCollection = state.isRecycleBinMode ? state.deletedDocs : state.docs;
    const counts = new Map();

    for (const doc of docsCollection) {
      const key = doc.folderId || "__root__";
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    // Depth-first so the picker reads like the tree, with each entry indented to
    // its level and labelled by its full path.
    const childrenOf = new Map();
    for (const folder of state.folders) {
      const key = folder.parentId || "__top__";
      if (!childrenOf.has(key)) {
        childrenOf.set(key, []);
      }
      childrenOf.get(key).push(folder);
    }
    for (const list of childrenOf.values()) {
      list.sort((left, right) => compareNames(left.name, right.name));
    }

    const folders = [];
    const walk = (parentKey, depth) => {
      for (const folder of childrenOf.get(parentKey) || []) {
        folders.push({ folder, depth });
        walk(folder.id, depth + 1);
      }
    };
    walk("__top__", 0);

    if (folders.length === 0) {
      elements.folderPickerList.innerHTML = '<div class="folder-empty">No folders yet. Create one to organize documents.</div>';
      return;
    }

    elements.folderPickerList.innerHTML = folders.map(({ folder, depth }) => `
      <button class="folder-choice" type="button" data-folder-id="${escapeHtml(folder.id)}"
        style="--depth: ${depth}" title="${escapeHtml(folder.path)}" ${moveMode ? "" : "disabled"}>
        <span class="folder-choice-title"><i class="ph ph-folder"></i>${escapeHtml(folder.name)}</span>
        <span class="folder-choice-meta">${escapeHtml(String(counts.get(folder.id) || 0))} doc(s)</span>
      </button>
    `).join("");

    elements.folderPickerList.querySelectorAll(".folder-choice").forEach((button) => {
      if (!moveMode) {
        return;
      }

      button.addEventListener("click", async () => {
        const folderId = button.getAttribute("data-folder-id");

        if (state.folderModalMode === "upload") {
          const pending = state.pendingUploadFile;
          closeFolderModal();
          await App.uploadMarkdown(pending, folderId);
          return;
        }

        if (state.folderModalTargetFile) {
          try {
            await App.moveDocumentToFolder(state.folderModalTargetFile, folderId);
            closeFolderModal();
          } catch (error) {
            setStatus(error.message, "error");
          }
        }
      });
    });
  }

  // Folders and documents are listed alphabetically, so there is no manual
  // ordering to move a folder within. The "move up" / "move down" row actions and
  // the reorder request they sent are gone with it — a control that cannot change
  // what you see is worse than no control.

  function openFolderModal({ mode = "create", file = null, folderId = null, parentId = null } = {}) {
    state.folderModalOpen = true;
    state.folderModalMode = mode;
    state.folderModalTargetFile = file;
    state.folderModalTargetFolderId = folderId;
    // Only meaningful in "create" mode: which folder the new one nests under.
    state.folderModalParentId = parentId;
    syncFolderModalUI();
    renderFolderPickerList();

    elements.folderModal.classList.add("open");
    elements.folderModal.setAttribute("aria-hidden", "false");
    enterModalLayer(elements.folderModal);
    syncBodyLock();
    window.requestAnimationFrame(() => elements.folderNameInput.focus());
    window.requestAnimationFrame(() => {
      if (mode === "rename") {
        elements.folderNameInput.select();
      }
    });
  }

  function closeFolderModal() {
    if (state.folderModalMode === "upload" && state.pendingUploadFile) {
      state.pendingUploadFile = null;
      elements.uploadInput.value = "";
    }

    state.folderModalOpen = false;
    state.folderModalMode = "create";
    state.folderModalTargetFile = null;
    state.folderModalTargetFolderId = null;
    state.folderModalParentId = null;
    elements.folderNameInput.value = "";
    elements.folderModal.classList.remove("open");
    elements.folderModal.setAttribute("aria-hidden", "true");
    exitModalLayer(elements.folderModal);
    syncBodyLock();
  }

  global.AppFolderModal = {
    syncFolderModalUI,
    renderFolderPickerList,
    openFolderModal,
    closeFolderModal
  };
})(typeof window === "undefined" ? globalThis : window);
