/* Folder collapse state.
 *
 * Every folder used to render expanded on every load, which on a real corpus
 * means a wall of files with no structure visible. The tree now starts fully
 * collapsed, and what you open is remembered — so a reload picks up where you
 * left off instead of throwing the whole tree open again.
 */

(function (global) {
  const { state } = global.AppState;

  const COLLAPSED_FOLDERS_STORAGE_KEY = "mdviewer.collapsedFolders";
  let collapseStateRestored = false;

  function persistCollapsedFolders() {
    try {
      window.localStorage.setItem(
        COLLAPSED_FOLDERS_STORAGE_KEY,
        JSON.stringify([...state.collapsedFolderIds])
      );
    } catch {
      // Private mode. The state still holds for this page session.
    }
  }

  function applyInitialFolderCollapse() {
    if (collapseStateRestored) {
      return;
    }

    collapseStateRestored = true;

    let stored = null;
    try {
      const raw = window.localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }

    if (Array.isArray(stored)) {
      // Folders deleted since the last visit are dropped rather than kept as
      // dead ids that would accumulate forever.
      const live = new Set([...state.folders.map((folder) => folder.id), "__root__"]);
      state.collapsedFolderIds = new Set(stored.filter((id) => live.has(id)));
      return;
    }

    // No stored preference: start with everything closed. A folder created later
    // is not in the set, so it appears expanded, which is what you want right
    // after making one.
    //
    // "__root__" is the Ungrouped bucket. It is not in state.folders, and it is
    // usually the largest group of all, so leaving it out would defeat the point.
    state.collapsedFolderIds = new Set([
      ...state.folders.map((folder) => folder.id),
      "__root__"
    ]);
    persistCollapsedFolders();
  }

  function toggleFolderCollapse(folderKey) {
    if (!folderKey) {
      return;
    }

    if (state.collapsedFolderIds.has(folderKey)) {
      state.collapsedFolderIds.delete(folderKey);
    } else {
      state.collapsedFolderIds.add(folderKey);
    }

    persistCollapsedFolders();
    App.renderDocList();
  }

  global.AppFolderCollapse = {
    persistCollapsedFolders,
    applyInitialFolderCollapse,
    toggleFolderCollapse
  };
})(typeof window === "undefined" ? globalThis : window);
