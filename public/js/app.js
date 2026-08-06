const elements = {
  appShell: document.getElementById("appShell"),
  toggleSidebar: document.getElementById("toggleSidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  sidebarTitle: document.getElementById("sidebarTitle"),
  refreshDocs: document.getElementById("refreshDocs"),
  toggleRecycleBinBtn: document.getElementById("toggleRecycleBinBtn"),
  uploadTrigger: document.getElementById("uploadTrigger"),
  uploadInput: document.getElementById("uploadInput"),
  createFolderBtn: document.getElementById("createFolderBtn"),
  newDocBtn: document.getElementById("newDocBtn"),
  editDocBtn: document.getElementById("editDocBtn"),
  editCurrentDocBtn: document.getElementById("editCurrentDocBtn"),
  softDeleteDocBtn: document.getElementById("softDeleteDocBtn"),
  hardDeleteDocBtn: document.getElementById("hardDeleteDocBtn"),
  restoreDocBtn: document.getElementById("restoreDocBtn"),
  activeDocLabel: document.getElementById("activeDocLabel"),
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
  searchMeta: document.getElementById("searchMeta"),
  statusMsg: document.getElementById("statusMsg"),
  docList: document.getElementById("docList"),
  emptyState: document.getElementById("emptyState"),
  docContent: document.getElementById("docContent"),
  editorModal: document.getElementById("editorModal"),
  editorBackdrop: document.getElementById("editorBackdrop"),
  closeEditorBtn: document.getElementById("closeEditorBtn"),
  saveDocBtn: document.getElementById("saveDocBtn"),
  editorFileName: document.getElementById("editorFileName"),
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
  isRecycleBinMode: false,
  filteredDocs: [],
  contentCache: new Map(),
  activeFile: null,
  editorMode: "create",
  editorFile: null,
  editorOpen: false,
  editorInitialContent: "",
  editorInitialFileName: "",
  mermaidReady: false,
  panZoomCounter: 0,
  searchResults: [],
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
  folderModalTargetFolderId: null,
  collapsedFolderIds: new Set(),
  confirmOpen: false,
  confirmResolver: null
};

const MOBILE_BREAKPOINT = 920;
const TREE_MENU_HOLD_DELAY = 420;
const SUPERSEARCH_LIMIT = 8;
const MATCH_SWIPE_THRESHOLD = 56;
const MATCH_SWIPE_VERTICAL_LIMIT = 42;
const SANITIZE_ALLOWED_URI_PATTERN = /^(?:(?:(?:f|ht)tps?|mailto|tel):|data:image\/(?:bmp|gif|jpe?g|png|svg\+xml|webp|avif)(?:;charset=[^;,]+)?(?:;base64)?,|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
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
    .replace(/\"/g, "&quot;")
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
  if (!folderId) {
    return -1;
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


function groupDocsByFolder(docs) {
  const groups = new Map();

  for (const doc of docs) {
    const folderId = doc.folderId || null;
    const key = folderId || "__root__";

    if (!groups.has(key)) {
      groups.set(key, {
        folderId,
        folderName: getFolderLabel(folderId),
        folderOrder: getFolderOrder(folderId),
        docs: []
      });
    }

    groups.get(key).docs.push(doc);
  }

  return [...groups.values()].sort((left, right) => {
    if (left.folderOrder !== right.folderOrder) {
      return left.folderOrder - right.folderOrder;
    }

    return left.folderName.localeCompare(right.folderName);
  });
}

function syncFolderModalUI() {
  if (!elements.folderModal) {
    return;
  }

  const mode = state.folderModalMode;
  const targetFile = state.folderModalTargetFile ? getDocByFile(state.folderModalTargetFile, true) : null;
  const targetFolder = state.folderModalTargetFolderId ? getFolderRecord(state.folderModalTargetFolderId) : null;

  if (mode === "move") {
    elements.folderTitle.textContent = targetFile
      ? `Move ${targetFile.title || targetFile.file} to a folder`
      : "Move document to a folder";
    elements.folderDescription.textContent = targetFile
      ? `Choose an existing folder or create a new one for ${targetFile.file}.`
      : "Choose an existing folder or create a new one.";
    elements.createFolderConfirmBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i> Create And Move';
    elements.moveToRootBtn.hidden = false;
    elements.folderPicker.hidden = false;
  } else if (mode === "rename") {
    elements.folderTitle.textContent = targetFolder ? `Rename ${targetFolder.name}` : "Rename folder";
    elements.folderDescription.textContent = targetFolder
      ? "Update the logical folder name without moving any files."
      : "Update the logical folder name without moving any files.";
    elements.createFolderConfirmBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Rename Folder';
    elements.moveToRootBtn.hidden = true;
    elements.folderPicker.hidden = true;
  } else {
    elements.folderTitle.textContent = "Create folder";
    elements.folderDescription.textContent = "Create a logical folder to group documents without changing the physical layout.";
    elements.createFolderConfirmBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i> Create Folder';
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

  const moveMode = state.folderModalMode === "move";
  const docsCollection = state.isRecycleBinMode ? state.deletedDocs : state.docs;
  const counts = new Map();

  for (const doc of docsCollection) {
    const key = doc.folderId || "__root__";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const folders = [...state.folders].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.name.localeCompare(right.name);
  });

  if (folders.length === 0) {
    elements.folderPickerList.innerHTML = '<div class="folder-empty">No folders yet. Create one to organize documents.</div>';
    return;
  }

  elements.folderPickerList.innerHTML = folders.map((folder) => `
    <button class="folder-choice" type="button" data-folder-id="${escapeHtml(folder.id)}" ${moveMode ? "" : "disabled"}>
      <span class="folder-choice-title"><i class="fa-solid fa-folder"></i>${escapeHtml(folder.name)}</span>
      <span class="folder-choice-meta">${escapeHtml(String(counts.get(folder.id) || 0))} doc(s)</span>
    </button>
  `).join("");

  elements.folderPickerList.querySelectorAll(".folder-choice").forEach((button) => {
    if (!moveMode) {
      return;
    }

    button.addEventListener("click", async () => {
      const folderId = button.getAttribute("data-folder-id");
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

function openFolderModal({ mode = "create", file = null, folderId = null } = {}) {
  state.folderModalOpen = true;
  state.folderModalMode = mode;
  state.folderModalTargetFile = file;
  state.folderModalTargetFolderId = folderId;
  syncFolderModalUI();
  renderFolderPickerList();

  elements.folderModal.classList.add("open");
  elements.folderModal.setAttribute("aria-hidden", "false");
  syncBodyLock();
  window.requestAnimationFrame(() => elements.folderNameInput.focus());
  window.requestAnimationFrame(() => {
    if (mode === "rename") {
      elements.folderNameInput.select();
    }
  });
}

function closeFolderModal() {
  state.folderModalOpen = false;
  state.folderModalMode = "create";
  state.folderModalTargetFile = null;
  state.folderModalTargetFolderId = null;
  elements.folderNameInput.value = "";
  elements.folderModal.classList.remove("open");
  elements.folderModal.setAttribute("aria-hidden", "true");
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

function renderSuperSearchPanel(query, matches, searchTerms) {
  const trimmedQuery = String(query || "").trim();
  syncSearchInputState(query);

  if (!trimmedQuery) {
    state.searchResults = [];
    state.searchResultsQuery = "";
    elements.superSearchList.innerHTML = "";
    elements.superSearchCount.textContent = "0 results";
    setSuperSearchOpen(false);
    return;
  }

  const topResults = matches.slice(0, SUPERSEARCH_LIMIT);
  state.searchResults = topResults;
  state.searchResultsQuery = trimmedQuery;
  elements.superSearchCount.textContent = `${matches.length} result(s)`;

  if (topResults.length === 0) {
    elements.superSearchList.innerHTML = "<li class=\"supersearch-empty\">No matches. Try fewer keywords or part of the filename.</li>";
    setSuperSearchOpen(true);
    return;
  }

  elements.superSearchList.innerHTML = topResults.map((doc) => `
    <li>
      <button class="supersearch-item" type="button" data-file="${escapeHtml(doc.file)}">
        <span class="supersearch-item-title"><i class="fa-solid ${escapeHtml(doc.icon)}"></i>${highlightMatches(doc.title, searchTerms)}</span>
        <span class="supersearch-item-file">${highlightMatches(doc.originalFile || doc.file, searchTerms)}</span>
        <span class="supersearch-item-snippet">${highlightMatches(doc.snippet, searchTerms)}</span>
      </button>
    </li>
  `).join("");

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
  const shouldLock = elements.appShell.classList.contains("nav-open") || state.editorOpen || state.confirmOpen || state.folderModalOpen;
  document.body.classList.toggle("lock-scroll", shouldLock);
}

function inferIcon(fileName) {
  const value = normalize(fileName);
  if (isNotebookFile(value)) {
    return "fa-file-code";
  }

  if (value.includes("srs") || value.includes("spec")) {
    return "fa-file-contract";
  }

  if (value.includes("erd") || value.includes("schema") || value.includes("db")) {
    return "fa-diagram-project";
  }

  if (value.includes("readme")) {
    return "fa-book";
  }

  if (value.endsWith(".mmd") || value.endsWith(".mermaid")) {
    return "fa-diagram-project";
  }

  return "fa-file-lines";
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
}

function updateActiveDocUI(fileName) {
  if (!fileName) {
    elements.activeDocLabel.innerHTML = '<i class="fa-solid fa-file-lines"></i>No document selected';
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
    elements.activeDocLabel.innerHTML = `<i class="fa-solid fa-trash-can"></i>${escapeHtml(label)}`;
    elements.editDocBtn.disabled = true;
    elements.editCurrentDocBtn.disabled = true;
    elements.dockEdit.disabled = true;
    elements.softDeleteDocBtn.disabled = true;
    elements.hardDeleteDocBtn.disabled = false;
    elements.restoreDocBtn.disabled = false;
    return;
  }

  const notebookFile = isNotebookFile(fileName);
  elements.activeDocLabel.innerHTML = `<i class="fa-solid ${notebookFile ? "fa-file-code" : "fa-file-lines"}"></i>${escapeHtml(fileName)}`;
  elements.editDocBtn.disabled = notebookFile;
  elements.editCurrentDocBtn.disabled = notebookFile;
  elements.dockEdit.disabled = notebookFile;
  elements.softDeleteDocBtn.disabled = false;
  elements.hardDeleteDocBtn.disabled = false;
  elements.restoreDocBtn.disabled = true;
}

function setStatus(message, tone = "neutral") {
  elements.statusMsg.textContent = message || "";
  elements.statusMsg.dataset.tone = tone;
}

function resolveConfirmDialog(confirmed) {
  if (!state.confirmOpen) {
    return;
  }

  state.confirmOpen = false;
  elements.confirmModal.classList.remove("open");
  elements.confirmModal.setAttribute("aria-hidden", "true");
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
  confirmIcon = "fa-check",
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
    elements.confirmProceedBtn.innerHTML = `<i class="fa-solid ${confirmIcon}"></i> ${escapeHtml(confirmLabel)}`;
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
    syncBodyLock();
    elements.confirmProceedBtn.focus();
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload;
}

async function fetchDocs() {
  const payload = await requestJson("/api/docs", { cache: "no-store" });

  state.rootFolderLabel = payload.rootFolderLabel || "Ungrouped";
  state.folders = (payload.folders || []).map((folder, index) => ({
    id: folder.id,
    name: folder.name || folder.id,
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
    folderOrder: Number.isFinite(Number(doc.folderOrder)) ? Number(doc.folderOrder) : getFolderOrder(doc.folderId),
    icon: inferIcon(doc.file)
  }));
}

async function fetchDeletedDocs() {
  const payload = await requestJson("/api/recycle-bin", { cache: "no-store" });

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
    icon: "fa-trash-can"
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

  const payload = await requestJson(`/api/recycle-bin/${encodeURIComponent(entryFile)}/content`, { cache: "no-store" });
  const content = String(payload.content || "");
  const version = String(doc?.deletedAt || doc?.updatedAt || "");
  state.contentCache.set(entryFile, {
    content,
    version
  });

  return content;
}

function syncModeUI() {
  const inRecycleBin = state.isRecycleBinMode;
  elements.sidebarTitle.innerHTML = inRecycleBin
    ? '<i class="fa-solid fa-trash-can"></i> Recycle Bin'
    : '<i class="fa-solid fa-folder-tree"></i> Markdowns';

  elements.toggleRecycleBinBtn.classList.toggle("active", inRecycleBin);
  elements.toggleRecycleBinBtn.setAttribute("aria-label", inRecycleBin ? "Exit recycle bin" : "Open recycle bin");
  elements.toggleRecycleBinBtn.title = inRecycleBin ? "Exit recycle bin" : "Open recycle bin";

  elements.softDeleteDocBtn.hidden = inRecycleBin;
  elements.hardDeleteDocBtn.hidden = false;
  elements.restoreDocBtn.hidden = !inRecycleBin;
  elements.createFolderBtn.hidden = inRecycleBin;

  const hardDeleteIcon = elements.hardDeleteDocBtn.querySelector("i");
  if (inRecycleBin) {
    if (hardDeleteIcon) hardDeleteIcon.className = "fa-solid fa-box-archive";
    elements.hardDeleteDocBtn.setAttribute("aria-label", "Move recycle bin markdown to hard archive");
    elements.hardDeleteDocBtn.title = "Move to deleted_markdowns/hard";
  } else {
    if (hardDeleteIcon) hardDeleteIcon.className = "fa-solid fa-trash";
    elements.hardDeleteDocBtn.setAttribute("aria-label", "Hard delete current markdown");
    elements.hardDeleteDocBtn.title = "Hard delete to deleted_markdowns";
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

function showEmptyState(title, message, icon = "fa-file-circle-question") {
  elements.emptyState.style.display = "block";
  elements.docContent.classList.remove("visible");
  elements.docContent.classList.remove("notebook-viewer");
  elements.docContent.innerHTML = "";
  elements.emptyState.innerHTML = `
    <i class="fa-solid ${icon}"></i>
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
          errorColor: "#f38ba8"
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
      errorColor: "#f38ba8"
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
      <p class="notebook-eyebrow"><i class="fa-solid fa-file-code"></i> Jupyter Notebook</p>
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

function ensureMermaidInitialized() {
  if (!window.mermaid || state.mermaidReady) {
    return;
  }

  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "base",
    darkMode: true,
    fontFamily: '"Space Grotesk", sans-serif',
    themeVariables: {
      primaryColor: "#1e1e2e",
      primaryTextColor: "#cdd6f4",
      primaryBorderColor: "#89b4fa",
      lineColor: "#cba6f7",
      textColor: "#cdd6f4"
    },
    er: {
      useMaxWidth: true
    },
    themeCSS: `
      /* Override ALL fill colors to be dark */
      rect, polygon, path, circle {
        fill: #1e1e2e !important;
        stroke: #585b70 !important;
      }
      
      /* Make entity headers stand out */
      .er.entityBox, .entityBox {
        fill: #313244 !important;
        stroke: #89b4fa !important;
        stroke-width: 2px !important;
      }
      
      /* Ensure all text is white/light */
      text, tspan {
        fill: #cdd6f4 !important;
        font-family: "JetBrains Mono", monospace !important;
        font-size: 11px !important;
      }
      
      /* Make connections purple */
      line, .relationshipLine {
        stroke: #cba6f7 !important;
        stroke-width: 2px !important;
      }
      
      /* Kill any default light colors */
      [fill="#f5e0dc"],
      [fill="#f2cdcd"],
      [fill="#f5c2e7"],
      [fill="#fab387"],
      [fill="#a6e3a1"],
      [fill="#94e2d5"],
      [fill="#89dceb"],
      [fill="#89b4fa"],
      [fill="#b4befe"],
      [fill="#cdd6f4"],
      [fill="#ffffff"],
      [fill="#f0f0f0"],
      [fill="#e8e8e8"],
      [fill="white"] {
        fill: #1e1e2e !important;
      }
    `
  });
  state.mermaidReady = true;
}

function promoteMermaidCodeBlocks(root) {
  const codeNodes = root.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid");
  codeNodes.forEach((codeNode) => {
    const source = codeNode.textContent || "";
    const block = document.createElement("div");
    block.className = "mermaid mermaid-block";
    block.textContent = source;
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

function applyPanZoom(root) {
  if (!window.svgPanZoom) {
    return;
  }

  const svgNodes = root.querySelectorAll(".mermaid-block svg");
  svgNodes.forEach((svg) => {
    if (svg.dataset.panzoomInit === "1") {
      return;
    }

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
        zoomScaleSensitivity: 0.3
      });
      svg.dataset.panzoomInit = "1";
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

function renderDocList() {
  const docs = state.filteredDocs;
  elements.docList.innerHTML = "";

  if (docs.length === 0) {
    const item = document.createElement("li");
    item.className = "doc-item is-empty";
    item.innerHTML = "<span class=\"doc-title\"><i class=\"fa-solid fa-face-frown\"></i>No matching markdowns</span>";
    elements.docList.appendChild(item);
    return;
  }

  const shouldShowFolderChip = Boolean(elements.searchInput.value.trim()) || state.isRecycleBinMode;
  const groupedDocs = groupDocsByFolder(docs);

  for (const group of groupedDocs) {
    const groupKey = group.folderId || "__root__";
    const groupItem = document.createElement("li");
    groupItem.className = "doc-group";
    groupItem.dataset.folderKey = groupKey;

    if (state.collapsedFolderIds.has(groupKey)) {
      groupItem.classList.add("is-collapsed");
    }

    const groupHead = document.createElement("div");
    groupHead.className = "folder-group-head";

    const groupToggle = document.createElement("button");
    groupToggle.type = "button";
    groupToggle.className = "folder-group-toggle";
    groupToggle.setAttribute("aria-expanded", String(!state.collapsedFolderIds.has(groupKey)));
    groupToggle.setAttribute("aria-haspopup", "menu");
    groupToggle.innerHTML = `
      <span class="folder-group-title">
        <i class="fa-solid ${group.folderId ? "fa-folder" : "fa-layer-group"}"></i>
        ${escapeHtml(group.folderName || state.rootFolderLabel || "Ungrouped")}
      </span>
      <span class="folder-group-count">
        <span class="count-text">${escapeHtml(String(group.docs.length))} doc(s)</span>
        <i class="fa-solid fa-chevron-down folder-toggle-icon"></i>
      </span>
    `;
    groupToggle.addEventListener("click", (event) => {
      toggleFolderCollapse(groupKey);
    });
    groupHead.appendChild(groupToggle);

    if (!state.isRecycleBinMode && group.folderId) {
      const mobileMenuBtn = document.createElement("button");
      mobileMenuBtn.className = "icon-btn mobile-folder-menu-btn";
      mobileMenuBtn.title = "Folder Actions";
      mobileMenuBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
      mobileMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        groupHead.classList.toggle("show-mobile-actions");
      });
      groupHead.appendChild(mobileMenuBtn);

      const groupActions = document.createElement("div");
      groupActions.className = "row-quick-actions folder-group-actions";

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "icon-btn";
      renameBtn.title = "Rename folder";
      renameBtn.setAttribute("aria-label", `Rename ${group.folderName}`);
      renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
      renameBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFolderModal({ mode: "rename", folderId: group.folderId });
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-btn danger";
      deleteBtn.title = "Delete folder";
      deleteBtn.setAttribute("aria-label", `Delete ${group.folderName}`);
      deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      deleteBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const shouldProceed = await requestConfirmation({
          title: `Delete ${group.folderName}?`,
          message: "Documents in this logical folder will move back to Ungrouped. The files themselves will stay in place.",
          confirmLabel: "Delete Folder",
          confirmIcon: "fa-trash-can",
          tone: "danger"
        });

        if (!shouldProceed) {
          return;
        }

        try {
          await requestJson(`/api/folders/${encodeURIComponent(group.folderId)}`, {
            method: "DELETE"
          });
          await refreshDocs({ preserveSearch: true });
          setStatus(`Deleted folder ${group.folderName}.`, "success");
        } catch (error) {
          setStatus(error.message, "error");
        }
      });

      groupActions.append(renameBtn, deleteBtn);
      groupHead.appendChild(groupActions);
    }

    groupItem.appendChild(groupHead);

    const groupList = document.createElement("ul");
    groupList.className = "folder-group-list";

    for (const doc of group.docs) {
      const isActive = state.activeFile === doc.file;
      const row = document.createElement("li");
      row.className = `doc-row ${isActive ? "active-row" : ""}`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = `doc-item${isActive ? " active" : ""}`;
      button.setAttribute("aria-haspopup", "menu");

      const escapedTitle = escapeHtml(doc.title);
      const escapedFile = escapeHtml(state.isRecycleBinMode ? (doc.originalFile || doc.file) : doc.file);
      const timeLabel = state.isRecycleBinMode ? "fa-solid fa-clock-rotate-left" : "fa-regular fa-clock";
      const folderChip = shouldShowFolderChip
        ? `<span class="tag-chip folder-chip"><i class="fa-solid fa-folder"></i>${escapeHtml(doc.folderName || state.rootFolderLabel || "Ungrouped")}</span>`
        : "";
      const tags = `
        <span class="tag-chip"><i class="${timeLabel}"></i>${escapeHtml(formatDate(doc.updatedAt))}</span>
        <span class="tag-chip muted"><i class="fa-solid fa-weight-hanging"></i>${escapeHtml(formatBytes(doc.size))}</span>
        ${folderChip}
      `;

      button.innerHTML = `
        <span class="doc-item-top">
          <span class="doc-icon"><i class="fa-solid ${escapeHtml(doc.icon)}"></i></span>
          <span class="doc-title">${escapedTitle}</span>
        </span>
        <span class="doc-details">
          <span class="doc-meta">${tags}</span>
        </span>
      `;

      button.addEventListener("click", async (event) => {
        if (state.isRecycleBinMode) {
          await openRecycleBinDocument(doc.file);
        } else {
          await openDocument(doc.file, true, {
            jumpQuery: elements.searchInput.value
          });
        }

        closeSidebarOnMobile();
      });

      const actions = document.createElement("div");
      actions.className = "row-quick-actions doc-row-actions";

      if (state.isRecycleBinMode) {
        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.className = "icon-btn";
        restoreBtn.title = "Restore";
        restoreBtn.innerHTML = '<i class="fa-solid fa-box-archive"></i>';
        restoreBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await restoreDeletedDocumentByFile(doc.file);
        });

        const hardDeleteBtn = document.createElement("button");
        hardDeleteBtn.type = "button";
        hardDeleteBtn.className = "icon-btn danger";
        hardDeleteBtn.title = "Hard Delete";
        hardDeleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        hardDeleteBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await hardDeleteDeletedDocumentByFile(doc.file);
        });

        actions.append(restoreBtn, hardDeleteBtn);
      } else {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "icon-btn";
        editBtn.title = "Edit";
        editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
        editBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await openEditorForDocument(doc.file);
        });

        const moveBtn = document.createElement("button");
        moveBtn.type = "button";
        moveBtn.className = "icon-btn";
        moveBtn.title = "Move";
        moveBtn.innerHTML = '<i class="fa-solid fa-folder-tree"></i>';
        moveBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openFolderModal({ mode: "move", file: doc.file, folderId: doc.folderId || null });
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "icon-btn danger";
        deleteBtn.title = "Delete";
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await deleteDocumentByFile(doc.file, "soft");
        });

        actions.append(editBtn, moveBtn, deleteBtn);
      }
      row.append(button, actions);
      groupList.appendChild(row);
    }

    groupItem.appendChild(groupList);
    elements.docList.appendChild(groupItem);
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
    state.filteredDocs = [...currentDocs];
    setMeta(state.isRecycleBinMode
      ? `${state.filteredDocs.length} deleted document(s)`
      : `${state.filteredDocs.length} document(s)`);
    renderSuperSearchPanel(rawQuery, [], []);
    renderDocList();
    return;
  }

  const requestId = ++state.searchRequestId;
  const contextLabel = state.isRecycleBinMode ? "recycle bin" : "documents";
  setMeta(`Searching ${contextLabel}...`);

  try {
    const payload = await requestJson(`/api/docs/search?scope=${encodeURIComponent(state.isRecycleBinMode ? "recycle-bin" : "docs")}&q=${encodeURIComponent(rawQuery)}`, { cache: "no-store" });
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

      document.title = `${doc.title} | Cart Docs Viewer`;
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

    elements.docContent.innerHTML = safeHtml;
    elements.docContent.classList.add("visible");
    elements.emptyState.style.display = "none";
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

    state.activeFile = file;
    renderDocList();
    updateActiveDocUI(file);

    document.title = `${doc.title} | Cart Docs Viewer`;
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
  } catch (error) {
    if (requestId !== state.openDocumentRequestId) {
      return;
    }

    showEmptyState(isNotebookFile(file) ? "Could not load this notebook" : "Could not load this markdown", error.message, "fa-triangle-exclamation");
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

    elements.docContent.innerHTML = safeHtml;
    elements.docContent.classList.add("visible");
    elements.emptyState.style.display = "none";
    await waitForNextFrame();
    await renderMermaidBlocks(elements.docContent);

    state.activeFile = file;
    renderDocList();
    updateActiveDocUI(file);

    document.title = `${doc.title} | Recycle Bin | Markdown Docs Viewer`;
    setStatus(`Viewing deleted doc ${doc.originalFile || doc.file}`, "neutral");
  } catch (error) {
    showEmptyState("Could not load deleted document", error.message, "fa-triangle-exclamation");
    setStatus(error.message, "error");
  }
}

async function refreshDeletedDocs({ openFile = null, preserveSearch = true } = {}) {
  setMeta("Loading recycle bin...");

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
    showEmptyState("Recycle bin is empty", "Soft-deleted markdowns will appear here.", "fa-trash-can");
    setStatus("Recycle bin is empty.", "neutral");
    return;
  }

  const target = state.deletedDocs.find((doc) => doc.file === openFile)?.file
    || state.deletedDocs.find((doc) => doc.file === state.activeFile)?.file
    || null;

  if (!target) {
    state.activeFile = null;
    updateActiveDocUI(null);
    showEmptyState("Select a recycle bin document", "Choose a soft-deleted file from the list to load it.", "fa-trash-can");
    setStatus("Recycle bin loaded. Select a file to view it.", "neutral");
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
    title: mode === "hard" ? "Hard delete this markdown?" : "Move markdown to recycle bin?",
    message: mode === "hard"
      ? `${targetFile} will be moved into deleted_markdowns/hard.`
      : `${targetFile} will be moved into the recycle bin and can be restored later.`,
    confirmLabel: mode === "hard" ? "Hard Delete" : "Move To Bin",
    confirmIcon: mode === "hard" ? "fa-trash" : "fa-trash-can",
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
    setStatus("Select a recycle bin markdown to hard delete.", "error");
    return;
  }

  const entryFile = state.activeFile;
  const shouldProceed = await requestConfirmation({
    title: "Move recycle-bin markdown to hard archive?",
    message: "This keeps the file in storage but moves it to deleted_markdowns/hard and removes it from recycle bin view.",
    confirmLabel: "Move To Hard Archive",
    confirmIcon: "fa-box-archive",
    tone: "danger"
  });

  if (!shouldProceed) {
    setStatus("Hard delete cancelled.", "neutral");
    return;
  }

  try {
    await requestJson(`/api/recycle-bin/${encodeURIComponent(entryFile)}/hard-delete`, {
      method: "POST"
    });

    state.contentCache.delete(entryFile);
    await refreshDeletedDocs({ preserveSearch: true });
    setStatus("Document moved to hard-deleted archive.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function createFolderOnServer(folderName) {
  return requestJson("/api/folders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: folderName })
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

    const created = await createFolderOnServer(folderName);

    if (state.folderModalMode === "move" && state.folderModalTargetFile) {
      await moveDocumentToFolder(state.folderModalTargetFile, created.folder.id);
      closeFolderModal();
      return;
    }

    closeFolderModal();
    await refreshDocs({ preserveSearch: true });
    setStatus(`Created folder ${created.folder.name}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function renderEditorPreview() {
  const inputScrollMax = Math.max(0, elements.editorInput.scrollHeight - elements.editorInput.clientHeight);
  const inputScrollRatio = inputScrollMax > 0
    ? elements.editorInput.scrollTop / inputScrollMax
    : 0;

  const source = state.editorMode === "edit" && isDiagramFile(state.editorFile)
    ? toMermaidMarkdown(elements.editorInput.value)
    : elements.editorInput.value;

  elements.editorPreview.innerHTML = renderMarkdown(source);
  await renderMermaidBlocks(elements.editorPreview);
  highlightCodeBlocks(elements.editorPreview);

  const previewScrollMax = Math.max(0, elements.editorPreview.scrollHeight - elements.editorPreview.clientHeight);
  elements.editorPreview.scrollTop = previewScrollMax * inputScrollRatio;
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

function openEditor({ mode, fileName, content }) {
  state.editorMode = mode;
  state.editorFile = mode === "edit" ? fileName : null;
  state.editorOpen = true;

  elements.editorFileName.value = fileName || "";
  elements.editorFileName.disabled = mode === "edit";
  elements.editorInput.value = content || "";
  state.editorInitialContent = elements.editorInput.value;
  state.editorInitialFileName = elements.editorFileName.value;
  elements.editorInput.scrollTop = 0;
  elements.editorPreview.scrollTop = 0;
  state.editorScrollSyncLock = false;
  void renderEditorPreview();

  elements.saveDocBtn.innerHTML = mode === "edit"
    ? '<i class="fa-solid fa-floppy-disk"></i> Save Changes'
    : '<i class="fa-solid fa-floppy-disk"></i> Save New';

  elements.editorModal.classList.add("open");
  elements.editorModal.setAttribute("aria-hidden", "false");
  syncBodyLock();

  elements.editorInput.focus();
}

function closeEditor() {
  state.editorOpen = false;
  state.editorInitialContent = "";
  state.editorInitialFileName = "";
  elements.editorModal.classList.remove("open");
  elements.editorModal.setAttribute("aria-hidden", "true");
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
    confirmIcon: "fa-trash-can",
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
    showEmptyState("No markdowns yet", "Upload a markdown or create one in the live editor.", "fa-file-circle-plus");
    setStatus("No markdown files in markdowns folder yet.", "neutral");
    return;
  }

  const target = state.docs.find((doc) => doc.file === openFile)?.file
    || state.docs.find((doc) => doc.file === state.activeFile)?.file
    || null;

  if (!target) {
    state.activeFile = null;
    updateActiveDocUI(null);
    showEmptyState("Select a markdown document", "Choose a file from a folder to load its content.", "fa-file-lines");
    setStatus("Documents loaded. Select a file to view it.", "neutral");
    return;
  }

  await openDocument(target, false, { forceReload: true });
}

async function uploadMarkdown(file) {
  if (!file) {
    return;
  }

  const formData = new FormData();
  formData.append("markdownFile", file);

  try {
    const payload = await requestJson("/api/docs/upload", {
      method: "POST",
      body: formData
    });

    await refreshDocs({ openFile: payload.file, preserveSearch: false });
    setStatus(`Uploaded ${payload.file} to markdowns folder.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
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
      payload = await requestJson(`/api/docs/${encodeURIComponent(state.editorFile)}`, {
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
            overwrite: false
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
          confirmIcon: "fa-file-circle-check",
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
    setStatus(`Saved ${payload.file} to markdowns folder.`, "success");
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
    title: mode === "hard" ? "Hard delete this markdown?" : "Move markdown to recycle bin?",
    message: mode === "hard"
      ? `${file} will be moved into deleted_markdowns/hard.`
      : `${file} will be moved into the recycle bin and can be restored later.`,
    confirmLabel: mode === "hard" ? "Hard Delete" : "Move To Bin",
    confirmIcon: mode === "hard" ? "fa-trash" : "fa-trash-can",
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

async function hardDeleteDeletedDocumentByFile(file) {
  if (!state.isRecycleBinMode || !file) {
    setStatus("Select a recycle bin markdown to hard delete.", "error");
    return;
  }

  const shouldProceed = await requestConfirmation({
    title: "Move recycle-bin markdown to hard archive?",
    message: "This keeps the file in storage but moves it to deleted_markdowns/hard and removes it from recycle bin view.",
    confirmLabel: "Move To Hard Archive",
    confirmIcon: "fa-box-archive",
    tone: "danger"
  });

  if (!shouldProceed) {
    setStatus("Hard delete cancelled.", "neutral");
    return;
  }

  try {
    const payload = await requestJson(`/api/recycle-bin/${encodeURIComponent(file)}/hard-delete`, {
      method: "POST"
    });

    state.contentCache.delete(file);
    await refreshDeletedDocs({ preserveSearch: true });
    setStatus(payload.message || `${payload.originalFile} moved to hard archive.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function initialize() {
  setMeta("Loading documents...");
  mountMatchNavToViewportLayer();
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
    showEmptyState("Document loading failed", error.message, "fa-triangle-exclamation");
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

elements.searchInput.addEventListener("input", handleSearchEvent);
elements.searchInput.addEventListener("search", handleSearchEvent);
elements.searchInput.addEventListener("change", handleSearchEvent);

elements.searchInput.addEventListener("focus", () => {
  if (elements.searchInput.value.trim()) {
    applySearch(elements.searchInput.value);
  }
});

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

elements.matchPrevBtn.addEventListener("click", async () => {
  await navigateMatches(-1, state.jumpQuery);
});

elements.matchNextBtn.addEventListener("click", async () => {
  await navigateMatches(1, state.jumpQuery);
});

elements.matchCloseBtn.addEventListener("click", () => {
  exitSearchMode();
});

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

elements.createFolderBtn.addEventListener("click", () => {
  openFolderModal({ mode: "create" });
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
      setStatus("Recycle bin refreshed.", "success");
    } else {
      await refreshDocs({ preserveSearch: true });
      setStatus("Document list refreshed.", "success");
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.toggleRecycleBinBtn.addEventListener("click", async () => {
  try {
    state.isRecycleBinMode = !state.isRecycleBinMode;
    syncModeUI();
    resetJumpNavigation();

    if (state.isRecycleBinMode) {
      await refreshDeletedDocs({ preserveSearch: false });
      setStatus("Recycle bin opened.", "success");
    } else {
      await refreshDocs({ preserveSearch: false });
      setStatus("Returned to markdowns.", "neutral");
    }
  } catch (error) {
    state.isRecycleBinMode = !state.isRecycleBinMode;
    syncModeUI();
    setStatus(error.message, "error");
  }
});

elements.softDeleteDocBtn.addEventListener("click", () => {
  deleteCurrentDocument("soft");
});

elements.hardDeleteDocBtn.addEventListener("click", () => {
  if (state.isRecycleBinMode) {
    hardDeleteCurrentDeletedDocument();
    return;
  }

  deleteCurrentDocument("hard");
});

elements.restoreDocBtn.addEventListener("click", () => {
  restoreCurrentDeletedDocument();
});

elements.toggleSidebar.addEventListener("click", () => {
  setNavOpen(!elements.appShell.classList.contains("nav-open"));
});

elements.sidebarOverlay.addEventListener("click", () => {
  setNavOpen(false);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.confirmOpen) {
    event.preventDefault();
    resolveConfirmDialog(false);
    return;
  }



  if (event.key === "Escape" && elements.appShell.classList.contains("nav-open")) {
    setNavOpen(false);
  }

  if (event.key === "Escape" && state.folderModalOpen) {
    event.preventDefault();
    closeFolderModal();
    return;
  }

  if (event.key === "Escape" && state.editorOpen) {
    void requestEditorClose();
    return;
  }

  if (event.key === "Escape" && state.searchPanelOpen) {
    setSuperSearchOpen(false);
  }
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
  uploadMarkdown(file);
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
  void renderEditorPreview();
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
  window.scrollTo({ top: 0, behavior: "smooth" });
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

initialize();
