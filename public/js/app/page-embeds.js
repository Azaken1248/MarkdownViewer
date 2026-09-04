/* Everything else, and which of the four a block is.
 *
 * Math, raw HTML, front matter, link definitions and mermaid diagrams. What
 * these have in common is that there is nothing in the rendering to type into:
 * an equation is a picture of an equation, a diagram is a picture of a
 * diagram, and front matter has no rendering at all. They stay rendered and
 * hand over their markdown on request — with a live preview, so the result is
 * visible while it is being written rather than only afterwards.
 *
 * A diagram has a second way out: the canvas on the diagram page. Handing the
 * document over and getting it back is the stash at the bottom of this file.
 *
 * renderBlock is the choice between the four kinds, so it lives with the last
 * of them rather than in a module of its own.
 */

(function (global) {
  const { state } = global.AppState;
  const { docUrl } = global.AppText;
  const { renderMermaidBlocks, destroyPanZoomInstances } = global.AppRender;
  const { setStatus } = global.AppNotify;
  const { loadDocContent } = global.AppDocs;
  const {
    pageModel, isDefinitionsBlock, blockSource, embedLabel,
    markPageEditDirty, renderRichBlock
  } = global.AppPageBlocks;
  const { renderTableBlock } = global.AppPageTables;
  const { renderCodeBlock } = global.AppPageCode;

  function renderEmbedBlock(block, index) {
    const node = document.createElement("div");
    node.className = "ve-block ve-embed";
    node.dataset.index = String(index);
    node.setAttribute("contenteditable", "false");
    block.serialize = () => blockSource(block);
    paintEmbedBlock(node, block);
    return node;
  }

  function paintEmbedBlock(node, block) {
    node.classList.remove("is-source-open");
    // A diagram in here may already own a pan-zoom instance bound to an element
    // that is about to be thrown away.
    destroyPanZoomInstances(node);
    node.innerHTML = "";

    const view = document.createElement("div");
    view.className = "ve-embed-view";

    if (block.type === "frontmatter" || isDefinitionsBlock(block)) {
      // Neither of these appears in the document as it reads, so showing them as
      // a rendered anything would be an invention. They get a marker instead —
      // visible enough to find, small enough not to be part of the prose.
      view.innerHTML = `<span class="ve-embed-note">${MarkdownCore.escapeHtml(embedLabel(block))}</span>`;
    } else {
      view.innerHTML = MarkdownCore.renderMarkdown(blockSource(block) + pageModel.linkReferences);
    }

    // One corner, however many ways in there are. A flowchart has two — its
    // steps, or its Mermaid — and two absolutely positioned buttons would sit on
    // top of each other, so the corner is a row and the buttons are in it.
    const tools = document.createElement("div");
    tools.className = "ve-embed-tools";

    const buildable = Boolean(buildableDiagram(block));

    /* One button, and it goes to the page.
     *
     * The canvas used to open inside the block as well, in a strip a few hundred
     * pixels tall with the document either side of it. Everything the canvas has
     * grown since — a palette, an inspector, a zoom bar, arrows you draw by
     * dragging — wants room, and the page has room. So there is one way in, and
     * the document comes back exactly as it was left.
     */
    if (buildable) {
      const build = document.createElement("button");
      build.type = "button";
      build.className = "ve-embed-edit ve-embed-build";
      build.title = "Build this diagram on a page of its own";
      build.innerHTML = '<i class="ph ph-tree-structure" aria-hidden="true"></i><span>Build</span>';
      build.addEventListener("click", () => openDiagramPage(block));
      tools.appendChild(build);
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "ve-embed-edit ve-embed-source-open";
    open.title = `Edit this ${embedLabel(block)} as markdown`;
    // Next to a Build button the long form is redundant twice over: the corner
    // already says which block this is, and the word that matters is the one
    // that tells the two buttons apart.
    open.innerHTML = buildable
      ? '<i class="ph ph-code" aria-hidden="true"></i><span>Markdown</span>'
      : `<i class="ph ph-code" aria-hidden="true"></i><span>Edit ${embedLabel(block)}</span>`;
    open.addEventListener("click", () => openEmbedSource(node, block));

    tools.appendChild(open);
    node.append(view, tools);
    void renderMermaidBlocks(node);
  }

  function openEmbedSource(node, block) {
    node.classList.add("is-source-open");
    destroyPanZoomInstances(node);
    node.innerHTML = "";

    const head = document.createElement("div");
    head.className = "ve-embed-head";
    head.textContent = embedLabel(block);

    const area = document.createElement("textarea");
    area.className = "ve-embed-source";
    area.name = "block-source";
    area.value = blockSource(block).replace(/\n+$/, "");
    area.spellcheck = false;
    area.setAttribute("aria-label", `${embedLabel(block)} source`);

    const preview = document.createElement("div");
    preview.className = "ve-embed-preview markdown-body";

    const fit = () => {
      area.rows = Math.min(24, Math.max(2, area.value.split("\n").length));
    };

    // Writing an equation or a diagram blind and pressing Done to find out is
    // the thing that makes source editing feel like a punishment.
    const drawPreview = () => {
      destroyPanZoomInstances(preview);
      preview.innerHTML = MarkdownCore.renderMarkdown(blockSource(block) + pageModel.linkReferences);
      void renderMermaidBlocks(preview);
    };

    fit();
    drawPreview();

    area.addEventListener("input", () => {
      block.dirty = true;
      block.sourceOverride = area.value;
      fit();
      markPageEditDirty();

      window.clearTimeout(state.embedPreviewTimer);
      state.embedPreviewTimer = window.setTimeout(drawPreview, 250);
    });

    const done = document.createElement("button");
    done.type = "button";
    done.className = "ve-embed-done";
    done.innerHTML = '<i class="ph ph-check" aria-hidden="true"></i><span>Done</span>';
    done.addEventListener("click", () => paintEmbedBlock(node, block));

    node.append(head, area, preview, done);
    area.focus();
  }

  // Long enough to sit out a run of typing, and the same pause the source box's
  // preview uses, so the two feel like one thing.
  /* Handing the document over to the diagram page, and getting it back.
   *
   * A diagram opens on a page of its own, and the document it came from may have
   * unsaved changes in it. Reading the file from disk on the other side would
   * throw those away without saying so, so the document goes across in
   * sessionStorage: this leaves it there, the diagram page edits the fence inside
   * it and puts it back, and startPageEdit picks it up again — still unsaved,
   * with the new picture in it.
   */
  const DIAGRAM_STASH_PREFIX = "azadocs:diagram:";

  function diagramStashKey(file) {
    return `${DIAGRAM_STASH_PREFIX}${file}`;
  }

  function stashDocument(file, markdown) {
    try {
      window.sessionStorage.setItem(diagramStashKey(file), markdown);
      return true;
    } catch {
      // Private browsing, or no room. Better to say so than to navigate away and
      // let the other page quietly open the version on disk.
      return false;
    }
  }

  // Taken, not read: a document is picked up once, by whoever comes back to it.
  // Leaving it there would mean the next edit of the same file starts from a
  // diagram session that ended long ago.
  function takeStashedDocument(file) {
    try {
      const held = window.sessionStorage.getItem(diagramStashKey(file));
      window.sessionStorage.removeItem(diagramStashKey(file));
      return held;
    } catch {
      return null;
    }
  }

  /* Whether a .mmd file is one the canvas can draw.
   *
   * Asked before Edit sends anyone to the diagram page, because a file it cannot
   * draw has to open in the source editor instead — and finding that out after
   * the page has already been navigated to means a dead end with a Back button.
   */
  async function diagramFileOpens(file) {
    try {
      return Boolean(DiagramEditor.canOpen(await loadDocContent(file)));
    } catch {
      return false;
    }
  }

  function openDiagramPage(block) {
    const fence = diagramFence(block);
    if (!fence || !state.pageEdit.file) {
      return;
    }

    const markdown = AppPageEdit.collectPageMarkdown();
    if (!stashDocument(state.pageEdit.file, markdown)) {
      setStatus("This browser will not hold the document while you edit the diagram. Save first.", "error");
      return;
    }

    // The index is a hint and the hash is the truth: insert a paragraph above
    // while the editor is open and the index points at something else, so the
    // page believes it only while what is at it still hashes the same.
    const address = `${pageModel.blocks.indexOf(block)}-${VisualEditor.contentHash(fence.body)}`;
    window.location.href = `/diagram/doc/${docUrl(state.pageEdit.file)}#${address}`;
  }

  function diagramFence(block) {
    if (block.type !== "fence") {
      return null;
    }

    const fence = VisualEditor.parseFence(blockSource(block));
    return /^mermaid\b/i.test(fence.info) ? fence : null;
  }

  // The fence and the model, or null for every diagram the canvas has no business
  // opening — which is also what decides whether the button is there.
  function buildableDiagram(block) {
    const fence = diagramFence(block);
    if (!fence) {
      return null;
    }

    const model = DiagramEditor.canOpen(fence.body);
    return model ? { fence, model } : null;
  }

  // Which of the four ways a block is drawn and written back.
  function renderBlock(block, index) {
    const node = drawBlock(block, index);
    pageModel.nodeOf.set(node, block);
    return node;
  }

  function drawBlock(block, index) {
    if (isDefinitionsBlock(block)) {
      return renderEmbedBlock(block, index);
    }

    if (VisualEditor.isRich(block)) {
      return renderRichBlock(block, index);
    }

    if (block.type === "table") {
      return renderTableBlock(block, index);
    }

    if (block.type === "fence") {
      return renderCodeBlock(block, index);
    }

    return renderEmbedBlock(block, index);
  }

  global.AppPageEmbeds = {
    renderEmbedBlock,
    diagramStashKey,
    stashDocument,
    takeStashedDocument,
    diagramFileOpens,
    buildableDiagram,
    renderBlock,
    drawBlock
  };
})(typeof window === "undefined" ? globalThis : window);
