const elements = {
  appShell: document.getElementById("appShell"),
  toggleSidebar: document.getElementById("toggleSidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  sidebarTitle: document.getElementById("sidebarTitle"),
  refreshDocs: document.getElementById("refreshDocs"),
  toggleRecycleBinBtn: document.getElementById("toggleRecycleBinBtn"),
  uploadTrigger: document.getElementById("uploadTrigger"),
  uploadInput: document.getElementById("uploadInput"),
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
  confirmProceedBtn: document.getElementById("confirmProceedBtn")
};

const state = {
  docs: [],
  deletedDocs: [],
  isRecycleBinMode: false,
  filteredDocs: [],
  contentCache: new Map(),
  activeFile: null,
  editorMode: "create",
  editorFile: null,
  editorOpen: false,
  mermaidReady: false,
  panZoomCounter: 0,
  searchResults: [],
  searchPanelOpen: false,
  jumpHighlightTimer: null,
  jumpQuery: "",
  jumpTerms: [],
  jumpMatchIndex: -1,
  jumpMatchCount: 0,
  jumpMarkedNodes: [],
  jumpMatchFile: null,
  openDocumentRequestId: 0,
  editorScrollSyncLock: false,
  confirmOpen: false,
  confirmResolver: null
};

const MOBILE_BREAKPOINT = 920;
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
  return filename
    .replace(/\.md$/i, "")
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
  const content = normalize(state.contentCache.get(doc.file));

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

    const content = String(state.contentCache.get(doc.file) || "");
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
    elements.superSearchList.innerHTML = "";
    elements.superSearchCount.textContent = "0 results";
    setSuperSearchOpen(false);
    return;
  }

  const topResults = matches.slice(0, SUPERSEARCH_LIMIT);
  state.searchResults = topResults;
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
  const shouldLock = elements.appShell.classList.contains("nav-open") || state.editorOpen || state.confirmOpen;
  document.body.classList.toggle("lock-scroll", shouldLock);
}

function inferIcon(fileName) {
  const value = normalize(fileName);
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
    elements.editCurrentDocBtn.disabled = true;
    elements.dockEdit.disabled = true;
    elements.softDeleteDocBtn.disabled = true;
    elements.hardDeleteDocBtn.disabled = false;
    elements.restoreDocBtn.disabled = false;
    return;
  }

  elements.activeDocLabel.innerHTML = `<i class="fa-solid fa-file-lines"></i>${escapeHtml(fileName)}`;
  elements.editCurrentDocBtn.disabled = false;
  elements.dockEdit.disabled = false;
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

  state.docs = (payload.docs || []).map((doc) => ({
    file: doc.file,
    title: doc.title || filenameToTitle(doc.file),
    size: Number(doc.size || 0),
    updatedAt: doc.updatedAt || "",
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
    icon: "fa-trash-can"
  }));
}

async function loadDocContent(file) {
  if (state.contentCache.has(file)) {
    return state.contentCache.get(file);
  }

  const payload = await requestJson(`/api/docs/${encodeURIComponent(file)}`);
  const content = String(payload.content || "");
  state.contentCache.set(file, content);
  return content;
}

async function loadDeletedDocContent(entryFile) {
  if (state.contentCache.has(entryFile)) {
    return state.contentCache.get(entryFile);
  }

  const payload = await requestJson(`/api/recycle-bin/${encodeURIComponent(entryFile)}/content`);
  const content = String(payload.content || "");
  state.contentCache.set(entryFile, content);
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

  if (inRecycleBin) {
    elements.hardDeleteDocBtn.innerHTML = '<i class="fa-solid fa-box-archive"></i> Move To Hard Archive';
    elements.hardDeleteDocBtn.setAttribute("aria-label", "Move recycle bin markdown to hard archive");
    elements.hardDeleteDocBtn.title = "Move to deleted_markdowns/hard";
  } else {
    elements.hardDeleteDocBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Hard Delete';
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

  for (const doc of docs) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `doc-item${state.activeFile === doc.file ? " active" : ""}`;

    const escapedTitle = escapeHtml(doc.title);
    const escapedFile = escapeHtml(state.isRecycleBinMode ? (doc.originalFile || doc.file) : doc.file);
    const timeLabel = state.isRecycleBinMode ? "fa-solid fa-clock-rotate-left" : "fa-regular fa-clock";
    const tags = `
      <span class=\"tag-chip\"><i class=\"${timeLabel}\"></i>${escapeHtml(formatDate(doc.updatedAt))}</span>
      <span class=\"tag-chip muted\"><i class=\"fa-solid fa-weight-hanging\"></i>${escapeHtml(formatBytes(doc.size))}</span>
    `;

    button.innerHTML = `
      <span class="doc-head">
        <span class="doc-title"><i class="fa-solid ${escapeHtml(doc.icon)}"></i>${escapedTitle}</span>
        <span class="doc-file">${escapedFile}</span>
      </span>
      <span class="doc-tags">${tags}</span>
    `;

    button.addEventListener("click", async () => {
      if (state.isRecycleBinMode) {
        await openRecycleBinDocument(doc.file);
      } else {
        await openDocument(doc.file, true, {
          jumpQuery: elements.searchInput.value
        });
      }

      closeSidebarOnMobile();
    });

    li.appendChild(button);
    elements.docList.appendChild(li);
  }
}

