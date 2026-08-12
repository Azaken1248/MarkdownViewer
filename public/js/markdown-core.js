// The document rendering engine, shared by the app and by the standalone share
// page (share.html).
//
// This exists as its own file for one reason above all: the sanitizer. Two
// copies of DOMPurify configuration drift, and the copy nobody is looking at
// becomes the XSS hole. The Mermaid securityLevel is here for the same reason.
//
// It is a plain script, not a module — the rest of this app is too — so it
// hangs one namespace off window and touches nothing else. It owns its own
// Mermaid/pan-zoom state and asks the host page for the two things it cannot
// know: which theme is showing, and where to report a render failure.

(function (global) {
  "use strict";

  // The host page overrides these; the defaults keep the core usable alone.
  // State the core owns, previously fields on the app's global `state` object.
  // Keeping it here is what lets the share page render diagrams without
  // dragging in the app's entire state model.
  const mermaidState = { ready: false, theme: null, panZoomCounter: 0 };

  const hooks = {
    onWarning(message) {
      console.warn(message);
    },
    // Off unless the host page turns it on. The share page leaves it off: a
    // visitor following a link should not be handed a Run button for code
    // somebody else wrote.
    executableNotebooks: false
  };

  function configure(overrides) {
    Object.assign(hooks, overrides || {});
  }

  const SANITIZE_ALLOWED_URI_PATTERN = /^(?:(?:(?:f|ht)tps?|mailto|tel):|data:image\/(?:bmp|gif|jpe?g|png|svg\+xml|webp|avif)(?:;charset=[^;,]+)?(?:;base64)?,|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;
  const MARKDOWN_SANITIZE_OPTIONS = {
    ALLOWED_URI_REGEXP: SANITIZE_ALLOWED_URI_PATTERN,
    ADD_DATA_URI_TAGS: ["img"]
  };
  const CODE_LANGUAGE_ALIAS = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    html: "xml"
  };

  /* --- The heavy half, fetched only when a document needs it ---------------
   *
   * Mermaid is 3.5MB. As a <script defer> in the head it had to arrive and
   * parse before app.js — the file that draws the entire interface — was
   * allowed to run, so every visit paid for a diagram engine, a maths
   * typesetter and a syntax highlighter before it could show a word of text,
   * whether or not the document contained a diagram, an equation or a line of
   * code. All four are only ever reached from inside a render, so they are
   * fetched from inside a render.
   *
   * marked and DOMPurify are deliberately not here. Nothing renders without
   * them, so there is nothing to defer.
   *
   * The integrity hashes are the ones the eager tags carried and must move with
   * the versions. When bumping one, recompute:
   *   curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
   */
  const LAZY_LIBRARIES = {
    mermaid: {
      label: "The diagram engine",
      loaded: () => Boolean(global.mermaid),
      assets: [
        {
          js: "https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js",
          integrity: "sha384-aBQXj4hK6Jm05i7aQAsUV3bLdSUrHX1BGYfMB0166TtWt/RRaw+h0Eelme9OCOvy"
        }
      ]
    },
    panZoom: {
      label: "Diagram pan and zoom",
      loaded: () => Boolean(global.svgPanZoom),
      assets: [
        {
          js: "https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js",
          integrity: "sha384-yc/c2Lk1s2V2ir1rxvjo8YyVD9PlOlYTqpNr3Wm1WIuAA30GlDYNx6U5104OiavY"
        }
      ]
    },
    highlight: {
      label: "Syntax highlighting",
      loaded: () => Boolean(global.hljs),
      assets: [
        {
          js: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js",
          integrity: "sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU"
        }
      ]
    },
    // The stylesheet belongs to the same download: KaTeX without its CSS is a
    // column of unspaced glyphs, which reads worse than the TeX it replaced.
    // auto-render reads the katex global at call time, so order matters here —
    // which is why assets load one after another rather than all at once.
    math: {
      label: "Maths typesetting",
      loaded: () => Boolean(global.katex && global.renderMathInElement),
      assets: [
        {
          css: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css",
          integrity: "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+"
        },
        {
          js: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js",
          integrity: "sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg"
        },
        {
          js: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js",
          integrity: "sha384-43gviWU0YVjaDtb/GhzOouOXtZMP/7XUzwPTstBeZFe/+rCMvRwr4yROQP43s0Xk"
        }
      ]
    }
  };

  const libraryLoads = new Map();

  function loadAsset(asset) {
    return new Promise((resolve, reject) => {
      const node = document.createElement(asset.css ? "link" : "script");
      if (asset.css) {
        node.rel = "stylesheet";
        node.href = asset.css;
      } else {
        node.src = asset.js;
      }

      // Same integrity, crossorigin and referrer policy the head tags carried.
      // A subresource that stops being checked because it moved to a lazy load
      // is a subresource that stopped being checked.
      node.integrity = asset.integrity;
      node.crossOrigin = "anonymous";
      node.referrerPolicy = "no-referrer";
      node.addEventListener("load", () => resolve());
      node.addEventListener("error", () => reject(new Error(`Could not load ${asset.css || asset.js}`)));
      document.head.appendChild(node);
    });
  }

  // Resolves true once the library is usable. One load per page, shared by
  // every render that asks while it is still in flight. A failure is not
  // cached: a document opened after the network comes back tries again, and
  // until then the render degrades exactly as it did when the library was
  // simply absent.
  function ensureLibrary(name) {
    const library = LAZY_LIBRARIES[name];
    if (!library) {
      return Promise.resolve(false);
    }

    if (library.loaded()) {
      return Promise.resolve(true);
    }

    if (!libraryLoads.has(name)) {
      const load = (async () => {
        for (const asset of library.assets) {
          await loadAsset(asset);
        }
      })()
        .then(() => library.loaded())
        .catch((error) => {
          console.error(error);
          libraryLoads.delete(name);
          hooks.onWarning(`${library.label} could not be loaded, so part of this document is shown unformatted.`);
          return false;
        });

      libraryLoads.set(name, load);
    }

    return libraryLoads.get(name);
  }

  marked.setOptions({
    gfm: true,
    breaks: false,
    mangle: false,
    headerIds: true,
    langPrefix: "language-"
  });


  // Local copy: a lowercase helper, not shared behaviour worth coupling over.
  function normalize(text) {
    return String(text || "").toLowerCase();
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    let binary = "";

    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }

    return window.btoa(binary);
  }

  function normalizeMatrixEnvironments(tex) {
    const source = String(tex || "");
    const matrixEnvironmentPattern = /\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}/g;

    return source.replace(matrixEnvironmentPattern, (match, environmentName, body) => {
      if (body.includes("\\\\")) {
        return match;
      }

      const rows = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => line.replace(/\\+\s*$/, "").trim())
        .filter((line) => line.length > 0);

      if (rows.length <= 1) {
        return match;
      }

      return `\\begin{${environmentName}}\n${rows.join(" \\\\ \n")}\n\\end{${environmentName}}`;
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isNotebookFile(fileName) {
    return /\.ipynb$/i.test(String(fileName || ""));
  }

  function isDiagramFile(fileName) {
    return /\.(mmd|mermaid)$/i.test(String(fileName || ""));
  }

  function toMermaidMarkdown(diagramSource) {
    return `\n\
  \`\`\`mermaid
  ${String(diagramSource || "")}
  \`\`\`
  `;
  }

  function decodeBase64Utf8(value) {
    const binary = window.atob(String(value || ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function activeThemeName() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function normalizeMarkdownMath(markdown) {
    const source = String(markdown || "");
    if (!source.includes("[") && !source.includes("]") && !source.includes("\\[") && !source.includes("$$")) {
      return source;
    }

    const lines = source.split(/\r?\n/);
    const normalizedLines = [];
    let inCodeFence = false;
    let codeFenceMarker = "";
    let inDisplayMathBlock = false;
    let displayMathMode = "";
    let displayMathLines = [];

    const flushDisplayMathBlock = () => {
      const tex = normalizeMatrixEnvironments(displayMathLines.join("\n").trim());
      if (tex) {
        normalizedLines.push(`<div class="math-block" data-math-tex="${encodeBase64Utf8(tex)}"></div>`);
      }

      displayMathLines = [];
      inDisplayMathBlock = false;
      displayMathMode = "";
    };

    for (const line of lines) {
      const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[2][0];
        if (!inCodeFence) {
          inCodeFence = true;
          codeFenceMarker = marker;
        } else if (marker === codeFenceMarker) {
          inCodeFence = false;
          codeFenceMarker = "";
        }

        normalizedLines.push(line);
        continue;
      }

      if (!inCodeFence) {
        const trimmed = line.trim();
        if (!inDisplayMathBlock && (trimmed === "[" || trimmed === "\\[" || trimmed === "$$")) {
          inDisplayMathBlock = true;
          displayMathMode = trimmed;
          displayMathLines = [];
          continue;
        }

        if (inDisplayMathBlock) {
          const isClosingBracket = (displayMathMode === "[" || displayMathMode === "\\[") && (trimmed === "]" || trimmed === "\\]");
          const isClosingDollar = displayMathMode === "$$" && trimmed === "$$";

          if (isClosingBracket || isClosingDollar) {
            flushDisplayMathBlock();
            continue;
          }

          displayMathLines.push(line);
          continue;
        }
      }

      normalizedLines.push(line);
    }

    if (inDisplayMathBlock && displayMathLines.length > 0) {
      normalizedLines.push(...displayMathLines);
    }

    return normalizedLines.join("\n");
  }

  function renderMarkdown(markdown) {
    const normalizedMarkdown = normalizeMarkdownMath(markdown);
    const unsafeHtml = marked.parse(normalizedMarkdown);
    return DOMPurify.sanitize(unsafeHtml, MARKDOWN_SANITIZE_OPTIONS);
  }

  // Display maths is a marker element; inline maths is whatever KaTeX's own
  // scanner would pick up, so this looks for the same delimiters it does. A
  // false positive costs one download nobody reads; a false negative leaves an
  // equation as raw TeX, so the pattern errs towards fetching.
  const INLINE_MATH_PATTERN = /\$[^$\n]+\$|\\\(|\\\[|\\begin\{/;

  function hasMathContent(root) {
    if (root.querySelector(".math-block[data-math-tex]")) {
      return true;
    }

    return INLINE_MATH_PATTERN.test(root.textContent || "");
  }

  // Resolves when the maths on screen is typeset. Already-loaded KaTeX is used
  // on the spot rather than a microtask later, so nothing that renders and
  // measures in the same breath has to learn to wait.
  function renderMathBlocks(root) {
    if (!root) {
      return Promise.resolve();
    }

    if (global.katex || global.renderMathInElement) {
      renderLoadedMathBlocks(root);
      return Promise.resolve();
    }

    if (!hasMathContent(root)) {
      return Promise.resolve();
    }

    return ensureLibrary("math").then((ready) => {
      if (ready) {
        renderLoadedMathBlocks(root);
      }
    });
  }

  function renderLoadedMathBlocks(root) {
    if (!root) {
      return;
    }

    if (window.katex) {
      const blockNodes = root.querySelectorAll(".math-block[data-math-tex]");
      for (const node of blockNodes) {
        const tex = decodeBase64Utf8(node.getAttribute("data-math-tex") || "");

        try {
          window.katex.render(tex, node, {
            displayMode: true,
            throwOnError: false,
            errorColor: "#eb9b96"
          });
        } catch (error) {
          console.error("Math block rendering failed", error);
          node.textContent = tex;
        }
      }
    }

    if (!window.renderMathInElement) {
      return;
    }

    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false }
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "svg"],
        processEscapes: true,
        throwOnError: false,
        errorColor: "#eb9b96"
      });
    } catch (error) {
      console.error("Math rendering failed", error);
    }
  }

  function waitForNextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  function normalizeNotebookText(value) {
    if (Array.isArray(value)) {
      return value.join("");
    }

    if (value == null) {
      return "";
    }

    return String(value);
  }

  function inferNotebookLanguage(notebook) {
    const rawLanguage = normalize(
      notebook?.metadata?.language_info?.name
        || notebook?.metadata?.language_info?.codemirror_mode?.name
        || notebook?.metadata?.kernelspec?.language
        || "python"
    ).trim();

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

  function renderNotebookOutput(output) {
    const outputType = String(output?.output_type || "").toLowerCase();

    if (outputType === "stream") {
      const streamName = escapeHtml(String(output?.name || "stream"));
      const streamText = escapeHtml(normalizeNotebookText(output?.text));
      return `
        <section class="notebook-output notebook-output-stream">
          <div class="notebook-output-label">${streamName}</div>
          <pre class="notebook-output-text">${streamText}</pre>
        </section>
      `;
    }

    if (outputType === "error") {
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

    const data = output?.data || {};
    const mimeOrder = [
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

    for (const mimeType of mimeOrder) {
      if (data[mimeType] != null) {
        const mimeClass = mimeType.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
        return `<section class="notebook-output notebook-output-${mimeClass}">${renderNotebookMimePayload(mimeType, data[mimeType])}</section>`;
      }
    }

    return "";
  }

  function renderNotebookCell(cell, index, notebookLanguage) {
    const cellType = normalize(cell?.cell_type || "").trim();
    const cellNumber = index + 1;
    const source = normalizeNotebookText(cell?.source);

    if (cellType === "markdown") {
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

    if (cellType === "code") {
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
  const DIAGRAM_PALETTES = {
    dark: {
      themeVariables: {
        background: "#0c1214",
        mainBkg: "#1c262a",
        primaryColor: "#1c262a",
        primaryTextColor: "#dce7e5",
        primaryBorderColor: "#3f8d84",
        secondaryColor: "#253238",
        secondaryTextColor: "#dce7e5",
        secondaryBorderColor: "#2e3d42",
        tertiaryColor: "#0a1013",
        tertiaryTextColor: "#dce7e5",
        tertiaryBorderColor: "#2e3d42",
        lineColor: "#86a09d",
        textColor: "#dce7e5",
        nodeBorder: "#3f8d84",
        nodeTextColor: "#dce7e5",
        clusterBkg: "#0a1013",
        clusterBorder: "#2e3d42",
        edgeLabelBackground: "#0c1214",
        labelBoxBkgColor: "#1c262a",
        labelBoxBorderColor: "#2e3d42",
        labelTextColor: "#dce7e5",
        titleColor: "#dce7e5",
        actorBkg: "#1c262a",
        actorBorder: "#3f8d84",
        actorTextColor: "#dce7e5",
        actorLineColor: "#86a09d",
        signalColor: "#86a09d",
        signalTextColor: "#dce7e5",
        loopTextColor: "#dce7e5",
        noteBkgColor: "#253238",
        noteTextColor: "#dce7e5",
        noteBorderColor: "#2e3d42",
        attributeBackgroundColorOdd: "#0c1214",
        attributeBackgroundColorEven: "#1c262a",
        altBackground: "#0a1013"
      },
      // Fills the base theme emits that have to be corrected on this background.
      strayFills: ["#ffffff", "white", "#ECECFF"]
    },
    light: {
      themeVariables: {
        background: "#ffffff",
        mainBkg: "#eef4f2",
        primaryColor: "#eef4f2",
        primaryTextColor: "#101b1a",
        primaryBorderColor: "#10635a",
        secondaryColor: "#dcece9",
        secondaryTextColor: "#101b1a",
        secondaryBorderColor: "#a6b9b5",
        tertiaryColor: "#f4f8f7",
        tertiaryTextColor: "#101b1a",
        tertiaryBorderColor: "#a6b9b5",
        lineColor: "#465956",
        textColor: "#101b1a",
        nodeBorder: "#10635a",
        nodeTextColor: "#101b1a",
        clusterBkg: "#f4f8f7",
        clusterBorder: "#a6b9b5",
        edgeLabelBackground: "#ffffff",
        labelBoxBkgColor: "#eef4f2",
        labelBoxBorderColor: "#a6b9b5",
        labelTextColor: "#101b1a",
        titleColor: "#101b1a",
        actorBkg: "#eef4f2",
        actorBorder: "#10635a",
        actorTextColor: "#101b1a",
        actorLineColor: "#465956",
        signalColor: "#465956",
        signalTextColor: "#101b1a",
        loopTextColor: "#101b1a",
        noteBkgColor: "#dcece9",
        noteTextColor: "#101b1a",
        noteBorderColor: "#a6b9b5",
        attributeBackgroundColorOdd: "#ffffff",
        attributeBackgroundColorEven: "#eef4f2",
        altBackground: "#f4f8f7"
      },
      // On white, the base theme's own light fills are fine; the lavender is not.
      strayFills: ["#ECECFF"]
    }
  };

  function buildDiagramThemeCss(palette) {
    const vars = palette.themeVariables;
    const strayShapes = palette.strayFills
      .flatMap((fill) => ["rect", "polygon", "circle", "ellipse"].map((shape) => `${shape}[fill="${fill}"]`))
      .join(", ");

    return `
        /* Only the gaps the base theme leaves. Crucially not a blanket rule on
           <path>: that fills edge lines and turns every connector into a solid
           blob. */
        text,
        tspan {
          fill: ${vars.textColor};
        }

        .nodeLabel,
        .edgeLabel,
        .label,
        foreignObject div,
        foreignObject span {
          color: ${vars.textColor} !important;
        }

        /* Edge labels ship with their own plate behind them. */
        .edgeLabel rect,
        .labelBkg,
        rect.background {
          fill: ${vars.edgeLabelBackground} !important;
          opacity: 1 !important;
        }

        .er.entityBox,
        .entityBox {
          fill: ${vars.mainBkg};
          stroke: ${vars.nodeBorder};
        }

        .relationshipLine,
        .messageLine0,
        .messageLine1 {
          stroke: ${vars.lineColor};
          fill: none;
        }

        /* Stray fills the base theme still emits, without touching edges. */
        ${strayShapes} {
          fill: ${vars.mainBkg} !important;
        }
      `;
  }

  function ensureMermaidInitialized() {
    if (!window.mermaid) {
      return;
    }

    // Re-initialize when the theme has moved on, not only when nothing has been
    // initialized yet — otherwise a stale palette survives a theme change.
    const theme = activeThemeName();
    if (mermaidState.ready && mermaidState.theme === theme) {
      return;
    }

    const palette = DIAGRAM_PALETTES[theme] || DIAGRAM_PALETTES.dark;

    window.mermaid.initialize({
      startOnLoad: false,
      // "antiscript" runs DOMPurify over diagram labels and blocks javascript:
      // click directives, while still allowing the <br/> tags our docs rely on.
      // Do not set this back to "loose": Mermaid renders after DOMPurify has run
      // on the markdown, so "loose" lets an uploaded document execute script.
      securityLevel: "antiscript",
      theme: "base",
      darkMode: theme === "dark",
      fontFamily: '"Inter", sans-serif',
      // Colours belong in themeVariables, not in blanket !important overrides.
      // An earlier set filled every node with the surface colour — the same
      // colour as the block behind it — and stroked them in --border-muted, which
      // is barely a shade off it. Nodes have to sit a step above the background
      // with a border that can actually be seen.
      themeVariables: palette.themeVariables,
      er: {
        useMaxWidth: true
      },
      themeCSS: buildDiagramThemeCss(palette)
    });

    mermaidState.theme = theme;
    mermaidState.ready = true;
  }

  function promoteMermaidCodeBlocks(root) {
    const codeNodes = root.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid");
    codeNodes.forEach((codeNode) => {
      const source = codeNode.textContent || "";
      const block = document.createElement("div");
      block.className = "mermaid mermaid-block";
      block.textContent = source;
      // Kept so the diagram can be redrawn from source when the theme changes;
      // Mermaid bakes its colours into the SVG at render time, so a repaint is
      // the only way to recolour one.
      block.dataset.mermaidSource = source;
      const pre = codeNode.closest("pre");
      if (pre) {
        pre.replaceWith(block);
      }
    });
  }

  // Resolves when the code on screen is coloured. As with maths, an already
  // loaded highlighter runs synchronously: the editor preview repaints on every
  // keystroke and must not lose its colours to a microtask each time.
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

  function normalizeMermaidSource(source) {
    return String(source || "")
      .replace(/\uFEFF/g, "")
      .replace(/[\u200B-\u200D]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\r\n/g, "\n")
      .trim();
  }

  function simplifyErDiagramSource(source) {
    const raw = normalizeMermaidSource(source);
    if (!/^erDiagram\b/.test(raw)) {
      return raw;
    }

    const lines = raw.split("\n");
    let inEntity = false;
    const output = [];

    for (const originalLine of lines) {
      const line = originalLine.replace(/\t/g, "  ");
      const trimmed = line.trim();

      if (!trimmed) {
        output.push("");
        continue;
      }

      if (trimmed === "erDiagram") {
        output.push("erDiagram");
        continue;
      }

      if (trimmed.endsWith("{")) {
        inEntity = true;
        output.push(`  ${trimmed}`);
        continue;
      }

      if (trimmed === "}") {
        inEntity = false;
        output.push("  }");
        continue;
      }

      if (inEntity) {
        const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(PK|FK|UK))?/i);
        if (!match) {
          continue;
        }

        let type = match[1].toLowerCase();
        const name = match[2];
        const key = match[3] ? match[3].toUpperCase() : "";

        if (type === "timestamp") {
          type = "datetime";
        }
        if (type === "text") {
          type = "string";
        }
        if (type === "enum") {
          type = "string";
        }

        output.push(`    ${type} ${name}${key ? ` ${key}` : ""}`);
        continue;
      }

      const relMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s+(\|\|--\|\{|\|\|--o\{|o\|--\|\{|o\|--o\{|\|o--\|\{|\|o--o\{|\}\|--\|\{|\}\|--o\{|\|\|--\|\||\|\|--o\||o\|--\|\||o\|--o\|)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/);
      if (relMatch) {
        const left = relMatch[1];
        const connector = relMatch[2];
        const right = relMatch[3];
        const rawLabel = relMatch[4]
          .replace(/^"|"$/g, "")
          .replace(/[^A-Za-z0-9_ ]/g, " ")
          .replace(/\s+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toLowerCase();
        const label = rawLabel || "relates_to";
        output.push(`  ${left} ${connector} ${right} : ${label}`);
        continue;
      }

      output.push(`  ${trimmed}`);
    }

    return output.join("\n");
  }

  async function renderSingleMermaidNode(node) {
    const raw = normalizeMermaidSource(node.textContent || "");
    const attempts = [raw];
    const simplified = simplifyErDiagramSource(raw);
    if (simplified && simplified !== raw) {
      attempts.push(simplified);
    }

    let lastError = null;

    for (const candidate of attempts) {
      try {
        mermaidState.panZoomCounter += 1;
        const renderId = `mermaid-svg-${mermaidState.panZoomCounter}`;
        const { svg, bindFunctions } = await window.mermaid.render(renderId, candidate);
        node.innerHTML = svg;
        if (typeof bindFunctions === "function") {
          bindFunctions(node);
        }
        return true;
      } catch (error) {
        lastError = error;
      }
    }

    const errText = String(lastError?.str || lastError?.message || "Unknown parser error");
    node.innerHTML = `
      <pre class="mermaid-fallback-code">${escapeHtml(raw)}</pre>
      <p class="mermaid-fallback-error">Mermaid parse failed: ${escapeHtml(errText)}</p>
    `;
    return false;
  }

  // svg-pan-zoom binds window resize and wheel handlers per instance. They were
  // never released, so every re-render and every document switch leaked another
  // set that kept firing against detached SVGs for the life of the page.
  const livePanZoomInstances = new Map();

  function destroyPanZoomInstances(root = null) {
    for (const [svg, instance] of [...livePanZoomInstances.entries()]) {
      // A null root means "everything"; otherwise only what lives under it, plus
      // any node that has since been detached from the document.
      if (root && root.contains(svg) === false && svg.isConnected) {
        continue;
      }

      try {
        instance.destroy();
      } catch (error) {
        console.error("Pan/zoom destroy failed", error);
      }

      delete svg.dataset.panzoomInit;
      livePanZoomInstances.delete(svg);
    }
  }

  // Wheel-over-diagram used to zoom instead of scrolling the page, which turned
  // every diagram into a scroll trap. Wheel zoom is now opt-in for exactly as
  // long as Ctrl/Cmd is held — the same gesture maps use.
  let wheelZoomArmed = false;

  function setWheelZoomArmed(armed) {
    if (armed === wheelZoomArmed) {
      return;
    }

    wheelZoomArmed = armed;
    for (const instance of livePanZoomInstances.values()) {
      try {
        if (armed) {
          instance.enableMouseWheelZoom();
        } else {
          instance.disableMouseWheelZoom();
        }
      } catch (error) {
        console.error("Pan/zoom wheel toggle failed", error);
      }
    }
  }

  function bindWheelZoomModifier() {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Control" || event.key === "Meta") {
        setWheelZoomArmed(true);
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.key === "Control" || event.key === "Meta") {
        setWheelZoomArmed(false);
      }
    });

    // A keyup that happens while the window is unfocused never arrives, so the
    // modifier would stay stuck on. Reset whenever focus leaves.
    window.addEventListener("blur", () => setWheelZoomArmed(false));
  }

  // svg-pan-zoom sets the SVG to width:100%/height:100%, so the block has to have
  // a height of its own or the whole thing collapses to nothing — which is what a
  // plain `height: auto` container did. Take the shape from the diagram's own
  // viewBox so each one is sized to its content instead of a blanket 65vh, and let
  // CSS clamp the extremes.
  const DIAGRAM_FALLBACK_RATIO = "16 / 9";
  const DIAGRAM_FALLBACK_WIDTH = 720;
  // Small diagrams are still scaled up to at least this, or a three-node flowchart
  // renders postage-stamp sized on a wide monitor.
  const DIAGRAM_MIN_WIDTH = 360;
  // The block's own padding and border, both sides, since aspect-ratio applies to
  // the border box.
  const DIAGRAM_BLOCK_CHROME = 26;

  function sizeDiagramContainer(svg) {
    const block = svg.closest(".mermaid-block");
    if (!block) {
      return;
    }

    let width = 0;
    let height = 0;

    const viewBox = svg.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      width = viewBox.width;
      height = viewBox.height;
    } else {
      // No usable viewBox (some diagram types), so measure what was drawn.
      try {
        const box = svg.getBBox();
        width = box.width;
        height = box.height;
      } catch {
        // getBBox throws on a detached or not-yet-laid-out SVG; fall through.
      }
    }

    if (width > 0 && height > 0) {
      block.style.aspectRatio = `${width} / ${height}`;
      // Capping the width at the diagram's natural size is what keeps a small
      // diagram small. Without it, width:100% stretches a 160px flowchart across
      // the whole pane and the aspect ratio then makes it enormously tall.
      block.style.maxWidth = `${Math.max(width, DIAGRAM_MIN_WIDTH) + DIAGRAM_BLOCK_CHROME}px`;
      return;
    }

    block.style.aspectRatio = DIAGRAM_FALLBACK_RATIO;
    block.style.maxWidth = `${DIAGRAM_FALLBACK_WIDTH}px`;
  }

  // Only ever wanted once a diagram has actually been drawn, which is the one
  // moment worth paying for the controls.
  function applyPanZoom(root) {
    if (!root) {
      return Promise.resolve();
    }

    if (global.svgPanZoom) {
      applyLoadedPanZoom(root);
      return Promise.resolve();
    }

    if (!root.querySelector(".mermaid-block svg")) {
      return Promise.resolve();
    }

    return ensureLibrary("panZoom").then((ready) => {
      if (ready) {
        applyLoadedPanZoom(root);
      }
    });
  }

  function applyLoadedPanZoom(root) {
    if (!window.svgPanZoom) {
      return;
    }

    // Anything previously initialized inside this root is about to be replaced.
    destroyPanZoomInstances(root);

    const svgNodes = root.querySelectorAll(".mermaid-block svg");
    svgNodes.forEach((svg) => {
      if (svg.dataset.panzoomInit === "1") {
        return;
      }

      // Must happen before svg-pan-zoom takes over the SVG's own dimensions.
      sizeDiagramContainer(svg);

      mermaidState.panZoomCounter += 1;
      const id = svg.id || `mermaid-svg-${mermaidState.panZoomCounter}`;
      svg.id = id;

      try {
        const panZoomInstance = window.svgPanZoom(`#${id}`, {
          controlIconsEnabled: true,
          fit: true,
          center: true,
          minZoom: 0.5,
          maxZoom: 12,
          zoomScaleSensitivity: 0.3,
          // Off by default so scrolling the page past a diagram scrolls the page.
          // Held Ctrl/Cmd turns it on for as long as the key is down; the +/-
          // control icons work regardless.
          mouseWheelZoomEnabled: false
        });
        svg.dataset.panzoomInit = "1";
        livePanZoomInstances.set(svg, panZoomInstance);
        if (wheelZoomArmed) {
          // Rendered while the modifier was already down.
          panZoomInstance.enableMouseWheelZoom();
        }
        window.requestAnimationFrame(() => {
          try {
            panZoomInstance.resize();
            panZoomInstance.fit();
            panZoomInstance.center();
          } catch (error) {
            console.error("Pan/zoom refit failed", error);
          }
        });
      } catch (error) {
        console.error("Pan/zoom init failed", error);
      }
    });
  }

  async function renderMermaidBlocks(root) {
    // Asked before anything is promoted, and deliberately so. Promoting turns a
    // fenced block into a bare <div>, so doing it first and then finding the
    // engine unavailable would leave the diagram's source as loose body text.
    // A document with no diagram in it never downloads the engine at all.
    const wantsDiagram = Boolean(root?.querySelector(
      "pre > code.language-mermaid, pre > code.lang-mermaid, .mermaid"
    ));

    if (wantsDiagram) {
      await ensureLibrary("mermaid");
    }

    ensureMermaidInitialized();
    if (!window.mermaid) {
      await decorateCodeBlocks(root);
      await renderMathBlocks(root);
      return;
    }

    await waitForNextFrame();
    promoteMermaidCodeBlocks(root);
    await waitForNextFrame();
    const nodes = root.querySelectorAll(".mermaid");
    if (nodes.length === 0) {
      await decorateCodeBlocks(root);
      await renderMathBlocks(root);
      return;
    }

    let hadFailure = false;
    for (const node of nodes) {
      const ok = await renderSingleMermaidNode(node);
      if (!ok) {
        hadFailure = true;
      }
    }

    await decorateCodeBlocks(root);
    await applyPanZoom(root);
    await renderMathBlocks(root);
    if (hadFailure) {
      hooks.onWarning("One or more Mermaid blocks were auto-simplified or could not be parsed.");
    }
  }

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
    ensureMermaidInitialized,
    highlightCodeBlocks,
    decorateCodeBlocks,
    addCopyButtons,
    copyText,
    liveHighlightCode,
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
