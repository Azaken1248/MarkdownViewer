/* Editing the document on the page: the blocks it is made of.
 *
 * Not a mode in a dialog: the document you are reading becomes the document
 * you are editing, in the same column, at the same width, in the same type,
 * with its diagrams and highlighted code still drawn. Nothing moves when you
 * start, which is the whole point — an editor that relayouts the page has
 * already stopped being the page.
 *
 * Underneath it is the block model in visual-editor.js. The source is cut into
 * blocks that reassemble byte for byte; only the blocks actually typed into
 * are written back. Open a document, fix one word, save, and the diff is that
 * word, even for the files here that were written somewhere else entirely.
 *
 * This module holds what every kind of block needs: the model itself, the
 * source a block currently stands for, and what marks the document dirty. The
 * four kinds of block are drawn in the four modules after it.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { state } = global.AppState;
  const { taskCheckboxes } = global.AppTaskLists;

  /* The document being edited on the page, as blocks.
   *
   * One object rather than three bindings, because these are about to be spread
   * across several modules and a module that destructures a `let` gets a copy of
   * whatever it held at load — which for `blocks` is the empty array it starts
   * as, forever. Not to be confused with state.pageEdit, which is whether an
   * edit is happening and to which file.
   *
   * linkReferences: link reference definitions live at the bottom of a document
   * and are used halfway up it. Rendering a block on its own would lose them, so
   * they are collected once and appended to each block before rendering — for
   * the rendering only, never for what gets written back.
   *
   * nodeOf: which block a rendered node is showing. The index written on the
   * node stops being true the moment a block is inserted above it, so anything
   * that needs to find a block from the page asks here instead.
   */
  const pageModel = {
    blocks: [],
    linkReferences: "",
    nodeOf: new WeakMap()
  };

  const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:\s*\S+/;

  function collectLinkReferences(markdown) {
    const found = String(markdown || "")
      .split("\n")
      .filter((line) => REFERENCE_DEFINITION_RE.test(line));

    return found.length > 0 ? `\n\n${found.join("\n")}\n` : "";
  }

  /* A block that is nothing but link definitions.
   *
   * It renders to nothing at all, so as formatted text it would be an invisible
   * block you could put the cursor in and destroy without seeing it happen. It is
   * markdown that has no rendered form — which is exactly the case the source
   * boxes exist for.
   */
  function isDefinitionsBlock(block) {
    if (block.type !== "paragraph") {
      return false;
    }

    const lines = block.source.split("\n").filter((line) => line.trim() !== "");
    return lines.length > 0 && lines.every((line) => REFERENCE_DEFINITION_RE.test(line));
  }

  function pageEditActive() {
    return state.pageEdit.active;
  }

  // The source a block currently stands for: what its own textarea says if it has
  // one, otherwise the text it came in with.
  function blockSource(block) {
    if (block.sourceOverride == null) {
      return block.source;
    }

    const value = String(block.sourceOverride).replace(/\n+$/, "");
    return value ? `${value}\n` : "";
  }

  function embedLabel(block) {
    switch (block.type) {
      case "fence":
        return block.info ? `code (${block.info})` : "code";
      case "table":
        return "table";
      case "math":
        return "math";
      case "html":
        return "HTML";
      case "frontmatter":
        return "front matter";
      default:
        return isDefinitionsBlock(block) ? "link definitions" : "source";
    }
  }

  function markPageEditDirty() {
    updatePageEditState();
    // Every edit in the page editor comes through here, which is what makes the
    // history complete rather than a list of the edits somebody remembered to
    // record. A burst of typing is coalesced into one step; see
    // schedulePageHistory.
    AppPageHistory.schedulePageHistory();
  }

  function updatePageEditState() {
    if (!elements.pageEditState) {
      return;
    }

    elements.pageEditState.textContent = AppPageEdit.isPageEditDirty() ? "Unsaved changes" : "No changes yet";
  }

  /* A block that survives being shown as formatted text. It is the rendered
   * markdown, editable in place — no frame, no handle, nothing to tell you that
   * the paragraph you are typing in is a paragraph in a list of blocks.
   */
  function renderRichBlock(block, index) {
    const node = document.createElement("div");
    node.className = "ve-block";
    node.dataset.index = String(index);
    // setAttribute, not the property: the attribute is what CSS and querySelector
    // see, and not every DOM implementation reflects the property back to it.
    node.setAttribute("contenteditable", "true");
    node.spellcheck = true;
    node.innerHTML = MarkdownCore.renderMarkdown(block.source + pageModel.linkReferences);
    makeEditorTasksLive(node, block);

    node.addEventListener("input", () => {
      block.dirty = true;
      markPageEditDirty();
    });

    block.serialize = () => VisualEditor.serializeEditedBlock(node);
    return node;
  }

  // The serializer already writes a box's state back as [x] or [ ], so the only
  // thing between a checkbox and working here is that marked renders it disabled.
  //
  // Do not be tempted to intercept the click and flip `checked` by hand: by the
  // time a click event is delivered the box has already toggled itself, so
  // cancelling the event to "take control" reverts it and the tick never lands.
  // Marking it contenteditable="false" is what stops the surrounding editable
  // region from swallowing the click; the browser does the rest.
  function makeEditorTasksLive(node, block) {
    for (const box of taskCheckboxes(node)) {
      box.disabled = false;
      // An island in the text: the caret skips it, and typing cannot break a list
      // item's marker apart.
      box.setAttribute("contenteditable", "false");

      box.addEventListener("change", () => {
        block.dirty = true;
        markPageEditDirty();
      });
    }
  }

  global.AppPageBlocks = {
    pageModel,
    collectLinkReferences,
    isDefinitionsBlock,
    pageEditActive,
    blockSource,
    embedLabel,
    markPageEditDirty,
    updatePageEditState,
    renderRichBlock,
    makeEditorTasksLive
  };
})(typeof window === "undefined" ? globalThis : window);
