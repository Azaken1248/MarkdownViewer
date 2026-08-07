const elements = {
  appShell: document.getElementById("appShell"),
  toggleSidebar: document.getElementById("toggleSidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  sidebarTitle: document.getElementById("sidebarTitle"),
  refreshDocs: document.getElementById("refreshDocs"),
  toggleRecycleBinBtn: document.getElementById("toggleRecycleBinBtn"),
  toggleArchiveBtn: document.getElementById("toggleArchiveBtn"),
  uploadTrigger: document.getElementById("uploadTrigger"),
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
  editorModal: document.getElementById("editorModal"),
  editorBackdrop: document.getElementById("editorBackdrop"),
  closeEditorBtn: document.getElementById("closeEditorBtn"),
  saveDocBtn: document.getElementById("saveDocBtn"),
  editorFileName: document.getElementById("editorFileName"),
  editorFolderField: document.getElementById("editorFolderField"),
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
  lockToggleBtn: document.getElementById("lockToggleBtn"),
  unlockModal: document.getElementById("unlockModal"),
  unlockBackdrop: document.getElementById("unlockBackdrop"),
  unlockTokenInput: document.getElementById("unlockTokenInput"),
  unlockCancelBtn: document.getElementById("unlockCancelBtn"),
  unlockConfirmBtn: document.getElementById("unlockConfirmBtn"),
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

  // "docs" | "recycle" | "archive". Most code only cares whether we are
  // browsing deleted documents (read-only), which both non-docs modes are, so
  // isRecycleBinMode stays available as a derived accessor.
  viewMode: "docs",

  get isRecycleBinMode() {
    return this.viewMode !== "docs";
  },

  set isRecycleBinMode(value) {
    this.viewMode = value ? "recycle" : "docs";
  },

  filteredDocs: [],
  contentCache: new Map(),
  activeFile: null,
  editorMode: "create",
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
  writeToken: "",
  canWrite: false,
  unlockOpen: false
};

const WRITE_TOKEN_STORAGE_KEY = "mdviewer.writeToken";

function readStoredWriteToken() {
  try {
    return window.localStorage.getItem(WRITE_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function persistWriteToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(WRITE_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(WRITE_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in private mode; the token still works for
    // this page session via state.writeToken.
  }
}

const MOBILE_BREAKPOINT = 920;
const SUPERSEARCH_LIMIT = 8;
// Each "Show more" click in the results panel reveals this many further rows.
const SUPERSEARCH_PAGE_SIZE = 12;
// How many document rows each folder group renders before offering "show more".
const DOC_LIST_PAGE_SIZE = 50;
const MATCH_SWIPE_THRESHOLD = 56;
const MATCH_SWIPE_VERTICAL_LIMIT = 42;
const SANITIZE_ALLOWED_URI_PATTERN = /^(?:(?:(?:f|ht)tps?|mailto|tel):|data:image\/(?:bmp|gif|jpe?g|png|svg\+xml|webp|avif)(?:;charset=[^;,]+)?(?:;base64)?,|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;
const MARKDOWN_SANITIZE_OPTIONS = {
  ALLOWED_URI_REGEXP: SANITIZE_ALLOWED_URI_PATTERN,
  ADD_DATA_URI_TAGS: ["img"]
};
const CODE_LANGUAGE_ALIAS = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  html: "xml"
};

marked.setOptions({
  gfm: true,
  breaks: false,
  mangle: false,
  headerIds: true,
  langPrefix: "language-"
});

function filenameToTitle(filename) {
  return stripDocumentExtension(filename)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDocumentExtension(filename) {
  return String(filename || "").replace(/\.(md|markdown|mmd|mermaid|ipynb)$/i, "");
}

function isNotebookFile(fileName) {
  return /\.ipynb$/i.test(String(fileName || ""));
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return window.btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = window.atob(String(value || ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeMatrixEnvironments(tex) {
  const source = String(tex || "");
  const matrixEnvironmentPattern = /\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}/g;

  return source.replace(matrixEnvironmentPattern, (match, environmentName, body) => {
    if (body.includes("\\\\")) {
      return match;
    }

    const rows = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/\\+\s*$/, "").trim())
      .filter((line) => line.length > 0);

    if (rows.length <= 1) {
      return match;
    }

    return `\\begin{${environmentName}}\n${rows.join(" \\\\ \n")}\n\\end{${environmentName}}`;
  });
}

function normalizeMarkdownMath(markdown) {
  const source = String(markdown || "");
  if (!source.includes("[") && !source.includes("]") && !source.includes("\\[") && !source.includes("$$")) {
    return source;
  }

  const lines = source.split(/\r?\n/);
  const normalizedLines = [];
  let inCodeFence = false;
  let codeFenceMarker = "";
  let inDisplayMathBlock = false;
  let displayMathMode = "";
  let displayMathLines = [];

  const flushDisplayMathBlock = () => {
    const tex = normalizeMatrixEnvironments(displayMathLines.join("\n").trim());
    if (tex) {
      normalizedLines.push(`<div class="math-block" data-math-tex="${encodeBase64Utf8(tex)}"></div>`);
    }

    displayMathLines = [];
    inDisplayMathBlock = false;
    displayMathMode = "";
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = marker;
      } else if (marker === codeFenceMarker) {
        inCodeFence = false;
        codeFenceMarker = "";
      }

      normalizedLines.push(line);
      continue;
    }

    if (!inCodeFence) {
      const trimmed = line.trim();
      if (!inDisplayMathBlock && (trimmed === "[" || trimmed === "\\[" || trimmed === "$$")) {
        inDisplayMathBlock = true;
        displayMathMode = trimmed;
        displayMathLines = [];
        continue;
      }

      if (inDisplayMathBlock) {
        const isClosingBracket = (displayMathMode === "[" || displayMathMode === "\\[") && (trimmed === "]" || trimmed === "\\]");
        const isClosingDollar = displayMathMode === "$$" && trimmed === "$$";

        if (isClosingBracket || isClosingDollar) {
          flushDisplayMathBlock();
          continue;
        }

        displayMathLines.push(line);
        continue;
      }
    }

    normalizedLines.push(line);
  }

  if (inDisplayMathBlock && displayMathLines.length > 0) {
    normalizedLines.push(...displayMathLines);
  }

  return normalizedLines.join("\n");
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
    list.sort((left, right) => (left.order - right.order) || left.name.localeCompare(right.name));
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

// Swaps a folder with its neighbour and persists the whole ordering, so the
// server never has to infer intent from a single index.
// Order is scoped to a sibling group now, so only the folder's own siblings are
// reordered — moving a child never disturbs folders at another level.
async function moveFolderBy(folderId, offset) {
  const folder = getFolderRecord(folderId);
  if (!folder) {
    return;
  }

  const siblings = state.folders
    .filter((entry) => (entry.parentId || null) === (folder.parentId || null))
    .sort((left, right) => (left.order - right.order) || left.name.localeCompare(right.name));

  const index = siblings.findIndex((entry) => entry.id === folderId);
  const target = index + offset;

  if (index < 0 || target < 0 || target >= siblings.length) {
    return;
  }

  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];

  try {
    await requestJson("/api/folders/reorder", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ folderIds: siblings.map((entry) => entry.id) })
    });

    await refreshDocs({ preserveSearch: true });
    notify(`Moved "${folder.name}" ${offset < 0 ? "up" : "down"}.`, "success");
  } catch (error) {
    notify(error.message, "error");
  }
}

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

