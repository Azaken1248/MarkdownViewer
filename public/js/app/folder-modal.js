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

/* exported AppFolderModal */
var AppFolderModal = (function () {
  const { html } = DomHtml;
  const { elements } = AppDom;
  const { state } = AppState;
  const { compareNames } = AppText;
  const { getDocByFile, getFolderRecord } = AppLibrary;
  const { enterModalLayer, exitModalLayer } = AppModal;
  const { syncBodyLock } = AppShell;
  const { setStatus } = AppNotify;

  /* What the folder dialog says, per thing it is being used for.
   *
   * One dialog does four jobs — upload, move, rename, create — and what
   * changes between them is only the words and whether the picker is shown.
   * Each answers a title, a line under it, the word on the button, and what
   * the Ungrouped button says when there is one.
   */
  const FOLDER_MODAL_WORDS = {
    upload: () => ({
      title: `Upload ${state.pendingUploadFile?.name || "this file"}`,
      description: "Pick the folder it should land in, or create a new one.",
      confirm: html`<i class="ph ph-folder-plus"></i> Create And Upload`,
      root: html`<i class="ph ph-stack"></i> Upload To Ungrouped`
    }),

    move: (targetFile) => ({
      title: targetFile
        ? `Move ${targetFile.title || targetFile.file} to a folder`
        : "Move document to a folder",
      description: targetFile
        ? `Choose an existing folder or create a new one for ${targetFile.file}.`
        : "Choose an existing folder or create a new one.",
      confirm: html`<i class="ph ph-folder-plus"></i> Create And Move`,
      root: html`<i class="ph ph-stack"></i> Move To Ungrouped`
    }),

    rename: (targetFile, targetFolder) => ({
      title: targetFolder ? `Rename ${targetFolder.name}` : "Rename folder",
      description: "Update the logical folder name without moving any files.",
      confirm: html`<i class="ph ph-pencil-simple"></i> Rename Folder`,
      root: null
    }),

    create: () => {
      const parent = state.folderModalParentId ? getFolderRecord(state.folderModalParentId) : null;
      return {
        title: parent ? `New folder in ${parent.name}` : "Create folder",
        description: parent
          ? `The new folder will be nested inside ${parent.path}. Files on disk are not moved.`
          : "Create a logical folder to group documents without changing the physical layout.",
        confirm: html`<i class="ph ph-folder-plus"></i> Create Folder`,
        root: null
      };
    }
  };

  function syncFolderModalUI() {
    if (!elements.folderModal) {
      return;
    }

    const mode = state.folderModalMode;
    const targetFile = state.folderModalTargetFile ? getDocByFile(state.folderModalTargetFile, true) : null;
    const targetFolder = state.folderModalTargetFolderId ? getFolderRecord(state.folderModalTargetFolderId) : null;

    const words = (FOLDER_MODAL_WORDS[mode] || FOLDER_MODAL_WORDS.create)(targetFile, targetFolder);

    elements.folderTitle.textContent = words.title;
    elements.folderDescription.textContent = words.description;
    // Already escaped: these come from the table above, not from a document.
    // eslint-disable-next-line no-unsanitized/property
    elements.createFolderConfirmBtn.innerHTML = words.confirm;
    elements.moveToRootBtn.hidden = !words.root;
    elements.folderPicker.hidden = !words.root;

    if (words.root) {
      // As above: markup from the table, built with html`` and escaped there.
      // eslint-disable-next-line no-unsanitized/property
      elements.moveToRootBtn.innerHTML = words.root;
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

    elements.folderPickerList.innerHTML = html`${folders.map(({ folder, depth }) => html`
      <button class="folder-choice" type="button" data-folder-id="${folder.id}"
        style="--depth: ${depth}" title="${folder.path}" ${moveMode ? "" : "disabled"}>
        <span class="folder-choice-title"><i class="ph ph-folder"></i>${folder.name}</span>
        <span class="folder-choice-meta">${counts.get(folder.id) || 0} doc(s)</span>
      </button>
    `)}`;

    elements.folderPickerList.querySelectorAll(".folder-choice").forEach((button) => {
      if (!moveMode) {
        return;
      }

      button.addEventListener("click", async () => {
        const folderId = button.getAttribute("data-folder-id");

        if (state.folderModalMode === "upload") {
          const pending = state.pendingUploadFile;
          closeFolderModal();
          await AppUploads.uploadMarkdown(pending, folderId);
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

  return {
    syncFolderModalUI,
    renderFolderPickerList,
    openFolderModal,
    closeFolderModal
  };
})();
