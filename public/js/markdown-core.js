// The document rendering engine, shared by the app and by the standalone share
// page (share.html).
//
// This is the one name the pages know: MarkdownCore. The engine itself is the
// eight files under js/md, each loaded before this one, and all this does is
// gather what they offer into a single object. Which module a function lives in
// is a fact about the source tree, not something a caller should have to spell.
//
// It exists as its own namespace for one reason above all: the sanitizer. Two
// copies of DOMPurify configuration drift, and the copy nobody is looking at
// becomes the XSS hole. The Mermaid securityLevel is there for the same reason.
//
// They are plain scripts, not modules — the rest of this app is too — so they
// hang their namespaces off window and touch nothing else. The engine owns its
// own Mermaid/pan-zoom state and asks the host page for the two things it
// cannot know: which theme is showing, and where to report a render failure.

(function (global) {
  "use strict";

  const {
    mermaidState, configure, ensureLibrary,
    MARKDOWN_SANITIZE_OPTIONS, SANITIZE_ALLOWED_URI_PATTERN
  } = global.MdLazy;
  const {
    renderMarkdown, normalizeMarkdownMath, escapeHtml, activeThemeName,
    isNotebookFile, isDiagramFile, toMermaidMarkdown
  } = global.MdText;
  const { renderMathBlocks } = global.MdMath;
  const { renderNotebookDocument, notebookSourceFor, renderDocumentContent } = global.MdNotebook;
  const {
    DIAGRAM_PALETTES, ensureMermaidInitialized, promoteMermaidCodeBlocks, drawLaidOutDiagrams
  } = global.MdDiagramTheme;
  const {
    highlightCodeBlocks, decorateCodeBlocks, addCopyButtons, copyText,
    liveHighlightCode, selectionOffsetsWithin, placeSelectionWithin
  } = global.MdCode;
  const {
    sizeDiagramContainer, applyPanZoom, destroyPanZoomInstances,
    bindWheelZoomModifier, renderMermaidBlocks
  } = global.MdPanZoom;

  global.MarkdownCore = {
    configure,
    // Markdown
    renderMarkdown,
    normalizeMarkdownMath,
    escapeHtml,
    MARKDOWN_SANITIZE_OPTIONS,
    SANITIZE_ALLOWED_URI_PATTERN,
    // File-type helpers
    isNotebookFile,
    isDiagramFile,
    toMermaidMarkdown,
    // Notebooks
    renderNotebookDocument,
    notebookSourceFor,
    // Dispatches on file type: notebook, diagram source, or plain markdown.
    renderDocumentContent,
    // Diagrams, code and math
    renderMermaidBlocks,
    promoteMermaidCodeBlocks,
    drawLaidOutDiagrams,
    ensureMermaidInitialized,
    highlightCodeBlocks,
    decorateCodeBlocks,
    addCopyButtons,
    copyText,
    liveHighlightCode,
    // Caret arithmetic, exported because undo needs exactly what live
    // highlighting needs: where the selection is in the text, and how to put it
    // back once the markup under it has been rebuilt. A second copy of this is
    // a second chance to get Range boundaries wrong.
    selectionOffsetsWithin,
    placeSelectionWithin,
    // Warms the lazy highlighter, so the first pause in typing is not also the
    // first time anyone asked the CDN for it.
    loadHighlighter: () => ensureLibrary("highlight"),
    renderMathBlocks,
    sizeDiagramContainer,
    applyPanZoom,
    destroyPanZoomInstances,
    bindWheelZoomModifier,
    resetMermaidForThemeChange() {
      // Mermaid bakes its palette into the SVG, so a theme change means the
      // next render has to re-initialize with the other palette.
      mermaidState.ready = false;
    },
    activeThemeName,
    DIAGRAM_PALETTES
  };
})(window);
