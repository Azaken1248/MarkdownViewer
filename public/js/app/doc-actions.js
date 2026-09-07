/* What the buttons above the open document do.
 *
 * Delete, restore, delete for good — each acting on the document you are
 * looking at, and each answerable for what happens to the view afterwards:
 * the recycle bin moves you to the next entry, the library leaves you with
 * nothing open rather than with a document that is gone.
 */

(function (global) {
  const { state } = global.AppState;
  const { requestJson } = global.AppApi;
  const { docUrl, normalize } = global.AppText;
  const { requestConfirmation, setStatus } = global.AppNotify;
  const { syncModeUI } = global.AppDocs;
  const { resetJumpNavigation } = global.AppJump;
  const { refreshDeletedDocs } = global.AppOpening;

  async function deleteCurrentDocument(mode) {
    if (!state.activeFile || state.isRecycleBinMode) {
      setStatus("Select an active markdown to delete.", "error");
      return;
    }

    const targetFile = state.activeFile;
    const shouldProceed = await requestConfirmation({
      title: mode === "hard" ? "Archive this markdown?" : "Move markdown to recycle bin?",
      message: mode === "hard"
        ? `${targetFile} will be moved straight to the archive, skipping the recycle bin. It can still be restored from there.`
        : `${targetFile} will be moved into the recycle bin and can be restored later.`,
      confirmLabel: mode === "hard" ? "Archive" : "Move To Bin",
      tone: mode === "hard" ? "danger" : "primary"
    });

    if (!shouldProceed) {
      setStatus("Delete cancelled.", "neutral");
      return;
    }

    try {
      const payload = await requestJson(`/api/docs/${docUrl(targetFile)}/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mode })
      });

      state.contentCache.delete(targetFile);
      await AppRefresh.refreshDocs({ preserveSearch: true });
      setStatus(payload.message || `${payload.originalFile} deleted.`, "success");
    } catch (error) {
      if (normalize(error.message).includes("request failed (404)")) {
        setStatus("Delete endpoint returned 404. Restart the server so the recycle-bin API routes are loaded.", "error");
        return;
      }

      setStatus(error.message, "error");
    }
  }

  async function restoreCurrentDeletedDocument() {
    if (!state.isRecycleBinMode || !state.activeFile) {
      setStatus("Select a recycle bin markdown to restore.", "error");
      return;
    }

    try {
      const payload = await requestJson(`/api/recycle-bin/${encodeURIComponent(state.activeFile)}/restore`, {
        method: "POST"
      });

      state.contentCache.delete(state.activeFile);
      state.isRecycleBinMode = false;
      syncModeUI();
      resetJumpNavigation();
      await AppRefresh.refreshDocs({ openFile: payload.file, preserveSearch: false });
      setStatus(`Restored ${payload.file} from recycle bin.`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function hardDeleteCurrentDeletedDocument() {
    if (!state.isRecycleBinMode || !state.activeFile) {
      setStatus("Select a recycle bin markdown to archive.", "error");
      return;
    }

    const entryFile = state.activeFile;
    const shouldProceed = await requestConfirmation({
      title: "Archive this markdown?",
      message: "The file stays on disk. It moves out of the recycle bin and into the archive, where it can still be restored or erased for good.",
      confirmLabel: "Archive",
      tone: "danger"
    });

    if (!shouldProceed) {
      setStatus("Archive cancelled.", "neutral");
      return;
    }

    try {
      await requestJson(`/api/recycle-bin/${docUrl(entryFile)}/hard-delete`, {
        method: "POST"
      });

      state.contentCache.delete(entryFile);
      await refreshDeletedDocs({ preserveSearch: true });
      setStatus("Document moved to the archive.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  global.AppDocActions = {
    deleteCurrentDocument,
    restoreCurrentDeletedDocument,
    hardDeleteCurrentDeletedDocument
  };
})(typeof window === "undefined" ? globalThis : window);
