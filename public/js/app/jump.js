/* Walking the matches inside the document on screen.
 *
 * The search box finds documents; this finds the words in the one you are
 * reading, marks them, and steps between them — including across into the next
 * document that matches, which is why it has to ask the app to open one.
 *
 * Nothing here touches the search panel: that is the list of documents, and it
 * lives next door.
 */

/* exported AppJump */
var AppJump = (function () {
  const { elements } = AppDom;
  const { state } = AppState;
  const { normalize } = AppText;
  const { buildJumpSearchTerms } = AppSearch;

  function clearDocumentJumpDecorations() {
    if (state.jumpHighlightTimer) {
      window.clearTimeout(state.jumpHighlightTimer);
      state.jumpHighlightTimer = null;
    }

    elements.docContent.querySelectorAll("mark.doc-jump-highlight").forEach((markNode) => {
      const textNode = document.createTextNode(markNode.textContent || "");
      markNode.replaceWith(textNode);
    });

    elements.docContent.querySelectorAll(".doc-jump-focus").forEach((node) => {
      node.classList.remove("doc-jump-focus");
    });

    state.jumpMarkedNodes = [];
    state.jumpMatchFile = null;
  }

  function areSameJumpTerms(leftTerms, rightTerms) {
    if (!Array.isArray(leftTerms) || !Array.isArray(rightTerms)) {
      return false;
    }

    if (leftTerms.length !== rightTerms.length) {
      return false;
    }

    return leftTerms.every((term, index) => term === rightTerms[index]);
  }

  function updateJumpNavigationUI() {
    const hasQuery = state.jumpQuery.trim().length > 0;
    const hasMatches = state.jumpMatchCount > 0;

    elements.matchNav.hidden = !hasQuery;
    elements.matchNavLabel.textContent = hasMatches
      ? `${state.jumpMatchIndex + 1} / ${state.jumpMatchCount}`
      : "0 / 0";
    elements.matchPrevBtn.disabled = !hasMatches;
    elements.matchNextBtn.disabled = !hasMatches;
  }

  function resetJumpNavigation() {
    clearDocumentJumpDecorations();
    state.jumpQuery = "";
    state.jumpTerms = [];
    state.jumpMatchIndex = -1;
    state.jumpMatchCount = 0;
    state.jumpMarkedNodes = [];
    state.jumpMatchFile = null;
    updateJumpNavigationUI();
  }

  function findDocumentTextMatches(root, terms) {
    const matches = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }

          if (parent.closest("pre, code, .mermaid, .mermaid-block, .mermaid-fallback-code, mark.doc-jump-highlight")) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!String(node.nodeValue || "").trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let currentNode = walker.nextNode();
    while (currentNode) {
      const normalizedText = normalize(currentNode.nodeValue || "");
      let cursor = 0;

      while (cursor < normalizedText.length) {
        let bestTerm = "";
        for (const term of terms) {
          if (term.length <= bestTerm.length) {
            continue;
          }

          if (normalizedText.startsWith(term, cursor)) {
            bestTerm = term;
          }
        }

        if (bestTerm) {
          matches.push({
            node: currentNode,
            start: cursor,
            end: cursor + bestTerm.length
          });
          cursor += bestTerm.length;
          continue;
        }

        cursor += 1;
      }

      currentNode = walker.nextNode();
    }

    return matches;
  }

  function highlightDocumentMatches(matches, activeIndex) {
    const markNodes = [];

    // Wrap from the end so text offsets remain valid for earlier matches.
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      const range = document.createRange();
      range.setStart(match.node, match.start);
      range.setEnd(match.node, match.end);

      const markNode = document.createElement("mark");
      markNode.className = "doc-jump-highlight";
      if (index === activeIndex) {
        markNode.classList.add("doc-jump-highlight-active");
      } else {
        markNode.classList.add("doc-jump-highlight-passive");
      }

      try {
        range.surroundContents(markNode);
        markNodes[index] = markNode;
      } catch (error) {
        console.error("Failed to apply match highlight", error);
      }
    }

    return markNodes.filter((node) => Boolean(node));
  }

  function setActiveJumpMatch(targetIndex, { scrollBehavior = "auto" } = {}) {
    if (state.jumpMarkedNodes.length === 0) {
      state.jumpMatchIndex = -1;
      state.jumpMatchCount = 0;
      updateJumpNavigationUI();
      return {
        found: false,
        index: -1,
        total: 0
      };
    }

    const total = state.jumpMarkedNodes.length;
    const safeIndex = ((Number(targetIndex) % total) + total) % total;

    const previousNode = state.jumpMarkedNodes[state.jumpMatchIndex];
    if (previousNode?.isConnected) {
      previousNode.classList.remove("doc-jump-highlight-active");
      previousNode.classList.add("doc-jump-highlight-passive");
    }

    const activeMarkNode = state.jumpMarkedNodes[safeIndex];
    if (!activeMarkNode?.isConnected) {
      state.jumpMatchIndex = -1;
      state.jumpMatchCount = 0;
      updateJumpNavigationUI();
      return {
        found: false,
        index: -1,
        total: 0
      };
    }

    activeMarkNode.classList.remove("doc-jump-highlight-passive");
    activeMarkNode.classList.add("doc-jump-highlight-active");

    elements.docContent.querySelectorAll(".doc-jump-focus").forEach((node) => {
      node.classList.remove("doc-jump-focus");
    });

    const focusNode = activeMarkNode.closest("h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th") || activeMarkNode.parentElement;
    if (focusNode) {
      focusNode.classList.add("doc-jump-focus");
    }

    activeMarkNode.scrollIntoView({
      behavior: scrollBehavior,
      block: "center",
      inline: "nearest"
    });

    state.jumpMatchIndex = safeIndex;
    state.jumpMatchCount = total;
    updateJumpNavigationUI();

    return {
      found: true,
      index: safeIndex,
      total
    };
  }

  const NO_MATCH = { found: false, index: -1, total: 0 };

  // Nothing found, or nothing to find: the marks come off and the counter goes
  // back to saying nothing.
  function forgetJumpMatches(sourceFile) {
    state.jumpMatchIndex = -1;
    state.jumpMatchCount = 0;
    state.jumpMarkedNodes = [];
    state.jumpMatchFile = sourceFile;
    updateJumpNavigationUI();
    return NO_MATCH;
  }

  /* Whether the marks already on the page are the marks this search wants.
   *
   * Re-marking a long document on every press of Enter is the slowest thing
   * this app does, and the answer is usually yes: the same query, in the same
   * document, whose marks are still attached to it.
   */
  function marksStillFit(sourceFile, query, terms) {
    return Boolean(
      sourceFile
      && state.jumpMatchFile === sourceFile
      && state.jumpMarkedNodes.length > 0
      && state.jumpMarkedNodes.every((node) => node?.isConnected)
      && state.jumpQuery === query
      && areSameJumpTerms(state.jumpTerms, terms)
    );
  }

  // Mark every match in the document. Answers false when there was nothing to
  // mark, which the caller reports as "not found".
  function markDocumentMatches(searchTerms, targetIndex, sourceFile) {
    clearDocumentJumpDecorations();

    const matches = findDocumentTextMatches(elements.docContent, searchTerms);
    state.jumpMatchCount = matches.length;

    if (matches.length === 0) {
      return false;
    }

    state.jumpMarkedNodes = highlightDocumentMatches(matches, Number(targetIndex));
    state.jumpMatchCount = state.jumpMarkedNodes.length;
    state.jumpMatchFile = sourceFile || state.activeFile || null;

    if (state.jumpMarkedNodes.length === 0) {
      return false;
    }

    state.jumpMatchIndex = -1;
    return true;
  }

  function jumpToSearchMatch(query, terms = [], targetIndex = 0, options = {}) {
    const sourceFile = String(options.sourceFile || state.activeFile || "").trim();
    const scrollBehavior = String(options.scrollBehavior || "auto");

    const searchTerms = buildJumpSearchTerms(query, terms);
    const normalizedQuery = String(query || "").trim();
    const reusable = marksStillFit(sourceFile, normalizedQuery, searchTerms);

    state.jumpQuery = normalizedQuery;
    state.jumpTerms = [...searchTerms];

    if (searchTerms.length === 0) {
      clearDocumentJumpDecorations();
      return forgetJumpMatches(null);
    }

    if (!reusable && !markDocumentMatches(searchTerms, targetIndex, sourceFile)) {
      return forgetJumpMatches(sourceFile || null);
    }

    return setActiveJumpMatch(targetIndex, { scrollBehavior });
  }

  function getNavigationDocFilesForJump() {
    if (!state.jumpQuery.trim()) {
      return [];
    }

    const sourceDocs = state.filteredDocs.length > 0
      ? state.filteredDocs
      : state.searchResults.length > 0
        ? state.searchResults
        : state.docs;

    const orderedFiles = [];
    const seen = new Set();

    if (state.activeFile && !seen.has(state.activeFile)) {
      seen.add(state.activeFile);
      orderedFiles.push(state.activeFile);
    }

    for (const doc of sourceDocs) {
      const file = String(doc?.file || "");
      if (!file || seen.has(file)) {
        continue;
      }

      seen.add(file);
      orderedFiles.push(file);
    }

    return orderedFiles;
  }

  /* The next match in this document, if there is one.
   *
   * Answers null when the walk has run off either end of it, which is the
   * signal to go looking in the next document.
   */
  function nextMatchHere(step) {
    if (state.jumpMatchCount === 0) {
      return null;
    }

    const targetIndex = state.jumpMatchIndex >= 0
      ? state.jumpMatchIndex + step
      : (step > 0 ? 0 : -1);

    return targetIndex >= 0 && targetIndex < state.jumpMatchCount
      ? setActiveJumpMatch(targetIndex, { scrollBehavior: "smooth" })
      : null;
  }

  /* On through the other documents, in the order the list is in, until one of
   * them has a match in it or they have all been tried.
   *
   * Opening a document is what searches it — the marks are made on the way in
   * — so this is a walk of openings rather than of searches.
   */
  async function nextMatchElsewhere(step) {
    const navigationFiles = getNavigationDocFilesForJump();
    if (navigationFiles.length === 0) {
      return NO_MATCH;
    }

    const from = navigationFiles.indexOf(state.activeFile || state.jumpMatchFile || "");
    let at = from < 0 ? 0 : from;

    for (let attempt = 0; attempt < navigationFiles.length; attempt += 1) {
      at = (at + step + navigationFiles.length) % navigationFiles.length;
      const targetFile = navigationFiles[at];

      await App.openDocument(targetFile, true, {
        jumpQuery: state.jumpQuery,
        jumpTerms: state.jumpTerms,
        jumpIndex: step > 0 ? 0 : -1,
        scrollBehavior: "smooth"
      });

      if (state.activeFile === targetFile && state.jumpMatchCount > 0) {
        return {
          found: true,
          index: state.jumpMatchIndex,
          total: state.jumpMatchCount,
          file: targetFile,
          docChanged: true
        };
      }
    }

    return NO_MATCH;
  }

  async function moveToAdjacentJumpMatch(direction) {
    if (!state.jumpQuery.trim()) {
      return NO_MATCH;
    }

    const step = direction >= 0 ? 1 : -1;
    return nextMatchHere(step) || nextMatchElsewhere(step);
  }

  return {
    clearDocumentJumpDecorations,
    areSameJumpTerms,
    updateJumpNavigationUI,
    resetJumpNavigation,
    findDocumentTextMatches,
    highlightDocumentMatches,
    setActiveJumpMatch,
    jumpToSearchMatch,
    getNavigationDocFilesForJump,
    moveToAdjacentJumpMatch
  };
})();
