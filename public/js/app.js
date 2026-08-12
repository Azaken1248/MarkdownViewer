const elements = {
  appShell: document.getElementById("appShell"),
  toggleSidebar: document.getElementById("toggleSidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  sidebarTitle: document.getElementById("sidebarTitle"),
  refreshDocs: document.getElementById("refreshDocs"),
  toggleRecycleBinBtn: document.getElementById("toggleRecycleBinBtn"),
  toggleArchiveBtn: document.getElementById("toggleArchiveBtn"),
  uploadTrigger: document.getElementById("uploadTrigger"),
  uploadMenu: document.getElementById("uploadMenu"),
  uploadFilesItem: document.getElementById("uploadFilesItem"),
  uploadFolderItem: document.getElementById("uploadFolderItem"),
  uploadFolderInput: document.getElementById("uploadFolderInput"),
  uploadInput: document.getElementById("uploadInput"),
  createFolderBtn: document.getElementById("createFolderBtn"),
  collapseAllBtn: document.getElementById("collapseAllBtn"),
  closeSidebarBtn: document.getElementById("closeSidebarBtn"),
  newDocBtn: document.getElementById("newDocBtn"),
  editDocBtn: document.getElementById("editDocBtn"),
  editCurrentDocBtn: document.getElementById("editCurrentDocBtn"),
  softDeleteDocBtn: document.getElementById("softDeleteDocBtn"),
  hardDeleteDocBtn: document.getElementById("hardDeleteDocBtn"),
  restoreDocBtn: document.getElementById("restoreDocBtn"),
  breadcrumbs: document.getElementById("breadcrumbs"),
  activeDocMeta: document.getElementById("activeDocMeta"),
  matchNav: document.getElementById("matchNav"),
  matchNavLabel: document.getElementById("matchNavLabel"),
  matchPrevBtn: document.getElementById("matchPrevBtn"),
  matchNextBtn: document.getElementById("matchNextBtn"),
  matchCloseBtn: document.getElementById("matchCloseBtn"),
  dockSearch: document.getElementById("dockSearch"),
  dockOpenDocs: document.getElementById("dockOpenDocs"),
  dockUpload: document.getElementById("dockUpload"),
  dockNew: document.getElementById("dockNew"),
  dockEdit: document.getElementById("dockEdit"),
  searchWrap: document.querySelector(".search-wrap"),
  searchInput: document.getElementById("searchInput"),
  clearSearchBtn: document.getElementById("clearSearchBtn"),
  superSearchPanel: document.getElementById("superSearchPanel"),
  superSearchCount: document.getElementById("superSearchCount"),
  superSearchList: document.getElementById("superSearchList"),
  superSearchHint: document.getElementById("superSearchHint"),
  clearFilterBtn: document.getElementById("clearFilterBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  searchMeta: document.getElementById("searchMeta"),
  selectionMeta: document.getElementById("selectionMeta"),
  contextMenu: document.getElementById("contextMenu"),
  toastStack: document.getElementById("toastStack"),
  toastStackUrgent: document.getElementById("toastStackUrgent"),
  docList: document.getElementById("docList"),
  sidebar: document.getElementById("sidebar"),
  emptyState: document.getElementById("emptyState"),
  docContent: document.getElementById("docContent"),
  toggleLinksBtn: document.getElementById("toggleLinksBtn"),
  viewerToolbar: document.getElementById("viewerToolbar"),
  linksPane: document.getElementById("linksPane"),
  linksGrid: document.getElementById("linksGrid"),
  linksEmpty: document.getElementById("linksEmpty"),
  linksCount: document.getElementById("linksCount"),
  linkSearchInput: document.getElementById("linkSearchInput"),
  addLinkBtn: document.getElementById("addLinkBtn"),
  linkModal: document.getElementById("linkModal"),
  linkBackdrop: document.getElementById("linkBackdrop"),
  closeLinkModalBtn: document.getElementById("closeLinkModalBtn"),
  cancelLinkBtn: document.getElementById("cancelLinkBtn"),
  linkForm: document.getElementById("linkForm"),
  linkUrlInput: document.getElementById("linkUrlInput"),
  linkNoteInput: document.getElementById("linkNoteInput"),
  linkGroupsInput: document.getElementById("linkGroupsInput"),
  linkGroupOptions: document.getElementById("linkGroupOptions"),
  linksGroups: document.getElementById("linksGroups"),
  linkError: document.getElementById("linkError"),
  saveLinkBtn: document.getElementById("saveLinkBtn"),
  editorModal: document.getElementById("editorModal"),
  editorBackdrop: document.getElementById("editorBackdrop"),
  closeEditorBtn: document.getElementById("closeEditorBtn"),
  saveDocBtn: document.getElementById("saveDocBtn"),
  editorFileName: document.getElementById("editorFileName"),
  editorFolderField: document.getElementById("editorFolderField"),
  editorTabs: document.getElementById("editorTabs"),
  editorGrid: document.getElementById("editorGrid"),
  pageEditBar: document.getElementById("pageEditBar"),
  pageEditState: document.getElementById("pageEditState"),
  pageEditSourceBtn: document.getElementById("pageEditSourceBtn"),
  pageEditCancelBtn: document.getElementById("pageEditCancelBtn"),
  pageEditSaveBtn: document.getElementById("pageEditSaveBtn"),
  visualToolbar: document.getElementById("visualToolbar"),
  visualImageBtn: document.getElementById("visualImageBtn"),
  imageInput: document.getElementById("imageInput"),
  editorTabWrite: document.getElementById("editorTabWrite"),
  editorTabPreview: document.getElementById("editorTabPreview"),
  editorWritePane: document.getElementById("editorWritePane"),
  editorPreviewPane: document.getElementById("editorPreviewPane"),
  editorFolderSelect: document.getElementById("editorFolderSelect"),
  editorInput: document.getElementById("editorInput"),
  editorPreview: document.getElementById("editorPreview"),
  confirmModal: document.getElementById("confirmModal"),
  confirmBackdrop: document.getElementById("confirmBackdrop"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmMessage: document.getElementById("confirmMessage"),
  confirmCancelBtn: document.getElementById("confirmCancelBtn"),
  confirmProceedBtn: document.getElementById("confirmProceedBtn"),
  folderModal: document.getElementById("folderModal"),
  folderBackdrop: document.getElementById("folderBackdrop"),
  folderTitle: document.getElementById("folderTitle"),
  folderDescription: document.getElementById("folderDescription"),
  folderNameInput: document.getElementById("folderNameInput"),
  createFolderConfirmBtn: document.getElementById("createFolderConfirmBtn"),
  loginModal: document.getElementById("loginModal"),
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
  loginSubmitBtn: document.getElementById("loginSubmitBtn"),
  loginMessage: document.getElementById("loginMessage"),
  loginTitle: document.getElementById("loginTitle"),

  passwordModal: document.getElementById("passwordModal"),
  passwordForm: document.getElementById("passwordForm"),
  passwordUsername: document.getElementById("passwordUsername"),
  currentPassword: document.getElementById("currentPassword"),
  newPassword: document.getElementById("newPassword"),
  confirmPassword: document.getElementById("confirmPassword"),
  passwordError: document.getElementById("passwordError"),
  passwordCancelBtn: document.getElementById("passwordCancelBtn"),
  passwordBackdrop: document.getElementById("passwordBackdrop"),
  passwordTitle: document.getElementById("passwordTitle"),
  passwordMessage: document.getElementById("passwordMessage"),

  usersModal: document.getElementById("usersModal"),
  usersBackdrop: document.getElementById("usersBackdrop"),
  usersTableBody: document.getElementById("usersTableBody"),
  closeUsersBtn: document.getElementById("closeUsersBtn"),
  newUserForm: document.getElementById("newUserForm"),
  newUserName: document.getElementById("newUserName"),
  newUserPassword: document.getElementById("newUserPassword"),
  newUserRole: document.getElementById("newUserRole"),
  newUserError: document.getElementById("newUserError"),
  newUserDetails: document.getElementById("newUserDetails"),

  kernelBar: document.getElementById("kernelBar"),
  kernelStatus: document.getElementById("kernelStatus"),
  restartKernelBtn: document.getElementById("restartKernelBtn"),

  shareDocBtn: document.getElementById("shareDocBtn"),
  shareModal: document.getElementById("shareModal"),
  shareBackdrop: document.getElementById("shareBackdrop"),
  shareStatus: document.getElementById("shareStatus"),
  shareUrlField: document.getElementById("shareUrlField"),
  shareUrlInput: document.getElementById("shareUrlInput"),
  copyShareUrlBtn: document.getElementById("copyShareUrlBtn"),
  shareOnceHint: document.getElementById("shareOnceHint"),
  shareCloseBtn: document.getElementById("shareCloseBtn"),
  revokeShareBtn: document.getElementById("revokeShareBtn"),
  createShareBtn: document.getElementById("createShareBtn"),

  accountBtn: document.getElementById("accountBtn"),
  accountMenu: document.getElementById("accountMenu"),
  accountIdentity: document.getElementById("accountIdentity"),
  changePasswordItem: document.getElementById("changePasswordItem"),
  manageUsersItem: document.getElementById("manageUsersItem"),
  signOutItem: document.getElementById("signOutItem"),
  folderPicker: document.getElementById("folderPicker"),
  folderPickerList: document.getElementById("folderPickerList"),
  moveToRootBtn: document.getElementById("moveToRootBtn"),
  closeFolderModalBtn: document.getElementById("closeFolderModalBtn")
};

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
  linkGroups: [],
  linkFilter: "",
  // null = every link; "" = only the ungrouped ones; otherwise a group name.
  linkGroupFilter: null,
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

const MOBILE_BREAKPOINT = 920;
const SUPERSEARCH_LIMIT = 8;
// Each "Show more" click in the results panel reveals this many further rows.
const SUPERSEARCH_PAGE_SIZE = 12;
// How many document rows each folder group renders before offering "show more".
const DOC_LIST_PAGE_SIZE = 50;
const MATCH_SWIPE_THRESHOLD = 56;
const MATCH_SWIPE_VERTICAL_LIMIT = 42;
// The sanitizer configuration, the marked options and the code-language
// aliases now live in markdown-core.js, shared with the share page.
function filenameToTitle(filename) {
  return stripDocumentExtension(filename)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function escapeHtml(value) {
  return MarkdownCore.escapeHtml(value);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDocumentExtension(filename) {
  return String(filename || "").replace(/\.(md|markdown|mmd|mermaid|ipynb)$/i, "");
}

function isNotebookFile(fileName) {
  return MarkdownCore.isNotebookFile(fileName);
}




function tokenizeSearchQuery(query) {
  return normalize(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasLooseSubsequence(needle, haystack) {
  const compactNeedle = normalize(needle).replace(/\s+/g, "");
  const compactHaystack = normalize(haystack).replace(/\s+/g, "");
  if (!compactNeedle || !compactHaystack) {
    return false;
  }

  let index = 0;
  for (const char of compactHaystack) {
    if (char === compactNeedle[index]) {
      index += 1;
      if (index === compactNeedle.length) {
        return true;
      }
    }
  }

  return false;
}

function highlightMatches(text, searchTerms) {
  const raw = String(text || "");
  const tokens = [...new Set((searchTerms || [])
    .map((term) => normalize(term).trim())
    .filter((term) => term.length >= 2))]
    .sort((left, right) => right.length - left.length);

  if (tokens.length === 0) {
    return escapeHtml(raw);
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
  return raw
    .split(pattern)
    .map((part, index) => (
      index % 2 === 1
        ? `<mark>${escapeHtml(part)}</mark>`
        : escapeHtml(part)
    ))
    .join("");
}

function buildSearchSnippet(content, query, tokens) {
  const raw = String(content || "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return "No preview available.";
  }

  const normalizedContent = normalize(raw);
  const searchTerms = [...new Set([normalize(query), ...(tokens || [])]
    .map((token) => normalize(token).trim())
    .filter(Boolean))];

  let matchIndex = -1;
  let matchToken = "";

  for (const token of searchTerms) {
    const index = normalizedContent.indexOf(token);
    if (index >= 0 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchToken = token;
    }
  }

  if (matchIndex === -1) {
    return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw;
  }

  const focusLength = Math.max(matchToken.length, 18);
  const start = Math.max(0, matchIndex - 56);
  const end = Math.min(raw.length, matchIndex + focusLength + 72);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < raw.length ? "..." : "";
  return `${prefix}${raw.slice(start, end)}${suffix}`;
}

function scoreDocForQuery(doc, normalizedQuery, tokens) {
  const title = normalize(doc.title);
  const file = normalize(doc.originalFile || doc.file);
  const folderName = normalize(doc.folderName || "");
  const content = normalize(state.contentCache.get(doc.file)?.content || "");

  let score = 0;
  let matched = false;

  if (title.startsWith(normalizedQuery)) {
    score += 1200;
    matched = true;
  }

  if (file.startsWith(normalizedQuery)) {
    score += 1000;
    matched = true;
  }

  if (title.includes(normalizedQuery)) {
    score += 850;
    matched = true;
  }

  if (file.includes(normalizedQuery)) {
    score += 760;
    matched = true;
  }

  if (folderName.startsWith(normalizedQuery)) {
    score += 680;
    matched = true;
  }

  if (folderName.includes(normalizedQuery)) {
    score += 560;
    matched = true;
  }

  const contentIndex = content.indexOf(normalizedQuery);
  if (contentIndex >= 0) {
    score += 520 + Math.max(0, 140 - (contentIndex / 11));
    matched = true;
  }

  if (!matched && hasLooseSubsequence(normalizedQuery, `${title} ${file}`)) {
    score += 240;
    matched = true;
  }

  let tokenHits = 0;
  for (const token of tokens) {
    if (title.includes(token)) {
      score += 220;
      tokenHits += 1;
      continue;
    }

    if (file.includes(token)) {
      score += 190;
      tokenHits += 1;
      continue;
    }

    if (folderName.includes(token)) {
      score += 150;
      tokenHits += 1;
      continue;
    }

    if (content.includes(token)) {
      score += 110;
      tokenHits += 1;
      continue;
    }

    score -= 20;
  }

  if (!matched && tokenHits === 0) {
    return null;
  }

  return score + Math.min(180, tokenHits * 45);
}

function getCurrentDocsCollection() {
  return state.isRecycleBinMode ? state.deletedDocs : state.docs;
}

function buildSuperSearchMatches(query, docsCollection = getCurrentDocsCollection()) {
  const normalizedQuery = normalize(query).trim();
  const tokens = tokenizeSearchQuery(normalizedQuery);
  const searchTerms = [...new Set([normalizedQuery, ...tokens].filter(Boolean))];

  if (!normalizedQuery) {
    return { matches: [], searchTerms };
  }

  const matches = [];
  for (const doc of docsCollection) {
    const score = scoreDocForQuery(doc, normalizedQuery, tokens);
    if (score === null) {
      continue;
    }

    const content = String(state.contentCache.get(doc.file)?.content || "");
    matches.push({
      ...doc,
      score,
      snippet: buildSearchSnippet(content, normalizedQuery, searchTerms)
    });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const rightTime = Date.parse(right.updatedAt || "") || 0;
    const leftTime = Date.parse(left.updatedAt || "") || 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return left.file.localeCompare(right.file);
  });

  return { matches, searchTerms };
}

function buildJumpSearchTerms(query, terms = []) {
  const normalizedSeedTerms = [
    normalize(query).trim(),
    ...tokenizeSearchQuery(query),
    ...(terms || []).map((term) => normalize(term).trim())
  ];

  return [...new Set(normalizedSeedTerms.filter((term) => term.length >= 2))]
    .sort((left, right) => right.length - left.length);
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


function syncFolderModalUI() {
  if (!elements.folderModal) {
    return;
  }

  const mode = state.folderModalMode;
  const targetFile = state.folderModalTargetFile ? getDocByFile(state.folderModalTargetFile, true) : null;
  const targetFolder = state.folderModalTargetFolderId ? getFolderRecord(state.folderModalTargetFolderId) : null;

  if (mode === "upload") {
    const pendingName = state.pendingUploadFile?.name || "this file";
    elements.folderTitle.textContent = `Upload ${pendingName}`;
    elements.folderDescription.textContent = "Pick the folder it should land in, or create a new one.";
    elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-folder-plus"></i> Create And Upload';
    elements.moveToRootBtn.innerHTML = '<i class="ph ph-stack"></i> Upload To Ungrouped';
    elements.moveToRootBtn.hidden = false;
    elements.folderPicker.hidden = false;
  } else if (mode === "move") {
    elements.folderTitle.textContent = targetFile
      ? `Move ${targetFile.title || targetFile.file} to a folder`
      : "Move document to a folder";
    elements.folderDescription.textContent = targetFile
      ? `Choose an existing folder or create a new one for ${targetFile.file}.`
      : "Choose an existing folder or create a new one.";
    elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-folder-plus"></i> Create And Move';
    elements.moveToRootBtn.innerHTML = '<i class="ph ph-stack"></i> Move To Ungrouped';
    elements.moveToRootBtn.hidden = false;
    elements.folderPicker.hidden = false;
  } else if (mode === "rename") {
    elements.folderTitle.textContent = targetFolder ? `Rename ${targetFolder.name}` : "Rename folder";
    elements.folderDescription.textContent = targetFolder
      ? "Update the logical folder name without moving any files."
      : "Update the logical folder name without moving any files.";
    elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-pencil-simple"></i> Rename Folder';
    elements.moveToRootBtn.hidden = true;
    elements.folderPicker.hidden = true;
  } else {
    const parent = state.folderModalParentId ? getFolderRecord(state.folderModalParentId) : null;
    elements.folderTitle.textContent = parent ? `New folder in ${parent.name}` : "Create folder";
    elements.folderDescription.textContent = parent
      ? `The new folder will be nested inside ${parent.path}. Files on disk are not moved.`
      : "Create a logical folder to group documents without changing the physical layout.";
    elements.createFolderConfirmBtn.innerHTML = '<i class="ph ph-folder-plus"></i> Create Folder';
    elements.moveToRootBtn.hidden = true;
    elements.folderPicker.hidden = true;
  }

  elements.folderNameInput.value = targetFolder ? targetFolder.name : "";
  elements.folderNameInput.placeholder = mode === "rename" ? "Rename folder" : "Project Alpha";
}

function renderFolderPickerList() {
  if (!elements.folderPickerList) {
    return;
  }

  const moveMode = state.folderModalMode === "move" || state.folderModalMode === "upload";
  const docsCollection = state.isRecycleBinMode ? state.deletedDocs : state.docs;
  const counts = new Map();

  for (const doc of docsCollection) {
    const key = doc.folderId || "__root__";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Depth-first so the picker reads like the tree, with each entry indented to
  // its level and labelled by its full path.
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

  const folders = [];
  const walk = (parentKey, depth) => {
    for (const folder of childrenOf.get(parentKey) || []) {
      folders.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk("__top__", 0);

  if (folders.length === 0) {
    elements.folderPickerList.innerHTML = '<div class="folder-empty">No folders yet. Create one to organize documents.</div>';
    return;
  }

  elements.folderPickerList.innerHTML = folders.map(({ folder, depth }) => `
    <button class="folder-choice" type="button" data-folder-id="${escapeHtml(folder.id)}"
      style="--depth: ${depth}" title="${escapeHtml(folder.path)}" ${moveMode ? "" : "disabled"}>
      <span class="folder-choice-title"><i class="ph ph-folder"></i>${escapeHtml(folder.name)}</span>
      <span class="folder-choice-meta">${escapeHtml(String(counts.get(folder.id) || 0))} doc(s)</span>
    </button>
  `).join("");

  elements.folderPickerList.querySelectorAll(".folder-choice").forEach((button) => {
    if (!moveMode) {
      return;
    }

    button.addEventListener("click", async () => {
      const folderId = button.getAttribute("data-folder-id");

      if (state.folderModalMode === "upload") {
        const pending = state.pendingUploadFile;
        closeFolderModal();
        await uploadMarkdown(pending, folderId);
        return;
      }

      if (state.folderModalTargetFile) {
        try {
          await moveDocumentToFolder(state.folderModalTargetFile, folderId);
          closeFolderModal();
        } catch (error) {
          setStatus(error.message, "error");
        }
      }
    });
  });
}

// Folders and documents are listed alphabetically, so there is no manual
// ordering to move a folder within. The "move up" / "move down" row actions and
// the reorder request they sent are gone with it — a control that cannot change
// what you see is worse than no control.

function openFolderModal({ mode = "create", file = null, folderId = null, parentId = null } = {}) {
  state.folderModalOpen = true;
  state.folderModalMode = mode;
  state.folderModalTargetFile = file;
  state.folderModalTargetFolderId = folderId;
  // Only meaningful in "create" mode: which folder the new one nests under.
  state.folderModalParentId = parentId;
  syncFolderModalUI();
  renderFolderPickerList();

  elements.folderModal.classList.add("open");
  elements.folderModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.folderModal);
  syncBodyLock();
  window.requestAnimationFrame(() => elements.folderNameInput.focus());
  window.requestAnimationFrame(() => {
    if (mode === "rename") {
      elements.folderNameInput.select();
    }
  });
}

function closeFolderModal() {
  if (state.folderModalMode === "upload" && state.pendingUploadFile) {
    state.pendingUploadFile = null;
    elements.uploadInput.value = "";
  }

  state.folderModalOpen = false;
  state.folderModalMode = "create";
  state.folderModalTargetFile = null;
  state.folderModalTargetFolderId = null;
  state.folderModalParentId = null;
  elements.folderNameInput.value = "";
  elements.folderModal.classList.remove("open");
  elements.folderModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.folderModal);
  syncBodyLock();
}

/* --------------------------------------------------------------------------
   Folder collapse state

   Every folder used to render expanded on every load, which on a real corpus
   means a wall of files with no structure visible. The tree now starts fully
   collapsed, and what you open is remembered — so a reload picks up where you
   left off instead of throwing the whole tree open again.
   -------------------------------------------------------------------------- */

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
  renderDocList();
}

function getDocByFile(file, includeDeleted = false) {
  const docsCollection = includeDeleted ? [...state.docs, ...state.deletedDocs] : getCurrentDocsCollection();
  return docsCollection.find((doc) => doc.file === file) || null;
}

function clearDocumentJumpDecorations() {
  if (state.jumpHighlightTimer) {
    window.clearTimeout(state.jumpHighlightTimer);
    state.jumpHighlightTimer = null;
  }

  elements.docContent.querySelectorAll("mark.doc-jump-highlight").forEach((markNode) => {
    const textNode = document.createTextNode(markNode.textContent || "");
    markNode.replaceWith(textNode);
  });

  elements.docContent.querySelectorAll(".doc-jump-focus").forEach((node) => {
    node.classList.remove("doc-jump-focus");
  });

  state.jumpMarkedNodes = [];
  state.jumpMatchFile = null;
}

function areSameJumpTerms(leftTerms, rightTerms) {
  if (!Array.isArray(leftTerms) || !Array.isArray(rightTerms)) {
    return false;
  }

  if (leftTerms.length !== rightTerms.length) {
    return false;
  }

  return leftTerms.every((term, index) => term === rightTerms[index]);
}

function updateJumpNavigationUI() {
  const hasQuery = state.jumpQuery.trim().length > 0;
  const hasMatches = state.jumpMatchCount > 0;

  elements.matchNav.hidden = !hasQuery;
  elements.matchNavLabel.textContent = hasMatches
    ? `${state.jumpMatchIndex + 1} / ${state.jumpMatchCount}`
    : "0 / 0";
  elements.matchPrevBtn.disabled = !hasMatches;
  elements.matchNextBtn.disabled = !hasMatches;
}

function resetJumpNavigation() {
  clearDocumentJumpDecorations();
  state.jumpQuery = "";
  state.jumpTerms = [];
  state.jumpMatchIndex = -1;
  state.jumpMatchCount = 0;
  state.jumpMarkedNodes = [];
  state.jumpMatchFile = null;
  updateJumpNavigationUI();
}

function findDocumentTextMatches(root, terms) {
  const matches = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest("pre, code, .mermaid, .mermaid-block, .mermaid-fallback-code, mark.doc-jump-highlight")) {
          return NodeFilter.FILTER_REJECT;
        }

        if (!String(node.nodeValue || "").trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let currentNode = walker.nextNode();
  while (currentNode) {
    const normalizedText = normalize(currentNode.nodeValue || "");
    let cursor = 0;

    while (cursor < normalizedText.length) {
      let bestTerm = "";
      for (const term of terms) {
        if (term.length <= bestTerm.length) {
          continue;
        }

        if (normalizedText.startsWith(term, cursor)) {
          bestTerm = term;
        }
      }

      if (bestTerm) {
        matches.push({
          node: currentNode,
          start: cursor,
          end: cursor + bestTerm.length
        });
        cursor += bestTerm.length;
        continue;
      }

      cursor += 1;
    }

    currentNode = walker.nextNode();
  }

  return matches;
}

function highlightDocumentMatches(matches, activeIndex) {
  const markNodes = [];

  // Wrap from the end so text offsets remain valid for earlier matches.
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const range = document.createRange();
    range.setStart(match.node, match.start);
    range.setEnd(match.node, match.end);

    const markNode = document.createElement("mark");
    markNode.className = "doc-jump-highlight";
    if (index === activeIndex) {
      markNode.classList.add("doc-jump-highlight-active");
    } else {
      markNode.classList.add("doc-jump-highlight-passive");
    }

    try {
      range.surroundContents(markNode);
      markNodes[index] = markNode;
    } catch (error) {
      console.error("Failed to apply match highlight", error);
    }
  }

  return markNodes.filter((node) => Boolean(node));
}

function setActiveJumpMatch(targetIndex, { scrollBehavior = "auto" } = {}) {
  if (state.jumpMarkedNodes.length === 0) {
    state.jumpMatchIndex = -1;
    state.jumpMatchCount = 0;
    updateJumpNavigationUI();
    return {
      found: false,
      index: -1,
      total: 0
    };
  }

  const total = state.jumpMarkedNodes.length;
  const safeIndex = ((Number(targetIndex) % total) + total) % total;

  const previousNode = state.jumpMarkedNodes[state.jumpMatchIndex];
  if (previousNode?.isConnected) {
    previousNode.classList.remove("doc-jump-highlight-active");
    previousNode.classList.add("doc-jump-highlight-passive");
  }

  const activeMarkNode = state.jumpMarkedNodes[safeIndex];
  if (!activeMarkNode?.isConnected) {
    state.jumpMatchIndex = -1;
    state.jumpMatchCount = 0;
    updateJumpNavigationUI();
    return {
      found: false,
      index: -1,
      total: 0
    };
  }

  activeMarkNode.classList.remove("doc-jump-highlight-passive");
  activeMarkNode.classList.add("doc-jump-highlight-active");

  elements.docContent.querySelectorAll(".doc-jump-focus").forEach((node) => {
    node.classList.remove("doc-jump-focus");
  });

  const focusNode = activeMarkNode.closest("h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th") || activeMarkNode.parentElement;
  if (focusNode) {
    focusNode.classList.add("doc-jump-focus");
  }

  activeMarkNode.scrollIntoView({
    behavior: scrollBehavior,
    block: "center",
    inline: "nearest"
  });

  state.jumpMatchIndex = safeIndex;
  state.jumpMatchCount = total;
  updateJumpNavigationUI();

  return {
    found: true,
    index: safeIndex,
    total
  };
}

function jumpToSearchMatch(query, terms = [], targetIndex = 0, options = {}) {
  const sourceFile = String(options.sourceFile || state.activeFile || "").trim();
  const scrollBehavior = String(options.scrollBehavior || "auto");

  const searchTerms = buildJumpSearchTerms(query, terms);
  const normalizedQuery = String(query || "").trim();
  const normalizedTerms = [...searchTerms];
  const previousQuery = state.jumpQuery;
  const canReuseExistingMarks = Boolean(
    sourceFile
    && state.jumpMatchFile === sourceFile
    && state.jumpMarkedNodes.length > 0
    && state.jumpMarkedNodes.every((node) => node?.isConnected)
    && previousQuery === normalizedQuery
    && areSameJumpTerms(state.jumpTerms, normalizedTerms)
  );

  state.jumpQuery = normalizedQuery;
  state.jumpTerms = [...normalizedTerms];

  if (searchTerms.length === 0) {
    clearDocumentJumpDecorations();
    state.jumpMatchIndex = -1;
    state.jumpMatchCount = 0;
    state.jumpMarkedNodes = [];
    state.jumpMatchFile = null;
    updateJumpNavigationUI();
    return {
      found: false,
      index: -1,
      total: 0
    };
  }

  if (!canReuseExistingMarks) {
    clearDocumentJumpDecorations();

    const matches = findDocumentTextMatches(elements.docContent, searchTerms);
    state.jumpMatchCount = matches.length;

    if (matches.length === 0) {
      state.jumpMatchIndex = -1;
      state.jumpMarkedNodes = [];
      state.jumpMatchFile = sourceFile || null;
      updateJumpNavigationUI();
      return {
        found: false,
        index: -1,
        total: 0
      };
    }

    state.jumpMarkedNodes = highlightDocumentMatches(matches, Number(targetIndex));
    state.jumpMatchCount = state.jumpMarkedNodes.length;
    state.jumpMatchFile = sourceFile || state.activeFile || null;

    if (state.jumpMarkedNodes.length === 0) {
      state.jumpMatchIndex = -1;
      state.jumpMatchCount = 0;
      updateJumpNavigationUI();
      return {
        found: false,
        index: -1,
        total: 0
      };
    }

    state.jumpMatchIndex = -1;
  }

  return setActiveJumpMatch(targetIndex, { scrollBehavior });
}

function getNavigationDocFilesForJump() {
  if (!state.jumpQuery.trim()) {
    return [];
  }

  const sourceDocs = state.filteredDocs.length > 0
    ? state.filteredDocs
    : state.searchResults.length > 0
      ? state.searchResults
      : state.docs;

  const orderedFiles = [];
  const seen = new Set();

  if (state.activeFile && !seen.has(state.activeFile)) {
    seen.add(state.activeFile);
    orderedFiles.push(state.activeFile);
  }

  for (const doc of sourceDocs) {
    const file = String(doc?.file || "");
    if (!file || seen.has(file)) {
      continue;
    }

    seen.add(file);
    orderedFiles.push(file);
  }

  return orderedFiles;
}

async function moveToAdjacentJumpMatch(direction) {
  if (!state.jumpQuery.trim()) {
    return {
      found: false,
      index: -1,
      total: 0
    };
  }

  const step = direction >= 0 ? 1 : -1;

  if (state.jumpMatchCount > 0) {
    const targetIndex = state.jumpMatchIndex >= 0
      ? state.jumpMatchIndex + step
      : step > 0 ? 0 : -1;

    if (targetIndex >= 0 && targetIndex < state.jumpMatchCount) {
      return setActiveJumpMatch(targetIndex, { scrollBehavior: "smooth" });
    }
  }

  const navigationFiles = getNavigationDocFilesForJump();
  if (navigationFiles.length === 0) {
    return {
      found: false,
      index: -1,
      total: 0
    };
  }

  let currentFileIndex = navigationFiles.indexOf(state.activeFile || state.jumpMatchFile || "");
  if (currentFileIndex < 0) {
    currentFileIndex = 0;
  }

  for (let attempt = 0; attempt < navigationFiles.length; attempt += 1) {
    currentFileIndex = (currentFileIndex + step + navigationFiles.length) % navigationFiles.length;
    const targetFile = navigationFiles[currentFileIndex];

    await openDocument(targetFile, true, {
      jumpQuery: state.jumpQuery,
      jumpTerms: state.jumpTerms,
      jumpIndex: step > 0 ? 0 : -1,
      scrollBehavior: "smooth"
    });

    if (state.activeFile === targetFile && state.jumpMatchCount > 0) {
      return {
        found: true,
        index: state.jumpMatchIndex,
        total: state.jumpMatchCount,
        file: targetFile,
        docChanged: true
      };
    }
  }

  return {
    found: false,
    index: -1,
    total: 0
  };
}

function setSuperSearchOpen(isOpen) {
  state.searchPanelOpen = Boolean(isOpen);
  elements.superSearchPanel.hidden = !state.searchPanelOpen;
}

function syncSearchInputState(query) {
  const hasQuery = String(query || "").trim().length > 0;
  elements.searchWrap.classList.toggle("has-value", hasQuery);
}

// Enter does two different things depending on whether you are reading a
// document that already matches the query, and neither was signposted
// anywhere in the app.
function renderSearchShortcutHint(query) {
  if (!elements.superSearchHint) {
    return;
  }

  const traversing = !state.isRecycleBinMode
    && state.activeFile
    && state.jumpQuery.trim().length > 0
    && normalize(query) === normalize(state.jumpQuery);

  elements.superSearchHint.innerHTML = traversing
    ? '<kbd>Enter</kbd> next match <span>·</span> <kbd>Shift</kbd>+<kbd>Enter</kbd> previous <span>·</span> <kbd>Esc</kbd> exit search'
    : '<kbd>Enter</kbd> open top result <span>·</span> <kbd>Esc</kbd> exit search';
}

function renderSuperSearchPanel(query, matches, searchTerms) {
  const trimmedQuery = String(query || "").trim();
  syncSearchInputState(query);
  renderSearchShortcutHint(trimmedQuery);

  if (!trimmedQuery) {
    state.searchResults = [];
    state.searchResultsQuery = "";
    state.searchRevealCount = SUPERSEARCH_LIMIT;
    elements.superSearchList.innerHTML = "";
    elements.superSearchCount.textContent = "0 results";
    setSuperSearchOpen(false);
    return;
  }

  // A new query starts the reveal over; re-rendering the same query (a "Show
  // more" click, a background refresh) keeps whatever the reader had unfolded.
  if (trimmedQuery !== state.searchResultsQuery) {
    state.searchRevealCount = SUPERSEARCH_LIMIT;
  }

  const revealCount = Math.min(
    Math.max(state.searchRevealCount, SUPERSEARCH_LIMIT),
    matches.length
  );
  const topResults = matches.slice(0, revealCount);
  const remaining = matches.length - topResults.length;
  state.searchResults = topResults;
  state.searchResultsQuery = trimmedQuery;
  state.searchRevealCount = revealCount;
  elements.superSearchCount.textContent = remaining > 0
    ? `Showing ${topResults.length} of ${matches.length}`
    : `${matches.length} result${matches.length === 1 ? "" : "s"}`;

  if (topResults.length === 0) {
    elements.superSearchList.innerHTML = "<li class=\"supersearch-empty\">No matches. Try fewer keywords or part of the filename.</li>";
    setSuperSearchOpen(true);
    return;
  }

  elements.superSearchList.innerHTML = topResults.map((doc) => `
    <li>
      <button class="supersearch-item" type="button" data-file="${escapeHtml(doc.file)}">
        <span class="supersearch-item-title"><i class="ph ${escapeHtml(doc.icon)}"></i>${highlightMatches(doc.title, searchTerms)}</span>
        <span class="supersearch-item-file">${highlightMatches(doc.originalFile || doc.file, searchTerms)}</span>
        <span class="supersearch-item-snippet">${highlightMatches(doc.snippet, searchTerms)}</span>
      </button>
    </li>
  `).join("");

  if (remaining > 0) {
    const more = document.createElement("li");
    more.innerHTML = `
      <button class="supersearch-more" type="button">
        <i class="ph ph-caret-down" aria-hidden="true"></i>
        <span>Show ${remaining} more</span>
      </button>
    `;
    more.querySelector(".supersearch-more").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.searchRevealCount = revealCount + SUPERSEARCH_PAGE_SIZE;
      renderSuperSearchPanel(query, matches, searchTerms);
      // Land the reader on the first newly-revealed row, not back at the top.
      const rows = elements.superSearchList.querySelectorAll(".supersearch-item");
      rows[revealCount]?.focus();
    });
    elements.superSearchList.appendChild(more);
  }

  elements.superSearchList.querySelectorAll(".supersearch-item").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const file = button.getAttribute("data-file");
      if (!file) {
        return;
      }

      if (state.isRecycleBinMode) {
        await openRecycleBinDocument(file);
      } else {
        await openDocument(file, true, {
          jumpQuery: trimmedQuery,
          jumpTerms: searchTerms
        });
      }

      closeSidebarOnMobile();
      setSuperSearchOpen(false);
    });
  });

  setSuperSearchOpen(true);
}

function setNavOpen(isOpen) {
  elements.appShell.classList.toggle("nav-open", isOpen);
  elements.toggleSidebar.setAttribute("aria-expanded", String(isOpen));
  syncBodyLock();
}

function syncBodyLock() {
  const shouldLock = elements.appShell.classList.contains("nav-open") || state.editorOpen || state.confirmOpen || state.folderModalOpen
    || state.loginOpen || state.passwordOpen || state.usersOpen || state.shareOpen || state.linkModalOpen;
  document.body.classList.toggle("lock-scroll", shouldLock);
}

/* --------------------------------------------------------------------------
   Theme

   Every colour in the stylesheet is a custom property, so switching themes is
   a single attribute on <html>. Two things do not follow automatically and are
   handled here: the browser-chrome theme-color meta, and Mermaid, which bakes
   hex into the SVG it emits and has to redraw.

   theme-boot.js has already applied the stored preference before first paint;
   this only takes over once the user touches the toggle.
   -------------------------------------------------------------------------- */

const THEME_STORAGE_KEY = "mdviewer.theme";
// Dark first: it is the app's long-standing look, so the default never
// surprises anyone who has not asked for a change.
const THEME_CYCLE = ["dark", "light", "auto"];
const THEME_META = {
  dark: { icon: "ph-moon", label: "Dark theme", next: "light" },
  light: { icon: "ph-sun", label: "Light theme", next: "auto" },
  auto: { icon: "ph-circle-half", label: "Theme follows your system", next: "dark" }
};
const THEME_COLORS = { dark: "#06090a", light: "#f4f8f7" };

function themePreference() {
  const stored = document.documentElement.dataset.themePreference;
  return THEME_CYCLE.includes(stored) ? stored : "dark";
}

// The concrete theme in force, with "auto" already resolved.
function activeThemeName() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function resolveThemePreference(preference) {
  if (preference !== "auto") {
    return preference;
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function syncThemeToggleUI() {
  if (!elements.themeToggleBtn) {
    return;
  }

  const preference = themePreference();
  const meta = THEME_META[preference];
  const icon = elements.themeToggleBtn.querySelector("i");
  if (icon) {
    icon.className = `ph ${meta.icon}`;
  }

  // Say what it is now and what the click does — an icon alone cannot.
  const label = `${meta.label}. Switch to ${THEME_META[meta.next].label.toLowerCase()}`;
  elements.themeToggleBtn.setAttribute("aria-label", label);
  elements.themeToggleBtn.title = label;
  delete elements.themeToggleBtn.dataset.tip;
}

async function applyThemePreference(preference, { announce = false } = {}) {
  const next = THEME_CYCLE.includes(preference) ? preference : "dark";
  const resolvedBefore = activeThemeName();
  const resolved = resolveThemePreference(next);

  document.documentElement.dataset.themePreference = next;
  document.documentElement.dataset.theme = resolved;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private mode. The choice still holds for this page session.
  }

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", THEME_COLORS[resolved]);
  }

  syncThemeToggleUI();

  if (announce) {
    notify(THEME_META[next].label + " enabled.", "info");
  }

  if (resolved !== resolvedBefore) {
    await repaintDiagramsForTheme();
  }
}

// Mermaid renders to a static SVG with the palette inlined, so the only way to
// recolour a diagram is to draw it again from its source.
async function repaintDiagramsForTheme() {
  const roots = [elements.docContent, elements.editorPreview].filter(Boolean);
  const blocks = roots.flatMap((root) => [...root.querySelectorAll(".mermaid-block")]);
  if (blocks.length === 0) {
    // Nothing on screen to redraw, but the next render must not reuse the old
    // palette.
    MarkdownCore.resetMermaidForThemeChange();
    return;
  }

  // Their SVGs are about to be replaced; leaving the instances bound would leak
  // handlers onto detached nodes.
  destroyPanZoomInstances();

  for (const block of blocks) {
    const source = block.dataset.mermaidSource;
    if (!source) {
      continue;
    }

    block.removeAttribute("data-processed");
    // Sizing is derived from the rendered viewBox and has to be measured again.
    block.style.aspectRatio = "";
    block.style.maxWidth = "";
    block.textContent = source;
    block.classList.add("mermaid");
  }

  MarkdownCore.resetMermaidForThemeChange();

  for (const root of roots) {
    await renderMermaidBlocks(root);
  }
}

function bindThemeToggle() {
  syncThemeToggleUI();

  elements.themeToggleBtn?.addEventListener("click", () => {
    void applyThemePreference(THEME_META[themePreference()].next, { announce: true });
  });

  // Only meaningful while the preference is "auto", but the listener is cheap
  // and the guard keeps an explicit choice from being overridden.
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
    if (themePreference() === "auto") {
      void applyThemePreference("auto");
    }
  });
}

