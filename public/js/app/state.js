// The one object the interface is a function of.
//
// Everything drawn on the screen is drawn from this and nothing else, so a
// change here followed by a render is the whole update path. It is handed out
// by reference — every module reads and writes the same object, which is what
// makes "set it, then render" work from anywhere.

(function (global) {
  const state = {
    docs: [],
    deletedDocs: [],
    folders: [],
    foldersById: new Map(),
    rootFolderLabel: "Ungrouped",

    // "docs" | "recycle" | "archive" | "links". Most code only cares whether we
    // are browsing deleted documents (read-only), so isRecycleBinMode stays
    // available as a derived accessor.
    viewMode: "docs",

    // Named modes, not "anything that is not docs". It used to be the latter,
    // which was true while recycle and archive were the only other views — and
    // would have quietly told every caller that the links pane was a bin of
    // deleted documents.
    get isRecycleBinMode() {
      return this.viewMode === "recycle" || this.viewMode === "archive";
    },

    set isRecycleBinMode(value) {
      this.viewMode = value ? "recycle" : "docs";
    },

    links: [],
    linksLoaded: false,
    linkGroups: [],
    linkFilter: "",

    // One search box serves both halves of the library, and the same words mean
    // different things in each. Each place keeps its own query here and gets it
    // back on the way in, so a trip to the links does not wipe the document
    // search you were in the middle of.
    searchQueries: { docs: "", links: "" },

    // The line under the sidebar title belongs to the query above, so it is put
    // down and picked up with it. Recomputing it on the way back would mean
    // running the search again, which is the round trip this is here to avoid.
    searchMetas: { docs: "", links: "" },

    // Where the document was scrolled to when the links pane went over it. The
    // article is display:none while it is hidden, so the browser forgets.
    viewerScrollTop: 0,
    // null = every link; "" = only the ungrouped ones; otherwise a group name.
    linkGroupFilter: null,
    linkIconsRunning: false,
    linkDragId: null,
    linkModalOpen: false,

    filteredDocs: [],
    contentCache: new Map(),
    activeFile: null,
    editorMode: "create",
    // "write" | "preview". Only consulted below the tab breakpoint; above it both
    // panes are visible and this is inert.
    editorTab: "write",
    // Editing the open document in place, in the viewer. `initial` is the source
    // it was entered with, which is both what Cancel restores and what "has this
    // changed?" is measured against.
    pageEdit: {
      active: false,
      file: null,
      title: "",
      initial: ""
    },
    // Redraw of the preview under an open source box, debounced.
    embedPreviewTimer: null,
    // Where each live checkbox in the open document lives in its source. Empty
    // when the boxes are not live, which is also what makes a click a no-op.
    taskMarkers: [],
    editorFile: null,
    editorOpen: false,
    editorInitialContent: "",
    editorInitialFileName: "",
    mermaidReady: false,
    // Which palette the initialized Mermaid instance was built with.
    mermaidTheme: null,
    panZoomCounter: 0,
    searchResults: [],
    // How many of the matches the panel is currently showing. Reset to
    // SUPERSEARCH_LIMIT whenever the query changes; grown by "Show more".
    searchRevealCount: 0,
    searchPanelOpen: false,
    searchRequestId: 0,
    searchInputTimer: null,
    searchResultsQuery: "",
    jumpHighlightTimer: null,
    jumpQuery: "",
    jumpTerms: [],
    jumpMatchIndex: -1,
    jumpMatchCount: 0,
    jumpMarkedNodes: [],
    jumpMatchFile: null,
    openDocumentRequestId: 0,
    editorScrollSyncLock: false,
    folderModalOpen: false,
    folderModalMode: "create",
    folderModalTargetFile: null,
    pendingUploadFile: null,
    editorPreviewTextTimer: null,
    editorPreviewDiagramTimer: null,
    folderModalTargetFolderId: null,
    folderModalParentId: null,
    collapsedFolderIds: new Set(),
    groupRevealCounts: new Map(),

    // Explorer-style selection and clipboard.
    selection: new Set(),
    selectionAnchor: null,
    clipboard: { files: [], mode: null },
    dragPayload: null,
    confirmOpen: false,
    confirmResolver: null,
    // Session. Nothing here is a credential: the session itself is an httpOnly
    // cookie the script cannot read. csrfToken is a double-submit value, useless
    // without the cookie.
    authenticated: false,
    user: null,
    permissions: [],
    csrfToken: "",
    publicReads: false,
    mustChangePassword: false,
    canWrite: false,

    loginOpen: false,
    passwordOpen: false,
    passwordForced: false,
    usersOpen: false,
    users: [],

    shareOpen: false,
    shareFile: null,
    shares: new Map()
  };

  global.AppState = { state };
})(typeof window === "undefined" ? globalThis : window);
