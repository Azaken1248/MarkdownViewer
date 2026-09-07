/* Reloading the library and putting the page back the way it was.
 *
 * One function, but it sits at the meeting point of nearly everything: it
 * refetches the documents, re-runs the current search over them, and reopens
 * whatever should be open afterwards. Everything that changes the library on
 * the server — an upload, a save, a delete, a move — ends by calling this.
 */
(function (global) {

const { elements } = global.AppDom;
const { state } = global.AppState;
const { showDocumentInUrl } = global.AppLocation;
const { setMeta } = global.AppShell;
const { setStatus } = global.AppNotify;
const { updateActiveDocUI } = global.AppViewerHeader;
const {
  fetchDocs, hydrateSearchContent, showEmptyState, showNoDocumentOpen
} = global.AppDocs;
const { applySearch } = global.AppSearching;
const { openDocument } = global.AppOpening;

async function refreshDocs({ openFile = null, preserveSearch = true } = {}) {
  setMeta("Loading documents...");

  await fetchDocs();

  // Warm the content cache in the background so the offline fallback in
  // applySearch() can match on document text, not just titles and filenames.
  void hydrateSearchContent();

  const query = preserveSearch ? elements.searchInput.value : "";
  if (!preserveSearch) {
    elements.searchInput.value = "";
  }

  await applySearch(query);

  if (state.docs.length === 0) {
    state.activeFile = null;
    showDocumentInUrl(null, { replace: true });
    updateActiveDocUI(null);
    showEmptyState("No markdowns yet", "Upload a markdown or create one in the live editor.", "ph-file-plus");
    setStatus("No documents yet. Create or upload one to get started.", "neutral");
    return;
  }

  const target = state.docs.find((doc) => doc.file === openFile)?.file
    || state.docs.find((doc) => doc.file === state.activeFile)?.file
    || null;

  if (!target) {
    showNoDocumentOpen();

    // A document was asked for by name — typed, refreshed, or opened from a
    // link someone pasted — and the library does not have it. The address bar
    // is now the only place that still believes in it, so say what happened
    // and put the address back rather than leaving a bare "nothing selected".
    if (openFile) {
      showEmptyState("Document not found", `There is nothing called “${openFile}” in this library.`, "ph-file-dashed");
      setMeta("Document not found");
    }

    return;
  }

  await openDocument(target, false, { forceReload: true });
}


global.AppRefresh = { refreshDocs };

})(typeof window === "undefined" ? globalThis : window);
