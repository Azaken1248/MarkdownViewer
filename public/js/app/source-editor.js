/* The source editor: the modal you type Markdown into.
 *
 * Everything about the window itself lives here — opening it on a file or on a
 * blank one, the Write / Preview tabs, the live preview and the scroll that
 * keeps the two panes together, and whether what is in it has been changed.
 * Saving is next door, in AppEditorSave, because a save reaches out to the
 * server and back into the document list, and this file reaches nowhere.
 */
(function (global) {

const { docName, compareNames, isDiagramFile, toMermaidMarkdown } = global.AppText;
const { elements } = global.AppDom;
const { state } = global.AppState;
const { enterModalLayer, exitModalLayer } = global.AppModal;
const { syncBodyLock } = global.AppShell;
const {
  renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, destroyPanZoomInstances
} = global.AppRender;

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


global.AppSourceEditor = {
  EDITOR_TABS_QUERY, startNewDocument, openEditor, closeEditor, isEditorDirty,
  renderEditorPreview, renderEditorPreviewText, scheduleEditorPreview,
  syncEditorPaneScroll, syncEditorFolderPicker, syncEditorTabs, selectEditorTab,
  editorTabsActive
};

})(typeof window === "undefined" ? globalThis : window);
