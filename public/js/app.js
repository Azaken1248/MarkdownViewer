const elements = {
  appShell: document.getElementById("appShell"),
  toggleSidebar: document.getElementById("toggleSidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  refreshDocs: document.getElementById("refreshDocs"),
  uploadTrigger: document.getElementById("uploadTrigger"),
  uploadInput: document.getElementById("uploadInput"),
  newDocBtn: document.getElementById("newDocBtn"),
  editDocBtn: document.getElementById("editDocBtn"),
  editCurrentDocBtn: document.getElementById("editCurrentDocBtn"),
  activeDocLabel: document.getElementById("activeDocLabel"),
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
  editorPreview: document.getElementById("editorPreview")
};

const state = {
  docs: [],
  filteredDocs: [],
  contentCache: new Map(),
  activeFile: null,
  editorMode: "create",
  editorFile: null,
  editorOpen: false,
  mermaidReady: false,
  panZoomCounter: 0,
  searchResults: [],
  searchPanelOpen: false
};

const MOBILE_BREAKPOINT = 920;
const SUPERSEARCH_LIMIT = 8;

marked.setOptions({
  gfm: true,
  breaks: false,
  mangle: false,
  headerIds: true
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
  const file = normalize(doc.file);
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

function buildSuperSearchMatches(query) {
  const normalizedQuery = normalize(query).trim();
  const tokens = tokenizeSearchQuery(normalizedQuery);
  const searchTerms = [...new Set([normalizedQuery, ...tokens].filter(Boolean))];

  if (!normalizedQuery) {
    return { matches: [], searchTerms };
  }

  const matches = [];
  for (const doc of state.docs) {
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
        <span class="supersearch-item-file">${highlightMatches(doc.file, searchTerms)}</span>
        <span class="supersearch-item-snippet">${highlightMatches(doc.snippet, searchTerms)}</span>
      </button>
    </li>
  `).join("");

  elements.superSearchList.querySelectorAll(".supersearch-item").forEach((button) => {
    button.addEventListener("click", () => {
      const file = button.getAttribute("data-file");
      if (!file) {
        return;
      }

      openDocument(file, true);
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
  const shouldLock = elements.appShell.classList.contains("nav-open") || state.editorOpen;
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
    return;
  }

  elements.activeDocLabel.innerHTML = `<i class="fa-solid fa-file-lines"></i>${escapeHtml(fileName)}`;
  elements.editCurrentDocBtn.disabled = false;
  elements.dockEdit.disabled = false;
}

function setStatus(message, tone = "neutral") {
  elements.statusMsg.textContent = message || "";
  elements.statusMsg.dataset.tone = tone;
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

async function loadDocContent(file) {
  if (state.contentCache.has(file)) {
    return state.contentCache.get(file);
  }

  const payload = await requestJson(`/api/docs/${encodeURIComponent(file)}`);
  const content = String(payload.content || "");
  state.contentCache.set(file, content);
  return content;
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
  const unsafeHtml = marked.parse(markdown || "");
  return DOMPurify.sanitize(unsafeHtml);
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
      window.hljs.highlightElement(codeNode);
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
    return;
  }

  await waitForNextFrame();
  promoteMermaidCodeBlocks(root);
  await waitForNextFrame();
  const nodes = root.querySelectorAll(".mermaid");
  if (nodes.length === 0) {
    highlightCodeBlocks(root);
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
    const escapedFile = escapeHtml(doc.file);
    const tags = `
      <span class=\"tag-chip\"><i class=\"fa-regular fa-clock\"></i>${escapeHtml(formatDate(doc.updatedAt))}</span>
      <span class=\"tag-chip muted\"><i class=\"fa-solid fa-weight-hanging\"></i>${escapeHtml(formatBytes(doc.size))}</span>
    `;

    button.innerHTML = `
      <span class="doc-head">
        <span class="doc-title"><i class="fa-solid ${escapeHtml(doc.icon)}"></i>${escapedTitle}</span>
        <span class="doc-file">${escapedFile}</span>
      </span>
      <span class="doc-tags">${tags}</span>
    `;

    button.addEventListener("click", () => {
      openDocument(doc.file, true);
      closeSidebarOnMobile();
    });

    li.appendChild(button);
    elements.docList.appendChild(li);
  }
}

function applySearch(query) {
  const rawQuery = String(query || "");
  const q = normalize(rawQuery).trim();
  const { matches, searchTerms } = buildSuperSearchMatches(rawQuery);
  renderSuperSearchPanel(rawQuery, matches, searchTerms);

  if (!q) {
    state.filteredDocs = [...state.docs];
    setMeta(`${state.filteredDocs.length} document(s)`);
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

  setMeta(`${state.filteredDocs.length} result(s) for "${rawQuery.trim()}"`);
  renderDocList();
}

async function openDocument(file, pushHash) {
  try {
    const doc = state.docs.find((candidate) => candidate.file === file);
    if (!doc) {
      return;
    }

    const rawContent = await loadDocContent(file);
    const renderedSource = isDiagramFile(file)
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

    document.title = `${doc.title} | Cart Docs Viewer`;
    if (pushHash) {
      window.location.hash = encodeURIComponent(file);
    }

    setStatus(`Viewing ${doc.file}`, "neutral");
  } catch (error) {
    showEmptyState("Could not load this markdown", error.message, "fa-triangle-exclamation");
    setStatus(error.message, "error");
  }
}

async function renderEditorPreview() {
  const source = state.editorMode === "edit" && isDiagramFile(state.editorFile)
    ? toMermaidMarkdown(elements.editorInput.value)
    : elements.editorInput.value;

  elements.editorPreview.innerHTML = renderMarkdown(source);
  await renderMermaidBlocks(elements.editorPreview);
  highlightCodeBlocks(elements.editorPreview);
}

function openEditor({ mode, fileName, content }) {
  state.editorMode = mode;
  state.editorFile = mode === "edit" ? fileName : null;
  state.editorOpen = true;

  elements.editorFileName.value = fileName || "";
  elements.editorFileName.disabled = mode === "edit";
  elements.editorInput.value = content || "";
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

        const shouldOverwrite = window.confirm(`${fileName} already exists. Replace it with this content?`);
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
  updateActiveDocUI(null);
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

function handleSearchEvent(event) {
  applySearch(event.target.value);
}

elements.searchInput.addEventListener("input", handleSearchEvent);
elements.searchInput.addEventListener("search", handleSearchEvent);
elements.searchInput.addEventListener("change", handleSearchEvent);

elements.searchInput.addEventListener("focus", () => {
  if (elements.searchInput.value.trim()) {
    applySearch(elements.searchInput.value);
  }
});

elements.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && state.searchResults.length > 0) {
    event.preventDefault();
    openDocument(state.searchResults[0].file, true);
    closeSidebarOnMobile();
    setSuperSearchOpen(false);
    elements.searchInput.blur();
  }
});

elements.clearSearchBtn.addEventListener("click", () => {
  elements.searchInput.value = "";
  applySearch("");
  elements.searchInput.focus();
});

elements.refreshDocs.addEventListener("click", async () => {
  try {
    await refreshDocs({ preserveSearch: true });
    setStatus("Document list refreshed.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.toggleSidebar.addEventListener("click", () => {
  setNavOpen(!elements.appShell.classList.contains("nav-open"));
});

elements.sidebarOverlay.addEventListener("click", () => {
  setNavOpen(false);
});

window.addEventListener("keydown", (event) => {
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

elements.saveDocBtn.addEventListener("click", () => {
  saveEditorDocument();
});

elements.closeEditorBtn.addEventListener("click", () => {
  closeEditor();
});

elements.editorBackdrop.addEventListener("click", () => {
  closeEditor();
});

elements.dockOpenDocs.addEventListener("click", () => {
  setNavOpen(true);
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
