/* Document rendering.
 *
 * Markdown, notebooks, Mermaid, code highlighting and math all live in
 * public/js/markdown-core.js, which the standalone share page loads too. One
 * copy of the sanitizer and one Mermaid securityLevel, rather than two that
 * drift apart.
 *
 * These wrappers keep the call sites unchanged, and are gathered here so that
 * every module can reach them without each one naming MarkdownCore.
 */

(function (global) {
  function waitForNextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function renderMarkdown(markdown) {
    return MarkdownCore.renderMarkdown(markdown);
  }

  // The colours and the copy button, both of which belong to a code block once it
  // has been rendered. The editor preview calls this on every keystroke, so the
  // copy pass has to be as cheap as the highlighting one: see addCopyButtons.
  function highlightCodeBlocks(root) {
    return MarkdownCore.decorateCodeBlocks(root);
  }

  function renderDocumentContent(fileName, rawContent, title) {
    return MarkdownCore.renderDocumentContent(fileName, rawContent, title);
  }

  global.AppRender = {
    waitForNextFrame,
    renderMarkdown,
    highlightCodeBlocks,
    renderDocumentContent
  };
})(typeof window === "undefined" ? globalThis : window);
