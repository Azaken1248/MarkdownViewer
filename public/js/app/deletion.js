/* Deleting more than one thing.
 *
 * A folder, with everything under it, and a batch of files. Both ask once,
 * plainly, saying what will happen — a folder delete says how many subfolders
 * go with it — and both refresh the listing once at the end rather than after
 * each item.
 */

(function (global) {
  const { state } = global.AppState;
  const { requestJson } = global.AppApi;
  const { docUrl } = global.AppText;
  const { getFolderRecord, folderPathIds } = global.AppLibrary;
  const { clearSelection } = global.AppSelection;
  const { notify, requestConfirmation } = global.AppNotify;

  async function deleteFolderById(folderId) {
    const folder = getFolderRecord(folderId);
    if (!folder) {
      return;
    }

    const descendants = state.folders.filter((entry) => folderPathIds(entry.id).includes(folderId) && entry.id !== folderId);
    const affected = state.docs.filter((doc) => doc.folderId === folderId
      || descendants.some((entry) => entry.id === doc.folderId)).length;

    const shouldProceed = await requestConfirmation({
      title: `Delete "${folder.name}"?`,
      message: descendants.length
        ? `This also deletes ${descendants.length} subfolder(s). ${affected} document(s) move back to Ungrouped. No file on disk is touched.`
        : `${affected} document(s) move back to Ungrouped. No file on disk is touched.`,
      confirmLabel: "Delete folder",
      tone: "danger"
    });

    if (!shouldProceed) {
      return;
    }

    try {
      const payload = await requestJson(`/api/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
      await App.refreshDocs({ preserveSearch: true });
      notify(payload.removedFolders > 1
        ? `Deleted "${folder.name}" and ${payload.removedFolders - 1} subfolder(s).`
        : `Deleted folder "${folder.name}".`, "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  // --- Bulk delete ----------------------------------------------------------

  async function deleteFiles(files, mode) {
    const list = files.filter(Boolean);
    if (!list.length) {
      return;
    }

    if (list.length === 1) {
      await App.deleteDocumentByFile(list[0], mode);
      return;
    }

    const shouldProceed = await requestConfirmation({
      title: mode === "hard" ? `Archive ${list.length} files?` : `Delete ${list.length} files?`,
      message: mode === "hard"
        ? "They move to the archive, where they can still be restored."
        : "They move to the recycle bin, where they can still be restored.",
      confirmLabel: mode === "hard" ? "Archive" : "Delete",
      tone: "danger"
    });

    if (!shouldProceed) {
      notify("Nothing was deleted.", "info");
      return;
    }

    const failed = [];
    let done = 0;

    for (const file of list) {
      try {
        await requestJson(`/api/docs/${docUrl(file)}/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode })
        });
        state.contentCache.delete(file);
        done += 1;
      } catch (error) {
        failed.push(error.message);
      }
    }

    clearSelection();
    await App.refreshDocs({ preserveSearch: true });

    if (done) {
      notify(`${done} file(s) ${mode === "hard" ? "archived" : "moved to the recycle bin"}.`, "success");
    }
    if (failed.length) {
      notify(failed[0], "error");
    }
  }

  global.AppDeletion = {
    deleteFolderById,
    deleteFiles
  };
})(typeof window === "undefined" ? globalThis : window);
