// The library, as the page currently holds it.
//
// Which collection is on screen, the document behind a path, the folder behind
// an id, and the nested shape the tree is drawn from. All of it reads state and
// writes none of it: ask the same question twice and get the same answer twice,
// which is what lets every other module ask without coordinating.

(function (global) {
  const { state } = global.AppState;
  const { compareNames } = global.AppText;
  const { elements } = global.AppDom;

  function getCurrentDocsCollection() {
    return state.isRecycleBinMode ? state.deletedDocs : state.docs;
  }

  function getDocByFile(file, includeDeleted = false) {
    const docsCollection = includeDeleted ? [...state.docs, ...state.deletedDocs] : getCurrentDocsCollection();
    return docsCollection.find((doc) => doc.file === file) || null;
  }

  function getFolderRecord(folderId) {
    if (!folderId) {
      return null;
    }

    return state.foldersById.get(folderId) || null;
  }

  function getFolderLabel(folderId) {
    if (!folderId) {
      return state.rootFolderLabel || "Ungrouped";
    }

    return getFolderRecord(folderId)?.name || state.rootFolderLabel || "Ungrouped";
  }

  function getFolderOrder(folderId) {
    // Unfiled documents are a catch-all, so they sort below every real folder
    // instead of being pinned above them. Mirrors UNFILED_FOLDER_ORDER on the server.
    if (!folderId) {
      return Number.MAX_SAFE_INTEGER;
    }

    const folder = getFolderRecord(folderId);
    if (!folder) {
      return Number.MAX_SAFE_INTEGER;
    }

    return Number.isFinite(Number(folder.order)) ? Number(folder.order) : Number.MAX_SAFE_INTEGER;
  }

  function getDocCacheVersion(doc) {
    return String(doc?.updatedAt || doc?.deletedAt || "");
  }

  function folderPathIds(folderId) {
    const ids = [];
    let current = getFolderRecord(folderId);
    let guard = 0;

    while (current && guard++ < 32) {
      ids.unshift(current.id);
      current = current.parentId ? getFolderRecord(current.parentId) : null;
    }

    return ids;
  }

  // Builds the nested structure the renderer walks: every folder node carries its
  // own documents plus its child folders, sorted the way the server ordered them.
  function buildFolderTree(docs) {
    const docsByFolder = new Map();
    for (const doc of docs) {
      const key = doc.folderId || "__root__";
      if (!docsByFolder.has(key)) {
        docsByFolder.set(key, []);
      }
      docsByFolder.get(key).push(doc);
    }

    // The server already sorts, but a document renamed or moved in this session
    // is placed locally before the next reload, and it should land in the right
    // place rather than at the end of its folder.
    for (const list of docsByFolder.values()) {
      list.sort((left, right) => compareNames(left.title || left.file, right.title || right.file)
        || compareNames(left.file, right.file));
    }

    const childrenOf = new Map();
    for (const folder of state.folders) {
      const key = folder.parentId || "__top__";
      if (!childrenOf.has(key)) {
        childrenOf.set(key, []);
      }
      childrenOf.get(key).push(folder);
    }

    for (const list of childrenOf.values()) {
      list.sort((left, right) => compareNames(left.name, right.name));
    }

    const isSearching = Boolean(elements.searchInput.value.trim());

    // An empty folder is worth showing in the normal view — it is somewhere to
    // put things. It is not worth showing in a search result, and it is not worth
    // showing in the recycle bin or the archive, where the whole folder tree
    // rendering empty made those views look like they still held everything.
    const hideEmptyBranches = isSearching || state.isRecycleBinMode;

    const buildNode = (folder, depth) => {
      const children = (childrenOf.get(folder.id) || [])
        .map((child) => buildNode(child, depth + 1))
        .filter(Boolean);
      const ownDocs = docsByFolder.get(folder.id) || [];

      if (hideEmptyBranches && ownDocs.length === 0 && children.length === 0) {
        return null;
      }

      return { folder, depth, docs: ownDocs, children };
    };

    const roots = (childrenOf.get("__top__") || [])
      .map((folder) => buildNode(folder, 0))
      .filter(Boolean);

    const rootDocs = docsByFolder.get("__root__") || [];
    if (rootDocs.length > 0 || !hideEmptyBranches) {
      roots.push({ folder: null, depth: 0, docs: rootDocs, children: [] });
    }

    return roots;
  }

  global.AppLibrary = {
    getCurrentDocsCollection,
    getDocByFile,
    getFolderRecord,
    getFolderLabel,
    getFolderOrder,
    getDocCacheVersion,
    folderPathIds,
    buildFolderTree
  };
})(typeof window === "undefined" ? globalThis : window);
