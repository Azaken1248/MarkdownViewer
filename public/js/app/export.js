// Exporting the open document from the workspace.
//
// Nothing is gated here: a document you are reading is one you may already
// copy, paste and print, and a download of it is not a new permission. The
// share page is the place where that is a decision, and it is made by whoever
// published the link.

/* exported AppExport */
var AppExport = (function () {
  const { elements } = AppDom;
  const { state } = AppState;
  const { notify } = AppNotify;

  function sourceOf() {
    const cached = state.contentCache.get(state.activeFile);
    return cached ? cached.content : "";
  }

  function titleOf() {
    return String(state.activeFile || "Document").replace(/\.[^./\\]+$/, "");
  }

  function attach() {
    if (!elements.exportDocBtn) {
      return;
    }

    Exporter.attach({
      button: elements.exportDocBtn,
      name: () => state.activeFile || "document",
      title: titleOf,
      // The rendered document, as it stands: formulas laid out, diagrams
      // drawn, code coloured. There is no ink in the workspace — annotating
      // is a share-page thing — so the copy is the article alone.
      article: () => elements.docContent,
      source: sourceOf,
      notify
    });
  }

  /* Only offered for something there is a copy of.
   *
   * With nothing open there is nothing to export, and in the recycle bin what
   * is on screen is a deleted document being previewed rather than one of the
   * library's.
   */
  function updateExportButton() {
    if (!elements.exportDocBtn) {
      return;
    }

    const usable = Boolean(state.activeFile) && !state.isRecycleBinMode;
    elements.exportDocBtn.disabled = !usable;
  }

  return { attach, updateExportButton };
})();
