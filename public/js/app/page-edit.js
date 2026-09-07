/* Starting, saving and leaving an edit on the page.
 *
 * The lifecycle around the blocks: turning a document into an editor, turning
 * it back, collecting the markdown out of it, and the two ways a save can end
 * — Ctrl+S writes the file and leaves you in the text, the Save button
 * finishes. Saving keeps you where you were reading.
 *
 * Saves of a document run one after another, never at the same time.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { requestJson, can } = global.AppApi;
  const { docUrl, docName, isNotebookFile, isDiagramFile } = global.AppText;
  const { resetJumpNavigation } = global.AppJump;
  const { getDocByFile } = global.AppLibrary;
  const { renderMermaidBlocks, destroyPanZoomInstances, renderDocumentContent } = global.AppRender;
  const { notify, setStatus, askAboutUnsavedWork } = global.AppNotify;
  const { loadDocContent } = global.AppDocs;
  const { pageModel, collectLinkReferences, pageEditActive, updatePageEditState, renderRichBlock } = global.AppPageBlocks;
  const { renderBlock, diagramFileOpens, takeStashedDocument } = global.AppPageEmbeds;
  const { pageHistory, resetPageHistory, commitPageHistory } = global.AppPageHistory;

  function renderPageEditor(markdown) {
    pageModel.blocks = VisualEditor.splitBlocks(markdown);
    pageModel.linkReferences = collectLinkReferences(markdown);

    destroyPanZoomInstances(elements.docContent);
    elements.docContent.innerHTML = "";
    elements.docContent.classList.add("doc-editing", "visible");

    for (const [index, block] of pageModel.blocks.entries()) {
      // A run of blank lines is spacing, not content. It stays in the model so the
      // document reassembles exactly, and is simply not drawn.
      if (block.type === "blank") {
        continue;
      }

      elements.docContent.appendChild(renderBlock(block, index));
    }

    // An empty document would have nowhere to put the cursor. Give it a paragraph
    // to start in; it contributes nothing to the file until something is typed
    // into it.
    if (!elements.docContent.querySelector('.ve-block[contenteditable="true"]')) {
      const index = pageModel.blocks.length;
      pageModel.blocks.push({ type: "paragraph", source: "" });
      const node = renderRichBlock(pageModel.blocks[index], index);
      // Only this one carries a placeholder. A block that is empty because the
      // document says so must not sprout words the file does not contain.
      node.classList.add("ve-placeholder");
      elements.docContent.appendChild(node);
    }

    void renderMermaidBlocks(elements.docContent);
    updatePageEditState();
  }

  /* Back to markdown.
   *
   * Only dirty blocks are re-serialized, each by the function the renderer gave
   * it. That is the whole safety property, and the reason this can be pointed at
   * a library written elsewhere.
   */
  function collectPageMarkdown() {
    const out = [];

    for (const block of pageModel.blocks) {
      if (!block.dirty || typeof block.serialize !== "function") {
        out.push(block.source);
        continue;
      }

      out.push(block.serialize());
    }

    return out.join("");
  }

  function isPageEditDirty() {
    return pageEditActive() && collectPageMarkdown() !== state.pageEdit.initial;
  }

  // The bar sits under the viewer toolbar, which is sticky and whose height
  // depends on what is in it. Measuring beats guessing.
  function syncPageEditOffset() {
    if (!elements.pageEditBar || !elements.viewerToolbar) {
      return;
    }

    const height = elements.viewerToolbar.offsetHeight || 45;
    elements.pageEditBar.style.setProperty("--page-edit-top", `${height}px`);
  }

  /* Put the reading view back from markdown already in hand. No refetch: the
   * content is what was loaded to edit, so a round trip to the server would only
   * add a delay and a way to fail.
   */
  async function restorePageView(file, markdown, title) {
    destroyPanZoomInstances(elements.docContent);
    elements.docContent.innerHTML = renderDocumentContent(file, markdown, title || file);
    elements.docContent.classList.add("visible");
    await renderMermaidBlocks(elements.docContent);
  }

  async function startPageEdit() {
    if (pageEditActive()) {
      return;
    }

    if (state.isRecycleBinMode) {
      setStatus("Restore this document before editing it.", "error");
      return;
    }

    if (!state.activeFile) {
      setStatus("Open a document first, then choose Edit.", "error");
      return;
    }

    if (isNotebookFile(state.activeFile)) {
      setStatus("Notebook files are view-only in this viewer.", "neutral");
      return;
    }

    if (!can("doc:write")) {
      setStatus("Your account cannot edit documents.", "error");
      return;
    }

    // A .mmd file is diagram source that the viewer wraps in a fence to render.
    // Its content is not markdown, so cutting it into markdown blocks would be
    // reading it as something it is not. It goes straight to the source editor.
    // A .mmd file is diagram source, and the whole file is the diagram — so
    // Edit means the canvas, not a text box, whenever the canvas can draw it.
    if (isDiagramFile(state.activeFile)) {
      const drawable = await diagramFileOpens(state.activeFile);
      if (drawable) {
        window.location.href = `/diagram/file/${docUrl(state.activeFile)}`;
        return;
      }

      await AppEditorSave.openEditorForDocument(state.activeFile);
      return;
    }

    const file = state.activeFile;
    const doc = getDocByFile(file);

    let content;
    try {
      content = await loadDocContent(file);
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }

    // Loading is async and the sidebar is not. If the reader moved on while the
    // content was in flight, editing what they left would be a surprise.
    if (state.activeFile !== file) {
      return;
    }

    state.pageEdit = {
      active: true,
      file,
      title: doc?.title || file,
      initial: content
    };

    // Coming back from the diagram page. The file on disk is still what this
    // edit is a change from — that is what `initial` is for — but what is on
    // screen is the document as it was left, with the new diagram in it.
    const stashed = takeStashedDocument(file);
    const restored = stashed !== null && stashed !== content;
    if (restored) {
      content = stashed;
    }

    // Search highlights belong to the rendering that is about to be replaced.
    resetJumpNavigation();

    document.body.classList.add("page-editing");
    elements.pageEditBar.hidden = false;
    syncPageEditOffset();
    renderPageEditor(content);

    // The document as opened is the state everything else is a change from, and
    // the one an undo run all the way back arrives at.
    resetPageHistory();
    pageHistory.present = { markdown: content, caret: null };

    elements.docContent.querySelector('[contenteditable="true"]')?.focus();

    // A document that came back from the diagram page already has a change in it
    // that nobody made by typing, so the line under the bar says where it came
    // from rather than "Editing", which would read as though nothing had happened.
    if (restored) {
      setStatus(`${docName(file)} has the edited diagram in it. Save when you are ready.`, "neutral");
      return;
    }

    setStatus(`Editing ${docName(file)} on the page.`, "neutral");
  }

  function exitPageEdit() {
    // A queued preview must not fire into a document that has gone back to
    // being read.
    window.clearTimeout(state.embedPreviewTimer);
    state.embedPreviewTimer = null;

    // The history belongs to this editing session. Carrying it into the next one
    // would offer to undo edits to a document that is no longer open.
    resetPageHistory();

    state.pageEdit = { active: false, file: null, title: "", initial: "" };
    pageModel.blocks = [];
    pageModel.linkReferences = "";
    elements.pageEditBar.hidden = true;
    elements.docContent.classList.remove("doc-editing");
    document.body.classList.remove("page-editing");
  }

  /* Saving keeps you where you were reading.
   *
   * Re-rendering resets the scroll, and being thrown to the top of a long document
   * every time you fix a sentence in the middle of it is its own reason not to
   * edit anything.
   */
  function viewerScroll() {
    return elements.docContent.closest(".viewer") || null;
  }

  /* Saves of a document run one after another, never at the same time.
   *
   * Ctrl+S is pressed more often than it needs to be, so two writes of the same
   * document are easily in flight at once — and two requests can reach the server
   * in either order, which would leave the file holding the older text while the
   * editor said it was saved. Queueing them also means each save reads the
   * document as it stands when its turn comes rather than when the key was
   * pressed, and that the baseline they leave behind is the newest one.
   *
   * A failed save must not stop the next one from being attempted, which is why
   * the rejection handler carries on rather than breaking the chain.
   */
  let pageSaveChain = Promise.resolve();

  function savePageEdit(options) {
    const run = () => runPageSave(options);
    pageSaveChain = pageSaveChain.then(run, run);
    return pageSaveChain;
  }

  /* What a save in place changes: not the screen, only what "unsaved" means and
   * what the rest of the app believes is on disk.
   *
   * Its own function because it runs after an awaited request, and because the
   * state it writes has to be read after that request too — Escape while the PUT
   * was in flight may have ended the editing session, or started another one on
   * a different document. The file is written either way; what must not happen is
   * this document's baseline landing on a document that is not it.
   */
  function settlePageSave(file, content, payload) {
    state.contentCache.set(file, { content, version: String(payload.updatedAt || "") });

    const doc = getDocByFile(file);
    if (doc) {
      doc.updatedAt = payload.updatedAt || doc.updatedAt;
      doc.size = Number.isFinite(Number(payload.size)) ? Number(payload.size) : doc.size;
    }

    if (pageEditActive() && state.pageEdit.file === file) {
      state.pageEdit.initial = content;
      updatePageEditState();
    }
  }

  /* Saving and leaving are two different things.
   *
   * Ctrl+S is pressed mid-sentence, out of habit, dozens of times in one sitting;
   * it means "write this down", not "I have finished". Closing the editor on it
   * throws away the caret, the scroll and the undo history of somebody who only
   * wanted their work to be safe. So the keystroke saves in place and the Save
   * button — pressed once, deliberately, when the writing is done — is the only
   * thing that leaves.
   */
  async function runPageSave({ exit = true } = {}) {
    if (!pageEditActive()) {
      return;
    }

    const { file, title } = state.pageEdit;
    const content = collectPageMarkdown();

    if (content === state.pageEdit.initial) {
      if (!exit) {
        setStatus(`No changes to save in ${docName(file)}.`, "neutral");
        return;
      }

      exitPageEdit();
      await restorePageView(file, content, title);
      setStatus(`No changes to save in ${docName(file)}.`, "neutral");
      return;
    }

    const viewer = viewerScroll();
    const offset = viewer ? viewer.scrollTop : 0;

    elements.pageEditSaveBtn.disabled = true;

    try {
      const payload = await requestJson(`/api/docs/${docUrl(file)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });

      // Saving in place touches nothing on the screen. The blocks, the caret, the
      // scroll and the undo history are all still the ones being typed into; what
      // changes is only what "unsaved" now means, and what the rest of the app
      // believes is on disk.
      if (!exit) {
        settlePageSave(file, content, payload);
        setStatus(`Saved ${payload.file || file}.`, "success");
        return;
      }

      exitPageEdit();
      await AppRefresh.refreshDocs({ openFile: payload.file || file, preserveSearch: true });

      if (viewer) {
        viewer.scrollTop = offset;
      }

      setStatus(`Saved ${payload.file || file}.`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      elements.pageEditSaveBtn.disabled = false;
    }
  }

  async function cancelPageEdit({ confirm = true, restore = true } = {}) {
    if (!pageEditActive()) {
      return true;
    }

    if (confirm && isPageEditDirty()) {
      const answer = await askAboutUnsavedWork(
        `${docName(state.pageEdit.file)} has changes that have not been saved.`
      );

      if (!answer) {
        return false;
      }

      if (answer === "alt") {
        await savePageEdit();

        // A save that failed said so and left the edits where they were. Leaving
        // anyway would throw away the work the answer was given to keep.
        return !pageEditActive();
      }
    }

    const { file, initial, title } = state.pageEdit;
    exitPageEdit();

    // A caller that is about to draw a different document does not need this one
    // rendered first, only to be thrown away a frame later.
    if (restore) {
      await restorePageView(file, initial, title);
      setStatus(`Stopped editing ${docName(file)}.`, "neutral");
    }

    return true;
  }

  /* The way out to the source.
   *
   * Edits made on the page come with you, so the switch is not a decision you have
   * to make before you start. The page behind the dialog goes back to what is on
   * disk: the dialog now owns the unsaved version, and it already asks before
   * throwing it away.
   */
  async function openSourceFromPageEdit() {
    if (!pageEditActive()) {
      return;
    }

    const { file, initial, title } = state.pageEdit;
    const content = collectPageMarkdown();
    const doc = getDocByFile(file);

    exitPageEdit();
    await restorePageView(file, initial, title);

    AppSourceEditor.openEditor({
      mode: "edit",
      fileName: file,
      content,
      folderId: doc?.folderId || null
    });
  }

  /* The toolbar.
   *
   * execCommand is deprecated and still the only thing every browser implements
   * for editing a contenteditable selection. The alternative is hand-rolled Range
   * surgery for bold, italic and lists, which is a great deal of code to
   * reimplement worse. What it produces is normalised by the serializer anyway —
   * a <b> becomes ** either way.
   */
  function editableBlockFromSelection() {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (!anchor) {
      return null;
    }

    const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    return element?.closest('.ve-block[contenteditable="true"]') || null;
  }

  function applyVisualCommand(command) {
    const block = editableBlockFromSelection();
    if (!block) {
      notify("Put the cursor in the text first.", "neutral");
      return;
    }

    const selection = window.getSelection();
    const run = (name, value) => document.execCommand(name, false, value);

    // Formatting is a discrete act too: Ctrl+Z after Ctrl+B should take the bold
    // off, not unwrite the sentence.
    commitPageHistory();

    switch (command) {
      case "bold": run("bold"); break;
      case "italic": run("italic"); break;
      case "ul": run("insertUnorderedList"); break;
      case "ol": run("insertOrderedList"); break;
      case "hr": run("insertHTML", "<hr>"); break;
      case "code": {
        const text = String(selection).trim();
        if (!text) {
          notify("Select the text to mark as code.", "neutral");
          return;
        }
        run("insertHTML", `<code>${MarkdownCore.escapeHtml(text)}</code>`);
        break;
      }
      case "link": {
        const text = String(selection).trim();
        const href = window.prompt("Link address", "https://");
        if (!href) {
          return;
        }
        if (text) {
          run("createLink", href);
        } else {
          run("insertHTML", `<a href="${MarkdownCore.escapeHtml(href)}">${MarkdownCore.escapeHtml(href)}</a>`);
        }
        break;
      }
      default:
        return;
    }

    block.dispatchEvent(new Event("input", { bubbles: true }));
    commitPageHistory();
  }

  function applyVisualBlockFormat(tag) {
    const block = editableBlockFromSelection();
    if (!block) {
      notify("Put the cursor in the text first.", "neutral");
      return;
    }

    commitPageHistory();
    document.execCommand("formatBlock", false, tag.toUpperCase());
    block.dispatchEvent(new Event("input", { bubbles: true }));
    commitPageHistory();
  }

  global.AppPageEdit = {
    renderPageEditor,
    collectPageMarkdown,
    isPageEditDirty,
    syncPageEditOffset,
    restorePageView,
    startPageEdit,
    exitPageEdit,
    viewerScroll,
    savePageEdit,
    runPageSave,
    cancelPageEdit,
    openSourceFromPageEdit,
    editableBlockFromSelection,
    applyVisualCommand,
    applyVisualBlockFormat
  };
})(typeof window === "undefined" ? globalThis : window);
