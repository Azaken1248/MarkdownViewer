/* Putting something new into the document.
 *
 * The formatting bar could only ever change text that was already there. A
 * code fence, a table, a formula or a diagram had to be typed as markdown in
 * the source editor, which is an odd thing to have to do in a visual editor.
 *
 * Each of these is inserted as its markdown and then parsed by the same
 * splitter the document went through, so a new block is typed and rendered by
 * exactly the same path as one that was already in the file — there is no
 * second idea of what a table is.
 */

(function (global) {
  const { elements } = global.AppDom;
  const { setStatus } = global.AppNotify;
  const { renderMermaidBlocks } = global.AppRender;
  const { pageModel, pageEditActive, markPageEditDirty } = global.AppPageBlocks;
  const { renderBlock } = global.AppPageEmbeds;

  const NEW_BLOCKS = {
    fence: {
      label: "code block",
      markdown: "```\n\n```\n"
    },
    table: {
      label: "table",
      markdown: "| Column | Column |\n| --- | --- |\n|  |  |\n"
    },
    math: {
      label: "formula",
      markdown: "$$\n\\frac{a}{b}\n$$\n"
    },
    mermaid: {
      label: "diagram",
      markdown: "```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n"
    }
  };

  // Where a new block should go: after the block the cursor is in, or at the end
  // when the cursor is nowhere.
  function currentPageBlockNode() {
    const editing = AppPageEdit.editableBlockFromSelection();
    if (editing) {
      return editing;
    }

    const focused = document.activeElement?.closest?.(".ve-block");
    if (focused) {
      return focused;
    }

    const all = elements.docContent.querySelectorAll(".ve-block");
    return all.length > 0 ? all[all.length - 1] : null;
  }

  function insertPageBlock(kind) {
    const template = NEW_BLOCKS[kind];
    if (!pageEditActive() || !template) {
      return null;
    }

    // Adding a block is one act, so it gets one step of its own rather than
    // being folded into whatever was being typed just before it.
    AppPageHistory.commitPageHistory();

    const afterNode = currentPageBlockNode();
    const afterBlock = afterNode ? pageModel.nodeOf.get(afterNode) : null;
    const at = afterBlock ? pageModel.blocks.indexOf(afterBlock) : -1;
    const insertAt = at === -1 ? pageModel.blocks.length : at + 1;

    // A blank line first, or the new block runs straight into the previous
    // paragraph and stops being a separate block at all.
    const spacer = { type: "blank", source: "\n" };
    const fresh = VisualEditor.splitBlocks(template.markdown);

    pageModel.blocks.splice(insertAt, 0, spacer, ...fresh);

    let anchor = afterNode;
    let first = null;

    for (const [offset, block] of fresh.entries()) {
      if (block.type === "blank") {
        continue;
      }

      const node = renderBlock(block, insertAt + 1 + offset);
      if (anchor) {
        anchor.after(node);
      } else {
        elements.docContent.appendChild(node);
      }

      anchor = node;
      first = first || node;
    }

    if (!first) {
      return null;
    }

    void renderMermaidBlocks(first);
    markPageEditDirty();
    AppPageHistory.commitPageHistory();

    // Cursor first. Scrolling is a courtesy, and a browser that cannot do it must
    // not cost the cursor its place.
    startTypingIn(first);
    first.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setStatus(`Added a ${template.label}.`, "success");
    return first;
  }

  // Put the cursor where whoever pressed the button is going to type next, which
  // is a different place in each of these.
  function startTypingIn(node) {
    const cell = node.querySelector("th, td");
    if (cell) {
      cell.focus();
      return;
    }

    /* A flowchart opens on its builder, where the first thing to do is drag
     * something.
     *
     * Asked before the code below it, and that order is the whole of this: a
     * diagram is a fence, so until the renderer has turned it into a drawing
     * there is a <pre><code> sitting in the block — and the drawing happens a
     * frame later than this runs. Asking for the code first therefore found the
     * diagram's own source every time and focused an element nobody can type in,
     * which looked exactly like the button doing nothing. A diagram that already
     * carried a layout hid it, because those are drawn on the spot rather than a
     * frame later.
     */
    const build = node.querySelector(".ve-embed-build");
    if (build) {
      build.click();
      return;
    }

    const code = node.querySelector("pre code");
    if (code) {
      code.focus();
      return;
    }

    // Maths and everything else have no rendering to type into either, and open
    // on their source with the preview already beside it.
    const edit = node.querySelector(".ve-embed-edit");
    if (edit) {
      edit.click();
      return;
    }

    node.focus?.();
  }

  global.AppPageInsert = {
    currentPageBlockNode,
    insertPageBlock
  };
})(typeof window === "undefined" ? globalThis : window);
