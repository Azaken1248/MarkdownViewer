/* The app.
 *
 * Everything below is inside this function, so none of it is a property of the
 * page. What the file offers is the one object at the bottom, named the way
 * every other module on the page names itself.
 *
 * The body is not indented into the wrapper. Indenting it would rewrite nine
 * thousand lines to say nothing, and would change the contents of every
 * multi-line template literal in the file — the strings this app draws itself
 * out of. The wrapper is one line at each end, and it stays that way while the
 * sections inside it move out one at a time.
 */
(function (global) {

// The modules this file is assembled from.
//
// Named locally, in the order the page loads them, so that every use below
// reads the way it always has — the module a function lives in is a fact
// about the source tree, not something the call sites should have to spell.
const {
  UPLOADABLE_EXTENSIONS, normalize, isNotebookFile,
  docUrl, docName, compareNames, ensureDocFilename, isDiagramFile,
  toMermaidMarkdown
} = AppText;
const { elements } = AppDom;
const { state } = AppState;
const { requestJson, can } = AppApi;
const {
  getDocByFile
} = AppLibrary;
const {
  SUPERSEARCH_LIMIT, buildJumpSearchTerms
} = AppSearch;
const {
  documentPath, viewFromLocation, showLinksInUrl, fileFromLocation,
  showDocumentInUrl
} = AppLocation;
const {
  setSelection, clearSelection, updateSelectionUI
} = AppSelection;
const { bindTooltips } = AppTooltips;
const { enterModalLayer, exitModalLayer } = AppModal;
const {
  MOBILE_BREAKPOINT, setNavOpen, closeSidebarOnMobile, syncBodyLock, setMeta, syncFilterChip
} = AppShell;
const {
  notify, setStatus, requestConfirmation, resolveConfirmDialog, askAboutUnsavedWork
} = AppNotify;
const {
  renderLinks, refreshLinks, submitLink, openLinkModal, closeLinkModal,
  showLinksLoading, linksNeedingIcons, backfillLinkIcons
} = AppLinks;
const {
  openShareModal, closeShareModal, createShareLink,
  revokeShareLink, updateShareButton
} = AppShare;
const { imagesFromTransfer } = AppPastedImages;
const { bindThemeToggle } = AppTheme;
const { bindNotebookExecution } = AppNotebook;
const { replaceRangeInTextarea, insertIntoTextarea, replaceInTextarea } = AppTextarea;
const { persistCollapsedFolders } = AppFolderCollapse;
const { updateJumpNavigationUI, resetJumpNavigation, moveToAdjacentJumpMatch } = AppJump;
const { setSuperSearchOpen, syncSearchInputState, renderSuperSearchPanel } = AppSearchPanel;
const { revealFolderInTree, updateActiveDocUI } = AppViewerHeader;
const {
  applySession, refreshSession, openLoginModal, closeLoginModal,
  submitLogin, signOut, openPasswordModal, closePasswordModal, submitPasswordChange
} = AppSession;
const { openUsersModal, closeUsersModal, submitNewUser } = AppUsers;
const { openFolderModal, closeFolderModal } = AppFolderModal;
const {
  renderMarkdown, highlightCodeBlocks,
  renderMermaidBlocks, destroyPanZoomInstances, bindWheelZoomModifier
} = AppRender;
const { fetchDocs, loadDocContent, loadDeletedDocContent, syncModeUI, hydrateSearchContent, showEmptyState, showLoadingState, showNoDocumentOpen } = AppDocs;
const { toggleTaskCheckbox } = AppTaskLists;
const { attachImagesToSource, attachImagesToPage } = AppPageImages;
const { cutFiles, pasteIntoFolder } = AppClipboard;
const { deleteFiles } = AppDeletion;
const { closeContextMenu, openContextMenu, buildDocContextItems, buildFolderContextItems } = AppContextMenu;
const { canDropOnFolder, renderDocList, handleTreeKeydown } = AppTree;
const { applySearch } = AppSearching;
const { openDocument, openRecycleBinDocument, refreshDeletedDocs } = AppOpening;
const { deleteCurrentDocument, restoreCurrentDeletedDocument, hardDeleteCurrentDeletedDocument } = AppDocActions;
const { moveDocumentToFolder, handleFolderModalAction } = AppFolderOps;
const { pageEditActive } = AppPageBlocks;
const { diagramStashKey, stashDocument, takeStashedDocument } = AppPageEmbeds;
const { insertPageBlock } = AppPageInsert;
const { pageHistory, commitPageHistory, undoPageEdit, redoPageEdit } = AppPageHistory;
const { applyVisualBlockFormat, collectPageMarkdown, isPageEditDirty, syncPageEditOffset, startPageEdit, savePageEdit, cancelPageEdit, openSourceFromPageEdit, editableBlockFromSelection, applyVisualCommand } = AppPageEdit;

const MATCH_SWIPE_THRESHOLD = 56;
const MATCH_SWIPE_VERTICAL_LIMIT = 42;

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

async function requestEditorClose() {
  if (!isEditorDirty()) {
    closeEditor();
    return;
  }

  const answer = await askAboutUnsavedWork(
    "This document has edits that have not been saved. Closing the editor will lose them."
  );

  if (answer === "alt") {
    // Saves and closes on its own. A save that failed leaves the editor open
    // with the text still in it, which is the only safe place for it to be.
    await saveEditorDocument();
    return;
  }

  if (answer) {
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

// The source editor's half of the overlapping-saves problem; see pageSaveChain.
let editorSaveChain = Promise.resolve();

function saveEditorDocument(options) {
  const run = () => runEditorSave(options);
  editorSaveChain = editorSaveChain.then(run, run);
  return editorSaveChain;
}

/* The same settling for the source editor, and the same reason for being a
 * function of its own — see settlePageSave.
 *
 * Staying open means this is now an edit of a file that exists, whatever it was
 * when the editor opened: without that, a second Ctrl+S on a new document would
 * try to create it again and be told it already exists.
 */
function settleEditorSave(file, content) {
  if (!state.editorOpen) {
    return;
  }

  state.editorMode = "edit";
  state.editorFile = file;
  state.editorInitialContent = content;
  state.editorInitialFileName = elements.editorFileName.value;
  elements.saveDocBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> Save Changes';
}

// As on the page: Ctrl+S writes the file and leaves you in the text, the Save
// button finishes. See savePageEdit.
async function runEditorSave({ close = true } = {}) {
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

    if (close) {
      closeEditor();
      await refreshDocs({ openFile: payload.file, preserveSearch: true });
      setStatus(`Saved ${payload.file}.`, "success");
      return;
    }

    settleEditorSave(payload.file, content);

    // The library and the document under the modal are redrawn so they agree
    // with what was just written. Neither contains the textarea, so the caret
    // and the scroll of the text being typed are left alone by it.
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

    // /links, typed or bookmarked. The documents are not fetched at all until
    // something asks for them: this address is not about them, and the first
    // press of Files loads the library then.
    if (viewFromLocation() === "links") {
      state.viewMode = "links";
      syncModeUI();
      showLinksLoading();
      await refreshLinks();
      return;
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

  // Everything below opens a document. In the links pane the filtering has
  // already happened as the words were typed, so Enter has nothing left to do.
  if (state.viewMode === "links") {
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
    await MarkdownCore.copyText(elements.shareUrlInput.value);
    notify("Share link copied.", "success");
  } catch {
    // Both clipboard paths were refused; the text is already selected, so
    // Ctrl+C still works.
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
    action: () => setSelection(state.visibleFileOrder)
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
    if (state.viewMode === "links") {
      await refreshLinks();
      setStatus("Saved links refreshed.", "success");
    } else if (state.isRecycleBinMode) {
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

/* A switch that has to wait says so.
 *
 * Only ever set around a real round trip: a move that is already in memory
 * finishes in the same frame, and a spinner that appears and vanishes inside
 * one frame is a flicker rather than an answer.
 */
function setPlaceBusy(place, busy) {
  const button = place === "links" ? elements.placeLinksBtn : elements.placeDocsBtn;
  if (!button) {
    return;
  }

  const icon = button.querySelector("i");
  if (icon) {
    icon.className = busy
      ? "ph ph-circle-notch"
      : place === "links" ? "ph ph-link-simple" : "ph ph-files";
  }

  button.classList.toggle("is-busy", busy);
  if (busy) {
    button.setAttribute("aria-busy", "true");
  } else {
    button.removeAttribute("aria-busy");
  }
}

/* The one search box goes with you, and each place keeps its own query.
 *
 * Called on the way through, while both the place being left and the place
 * being entered are still known — the box is read for one and written for the
 * other in the same breath, so neither query can be lost to a half-done swap.
 */
function stashSearchQuery(from, to) {
  const slot = (mode) => (mode === "links" ? "links" : "docs");

  state.searchQueries[slot(from)] = elements.searchInput.value;
  state.searchMetas[slot(from)] = elements.searchMeta.textContent;

  elements.searchInput.value = state.searchQueries[slot(to)] || "";
  syncSearchInputState(elements.searchInput.value);
}

/* The sidebar tree, redrawn from the list already in memory.
 *
 * No search runs: state.filteredDocs is exactly what it was before the links
 * pane went over it, and the line under the title was put down together with
 * the query it belongs to.
 */
function restoreDocumentList() {
  renderDocList();
  setMeta(state.searchMetas.docs || `${state.filteredDocs.length} document(s)`);
}

/* Put the document view back exactly as the links pane found it.
 *
 * Nothing was torn down to show the links: syncModeUI only takes the "visible"
 * class off the article, so the rendered markdown, its diagrams and its
 * pan-zoom instances are all still in the DOM. Coming back is that class going
 * back on, the tree redrawn, and the scroll put back — no request, and nothing
 * rendered twice.
 *
 * It used to refetch the library, re-read every document to warm the search
 * cache, and force-reload and re-render the open one, which is a long way to
 * go to arrive where you already were.
 */
function restoreDocumentView() {
  restoreDocumentList();

  if (!state.activeFile || !elements.docContent.innerHTML) {
    showNoDocumentOpen();
    return;
  }

  elements.docContent.classList.add("visible");
  elements.emptyState.style.display = "none";
  updateActiveDocUI(state.activeFile);

  if (elements.viewer) {
    elements.viewer.scrollTop = state.viewerScrollTop;
  }
}

/* Undo a move that could not be made.
 *
 * Its own function because everything it restores was read before the await
 * that failed. A rollback that read the state it is undoing would be putting
 * back whatever the failed move had already written.
 */
function rollbackPlace(mode, query, message) {
  state.viewMode = mode;
  elements.searchInput.value = query;
  syncSearchInputState(query);
  syncModeUI();
  setStatus(message, "error");
}

/* Move to one of the two halves of the library.
 *
 * Not a toggle. Pressing Links while already among the links does nothing,
 * which is the only thing a control that also says where you are can mean. The
 * recycle bin and the archive keep their toggles below: those are a detour
 * from the documents, not a place you live.
 *
 * `push` is false when the browser did the navigating, so going back does not
 * push the entry it just came from.
 */
async function goToPlace(place, { push = true, openFile = null } = {}) {
  const target = place === "links" ? "links" : "docs";

  if (state.viewMode === target) {
    return true;
  }

  // Leaving takes the document being edited off the screen, so it has to ask
  // the same question closing the editor would — and before anything else, so
  // nothing is written back based on a view that moved while the question was
  // on screen.
  if (pageEditActive()) {
    const left = await cancelPageEdit({ restore: false });
    if (!left) {
      return false;
    }
  }

  const previousMode = state.viewMode;
  const previousQuery = elements.searchInput.value;

  // Read before syncModeUI hides the article: once it is display:none the
  // browser has forgotten where it was scrolled to.
  if (previousMode !== "links" && elements.viewer) {
    state.viewerScrollTop = elements.viewer.scrollTop;
  }

  try {
    state.viewMode = target;
    stashSearchQuery(previousMode, target);
    syncModeUI();
    resetJumpNavigation();

    if (target === "links") {
      if (push) {
        showLinksInUrl();
      }

      state.linkFilter = elements.searchInput.value;

      // Already in memory: render and be done. Only a first visit waits, and
      // only a first visit says it is waiting.
      if (state.linksLoaded) {
        renderLinks();
        return true;
      }

      setPlaceBusy("links", true);
      showLinksLoading();

      try {
        await refreshLinks();
      } finally {
        setPlaceBusy("links", false);
      }

      return true;
    }

    if (push) {
      // Back where the document was. The address and the screen agree from
      // the first frame rather than after a round trip.
      showDocumentInUrl(state.activeFile);
    }

    // The library is already loaded and the document is still rendered under
    // the links pane, so there is nothing to fetch and nothing to draw twice.
    //
    // Only from the links. The recycle bin and the archive replaced the tree
    // and the filtered list with deleted entries, so coming back from one of
    // those is a real reload however much is in memory.
    const wanted = openFile || state.activeFile;
    if (previousMode === "links" && state.docs.length > 0) {
      // Unless Back landed on a different document than the one that was open,
      // which is one request at most and usually none — its content is already
      // in the cache.
      if (wanted && wanted !== state.activeFile && state.docs.some((doc) => doc.file === wanted)) {
        restoreDocumentList();
        await openDocument(wanted, false);
        return true;
      }

      restoreDocumentView();
      return true;
    }

    // Nothing loaded: this tab booted straight into /links, or came back to a
    // document by name. That is a real wait, so it looks like one.
    setPlaceBusy("docs", true);
    setMeta("Loading documents...");
    showLoadingState("Opening the library", "Fetching your documents.");

    try {
      await refreshDocs({ openFile, preserveSearch: true });
    } finally {
      setPlaceBusy("docs", false);
    }

    return true;
  } catch (error) {
    rollbackPlace(previousMode, previousQuery, error.message);
    return false;
  }
}

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

    // The recycle bin and the archive can be opened from the links pane, which
    // means this is also a way out of it: the search box goes back to being
    // about documents, and the address stops claiming to be /links.
    if (previousMode === "links") {
      stashSearchQuery("links", "docs");
      showDocumentInUrl(state.activeFile);
    }

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

/* The switcher's two halves are real links, so they can be copied, opened in a
 * new tab and dropped in a bookmark. An ordinary click is handled in-page
 * instead: nothing here needs a reload, and a reload would throw away the
 * library that is already loaded. */
function bindPlaceButton(button, place) {
  button.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
      || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    void goToPlace(place);
  });
}

bindPlaceButton(elements.placeDocsBtn, "docs");
bindPlaceButton(elements.placeLinksBtn, "links");

elements.addLinkBtn.addEventListener("click", openLinkModal);
elements.closeLinkModalBtn.addEventListener("click", closeLinkModal);
elements.cancelLinkBtn.addEventListener("click", closeLinkModal);
elements.linkBackdrop.addEventListener("click", closeLinkModal);

elements.linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitLink();
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

/* The whole document, as markdown.
 *
 * Reads the same cache the renderer read, so the copy is the source the page
 * on screen was made from rather than a second fetch that could disagree with
 * it. If the cache has gone the document is fetched again — which is also the
 * path a document opened before a reload takes.
 */
async function copyActiveDocument() {
  const file = state.activeFile;
  if (!file) {
    notify("Open a document first.", "info");
    return;
  }

  let markdown = state.contentCache.get(file)?.content ?? "";

  if (!markdown) {
    try {
      markdown = state.isRecycleBinMode
        ? await loadDeletedDocContent(file)
        : await loadDocContent(file);
    } catch {
      notify("Could not read this document.", "error");
      return;
    }
  }

  try {
    await MarkdownCore.copyText(markdown);
    notify(`Copied ${docName(file)} as markdown.`, "success");
  } catch {
    notify("Your browser would not let this page use the clipboard.", "error");
  }
}

elements.copyDocBtn.addEventListener("click", () => {
  void copyActiveDocument();
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

  /* A diagram builder is an editor in its own right: it has its own undo, its
   * own Escape and its own selection. Every key it handles used to arrive here
   * as well, so Ctrl+Z inside a diagram undid the whole document — which threw
   * away the rendered block the builder was mounted in, and looked from the
   * outside like being thrown out of the builder.
   */
  // Escape leaves editing, and asks first if there is anything to lose.
  if (event.key === "Escape") {
    event.preventDefault();
    void cancelPageEdit();
    return;
  }

  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  const key = event.key.toLowerCase();

  // Saves where you stand. Leaving is the Save button's job, and Escape's.
  if (key === "s") {
    event.preventDefault();
    void savePageEdit({ exit: false });
    return;
  }

  // A source box and the language field are ordinary form controls, and their
  // own undo is character-accurate and keeps the caret exactly where it was.
  // Replacing it with a whole-document step would be a downgrade.
  const inFormControl = ["TEXTAREA", "INPUT"].includes(event.target?.tagName);

  if ((key === "z" || key === "y") && !inFormControl) {
    event.preventDefault();
    // Ctrl+Y and Ctrl+Shift+Z are the same request; both are in circulation and
    // neither is worth being right about at the author's expense.
    if (key === "y" || event.shiftKey) {
      redoPageEdit();
    } else {
      undoPageEdit();
    }
    return;
  }

  if (key === "k") {
    event.preventDefault();
    applyVisualCommand("link");
    return;
  }

  if (key === "e") {
    event.preventDefault();
    applyVisualCommand("code");
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

/* --- The source editor's shortcuts ----------------------------------------
 *
 * The same keys as the page editor, doing the same things, because which of the
 * two editors is open is not something anyone's fingers keep track of.
 *
 * Undo is deliberately absent: a textarea already has one, it is
 * character-accurate and it keeps the caret exactly. All that was ever wrong
 * with it here was that the app used to wipe it by assigning to .value — see
 * replaceRangeInTextarea.
 *
 * Bold and italic wrap the selection in markdown, and unwrap it when it is
 * already wrapped, so pressing Ctrl+B twice leaves the text as it was found
 * rather than as `****text****`.
 */
function toggleMarkdownWrap(area, marker, placeholder) {
  const start = area.selectionStart ?? 0;
  const end = area.selectionEnd ?? start;
  const selected = area.value.slice(start, end);
  const width = marker.length;

  // Already wrapped, either inside the selection or just outside it.
  if (selected.length >= width * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(width, -width);
    replaceRangeInTextarea(area, start, end, inner);
    area.setSelectionRange(start, start + inner.length);
    return;
  }

  if (area.value.slice(Math.max(0, start - width), start) === marker
    && area.value.slice(end, end + width) === marker) {
    replaceRangeInTextarea(area, start - width, end + width, selected);
    area.setSelectionRange(start - width, start - width + selected.length);
    return;
  }

  const text = selected || placeholder;
  replaceRangeInTextarea(area, start, end, `${marker}${text}${marker}`);
  // Leave the wrapped words selected so they can be typed straight over, which
  // is what an empty selection wrapped around a placeholder wants.
  area.setSelectionRange(start + width, start + width + text.length);
}

// Returns true when the key was one of these, so the caller knows whether to
// take it off the browser.
function applySourceShortcut(key) {
  const area = elements.editorInput;

  switch (key) {
    case "b":
      toggleMarkdownWrap(area, "**", "bold text");
      return true;
    case "i":
      toggleMarkdownWrap(area, "*", "italic text");
      return true;
    case "e":
      toggleMarkdownWrap(area, "`", "code");
      return true;
    case "k": {
      const start = area.selectionStart ?? 0;
      const end = area.selectionEnd ?? start;
      const label = area.value.slice(start, end) || "link text";
      const href = window.prompt("Link address", "https://");
      if (!href) {
        return true;
      }
      replaceRangeInTextarea(area, start, end, `[${label}](${href})`);
      area.setSelectionRange(start + 1, start + 1 + label.length);
      return true;
    }
    default:
      return false;
  }
}

// Bound on the modal rather than the textarea, so Ctrl+S saves from the
// filename field and the folder picker too — where it is at least as likely to
// be pressed, having just been typed in.
elements.editorModal.addEventListener("keydown", (event) => {
  if (!state.editorOpen || !(event.ctrlKey || event.metaKey)) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "s") {
    event.preventDefault();
    void saveEditorDocument({ close: false });
    return;
  }

  // The rest only mean anything in the text being written.
  if (event.target !== elements.editorInput) {
    return;
  }

  if (applySourceShortcut(key)) {
    event.preventDefault();
    scheduleEditorPreview();
  }
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

elements.confirmAltBtn.addEventListener("click", () => {
  resolveConfirmDialog("alt");
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
    if (state.viewMode === "links") {
      showLinksInUrl({ replace: true });
    } else {
      showDocumentInUrl(state.activeFile, { replace: true });
    }

    setStatus("Save or discard your changes before leaving this document.", "warning");
    return;
  }

  // Into or out of the saved links. The address already says where to be, so
  // this follows it rather than pushing another entry on top.
  const wantsLinks = viewFromLocation() === "links";
  if (wantsLinks !== (state.viewMode === "links")) {
    // Coming back to a document address opens that document, not whichever one
    // happened to be open when the links were entered.
    void goToPlace(wantsLinks ? "links" : "docs", { push: false, openFile: file });
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


/* What this file is, from outside.
 *
 * Nothing on the page reads it — app.js is the last script, and it calls its
 * own boot. This is the surface the tests drive, which is to say the operations
 * the interface performs, named in the source rather than fished out of scope
 * by a test that appends itself to the file.
 *
 * It shrinks as the sections below become modules of their own.
 */
global.App = {
  state, can, requestJson, applySession, refreshSession,
  openLoginModal, closeLoginModal, openPasswordModal, closePasswordModal,
  openShareModal, closeShareModal, updateShareButton,
  cutFiles, pasteIntoFolder, canDropOnFolder, deleteFiles,
  openContextMenu, closeContextMenu, buildDocContextItems, buildFolderContextItems,
  setUploadMenuOpen,
  openDocument, openRecycleBinDocument, refreshDocs, renderDocList,
  switchViewMode,
  restoreDocumentView, showEmptyState, showLoadingState, setPlaceBusy,
  renderSuperSearchPanel, syncFilterChip, applySearch, stashSearchQuery,
  hydrateSearchContent, SUPERSEARCH_LIMIT,
  requestEditorClose, isEditorDirty, closeEditor, openEditor,
  openEditorForCurrentDoc, saveEditorDocument, syncEditorTabs, selectEditorTab,
  startNewDocument, uploadFolder, uploadMarkdown, isUploadableFile,
  deleteDocumentByFile, openEditorForDocument,
  restoreDeletedDocumentByFile, restoreArchivedDocumentByFile,
  hardDeleteDeletedDocumentByFile, permanentlyDeleteArchivedDocument,
  scheduleEditorPreview,
  moveDocumentToFolder,
  startPageEdit, savePageEdit, cancelPageEdit, isPageEditDirty, pageEditActive,
  collectPageMarkdown, insertPageBlock, applyVisualCommand,
  undoPageEdit, redoPageEdit, commitPageHistory, pageHistory,
  openSourceFromPageEdit, insertIntoTextarea, replaceInTextarea,
  toggleMarkdownWrap, applySourceShortcut,
  renderLinks, refreshLinks, submitLink, openLinkModal, closeLinkModal,
  linksNeedingIcons, backfillLinkIcons, syncModeUI,
  documentPath, fileFromLocation, showDocumentInUrl, showLinksInUrl,
  viewFromLocation, goToPlace,
  stashDocument, takeStashedDocument, diagramStashKey
};

bindTooltips();
initialize();

})(typeof window === "undefined" ? globalThis : window);
