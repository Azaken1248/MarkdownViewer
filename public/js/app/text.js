// The small answers about a name, a size or a date.
//
// Nothing here reads the state or touches the page: hand it a filename and it
// tells you the title, the icon, or the extension it should have had. They are
// together because they are used from everywhere, and a function that only
// looks at its arguments is the cheapest kind of thing to move.

(function (global) {
  // The sanitizer configuration, the marked options and the code-language
  // aliases now live in markdown-core.js, shared with the share page.
  function filenameToTitle(filename) {
    return stripDocumentExtension(filename)
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function normalize(text) {
    return String(text || "").toLowerCase();
  }

  function escapeHtml(value) {
    return MarkdownCore.escapeHtml(value);
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripDocumentExtension(filename) {
    return String(filename || "").replace(/\.(md|markdown|mmd|mermaid|ipynb)$/i, "");
  }

  function isNotebookFile(fileName) {
    return MarkdownCore.isNotebookFile(fileName);
  }

  /* A document path in a URL.
   *
   * encodeURIComponent on the whole path would turn "docs/README.md" into
   * "docs%2FREADME.md" — one segment as far as routing is concerned, which the
   * wildcard routes do not match, and which a reverse proxy may rewrite anyway.
   * Each segment is encoded on its own and the separators stay separators.
   */
  /* Alphabetical, case-insensitively, with numbers compared as numbers so
   * "page-2" sorts before "page-10". The server sorts the same way; this exists
   * so the client can re-sort after a local change without waiting for a reload.
   */
  function compareNames(left, right) {
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  }

  // The name of a document, without the folder it sits in. A document's identity
  // is its path now ("docs/README.md"), and a row in a tree that already shows
  // the folder should say "README.md".
  function docName(file) {
    const value = String(file || "");
    const index = value.lastIndexOf("/");
    return index === -1 ? value : value.slice(index + 1);
  }

  function docUrl(file) {
    return String(file).split("/").map(encodeURIComponent).join("/");
  }

  function inferIcon(fileName) {
    const value = normalize(fileName);
    if (isNotebookFile(value)) {
      return "ph-file-code";
    }

    if (value.includes("srs") || value.includes("spec")) {
      return "ph-scroll";
    }

    if (value.includes("erd") || value.includes("schema") || value.includes("db")) {
      return "ph-graph";
    }

    if (value.includes("readme")) {
      return "ph-book-open-text";
    }

    if (value.endsWith(".mmd") || value.endsWith(".mermaid")) {
      return "ph-graph";
    }

    return "ph-file-text";
  }

  function ensureDocFilename(fileName) {
    const value = String(fileName || "").trim();
    if (!value) {
      return "";
    }

    if (/\.(md|markdown|mmd|mermaid)$/i.test(value)) {
      return value;
    }

    return `${value}.md`;
  }

  function isDiagramFile(fileName) {
    return MarkdownCore.isDiagramFile(fileName);
  }

  function toMermaidMarkdown(source) {
    return MarkdownCore.toMermaidMarkdown(source);
  }

  function formatDate(isoString) {
    if (!isoString) {
      return "unknown";
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "unknown";
    }

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatBytes(size) {
    const value = Number(size || 0);
    if (value < 1024) {
      return `${value} B`;
    }

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }

    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  global.AppText = {
    filenameToTitle,
    normalize,
    escapeHtml,
    escapeRegExp,
    stripDocumentExtension,
    isNotebookFile,
    docUrl,
    docName,
    compareNames,
    inferIcon,
    ensureDocFilename,
    isDiagramFile,
    toMermaidMarkdown,
    formatDate,
    formatBytes
  };
})(typeof window === "undefined" ? globalThis : window);
