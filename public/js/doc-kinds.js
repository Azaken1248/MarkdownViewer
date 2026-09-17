/* What a document is, by its name. One copy, loaded by both sides.
 *
 * The server decides what it will store and the client decides what it will
 * offer to upload, open or create — and those have to be the same decision.
 * They used to be five: a Set in lib/docs/paths.js, an array in the client's
 * text helpers, and three regular expressions that each spelled the list out
 * again. Nothing held them together, so the client could drift into offering
 * what the server refuses, or refusing what it would take. One of them had:
 * the editor's "add .md if there is no extension" did not know .ipynb was one.
 *
 * This file is a plain script in the browser, hanging DocKinds off window like
 * every other module here, and a CommonJS module on the server, where
 * lib/docs/paths.js requires it. The same bytes run in both places, which is
 * the only arrangement under which they cannot disagree. The tests check
 * that no other file spells the list out again.
 */

(function (global) {
  "use strict";

  // Everything this app will store, list and open.
  const DOC_EXTENSIONS = [".md", ".markdown", ".mmd", ".mermaid", ".ipynb"];

  // The ones a notebook is, and the ones a diagram is. What is left is
  // markdown.
  const NOTEBOOK_EXTENSIONS = [".ipynb"];
  const DIAGRAM_EXTENSIONS = [".mmd", ".mermaid"];

  /* What the source editor can write.
   *
   * Everything but the notebook. The editor writes text, and a text file
   * called .ipynb is a notebook that will not open — so a name typed into it
   * as "notes.ipynb" gets .md added rather than being taken as read. That
   * used to be an accident of a regular expression that had simply left
   * .ipynb out; it is a rule now, and this is where it is written down.
   */
  const TEXT_DOC_EXTENSIONS = DOC_EXTENSIONS.filter((ext) => !NOTEBOOK_EXTENSIONS.includes(ext));

  // The extension of a name, lowercased, or "" if it has none. Only the last
  // dot counts, so "notes.v2.md" is a .md and "README" is nothing.
  function extensionOf(fileName) {
    const name = String(fileName || "");
    const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
    const base = slash >= 0 ? name.slice(slash + 1) : name;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot).toLowerCase() : "";
  }

  function hasOneOf(fileName, extensions) {
    return extensions.includes(extensionOf(fileName));
  }

  function isDocFile(fileName) {
    return hasOneOf(fileName, DOC_EXTENSIONS);
  }

  function isNotebookFile(fileName) {
    return hasOneOf(fileName, NOTEBOOK_EXTENSIONS);
  }

  function isDiagramFile(fileName) {
    return hasOneOf(fileName, DIAGRAM_EXTENSIONS);
  }

  // The name without its document extension, for a title. A name with some
  // other extension, or none, comes back as it was.
  function stripDocExtension(fileName) {
    const name = String(fileName || "");
    const ext = extensionOf(name);
    return DOC_EXTENSIONS.includes(ext) ? name.slice(0, name.length - ext.length) : name;
  }

  // A name the source editor can save under: kept if it already ends in
  // something the editor can write, given .md otherwise.
  function ensureDocFilename(fileName) {
    const value = String(fileName || "").trim();
    if (!value) {
      return "";
    }

    return hasOneOf(value, TEXT_DOC_EXTENSIONS) ? value : `${value}.md`;
  }

  // The list as a sentence, for the message a refused upload gets. Built from
  // the list rather than typed beside it, so it cannot fall behind.
  const DOC_EXTENSIONS_SENTENCE = DOC_EXTENSIONS.length > 1
    ? `${DOC_EXTENSIONS.slice(0, -1).join(", ")}, or ${DOC_EXTENSIONS[DOC_EXTENSIONS.length - 1]}`
    : DOC_EXTENSIONS.join("");

  const DocKinds = {
    DOC_EXTENSIONS,
    DOC_EXTENSIONS_SENTENCE,
    TEXT_DOC_EXTENSIONS,
    NOTEBOOK_EXTENSIONS,
    DIAGRAM_EXTENSIONS,
    extensionOf,
    isDocFile,
    isNotebookFile,
    isDiagramFile,
    stripDocExtension,
    ensureDocFilename
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DocKinds;
  }

  global.DocKinds = DocKinds;
})(typeof window === "undefined" ? globalThis : window);
