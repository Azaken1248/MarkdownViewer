// What is selected, and what a click does to it.
//
// Explorer semantics: plain click replaces the selection, Ctrl toggles one row,
// Shift extends from the anchor, across state.visibleFileOrder — rebuilt on
// every render so a Shift-range always matches what is actually on screen.

(function (global) {
  const { state } = global.AppState;
  const { elements } = global.AppDom;

  function pruneSelection() {
    const known = new Set([
      ...state.docs.map((doc) => doc.file),
      ...state.deletedDocs.map((doc) => doc.file)
    ]);

    for (const file of [...state.selection]) {
      if (!known.has(file)) {
        state.selection.delete(file);
      }
    }

    if (state.selectionAnchor && !known.has(state.selectionAnchor)) {
      state.selectionAnchor = null;
    }

    state.clipboard.files = state.clipboard.files.filter((file) => known.has(file));
  }

  function updateSelectionUI() {
    for (const row of elements.docList.querySelectorAll(".tree-row-doc")) {
      const selected = state.selection.has(row.dataset.file);
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", String(selected));
      row.classList.toggle("is-cut", state.clipboard.mode === "cut" && state.clipboard.files.includes(row.dataset.file));
    }

    updateSelectionMeta();
  }

  function updateSelectionMeta() {
    if (!elements.selectionMeta) {
      return;
    }

    const count = state.selection.size;
    elements.selectionMeta.hidden = count < 2;
    if (count >= 2) {
      elements.selectionMeta.textContent = `${count} selected`;
    }
  }

  function setSelection(files, { anchor = null } = {}) {
    state.selection = new Set(files);
    if (anchor !== null) {
      state.selectionAnchor = anchor;
    }
    updateSelectionUI();
  }

  function clearSelection() {
    if (state.selection.size === 0) {
      return;
    }
    state.selection.clear();
    state.selectionAnchor = null;
    updateSelectionUI();
  }

  function handleRowSelection(file, event) {
    if (event.shiftKey && state.selectionAnchor) {
      const from = state.visibleFileOrder.indexOf(state.selectionAnchor);
      const to = state.visibleFileOrder.indexOf(file);

      if (from >= 0 && to >= 0) {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        const range = state.visibleFileOrder.slice(lo, hi + 1);
        // Ctrl+Shift adds the range to what is already selected, as Explorer does.
        setSelection(event.ctrlKey || event.metaKey ? [...state.selection, ...range] : range);
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      if (state.selection.has(file)) {
        state.selection.delete(file);
      } else {
        state.selection.add(file);
      }
      state.selectionAnchor = file;
      updateSelectionUI();
      return;
    }

    setSelection([file], { anchor: file });
  }

  // What an operation should act on: the selection when the row is part of it,
  // otherwise just the row that was invoked.
  function resolveTargetFiles(file) {
    if (file && state.selection.has(file) && state.selection.size > 1) {
      return [...state.selection];
    }
    return file ? [file] : [...state.selection];
  }

  global.AppSelection = {
    pruneSelection,
    resolveTargetFiles,
    setSelection,
    clearSelection,
    updateSelectionMeta,
    updateSelectionUI,
    handleRowSelection
  };
})(typeof window === "undefined" ? globalThis : window);