function applySearch(query) {
  const rawQuery = String(query || "");
  const q = normalize(rawQuery).trim();
  const currentDocs = getCurrentDocsCollection();

  if (q !== normalize(state.jumpQuery)) {
    resetJumpNavigation();
  }

  const { matches, searchTerms } = buildSuperSearchMatches(rawQuery, currentDocs);
  renderSuperSearchPanel(rawQuery, matches, searchTerms);

  if (!q) {
    state.filteredDocs = [...currentDocs];
    setMeta(state.isRecycleBinMode
      ? `${state.filteredDocs.length} deleted document(s)`
      : `${state.filteredDocs.length} document(s)`);
    renderDocList();
    return;
  }

  state.filteredDocs = matches.map((match) => ({
    file: match.file,
    title: match.title,
    size: match.size,
    updatedAt: match.updatedAt,
    icon: match.icon
  }));

  const contextLabel = state.isRecycleBinMode ? "recycle bin" : "documents";
  setMeta(`${state.filteredDocs.length} result(s) in ${contextLabel} for "${rawQuery.trim()}"`);
  renderDocList();
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

    if (file === state.activeFile && elements.docContent.classList.contains("visible")) {
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

    const rawContent = await loadDocContent(file);
    if (requestId !== state.openDocumentRequestId) {
      return;
    }

    const renderedSource = isDiagramFile(file)
      ? toMermaidMarkdown(rawContent)
      : rawContent;
    const safeHtml = renderMarkdown(renderedSource);

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

    showEmptyState("Could not load this markdown", error.message, "fa-triangle-exclamation");
    setStatus(error.message, "error");
  }
}

async function openRecycleBinDocument(file) {
  try {
    const doc = state.deletedDocs.find((candidate) => candidate.file === file);
    if (!doc) {
      return;
    }

    const rawContent = await loadDeletedDocContent(file);
    const renderedSource = isDiagramFile(doc.originalFile || doc.file)
      ? toMermaidMarkdown(rawContent)
      : rawContent;
    const safeHtml = renderMarkdown(renderedSource);

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
    showEmptyState("Could not load deleted markdown", error.message, "fa-triangle-exclamation");
    setStatus(error.message, "error");
  }
}

async function refreshDeletedDocs({ openFile = null, preserveSearch = true } = {}) {
  setMeta("Loading recycle bin...");

  await fetchDeletedDocs();
  await hydrateDeletedSearchContent();

  const query = preserveSearch ? elements.searchInput.value : "";
  if (!preserveSearch) {
    elements.searchInput.value = "";
  }

  applySearch(query);

  if (state.deletedDocs.length === 0) {
    state.activeFile = null;
    updateActiveDocUI(null);
    showEmptyState("Recycle bin is empty", "Soft-deleted markdowns will appear here.", "fa-trash-can");
    setStatus("Recycle bin is empty.", "neutral");
    return;
  }

  const target = state.deletedDocs.find((doc) => doc.file === openFile)?.file
    || state.deletedDocs.find((doc) => doc.file === state.activeFile)?.file
    || state.deletedDocs[0].file;

  await openRecycleBinDocument(target);
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
  elements.editorModal.classList.remove("open");
  elements.editorModal.setAttribute("aria-hidden", "true");
  syncBodyLock();
}

async function refreshDocs({ openFile = null, preserveSearch = true } = {}) {
  setMeta("Loading documents...");

  await fetchDocs();

  state.contentCache.clear();
  await hydrateSearchContent();

  const query = preserveSearch ? elements.searchInput.value : "";
  if (!preserveSearch) {
    elements.searchInput.value = "";
  }

  applySearch(query);

  if (state.docs.length === 0) {
    state.activeFile = null;
    updateActiveDocUI(null);
    showEmptyState("No markdowns yet", "Upload a markdown or create one in the live editor.", "fa-file-circle-plus");
    setStatus("No markdown files in markdowns folder yet.", "neutral");
    return;
  }

  const target = state.docs.find((doc) => doc.file === openFile)?.file
    || state.docs.find((doc) => doc.file === state.activeFile)?.file
    || state.docs[0].file;

  await openDocument(target, false);
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

  try {
    const content = await loadDocContent(state.activeFile);
    openEditor({
      mode: "edit",
      fileName: state.activeFile,
      content
    });
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
  applySearch(event.target.value);
}

function exitSearchMode() {
  const hadQuery = Boolean(state.jumpQuery.trim() || elements.searchInput.value.trim());
  elements.searchInput.value = "";
  applySearch("");
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

  if (state.searchResults.length > 0) {
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

let docSwipeStart = null;

elements.docContent.addEventListener("touchstart", (event) => {
  if (!state.jumpQuery.trim() || event.touches.length !== 1) {
    docSwipeStart = null;
    return;
  }

  if (event.target instanceof Element
    && event.target.closest("a, button, input, textarea, select, pre, code, .mermaid-block, .svg-pan-zoom-control")) {
    docSwipeStart = null;
    return;
  }

  const touch = event.touches[0];
  docSwipeStart = {
    x: touch.clientX,
    y: touch.clientY
  };
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

  if (event.key === "Escape" && state.editorOpen) {
    closeEditor();
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
  closeEditor();
});

elements.editorBackdrop.addEventListener("click", () => {
  closeEditor();
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