/* --------------------------------------------------------------------------
   Modal focus containment

   The dialogs claimed aria-modal="true" but nothing enforced it: a screen
   reader could walk the whole page behind them, Tab escaped into the app, and
   closing one dropped focus on <body>. This keeps a stack (the editor can open
   a confirm on top of itself), marks everything below the top dialog inert,
   and hands focus back to whatever opened it.
   -------------------------------------------------------------------------- */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

const modalLayerStack = [];

function focusableWithin(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((node) => {
    // offsetParent is null for display:none subtrees; position:fixed nodes have
    // no offsetParent either, so fall back to a box check for those.
    return node.offsetParent !== null || node.getClientRects().length > 0;
  });
}

function syncModalInertness() {
  const top = modalLayerStack.length
    ? modalLayerStack[modalLayerStack.length - 1].element
    : null;

  for (const node of document.body.children) {
    // Toasts have to stay announceable even while a dialog is up.
    if (node.id === "toastRegion") {
      continue;
    }

    node.inert = Boolean(top) && node !== top;
  }
}

function trapModalTab(event) {
  if (event.key !== "Tab") {
    return;
  }

  const layer = modalLayerStack[modalLayerStack.length - 1];
  if (!layer || !layer.element.contains(event.currentTarget)) {
    return;
  }

  const focusable = focusableWithin(layer.element);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !layer.element.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function enterModalLayer(element) {
  if (modalLayerStack.some((layer) => layer.element === element)) {
    return;
  }

  const opener = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  element.addEventListener("keydown", trapModalTab);
  modalLayerStack.push({ element, opener });
  syncModalInertness();
}

function exitModalLayer(element) {
  const index = modalLayerStack.findIndex((layer) => layer.element === element);
  if (index === -1) {
    return;
  }

  const [layer] = modalLayerStack.splice(index, 1);
  element.removeEventListener("keydown", trapModalTab);
  syncModalInertness();

  // Only the dialog that actually owned focus should move it, and only if the
  // opener is still on the page and reachable.
  const opener = layer.opener;
  if (opener && opener.isConnected && !opener.inert && typeof opener.focus === "function") {
    opener.focus();
  }
}

function inferIcon(fileName) {
  const value = normalize(fileName);
  if (isNotebookFile(value)) {
    return "ph-file-code";
  }

  if (value.includes("srs") || value.includes("spec")) {
    return "ph-scroll";
  }

  if (value.includes("erd") || value.includes("schema") || value.includes("db")) {
    return "ph-graph";
  }

  if (value.includes("readme")) {
    return "ph-book-open-text";
  }

  if (value.endsWith(".mmd") || value.endsWith(".mermaid")) {
    return "ph-graph";
  }

  return "ph-file-text";
}

function ensureDocFilename(fileName) {
  const value = String(fileName || "").trim();
  if (!value) {
    return "";
  }

  if (/\.(md|markdown|mmd|mermaid)$/i.test(value)) {
    return value;
  }

  return `${value}.md`;
}

function isDiagramFile(fileName) {
  return MarkdownCore.isDiagramFile(fileName);
}

function toMermaidMarkdown(source) {
  return MarkdownCore.toMermaidMarkdown(source);
}

function formatDate(isoString) {
  if (!isoString) {
    return "unknown";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(size) {
  const value = Number(size || 0);
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function setMeta(message) {
  elements.searchMeta.textContent = message;
  syncFilterChip();
}

// The results panel and the file tree are two views of one query. This chip is
// what ties them together in the tree, and the way out of the filter without
// hunting for the search box.
function syncFilterChip() {
  if (!elements.clearFilterBtn) {
    return;
  }

  elements.clearFilterBtn.hidden = String(elements.searchInput.value || "").trim().length === 0;
}

// --- Breadcrumbs ----------------------------------------------------------
// With folders nesting arbitrarily, "which folder am I in" stops being obvious
// from the tree alone once a branch is scrolled or collapsed. The trail answers
// it, and each ancestor is a way back to that folder in the tree.

// Beyond this many crumbs the middle ancestors collapse behind an overflow
// button, so a deep path cannot push the file name out of view.
const BREADCRUMB_MAX_CRUMBS = 4;

function scrollTreeRowIntoView(row) {
  // Scrolling is the least important half of "reveal this folder", so it must
  // not be able to take the expand-and-focus half down with it.
  if (!row || typeof row.scrollIntoView !== "function") {
    return;
  }

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
}

function revealFolderInTree(folderId) {
  // Expanding the whole ancestor chain, not just the folder, so revealing a
  // deep folder cannot leave it hidden inside a collapsed parent.
  for (const id of folderPathIds(folderId)) {
    state.collapsedFolderIds.delete(id);
  }

  persistCollapsedFolders();
  renderDocList();

  const row = findFolderRow(folderId);
  scrollTreeRowIntoView(row);
  row?.querySelector(".tree-row-btn")?.focus();

  if (window.innerWidth <= MOBILE_BREAKPOINT) {
    setNavOpen(true);
  }
}

function buildCrumbButton(label, { title = "", icon = "", onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "crumb";
  button.title = title || label;
  button.innerHTML = icon ? `<i class="ph ${icon}" aria-hidden="true"></i><span></span>` : "<span></span>";
  button.querySelector("span").textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function appendCrumbSeparator(container) {
  const sep = document.createElement("i");
  sep.className = "ph ph-caret-right crumb-sep";
  sep.setAttribute("aria-hidden", "true");
  container.appendChild(sep);
}

function renderBreadcrumbs({ iconClass, label, folderId, rootLabel }) {
  const nav = elements.breadcrumbs;
  if (!nav) {
    return;
  }

  nav.innerHTML = "";

  // Root crumb: the scope being browsed, not a folder.
  const rootIcon = state.viewMode === "archive"
    ? "ph-archive-box"
    : state.viewMode === "recycle" ? "ph-trash" : "ph-house";

  const crumbs = [
    buildCrumbButton(rootLabel, {
      icon: rootIcon,
      title: `Back to the top of ${rootLabel}`,
      onClick: () => {
        elements.docList.scrollTo({ top: 0 });
        if (window.innerWidth <= MOBILE_BREAKPOINT) {
          setNavOpen(true);
        }
      }
    })
  ];

  const ancestors = folderId ? folderPathIds(folderId) : [];
  for (const id of ancestors) {
    const folder = getFolderRecord(id);
    if (!folder) {
      continue;
    }

    crumbs.push(buildCrumbButton(folder.name, {
      title: `Show ${folder.path} in the file tree`,
      onClick: () => revealFolderInTree(id)
    }));
  }

  // Everything except the root and the last folder can fold away; the file name
  // is rendered separately and always survives.
  const overflowCount = crumbs.length - (BREADCRUMB_MAX_CRUMBS - 1);
  if (overflowCount > 1) {
    const hidden = crumbs.splice(1, overflowCount);
    const hiddenIds = ancestors.slice(0, overflowCount);

    const more = document.createElement("button");
    more.type = "button";
    more.className = "crumb crumb-overflow";
    more.title = "Show the folders in between";
    more.setAttribute("aria-label", `${hidden.length} more folders`);
    more.setAttribute("aria-haspopup", "menu");
    more.innerHTML = '<i class="ph ph-dots-three" aria-hidden="true"></i>';
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = more.getBoundingClientRect();
      openContextMenu(rect.left, rect.bottom + 4, hiddenIds.map((id) => ({
        label: getFolderRecord(id)?.name || id,
        icon: "ph-folder",
        action: () => revealFolderInTree(id)
      })));
    });

    crumbs.splice(1, 0, more);
  }

  crumbs.forEach((crumb, index) => {
    if (index > 0) {
      appendCrumbSeparator(nav);
    }
    nav.appendChild(crumb);
  });

  appendCrumbSeparator(nav);

  const current = document.createElement("span");
  current.className = "crumb crumb-current";
  current.setAttribute("aria-current", "page");
  current.innerHTML = `<i class="ph ${iconClass}" aria-hidden="true"></i><span></span>`;
  current.querySelector("span").textContent = label;
  nav.appendChild(current);
}

// The tree rows are one line each, so the size/date/folder facts they used to
// carry as chips live here instead, next to the file they describe.
function setViewerHeading(iconClass, label, metaParts, folderId = null) {
  const rootLabel = state.viewMode === "archive"
    ? "Archive"
    : state.viewMode === "recycle" ? "Recycle bin" : "Files";

  renderBreadcrumbs({ iconClass, label, folderId, rootLabel });

  if (elements.activeDocMeta) {
    elements.activeDocMeta.textContent = (metaParts || []).filter(Boolean).join("  ·  ");
  }
}

// Every write control in the viewer toolbar and the mobile dock, gated in one
// place. updateActiveDocUI has three exits and each used to set these
// independently, so a viewer ended up with live Edit and Delete buttons that
// only failed once the server refused them.
function applyPermissionGating() {
  const writable = can("doc:write");

  // Hidden rather than disabled: a greyed-out button that can never become
  // usable is just clutter with a tooltip.
  for (const control of [elements.newDocBtn, elements.uploadTrigger, elements.editDocBtn,
    elements.createFolderBtn, elements.editCurrentDocBtn, elements.softDeleteDocBtn,
    elements.dockNew, elements.dockUpload, elements.dockEdit]) {
    if (control) {
      control.hidden = !writable;
    }
  }

  // Erasing from the archive is admin-only; the same button is "Archive" for
  // everyone else, so it follows doc:write outside the archive view.
  if (elements.hardDeleteDocBtn) {
    elements.hardDeleteDocBtn.hidden = state.viewMode === "archive"
      ? !can("doc:erase")
      : !writable;
  }

  if (elements.restoreDocBtn) {
    elements.restoreDocBtn.hidden = !writable || !state.isRecycleBinMode;
  }

  if (elements.manageUsersItem) {
    elements.manageUsersItem.hidden = !can("user:manage");
  }

  // A viewer can read the saved links but not add, refresh or remove one.
  // Adding makes the server fetch a URL, which is a write in every sense that
  // matters here.
  if (elements.addLinkBtn) {
    elements.addLinkBtn.hidden = !writable;
  }

  if (!writable && state.linkModalOpen) {
    closeLinkModal();
  }

  // The per-card buttons are built at render time, so the cards have to be
  // rebuilt for a role change to reach them.
  if (state.viewMode === "links") {
    renderLinks();
  }

  // A menu left open over a control that has just been hidden.
  if (!writable && elements.uploadMenu && !elements.uploadMenu.hidden) {
    setUploadMenuOpen(false);
  }

  updateShareButton();
}

function updateActiveDocUI(fileName) {
  if (!fileName) {
    setViewerHeading("ph-file-text", "No file selected", []);
    elements.editDocBtn.disabled = true;
    elements.editCurrentDocBtn.disabled = true;
    elements.dockEdit.disabled = true;
    elements.softDeleteDocBtn.disabled = true;
    elements.hardDeleteDocBtn.disabled = true;
    elements.restoreDocBtn.disabled = true;
    applyPermissionGating();
    return;
  }

  if (state.isRecycleBinMode) {
    const deletedDoc = state.deletedDocs.find((doc) => doc.file === fileName);
    const label = deletedDoc?.originalFile || fileName;
    const inArchive = state.viewMode === "archive";
    setViewerHeading(inArchive ? "ph-archive-box" : "ph-trash", label, [
      inArchive ? "Archived" : "In recycle bin",
      deletedDoc ? formatBytes(deletedDoc.size) : "",
      deletedDoc?.deletedAt ? `deleted ${formatDate(deletedDoc.deletedAt)}` : ""
    ], deletedDoc?.folderId || null);
    elements.editDocBtn.disabled = true;
    elements.editCurrentDocBtn.disabled = true;
    elements.dockEdit.disabled = true;
    elements.softDeleteDocBtn.disabled = true;
    elements.hardDeleteDocBtn.disabled = false;
    elements.restoreDocBtn.disabled = false;
    applyPermissionGating();
    return;
  }

  const notebookFile = isNotebookFile(fileName);
  const doc = getDocByFile(fileName);
  // The folder is in the breadcrumb trail now, so it is not repeated here.
  // The trail already names every folder above it, so the last crumb is the
  // document's name rather than its whole path.
  setViewerHeading(notebookFile ? "ph-file-code" : "ph-file-text", docName(fileName), [
    doc ? formatBytes(doc.size) : "",
    doc?.updatedAt ? `updated ${formatDate(doc.updatedAt)}` : ""
  ], doc?.folderId || null);
  elements.editDocBtn.disabled = notebookFile;
  updateShareButton();
  elements.editCurrentDocBtn.disabled = notebookFile;
  elements.dockEdit.disabled = notebookFile;
  elements.softDeleteDocBtn.disabled = false;
  elements.hardDeleteDocBtn.disabled = false;
  elements.restoreDocBtn.disabled = true;
  applyPermissionGating();
}

// --- Notifications --------------------------------------------------------
// A single inline status line could only ever show the most recent thing that
// happened, and it showed it somewhere nobody was looking. Toasts stack, say
// what happened, and clear themselves.

const TOAST_TONES = {
  success: { icon: "ph-check-circle", title: "Done", duration: 4000 },
  error: { icon: "ph-warning-circle", title: "Something went wrong", duration: 8000 },
  warning: { icon: "ph-warning", title: "Heads up", duration: 6000 },
  info: { icon: "ph-info", title: "", duration: 4500 },
  neutral: { icon: "ph-info", title: "", duration: 4500 }
};

const TOAST_MAX_VISIBLE = 4;
const activeToasts = new Set();

function dismissToast(toast) {
  if (!toast || !activeToasts.has(toast)) {
    return;
  }

  activeToasts.delete(toast);
  window.clearTimeout(toast.dataset.timerId ? Number(toast.dataset.timerId) : 0);
  toast.classList.add("is-leaving");

  // Fall back to removing it outright if the animation never fires (reduced
  // motion, background tab), otherwise the stack would fill up with corpses.
  const remove = () => toast.remove();
  toast.addEventListener("animationend", remove, { once: true });
  window.setTimeout(remove, 400);
}

function notify(message, tone = "info", options = {}) {
  const text = String(message || "").trim();
  if (!text) {
    return null;
  }

  const preset = TOAST_TONES[tone] || TOAST_TONES.info;
  const toneClass = TOAST_TONES[tone] ? tone : "info";
  const title = options.title !== undefined ? options.title : preset.title;
  const duration = Number.isFinite(options.duration) ? options.duration : preset.duration;
  const isUrgent = toneClass === "error";

  const stack = isUrgent ? elements.toastStackUrgent : elements.toastStack;
  if (!stack) {
    return null;
  }

  // Collapse a repeat of the message already on screen instead of stacking
  // duplicates, which is what a retry loop or a double-click produces.
  for (const existing of activeToasts) {
    if (existing.dataset.toastKey === `${toneClass}:${text}`) {
      dismissToast(existing);
      break;
    }
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${toneClass}`;
  toast.dataset.toastKey = `${toneClass}:${text}`;
  toast.setAttribute("role", isUrgent ? "alert" : "status");

  const icon = document.createElement("i");
  icon.className = `ph ${preset.icon} toast-icon`;
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "toast-body";

  if (title) {
    const titleNode = document.createElement("p");
    titleNode.className = "toast-title";
    titleNode.textContent = title;
    body.appendChild(titleNode);
  }

  const messageNode = document.createElement("p");
  messageNode.className = "toast-message";
  messageNode.textContent = text;
  body.appendChild(messageNode);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
  closeBtn.addEventListener("click", () => dismissToast(toast));

  const timer = document.createElement("span");
  timer.className = "toast-timer";
  timer.setAttribute("aria-hidden", "true");
  timer.style.animationDuration = `${duration}ms`;

  toast.append(icon, body, closeBtn, timer);
  stack.appendChild(toast);
  activeToasts.add(toast);

  const timerId = window.setTimeout(() => dismissToast(toast), duration);
  toast.dataset.timerId = String(timerId);

  // Oldest first, so trimming the overflow drops the stalest message.
  while (activeToasts.size > TOAST_MAX_VISIBLE) {
    const [oldest] = activeToasts;
    dismissToast(oldest);
  }

  return toast;
}

// Existing call sites speak in "neutral"/"success"/"error"; keep that vocabulary
// working rather than rewriting ninety of them by hand.
function setStatus(message, tone = "neutral") {
  if (!message) {
    return;
  }

  notify(message, tone === "neutral" ? "info" : tone);
}

function resolveConfirmDialog(confirmed) {
  if (!state.confirmOpen) {
    return;
  }

  state.confirmOpen = false;
  elements.confirmModal.classList.remove("open");
  elements.confirmModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.confirmModal);
  syncBodyLock();

  if (typeof state.confirmResolver === "function") {
    const resolver = state.confirmResolver;
    state.confirmResolver = null;
    resolver(Boolean(confirmed));
  }
}

function requestConfirmation({
  title,
  message,
  confirmLabel = "Continue",
  tone = "danger"
}) {
  return new Promise((resolve) => {
    if (typeof state.confirmResolver === "function") {
      const previousResolver = state.confirmResolver;
      state.confirmResolver = null;
      previousResolver(false);
    }

    elements.confirmTitle.textContent = title || "Please confirm this action";
    elements.confirmMessage.textContent = message || "Are you sure you want to continue?";
    elements.confirmProceedBtn.textContent = confirmLabel || "Continue";
    elements.confirmProceedBtn.classList.remove("btn-danger", "btn-primary");

    if (tone === "primary") {
      elements.confirmProceedBtn.classList.add("btn-primary");
    } else {
      elements.confirmProceedBtn.classList.add("btn-danger");
    }

    state.confirmOpen = true;
    state.confirmResolver = resolve;
    elements.confirmModal.classList.add("open");
    elements.confirmModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.confirmModal);
    syncBodyLock();
    elements.confirmProceedBtn.focus();
  });
}

/* --------------------------------------------------------------------------
   Session

   Accounts replace the shared editor token. The session lives in an httpOnly
   cookie the script cannot read, so there is nothing here to store or leak —
   credentials: "same-origin" is what attaches it.

   The CSRF token is the one piece the page does hold, because the whole point
   of a double-submit token is that script has to echo it back and cross-origin
   script cannot.
   -------------------------------------------------------------------------- */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* A document path in a URL.
 *
 * encodeURIComponent on the whole path would turn "docs/README.md" into
 * "docs%2FREADME.md" — one segment as far as routing is concerned, which the
 * wildcard routes do not match, and which a reverse proxy may rewrite anyway.
 * Each segment is encoded on its own and the separators stay separators.
 */
// The name of a document, without the folder it sits in. A document's identity
// is its path now ("docs/README.md"), and a row in a tree that already shows
// the folder should say "README.md".
/* Alphabetical, case-insensitively, with numbers compared as numbers so
 * "page-2" sorts before "page-10". The server sorts the same way; this exists
 * so the client can re-sort after a local change without waiting for a reload.
 */
function compareNames(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function docName(file) {
  const value = String(file || "");
  const index = value.lastIndexOf("/");
  return index === -1 ? value : value.slice(index + 1);
}

function docUrl(file) {
  return String(file).split("/").map(encodeURIComponent).join("/");
}

/* --- The address bar ------------------------------------------------------
 *
 * A document's address is its path: /Notes/day-one.md. It used to be a
 * fragment, /#Notes/day-one.md, which no server ever sees — so the URL was
 * really just a note the client left itself, and the page it named only
 * appeared because the client read it back.
 *
 * Navigation is still entirely in-page. pushState changes the address without
 * fetching anything; the server route of the same name exists only for when
 * that address is typed, refreshed or opened from a link somewhere else.
 */
function documentPath(file) {
  return `/${docUrl(file)}`;
}

// The document a URL names, or null for the app's own root.
function fileFromLocation() {
  const fromPath = decodePathFile(window.location.pathname);
  if (fromPath) {
    return fromPath;
  }

  // Links from before this existed, and anything that still points at one.
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) {
    return null;
  }

  try {
    return decodeURIComponent(hash) || null;
  } catch {
    return null;
  }
}

function decodePathFile(pathname) {
  const raw = String(pathname || "").replace(/^\/+/, "");
  if (!raw) {
    return null;
  }

  try {
    const file = raw.split("/").map(decodeURIComponent).join("/");
    // A path is only a document if it could name one. Anything else is the
    // app's own root by another name.
    const lower = file.toLowerCase();
    return UPLOADABLE_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? file : null;
  } catch {
    return null;
  }
}

// Called when the open document changes, not when the URL does.
function showDocumentInUrl(file, { replace = false } = {}) {
  const next = file ? documentPath(file) : "/";
  if (next === window.location.pathname && !window.location.hash) {
    return;
  }

  // The hash goes with it: an address cannot be half in each place.
  window.history[replace ? "replaceState" : "pushState"]({ file: file || null }, "", next);
}

async function requestJson(url, options = {}) {
  const requestOptions = { ...options, credentials: "same-origin" };
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };

  // express.json() only parses a body that says it is JSON, and silently leaves
  // req.body empty otherwise — so a caller that forgot this header got a
  // confusing "that field is missing" from the server rather than an error.
  // Every caller used to set it by hand, and every new one was one omission
  // away from the same bug. A string body from here is always JSON.
  if (typeof options.body === "string" && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  if (UNSAFE_METHODS.has(method) && state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }

  if (Object.keys(headers).length > 0) {
    requestOptions.headers = headers;
  }

  const response = await fetch(url, requestOptions);
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    // The session expired, was revoked, or never existed.
    applySession({ authenticated: false, user: null, permissions: [], csrfToken: null });
    throw new Error(payload?.error || "Your session has ended. Sign in again.");
  }

  if (response.status === 403 && payload?.code === "password_change_required") {
    // eslint-disable-next-line require-atomic-updates
    state.mustChangePassword = true;
    openPasswordModal({ forced: true });
    throw new Error(payload.error);
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload;
}

function can(permission) {
  return state.permissions.includes(permission);
}

// One place decides what the session means for the UI, so a role change or a
// sign-out cannot leave half the controls in the wrong state.
function applySession(payload) {
  state.authenticated = Boolean(payload?.authenticated);
  state.user = payload?.user || null;
  state.permissions = Array.isArray(payload?.permissions) ? payload.permissions : [];
  state.csrfToken = payload?.csrfToken || "";
  state.publicReads = Boolean(payload?.publicReads);
  state.canWrite = can("doc:write");
  state.mustChangePassword = Boolean(payload?.user?.mustChangePassword);

  syncAccountUI();
}

function syncAccountUI() {
  const signedIn = state.authenticated;

  if (elements.accountBtn) {
    const icon = elements.accountBtn.querySelector("i");
    if (icon) {
      icon.className = signedIn ? "ph ph-user-circle" : "ph ph-sign-in";
    }

    const label = signedIn
      ? `Signed in as ${state.user.username} (${state.user.role}). Account menu`
      : "Sign in";
    elements.accountBtn.setAttribute("aria-label", label);
    elements.accountBtn.title = label;
    delete elements.accountBtn.dataset.tip;
  }

  document.body.classList.toggle("is-signed-in", signedIn);
  document.body.classList.toggle("can-write", can("doc:write"));

  // Re-render the tree so row actions match the new role, then re-apply the
  // toolbar gate for whatever document is open.
  renderDocList();
  updateActiveDocUI(state.activeFile);
}

async function refreshSession() {
  try {
    const payload = await requestJson("/api/session", { cache: "no-store" });
    applySession(payload);
    return payload;
  } catch {
    applySession({ authenticated: false, user: null, permissions: [], csrfToken: null });
    return null;
  }
}

/* --------------------------------------------------------------------------
   Login, password change and account management
   -------------------------------------------------------------------------- */

function showFieldError(element, message) {
  if (!element) {
    return;
  }

  element.textContent = message || "";
  element.hidden = !message;
}

function openLoginModal() {
  state.loginOpen = true;
  showFieldError(elements.loginError, "");
  elements.loginPassword.value = "";

  elements.loginModal.classList.add("open");
  elements.loginModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.loginModal);
  syncBodyLock();

  window.requestAnimationFrame(() => {
    (elements.loginUsername.value ? elements.loginPassword : elements.loginUsername).focus();
  });
}

function closeLoginModal() {
  state.loginOpen = false;
  elements.loginPassword.value = "";
  elements.loginModal.classList.remove("open");
  elements.loginModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.loginModal);
  syncBodyLock();
}

async function submitLogin() {
  const username = String(elements.loginUsername.value || "").trim();
  const password = String(elements.loginPassword.value || "");

  if (!username || !password) {
    showFieldError(elements.loginError, "Enter your username and password.");
    return;
  }

  elements.loginSubmitBtn.disabled = true;
  showFieldError(elements.loginError, "");

  try {
    // Not requestJson: a failed sign-in is an expected outcome to show inline,
    // not an exception to toast, and there is no session to invalidate yet.
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      showFieldError(elements.loginError, payload?.error || "Sign-in failed.");
      elements.loginPassword.select();
      return;
    }

    applySession(payload);
    closeLoginModal();

    if (state.mustChangePassword) {
      notify("Set a new password to continue.", "warning");
      openPasswordModal({ forced: true });
      return;
    }

    notify(`Signed in as ${payload.user.username}.`, "success");
    await refreshDocs({ preserveSearch: false });
  } catch (error) {
    showFieldError(elements.loginError, error.message || "Sign-in failed.");
  } finally {
    // eslint-disable-next-line require-atomic-updates
    elements.loginSubmitBtn.disabled = false;
  }
}

async function signOut() {
  try {
    await requestJson("/api/auth/logout", { method: "POST" });
  } catch {
    // Even if the call fails, drop local state — the cookie may already be gone.
  }

  applySession({ authenticated: false, user: null, permissions: [], csrfToken: null });
  state.docs = [];
  state.filteredDocs = [];
  state.activeFile = null;
  renderDocList();
  updateActiveDocUI(null);
  notify("Signed out.", "neutral");
  openLoginModal();
}

function openPasswordModal({ forced = false } = {}) {
  if (state.passwordOpen) {
    return;
  }

  state.passwordOpen = true;
  state.passwordForced = forced;

  elements.currentPassword.value = "";
  elements.newPassword.value = "";
  elements.confirmPassword.value = "";
  elements.passwordUsername.value = state.user?.username || "";
  showFieldError(elements.passwordError, "");

  elements.passwordTitle.textContent = forced ? "Choose a new password" : "Change your password";
  elements.passwordMessage.textContent = forced
    ? "This account is using a password someone else set. Choose your own before continuing."
    : "Changing your password signs out every other session on your account.";
  // Nothing behind a forced change is usable, so there is nothing to cancel to.
  elements.passwordCancelBtn.hidden = forced;

  elements.passwordModal.classList.add("open");
  elements.passwordModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.passwordModal);
  syncBodyLock();
  window.requestAnimationFrame(() => elements.currentPassword.focus());
}

function closePasswordModal() {
  if (state.passwordForced) {
    return;
  }

  state.passwordOpen = false;
  elements.currentPassword.value = "";
  elements.newPassword.value = "";
  elements.confirmPassword.value = "";
  elements.passwordModal.classList.remove("open");
  elements.passwordModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.passwordModal);
  syncBodyLock();
}

async function submitPasswordChange() {
  const currentPassword = String(elements.currentPassword.value || "");
  const newPassword = String(elements.newPassword.value || "");
  const confirmPassword = String(elements.confirmPassword.value || "");

  if (newPassword !== confirmPassword) {
    showFieldError(elements.passwordError, "The two new passwords do not match.");
    elements.confirmPassword.select();
    return;
  }

  showFieldError(elements.passwordError, "");

  try {
    const payload = await requestJson("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    applySession(payload);
    state.passwordForced = false;
    closePasswordModal();
    notify("Password changed. Other sessions were signed out.", "success");

    // A forced change blocked the initial load, so the library is still empty.
    if (state.docs.length === 0) {
      await refreshDocs({ preserveSearch: false });
    }
  } catch (error) {
    showFieldError(elements.passwordError, error.message);
  }
}

// -- accounts ---------------------------------------------------------------

async function openUsersModal() {
  state.usersOpen = true;
  elements.usersModal.classList.add("open");
  elements.usersModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.usersModal);
  syncBodyLock();

  await refreshUsers();
}

function closeUsersModal() {
  state.usersOpen = false;
  elements.usersModal.classList.remove("open");
  elements.usersModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.usersModal);
  syncBodyLock();
}

async function refreshUsers() {
  try {
    const payload = await requestJson("/api/users", { cache: "no-store" });
    state.users = payload.users || [];
    renderUsers();
  } catch (error) {
    notify(error.message, "error");
  }
}

function renderUsers() {
  elements.usersTableBody.innerHTML = "";

  for (const user of state.users) {
    const row = document.createElement("tr");
    const isSelf = user.id === state.user?.id;

    const name = document.createElement("td");
    name.className = "users-cell-name";
    name.textContent = user.username;
    if (isSelf) {
      const badge = document.createElement("span");
      badge.className = "users-self";
      badge.textContent = "you";
      name.appendChild(badge);
    }
    row.appendChild(name);

    const roleCell = document.createElement("td");
    const roleSelect = document.createElement("select");
    roleSelect.className = "users-role";
    for (const role of ["viewer", "editor", "admin"]) {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role;
      option.selected = user.role === role;
      roleSelect.appendChild(option);
    }
    // Changing your own role is the one-click route to locking yourself out.
    roleSelect.disabled = isSelf;
    roleSelect.setAttribute("aria-label", `Role for ${user.username}`);
    roleSelect.addEventListener("change", () => {
      void updateUser(user.id, { role: roleSelect.value });
    });
    roleCell.appendChild(roleSelect);
    row.appendChild(roleCell);

    const status = document.createElement("td");
    status.textContent = user.disabled
      ? "Disabled"
      : user.mustChangePassword ? "Must set password" : "Active";
    row.appendChild(status);

    const lastSeen = document.createElement("td");
    lastSeen.textContent = user.lastLoginAt
      ? new Date(user.lastLoginAt).toLocaleDateString()
      : "Never";
    row.appendChild(lastSeen);

    const actions = document.createElement("td");
    actions.className = "users-actions";

    const resetBtn = document.createElement("button");
    resetBtn.className = "btn btn-sm";
    resetBtn.type = "button";
    resetBtn.textContent = "Reset password";
    resetBtn.addEventListener("click", () => {
      void resetUserPassword(user);
    });
    actions.appendChild(resetBtn);

    if (!isSelf) {
      const disableBtn = document.createElement("button");
      disableBtn.className = "btn btn-sm";
      disableBtn.type = "button";
      disableBtn.textContent = user.disabled ? "Enable" : "Disable";
      disableBtn.addEventListener("click", () => {
        void updateUser(user.id, { disabled: !user.disabled });
      });
      actions.appendChild(disableBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn btn-sm danger";
      deleteBtn.type = "button";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        void deleteUser(user);
      });
      actions.appendChild(deleteBtn);
    }

    row.appendChild(actions);
    elements.usersTableBody.appendChild(row);
  }
}

async function updateUser(id, changes) {
  try {
    await requestJson(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes)
    });

    await refreshUsers();
    notify("Account updated.", "success");
  } catch (error) {
    notify(error.message, "error");
    // The select still shows the value that failed; re-render to correct it.
    await refreshUsers();
  }
}

async function submitNewUser() {
  showFieldError(elements.newUserError, "");

  try {
    await requestJson("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: elements.newUserName.value,
        password: elements.newUserPassword.value,
        role: elements.newUserRole.value
      })
    });

    const username = elements.newUserName.value;
    elements.newUserName.value = "";
    elements.newUserPassword.value = "";
    elements.newUserRole.value = "viewer";
    elements.newUserDetails.open = false;

    await refreshUsers();
    notify(`Account "${username}" created.`, "success");
  } catch (error) {
    showFieldError(elements.newUserError, error.message);
  }
}

async function resetUserPassword(user) {
  const password = window.prompt(
    `New password for "${user.username}".\n\nThey will be required to change it at next sign-in.`
  );

  if (password === null) {
    return;
  }

  try {
    await requestJson(`/api/users/${encodeURIComponent(user.id)}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    await refreshUsers();
    notify(`Password reset for "${user.username}". Their other sessions were signed out.`, "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function deleteUser(user) {
  const confirmed = await requestConfirmation({
    title: `Delete "${user.username}"?`,
    message: "The account is removed and its sessions end immediately. Documents they created are not affected.",
    confirmLabel: "Delete account",
    tone: "danger"
  });

  if (!confirmed) {
    return;
  }

  try {
    await requestJson(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
    await refreshUsers();
    notify(`Account "${user.username}" deleted.`, "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

/* --------------------------------------------------------------------------
   Share links

   A share link publishes one document at an unguessable URL. The token is the
   credential, so the server stores only its hash and hands back the full URL
   exactly once — which is why the dialog says so, and why "create" on an
   already-shared document is a rotation that invalidates the old link.
   -------------------------------------------------------------------------- */

async function refreshShares() {
  if (!can("share:manage")) {
    state.shares = new Map();
    return;
  }

  try {
    const payload = await requestJson("/api/shares", { cache: "no-store" });
    state.shares = new Map((payload.shares || []).map((share) => [share.file, share]));
  } catch {
    // Not fatal: the share button just will not show a "shared" state.
    state.shares = new Map();
  }
}

function openShareModal(file) {
  state.shareOpen = true;
  state.shareFile = file;

  renderShareDialog();

  elements.shareModal.classList.add("open");
  elements.shareModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.shareModal);
  syncBodyLock();
}

function closeShareModal() {
  state.shareOpen = false;
  state.shareFile = null;
  elements.shareUrlInput.value = "";
  elements.shareUrlField.hidden = true;
  elements.shareOnceHint.hidden = true;
  elements.shareModal.classList.remove("open");
  elements.shareModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.shareModal);
  syncBodyLock();
}

function renderShareDialog() {
  const share = state.shares.get(state.shareFile);

  if (share) {
    const viewed = share.views > 0
      ? `Opened ${share.views} time${share.views === 1 ? "" : " s"}.`.replace(" s", "s")
      : "Not opened yet.";
    elements.shareStatus.innerHTML = `
      <p class="share-live"><i class="ph ph-globe-simple" aria-hidden="true"></i>
        <span><strong>${escapeHtml(state.shareFile)}</strong> is shared publicly.</span></p>
      <p class="share-sub">Created ${escapeHtml(new Date(share.createdAt).toLocaleDateString())} by
        ${escapeHtml(share.createdBy || "unknown")}. ${escapeHtml(viewed)}</p>
    `;
    elements.revokeShareBtn.hidden = false;
    elements.createShareBtn.textContent = "Replace link";
  } else {
    elements.shareStatus.innerHTML = `
      <p class="share-live"><i class="ph ph-lock-simple" aria-hidden="true"></i>
        <span><strong>${escapeHtml(state.shareFile)}</strong> is private.</span></p>
      <p class="share-sub">Only signed-in accounts can read it.</p>
    `;
    elements.revokeShareBtn.hidden = true;
    elements.createShareBtn.textContent = "Create link";
  }
}

async function createShareLink() {
  const file = state.shareFile;
  const existing = state.shares.get(file);

  if (existing) {
    const confirmed = await requestConfirmation({
      title: "Replace the existing link?",
      message: "The current link stops working immediately. Anyone still using it will get a 'not valid' page.",
      confirmLabel: "Replace link",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }
  }

  try {
    const payload = await requestJson(`/api/docs/${docUrl(file)}/share`, { method: "POST" });
    await refreshShares();
    renderShareDialog();

    elements.shareUrlInput.value = payload.url;
    elements.shareUrlField.hidden = false;
    elements.shareOnceHint.hidden = false;
    elements.shareUrlInput.select();

    updateShareButton();
    notify(payload.rotated ? "New share link created. The old one no longer works." : "Share link created.", "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function revokeShareLink() {
  const file = state.shareFile;
  const confirmed = await requestConfirmation({
    title: "Revoke the share link?",
    message: `"${file}" stops being publicly readable immediately.`,
    confirmLabel: "Revoke link",
    tone: "danger"
  });

  if (!confirmed) {
    return;
  }

  try {
    await requestJson(`/api/docs/${docUrl(file)}/share`, { method: "DELETE" });
    await refreshShares();
    renderShareDialog();
    elements.shareUrlField.hidden = true;
    elements.shareOnceHint.hidden = true;
    updateShareButton();
    notify("Share link revoked.", "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

// The button carries the state, so you can see at a glance whether the open
// document is published without opening the dialog.
function updateShareButton() {
  if (!elements.shareDocBtn) {
    return;
  }

  const usable = can("share:manage") && Boolean(state.activeFile) && !state.isRecycleBinMode;
  elements.shareDocBtn.hidden = !can("share:manage");
  elements.shareDocBtn.disabled = !usable;

  const shared = usable && state.shares.has(state.activeFile);
  elements.shareDocBtn.classList.toggle("active", shared);

  const icon = elements.shareDocBtn.querySelector("i");
  if (icon) {
    icon.className = shared ? "ph-fill ph-link-simple" : "ph ph-link-simple";
  }

  const label = shared ? "Shared publicly - manage link" : "Share this document";
  elements.shareDocBtn.setAttribute("aria-label", label);
  elements.shareDocBtn.title = label;
  delete elements.shareDocBtn.dataset.tip;
}

/* --------------------------------------------------------------------------
   Running notebook cells

   The Python lives in a worker (see notebook-runtime.js). This is the glue
   between a Run button and the output area under the cell.

   Nothing runs on its own. Opening a notebook renders it and stops; a cell
   executes because someone pressed Run on it, which is the only reason a
   document in a library should ever execute anything.
   -------------------------------------------------------------------------- */

function notebookOutputFor(cellNumber) {
  return elements.docContent.querySelector(`.notebook-live-output[data-cell="${cellNumber}"]`);
}

function renderRunOutput(target, result) {
  target.innerHTML = "";
  target.hidden = false;

  const append = (className, text) => {
    if (!text || !String(text).trim()) {
      return;
    }

    const block = document.createElement("pre");
    block.className = className;
    block.textContent = String(text);
    target.appendChild(block);
  };

  append("notebook-run-stream", (result.stdout || []).join("\n"));
  append("notebook-run-stream is-stderr", (result.stderr || []).join("\n"));

  if (result.ok) {
    append("notebook-run-value", result.result);
  } else {
    append("notebook-run-error", result.error);
  }

  if (!target.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "notebook-run-empty";
    empty.textContent = result.ok ? "Ran with no output." : "Failed with no output.";
    target.appendChild(empty);
  }
}

function setKernelStatus(label, { busy = false } = {}) {
  if (!elements.kernelStatus) {
    return;
  }

  elements.kernelStatus.hidden = !label;
  elements.kernelStatus.textContent = label || "";
  elements.kernelStatus.classList.toggle("is-busy", busy);
  if (elements.kernelBar) {
    elements.kernelBar.hidden = !NotebookRuntime.started;
  }
}

async function runNotebookCell(button) {
  const cellNumber = Number(button.dataset.cell);
  const code = MarkdownCore.notebookSourceFor(cellNumber);
  const target = notebookOutputFor(cellNumber);

  if (!code || !target) {
    return;
  }

  // Which document this run belongs to. Switching away mid-run replaces the
  // whole article, and writing into the detached node would put one notebook's
  // output under another's cell.
  const startedFor = state.activeFile;

  button.disabled = true;
  button.classList.add("is-running");
  target.hidden = false;
  target.innerHTML = '<p class="notebook-run-empty">Working…</p>';

  try {
    // The notebook's filename keys the kernel namespace, so cells in one
    // document share variables and two notebooks do not collide.
    const result = await NotebookRuntime.runCell(startedFor || "notebook", code, {
      onSlow: () => {
        if (target.isConnected) {
          target.innerHTML = "";
          const note = document.createElement("p");
          note.className = "notebook-run-empty";
          note.textContent = "Still running. Use Restart Python if it is stuck.";
          target.appendChild(note);
        }
      }
    });

    // The reader has moved on; their current notebook must not gain output
    // from the one they left.
    if (state.activeFile !== startedFor || !target.isConnected) {
      return;
    }

    renderRunOutput(target, result);

    if (!result.ok) {
      notify(`Cell ${cellNumber} failed.`, "error");
    }
  } catch (error) {
    if (target.isConnected) {
      renderRunOutput(target, { ok: false, error: error.message });
    }
  } finally {
    // Re-enabling the button that started this run; nothing else holds it.
    // eslint-disable-next-line require-atomic-updates
    button.disabled = false;
    button.classList.remove("is-running");
    setKernelStatus(NotebookRuntime.isBusy() ? "Running…" : "Python ready", { busy: NotebookRuntime.isBusy() });
  }
}

function bindNotebookExecution() {
  // If the runtime script failed to load, the app still has to work — running
  // Python is an extra, not a dependency. Cells simply keep their rendered
  // output and lose the Run button.
  if (typeof NotebookRuntime === "undefined") {
    MarkdownCore.configure({ executableNotebooks: false });
    return;
  }

  // Delegated, because the notebook markup is replaced wholesale every time a
  // document opens.
  elements.docContent.addEventListener("click", (event) => {
    const button = event.target.closest(".notebook-run");
    if (button) {
      void runNotebookCell(button);
    }
  });

  NotebookRuntime.onStatus((status) => {
    setKernelStatus(status.label, { busy: status.stage !== "ready" && status.stage !== "idle" });
  });

  elements.restartKernelBtn?.addEventListener("click", () => {
    NotebookRuntime.restart();
    for (const output of elements.docContent.querySelectorAll(".notebook-live-output")) {
      output.hidden = true;
      output.innerHTML = "";
    }
    notify("Python kernel stopped. The next Run starts a fresh one.", "neutral");
    setKernelStatus("");
  });
}

async function fetchDocs() {
  const payload = await requestJson("/api/docs", { cache: "no-store" });

  state.rootFolderLabel = payload.rootFolderLabel || "Ungrouped";
  state.folders = (payload.folders || []).map((folder, index) => ({
    id: folder.id,
    name: folder.name || folder.id,
    parentId: folder.parentId || null,
    depth: Number.isFinite(Number(folder.depth)) ? Number(folder.depth) : 0,
    path: folder.path || folder.name || folder.id,
    order: Number.isFinite(Number(folder.order)) ? Number(folder.order) : index,
    createdAt: folder.createdAt || "",
    updatedAt: folder.updatedAt || ""
  }));
  state.foldersById = new Map(state.folders.map((folder) => [folder.id, folder]));
  applyInitialFolderCollapse();
  await refreshShares();

  // Last write wins; this replaces the whole list.
  // eslint-disable-next-line require-atomic-updates
  state.docs = (payload.docs || []).map((doc) => ({
    file: doc.file,
    title: doc.title || filenameToTitle(doc.file),
    size: Number(doc.size || 0),
    updatedAt: doc.updatedAt || "",
    folderId: doc.folderId || null,
    folderName: doc.folderName || null,
    folderPath: doc.folderPath || null,
    folderOrder: Number.isFinite(Number(doc.folderOrder)) ? Number(doc.folderOrder) : getFolderOrder(doc.folderId),
    icon: inferIcon(doc.file)
  }));

  // A stale selection would keep phantom rows highlighted and let a delete fire
  // against a file that no longer exists.
  pruneSelection();
}

async function fetchDeletedDocs() {
  const endpoint = state.viewMode === "archive" ? "/api/archive" : "/api/recycle-bin";
  const payload = await requestJson(endpoint, { cache: "no-store" });

  // Last write wins is the intent: this replaces the whole list.
  // eslint-disable-next-line require-atomic-updates
  state.deletedDocs = (payload.docs || []).map((doc) => ({
    file: doc.file,
    originalFile: doc.originalFile || "",
    title: doc.title || filenameToTitle(doc.originalFile || doc.file),
    size: Number(doc.size || 0),
    updatedAt: doc.deletedAt || doc.updatedAt || "",
    deletedAt: doc.deletedAt || doc.updatedAt || "",
    folderId: doc.folderId || null,
    folderName: doc.folderName || null,
    folderOrder: Number.isFinite(Number(doc.folderOrder)) ? Number(doc.folderOrder) : getFolderOrder(doc.folderId),
    icon: "ph-trash"
  }));
}

async function loadDocContent(file, { forceReload = false } = {}) {
  const doc = getDocByFile(file);
  const cacheVersion = getDocCacheVersion(doc);
  const cached = state.contentCache.get(file);

  if (!forceReload && cached && cached.version === cacheVersion) {
    return cached.content;
  }

  const payload = await requestJson(`/api/docs/${docUrl(file)}`, { cache: "no-store" });
  const content = String(payload.content || "");
  const version = String(payload.updatedAt || cacheVersion || "");
  state.contentCache.set(file, {
    content,
    version
  });

  if (doc) {
    doc.updatedAt = payload.updatedAt || doc.updatedAt || version;
    doc.folderId = payload.folderId || doc.folderId || null;
    doc.folderName = payload.folderName || doc.folderName || null;
  }

  return content;
}

async function loadDeletedDocContent(entryFile, { forceReload = false } = {}) {
  const doc = state.deletedDocs.find((candidate) => candidate.file === entryFile) || null;
  const cacheVersion = getDocCacheVersion(doc);
  const cached = state.contentCache.get(entryFile);

  if (!forceReload && cached && cached.version === cacheVersion) {
    return cached.content;
  }

  const contentBase = state.viewMode === "archive" ? "/api/archive" : "/api/recycle-bin";
  const payload = await requestJson(`${contentBase}/${encodeURIComponent(entryFile)}/content`, { cache: "no-store" });
  const content = String(payload.content || "");
  const version = String(doc?.deletedAt || doc?.updatedAt || "");
  state.contentCache.set(entryFile, {
    content,
    version
  });

  return content;
}

function syncModeUI() {
  const inRecycleBin = state.viewMode === "recycle";
  const inArchive = state.viewMode === "archive";
  const inLinks = state.viewMode === "links";
  const inTrashView = inRecycleBin || inArchive;

  elements.sidebarTitle.textContent = inLinks
    ? "Links"
    : inArchive ? "Archive" : inRecycleBin ? "Recycle bin" : "Files";

  if (elements.toggleLinksBtn) {
    elements.toggleLinksBtn.classList.toggle("active", inLinks);
    elements.toggleLinksBtn.setAttribute("aria-pressed", String(inLinks));
    elements.toggleLinksBtn.setAttribute("aria-label", inLinks ? "Exit saved links" : "Show saved links");
    elements.toggleLinksBtn.title = inLinks ? "Exit saved links" : "Saved links";
  }

  // The links pane replaces the document viewer rather than sitting beside it:
  // there is no open document in this mode, so the toolbar, the empty state and
  // the article all step aside.
  if (elements.linksPane) {
    elements.linksPane.hidden = !inLinks;
  }

  if (elements.viewerToolbar) {
    elements.viewerToolbar.hidden = inLinks;
  }

  if (inLinks) {
    elements.emptyState.style.display = "none";
    elements.docContent.classList.remove("visible");
    if (elements.kernelBar) {
      elements.kernelBar.hidden = true;
    }
  }

  elements.toggleRecycleBinBtn.classList.toggle("active", inRecycleBin);
  elements.toggleRecycleBinBtn.setAttribute("aria-pressed", String(inRecycleBin));
  elements.toggleRecycleBinBtn.setAttribute("aria-label", inRecycleBin ? "Exit recycle bin" : "Show recycle bin");
  elements.toggleRecycleBinBtn.title = inRecycleBin ? "Exit recycle bin" : "Recycle bin";

  elements.toggleArchiveBtn.classList.toggle("active", inArchive);
  elements.toggleArchiveBtn.setAttribute("aria-pressed", String(inArchive));
  elements.toggleArchiveBtn.setAttribute("aria-label", inArchive ? "Exit archive" : "Show archive");
  elements.toggleArchiveBtn.title = inArchive ? "Exit archive" : "Archive";

  elements.softDeleteDocBtn.hidden = inTrashView;
  elements.hardDeleteDocBtn.hidden = false;
  elements.restoreDocBtn.hidden = !inTrashView;
  elements.createFolderBtn.hidden = inTrashView;

  if (elements.collapseAllBtn) {
    elements.collapseAllBtn.hidden = inTrashView;
  }

  // The button keeps its slot in all three modes but means something different in each:
  // archive from the viewer, archive from the recycle bin, erase from the archive.
  const hardDeleteIcon = elements.hardDeleteDocBtn.querySelector("i");
  if (inArchive) {
    if (hardDeleteIcon) hardDeleteIcon.className = "ph ph-trash";
    elements.hardDeleteDocBtn.setAttribute("aria-label", "Permanently delete archived markdown");
    elements.hardDeleteDocBtn.title = "Delete forever";
  } else if (inRecycleBin) {
    if (hardDeleteIcon) hardDeleteIcon.className = "ph ph-archive-box";
    elements.hardDeleteDocBtn.setAttribute("aria-label", "Move recycle bin markdown to archive");
    elements.hardDeleteDocBtn.title = "Archive";
  } else {
    if (hardDeleteIcon) hardDeleteIcon.className = "ph ph-archive-box";
    elements.hardDeleteDocBtn.setAttribute("aria-label", "Archive current markdown");
    elements.hardDeleteDocBtn.title = "Archive";
  }
}

async function hydrateSearchContent() {
  await Promise.all(
    state.docs.map(async (doc) => {
      try {
        await loadDocContent(doc.file);
      } catch (error) {
        console.error(error);
      }
    })
  );
}

async function hydrateDeletedSearchContent() {
  await Promise.all(
    state.deletedDocs.map(async (doc) => {
      try {
        await loadDeletedDocContent(doc.file);
      } catch (error) {
        console.error(error);
      }
    })
  );
}

function showEmptyState(title, message, icon = "ph-file-dashed") {
  elements.emptyState.style.display = "grid";
  // Whatever this is, it is a settled answer rather than a wait, so the spinner
  // stops. The markup ships spinning, so forgetting this leaves "No file
  // selected" turning on the spot forever.
  elements.emptyState.classList.remove("is-loading");
  elements.emptyState.removeAttribute("aria-busy");
  elements.docContent.classList.remove("visible");
  elements.docContent.classList.remove("notebook-viewer");
  destroyPanZoomInstances(elements.docContent);
  elements.docContent.innerHTML = "";
  elements.emptyState.innerHTML = `
    <i class="ph ${icon}"></i>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  `;
}

// The same panel, still spinning. Used while something is genuinely on its way,
// so the reader is told what is being fetched instead of being shown a prompt
// to do something they have already done.
function showLoadingState(title, message) {
  showEmptyState(title, message, "ph-circle-notch");
  elements.emptyState.classList.add("is-loading");
  elements.emptyState.setAttribute("aria-busy", "true");
}

// Nothing open: the viewer says so, the explorer highlights nothing and the
// buttons that need a document go quiet. One place, so the wording cannot
// drift between the ways of getting here.
function showNoDocumentOpen() {
  state.activeFile = null;
  // The address goes back to the library too. Leaving it pointing at a
  // document that is no longer on screen is how a refresh ends up somewhere
  // the last click did not.
  showDocumentInUrl(null, { replace: true });
  updateActiveDocUI(null);
  showEmptyState("No file selected", "Pick a file from the explorer, or search across every document.", "ph-file-dashed");
}

/* --------------------------------------------------------------------------
   Document rendering

   Markdown, notebooks, Mermaid, code highlighting and math all live in
   public/js/markdown-core.js, which the standalone share page loads too. One
   copy of the sanitizer and one Mermaid securityLevel, rather than two that
   drift apart.

   These wrappers keep the ~40 call sites below unchanged, and stay function
   declarations so hoisting works exactly as it did.
   -------------------------------------------------------------------------- */

function waitForNextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function renderMarkdown(markdown) {
  return MarkdownCore.renderMarkdown(markdown);
}

function highlightCodeBlocks(root) {
  return MarkdownCore.highlightCodeBlocks(root);
}

function renderDocumentContent(fileName, rawContent, title) {
  return MarkdownCore.renderDocumentContent(fileName, rawContent, title);
}

// --- Task lists you can actually tick --------------------------------------
//
// A checkbox that cannot be clicked is a picture of a checkbox. marked renders
// task lists disabled, which is the right default for a renderer and the wrong
// one for a document you own, so on a writable markdown file the boxes are made
// live and a click is written straight to the file.
//
// Ticking is a one-character edit, so it does not go through the editor: there
// is nothing to open, save or discard, and the page is not re-rendered — the box
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

// --- Pasted images ---------------------------------------------------------
//
// Paste a screenshot into a document and it should just be in the document, the
// way it is everywhere people already paste screenshots. The picture is
// uploaded, and what lands in the markdown is an ordinary image link.
//
// The upload takes as long as it takes, so a placeholder goes in at the cursor
// straight away and is swapped for the real link when the bytes are up. Typing
// carries on around it, which is why the placeholder is found again by text
// rather than held as a position.

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

function imagesFromTransfer(transfer) {
  if (!transfer) {
    return [];
  }

  const files = [...(transfer.files || [])];
  // A clipboard image arrives as an item with no file list on some browsers.
  const fromItems = [...(transfer.items || [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);

  const all = files.length > 0 ? files : fromItems;
  return all.filter((file) => IMAGE_TYPES.has(String(file.type || "").toLowerCase()));
}

function uploadPlaceholder(file) {
  return `![Uploading ${imageName(file)}...]()`;
}

function imageName(file) {
  const name = String(file?.name || "").trim();
  return name || "image";
}

async function uploadImage(file) {
  const body = new FormData();
  body.append("image", file, imageName(file));

  const payload = await requestJson("/api/assets", { method: "POST", body });
  return String(payload.url || "");
}

// The alt text is the file's name without its extension, which is what a
// screenshot tool's name gives you and better than nothing for a reader who
// cannot see the picture.
function imageMarkdown(file, url) {
  const alt = imageName(file).replace(/\.[^.]+$/, "");
  return `![${alt}](${url})`;
}

// --- Into the source editor ------------------------------------------------

function insertIntoTextarea(area, text) {
  const at = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? at;

  area.value = `${area.value.slice(0, at)}${text}${area.value.slice(end)}`;
  area.selectionStart = at + text.length;
  area.selectionEnd = area.selectionStart;
}

// Found by text rather than by the offset it went in at, because the upload is
// away for a while and nothing stops the author typing above it in the meantime.
function replaceInTextarea(area, find, text) {
  const at = area.value.indexOf(find);
  if (at === -1) {
    return false;
  }

  const caret = area.selectionStart ?? 0;
  area.value = `${area.value.slice(0, at)}${text}${area.value.slice(at + find.length)}`;

  // Keep the cursor where the typing was, allowing for the length change.
  const shift = text.length - find.length;
  const next = caret > at ? Math.max(at, caret + shift) : caret;
  area.selectionStart = next;
  area.selectionEnd = next;
  return true;
}

async function attachImagesToSource(files) {
  for (const file of files) {
    const placeholder = uploadPlaceholder(file);
    insertIntoTextarea(elements.editorInput, placeholder);
    scheduleEditorPreview();

    try {
      const url = await uploadImage(file);
      replaceInTextarea(elements.editorInput, placeholder, imageMarkdown(file, url));
      setStatus(`Attached ${imageName(file)}.`, "success");
    } catch (error) {
      // Leaving "Uploading..." in the text would be a lie that saves to the file.
      replaceInTextarea(elements.editorInput, placeholder, "");
      setStatus(error.message, "error");
    }

    scheduleEditorPreview();
  }
}

// --- Into the document being edited on the page ----------------------------

// An image in a rich block goes in as a real img element, so the picture is
// where it will be rather than a line of markup standing in for it. The
// serializer already writes an img back out as ![alt](src).
function insertNodeAtCaret(node) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// Inserting a node is a change to the block, but the browser only fires input
// for changes a person made. Saying so explicitly is what marks the block dirty
// and updates the bar, through exactly the path typing already uses.
function announceEdit(host) {
  host?.dispatchEvent(new Event("input", { bubbles: true }));
}

async function attachImagesToPage(files) {
  for (const file of files) {
    const image = document.createElement("img");
    // A local preview means the picture is on the page before the upload
    // finishes, which is the whole feel of pasting one. Guarded because losing
    // the preview should cost the preview, not the paste.
    const preview = window.URL?.createObjectURL ? URL.createObjectURL(file) : "";
    if (preview) {
      image.src = preview;
    }
    image.alt = imageName(file).replace(/\.[^.]+$/, "");
    image.dataset.uploading = "true";

    const release = () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };

    if (!insertNodeAtCaret(image)) {
      release();
      return;
    }

    // Held now, because a failed upload takes the image back out of the
    // document and there would be nothing left to ask.
    const host = image.closest('[contenteditable="true"]');
    announceEdit(host);

    try {
      const url = await uploadImage(file);
      image.src = url;
      delete image.dataset.uploading;
      announceEdit(host);
      setStatus(`Attached ${imageName(file)}.`, "success");
    } catch (error) {
      // The picture never made it, so it must not be left sitting in the
      // document looking as though it did.
      image.remove();
      announceEdit(host);
      setStatus(error.message, "error");
    } finally {
      release();
    }
  }
}

function renderMermaidBlocks(root) {
  return MarkdownCore.renderMermaidBlocks(root);
}

function destroyPanZoomInstances(root = null) {
  return MarkdownCore.destroyPanZoomInstances(root);
}

function bindWheelZoomModifier() {
  return MarkdownCore.bindWheelZoomModifier();
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= MOBILE_BREAKPOINT) {
    setNavOpen(false);
  }
}

// Opening a document only changes which row is highlighted. Rebuilding all ~93
// rows and their listeners for that was both wasteful and visible: emptying the
// list collapsed the page height and threw the scroll position back to the top.
function updateActiveRowHighlight() {
  for (const row of elements.docList.querySelectorAll(".tree-row-doc")) {
    const isActive = row.dataset.file === state.activeFile;
    row.classList.toggle("is-active", isActive);
    row.setAttribute("aria-current", isActive ? "true" : "false");
  }
}

// --- Selection ------------------------------------------------------------
// Explorer semantics: plain click replaces the selection, Ctrl toggles one row,
// Shift extends from the anchor. `visibleFileOrder` is rebuilt on every render
// so a Shift-range always matches what is actually on screen.

let visibleFileOrder = [];

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
    const from = visibleFileOrder.indexOf(state.selectionAnchor);
    const to = visibleFileOrder.indexOf(file);

    if (from >= 0 && to >= 0) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      const range = visibleFileOrder.slice(lo, hi + 1);
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

// --- Clipboard ------------------------------------------------------------

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
    await refreshDocs({ preserveSearch: true });
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
    await refreshDocs({ preserveSearch: true });
    notify(`Moved "${getFolderLabel(folderId)}" into ${parentId ? getFolderLabel(parentId) : "the top level"}.`, "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

// --- Saved links -----------------------------------------------------------
//
// A link is a URL plus what the page said about itself when it was added. The
// server reads the page once, on add; the card renders from that snapshot, so
// opening this section makes no request to any of the sites in it.

function linkHost(link) {
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

function linkGroupsOf(link) {
  return Array.isArray(link.groups) ? link.groups : [];
}

function inSelectedGroup(link) {
  if (state.linkGroupFilter === null) {
    return true;
  }

  const groups = linkGroupsOf(link);

  // "" is the Ungrouped chip, which is the one filter you cannot express as a
  // group name and the one you need most while filing a backlog.
  if (state.linkGroupFilter === "") {
    return groups.length === 0;
  }

  const wanted = state.linkGroupFilter.toLowerCase();
  return groups.some((name) => name.toLowerCase() === wanted);
}

function matchingLinks() {
  const needle = state.linkFilter.trim().toLowerCase();

  return state.links.filter((link) => {
    if (!inSelectedGroup(link)) {
      return false;
    }

    if (!needle) {
      return true;
    }

    // The group names are searched too, so typing a group name finds its links
    // whether or not the chip is selected.
    return [link.title, link.description, link.note, link.url, link.siteName, ...linkGroupsOf(link)]
      .some((field) => String(field || "").toLowerCase().includes(needle));
  });
}

// Derived here rather than trusted from the server, so the chip bar is correct
// the instant a card changes rather than after the next round trip.
function groupCounts() {
  const counts = new Map();

  for (const link of state.links) {
    for (const name of linkGroupsOf(link)) {
      const key = name.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { name, count: 1 });
      }
    }
  }

  return [...counts.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function selectLinkGroup(value) {
  // Clicking the selected chip clears it, so the filter is its own way out.
  state.linkGroupFilter = state.linkGroupFilter === value ? null : value;
  renderLinks();
}

async function setLinkGroups(id, groups) {
  const link = state.links.find((entry) => entry.id === id);
  if (!link) {
    return;
  }

  const before = linkGroupsOf(link);

  try {
    const payload = await requestJson(`/api/links/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ groups })
    });

    state.links = state.links.map((entry) => (entry.id === id ? payload.link : entry));
    renderLinks();
  } catch (error) {
    // Put the card back the way it was: the optimistic render already happened
    // in the drag case, and a card silently showing a group the server refused
    // is worse than an error.
    link.groups = before;
    renderLinks();
    notify(error.message, "error");
  }
}

function renderGroupChips() {
  if (!elements.linksGroups) {
    return;
  }

  const counts = groupCounts();
  const ungrouped = state.links.filter((link) => linkGroupsOf(link).length === 0).length;

  elements.linksGroups.innerHTML = "";

  // No chip bar for a library with no groups in it: an "All (3)" chip on its
  // own is a control that does nothing.
  if (counts.length === 0) {
    return;
  }

  const chip = (label, value, count) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.linkGroupFilter === value ? "group-chip active" : "group-chip";
    button.setAttribute("aria-pressed", String(state.linkGroupFilter === value));

    // "All" and "Ungrouped" are not group names, and both would otherwise sit
    // in data-group as an empty string — indistinguishable from each other and
    // from a group that happens to be unnamed.
    if (value === null) {
      button.dataset.groupAll = "";
    } else if (value === "") {
      button.dataset.groupNone = "";
    } else {
      button.dataset.group = value;
    }

    const text = document.createElement("span");
    text.textContent = label;
    button.appendChild(text);

    if (typeof count === "number") {
      const badge = document.createElement("span");
      badge.className = "group-chip-count";
      badge.textContent = String(count);
      button.appendChild(badge);
    }

    button.addEventListener("click", () => selectLinkGroup(value));

    // Dropping a card on a chip files it there — the quickest way to group a
    // backlog, since it needs no dialog and no typing.
    if (value !== null && value !== "" && can("doc:write")) {
      button.addEventListener("dragover", (event) => {
        if (!state.linkDragId) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        button.classList.add("drop-target");
      });

      button.addEventListener("dragleave", () => button.classList.remove("drop-target"));

      button.addEventListener("drop", (event) => {
        event.preventDefault();
        button.classList.remove("drop-target");

        const id = state.linkDragId;
        if (!id) {
          return;
        }

        const link = state.links.find((entry) => entry.id === id);
        const existing = link ? linkGroupsOf(link) : [];
        if (existing.some((name) => name.toLowerCase() === value.toLowerCase())) {
          notify(`Already in "${value}".`, "neutral");
          return;
        }

        void setLinkGroups(id, [...existing, value]);
      });
    }

    elements.linksGroups.appendChild(button);
    return button;
  };

  chip("All", null, state.links.length);
  for (const group of counts) {
    chip(group.name, group.name, group.count);
  }
  if (ungrouped > 0) {
    chip("Ungrouped", "", ungrouped);
  }
}

function syncGroupDatalist() {
  if (!elements.linkGroupOptions) {
    return;
  }

  elements.linkGroupOptions.innerHTML = "";
  for (const group of groupCounts()) {
    const option = document.createElement("option");
    option.value = group.name;
    elements.linkGroupOptions.appendChild(option);
  }
}

// Filing a card without leaving the grid: the chip row becomes a text field
// holding the current groups, Enter saves, Escape puts it back.
function beginGroupEdit(card, link) {
  if (card.querySelector(".link-card-group-edit")) {
    return;
  }

  const row = card.querySelector(".link-card-groups");
  const editor = document.createElement("div");
  editor.className = "link-card-group-edit";

  const input = document.createElement("input");
  input.type = "text";
  input.value = linkGroupsOf(link).join(", ");
  input.setAttribute("aria-label", `Groups for ${link.title || link.url}`);
  input.placeholder = "osu, APIs";
  input.setAttribute("list", "linkGroupOptions");
  editor.appendChild(input);

  let settled = false;
  const finish = (save) => {
    if (settled) {
      return;
    }
    settled = true;

    if (save) {
      void setLinkGroups(link.id, input.value);
    } else {
      renderLinks();
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });

  input.addEventListener("blur", () => finish(true));

  if (row) {
    row.replaceWith(editor);
  } else {
    card.appendChild(editor);
  }

  input.focus();
  input.select();
}

function renderLinkCard(link) {
  const card = document.createElement("article");
  card.className = "link-card";
  card.dataset.id = link.id;

  const title = document.createElement("h3");
  title.className = "link-card-title";

  const anchor = document.createElement("a");
  anchor.href = link.url;
  anchor.target = "_blank";
  // noopener stops the opened page reaching back through window.opener;
  // noreferrer also keeps this app's URL out of the other site's logs. Both
  // matter more here than usual, because these are addresses someone typed.
  anchor.rel = "noopener noreferrer";
  anchor.setAttribute("referrerpolicy", "no-referrer");
  anchor.textContent = link.title || linkHost(link);
  title.appendChild(anchor);
  card.appendChild(title);

  if (link.description) {
    const description = document.createElement("p");
    description.className = "link-card-desc";
    description.textContent = link.description;
    card.appendChild(description);
  }

  if (link.note) {
    const note = document.createElement("p");
    note.className = "link-card-note";
    note.textContent = link.note;
    card.appendChild(note);
  }

  const groups = linkGroupsOf(link);
  if (groups.length > 0) {
    const row = document.createElement("div");
    row.className = "link-card-groups";

    for (const name of groups) {
      const groupChip = document.createElement("button");
      groupChip.type = "button";
      groupChip.className = "link-card-group";
      groupChip.textContent = name;
      groupChip.title = `Show only "${name}"`;
      groupChip.addEventListener("click", () => selectLinkGroup(name));
      row.appendChild(groupChip);
    }

    card.appendChild(row);
  }

  const foot = document.createElement("div");
  foot.className = "link-card-foot";

  const host = document.createElement("span");
  host.className = "link-card-host";
  host.textContent = linkHost(link);
  host.title = link.url;
  foot.appendChild(host);

  // A page that could not be read is still a link worth keeping, so it is saved
  // either way — but the card should not pretend the description is missing
  // because the site has none.
  if (!link.fetched) {
    const warn = document.createElement("span");
    warn.className = "link-card-warn";
    warn.title = link.fetchError || "The page could not be read.";
    warn.innerHTML = '<i class="ph ph-warning-circle" aria-hidden="true"></i>';
    foot.appendChild(warn);
  }

  if (can("doc:write")) {
    const actions = document.createElement("div");
    actions.className = "link-card-actions";

    const group = document.createElement("button");
    group.type = "button";
    group.className = "icon-btn icon-btn-sm";
    group.title = "Edit groups";
    group.setAttribute("aria-label", `Edit groups for ${link.title || link.url}`);
    group.innerHTML = '<i class="ph ph-tag" aria-hidden="true"></i>';
    group.addEventListener("click", () => beginGroupEdit(card, link));
    actions.appendChild(group);

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "icon-btn icon-btn-sm";
    refresh.title = "Re-read this page";
    refresh.setAttribute("aria-label", `Re-read ${link.title || link.url}`);
    refresh.innerHTML = '<i class="ph ph-arrow-clockwise" aria-hidden="true"></i>';
    refresh.addEventListener("click", () => void refreshLink(link.id));
    actions.appendChild(refresh);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn icon-btn-sm danger";
    remove.title = "Remove this link";
    remove.setAttribute("aria-label", `Remove ${link.title || link.url}`);
    remove.innerHTML = '<i class="ph ph-trash" aria-hidden="true"></i>';
    remove.addEventListener("click", () => void removeLink(link.id));
    actions.appendChild(remove);

    foot.appendChild(actions);
  }

  card.appendChild(foot);

  // Dragging a card onto a group chip files it there. Only worth offering when
  // there is a chip to drop it on and the account may change anything.
  if (can("doc:write")) {
    card.draggable = true;

    card.addEventListener("dragstart", (event) => {
      state.linkDragId = link.id;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "copy";
      // Some browsers refuse to start a drag with nothing on the transfer.
      event.dataTransfer.setData("text/plain", link.url);
    });

    card.addEventListener("dragend", () => {
      state.linkDragId = null;
      card.classList.remove("dragging");
    });
  }

  return card;
}

function renderLinks() {
  if (!elements.linksGrid) {
    return;
  }

  const visible = matchingLinks();

  elements.linksGrid.innerHTML = "";
  for (const link of visible) {
    elements.linksGrid.appendChild(renderLinkCard(link));
  }

  elements.linksEmpty.hidden = visible.length > 0;
  if (visible.length === 0 && state.linkFilter.trim()) {
    elements.linksEmpty.querySelector("h3").textContent = "Nothing matches";
    elements.linksEmpty.querySelector("p").textContent =
      `No saved link mentions "${state.linkFilter.trim()}".`;
  } else if (visible.length === 0 && state.linkGroupFilter) {
    elements.linksEmpty.querySelector("h3").textContent = "This group is empty";
    elements.linksEmpty.querySelector("p").textContent =
      `Nothing is filed under "${state.linkGroupFilter}" any more.`;
  } else if (visible.length === 0 && state.linkGroupFilter === "") {
    elements.linksEmpty.querySelector("h3").textContent = "Everything is filed";
    elements.linksEmpty.querySelector("p").textContent = "No link is outside a group.";
  } else if (visible.length === 0) {
    elements.linksEmpty.querySelector("h3").textContent = "No links yet";
    elements.linksEmpty.querySelector("p").textContent =
      "Paste the address of a docs site and it will be saved with the title and description the page gives for itself.";
  }

  elements.linksCount.textContent = state.links.length === visible.length
    ? `${state.links.length} link${state.links.length === 1 ? "" : "s"}`
    : `${visible.length} of ${state.links.length}`;

  renderGroupChips();
  syncGroupDatalist();
  renderLinkSidebar(visible);
}

// The sidebar keeps working in this mode: the same list, as rows, so the tree
// pane is not simply blank while the cards are on screen.
function renderLinkSidebar(visible) {
  if (state.viewMode !== "links" || !elements.docList) {
    return;
  }

  elements.docList.innerHTML = "";

  for (const link of visible) {
    const row = document.createElement("div");
    row.className = "tree-row tree-row-link";

    const anchor = document.createElement("a");
    anchor.className = "tree-row-btn";
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.setAttribute("referrerpolicy", "no-referrer");
    anchor.title = link.url;
    anchor.innerHTML = '<i class="ph ph-link-simple" aria-hidden="true"></i><span></span>';
    anchor.querySelector("span").textContent = link.title || linkHost(link);

    row.appendChild(anchor);
    elements.docList.appendChild(row);
  }
}

async function refreshLinks() {
  const payload = await requestJson("/api/links");
  state.links = Array.isArray(payload.links) ? payload.links : [];
  state.linkGroups = Array.isArray(payload.groups) ? payload.groups : [];

  // A chip that no longer exists must not stay selected, or the grid is empty
  // with no way to see why.
  if (state.linkGroupFilter && !state.links.some((link) =>
    (link.groups || []).some((name) => name.toLowerCase() === state.linkGroupFilter.toLowerCase()))) {
    state.linkGroupFilter = null;
  }

  renderLinks();
}

function openLinkModal() {
  if (!can("doc:write")) {
    return;
  }

  state.linkModalOpen = true;
  elements.linkUrlInput.value = "";
  elements.linkNoteInput.value = "";
  // Adding while a group is selected almost always means "into this group".
  elements.linkGroupsInput.value = state.linkGroupFilter || "";
  syncGroupDatalist();
  elements.linkError.hidden = true;
  elements.linkError.textContent = "";
  elements.linkModal.classList.add("open");
  elements.linkModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.linkModal);
  syncBodyLock();
  elements.linkUrlInput.focus();
}

function closeLinkModal() {
  state.linkModalOpen = false;
  elements.linkModal.classList.remove("open");
  elements.linkModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.linkModal);
  syncBodyLock();
}

function showLinkError(message) {
  elements.linkError.textContent = message;
  elements.linkError.hidden = false;
}

async function submitLink() {
  const url = elements.linkUrlInput.value.trim();
  if (!url) {
    showLinkError("Enter a URL.");
    elements.linkUrlInput.focus();
    return;
  }

  elements.linkError.hidden = true;
  elements.saveLinkBtn.disabled = true;
  const label = elements.saveLinkBtn.querySelector("span");
  const original = label.textContent;
  label.textContent = "Reading the page…";

  try {
    const payload = await requestJson("/api/links", {
      method: "POST",
      body: JSON.stringify({
        url,
        note: elements.linkNoteInput.value.trim(),
        groups: elements.linkGroupsInput.value
      })
    });

    state.links.unshift(payload.link);
    renderLinks();
    closeLinkModal();
    notify(payload.link.fetched
      ? `Saved "${payload.link.title}".`
      : `Saved, but that page could not be read: ${payload.link.fetchError}`,
    payload.link.fetched ? "success" : "warning");
  } catch (error) {
    // The dialog stays open with the message in it: the URL is still in the
    // field, which is what you want if it needs a correction.
    showLinkError(error.message);
  } finally {
    // eslint-disable-next-line require-atomic-updates
    elements.saveLinkBtn.disabled = false;
    label.textContent = original;
  }
}

async function refreshLink(id) {
  const current = state.links.find((entry) => entry.id === id);
  if (!current) {
    return;
  }

  try {
    const payload = await requestJson(`/api/links/${encodeURIComponent(id)}`, {
      method: "PATCH",
      // The server replaces the metadata wholesale on a refresh, so the groups
      // are sent back with it or the card comes home unfiled.
      body: JSON.stringify({ refresh: true, groups: linkGroupsOf(current) })
    });

    state.links = state.links.map((link) => (link.id === id ? payload.link : link));
    renderLinks();
    notify(payload.link.fetched ? "Link updated." : `Could not read that page: ${payload.link.fetchError}`,
      payload.link.fetched ? "success" : "warning");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function removeLink(id) {
  const link = state.links.find((entry) => entry.id === id);
  if (!link) {
    return;
  }

  const shouldProceed = await requestConfirmation({
    title: "Remove this link?",
    message: `"${link.title || link.url}" will be removed from your saved links. The site itself is untouched.`,
    confirmLabel: "Remove",
    tone: "danger"
  });

  if (!shouldProceed) {
    return;
  }

  try {
    await requestJson(`/api/links/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.links = state.links.filter((entry) => entry.id !== id);
    renderLinks();
    notify("Link removed.", "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

// One entry point for "make a new document", so the toolbar button and the two
// context menus cannot drift apart. folderId preselects the picker.
function startNewDocument(folderId = null) {
  openEditor({
    mode: "create",
    fileName: "",
    content: "# New Markdown\n\nStart writing here...",
    folderId
  });
}

// --- Context menu ---------------------------------------------------------

function closeContextMenu() {
  if (!elements.contextMenu || elements.contextMenu.hidden) {
    return;
  }
  elements.contextMenu.hidden = true;
  elements.contextMenu.innerHTML = "";
}

function openContextMenu(x, y, items) {
  if (!elements.contextMenu) {
    return;
  }

  elements.contextMenu.innerHTML = "";

  for (const item of items) {
    if (item.separator) {
      const hr = document.createElement("hr");
      hr.className = "context-sep";
      elements.contextMenu.appendChild(hr);
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = item.danger ? "context-item danger" : "context-item";
    button.disabled = Boolean(item.disabled);
    button.innerHTML = `<i class="ph ${item.icon}" aria-hidden="true"></i><span></span>`;
    button.querySelector("span").textContent = item.label;

    if (item.shortcut) {
      const hint = document.createElement("kbd");
      hint.textContent = item.shortcut;
      button.appendChild(hint);
    }

    button.addEventListener("click", () => {
      closeContextMenu();
      item.action();
    });

    elements.contextMenu.appendChild(button);
  }

  elements.contextMenu.hidden = false;

  // Flip the menu back on screen if it would overflow the viewport.
  const rect = elements.contextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  elements.contextMenu.style.left = `${Math.max(8, left)}px`;
  elements.contextMenu.style.top = `${Math.max(8, top)}px`;

  elements.contextMenu.querySelector(".context-item:not(:disabled)")?.focus();
}

function buildDocContextItems(doc) {
  const targets = resolveTargetFiles(doc.file);
  const many = targets.length > 1;
  const inArchive = state.viewMode === "archive";

  // Without write access the menu is what a reader can actually do: open it,
  // and share it if the role allows. Offering Cut/Rename/Delete that only fail
  // at the server is worse than not offering them.
  if (!can("doc:write")) {
    const items = state.isRecycleBinMode
      ? [{ label: "Open", icon: "ph-file-text", action: () => void openRecycleBinDocument(doc.file) }]
      : [{ label: "Open", icon: "ph-file-text", action: () => void openDocument(doc.file, true) }];

    if (!state.isRecycleBinMode && can("share:manage")) {
      items.push({ separator: true });
      items.push({
        label: state.shares.has(doc.file) ? "Manage share link" : "Share...",
        icon: "ph-link-simple",
        action: () => openShareModal(doc.file)
      });
    }

    return items;
  }

  if (state.isRecycleBinMode) {
    return [
      {
        label: "Open", icon: "ph-file-text", action: () => void openRecycleBinDocument(doc.file)
      },
      { separator: true },
      {
        label: "Restore",
        icon: "ph-arrow-counter-clockwise",
        action: () => void (inArchive ? restoreArchivedDocumentByFile(doc.file) : restoreDeletedDocumentByFile(doc.file))
      },
      {
        label: inArchive ? "Delete forever" : "Archive",
        icon: inArchive ? "ph-trash" : "ph-archive-box",
        danger: true,
        action: () => void (inArchive ? permanentlyDeleteArchivedDocument(doc.file) : hardDeleteDeletedDocumentByFile(doc.file))
      }
    ];
  }

  return [
    { label: "Open", icon: "ph-file-text", disabled: many, action: () => void openDocument(doc.file, true) },
    { label: "Edit", icon: "ph-pencil-simple", disabled: many, action: () => void openEditorForDocument(doc.file) },
    { separator: true },
    {
      label: many ? `Cut ${targets.length} files` : "Cut",
      icon: "ph-scissors",
      shortcut: "Ctrl+X",
      action: () => cutFiles(targets)
    },
    {
      label: "Move to folder...",
      icon: "ph-folder",
      disabled: many,
      action: () => openFolderModal({ mode: "move", file: doc.file, folderId: doc.folderId || null })
    },
    {
      label: "Rename",
      icon: "ph-cursor-text",
      shortcut: "F2",
      disabled: many,
      action: () => beginInlineRename(doc.file)
    },
    { separator: true },
    {
      label: many ? `Delete ${targets.length} files` : "Delete",
      icon: "ph-trash",
      shortcut: "Del",
      danger: true,
      action: () => void deleteFiles(targets, "soft")
    },
    {
      label: many ? `Archive ${targets.length} files` : "Archive",
      icon: "ph-archive-box",
      shortcut: "Shift+Del",
      danger: true,
      action: () => void deleteFiles(targets, "hard")
    },
    ...(can("share:manage") ? [
      { separator: true },
      {
        label: state.shares.has(doc.file) ? "Manage share link" : "Share...",
        icon: "ph-link-simple",
        disabled: many,
        action: () => openShareModal(doc.file)
      }
    ] : [])
  ];
}

function buildFolderContextItems(folder) {
  const canPaste = state.clipboard.files.length > 0;

  // Every entry below is a write. There is no read-only folder action, so a
  // viewer gets no folder menu rather than a menu of refusals.
  if (!can("doc:write")) {
    return [];
  }

  return [
    {
      label: "New file",
      icon: "ph-file-plus",
      action: () => startNewDocument(folder.id)
    },
    {
      label: "New subfolder",
      icon: "ph-folder-plus",
      action: () => openFolderModal({ mode: "create", parentId: folder.id })
    },
    {
      label: canPaste ? `Paste ${state.clipboard.files.length} file(s)` : "Paste",
      icon: "ph-clipboard-text",
      shortcut: "Ctrl+V",
      disabled: !canPaste,
      action: () => void pasteIntoFolder(folder.id)
    },
    { separator: true },
    {
      label: "Rename",
      icon: "ph-cursor-text",
      shortcut: "F2",
      action: () => beginInlineFolderRename(folder.id)
    },
    {
      label: "Move to top level",
      icon: "ph-arrow-line-up",
      disabled: !folder.parentId,
      action: () => void moveFolderToParent(folder.id, null)
    },
    { separator: true },
    {
      label: "Delete folder",
      icon: "ph-trash",
      danger: true,
      action: () => void deleteFolderById(folder.id)
    }
  ];
}

async function deleteFolderById(folderId) {
  const folder = getFolderRecord(folderId);
  if (!folder) {
    return;
  }

  const descendants = state.folders.filter((entry) => folderPathIds(entry.id).includes(folderId) && entry.id !== folderId);
  const affected = state.docs.filter((doc) => doc.folderId === folderId
    || descendants.some((entry) => entry.id === doc.folderId)).length;

  const shouldProceed = await requestConfirmation({
    title: `Delete "${folder.name}"?`,
    message: descendants.length
      ? `This also deletes ${descendants.length} subfolder(s). ${affected} document(s) move back to Ungrouped. No file on disk is touched.`
      : `${affected} document(s) move back to Ungrouped. No file on disk is touched.`,
    confirmLabel: "Delete folder",
    tone: "danger"
  });

  if (!shouldProceed) {
    return;
  }

  try {
    const payload = await requestJson(`/api/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
    await refreshDocs({ preserveSearch: true });
    notify(payload.removedFolders > 1
      ? `Deleted "${folder.name}" and ${payload.removedFolders - 1} subfolder(s).`
      : `Deleted folder "${folder.name}".`, "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

// --- Bulk delete ----------------------------------------------------------

async function deleteFiles(files, mode) {
  const list = files.filter(Boolean);
  if (!list.length) {
    return;
  }

  if (list.length === 1) {
    await deleteDocumentByFile(list[0], mode);
    return;
  }

  const shouldProceed = await requestConfirmation({
    title: mode === "hard" ? `Archive ${list.length} files?` : `Delete ${list.length} files?`,
    message: mode === "hard"
      ? "They move to the archive, where they can still be restored."
      : "They move to the recycle bin, where they can still be restored.",
    confirmLabel: mode === "hard" ? "Archive" : "Delete",
    tone: "danger"
  });

  if (!shouldProceed) {
    notify("Nothing was deleted.", "info");
    return;
  }

  const failed = [];
  let done = 0;

  for (const file of list) {
    try {
      await requestJson(`/api/docs/${docUrl(file)}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      state.contentCache.delete(file);
      done += 1;
    } catch (error) {
      failed.push(error.message);
    }
  }

  clearSelection();
  await refreshDocs({ preserveSearch: true });

  if (done) {
    notify(`${done} file(s) ${mode === "hard" ? "archived" : "moved to the recycle bin"}.`, "success");
  }
  if (failed.length) {
    notify(failed[0], "error");
  }
}

// --- Inline rename --------------------------------------------------------
// F2 edits the label in place rather than opening the editor, which is what
// makes renaming feel like a filesystem instead of a document workflow.

function beginInlineEdit(labelNode, currentValue, commit) {
  if (!labelNode || labelNode.querySelector("input")) {
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-rename-input";
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
      renderDocList();
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
      await refreshDocs({ openFile: openedFile, preserveSearch: true });
      notify(`Renamed to ${docName(payload.file)}.`, "success");
    } catch (error) {
      notify(error.message, "error");
      renderDocList();
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
      await refreshDocs({ preserveSearch: true });
      notify(`Renamed folder to ${nextName}.`, "success");
    } catch (error) {
      notify(error.message, "error");
      renderDocList();
    }
  });
}

// --- Tree model -----------------------------------------------------------

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

// --- Rendering ------------------------------------------------------------

function buildTreeAction(label, iconClass, handler, { danger = false, disabled = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "tree-action danger" : "tree-action";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.innerHTML = `<i class="ph ${iconClass}" aria-hidden="true"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  });
  return button;
}

// On a phone there is no hover, so the per-row buttons would have to be shown
// permanently — three to five 44px targets, which leaves a ~280px drawer almost
// no room for the filename. One overflow button opens the same actions instead.
function buildOverflowAction(getItems) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-action tree-action-more";
  button.title = "More actions";
  button.setAttribute("aria-label", "More actions");
  button.setAttribute("aria-haspopup", "menu");
  button.innerHTML = '<i class="ph ph-dots-three-vertical" aria-hidden="true"></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = button.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, getItems());
  });
  return button;
}

function enableDocDrag(row, doc) {
  row.draggable = true;

  row.addEventListener("dragstart", (event) => {
    // Dragging an unselected row selects it first, so what you drag is always
    // what you can see highlighted.
    if (!state.selection.has(doc.file)) {
      setSelection([doc.file], { anchor: doc.file });
    }

    state.dragPayload = { type: "files", files: [...state.selection] };
    row.classList.add("is-dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", [...state.selection].join("\n"));
    }
  });

  row.addEventListener("dragend", () => {
    state.dragPayload = null;
    row.classList.remove("is-dragging");
    elements.docList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
  });
}

function enableFolderDrag(row, folder) {
  if (!can("doc:write")) {
    return;
  }

  row.draggable = true;

  row.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    state.dragPayload = { type: "folder", folderId: folder.id };
    row.classList.add("is-dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", folder.name);
    }
  });

  row.addEventListener("dragend", () => {
    state.dragPayload = null;
    row.classList.remove("is-dragging");
    elements.docList.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
  });
}

function canDropOnFolder(targetFolderId) {
  // Every drop is a move. One guard here covers both the folder and document
  // drop zones rather than each remembering to ask.
  if (!can("doc:write")) {
    return false;
  }

  const payload = state.dragPayload;
  if (!payload) {
    return false;
  }

  if (payload.type === "folder") {
    if (payload.folderId === targetFolderId) {
      return false;
    }
    // Refuse the drop that would make a folder its own ancestor. The server
    // rejects it too; this just avoids offering an action that cannot work.
    if (targetFolderId && folderPathIds(targetFolderId).includes(payload.folderId)) {
      return false;
    }
    const current = getFolderRecord(payload.folderId)?.parentId || null;
    return current !== (targetFolderId || null);
  }

  return payload.files.some((file) => {
    const doc = getDocByFile(file);
    return !doc || (doc.folderId || null) !== (targetFolderId || null);
  });
}

function enableFolderDrop(zone, folderRow, folderId) {
  zone.addEventListener("dragover", (event) => {
    if (!canDropOnFolder(folderId)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    folderRow.classList.add("is-drop-target");
  });

  zone.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && zone.contains(event.relatedTarget)) {
      return;
    }
    folderRow.classList.remove("is-drop-target");
  });

  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    folderRow.classList.remove("is-drop-target");

    const payload = state.dragPayload;
    state.dragPayload = null;
    if (!payload) {
      return;
    }

    if (payload.type === "folder") {
      await moveFolderToParent(payload.folderId, folderId);
      return;
    }

    await moveFilesToFolder(payload.files, folderId);
  });
}

function buildFolderRow(node, isCollapsed) {
  const { folder, depth } = node;
  const row = document.createElement("div");
  row.className = "tree-row tree-row-folder";
  if (folder) {
    row.dataset.folderId = folder.id;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-row-btn";
  button.style.setProperty("--depth", String(depth));
  button.setAttribute("aria-expanded", String(!isCollapsed));

  const totalDocs = countNodeDocs(node);
  button.innerHTML = `
    <i class="ph ph-caret-down tree-caret" aria-hidden="true"></i>
    <i class="ph ${folder ? "ph-folder" : "ph-stack"} tree-icon" aria-hidden="true"></i>
    <span class="tree-label"></span>
    <span class="tree-count"></span>
  `;
  button.querySelector(".tree-label").textContent = folder ? folder.name : (state.rootFolderLabel || "Ungrouped");
  button.querySelector(".tree-count").textContent = String(totalDocs);
  if (folder) {
    button.title = folder.path;
  }

  button.addEventListener("click", () => toggleFolderCollapse(folder ? folder.id : "__root__"));

  row.appendChild(button);

  if (folder && !state.isRecycleBinMode) {
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, buildFolderContextItems(folder));
    });
    enableFolderDrag(row, folder);
  }

  return row;
}

function countNodeDocs(node) {
  return node.docs.length + node.children.reduce((total, child) => total + countNodeDocs(child), 0);
}

function buildFolderActions(node) {
  const folder = node.folder;
  const actions = document.createElement("div");
  actions.className = "tree-actions";

  actions.append(
    buildTreeAction("New subfolder", "ph-folder-plus", () => {
      openFolderModal({ mode: "create", parentId: folder.id });
    }),

    buildTreeAction(`Rename ${folder.name}`, "ph-pencil-simple", () => {
      beginInlineFolderRename(folder.id);
    }),

    buildTreeAction(`Delete ${folder.name}`, "ph-trash", () => {
      void deleteFolderById(folder.id);
    }, { danger: true }),

    buildOverflowAction(() => buildFolderContextItems(folder))
  );

  return actions;
}

function buildDocRow(doc, depth) {
  const row = document.createElement("li");
  row.className = "tree-row tree-row-doc";
  row.dataset.file = doc.file;

  const isActive = state.activeFile === doc.file;
  if (isActive) {
    row.classList.add("is-active");
  }
  row.setAttribute("aria-current", isActive ? "true" : "false");

  if (state.selection.has(doc.file)) {
    row.classList.add("is-selected");
  }
  row.setAttribute("aria-selected", String(state.selection.has(doc.file)));

  if (state.clipboard.mode === "cut" && state.clipboard.files.includes(doc.file)) {
    row.classList.add("is-cut");
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-row-btn";
  button.style.setProperty("--depth", String(depth));

  const displayName = docName(state.isRecycleBinMode ? (doc.originalFile || doc.file) : doc.file);
  const timeLabel = state.isRecycleBinMode
    ? `deleted ${formatDate(doc.deletedAt || doc.updatedAt)}`
    : `updated ${formatDate(doc.updatedAt)}`;
  button.title = `${displayName}\n${formatBytes(doc.size)} · ${timeLabel}`;

  button.innerHTML = `
    <i class="ph ${doc.icon} tree-icon" aria-hidden="true"></i>
    <span class="tree-label"></span>
  `;
  button.querySelector(".tree-label").textContent = doc.title;

  button.addEventListener("click", async (event) => {
    handleRowSelection(doc.file, event);

    // Ctrl/Shift are selection gestures, not "open this" gestures.
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (state.isRecycleBinMode) {
      await openRecycleBinDocument(doc.file);
    } else {
      await openDocument(doc.file, true, { jumpQuery: elements.searchInput.value });
    }

    closeSidebarOnMobile();
  });

  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!state.selection.has(doc.file)) {
      setSelection([doc.file], { anchor: doc.file });
    }
    openContextMenu(event.clientX, event.clientY, buildDocContextItems(doc));
  });

  const actions = document.createElement("div");
  actions.className = "tree-actions";

  if (state.isRecycleBinMode) {
    const inArchive = state.viewMode === "archive";

    actions.append(
      buildTreeAction("Restore", "ph-arrow-counter-clockwise", async () => {
        if (inArchive) {
          await restoreArchivedDocumentByFile(doc.file);
        } else {
          await restoreDeletedDocumentByFile(doc.file);
        }
      }),
      buildTreeAction(
        inArchive ? "Delete forever" : "Archive",
        inArchive ? "ph-trash" : "ph-archive-box",
        async () => {
          if (inArchive) {
            await permanentlyDeleteArchivedDocument(doc.file);
          } else {
            await hardDeleteDeletedDocumentByFile(doc.file);
          }
        },
        { danger: true }
      ),
      buildOverflowAction(() => buildDocContextItems(doc))
    );
  } else if (can("doc:write")) {
    actions.append(
      buildTreeAction("Edit", "ph-pencil-simple", async () => {
        await openEditorForDocument(doc.file);
      }),
      buildTreeAction("Rename", "ph-cursor-text", () => beginInlineRename(doc.file)),
      buildTreeAction("Move to recycle bin", "ph-trash", () => {
        void deleteFiles(resolveTargetFiles(doc.file), "soft");
      }, { danger: true }),
      buildOverflowAction(() => buildDocContextItems(doc))
    );

    // Dragging a row is a move; without write access there is nothing to drag.
    enableDocDrag(row, doc);
  } else if (can("share:manage")) {
    // Nothing to edit, but sharing is still available from the row.
    actions.append(buildOverflowAction(() => buildDocContextItems(doc)));
  }

  row.append(button, actions);
  return row;
}

function renderTreeNode(node, container) {
  const folderKey = node.folder ? node.folder.id : "__root__";
  const isCollapsed = state.collapsedFolderIds.has(folderKey);

  const groupItem = document.createElement("li");
  groupItem.className = isCollapsed ? "tree-group is-collapsed" : "tree-group";
  groupItem.dataset.folderKey = folderKey;

  const folderRow = buildFolderRow(node, isCollapsed);

  if (!state.isRecycleBinMode && node.folder && can("doc:write")) {
    folderRow.appendChild(buildFolderActions(node));
  }

  groupItem.appendChild(folderRow);

  if (!state.isRecycleBinMode) {
    enableFolderDrop(groupItem, folderRow, node.folder ? node.folder.id : null);
  }

  const childList = document.createElement("ul");
  childList.className = "tree-children";
  childList.style.setProperty("--depth", String(node.depth));

  for (const child of node.children) {
    renderTreeNode(child, childList);
  }

  const revealed = state.groupRevealCounts.get(folderKey) || DOC_LIST_PAGE_SIZE;
  const activeIndex = node.docs.findIndex((doc) => doc.file === state.activeFile);
  const visibleCount = Math.max(revealed, activeIndex + 1);
  const visibleDocs = node.docs.slice(0, visibleCount);
  const hiddenCount = node.docs.length - visibleDocs.length;

  for (const doc of visibleDocs) {
    childList.appendChild(buildDocRow(doc, node.depth + 1));
    visibleFileOrder.push(doc.file);
  }

  if (node.docs.length === 0 && node.children.length === 0) {
    const emptyRow = document.createElement("li");
    emptyRow.className = "tree-empty";
    emptyRow.style.setProperty("--depth", String(node.depth + 1));
    emptyRow.textContent = "Empty";
    childList.appendChild(emptyRow);
  }

  if (hiddenCount > 0) {
    const moreRow = document.createElement("li");
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "tree-more";
    moreBtn.style.setProperty("--depth", String(node.depth + 1));
    moreBtn.innerHTML = '<i class="ph ph-caret-down" aria-hidden="true"></i><span></span>';
    moreBtn.querySelector("span").textContent =
      `Show ${Math.min(hiddenCount, DOC_LIST_PAGE_SIZE)} more of ${node.docs.length}`;
    moreBtn.addEventListener("click", () => {
      state.groupRevealCounts.set(folderKey, visibleCount + DOC_LIST_PAGE_SIZE);
      renderDocList();
    });
    moreRow.appendChild(moreBtn);
    childList.appendChild(moreRow);
  }

  groupItem.appendChild(childList);
  container.appendChild(groupItem);
}

function renderDocList() {
  const treeScrollTop = elements.docList.scrollTop || 0;
  const sidebarScrollTop = elements.sidebar?.scrollTop || 0;

  elements.docList.innerHTML = "";
  visibleFileOrder = [];

  const nodes = buildFolderTree(state.filteredDocs);

  if (nodes.length === 0) {
    const item = document.createElement("li");
    item.className = "tree-empty";
    item.textContent = elements.searchInput.value.trim() ? "No files match this search." : "No files yet.";
    elements.docList.appendChild(item);
    elements.docList.scrollTop = treeScrollTop;
    updateSelectionMeta();
    return;
  }

  for (const node of nodes) {
    renderTreeNode(node, elements.docList);
  }

  elements.docList.scrollTop = treeScrollTop;
  if (elements.sidebar) {
    elements.sidebar.scrollTop = sidebarScrollTop;
  }

  updateSelectionMeta();
}

// --- Keyboard -------------------------------------------------------------

function getVisibleTreeButtons() {
  return [...elements.docList.querySelectorAll(".tree-row-btn")]
    .filter((button) => button.offsetParent !== null);
}

function moveTreeFocus(from, offset) {
  const buttons = getVisibleTreeButtons();
  const index = buttons.indexOf(from);
  if (index < 0) {
    return;
  }

  const next = buttons[Math.min(Math.max(index + offset, 0), buttons.length - 1)];
  if (next && next !== from) {
    next.focus();
  }
}

function handleTreeKeydown(event) {
  // An inline rename owns every key while it is open.
  if (event.target.classList?.contains("tree-rename-input")) {
    return;
  }

  const button = event.target.closest(".tree-row-btn");
  const group = button?.closest(".tree-group");
  const docRow = button?.closest(".tree-row-doc");
  const folderRow = button?.closest(".tree-row-folder");

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    setSelection(visibleFileOrder);
    return;
  }

  // Cut, paste, rename and delete are writes. Select-all and arrow navigation
  // are not, so they stay available to a reader.
  const writable = can("doc:write");

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x" && writable) {
    event.preventDefault();
    cutFiles([...state.selection]);
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && writable) {
    event.preventDefault();
    const targetFolderId = folderRow?.dataset.folderId
      || (group?.dataset.folderKey !== "__root__" ? group?.dataset.folderKey : null)
      || null;
    void pasteIntoFolder(targetFolderId);
    return;
  }

  if (event.key === "F2" && writable) {
    event.preventDefault();
    if (docRow) {
      beginInlineRename(docRow.dataset.file);
    } else if (folderRow?.dataset.folderId) {
      beginInlineFolderRename(folderRow.dataset.folderId);
    }
    return;
  }

  if (event.key === "Delete" && !state.isRecycleBinMode && writable) {
    event.preventDefault();
    const targets = docRow ? resolveTargetFiles(docRow.dataset.file) : [...state.selection];
    if (targets.length) {
      void deleteFiles(targets, event.shiftKey ? "hard" : "soft");
    }
    return;
  }

  if (!button) {
    return;
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      moveTreeFocus(button, 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      moveTreeFocus(button, -1);
      break;
    case "Home": {
      event.preventDefault();
      const [first] = getVisibleTreeButtons();
      if (first) first.focus();
      break;
    }
    case "End": {
      event.preventDefault();
      const buttons = getVisibleTreeButtons();
      if (buttons.length) buttons[buttons.length - 1].focus();
      break;
    }
    case "ArrowRight":
      if (folderRow && group?.classList.contains("is-collapsed")) {
        event.preventDefault();
        toggleFolderCollapse(group.dataset.folderKey);
      } else if (folderRow) {
        event.preventDefault();
        moveTreeFocus(button, 1);
      }
      break;
    case "ArrowLeft":
      if (folderRow && !group?.classList.contains("is-collapsed")) {
        event.preventDefault();
        toggleFolderCollapse(group.dataset.folderKey);
      } else {
        event.preventDefault();
        const parentGroup = group?.parentElement?.closest(".tree-group");
        const targetGroup = folderRow ? parentGroup : group;
        targetGroup?.querySelector(".tree-row-folder .tree-row-btn")?.focus();
      }
      break;
    default:
      break;
  }
}

async function applySearch(query) {
  const rawQuery = String(query || "");
  const q = normalize(rawQuery).trim();
  const currentDocs = getCurrentDocsCollection();

  if (q !== normalize(state.jumpQuery)) {
    resetJumpNavigation();
  }

  if (!q) {
    state.searchRequestId += 1;
    state.groupRevealCounts.clear();
    state.filteredDocs = [...currentDocs];
    setMeta(state.viewMode === "archive"
      ? `${state.filteredDocs.length} archived document(s)`
      : state.viewMode === "recycle"
        ? `${state.filteredDocs.length} deleted document(s)`
        : `${state.filteredDocs.length} document(s)`);
    renderSuperSearchPanel(rawQuery, [], []);
    renderDocList();
    return;
  }

  const requestId = ++state.searchRequestId;
  const searchScope = state.viewMode === "archive"
    ? "archive"
    : state.viewMode === "recycle"
      ? "recycle-bin"
      : "docs";
  const contextLabel = searchScope === "archive"
    ? "archive"
    : searchScope === "recycle-bin"
      ? "recycle bin"
      : "documents";
  setMeta(`Searching ${contextLabel}...`);

  try {
    const payload = await requestJson(`/api/docs/search?scope=${encodeURIComponent(searchScope)}&q=${encodeURIComponent(rawQuery)}`, { cache: "no-store" });
    if (requestId !== state.searchRequestId) {
      return;
    }

    const matches = (payload.matches || []).map((match) => ({
      file: match.file,
      originalFile: match.originalFile || "",
      title: match.title || filenameToTitle(match.originalFile || match.file),
      size: Number(match.size || 0),
      updatedAt: match.updatedAt || match.deletedAt || "",
      deletedAt: match.deletedAt || match.updatedAt || "",
      folderId: match.folderId || null,
      folderName: match.folderName || null,
      folderOrder: Number.isFinite(Number(match.folderOrder)) ? Number(match.folderOrder) : getFolderOrder(match.folderId),
      icon: inferIcon(match.originalFile || match.file),
      snippet: match.snippet || "No preview available."
    }));

    const searchTerms = buildJumpSearchTerms(rawQuery, payload.searchTerms || []);
    state.groupRevealCounts.clear();
    state.filteredDocs = matches;
    renderSuperSearchPanel(rawQuery, matches, searchTerms);
    setMeta(`${matches.length} result(s) in ${contextLabel} for "${rawQuery.trim()}"`);
    renderDocList();
  } catch (error) {
    if (requestId !== state.searchRequestId) {
      return;
    }

    console.error(error);
    const fallback = buildSuperSearchMatches(rawQuery, currentDocs);
    const matches = fallback.matches.map((match) => ({
      file: match.file,
      originalFile: match.originalFile || "",
      title: match.title || filenameToTitle(match.originalFile || match.file),
      size: Number(match.size || 0),
      updatedAt: match.updatedAt || match.deletedAt || "",
      deletedAt: match.deletedAt || match.updatedAt || "",
      folderId: match.folderId || null,
      folderName: match.folderName || null,
      folderOrder: Number.isFinite(Number(match.folderOrder)) ? Number(match.folderOrder) : getFolderOrder(match.folderId),
      icon: inferIcon(match.originalFile || match.file),
      snippet: match.snippet || "No preview available."
    }));

    state.groupRevealCounts.clear();
    state.filteredDocs = matches;
    renderSuperSearchPanel(rawQuery, matches, fallback.searchTerms);
    setMeta(`${matches.length} result(s) in ${contextLabel} for "${rawQuery.trim()}"`);
    renderDocList();
    setStatus("Search fell back to local metadata results.", "neutral");
  }
}

async function openDocument(file, pushHash, options = {}) {
  // Opening something else while the page is being edited would replace the
  // edits with another document and say nothing about it.
  if (pageEditActive() && file !== state.pageEdit.file) {
    const left = await cancelPageEdit({ restore: false });
    if (!left) {
      return;
    }
  }

  const requestId = ++state.openDocumentRequestId;

  try {
    const doc = state.docs.find((candidate) => candidate.file === file);
    if (!doc) {
      return;
    }

    const jumpQuery = String(options.jumpQuery || "");
    const jumpTerms = Array.isArray(options.jumpTerms) ? options.jumpTerms : [];
    const jumpIndex = Number.isFinite(Number(options.jumpIndex)) ? Number(options.jumpIndex) : 0;
    const scrollBehavior = String(options.scrollBehavior || "auto");
    const hasJumpQuery = jumpQuery.trim().length > 0;
    const forceReload = Boolean(options.forceReload);

    if (file === state.activeFile && elements.docContent.classList.contains("visible") && !forceReload) {
      let jumpResult = {
        found: false,
        index: -1,
        total: 0
      };

      if (hasJumpQuery) {
        jumpResult = jumpToSearchMatch(jumpQuery, jumpTerms, jumpIndex, {
          sourceFile: file,
          scrollBehavior
        });
      } else {
        resetJumpNavigation();
      }

      if (requestId !== state.openDocumentRequestId) {
        return;
      }

      document.title = `${doc.title} | AzaDocs`;
      // Push when someone asked for this document, replace when the app
      // simply landed on it, so the address always names what is on screen
      // without inventing history entries nobody navigated to.
      showDocumentInUrl(file, { replace: !pushHash });

      if (hasJumpQuery) {
        if (jumpResult.found) {
          setStatus(`Viewing ${docName(doc.file)}. Match ${jumpResult.index + 1} of ${jumpResult.total} for "${jumpQuery.trim()}".`, "success");
        } else {
          setStatus(`Viewing ${docName(doc.file)}. Could not find "${jumpQuery.trim()}" in rendered content.`, "neutral");
        }
        return;
      }

      setStatus(`Viewing ${docName(doc.file)}`, "neutral");
      return;
    }

    const rawContent = await loadDocContent(file, { forceReload });
    if (requestId !== state.openDocumentRequestId) {
      return;
    }

    const safeHtml = renderDocumentContent(file, rawContent, doc.title || file);

    elements.docContent.classList.toggle("notebook-viewer", isNotebookFile(file));

    destroyPanZoomInstances(elements.docContent);
    elements.docContent.innerHTML = safeHtml;
    elements.docContent.classList.add("visible");
    elements.emptyState.style.display = "none";
    bindTaskCheckboxes(file, rawContent);

    // Claim the document the moment its content is on screen. Waiting until after
    // Mermaid finishes left a multi-second window on diagram-heavy files where the
    // Edit and Delete buttons still pointed at the previously open document.
    state.activeFile = file;
    // Selection-only change: repaint the highlight, don't rebuild the list.
    updateActiveRowHighlight();
    updateActiveDocUI(file);
    document.title = `${doc.title} | AzaDocs`;
    showDocumentInUrl(file, { replace: !pushHash });

    await waitForNextFrame();

    if (requestId !== state.openDocumentRequestId) {
      return;
    }

    let jumpResult = {
      found: false,
      index: -1,
      total: 0
    };

    if (hasJumpQuery) {
      jumpResult = jumpToSearchMatch(jumpQuery, jumpTerms, jumpIndex, {
        sourceFile: file,
        scrollBehavior
      });
    } else {
      resetJumpNavigation();
    }

    await renderMermaidBlocks(elements.docContent);
    if (requestId !== state.openDocumentRequestId) {
      return;
    }

    if (hasJumpQuery) {
      if (jumpResult.found) {
        setStatus(`Viewing ${docName(doc.file)}. Match ${jumpResult.index + 1} of ${jumpResult.total} for "${jumpQuery.trim()}".`, "success");
      } else {
        setStatus(`Viewing ${docName(doc.file)}. Could not find "${jumpQuery.trim()}" in rendered content.`, "neutral");
      }
      return;
    }

    setStatus(`Viewing ${docName(doc.file)}`, "neutral");
  } catch (error) {
    if (requestId !== state.openDocumentRequestId) {
      return;
    }

    showEmptyState(isNotebookFile(file) ? "Could not load this notebook" : "Could not load this markdown", error.message, "ph-warning");
    setStatus(error.message, "error");
  }
}

async function openRecycleBinDocument(file, options = {}) {
  try {
    const doc = state.deletedDocs.find((candidate) => candidate.file === file);
    if (!doc) {
      return;
    }

    const rawContent = await loadDeletedDocContent(file, { forceReload: Boolean(options.forceReload) });
    const originalFile = doc.originalFile || doc.file;
    const safeHtml = renderDocumentContent(originalFile, rawContent, doc.title || originalFile);

    elements.docContent.classList.toggle("notebook-viewer", isNotebookFile(originalFile));

    destroyPanZoomInstances(elements.docContent);
    elements.docContent.innerHTML = safeHtml;
    elements.docContent.classList.add("visible");
    elements.emptyState.style.display = "none";

    // Same reason as openDocument: claim it before the async Mermaid pass.
    // Assigning after the earlier await is deliberate, not a race.
    // eslint-disable-next-line require-atomic-updates
    state.activeFile = file;
    // Selection-only change: repaint the highlight, don't rebuild the list.
    updateActiveRowHighlight();
    updateActiveDocUI(file);

    await waitForNextFrame();
    await renderMermaidBlocks(elements.docContent);

    document.title = state.viewMode === "archive"
      ? `${doc.title} | Archive | AzaDocs`
      : `${doc.title} | Recycle Bin | AzaDocs`;
    setStatus(state.viewMode === "archive"
      ? `Viewing archived doc ${doc.originalFile || doc.file}`
      : `Viewing deleted doc ${doc.originalFile || doc.file}`, "neutral");
  } catch (error) {
    showEmptyState("Could not load deleted document", error.message, "ph-warning");
    setStatus(error.message, "error");
  }
}

async function refreshDeletedDocs({ openFile = null, preserveSearch = true } = {}) {
  const inArchive = state.viewMode === "archive";
  setMeta(inArchive ? "Loading archive..." : "Loading recycle bin...");

  await fetchDeletedDocs();
  void hydrateDeletedSearchContent();

  const query = preserveSearch ? elements.searchInput.value : "";
  if (!preserveSearch) {
    elements.searchInput.value = "";
  }

  await applySearch(query);

  if (state.deletedDocs.length === 0) {
    state.activeFile = null;
    updateActiveDocUI(null);
    if (inArchive) {
      showEmptyState("Archive is empty", "Archived markdowns will appear here.", "ph-archive-box");
      setStatus("Archive is empty.", "neutral");
    } else {
      showEmptyState("Recycle bin is empty", "Soft-deleted markdowns will appear here.", "ph-trash");
      setStatus("Recycle bin is empty.", "neutral");
    }
    return;
  }

  const target = state.deletedDocs.find((doc) => doc.file === openFile)?.file
    || state.deletedDocs.find((doc) => doc.file === state.activeFile)?.file
    || null;

  if (!target) {
    state.activeFile = null;
    showDocumentInUrl(null, { replace: true });
    updateActiveDocUI(null);
    // No toast here: the empty state on screen already says this, and a toast
    // that fires on every refresh is what teaches people to ignore toasts.
    showEmptyState("No file selected", "Choose a deleted file from the explorer to read it.", "ph-trash");
    return;
  }

  await openRecycleBinDocument(target, { forceReload: true });
}

async function deleteCurrentDocument(mode) {
  if (!state.activeFile || state.isRecycleBinMode) {
    setStatus("Select an active markdown to delete.", "error");
    return;
  }

  const targetFile = state.activeFile;
  const shouldProceed = await requestConfirmation({
    title: mode === "hard" ? "Archive this markdown?" : "Move markdown to recycle bin?",
    message: mode === "hard"
      ? `${targetFile} will be moved straight to the archive, skipping the recycle bin. It can still be restored from there.`
      : `${targetFile} will be moved into the recycle bin and can be restored later.`,
    confirmLabel: mode === "hard" ? "Archive" : "Move To Bin",
    tone: mode === "hard" ? "danger" : "primary"
  });

  if (!shouldProceed) {
    setStatus("Delete cancelled.", "neutral");
    return;
  }

  try {
    const payload = await requestJson(`/api/docs/${docUrl(targetFile)}/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode })
    });

    state.contentCache.delete(targetFile);
    await refreshDocs({ preserveSearch: true });
    setStatus(payload.message || `${payload.originalFile} deleted.`, "success");
  } catch (error) {
    if (normalize(error.message).includes("request failed (404)")) {
      setStatus("Delete endpoint returned 404. Restart the server so the recycle-bin API routes are loaded.", "error");
      return;
    }

    setStatus(error.message, "error");
  }
}

async function restoreCurrentDeletedDocument() {
  if (!state.isRecycleBinMode || !state.activeFile) {
    setStatus("Select a recycle bin markdown to restore.", "error");
    return;
  }

  try {
    const payload = await requestJson(`/api/recycle-bin/${encodeURIComponent(state.activeFile)}/restore`, {
      method: "POST"
    });

    state.contentCache.delete(state.activeFile);
    state.isRecycleBinMode = false;
    syncModeUI();
    resetJumpNavigation();
    await refreshDocs({ openFile: payload.file, preserveSearch: false });
    setStatus(`Restored ${payload.file} from recycle bin.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function hardDeleteCurrentDeletedDocument() {
  if (!state.isRecycleBinMode || !state.activeFile) {
    setStatus("Select a recycle bin markdown to archive.", "error");
    return;
  }

  const entryFile = state.activeFile;
  const shouldProceed = await requestConfirmation({
    title: "Archive this markdown?",
    message: "The file stays on disk. It moves out of the recycle bin and into the archive, where it can still be restored or erased for good.",
    confirmLabel: "Archive",
    tone: "danger"
  });

  if (!shouldProceed) {
    setStatus("Archive cancelled.", "neutral");
    return;
  }

  try {
    await requestJson(`/api/recycle-bin/${docUrl(entryFile)}/hard-delete`, {
      method: "POST"
    });

    state.contentCache.delete(entryFile);
    await refreshDeletedDocs({ preserveSearch: true });
    setStatus("Document moved to the archive.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function createFolderOnServer(folderName, parentId = null) {
  return requestJson("/api/folders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: folderName, parentId: parentId || null })
  });
}

async function renameFolderOnServer(folderId, folderName) {
  return requestJson(`/api/folders/${encodeURIComponent(folderId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: folderName })
  });
}

async function moveDocumentToFolder(file, folderId) {
  const payload = await requestJson(`/api/docs/${docUrl(file)}/folder`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ folderId: folderId || null })
  });

  state.contentCache.delete(file);
  // A move is a move on disk, so the document that comes back has the
  // destination's path. Asking for the old one would find nothing there —
  // and only the document actually being read should follow the move.
  const stillOpen = state.activeFile === file ? payload.file : state.activeFile;
  await refreshDocs({ openFile: stillOpen, preserveSearch: true });
  setStatus(`Moved ${payload.file} to ${payload.folderName || state.rootFolderLabel || "Ungrouped"}.`, "success");
  return payload;
}

async function handleFolderModalAction() {
  const folderName = String(elements.folderNameInput.value || "").trim();
  if (!folderName) {
    setStatus("Folder name is required.", "error");
    elements.folderNameInput.focus();
    return;
  }

  try {
    if (state.folderModalMode === "rename") {
      if (!state.folderModalTargetFolderId) {
        setStatus("Select a folder to rename.", "error");
        return;
      }

      await renameFolderOnServer(state.folderModalTargetFolderId, folderName);
      closeFolderModal();
      await refreshDocs({ preserveSearch: true });
      setStatus(`Renamed folder to ${folderName}.`, "success");
      return;
    }

    const created = await createFolderOnServer(folderName, state.folderModalParentId);

    if (state.folderModalMode === "upload") {
      const pending = state.pendingUploadFile;
      closeFolderModal();
      await uploadMarkdown(pending, created.folder.id);
      return;
    }

    if (state.folderModalMode === "move" && state.folderModalTargetFile) {
      await moveDocumentToFolder(state.folderModalTargetFile, created.folder.id);
      closeFolderModal();
      return;
    }

    closeFolderModal();
    await refreshDocs({ preserveSearch: true });
    notify(created.folder.parentId
      ? `Created "${created.folder.name}" in ${created.folder.path.replace(/ \/ [^/]+$/, "")}.`
      : `Created folder "${created.folder.name}".`, "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

// Every render bumps the generation. An async pass that finds the generation has
// moved on abandons its work instead of writing stale HTML over a newer render.
let editorPreviewGeneration = 0;

async function renderEditorPreview() {
  const generation = ++editorPreviewGeneration;

  const inputScrollMax = Math.max(0, elements.editorInput.scrollHeight - elements.editorInput.clientHeight);
  const inputScrollRatio = inputScrollMax > 0
    ? elements.editorInput.scrollTop / inputScrollMax
    : 0;

  const source = state.editorMode === "edit" && isDiagramFile(state.editorFile)
    ? toMermaidMarkdown(elements.editorInput.value)
    : elements.editorInput.value;

  // Markdown alone is cheap and synchronous, so the text updates immediately.
  destroyPanZoomInstances(elements.editorPreview);
  elements.editorPreview.innerHTML = renderMarkdown(source);
  void highlightCodeBlocks(elements.editorPreview);

  const previewScrollMax = Math.max(0, elements.editorPreview.scrollHeight - elements.editorPreview.clientHeight);
  elements.editorPreview.scrollTop = previewScrollMax * inputScrollRatio;

  // Mermaid and KaTeX are the expensive half, so they run once typing settles.
  await renderMermaidBlocks(elements.editorPreview);
  if (generation !== editorPreviewGeneration) {
    return;
  }

  void highlightCodeBlocks(elements.editorPreview);
  const settledScrollMax = Math.max(0, elements.editorPreview.scrollHeight - elements.editorPreview.clientHeight);
  elements.editorPreview.scrollTop = settledScrollMax * inputScrollRatio;
}

// Typing repaints the markdown at most once a frame-ish, and only redraws
// diagrams after a pause. Without this, every keystroke re-parsed the whole
// document and re-ran Mermaid, which locks the browser on diagram-heavy files.
const EDITOR_PREVIEW_TEXT_DELAY = 120;
const EDITOR_PREVIEW_DIAGRAM_DELAY = 420;

function scheduleEditorPreview() {
  if (state.editorPreviewTextTimer) {
    window.clearTimeout(state.editorPreviewTextTimer);
  }

  if (state.editorPreviewDiagramTimer) {
    window.clearTimeout(state.editorPreviewDiagramTimer);
  }

  state.editorPreviewTextTimer = window.setTimeout(() => {
    state.editorPreviewTextTimer = null;
    renderEditorPreviewText();
  }, EDITOR_PREVIEW_TEXT_DELAY);

  state.editorPreviewDiagramTimer = window.setTimeout(() => {
    state.editorPreviewDiagramTimer = null;
    void renderEditorPreview();
  }, EDITOR_PREVIEW_DIAGRAM_DELAY);
}

// The fast path: markdown and syntax highlighting only, no diagram work.
function renderEditorPreviewText() {
  const generation = ++editorPreviewGeneration;

  const source = state.editorMode === "edit" && isDiagramFile(state.editorFile)
    ? toMermaidMarkdown(elements.editorInput.value)
    : elements.editorInput.value;

  destroyPanZoomInstances(elements.editorPreview);
  elements.editorPreview.innerHTML = renderMarkdown(source);
  void highlightCodeBlocks(elements.editorPreview);
  return generation;
}

function syncEditorPaneScroll(sourceElement, targetElement) {
  if (state.editorScrollSyncLock) {
    return;
  }

  const sourceMax = Math.max(0, sourceElement.scrollHeight - sourceElement.clientHeight);
  const targetMax = Math.max(0, targetElement.scrollHeight - targetElement.clientHeight);

  const ratio = sourceMax > 0
    ? sourceElement.scrollTop / sourceMax
    : 0;

  state.editorScrollSyncLock = true;
  targetElement.scrollTop = targetMax * ratio;

  window.requestAnimationFrame(() => {
    state.editorScrollSyncLock = false;
  });
}

// The folder picker only appears when creating: an existing document is moved
// with the dedicated Move action, which already handles reassignment.
function syncEditorFolderPicker(mode, folderId) {
  const select = elements.editorFolderSelect;
  if (!select || !elements.editorFolderField) {
    return;
  }

  elements.editorFolderField.hidden = mode !== "create";
  if (mode !== "create") {
    return;
  }

  select.innerHTML = "";

  const rootOption = document.createElement("option");
  rootOption.value = "";
  rootOption.textContent = state.rootFolderLabel || "Ungrouped";
  select.appendChild(rootOption);

  for (const folder of [...state.folders].sort((left, right) => compareNames(left.name, right.name))) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }

  // Creating from a folder's own menu should land in that folder; the picker
  // is still there to change it. A stale id (folder deleted in another tab)
  // falls back to the root rather than selecting nothing.
  select.value = folderId && state.folders.some((folder) => folder.id === folderId) ? folderId : "";
}

/* --- Editing the document on the page -------------------------------------
 *
 * Not a mode in a dialog: the document you are reading becomes the document you
 * are editing, in the same column, at the same width, in the same type, with its
 * diagrams and highlighted code still drawn. Nothing moves when you start, which
 * is the whole point — an editor that relayouts the page has already stopped
 * being the page.
 *
 * Underneath it is the block model in visual-editor.js. The source is cut into
 * blocks that reassemble byte for byte; only the blocks actually typed into are
 * written back. Open a document, fix one word, save, and the diff is that word,
 * even for the files here that were written somewhere else entirely.
 */

let pageBlocks = [];
// Link reference definitions live at the bottom of a document and are used
// halfway up it. Rendering a block on its own would lose them, so they are
// collected once and appended to each block before rendering — for the
// rendering only, never for what gets written back.
let pageLinkReferences = "";

const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:\s*\S+/;

function collectLinkReferences(markdown) {
  const found = String(markdown || "")
    .split("\n")
    .filter((line) => REFERENCE_DEFINITION_RE.test(line));

  return found.length > 0 ? `\n\n${found.join("\n")}\n` : "";
}

/* A block that is nothing but link definitions.
 *
 * It renders to nothing at all, so as formatted text it would be an invisible
 * block you could put the cursor in and destroy without seeing it happen. It is
 * markdown that has no rendered form — which is exactly the case the source
 * boxes exist for.
 */
function isDefinitionsBlock(block) {
  if (block.type !== "paragraph") {
    return false;
  }

  const lines = block.source.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 && lines.every((line) => REFERENCE_DEFINITION_RE.test(line));
}

function pageEditActive() {
  return state.pageEdit.active;
}

// The source a block currently stands for: what its own textarea says if it has
// one, otherwise the text it came in with.
function blockSource(block) {
  if (block.sourceOverride == null) {
    return block.source;
  }

  const value = String(block.sourceOverride).replace(/\n+$/, "");
  return value ? `${value}\n` : "";
}

function embedLabel(block) {
  switch (block.type) {
    case "fence":
      return block.info ? `code (${block.info})` : "code";
    case "table":
      return "table";
    case "math":
      return "math";
    case "html":
      return "HTML";
    case "frontmatter":
      return "front matter";
    default:
      return isDefinitionsBlock(block) ? "link definitions" : "source";
  }
}

function markPageEditDirty() {
  updatePageEditState();
}

function updatePageEditState() {
  if (!elements.pageEditState) {
    return;
  }

  elements.pageEditState.textContent = isPageEditDirty() ? "Unsaved changes" : "No changes yet";
}

/* A block that survives being shown as formatted text. It is the rendered
 * markdown, editable in place — no frame, no handle, nothing to tell you that
 * the paragraph you are typing in is a paragraph in a list of blocks.
 */
function renderRichBlock(block, index) {
  const node = document.createElement("div");
  node.className = "ve-block";
  node.dataset.index = String(index);
  // setAttribute, not the property: the attribute is what CSS and querySelector
  // see, and not every DOM implementation reflects the property back to it.
  node.setAttribute("contenteditable", "true");
  node.spellcheck = true;
  node.innerHTML = MarkdownCore.renderMarkdown(block.source + pageLinkReferences);
  makeEditorTasksLive(node, block);

  node.addEventListener("input", () => {
    block.dirty = true;
    markPageEditDirty();
  });

  block.serialize = () => VisualEditor.serializeEditedBlock(node);
  return node;
}

// The serializer already writes a box's state back as [x] or [ ], so the only
// thing between a checkbox and working here is that marked renders it disabled.
//
// Do not be tempted to intercept the click and flip `checked` by hand: by the
// time a click event is delivered the box has already toggled itself, so
// cancelling the event to "take control" reverts it and the tick never lands.
// Marking it contenteditable="false" is what stops the surrounding editable
// region from swallowing the click; the browser does the rest.
function makeEditorTasksLive(node, block) {
  for (const box of taskCheckboxes(node)) {
    box.disabled = false;
    // An island in the text: the caret skips it, and typing cannot break a list
    // item's marker apart.
    box.setAttribute("contenteditable", "false");

    box.addEventListener("change", () => {
      block.dirty = true;
      markPageEditDirty();
    });
  }
}

/* --- Tables ---------------------------------------------------------------
 *
 * A table is a grid of text with an alignment per column, and both of those
 * survive being edited as a grid. So the table is not shown as markdown: the
 * cells are typed into where they are, and rows, columns and alignment are
 * changed with controls on the table itself.
 *
 * What does not survive the trip is the spacing of the source. That is why a
 * table is only rewritten once it has actually been edited — an untouched table
 * is emitted exactly as it was found, however irregularly it was typed.
 */
function renderTableBlock(block, index) {
  const node = document.createElement("div");
  node.className = "ve-block ve-table";
  node.dataset.index = String(index);
  node.setAttribute("contenteditable", "false");
  // The declared alignment of each column, which the cells are drawn with and
  // the serializer writes back. Read from the source rather than from the
  // rendered table: the renderer expresses it in a way sanitizing may drop.
  block.align = VisualEditor.tableAlignments(block.source);
  node.innerHTML = MarkdownCore.renderMarkdown(block.source);

  const table = node.querySelector("table");
  if (!table) {
    // Not a table after all once rendered. Fall back to source editing rather
    // than putting controls on something that is not there.
    return renderEmbedBlock(block, index);
  }

  const touched = () => {
    block.dirty = true;
    markPageEditDirty();
  };

  const paint = () => paintTable(node, block);
  paint();

  node.append(buildTableTools(node, block, paint, touched));

  node.addEventListener("input", (event) => {
    if (event.target.closest("th, td")) {
      touched();
    }
  });

  node.addEventListener("focusin", (event) => {
    const cell = event.target.closest?.("th, td");
    if (cell) {
      block.lastCell = cell;
    }
  });

  block.serialize = () => VisualEditor.tableElementToMarkdown(node.querySelector("table"), block.align);
  return node;
}

// Every cell editable, and every cell drawn with its column's alignment.
function paintTable(node, block) {
  const table = node.querySelector("table");
  if (!table) {
    return;
  }

  for (const row of table.querySelectorAll("tr")) {
    [...row.children].forEach((cell, column) => {
      cell.setAttribute("contenteditable", "true");
      cell.style.textAlign = block.align[column] || "";
    });
  }
}

/* Which cell the controls act on.
 *
 * The cursor is the answer while it is in the table, and the last cell it was
 * in once it is not — clicking a control is not a reason for "this column" to
 * stop meaning the column you were just typing in.
 */
function focusedCell(node, block) {
  const active = document.activeElement;
  const current = active && node.contains(active) ? active.closest("th, td") : null;
  if (current) {
    return current;
  }

  return block.lastCell && node.contains(block.lastCell) ? block.lastCell : null;
}

function cellPosition(cell) {
  const row = cell.closest("tr");
  const table = row.closest("table");
  return {
    row: [...table.querySelectorAll("tr")].indexOf(row),
    column: [...row.children].indexOf(cell)
  };
}

function buildTableTools(node, block, paint, touched) {
  const tools = document.createElement("div");
  tools.className = "ve-table-tools";
  tools.setAttribute("contenteditable", "false");

  const button = (icon, label, run) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "ve-table-tool";
    control.title = label;
    control.setAttribute("aria-label", label);
    control.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
    // The cell has to keep the focus, because every one of these acts on the
    // cell the cursor is in.
    control.addEventListener("mousedown", (event) => event.preventDefault());
    control.addEventListener("click", () => {
      const table = node.querySelector("table");
      const cell = focusedCell(node, block) || table.querySelector("th, td");
      const at = cell ? cellPosition(cell) : { row: 0, column: 0 };
      run(table, at);
      paint();
      touched();

      // Whatever the cursor was in may have just been deleted. Put it in the
      // cell that took its place, so the next control still means "here".
      const rows = [...table.querySelectorAll("tr")];
      const row = rows[Math.min(at.row, rows.length - 1)];
      row?.children[Math.min(at.column, row.children.length - 1)]?.focus();
    });
    return control;
  };

  const separator = () => {
    const line = document.createElement("span");
    line.className = "ve-table-sep";
    line.setAttribute("aria-hidden", "true");
    return line;
  };

  tools.append(
    button("ph-rows-plus-bottom", "Add row below", (table, at) => insertTableRow(table, at.row)),
    button("ph-rows", "Delete this row", (table, at) => deleteTableRow(table, at.row)),
    button("ph-columns-plus-right", "Add column to the right", (table, at) => {
      insertTableColumn(table, at.column);
      block.align.splice(at.column + 1, 0, "");
    }),
    button("ph-columns", "Delete this column", (table, at) => {
      deleteTableColumn(table, at.column);
      block.align.splice(at.column, 1);
    }),
    separator(),
    button("ph-text-align-left", "Align this column left", (table, at) => {
      block.align[at.column] = "left";
    }),
    button("ph-text-align-center", "Centre this column", (table, at) => {
      block.align[at.column] = "center";
    }),
    button("ph-text-align-right", "Align this column right", (table, at) => {
      block.align[at.column] = "right";
    })
  );

  return tools;
}

function insertTableRow(table, afterIndex) {
  const rows = [...table.querySelectorAll("tr")];
  const reference = rows[Math.max(1, afterIndex)] || rows[rows.length - 1];
  if (!reference) {
    return;
  }

  const fresh = document.createElement("tr");
  for (let i = 0; i < reference.children.length; i += 1) {
    fresh.appendChild(document.createElement("td"));
  }

  reference.parentNode.insertBefore(fresh, reference.nextSibling);
}

function deleteTableRow(table, index) {
  const rows = [...table.querySelectorAll("tr")];
  // The header row is the table's column names; a table without one is not a
  // markdown table at all.
  if (index <= 0 || rows.length <= 2) {
    return;
  }

  rows[index].remove();
}

function insertTableColumn(table, afterIndex) {
  for (const row of table.querySelectorAll("tr")) {
    const isHeader = Boolean(row.querySelector("th"));
    const cell = document.createElement(isHeader ? "th" : "td");
    const reference = row.children[afterIndex];

    if (reference) {
      row.insertBefore(cell, reference.nextSibling);
    } else {
      row.appendChild(cell);
    }
  }
}

function deleteTableColumn(table, index) {
  const rows = [...table.querySelectorAll("tr")];
  if (rows.length === 0 || rows[0].children.length <= 1) {
    return;
  }

  for (const row of rows) {
    row.children[index]?.remove();
  }
}

/* --- Code -----------------------------------------------------------------
 *
 * The text inside a fence is literal, so it is exactly the kind of thing that
 * can be typed into as itself. The code block stays a code block — same font,
 * same colours, same box — and the caret goes in it. Highlighting is left alone
 * while you type, because re-highlighting on every keystroke rebuilds the
 * markup the caret is standing in, and comes back when you leave.
 *
 * The language is an input rather than something to go and find in the source,
 * since it is the one part of a fence that is not the code.
 */
function renderCodeBlock(block, index) {
  const fence = VisualEditor.parseFence(block.source);

  // A mermaid fence renders to a diagram. There is nothing to type into in an
  // SVG, so those keep the rendering and open their source on request.
  if (/^mermaid\b/i.test(fence.info)) {
    return renderEmbedBlock(block, index);
  }

  const node = document.createElement("div");
  node.className = "ve-block ve-code";
  node.dataset.index = String(index);
  node.setAttribute("contenteditable", "false");
  node.innerHTML = MarkdownCore.renderMarkdown(block.source);

  const code = node.querySelector("pre code");
  if (!code) {
    return renderEmbedBlock(block, index);
  }

  // The renderer adds a trailing newline of its own. Setting the text from the
  // parsed fence means what is on screen is exactly the code, so what comes
  // back out of the element needs no interpretation.
  code.textContent = fence.body;

  // plaintext-only keeps Enter as a newline and paste as text, which is what
  // code is. Browsers without it get the ordinary editable behaviour and the
  // paste handler on the document.
  code.setAttribute("contenteditable", "plaintext-only");
  if (code.contentEditable !== "plaintext-only") {
    code.setAttribute("contenteditable", "true");
  }
  code.spellcheck = false;

  const language = document.createElement("input");
  language.className = "ve-code-language";
  language.value = fence.info;
  language.placeholder = "language";
  language.spellcheck = false;
  language.setAttribute("aria-label", "Code language");

  const fenceState = { info: fence.info };

  const touched = () => {
    block.dirty = true;
    markPageEditDirty();
  };

  language.addEventListener("input", () => {
    fenceState.info = language.value.trim();
    touched();
  });

  code.addEventListener("input", touched);

  // Highlighting is rebuilt from the text once the caret has left, so the
  // colours come back without the markup moving under the cursor.
  code.addEventListener("blur", () => {
    const text = code.textContent;
    code.textContent = text;
    delete code.dataset.highlighted;
    code.className = fenceState.info ? `language-${fenceState.info}` : "";
    void MarkdownCore.highlightCodeBlocks(node);
  });

  node.appendChild(language);

  block.serialize = () => VisualEditor.serializeFence({
    ...fence,
    info: fenceState.info,
    body: code.textContent
  });

  return node;
}

/* --- Everything else ------------------------------------------------------
 *
 * Math, raw HTML, front matter, link definitions and mermaid diagrams. What
 * these have in common is that there is nothing in the rendering to type into:
 * an equation is a picture of an equation, a diagram is a picture of a diagram,
 * and front matter has no rendering at all. They stay rendered and hand over
 * their markdown on request — with a live preview, so the result is visible
 * while it is being written rather than only afterwards.
 */
function renderEmbedBlock(block, index) {
  const node = document.createElement("div");
  node.className = "ve-block ve-embed";
  node.dataset.index = String(index);
  node.setAttribute("contenteditable", "false");
  block.serialize = () => blockSource(block);
  paintEmbedBlock(node, block);
  return node;
}

function paintEmbedBlock(node, block) {
  node.classList.remove("is-source-open");
  // A diagram in here may already own a pan-zoom instance bound to an element
  // that is about to be thrown away.
  destroyPanZoomInstances(node);
  node.innerHTML = "";

  const view = document.createElement("div");
  view.className = "ve-embed-view";

  if (block.type === "frontmatter" || isDefinitionsBlock(block)) {
    // Neither of these appears in the document as it reads, so showing them as
    // a rendered anything would be an invention. They get a marker instead —
    // visible enough to find, small enough not to be part of the prose.
    view.innerHTML = `<span class="ve-embed-note">${MarkdownCore.escapeHtml(embedLabel(block))}</span>`;
  } else {
    view.innerHTML = MarkdownCore.renderMarkdown(blockSource(block) + pageLinkReferences);
  }

  const open = document.createElement("button");
  open.type = "button";
  open.className = "ve-embed-edit";
  open.title = `Edit this ${embedLabel(block)} as markdown`;
  open.innerHTML = `<i class="ph ph-code" aria-hidden="true"></i><span>Edit ${embedLabel(block)}</span>`;
  open.addEventListener("click", () => openEmbedSource(node, block));

  node.append(view, open);
  void renderMermaidBlocks(node);
}

function openEmbedSource(node, block) {
  node.classList.add("is-source-open");
  destroyPanZoomInstances(node);
  node.innerHTML = "";

  const head = document.createElement("div");
  head.className = "ve-embed-head";
  head.textContent = embedLabel(block);

  const area = document.createElement("textarea");
  area.className = "ve-embed-source";
  area.value = blockSource(block).replace(/\n+$/, "");
  area.spellcheck = false;
  area.setAttribute("aria-label", `${embedLabel(block)} source`);

  const preview = document.createElement("div");
  preview.className = "ve-embed-preview markdown-body";

  const fit = () => {
    area.rows = Math.min(24, Math.max(2, area.value.split("\n").length));
  };

  // Writing an equation or a diagram blind and pressing Done to find out is
  // the thing that makes source editing feel like a punishment.
  const drawPreview = () => {
    destroyPanZoomInstances(preview);
    preview.innerHTML = MarkdownCore.renderMarkdown(blockSource(block) + pageLinkReferences);
    void renderMermaidBlocks(preview);
  };

  fit();
  drawPreview();

  area.addEventListener("input", () => {
    block.dirty = true;
    block.sourceOverride = area.value;
    fit();
    markPageEditDirty();

    window.clearTimeout(state.embedPreviewTimer);
    state.embedPreviewTimer = window.setTimeout(drawPreview, 250);
  });

  const done = document.createElement("button");
  done.type = "button";
  done.className = "ve-embed-done";
  done.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i><span>Done</span>';
  done.addEventListener("click", () => paintEmbedBlock(node, block));

  node.append(head, area, preview, done);
  area.focus();
}

// Which block a rendered node is showing. The index on the node is only ever
// written, and stops being true the moment a block is inserted above it, so
// anything that needs to find a block from the page asks here instead.
const blockOfNode = new WeakMap();

// Which of the four ways a block is drawn and written back.
function renderBlock(block, index) {
  const node = drawBlock(block, index);
  blockOfNode.set(node, block);
  return node;
}

function drawBlock(block, index) {
  if (isDefinitionsBlock(block)) {
    return renderEmbedBlock(block, index);
  }

  if (VisualEditor.isRich(block)) {
    return renderRichBlock(block, index);
  }

  if (block.type === "table") {
    return renderTableBlock(block, index);
  }

  if (block.type === "fence") {
    return renderCodeBlock(block, index);
  }

  return renderEmbedBlock(block, index);
}

/* --- Putting something new into the document -----------------------------
 *
 * The formatting bar could only ever change text that was already there. A
 * code fence, a table, a formula or a diagram had to be typed as markdown in
 * the source editor, which is an odd thing to have to do in a visual editor.
 *
 * Each of these is inserted as its markdown and then parsed by the same
 * splitter the document went through, so a new block is typed and rendered by
 * exactly the same path as one that was already in the file — there is no
 * second idea of what a table is.
 */
const NEW_BLOCKS = {
  fence: {
    label: "code block",
    markdown: "```\n\n```\n"
  },
  table: {
    label: "table",
    markdown: "| Column | Column |\n| --- | --- |\n|  |  |\n"
  },
  math: {
    label: "formula",
    markdown: "$$\n\\frac{a}{b}\n$$\n"
  },
  mermaid: {
    label: "diagram",
    markdown: "```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n"
  }
};

// Where a new block should go: after the block the cursor is in, or at the end
// when the cursor is nowhere.
function currentPageBlockNode() {
  const editing = editableBlockFromSelection();
  if (editing) {
    return editing;
  }

  const focused = document.activeElement?.closest?.(".ve-block");
  if (focused) {
    return focused;
  }

  const all = elements.docContent.querySelectorAll(".ve-block");
  return all.length > 0 ? all[all.length - 1] : null;
}

function insertPageBlock(kind) {
  const template = NEW_BLOCKS[kind];
  if (!pageEditActive() || !template) {
    return null;
  }

  const afterNode = currentPageBlockNode();
  const afterBlock = afterNode ? blockOfNode.get(afterNode) : null;
  const at = afterBlock ? pageBlocks.indexOf(afterBlock) : -1;
  const insertAt = at === -1 ? pageBlocks.length : at + 1;

  // A blank line first, or the new block runs straight into the previous
  // paragraph and stops being a separate block at all.
  const spacer = { type: "blank", source: "\n" };
  const fresh = VisualEditor.splitBlocks(template.markdown);

  pageBlocks.splice(insertAt, 0, spacer, ...fresh);

  let anchor = afterNode;
  let first = null;

  for (const [offset, block] of fresh.entries()) {
    if (block.type === "blank") {
      continue;
    }

    const node = renderBlock(block, insertAt + 1 + offset);
    if (anchor) {
      anchor.after(node);
    } else {
      elements.docContent.appendChild(node);
    }

    anchor = node;
    first = first || node;
  }

  if (!first) {
    return null;
  }

  void renderMermaidBlocks(first);
  markPageEditDirty();

  // Cursor first. Scrolling is a courtesy, and a browser that cannot do it must
  // not cost the cursor its place.
  startTypingIn(first);
  first.scrollIntoView?.({ block: "center", behavior: "smooth" });
  setStatus(`Added a ${template.label}.`, "success");
  return first;
}

// Put the cursor where whoever pressed the button is going to type next, which
// is a different place in each of these.
function startTypingIn(node) {
  const cell = node.querySelector("th, td");
  if (cell) {
    cell.focus();
    return;
  }

  const code = node.querySelector("pre code");
  if (code) {
    code.focus();
    return;
  }

  // Maths and diagrams have no rendering to type into, so they open on their
  // source with the preview already beside it.
  const source = node.querySelector(".ve-embed-edit");
  if (source) {
    source.click();
    return;
  }

  node.focus?.();
}

function renderPageEditor(markdown) {
  pageBlocks = VisualEditor.splitBlocks(markdown);
  pageLinkReferences = collectLinkReferences(markdown);

  destroyPanZoomInstances(elements.docContent);
  elements.docContent.innerHTML = "";
  elements.docContent.classList.add("doc-editing", "visible");

  for (const [index, block] of pageBlocks.entries()) {
    // A run of blank lines is spacing, not content. It stays in the model so the
    // document reassembles exactly, and is simply not drawn.
    if (block.type === "blank") {
      continue;
    }

    elements.docContent.appendChild(renderBlock(block, index));
  }

  // An empty document would have nowhere to put the cursor. Give it a paragraph
  // to start in; it contributes nothing to the file until something is typed
  // into it.
  if (!elements.docContent.querySelector('.ve-block[contenteditable="true"]')) {
    const index = pageBlocks.length;
    pageBlocks.push({ type: "paragraph", source: "" });
    const node = renderRichBlock(pageBlocks[index], index);
    // Only this one carries a placeholder. A block that is empty because the
    // document says so must not sprout words the file does not contain.
    node.classList.add("ve-placeholder");
    elements.docContent.appendChild(node);
  }

  void renderMermaidBlocks(elements.docContent);
  updatePageEditState();
}

/* Back to markdown.
 *
 * Only dirty blocks are re-serialized, each by the function the renderer gave
 * it. That is the whole safety property, and the reason this can be pointed at
 * a library written elsewhere.
 */
function collectPageMarkdown() {
  const out = [];

  for (const block of pageBlocks) {
    if (!block.dirty || typeof block.serialize !== "function") {
      out.push(block.source);
      continue;
    }

    out.push(block.serialize());
  }

  return out.join("");
}

function isPageEditDirty() {
  return pageEditActive() && collectPageMarkdown() !== state.pageEdit.initial;
}

// The bar sits under the viewer toolbar, which is sticky and whose height
// depends on what is in it. Measuring beats guessing.
function syncPageEditOffset() {
  if (!elements.pageEditBar || !elements.viewerToolbar) {
    return;
  }

  const height = elements.viewerToolbar.offsetHeight || 45;
  elements.pageEditBar.style.setProperty("--page-edit-top", `${height}px`);
}

/* Put the reading view back from markdown already in hand. No refetch: the
 * content is what was loaded to edit, so a round trip to the server would only
 * add a delay and a way to fail.
 */
async function restorePageView(file, markdown, title) {
  destroyPanZoomInstances(elements.docContent);
  elements.docContent.innerHTML = renderDocumentContent(file, markdown, title || file);
  elements.docContent.classList.add("visible");
  await renderMermaidBlocks(elements.docContent);
}

async function startPageEdit() {
  if (pageEditActive()) {
    return;
  }

  if (state.isRecycleBinMode) {
    setStatus("Restore this document before editing it.", "error");
    return;
  }

  if (!state.activeFile) {
    setStatus("Open a document first, then choose Edit.", "error");
    return;
  }

  if (isNotebookFile(state.activeFile)) {
    setStatus("Notebook files are view-only in this viewer.", "neutral");
    return;
  }

  if (!can("doc:write")) {
    setStatus("Your account cannot edit documents.", "error");
    return;
  }

  // A .mmd file is diagram source that the viewer wraps in a fence to render.
  // Its content is not markdown, so cutting it into markdown blocks would be
  // reading it as something it is not. It goes straight to the source editor.
  if (isDiagramFile(state.activeFile)) {
    await openEditorForDocument(state.activeFile);
    return;
  }

  const file = state.activeFile;
  const doc = getDocByFile(file);

  let content;
  try {
    content = await loadDocContent(file);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  // Loading is async and the sidebar is not. If the reader moved on while the
  // content was in flight, editing what they left would be a surprise.
  if (state.activeFile !== file) {
    return;
  }

  state.pageEdit = {
    active: true,
    file,
    title: doc?.title || file,
    initial: content
  };

  // Search highlights belong to the rendering that is about to be replaced.
  resetJumpNavigation();

  document.body.classList.add("page-editing");
  elements.pageEditBar.hidden = false;
  syncPageEditOffset();
  renderPageEditor(content);

  elements.docContent.querySelector('[contenteditable="true"]')?.focus();
  setStatus(`Editing ${docName(file)} on the page.`, "neutral");
}

function exitPageEdit() {
  // A queued preview must not fire into a document that has gone back to
  // being read.
  window.clearTimeout(state.embedPreviewTimer);
  state.embedPreviewTimer = null;

  state.pageEdit = { active: false, file: null, title: "", initial: "" };
  pageBlocks = [];
  pageLinkReferences = "";
  elements.pageEditBar.hidden = true;
  elements.docContent.classList.remove("doc-editing");
  document.body.classList.remove("page-editing");
}

/* Saving keeps you where you were reading.
 *
 * Re-rendering resets the scroll, and being thrown to the top of a long document
 * every time you fix a sentence in the middle of it is its own reason not to
 * edit anything.
 */
function viewerScroll() {
  return elements.docContent.closest(".viewer") || null;
}

async function savePageEdit() {
  if (!pageEditActive()) {
    return;
  }

  const { file, title } = state.pageEdit;
  const content = collectPageMarkdown();

  if (content === state.pageEdit.initial) {
    exitPageEdit();
    await restorePageView(file, content, title);
    setStatus(`No changes to save in ${docName(file)}.`, "neutral");
    return;
  }

  const viewer = viewerScroll();
  const offset = viewer ? viewer.scrollTop : 0;

  elements.pageEditSaveBtn.disabled = true;

  try {
    const payload = await requestJson(`/api/docs/${docUrl(file)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });

    exitPageEdit();
    await refreshDocs({ openFile: payload.file || file, preserveSearch: true });

    if (viewer) {
      viewer.scrollTop = offset;
    }

    setStatus(`Saved ${payload.file || file}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.pageEditSaveBtn.disabled = false;
  }
}

async function cancelPageEdit({ confirm = true, restore = true } = {}) {
  if (!pageEditActive()) {
    return true;
  }

  if (confirm && isPageEditDirty()) {
    const discard = await requestConfirmation({
      title: "Discard your edits?",
      message: `${docName(state.pageEdit.file)} has changes that have not been saved.`,
      confirmLabel: "Discard Changes",
      tone: "danger"
    });

    if (!discard) {
      return false;
    }
  }

  const { file, initial, title } = state.pageEdit;
  exitPageEdit();

  // A caller that is about to draw a different document does not need this one
  // rendered first, only to be thrown away a frame later.
  if (restore) {
    await restorePageView(file, initial, title);
    setStatus(`Stopped editing ${docName(file)}.`, "neutral");
  }

  return true;
}

/* The way out to the source.
 *
 * Edits made on the page come with you, so the switch is not a decision you have
 * to make before you start. The page behind the dialog goes back to what is on
 * disk: the dialog now owns the unsaved version, and it already asks before
 * throwing it away.
 */
async function openSourceFromPageEdit() {
  if (!pageEditActive()) {
    return;
  }

  const { file, initial, title } = state.pageEdit;
  const content = collectPageMarkdown();
  const doc = getDocByFile(file);

  exitPageEdit();
  await restorePageView(file, initial, title);

  openEditor({
    mode: "edit",
    fileName: file,
    content,
    folderId: doc?.folderId || null
  });
}

/* The toolbar.
 *
 * execCommand is deprecated and still the only thing every browser implements
 * for editing a contenteditable selection. The alternative is hand-rolled Range
 * surgery for bold, italic and lists, which is a great deal of code to
 * reimplement worse. What it produces is normalised by the serializer anyway —
 * a <b> becomes ** either way.
 */
function editableBlockFromSelection() {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor) {
    return null;
  }

  const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
  return element?.closest('.ve-block[contenteditable="true"]') || null;
}

function applyVisualCommand(command) {
  const block = editableBlockFromSelection();
  if (!block) {
    notify("Put the cursor in the text first.", "neutral");
    return;
  }

  const selection = window.getSelection();
  const run = (name, value) => document.execCommand(name, false, value);

  switch (command) {
    case "bold": run("bold"); break;
    case "italic": run("italic"); break;
    case "ul": run("insertUnorderedList"); break;
    case "ol": run("insertOrderedList"); break;
    case "hr": run("insertHTML", "<hr>"); break;
    case "code": {
      const text = String(selection).trim();
      if (!text) {
        notify("Select the text to mark as code.", "neutral");
        return;
      }
      run("insertHTML", `<code>${MarkdownCore.escapeHtml(text)}</code>`);
      break;
    }
    case "link": {
      const text = String(selection).trim();
      const href = window.prompt("Link address", "https://");
      if (!href) {
        return;
      }
      if (text) {
        run("createLink", href);
      } else {
        run("insertHTML", `<a href="${MarkdownCore.escapeHtml(href)}">${MarkdownCore.escapeHtml(href)}</a>`);
      }
      break;
    }
    default:
      return;
  }

  block.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyVisualBlockFormat(tag) {
  const block = editableBlockFromSelection();
  if (!block) {
    notify("Put the cursor in the text first.", "neutral");
    return;
  }

  document.execCommand("formatBlock", false, tag.toUpperCase());
  block.dispatchEvent(new Event("input", { bubbles: true }));
}

/* Write / Preview tabs, for when the two panes cannot sit side by side.
 *
 * The breakpoint is a width, not a device, so a narrow window on a desktop gets
 * tabs too and widening it puts both panes back. It has to match the media
 * query in the stylesheet exactly — the CSS decides whether the tab bar is
 * visible and this decides whether a pane is hidden, and if they disagree you
 * get a tab bar controlling nothing, or worse, no visible pane at all. The
 * layout suite checks the two against each other.
 */
const EDITOR_TABS_QUERY = "(max-width: 1160px)";

function editorTabsActive() {
  return Boolean(window.matchMedia?.(EDITOR_TABS_QUERY).matches);
}

function syncEditorTabs() {
  const tabbed = editorTabsActive();
  const showing = state.editorTab === "preview" ? "preview" : "write";

  for (const [name, tab, pane] of [
    ["write", elements.editorTabWrite, elements.editorWritePane],
    ["preview", elements.editorTabPreview, elements.editorPreviewPane]
  ]) {
    if (!tab || !pane) {
      continue;
    }

    const selected = name === showing;
    tab.setAttribute("aria-selected", String(selected));
    // Only one tab is in the tab order; the arrow keys move between them.
    tab.tabIndex = selected ? 0 : -1;
    // Above the breakpoint both panes are on show and neither is hidden,
    // whatever the tab state happens to be.
    pane.hidden = tabbed && !selected;
  }
}

function selectEditorTab(name) {
  state.editorTab = name === "preview" ? "preview" : "write";
  syncEditorTabs();

  if (state.editorTab === "preview") {
    // Mermaid measures the element it draws into, and a pane that was
    // display:none measures zero — so a diagram laid out while the tab was
    // hidden comes out the wrong size. Redraw now that it has a width.
    void renderEditorPreview();
  } else {
    elements.editorInput.focus();
  }
}

function openEditor({ mode, fileName, content, folderId = null }) {
  state.editorMode = mode;
  state.editorFile = mode === "edit" ? fileName : null;
  state.editorOpen = true;
  // Always opens on Write: the editor is opened to type in, and landing on a
  // preview of what you already have would be a step to undo every time.
  state.editorTab = "write";
  syncEditorTabs();
  syncEditorFolderPicker(mode, folderId);

  // The name only. The folder is the picker beside it, or the path it is
  // already in — a path typed here would be a move the endpoint refuses.
  elements.editorFileName.value = docName(fileName || "");
  // Editing the name is how you rename: saving renames the file first, then writes
  // the content. It used to be disabled here with no explanation and no other way
  // to rename a document anywhere in the app.
  elements.editorFileName.disabled = false;
  elements.editorFileName.title = mode === "edit"
    ? "Change this to rename the document"
    : "Name for the new document";
  elements.editorInput.value = content || "";
  state.editorInitialContent = elements.editorInput.value;
  state.editorInitialFileName = elements.editorFileName.value;
  elements.editorInput.scrollTop = 0;
  elements.editorPreview.scrollTop = 0;
  state.editorScrollSyncLock = false;
  void renderEditorPreview();

  elements.saveDocBtn.innerHTML = mode === "edit"
    ? '<i class="ph ph-floppy-disk"></i> Save Changes'
    : '<i class="ph ph-floppy-disk"></i> Save New';

  elements.editorModal.classList.add("open");
  elements.editorModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.editorModal);
  syncBodyLock();

  elements.editorInput.focus();
}

function closeEditor() {
  // A queued preview must not fire into a closed editor.
  if (state.editorPreviewTextTimer) {
    window.clearTimeout(state.editorPreviewTextTimer);
    state.editorPreviewTextTimer = null;
  }

  if (state.editorPreviewDiagramTimer) {
    window.clearTimeout(state.editorPreviewDiagramTimer);
    state.editorPreviewDiagramTimer = null;
  }

  editorPreviewGeneration += 1;

  state.editorOpen = false;
  state.editorInitialContent = "";
  state.editorInitialFileName = "";
  elements.editorModal.classList.remove("open");
  elements.editorModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.editorModal);
  syncBodyLock();
}

function isEditorDirty() {
  if (!state.editorOpen) {
    return false;
  }

  return elements.editorInput.value !== state.editorInitialContent
    || elements.editorFileName.value !== state.editorInitialFileName;
}

async function requestEditorClose() {
  if (!isEditorDirty()) {
    closeEditor();
    return;
  }

  const shouldDiscard = await requestConfirmation({
    title: "Discard unsaved changes?",
    message: "This document has edits that have not been saved. Closing the editor will lose them.",
    confirmLabel: "Discard Changes",
    tone: "danger"
  });

  if (shouldDiscard) {
    closeEditor();
  }
}

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

async function uploadMarkdown(file, folderId = null) {
  if (!file) {
    return;
  }

  const formData = new FormData();
  formData.append("markdownFile", file);
  if (folderId) {
    formData.append("folderId", folderId);
  }

  try {
    const payload = await requestJson("/api/docs/upload", {
      method: "POST",
      body: formData
    });

    await refreshDocs({ openFile: payload.file, preserveSearch: false });
    setStatus(payload.folderName
      ? `Uploaded ${payload.file} to ${payload.folderName}.`
      : `Uploaded ${payload.file}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.pendingUploadFile = null;
    elements.uploadInput.value = "";
  }
}

/* --------------------------------------------------------------------------
   Folder upload

   The picker hands back a flat list of File objects, each carrying its path
   within the chosen folder in webkitRelativePath. The tree is rebuilt from
   those paths server-side.

   Unsupported files are dropped here rather than sent and rejected: a real
   folder is full of images, .DS_Store and lock files, and there is no reason
   to spend upload bandwidth on them. The server still checks — this is
   convenience, not the security boundary.
   -------------------------------------------------------------------------- */

const UPLOADABLE_EXTENSIONS = [".md", ".markdown", ".mmd", ".mermaid", ".ipynb"];
// Mirrors MAX_FOLDER_UPLOAD_FILES on the server; checked here so a huge folder
// fails immediately instead of after uploading everything.
const MAX_FOLDER_UPLOAD_FILES = 200;

function isUploadableFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return UPLOADABLE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function relativePathFor(file) {
  // webkitRelativePath is empty for a plain multi-file selection, which is a
  // perfectly good upload of loose files into the destination folder.
  return file.webkitRelativePath || file.name;
}

async function uploadFolder(picked, folderId = null) {
  const documents = picked.filter(isUploadableFile);
  const ignored = picked.length - documents.length;

  if (documents.length === 0) {
    notify(
      `Nothing to upload — none of those ${picked.length} file(s) are markdown, Mermaid or notebook files.`,
      "warning"
    );
    return;
  }

  if (documents.length > MAX_FOLDER_UPLOAD_FILES) {
    notify(
      `That folder has ${documents.length} documents; the limit is ${MAX_FOLDER_UPLOAD_FILES}. Upload a subfolder instead.`,
      "error"
    );
    return;
  }

  const rootName = relativePathFor(documents[0]).split("/")[0] || "folder";
  notify(`Uploading ${documents.length} document(s) from "${rootName}"…`, "info");

  const formData = new FormData();
  for (const file of documents) {
    formData.append("files", file);
  }
  // Index-aligned with the files above, in the same order.
  formData.append("paths", JSON.stringify(documents.map(relativePathFor)));
  if (folderId) {
    formData.append("parentId", folderId);
  }

  try {
    const payload = await requestJson("/api/upload/folder", {
      method: "POST",
      body: formData
    });

    await refreshDocs({ preserveSearch: false });

    const parts = [`Uploaded ${payload.counts.uploaded} document(s)`];
    if (payload.counts.foldersCreated > 0) {
      parts.push(`created ${payload.counts.foldersCreated} folder(s)`);
    }
    if (ignored > 0) {
      parts.push(`skipped ${ignored} unsupported file(s)`);
    }
    if (payload.counts.skipped > 0) {
      parts.push(`${payload.counts.skipped} rejected`);
    }

    const renamed = payload.uploaded.filter((entry) => entry.renamedFrom);
    if (renamed.length > 0) {
      parts.push(`${renamed.length} renamed to avoid a clash`);
    }

    const adjustedFolders = payload.renamedFolders || [];
    if (adjustedFolders.length > 0) {
      // Say which, so a folder appearing under a different name is explained.
      parts.push(`${adjustedFolders.length} folder name(s) adjusted (${
        adjustedFolders.slice(0, 2).map((r) => `"${r.to}"`).join(", ")
      })`);
    }

    notify(`${parts.join(", ")}.`, "success");

    // Open the uploaded tree rather than leaving it collapsed out of sight.
    for (const folder of state.folders) {
      if (folder.name === rootName && !folder.parentId) {
        revealFolderInTree(folder.id);
        break;
      }
    }
  } catch (error) {
    notify(error.message, "error");
  }
}

async function saveEditorDocument() {
  const fileName = ensureDocFilename(elements.editorFileName.value.trim());
  const content = elements.editorInput.value;

  if (!fileName) {
    setStatus("File name is required.", "error");
    elements.editorFileName.focus();
    return;
  }

  try {
    let payload;
    if (state.editorMode === "edit" && state.editorFile) {
      // A changed name is a rename. Do it before the content write so the PUT
      // targets the new path and the folder assignment moves with the file.
      let targetFile = state.editorFile;
      if (fileName !== docName(state.editorFile)) {
        const renamed = await requestJson(`/api/docs/${docUrl(state.editorFile)}/rename`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ fileName })
        });

        targetFile = renamed.file;
        state.contentCache.delete(state.editorFile);
        state.editorFile = targetFile;
      }

      payload = await requestJson(`/api/docs/${docUrl(targetFile)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });
    } else {
      try {
        payload = await requestJson("/api/docs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fileName,
            content,
            overwrite: false,
            folderId: elements.editorFolderSelect?.value || null
          })
        });
      } catch (error) {
        const isConflict = normalize(error.message).includes("already exists");
        if (!isConflict) {
          throw error;
        }

        const shouldOverwrite = await requestConfirmation({
          title: "Replace existing markdown?",
          message: `${fileName} already exists. Replace its content with what is in the editor now?`,
          confirmLabel: "Replace File",
          tone: "primary"
        });

        if (!shouldOverwrite) {
          setStatus("Save cancelled. Pick a different file name or open the existing doc and edit it.", "neutral");
          return;
        }

        payload = await requestJson(`/api/docs/${docUrl(fileName)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ content })
        });
      }
    }

    closeEditor();
    await refreshDocs({ openFile: payload.file, preserveSearch: true });
    setStatus(`Saved ${payload.file}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function openEditorForCurrentDoc() {
  if (state.isRecycleBinMode) {
    setStatus("Restore a recycle bin document before editing.", "error");
    return;
  }

  if (!state.activeFile) {
    setStatus("Select a markdown first, then choose Edit.", "error");
    return;
  }

  if (isNotebookFile(state.activeFile)) {
    setStatus("Notebook files are view-only in this viewer.", "neutral");
    return;
  }

  try {
    await openEditorForDocument(state.activeFile);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function openEditorForDocument(file) {
  const doc = getDocByFile(file);
  if (!doc) {
    setStatus("Select a markdown first, then choose Edit.", "error");
    return;
  }

  if (state.isRecycleBinMode) {
    setStatus("Restore a recycle bin document before editing.", "error");
    return;
  }

  if (isNotebookFile(file)) {
    setStatus("Notebook files are view-only in this viewer.", "neutral");
    return;
  }

  const content = await loadDocContent(file);
  openEditor({
    mode: "edit",
    fileName: file,
    content
  });
}

async function deleteDocumentByFile(file, mode) {
  if (!file || state.isRecycleBinMode) {
    setStatus("Select a markdown to delete.", "error");
    return;
  }

  const shouldProceed = await requestConfirmation({
    title: mode === "hard" ? "Archive this markdown?" : "Move markdown to recycle bin?",
    message: mode === "hard"
      ? `${file} will be moved straight to the archive, skipping the recycle bin. It can still be restored from there.`
      : `${file} will be moved into the recycle bin and can be restored later.`,
    confirmLabel: mode === "hard" ? "Archive" : "Move To Bin",
    tone: mode === "hard" ? "danger" : "primary"
  });

  if (!shouldProceed) {
    setStatus("Delete cancelled.", "neutral");
    return;
  }

  try {
    const payload = await requestJson(`/api/docs/${docUrl(file)}/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode })
    });

    state.contentCache.delete(file);
    await refreshDocs({ preserveSearch: true });
    setStatus(payload.message || `${payload.originalFile} deleted.`, "success");
  } catch (error) {
    if (normalize(error.message).includes("request failed (404)")) {
      setStatus("Delete endpoint returned 404. Restart the server so the recycle-bin API routes are loaded.", "error");
      return;
    }

    setStatus(error.message, "error");
  }
}

async function restoreDeletedDocumentByFile(file) {
  if (!state.isRecycleBinMode || !file) {
    setStatus("Select a recycle bin markdown to restore.", "error");
    return;
  }

  try {
    const payload = await requestJson(`/api/recycle-bin/${docUrl(file)}/restore`, {
      method: "POST"
    });

    state.contentCache.delete(file);
    state.isRecycleBinMode = false;
    syncModeUI();
    resetJumpNavigation();
    await refreshDocs({ openFile: payload.file, preserveSearch: false });
    setStatus(`Restored ${payload.file} from recycle bin.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function restoreArchivedDocumentByFile(file) {
  if (state.viewMode !== "archive" || !file) {
    setStatus("Select an archived document to restore.", "error");
    return;
  }

  try {
    const payload = await requestJson(`/api/archive/${docUrl(file)}/restore`, {
      method: "POST"
    });

    state.contentCache.delete(file);
    state.viewMode = "docs";
    syncModeUI();
    resetJumpNavigation();
    await refreshDocs({ openFile: payload.file, preserveSearch: false });
    setStatus(`Restored ${payload.file} from the archive.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function permanentlyDeleteArchivedDocument(file) {
  if (state.viewMode !== "archive" || !file) {
    setStatus("Select an archived document to delete.", "error");
    return;
  }

  const doc = state.deletedDocs.find((candidate) => candidate.file === file);
  const originalFile = doc?.originalFile || file;

  const shouldProceed = await requestConfirmation({
    title: `Permanently delete ${originalFile}?`,
    message: "This erases the file from disk. It is the only action in this app that destroys data, and it cannot be undone.",
    confirmLabel: "Delete Forever",
    tone: "danger"
  });

  if (!shouldProceed) {
    setStatus("Permanent delete cancelled.", "neutral");
    return;
  }

  try {
    const payload = await requestJson(`/api/archive/${docUrl(file)}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      // The server requires the original name back before it will unlink.
      body: JSON.stringify({ confirmFile: originalFile })
    });

    state.contentCache.delete(file);

    if (state.activeFile === file) {
      state.activeFile = null;
    }

    await refreshDeletedDocs({ preserveSearch: true });
    setStatus(payload.message || `${originalFile} was permanently deleted.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function hardDeleteDeletedDocumentByFile(file) {
  if (!state.isRecycleBinMode || !file) {
    setStatus("Select a recycle bin markdown to archive.", "error");
    return;
  }

  const shouldProceed = await requestConfirmation({
    title: "Archive this markdown?",
    message: "The file stays on disk. It moves out of the recycle bin and into the archive, where it can still be restored or erased for good.",
    confirmLabel: "Archive",
    tone: "danger"
  });

  if (!shouldProceed) {
    setStatus("Archive cancelled.", "neutral");
    return;
  }

  try {
    const payload = await requestJson(`/api/recycle-bin/${docUrl(file)}/hard-delete`, {
      method: "POST"
    });

    state.contentCache.delete(file);
    await refreshDeletedDocs({ preserveSearch: true });
    setStatus(payload.message || `${payload.originalFile} moved to the archive.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function initialize() {
  setMeta("Loading documents...");

  // The address already names a document, so say which one before the first
  // request leaves. Session, library and content are three round trips, and
  // until this the viewer spent all three showing a generic wait — on a slow
  // connection, long enough to look like the link had failed.
  const wantedAtBoot = fileFromLocation();
  if (wantedAtBoot) {
    showLoadingState(`Opening ${wantedAtBoot}`, "Fetching this document from the library.");
  }

  mountMatchNavToViewportLayer();
  bindWheelZoomModifier();
  bindThemeToggle();
  MarkdownCore.configure({
    onWarning: (message) => notify(message, "error"),
    // Notebook cells get a Run button here but never on the share page: a
    // visitor following a link should not be offered one for code they did
    // not write.
    executableNotebooks: true
  });

  bindNotebookExecution();

  // Who we are decides what renders, so this has to settle before anything
  // tries to load a document.
  const session = await refreshSession();

  syncModeUI();
  updateActiveDocUI(null);
  updateJumpNavigationUI();
  syncSearchInputState(elements.searchInput.value);

  if (!session?.authenticated && !session?.publicReads) {
    setMeta("Sign in to browse this library.");
    showEmptyState("This library is private", "Sign in to browse the documents.", "ph-lock-simple");
    openLoginModal();
    return;
  }

  if (state.mustChangePassword) {
    setMeta("Set a new password to continue.");
    // Settles the panel behind the modal. Nothing further is being fetched, so
    // leaving the spinner turning would promise an arrival that is not coming.
    showEmptyState("Set a new password", "Choose a new password to finish signing in.", "ph-lock-simple");
    openPasswordModal({ forced: true });
    return;
  }

  try {
    // Read once, at the top, and reused here: it is what the loading state was
    // told to name, and the two must not be able to disagree.
    const wanted = wantedAtBoot;

    // An old /#Notes/day-one.md link still works, and becomes the real address
    // as soon as it lands rather than staying half in the fragment.
    if (wanted && window.location.hash) {
      showDocumentInUrl(wanted, { replace: true });
    }

    await refreshDocs({ openFile: wanted, preserveSearch: true });
  } catch (error) {
    console.error(error);
    setMeta("Failed to load documents");
    showEmptyState("Document loading failed", error.message, "ph-warning");
    setStatus(error.message, "error");
  }
}

function mountMatchNavToViewportLayer() {
  if (!elements.matchNav) {
    return;
  }

  // Keep controls pinned to viewport even when shell has visual effects.
  if (elements.matchNav.parentElement !== document.body) {
    document.body.appendChild(elements.matchNav);
  }
}

function handleSearchEvent(event) {
  const query = event.target.value;
  if (state.searchInputTimer) {
    window.clearTimeout(state.searchInputTimer);
  }

  state.searchInputTimer = window.setTimeout(() => {
    state.searchInputTimer = null;
    void applySearch(query);
  }, 160);
}

function exitSearchMode() {
  const hadQuery = Boolean(state.jumpQuery.trim() || elements.searchInput.value.trim());
  if (state.searchInputTimer) {
    window.clearTimeout(state.searchInputTimer);
    state.searchInputTimer = null;
  }

  elements.searchInput.value = "";
  void applySearch("");
  setSuperSearchOpen(false);

  if (hadQuery) {
    setStatus("Search mode closed.", "neutral");
  }
}

async function navigateMatches(direction, queryLabel = state.jumpQuery) {
  const result = await moveToAdjacentJumpMatch(direction);
  if (!result.found) {
    setStatus("No searchable matches for the current query.", "neutral");
    return result;
  }

  if (result.docChanged && result.file) {
    setStatus(`Moved to ${result.file}. Match ${result.index + 1} of ${result.total} for "${queryLabel}".`, "success");
    return result;
  }

  setStatus(`Match ${result.index + 1} of ${result.total} for "${queryLabel}".`, "success");
  return result;
}

// "input" already covers typing, pasting, and the clear button on a search field.
// "search" and "change" only re-fired the same debounced query, and the focus
// handler ran an undebounced full search every time the field was clicked.
elements.searchInput.addEventListener("input", handleSearchEvent);

elements.searchInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }

  const query = elements.searchInput.value.trim();
  if (!query) {
    return;
  }

  const canTraverseMatches = !state.isRecycleBinMode
    && state.activeFile
    && state.jumpQuery.trim().length > 0
    && normalize(query) === normalize(state.jumpQuery);

  if (canTraverseMatches) {
    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    await navigateMatches(direction, query);
    return;
  }

  if (state.searchResults.length > 0 && normalize(query) === normalize(state.searchResultsQuery)) {
    event.preventDefault();
    if (state.isRecycleBinMode) {
      await openRecycleBinDocument(state.searchResults[0].file);
    } else {
      await openDocument(state.searchResults[0].file, true, {
        jumpQuery: query,
        jumpTerms: buildJumpSearchTerms(query)
      });
    }

    closeSidebarOnMobile();
    setSuperSearchOpen(false);
  }
});

elements.clearFilterBtn?.addEventListener("click", () => {
  exitSearchMode();
  elements.searchInput.focus();
});

elements.matchPrevBtn.addEventListener("click", async () => {
  await navigateMatches(-1, state.jumpQuery);
});

elements.matchNextBtn.addEventListener("click", async () => {
  await navigateMatches(1, state.jumpQuery);
});

elements.matchCloseBtn.addEventListener("click", () => {
  exitSearchMode();
});

// Swipe left/right across the document to walk search matches on a phone.
//
// This was declared nowhere and set nowhere: the touchend handler below read
// `docSwipeStart` on every touch and threw a ReferenceError, so the feature had
// never once worked and it took the rest of the handler down with it. The
// linter is what finally surfaced it.
let docSwipeStart = null;

// Delegated: the document's markup is replaced wholesale every time one opens,
// and while editing in place the blocks are rebuilt under it as well.
elements.docContent.addEventListener("change", (event) => {
  const box = event.target?.closest?.('input[type="checkbox"][data-task-index]');
  if (box && !pageEditActive()) {
    void toggleTaskCheckbox(box);
  }
});

elements.docContent.addEventListener("touchstart", (event) => {
  // Only single-finger gestures; two fingers is a pinch-zoom, not a swipe.
  if (event.touches.length !== 1) {
    docSwipeStart = null;
    return;
  }

  const touch = event.touches[0];
  docSwipeStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

elements.docContent.addEventListener("touchend", (event) => {
  if (!docSwipeStart || event.changedTouches.length === 0 || !state.jumpQuery.trim()) {
    docSwipeStart = null;
    return;
  }

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - docSwipeStart.x;
  const deltaY = touch.clientY - docSwipeStart.y;
  docSwipeStart = null;

  const isHorizontalSwipe = Math.abs(deltaX) >= MATCH_SWIPE_THRESHOLD
    && Math.abs(deltaY) <= MATCH_SWIPE_VERTICAL_LIMIT
    && Math.abs(deltaX) > Math.abs(deltaY);

  if (!isHorizontalSwipe) {
    return;
  }

  const direction = deltaX < 0 ? 1 : -1;
  void navigateMatches(direction, state.jumpQuery);
}, { passive: true });

elements.docContent.addEventListener("touchcancel", () => {
  docSwipeStart = null;
}, { passive: true });

elements.clearSearchBtn.addEventListener("click", () => {
  exitSearchMode();
  elements.searchInput.focus();
});

// -- account menu -----------------------------------------------------------

function setAccountMenuOpen(open) {
  elements.accountMenu.hidden = !open;
  elements.accountBtn.setAttribute("aria-expanded", open ? "true" : "false");

  if (open) {
    elements.accountIdentity.textContent = state.user
      ? `${state.user.username} · ${state.user.role}`
      : "";
    elements.accountMenu.querySelector(".account-item:not([hidden])")?.focus();
  }
}

elements.accountBtn.addEventListener("click", (event) => {
  event.stopPropagation();

  if (!state.authenticated) {
    openLoginModal();
    return;
  }

  setAccountMenuOpen(elements.accountMenu.hidden);
});

document.addEventListener("click", (event) => {
  if (elements.accountMenu.hidden) {
    return;
  }

  if (!elements.accountMenu.contains(event.target) && !elements.accountBtn.contains(event.target)) {
    setAccountMenuOpen(false);
  }
});

elements.changePasswordItem.addEventListener("click", () => {
  setAccountMenuOpen(false);
  openPasswordModal();
});

elements.manageUsersItem.addEventListener("click", () => {
  setAccountMenuOpen(false);
  void openUsersModal();
});

elements.signOutItem.addEventListener("click", () => {
  setAccountMenuOpen(false);
  void signOut();
});

// -- login ------------------------------------------------------------------

elements.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitLogin();
});

// -- password ---------------------------------------------------------------

elements.passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitPasswordChange();
});

elements.passwordCancelBtn.addEventListener("click", () => {
  closePasswordModal();
});

elements.passwordBackdrop.addEventListener("click", () => {
  closePasswordModal();
});

// -- users ------------------------------------------------------------------

// -- sharing ----------------------------------------------------------------

elements.shareDocBtn.addEventListener("click", () => {
  if (state.activeFile) {
    openShareModal(state.activeFile);
  }
});

elements.shareCloseBtn.addEventListener("click", () => {
  closeShareModal();
});

elements.shareBackdrop.addEventListener("click", () => {
  closeShareModal();
});

elements.createShareBtn.addEventListener("click", () => {
  void createShareLink();
});

elements.revokeShareBtn.addEventListener("click", () => {
  void revokeShareLink();
});

elements.copyShareUrlBtn.addEventListener("click", async () => {
  elements.shareUrlInput.select();

  try {
    await navigator.clipboard.writeText(elements.shareUrlInput.value);
    notify("Share link copied.", "success");
  } catch {
    // Clipboard access needs a secure context and can be refused; the text is
    // already selected, so Ctrl+C still works.
    notify("Press Ctrl+C to copy the selected link.", "info");
  }
});

elements.closeUsersBtn.addEventListener("click", () => {
  closeUsersModal();
});

elements.usersBackdrop.addEventListener("click", () => {
  closeUsersModal();
});

elements.newUserForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitNewUser();
});

elements.createFolderBtn.addEventListener("click", () => {
  openFolderModal({ mode: "create" });
});

// Delegated so they survive every rebuild of the tree.
elements.docList.addEventListener("keydown", handleTreeKeydown);

// Clicking the empty space below the rows clears the selection, as it does in
// Explorer. Clicks that landed on a row are handled by the row itself.
elements.docList.addEventListener("mousedown", (event) => {
  if (event.target === elements.docList) {
    clearSelection();
  }
});

// Right-clicking the empty area offers the paste target for the top level.
elements.docList.addEventListener("contextmenu", (event) => {
  if (event.target !== elements.docList) {
    return;
  }

  event.preventDefault();

  // Creating is a write, so a viewer is left with the one entry that is not.
  const items = [];

  if (can("doc:write")) {
    items.push(
      {
        label: "New file",
        icon: "ph-file-plus",
        action: () => startNewDocument(null)
      },
      {
        label: "New folder",
        icon: "ph-folder-plus",
        action: () => openFolderModal({ mode: "create" })
      },
      {
        label: state.clipboard.files.length
          ? `Paste ${state.clipboard.files.length} file(s) into Ungrouped`
          : "Paste",
        icon: "ph-clipboard-text",
        disabled: state.clipboard.files.length === 0,
        action: () => void pasteIntoFolder(null)
      },
      { separator: true }
    );
  }

  items.push({
    label: "Select all",
    icon: "ph-check-square",
    action: () => setSelection(visibleFileOrder)
  });

  openContextMenu(event.clientX, event.clientY, items);
});

// A context menu must not survive the next interaction anywhere on the page.
window.addEventListener("mousedown", (event) => {
  if (elements.contextMenu && !elements.contextMenu.contains(event.target)) {
    closeContextMenu();
  }
});

window.addEventListener("blur", closeContextMenu);
window.addEventListener("resize", closeContextMenu);
document.addEventListener("scroll", closeContextMenu, true);

// The mobile drawer covers the header, so it needs its own way out.
elements.closeSidebarBtn?.addEventListener("click", () => {
  setNavOpen(false);
});

elements.collapseAllBtn?.addEventListener("click", () => {
  const groups = [...elements.docList.querySelectorAll(".tree-group")];
  const anyExpanded = groups.some((group) => !group.classList.contains("is-collapsed"));

  if (anyExpanded) {
    for (const group of groups) {
      state.collapsedFolderIds.add(group.dataset.folderKey);
    }
  } else {
    state.collapsedFolderIds.clear();
  }

  persistCollapsedFolders();
  elements.collapseAllBtn.setAttribute("aria-label", anyExpanded ? "Expand all folders" : "Collapse all folders");
  elements.collapseAllBtn.title = anyExpanded ? "Expand all folders" : "Collapse all folders";
  renderDocList();
});

elements.createFolderConfirmBtn.addEventListener("click", async () => {
  await handleFolderModalAction();
});

elements.closeFolderModalBtn.addEventListener("click", () => {
  closeFolderModal();
});

elements.folderBackdrop.addEventListener("click", () => {
  closeFolderModal();
});

elements.moveToRootBtn.addEventListener("click", async () => {
  if (state.folderModalMode === "upload") {
    const pending = state.pendingUploadFile;
    closeFolderModal();
    await uploadMarkdown(pending, null);
    return;
  }

  if (!state.folderModalTargetFile) {
    return;
  }

  try {
    await moveDocumentToFolder(state.folderModalTargetFile, null);
    closeFolderModal();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.folderNameInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  await handleFolderModalAction();
});

elements.refreshDocs.addEventListener("click", async () => {
  try {
    if (state.isRecycleBinMode) {
      await refreshDeletedDocs({ preserveSearch: true });
      setStatus(state.viewMode === "archive" ? "Archive refreshed." : "Recycle bin refreshed.", "success");
    } else {
      await refreshDocs({ preserveSearch: true });
      setStatus("Document list refreshed.", "success");
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
});

// Both trash-view toggles flip between their own mode and "docs", so they share one handler.
async function switchViewMode(targetMode) {
  // Leaving the documents view takes the document being edited off the screen,
  // so it has to ask the same question closing the editor would. Asked before
  // the modes are read, so what is written back cannot be based on a view that
  // moved on while the question was on screen.
  if (pageEditActive()) {
    const left = await cancelPageEdit({ restore: false });
    if (!left) {
      return;
    }
  }

  const previousMode = state.viewMode;
  const nextMode = previousMode === targetMode ? "docs" : targetMode;

  try {
    state.viewMode = nextMode;
    syncModeUI();
    resetJumpNavigation();

    if (nextMode === "docs") {
      await refreshDocs({ preserveSearch: false });
      setStatus("Returned to markdowns.", "neutral");
      return;
    }

    if (nextMode === "links") {
      await refreshLinks();
      setStatus("Saved links opened.", "success");
      return;
    }

    await refreshDeletedDocs({ preserveSearch: false });
    setStatus(nextMode === "archive" ? "Archive opened." : "Recycle bin opened.", "success");
  } catch (error) {
    // Rollback to a value captured before the await.
    // eslint-disable-next-line require-atomic-updates
    state.viewMode = previousMode;
    syncModeUI();
    setStatus(error.message, "error");
  }
}

elements.toggleRecycleBinBtn.addEventListener("click", () => {
  void switchViewMode("recycle");
});

elements.toggleArchiveBtn.addEventListener("click", () => {
  void switchViewMode("archive");
});

elements.toggleLinksBtn.addEventListener("click", () => {
  void switchViewMode("links");
});

elements.addLinkBtn.addEventListener("click", openLinkModal);
elements.closeLinkModalBtn.addEventListener("click", closeLinkModal);
elements.cancelLinkBtn.addEventListener("click", closeLinkModal);
elements.linkBackdrop.addEventListener("click", closeLinkModal);

elements.linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitLink();
});

elements.linkSearchInput.addEventListener("input", () => {
  state.linkFilter = elements.linkSearchInput.value;
  renderLinks();
});

elements.softDeleteDocBtn.addEventListener("click", () => {
  deleteCurrentDocument("soft");
});

elements.hardDeleteDocBtn.addEventListener("click", () => {
  if (state.viewMode === "archive") {
    void permanentlyDeleteArchivedDocument(state.activeFile);
    return;
  }

  if (state.isRecycleBinMode) {
    hardDeleteCurrentDeletedDocument();
    return;
  }

  deleteCurrentDocument("hard");
});

elements.restoreDocBtn.addEventListener("click", () => {
  if (state.viewMode === "archive") {
    void restoreArchivedDocumentByFile(state.activeFile);
    return;
  }

  restoreCurrentDeletedDocument();
});

elements.toggleSidebar.addEventListener("click", () => {
  setNavOpen(!elements.appShell.classList.contains("nav-open"));
});

elements.sidebarOverlay.addEventListener("click", () => {
  setNavOpen(false);
});

// "/" focuses search, the way it does in every other document browser. Ignored
// while typing so it never eats a literal slash.
window.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const target = event.target;
  const isTyping = target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

  if (isTyping || state.editorOpen || state.confirmOpen || state.folderModalOpen
    || state.loginOpen || state.passwordOpen || state.usersOpen || state.shareOpen) {
    return;
  }

  event.preventDefault();
  elements.searchInput.focus();
  elements.searchInput.select();
});

// Escape dismisses exactly one layer, topmost first. The nav used to be checked
// without a `return`, so a single press could close the sidebar and a modal and
// the search panel at once.
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  // The context menu floats above everything, so it closes first.
  if (elements.contextMenu && !elements.contextMenu.hidden) {
    event.preventDefault();
    closeContextMenu();
    return;
  }

  if (state.confirmOpen) {
    event.preventDefault();
    resolveConfirmDialog(false);
    return;
  }

  if (state.usersOpen) {
    event.preventDefault();
    closeUsersModal();
    return;
  }

  if (state.shareOpen) {
    event.preventDefault();
    closeShareModal();
    return;
  }

  if (state.linkModalOpen) {
    event.preventDefault();
    closeLinkModal();
    return;
  }

  // A forced password change and the sign-in wall are not dismissable: there is
  // nothing usable behind them.
  if (state.passwordOpen && !state.passwordForced) {
    event.preventDefault();
    closePasswordModal();
    return;
  }

  if (state.folderModalOpen) {
    event.preventDefault();
    closeFolderModal();
    return;
  }

  if (state.editorOpen) {
    event.preventDefault();
    void requestEditorClose();
    return;
  }

  if (state.searchPanelOpen) {
    event.preventDefault();
    setSuperSearchOpen(false);
    return;
  }

  if (elements.appShell.classList.contains("nav-open")) {
    event.preventDefault();
    setNavOpen(false);
    return;
  }

  // Last layer: drop the file selection and any pending cut.
  if (state.selection.size > 0 || state.clipboard.files.length > 0) {
    event.preventDefault();
    state.clipboard = { files: [], mode: null };
    clearSelection();
    updateSelectionUI();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!isEditorDirty() && !isPageEditDirty()) {
    return;
  }

  // Browsers show their own generic wording; returnValue just opts in.
  event.preventDefault();
  event.returnValue = "";
});

window.addEventListener("resize", () => {
  // The toolbar the edit bar sticks below wraps to two rows on a narrow window.
  if (pageEditActive()) {
    syncPageEditOffset();
  }

  if (window.innerWidth > MOBILE_BREAKPOINT && elements.appShell.classList.contains("nav-open")) {
    setNavOpen(false);
  }
});

function setUploadMenuOpen(open) {
  elements.uploadMenu.hidden = !open;
  elements.uploadTrigger.setAttribute("aria-expanded", open ? "true" : "false");

  if (open) {
    elements.uploadMenu.querySelector(".account-item")?.focus();
  }
}

elements.uploadTrigger.addEventListener("click", (event) => {
  event.stopPropagation();
  setUploadMenuOpen(elements.uploadMenu.hidden);
});

document.addEventListener("click", (event) => {
  if (elements.uploadMenu.hidden) {
    return;
  }

  if (!elements.uploadMenu.contains(event.target) && !elements.uploadTrigger.contains(event.target)) {
    setUploadMenuOpen(false);
  }
});

elements.uploadFilesItem.addEventListener("click", () => {
  setUploadMenuOpen(false);
  elements.uploadInput.click();
});

elements.uploadFolderItem.addEventListener("click", () => {
  setUploadMenuOpen(false);
  elements.uploadFolderInput.click();
});

elements.uploadFolderInput.addEventListener("change", () => {
  const picked = [...elements.uploadFolderInput.files];
  // Clearing lets the same folder be picked twice in a row; without it the
  // change event never fires the second time.
  elements.uploadFolderInput.value = "";

  if (picked.length > 0) {
    void uploadFolder(picked);
  }
});

elements.uploadInput.addEventListener("change", () => {
  const [file] = elements.uploadInput.files;
  if (!file) {
    return;
  }

  // With no folders there is nothing to choose, so skip straight to the upload.
  if (state.folders.length === 0) {
    void uploadMarkdown(file);
    return;
  }

  state.pendingUploadFile = file;
  openFolderModal({ mode: "upload" });
});

elements.newDocBtn.addEventListener("click", () => {
  startNewDocument(null);
});

elements.editDocBtn.addEventListener("click", () => {
  openEditorForCurrentDoc();
});

// The pencil edits the document where it is. The source editor is one button
// away from there, for when markdown is what you actually want to type.
elements.editCurrentDocBtn.addEventListener("click", () => {
  void startPageEdit();
});

elements.pageEditSaveBtn.addEventListener("click", () => {
  void savePageEdit();
});

elements.pageEditCancelBtn.addEventListener("click", () => {
  void cancelPageEdit();
});

elements.pageEditSourceBtn.addEventListener("click", () => {
  void openSourceFromPageEdit();
});

// Delegated, so the toolbar can grow without another listener each time.
elements.visualToolbar.addEventListener("mousedown", (event) => {
  // The selection in the contenteditable must survive the click, and focusing
  // a button destroys it.
  if (event.target.closest(".visual-tool")) {
    event.preventDefault();
  }
});

elements.visualToolbar.addEventListener("click", (event) => {
  const tool = event.target.closest(".visual-tool");
  if (!tool) {
    return;
  }

  if (tool.dataset.insert) {
    insertPageBlock(tool.dataset.insert);
  } else if (tool.dataset.block) {
    applyVisualBlockFormat(tool.dataset.block);
  } else if (tool.dataset.command) {
    applyVisualCommand(tool.dataset.command);
  }
});

// Picking a file rather than pasting one. The upload path is the same; only
// the way the file arrives differs.
elements.visualImageBtn.addEventListener("click", () => {
  if (!pageEditActive()) {
    return;
  }

  // The caret is remembered by the browser, and the picker is modal, so the
  // insertion point is still there when it closes.
  elements.imageInput.click();
});

elements.imageInput.addEventListener("change", () => {
  const files = [...(elements.imageInput.files || [])];
  // Cleared straight away, so picking the same file twice in a row still fires.
  elements.imageInput.value = "";

  if (files.length === 0 || !pageEditActive() || !can("doc:write")) {
    return;
  }

  const block = editableBlockFromSelection() || elements.docContent.querySelector('.ve-block[contenteditable="true"]');
  if (!block) {
    notify("Put the cursor in the text first.", "neutral");
    return;
  }

  // The picker took the selection with it when it opened.
  if (!editableBlockFromSelection()) {
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  void attachImagesToPage(files);
});

// The shortcuts people already have in their fingers. Ctrl+B and Ctrl+I are
// handled by contenteditable itself; Ctrl+K is not, and browsers would
// otherwise take it for the address bar.
elements.docContent.addEventListener("keydown", (event) => {
  if (!pageEditActive()) {
    return;
  }

  // Escape leaves editing, and asks first if there is anything to lose.
  if (event.key === "Escape") {
    event.preventDefault();
    void cancelPageEdit();
    return;
  }

  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    void savePageEdit();
    return;
  }

  if (event.key === "k" || event.key === "K") {
    event.preventDefault();
    applyVisualCommand("link");
  }
});

// Pasting rich text into a contenteditable brings the source site's markup
// with it — fonts, colours, spans, classes. Only the text is wanted; the
// formatting people are pasting is not the formatting this document uses.
elements.docContent.addEventListener("paste", (event) => {
  if (!pageEditActive() || !event.target.closest?.('[contenteditable="true"]')) {
    return;
  }

  // A screenshot on the clipboard is not text, and is the thing being pasted
  // rather than something alongside it.
  const images = imagesFromTransfer(event.clipboardData);
  if (images.length > 0 && can("doc:write")) {
    event.preventDefault();
    void attachImagesToPage(images);
    return;
  }

  const text = event.clipboardData?.getData("text/plain");
  if (typeof text !== "string") {
    return;
  }

  event.preventDefault();
  document.execCommand("insertText", false, text);
});

// Dropping a picture onto the page is the same act as pasting one. Without
// this the browser navigates away from the app to display the file.
elements.docContent.addEventListener("dragover", (event) => {
  if (pageEditActive() && imagesFromTransfer(event.dataTransfer).length > 0) {
    event.preventDefault();
  }
});

elements.docContent.addEventListener("drop", (event) => {
  if (!pageEditActive() || !can("doc:write")) {
    return;
  }

  const images = imagesFromTransfer(event.dataTransfer);
  if (images.length === 0) {
    return;
  }

  event.preventDefault();

  // Drop where it was dropped, not where the cursor happened to be.
  const at = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (at && at.startContainer?.parentElement?.closest?.('[contenteditable="true"]')) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(at);
  }

  void attachImagesToPage(images);
});

elements.editorTabWrite.addEventListener("click", () => selectEditorTab("write"));
elements.editorTabPreview.addEventListener("click", () => selectEditorTab("preview"));

// Arrow keys move between tabs, which is what a tablist is expected to do and
// the only way to reach the other tab from the keyboard once one is out of the
// tab order.
elements.editorTabs.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }

  event.preventDefault();
  const next = state.editorTab === "write" ? "preview" : "write";
  selectEditorTab(next);
  (next === "write" ? elements.editorTabWrite : elements.editorTabPreview).focus();
});

// Widening the window past the breakpoint has to put both panes back, or a
// pane stays hidden with no tab bar left to bring it back.
window.matchMedia?.(EDITOR_TABS_QUERY).addEventListener?.("change", syncEditorTabs);

elements.editorInput.addEventListener("input", () => {
  scheduleEditorPreview();
});

elements.editorInput.addEventListener("paste", (event) => {
  const images = imagesFromTransfer(event.clipboardData);
  if (images.length === 0 || !can("doc:write")) {
    return;
  }

  event.preventDefault();
  void attachImagesToSource(images);
});

elements.editorInput.addEventListener("dragover", (event) => {
  if (imagesFromTransfer(event.dataTransfer).length > 0) {
    event.preventDefault();
  }
});

elements.editorInput.addEventListener("drop", (event) => {
  const images = imagesFromTransfer(event.dataTransfer);
  if (images.length === 0 || !can("doc:write")) {
    return;
  }

  event.preventDefault();
  void attachImagesToSource(images);
});

elements.editorInput.addEventListener("scroll", () => {
  syncEditorPaneScroll(elements.editorInput, elements.editorPreview);
});

elements.editorPreview.addEventListener("scroll", () => {
  syncEditorPaneScroll(elements.editorPreview, elements.editorInput);
});

elements.saveDocBtn.addEventListener("click", () => {
  saveEditorDocument();
});

elements.closeEditorBtn.addEventListener("click", () => {
  void requestEditorClose();
});

elements.editorBackdrop.addEventListener("click", () => {
  void requestEditorClose();
});

elements.confirmBackdrop.addEventListener("click", () => {
  resolveConfirmDialog(false);
});

elements.confirmCancelBtn.addEventListener("click", () => {
  resolveConfirmDialog(false);
});

elements.confirmProceedBtn.addEventListener("click", () => {
  resolveConfirmDialog(true);
});

elements.dockOpenDocs.addEventListener("click", () => {
  setNavOpen(!elements.appShell.classList.contains("nav-open"));
});

elements.dockSearch.addEventListener("click", () => {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  elements.searchInput.focus();
  if (elements.searchInput.value.trim()) {
    applySearch(elements.searchInput.value);
  }
});

elements.dockUpload.addEventListener("click", () => {
  elements.uploadInput.click();
});

elements.dockNew.addEventListener("click", () => {
  openEditor({
    mode: "create",
    fileName: "",
    content: "# New Markdown\n\nStart writing here..."
  });
});

elements.dockEdit.addEventListener("click", () => {
  void startPageEdit();
});

// Back and forward. pushState does not fire this — only the buttons do — so
// this is where the browser's own navigation is honoured, and the false says
// "do not push what we are already standing on".
window.addEventListener("popstate", () => {
  const file = fileFromLocation();

  // Back is not an unload, so the beforeunload guard never sees it and unsaved
  // work would go without a word. The address moves back to where the screen
  // is rather than the screen following the address.
  if (isEditorDirty() || isPageEditDirty()) {
    showDocumentInUrl(state.activeFile, { replace: true });
    setStatus("Save or discard your changes before leaving this document.", "warning");
    return;
  }

  // Back as far as the library itself. The address says nothing is open, so
  // nothing should be — going forward again opens it once more.
  if (!file) {
    if (state.activeFile) {
      showNoDocumentOpen();
    }
    return;
  }

  if (file !== state.activeFile && state.docs.some((doc) => doc.file === file)) {
    void openDocument(file, false);
  }
});

// Anything still pointing at the old fragment form.
window.addEventListener("hashchange", () => {
  const file = fileFromLocation();
  if (file && file !== state.activeFile && state.docs.some((doc) => doc.file === file)) {
    void openDocument(file, true);
  }
});

document.addEventListener("click", (event) => {
  if (!state.searchPanelOpen) {
    return;
  }

  if (!(event.target instanceof Element)) {
    return;
  }

  if (elements.superSearchPanel.contains(event.target) || elements.searchWrap.contains(event.target)) {
    return;
  }

  setSuperSearchOpen(false);
});

/* --------------------------------------------------------------------------
   Tooltips

   Nearly every control in this app is icon-only, and native `title` tooltips
   are slow, unstyleable, and land in the wrong place. This adopts the existing
   `title` attributes rather than replacing them at ~40 call sites: on first
   hover the text is moved to `data-tip` (which also stops the native tooltip
   from ever appearing) and drawn in one body-level element, so a tooltip is
   never clipped by the sidebar's own scroll container.

   `aria-label` still carries the accessible name, so the tooltip itself is
   decorative and hidden from assistive tech.
   -------------------------------------------------------------------------- */

const TOOLTIP_GAP = 8;
const TOOLTIP_EDGE_PADDING = 8;

let tooltipElement = null;
let tooltipTarget = null;

function ensureTooltipElement() {
  if (tooltipElement) {
    return tooltipElement;
  }

  tooltipElement = document.createElement("div");
  tooltipElement.className = "tooltip";
  tooltipElement.setAttribute("aria-hidden", "true");
  tooltipElement.hidden = true;
  document.body.appendChild(tooltipElement);
  return tooltipElement;
}

function tooltipTextFor(element) {
  // A freshly-assigned .title wins: dynamic labels ("Archive" -> "Exit
  // archive") are rewritten by the code that owns them.
  const native = element.getAttribute("title");
  if (native) {
    element.dataset.tip = native;
    element.removeAttribute("title");
  }

  return element.dataset.tip || "";
}

function hideTooltip() {
  tooltipTarget = null;
  if (tooltipElement) {
    tooltipElement.hidden = true;
    tooltipElement.classList.remove("is-above");
  }
}

function showTooltip(element) {
  const text = tooltipTextFor(element);
  if (!text) {
    hideTooltip();
    return;
  }

  const tip = ensureTooltipElement();
  tooltipTarget = element;
  tip.textContent = text;
  tip.hidden = false;

  const anchor = element.getBoundingClientRect();
  const box = tip.getBoundingClientRect();

  // Below by default, above when the bottom of the window is in the way.
  const above = anchor.bottom + TOOLTIP_GAP + box.height > window.innerHeight;
  const top = above
    ? anchor.top - box.height - TOOLTIP_GAP
    : anchor.bottom + TOOLTIP_GAP;

  const maxLeft = window.innerWidth - box.width - TOOLTIP_EDGE_PADDING;
  const left = Math.min(
    Math.max(anchor.left + (anchor.width - box.width) / 2, TOOLTIP_EDGE_PADDING),
    Math.max(maxLeft, TOOLTIP_EDGE_PADDING)
  );

  tip.classList.toggle("is-above", above);
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
}

function bindTooltips() {
  document.addEventListener("pointerover", (event) => {
    // Touch has no hover state, and a tooltip there just covers what was
    // tapped. The mobile dock carries visible text labels instead.
    if (event.pointerType === "touch" || !(event.target instanceof Element)) {
      return;
    }

    const element = event.target.closest("[title], [data-tip]");
    if (!element || element === tooltipTarget) {
      if (!element) {
        hideTooltip();
      }
      return;
    }

    showTooltip(element);
  });

  document.addEventListener("pointerout", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    // relatedTarget null means the pointer left the window entirely.
    const next = event.relatedTarget;
    if (tooltipTarget && (!next || !tooltipTarget.contains(next))) {
      hideTooltip();
    }
  });

  document.addEventListener("focusin", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const element = event.target.closest("[title], [data-tip]");
    if (element && element.matches(":focus-visible")) {
      showTooltip(element);
    } else {
      hideTooltip();
    }
  });

  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("click", hideTooltip);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideTooltip();
    }
  });
  // The anchor moves out from under a tooltip on any scroll, including the
  // sidebar's own, so listen in the capture phase to catch every scroller.
  document.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);
}

bindTooltips();
initialize();
