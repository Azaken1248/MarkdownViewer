/* Task lists you can actually tick.
 *
 * A checkbox that cannot be clicked is a picture of a checkbox. marked renders
 * task lists disabled, which is the right default for a renderer and the wrong
 * one for a document you own, so on a writable markdown file the boxes are
 * made live and a click is written straight to the file.
 *
 * Ticking is a one-character edit, so it does not go through the editor: there
 * is nothing to open, save or discard, and the page is not re-rendered — the
 * box you clicked is the box that changes.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { requestJson, can } = global.AppApi;
  const { docUrl, docName, isNotebookFile } = global.AppText;
  const { getDocByFile } = global.AppLibrary;
  const { loadDocContent } = global.AppDocs;
  const { setStatus } = global.AppNotify;

  // you clicked is the box that changes.

  function taskCheckboxes(root) {
    return [...root.querySelectorAll('li input[type="checkbox"]')];
  }

  function bindTaskCheckboxes(file, source) {
    state.taskMarkers = [];

    const boxes = taskCheckboxes(elements.docContent);
    if (boxes.length === 0) {
      return;
    }

    // Read-only accounts, the recycle bin and notebooks keep the picture.
    if (!can("doc:write") || state.isRecycleBinMode || isNotebookFile(file)) {
      return;
    }

    const markers = VisualEditor.taskMarkers(source);

    // The boxes on the page and the markers in the file have to line up exactly,
    // in count and in state. If they do not, this document parses differently
    // than expected somewhere, and a click would tick the wrong line of somebody
    // else's file — so the boxes stay inert rather than guess.
    const aligned = markers.length === boxes.length
      && markers.every((marker, index) => marker.checked === boxes[index].checked);

    if (!aligned) {
      return;
    }

    state.taskMarkers = markers;

    boxes.forEach((box, index) => {
      box.disabled = false;
      box.dataset.taskIndex = String(index);
      box.setAttribute("aria-label", taskCheckboxLabel(box));
    });
  }

  function taskCheckboxLabel(box) {
    const text = String(box.closest("li")?.textContent || "").trim();
    return text ? `Task: ${text.slice(0, 80)}` : "Task";
  }

  // The two DOM writes that happen after the request has been away. Kept in one
  // synchronous place so that settling the box is a single step rather than
  // something spread across the tail of an async function.
  function settleTaskCheckbox(box, checked) {
    box.checked = checked;
    box.disabled = false;
  }

  async function toggleTaskCheckbox(box) {
    const file = state.activeFile;
    const at = Number(box.dataset.taskIndex);
    const wanted = box.checked;

    if (!file || !Number.isInteger(at) || !state.taskMarkers[at]) {
      return;
    }

    // Also what stops a second click landing while this one is in the air.
    box.disabled = true;

    try {
      // Re-read rather than trusting the copy this page was rendered from: the
      // file may have been edited elsewhere since, and ticking a box is not worth
      // overwriting somebody's paragraph for.
      const source = await loadDocContent(file, { forceReload: true });
      const markers = VisualEditor.taskMarkers(source);

      if (markers.length !== state.taskMarkers.length) {
        throw new Error("This document changed since it was opened. Reopen it and try again.");
      }

      const content = VisualEditor.setTaskMarker(source, markers[at].index, wanted);
      const payload = await requestJson(`/api/docs/${docUrl(file)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });

      const version = String(payload.updatedAt || "");
      state.contentCache.set(file, { content, version });
      state.taskMarkers = VisualEditor.taskMarkers(content);

      const doc = getDocByFile(file);
      if (doc) {
        doc.updatedAt = payload.updatedAt || doc.updatedAt;
        doc.size = Number.isFinite(Number(payload.size)) ? Number(payload.size) : doc.size;
      }

      settleTaskCheckbox(box, wanted);
      setStatus(`${wanted ? "Ticked" : "Cleared"} a task in ${docName(file)}.`, "success");
    } catch (error) {
      // The tick is the user's claim about the file; if the file did not take it,
      // the box must not keep showing it.
      settleTaskCheckbox(box, !wanted);
      setStatus(error.message, "error");
    }
  }

  global.AppTaskLists = {
    taskCheckboxes,
    bindTaskCheckboxes,
    settleTaskCheckbox,
    toggleTaskCheckbox
  };
})(typeof window === "undefined" ? globalThis : window);