function toggleFolderCollapse(folderKey) {
  if (!folderKey) {
    return;
  }

  if (state.collapsedFolderIds.has(folderKey)) {
    state.collapsedFolderIds.delete(folderKey);
  } else {
    state.collapsedFolderIds.add(folderKey);
  }

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
  const shouldLock = elements.appShell.classList.contains("nav-open") || state.editorOpen || state.confirmOpen || state.folderModalOpen || state.unlockOpen;
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
    state.mermaidReady = false;
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

  state.mermaidReady = false;

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
  return /\.(mmd|mermaid)$/i.test(String(fileName || ""));
}

function toMermaidMarkdown(diagramSource) {
  return `\n\
\`\`\`mermaid
${String(diagramSource || "")}
\`\`\`
`;
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

function updateActiveDocUI(fileName) {
  if (!fileName) {
    setViewerHeading("ph-file-text", "No file selected", []);
    elements.editDocBtn.disabled = true;
    elements.editCurrentDocBtn.disabled = true;
    elements.dockEdit.disabled = true;
    elements.softDeleteDocBtn.disabled = true;
    elements.hardDeleteDocBtn.disabled = true;
    elements.restoreDocBtn.disabled = true;
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
    return;
  }

  const notebookFile = isNotebookFile(fileName);
  const doc = getDocByFile(fileName);
  // The folder is in the breadcrumb trail now, so it is not repeated here.
  setViewerHeading(notebookFile ? "ph-file-code" : "ph-file-text", fileName, [
    doc ? formatBytes(doc.size) : "",
    doc?.updatedAt ? `updated ${formatDate(doc.updatedAt)}` : ""
  ], doc?.folderId || null);
  elements.editDocBtn.disabled = notebookFile;
  elements.editCurrentDocBtn.disabled = notebookFile;
  elements.dockEdit.disabled = notebookFile;
  elements.softDeleteDocBtn.disabled = false;
  elements.hardDeleteDocBtn.disabled = false;
  elements.restoreDocBtn.disabled = true;
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

async function requestJson(url, options = {}) {
  const requestOptions = { ...options };

  if (state.writeToken) {
    requestOptions.headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${state.writeToken}`
    };
  }

  const response = await fetch(url, requestOptions);
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    // The stored token is missing or no longer valid (the server generates a
    // fresh one on restart unless MDVIEWER_TOKEN is set).
    setWriteAccess(false);
    throw new Error(payload?.error || "Editing is locked. Unlock editing to continue.");
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload;
}

function syncLockUI() {
  if (!elements.lockToggleBtn) {
    return;
  }

  const icon = elements.lockToggleBtn.querySelector("i");
  if (icon) {
    icon.className = state.canWrite ? "ph ph-lock-simple-open" : "ph ph-lock-simple";
  }

  elements.lockToggleBtn.classList.toggle("active", state.canWrite);
  const label = state.canWrite ? "Lock editing" : "Unlock editing";
  elements.lockToggleBtn.setAttribute("aria-label", label);
  elements.lockToggleBtn.title = state.canWrite ? "Editing unlocked - click to lock" : "Unlock editing";
}

function setWriteAccess(canWrite, { token = null } = {}) {
  state.canWrite = Boolean(canWrite);

  if (!state.canWrite) {
    state.writeToken = "";
    persistWriteToken("");
  } else if (token) {
    state.writeToken = token;
    persistWriteToken(token);
  }

  syncLockUI();
}

async function verifyWriteToken(token) {
  const response = await fetch("/api/session", {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (!response.ok) {
    return false;
  }

  const payload = await response.json().catch(() => null);
  return Boolean(payload?.canWrite);
}

async function restoreWriteSession() {
  const storedToken = readStoredWriteToken();
  if (!storedToken) {
    setWriteAccess(false);
    return;
  }

  try {
    const isValid = await verifyWriteToken(storedToken);
    if (isValid) {
      state.writeToken = storedToken;
      setWriteAccess(true, { token: storedToken });
      return;
    }
  } catch {
    // Network trouble - treat as locked rather than assuming access.
  }

  setWriteAccess(false);
}

function openUnlockModal() {
  state.unlockOpen = true;
  elements.unlockTokenInput.value = "";
  elements.unlockModal.classList.add("open");
  elements.unlockModal.setAttribute("aria-hidden", "false");
  enterModalLayer(elements.unlockModal);
  syncBodyLock();
  window.requestAnimationFrame(() => elements.unlockTokenInput.focus());
}

function closeUnlockModal() {
  state.unlockOpen = false;
  elements.unlockTokenInput.value = "";
  elements.unlockModal.classList.remove("open");
  elements.unlockModal.setAttribute("aria-hidden", "true");
  exitModalLayer(elements.unlockModal);
  syncBodyLock();
}

async function submitUnlock() {
  const token = String(elements.unlockTokenInput.value || "").trim();
  if (!token) {
    setStatus("Enter the editor token to unlock editing.", "error");
    elements.unlockTokenInput.focus();
    return;
  }

  try {
    const isValid = await verifyWriteToken(token);
    if (!isValid) {
      setStatus("That token was not accepted.", "error");
      elements.unlockTokenInput.select();
      return;
    }

    setWriteAccess(true, { token });
    closeUnlockModal();
    setStatus("Editing unlocked.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function handleLockToggle() {
  if (state.canWrite) {
    setWriteAccess(false);
    setStatus("Editing locked.", "neutral");
    return;
  }

  openUnlockModal();
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

  const payload = await requestJson(`/api/docs/${encodeURIComponent(file)}`, { cache: "no-store" });
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
  const inTrashView = inRecycleBin || inArchive;

  elements.sidebarTitle.textContent = inArchive ? "Archive" : inRecycleBin ? "Recycle bin" : "Files";

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

function renderMarkdown(markdown) {
  const normalizedMarkdown = normalizeMarkdownMath(markdown);
  const unsafeHtml = marked.parse(normalizedMarkdown);
  return DOMPurify.sanitize(unsafeHtml, MARKDOWN_SANITIZE_OPTIONS);
}

function renderMathBlocks(root) {
  if (!root) {
    return;
  }

  if (window.katex) {
    const blockNodes = root.querySelectorAll(".math-block[data-math-tex]");
    for (const node of blockNodes) {
      const tex = decodeBase64Utf8(node.getAttribute("data-math-tex") || "");

      try {
        window.katex.render(tex, node, {
          displayMode: true,
          throwOnError: false,
          errorColor: "#eb9b96"
        });
      } catch (error) {
        console.error("Math block rendering failed", error);
        node.textContent = tex;
      }
    }
  }

  if (!window.renderMathInElement) {
    return;
  }

  try {
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "svg"],
      processEscapes: true,
      throwOnError: false,
      errorColor: "#eb9b96"
    });
  } catch (error) {
    console.error("Math rendering failed", error);
  }
}

function waitForNextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function normalizeNotebookText(value) {
  if (Array.isArray(value)) {
    return value.join("");
  }

  if (value == null) {
    return "";
  }

  return String(value);
}

function inferNotebookLanguage(notebook) {
  const rawLanguage = normalize(
    notebook?.metadata?.language_info?.name
      || notebook?.metadata?.language_info?.codemirror_mode?.name
      || notebook?.metadata?.kernelspec?.language
      || "python"
  ).trim();

  if (!rawLanguage) {
    return "python";
  }

  if (rawLanguage.startsWith("python")) {
    return "python";
  }

  return CODE_LANGUAGE_ALIAS[rawLanguage] || rawLanguage;
}

function getNotebookImageSource(mimeType, payload) {
  const source = normalizeNotebookText(payload).trim();

  if (mimeType === "image/svg+xml") {
    const compactSource = source.replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/=]+$/.test(compactSource)) {
      return `data:image/svg+xml;base64,${compactSource}`;
    }

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  }

  return `data:${mimeType};base64,${source.replace(/\s+/g, "")}`;
}

function renderNotebookMimePayload(mimeType, payload) {
  const text = normalizeNotebookText(payload);

  switch (mimeType) {
    case "text/html":
      return `<div class="notebook-output-html">${DOMPurify.sanitize(text, MARKDOWN_SANITIZE_OPTIONS)}</div>`;
    case "image/svg+xml":
    case "image/png":
    case "image/jpeg":
    case "image/gif":
    case "image/webp":
    case "image/avif":
      return `<figure class="notebook-output notebook-output-image"><img src="${escapeHtml(getNotebookImageSource(mimeType, text))}" alt="Notebook output image" loading="lazy" /></figure>`;
    case "text/markdown":
      return `<div class="notebook-output-markdown">${renderMarkdown(text)}</div>`;
    case "application/json": {
      let formattedText = text;

      try {
        formattedText = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        formattedText = text;
      }

      return `<pre class="notebook-output-json">${escapeHtml(formattedText)}</pre>`;
    }
    case "text/plain":
    default:
      return `<pre class="notebook-output-text">${escapeHtml(text)}</pre>`;
  }
}

function renderNotebookOutput(output) {
  const outputType = String(output?.output_type || "").toLowerCase();

  if (outputType === "stream") {
    const streamName = escapeHtml(String(output?.name || "stream"));
    const streamText = escapeHtml(normalizeNotebookText(output?.text));
    return `
      <section class="notebook-output notebook-output-stream">
        <div class="notebook-output-label">${streamName}</div>
        <pre class="notebook-output-text">${streamText}</pre>
      </section>
    `;
  }

  if (outputType === "error") {
    const errorName = escapeHtml(String(output?.ename || "Error"));
    const errorValue = escapeHtml(String(output?.evalue || ""));
    const traceback = Array.isArray(output?.traceback)
      ? output.traceback.map((line) => normalizeNotebookText(line)).join("\n")
      : `${normalizeNotebookText(output?.ename)}: ${normalizeNotebookText(output?.evalue)}`;

    return `
      <section class="notebook-output notebook-output-error">
        <div class="notebook-output-label">Error</div>
        <div class="notebook-output-error-name">${errorName}</div>
        <div class="notebook-output-error-value">${errorValue}</div>
        <pre class="notebook-output-text">${escapeHtml(traceback)}</pre>
      </section>
    `;
  }

  const data = output?.data || {};
  const mimeOrder = [
    "text/html",
    "image/svg+xml",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "text/markdown",
    "application/json",
    "text/plain"
  ];

  for (const mimeType of mimeOrder) {
    if (data[mimeType] != null) {
      const mimeClass = mimeType.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
      return `<section class="notebook-output notebook-output-${mimeClass}">${renderNotebookMimePayload(mimeType, data[mimeType])}</section>`;
    }
  }

  return "";
}

function renderNotebookCell(cell, index, notebookLanguage) {
  const cellType = normalize(cell?.cell_type || "").trim();
  const cellNumber = index + 1;
  const source = normalizeNotebookText(cell?.source);

  if (cellType === "markdown") {
    return `
      <section class="notebook-cell notebook-cell-markdown">
        <div class="notebook-cell-head">
          <span class="notebook-cell-badge">Markdown</span>
          <span class="notebook-cell-index">Cell ${cellNumber}</span>
        </div>
        <div class="notebook-cell-content">
          ${renderMarkdown(source)}
        </div>
      </section>
    `;
  }

  if (cellType === "code") {
    const executionCount = Number.isFinite(Number(cell?.execution_count))
      ? Number(cell.execution_count)
      : null;
    const outputHtml = Array.isArray(cell?.outputs)
      ? cell.outputs.map((output) => renderNotebookOutput(output)).filter(Boolean).join("")
      : "";

    return `
      <section class="notebook-cell notebook-cell-code">
        <div class="notebook-cell-head">
          <span class="notebook-cell-badge">Code</span>
          <span class="notebook-cell-index">${executionCount != null ? `In [${executionCount}]` : `Cell ${cellNumber}`}</span>
        </div>
        <div class="notebook-cell-content">
          <pre class="notebook-code-block"><code class="language-${escapeHtml(notebookLanguage)}">${escapeHtml(source)}</code></pre>
          ${outputHtml ? `<div class="notebook-outputs">${outputHtml}</div>` : ""}
        </div>
      </section>
    `;
  }

  return `
    <section class="notebook-cell notebook-cell-raw">
      <div class="notebook-cell-head">
        <span class="notebook-cell-badge">Raw</span>
        <span class="notebook-cell-index">Cell ${cellNumber}</span>
      </div>
      <div class="notebook-cell-content">
        <pre class="notebook-raw-block">${escapeHtml(source)}</pre>
      </div>
    </section>
  `;
}

function renderNotebookDocument(rawContent, title) {
  const notebook = JSON.parse(String(rawContent || "").replace(/^\uFEFF/, ""));
  const cells = Array.isArray(notebook?.cells) ? notebook.cells : null;

  if (!cells) {
    throw new Error("Invalid notebook file");
  }

  const notebookLanguage = inferNotebookLanguage(notebook);
  const cellCounts = cells.reduce((counts, cell) => {
    const type = normalize(cell?.cell_type || "").trim();
    if (type === "markdown") {
      counts.markdown += 1;
    } else if (type === "code") {
      counts.code += 1;
    } else if (type === "raw") {
      counts.raw += 1;
    }

    return counts;
  }, { markdown: 0, code: 0, raw: 0 });

  const totalCells = cells.length;
  const renderedCells = cells.map((cell, index) => renderNotebookCell(cell, index, notebookLanguage)).join("");

  return `
    <section class="notebook-summary">
      <p class="notebook-eyebrow"><i class="ph ph-file-code"></i> Jupyter Notebook</p>
      <h1>${escapeHtml(title || notebook?.metadata?.title || "Notebook")}</h1>
      <p class="notebook-meta">
        ${totalCells} cell${totalCells === 1 ? "" : "s"}
        · ${cellCounts.markdown} markdown
        · ${cellCounts.code} code
        ${cellCounts.raw ? `· ${cellCounts.raw} raw` : ""}
      </p>
    </section>
    <section class="notebook-cells">
      ${renderedCells || '<p class="notebook-empty">This notebook has no cells.</p>'}
    </section>
  `;
}

function renderDocumentContent(fileName, rawContent, title) {
  if (isNotebookFile(fileName)) {
    return renderNotebookDocument(rawContent, title);
  }

  const renderedSource = isDiagramFile(fileName)
    ? toMermaidMarkdown(rawContent)
    : rawContent;

  return renderMarkdown(renderedSource);
}

// Mermaid bakes hex colours into the SVG it emits, so it cannot read the CSS
// custom properties the rest of the app themes with. These two tables are the
// diagram-side mirror of the light and dark token sets in app.css; if a token
// there changes, change its counterpart here.
const DIAGRAM_PALETTES = {
  dark: {
    themeVariables: {
      background: "#0c1214",
      mainBkg: "#1c262a",
      primaryColor: "#1c262a",
      primaryTextColor: "#dce7e5",
      primaryBorderColor: "#3f8d84",
      secondaryColor: "#253238",
      secondaryTextColor: "#dce7e5",
      secondaryBorderColor: "#2e3d42",
      tertiaryColor: "#0a1013",
      tertiaryTextColor: "#dce7e5",
      tertiaryBorderColor: "#2e3d42",
      lineColor: "#86a09d",
      textColor: "#dce7e5",
      nodeBorder: "#3f8d84",
      nodeTextColor: "#dce7e5",
      clusterBkg: "#0a1013",
      clusterBorder: "#2e3d42",
      edgeLabelBackground: "#0c1214",
      labelBoxBkgColor: "#1c262a",
      labelBoxBorderColor: "#2e3d42",
      labelTextColor: "#dce7e5",
      titleColor: "#dce7e5",
      actorBkg: "#1c262a",
      actorBorder: "#3f8d84",
      actorTextColor: "#dce7e5",
      actorLineColor: "#86a09d",
      signalColor: "#86a09d",
      signalTextColor: "#dce7e5",
      loopTextColor: "#dce7e5",
      noteBkgColor: "#253238",
      noteTextColor: "#dce7e5",
      noteBorderColor: "#2e3d42",
      attributeBackgroundColorOdd: "#0c1214",
      attributeBackgroundColorEven: "#1c262a",
      altBackground: "#0a1013"
    },
    // Fills the base theme emits that have to be corrected on this background.
    strayFills: ["#ffffff", "white", "#ECECFF"]
  },
  light: {
    themeVariables: {
      background: "#ffffff",
      mainBkg: "#eef4f2",
      primaryColor: "#eef4f2",
      primaryTextColor: "#101b1a",
      primaryBorderColor: "#10635a",
      secondaryColor: "#dcece9",
      secondaryTextColor: "#101b1a",
      secondaryBorderColor: "#a6b9b5",
      tertiaryColor: "#f4f8f7",
      tertiaryTextColor: "#101b1a",
      tertiaryBorderColor: "#a6b9b5",
      lineColor: "#465956",
      textColor: "#101b1a",
      nodeBorder: "#10635a",
      nodeTextColor: "#101b1a",
      clusterBkg: "#f4f8f7",
      clusterBorder: "#a6b9b5",
      edgeLabelBackground: "#ffffff",
      labelBoxBkgColor: "#eef4f2",
      labelBoxBorderColor: "#a6b9b5",
      labelTextColor: "#101b1a",
      titleColor: "#101b1a",
      actorBkg: "#eef4f2",
      actorBorder: "#10635a",
      actorTextColor: "#101b1a",
      actorLineColor: "#465956",
      signalColor: "#465956",
      signalTextColor: "#101b1a",
      loopTextColor: "#101b1a",
      noteBkgColor: "#dcece9",
      noteTextColor: "#101b1a",
      noteBorderColor: "#a6b9b5",
      attributeBackgroundColorOdd: "#ffffff",
      attributeBackgroundColorEven: "#eef4f2",
      altBackground: "#f4f8f7"
    },
    // On white, the base theme's own light fills are fine; the lavender is not.
    strayFills: ["#ECECFF"]
  }
};

function buildDiagramThemeCss(palette) {
  const vars = palette.themeVariables;
  const strayShapes = palette.strayFills
    .flatMap((fill) => ["rect", "polygon", "circle", "ellipse"].map((shape) => `${shape}[fill="${fill}"]`))
    .join(", ");

  return `
      /* Only the gaps the base theme leaves. Crucially not a blanket rule on
         <path>: that fills edge lines and turns every connector into a solid
         blob. */
      text,
      tspan {
        fill: ${vars.textColor};
      }

      .nodeLabel,
      .edgeLabel,
      .label,
      foreignObject div,
      foreignObject span {
        color: ${vars.textColor} !important;
      }

      /* Edge labels ship with their own plate behind them. */
      .edgeLabel rect,
      .labelBkg,
      rect.background {
        fill: ${vars.edgeLabelBackground} !important;
        opacity: 1 !important;
      }

      .er.entityBox,
      .entityBox {
        fill: ${vars.mainBkg};
        stroke: ${vars.nodeBorder};
      }

      .relationshipLine,
      .messageLine0,
      .messageLine1 {
        stroke: ${vars.lineColor};
        fill: none;
      }

      /* Stray fills the base theme still emits, without touching edges. */
      ${strayShapes} {
        fill: ${vars.mainBkg} !important;
      }
    `;
}

function ensureMermaidInitialized() {
  if (!window.mermaid) {
    return;
  }

  // Re-initialize when the theme has moved on, not only when nothing has been
  // initialized yet — otherwise a stale palette survives a theme change.
  const theme = activeThemeName();
  if (state.mermaidReady && state.mermaidTheme === theme) {
    return;
  }

  const palette = DIAGRAM_PALETTES[theme] || DIAGRAM_PALETTES.dark;

  window.mermaid.initialize({
    startOnLoad: false,
    // "antiscript" runs DOMPurify over diagram labels and blocks javascript:
    // click directives, while still allowing the <br/> tags our docs rely on.
    // Do not set this back to "loose": Mermaid renders after DOMPurify has run
    // on the markdown, so "loose" lets an uploaded document execute script.
    securityLevel: "antiscript",
    theme: "base",
    darkMode: theme === "dark",
    fontFamily: '"Inter", sans-serif',
    // Colours belong in themeVariables, not in blanket !important overrides.
    // An earlier set filled every node with the surface colour — the same
    // colour as the block behind it — and stroked them in --border-muted, which
    // is barely a shade off it. Nodes have to sit a step above the background
    // with a border that can actually be seen.
    themeVariables: palette.themeVariables,
    er: {
      useMaxWidth: true
    },
    themeCSS: buildDiagramThemeCss(palette)
  });

  state.mermaidTheme = theme;
  state.mermaidReady = true;
}

function promoteMermaidCodeBlocks(root) {
  const codeNodes = root.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid");
  codeNodes.forEach((codeNode) => {
    const source = codeNode.textContent || "";
    const block = document.createElement("div");
    block.className = "mermaid mermaid-block";
    block.textContent = source;
    // Kept so the diagram can be redrawn from source when the theme changes;
    // Mermaid bakes its colours into the SVG at render time, so a repaint is
    // the only way to recolour one.
    block.dataset.mermaidSource = source;
    const pre = codeNode.closest("pre");
    if (pre) {
      pre.replaceWith(block);
    }
  });
}

function highlightCodeBlocks(root) {
  if (!window.hljs) {
    return;
  }

  const codeNodes = root.querySelectorAll("pre code");
  codeNodes.forEach((codeNode) => {
    if (codeNode.closest(".mermaid-block")) {
      return;
    }

    if (codeNode.dataset.highlighted === "true") {
      return;
    }

    try {
      const classes = Array.from(codeNode.classList || []);
      const languageClass = classes.find((value) => /^language-|^lang-/i.test(value));
      const requestedRawLanguage = languageClass
        ? languageClass.replace(/^language-|^lang-/i, "").trim().toLowerCase()
        : "";
      const requestedLanguage = CODE_LANGUAGE_ALIAS[requestedRawLanguage] || requestedRawLanguage;
      const source = String(codeNode.textContent || "");

      if (requestedLanguage && window.hljs.getLanguage(requestedLanguage)) {
        const highlighted = window.hljs.highlight(source, {
          language: requestedLanguage,
          ignoreIllegals: true
        });

        codeNode.innerHTML = highlighted.value;
        codeNode.classList.add("hljs", `language-${requestedLanguage}`);
        codeNode.dataset.highlighted = "true";
        return;
      }

      const autoHighlighted = window.hljs.highlightAuto(source);
      codeNode.innerHTML = autoHighlighted.value;
      codeNode.classList.add("hljs");
      if (autoHighlighted.language) {
        codeNode.classList.add(`language-${autoHighlighted.language}`);
      }
      codeNode.dataset.highlighted = "true";
    } catch (error) {
      console.error("Code highlighting failed", error);
    }
  });
}

function normalizeMermaidSource(source) {
  return String(source || "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\r\n/g, "\n")
    .trim();
}

function simplifyErDiagramSource(source) {
  const raw = normalizeMermaidSource(source);
  if (!/^erDiagram\b/.test(raw)) {
    return raw;
  }

  const lines = raw.split("\n");
  let inEntity = false;
  const output = [];

  for (const originalLine of lines) {
    const line = originalLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (!trimmed) {
      output.push("");
      continue;
    }

    if (trimmed === "erDiagram") {
      output.push("erDiagram");
      continue;
    }

    if (trimmed.endsWith("{")) {
      inEntity = true;
      output.push(`  ${trimmed}`);
      continue;
    }

    if (trimmed === "}") {
      inEntity = false;
      output.push("  }");
      continue;
    }

    if (inEntity) {
      const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(PK|FK|UK))?/i);
      if (!match) {
        continue;
      }

      let type = match[1].toLowerCase();
      const name = match[2];
      const key = match[3] ? match[3].toUpperCase() : "";

      if (type === "timestamp") {
        type = "datetime";
      }
      if (type === "text") {
        type = "string";
      }
      if (type === "enum") {
        type = "string";
      }

      output.push(`    ${type} ${name}${key ? ` ${key}` : ""}`);
      continue;
    }

    const relMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s+(\|\|--\|\{|\|\|--o\{|o\|--\|\{|o\|--o\{|\|o--\|\{|\|o--o\{|\}\|--\|\{|\}\|--o\{|\|\|--\|\||\|\|--o\||o\|--\|\||o\|--o\|)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (relMatch) {
      const left = relMatch[1];
      const connector = relMatch[2];
      const right = relMatch[3];
      const rawLabel = relMatch[4]
        .replace(/^"|"$/g, "")
        .replace(/[^A-Za-z0-9_ ]/g, " ")
        .replace(/\s+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
      const label = rawLabel || "relates_to";
      output.push(`  ${left} ${connector} ${right} : ${label}`);
      continue;
    }

    output.push(`  ${trimmed}`);
  }

  return output.join("\n");
}

async function renderSingleMermaidNode(node) {
  const raw = normalizeMermaidSource(node.textContent || "");
  const attempts = [raw];
  const simplified = simplifyErDiagramSource(raw);
  if (simplified && simplified !== raw) {
    attempts.push(simplified);
  }

  let lastError = null;

  for (const candidate of attempts) {
    try {
      state.panZoomCounter += 1;
      const renderId = `mermaid-svg-${state.panZoomCounter}`;
      const { svg, bindFunctions } = await window.mermaid.render(renderId, candidate);
      node.innerHTML = svg;
      if (typeof bindFunctions === "function") {
        bindFunctions(node);
      }
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  const errText = String(lastError?.str || lastError?.message || "Unknown parser error");
  node.innerHTML = `
    <pre class="mermaid-fallback-code">${escapeHtml(raw)}</pre>
    <p class="mermaid-fallback-error">Mermaid parse failed: ${escapeHtml(errText)}</p>
  `;
  return false;
}

// svg-pan-zoom binds window resize and wheel handlers per instance. They were
// never released, so every re-render and every document switch leaked another
// set that kept firing against detached SVGs for the life of the page.
const livePanZoomInstances = new Map();

function destroyPanZoomInstances(root = null) {
  for (const [svg, instance] of [...livePanZoomInstances.entries()]) {
    // A null root means "everything"; otherwise only what lives under it, plus
    // any node that has since been detached from the document.
    if (root && root.contains(svg) === false && svg.isConnected) {
      continue;
    }

    try {
      instance.destroy();
    } catch (error) {
      console.error("Pan/zoom destroy failed", error);
    }

    delete svg.dataset.panzoomInit;
    livePanZoomInstances.delete(svg);
  }
}

// Wheel-over-diagram used to zoom instead of scrolling the page, which turned
// every diagram into a scroll trap. Wheel zoom is now opt-in for exactly as
// long as Ctrl/Cmd is held — the same gesture maps use.
let wheelZoomArmed = false;

function setWheelZoomArmed(armed) {
  if (armed === wheelZoomArmed) {
    return;
  }

  wheelZoomArmed = armed;
  for (const instance of livePanZoomInstances.values()) {
    try {
      if (armed) {
        instance.enableMouseWheelZoom();
      } else {
        instance.disableMouseWheelZoom();
      }
    } catch (error) {
      console.error("Pan/zoom wheel toggle failed", error);
    }
  }
}

function bindWheelZoomModifier() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Control" || event.key === "Meta") {
      setWheelZoomArmed(true);
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "Control" || event.key === "Meta") {
      setWheelZoomArmed(false);
    }
  });

  // A keyup that happens while the window is unfocused never arrives, so the
  // modifier would stay stuck on. Reset whenever focus leaves.
  window.addEventListener("blur", () => setWheelZoomArmed(false));
}

// svg-pan-zoom sets the SVG to width:100%/height:100%, so the block has to have
// a height of its own or the whole thing collapses to nothing — which is what a
// plain `height: auto` container did. Take the shape from the diagram's own
// viewBox so each one is sized to its content instead of a blanket 65vh, and let
// CSS clamp the extremes.
const DIAGRAM_FALLBACK_RATIO = "16 / 9";
const DIAGRAM_FALLBACK_WIDTH = 720;
// Small diagrams are still scaled up to at least this, or a three-node flowchart
// renders postage-stamp sized on a wide monitor.
const DIAGRAM_MIN_WIDTH = 360;
// The block's own padding and border, both sides, since aspect-ratio applies to
// the border box.
const DIAGRAM_BLOCK_CHROME = 26;

function sizeDiagramContainer(svg) {
  const block = svg.closest(".mermaid-block");
  if (!block) {
    return;
  }

  let width = 0;
  let height = 0;

  const viewBox = svg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    width = viewBox.width;
    height = viewBox.height;
  } else {
    // No usable viewBox (some diagram types), so measure what was drawn.
    try {
      const box = svg.getBBox();
      width = box.width;
      height = box.height;
    } catch {
      // getBBox throws on a detached or not-yet-laid-out SVG; fall through.
    }
  }

  if (width > 0 && height > 0) {
    block.style.aspectRatio = `${width} / ${height}`;
    // Capping the width at the diagram's natural size is what keeps a small
    // diagram small. Without it, width:100% stretches a 160px flowchart across
    // the whole pane and the aspect ratio then makes it enormously tall.
    block.style.maxWidth = `${Math.max(width, DIAGRAM_MIN_WIDTH) + DIAGRAM_BLOCK_CHROME}px`;
    return;
  }

  block.style.aspectRatio = DIAGRAM_FALLBACK_RATIO;
  block.style.maxWidth = `${DIAGRAM_FALLBACK_WIDTH}px`;
}

function applyPanZoom(root) {
  if (!window.svgPanZoom) {
    return;
  }

  // Anything previously initialized inside this root is about to be replaced.
  destroyPanZoomInstances(root);

  const svgNodes = root.querySelectorAll(".mermaid-block svg");
  svgNodes.forEach((svg) => {
    if (svg.dataset.panzoomInit === "1") {
      return;
    }

    // Must happen before svg-pan-zoom takes over the SVG's own dimensions.
    sizeDiagramContainer(svg);

    state.panZoomCounter += 1;
    const id = svg.id || `mermaid-svg-${state.panZoomCounter}`;
    svg.id = id;

    try {
      const panZoomInstance = window.svgPanZoom(`#${id}`, {
        controlIconsEnabled: true,
        fit: true,
        center: true,
        minZoom: 0.5,
        maxZoom: 12,
        zoomScaleSensitivity: 0.3,
        // Off by default so scrolling the page past a diagram scrolls the page.
        // Held Ctrl/Cmd turns it on for as long as the key is down; the +/-
        // control icons work regardless.
        mouseWheelZoomEnabled: false
      });
      svg.dataset.panzoomInit = "1";
      livePanZoomInstances.set(svg, panZoomInstance);
      if (wheelZoomArmed) {
        // Rendered while the modifier was already down.
        panZoomInstance.enableMouseWheelZoom();
      }
      window.requestAnimationFrame(() => {
        try {
          panZoomInstance.resize();
          panZoomInstance.fit();
          panZoomInstance.center();
        } catch (error) {
          console.error("Pan/zoom refit failed", error);
        }
      });
    } catch (error) {
      console.error("Pan/zoom init failed", error);
    }
  });
}

