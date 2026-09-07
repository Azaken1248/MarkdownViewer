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
const { docName } = AppText;
const { elements } = AppDom;
const { state } = AppState;
const { can } = AppApi;

const { viewFromLocation, showLinksInUrl, fileFromLocation, showDocumentInUrl } = AppLocation;
const { clearSelection, updateSelectionUI } = AppSelection;
const { bindTooltips } = AppTooltips;

const { MOBILE_BREAKPOINT, setNavOpen, setMeta } = AppShell;
const { notify, setStatus, resolveConfirmDialog } = AppNotify;
const { refreshLinks, submitLink, openLinkModal, closeLinkModal, showLinksLoading } = AppLinks;
const { closeShareModal } = AppShare;
const { imagesFromTransfer } = AppPastedImages;
const { bindThemeToggle } = AppTheme;
const { bindNotebookExecution } = AppNotebook;

const { updateJumpNavigationUI } = AppJump;
const { setSuperSearchOpen, syncSearchInputState } = AppSearchPanel;
const { updateActiveDocUI } = AppViewerHeader;
const { refreshSession, openLoginModal, openPasswordModal, closePasswordModal } = AppSession;
const { closeUsersModal } = AppUsers;
const { openFolderModal, closeFolderModal } = AppFolderModal;
const { bindWheelZoomModifier } = AppRender;
const { startNewDocument, openEditor, isEditorDirty } = AppSourceEditor;
const {
  loadDocContent, loadDeletedDocContent, syncModeUI, showEmptyState, showLoadingState,
  showNoDocumentOpen
} = AppDocs;
const { toggleTaskCheckbox } = AppTaskLists;
const { attachImagesToPage } = AppPageImages;

const { closeContextMenu, openContextMenu } = AppContextMenu;
const { renderDocList } = AppTree;
const { applySearch } = AppSearching;
const { openDocument, openRecycleBinDocument } = AppOpening;
const { refreshDocs } = AppRefresh;
const { restoreArchivedDocumentByFile, permanentlyDeleteArchivedDocument } = AppFileActions;
const {
  mountMatchNavToViewportLayer, exitSearchMode, navigateMatches, bindSearchInput
} = AppMatchNav;
const { goToPlace, bindPlaceSwitcher } = AppPlaces;
const { bindAccountMenu } = AppAccountMenu;
const { bindSidebar } = AppSidebar;
const { bindSourceEditorSurface } = AppEditorKeys;
const { uploadMarkdown, uploadFolder } = AppUploads;
const { openEditorForCurrentDoc, requestEditorClose } = AppEditorSave;
const {
  deleteCurrentDocument, restoreCurrentDeletedDocument, hardDeleteCurrentDeletedDocument
} = AppDocActions;
const { moveDocumentToFolder } = AppFolderOps;
const { pageEditActive } = AppPageBlocks;

const { insertPageBlock } = AppPageInsert;
const { commitPageHistory, undoPageEdit, redoPageEdit } = AppPageHistory;
const {
  applyVisualBlockFormat, isPageEditDirty, syncPageEditOffset, startPageEdit, savePageEdit,
  cancelPageEdit, openSourceFromPageEdit, editableBlockFromSelection, applyVisualCommand
} = AppPageEdit;

const MATCH_SWIPE_THRESHOLD = 56;
const MATCH_SWIPE_VERTICAL_LIMIT = 42;

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

bindSearchInput();

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

bindAccountMenu();

bindSidebar();

bindPlaceSwitcher();

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

bindSourceEditorSurface();

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
  openContextMenu, setUploadMenuOpen, openDocument, openRecycleBinDocument, renderDocList,
  moveDocumentToFolder, cancelPageEdit, pageEditActive, commitPageHistory
};

bindTooltips();
initialize();

})(typeof window === "undefined" ? globalThis : window);
