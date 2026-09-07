/* Markdown in, sanitized HTML out — and the small text jobs around it.
 *
 * The math pass runs before marked does, because `$...$` and `\[...\]` are not
 * markdown and marked would mangle them; what comes back is placeholder spans
 * carrying the TeX, for AppMdMath to fill in once KaTeX has arrived.
 */
(function (global) {
  "use strict";

  const { MARKDOWN_SANITIZE_OPTIONS } = global.MdLazy;

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

  global.MdText = {
    normalize, encodeBase64Utf8, decodeBase64Utf8, normalizeMatrixEnvironments, escapeHtml, isNotebookFile, isDiagramFile, toMermaidMarkdown, activeThemeName, normalizeMarkdownMath, renderMarkdown
  };
})(typeof window === "undefined" ? globalThis : window);