async function renderMermaidBlocks(root) {
  ensureMermaidInitialized();
  if (!window.mermaid) {
    highlightCodeBlocks(root);
    renderMathBlocks(root);
    return;
  }

  await waitForNextFrame();
  promoteMermaidCodeBlocks(root);
  await waitForNextFrame();
  const nodes = root.querySelectorAll(".mermaid");
  if (nodes.length === 0) {
    highlightCodeBlocks(root);
    renderMathBlocks(root);
    return;
  }

  let hadFailure = false;
  for (const node of nodes) {
    const ok = await renderSingleMermaidNode(node);
    if (!ok) {
      hadFailure = true;
    }
  }

  highlightCodeBlocks(root);
  applyPanZoom(root);
  renderMathBlocks(root);
  if (hadFailure) {
    setStatus("One or more Mermaid blocks were auto-simplified or could not be parsed.", "error");
  }
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
      await requestJson(`/api/docs/${encodeURIComponent(file)}/folder`, {
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
    }
  ];
}

function buildFolderContextItems(folder) {
  const canPaste = state.clipboard.files.length > 0;

  return [
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
      await requestJson(`/api/docs/${encodeURIComponent(file)}/delete`, {
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

  beginInlineEdit(label, file, async (nextName) => {
    try {
      const payload = await requestJson(`/api/docs/${encodeURIComponent(file)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName })
      });
      state.contentCache.delete(file);
      const openedFile = state.activeFile === file ? payload.file : state.activeFile;
      await refreshDocs({ openFile: openedFile, preserveSearch: true });
      notify(`Renamed to ${payload.file}.`, "success");
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

  const childrenOf = new Map();
  for (const folder of state.folders) {
    const key = folder.parentId || "__top__";
    if (!childrenOf.has(key)) {
      childrenOf.set(key, []);
    }
    childrenOf.get(key).push(folder);
  }

  for (const list of childrenOf.values()) {
    list.sort((left, right) => (left.order - right.order) || left.name.localeCompare(right.name));
  }

  const isSearching = Boolean(elements.searchInput.value.trim());

  const buildNode = (folder, depth) => {
    const children = (childrenOf.get(folder.id) || [])
      .map((child) => buildNode(child, depth + 1))
      .filter(Boolean);
    const ownDocs = docsByFolder.get(folder.id) || [];

    // While searching, a branch with no matches anywhere inside it is noise.
    if (isSearching && ownDocs.length === 0 && children.length === 0) {
      return null;
    }

    return { folder, depth, docs: ownDocs, children };
  };

  const roots = (childrenOf.get("__top__") || [])
    .map((folder) => buildNode(folder, 0))
    .filter(Boolean);

  const rootDocs = docsByFolder.get("__root__") || [];
  if (rootDocs.length > 0 || !isSearching) {
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

  const siblings = state.folders
    .filter((entry) => (entry.parentId || null) === (folder.parentId || null))
    .sort((left, right) => (left.order - right.order) || left.name.localeCompare(right.name));
  const position = siblings.findIndex((entry) => entry.id === folder.id);

  actions.append(
    buildTreeAction("New subfolder", "ph-folder-plus", () => {
      openFolderModal({ mode: "create", parentId: folder.id });
    }),

    buildTreeAction(`Move ${folder.name} up`, "ph-arrow-up", () => {
      void moveFolderBy(folder.id, -1);
    }, { disabled: position <= 0 }),

    buildTreeAction(`Move ${folder.name} down`, "ph-arrow-down", () => {
      void moveFolderBy(folder.id, 1);
    }, { disabled: position < 0 || position >= siblings.length - 1 }),

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

  const displayName = state.isRecycleBinMode ? (doc.originalFile || doc.file) : doc.file;
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
  } else {
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

    enableDocDrag(row, doc);
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

  if (!state.isRecycleBinMode && node.folder) {
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

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
    event.preventDefault();
    cutFiles([...state.selection]);
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    event.preventDefault();
    const targetFolderId = folderRow?.dataset.folderId
      || (group?.dataset.folderKey !== "__root__" ? group?.dataset.folderKey : null)
      || null;
    void pasteIntoFolder(targetFolderId);
    return;
  }

  if (event.key === "F2") {
    event.preventDefault();
    if (docRow) {
      beginInlineRename(docRow.dataset.file);
    } else if (folderRow?.dataset.folderId) {
      beginInlineFolderRename(folderRow.dataset.folderId);
    }
    return;
  }

  if (event.key === "Delete" && !state.isRecycleBinMode) {
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
      if (pushHash) {
        window.location.hash = encodeURIComponent(file);
      }

      if (hasJumpQuery) {
        if (jumpResult.found) {
          setStatus(`Viewing ${doc.file}. Match ${jumpResult.index + 1} of ${jumpResult.total} for "${jumpQuery.trim()}".`, "success");
        } else {
          setStatus(`Viewing ${doc.file}. Could not find "${jumpQuery.trim()}" in rendered content.`, "neutral");
        }
        return;
      }

      setStatus(`Viewing ${doc.file}`, "neutral");
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

    // Claim the document the moment its content is on screen. Waiting until after
    // Mermaid finishes left a multi-second window on diagram-heavy files where the
    // Edit and Delete buttons still pointed at the previously open document.
    state.activeFile = file;
    // Selection-only change: repaint the highlight, don't rebuild the list.
    updateActiveRowHighlight();
    updateActiveDocUI(file);
    document.title = `${doc.title} | AzaDocs`;
    if (pushHash) {
      window.location.hash = encodeURIComponent(file);
    }

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
        setStatus(`Viewing ${doc.file}. Match ${jumpResult.index + 1} of ${jumpResult.total} for "${jumpQuery.trim()}".`, "success");
      } else {
        setStatus(`Viewing ${doc.file}. Could not find "${jumpQuery.trim()}" in rendered content.`, "neutral");
      }
      return;
    }

    setStatus(`Viewing ${doc.file}`, "neutral");
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
    const payload = await requestJson(`/api/docs/${encodeURIComponent(targetFile)}/delete`, {
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
    await requestJson(`/api/recycle-bin/${encodeURIComponent(entryFile)}/hard-delete`, {
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
  const payload = await requestJson(`/api/docs/${encodeURIComponent(file)}/folder`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ folderId: folderId || null })
  });

  state.contentCache.delete(file);
  await refreshDocs({ openFile: file, preserveSearch: true });
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
  highlightCodeBlocks(elements.editorPreview);

  const previewScrollMax = Math.max(0, elements.editorPreview.scrollHeight - elements.editorPreview.clientHeight);
  elements.editorPreview.scrollTop = previewScrollMax * inputScrollRatio;

  // Mermaid and KaTeX are the expensive half, so they run once typing settles.
  await renderMermaidBlocks(elements.editorPreview);
  if (generation !== editorPreviewGeneration) {
    return;
  }

  highlightCodeBlocks(elements.editorPreview);
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
  highlightCodeBlocks(elements.editorPreview);
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
function syncEditorFolderPicker(mode) {
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

  for (const folder of [...state.folders].sort((left, right) => left.order - right.order)) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.name;
    select.appendChild(option);
  }

  select.value = "";
}

function openEditor({ mode, fileName, content }) {
  state.editorMode = mode;
  state.editorFile = mode === "edit" ? fileName : null;
  state.editorOpen = true;
  syncEditorFolderPicker(mode);

  elements.editorFileName.value = fileName || "";
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
    updateActiveDocUI(null);
    showEmptyState("No markdowns yet", "Upload a markdown or create one in the live editor.", "ph-file-plus");
    setStatus("No documents yet. Create or upload one to get started.", "neutral");
    return;
  }

  const target = state.docs.find((doc) => doc.file === openFile)?.file
    || state.docs.find((doc) => doc.file === state.activeFile)?.file
    || null;

  if (!target) {
    state.activeFile = null;
    updateActiveDocUI(null);
    showEmptyState("No file selected", "Pick a file from the explorer, or search across every document.", "ph-file-dashed");
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
      if (fileName !== state.editorFile) {
        const renamed = await requestJson(`/api/docs/${encodeURIComponent(state.editorFile)}/rename`, {
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

      payload = await requestJson(`/api/docs/${encodeURIComponent(targetFile)}`, {
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

        payload = await requestJson(`/api/docs/${encodeURIComponent(fileName)}`, {
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
    const payload = await requestJson(`/api/docs/${encodeURIComponent(file)}/delete`, {
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
    const payload = await requestJson(`/api/recycle-bin/${encodeURIComponent(file)}/restore`, {
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
    const payload = await requestJson(`/api/archive/${encodeURIComponent(file)}/restore`, {
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
    const payload = await requestJson(`/api/archive/${encodeURIComponent(file)}`, {
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
    const payload = await requestJson(`/api/recycle-bin/${encodeURIComponent(file)}/hard-delete`, {
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
  mountMatchNavToViewportLayer();
  bindWheelZoomModifier();
  bindThemeToggle();
  syncLockUI();
  await restoreWriteSession();
  syncModeUI();
  updateActiveDocUI(null);
  updateJumpNavigationUI();
  syncSearchInputState(elements.searchInput.value);

  try {
    const hashFile = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    await refreshDocs({ openFile: hashFile || null, preserveSearch: true });
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

elements.lockToggleBtn.addEventListener("click", () => {
  handleLockToggle();
});

elements.unlockConfirmBtn.addEventListener("click", () => {
  void submitUnlock();
});

elements.unlockCancelBtn.addEventListener("click", () => {
  closeUnlockModal();
});

elements.unlockBackdrop.addEventListener("click", () => {
  closeUnlockModal();
});

elements.unlockTokenInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  void submitUnlock();
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
  openContextMenu(event.clientX, event.clientY, [
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
    { separator: true },
    {
      label: "Select all",
      icon: "ph-check-square",
      action: () => setSelection(visibleFileOrder)
    }
  ]);
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

  if (isTyping || state.editorOpen || state.confirmOpen || state.unlockOpen || state.folderModalOpen) {
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

  if (state.unlockOpen) {
    event.preventDefault();
    closeUnlockModal();
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
  if (!isEditorDirty()) {
    return;
  }

  // Browsers show their own generic wording; returnValue just opts in.
  event.preventDefault();
  event.returnValue = "";
});

window.addEventListener("resize", () => {
  if (window.innerWidth > MOBILE_BREAKPOINT && elements.appShell.classList.contains("nav-open")) {
    setNavOpen(false);
  }
});

elements.uploadTrigger.addEventListener("click", () => {
  elements.uploadInput.click();
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
  openEditor({
    mode: "create",
    fileName: "",
    content: "# New Markdown\n\nStart writing here..."
  });
});

elements.editDocBtn.addEventListener("click", () => {
  openEditorForCurrentDoc();
});

elements.editCurrentDocBtn.addEventListener("click", () => {
  openEditorForCurrentDoc();
});

elements.editorInput.addEventListener("input", () => {
  scheduleEditorPreview();
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
  openEditorForCurrentDoc();
});

window.addEventListener("hashchange", () => {
  const hashFile = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (hashFile && hashFile !== state.activeFile && state.docs.some((doc) => doc.file === hashFile)) {
    openDocument(hashFile, false);
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
