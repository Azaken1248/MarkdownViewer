/* Code.
 *
 * The text inside a fence is literal, so it is exactly the kind of thing that
 * can be typed into as itself. The code block stays a code block — same font,
 * same colours, same box — and the caret goes in it. It stays coloured while
 * you type, too: MarkdownCore.liveHighlightCode puts the caret back after it
 * rebuilds the markup, which is what used to make that impossible.
 *
 * What is owned here is the timing, and the timing is the whole cost:
 *
 *  - a pause, not a keystroke. Highlighting mid-word would be work thrown away
 *    by the next letter;
 *  - never during IME composition. Replacing the markup under a composition
 *    cancels the word being composed;
 *  - not once the block has been thrown away. A pending pass on a re-rendered
 *    document is a highlight nobody will ever see.
 *
 * The language is an input rather than something to go and find in the source,
 * since it is the one part of a fence that is not the code.
 */

(function (global) {
  const { markPageEditDirty } = global.AppPageBlocks;

  // Long enough that it never fires inside a run of typing, short enough that it
  // reads as "as you type" rather than as an afterthought.
  const LIVE_HIGHLIGHT_DELAY = 140;

  function renderCodeBlock(block, index) {
    const fence = VisualEditor.parseFence(block.source);

    // A mermaid fence renders to a diagram. There is nothing to type into in an
    // SVG, so those keep the rendering and open their source on request.
    if (/^mermaid\b/i.test(fence.info)) {
      return AppPageEmbeds.renderEmbedBlock(block, index);
    }

    const node = document.createElement("div");
    node.className = "ve-block ve-code";
    node.dataset.index = String(index);
    node.setAttribute("contenteditable", "false");
    node.innerHTML = MarkdownCore.renderMarkdown(block.source);

    const code = node.querySelector("pre code");
    if (!code) {
      return AppPageEmbeds.renderEmbedBlock(block, index);
    }

    // The renderer adds a trailing newline of its own. Setting the text from the
    // parsed fence means what is on screen is exactly the code, so what comes
    // back out of the element needs no interpretation.
    code.textContent = fence.body;

    // plaintext-only keeps Enter as a newline and paste as text, which is what
    // code is. Browsers without it get the ordinary editable behaviour and the
    // paste handler on the document.
    code.setAttribute("contenteditable", "plaintext-only");
    if (code.contentEditable !== "plaintext-only") {
      code.setAttribute("contenteditable", "true");
    }
    code.spellcheck = false;

    const language = document.createElement("input");
    language.className = "ve-code-language";
    language.name = "code-language";
    language.value = fence.info;
    language.placeholder = "language";
    language.spellcheck = false;
    language.setAttribute("aria-label", "Code language");

    const fenceState = { info: fence.info };

    const touched = () => {
      block.dirty = true;
      markPageEditDirty();
    };

    let paintTimer = 0;
    let composing = false;

    const paintNow = () => {
      window.clearTimeout(paintTimer);
      paintTimer = 0;

      if (composing || !code.isConnected) {
        return false;
      }

      return MarkdownCore.liveHighlightCode(code, fenceState.info);
    };

    const schedulePaint = () => {
      window.clearTimeout(paintTimer);
      paintTimer = window.setTimeout(paintNow, LIVE_HIGHLIGHT_DELAY);
    };

    language.addEventListener("input", () => {
      fenceState.info = language.value.trim();
      touched();
      // Naming the language is the one edit that recolours a block without
      // changing a character of it.
      schedulePaint();
    });

    code.addEventListener("input", () => {
      touched();
      schedulePaint();
    });

    // The highlighter is a lazy 60KB download. Asking for it when the caret
    // arrives means it is there by the time the first pause is.
    code.addEventListener("focus", () => {
      void MarkdownCore.loadHighlighter();
    });

    code.addEventListener("compositionstart", () => {
      composing = true;
      window.clearTimeout(paintTimer);
      paintTimer = 0;
    });

    code.addEventListener("compositionend", () => {
      composing = false;
      schedulePaint();
    });

    // Leaving the block is the one moment a full pass is affordable, so a block
    // the live pass will not touch — no language named and nothing it could work
    // out from too little text — gets the auto-detector's answer here.
    code.addEventListener("blur", () => {
      if (paintNow()) {
        return;
      }

      const text = code.textContent;
      code.textContent = text;
      delete code.dataset.highlighted;
      code.className = fenceState.info ? `language-${fenceState.info}` : "";
      void MarkdownCore.highlightCodeBlocks(node);
    });

    node.appendChild(language);

    block.serialize = () => VisualEditor.serializeFence({
      ...fence,
      info: fenceState.info,
      body: code.textContent
    });

    return node;
  }

  global.AppPageCode = {
    renderCodeBlock
  };
})(typeof window === "undefined" ? globalThis : window);
