/* Code blocks: coloured, copyable, and coloured again while being typed.
 *
 * Three jobs that share a highlighter. The last one is the awkward one — it
 * rebuilds the markup underneath a caret that someone is still typing into,
 * which is why the caret arithmetic below is exported rather than repeated.
 */
(function (global) {
  "use strict";

  const { ensureLibrary, CODE_LANGUAGE_ALIAS } = global.MdLazy;
  const { normalize } = global.MdText;

  function highlightCodeBlocks(root) {
    if (!root) {
      return Promise.resolve();
    }

    if (global.hljs) {
      highlightLoadedCodeBlocks(root);
      return Promise.resolve();
    }

    if (!root.querySelector("pre code")) {
      return Promise.resolve();
    }

    return ensureLibrary("highlight").then((ready) => {
      if (ready) {
        highlightLoadedCodeBlocks(root);
      }
    });
  }

  function highlightLoadedCodeBlocks(root) {
    if (!window.hljs) {
      return;
    }

    const codeNodes = root.querySelectorAll("pre code");
    codeNodes.forEach((codeNode) => {
      if (codeNode.closest(".mermaid-block")) {
        return;
      }

      if (codeNode.dataset.highlighted === "true") {
        return;
      }

      try {
        const classes = Array.from(codeNode.classList || []);
        const languageClass = classes.find((value) => /^language-|^lang-/i.test(value));
        const requestedRawLanguage = languageClass
          ? languageClass.replace(/^language-|^lang-/i, "").trim().toLowerCase()
          : "";
        const requestedLanguage = CODE_LANGUAGE_ALIAS[requestedRawLanguage] || requestedRawLanguage;
        const source = String(codeNode.textContent || "");

        if (requestedLanguage && window.hljs.getLanguage(requestedLanguage)) {
          const highlighted = window.hljs.highlight(source, {
            language: requestedLanguage,
            ignoreIllegals: true
          });

          codeNode.innerHTML = highlighted.value;
          codeNode.classList.add("hljs", `language-${requestedLanguage}`);
          codeNode.dataset.highlighted = "true";
          return;
        }

        const autoHighlighted = window.hljs.highlightAuto(source);
        codeNode.innerHTML = autoHighlighted.value;
        codeNode.classList.add("hljs");
        if (autoHighlighted.language) {
          codeNode.classList.add(`language-${autoHighlighted.language}`);
        }
        codeNode.dataset.highlighted = "true";
      } catch (error) {
        console.error("Code highlighting failed", error);
      }
    });
  }

  /* --- Taking the code away -------------------------------------------------
   *
   * A code block is the one thing on a page that is hard to select. It scrolls
   * in both directions, a triple-click takes a line rather than the block, and
   * dragging through a long listing takes the prose on either side of it too.
   * So each one gets a button.
   *
   * The clipboard is asked for twice, deliberately. navigator.clipboard does
   * not exist outside a secure context, and this app is most often reached at
   * http://<some-lan-address>:4321, which is not one — so the deprecated
   * execCommand path is not a legacy-browser courtesy here, it is the path that
   * actually runs for a lot of people.
   */
  function copyByExecCommand(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // Off-screen rather than hidden: a display:none textarea cannot be
    // selected, and an unselected textarea cannot be copied from.
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);

    // Selecting the textarea throws away whatever the reader had selected, so
    // it is put back afterwards.
    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    let copied = false;
    try {
      area.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    area.remove();

    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }

    return copied;
  }

  // Resolves when the text is on the clipboard, rejects when the browser
  // refused. Callers report that themselves — the share page has no toasts.
  function copyText(text) {
    const value = String(text == null ? "" : text);

    if (global.isSecureContext && global.navigator?.clipboard?.writeText) {
      return global.navigator.clipboard.writeText(value).catch(() => {
        // Permission can still be refused on a secure origin, and the older
        // path is not subject to the same policy.
        if (!copyByExecCommand(value)) {
          throw new Error("Copying was refused by the browser.");
        }
      });
    }

    if (copyByExecCommand(value)) {
      return Promise.resolve();
    }

    return Promise.reject(new Error("Copying was refused by the browser."));
  }

  const COPY_LABEL = "Copy this code";
  const COPY_FEEDBACK_MS = 1400;

  function flashCopyButton(button, copied) {
    const icon = button.querySelector("i");
    window.clearTimeout(Number(button.dataset.copyFlash || 0));

    button.classList.toggle("is-copied", copied);
    button.classList.toggle("is-failed", !copied);
    button.setAttribute("aria-label", copied ? "Copied" : "Could not copy");
    if (icon) {
      icon.className = `ph ${copied ? "ph-check" : "ph-warning-circle"}`;
    }

    button.dataset.copyFlash = String(window.setTimeout(() => {
      button.classList.remove("is-copied", "is-failed");
      button.setAttribute("aria-label", COPY_LABEL);
      if (icon) {
        icon.className = "ph ph-copy";
      }
      delete button.dataset.copyFlash;
    }, COPY_FEEDBACK_MS));
  }

  // One listener for the whole page rather than one per button. The editor
  // preview rebuilds its markup on every keystroke, so a listener attached per
  // button would be attached again on every keystroke as well.
  let copyDelegateBound = false;

  function bindCopyDelegate() {
    if (copyDelegateBound) {
      return;
    }

    copyDelegateBound = true;
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.(".code-copy");
      if (!button) {
        return;
      }

      event.preventDefault();
      const code = button.parentElement?.querySelector("pre code");
      if (!code) {
        return;
      }

      copyText(code.textContent)
        .then(() => flashCopyButton(button, true))
        .catch(() => flashCopyButton(button, false));
    });
  }

  /* Give every rendered code block a copy button.
   *
   * The button goes in a wrapper around the <pre> rather than inside it. A
   * <pre> scrolls horizontally, and an absolutely positioned child of a scroll
   * container scrolls away with the content — the button would slide off the
   * side of any block with one long line in it.
   */
  function addCopyButtons(root) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return;
    }

    // pre > code, not every pre: a notebook's output pane and a Mermaid
    // fallback are both <pre> and neither is code you would paste anywhere.
    for (const code of root.querySelectorAll("pre > code")) {
      const pre = code.parentElement;

      if (pre.parentElement?.classList.contains("code-block")) {
        continue;
      }

      // Code being typed into is already selectable, and in the visual editor
      // the corner of the block belongs to the language field.
      if (pre.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]')) {
        continue;
      }

      if (code.closest(".mermaid-block")) {
        continue;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "code-block";
      pre.replaceWith(wrapper);
      wrapper.appendChild(pre);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy";
      button.title = COPY_LABEL;
      button.setAttribute("aria-label", COPY_LABEL);
      button.innerHTML = '<i class="ph ph-copy" aria-hidden="true"></i>';
      wrapper.appendChild(button);
    }

    bindCopyDelegate();
  }

  // Everything a rendered code block needs once the markup is on the page. The
  // copy button is attached first and unconditionally: it needs nothing, and a
  // reader who cannot reach the CDN should still be able to take the code away.
  function decorateCodeBlocks(root) {
    addCopyButtons(root);
    return highlightCodeBlocks(root);
  }

  /* --- Colour while it is being typed --------------------------------------
   *
   * Highlighting rebuilds the markup the caret is standing in, which is why the
   * visual editor used to wait until you left a code block before colouring it.
   * Three things make it affordable on every pause instead:
   *
   *  - the caret is remembered as a character offset into the block's text and
   *    put back after the swap, so rebuilding the markup no longer moves it;
   *  - the language is worked out at most once per block rather than on every
   *    pass. highlightAuto() runs every grammar the library has against the
   *    text, and against half-typed code it also keeps changing its mind, so
   *    re-guessing would be both the expensive call and the one that makes a
   *    block flicker between Python and Ruby as it is written;
   *  - the text is compared with what was last painted, so arrow keys, clicks,
   *    and every keystroke that leaves the text alone cost nothing at all.
   *
   * The caller owns the timing. This is the part that has to be quick, not the
   * part that decides when to run.
   */
  // Past this, one pass is long enough to be felt. A block this size is a file
  // pasted into a document, and it keeps the on-blur behaviour.
  const LIVE_HIGHLIGHT_LIMIT = 20000;
  // Too little text and a guess is a coin toss, so an untagged block stays
  // uncoloured until there is something to go on.
  const LIVE_DETECT_MINIMUM = 24;
  // ...and having failed to guess, do not try again on the next keystroke.
  const LIVE_DETECT_STEP = 64;
  const LIVE_DETECT_RELEVANCE = 5;

  // Per code element: which language was settled on, and the exact text that is
  // currently painted. A WeakMap rather than a data attribute — the text of the
  // block is not something to keep a second copy of in the DOM.
  const liveHighlights = new WeakMap();

  function detectCodeLanguage(source) {
    try {
      const guess = global.hljs.highlightAuto(source);
      return guess.language && guess.relevance >= LIVE_DETECT_RELEVANCE ? guess.language : "";
    } catch (error) {
      console.error("Language detection failed", error);
      return "";
    }
  }

  // Where the selection sits inside `element`, counted in characters of its
  // text, so it survives the markup underneath it being replaced.
  function selectionOffsetsWithin(element) {
    const selection = element.ownerDocument?.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
      return null;
    }

    const leading = range.cloneRange();
    leading.selectNodeContents(element);
    leading.setEnd(range.startContainer, range.startOffset);
    const start = leading.toString().length;

    return { start, end: start + range.toString().length };
  }

  function placeSelectionWithin(element, start, end) {
    const doc = element.ownerDocument;
    const selection = doc?.getSelection?.();
    if (!selection) {
      return;
    }

    const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    let seen = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.nodeValue.length;

      if (!startNode && seen + length >= start) {
        startNode = node;
        startOffset = start - seen;
      }

      if (startNode && seen + length >= end) {
        endNode = node;
        endOffset = end - seen;
        break;
      }

      seen += length;
    }

    const range = doc.createRange();

    if (!startNode) {
      // The offsets ran past the text — an edit that shortened the block. The
      // end of it is the only honest place left to put the caret.
      range.selectNodeContents(element);
      range.collapse(false);
    } else {
      range.setStart(startNode, Math.min(startOffset, startNode.nodeValue.length));
      if (endNode) {
        range.setEnd(endNode, Math.min(endOffset, endNode.nodeValue.length));
      } else {
        range.setEnd(element, element.childNodes.length);
      }
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }

  /* Colour one code element in place, keeping the caret where it was.
   *
   * Returns true when the block is showing live colours for the text it
   * currently holds — including when it already was and nothing needed doing.
   * A caller can therefore use the answer to decide whether a full pass with
   * the auto-detector is still owed, which is what happens on blur.
   */
  function liveHighlightCode(codeNode, declaredLanguage) {
    if (!codeNode || !global.hljs) {
      return false;
    }

    const source = String(codeNode.textContent || "");
    if (source.trim() === "" || source.length > LIVE_HIGHLIGHT_LIMIT) {
      return false;
    }

    const declared = normalize(declaredLanguage).trim();
    const previous = liveHighlights.get(codeNode);
    // Renaming the fence starts the block over; anything else carries its
    // settled language and its last painted text forward.
    const live = previous && previous.declared === declared
      ? previous
      : { declared, language: "", painted: null, detectedAt: -Infinity };
    liveHighlights.set(codeNode, live);

    if (live.painted === source) {
      return true;
    }

    const named = CODE_LANGUAGE_ALIAS[declared] || declared;

    if (named && global.hljs.getLanguage(named)) {
      live.language = named;
    } else if (!live.language
      && source.length >= LIVE_DETECT_MINIMUM
      && source.length - live.detectedAt >= LIVE_DETECT_STEP) {
      live.detectedAt = source.length;
      live.language = detectCodeLanguage(source);
    }

    if (!live.language) {
      return false;
    }

    let markup = "";
    try {
      markup = global.hljs.highlight(source, { language: live.language, ignoreIllegals: true }).value;
    } catch (error) {
      console.error("Live highlighting failed", error);
      live.language = "";
      return false;
    }

    const caret = selectionOffsetsWithin(codeNode);

    codeNode.innerHTML = markup;
    // A block whose fence was renamed would otherwise accumulate one
    // language- class per language it has ever been called.
    for (const name of [...codeNode.classList]) {
      if (/^language-|^lang-/i.test(name)) {
        codeNode.classList.remove(name);
      }
    }
    codeNode.classList.add("hljs", `language-${live.language}`);
    codeNode.dataset.highlighted = "true";
    live.painted = source;

    if (caret) {
      placeSelectionWithin(codeNode, caret.start, caret.end);
    }

    return true;
  }


  global.MdCode = {
    highlightCodeBlocks, copyText, addCopyButtons, decorateCodeBlocks, detectCodeLanguage, selectionOffsetsWithin, placeSelectionWithin, liveHighlightCode
  };
})(typeof window === "undefined" ? globalThis : window);
