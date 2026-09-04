/* Renaming in place.
 *
 * F2 edits the label where it sits rather than opening the editor, which is
 * what makes renaming feel like a filesystem instead of a document workflow.
 *
 * The two calls back into the app — redraw the list, refetch it — are written
 * as App.x rather than taken as imports at the top. This module sits above the
 * one that owns them, and naming them at the call site says so out loud instead
 * of hiding an upward reach behind an alias.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { docName, docUrl } = global.AppText;
  const { getFolderRecord } = global.AppLibrary;
  const { requestJson } = global.AppApi;
  const { notify } = global.AppNotify;

  // F2 edits the label in place rather than opening the editor, which is what
  // makes renaming feel like a filesystem instead of a document workflow.

  function beginInlineEdit(labelNode, currentValue, commit) {
    if (!labelNode || labelNode.querySelector("input")) {
      return;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "tree-rename-input";
    input.name = "rename";
    input.value = currentValue;
    input.setAttribute("aria-label", "New name");

    labelNode.textContent = "";
    labelNode.appendChild(input);
    input.focus();

    // Preselect the stem so the extension is not in the way of typing.
    const dot = currentValue.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : currentValue.length);

    let settled = false;

    const finish = async (accept) => {
      if (settled) {
        return;
      }
      settled = true;

      const next = input.value.trim();
      if (!accept || !next || next === currentValue) {
        App.renderDocList();
        return;
      }

      await commit(next);
    };

    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        void finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finish(false);
      }
    });

    input.addEventListener("blur", () => void finish(true));
    input.addEventListener("click", (event) => event.stopPropagation());
  }

  // Filenames here legitimately contain spaces, quotes and brackets, so match on
  // the dataset directly rather than building an attribute selector out of them.
  function findDocRow(file) {
    for (const row of elements.docList.querySelectorAll(".tree-row-doc")) {
      if (row.dataset.file === file) {
        return row;
      }
    }
    return null;
  }

  function findFolderRow(folderId) {
    for (const row of elements.docList.querySelectorAll(".tree-row-folder")) {
      if (row.dataset.folderId === folderId) {
        return row;
      }
    }
    return null;
  }

  function beginInlineRename(file) {
    const row = findDocRow(file);
    const label = row?.querySelector(".tree-label");
    if (!label) {
      return;
    }

    // Seeded with the name, not the path: renaming is renaming, and typing a
    // path here would be a move the endpoint refuses.
    beginInlineEdit(label, docName(file), async (nextName) => {
      try {
        // fileName, not name: the endpoint reads fileName, and sending the wrong
        // key meant sanitizeNewFilename got undefined and answered "Invalid
        // document file name" for every rename typed into the tree.
        const payload = await requestJson(`/api/docs/${docUrl(file)}/rename`, {
          method: "POST",
          body: JSON.stringify({ fileName: nextName })
        });
        state.contentCache.delete(file);
        const openedFile = state.activeFile === file ? payload.file : state.activeFile;
        await App.refreshDocs({ openFile: openedFile, preserveSearch: true });
        notify(`Renamed to ${docName(payload.file)}.`, "success");
      } catch (error) {
        notify(error.message, "error");
        App.renderDocList();
      }
    });
  }

  function beginInlineFolderRename(folderId) {
    const row = findFolderRow(folderId);
    const label = row?.querySelector(".tree-label");
    const folder = getFolderRecord(folderId);
    if (!label || !folder) {
      return;
    }

    beginInlineEdit(label, folder.name, async (nextName) => {
      try {
        await requestJson(`/api/folders/${encodeURIComponent(folderId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName })
        });
        await App.refreshDocs({ preserveSearch: true });
        notify(`Renamed folder to ${nextName}.`, "success");
      } catch (error) {
        notify(error.message, "error");
        App.renderDocList();
      }
    });
  }

  global.AppInlineRename = {
    beginInlineEdit,
    findDocRow,
    findFolderRow,
    beginInlineRename,
    beginInlineFolderRename
  };
})(typeof window === "undefined" ? globalThis : window);
