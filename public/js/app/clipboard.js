/* Cut and paste, for files and folders.
 *
 * The clipboard is a list of paths and a mode, held in state so that the tree
 * can dim what is on it. Pasting is a move on the server, and one refresh for
 * the whole batch rather than one per file — which is what made moving several
 * documents feel like the interface was fighting itself.
 */

(function (global) {
  const { state } = global.AppState;
  const { requestJson } = global.AppApi;
  const { docUrl } = global.AppText;
  const { getDocByFile, getFolderLabel } = global.AppLibrary;
  const { updateSelectionUI } = global.AppSelection;
  const { notify } = global.AppNotify;

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
  async function moveFilesToFolder(files, folderId, { silent = false } = {}) {
    const failed = [];
    let moved = 0;

    for (const file of files) {
      const doc = getDocByFile(file);
      if (doc && (doc.folderId || null) === (folderId || null)) {
        continue;
      }

      try {
        await requestJson(`/api/docs/${docUrl(file)}/folder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: folderId || null })
        });
        state.contentCache.delete(file);
        moved += 1;
      } catch (error) {
        failed.push(error.message);
      }
    }

    if (moved > 0) {
      await AppRefresh.refreshDocs({ preserveSearch: true });
    }

    if (!silent) {
      const targetLabel = folderId ? getFolderLabel(folderId) : (state.rootFolderLabel || "Ungrouped");
      if (moved === 1) {
        notify(`Moved 1 file to ${targetLabel}.`, "success");
      } else if (moved > 1) {
        notify(`Moved ${moved} files to ${targetLabel}.`, "success");
      }
      if (failed.length) {
        notify(failed[0], "error");
      }
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

  global.AppClipboard = {
    cutFiles,
    pasteIntoFolder,
    moveFilesToFolder,
    moveFolderToParent
  };
})(typeof window === "undefined" ? globalThis : window);
