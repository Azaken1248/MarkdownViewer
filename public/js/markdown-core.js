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
    }
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

  function renderMathBlocks(root) {
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

      return `
        <section class="notebook-cell notebook-cell-code">
          <div class="notebook-cell-head">
            <span class="notebook-cell-badge">Code</span>
            <span class="notebook-cell-index">${executionCount != null ? `In [${executionCount}]` : `Cell ${cellNumber}`}</span>
          </div>
          <div class="notebook-cell-content">
            <pre class="notebook-code-block"><code class="language-${escapeHtml(notebookLanguage)}">${escapeHtml(source)}</code></pre>
            ${outputHtml ? `<div class="notebook-outputs">${outputHtml}</div>` : ""}
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

  function renderNotebookDocument(rawContent, title) {
    const notebook = JSON.parse(String(rawContent || "").replace(/^\uFEFF/, ""));
    const cells = Array.isArray(notebook?.cells) ? notebook.cells : null;

    if (!cells) {
      throw new Error("Invalid notebook file");
    }

    const notebookLanguage = inferNotebookLanguage(notebook);
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

  function highlightCodeBlocks(root) {
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

  function applyPanZoom(root) {
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
    ensureMermaidInitialized();
    if (!window.mermaid) {
      highlightCodeBlocks(root);
      renderMathBlocks(root);
      return;
    }

    await waitForNextFrame();
    promoteMermaidCodeBlocks(root);
    await waitForNextFrame();
    const nodes = root.querySelectorAll(".mermaid");
    if (nodes.length === 0) {
      highlightCodeBlocks(root);
      renderMathBlocks(root);
      return;
    }

    let hadFailure = false;
    for (const node of nodes) {
      const ok = await renderSingleMermaidNode(node);
      if (!ok) {
        hadFailure = true;
      }
    }

    highlightCodeBlocks(root);
    applyPanZoom(root);
    renderMathBlocks(root);
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
    // Dispatches on file type: notebook, diagram source, or plain markdown.
    renderDocumentContent,
    // Diagrams, code and math
    renderMermaidBlocks,
    promoteMermaidCodeBlocks,
    ensureMermaidInitialized,
    highlightCodeBlocks,
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
