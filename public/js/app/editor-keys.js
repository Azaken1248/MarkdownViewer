/* The source editor's keyboard, and the rest of its window.
 *
 * The shortcuts are the same keys as the page editor's, doing the same things,
 * because which of the two editors is open is not something anyone's fingers
 * keep track of. Below them: the tabs the two panes collapse into on a narrow
 * screen, paste and drop of images, the linked scroll, and the buttons.
 */
(function (global) {

const { elements } = global.AppDom;
const { state } = global.AppState;
const { can } = global.AppApi;
const { resolveConfirmDialog } = global.AppNotify;
const { imagesFromTransfer } = global.AppPastedImages;
const { replaceRangeInTextarea } = global.AppTextarea;
const {
  EDITOR_TABS_QUERY, scheduleEditorPreview, syncEditorPaneScroll,
  syncEditorTabs, selectEditorTab
} = global.AppSourceEditor;
const { attachImagesToSource } = global.AppPageImages;
const { saveEditorDocument, requestEditorClose } = global.AppEditorSave;

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

function bindSourceEditorSurface() {
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
}

global.AppEditorKeys = { toggleMarkdownWrap, applySourceShortcut, bindSourceEditorSurface };

})(typeof window === "undefined" ? globalThis : window);
