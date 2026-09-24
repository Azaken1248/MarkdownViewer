/* Cut and paste, for files and folders.
 *
 * The clipboard is a list of paths and a mode, held in state so that the tree
 * can dim what is on it. Pasting is a move on the server, and one refresh for
 * the whole batch rather than one per file — which is what made moving several
 * documents feel like the interface was fighting itself.
 */

/* exported AppClipboard */
var AppClipboard = (function () {
  const { state } = AppState;
  const { requestJson } = AppApi;
  const { docUrl } = AppText;
  const { getDocByFile, getFolderLabel } = AppLibrary;
  const { updateSelectionUI } = AppSelection;
  const { notify } = AppNotify;

  function cutFiles(files) {
    const list = files.filter(Boolean);
    if (!list.length) {
      return;
    }

    state.clipboard = { files: list, mode: "cut" };
    updateSelectionUI();
    notify(list.length === 1
      ? `Cut ${list[0]}. Paste onto a folder to move it.`
      : `Cut ${list.length} files. Paste onto a folder to move them.`, "info");
  }

  async function pasteIntoFolder(folderId) {
    const files = state.clipboard.files.filter(Boolean);
    if (!files.length) {
      notify("Nothing to paste.", "warning");
      return;
    }

    const targetLabel = folderId ? getFolderLabel(folderId) : (state.rootFolderLabel || "Ungrouped");
    const results = await moveFilesToFolder(files, folderId, { silent: true });

    // Clearing after the move is the point; a cut must survive a failed paste.
    // eslint-disable-next-line require-atomic-updates
    state.clipboard = { files: [], mode: null };

    if (results.moved > 0) {
      notify(results.moved === 1
        ? `Moved 1 file to ${targetLabel}.`
        : `Moved ${results.moved} files to ${targetLabel}.`, "success");
    }

    if (results.failed.length) {
      notify(`${results.failed.length} could not be moved: ${results.failed[0]}`, "error");
    }
  }

  // One refresh for the whole batch rather than one per file, which is what made
  // a multi-file move feel like the UI was fighting itself.
  /* What happened, in one line. Nothing to say when nothing moved and nothing
   * failed, which is what dropping a file into the folder it is already in
   * looks like.
   */
  function sayWhatMoved(moved, failed, folderId) {
    const targetLabel = folderId ? getFolderLabel(folderId) : (state.rootFolderLabel || "Ungrouped");

    if (moved > 0) {
      notify(`Moved ${moved} file${moved === 1 ? "" : "s"} to ${targetLabel}.`, "success");
    }

    if (failed.length) {
      notify(failed[0], "error");
    }
  }

  // One file into one folder. Answers null, or what went wrong with it — so a
  // batch that fails halfway still reports what it did manage.
  async function moveOneFile(file, folderId) {
    try {
      await requestJson(`/api/docs/${docUrl(file)}/folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folderId || null })
      });

      state.contentCache.delete(file);
      return null;
    } catch (error) {
      return error.message;
    }
  }

  async function moveFilesToFolder(files, folderId, { silent = false } = {}) {
    const failed = [];
    let moved = 0;

    for (const file of files) {
      const doc = getDocByFile(file);
      // Already there: not a move, and not a failure either.
      if (doc && (doc.folderId || null) === (folderId || null)) {
        continue;
      }

      const problem = await moveOneFile(file, folderId);
      if (problem) {
        failed.push(problem);
      } else {
        moved += 1;
      }
    }

    if (moved > 0) {
      await AppRefresh.refreshDocs({ preserveSearch: true });
    }

    if (!silent) {
      sayWhatMoved(moved, failed, folderId);
    }

    return { moved, failed };
  }

  async function moveFolderToParent(folderId, parentId) {
    try {
      await requestJson(`/api/folders/${encodeURIComponent(folderId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: parentId || null })
      });
      await AppRefresh.refreshDocs({ preserveSearch: true });
      notify(`Moved "${getFolderLabel(folderId)}" into ${parentId ? getFolderLabel(parentId) : "the top level"}.`, "success");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  return {
    cutFiles,
    pasteIntoFolder,
    moveFilesToFolder,
    moveFolderToParent
  };
})();
