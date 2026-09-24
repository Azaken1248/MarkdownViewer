/* A .ipynb drawn as a document.
 *
 * Cells become sections, outputs become the things they claim to be — an image,
 * a table, a stream of text, a traceback — and the source of each code cell is
 * kept so the Run button has something to send. Everything arrives through the
 * same sanitizer as ordinary markdown.
 */
/* exported MdNotebook */
var MdNotebook = (function () {
  "use strict";

  const { hooks, CODE_LANGUAGE_ALIAS, MARKDOWN_SANITIZE_OPTIONS } = MdLazy;
  const { normalize, escapeHtml, isNotebookFile, isDiagramFile, toMermaidMarkdown, renderMarkdown } = MdText;

  function normalizeNotebookText(value) {
    if (Array.isArray(value)) {
      return value.join("");
    }

    if (value == null) {
      return "";
    }

    return String(value);
  }

  /* What the notebook says it is written in, in the three places it might say
   * so. Python when it says nothing, because that is what a notebook is
   * unless it says otherwise.
   */
  function declaredLanguage(notebook) {
    const metadata = notebook?.metadata;
    return metadata?.language_info?.name
      || metadata?.language_info?.codemirror_mode?.name
      || metadata?.kernelspec?.language
      || "python";
  }

  function inferNotebookLanguage(notebook) {
    const rawLanguage = normalize(declaredLanguage(notebook)).trim();

    if (!rawLanguage) {
      return "python";
    }

    if (rawLanguage.startsWith("python")) {
      return "python";
    }

    return CODE_LANGUAGE_ALIAS[rawLanguage] || rawLanguage;
  }

  function getNotebookImageSource(mimeType, payload) {
    const source = normalizeNotebookText(payload).trim();

    if (mimeType === "image/svg+xml") {
      const compactSource = source.replace(/\s+/g, "");
      if (/^[A-Za-z0-9+/=]+$/.test(compactSource)) {
        return `data:image/svg+xml;base64,${compactSource}`;
      }

      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    }

    return `data:${mimeType};base64,${source.replace(/\s+/g, "")}`;
  }

  function renderNotebookMimePayload(mimeType, payload) {
    const text = normalizeNotebookText(payload);

    switch (mimeType) {
      case "text/html":
        return `<div class="notebook-output-html">${DOMPurify.sanitize(text, MARKDOWN_SANITIZE_OPTIONS)}</div>`;
      case "image/svg+xml":
      case "image/png":
      case "image/jpeg":
      case "image/gif":
      case "image/webp":
      case "image/avif":
        return `<figure class="notebook-output notebook-output-image"><img src="${escapeHtml(getNotebookImageSource(mimeType, text))}" alt="Notebook output image" loading="lazy" /></figure>`;
      case "text/markdown":
        return `<div class="notebook-output-markdown">${renderMarkdown(text)}</div>`;
      case "application/json": {
        let formattedText = text;

        try {
          formattedText = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          formattedText = text;
        }

        return `<pre class="notebook-output-json">${escapeHtml(formattedText)}</pre>`;
      }
      case "text/plain":
      default:
        return `<pre class="notebook-output-text">${escapeHtml(text)}</pre>`;
    }
  }

  // What a notebook says while it runs: text on stdout or stderr.
  function streamOutput(output) {
      const streamName = escapeHtml(String(output?.name || "stream"));
      const streamText = escapeHtml(normalizeNotebookText(output?.text));
      return `
        <section class="notebook-output notebook-output-stream">
          <div class="notebook-output-label">${streamName}</div>
          <pre class="notebook-output-text">${streamText}</pre>
        </section>
      `;
  }

  // And what it says when it stops.
  function errorOutput(output) {
      const errorName = escapeHtml(String(output?.ename || "Error"));
      const errorValue = escapeHtml(String(output?.evalue || ""));
      const traceback = Array.isArray(output?.traceback)
        ? output.traceback.map((line) => normalizeNotebookText(line)).join("\n")
        : `${normalizeNotebookText(output?.ename)}: ${normalizeNotebookText(output?.evalue)}`;

      return `
        <section class="notebook-output notebook-output-error">
          <div class="notebook-output-label">Error</div>
          <div class="notebook-output-error-name">${errorName}</div>
          <div class="notebook-output-error-value">${errorValue}</div>
          <pre class="notebook-output-text">${escapeHtml(traceback)}</pre>
        </section>
      `;
  }

  /* What a result is shown as, best first. A notebook may offer the same
   * result several ways — a chart as HTML and as a PNG and as the words "a
   * chart" — and the first of these it has is the one worth showing.
   */
  const MIME_ORDER = [
    "text/html",
    "image/svg+xml",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "text/markdown",
    "application/json",
    "text/plain"
  ];

  const OUTPUT_KINDS = { stream: streamOutput, error: errorOutput };

  function renderNotebookOutput(output) {
    const kind = OUTPUT_KINDS[String(output?.output_type || "").toLowerCase()];
    if (kind) {
      return kind(output);
    }

    const data = output?.data || {};
    const mimeType = MIME_ORDER.find((type) => data[type] != null);
    if (!mimeType) {
      return "";
    }

    const mimeClass = mimeType.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    return `<section class="notebook-output notebook-output-${mimeClass}">`
      + `${renderNotebookMimePayload(mimeType, data[mimeType])}</section>`;
  }

  function markdownCell(source, cellNumber) {
      return `
        <section class="notebook-cell notebook-cell-markdown">
          <div class="notebook-cell-head">
            <span class="notebook-cell-badge">Markdown</span>
            <span class="notebook-cell-index">Cell ${cellNumber}</span>
          </div>
          <div class="notebook-cell-content">
            ${renderMarkdown(source)}
          </div>
        </section>
      `;
  }

  function codeCell(cell, source, cellNumber, notebookLanguage) {
      const executionCount = Number.isFinite(Number(cell?.execution_count))
        ? Number(cell.execution_count)
        : null;
      const outputHtml = Array.isArray(cell?.outputs)
        ? cell.outputs.map((output) => renderNotebookOutput(output)).filter(Boolean).join("")
        : "";

      // Only Python, and only when the host page allows it. A cell with no
      // source is nothing to run.
      const runnable = hooks.executableNotebooks
        && /^python/.test(normalize(notebookLanguage))
        && source.trim().length > 0;

      const runControls = runnable
        ? `<button class="notebook-run" type="button" data-cell="${cellNumber}"
             aria-label="Run cell ${cellNumber}" title="Run this cell">
             <i class="ph ph-play" aria-hidden="true"></i><span>Run</span>
           </button>`
        : "";

      return `
        <section class="notebook-cell notebook-cell-code" data-cell="${cellNumber}"${runnable ? ' data-runnable="true"' : ""}>
          <div class="notebook-cell-head">
            <span class="notebook-cell-badge">Code</span>
            <span class="notebook-cell-index">${executionCount != null ? `In [${executionCount}]` : `Cell ${cellNumber}`}</span>
            ${runControls}
          </div>
          <div class="notebook-cell-content">
            <pre class="notebook-code-block"><code class="language-${escapeHtml(notebookLanguage)}">${escapeHtml(source)}</code></pre>
            ${outputHtml ? `<div class="notebook-outputs">${outputHtml}</div>` : ""}
            ${runnable ? `<div class="notebook-live-output" data-cell="${cellNumber}" hidden></div>` : ""}
          </div>
        </section>
      `;
  }

  function rawCell(source, cellNumber) {
    return `
      <section class="notebook-cell notebook-cell-raw">
        <div class="notebook-cell-head">
          <span class="notebook-cell-badge">Raw</span>
          <span class="notebook-cell-index">Cell ${cellNumber}</span>
        </div>
        <div class="notebook-cell-content">
          <pre class="notebook-raw-block">${escapeHtml(source)}</pre>
        </div>
      </section>
    `;
  }

  function renderNotebookCell(cell, index, notebookLanguage) {
    const cellType = normalize(cell?.cell_type || "").trim();
    const cellNumber = index + 1;
    const source = normalizeNotebookText(cell?.source);

    if (cellType === "markdown") {
      return markdownCell(source, cellNumber);
    }

    // Anything that is not markdown and not code is raw: shown as it is, which
    // is what a raw cell means.
    return cellType === "code"
      ? codeCell(cell, source, cellNumber, notebookLanguage)
      : rawCell(source, cellNumber);
  }

  // Cell sources, keyed by cell number, so a Run handler gets the original text
  // rather than trying to reconstruct it from highlighted markup.
  const notebookCellSources = new Map();

  function notebookSourceFor(cellNumber) {
    return notebookCellSources.get(Number(cellNumber)) || "";
  }

  function renderNotebookDocument(rawContent, title) {
    const notebook = JSON.parse(String(rawContent || "").replace(/^\uFEFF/, ""));
    const cells = Array.isArray(notebook?.cells) ? notebook.cells : null;

    if (!cells) {
      throw new Error("Invalid notebook file");
    }

    const notebookLanguage = inferNotebookLanguage(notebook);

    // Fresh per document: cell 3 means cell 3 of the notebook now open, not of
    // whichever one was open before.
    notebookCellSources.clear();
    cells.forEach((cell, index) => {
      if (normalize(cell?.cell_type || "").trim() === "code") {
        notebookCellSources.set(index + 1, normalizeNotebookText(cell?.source));
      }
    });

    const cellCounts = cells.reduce((counts, cell) => {
      const type = normalize(cell?.cell_type || "").trim();
      if (type === "markdown") {
        counts.markdown += 1;
      } else if (type === "code") {
        counts.code += 1;
      } else if (type === "raw") {
        counts.raw += 1;
      }

      return counts;
    }, { markdown: 0, code: 0, raw: 0 });

    const totalCells = cells.length;
    const renderedCells = cells.map((cell, index) => renderNotebookCell(cell, index, notebookLanguage)).join("");

    return `
      <section class="notebook-summary">
        <p class="notebook-eyebrow"><i class="ph ph-file-code"></i> Jupyter Notebook</p>
        <h1>${escapeHtml(title || notebook?.metadata?.title || "Notebook")}</h1>
        <p class="notebook-meta">
          ${totalCells} cell${totalCells === 1 ? "" : "s"}
          · ${cellCounts.markdown} markdown
          · ${cellCounts.code} code
          ${cellCounts.raw ? `· ${cellCounts.raw} raw` : ""}
        </p>
      </section>
      <section class="notebook-cells">
        ${renderedCells || '<p class="notebook-empty">This notebook has no cells.</p>'}
      </section>
    `;
  }

  function renderDocumentContent(fileName, rawContent, title) {
    if (isNotebookFile(fileName)) {
      return renderNotebookDocument(rawContent, title);
    }

    const renderedSource = isDiagramFile(fileName)
      ? toMermaidMarkdown(rawContent)
      : rawContent;

    return renderMarkdown(renderedSource);
  }

  // Mermaid bakes hex colours into the SVG it emits, so it cannot read the CSS
  // custom properties the rest of the app themes with. These two tables are the
  // diagram-side mirror of the light and dark token sets in app.css; if a token
  // there changes, change its counterpart here.

  return {
    notebookSourceFor, renderNotebookDocument, renderDocumentContent
  };
})();
