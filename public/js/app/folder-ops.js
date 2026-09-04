/* What the folder dialog asks the server for.
 *
 * The dialog collects a name or a destination; this is the request that
 * follows, for each of the three things it can be asked to do. Kept apart from
 * the dialog so that the dialog is only about what is on the screen.
 */

(function (global) {
  const { state } = global.AppState;
  const { requestJson } = global.AppApi;
  const { elements } = global.AppDom;
  const { docUrl } = global.AppText;
  const { notify, setStatus } = global.AppNotify;
  const { closeFolderModal } = global.AppFolderModal;

  async function createFolderOnServer(folderName, parentId = null) {
    return requestJson("/api/folders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: folderName, parentId: parentId || null })
    });
  }

  async function renameFolderOnServer(folderId, folderName) {
    return requestJson(`/api/folders/${encodeURIComponent(folderId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: folderName })
    });
  }

  async function moveDocumentToFolder(file, folderId) {
    const payload = await requestJson(`/api/docs/${docUrl(file)}/folder`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ folderId: folderId || null })
    });

    state.contentCache.delete(file);
    // A move is a move on disk, so the document that comes back has the
    // destination's path. Asking for the old one would find nothing there —
    // and only the document actually being read should follow the move.
    const stillOpen = state.activeFile === file ? payload.file : state.activeFile;
    await App.refreshDocs({ openFile: stillOpen, preserveSearch: true });
    setStatus(`Moved ${payload.file} to ${payload.folderName || state.rootFolderLabel || "Ungrouped"}.`, "success");
    return payload;
  }

  async function handleFolderModalAction() {
    const folderName = String(elements.folderNameInput.value || "").trim();
    if (!folderName) {
      setStatus("Folder name is required.", "error");
      elements.folderNameInput.focus();
      return;
    }

    try {
      if (state.folderModalMode === "rename") {
        if (!state.folderModalTargetFolderId) {
          setStatus("Select a folder to rename.", "error");
          return;
        }

        await renameFolderOnServer(state.folderModalTargetFolderId, folderName);
        closeFolderModal();
        await App.refreshDocs({ preserveSearch: true });
        setStatus(`Renamed folder to ${folderName}.`, "success");
        return;
      }

      const created = await createFolderOnServer(folderName, state.folderModalParentId);

      if (state.folderModalMode === "upload") {
        const pending = state.pendingUploadFile;
        closeFolderModal();
        await App.uploadMarkdown(pending, created.folder.id);
        return;
      }

      if (state.folderModalMode === "move" && state.folderModalTargetFile) {
        await moveDocumentToFolder(state.folderModalTargetFile, created.folder.id);
        closeFolderModal();
        return;
      }

      closeFolderModal();
      await App.refreshDocs({ preserveSearch: true });
      notify(created.folder.parentId
        ? `Created "${created.folder.name}" in ${created.folder.path.replace(/ \/ [^/]+$/, "")}.`
        : `Created folder "${created.folder.name}".`, "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  global.AppFolderOps = {
    createFolderOnServer,
    renameFolderOnServer,
    moveDocumentToFolder,
    handleFolderModalAction
  };
})(typeof window === "undefined" ? globalThis : window);
