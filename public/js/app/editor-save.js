/* Saving what the source editor holds, and opening it on a document.
 *
 * Separate from AppSourceEditor because a save leaves the page: it renames,
 * writes, reloads the library and redraws the document underneath the modal.
 * The editor window itself knows none of that, and this file is where the
 * knowing is kept.
 */
(function (global) {

const { normalize, isNotebookFile, docUrl, docName, ensureDocFilename } = global.AppText;
const { elements } = global.AppDom;
const { state } = global.AppState;
const { requestJson } = global.AppApi;
const { getDocByFile } = global.AppLibrary;
const { setStatus, requestConfirmation, askAboutUnsavedWork } = global.AppNotify;
const { openEditor, closeEditor, isEditorDirty } = global.AppSourceEditor;
const { loadDocContent } = global.AppDocs;
const { refreshDocs } = global.AppRefresh;

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


global.AppEditorSave = {
  saveEditorDocument, settleEditorSave, runEditorSave,
  openEditorForCurrentDoc, openEditorForDocument, requestEditorClose
};

})(typeof window === "undefined" ? globalThis : window);
