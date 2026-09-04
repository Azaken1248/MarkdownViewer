/* Undo, for a document that is not one editing host.
 *
 * A browser's undo belongs to a single editing host, and the page editor is not
 * one: it is a stack of separate contenteditable blocks with table cells,
 * source boxes and a language field among them. So native Ctrl+Z could never
 * cross a block boundary — it would undo something in whichever block the caret
 * happened to be in, and nothing at all if the last edit had been in another
 * one. It could not see the app's own edits either: adding a block, deleting a
 * table row, dropping in an image, or the live highlighter replacing the markup
 * inside a fence, all of which happen outside the browser's typing history.
 *
 * So the history is the document, not the DOM. An entry is the markdown that
 * AppPageEdit.collectPageMarkdown() would write — the same string the save button sends —
 * so an undo can only ever produce a document this editor could have produced
 * by typing, and cannot invent one. Restoring goes back through
 * renderPageEditor, the same path that opened the editor.
 *
 * Two things a naive version gets wrong and this does not: it re-renders the
 * whole document, so the scroll position has to be carried across or every undo
 * throws you to the top of the file; and the caret has to be put back, or you
 * undo a typo and then have to go and find where you were.
 *
 * Native undo is deliberately left alone inside <textarea> and <input> — a
 * source box and the language field are ordinary form controls whose own undo
 * is character-accurate and keeps the caret exactly. Replacing that with a
 * whole-document step would make them worse, not better.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { setStatus } = global.AppNotify;
  const { pageEditActive, updatePageEditState } = global.AppPageBlocks;
  const { currentPageBlockNode } = global.AppPageInsert;

  // Long enough that a burst of typing is one undo step rather than forty.
  const PAGE_HISTORY_IDLE = 450;
  // Each entry is a copy of the document. Deep history on a large file is real
  // memory, and nobody presses Ctrl+Z two hundred times.
  const PAGE_HISTORY_LIMIT = 100;

  const pageHistory = {
    past: [],
    future: [],
    present: null,
    timer: 0,
    // Set while an undo is being applied, so the re-render it causes is not
    // itself recorded as an edit.
    restoring: false
  };

  // Where the caret is, as the block it is in and its offset in that block's
  // text. Not an offset into the markdown: the rendered text of a block and its
  // source are different strings — `**bold**` is six characters on screen and ten
  // in the file — and there is no mapping between them to be had.
  function pageCaretAnchor() {
    const node = currentPageBlockNode();
    if (!node) {
      return null;
    }

    const index = node.dataset.index;
    const field = document.activeElement;

    if (field && node.contains(field) && (field.tagName === "TEXTAREA" || field.tagName === "INPUT")) {
      return { index, offset: field.selectionStart ?? 0, field: true };
    }

    const host = node.getAttribute("contenteditable") === "true"
      ? node
      : node.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]');

    if (!host) {
      return { index, offset: 0, field: false };
    }

    const caret = MarkdownCore.selectionOffsetsWithin(host);
    return { index, offset: caret ? caret.start : 0, field: false };
  }

  function restorePageCaret(anchor) {
    if (!anchor) {
      return;
    }

    const node = elements.docContent.querySelector(`.ve-block[data-index="${anchor.index}"]`);
    if (!node) {
      return;
    }

    // A block that was open on its source is re-rendered as its view, so the
    // caret lands on the block rather than back in the box it was typed in.
    const host = node.getAttribute("contenteditable") === "true"
      ? node
      : node.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]');

    if (!host) {
      node.focus?.();
      return;
    }

    host.focus();
    const limit = (host.textContent || "").length;
    const at = Math.min(anchor.offset, limit);
    MarkdownCore.placeSelectionWithin(host, at, at);
  }

  function pageHistoryState() {
    return { markdown: AppPageEdit.collectPageMarkdown(), caret: pageCaretAnchor() };
  }

  function resetPageHistory() {
    window.clearTimeout(pageHistory.timer);
    pageHistory.timer = 0;
    pageHistory.past = [];
    pageHistory.future = [];
    pageHistory.present = null;
    pageHistory.restoring = false;
  }

  /* Close off the current step.
   *
   * Called on a pause in typing, and called straight away by anything structural
   * — adding a block, deleting a table row — so that lands as its own step rather
   * than being folded into whatever was being typed just before it.
   */
  function commitPageHistory() {
    window.clearTimeout(pageHistory.timer);
    pageHistory.timer = 0;

    if (!pageEditActive() || pageHistory.restoring || !pageHistory.present) {
      return;
    }

    // A picture that is still uploading is a blob: URL which will not exist in a
    // minute. Recording it would let an undo restore a document pointing at
    // nothing; the upload settling announces its own edit, and that one is kept.
    if (elements.docContent.querySelector("img[data-uploading]")) {
      return;
    }

    const next = pageHistoryState();
    if (next.markdown === pageHistory.present.markdown) {
      // The caret moved and the document did not. Worth keeping, so an undo
      // arriving later lands where the author actually is.
      pageHistory.present.caret = next.caret;
      return;
    }

    pageHistory.past.push(pageHistory.present);
    if (pageHistory.past.length > PAGE_HISTORY_LIMIT) {
      pageHistory.past.shift();
    }

    pageHistory.present = next;
    // Typing after an undo is a new branch; there is nothing left to redo onto.
    pageHistory.future = [];
  }

  function schedulePageHistory() {
    if (!pageEditActive() || pageHistory.restoring) {
      return;
    }

    window.clearTimeout(pageHistory.timer);
    pageHistory.timer = window.setTimeout(commitPageHistory, PAGE_HISTORY_IDLE);
  }

  function applyPageHistoryState(entry) {
    const viewer = AppPageEdit.viewerScroll();
    const offset = viewer ? viewer.scrollTop : 0;

    pageHistory.restoring = true;
    try {
      AppPageEdit.renderPageEditor(entry.markdown);
      restorePageCaret(entry.caret);
    } finally {
      pageHistory.restoring = false;
    }

    // Re-rendering the document resets the scroll, and being thrown to the top of
    // a long file on every undo is its own reason not to use undo.
    if (viewer) {
      viewer.scrollTop = offset;
    }

    updatePageEditState();
  }

  function undoPageEdit() {
    if (!pageEditActive()) {
      return false;
    }

    // Whatever is being typed right now is a step of its own, or the first Ctrl+Z
    // would skip straight past it.
    commitPageHistory();

    if (pageHistory.past.length === 0) {
      setStatus("Nothing left to undo.", "neutral");
      return false;
    }

    pageHistory.future.push(pageHistory.present);
    pageHistory.present = pageHistory.past.pop();
    applyPageHistoryState(pageHistory.present);
    return true;
  }

  function redoPageEdit() {
    if (!pageEditActive()) {
      return false;
    }

    window.clearTimeout(pageHistory.timer);
    pageHistory.timer = 0;

    if (pageHistory.future.length === 0) {
      setStatus("Nothing left to redo.", "neutral");
      return false;
    }

    pageHistory.past.push(pageHistory.present);
    pageHistory.present = pageHistory.future.pop();
    applyPageHistoryState(pageHistory.present);
    return true;
  }

  global.AppPageHistory = {
    pageHistory,
    pageCaretAnchor,
    restorePageCaret,
    pageHistoryState,
    resetPageHistory,
    commitPageHistory,
    schedulePageHistory,
    applyPageHistoryState,
    undoPageEdit,
    redoPageEdit
  };
})(typeof window === "undefined" ? globalThis : window);
